/**
 * mixer_workspace_layout — the PURE layout brain of the Mixer channel
 * workspace (contract: docs/64_mixer_relayout.md §2, design report `_258`).
 *
 * ZERO react / react-native imports on purpose: the vitest config only admits
 * pure `.ts` under `components/**` (RN components are `.tsx` and stay
 * excluded), so every layout rule below is unit-testable in plain Node. The
 * render layer (mixer.tsx / mixer_workspace_bar.tsx) may only ASK this module
 * questions — it never re-derives a layout fact of its own.
 *
 * This module is the mixer's twin of `deck/deck_workspace_layout.ts`, with
 * one structural difference the deck never had to face: deck windows are a
 * closed, compile-time enum (`DeckWindowId`); mixer channels are RUNTIME ids
 * — created, renamed and deleted live by the operator or a second pad. The
 * id space is therefore namespaced STRINGS, not an enum, and the `known` set
 * that used to live only in the persisted wire shape (`StoredDeckWorkspaceLayout`)
 * has to travel with the RUNTIME layout too (§2.2) — it is how this module
 * tells a channel/section that predates this build from one that was created
 * five seconds ago by an operator on another iPad.
 *
 * Model (docs/64 §2, ported from the deck's docs/53 §1 / docs/63 §2):
 *   1. Three namespaces, one flat closed-set over all of them:
 *        ch/<channelId>              a channel card (window)
 *        sec/<channelId>/params      that channel's LOCAL PARAMS section
 *        sec/<channelId>/pixels      that channel's 2D pixel band section
 *        citizen/masterBand          the master 2D band (static citizen)
 *        citizen/colors              the COLORS window (static citizen)
 *   2. A closed channel leaves the strip row entirely — survivors reflow —
 *      exactly like a closed deck window. Sections behave the same way
 *      inside their channel card (§3.1: a hidden section leaves a stub, that
 *      stub is render-layer chrome, not this module's concern).
 *   3. FLOOR (D1): the reducer refuses to close the LAST VISIBLE CHANNEL
 *      given the roster it is handed; the normalizer backstops the same
 *      floor against a hand-edited or stale store. There is no "protected
 *      id" the way PATTERNS is protected on the deck — ANY channel may
 *      close, just never the last one standing.
 *   4. Both `closed` AND `known` are persisted, under a versioned key
 *      (`MIXER_WORKSPACE_LAYOUT_KEY`). `known` is recomputed fresh from the
 *      roster on every hydrate and every confirmed-roster commit — it is
 *      never itself hand-edited or trusted verbatim from storage beyond
 *      deciding what a STALE store had an opinion about.
 */

import { WORKSPACE_KNOWN_SET_RULE } from '@/components/workspace_known_set_policy';

/** Re-exported so a reader who lands in THIS file's `shippedDefaultClosed`
 *  (below) does not have to go find the shared statement — see
 *  `components/workspace_known_set_policy.ts` for why the rule lives there
 *  and not restated per module (docs/64 §10 convergence duty: this module's
 *  new-id policy and the deck's must "read as one rule"). The deck's
 *  `deck_workspace_layout.ts` re-exports the identical symbol. */
export { WORKSPACE_KNOWN_SET_RULE };

// ── Ids ──────────────────────────────────────────────────────────────────

/** A runtime engine channel id. Opaque as far as this module is concerned. */
export type MixerChannelId = string;

/** The two per-channel hideable regions (docs/64 §3.1). */
export type MixerSectionKind = 'params' | 'pixels';

/** The two static, deck-style citizens (docs/64 §2.1). Unlike channels these
 *  are NOT runtime-created — they always exist — but they still live in the
 *  same flat closed-set as everything else, one reducer, one tier. */
export type MixerCitizenKey = 'masterBand' | 'colors';

/** Any namespaced id this store can name. Structurally a `string` — the
 *  point of the type alias is documentation at call sites, not branding. */
export type MixerSurfaceId = string;

/** citizen/masterBand — never per-channel (docs/64 §4). */
export const MASTER_BAND_ID: MixerSurfaceId = 'citizen/masterBand';
/** citizen/colors — the rig-global COLORS window (docs/64 §4). */
export const COLORS_ID: MixerSurfaceId = 'citizen/colors';

