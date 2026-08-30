import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  arrangedDesignAspect,
  compositeAspectFor,
  describeColourResolution,
  flattenView,
  panelAxisFor,
  parsePixelViewArtifact,
  type FlatPixelView,
  type PixelViewArtifact,
} from '@/components/deck/pixel_view_logic';
import {
  BAND_VIEW_STORAGE_KEY,
  CHANNEL_EDIT_CAP_HEIGHT,
  MASTER_EDIT_CAP_HEIGHT,
  MASTER_PERF_CAP_HEIGHT,
  MIN_BAND_CANVAS_HEIGHT,
  bandCanvasSizeForAspect,
  bandCapHeight,
  bandHonestySentence,
  bandRatioCaption,
  bandViewChipLabel,
  computeBandCanvasSize,
  getBandSession,
  hydrateBandSessions,
  normalizeBandSessions,
  resetBandSessions,
  resolveBandViewId,
  serializeBandSessions,
  setBandSessionPersistListener,
  setBandView,
  snapshotBandSessions,
  subscribeBandSession,
} from './pixel_view_band_logic';

const ARTIFACT = {
  schemaVersion: 4,
  design: { width: 100, height: 40, panelGap: 8 },
  modelPixelCount: 964,
  views: [
    { id: 'top_down', label: 'Top Down', panels: [] },
    { id: 'front', label: 'Front', panels: [] },
    { id: 'te_sign', label: 'TE Sign', panels: [] },
  ],
} as unknown as PixelViewArtifact;

const SIGN_FIRST = {
  ...ARTIFACT,
  views: [ARTIFACT.views[2], ARTIFACT.views[0]],
} as PixelViewArtifact;

describe('band geometry', () => {
  // docs/64 §8 W5: `bandCanvasHeight` and its fixed-height constants
  // (CHANNEL_BAND_CANVAS_HEIGHT / MASTER_BAND_CANVAS_HEIGHT /
  // PERF_MASTER_BAND_CANVAS_HEIGHT) are retired — the aspect-honest
  // `bandCapHeight`/`computeBandCanvasSize` pair (exercised below) replaced
  // them. Their own coverage moved to the `bandCapHeight` describe block.
  it("grows the master band's cap in performance mode too", () => {
    expect(MASTER_PERF_CAP_HEIGHT).toBeGreaterThan(MASTER_EDIT_CAP_HEIGHT);
  });
});

describe('captions', () => {
  it('prints the capped ratio as arithmetic', () => {
    expect(bandRatioCaption(100, 964)).toBe('100/964');
    expect(bandRatioCaption(240, 964)).toBe('240/964');
  });

  it('says FULL out loud when the cap has stopped binding', () => {
    expect(bandRatioCaption(964, 964)).toBe('964/964 FULL');
    // A rig UNDER the cap transmits verbatim — still full, still stated.
    expect(bandRatioCaption(2000, 964)).toBe('964/964 FULL');
  });

  it('refuses to invent a ratio from nonsense counts', () => {
    expect(() => bandRatioCaption(0, 964)).toThrow(/positive counts/);
    expect(() => bandRatioCaption(100, 0)).toThrow(/positive counts/);
  });

  it('keeps the picker footer identical to the deck window sentence', () => {
    expect(bandHonestySentence(720, 100, 964)).toBe(describeColourResolution(720, 100, 964));
    expect(bandHonestySentence(720, 100, 964)).toBe('720 PX · 100/964 COLOUR SAMPLES');
    expect(bandHonestySentence(720, 964, 964)).toContain('FULL RATE');
  });

  it('renders the view chip as the mixer dropdown idiom', () => {
    expect(bandViewChipLabel('Top Down')).toBe('TOP-DOWN ▾');
    expect(bandViewChipLabel('te_sign')).toBe('TE-SIGN ▾');
    expect(bandViewChipLabel('  ')).toBe('VIEW ▾');
  });
});

