import { describe, expect, it } from 'vitest';

import {
  deckWorkspaceIsWide,
  DECK_BAR_IDS,
  DECK_BAR_TITLES,
  DECK_SURFACE_IDS,
  DECK_WINDOW_IDS,
  DECK_WINDOW_TITLES,
  DECK_WORKSPACE_LAYOUT_KEY,
  DEFAULT_LAYOUT,
  LEGACY_KNOWN_WINDOWS,
  NARROW_PATTERNS_MIN_SHARE,
  NARROW_REST_ABS_MIN_HEIGHT,
  PERF_BAR_CAPTION,
  PERF_HIDDEN_WINDOWS,
  PIXELS_BAR_CAPTION,
  PIXELS_SUPPRESSES,
  PROTECTED_WINDOW,
  WIDE_FLEX_FLOOR,
  canClose,
  effectiveOpenWindows,
  effectiveRailWindows,
  effectiveShownBars,
  isDeckSurfaceId,
  isDeckWindowId,
  isOpen,
  isShown,
  layoutReducer,
  narrowPatternsPin,
  narrowScrollOwner,
  narrowStackSizing,
  normalizeLayout,
  openWindows,
  patternsFillsNarrow,
  railSurfaces,
  railWindows,
  serializeLayout,
  shownBars,
  wideFlexFor,
  windowDisplay,
  type DeckBarId,
  type DeckSurfaceId,
  type DeckWindowId,
  type DeckWorkspaceLayout,
} from './deck_workspace_layout';

const close = (s: DeckWorkspaceLayout, id: DeckSurfaceId) => layoutReducer(s, { type: 'close', id });
const open = (s: DeckWorkspaceLayout, id: DeckSurfaceId) => layoutReducer(s, { type: 'open', id });

describe('CaptainPad native landscape-only workspace', () => {
  it('never enters the narrow Deck layout on a native device', () => {
    expect(deckWorkspaceIsWide('ios', 834, 1194)).toBe(true);
    expect(deckWorkspaceIsWide('ios', 1194, 834)).toBe(true);
    expect(deckWorkspaceIsWide('android', 600, 1024)).toBe(true);
  });

  it('keeps browser tooling responsive', () => {
    expect(deckWorkspaceIsWide('web', 834, 1194)).toBe(false);
    expect(deckWorkspaceIsWide('web', 1194, 834)).toBe(true);
    expect(deckWorkspaceIsWide('web', 880, 620)).toBe(false);
  });
});

/** Every subset of the closed set that the UI can actually produce (PATTERNS
 *  never closes → 2^4 = 16 reachable layouts once PIXELS joins). */
function allReachableLayouts(): DeckWorkspaceLayout[] {
  const closable: DeckWindowId[] = ['parameters', 'autopilot', 'colors', 'pixels'];
  const out: DeckWorkspaceLayout[] = [];
  for (let mask = 0; mask < 1 << closable.length; mask += 1) {
    out.push({ closed: closable.filter((_, i) => (mask & (1 << i)) !== 0) });
  }
  return out;
}

/** Every subset of the closed set across BOTH tiers (docs/63 §2.2): the six
 *  non-protected surfaces — 4 windows + 2 bars — give 2^6 = 64 reachable
 *  layouts once the bars join the workspace. */
function allReachableSurfaceLayouts(): DeckWorkspaceLayout[] {
  const closable: DeckSurfaceId[] = ['parameters', 'autopilot', 'colors', 'pixels', 'audioBar', 'outputBar'];
  const out: DeckWorkspaceLayout[] = [];
  for (let mask = 0; mask < 1 << closable.length; mask += 1) {
    out.push({ closed: closable.filter((_, i) => (mask & (1 << i)) !== 0) });
  }
  return out;
}

describe('Deck workspace — default layout', () => {
  it('boots with PATTERNS / PARAMETERS / AUTOPILOT open, COLORS + PIXELS on the rail', () => {
    expect(DEFAULT_LAYOUT).toEqual({ closed: ['colors', 'pixels'] });
    expect(openWindows(DEFAULT_LAYOUT)).toEqual(['patterns', 'parameters', 'autopilot']);
    expect(railWindows(DEFAULT_LAYOUT)).toEqual(['colors', 'pixels']);
  });

  it('gives the 4/3/3/3/4 weights when every window is open', () => {
    const allOpen: DeckWorkspaceLayout = { closed: [] };
    const openIds = openWindows(allOpen);
    expect(openIds).toEqual(['patterns', 'parameters', 'autopilot', 'colors', 'pixels']);
    expect(openIds.map((id) => wideFlexFor(openIds, id))).toEqual([4, 3, 3, 3, 4]);
  });
});

// ── The UPGRADE (report _225) ──────────────────────────────────────────────
// Adding a window to a closed-set store is the one way this module could
// silently rearrange a deck the operator already set up. These tests are the
// guarantee that it does not.

describe('Deck workspace — adding a window never disturbs a stored layout', () => {
  it('treats a pre-_225 store (no `known`) as not knowing about PIXELS', () => {
    for (const stored of [{ closed: ['colors'] }, { closed: [] }, { closed: ['parameters', 'colors'] }]) {
      const hydrated = normalizeLayout(stored);
      // Whatever he had, PIXELS arrives CLOSED — it did not exist for him.
      expect(hydrated.closed).toContain('pixels');
      expect(openWindows(hydrated)).not.toContain('pixels');
      // …and every window he DID have an opinion about is untouched.
      expect(hydrated.closed.filter((id) => id !== 'pixels')).toEqual(stored.closed);
    }
  });

  it('reproduces the pre-_225 deck EXACTLY for the two stores that matter', () => {
    // The shipped default of the previous build…
    expect(openWindows(normalizeLayout({ closed: ['colors'] })))
      .toEqual(['patterns', 'parameters', 'autopilot']);
    // …and an operator who had opened everything the old build had.
    expect(openWindows(normalizeLayout({ closed: [] })))
      .toEqual(['patterns', 'parameters', 'autopilot', 'colors']);
  });

  it('honours a POST-_225 store that deliberately opened PIXELS', () => {
    const stored = serializeLayout({ closed: ['colors'] });
    expect(stored.known).toContain('pixels');
    // He knew about PIXELS and left it open → it stays open.
    expect(openWindows(normalizeLayout(stored)))
      .toEqual(['patterns', 'parameters', 'autopilot', 'pixels']);
  });

  it('round-trips any reachable layout through serialize → JSON → normalize', () => {
    for (const layout of allReachableLayouts()) {
      const wire = JSON.parse(JSON.stringify(serializeLayout(layout)));
      expect(normalizeLayout(wire)).toEqual(layout);
    }
  });

  it('names the four windows that shipped before the `known` field', () => {
    expect(LEGACY_KNOWN_WINDOWS).toEqual(['patterns', 'parameters', 'autopilot', 'colors']);
    // A junk `known` is treated as absent — a new window still arrives closed
    // rather than springing open off a corrupt field.
    for (const junk of [null, 'colors', 7, {}, [1, 2]]) {
      expect(normalizeLayout({ closed: [], known: junk }).closed).toContain('pixels');
    }
  });

  it('stamps the CURRENT surface set on every write (docs/63 §2.3: all seven, windows + bars)', () => {
    expect(serializeLayout(DEFAULT_LAYOUT).known).toEqual([...DECK_SURFACE_IDS]);
    // A copy, never the shared arrays — a later mutation cannot poison state.
    const s = serializeLayout(DEFAULT_LAYOUT);
    expect(s.closed).not.toBe(DEFAULT_LAYOUT.closed);
  });

  it("reproduces today's operator-locked 40/30/30 column weights", () => {
    const openIds = openWindows(DEFAULT_LAYOUT);
    expect(wideFlexFor(openIds, 'patterns')).toBe(4);
    expect(wideFlexFor(openIds, 'parameters')).toBe(3);
    expect(wideFlexFor(openIds, 'autopilot')).toBe(3);
    // Closed → no track at all.
    expect(wideFlexFor(openIds, 'colors')).toBe(0);
    expect(wideFlexFor(openIds, 'pixels')).toBe(0);
  });

  it('freezes the shared default so a hydrate can never mutate it', () => {
    expect(Object.isFrozen(DEFAULT_LAYOUT)).toBe(true);
    expect(Object.isFrozen(DEFAULT_LAYOUT.closed)).toBe(true);
  });

  it('pins the persistence key at v1', () => {
    expect(DECK_WORKSPACE_LAYOUT_KEY).toBe('deck_workspace_layout_v1');
  });
});