/** The citizens that default CLOSED. `colors` is the `_225` rule verbatim
 *  (new chrome defaults closed). `masterBand` joined it in docs/67 §2 on an
 *  OPERATOR RULING ("Master 2D pixels is too large — just disable it by
 *  default"): the master band is a large show surface the operator opens on
 *  demand, not a permanent tenant of the top row.
 *
 *  WHO THIS FLIP REACHES — fresh stores ONLY, provably (docs/67 §2.2). Every
 *  mixer store ever written serialized `known = roster ∪ citizens ∪ sections`
 *  (there is no legacy pre-`known` mixer store — docs/64 §2.3 pinned that),
 *  so `citizen/masterBand` is in the `known` of every existing store and
 *  `normalizeLayout`'s `wasKnown` gate exempts all of them automatically. A
 *  one-time migration was REJECTED deliberately: the store records
 *  MEMBERSHIP, not INTENT — "open and known" cannot distinguish "the operator
 *  deliberately reopened the band" from "the operator never touched it", so
 *  force-closing known-open bands could fight an explicit choice, which is
 *  exactly what the `_225` invariant exists to prevent.
 *
 *  Order matters: this array's order is the order `normalizeLayout`/`reset`
 *  would append in only if it matched `knownSetFor`'s citizen order — it does
 *  not, and it does not need to: both consumers iterate `known`/`currentIds`
 *  (MASTER_BAND_ID then COLORS_ID) and merely ASK this list for membership. */
export const SHIPPED_DEFAULT_CLOSED_CITIZENS: readonly MixerCitizenKey[] = ['colors', 'masterBand'];

function assertValidChannelId(channelId: unknown): asserts channelId is MixerChannelId {
  if (typeof channelId !== 'string' || channelId.length === 0) {
    throw new Error(`[mixer_workspace_layout] invalid channel id: ${JSON.stringify(channelId)}`);
  }
  if (channelId.includes('/')) {
    // A '/' inside a channel id would corrupt the `sec/<channelId>/<kind>`
    // grammar and make round-tripping ambiguous. Constructors fail loudly
    // rather than silently building an id the parser could misread later
    // (codex P0 — no fallback behaviors). Untrusted, already-serialized
    // strings go through `parseMixerSurfaceId` instead, which is TOTAL and
    // never throws — see that function's doc for why the two paths differ.
    throw new Error(`[mixer_workspace_layout] channel id must not contain '/': ${JSON.stringify(channelId)}`);
  }
}

/** Builds `ch/<channelId>`. Throws on a malformed channel id (see
 *  `assertValidChannelId`) — this is the CONSTRUCTOR path, used with ids the
 *  caller is asserting are real, not with untrusted storage input. */
export function channelSurfaceId(channelId: MixerChannelId): MixerSurfaceId {
  assertValidChannelId(channelId);
  return `ch/${channelId}`;
}

/** Builds `sec/<channelId>/<section>`. Throws on a malformed channel id or an
 *  unrecognized section kind — same constructor-path discipline as
 *  `channelSurfaceId`. */
export function sectionSurfaceId(channelId: MixerChannelId, section: MixerSectionKind): MixerSurfaceId {
  assertValidChannelId(channelId);
  if (section !== 'params' && section !== 'pixels') {
    throw new Error(`[mixer_workspace_layout] invalid section kind: ${JSON.stringify(section)}`);
  }
  return `sec/${channelId}/${section}`;
}

/** Builds `citizen/<key>`. */
export function citizenSurfaceId(citizen: MixerCitizenKey): MixerSurfaceId {
  return `citizen/${citizen}`;
}

/** The discriminated union `parseMixerSurfaceId` returns. `invalid` carries
 *  the raw value back so a caller that wants to log/report a corrupt id can,
 *  without the parser itself doing any logging (it is a pure function). */
