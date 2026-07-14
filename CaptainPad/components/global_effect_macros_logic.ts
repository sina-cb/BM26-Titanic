/**
 * Pure, testable derivations for GlobalEffectMacros (the global-effects strip).
 *
 * Extracted from GlobalEffectMacros.tsx so the slot bound/empty + page-window
 * logic can be unit-tested without pulling in react-native (mirrors the
 * deck_tx_logic.ts split). Sina's standing rule: the connections must be
 * asserted by tests — these functions are the ones the "can't remove/change an
 * effect" bug lived in.
 *
 * THE BUG (Sina, live iPad): removing or changing an effect in CaptainPad did
 * nothing visible. Root cause: the REMOVE action PATCHes `{ enabled:false }`,
 * and the engine's clear KEEPS the slot's `effectId` (it only flips `enabled`
 * — see global_effect_slot_manager.patchSlot). The strip decided bound-vs-empty
 * on `effectId` ALONE, so a cleared slot kept rendering its old effect forever.
 * `slotIsBound` is the fix: a slot is bound iff it is BOTH enabled AND carries
 * an effectId. Every surface (grid cells, page-activity dots, swap sheet) shares
 * this one predicate so they can never disagree.
 */

/** The visible-slot window size + page geometry (mirrors the engine's paging:
 *  page p views flat slot ids `8p+1 .. 8p+8`). */
export const VISIBLE_SLOT_COUNT = 8;
export const EFFECTS_PAGE_COUNT = 4;

// party 2026-07-11 — single-page effects layout. FLIP TO `true` TO RESTORE the
// 4-page switcher. The party redesign remapped the VSN1 side buttons (they used
// to drive the effects page) to MODE/VIEW/empty/LOGO, so ONLY page 0 (the
// party-8 layout) is ever in use. The 4-page switcher chrome + the "PAGE Pn"
// badge were eating vertical space in the deck/mixer bottom bar (and squeezing
// the deck pattern column), so with this false the grid renders page 0 ONLY and
// the pager UI is hidden. ALL engine paging PLUMBING stays wired underneath —
// the `page` state, GET/PATCH /global-effects/page, and the `effectsPage` WS
// broadcast are untouched — so restoring the switcher is this one-line change.
export const SHOW_EFFECT_PAGES = false;

/**
 * The page the strip should actually RENDER. When the pager UI is hidden
 * (SHOW_EFFECT_PAGES=false, the party single-page layout) we pin page 0
 * regardless of the engine's active `effectsPage`; when it's shown we honour the
 * engine page verbatim. Pure + total so the "pages hidden ⇒ always page 0"
 * contract is unit-tested without react-native.
 */
export function resolveEffectsPage(
  enginePage: number,
  showPages: boolean = SHOW_EFFECT_PAGES,
): number {
  return showPages ? enginePage : 0;
}

/** Flat slot id (1..32) for the `index0`-th visible cell on `page`. */
export const slotIdForPage = (page: number, index0: number): number =>
  page * VISIBLE_SLOT_COUNT + index0 + 1;

/** Minimal shape the bound/empty decision needs. */
export interface SlotBindingLike {
  slotId?: number;
  effectId?: string;
  enabled?: boolean;
  active?: boolean;
}

/**
 * Is a slot BOUND (renders as a live effect chip) or EMPTY (renders the "+"
 * socket)? Bound iff enabled AND effectId present. A disabled slot is empty
 * regardless of the stale effectId the engine still reports after a clear —
 * this is the "can't remove an effect" fix.
 */
export function slotIsBound(slot: SlotBindingLike | null | undefined): boolean {
  return !!slot && slot.enabled !== false && !!slot.effectId;
}

/**
 * Build the VISIBLE_SLOT_COUNT cells for `page` from the full engine slot array.
 * A bound slot on the page passes through; an empty/disabled/absent slot becomes
 * an empty stencil carrying the flat slotId (so a PATCH can fill it). Pure and
 * total — always returns exactly VISIBLE_SLOT_COUNT cells.
 */