describe('Deck workspace — minimize', () => {
  it('minimizing PARAMETERS leaves PATTERNS + AUTOPILOT — PATTERNS absorbs the slack down to the floor', () => {
    const next = close(DEFAULT_LAYOUT, 'parameters');
    expect(next.closed).toEqual(['colors', 'pixels', 'parameters']);
    const openIds = openWindows(next);
    expect(openIds).toEqual(['patterns', 'autopilot']);
    // Raw sum 4+3=7 is below WIDE_FLEX_FLOOR (10), so PATTERNS absorbs the
    // slack (3) instead of returning its raw weight — AUTOPILOT keeps its
    // canonical 3, landing at the same 3/10 share it has in the default deck.
    expect(wideFlexFor(openIds, 'patterns')).toBe(7);
    expect(wideFlexFor(openIds, 'autopilot')).toBe(3);
    expect(wideFlexFor(openIds, 'parameters')).toBe(0);
  });

  it('minimizing AUTOPILOT leaves PATTERNS + PARAMETERS', () => {
    const next = close(DEFAULT_LAYOUT, 'autopilot');
    expect(openWindows(next)).toEqual(['patterns', 'parameters']);
    expect(railWindows(next)).toEqual(['colors', 'pixels', 'autopilot']);
  });

  it('is idempotent and returns the same reference for a no-op', () => {
    const once = close(DEFAULT_LAYOUT, 'parameters');
    expect(close(once, 'parameters')).toBe(once);
    // COLORS is already closed in the default.
    expect(close(DEFAULT_LAYOUT, 'colors')).toBe(DEFAULT_LAYOUT);
  });

  it('never leaves an empty track: every open window keeps a positive weight', () => {
    for (const layout of allReachableLayouts()) {
      const openIds = openWindows(layout);
      expect(openIds.length).toBeGreaterThan(0);
      for (const id of openIds) expect(wideFlexFor(openIds, id)).toBeGreaterThan(0);
      // allReachableLayouts() only ever closes WINDOWS — narrow the (now
      // surface-typed) closed set back to DeckWindowId for wideFlexFor.
      for (const id of layout.closed.filter(isDeckWindowId)) expect(wideFlexFor(openIds, id)).toBe(0);
    }
  });

  it('lets a single remaining window fill the workspace', () => {
    let layout = close(DEFAULT_LAYOUT, 'parameters');
    layout = close(layout, 'autopilot');
    const openIds = openWindows(layout);
    expect(openIds).toEqual(['patterns']);
    // One track, positive weight, flex-basis 0 → it takes the whole row
    // regardless of the exact number (100% either way). The number itself is
    // now floor-absorbed (WIDE_FLEX_FLOOR, 10) rather than the raw 4 — see
    // the "reopen from all-hidden" suite below for why that matters.
    expect(wideFlexFor(openIds, 'patterns')).toBe(WIDE_FLEX_FLOOR);
    expect(openIds.filter((id) => wideFlexFor(openIds, id) > 0)).toHaveLength(1);
  });
});

// ── The DENOMINATOR FLOOR fix ───────────────────────────────────────────────
// Operator report, live iPad: "in the deck, when all views are hidden and
// then I enable one, it takes over most of the screen — please fix." Cause:
// flexbox renormalizes over the OPEN set only, so a lone reopened secondary
// against a lone PATTERNS landed at an inflated share (e.g. 43% for a 4:3
// pair) instead of its shipped-default 30%. `WIDE_FLEX_FLOOR` (10 = the
// default deck's patterns+parameters+autopilot) is the absorbed-into-PATTERNS
// floor: any composition whose raw weight sum already reaches it is inert.