export type ParsedMixerSurfaceId =
  | { kind: 'channel'; channelId: MixerChannelId }
  | { kind: 'section'; channelId: MixerChannelId; section: MixerSectionKind }
  | { kind: 'citizen'; citizen: MixerCitizenKey }
  | { kind: 'invalid'; raw: unknown };

function isValidChannelIdShape(channelId: string): boolean {
  return channelId.length > 0 && !channelId.includes('/');
}

/**
 * TOTAL parser over untrusted input (a stored `closed`/`known` entry, a
 * stray action id). Never throws — a malformed id is reported as the
 * `invalid` branch of the discriminated union, NOT silently dropped here:
 * dropping is a decision, and exactly ONE place in this module makes it
 * (`normalizeLayout`, for storage hydrate; the reducer's own unknown-id
 * no-ops for actions). Every other caller gets the honest classification and
 * decides for itself.
 *
 * This is the deliberate split from the constructor functions above, which
 * THROW on a malformed channel id: constructors build ids the CALLER is
 * asserting are real (a coding bug if wrong — fail loudly, codex P0); this
 * parser classifies ids that arrived over an untrusted boundary (AsyncStorage,
 * a JSON blob), where "malformed" is an expected, not exceptional, outcome.
 */
export function parseMixerSurfaceId(value: unknown): ParsedMixerSurfaceId {
  if (typeof value !== 'string') return { kind: 'invalid', raw: value };
  if (value === MASTER_BAND_ID) return { kind: 'citizen', citizen: 'masterBand' };
  if (value === COLORS_ID) return { kind: 'citizen', citizen: 'colors' };
  if (value.startsWith('ch/')) {
    const channelId = value.slice(3);
    if (!isValidChannelIdShape(channelId)) return { kind: 'invalid', raw: value };
    return { kind: 'channel', channelId };
  }
  if (value.startsWith('sec/')) {
    for (const section of ['params', 'pixels'] as const) {
      const suffix = `/${section}`;
      if (value.endsWith(suffix)) {
        const channelId = value.slice(4, value.length - suffix.length);
        if (!isValidChannelIdShape(channelId)) return { kind: 'invalid', raw: value };
        return { kind: 'section', channelId, section };
      }
    }
    return { kind: 'invalid', raw: value };
  }
  return { kind: 'invalid', raw: value };
}

/** Runtime type guard — is this a syntactically valid mixer surface id? */
export function isMixerSurfaceId(value: unknown): value is MixerSurfaceId {
  return parseMixerSurfaceId(value).kind !== 'invalid';
}

// ── Store ────────────────────────────────────────────────────────────────

/** AsyncStorage key — version lives IN the key (same convention as the deck's
 *  `deck_workspace_layout_v1`). */
export const MIXER_WORKSPACE_LAYOUT_KEY = 'mixer_workspace_layout_v1';

/**
 * The whole runtime/persisted layout state (docs/64 §2.2). Unlike
 * `DeckWorkspaceLayout` (which only carries `closed` at runtime — `known`
 * only exists in the wire shape, because `DECK_SURFACE_IDS` is a compile-time
 * constant), the mixer must carry `known` at RUNTIME too: the set of ids
 * "this build could see" changes live as channels are created/deleted, so
 * there is no fixed constant to fall back on between commits. `known` is
 * always `roster ∪ citizens ∪ section keys for the roster` as of the last
 * hydrate or confirmed-roster commit (`knownSetFor` below) — see
 * `commitRoster`.
 */
export type MixerWorkspaceLayout = { closed: MixerSurfaceId[]; known: MixerSurfaceId[] };

function sameArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Every id this build could see for a given roster: each channel's window +
 *  its two sections, plus the two static citizens. Throws if `roster`
 *  contains a malformed channel id (constructor-path discipline — a bad
 *  engine roster is a coding bug upstream, not an input to tolerate here). */
function knownSetFor(roster: readonly MixerChannelId[]): MixerSurfaceId[] {
  const out: MixerSurfaceId[] = [];
  for (const chId of roster) {
    out.push(channelSurfaceId(chId));
    out.push(sectionSurfaceId(chId, 'params'));
    out.push(sectionSurfaceId(chId, 'pixels'));
  }
  out.push(MASTER_BAND_ID, COLORS_ID);
  return out;
}

