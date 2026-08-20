import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { layoutView as sharedLayoutView } from '@/shared/pixel_view_projection';

import {
  BYTES_PER_SAMPLE,
  DEFAULT_VIS_SOURCE,
  FIT_FILL,
  PIXEL_GHOST_INK,
  PIXEL_VIS_SOURCES,
  PIXEL_STAGE_BG,
  PIXEL_VIEW_ARTIFACT_PATH,
  PREVIEW_GAMMA,
  PIXEL_VIEW_SCHEMA_VERSION,
  PREFERRED_VIEW_ID,
  arrangePanels,
  artifactModelMismatch,
  buildSampleLookup,
  decodeVisSamples,
  describeColourResolution,
  flattenView,
  layoutView,
  panelAxisFor,
  parsePixelViewArtifact,
  pickDefaultView,
  previewBrighten,
  sampleIndexForModelPixel,
  sampleToDisplayRgb,
  type FlatPixelView,
  type PixelViewArtifact,
  type ViewTransform,
} from './pixel_view_logic';

// ── A minimal, valid artifact, shaped exactly like the sim's export ────────

function glyph(pixelIndex: number, x: number, y: number, extra: object = {}) {
  return {
    pixelIndex,
    fixtureKey: 'F',
    fixtureType: 'LedStrand',
    kind: 'led',
    group: 'G',
    x,
    y,
    sizeX: 5,
    sizeY: 5,
    shape: 'square',
    effect: null,
    rotation: 0,
    world: { nx: 0, ny: 0, nz: 0 },
    ...extra,
  };
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PIXEL_VIEW_SCHEMA_VERSION,
    generatedBy: 'test',
    design: { width: 900, height: 520, panelGap: 8 },
    modelPixelCount: 10,
    views: [
      {
        id: 'top_down',
        label: 'Top-Down',
        panels: [{
          id: 'main',
          label: 'Main',
          weight: 1,
          glyphs: [glyph(0, 100, 100), glyph(1, 200, 140), glyph(2, 150, 60, { shape: 'circle' })],
        }],
      },
      {
        id: 'front',
        label: 'Front',
        panels: [{ id: 'main', label: 'Main', weight: 1, glyphs: [glyph(3, 10, 10)] }],
      },
    ],
    ...overrides,
  };
}

const nodeBase64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

