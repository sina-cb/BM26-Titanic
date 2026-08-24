/**
 * deck_workspace_layout — the PURE layout brain of the Deck window workspace
 * (contract: docs/53_deck_workspace_windows.md §3.1, design report _196).
 *
 * ZERO react / react-native imports on purpose: the vitest config only admits
 * pure `.ts` under `components/**` (RN components are `.tsx` and stay
 * excluded), so every layout rule below is unit-testable in plain Node. The
 * render layer (deck_workspace.tsx / deck_window.tsx) may only ASK this module
 * questions — it never re-derives a layout fact of its own.
 *
 * Model (ported from the Live Touch panel manager, docs/53 §1):
 *   1. A closed window leaves the layout ENTIRELY — it gets no track, and the
 *      survivors reflow into its space. It is NOT unmounted (see
 *      `windowDisplay`): hiding keeps scroll position, local component state
 *      and the WS reconciles alive, which is the whole reason minimize ≠ close.
 *   2. Closed windows collect on a compact restore rail, in CLOSE order
 *      (`railWindows`) — a window with no rail chip would be unreachable.
 *   3. A floor of open windows is enforced at BOTH ends: PATTERNS is protected
 *      (the reducer refuses to close it AND the normalizer purges it from a
 *      hand-edited store), so at least one window is always open.
 *   4. Only the CLOSED SET is persisted, under a versioned key. Layout is a
 *      view preference; it never carries engine state.
 */

import { WORKSPACE_KNOWN_SET_RULE } from '@/components/workspace_known_set_policy';

/** Re-exported so a reader who lands in THIS file's normalizer (below) does
 *  not have to go find the shared statement — see
 *  `components/workspace_known_set_policy.ts` for why the rule lives there
 *  and not restated per module (docs/64 §10 convergence duty: this module's
 *  new-id policy and the mixer's must "read as one rule"). */
export { WORKSPACE_KNOWN_SET_RULE };

/** The six Deck windows. */
export type DeckWindowId =
  | 'patterns'
  | 'parameters'
  | 'autopilot'
  | 'overlays'
  | 'colors'
  | 'pixels';

/** Canonical (left-to-right / top-to-bottom) order. Also the render order.
 *  PIXELS is appended LAST so adding it moved nothing: every previously
 *  reachable composition renders exactly as it did before (report _225). */
export const DECK_WINDOW_IDS: readonly DeckWindowId[] = [
  'patterns',
  'parameters',
  'autopilot',
  'overlays',
  'colors',
  'pixels',
];

/** The two Deck bars (docs/63 §2.1) — horizontal strips ABOVE the window
 *  workspace, not columns in it. They live in the SAME closed-set tier as
 *  the windows (one reducer, one store, one chip row) but are typed
 *  separately on purpose: every window-only selector (`openWindows`,
 *  `wideFlexFor`, `patternsFillsNarrow`, `effectiveOpenWindows`,
 *  `narrowScrollOwner`) stays total over windows and closed to bars by
 *  construction, not by runtime filtering discipline. */
export type DeckBarId = 'audioBar' | 'outputBar';

/** All surfaces the workspace tracks: windows, then bars. */
export type DeckSurfaceId = DeckWindowId | DeckBarId;

/** Canonical bar order (also the render order within the bar chip group). */
export const DECK_BAR_IDS: readonly DeckBarId[] = ['audioBar', 'outputBar'];

/** Every surface the layout can name, windows first. */
export const DECK_SURFACE_IDS: readonly DeckSurfaceId[] = [...DECK_WINDOW_IDS, ...DECK_BAR_IDS];

/** PATTERNS hosts the deck's pattern lists — the deck is useless without it,
 *  so it has no close affordance in the UI at all and the reducer backstops
 *  that (docs/53 §3.1: an affordance that always refuses should not exist). */
export const PROTECTED_WINDOW: DeckWindowId = 'patterns';

/** Operator-facing window names (10pt SpaceGrotesk caps label recipe). */
export const DECK_WINDOW_TITLES: Readonly<Record<DeckWindowId, string>> = {
  patterns: 'PATTERNS',
  parameters: 'PARAMETERS',
  autopilot: 'AUTOPILOT',
  overlays: 'OVERLAYS',
  colors: 'COLORS',
  pixels: 'PIXELS',
};

/** Operator-facing bar names, same label recipe as the windows (docs/63 §3.3). */
export const DECK_BAR_TITLES: Readonly<Record<DeckBarId, string>> = {
  audioBar: 'AUDIO',
  outputBar: 'OUTPUT',
};

/** AsyncStorage key — version lives IN the key (Live Touch `_v2` convention).
 *  A future schema change bumps to `_v2`; old keys are simply ignored, there
 *  is no migration because this is a preference, not engine state. */