export function computeVisibleSlots<T extends SlotBindingLike>(
  slots: T[],
  page: number,
  emptyStencil: (slotId: number) => T,
): T[] {
  const realById = new Map<number, T>();
  for (const s of slots) {
    if (typeof s.slotId === 'number') realById.set(s.slotId, s);
  }
  const out: T[] = [];
  for (let i = 0; i < VISIBLE_SLOT_COUNT; i += 1) {
    const slotId = slotIdForPage(page, i);
    const real = realById.get(slotId);
    out.push(slotIsBound(real) ? (real as T) : emptyStencil(slotId));
  }
  return out;
}

/** Which pages (0..EFFECTS_PAGE_COUNT-1) have at least one BOUND + ACTIVE slot
 *  — the page-switcher activity dots. A disabled slot never counts (it's empty),
 *  so a cleared-but-was-active slot correctly drops its page's dot. */
export function computePageActivity(slots: SlotBindingLike[]): boolean[] {
  const arr = Array.from({ length: EFFECTS_PAGE_COUNT }, () => false);
  for (const s of slots) {
    if (typeof s.slotId !== 'number' || !slotIsBound(s) || !s.active) continue;
    const p = Math.floor((s.slotId - 1) / VISIBLE_SLOT_COUNT);
    if (p >= 0 && p < EFFECTS_PAGE_COUNT) arr[p] = true;
  }
  return arr;
}

// ── VSN1 controller profile (2026-07) ────────────────────────────────────────
// The VSN1 has two profiles (engine-owned, GET/PATCH /global-effects/profile,
// WS-broadcast `controllerProfile`): 'edit' and 'play'. This is a VSN1
// DEVICE-SURFACE concept ONLY — the physical device swaps its Lua template set
// on toggle (sb_2). It has ZERO effect on the CaptainPad effects grid: the iPad
// grid ALWAYS renders the full authoring UI (swap ⋯, per-slot value/mode editor,
// empty "+" sockets to bind, normal sizing) regardless of profile. Earlier this
// profile degraded the CaptainPad presentation ('play' hid affordances + grew
// cells); that coupling was removed (operator: the effects UI must always look
// and behave the same). The type + reconcile/guard below stay so the hook can
// keep following the broadcast for the DEVICE — the presentation is decoupled.

export type ControllerProfile = 'edit' | 'play';

/** Shipping default when the engine hasn't reported a profile yet: EDIT, i.e.
 *  today's full UI (never guess PLAY and silently hide the authoring controls). */
export const DEFAULT_CONTROLLER_PROFILE: ControllerProfile = 'edit';

/** Type guard for the engine's `{type:'controllerProfile', profile}` WS message
 *  (and its connect replay). Only 'edit'/'play' are accepted — a malformed value
 *  is rejected here so the reconcile below keeps the last-known-good profile. */
export function isControllerProfileMessage(
  msg: unknown,
): msg is { type: 'controllerProfile'; profile: ControllerProfile } {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; profile?: unknown };
  return m.type === 'controllerProfile' && (m.profile === 'edit' || m.profile === 'play');
}

/** Fold an incoming profile value onto the previous one. A valid 'edit'/'play'
 *  wins; anything else is ignored (keep last-known-good — never fall back to a
 *  guessed profile that would flip the operator's surface out from under them). */
export function reconcileControllerProfile(
  prev: ControllerProfile,
  incoming: unknown,
): ControllerProfile {
  return incoming === 'edit' || incoming === 'play' ? incoming : prev;
}

/** The presentation the effects grid renders. This is now INVARIANT — the same
 *  full authoring presentation for every controller profile (operator: the
 *  CaptainPad effects UI must ALWAYS look and behave the same regardless of the
 *  VSN1 profile). `showEditAffordances` gates the swap ⋯ pencil AND the
 *  value/mode detail badge; `showEmptySockets` gates the tappable "+" bind
 *  sockets; `cellHeightScale` multiplies the base chip height; `showBlackout` is
 *  the e-stop. All constant now — the profile no longer touches the grid.
 *  (Structural affordances are still dimmed by PERFORMANCE MODE — a separate
 *  concern handled in the component via usePerfLock, not here.) */