describe('session store', () => {
  beforeEach(() => resetBandSessions());

  it('starts every band open, on no explicit view', () => {
    expect(getBandSession('ch_1')).toEqual({ viewId: null });
  });

  it('keeps view per vis key, independently', () => {
    setBandView('ch_1', 'front');

    expect(getBandSession('ch_1')).toEqual({ viewId: 'front' });
    expect(getBandSession('ch_2')).toEqual({ viewId: null });
  });

  it('hands out copies, so a caller cannot mutate the store by accident', () => {
    setBandView('ch_1', 'front');
    const got = getBandSession('ch_1');
    got.viewId = 'te_sign';
    expect(getBandSession('ch_1').viewId).toBe('front');
  });

  it('snapshots byte-identically for an unchanged store (the perf round-trip proof)', () => {
    setBandView('ch_1', 'front');
    setBandView('ch_2', 'te_sign');
    const before = snapshotBandSessions();

    // Everything performance mode does is a RENDER-time derivation: it reads
    // the store and writes nothing. Simulate a full enter/exit by reading.
    getBandSession('ch_1');
    getBandSession('ch_2');
    getBandSession('preDimmer');

    expect(snapshotBandSessions()).toBe(before);
  });

  it('orders the snapshot by key so it is comparable across sessions', () => {
    setBandView('zz', 'front');
    setBandView('aa', 'top_down');
    expect(snapshotBandSessions().indexOf('aa')).toBeLessThan(snapshotBandSessions().indexOf('zz'));
  });
});

// ── Persistence seam (docs/64 §7 D7) ────────────────────────────────────────
// `pixel_view_band_logic.ts` never touches AsyncStorage itself — these tests
// pin the seam `pixel_view_band_store.ts` drives: what gets serialized, what
// a stored blob normalizes to, when the persist listener fires (and, just as
// importantly, when it must NOT), and the round trip a reload performs.

describe('BAND_VIEW_STORAGE_KEY', () => {
  it('is a versioned key, the house convention', () => {
    expect(BAND_VIEW_STORAGE_KEY).toBe('mixer_band_views_v1');
  });
});

describe('serializeBandSessions', () => {
  beforeEach(() => resetBandSessions());

  it('only writes keys with an explicit choice — null is the default, nothing to store', () => {
    setBandView('ch_1', 'front');
    getBandSession('ch_2'); // a read of a never-chosen key must not appear
    expect(serializeBandSessions()).toEqual({ ch_1: 'front' });
  });

  it('is empty for an untouched store', () => {
    expect(serializeBandSessions()).toEqual({});
  });
});

describe('normalizeBandSessions', () => {
  it('passes through a well-shaped blob verbatim', () => {
    expect(normalizeBandSessions({ ch_1: 'front', preDimmer: 'top_down' }))
      .toEqual({ ch_1: 'front', preDimmer: 'top_down' });
  });

  it('never throws on garbage — drops what it cannot use (codex P0: fail loud, but not by crashing over a UI cookie)', () => {
    expect(normalizeBandSessions(null)).toEqual({});
    expect(normalizeBandSessions(undefined)).toEqual({});
    expect(normalizeBandSessions('not an object')).toEqual({});
    expect(normalizeBandSessions(42)).toEqual({});
    expect(normalizeBandSessions(['ch_1', 'front'])).toEqual({});
    expect(normalizeBandSessions({ ch_1: 'front', ch_2: 42, ch_3: null, '': 'front' }))
      .toEqual({ ch_1: 'front' });
  });
});

describe('hydrateBandSessions', () => {
  beforeEach(() => resetBandSessions());

  it('applies a stored blob into the store, once', () => {
    hydrateBandSessions({ ch_1: 'front', preDimmer: 'top_down' });
    expect(getBandSession('ch_1')).toEqual({ viewId: 'front' });
    expect(getBandSession('preDimmer')).toEqual({ viewId: 'top_down' });
  });

  it('never calls the persist listener — hydrate reads, it never writes', () => {
    let calls = 0;
    setBandSessionPersistListener(() => { calls += 1; });
    hydrateBandSessions({ ch_1: 'front' });
    expect(calls).toBe(0);
  });

  it('never overwrites a key a live operator gesture already touched — the gesture wins over a slow hydrate', () => {
    setBandView('ch_1', 'te_sign'); // the operator's live pick, before hydrate lands
    hydrateBandSessions({ ch_1: 'front' }); // the (now stale) stored preference
    expect(getBandSession('ch_1')).toEqual({ viewId: 'te_sign' });
  });

  it('a stale/unknown persisted view id still falls back to the artifact default via resolveBandViewId — unweakened', () => {
    hydrateBandSessions({ ch_1: 'starboard_1998' });
    expect(resolveBandViewId(ARTIFACT, getBandSession('ch_1').viewId)).toBe('top_down');
  });
});