export const DECK_WORKSPACE_LAYOUT_KEY = 'deck_workspace_layout_v1';

/** The whole runtime/persisted layout state: the closed set (windows AND
 *  bars, docs/63 §2.2), in close order. */
export type DeckWorkspaceLayout = { closed: DeckSurfaceId[] };

// Frozen so an accidental in-place mutation of the shared default throws in
// strict mode instead of silently poisoning every later hydrate.
const DEFAULT_CLOSED: DeckSurfaceId[] = ['overlays', 'colors', 'pixels'];
Object.freeze(DEFAULT_CLOSED);

/** COLORS starts on the restore rail so the default Deck keeps today's
 *  three-column composition (docs/53 §9 operator decision 1).
 *
 *  PIXELS joins it there for a DIFFERENT and stricter reason (report _225):
 *  only the CLOSED SET is persisted, so a window that defaults to OPEN would
 *  appear on every deck that already has a stored layout — the stored set
 *  cannot possibly name a window that did not exist when it was written.
 *  Defaulting PIXELS to closed makes the upgrade a no-op for every operator
 *  who has ever touched the workspace bar: their deck comes back byte-identical
 *  and the new window waits on the HIDDEN rail until they ask for it. */
export const DEFAULT_LAYOUT: DeckWorkspaceLayout = { closed: DEFAULT_CLOSED };
Object.freeze(DEFAULT_LAYOUT);

/** Wide-mode flex weight per window. All-open reproduces today's operator-
 *  locked 40/30/30 split exactly (PATTERNS 4 / PARAMETERS 3 / AUTOPILOT 3 —
 *  see the column-weights ruling in app/(tabs)/index.tsx), plus COLORS 3.
 *
 *  PIXELS gets 4, the only non-3 secondary window. Its content is a single
 *  wide-aspect picture of the ship (the sim's design space is 900×520), and a
 *  letterboxed fit is bounded by the NARROWER axis — at weight 3 in the
 *  all-five-open row the ship shrank to fit a column it could not use. Weight
 *  is the honest lever: it costs the other windows a few points each and buys
 *  the one window whose whole job is to be looked at. */
const WIDE_FLEX: Readonly<Record<DeckWindowId, number>> = {
  patterns: 4,
  parameters: 3,
  autopilot: 3,
  overlays: 3,
  colors: 3,
  pixels: 4,
};

/** The shipped default deck's total wide weight (patterns 4 + parameters 3 +
 *  autopilot 3 = 10) — derived from `DEFAULT_LAYOUT` so it can never drift
 *  out of sync with it.
 *
 *  Operator report, live iPad: "when all views are hidden and then I enable
 *  one, it takes over most of the screen." Cause: flexbox renormalizes over
 *  the OPEN set only, so a lone reopened secondary (weight 3 or 4) against a
 *  lone PATTERNS (weight 4) landed at an inflated 43–50% instead of its
 *  shipped-default share. The fix (`wideFlexFor` below): a window reopened
 *  into a sparse deck returns at the share it has in the SHIPPED DEFAULT
 *  deck; the protected window absorbs the slack. Every composition whose raw
 *  weight sum already reaches this floor is untouched — which is what keeps
 *  the operator-locked 40/30/30 default split, and the all-five-open split,
 *  byte-identical. */
export const WIDE_FLEX_FLOOR: number = DECK_WINDOW_IDS
  .filter((id) => !DEFAULT_LAYOUT.closed.includes(id))
  .reduce((sum, id) => sum + WIDE_FLEX[id], 0);

/** The ONE way layout state changes. Actions operate on the full surface
 *  union (windows AND bars, docs/63 §2.2) — one reducer, one tier. */
export type LayoutAction =
  | { type: 'close'; id: DeckSurfaceId }
  | { type: 'open'; id: DeckSurfaceId }
  | { type: 'reset' };

/** Runtime type guard — untrusted input (a persisted store, a stray action)
 *  is checked here and nowhere else. WINDOW-ONLY on purpose (docs/63 §2.1):
 *  callers that must stay total over windows and closed to bars (the wide
 *  flex table, the narrow scroll owner, the performance overlay) narrow with
 *  this guard, never with `isDeckSurfaceId`. */
export function isDeckWindowId(value: unknown): value is DeckWindowId {
  return typeof value === 'string'
    && (DECK_WINDOW_IDS as readonly string[]).includes(value);
}

/** Runtime type guard over the full surface union (windows + bars). */
export function isDeckSurfaceId(value: unknown): value is DeckSurfaceId {
  return typeof value === 'string'
    && (DECK_SURFACE_IDS as readonly string[]).includes(value);
}