export interface EffectsPresentation {
  showEditAffordances: boolean;
  showEmptySockets: boolean;
  showBlackout: boolean;
  cellHeightScale: number;
}

/** The one authoring presentation the grid always renders. Kept as a function
 *  (not a bare const) so the call site + tests keep a stable shape and the
 *  "identical for every profile" contract is pinned; it takes no profile because
 *  the presentation is deliberately profile-independent. */
export function resolveEffectsPresentation(): EffectsPresentation {
  return {
    showEditAffordances: true,
    showEmptySockets: true,
    showBlackout: true,
    cellHeightScale: 1,
  };
}

// ── MODE BADGE — performance-mode LOCKED indicator (2026-07) ──────────────────
// The grid presentation no longer changes with the controller profile, so the
// old PLAY badge variant (an on-screen escape hatch out of the now-removed PLAY
// UI degradation) is gone. The ONLY remaining badge is LOCKED: performance mode
// genuinely dims the structural affordances (⋯ swap / "+" bind), so a passive
// status pill explaining WHY they're inert stays useful. Pure so the state
// (locked vs no-badge) is unit-tested without react-native.

export type ModeBadgeKind = 'locked';

export interface ModeBadge {
  /** Which state the badge announces. Drives the component's colour choice. */
  kind: ModeBadgeKind;
  /** The exact copy rendered in the badge. */
  label: string;
}

/**
 * Derive the mode badge from the performance-mode lock. Returns `null` unless a
 * show is live:
 *   - perfLocked → LOCKED badge, passive (explains the inert ⋯/＋).
 *   - unlocked   → null (no badge — the grid looks exactly as it always has).
 * The controller profile is deliberately NOT an input: it never changes the grid.
 */
export function modeBadge(perfLocked: boolean): ModeBadge | null {
  if (perfLocked) {
    return { kind: 'locked', label: 'LOCKED — performance mode' };
  }
  return null;
}

// ── VSN1 layout auto-deploy error banner (2026-07) ───────────────────────────
// The engine broadcasts `{type:'vsn1LayoutDeploy', deploying, lastResult,
// lastError, ...}` around every device re-flash. Before this, CaptainPad acted
// ONLY on the `ok` result and IGNORED errors — a silently failed flash (e.g. a
// full 8-slot page overflowing the device's 909-char LCD budget) left the grid
// looking deployed while the device never updated. This reducer derives a
// visible, dismissible error strip from the broadcast stream: an `error` result
// surfaces the reason; a later `ok` clears it. Pure so the derivation is tested
// without react-native.

/** Fold a `vsn1LayoutDeploy` broadcast into the deploy-error banner state.
 *  Returns:
 *    - `undefined` → NO CHANGE (an unrelated message, or an in-flight
 *      `deploying:true` frame — the previous banner holds until a result lands),
 *    - `null` → CLEAR the banner (a successful `ok` result), or
 *    - a string → SHOW this error message (a settled `error` result).
 *  The caller stores the last non-`undefined` value in component state and may
 *  additionally set it to `null` on an operator dismiss. */
export function deployBannerMessage(
  msg: { type?: unknown; deploying?: unknown; lastResult?: unknown; lastError?: unknown },
): string | null | undefined {
  if (!msg || msg.type !== 'vsn1LayoutDeploy') return undefined;
  // Only ACT on a settled result. An in-flight frame (deploying:true) carries a
  // STALE lastResult from the previous flash, so ignore it — the previous banner
  // (if any) holds until this deploy resolves.
  if (msg.deploying === true) return undefined;
  if (msg.lastResult === 'ok') return null;
  if (msg.lastResult === 'error') {
    const detail = typeof msg.lastError === 'string' && msg.lastError.trim()
      ? msg.lastError.trim()
      : 'unknown error';
    return `VSN1 layout NOT deployed: ${detail}`;
  }
  // Any other result (e.g. 'disabled', or a frame with no result yet) — no change.
  return undefined;
}
