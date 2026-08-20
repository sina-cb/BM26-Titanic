/**
 * THE PARITY GATE (report _252, docs/60 §7 W1).
 *
 * The native port was allowed on one condition: the browser keeps drawing
 * EXACTLY what it drew before. This file holds the PRE-REFACTOR painter —
 * copied verbatim out of `pixel_view_paint.ts` as it stood before the
 * `PixelPaintTarget` seam existed — and asserts that it and the new
 * painter + canvas-2d adapter emit a byte-identical stream of 2D-context calls
 * for the same draw state.
 *
 * A screenshot can only show that the ship still looks right at one size on one
 * frame. This compares every `fillStyle`, `arc`, `ellipse`, `fillRect` and
 * composite-mode flip, across sizes, across lit/dark/mixed frames, across round
 * and square glyphs and across multi-panel views. If a future change to the
 * seam moves a single web pixel, the diff below names it.
 *
 * DO NOT "fix" the reference to match a change in the painter. It is a frozen
 * record of what the deck and the mixer looked like on web before the iPad
 * could draw them at all; a deliberate change to the picture means deleting
 * this file with the reason written down, not editing it.
 */
import { describe, expect, it } from 'vitest';

import { createCanvasPaintTarget } from './pixel_paint_target_canvas';
import {
  GLOW_ALPHA,
  GLOW_MIN_LUMA,
  GLOW_SCALE,
  MIN_GLYPH_PX,
  paintPixelView,
  type PixelViewDrawState,
} from './pixel_view_paint';
import {
  BYTES_PER_SAMPLE,
  PIXEL_GHOST_INK,
  PIXEL_STAGE_BG,
  layoutView,
  previewBrighten,
  sampleToDisplayRgb,
  type FlatPixelView,
} from './pixel_view_logic';

// ── The pre-refactor painter, verbatim ─────────────────────────────────────

type Op = [string, ...unknown[]];

interface RefCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  getContext(kind: '2d'): RefContext | null;
}

interface RefContext {
  fillStyle: string | object;
  globalCompositeOperation: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, s: number, e: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void;
  fill(): void;
}