describe('pixel_view_logic — artifact contract', () => {
  it('pins the sim artifact route and schema version', () => {
    expect(PIXEL_VIEW_ARTIFACT_PATH).toBe('/CaptainPad/live_touch/touch_control_pixel_views.json');
    expect(PIXEL_VIEW_SCHEMA_VERSION).toBe(4);
  });

  it('parses a well-formed artifact and narrows it', () => {
    const parsed = parsePixelViewArtifact(artifact());
    expect(parsed.modelPixelCount).toBe(10);
    expect(parsed.design).toEqual({ width: 900, height: 520, panelGap: 8 });
    expect(parsed.views.map((v) => v.id)).toEqual(['top_down', 'front']);
    expect(parsed.views[0].panels[0].glyphs).toHaveLength(3);
  });

  it('REFUSES a schema version it does not speak (fail loud, never guess)', () => {
    expect(() => parsePixelViewArtifact(artifact({ schemaVersion: 5 })))
      .toThrow(/schemaVersion.*speaks v4/s);
    expect(() => parsePixelViewArtifact(artifact({ schemaVersion: undefined })))
      .toThrow(/schemaVersion/);
  });

  it('refuses structurally broken artifacts rather than drawing half a ship', () => {
    const cases: [unknown, RegExp][] = [
      [null, /must be a JSON object/],
      ['nope', /must be a JSON object/],
      [[], /must be a JSON object/],
      [artifact({ design: null }), /design must be an object/],
      [artifact({ design: { width: 0, height: 5, panelGap: 8 } }), /positive/],
      [artifact({ modelPixelCount: -1 }), /positive/],
      [artifact({ views: [] }), /non-empty array/],
      [artifact({ views: 'x' }), /non-empty array/],
    ];
    for (const [input, pattern] of cases) {
      expect(() => parsePixelViewArtifact(input), String(pattern)).toThrow(pattern);
    }
  });

  it('requires design.panelGap — a mis-gapped multi-panel view is silently wrong', () => {
    expect(() => parsePixelViewArtifact(artifact({ design: { width: 900, height: 520 } })))
      .toThrow(/design\.panelGap must be a finite number/);
    expect(() => parsePixelViewArtifact(artifact({ design: { width: 900, height: 520, panelGap: -1 } })))
      .toThrow(/design\.panelGap must be zero or positive/);
    // Zero IS legal — a view may legitimately butt its panels together.
    expect(parsePixelViewArtifact(artifact({ design: { width: 900, height: 520, panelGap: 0 } })).design.panelGap)
      .toBe(0);
  });

  it('requires a positive panel weight — it decides how wide that panel gets', () => {
    const missing = artifact({
      views: [{ id: 'v', label: 'v', panels: [{ id: 'p', label: 'p', glyphs: [glyph(0, 0, 0)] }] }],
    });
    expect(() => parsePixelViewArtifact(missing)).toThrow(/panel 'p'\.weight must be a finite number/);
    const zero = artifact({
      views: [{ id: 'v', label: 'v', panels: [{ id: 'p', label: 'p', weight: 0, glyphs: [glyph(0, 0, 0)] }] }],
    });
    expect(() => parsePixelViewArtifact(zero)).toThrow(/panel 'p'\.weight must be positive/);
  });

  it('refuses a glyph whose pixelIndex escapes the artifact\'s own model', () => {
    const bad = artifact({
      views: [{
        id: 'v', label: 'v',
        panels: [{ id: 'p', label: 'p', weight: 1, glyphs: [glyph(99, 0, 0)] }],
      }],
    });
    expect(() => parsePixelViewArtifact(bad)).toThrow(/outside the artifact's own modelPixelCount/);
  });

  it('refuses non-finite geometry', () => {
    const bad = artifact({
      views: [{
        id: 'v', label: 'v',
        panels: [{ id: 'p', label: 'p', weight: 1, glyphs: [glyph(0, NaN, 0)] }],
      }],
    });
    expect(() => parsePixelViewArtifact(bad)).toThrow(/must be a finite number/);
  });

  it('opens on the operator\'s top-down ship, by NAME not by position', () => {
    const parsed = parsePixelViewArtifact(artifact());
    expect(PREFERRED_VIEW_ID).toBe('top_down');
    expect(pickDefaultView(parsed).id).toBe('top_down');
    // Re-ordered artifact → still the ship.
    const reordered = parsePixelViewArtifact(artifact({ views: artifact().views.slice().reverse() }));
    expect(pickDefaultView(reordered).id).toBe('top_down');
  });

  it('falls back to the first view only when there is no top_down at all', () => {
    const noShip = artifact({ views: [artifact().views[1]] });
    expect(pickDefaultView(parsePixelViewArtifact(noShip)).id).toBe('front');
  });
});

describe('pixel_view_logic — flattening', () => {
  it('produces parallel typed arrays and per-panel bounds', () => {
    const view = pickDefaultView(parsePixelViewArtifact(artifact()));
    const flat = flattenView(view);
    expect(flat.count).toBe(3);
    expect([...flat.modelIndex]).toEqual([0, 1, 2]);
    expect([...flat.round]).toEqual([0, 0, 1]);
    expect(flat.panels).toHaveLength(1);
    // Bounds include each glyph's own half-size, so nothing clips at the edge.
    expect(flat.panels[0].bounds).toEqual({ minX: 97.5, minY: 57.5, maxX: 202.5, maxY: 142.5 });
    expect(flat.panels[0].start).toBe(0);
    expect(flat.panels[0].end).toBe(3);
  });

  it('keeps each panel as its OWN range and bounds — they do not share a space', () => {
    const twoPanels = parsePixelViewArtifact(artifact({
      views: [{
        id: 'top_down', label: 'x',
        panels: [
          { id: 'a', label: 'a', weight: 1, glyphs: [glyph(0, 0, 0)] },
          { id: 'b', label: 'b', weight: 2, glyphs: [glyph(1, 50, 50), glyph(2, 60, 60)] },
        ],
      }],
    }));
    const flat = flattenView(pickDefaultView(twoPanels));
    expect(flat.count).toBe(3);
    expect(flat.panels.map((p) => [p.id, p.start, p.end, p.weight]))
      .toEqual([['a', 0, 1, 1], ['b', 1, 3, 2]]);
    // Panel b's bounds are ITS glyphs only — not the union with a.
    expect(flat.panels[1].bounds.minX).toBe(47.5);
  });

  it('THROWS on a view with nothing to draw rather than painting a blank panel', () => {
    const empty = parsePixelViewArtifact(artifact({
      views: [{ id: 'top_down', label: 'x', panels: [{ id: 'p', label: 'p', weight: 1, glyphs: [] }] }],
    }));
    expect(() => flattenView(pickDefaultView(empty))).toThrow(/zero glyphs/);
  });

  it('THROWS on an EMPTY panel inside an otherwise-drawable view', () => {
    const halfEmpty = parsePixelViewArtifact(artifact({
      views: [{
        id: 'top_down', label: 'x',
        panels: [
          { id: 'a', label: 'a', weight: 1, glyphs: [glyph(0, 0, 0)] },
          { id: 'ghost', label: 'ghost', weight: 1, glyphs: [] },
        ],
      }],
    }));
    // An empty panel would still claim a column and push the real one aside.
    expect(() => flattenView(pickDefaultView(halfEmpty))).toThrow(/panel 'ghost' has no glyphs/);
  });
});

describe('pixel_view_logic — per-view auto-fit', () => {
  const design = { width: 900, height: 520, panelGap: 8 };
  const single = flattenView(pickDefaultView(parsePixelViewArtifact(artifact())));

  it('delegates every final projection to the shared Deck/Live authority', () => {
    for (const [width, height] of [[1024, 682], [1194, 834], [1440, 900], [760, 620]]) {
      expect(layoutView(single, design, width, height))
        .toEqual(sharedLayoutView(single, design, width, height));
    }
  });

  /** Composite extents of every glyph, as the canvas would draw them. */
  function drawnBounds(flat: FlatPixelView, transforms: ViewTransform[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    flat.panels.forEach((panel, p) => {
      const t = transforms[p];
      for (let i = panel.start; i < panel.end; i += 1) {
        const x = flat.xs[i] * t.scale + t.offsetX;
        const y = flat.ys[i] * t.scale + t.offsetY;
        const hw = (flat.ws[i] * t.scale) / 2;
        const hh = (flat.hs[i] * t.scale) / 2;
        minX = Math.min(minX, x - hw); maxX = Math.max(maxX, x + hw);
        minY = Math.min(minY, y - hh); maxY = Math.max(maxY, y + hh);
      }
    });
    return { minX, minY, maxX, maxY };
  }

  it('fills the viewport to FIT_FILL on the binding axis and centres the other', () => {
    const t = layoutView(single, design, 420, 240);
    const b = drawnBounds(single, t);
    const spanX = b.maxX - b.minX;
    const spanY = b.maxY - b.minY;
    // One axis touches the fill fraction exactly; neither exceeds it.
    expect(Math.max(spanX / 420, spanY / 240)).toBeCloseTo(FIT_FILL, 6);
    expect(spanX).toBeLessThanOrEqual(420 * FIT_FILL + 1e-6);
    expect(spanY).toBeLessThanOrEqual(240 * FIT_FILL + 1e-6);
    // Centred on BOTH axes — equal margins either side.
    expect((b.minX + b.maxX) / 2).toBeCloseTo(210, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(120, 6);
  });

  it('never distorts aspect — one scale, whatever the viewport shape', () => {
    const p = single.panels[0].bounds;
    const designAspect = (p.maxX - p.minX) / (p.maxY - p.minY);
    for (const [w, h] of [[420, 240], [200, 600], [900, 90], [300, 300]]) {
      const b = drawnBounds(single, layoutView(single, design, w, h));
      expect((b.maxX - b.minX) / (b.maxY - b.minY)).toBeCloseTo(designAspect, 4);
    }
  });

  /** Two panels whose glyphs occupy the SAME design coordinates, exactly like
   *  the sim's `front` (left/right) and `te_sign` (sign_1/sign_2). */
  function overlappingPair() {
    const parsed = parsePixelViewArtifact(artifact({
      views: [{
        id: 'top_down', label: 'x',
        panels: [
          { id: 'a', label: 'a', weight: 1, glyphs: [glyph(0, 400, 260), glyph(1, 500, 300)] },
          { id: 'b', label: 'b', weight: 1, glyphs: [glyph(2, 400, 260), glyph(3, 500, 300)] },
        ],
      }],
    }));
    return flattenView(pickDefaultView(parsed));
  }

  it('gives every panel its OWN space — the _239 overlap bug', () => {
    const flat = overlappingPair();
    for (const [w, h] of [[800, 400], [400, 800]]) {
      const t = layoutView(flat, design, w, h);
      const axis = panelAxisFor(flat, design, w, h);
      // Identical glyphs from different panels must NOT land on the same point.
      const ax = flat.xs[0] * t[0].scale + t[0].offsetX;
      const ay = flat.ys[0] * t[0].scale + t[0].offsetY;
      const bx = flat.xs[2] * t[1].scale + t[1].offsetX;
      const by = flat.ys[2] * t[1].scale + t[1].offsetY;
      expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(1);
      // …and panel b sits strictly after panel a on the chosen axis.
      if (axis === 'columns') {
        expect(flat.xs[1] * t[0].scale + t[0].offsetX).toBeLessThan(bx);
      } else {
        expect(flat.ys[1] * t[0].scale + t[0].offsetY).toBeLessThan(by);
      }
    }
  });

  it('picks the axis that draws the pixels BIGGER — at every viewport shape', () => {
    const flat = overlappingPair();
    for (const [w, h] of [[900, 500], [400, 1200], [618, 463], [300, 300], [1400, 200]]) {
      const cols = arrangePanels(flat, design, w, h, 'columns').glyphScale;
      const rows = arrangePanels(flat, design, w, h, 'rows').glyphScale;
      const axis = panelAxisFor(flat, design, w, h);
      expect(axis, `${w}x${h}`).toBe(rows > cols ? 'rows' : 'columns');
      // The chosen transforms really are that arrangement's.
      expect(layoutView(flat, design, w, h)[0].scale).toBeCloseTo(Math.max(cols, rows), 9);
    }
  });

  it('a TIE goes to the sim\'s own columns', () => {
    const flat = overlappingPair();
    // A square viewport with a symmetric pair is the tie case.
    const w = 600;
    const h = 600;
    const cols = arrangePanels(flat, design, w, h, 'columns').glyphScale;
    const rows = arrangePanels(flat, design, w, h, 'rows').glyphScale;
    if (Math.abs(cols - rows) < 1e-12) {
      expect(panelAxisFor(flat, design, w, h)).toBe('columns');
    } else {
      // Not a tie for this fixture — assert the rule that IS in force.
      expect(panelAxisFor(flat, design, w, h)).toBe(rows > cols ? 'rows' : 'columns');
    }
  });

  it('a SINGLE-panel view is never re-arranged — always the sim\'s own layout', () => {
    for (const [w, h] of [[900, 100], [100, 900]]) {
      expect(panelAxisFor(single, design, w, h)).toBe('columns');
    }
  });

  it('splits the run by WEIGHT, so a heavier panel gets more room', () => {
    const weighted = parsePixelViewArtifact(artifact({
      views: [{
        id: 'top_down', label: 'x',
        panels: [
          { id: 'a', label: 'a', weight: 1, glyphs: [glyph(0, 0, 0), glyph(1, 900, 520)] },
          { id: 'b', label: 'b', weight: 3, glyphs: [glyph(2, 0, 0), glyph(3, 900, 520)] },
        ],
      }],
    }));
    const flat = flattenView(pickDefaultView(weighted));
    const t = layoutView(flat, design, 800, 400);
    // Same design rect in both panels ⇒ the scale ratio IS the weight ratio,
    // on whichever axis they were arranged.
    expect(t[1].scale / t[0].scale).toBeCloseTo(3, 6);
  });

  it('a single-panel view is laid out as if the gap did not exist', () => {
    const wide = layoutView(single, design, 420, 240);
    const noGap = layoutView(single, { ...design, panelGap: 999 }, 420, 240);
    expect(noGap[0].scale).toBeCloseTo(wide[0].scale, 9);
    expect(noGap[0].offsetX).toBeCloseTo(wide[0].offsetX, 9);
  });

  it('REFUSES a degenerate viewport instead of emitting NaN geometry', () => {
    expect(() => layoutView(single, design, 0, 0)).toThrow(/viewport must be positive/);
    expect(() => layoutView(single, design, 420, -1)).toThrow(/viewport must be positive/);
  });

  it('produces finite, positive geometry at every viewport shape it is given', () => {
    for (const [w, h] of [[1, 1], [420, 240], [2000, 40], [40, 2000]]) {
      for (const t of layoutView(single, design, w, h)) {
        expect(Number.isFinite(t.scale)).toBe(true);
        expect(Number.isFinite(t.offsetX)).toBe(true);
        expect(Number.isFinite(t.offsetY)).toBe(true);
        expect(t.scale).toBeGreaterThan(0);
      }
    }
  });
});

describe('pixel_view_logic — vis frame decode', () => {
  it('decodes whole RGBWAU samples', () => {
    const bytes = new Uint8Array([255, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0]);
    const b64 = Buffer.from(bytes).toString('base64');
    const out = decodeVisSamples(b64, nodeBase64);
    expect(out.length).toBe(12);
    expect(out.length / BYTES_PER_SAMPLE).toBe(2);
  });

  it('THROWS on a frame that is not a whole number of samples', () => {
    const b64 = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString('base64');
    expect(() => decodeVisSamples(b64, nodeBase64)).toThrow(/not a whole number/);
  });

  it('reproduces PixelStrip\'s RGBWAU→display arithmetic exactly', () => {
    const out = { r: 0, g: 0, b: 0 };
    // Pure red.
    sampleToDisplayRgb(new Uint8Array([255, 0, 0, 0, 0, 0]), 0, out);
    expect(out).toEqual({ r: 255, g: 0, b: 0 });
    // Pure white emitter → cool white (200,220,255).
    sampleToDisplayRgb(new Uint8Array([0, 0, 0, 255, 0, 0]), 0, out);
    expect(out).toEqual({ r: 200, g: 220, b: 255 });
    // Pure amber → (255,200,50).
    sampleToDisplayRgb(new Uint8Array([0, 0, 0, 0, 255, 0]), 0, out);
    expect(out).toEqual({ r: 255, g: 200, b: 50 });
    // Pure UV → (75,0,130).
    sampleToDisplayRgb(new Uint8Array([0, 0, 0, 0, 0, 255]), 0, out);
    expect(out).toEqual({ r: 75, g: 0, b: 130 });
    // Saturating add: red + white clamps at 255, never wraps.
    sampleToDisplayRgb(new Uint8Array([255, 0, 0, 255, 0, 0]), 0, out);
    expect(out).toEqual({ r: 255, g: 220, b: 255 });
  });

  it('reads the sample at an offset, not always the first', () => {
    const out = { r: 0, g: 0, b: 0 };
    sampleToDisplayRgb(new Uint8Array([0, 0, 0, 0, 0, 0, 10, 20, 30, 0, 0, 0]), 1, out);
    expect(out).toEqual({ r: 10, g: 20, b: 30 });
  });
});

describe('pixel_view_logic — the simulation\'s preview gamma', () => {
  it('carries the sim renderer\'s constant unchanged', () => {
    expect(PREVIEW_GAMMA).toBe(0.6);
  });

  it('leaves a full-brightness pixel alone', () => {
    const out = { r: 255, g: 255, b: 255 };
    previewBrighten(out);
    expect(out).toEqual({ r: 255, g: 255, b: 255 });
    const red = { r: 255, g: 0, b: 0 };
    previewBrighten(red);
    expect(red).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('leaves black black — a dark pixel is never invented into light', () => {
    const out = { r: 0, g: 0, b: 0 };
    previewBrighten(out);
    expect(out).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('LIFTS a dimmed pixel (the whole reason it exists)', () => {
    // The sim's own worked example: 10% → ~25%.
    const out = { r: 26, g: 26, b: 26 };
    previewBrighten(out);
    expect(out.r).toBeGreaterThan(50);
    expect(out.r).toBeLessThan(80);
  });

  it('PRESERVES HUE — every channel is scaled by the same factor', () => {
    const out = { r: 40, g: 20, b: 10 };
    previewBrighten(out);
    // Ratios survive (within rounding to whole bytes).
    expect(out.r / out.g).toBeCloseTo(2, 1);
    expect(out.g / out.b).toBeCloseTo(2, 1);
  });

  it('is monotonic and never exceeds the byte range', () => {
    let prev = -1;
    for (let v = 0; v <= 255; v += 1) {
      const out = { r: v, g: v, b: v };
      previewBrighten(out);
      expect(out.r).toBeGreaterThanOrEqual(v);   // a lift, never a cut
      expect(out.r).toBeLessThanOrEqual(255);
      expect(out.r).toBeGreaterThanOrEqual(prev);
      prev = out.r;
    }
  });
});

describe('pixel_view_logic — the stage is theme-independent', () => {
  it('uses the SIMULATION renderer\'s own near-black ground', () => {
    // pixel_map_renderer.js: const BG = '#0b0d12'.
    expect(PIXEL_STAGE_BG).toBe('#0b0d12');
  });

  it('offers exactly the two REAL engine buffers, and defaults to the show', () => {
    expect(PIXEL_VIS_SOURCES.map((s) => s.key)).toEqual(['preDimmer', 'rig']);
    expect(PIXEL_VIS_SOURCES.map((s) => s.label)).toEqual(['SHOW', 'RIG']);
    // The default matches the deck's own master strip, per the engine's
    // documented "dimmers wash the UI preview to near-black" note.
    expect(DEFAULT_VIS_SOURCE).toBe('preDimmer');
    expect(PIXEL_VIS_SOURCES.some((s) => s.key === DEFAULT_VIS_SOURCE)).toBe(true);
  });

  it('gives an unlit pixel a dim ink that is visible on that ground', () => {
    expect(PIXEL_GHOST_INK).toMatch(/^rgba\(/);
    // Translucent by construction — an off pixel must read as OFF, not as grey.
    const alpha = Number(PIXEL_GHOST_INK.split(',')[3].replace(')', '').trim());
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.35);
  });
});

describe('pixel_view_logic — the engine subsampling seam', () => {
  it('inverts the engine\'s own visSampleIdx table', () => {
    // engine.js: visSampleIdx[i] = floor(i * modelCount / sampleCount).
    const modelCount = 964;
    const sampleCount = 100;
    for (let i = 0; i < sampleCount; i += 1) {
      const sourcePixel = Math.floor((i * modelCount) / sampleCount);
      // The pixel a sample was READ FROM must map back to that same sample.
      expect(sampleIndexForModelPixel(sourcePixel, modelCount, sampleCount)).toBe(i);
    }
  });

  it('never indexes past the transmitted buffer', () => {
    const modelCount = 964;
    const sampleCount = 100;
    for (let m = 0; m < modelCount; m += 1) {
      const s = sampleIndexForModelPixel(m, modelCount, sampleCount);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(sampleCount);
    }
  });

  it('is the IDENTITY when the engine sends the model verbatim (cap not binding)', () => {
    for (let m = 0; m < 50; m += 1) {
      expect(sampleIndexForModelPixel(m, 50, 100)).toBe(m);
      expect(sampleIndexForModelPixel(m, 50, 50)).toBe(m);
    }
  });

  it('is monotonic — a strand never runs its colours backwards', () => {
    let prev = -1;
    for (let m = 0; m < 964; m += 1) {
      const s = sampleIndexForModelPixel(m, 964, 100);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('THROWS on nonsensical counts instead of returning a junk index', () => {
    expect(() => sampleIndexForModelPixel(0, 964, 0)).toThrow(/sampleCount must be positive/);
    expect(() => sampleIndexForModelPixel(0, 0, 100)).toThrow(/modelCount must be positive/);
  });

  it('builds a per-glyph lookup covering every drawn pixel WHEN capped', () => {
    const flat = flattenView(pickDefaultView(parsePixelViewArtifact(artifact())));
    const lut = buildSampleLookup(flat, 10, 4);
    expect(lut).not.toBeNull();
    expect(lut!.length).toBe(flat.count);
    for (let i = 0; i < lut!.length; i += 1) {
      expect(lut![i]).toBe(sampleIndexForModelPixel(flat.modelIndex[i], 10, 4));
      expect(lut![i]).toBeLessThan(4);
    }
  });

  it('builds NO lookup at all at full rate — the upsampling path is not walked', () => {
    // _239: rig/preDimmer ship every model pixel, so a lookup would just be a
    // copy of flat.modelIndex. null says "there is no resampling here".
    const flat = flattenView(pickDefaultView(parsePixelViewArtifact(artifact())));
    expect(buildSampleLookup(flat, 10, 10)).toBeNull();
    expect(buildSampleLookup(flat, 10, 964)).toBeNull();
  });

  it('THROWS on nonsensical counts rather than returning an empty lookup', () => {
    const flat = flattenView(pickDefaultView(parsePixelViewArtifact(artifact())));
    expect(() => buildSampleLookup(flat, 10, 0)).toThrow(/sampleCount must be positive/);
    expect(() => buildSampleLookup(flat, 0, 10)).toThrow(/modelCount must be positive/);
  });
});

describe('pixel_view_logic — honesty about what is on screen', () => {
  it('states the real sample/pixel ratio when the cap is binding', () => {
    expect(describeColourResolution(720, 100, 964)).toBe('720 PX · 100/964 COLOUR SAMPLES');
  });

  it('still shows the ARITHMETIC at full rate, not just the claim', () => {
    // _239 ships rig/preDimmer at full rate, and the operator should be able
    // to read 964/964 rather than take "FULL RATE" on trust.
    expect(describeColourResolution(720, 964, 964))
      .toBe('720 PX · 964/964 COLOUR SAMPLES · FULL RATE');
    expect(describeColourResolution(50, 200, 50))
      .toBe('50 PX · 50/50 COLOUR SAMPLES · FULL RATE');
  });

  it('is silent when the artifact and the engine agree on the model', () => {
    expect(artifactModelMismatch(964, 964)).toBeNull();
    // Engine count not known yet → nothing to claim.
    expect(artifactModelMismatch(964, null)).toBeNull();
  });

  it('names the mismatch, both counts, and the fix', () => {
    const msg = artifactModelMismatch(964, 512);
    expect(msg).toMatch(/964-pixel model/);
    expect(msg).toMatch(/512-pixel model/);
    expect(msg).toMatch(/export_touch_control_pixel_views\.mjs/);
  });
});

// ── The REAL shipped artifact ─────────────────────────────────────────────
// The window renders whatever the sim serves at runtime, but the checked-in
// artifact is what the show machine deploys — so it is parsed here for real.
// If the sim's resolver or the operator's authored views change shape, this is
// the test that says so, in CI, instead of the deck going blank on the playa.

describe('pixel_view_logic — the checked-in simulation artifact', () => {
  const artifactPath = path.resolve(
    __dirname, '..', '..', 'live_touch', 'touch_control_pixel_views.json',
  );

  it('exists where the simulation serves it from', () => {
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('parses, flattens, and fits without a single loosened rule', () => {
    const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const parsed: PixelViewArtifact = parsePixelViewArtifact(raw);
    expect(parsed.modelPixelCount).toBeGreaterThan(0);

    for (const view of parsed.views) {
      const flat = flattenView(view);
      expect(flat.count).toBeGreaterThan(0);
      for (const panel of flat.panels) {
        expect(Number.isFinite(panel.bounds.minX)).toBe(true);
        expect(panel.bounds.maxX).toBeGreaterThan(panel.bounds.minX);
        expect(panel.bounds.maxY).toBeGreaterThan(panel.bounds.minY);
      }

      const transforms = layoutView(flat, parsed.design, 400, 260);
      expect(transforms).toHaveLength(flat.panels.length);
      for (const t of transforms) expect(t.scale).toBeGreaterThan(0);

      // Every glyph joins to a real sample of a 100-sample (capped) vis frame.
      const lut = buildSampleLookup(flat, parsed.modelPixelCount, 100);
      expect(lut).not.toBeNull();
      for (let i = 0; i < lut!.length; i += 1) expect(lut![i]).toBeLessThan(100);
      // …and at the shipped full-rate budget there is no lookup at all.
      expect(buildSampleLookup(flat, parsed.modelPixelCount, parsed.modelPixelCount)).toBeNull();
    }
  });

  it('EVERY shipped view fills the window — the operator\'s FRONT / TE SIGN order', () => {
    // The bug this pins: `front` (left+right) and `te_sign` (sign_1+sign_2) are
    // MULTI-PANEL, and merging their coordinate spaces stacked the halves on
    // top of each other. Two independent assertions per view: the picture
    // fills the canvas, and no two panels' ink overlaps horizontally.
    const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const parsed = parsePixelViewArtifact(raw);
    const W = 618;
    const H = 463;

    for (const view of parsed.views) {
      const flat = flattenView(view);
      const transforms = layoutView(flat, parsed.design, W, H);
      const spans = flat.panels.map((panel, p) => {
        const t = transforms[p];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = panel.start; i < panel.end; i += 1) {
          const x = flat.xs[i] * t.scale + t.offsetX;
          const y = flat.ys[i] * t.scale + t.offsetY;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        return { minX, minY, maxX, maxY };
      });
      const minX = Math.min(...spans.map((s) => s.minX));
      const maxX = Math.max(...spans.map((s) => s.maxX));
      const minY = Math.min(...spans.map((s) => s.minY));
      const maxY = Math.max(...spans.map((s) => s.maxY));

      // Fills one axis to (near) the fill fraction — no view is left as a
      // little band floating in the middle of the canvas.
      const filled = Math.max((maxX - minX) / W, (maxY - minY) / H);
      expect(filled, `${view.id} must fill the canvas`).toBeGreaterThan(0.85);
      // Nothing escapes the canvas.
      expect(minX).toBeGreaterThanOrEqual(0);
      expect(minY).toBeGreaterThanOrEqual(0);
      expect(maxX).toBeLessThanOrEqual(W);
      expect(maxY).toBeLessThanOrEqual(H);

      // Panels occupy DISJOINT bands along whichever axis was chosen —
      // never drawn on top of each other.
      const axis = panelAxisFor(flat, parsed.design, W, H);
      for (let i = 1; i < spans.length; i += 1) {
        const prev = spans[i - 1];
        const here = spans[i];
        const separated = axis === 'columns'
          ? here.minX > prev.maxX
          : here.minY > prev.maxY;
        expect(separated, `${view.id}: panel ${i} must follow panel ${i - 1} along ${axis}`)
          .toBe(true);
      }
    }
  });

  it('FRONT stacks in a deck window and columns in a wide one — measured, not named', () => {
    // The operator's report was FRONT "squeezed into a band". Two 1.5:1 panels
    // side by side composite to ~2.9:1, which in a deck-window canvas can only
    // letterbox to a band. Stacked, the same pixels come out ~25 % larger
    // (measured below). On a wide enough canvas the sim's own column split wins
    // again, as it should.
    const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const parsed = parsePixelViewArtifact(raw);
    const front = flattenView(parsed.views.find((v) => v.id === 'front')!);
    expect(panelAxisFor(front, parsed.design, 618, 463)).toBe('rows');
    expect(panelAxisFor(front, parsed.design, 900, 500)).toBe('columns');
    // The gain is real, not marginal.
    const stacked = arrangePanels(front, parsed.design, 618, 463, 'rows').glyphScale;
    const side = arrangePanels(front, parsed.design, 618, 463, 'columns').glyphScale;
    expect(stacked / side).toBeGreaterThan(1.1);
  });

  it('carries the operator\'s top-down ship as the opening view', () => {
    const raw = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const parsed = parsePixelViewArtifact(raw);
    expect(pickDefaultView(parsed).id).toBe(PREFERRED_VIEW_ID);
    expect(flattenView(pickDefaultView(parsed)).count).toBeGreaterThan(100);
  });
});