/** Does this id default CLOSED when a store never had an opinion about it?
 *  The single generalized rule is `WORKSPACE_KNOWN_SET_RULE` (imported
 *  above, canonical text in `components/workspace_known_set_policy.ts`) —
 *  the SAME constant the deck's `deck_workspace_layout.ts` re-exports for
 *  its own compile-time-enum version of this rule (docs/64 §10 convergence
 *  duty: the two new-id policy tables must read as one rule). Applied here
 *  over the mixer's namespaced runtime ids:
 *    - a CHANNEL outside `known` → VISIBLE (content, not chrome: an
 *      operator-created channel is already painting the rig; a store written
 *      before it existed must show it).
 *    - a SECTION outside `known` → VISIBLE (shipped default = today's
 *      screen — LOCAL PARAMS and the pixel band are both on by default).
 *    - citizen/masterBand outside `known` → CLOSED (docs/67 §2, operator
 *      ruling: the master band is a large show surface opened on demand. No
 *      store is actually silent about it — every one records it in `known` —
 *      which is what makes the flip provably fresh-store-only).
 *    - citizen/colors outside `known` → CLOSED (new chrome defaults closed,
 *      the `_225` rule verbatim — COLORS is a brand-new mixer surface).
 *  Channels and sections still reproduce the screen their store's author was
 *  looking at: neither had a "hide by default" affordance before docs/64, so
 *  their absence must mean "still showing". Both citizens are chrome the
 *  operator summons: COLORS because it is wholly new, MASTER VIEW because the
 *  operator ruled the band too large to ship open. */
function shippedDefaultClosed(id: MixerSurfaceId): boolean {
  return SHIPPED_DEFAULT_CLOSED_CITIZENS.some((citizen) => citizenSurfaceId(citizen) === id);
}

/** The shipped-default layout for a fresh roster — no stored data at all.
 *  Equivalent to `normalizeLayout(undefined, roster)`, exposed directly for
 *  callers that need to seed state before the first AsyncStorage hydrate
 *  resolves. */
export function initialLayout(roster: readonly MixerChannelId[]): MixerWorkspaceLayout {
  return normalizeLayout(undefined, roster);
}

// ── Reducer ──────────────────────────────────────────────────────────────

/**
 * The ONE way layout state changes. Exactly three actions. `close` on a
 * `ch/<id>` needs the ROSTER to enforce the floor (D1: refuse to close the
 * last visible channel) — there is no compile-time enumeration of channels
 * to check against, so the caller hands the reducer the roster it is acting
 * on at dispatch time, in canonical order. `open` and `reset` need no
 * roster: opening never violates the floor, and `reset` re-derives shipped
 * defaults from the layout's OWN `known` set (see `layoutReducer` reset
 * case), not from a live roster.
 */
export type MixerLayoutAction =
  | { type: 'close'; id: MixerSurfaceId; roster: readonly MixerChannelId[] }
  | { type: 'open'; id: MixerSurfaceId }
  | { type: 'reset' };

/**
 * Pure reducer. Returns the SAME reference for a no-op so a React state
 * update can bail cheaply (and so "did anything change?" is a `!==` check at
 * the persistence boundary).
 *
 * An unknown `action.type` THROWS — that can only be a coding bug, and this
 * repo fails loudly (codex P0: no silent fallbacks). An unknown/malformed
 * `action.id`, by contrast, is a no-op (never throws): the reducer is the
 * backstop behind a UI that already only ever dispatches ids it built with
 * the constructors above, exactly like the deck's unknown-surface-id no-op.
 */