function sameClosed(a: readonly DeckSurfaceId[], b: readonly DeckSurfaceId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function cloneDefault(): DeckWorkspaceLayout {
  return { closed: [...DEFAULT_LAYOUT.closed] };
}

/**
 * Pure reducer. Returns the SAME reference for a no-op so a React state
 * update can bail cheaply (and so "did anything change?" is a `!==` check at
 * the persistence boundary).
 *
 * An unknown `action.type` THROWS — that can only be a coding bug, and this
 * repo fails loudly (codex P0: no silent fallbacks).
 */
export function layoutReducer(
  state: DeckWorkspaceLayout,
  action: LayoutAction,
): DeckWorkspaceLayout {
  switch (action.type) {
    case 'close': {
      // Unknown ids and the protected window are no-ops, never throws: the
      // reducer is the backstop behind a UI that already refuses to render a
      // close affordance for PATTERNS. PROTECTED_WINDOW is the only refusal —
      // both bars close freely (docs/63 §2.2).
      if (!isDeckSurfaceId(action.id)) return state;
      if (action.id === PROTECTED_WINDOW) return state;
      if (state.closed.includes(action.id)) return state;
      return { closed: [...state.closed, action.id] };
    }
    case 'open': {
      if (!isDeckSurfaceId(action.id)) return state;
      if (!state.closed.includes(action.id)) return state;
      return { closed: state.closed.filter((id) => id !== action.id) };
    }
    case 'reset':
      return sameClosed(state.closed, DEFAULT_LAYOUT.closed) ? state : cloneDefault();
    default:
      throw new Error(
        `[deck_workspace_layout] unknown layout action: ${JSON.stringify(action)}`,
      );
  }
}

/**
 * The windows that existed before the store started recording `known`
 * (report _225). A persisted layout with NO `known` field was written by a
 * build that shipped exactly these four.
 */
export const LEGACY_KNOWN_WINDOWS: readonly DeckWindowId[] = [
  'patterns',
  'parameters',
  'autopilot',
  'colors',
];

/**
 * What actually goes into AsyncStorage.
 *
 * WHY THIS IS NOT JUST `{closed}` (the bug this exists to prevent): the store
 * records the CLOSED set, so "open" is the absence of a name — which means a
 * store written before a window existed is indistinguishable from a store
 * whose author deliberately opened it. Adding a fifth window to a pure
 * closed-set store therefore springs that window OPEN on every operator who
 * had ever touched the workspace bar, because their stored `closed` could not
 * possibly name it. Recording the set of windows the store HAD AN OPINION
 * ABOUT closes that hole: anything outside `known` is NEW, and a new window
 * arrives closed, exactly like the shipped default.
 *
 * The key stays `_v1` on purpose — this is a backwards-compatible ADDITION,
 * and bumping the key would discard every operator's real preferences to fix
 * a problem that only affects the one window being added.
 */
export type StoredDeckWorkspaceLayout = {
  closed: DeckSurfaceId[];
  known: DeckSurfaceId[];
};

/** The exact object the persistence layer writes. `known` names all SEVEN
 *  surfaces (docs/63 §2.3) — windows and bars share one upgrade discipline. */
export function serializeLayout(state: DeckWorkspaceLayout): StoredDeckWorkspaceLayout {
  return { closed: [...state.closed], known: [...DECK_SURFACE_IDS] };
}

/**
 * TOTAL normalizer for untrusted input (the AsyncStorage hydrate). Never
 * throws. Deterministic:
 *   - not an object / `closed` not an array  → DEFAULT_LAYOUT (caller logs)
 *   - unknown ids dropped, duplicates deduped, surviving order preserved
 *   - the protected window purged from `closed`, so a hand-edited or stale
 *     store can never boot into a state the UI itself would refuse to create.
 *   - any surface the store did not KNOW ABOUT falls back to its SHIPPED
 *     DEFAULT membership (docs/63 §2.3, generalizing the `_225` rule): a
 *     WINDOW outside `known` is appended to `closed` (shipping a new window
 *     never rearranges a deck the operator already set up); a BAR outside
 *     `known` is left OPEN, because bars ship open — a store written before
 *     the bars existed hydrates to a deck whose bars are exactly where they
 *     are today, and the two new chips simply appear OPEN. The rule the two
 *     cases share is `WORKSPACE_KNOWN_SET_RULE` (imported above, canonical
 *     text in `components/workspace_known_set_policy.ts`) — the SAME
 *     constant the mixer's `mixer_workspace_layout.ts` re-exports for its
 *     own namespaced-id version of this rule (docs/64 §10 convergence duty).
 *   - EVERY FUTURE WINDOW must default closed for this to hold — only the
 *     closed set is persisted, so a default-open window would spring open on
 *     every stored layout that predates it.
 * NOTE `{closed: []}` is a LEGITIMATE persisted layout (every window that
 * store knew about is open, both bars shown) — only hopeless input falls
 * back to the default.
 */
export function normalizeLayout(input: unknown): DeckWorkspaceLayout {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return cloneDefault();
  }
  const raw = (input as { closed?: unknown }).closed;
  if (!Array.isArray(raw)) return cloneDefault();
  const closed: DeckSurfaceId[] = [];
  for (const entry of raw) {
    if (!isDeckSurfaceId(entry)) continue;
    if (entry === PROTECTED_WINDOW) continue;
    if (closed.includes(entry)) continue;
    closed.push(entry);
  }
  // Which surfaces did the WRITER of this store know about? An absent/invalid
  // `known` means a pre-_225 build, which shipped LEGACY_KNOWN_WINDOWS (bars
  // did not exist yet, so none of them were ever "known" pre-_225 either —
  // which is exactly right, since an unknown bar defaults OPEN below).
  const rawKnown = (input as { known?: unknown }).known;
  const known: DeckSurfaceId[] = Array.isArray(rawKnown)
    ? rawKnown.filter(isDeckSurfaceId)
    : [...LEGACY_KNOWN_WINDOWS];
  // Unknown WINDOWS default closed. Unknown BARS default open, so there is
  // nothing to append for them here — their absence from `closed` IS their
  // default.
  for (const id of DECK_WINDOW_IDS) {
    if (id === PROTECTED_WINDOW) continue;
    if (known.includes(id)) continue;
    if (closed.includes(id)) continue;
    closed.push(id);
  }
  return { closed };
}

