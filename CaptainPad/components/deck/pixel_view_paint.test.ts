/**
 * The pass order of `paintPixelView`, driven through a RECORDING fake target.
 *
 * Report _252 split the one imperative paint into a platform-neutral pass order
 * (this module) and two paint targets (a browser 2D context, an `SkCanvas`).
 * That split is only safe if the ORDER — additive halos first, the additive
 * window closed before the cores, ghosts for the unlit, the luma skip, the
 * glyph floor and the half-pixel snap — is pinned somewhere that neither
 * platform can drift away from. This is that pin.
 */
import { describe, expect, it } from 'vitest';

import {
  GLOW_ALPHA,
  GLOW_MIN_LUMA,
  GLOW_SCALE,
  MIN_GLYPH_PX,
  paintPixelView,
  type PixelPaintTarget,
  type PixelViewDrawState,
} from './pixel_view_paint';
import {
  BYTES_PER_SAMPLE,
  PIXEL_STAGE_BG,
  type FlatPixelView,
} from './pixel_view_logic';

// ── A recording target ─────────────────────────────────────────────────────

type Call =
  | { op: 'begin' }
  | { op: 'clear'; color: string }
  | { op: 'additive'; on: boolean }
  | { op: 'circle'; args: number[] }
  | { op: 'ellipse'; args: number[] }
  | { op: 'ghostEllipse'; args: number[] }
  | { op: 'rect'; args: number[] }
  | { op: 'ghostRect'; args: number[] }
  | { op: 'end' };

function recorder(size: { w: number; h: number } | null) {
  const calls: Call[] = [];
  const target: PixelPaintTarget = {
    begin() { calls.push({ op: 'begin' }); return size; },
    clear(color) { calls.push({ op: 'clear', color }); },
    setAdditive(on) { calls.push({ op: 'additive', on }); },
    fillCircle(...args) { calls.push({ op: 'circle', args }); },
    fillEllipse(...args) { calls.push({ op: 'ellipse', args }); },
    fillGhostEllipse(...args) { calls.push({ op: 'ghostEllipse', args }); },
    fillRect(...args) { calls.push({ op: 'rect', args }); },
    fillGhostRect(...args) { calls.push({ op: 'ghostRect', args }); },
    end() { calls.push({ op: 'end' }); },
  };
  return { target, calls, ops: () => calls.map((c) => c.op) };
}

// ── The smallest drawable view ─────────────────────────────────────────────
//
// Three glyphs in ONE panel, spread across a 100×100 design box so the layout
// is a plain 1:1 fit onto a 100×100 surface: index 0 square, index 1 square,
// index 2 round.

function flatView(): FlatPixelView {
  return {
    id: 'v',
    label: 'V',
    count: 3,
    xs: Float32Array.from([0, 50, 100]),
    ys: Float32Array.from([0, 50, 100]),
    ws: Float32Array.from([10, 10, 10]),
    hs: Float32Array.from([10, 10, 10]),
    round: Uint8Array.from([0, 0, 1]),
    modelIndex: Int32Array.from([0, 1, 2]),
    panels: [{
      id: 'p',
      label: 'P',
      weight: 1,
      start: 0,
      end: 3,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    }],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  };
}

/** One RGBWAU frame. `rgb[i]` is the raw R=G=B level of glyph i. */
function samplesOf(levels: number[]): Uint8Array {
  const bytes = new Uint8Array(levels.length * BYTES_PER_SAMPLE);
  levels.forEach((level, i) => {
    bytes[i * BYTES_PER_SAMPLE] = level;
    bytes[i * BYTES_PER_SAMPLE + 1] = level;
    bytes[i * BYTES_PER_SAMPLE + 2] = level;
  });
  return bytes;
}

function drawState(overrides: Partial<PixelViewDrawState> = {}): PixelViewDrawState {
  return {
    flat: flatView(),
    design: { width: 100, height: 100, panelGap: 8 },
    lut: null,
    lutReady: false,
    samples: null,
    sampleCount: 0,
    ...overrides,
  };
}

