/**
 * performance_mode_logic — PURE state derivations for PERFORMANCE MODE (the
 * live-show structural lock). No React / react-native imports so vitest can pin
 * the logic in plain Node (same posture as engine_settings_logic.ts).
 *
 * Performance mode is owned by the ENGINE (in-memory, never persisted). These
 * helpers cover what the shared hook + the PerformanceModeControl need:
 *   1. a DEFAULT-OFF starting state (the lock must never appear ON before the
 *      engine has answered — the safe default is "not locked"),
 *   2. a defensive RECONCILE from an engine payload (the `performanceMode` WS
 *      broadcast, its POST response, or the /performance-mode + /status seeds)
 *      that ignores malformed fields, and
 *   3. small label / intent helpers kept out of JSX so the exact wording is
 *      unit-testable and can't silently drift.
 */

/**
 * One deck playlist entry that carries operator tuning not yet written to its
 * playlist file (the engine's `pendingDeckFlush` + the live entry if touched).
 * `label` prefers the entry's label and falls back to its pattern name — the
 * engine resolves that; a deleted playlist yields null (fall back to entryId).
 */
export interface DeckDirtyEntry {
  playlist: string;
  entryId: string;
  label: string | null;
}

/** The performance-mode state the control renders. */
export interface PerformanceModeState {
  active: boolean;
  /** ISO timestamp the mode was entered, or null when inactive. */
  enteredAt: string | null;
  /** How many deck entries carry unsaved tuning right now (0 when clean). */
  dirtyCount: number;
  /** Thin rows for the dirty entries, for naming them in the exit summary. */
  dirtyEntries: DeckDirtyEntry[];
}

/**
 * DEFAULT-OFF. Performance mode defaults to inactive both in the engine and
 * here — the control must never flash "● PERFORMANCE" before the first fetch
 * lands, or the operator would think structural edits are locked when they
 * aren't. Dirty state defaults to clean.
 */
export const DEFAULT_PERFORMANCE_MODE: PerformanceModeState = {
  active: false,
  enteredAt: null,
  dirtyCount: 0,
  dirtyEntries: [],
};

/** The three ways the operator can leave the mode. `keep-save` writes the
 *  dirty deck tuning to the playlist files; `keep` keeps the live look but
 *  DISCARDS that backlog; `restore` reverts the whole rig to the pre-show. */
export type PerformanceExitAction = 'keep' | 'keep-save' | 'restore';

/**
 * Coerce an unknown value into a clean DeckDirtyEntry[] — drops any row missing
 * a string playlist/entryId, normalizes a non-string label to null. Never
 * throws; a non-array yields [].
 */
export function normalizeDirtyEntries(value: unknown): DeckDirtyEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DeckDirtyEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { playlist?: unknown; entryId?: unknown; label?: unknown };
    if (typeof r.playlist !== 'string' || typeof r.entryId !== 'string') continue;
    out.push({
      playlist: r.playlist,
      entryId: r.entryId,
      label: typeof r.label === 'string' ? r.label : null,
    });
  }
  return out;
}

/**
 * Merge an engine payload into the current state, ignoring anything that isn't
 * the right type. Accepts the raw WS message ({type:'performanceMode', active,
 * enteredAt, dirtyCount, dirtyEntries}), a POST response body, or a REST seed.
 * A malformed/absent `active` leaves the previous state intact rather than
 * blowing it away; a malformed `enteredAt` normalizes to null. Dirty fields are
 * adopted when the payload carries a finite dirtyCount, otherwise the previous
 * dirty state is preserved (so a plain {active,enteredAt} echo never clobbers a
 * freshly-seeded summary).
 */
export function reconcilePerformanceMode(
  prev: PerformanceModeState,
  patch: unknown,
): PerformanceModeState {
  if (!patch || typeof patch !== 'object') return prev;
  const p = patch as {
    type?: unknown; active?: unknown; enteredAt?: unknown;
    dirtyCount?: unknown; dirtyEntries?: unknown;
  };
  // If a `type` is present it MUST be 'performanceMode' — a stray message of a
  // different type must never mutate this state.
  if (p.type !== undefined && p.type !== 'performanceMode') return prev;
  if (typeof p.active !== 'boolean') return prev;
  const enteredAt =
    typeof p.enteredAt === 'string' && p.enteredAt.length > 0 ? p.enteredAt : null;
  // Tolerate a prev that lacks dirty fields (raw objects in tests / older cache).
  const prevCount = typeof prev.dirtyCount === 'number' ? prev.dirtyCount : 0;
  const prevEntries = Array.isArray(prev.dirtyEntries) ? prev.dirtyEntries : [];
  const hasDirty = typeof p.dirtyCount === 'number' && Number.isFinite(p.dirtyCount);
  const dirtyCount = hasDirty ? (p.dirtyCount as number) : prevCount;
  const dirtyEntries = hasDirty ? normalizeDirtyEntries(p.dirtyEntries) : prevEntries;
  return {
    active: p.active,
    enteredAt: p.active ? enteredAt : null,
    dirtyCount,
    dirtyEntries,
  };
}