/** Open windows in CANONICAL order (the render order of the tracks). Filters
 *  against `DECK_WINDOW_IDS` — total over windows, closed to bars by
 *  construction, even though `closed` itself may name bars (docs/63 §2.2). */
export function openWindows(state: DeckWorkspaceLayout): DeckWindowId[] {
  return DECK_WINDOW_IDS.filter((id) => !state.closed.includes(id));
}

/** Shown bars in CANONICAL order (`DECK_BAR_IDS`), before any suppression. */
export function shownBars(state: DeckWorkspaceLayout): DeckBarId[] {
  return DECK_BAR_IDS.filter((id) => !state.closed.includes(id));
}

/** Closed windows in CLOSE order — the restore-rail order. Narrows to
 *  `DeckWindowId[]` via `isDeckWindowId`, so a closed bar never leaks into a
 *  window-only rail. */
export function railWindows(state: DeckWorkspaceLayout): DeckWindowId[] {
  return state.closed.filter(isDeckWindowId);
}

/** The restore rail across BOTH tiers, in close order — windows and bars
 *  interleaved exactly as they were closed (docs/63 §2.2). */
export function railSurfaces(state: DeckWorkspaceLayout): DeckSurfaceId[] {
  return state.closed.filter(isDeckSurfaceId);
}

export function isOpen(state: DeckWorkspaceLayout, id: DeckWindowId): boolean {
  return isDeckWindowId(id) && !state.closed.includes(id);
}

/** Is this surface (window OR bar) currently shown? */
export function isShown(state: DeckWorkspaceLayout, id: DeckSurfaceId): boolean {
  return isDeckSurfaceId(id) && !state.closed.includes(id);
}

/** Does this surface get a close affordance at all? True for every window
 *  except the protected one, and true for BOTH bars (docs/63 §2.2 — bars
 *  close as freely as any non-protected window). */
export function canClose(id: DeckSurfaceId): boolean {
  return isDeckSurfaceId(id) && id !== PROTECTED_WINDOW;
}

/**
 * Wide-mode flex weight. A closed window gets 0 (it has no track — the render
 * layer also hides it, so the weight is belt-and-braces). SECONDARY survivors
 * keep their canonical weights unchanged. PATTERNS is the odd one out: it
 * absorbs the slack up to `WIDE_FLEX_FLOOR` (see that constant's doc) so a
 * reopened secondary window in a sparse deck lands at its SHIPPED DEFAULT
 * share instead of an inflated one — flexbox still renormalizes over
 * whatever this function returns, but the returned weights now encode "the
 * shares of the default deck" rather than raw per-window constants whenever
 * the open set is sparser than the default.
 */
export function wideFlexFor(open: DeckWindowId[], id: DeckWindowId): number {
  if (!isDeckWindowId(id)) return 0;
  if (!open.includes(id)) return 0;
  if (id !== PROTECTED_WINDOW) return WIDE_FLEX[id];
  // The `!open.includes(id)` guard above already proved PATTERNS is open
  // here, so there is always an absorber — no fallback branch to invent.
  const rawOpenSum = open.reduce((sum, openId) => sum + WIDE_FLEX[openId], 0);
  const slack = Math.max(0, WIDE_FLEX_FLOOR - rawOpenSum);
  return WIDE_FLEX[id] + slack;
}