describe('setBandSessionPersistListener', () => {
  beforeEach(() => resetBandSessions());

  it('fires on a real write', () => {
    let calls = 0;
    setBandSessionPersistListener(() => { calls += 1; });
    setBandView('ch_1', 'front');
    expect(calls).toBe(1);
  });

  it('does not fire on a no-op write (re-picking the already-active view)', () => {
    setBandView('ch_1', 'front');
    let calls = 0;
    setBandSessionPersistListener(() => { calls += 1; });
    setBandView('ch_1', 'front');
    expect(calls).toBe(0);
  });

  it('does not fire on a plain read', () => {
    setBandView('ch_1', 'front');
    let calls = 0;
    setBandSessionPersistListener(() => { calls += 1; });
    getBandSession('ch_1');
    snapshotBandSessions();
    expect(calls).toBe(0);
  });

  it("perf enter/exit — reading every band's session — writes nothing (the round-trip proof, at the persistence layer too)", () => {
    setBandView('ch_1', 'front');
    setBandView('ch_2', 'te_sign');
    let calls = 0;
    setBandSessionPersistListener(() => { calls += 1; });
    const before = snapshotBandSessions();

    // Simulate a full perf enter/exit: every band reads its session, none writes.
    getBandSession('ch_1');
    getBandSession('ch_2');
    getBandSession('preDimmer');

    expect(snapshotBandSessions()).toBe(before);
    expect(calls).toBe(0);
  });
});

describe('subscribeBandSession', () => {
  beforeEach(() => resetBandSessions());

  it('notifies subscribers of this key only, on a real write', () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeBandSession('ch_1', (v) => seen.push(v));
    setBandView('ch_1', 'front');
    setBandView('ch_2', 'te_sign'); // a different key — must not notify ch_1's subscriber
    expect(seen).toEqual(['front']);
    unsubscribe();
    setBandView('ch_1', 'te_sign');
    expect(seen).toEqual(['front']); // unsubscribed — no further notifications
  });

  it('notifies subscribers when a hydrate applies to their key (the reload re-sync case)', () => {
    const seen: (string | null)[] = [];
    subscribeBandSession('ch_1', (v) => seen.push(v));
    hydrateBandSessions({ ch_1: 'front' });
    expect(seen).toEqual(['front']);
  });

  it('does not notify when hydrate skips a touched key', () => {
    setBandView('ch_1', 'te_sign');
    const seen: (string | null)[] = [];
    subscribeBandSession('ch_1', (v) => seen.push(v));
    hydrateBandSessions({ ch_1: 'front' });
    expect(seen).toEqual([]);
  });
});

describe('the full reload round trip (serialize → normalize → hydrate)', () => {
  beforeEach(() => resetBandSessions());

  it('a picked view survives a simulated reload', () => {
    setBandView('ch_1', 'te_sign');
    const stored = JSON.parse(JSON.stringify(serializeBandSessions())); // simulate the AsyncStorage JSON round trip
    resetBandSessions(); // simulate the app restarting — the module map is fresh
    hydrateBandSessions(normalizeBandSessions(stored));
    expect(getBandSession('ch_1')).toEqual({ viewId: 'te_sign' });
  });

  it("a second band's choice is independent across the same round trip", () => {
    setBandView('ch_1', 'te_sign');
    setBandView('ch_2', 'front');
    const stored = JSON.parse(JSON.stringify(serializeBandSessions()));
    resetBandSessions();
    hydrateBandSessions(normalizeBandSessions(stored));
    expect(getBandSession('ch_1')).toEqual({ viewId: 'te_sign' });
    expect(getBandSession('ch_2')).toEqual({ viewId: 'front' });
  });
});

describe('resolveBandViewId', () => {
  beforeEach(() => resetBandSessions());

  it('opens on the operator top-down by default', () => {
    expect(resolveBandViewId(ARTIFACT, null)).toBe('top_down');
    // Even when he re-ordered his views and top_down is not first.
    expect(resolveBandViewId(SIGN_FIRST, null)).toBe('top_down');
  });

  it('honours the session choice', () => {
    expect(resolveBandViewId(ARTIFACT, 'te_sign')).toBe('te_sign');
  });

  it('falls to the default when the artifact no longer has that view', () => {
    // A re-export that dropped a view must not leave a band pointed at a
    // pointer into nothing.
    expect(resolveBandViewId(ARTIFACT, 'starboard_1998')).toBe('top_down');
  });
});

// ── §3.2 aspect-honest geometry (docs/64 M1 — the black-void kill) ─────────
// Off the REAL checked-in artifact, exactly as `pixel_view_logic.test.ts`
// loads it: this is what decides whether the fix holds on the actual ship,
// not on a hand-rolled fixture that could quietly drift from what the sim
// exports.