/** True iff a raw WS message should drive a performance-mode reconcile. */
export function isPerformanceModeMessage(msg: unknown): boolean {
  return !!msg && typeof msg === 'object' &&
    (msg as { type?: unknown }).type === 'performanceMode';
}

/** The chip label for the current state. Idle names the mode you ENTER
 *  ("PERFORMANCE"); active names the mode you switch BACK to ("EDIT") —
 *  operator ruling 2026-07-13: the active button reads EDIT and turns red. */
export function performanceModeLabel(active: boolean): string {
  return active ? 'EDIT' : 'PERFORMANCE';
}

/** Copy for the ENTER confirmation sheet. */
export const ENTER_CONFIRM_TITLE = 'Enter performance mode?';
export const ENTER_CONFIRM_MESSAGE =
  'Structure locks: adding/removing/reordering channels, playlists, snapshots, ' +
  'and view assignments are disabled. Live tweaks (faders, params, tempo) keep ' +
  'working but WILL NOT be saved — on exit you choose to keep or discard them.';
export const ENTER_CONFIRM_LABEL = 'GO LIVE';

/** Copy for the EXIT sheet's actions. Used verbatim for the CLEAN sheet (no
 *  dirty deck tuning → the original two choices). The dirty save-ask sheet uses
 *  performanceExitChoices() below, which reworded 'keep' to "without saving". */
export function exitActionLabel(action: PerformanceExitAction): string {
  switch (action) {
    case 'keep-save': return 'KEEP & SAVE TUNING';
    case 'restore': return 'RESTORE PRE-SHOW';
    case 'keep':
    default: return 'KEEP LIVE STATE';
  }
}
export function exitActionHint(action: PerformanceExitAction): string {
  switch (action) {
    case 'keep-save':
      return 'Save your session tuning into the playlists and leave performance mode.';
    case 'restore':
      return 'Discard every live tweak and restore the exact look from when you went live.';
    case 'keep':
    default:
      return 'Persist the current live look and leave performance mode.';
  }
}

// ── Exit sheet CHOICES (dirty-aware) ────────────────────────────────────────
// The single source of truth for which buttons the exit sheet shows, in order,
// and their wording — so deck + mixer (one shared component) always match and
// the copy is vitest-pinned. Two shapes:
//   • CLEAN (dirtyCount === 0): the original two choices — KEEP LIVE STATE /
//     RESTORE PRE-SHOW. Nothing was tuned, so there's no save question to ask.
//   • DIRTY (dirtyCount > 0): an explicit save-ask — KEEP & SAVE TUNING /
//     KEEP WITHOUT SAVING / RESTORE PRE-SHOW. Here 'keep' reads "without
//     saving" so the two keeps can never be confused.
// `tone` lets the sheet paint RESTORE as the destructive choice.
export interface PerformanceExitChoice {
  action: PerformanceExitAction;
  label: string;
  hint: string;
  tone: 'default' | 'restore';
}

export function performanceExitChoices(dirtyCount: number): PerformanceExitChoice[] {
  if (dirtyCount > 0) {
    return [
      {
        action: 'keep-save',
        label: 'KEEP & SAVE TUNING',
        hint: 'Save your session tuning into the playlists, then leave performance mode.',
        tone: 'default',
      },
      {
        action: 'keep',
        label: 'KEEP WITHOUT SAVING',
        hint: 'Keep the live look for now, but don’t write the tuning to the playlists.',
        tone: 'default',
      },
      {
        action: 'restore',
        label: 'RESTORE PRE-SHOW',
        hint: exitActionHint('restore'),
        tone: 'restore',
      },
    ];
  }
  return [
    { action: 'keep', label: exitActionLabel('keep'), hint: exitActionHint('keep'), tone: 'default' },
    { action: 'restore', label: exitActionLabel('restore'), hint: exitActionHint('restore'), tone: 'restore' },
  ];
}

/** Friendly name for one dirty entry — its label, else its raw entry id. */
export function dirtyEntryName(entry: DeckDirtyEntry): string {
  const label = entry.label && entry.label.trim();
  return label ? label : entry.entryId;
}

/**
 * The warm one-line summary at the top of the DIRTY exit sheet: how many
 * patterns were tuned this session, naming them when there are three or fewer.
 * Returns '' for a clean session (the sheet omits the line entirely).
 */