/**
 * The no-remount contract, encoded: a hidden window is `display:'none'`, NEVER
 * unmounted. Keeping it mounted is what preserves playlist scroll offsets,
 * in-progress parameter edits and the live WS reconciles while it is off
 * screen (docs/53 §3.4).
 */
export type DeckWindowDisplay = 'flex' | 'none';
export function windowDisplay(open: boolean): DeckWindowDisplay {
  return open ? 'flex' : 'none';
}

/**
 * Narrow-mode scroll ownership (the party 2026-07-11 PATTERNS-pin contract,
 * preserved verbatim): PATTERNS is PINNED at a fixed height above the scroll
 * region; every other window stacks inside the ONE `ColumnsScrollRest`
 * ScrollView below it. That is what keeps the deck free of same-axis nested
 * ScrollViews — closing/opening windows only changes which children that
 * single scroll region lays out.
 */
export type NarrowScrollOwner = 'pinned' | 'columnsScrollRest';
export function narrowScrollOwner(id: DeckWindowId): NarrowScrollOwner {
  return id === PROTECTED_WINDOW ? 'pinned' : 'columnsScrollRest';
}

/** CaptainPad native is an iPad landscape instrument. Native never enters the
 * narrow workspace—even during iOS rotation handoff. Web keeps its responsive
 * narrow layout for desktop browser tooling and small preview windows. */
export function deckWorkspaceIsWide(
  platform: string,
  width: number,
  height: number,
): boolean {
  if (platform !== 'web') return true;
  return width >= height && width >= 900;
}

// ── PERFORMANCE OVERLAY (docs/55 §2.5, D3) ─────────────────────────────────
//
// "In performance mode, hide the params and auto pilot settings from the deck
// and show them again when going back to edit mode."
//
// THE OVERLAY IS DERIVED, NEVER PERSISTED. Everything below is a pure function
// OVER a layout — none of it is an action, none of it reaches `layoutReducer`,
// and therefore none of it can touch `deck_workspace_layout_v1`. That is the
// load-bearing constraint: every reducer transition persists, so routing the
// overlay through the reducer would silently rewrite the operator's own window
// preferences every time a show started, and leaving performance mode would
// restore the WRONG layout. Entering and leaving a show must write nothing.
//
// The operator's OWN chip taps during a show still persist normally — the
// constraint is on the overlay, not on the human.

/** The two windows a show hides — and it stays TWO (report _225).
 *
 *  PATTERNS is the floor. COLORS is a live performance surface and stays
 *  exactly as the operator left it. PIXELS behaves like COLORS for the same
 *  reason, only more so: it is a pure MONITORING surface with no controls at
 *  all, so there is nothing about it for a show to protect the operator from,
 *  and a show is precisely when he most wants to see what the rig is doing.
 *  The order names "the params and auto pilot settings" — settings — and this
 *  window has none. */
export const PERF_HIDDEN_WINDOWS: readonly DeckWindowId[] = ['parameters', 'autopilot'];

/** Open windows as the SCREEN should compose them: the layout's open set,
 *  minus anything the performance overlay is hiding. */
export function effectiveOpenWindows(
  state: DeckWorkspaceLayout,
  perfActive: boolean,
): DeckWindowId[] {
  const open = openWindows(state);
  if (!perfActive) return open;
  return open.filter((id) => !PERF_HIDDEN_WINDOWS.includes(id));
}

/**
 * The restore rail as the BAR should render it. During performance mode the
 * two hidden windows are dropped from the rail as well as from the open row
 * (D3): a chip that cannot restore its window is docs/53 §3.1's "affordance
 * that always refuses", and these windows are DELIBERATELY unreachable — the
 * reach path is exiting performance mode.
 *
 * Report _308, operator order: the bar carries NO explainer caption in the
 * chips' place. The suppression is silent — the chips simply are not there.
 */
export function effectiveRailWindows(
  state: DeckWorkspaceLayout,
  perfActive: boolean,
): DeckWindowId[] {
  const rail = railWindows(state);
  if (!perfActive) return rail;
  return rail.filter((id) => !PERF_HIDDEN_WINDOWS.includes(id));
}

// ── PIXELS → OUTPUT suppression (docs/63 §2.4, operator order 1) ───────────
//
// "when the 2d pixels are enabled, hide the old classic 1D vis". Same pattern
// as the performance overlay above: a pure function OVER the layout, no
// reducer action, no storage write. A persistent flag cannot express "comes
// back when PIXELS closes" without auto-writing the operator's stored
// preference on every PIXELS toggle — precisely what the overlay contract
// exists to prevent. Closing PIXELS restores the OUTPUT chip and bar to the
// persisted truth, whatever the operator last chose for it manually.