describe('Deck workspace — the wide-flex denominator floor (wideFlexFor)', () => {
  type FloorCase = {
    mask: number;
    closedSecondary: DeckWindowId[];
    weights: Record<DeckWindowId, number>;
    affected: boolean;
  };

  // Exhaustive 16-row regression fence, one row per reachable subset of the
  // four optional windows (same mask convention as `allReachableLayouts`:
  // bit0=parameters, bit1=autopilot, bit2=colors, bit3=pixels — set = CLOSED).
  // Every weight is a LITERAL, not recomputed from the implementation. Rows
  // marked `affected` are the five compositions this fix actually changes —
  // patterns-alone plus each patterns+one-secondary pair; every other row is
  // byte-identical to the pre-fix raw weights.
  const table: FloorCase[] = [
    { mask: 0, closedSecondary: [], weights: { patterns: 4, parameters: 3, autopilot: 3, colors: 3, pixels: 4 }, affected: false },
    { mask: 1, closedSecondary: ['parameters'], weights: { patterns: 4, parameters: 0, autopilot: 3, colors: 3, pixels: 4 }, affected: false },
    { mask: 2, closedSecondary: ['autopilot'], weights: { patterns: 4, parameters: 3, autopilot: 0, colors: 3, pixels: 4 }, affected: false },
    { mask: 3, closedSecondary: ['parameters', 'autopilot'], weights: { patterns: 4, parameters: 0, autopilot: 0, colors: 3, pixels: 4 }, affected: false },
    { mask: 4, closedSecondary: ['colors'], weights: { patterns: 4, parameters: 3, autopilot: 3, colors: 0, pixels: 4 }, affected: false },
    { mask: 5, closedSecondary: ['parameters', 'colors'], weights: { patterns: 4, parameters: 0, autopilot: 3, colors: 0, pixels: 4 }, affected: false },
    { mask: 6, closedSecondary: ['autopilot', 'colors'], weights: { patterns: 4, parameters: 3, autopilot: 0, colors: 0, pixels: 4 }, affected: false },
    { mask: 7, closedSecondary: ['parameters', 'autopilot', 'colors'], weights: { patterns: 6, parameters: 0, autopilot: 0, colors: 0, pixels: 4 }, affected: true },
    { mask: 8, closedSecondary: ['pixels'], weights: { patterns: 4, parameters: 3, autopilot: 3, colors: 3, pixels: 0 }, affected: false },
    { mask: 9, closedSecondary: ['parameters', 'pixels'], weights: { patterns: 4, parameters: 0, autopilot: 3, colors: 3, pixels: 0 }, affected: false },
    { mask: 10, closedSecondary: ['autopilot', 'pixels'], weights: { patterns: 4, parameters: 3, autopilot: 0, colors: 3, pixels: 0 }, affected: false },
    { mask: 11, closedSecondary: ['parameters', 'autopilot', 'pixels'], weights: { patterns: 7, parameters: 0, autopilot: 0, colors: 3, pixels: 0 }, affected: true },
    { mask: 12, closedSecondary: ['colors', 'pixels'], weights: { patterns: 4, parameters: 3, autopilot: 3, colors: 0, pixels: 0 }, affected: false }, // DEFAULT_LAYOUT
    { mask: 13, closedSecondary: ['parameters', 'colors', 'pixels'], weights: { patterns: 7, parameters: 0, autopilot: 3, colors: 0, pixels: 0 }, affected: true },
    { mask: 14, closedSecondary: ['autopilot', 'colors', 'pixels'], weights: { patterns: 7, parameters: 3, autopilot: 0, colors: 0, pixels: 0 }, affected: true },
    { mask: 15, closedSecondary: ['parameters', 'autopilot', 'colors', 'pixels'], weights: { patterns: 10, parameters: 0, autopilot: 0, colors: 0, pixels: 0 }, affected: true },
  ];

  it('matches the exhaustive literal weight table for all 16 reachable subsets', () => {
    for (const row of table) {
      const layout: DeckWorkspaceLayout = { closed: row.closedSecondary };
      const openIds = openWindows(layout);
      for (const id of DECK_WINDOW_IDS) {
        expect(wideFlexFor(openIds, id), `mask ${row.mask} / ${id}`).toBe(row.weights[id]);
      }
    }
  });

  it('exactly 5 rows are affected: PATTERNS-alone and each PATTERNS+one-secondary pair', () => {
    const affectedMasks = table.filter((r) => r.affected).map((r) => r.mask).sort((a, b) => a - b);
    expect(affectedMasks).toEqual([7, 11, 13, 14, 15]);
  });

  it('pin: default layout stays the operator-locked 4/3/3 (40/30/30) — byte-identical', () => {
    const openIds = openWindows(DEFAULT_LAYOUT);
    expect(openIds).toEqual(['patterns', 'parameters', 'autopilot']);
    expect(wideFlexFor(openIds, 'patterns')).toBe(4);
    expect(wideFlexFor(openIds, 'parameters')).toBe(3);
    expect(wideFlexFor(openIds, 'autopilot')).toBe(3);
  });

  it('pin: all-five-open stays 4/3/3/3/4 — byte-identical', () => {
    const allOpen: DeckWorkspaceLayout = { closed: [] };
    const openIds = openWindows(allOpen);
    expect(openIds.map((id) => wideFlexFor(openIds, id))).toEqual([4, 3, 3, 3, 4]);
  });

  it('reopen-from-all-hidden: each window comes back at its SHIPPED DEFAULT share, PATTERNS holds the remainder', () => {
    const allHidden: DeckWorkspaceLayout = { closed: ['parameters', 'autopilot', 'colors', 'pixels'] };
    const expectedShare: { parameters: number; autopilot: number; colors: number; pixels: number } = {
      parameters: 3 / 10,
      autopilot: 3 / 10,
      colors: 3 / 10,
      pixels: 4 / 10,
    };
    for (const id of ['parameters', 'autopilot', 'colors', 'pixels'] as const) {
      const layout = open(allHidden, id);
      const openIds = openWindows(layout);
      // patterns always sorts first in canonical order, so a 2-open set is
      // always [patterns, id].
      expect(openIds).toEqual(['patterns', id]);
      const total = openIds.reduce((sum, openId) => sum + wideFlexFor(openIds, openId), 0);
      const idShare = wideFlexFor(openIds, id) / total;
      const patternsShare = wideFlexFor(openIds, 'patterns') / total;
      expect(idShare).toBeCloseTo(expectedShare[id], 10);
      expect(patternsShare).toBeCloseTo(1 - expectedShare[id], 10);
    }
  });

  it('sum invariant: total open weight is max(rawOpenSum, WIDE_FLEX_FLOOR) for every reachable layout', () => {
    const rawWeight: Record<DeckWindowId, number> = { patterns: 4, parameters: 3, autopilot: 3, colors: 3, pixels: 4 };
    for (const layout of allReachableLayouts()) {
      const openIds = openWindows(layout);
      const rawOpenSum = openIds.reduce((sum, id) => sum + rawWeight[id], 0);
      const total = openIds.reduce((sum, id) => sum + wideFlexFor(openIds, id), 0);
      expect(total).toBe(Math.max(rawOpenSum, WIDE_FLEX_FLOOR));
    }
  });

  it('PATTERNS floor intact: never closable, always a positive weight, a closed window is always exactly 0', () => {
    for (const layout of allReachableLayouts()) {
      const openIds = openWindows(layout);
      expect(openIds).toContain('patterns');
      expect(wideFlexFor(openIds, 'patterns')).toBeGreaterThan(0);
      for (const id of layout.closed.filter(isDeckWindowId)) expect(wideFlexFor(openIds, id)).toBe(0);
    }
  });

  it('patternsFillsNarrow is unaffected by this fix — engages at exactly 1 open member, disengages at 2', () => {
    expect(patternsFillsNarrow(['patterns'])).toBe(true);
    expect(patternsFillsNarrow(['patterns', 'parameters'])).toBe(false);
    expect(patternsFillsNarrow(['patterns', 'pixels'])).toBe(false);
  });

  it('persistence round trip: a STORED all-hidden layout reopens to the same shares as an in-session reopen', () => {
    const stored = {
      closed: ['parameters', 'autopilot', 'colors', 'pixels'],
      known: [...DECK_SURFACE_IDS],
    };
    const hydrated = normalizeLayout(stored);
    expect(hydrated).toEqual({ closed: ['parameters', 'autopilot', 'colors', 'pixels'] });

    const inSessionAllHidden: DeckWorkspaceLayout = { closed: ['parameters', 'autopilot', 'colors', 'pixels'] };
    for (const id of ['parameters', 'autopilot', 'colors', 'pixels'] as const) {
      const fromStore = openWindows(open(hydrated, id));
      const inSession = openWindows(open(inSessionAllHidden, id));
      expect(fromStore.map((openId) => wideFlexFor(fromStore, openId)))
        .toEqual(inSession.map((openId) => wideFlexFor(inSession, openId)));
    }
  });

  it('bars never influence window weights: a bar id returns 0, and closing/opening a bar leaves every window weight untouched', () => {
    const defaultOpenIds = openWindows(DEFAULT_LAYOUT);
    expect(wideFlexFor(defaultOpenIds, 'audioBar' as unknown as DeckWindowId)).toBe(0);
    expect(wideFlexFor(defaultOpenIds, 'outputBar' as unknown as DeckWindowId)).toBe(0);

    const before = defaultOpenIds.map((id) => wideFlexFor(defaultOpenIds, id));
    const withBarsClosed = close(close(DEFAULT_LAYOUT, 'audioBar'), 'outputBar');
    const openAfter = openWindows(withBarsClosed);
    const after = openAfter.map((id) => wideFlexFor(openAfter, id));
    expect(after).toEqual(before);
  });

  it('perf-overlay composition: the floor still applies through effectiveOpenWindows, and is inert once the raw sum clears it', () => {
    // Default deck under perf: PARAMETERS + AUTOPILOT hidden → PATTERNS alone.
    const defaultUnderPerf = effectiveOpenWindows(DEFAULT_LAYOUT, true);
    expect(defaultUnderPerf).toEqual(['patterns']);
    expect(wideFlexFor(defaultUnderPerf, 'patterns')).toBe(WIDE_FLEX_FLOOR);

    // All-open deck under perf: PARAMETERS + AUTOPILOT hidden, COLORS + PIXELS
    // stay → raw sum 4+3+4=11 already clears the floor, so it is inert.
    const allOpen: DeckWorkspaceLayout = { closed: [] };
    const allOpenUnderPerf = effectiveOpenWindows(allOpen, true);
    expect(allOpenUnderPerf).toEqual(['patterns', 'colors', 'pixels']);
    expect(allOpenUnderPerf.map((id) => wideFlexFor(allOpenUnderPerf, id))).toEqual([4, 3, 4]);
  });
});