export function layoutReducer(
  state: MixerWorkspaceLayout,
  action: MixerLayoutAction,
): MixerWorkspaceLayout {
  switch (action.type) {
    case 'close': {
      const parsed = parseMixerSurfaceId(action.id);
      if (parsed.kind === 'invalid') return state;
      if (state.closed.includes(action.id)) return state;
      if (parsed.kind === 'channel') {
        // FLOOR (D1): refuse to close the last visible channel GIVEN THE
        // ROSTER THIS ACTION WAS DISPATCHED WITH. `visibleChannels` already
        // filters to the roster, so a channel outside the roster (stale
        // click racing a delete broadcast) never trips this — it simply
        // cannot appear in `visible`.
        const visible = visibleChannels(action.roster, state);
        if (visible.length === 1 && visible[0] === parsed.channelId) return state;
      }
      return { closed: [...state.closed, action.id], known: state.known };
    }
    case 'open': {
      if (!isMixerSurfaceId(action.id)) return state;
      if (!state.closed.includes(action.id)) return state;
      return { closed: state.closed.filter((id) => id !== action.id), known: state.known };
    }
    case 'reset': {
      // Re-derive shipped-default membership from this layout's OWN known
      // set — no roster needed, no live channel state consulted. A channel
      // NEVER appears in the reset-closed set (`shippedDefaultClosed` is
      // citizen-only by construction — it only ever answers true for
      // `citizen/colors` and `citizen/masterBand`), so reset can never trip
      // the floor. docs/67 §2.1: RESET therefore now returns to a CLOSED
      // master band, which is the whole point of the flip's second consumer.
      const resetClosed = state.known.filter(shippedDefaultClosed);
      if (sameArray(state.closed, resetClosed)) return state;
      return { closed: resetClosed, known: state.known };
    }
    default:
      throw new Error(
        `[mixer_workspace_layout] unknown layout action: ${JSON.stringify(action)}`,
      );
  }
}

// ── Roster confirmation + pruning (docs/64 §2.3) ────────────────────────
//
// A `ch/`/`sec/` entry whose channel id is missing from the roster is
// RETAINED in storage and NEVER RENDERED while the roster could be stale
// (boot, reconnect) — the selectors below already achieve "never rendered"
// for free, because they intersect the roster they are handed with the
// stored layout. Pruning the STORAGE is a separate, deliberate commit: it
// only happens when the caller has a CONFIRMED roster (connected, mixer doc
// received) and says so explicitly. This is NOT a fourth reducer action —
// the three actions above are the complete set (codex P0 discipline: no
// hidden side channels into the store) — it is a distinct pure function the
// caller invokes exactly once per confirmed broadcast. No timers, no
// background writes: nothing prunes itself.

/**
 * Commits a roster snapshot: recomputes `known` for the given channel ids,
 * and — ONLY when `confirmed` is true — prunes `ch/`/`sec/` entries out of
 * `closed` for channels no longer in the roster (citizens are static and are
 * never pruned). An unconfirmed roster is a same-reference no-op: it changes
 * nothing about the stored layout, because a boot/reconnect snapshot may be
 * stale and pruning against it could permanently discard a hidden state for
 * a channel that is about to reappear in the very next broadcast.
 *
 * Pruning can only ever REMOVE entries from `closed`, never add them, so it
 * can never trip the floor (D1) — it can only make more channels visible.
 */
export function commitRoster(
  state: MixerWorkspaceLayout,
  roster: readonly MixerChannelId[],
  confirmed: boolean,
): MixerWorkspaceLayout {
  if (!confirmed) return state;
  const nextKnown = knownSetFor(roster);
  const rosterSet = new Set(roster);
  const prunedClosed = state.closed.filter((id) => {
    const parsed = parseMixerSurfaceId(id);
    if (parsed.kind === 'channel' || parsed.kind === 'section') return rosterSet.has(parsed.channelId);
    return parsed.kind !== 'invalid';
  });
  if (sameArray(prunedClosed, state.closed) && sameArray(nextKnown, state.known)) return state;
  return { closed: prunedClosed, known: nextKnown };
}

// ── Serialization + normalization (the `_225` discipline, extended) ───────

/**
 * What actually goes into AsyncStorage. Recomputes `known` FRESH from the
 * live roster on every write (rather than trusting `state.known` to be
 * current) — this is deliberately redundant with `commitRoster` keeping
 * `state.known` in sync, because a write that races a roster change must
 * still record the truth at write time, not a stale cache. `closed` is
 * copied defensively so a later caller mutation can never poison the value
 * already handed to the storage layer.
 */
