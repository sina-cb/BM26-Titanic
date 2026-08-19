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

/**
 * WHO holds the engine-global edit session (docs/56 D3). The enum NAMES the
 * engine's credential store already carries — `owner` (Sina), `collaborator`
 * (Misha), `bringup` (Sailors) — never credential material, never a token.
 * `null` means no edit session: either the show lock is on, or auth is
 * disabled on this engine (in which case nothing is gated).
 */
export type EditPrincipal = 'owner' | 'collaborator' | 'bringup';

const EDIT_PRINCIPALS: readonly string[] = ['owner', 'collaborator', 'bringup'];

/** The performance-mode state the control renders. */
export interface PerformanceModeState {
  active: boolean;
  /** ISO timestamp the mode was entered, or null when inactive. */
  enteredAt: string | null;
  /** How many deck entries carry unsaved tuning right now (0 when clean). */
  dirtyCount: number;
  /** Thin rows for the dirty entries, for naming them in the exit summary. */
  dirtyEntries: DeckDirtyEntry[];
  /**
   * The engine-global edit-session principal, or null. PERSISTENCE FOLLOWS
   * THIS, not the pad: disk is global, so "is the engine saving" has exactly
   * one answer for every connected CaptainPad (docs/56 D4).
   */
  editPrincipal: EditPrincipal | null;
  /**
   * Does this engine have privileged auth enabled? The engine says so directly
   * because a null `editPrincipal` is ambiguous on its own: on a show engine it
   * means "nobody has unlocked saving", on a bench it means "there is no gate
   * at all". Deriving it client-side would guess; the engine knows.
   */
  authRequired: boolean;
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
  editPrincipal: null,
  // DEFAULT-OFF for the same reason `active` is: before the engine answers, the
  // pad must not paint a "NOT SAVING" warning it cannot yet justify.
  authRequired: false,
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
    dirtyCount?: unknown; dirtyEntries?: unknown; editPrincipal?: unknown;
    authRequired?: unknown;
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
  // `editPrincipal` is present on every frame the engine sends since docs/56,
  // and an explicit null is MEANINGFUL (the session ended). Only an ABSENT
  // field preserves the previous value, so a pre-_228 engine — or a hand-rolled
  // {active} echo — never invents or erases a principal. Unknown strings are
  // rejected rather than rendered.
  const prevPrincipal = normalizeEditPrincipal(prev.editPrincipal);
  const editPrincipal = p.editPrincipal === undefined
    ? prevPrincipal
    : normalizeEditPrincipal(p.editPrincipal);
  return {
    active: p.active,
    enteredAt: p.active ? enteredAt : null,
    dirtyCount,
    dirtyEntries,
    // There is never an edit session while the show lock is on (docs/56 D3) —
    // pin it here too so a racing frame can't paint a chip over the lock.
    editPrincipal: p.active ? null : editPrincipal,
    // Only a real boolean adopts; an absent field keeps the previous answer, so
    // a pre-_228 engine (or a bare {active} echo) never flips the gate story.
    authRequired: typeof p.authRequired === 'boolean'
      ? p.authRequired
      : !!prev.authRequired,
  };
}