describe('Deck workspace — restore', () => {
  it('keeps the rail in CLOSE order and restores deterministically', () => {
    let layout = close(DEFAULT_LAYOUT, 'autopilot');
    layout = close(layout, 'parameters');
    expect(railWindows(layout)).toEqual(['colors', 'pixels', 'autopilot', 'parameters']);

    const afterAutopilot = open(layout, 'autopilot');
    expect(railWindows(afterAutopilot)).toEqual(['colors', 'pixels', 'parameters']);
    expect(openWindows(afterAutopilot)).toEqual(['patterns', 'autopilot']);

    const afterColors = open(afterAutopilot, 'colors');
    expect(railWindows(afterColors)).toEqual(['pixels', 'parameters']);
    // Tracks always render in CANONICAL order, whatever the restore order was.
    expect(openWindows(afterColors)).toEqual(['patterns', 'autopilot', 'colors']);

    // PIXELS restores like any other window, and lands in canonical order —
    // LAST, after COLORS, however late it was restored.
    const afterPixels = open(afterColors, 'pixels');
    expect(railWindows(afterPixels)).toEqual(['parameters']);
    expect(openWindows(afterPixels)).toEqual(['patterns', 'autopilot', 'colors', 'pixels']);
  });

  it('opening an already-open window is a same-reference no-op', () => {
    expect(open(DEFAULT_LAYOUT, 'parameters')).toBe(DEFAULT_LAYOUT);
  });

  it('resets to the default, and reset on the default is a no-op', () => {
    const layout = close(DEFAULT_LAYOUT, 'parameters');
    expect(layoutReducer(layout, { type: 'reset' })).toEqual({ closed: ['colors', 'pixels'] });
    const already: DeckWorkspaceLayout = { closed: ['colors', 'pixels'] };
    expect(layoutReducer(already, { type: 'reset' })).toBe(already);
  });
});

describe('Deck workspace — PATTERNS is protected', () => {
  it('close(patterns) returns the same reference', () => {
    expect(close(DEFAULT_LAYOUT, PROTECTED_WINDOW)).toBe(DEFAULT_LAYOUT);
    const busy = close(close(DEFAULT_LAYOUT, 'parameters'), 'autopilot');
    expect(close(busy, 'patterns')).toBe(busy);
  });

  it('offers no close affordance for PATTERNS and one for everyone else', () => {
    expect(canClose('patterns')).toBe(false);
    expect(canClose('parameters')).toBe(true);
    expect(canClose('autopilot')).toBe(true);
    expect(canClose('colors')).toBe(true);
  });

  it('keeps PATTERNS open in every reachable layout', () => {
    for (const layout of allReachableLayouts()) expect(isOpen(layout, 'patterns')).toBe(true);
  });
});

describe('Deck workspace — unknown actions', () => {
  it('treats an unknown window id as a no-op', () => {
    const bogus = 'bogus' as DeckWindowId;
    expect(close(DEFAULT_LAYOUT, bogus)).toBe(DEFAULT_LAYOUT);
    expect(open(DEFAULT_LAYOUT, bogus)).toBe(DEFAULT_LAYOUT);
  });

  it('THROWS on an unknown action type (coding bug — fail loud)', () => {
    expect(() => layoutReducer(DEFAULT_LAYOUT, { type: 'wat' } as unknown as never))
      .toThrow(/unknown layout action/);
  });
});

describe('Deck workspace — normalizeLayout (untrusted hydrate)', () => {
  // A store written by THIS build knows about every current window, so these
  // cases isolate the classic hydrate rules from the new-window rule above.
  const known = [...DECK_WINDOW_IDS];

  it('accepts a well-formed stored layout verbatim', () => {
    expect(normalizeLayout({ closed: ['autopilot', 'colors'], known }))
      .toEqual({ closed: ['autopilot', 'colors'] });
  });

  it('accepts an all-open stored layout (empty closed set is legitimate)', () => {
    expect(normalizeLayout({ closed: [], known })).toEqual({ closed: [] });
  });

  it('drops unknown ids, dedupes, and preserves the surviving order', () => {
    expect(normalizeLayout({ closed: ['colors', 'bogus', 'colors', 'autopilot', 7, null], known }))
      .toEqual({ closed: ['colors', 'autopilot'] });
  });

  it('purges a stale/hand-edited PATTERNS entry (the UI would refuse it)', () => {
    expect(normalizeLayout({ closed: ['patterns', 'bogus'], known })).toEqual({ closed: [] });
    expect(normalizeLayout({ closed: ['patterns', 'colors'], known }))
      .toEqual({ closed: ['colors'] });
    // PATTERNS is never appended by the new-window rule either — it is the
    // floor, so "the store never heard of it" still cannot close it.
    expect(normalizeLayout({ closed: [], known: ['colors'] }).closed)
      .not.toContain('patterns');
  });

  it('is total over junk input and never throws', () => {
    const junk: unknown[] = [
      undefined, null, 0, 1, '', 'closed', true, false, NaN,
      [], ['colors'], {}, { closed: null }, { closed: 'colors' }, { closed: 3 },
      { closed: {} }, { version: 2 }, { closed: [{ id: 'colors' }] },
      Symbol('x'), () => {}, new Date(0),
    ];
    for (const input of junk) {
      expect(() => normalizeLayout(input)).not.toThrow();
      const out = normalizeLayout(input);
      expect(Array.isArray(out.closed)).toBe(true);
      for (const id of out.closed) {
        expect(isDeckWindowId(id)).toBe(true);
        expect(id).not.toBe(PROTECTED_WINDOW);
      }
    }
    // Hopeless shapes land on the default (a copy, never the frozen constant).
    const fromJunk = normalizeLayout('nope');
    expect(fromJunk).toEqual(DEFAULT_LAYOUT);
    expect(fromJunk).not.toBe(DEFAULT_LAYOUT);
    expect(Object.isFrozen(fromJunk.closed)).toBe(false);
  });

  it('round-trips through JSON the way the AsyncStorage hydrate does', () => {
    const stored = JSON.stringify(serializeLayout(close(DEFAULT_LAYOUT, 'autopilot')));
    expect(normalizeLayout(JSON.parse(stored)))
      .toEqual({ closed: ['colors', 'pixels', 'autopilot'] });
  });
});

describe('Deck workspace — render-layer contracts', () => {
  it('hides a closed window instead of unmounting it', () => {
    expect(windowDisplay(true)).toBe('flex');
    expect(windowDisplay(false)).toBe('none');
  });

  it('keeps PATTERNS pinned and every other window inside the ONE narrow scroll', () => {
    expect(narrowScrollOwner('patterns')).toBe('pinned');
    expect(narrowScrollOwner('parameters')).toBe('columnsScrollRest');
    expect(narrowScrollOwner('autopilot')).toBe('columnsScrollRest');
    expect(narrowScrollOwner('colors')).toBe('columnsScrollRest');
    // Exactly one pinned owner → no same-axis nested ScrollViews.
    expect(DECK_WINDOW_IDS.filter((id) => narrowScrollOwner(id) === 'pinned'))
      .toEqual(['patterns']);
  });

  it('names every window for the chrome + accessibility labels', () => {
    for (const id of DECK_WINDOW_IDS) {
      expect(DECK_WINDOW_TITLES[id]).toBe(id.toUpperCase());
    }
  });
});

// ── The PERFORMANCE overlay (docs/55 §2.5, D3) ──────────────────────────────
// The overlay is a DERIVED VIEW over a layout. These tests exist to pin that
// it is derived — that no code path here can write, and that leaving a show
// restores exactly what the operator had.