export function dirtySummaryText(count: number, entries: DeckDirtyEntry[]): string {
  if (count <= 0) return '';
  if (count <= 3 && entries.length > 0) {
    const names = entries.slice(0, count).map(dirtyEntryName).join(', ');
    const verb = count === 1 ? 'was' : 'were';
    return `${names} ${verb} tuned during this session.`;
  }
  return `${count} patterns were tuned during this session.`;
}

/** The RESTORE consequence line for the DIRTY sheet — names the count that gets
 *  discarded so the operator knows what RESTORE throws away. */
export function dirtyRestoreCaption(count: number): string {
  if (count <= 0) return '';
  const noun = count === 1 ? 'this session tweak' : `all ${count} tuned patterns`;
  return `RESTORE discards ${noun}.`;
}

// ── Summon outcome (what a SOLO press DOES, given the dialog UI state) ─────
// Operator ruling 2026-07-13 (round 2): a second SOLO press while the ENTER
// confirm sheet is open CONFIRMS (GO LIVE) — press SOLO, press SOLO again,
// you're live. The EXIT sheet is different: one button cannot choose between
// KEEP and RESTORE, so a second press there only CLOSES the sheet (safe and
// reversible — press again to reopen); the sheet carries a hint that the
// choice must be made on the iPad. Pure decision fn so vitest pins the matrix.
export interface PerformanceDialogUiState {
  /** Engine performance-mode active (the authoritative WS-reconciled state). */
  active: boolean;
  /** The ENTER confirm sheet is currently open. */
  enterConfirmOpen: boolean;
  /** The KEEP/RESTORE exit sheet is currently open. */
  exitSheetOpen: boolean;
  /** An enter/exit POST is in flight — presses are ignored. */
  pending: boolean;
}

export type PerformanceSummonOutcome =
  | 'openEnterConfirm' // idle, nothing open → show the enter-confirm sheet
  | 'confirmEnter'     // enter sheet open → second press = GO LIVE
  | 'openExitSheet'    // active, nothing open → show the KEEP/RESTORE sheet
  | 'closeExitSheet'   // exit sheet open → close it (choice stays on the iPad)
  | 'none';            // pending — ignore the press

export function performanceSummonOutcome(
  s: PerformanceDialogUiState,
): PerformanceSummonOutcome {
  if (s.pending) return 'none';
  if (s.enterConfirmOpen) return 'confirmEnter';
  if (s.exitSheetOpen) return 'closeExitSheet';
  return s.active ? 'openExitSheet' : 'openEnterConfirm';
}

// ── Controller-affordance copy ──────────────────────────────────────────────
// Rendered ONLY when a connected MIDI controller binds the performanceDialog
// action (usePerformanceDialogButton() → the physical button's name, e.g.
// "SOLO"). Null controller → the sheets render exactly as without a controller.
/** The press-again row on the ENTER confirm sheet. */
export function pressAgainToGoLiveLabel(buttonName: string): string {
  return `● PRESS ${buttonName.toUpperCase()} AGAIN TO GO LIVE`;
}
/** The exit-sheet hint: the controller button can't pick KEEP vs RESTORE. */
export function exitChoiceControllerHint(buttonName: string): string {
  return `${buttonName.toUpperCase()} closes this sheet — choose KEEP or RESTORE here on the iPad.`;
}

// ── Performance-dialog summon bus ───────────────────────────────────────────
// The APC mini's SOLO pad summons the SAME guarded flows as tapping the header
// control, per performanceSummonOutcome above: idle → the enter-confirm sheet;
// enter sheet open → CONFIRM (GO LIVE); active → the KEEP/RESTORE exit sheet;
// exit sheet open → close it. The pad never blind-toggles the engine — every
// enter still goes through the confirm flow, and the keep-vs-restore choice is
// answered on the iPad. Only the FIRST subscriber is notified: the
// PerformanceModeControl is mounted in BOTH headers (deck + mixer) and RN's
// Modal overlays globally, so one handler is enough and two would stack
// duplicate sheets. Pure module state (no React/transport imports) so vitest
// pins the semantics in plain Node.
const _summonListeners: Array<() => void> = [];

/** Register a summon handler. Returns an unsubscribe. */
export function subscribePerformanceDialogSummon(l: () => void): () => void {
  _summonListeners.push(l);
  return () => {
    const i = _summonListeners.indexOf(l);
    if (i >= 0) _summonListeners.splice(i, 1);
  };
}

/** Ask the mounted PerformanceModeControl to open/close its dialog. Returns
 *  true when a handler was mounted to receive it (false = no UI mounted). */
export function summonPerformanceDialog(): boolean {
  const first = _summonListeners[0];
  if (!first) return false;
  try {
    first();
  } catch {
    // A buggy handler must never break the MIDI callback that summoned it.
  }
  return true;
}