/** The bars a shown window suppresses. Currently just PIXELS → outputBar. */
export const PIXELS_SUPPRESSES: readonly DeckBarId[] = ['outputBar'];

/** Bars as the SCREEN should compose them: the layout's shown bars, minus
 *  anything PIXELS is suppressing. `pixelsShown` must be the EFFECTIVE
 *  pixels visibility (`effectiveOpenWindows(layout, perfActive).includes(
 *  'pixels')`) so the composition has exactly one derivation order:
 *  persisted layout → perf overlay (windows) → pixels suppression (bars). */
export function effectiveShownBars(
  state: DeckWorkspaceLayout,
  pixelsShown: boolean,
): DeckBarId[] {
  const bars = shownBars(state);
  return pixelsShown ? bars.filter((b) => !PIXELS_SUPPRESSES.includes(b)) : bars;
}

// Report _308, operator order: like the perf suppression above, this one is
// SILENT — the OUTPUT chip leaves the row and nothing narrates its absence.

/**
 * Does PATTERNS fill the whole NARROW stack? True iff it is the ONLY window on
 * screen — layout closures and the performance overlay both count, because
 * both arrive here as the EFFECTIVE open set.
 *
 * Strictly conditional on purpose. In every other composition the party
 * 2026-07-11 PATTERNS-pin contract must be byte-identical: the fixed
 * flexBasis, the 400/500 floors, the 38.5 % scale and `narrowScrollOwner` are
 * all untouched whenever ANY second window is open. Only when the scroll
 * region below has nothing left to lay out does the pin become a bug — the
 * deck then shows PATTERNS over a dead region instead of filling the screen.
 */
export function patternsFillsNarrow(open: readonly DeckWindowId[]): boolean {
  return open.length === 1 && open[0] === PROTECTED_WINDOW;
}

// ── NARROW STACK ARBITRATION (report _273, operator ruling) ────────────────
//
// "Deck minimize and maximize feature is still broken — when all is hidden and
// one is turned back on, it takes over the patterns' list. That's a corner
// case not handled properly."
//
// THE MECHANISM. In the narrow stack the columns host has exactly TWO
// children: the PATTERNS track and the ONE `ColumnsScrollRest` scroll region
// that hosts every other window. Before this fix those two were sized by two
// INDEPENDENT rules that never looked at each other or at the host:
//
//   • PATTERNS took a rigid, NON-SHRINKABLE pin — `max(400|500, 38.5 % of the
//     WINDOW height)` — derived from the device window, not from the stack it
//     actually sits in.
//   • the region took `flex: 1`, i.e. "everything else", and the windows
//     inside it are content-sized (their `SectionHost` is a plain View in
//     narrow, because the single-scroll-region contract forbids a nested
//     same-axis ScrollView).
//
// Two failures fall straight out of that, BOTH measured on the web dist:
//
//   1. REOPEN FROM ALL-HIDDEN. PATTERNS drops from filling the stack to the
//      pin the instant a second window appears (834x1194: 835 -> 460 px, 12
//      visible playlist rows -> 4) while the newcomer, unbounded, claims the
//      whole remainder and then some (COLORS 1010 px in a 383 px viewport,
//      PIXELS stretched to 100 % of it). One chip tap costs the operator two
//      thirds of his pattern list — "it takes over the patterns' list".
//   2. SHORT STACKS. When the pin EXCEEDS the host (measured at 880x620: pin
//      400, host 309) the non-shrinkable PATTERNS overflows the host by 95 px
//      — spilling under the bottom PANIC bar — and the scroll region is
//      squeezed to ZERO height, so the window the operator just re-enabled
//      never appears at all. A reopened-but-invisible window is the worst
//      possible answer to a restore chip.
//
// THE FIX is the NARROW ANALOGUE OF `WIDE_FLEX_FLOOR` (report _267): the
// render layer measures the host and asks `narrowStackSizing` below — the ONE
// place the narrow split is decided.
//
// REVISED BY THE OPERATOR'S SECOND RULING (report _278). `_274` first shipped
// this arbitration with a PER-OCCUPANT share: a region hosting one window got
// HALF the default region (`restCount / 2`), and PATTERNS absorbed the slack
// (834x1194: PATTERNS 688 of a 916 stack, the newcomer 220 pt). The operator
// then reported, verbatim: "hide all panels, then reshow any of them, and it
// overlays the patterns panel. the pattern panel is not resizing maybe? from
// full screen or sth?" — a 75 % PATTERNS is visually indistinguishable from
// its full-screen fill state, and the newcomer's 220 pt strip reads as a
// fragment PASTED OVER the bottom of it, while the SAME reshow in wide mode
// (which he called fine — "only in the vertical layout") hands the window its
// full default column via `wideFlexFor`. The share arithmetic was the
// misstep: the narrow region is a SERIAL SCROLL VIEWPORT — in the default
// deck every occupant gets the whole `restDefault` viewport in turn, so its
// default size is NOT divisible per occupant. The true narrow analogue of
// `wideFlexFor` is therefore: ANY open secondary gives the region its FULL
// default-deck viewport, and PATTERNS returns to the party pin — restoring a
// window snaps the deck back to its SHIPPED proportions, exactly like wide.
//
// PIN STATUS after the two rulings (docs/53 §3 / docs/63 §5 pin 9, the party
// 2026-07-11 PATTERNS pin): with ANY secondary window open on a stack tall
// enough to seat it, the pin IS the PATTERNS height again, to the pixel
// (`_274`'s "grows past the pin when one window is open" bend is REVERSED by
// the `_278` ruling). The one remaining bend is `_274`'s short-stack yield:
// on a stack too short to seat the pin plus the hard region floor, the pin
// yields instead of overflowing the host — that fix stands untouched, as do
// the host measurement, `flexShrink: 1`, and the all-hidden fill mode.