describe('performance overlay — derived, never persisted', () => {
  const allOpen: DeckWorkspaceLayout = { closed: [] };

  it('hides PARAMETERS and AUTOPILOT, and ONLY those two', () => {
    expect(PERF_HIDDEN_WINDOWS).toEqual(['parameters', 'autopilot']);
    expect(effectiveOpenWindows(allOpen, true)).toEqual(['patterns', 'colors', 'pixels']);
  });

  it('leaves PIXELS alone during a show — it is a monitor, not a settings pane', () => {
    expect(PERF_HIDDEN_WINDOWS).not.toContain('pixels');
    // Open before the show → still open during it.
    expect(effectiveOpenWindows({ closed: [] }, true)).toContain('pixels');
    // Hidden before the show → still on the rail, still restorable mid-show.
    const hidden: DeckWorkspaceLayout = { closed: ['pixels'] };
    expect(effectiveOpenWindows(hidden, true)).not.toContain('pixels');
    expect(effectiveRailWindows(hidden, true)).toEqual(['pixels']);
  });

  it('is a no-op when performance mode is off', () => {
    for (const layout of [allOpen, DEFAULT_LAYOUT, { closed: ['colors', 'autopilot'] as DeckWindowId[] }]) {
      expect(effectiveOpenWindows(layout, false)).toEqual(openWindows(layout));
      expect(effectiveRailWindows(layout, false)).toEqual(railWindows(layout));
    }
  });

  it('COLORS stays exactly as the operator left it, in both directions', () => {
    // Open during the show…
    expect(effectiveOpenWindows(allOpen, true)).toContain('colors');
    // …and hidden during the show if that is how they left it.
    const colorsHidden: DeckWorkspaceLayout = { closed: ['colors', 'pixels'] };
    expect(effectiveOpenWindows(colorsHidden, true)).toEqual(['patterns']);
    expect(effectiveRailWindows(colorsHidden, true)).toEqual(['colors', 'pixels']);
  });

  it('SUPPRESSES the two chips from the rail as well as the open row (D3)', () => {
    // Both already minimized by the operator: during the show they must not
    // appear as restore chips either — an affordance that always refuses.
    const layout: DeckWorkspaceLayout = { closed: ['parameters', 'autopilot'] };
    expect(effectiveRailWindows(layout, false)).toEqual(['parameters', 'autopilot']);
    expect(effectiveRailWindows(layout, true)).toEqual([]);
    // A mixed rail keeps the chip that is still reachable.
    const mixed: DeckWorkspaceLayout = { closed: ['colors', 'autopilot'] };
    expect(effectiveRailWindows(mixed, true)).toEqual(['colors']);
  });

  it('PATTERNS is never hidden by the overlay — the floor holds', () => {
    expect(PERF_HIDDEN_WINDOWS).not.toContain(PROTECTED_WINDOW);
    for (const layout of [allOpen, DEFAULT_LAYOUT, { closed: ['colors'] as DeckWindowId[] }]) {
      expect(effectiveOpenWindows(layout, true)).toContain('patterns');
    }
  });

  it('the ROUND TRIP is byte-identical: entering and leaving writes nothing', () => {
    for (const closed of [[], ['colors'], ['parameters'], ['colors', 'autopilot']] as DeckWindowId[][]) {
      const layout: DeckWorkspaceLayout = { closed };
      const before = JSON.stringify(layout);
      // The overlay only ever READS. Every accessor is pure over the layout.
      effectiveOpenWindows(layout, true);
      effectiveRailWindows(layout, true);
      effectiveOpenWindows(layout, false);
      effectiveRailWindows(layout, false);
      expect(JSON.stringify(layout)).toBe(before);
      // …and what the screen shows on exit is what it showed before entry.
      expect(effectiveOpenWindows(layout, false)).toEqual(openWindows(layout));
    }
  });

  it('the overlay has no reducer action — it CANNOT reach the persisted store', () => {
    // Every LayoutAction is one of these three. The overlay is not among them,
    // by construction: there is nothing to dispatch. Anything else throws.
    expect(() => layoutReducer(DEFAULT_LAYOUT, { type: 'performance' } as never))
      .toThrow(/unknown layout action/);
    expect(DECK_WORKSPACE_LAYOUT_KEY).toBe('deck_workspace_layout_v1');
  });

  it('names the suppressed chips\' replacement caption', () => {
    expect(PERF_BAR_CAPTION).toBe('PERFORMANCE — PARAMS & AUTOPILOT HIDDEN');
  });
});

// ── Narrow fullscreen (docs/55 §2.4, operator intent 4) ─────────────────────

describe('patternsFillsNarrow — PATTERNS fills only when it is ALONE', () => {
  it('fills when PATTERNS is the only window on screen', () => {
    expect(patternsFillsNarrow(['patterns'])).toBe(true);
  });

  it('does NOT fill whenever a second window is open — the pin contract holds', () => {
    expect(patternsFillsNarrow(['patterns', 'colors'])).toBe(false);
    expect(patternsFillsNarrow(['patterns', 'parameters'])).toBe(false);
    expect(patternsFillsNarrow(['patterns', 'parameters', 'autopilot', 'colors'])).toBe(false);
    // PIXELS is a second window like any other: opening it restores the pin.
    expect(patternsFillsNarrow(['patterns', 'pixels'])).toBe(false);
  });

  it('never claims a fill for a set that is not PATTERNS-alone', () => {
    expect(patternsFillsNarrow([])).toBe(false);
    expect(patternsFillsNarrow(['colors'])).toBe(false);
  });

  it('engages via LAYOUT closures', () => {
    const layout: DeckWorkspaceLayout = {
      closed: ['parameters', 'autopilot', 'colors', 'pixels'],
    };
    expect(patternsFillsNarrow(effectiveOpenWindows(layout, false))).toBe(true);
  });

  it('engages via the PERFORMANCE OVERLAY too — a show with COLORS + PIXELS closed', () => {
    const layout: DeckWorkspaceLayout = { closed: ['colors', 'pixels'] };
    // Edit mode: PARAMETERS + AUTOPILOT are still open, so the pin stays.
    expect(patternsFillsNarrow(effectiveOpenWindows(layout, false))).toBe(false);
    // Performance mode hides both → PATTERNS is alone and fills.
    expect(patternsFillsNarrow(effectiveOpenWindows(layout, true))).toBe(true);
  });

  it('a show with PIXELS OPEN does not fill — the overlay never hides it', () => {
    const layout: DeckWorkspaceLayout = { closed: ['colors'] };
    expect(effectiveOpenWindows(layout, true)).toEqual(['patterns', 'pixels']);
    expect(patternsFillsNarrow(effectiveOpenWindows(layout, true))).toBe(false);
  });

  it('a show with COLORS OPEN does not fill — COLORS is a performance surface', () => {
    const layout: DeckWorkspaceLayout = { closed: [] };
    expect(patternsFillsNarrow(effectiveOpenWindows(layout, true))).toBe(false);
  });
});

// ── The BAR TIER (docs/63 §2) ───────────────────────────────────────────────
// AUDIO and OUTPUT join the same reducer, the same closed-set store, and the
// same chip row as the five windows — one mechanism, two tiers. These suites
// pin: the upgrade matrix generalizes cleanly (bars default OPEN, windows
// default closed), the reducer treats bars like any non-protected window, the
// PIXELS→OUTPUT suppression is derived and never persists, and every
// window-only selector stays provably closed to bars.

describe('Deck workspace — bar types + titles', () => {
  it('names both bars and their canonical order', () => {
    expect(DECK_BAR_IDS).toEqual(['audioBar', 'outputBar']);
    expect(DECK_BAR_TITLES.audioBar).toBe('AUDIO');
    expect(DECK_BAR_TITLES.outputBar).toBe('OUTPUT');
  });

  it('DECK_SURFACE_IDS is windows-then-bars, all seven', () => {
    expect(DECK_SURFACE_IDS).toEqual([...DECK_WINDOW_IDS, ...DECK_BAR_IDS]);
    expect(DECK_SURFACE_IDS).toHaveLength(7);
  });

  it('isDeckSurfaceId accepts every window and bar, rejects junk', () => {
    for (const id of DECK_SURFACE_IDS) expect(isDeckSurfaceId(id)).toBe(true);
    expect(isDeckSurfaceId('bogus')).toBe(false);
    expect(isDeckSurfaceId(7)).toBe(false);
    expect(isDeckSurfaceId(null)).toBe(false);
  });

  it('isDeckWindowId stays window-only — a bar is not a window', () => {
    for (const id of DECK_BAR_IDS) expect(isDeckWindowId(id)).toBe(false);
    for (const id of DECK_WINDOW_IDS) expect(isDeckWindowId(id)).toBe(true);
  });
});