export function serializeLayout(
  state: MixerWorkspaceLayout,
  roster: readonly MixerChannelId[],
): MixerWorkspaceLayout {
  return { closed: [...state.closed], known: knownSetFor(roster) };
}

/**
 * TOTAL normalizer for untrusted input (the AsyncStorage hydrate). Never
 * throws. Deterministic. Needs the CURRENT roster (unlike the deck's
 * `normalizeLayout`, which closes over a compile-time id set) because
 * "what ids exist right now" is itself runtime information here.
 *
 *   - `closed` entries that parse as a valid surface id are honored
 *     VERBATIM, whatever the roster says — this is what "retained in
 *     storage, never rendered" (§2.3 pruning) requires: a stale channel's
 *     hidden state must survive a hydrate that happens before the roster is
 *     confirmed. Syntactically invalid entries are dropped (nothing else can
 *     be done with them) and duplicates are deduped, order preserved.
 *   - Every CURRENT id (`roster ∪ citizens ∪ sections-for-roster`) that the
 *     stored `closed` array is silent about falls back to its SHIPPED
 *     DEFAULT membership (`shippedDefaultClosed` — the one generalized rule
 *     documented on that function) UNLESS the stored `known` array proves
 *     the store's author already had an opinion about it. An absent/invalid
 *     `known` field means the author had NO opinions at all (this is a
 *     brand-new store shape — there is no legacy mixer store predating
 *     `known`, unlike the deck's `LEGACY_KNOWN_WINDOWS` case), so every
 *     current id is treated as unknown to that store.
 *   - FLOOR backstop: if every roster channel ends up closed, the FIRST
 *     channel in canonical (roster) order is force-reopened — the same
 *     backstop the reducer's `close` enforces going forward, applied once at
 *     hydrate time against a store that could only have reached that state
 *     by hand-editing (the reducer itself can never produce it).
 *   - `known` in the RETURNED layout is always `knownSetFor(roster)` — the
 *     truth as of THIS hydrate, ready for `commitRoster`/`serializeLayout`
 *     to keep in sync from here on.
 */
export function normalizeLayout(input: unknown, roster: readonly MixerChannelId[]): MixerWorkspaceLayout {
  const currentIds = knownSetFor(roster);

  const isRecord = input !== null && typeof input === 'object' && !Array.isArray(input);

  const storedClosed: MixerSurfaceId[] = [];
  if (isRecord) {
    const rawClosed = (input as { closed?: unknown }).closed;
    if (Array.isArray(rawClosed)) {
      const seen = new Set<string>();
      for (const entry of rawClosed) {
        if (typeof entry !== 'string') continue;
        if (parseMixerSurfaceId(entry).kind === 'invalid') continue;
        if (seen.has(entry)) continue;
        seen.add(entry);
        storedClosed.push(entry);
      }
    }
  }

  let knownProvided: Set<string> | null = null;
  if (isRecord) {
    const rawKnown = (input as { known?: unknown }).known;
    if (Array.isArray(rawKnown)) {
      knownProvided = new Set(
        rawKnown.filter((e): e is string => typeof e === 'string' && parseMixerSurfaceId(e).kind !== 'invalid'),
      );
    }
  }

  const closed = [...storedClosed];
  const closedSet = new Set(closed);
  for (const id of currentIds) {
    if (closedSet.has(id)) continue;
    const wasKnown = knownProvided !== null && knownProvided.has(id);
    if (!wasKnown && shippedDefaultClosed(id)) {
      closed.push(id);
      closedSet.add(id);
    }
  }

  if (roster.length > 0) {
    const rosterSet = new Set(roster);
    let closedRosterChannelCount = 0;
    for (const id of closed) {
      const parsed = parseMixerSurfaceId(id);
      if (parsed.kind === 'channel' && rosterSet.has(parsed.channelId)) closedRosterChannelCount += 1;
    }
    if (closedRosterChannelCount >= roster.length) {
      const restoreId = channelSurfaceId(roster[0]);
      const idx = closed.indexOf(restoreId);
      if (idx !== -1) closed.splice(idx, 1);
    }
  }

  return { closed, known: currentIds };
}