const REAL_ARTIFACT_PATH = path.resolve(
  __dirname, '..', '..', 'live_touch', 'touch_control_pixel_views.json',
);

const REAL_PARSED = parsePixelViewArtifact(JSON.parse(fs.readFileSync(REAL_ARTIFACT_PATH, 'utf8')));
const REAL_DESIGN = REAL_PARSED.design;

function realFlat(viewId: string): FlatPixelView {
  const view = REAL_PARSED.views.find((v) => v.id === viewId);
  if (!view) throw new Error(`fixture: view '${viewId}' not in the checked-in artifact`);
  return flattenView(view);
}

describe('arrangedDesignAspect — the §3.2 aspect, off the real artifact', () => {
  it('collapses a single-panel view (TOP DOWN) to its own box aspect on either axis', () => {
    const topDown = realFlat('top_down');
    const columns = arrangedDesignAspect(topDown, 'columns');
    const rows = arrangedDesignAspect(topDown, 'rows');
    // The normalized scene's leveled, condensed rig (halves side by side
    // with the flank stacks) is much wider than deep — ~4.62:1 measured off
    // the real artifact.
    expect(columns).toBeCloseTo(4.6156, 2);
    expect(rows).toBe(columns);
  });

  it('FRONT side by side (columns) — the TRUE fixed point, not the sum of independent panel aspects', () => {
    // A per-panel-independent sum (1.52 + 1.19 ≈ 2.71, docs/64's own
    // illustrative "≈ 2.7") is WRONG: `arrangePanels` positions both panels
    // relative to the view's COMMON box (`flat.bounds`), which is taller
    // than either panel alone (they sit at different heights within it), so
    // an independent-sum formula undercounts the composite. The real,
    // gap-free fixed point (bisected against `arrangePanels` itself) is
    // ≈3.06 — noticeably higher, i.e. a WIDER true composite than the old
    // formula gave, which is why the old formula under-sized the canvas and
    // left a residual letterbox void on this exact view.
    expect(arrangedDesignAspect(realFlat('front'), 'columns')).toBeCloseTo(3.7593, 3);
  });

  it('FRONT stacked (rows) — the same true-fixed-point correction', () => {
    expect(arrangedDesignAspect(realFlat('front'), 'rows')).toBeCloseTo(0.9758, 3);
  });

  it('pins TE SIGN both ways off the real fixed point', () => {
    const teSign = realFlat('te_sign');
    expect(arrangedDesignAspect(teSign, 'columns')).toBeCloseTo(1.6945, 3);
    expect(arrangedDesignAspect(teSign, 'rows')).toBeCloseTo(0.4245, 3);
  });

  it('is a genuine fixed point: compositeAspectFor, probed at (aspect, 1), reproduces the same aspect (gap-free)', () => {
    // The definition, checked directly rather than trusting the bisection's
    // own internals: feeding the returned aspect back in as a viewport
    // shape and re-measuring the composite must reproduce it.
    for (const axis of ['columns', 'rows'] as const) {
      const flat = realFlat('front');
      const aspect = arrangedDesignAspect(flat, axis);
      const gapFreeDesign = { ...REAL_DESIGN, panelGap: 0 };
      const probeW = axis === 'columns' ? aspect * 1e6 : 1e6;
      const probeH = axis === 'columns' ? 1e6 : aspect * 1e6;
      const measured = compositeAspectFor(flat, gapFreeDesign, probeW, probeH, axis);
      expect(measured).toBeCloseTo(aspect, 3);
    }
  });
});

describe('bandCanvasSizeForAspect — the §3.2 clamp formula in isolation', () => {
  it('is full-bleed — no clamp at all — when the natural height already fits the box', () => {
    // aspect 1.9, slot 300: natural height ≈157.9, inside [72, 176].
    const { width, height } = bandCanvasSizeForAspect(1.9, 300, 176);
    expect(width).toBeCloseTo(300, 5);
    expect(height).toBeCloseTo(300 / 1.9, 5);
  });

  it('hits the CEILING clamp on a wide slot — height pins to the cap, width backs off', () => {
    const { width, height } = bandCanvasSizeForAspect(1.9, 1220, 176);
    expect(height).toBe(176);
    expect(width).toBeCloseTo(176 * 1.9, 5);
    expect(width).toBeLessThan(1220);
  });

  it('hits the FLOOR clamp when the aspect is wide enough that the natural height undershoots MIN_BAND_CANVAS_HEIGHT', () => {
    // aspect 6 (a hypothetically very wide strip — wider than any shipped
    // view), slot 300: natural height 50, under the 72 px floor.
    const { width, height } = bandCanvasSizeForAspect(6, 300, 176);
    expect(height).toBe(MIN_BAND_CANVAS_HEIGHT);
    expect(width).toBeCloseTo(300, 5); // 6 * 72 = 432 > 300, so width stays the slot
  });

  it('refuses non-positive inputs — codex P0, no silent zero-size canvas', () => {
    expect(() => bandCanvasSizeForAspect(0, 300, 176)).toThrow(/aspect must be positive/);
    expect(() => bandCanvasSizeForAspect(1.9, 0, 176)).toThrow(/slotWidth must be positive/);
    expect(() => bandCanvasSizeForAspect(1.9, 300, 0)).toThrow(/capHeight must be positive/);
  });
});