describe('Deck workspace — bars: the upgrade matrix (docs/63 §2.3)', () => {
  type UpgradeCase = {
    label: string;
    stored: unknown;
    expectedOpenWindows: DeckWindowId[];
    expectedShownBars: DeckBarId[];
  };

  const cases: UpgradeCase[] = [
    {
      label: 'no `known` field at all (legacy pre-_225 store)',
      stored: { closed: ['colors'] },
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
    {
      label: '4-id `known` (explicit legacy set)',
      stored: { closed: ['colors'], known: [...LEGACY_KNOWN_WINDOWS] },
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
    {
      label: '5-id `known` (current shipping builds — post-_225, pre-bars)',
      stored: { closed: ['colors'], known: [...DECK_WINDOW_IDS] },
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot', 'pixels'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
    {
      label: '7-id `known` (this build), operator never touched the bars',
      stored: { closed: ['colors'], known: [...DECK_SURFACE_IDS] },
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot', 'pixels'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
    {
      label: 'corrupt/garbage input falls back to the default',
      stored: 'nope',
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
    {
      label: '{closed: []}, no `known` — everything the pre-bar build knew about was open',
      stored: { closed: [] },
      expectedOpenWindows: ['patterns', 'parameters', 'autopilot', 'colors'],
      expectedShownBars: ['audioBar', 'outputBar'],
    },
  ];

  it('hydrates window membership per the `_225` contract and both bars OPEN unless explicitly named', () => {
    for (const { label, stored, expectedOpenWindows, expectedShownBars } of cases) {
      const hydrated = normalizeLayout(stored);
      expect(openWindows(hydrated), label).toEqual(expectedOpenWindows);
      expect(shownBars(hydrated), label).toEqual(expectedShownBars);
    }
  });

  it('a 7-id `known` store that explicitly closed a bar keeps that bar closed', () => {
    const stored = { closed: ['colors', 'audioBar'], known: [...DECK_SURFACE_IDS] };
    const hydrated = normalizeLayout(stored);
    expect(openWindows(hydrated)).toEqual(['patterns', 'parameters', 'autopilot', 'pixels']);
    expect(shownBars(hydrated)).toEqual(['outputBar']);
    expect(hydrated.closed).toEqual(['colors', 'audioBar']);
  });

  it('pre-`known` stores hydrate window-byte-identical to the pre-bar contract, PLUS two OPEN bar chips', () => {
    // The same three legacy stores the `_225` suite above already proves
    // hydrate window-identical. This is the explicit combined claim: nothing
    // about the window side changed, and the two new chips both render OPEN.
    for (const stored of [{ closed: ['colors'] }, { closed: [] }, { closed: ['parameters', 'colors'] }]) {
      const hydrated = normalizeLayout(stored);
      expect(hydrated.closed).toContain('pixels');
      expect(openWindows(hydrated)).not.toContain('pixels');
      expect(shownBars(hydrated)).toEqual(['audioBar', 'outputBar']);
      expect(hydrated.closed).not.toContain('audioBar');
      expect(hydrated.closed).not.toContain('outputBar');
    }
  });

  it('stamps all seven surface ids as `known` on every write', () => {
    expect(serializeLayout(DEFAULT_LAYOUT).known).toEqual([...DECK_SURFACE_IDS]);
    expect(serializeLayout(DEFAULT_LAYOUT).known).toHaveLength(7);
  });
});

describe('Deck workspace — bars: reducer + rail (docs/63 §2.2)', () => {
  it('closes and opens both bars like any non-protected surface', () => {
    let layout = close(DEFAULT_LAYOUT, 'audioBar');
    expect(layout.closed).toEqual(['colors', 'pixels', 'audioBar']);
    expect(shownBars(layout)).toEqual(['outputBar']);

    layout = close(layout, 'outputBar');
    expect(layout.closed).toEqual(['colors', 'pixels', 'audioBar', 'outputBar']);
    expect(shownBars(layout)).toEqual([]);

    layout = open(layout, 'audioBar');
    expect(shownBars(layout)).toEqual(['audioBar']);
    expect(railSurfaces(layout)).toEqual(['colors', 'pixels', 'outputBar']);
  });

  it('is idempotent and returns the same reference for a bar no-op', () => {
    const once = close(DEFAULT_LAYOUT, 'audioBar');
    expect(close(once, 'audioBar')).toBe(once);
    expect(open(DEFAULT_LAYOUT, 'audioBar')).toBe(DEFAULT_LAYOUT);
  });

  it('PATTERNS still refuses to close, even with both bars closed', () => {
    const layout = close(close(DEFAULT_LAYOUT, 'audioBar'), 'outputBar');
    expect(close(layout, PROTECTED_WINDOW)).toBe(layout);
    expect(isOpen(layout, 'patterns')).toBe(true);
  });

  it('reset returns to DEFAULT_LAYOUT even with bars closed', () => {
    const layout = close(close(DEFAULT_LAYOUT, 'audioBar'), 'outputBar');
    expect(layoutReducer(layout, { type: 'reset' })).toEqual(DEFAULT_LAYOUT);
  });

  it('an unknown surface id is a no-op, same as an unknown window id', () => {
    const bogus = 'bogus' as unknown as DeckSurfaceId;
    expect(close(DEFAULT_LAYOUT, bogus)).toBe(DEFAULT_LAYOUT);
    expect(open(DEFAULT_LAYOUT, bogus)).toBe(DEFAULT_LAYOUT);
  });

  it('interleaves windows and bars in CLOSE order on the combined rail', () => {
    let layout = close(DEFAULT_LAYOUT, 'autopilot'); // closed: colors, pixels, autopilot
    layout = close(layout, 'audioBar');               // + audioBar
    layout = close(layout, 'parameters');              // + parameters
    layout = close(layout, 'outputBar');                // + outputBar
    expect(railSurfaces(layout)).toEqual([
      'colors', 'pixels', 'autopilot', 'audioBar', 'parameters', 'outputBar',
    ]);
    // railWindows narrows to windows only, in the same close order.
    expect(railWindows(layout)).toEqual(['colors', 'pixels', 'autopilot', 'parameters']);
    // shownBars is empty — both bars are on the rail now.
    expect(shownBars(layout)).toEqual([]);
  });

  it('canClose is true for both bars and every non-protected window', () => {
    for (const id of DECK_BAR_IDS) expect(canClose(id)).toBe(true);
    expect(canClose('parameters')).toBe(true);
    expect(canClose('patterns')).toBe(false);
  });

  it('isShown mirrors isOpen for windows and extends to bars', () => {
    expect(isShown(DEFAULT_LAYOUT, 'patterns')).toBe(true);
    expect(isShown(DEFAULT_LAYOUT, 'colors')).toBe(false);
    expect(isShown(DEFAULT_LAYOUT, 'audioBar')).toBe(true);
    const layout = close(DEFAULT_LAYOUT, 'audioBar');
    expect(isShown(layout, 'audioBar')).toBe(false);
    expect(isShown(layout, 'outputBar')).toBe(true);
  });
});

describe('Deck workspace — PIXELS -> OUTPUT suppression (docs/63 §2.4)', () => {
  it('names outputBar as the only surface PIXELS suppresses', () => {
    expect(PIXELS_SUPPRESSES).toEqual(['outputBar']);
  });

  it('suppresses outputBar only while pixelsShown is true', () => {
    expect(effectiveShownBars(DEFAULT_LAYOUT, true)).toEqual(['audioBar']);
    expect(effectiveShownBars(DEFAULT_LAYOUT, false)).toEqual(['audioBar', 'outputBar']);
  });

  it('leaves audioBar alone regardless of pixels visibility', () => {
    const layout: DeckWorkspaceLayout = { closed: [] };
    expect(effectiveShownBars(layout, true)).toContain('audioBar');
    expect(effectiveShownBars(layout, false)).toContain('audioBar');
  });

  it('edge case: pixels open AND outputBar already closed by the operator — same filtered result either way', () => {
    const layout: DeckWorkspaceLayout = { closed: ['outputBar'] };
    expect(effectiveShownBars(layout, true)).toEqual(['audioBar']);
    expect(effectiveShownBars(layout, false)).toEqual(['audioBar']);
  });

  it('closing PIXELS restores the persisted truth, whatever the operator had for OUTPUT before', () => {
    // OUTPUT was shown; PIXELS opens and suppresses it; PIXELS closes and it
    // comes back — nothing was ever written to the layout in between.
    const shown: DeckWorkspaceLayout = { closed: [] };
    const before = JSON.stringify(shown);
    expect(effectiveShownBars(shown, true)).toEqual(['audioBar']);
    expect(effectiveShownBars(shown, false)).toEqual(['audioBar', 'outputBar']);
    expect(JSON.stringify(shown)).toBe(before);

    // The operator's OWN manual OUTPUT-hide, made before ever touching
    // PIXELS, survives the whole PIXELS open/close cycle unchanged.
    const manuallyClosed: DeckWorkspaceLayout = { closed: ['outputBar'] };
    expect(effectiveShownBars(manuallyClosed, true)).toEqual(['audioBar']);
    expect(effectiveShownBars(manuallyClosed, false)).toEqual(['audioBar']);
  });

  it('names the suppression caption', () => {
    expect(PIXELS_BAR_CAPTION).toBe('1D OUTPUT — SHOWN WHEN PIXELS IS HIDDEN');
  });

  it('never persists — effectiveShownBars is a pure read over the layout', () => {
    const layout: DeckWorkspaceLayout = { closed: [] };
    const before = JSON.stringify(layout);
    effectiveShownBars(layout, true);
    effectiveShownBars(layout, false);
    expect(JSON.stringify(layout)).toBe(before);
  });
});

describe('Deck workspace — bars are orthogonal to window-only rules (docs/63 §2.1, §2.5, §2.6)', () => {
  it('patternsFillsNarrow ignores bar state — closing both bars changes nothing it sees', () => {
    const allClosedIncludingBars: DeckWorkspaceLayout = {
      closed: ['parameters', 'autopilot', 'colors', 'pixels', 'audioBar', 'outputBar'],
    };
    expect(effectiveOpenWindows(allClosedIncludingBars, false)).toEqual(['patterns']);
    expect(patternsFillsNarrow(effectiveOpenWindows(allClosedIncludingBars, false))).toBe(true);

    // With a second WINDOW open, the pin holds even though both bars are
    // also closed — bars are simply not part of what this predicate reasons
    // about.
    const withColorsOpen: DeckWorkspaceLayout = {
      closed: ['parameters', 'autopilot', 'pixels', 'audioBar', 'outputBar'],
    };
    expect(patternsFillsNarrow(effectiveOpenWindows(withColorsOpen, false))).toBe(false);
  });

  it('wideFlexFor never returns a nonzero weight for a bar id', () => {
    const openIds = openWindows(DEFAULT_LAYOUT);
    expect(wideFlexFor(openIds, 'audioBar' as unknown as DeckWindowId)).toBe(0);
    expect(wideFlexFor(openIds, 'outputBar' as unknown as DeckWindowId)).toBe(0);
  });

  it('effectiveOpenWindows and effectiveRailWindows never return a bar, whatever the layout', () => {
    const layout: DeckWorkspaceLayout = { closed: [] };
    const open = effectiveOpenWindows(layout, false);
    const rail = effectiveRailWindows(layout, true);
    for (const barId of DECK_BAR_IDS) {
      expect(open).not.toContain(barId);
      expect(rail).not.toContain(barId);
    }
  });

  it('PERF_HIDDEN_WINDOWS names no bar — the perf overlay is windows-only', () => {
    for (const barId of DECK_BAR_IDS) expect(PERF_HIDDEN_WINDOWS).not.toContain(barId);
  });

  it('perf overlay ignores bars: a closed bar stays closed through an enter/exit round trip, writing nothing', () => {
    const layout: DeckWorkspaceLayout = { closed: ['audioBar', 'outputBar'] };
    const before = JSON.stringify(layout);
    expect(shownBars(layout)).toEqual([]);
    // Entering performance mode…
    effectiveOpenWindows(layout, true);
    effectiveRailWindows(layout, true);
    expect(shownBars(layout)).toEqual([]);
    // …and leaving it.
    effectiveOpenWindows(layout, false);
    effectiveRailWindows(layout, false);
    expect(shownBars(layout)).toEqual([]);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('an OPEN bar also survives a perf enter/exit round trip untouched', () => {
    const layout: DeckWorkspaceLayout = { closed: [] };
    expect(shownBars(layout)).toEqual(['audioBar', 'outputBar']);
    effectiveOpenWindows(layout, true);
    effectiveRailWindows(layout, true);
    expect(shownBars(layout)).toEqual(['audioBar', 'outputBar']);
  });
});

describe('Deck workspace — surface round trip is the identity (docs/63 §2.3, all 2^6 reachable sets)', () => {
  it('round-trips every reachable 7-surface layout through serialize -> JSON -> normalize', () => {
    const layouts = allReachableSurfaceLayouts();
    expect(layouts).toHaveLength(64);
    for (const layout of layouts) {
      const wire = JSON.parse(JSON.stringify(serializeLayout(layout)));
      expect(normalizeLayout(wire)).toEqual(layout);
    }
  });
});

// ── NARROW STACK ARBITRATION (report _273 ruling, REVISED by the _278
//    ruling) ────────────────────────────────────────────────────────────────
//
// Two operator rulings shaped this split, in order:
//
//   • _273/_274: a stack SHORTER than the pin must never overflow the host or
//     starve the region to zero (880x620, host 309, pin 400: PATTERNS spilled
//     95 px under the bottom bar and the reopened window never appeared).
//     That short-stack yield is pinned below, unchanged.
//   • _278: "hide all panels, then reshow any of them, and it overlays the
//     patterns panel. the pattern panel is not resizing maybe? from full
//     screen or sth?" — `_274`'s per-occupant share left PATTERNS at 75 % of
//     the stack after a reshow (visually still "full screen") with the
//     restored window a 220 pt fragment. The share is GONE: with ANY
//     secondary open, the region gets its FULL default-deck viewport and
//     PATTERNS returns to the party pin, so a reshow snaps the deck back to
//     its shipped proportions — the true narrow analogue of `wideFlexFor`.
//
// The MOST important assertions are still the NEGATIVE ones: the shipped
// default deck and every richer composition come back at the party
// 2026-07-11 pin, to the pixel.
describe('Deck workspace — the narrow stack split (narrowStackSizing)', () => {
  // Measured on the scratch dist: the columns host at each iPad portrait
  // viewport with the default chrome (both bars shown).
  const IPAD_12_9 = { windowHeight: 1366, hostHeight: 1015 };
  const IPAD_11 = { windowHeight: 1194, hostHeight: 843 };
  // The reproduced short-stack failure: a narrow window whose host is SMALLER
  // than the 400 pt pin floor.
  const SHORT = { windowHeight: 620, hostHeight: 309 };

  const size = (
    openCount: number,
    vp: { windowHeight: number; hostHeight: number | null },
    secondaryBound = false,
  ) => narrowStackSizing({ openCount, ...vp, secondaryBound });

  it('narrowPatternsPin is the party 2026-07-11 pin, unchanged', () => {
    expect(narrowPatternsPin(1366, false)).toBe(526);
    expect(narrowPatternsPin(1194, false)).toBe(460);
    // 38.5 % under the floor -> the floor wins; a bound second playlist raises it.
    expect(narrowPatternsPin(1000, false)).toBe(400);
    expect(narrowPatternsPin(1000, true)).toBe(500);
    expect(narrowPatternsPin(1366, true)).toBe(526);
  });

  it('PATTERNS alone still FILLS — patternsFillsNarrow, unchanged', () => {
    expect(size(1, IPAD_12_9)).toEqual({ mode: 'fill' });
    expect(size(1, IPAD_11)).toEqual({ mode: 'fill' });
    expect(size(1, SHORT)).toEqual({ mode: 'fill' });
    // The predicate and the sizer must agree on the SAME condition — they are
    // read by the PATTERNS track and by ColumnsScrollRest respectively, and a
    // disagreement is a dead scroll region or a collapsed card.
    const sets: DeckWindowId[][] = [
      ['patterns'],
      ['patterns', 'colors'],
      ['patterns', 'parameters', 'autopilot'],
    ];
    for (const openSet of sets) {
      expect(size(openSet.length, IPAD_11).mode === 'fill').toBe(patternsFillsNarrow(openSet));
    }
  });

  it('the SHIPPED DEFAULT deck is byte-identical — PATTERNS gets exactly the pin', () => {
    // Default narrow deck = PATTERNS + PARAMETERS + AUTOPILOT, i.e. openCount 3.
    expect(size(3, IPAD_11)).toEqual({ mode: 'pinned', patternsHeight: 460, restHeight: 383 });
    expect(size(3, IPAD_12_9)).toEqual({ mode: 'pinned', patternsHeight: 526, restHeight: 489 });
  });

  it('EVERY composition with ANY secondary open returns the pin (_278 ruling)', () => {
    for (const vp of [IPAD_11, IPAD_12_9]) {
      const pin = narrowPatternsPin(vp.windowHeight, false);
      for (let openCount = 2; openCount <= DECK_WINDOW_IDS.length; openCount += 1) {
        expect(size(openCount, vp)).toEqual({
          mode: 'pinned',
          patternsHeight: pin,
          restHeight: vp.hostHeight - pin,
        });
      }
    }
  });

  it('_278 — reshowing ONE window from all-hidden lands the deck at its SHIPPED proportions', () => {
    // The operator's report, verbatim: "hide all panels, then reshow any of
    // them, and it overlays the patterns panel. the pattern panel is not
    // resizing maybe? from full screen or sth?" — `_274`'s per-occupant share
    // returned 623/220 (11") and 770/245 (12.9") here: PATTERNS at 75 % of
    // the stack reads as still-full-screen, and the restored window's strip
    // reads as a fragment pasted over its bottom. The region is a serial
    // scroll viewport — its default size is not divisible per occupant — so
    // ONE open secondary now gets the region's FULL default viewport, and the
    // reshown deck is byte-identical to the default deck's split.
    const s11 = size(2, IPAD_11);
    expect(s11).toEqual({ mode: 'pinned', patternsHeight: 460, restHeight: 383 });
    expect(s11).toEqual(size(3, IPAD_11));
    const s129 = size(2, IPAD_12_9);
    expect(s129).toEqual({ mode: 'pinned', patternsHeight: 526, restHeight: 489 });
    expect(s129).toEqual(size(3, IPAD_12_9));
    // Stated as the operator would: after a reshow, PATTERNS must be
    // unmistakably SMALLER than its all-hidden full-screen fill.
    if (s11.mode !== 'pinned' || s129.mode !== 'pinned') throw new Error('unreachable');
    expect(s11.patternsHeight).toBeLessThan(IPAD_11.hostHeight * 0.6);
    expect(s129.patternsHeight).toBeLessThan(IPAD_12_9.hostHeight * 0.6);
  });

  it('DEFECT 2 — a stack SHORTER than the pin: nothing overflows, the region is never zero', () => {
    // Pre-fix this returned a bare 400 into a 309 host: PATTERNS spilled under
    // the bottom bar and the reopened window got no box at all. A later 72 pt
    // floor remained only a header sliver on native. The constrained host now
    // resolves to a genuine near-even split, with neither panel overlaying.
    for (const openCount of [2, 3, 4, 5]) {
      const s = size(openCount, SHORT);
      if (s.mode !== 'pinned') throw new Error('unreachable');
      expect(s).toEqual({ mode: 'pinned', patternsHeight: 155, restHeight: 154 });
      expect(s.patternsHeight + (s.restHeight ?? 0)).toBe(SHORT.hostHeight);
      // PATTERNS is the deck's reason to exist — it keeps at least its share.
      expect(s.patternsHeight).toBeGreaterThanOrEqual(Math.round(SHORT.hostHeight * NARROW_PATTERNS_MIN_SHARE));
    }
  });

  it('the HARD region floor makes a restored panel usable, not merely non-zero', () => {
    // A stack that seats the pin with only 49 pt to spare now gives the lower
    // panel a real 220 pt viewport. This is the native portrait case that the
    // old 72 pt header sliver falsely classified as fixed.
    const TIGHT = { windowHeight: 760, hostHeight: 449 };   // pin 400
    expect(size(3, TIGHT)).toEqual({ mode: 'pinned', patternsHeight: 229, restHeight: 220 });
    expect(size(2, TIGHT)).toEqual({ mode: 'pinned', patternsHeight: 229, restHeight: 220 });
    // 229 = host - NARROW_REST_ABS_MIN_HEIGHT: the hard floor is the only
    // thing that moved PATTERNS off its 400 pt pin here.
    expect(229).toBe(TIGHT.hostHeight - NARROW_REST_ABS_MIN_HEIGHT);
  });

  it('an UNMEASURED host (first frame) returns the bare pin — no guess, no jump', () => {
    expect(size(2, { windowHeight: 1194, hostHeight: null }))
      .toEqual({ mode: 'pinned', patternsHeight: 460, restHeight: null });
    // Degenerate measurements are treated as unmeasured, not as a 0 px stack.
    expect(size(2, { windowHeight: 1194, hostHeight: 0 }))
      .toEqual({ mode: 'pinned', patternsHeight: 460, restHeight: null });
    expect(size(2, { windowHeight: 1194, hostHeight: Number.NaN }))
      .toEqual({ mode: 'pinned', patternsHeight: 460, restHeight: null });
  });

  it('a bound second playlist raises the pin exactly as before', () => {
    // openCount 3 = the default deck: the pin is returned verbatim, 500 floor
    // included (38.5 % of 1194 = 460 < 500).
    expect(size(3, IPAD_11, true)).toEqual({ mode: 'pinned', patternsHeight: 500, restHeight: 343 });
  });

  it('INVARIANTS over every reachable narrow composition x a sweep of stacks', () => {
    const stacks = [200, 260, 309, 400, 500, 620, 843, 1015, 1200, 1600];
    const windows = [620, 760, 960, 1024, 1194, 1366];
    for (const windowHeight of windows) {
      for (const hostHeight of stacks) {
        for (let openCount = 1; openCount <= DECK_WINDOW_IDS.length; openCount += 1) {
          for (const secondaryBound of [false, true]) {
            const s = narrowStackSizing({ openCount, windowHeight, hostHeight, secondaryBound });
            if (openCount === 1) {
              expect(s).toEqual({ mode: 'fill' });
              continue;
            }
            if (s.mode !== 'pinned') throw new Error('unreachable');
            const rest = s.restHeight ?? 0;
            // 1. The split ALWAYS fits the stack exactly — no overflow, ever.
            expect(s.patternsHeight + rest).toBe(hostHeight);
            expect(s.patternsHeight).toBeGreaterThanOrEqual(0);
            // 2. A restored window ALWAYS gets a box: the floor, or — on a
            //    stack too short for both floors — whatever PATTERNS' own
            //    share leaves, which is still strictly positive.
            expect(rest).toBeGreaterThanOrEqual(
              Math.min(
                NARROW_REST_ABS_MIN_HEIGHT,
                hostHeight - Math.round(hostHeight * NARROW_PATTERNS_MIN_SHARE),
              ),
            );
            expect(rest).toBeGreaterThan(0);
            // 3. PATTERNS never falls below its share of the stack.
            expect(s.patternsHeight).toBeGreaterThanOrEqual(Math.round(hostHeight * NARROW_PATTERNS_MIN_SHARE));
            // 4. Whenever the stack can seat the pin between the two floors,
            //    PATTERNS is EXACTLY the pin — for every occupant count
            //    (_278: the region's default viewport is not divisible per
            //    occupant, so one open secondary splits like two or four).
            const pin = narrowPatternsPin(windowHeight, secondaryBound);
            if (pin <= hostHeight - NARROW_REST_ABS_MIN_HEIGHT
                && pin >= Math.round(hostHeight * NARROW_PATTERNS_MIN_SHARE)) {
              expect(s.patternsHeight).toBe(pin);
            }
          }
        }
      }
    }
  });

});