/** The scroll region's HARD usable floor, in pt. A single 72 pt header sliver
 *  technically made a restored window non-zero, but on native iPad portrait
 *  it still looked and behaved like an overlay: COLORS/PARAMETERS could not
 *  expose enough body to establish a real second panel. 220 pt seats a header
 *  plus meaningful controls. If the whole host is shorter than two usable
 *  floors, PATTERNS' 50% share below wins and both tracks split evenly. */
export const NARROW_REST_ABS_MIN_HEIGHT = 220;

/** PATTERNS' floor as a SHARE of the stack. On a stack so short that even the
 *  hard region floor cannot be paid out of the slack, this is what stops the
 *  arbitration from crushing the protected window instead: PATTERNS is the
 *  deck's reason to exist, so it keeps at least half of whatever there is. */
export const NARROW_PATTERNS_MIN_SHARE = 0.5;

/** The party 2026-07-11 pin, unchanged and stated once: 38.5 % of the WINDOW
 *  height, floored at 400 pt (500 pt with a second playlist bound — two
 *  MIN_PANE panes need the room). */
export function narrowPatternsPin(windowHeight: number, secondaryBound: boolean): number {
  return Math.max(secondaryBound ? 500 : 400, Math.round(windowHeight * 0.385));
}

/** What the narrow render layer needs to size its two children.
 *  `mode: 'fill'` is `patternsFillsNarrow` — PATTERNS owns the whole stack and
 *  the region collapses. `mode: 'pinned'` carries the arbitrated split; the
 *  two heights ALWAYS sum to `hostHeight` when it is known. */
export type NarrowStackSizing =
  | { mode: 'fill' }
  | { mode: 'pinned'; patternsHeight: number; restHeight: number | null };

/** PATTERNS is the only direct narrow child with vertical track margins.
 * `restHeight` is the arithmetic remainder before those margins; subtracting
 * their outer footprint gives the lower scroll host the exact Yoga box that
 * remains inside the measured columns host. Kept here beside the split math
 * so the render layer and the Yoga regression cannot silently disagree. */
export const NARROW_PATTERNS_OUTER_MARGIN = 8;

/** Native-only paint containment applied by the render layer to PATTERNS in
 * the narrow stack. The outer panel keeps its web/wide shadow; on Fabric this
 * clips a descendant that is still carrying the preceding fill frame while
 * the parent has already committed its smaller pinned frame. */
export const NARROW_PATTERNS_NATIVE_CLIP_STYLE = { overflow: 'hidden' } as const;

/** Native Fabric must arbitrate the lower track on a plain View, not directly
 * on UIScrollView. ScrollView carries its own native flex defaults and, when
 * restored from a zero-height all-hidden frame, those defaults can win the
 * sibling shrink pass: PATTERNS collapses to its hue-row minimum while the
 * scroll viewport takes the rest of the host. The outer View owns the measured
 * basis and clips native paint; the ScrollView flexes only inside that box. */
/** Flex longhands used by the two direct children of the narrow columns host.
 * Deliberately excludes the `flex` shorthand: Yoga gives a positive shorthand
 * special flex-basis precedence that differs from CSS, so a measured basis
 * must never be co-flattened with `flex: 1` on native. */
export type NarrowStackTrackStyle = Readonly<{
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;
  minHeight: 0;
}>;