function referencePaint(canvas: RefCanvas, state: PixelViewDrawState): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const dpr = Math.min(2, (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0 || cssH <= 0) return false;
  const wantW = Math.max(1, Math.round(cssW * dpr));
  const wantH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PIXEL_STAGE_BG;
  ctx.fillRect(0, 0, cssW, cssH);

  const { flat, samples } = state;
  const transforms = layoutView(flat, state.design, cssW, cssH);
  const lut = state.lut || flat.modelIndex;
  const haveColour = samples !== null && state.lutReady;
  const rgb = { r: 0, g: 0, b: 0 };

  if (samples && haveColour) {
    ctx.globalCompositeOperation = 'lighter';
    for (let p = 0; p < flat.panels.length; p += 1) {
      const panel = flat.panels[p];
      const t = transforms[p];
      for (let i = panel.start; i < panel.end; i += 1) {
        sampleToDisplayRgb(samples, lut[i], rgb);
        previewBrighten(rgb);
        const luma = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        if (luma < GLOW_MIN_LUMA) continue;
        const x = flat.xs[i] * t.scale + t.offsetX;
        const y = flat.ys[i] * t.scale + t.offsetY;
        const r = Math.max(MIN_GLYPH_PX, Math.max(flat.ws[i], flat.hs[i]) * t.scale) * GLOW_SCALE * 0.5;
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${GLOW_ALPHA})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  for (let p = 0; p < flat.panels.length; p += 1) {
    const panel = flat.panels[p];
    const t = transforms[p];
    for (let i = panel.start; i < panel.end; i += 1) {
      const x = flat.xs[i] * t.scale + t.offsetX;
      const y = flat.ys[i] * t.scale + t.offsetY;
      const w = Math.max(MIN_GLYPH_PX, flat.ws[i] * t.scale);
      const h = Math.max(MIN_GLYPH_PX, flat.hs[i] * t.scale);

      let lit = false;
      if (samples && haveColour) {
        sampleToDisplayRgb(samples, lut[i], rgb);
        previewBrighten(rgb);
        lit = rgb.r + rgb.g + rgb.b > 8;
      }
      ctx.fillStyle = lit
        ? `rgb(${rgb.r},${rgb.g},${rgb.b})`
        : PIXEL_GHOST_INK;

      if (flat.round[i]) {
        ctx.beginPath();
        ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
      }
    }
  }
  return true;
}

// ── One recording canvas, used by both ─────────────────────────────────────

function recordingCanvas(cssW: number, cssH: number) {
  const ops: Op[] = [];
  const ctx = {
    _fill: '' as string | object,
    _gco: '',
    get fillStyle() { return this._fill; },
    set fillStyle(value: string | object) { this._fill = value; ops.push(['fillStyle', value]); },
    get globalCompositeOperation() { return this._gco; },
    set globalCompositeOperation(value: string) { this._gco = value; ops.push(['gco', value]); },
    setTransform(...args: number[]) { ops.push(['setTransform', ...args]); },
    fillRect(...args: number[]) { ops.push(['fillRect', ...args]); },
    beginPath() { ops.push(['beginPath']); },
    arc(...args: number[]) { ops.push(['arc', ...args]); },
    ellipse(...args: number[]) { ops.push(['ellipse', ...args]); },
    fill() { ops.push(['fill']); },
  };
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: cssW,
    clientHeight: cssH,
    getContext: () => ctx,
  };
  return { canvas, ops };
}

// ── Draw states worth comparing ────────────────────────────────────────────

/** Two panels, mixed round/square, sizes that straddle MIN_GLYPH_PX. */
function flatView(): FlatPixelView {
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  const hs: number[] = [];
  const round: number[] = [];
  const modelIndex: number[] = [];
  for (let panel = 0; panel < 2; panel += 1) {
    for (let i = 0; i < 24; i += 1) {
      xs.push((i % 6) * 37 + panel * 3);
      ys.push(Math.floor(i / 6) * 41);
      ws.push(4 + (i % 5));
      hs.push(4 + ((i + 2) % 5));
      round.push(i % 3 === 0 ? 1 : 0);
      modelIndex.push(panel * 24 + i);
    }
  }
  const bounds = { minX: 0, minY: 0, maxX: 190, maxY: 130 };
  return {
    id: 'parity',
    label: 'Parity',
    count: xs.length,
    xs: Float32Array.from(xs),
    ys: Float32Array.from(ys),
    ws: Float32Array.from(ws),
    hs: Float32Array.from(hs),
    round: Uint8Array.from(round),
    modelIndex: Int32Array.from(modelIndex),
    panels: [
      { id: 'a', label: 'A', weight: 1, start: 0, end: 24, bounds },
      { id: 'b', label: 'B', weight: 1, start: 24, end: 48, bounds },
    ],
    bounds,
  };
}

/** A frame with dark, sub-luma-floor, mid and full pixels in every channel. */
function samplesOf(count: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(count * BYTES_PER_SAMPLE);
  for (let i = 0; i < count; i += 1) {
    const off = i * BYTES_PER_SAMPLE;
    bytes[off] = (i * 17 + seed) % 256;
    bytes[off + 1] = (i * 5 + seed * 3) % 256;
    bytes[off + 2] = (i * 29 + seed * 7) % 256;
    bytes[off + 3] = i % 4 === 0 ? 40 : 0;   // white
    bytes[off + 4] = i % 7 === 0 ? 90 : 0;   // amber
    bytes[off + 5] = i % 11 === 0 ? 120 : 0; // uv
  }
  return bytes;
}

function drawState(samples: Uint8Array | null, lutReady: boolean): PixelViewDrawState {
  const flat = flatView();
  return {
    flat,
    design: { width: 900, height: 520, panelGap: 8 },
    lut: null,
    lutReady,
    samples,
    sampleCount: samples ? samples.length / BYTES_PER_SAMPLE : 0,
  };
}

const FRAMES: [string, PixelViewDrawState][] = [
  ['before the first frame', drawState(null, false)],
  ['a frame that has not resolved its lookup', drawState(samplesOf(48, 3), false)],
  ['a blackout', drawState(new Uint8Array(48 * BYTES_PER_SAMPLE), true)],
  ['a busy frame', drawState(samplesOf(48, 3), true)],
  ['another busy frame', drawState(samplesOf(48, 91), true)],
];

/** Deck window, dominant mixer band, channel band, and a surface small enough
 *  that every glyph lands on the MIN_GLYPH_PX floor. */
const SIZES: [number, number][] = [[560, 320], [316, 240], [316, 110], [40, 18]];

describe('web pixel parity — the refactored painter draws what the old one drew', () => {
  for (const [label, state] of FRAMES) {
    for (const [w, h] of SIZES) {
      it(`${label}, ${w}×${h}`, () => {
        const before = recordingCanvas(w, h);
        const after = recordingCanvas(w, h);

        const refPainted = referencePaint(before.canvas, state);
        const newPainted = paintPixelView(createCanvasPaintTarget(after.canvas), state);

        expect(newPainted).toBe(refPainted);
        expect(after.ops).toEqual(before.ops);
        // Backing-store sizing is part of the picture, not an implementation
        // detail: a wrong device-pixel size is a blurry ship.
        expect(after.canvas.width).toBe(before.canvas.width);
        expect(after.canvas.height).toBe(before.canvas.height);
        expect(after.ops.length).toBeGreaterThan(50);
      });
    }
  }

  it('refuses a zero-sized surface exactly as the old painter did', () => {
    const before = recordingCanvas(0, 120);
    const after = recordingCanvas(0, 120);
    expect(referencePaint(before.canvas, FRAMES[3][1])).toBe(false);
    expect(paintPixelView(createCanvasPaintTarget(after.canvas), FRAMES[3][1])).toBe(false);
    expect(after.ops).toEqual(before.ops);
    expect(after.ops).toEqual([]);
  });

  it('is a REAL comparison — the reference does emit halos, ghosts and cores', () => {
    // Guards against the whole gate silently passing on an empty op stream.
    const { canvas, ops } = recordingCanvas(560, 320);
    referencePaint(canvas, FRAMES[3][1]);
    const styles = ops.filter((op) => op[0] === 'fillStyle').map((op) => String(op[1]));
    expect(styles.some((s) => s.startsWith('rgba('))).toBe(true);
    expect(styles.some((s) => s.startsWith('rgb('))).toBe(true);
    expect(styles).toContain(PIXEL_STAGE_BG);
    expect(ops.filter((op) => op[0] === 'gco')).toEqual([['gco', 'lighter'], ['gco', 'source-over']]);
    expect(ops.some((op) => op[0] === 'ellipse')).toBe(true);

    // Every pixel in the busy frame is lit, so the ghost ink only shows up in
    // the blackout frame — which the parity loop above also compares.
    const blackout = recordingCanvas(560, 320);
    referencePaint(blackout.canvas, FRAMES[2][1]);
    expect(blackout.ops.filter((op) => op[0] === 'fillStyle').map((op) => String(op[1])))
      .toContain(PIXEL_GHOST_INK);
  });
});