/** Coerce an unknown value into a known principal name, or null. */
export function normalizeEditPrincipal(value: unknown): EditPrincipal | null {
  return typeof value === 'string' && EDIT_PRINCIPALS.includes(value)
    ? (value as EditPrincipal)
    : null;
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

/** Copy for the EXIT sheet's actions — the CaptainPad UI exposes exactly two
 *  choices (DISCARD + SAVE CHANGES). The engine still accepts three internal
 *  exitAction values for compatibility. */
export function exitActionLabel(action: PerformanceExitAction): string {
  switch (action) {
    case 'keep-save': return 'SAVE CHANGES';
    case 'restore': return 'DISCARD PERFORMANCE CHANGES';
    case 'keep':
    default: return 'SAVE CHANGES';
  }
}
export function exitActionHint(action: PerformanceExitAction): string {
  switch (action) {
    case 'keep-save':
      return 'Save your session tuning into the playlists and leave performance mode.';
    case 'restore':
      return 'Roll the whole rig back to the pre-show snapshot — every live tweak is discarded.';
    case 'keep':
    default:
      return 'Persist the current live look and leave performance mode.';
  }
}

// ── Exit sheet CHOICES (dirty-aware) ────────────────────────────────────────
// The CaptainPad exit UI exposes exactly TWO choices in this order:
//   1. DISCARD PERFORMANCE CHANGES → exitAction:'restore' (full pre-show rollback)
//   2. SAVE CHANGES → exitAction:'keep-save' when dirty, 'keep' when clean
// `tone` lets the sheet paint SAVE as the emphasized choice and DISCARD as
// destructive.
export interface PerformanceExitChoice {
  action: PerformanceExitAction;
  label: string;
  hint: string;
  tone: 'default' | 'restore' | 'save';
  /**
   * An extra qualifier line under the hint. Only `keep-save` carries one: the
   * engine accepts it from the captain's passcode ALONE (docs/56 D7), and the
   * client cannot pre-know which principal is being typed — that would mean
   * verifying before submit — so the choice stays visible and a sailor gets the
   * engine's 400 rendered in the sheet's error box.
   */
  caption?: string;
}

/** Shown under SAVE CHANGES when dirty. Pinned here so the wording can't drift. */
export const KEEP_SAVE_OWNER_ONLY_CAPTION = 'Captain’s passcode only.';

/**
 * Shown under the exit sheet's passcode field whenever the engine gates the
 * exit (report `_236`). It replaces the old, mute affordance where both exit
 * buttons simply greyed out until something was typed — the operator tapped,
 * nothing happened, and no sentence anywhere said why. The buttons are always
 * live now; this line is the standing explanation, and an empty submit earns the
 * engine's own 401 in the sheet's error box.
 */
export const PASSCODE_REQUIRED_HINT =
  'This engine requires an operator passcode to leave performance mode. '
  + 'Whoever types it owns what gets saved for the rest of the edit session.';

/** Shown on the exit sheet when a valid 30-minute waiver is already on device. */
export const REMEMBERED_OPERATOR_AUTH_HINT =
  'Your operator passcode is remembered on this CaptainPad for the next 30 minutes. '
  + 'Choose how to leave performance mode — no passcode entry needed.';

export function performanceExitChoices(dirtyCount: number): PerformanceExitChoice[] {
  const saveAction: PerformanceExitAction = dirtyCount > 0 ? 'keep-save' : 'keep';
  return [
    {
      action: 'restore',
      label: exitActionLabel('restore'),
      hint: exitActionHint('restore'),
      tone: 'restore',
    },
    {
      action: saveAction,
      label: exitActionLabel(saveAction),
      hint: exitActionHint(saveAction),
      tone: 'save',
      ...(dirtyCount > 0 ? { caption: KEEP_SAVE_OWNER_ONLY_CAPTION } : {}),
    },
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
  return `Discard discards ${noun}.`;
}

// ── EDIT SESSION (docs/56 D5/D8) ────────────────────────────────────────────
// WHO holds the session decides what the ENGINE writes to disk. The pad never
// enforces this — every gate is engine-side, because any HTTP client could
// otherwise walk around a client-only lock — but it must SAY so, loudly and
// exactly once, so nobody spends a night tuning into a void.

/**
 * Will the engine persist what this session does? Mirrors the engine's
 * `principalMaySave()` (api_server.js) term for term.
 *
 * `authRequired=false` (benches, isolated test engines) → every gate is inert
 * and the answer is always yes, which is why a bench never shows a chip.
 */
export function editPrincipalMaySave(
  principal: EditPrincipal | null,
  authRequired: boolean,
): boolean {
  return !authRequired || principal === 'owner';
}

export interface EditSessionChip {
  /** Short, all-caps chip label. */
  label: string;
  /** The one-line explanation behind a tap / for accessibility. */
  detail: string;
}

/**
 * The persistent session chip, or null when nothing needs saying.
 *
 * Null cases, all deliberate: the show lock is on (the perf control already
 * dominates the sidebar and there IS no edit session), an owner session (normal
 * is silent — a chip on every ordinary edit would train the eye to ignore it),
 * and auth-disabled engines (no gate exists to warn about).
 */
export function editSessionChip(
  principal: EditPrincipal | null,
  performanceActive: boolean,
  authRequired: boolean,
): EditSessionChip | null {
  if (performanceActive || !authRequired) return null;
  if (principal === 'owner') return null;
  if (principal === 'collaborator') {
    return {
      label: 'CREW SESSION — LIVE, NOT SAVING',
      detail: 'Changes drive the rig right now but are not written to disk. '
        + 'Tap to enter the captain’s passcode and start saving.',
    };
  }
  if (principal === 'bringup') {
    return {
      label: 'SAILOR SESSION — LIVE, NOT SAVING',
      detail: 'Changes drive the rig right now but are not written to disk. '
        + 'Tap to enter the captain’s passcode and start saving.',
    };
  }
  return {
    label: 'NO EDIT SESSION — NOT SAVING',
    detail: 'Nobody has unlocked saving on this engine. '
      + 'Tap to enter the captain’s passcode and start saving.',
  };
}

/** Copy for the escalation sheet the chip opens. States the D4 consequence
 *  plainly: asserting the owner code BLESSES whatever is live right now. */
export const ESCALATE_SHEET_TITLE = 'Start saving this session';
export const ESCALATE_SHEET_DETAIL =
  'Entering the captain’s passcode starts auto-saving the CURRENT live tuning — '
  + 'including changes made earlier in this session. Any other passcode hands the '
  + 'session over and keeps saving frozen.';

// ── OFFLINE LOCAL VIEW OVERRIDE (report `_250`) ─────────────────────────────
// Performance mode is owned by the ENGINE and the flip is an engine route
// (`POST /performance-mode`). So when the control bus is DOWN the pad has no
// way off the locked performance face — which is exactly the moment the
// operator most needs CONFIG (the engine-address card, the boot-mode toggle).
// docs/56 D1 + report `_228`: an auth-enabled engine BOOTS locked, so a pad
// that cannot reach it sits on that face indefinitely. Operator order: "even
// when engine is down, allow me to switch between edit and performance so I
// can check the config".
//
// The answer is a CLIENT-LOCAL view override that exists ONLY while the engine
// is unreachable. It is pure presentation: never sent to the engine, never
// persisted, and discarded the instant the bus reconnects (the broadcast is
// authoritative again). This function IS that rule, so vitest pins it:
// a `connected` bus ignores the override outright.

export interface LocalViewResolution {
  /** The performance-mode value this pad should PRESENT right now. */
  active: boolean;
  /** True while the client-local override is the one being presented. */
  localOverride: boolean;
}

/**
 * Resolve what the pad shows: the engine's answer, unless the bus is down AND
 * the operator has picked a local view (`override` non-null).
 *
 * `engineConnected === true` ⇒ the override NEVER applies, no matter what it
 * holds. That is the reconnect guarantee in one line: engine truth wins the
 * moment it is available, and it is never merged with the local pick.
 */
export function resolveLocalViewOverride(
  engineActive: boolean,
  engineConnected: boolean,
  override: boolean | null,
): LocalViewResolution {
  const applies = !engineConnected && override !== null;
  return {
    active: applies ? (override as boolean) : engineActive,
    localOverride: applies,
  };
}

/** Standing caption under the mode chip whenever the control bus is down. */
export const ENGINE_OFFLINE_BADGE = 'ENGINE OFFLINE';
/** Added under it once the operator has taken a local view. Together the two
 *  lines read "ENGINE OFFLINE — LOCAL VIEW". */
export const LOCAL_VIEW_BADGE = 'LOCAL VIEW';

/**
 * Accessibility / long-form copy for the offline chip. NO PASSCODE is asked
 * for here, deliberately: nothing can be verified without the engine (the
 * credential ring lives there), and nothing engine-side can be affected by a
 * local view pick. Every gate that matters — the perf-exit passcode (docs/56
 * D2), the edit-session principal (D3) and the eight D6 persistence writers —
 * is enforced ENGINE-SIDE on every request, so this weakens nothing.
 */
export function localViewChipAccessibilityLabel(effectiveActive: boolean): string {
  return effectiveActive
    ? 'Engine offline — show the edit view on this iPad only. Nothing on the rig changes.'
    : 'Engine offline — show the performance view on this iPad only. Nothing on the rig changes.';
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
/** The exit-sheet hint: the controller button can't pick DISCARD vs SAVE. */
export function exitChoiceControllerHint(buttonName: string): string {
  return `${buttonName.toUpperCase()} closes this sheet — choose DISCARD or SAVE CHANGES here on the iPad.`;
}

// ── Performance-dialog summon bus ───────────────────────────────────────────
// The APC mini's SOLO pad summons the SAME guarded flows as tapping the header
// control, per performanceSummonOutcome above: idle → the enter-confirm sheet;
// enter sheet open → CONFIRM (GO LIVE); active → the KEEP/RESTORE exit sheet;
// exit sheet open → close it. The pad never blind-toggles the engine — every
// enter still goes through the confirm flow, and the keep-vs-restore choice is
// answered on the iPad. Only the FIRST subscriber is notified: the
// PerformanceModeControl is mounted once in the app-wide sidebar and RN's
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