// ── Selectors — TOTAL over namespaces (docs/64 §2.2) ───────────────────────
// Render code never re-derives a layout fact: it asks these.

/** Visible channel ids, in CANONICAL (engine/roster) order — never the order
 *  they were reopened in (the reopen-proportionality addendum: a reopened
 *  channel returns to its engine-order slot, never appended at the end). */
export function visibleChannels(
  roster: readonly MixerChannelId[],
  layout: MixerWorkspaceLayout,
): MixerChannelId[] {
  return roster.filter((chId) => !layout.closed.includes(channelSurfaceId(chId)));
}

/** Hidden channel chips, in CLOSE order (the restore-rail order) — narrowed
 *  to channels still present in the roster, so a pruned-but-not-yet-committed
 *  entry never leaks a chip for a channel that no longer exists. */
export function hiddenChannelChips(
  roster: readonly MixerChannelId[],
  layout: MixerWorkspaceLayout,
): MixerChannelId[] {
  const rosterSet = new Set(roster);
  const out: MixerChannelId[] = [];
  for (const id of layout.closed) {
    const parsed = parseMixerSurfaceId(id);
    if (parsed.kind === 'channel' && rosterSet.has(parsed.channelId)) out.push(parsed.channelId);
  }
  return out;
}

/** Is this channel's given section currently shown? */
export function isSectionShown(
  layout: MixerWorkspaceLayout,
  channelId: MixerChannelId,
  section: MixerSectionKind,
): boolean {
  return !layout.closed.includes(sectionSurfaceId(channelId, section));
}

/** Is this citizen currently shown? */
export function isCitizenShown(layout: MixerWorkspaceLayout, citizen: MixerCitizenKey): boolean {
  return !layout.closed.includes(citizenSurfaceId(citizen));
}

// ── PERFORMANCE OVERLAY (docs/64 §2.6) ──────────────────────────────────────
//
// Raw `usePerformanceMode().active`, ZERO writes, byte-identical round trip
// — the same `_217`/docs/58 §2.3 contract the deck's overlay obeys, now
// asserted over the mixer's PERSISTED workspace store too. Perf composes
// AFTER the persisted layout: hidden stays hidden, and perf can only ever
// NARROW what is shown, never widen it — it additionally suppresses the
// params sections of VISIBLE channels, never resurrects anything the
// operator closed, and never reopens a closed citizen (the master band's
// forced-open-in-perf rule, owned by the render layer, therefore only ever
// applies when `citizen/masterBand` is already shown here).

/** The one section kind a show suppresses on every still-visible channel. */
export const PERF_SUPPRESSED_SECTION: MixerSectionKind = 'params';

/** Is this section shown as the SCREEN should compose it: the persisted
 *  truth, minus perf's params suppression on visible channels. A section the
 *  operator already hid stays hidden regardless of `perfActive` — this
 *  function can only narrow what `isSectionShown` already says, never widen
 *  it. */
export function effectiveSectionShown(
  layout: MixerWorkspaceLayout,
  channelId: MixerChannelId,
  section: MixerSectionKind,
  perfActive: boolean,
): boolean {
  if (!isSectionShown(layout, channelId, section)) return false;
  if (perfActive && section === PERF_SUPPRESSED_SECTION) return false;
  return true;
}

/** Is this citizen shown as the SCREEN should compose it. Perf mode never
 *  reopens a citizen the operator closed — this is a pure post-filter over
 *  the persisted state and is therefore, by construction, IDENTICAL to
 *  `isCitizenShown` for every input: there is nothing about perf mode that
 *  could ever widen citizen visibility. Kept as its own named export (rather
 *  than inlining `isCitizenShown` at call sites) so the render layer's perf
 *  composition reads as one order — layout → perf(sections) → perf(citizens)
 *  — and so this guarantee has its own pinned test. */
export function effectiveCitizenShown(
  layout: MixerWorkspaceLayout,
  citizen: MixerCitizenKey,
  perfActive: boolean,
): boolean {
  void perfActive; // never resurrects a closed citizen — see doc comment above.
  return isCitizenShown(layout, citizen);
}