describe('paintPixelView pass order', () => {
  it('refuses a target that cannot begin, and draws nothing at all', () => {
    const rec = recorder(null);
    expect(paintPixelView(rec.target, drawState())).toBe(false);
    expect(rec.ops()).toEqual(['begin']);
  });

  it('paints the stage ground before anything else, and ends the frame', () => {
    const rec = recorder({ w: 100, h: 100 });
    expect(paintPixelView(rec.target, drawState())).toBe(true);
    expect(rec.calls[0]).toEqual({ op: 'begin' });
    expect(rec.calls[1]).toEqual({ op: 'clear', color: PIXEL_STAGE_BG });
    expect(rec.calls[rec.calls.length - 1]).toEqual({ op: 'end' });
  });

  it('draws only ghosts before the first frame — no colour, no halos', () => {
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState());
    expect(rec.ops()).toEqual([
      'begin', 'clear', 'ghostRect', 'ghostRect', 'ghostEllipse', 'end',
    ]);
  });

  it('opens the additive window for the halo pass and closes it before the cores', () => {
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState({
      samples: samplesOf([255, 255, 255]),
      lutReady: true,
      sampleCount: 3,
    }));
    expect(rec.ops()).toEqual([
      'begin', 'clear',
      'additive', 'circle', 'circle', 'circle', 'additive',
      'rect', 'rect', 'ellipse',
      'end',
    ]);
    const window = rec.calls.filter((c) => c.op === 'additive');
    expect(window).toEqual([{ op: 'additive', on: true }, { op: 'additive', on: false }]);
  });

  it('skips the halo of a pixel below GLOW_MIN_LUMA but still draws its core', () => {
    // Level 1 survives `previewBrighten` well under the luma floor; level 255
    // is far above it. The dim pixel keeps a lit core because "lit" is a
    // different, much lower threshold (sum > 8 after brightening).
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState({
      samples: samplesOf([255, 1, 255]),
      lutReady: true,
      sampleCount: 3,
    }));
    const circles = rec.calls.filter((c) => c.op === 'circle');
    expect(circles).toHaveLength(2);
    expect(rec.ops().slice(-4)).toEqual(['rect', 'rect', 'ellipse', 'end']);
  });

  it('inks a black pixel as a GHOST, so the ship keeps its shape in a blackout', () => {
    // The additive window still opens and closes: a frame HAS arrived, every
    // pixel in it simply failed the luma floor. Only the halos are missing.
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState({
      samples: samplesOf([0, 0, 0]),
      lutReady: true,
      sampleCount: 3,
    }));
    expect(rec.ops()).toEqual([
      'begin', 'clear', 'additive', 'additive',
      'ghostRect', 'ghostRect', 'ghostEllipse', 'end',
    ]);
  });

  it('snaps square cores to whole pixels, and never below one', () => {
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState());
    const rects = rec.calls.filter((c) => c.op === 'ghostRect');
    for (const call of rects) {
      const [x, y, w, h] = (call as { args: number[] }).args;
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
      expect(Number.isInteger(w)).toBe(true);
      expect(Number.isInteger(h)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(1);
      expect(h).toBeGreaterThanOrEqual(1);
    }
  });

  it('floors a sub-pixel glyph at MIN_GLYPH_PX rather than letting it dissolve', () => {
    // A 10-unit glyph on a 100-unit box shrunk into a 4 px surface is 0.4 px.
    const rec = recorder({ w: 4, h: 4 });
    paintPixelView(rec.target, drawState());
    const [, , w, h] = (rec.calls.find((c) => c.op === 'ghostRect') as { args: number[] }).args;
    expect(w).toBe(Math.max(1, Math.round(MIN_GLYPH_PX)));
    expect(h).toBe(Math.max(1, Math.round(MIN_GLYPH_PX)));
  });

  it('sizes a halo from the glyph floor times GLOW_SCALE, at GLOW_ALPHA', () => {
    const rec = recorder({ w: 4, h: 4 });
    paintPixelView(rec.target, drawState({
      samples: samplesOf([255, 255, 255]),
      lutReady: true,
      sampleCount: 3,
    }));
    const circle = rec.calls.find((c) => c.op === 'circle') as { args: number[] };
    const [, , r, , , , alpha] = circle.args;
    expect(r).toBeCloseTo(MIN_GLYPH_PX * GLOW_SCALE * 0.5, 6);
    expect(alpha).toBe(GLOW_ALPHA);
  });

  it('routes a round glyph to the ellipse calls with half-size radii', () => {
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState({
      samples: samplesOf([255, 255, 255]),
      lutReady: true,
      sampleCount: 3,
    }));
    const ellipse = rec.calls.find((c) => c.op === 'ellipse') as { args: number[] };
    const [, , rx, ry] = ellipse.args;
    // A circle has no crisp edge to preserve, so the ellipse radii are NOT
    // snapped — but they come from the same glyph size the square core snaps
    // from, so `round(rx * 2)` is the square core's width.
    const rect = rec.calls.find((c) => c.op === 'rect') as { args: number[] };
    expect(ry).toBe(rx);
    expect(Math.max(1, Math.round(rx * 2))).toBe(rect.args[2]);
  });

  it('draws nothing coloured until the lookup has been resolved', () => {
    // `lutReady: false` with samples present is the pre-lookup state the vis
    // callback passes through exactly once per session.
    const rec = recorder({ w: 100, h: 100 });
    paintPixelView(rec.target, drawState({ samples: samplesOf([255, 255, 255]) }));
    expect(rec.ops()).toEqual([
      'begin', 'clear', 'ghostRect', 'ghostRect', 'ghostEllipse', 'end',
    ]);
  });

  it('keeps GLOW_MIN_LUMA the documented floor, not an accident', () => {
    expect(GLOW_MIN_LUMA).toBe(24);
  });
});