export type NarrowStackTrackStyles = Readonly<{
  patterns: NarrowStackTrackStyle;
  rest: NarrowStackTrackStyle;
}>;


/** Translate the pure split into the complete flex-family styles of its two
 * direct Yoga children. The unmeasured branch preserves today's flexible
 * first frame; once measured, BOTH boxes carry definite bases whose outer
 * extents sum exactly to the host. */
export function narrowStackTrackStyles(sizing: NarrowStackSizing): NarrowStackTrackStyles {
  if (sizing.mode === 'fill') {
    return {
      patterns: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
      rest: { flexGrow: 0, flexShrink: 0, flexBasis: 0, minHeight: 0 },
    };
  }

  const patterns = {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: sizing.patternsHeight,
    minHeight: 0,
  } as const;
  if (sizing.restHeight === null) {
    return {
      patterns,
      rest: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 },
    };
  }
  return {
    patterns,
    rest: {
      flexGrow: 0,
      flexShrink: 1,
      flexBasis: Math.max(0, sizing.restHeight - NARROW_PATTERNS_OUTER_MARGIN),
      minHeight: 0,
    },
  };
}

/**
 * Fabric/iOS pinned-track authority. A real-device probe measured a healthy
 * 848pt host but intrinsic children P=30/R=0: both numeric flex bases had been
 * discarded, leaving 818pt of the parent unused. Once the host is measured we
 * therefore give native two explicit, non-shrinkable heights. They use the
 * exact same arithmetic as the portable flex styles; this is not a second
 * split rule. Fill and the first unmeasured frame remain flex-driven.
 */

/**
 * The ONE narrow-stack split rule.
 *
 * `hostHeight` is the MEASURED height of the columns host, or `null` on the
 * first frame before `onLayout` has reported (and in any environment that
 * cannot measure). `null` returns the bare pin — i.e. EXACTLY the pre-fix
 * behaviour — so the unmeasured frame is today's screen, never a guess.
 *
 * With a measured host:
 *   patterns    = pin                    the party pin, the operator's contract
 *   patterns    = min(patterns, host − NARROW_REST_ABS_MIN_HEIGHT)   ← the ONE
 *   patterns    = max(patterns, host × NARROW_PATTERNS_MIN_SHARE)      cut-in
 *   rest        = host − patterns
 *
 * i.e. with ANY secondary open, the region gets the FULL viewport the shipped
 * default deck gives it (`host − pin`) — the narrow region is a serial scroll
 * viewport, so its default size is not divisible per occupant (`_278`
 * operator ruling; see the block comment above for the full derivation).
 * Restoring one window from all-hidden snaps the deck back to its shipped
 * proportions, exactly as `wideFlexFor` does in the wide row.
 *
 * The one clamp allowed to cut into the pin is `NARROW_REST_ABS_MIN_HEIGHT`,
 * and it only bites on a stack too short to seat the pin — which is exactly
 * the state that used to overflow the host and starve the region to zero
 * (`_274` failure 2, fix unchanged).
 */
export function narrowStackSizing(input: {
  /** EFFECTIVE open windows, i.e. after the performance overlay. */
  openCount: number;
  /** Device window height — the pin's own scale, unchanged. */
  windowHeight: number;
  /** Measured columns-host height, or null before the first layout pass. */
  hostHeight: number | null;
  /** Is a second playlist bound? (raises the pin's floor 400 -> 500). */
  secondaryBound: boolean;
}): NarrowStackSizing {
  const { openCount, windowHeight, hostHeight, secondaryBound } = input;
  // openCount counts PATTERNS itself, which is protected and always open.
  const restCount = Math.max(0, openCount - 1);
  if (restCount === 0) return { mode: 'fill' };

  const pin = narrowPatternsPin(windowHeight, secondaryBound);
  if (hostHeight === null || !Number.isFinite(hostHeight) || hostHeight <= 0) {
    return { mode: 'pinned', patternsHeight: pin, restHeight: null };
  }

  // The region gets its full default-deck viewport (`host − pin`) whatever
  // its occupant count — so PATTERNS sits at the pin, exactly as it does in
  // the shipped default deck (`_278` operator ruling).
  let patterns = Math.min(pin, hostHeight);
  // The restored window ALWAYS gets a visible, scrollable box (failure 2).
  patterns = Math.min(patterns, hostHeight - NARROW_REST_ABS_MIN_HEIGHT);
  // ...but never at the cost of crushing the protected window below its share.
  patterns = Math.max(patterns, Math.round(hostHeight * NARROW_PATTERNS_MIN_SHARE));
  patterns = Math.min(Math.max(patterns, 0), hostHeight);
  return { mode: 'pinned', patternsHeight: patterns, restHeight: hostHeight - patterns };
}