describe('computeBandCanvasSize — docs/64 §8 W2 acceptance matrix (real artifact, slots 300/620/1220)', () => {
  const widths = [300, 620, 1220];

  it('top-down (single-panel, ≈4.62:1): floor-pinned at 300, natural at 620, ceiling-capped at 1220', () => {
    const flat = realFlat('top_down');
    const [w300, w620, w1220] = widths.map((w) => computeBandCanvasSize(flat, REAL_DESIGN, w, CHANNEL_EDIT_CAP_HEIGHT));
    // the normalized rig's wide aspect wants a 65 px band at 300 — the
    // MIN_BAND_CANVAS_HEIGHT floor holds it at 72 (bound-pinned box)
    expect(w300.width).toBeCloseTo(300, 1);
    expect(w300.height).toBe(MIN_BAND_CANVAS_HEIGHT);
    expect(w620.width).toBeCloseTo(620, 1);
    expect(w620.height).toBeCloseTo(134.33, 1);
    expect(w1220.height).toBe(CHANNEL_EDIT_CAP_HEIGHT);
    expect(w1220.width).toBeCloseTo(812.34, 1);
  });

  it('front (multi-panel, ≈3.76:1 side by side): STACKS at a narrow slot, columns from 620 up', () => {
    const flat = realFlat('front');
    const [w300, w620] = widths.map((w) => computeBandCanvasSize(flat, REAL_DESIGN, w, CHANNEL_EDIT_CAP_HEIGHT));
    // the normalized composite is so wide that stacking wins the lit-area
    // race at a 300 px slot ("measured, never named")
    expect(w300.axis).toBe('rows');
    expect(w300.width).toBeCloseTo(164.16, 1);
    expect(w300.height).toBe(CHANNEL_EDIT_CAP_HEIGHT);
    expect(w620.axis).toBe('columns');
    expect(w620.width).toBeCloseTo(620, 1);
    expect(w620.height).toBeCloseTo(163.32, 1);
  });

  it('te_sign (multi-panel, ≈1.69:1 true aspect): slot-bound at 300, ceiling-capped from 620 up', () => {
    const flat = realFlat('te_sign');
    const [w300, w620, w1220] = widths.map((w) => computeBandCanvasSize(flat, REAL_DESIGN, w, CHANNEL_EDIT_CAP_HEIGHT));
    expect(w300.width).toBeCloseTo(300, 1);
    expect(w300.height).toBeCloseTo(172.89, 1);
    for (const size of [w620, w1220]) {
      expect(size.height).toBe(CHANNEL_EDIT_CAP_HEIGHT);
      expect(size.width).toBeCloseTo(305.32, 1);
    }
  });

  it('never exceeds the slot width or the cap, and never undershoots the floor — every shipped view, every cap, every width', () => {
    for (const id of ['top_down', 'front', 'te_sign', 'strands']) {
      const flat = realFlat(id);
      for (const cap of [CHANNEL_EDIT_CAP_HEIGHT, MASTER_EDIT_CAP_HEIGHT, MASTER_PERF_CAP_HEIGHT]) {
        for (const w of widths) {
          const size = computeBandCanvasSize(flat, REAL_DESIGN, w, cap);
          expect(size.width).toBeLessThanOrEqual(w + 1e-6);
          expect(size.height).toBeGreaterThanOrEqual(MIN_BAND_CANVAS_HEIGHT - 1e-6);
          expect(size.height).toBeLessThanOrEqual(cap + 1e-6);
          // The M1 accept: this IS the picture, so it never paints a
          // zero-area canvas for a view the artifact actually resolved.
          expect(size.width).toBeGreaterThan(0);
          expect(size.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it('leaves ZERO measurable void — the real arrangement, run into the chosen canvas, fills it within 1% on every axis', () => {
    // The actual W7 gate, checked directly rather than trusting the
    // sizing math to have been transcribed correctly: take the box
    // `computeBandCanvasSize` picked, run the REAL `arrangePanels` (via
    // `compositeAspectFor`) into that EXACT box with the REAL panelGap, and
    // assert the resulting composite's own aspect matches the box's aspect
    // to within 1% on both dimensions — i.e. there is no letterbox bar left
    // to paint, on the real, gap-carrying geometry, not an idealization of it.
    let worstPct = 0;
    for (const id of ['top_down', 'front', 'te_sign', 'strands']) {
      const flat = realFlat(id);
      for (const cap of [CHANNEL_EDIT_CAP_HEIGHT, MASTER_EDIT_CAP_HEIGHT, MASTER_PERF_CAP_HEIGHT]) {
        for (const w of widths) {
          const size = computeBandCanvasSize(flat, REAL_DESIGN, w, cap);
          const boxAspect = size.width / size.height;
          const realAspect = compositeAspectFor(flat, REAL_DESIGN, size.width, size.height, size.axis);
          const pct = 100 * Math.abs(realAspect - boxAspect) / boxAspect;
          // A bound-pinned box is exempt: when the view's composite wants a
          // shallower band than MIN_BAND_CANVAS_HEIGHT permits (the
          // normalized top_down at a 300 px slot), the residual letterbox is
          // the floor's doing — declared geometry, not a sizing error.
          const floorPinned = size.height === MIN_BAND_CANVAS_HEIGHT && realAspect > boxAspect;
          if (floorPinned) continue;
          worstPct = Math.max(worstPct, pct);
          expect(pct, `${id} @ w=${w} cap=${cap}: ${pct.toFixed(3)}% void — box ${size.width.toFixed(1)}×${size.height.toFixed(1)}`)
            .toBeLessThan(1);
        }
      }
    }
    expect(worstPct).toBeLessThan(1);
  });
});

describe('computeBandCanvasSize — the axis loop closes (docs/64 §3.2\'s own circularity warning)', () => {
  it('panelAxisFor, run against the EXACT chosen canvas, always agrees with the axis computeBandCanvasSize picked', () => {
    const widths = [300, 620, 1220];
    const caps = [CHANNEL_EDIT_CAP_HEIGHT, MASTER_EDIT_CAP_HEIGHT, MASTER_PERF_CAP_HEIGHT];
    let checked = 0;
    for (const view of REAL_PARSED.views) {
      const flat = flattenView(view);
      for (const cap of caps) {
        for (const w of widths) {
          const chosen = computeBandCanvasSize(flat, REAL_DESIGN, w, cap);
          const realAxis = panelAxisFor(flat, REAL_DESIGN, chosen.width, chosen.height);
          expect(
            realAxis,
            `${view.id} @ slotWidth=${w} cap=${cap}: sizing chose '${chosen.axis}' but the real ` +
            `paint-time layout wants '${realAxis}' for a ${chosen.width.toFixed(1)}×${chosen.height.toFixed(1)} canvas`,
          ).toBe(chosen.axis);
          checked += 1;
        }
      }
    }
    // Every shipped view × every cap token × every acceptance width — not a
    // sample of the matrix, the whole thing.
    expect(checked).toBe(REAL_PARSED.views.length * caps.length * widths.length);
  });
});

describe('bandCapHeight', () => {
  it('gives master its edit/perf tokens', () => {
    expect(bandCapHeight('master', false)).toBe(MASTER_EDIT_CAP_HEIGHT);
    expect(bandCapHeight('master', true)).toBe(MASTER_PERF_CAP_HEIGHT);
  });

  it('gives an edit-mode channel its token', () => {
    expect(bandCapHeight('channel', false)).toBe(CHANNEL_EDIT_CAP_HEIGHT);
  });

  it('hands a perf-mode channel band back its OWN supplied column height — there is no fixed token for this case', () => {
    expect(bandCapHeight('channel', true, 245)).toBe(245);
  });

  it('refuses a perf-mode channel band with no column height to fill — nothing honest to size to', () => {
    expect(() => bandCapHeight('channel', true)).toThrow(/real measured height/);
    expect(() => bandCapHeight('channel', true, 0)).toThrow(/real measured height/);
    expect(() => bandCapHeight('channel', true, -5)).toThrow(/real measured height/);
  });
});
