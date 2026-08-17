/**
 * The Skia paint target, driven through a recording fake `SkCanvas`.
 *
 * The adapter takes its Skia factories by injection precisely so this suite can
 * exist with no simulator and no device (report _252): what it proves is the
 * half of the native path that is pure arithmetic — which paint each pass
 * writes through, the 0-255 → 0-1 colour conversion, the centre→top-left oval
 * rect, one picture per completed frame, and no picture at all for a frame that
 * could not begin. What only the iPad can prove (that Skia rasterizes it
 * identically to the browser) is docs/60 §8's on-device checklist.
 */
import { describe, expect, it } from 'vitest';

import {
  createSkiaPaintTarget,
  cssColorToSkColor,
  type SkPaintLike,
  type SkRectLike,
} from './pixel_paint_target_skia';
import { PIXEL_GHOST_INK, PIXEL_STAGE_BG } from './pixel_view_logic';

/** Colour maths lands in a Float32Array, so an expectation written in f64
 *  arithmetic misses by ~1e-9. Round-trip every expected colour the same way. */
function f32(values: number[]): number[] {
  return Array.from(Float32Array.from(values));
}

type Draw =
  | { op: 'circle'; cx: number; cy: number; r: number; paint: string; color: number[] }
  | { op: 'oval'; rect: SkRectLike; paint: string; color: number[] }
  | { op: 'rect'; rect: SkRectLike; paint: string; color: number[] };

function harness(size: { w: number; h: number }) {
  const draws: Draw[] = [];
  const pictures: string[] = [];
  let recordings = 0;
  let bounds: SkRectLike | undefined;

  /** Colours must be read AT DRAW TIME: the adapter reuses one Float32Array, so
   *  a fake that stored the reference would silently pass a broken adapter. */
  function paintOf(name: string): SkPaintLike & { last: number[] } {
    const paint = {
      last: [] as number[],
      setColor(color: Float32Array) { paint.last = Array.from(color); },
      toString() { return name; },
    };
    return paint;
  }

  const haloPaint = paintOf('halo');
  const corePaint = paintOf('core');
  const which = (paint: SkPaintLike) => (paint === haloPaint ? 'halo' : 'core');
  const colorOf = (paint: SkPaintLike) => (
    paint === haloPaint ? [...haloPaint.last] : [...corePaint.last]
  );

  const canvas = {
    drawCircle(cx: number, cy: number, r: number, paint: SkPaintLike) {
      draws.push({ op: 'circle', cx, cy, r, paint: which(paint), color: colorOf(paint) });
    },
    drawOval(rect: SkRectLike, paint: SkPaintLike) {
      draws.push({ op: 'oval', rect, paint: which(paint), color: colorOf(paint) });
    },
    drawRect(rect: SkRectLike, paint: SkPaintLike) {
      draws.push({ op: 'rect', rect, paint: which(paint), color: colorOf(paint) });
    },
  };

  const target = createSkiaPaintTarget<string>({
    createRecorder: () => {
      recordings += 1;
      const id = `picture-${recordings}`;
      return {
        beginRecording(rect?: SkRectLike) { bounds = rect; return canvas; },
        finishRecordingAsPicture() { return id; },
      };
    },
    haloPaint,
    corePaint,
    getSize: () => size,
    onPicture: (picture) => { pictures.push(picture); },
  });

  return {
    target,
    draws,
    pictures,
    recordings: () => recordings,
    bounds: () => bounds,
  };
}

describe('cssColorToSkColor', () => {
  it('parses the stage ground hex', () => {
    const out = cssColorToSkColor(PIXEL_STAGE_BG, new Float32Array(4));
    expect(Array.from(out).slice(0, 3).map((n) => Math.round(n * 255)))
      .toEqual([11, 13, 18]);
    expect(out[3]).toBe(1);
  });

  it('parses the ghost ink, alpha and all', () => {
    const out = cssColorToSkColor(PIXEL_GHOST_INK, new Float32Array(4));
    expect(Array.from(out).slice(0, 3).map((n) => Math.round(n * 255)))
      .toEqual([150, 170, 205]);
    expect(out[3]).toBeCloseTo(0.2, 6);
  });

  it('parses a three-argument rgb() as fully opaque', () => {
    const out = cssColorToSkColor('rgb(255,0,128)', new Float32Array(4));
    expect(Array.from(out)).toEqual(f32([1, 0, 128 / 255, 1]));
  });

  it('refuses anything else BY NAME rather than rendering a wrong colour', () => {
    expect(() => cssColorToSkColor('rebeccapurple', new Float32Array(4)))
      .toThrow(/unsupported colour/);
    expect(() => cssColorToSkColor('#abc', new Float32Array(4)))
      .toThrow(/unsupported hex colour/);
    expect(() => cssColorToSkColor('rgb(a,b,c)', new Float32Array(4)))
      .toThrow(/unparseable colour/);
  });
});

describe('skia paint target', () => {
  it('refuses a zero-sized surface and starts no recording', () => {
    const h = harness({ w: 0, h: 0 });
    expect(h.target.begin()).toBeNull();
    expect(h.recordings()).toBe(0);
    expect(h.pictures).toEqual([]);
  });

  it('records into a picture bounded by the surface, and emits it on end', () => {
    const h = harness({ w: 316, h: 110 });
    expect(h.target.begin()).toEqual({ w: 316, h: 110 });
    expect(h.bounds()).toEqual({ x: 0, y: 0, width: 316, height: 110 });
    h.target.end();
    expect(h.pictures).toEqual(['picture-1']);
  });

  it('emits ONE picture per frame and never one without a begin', () => {
    const h = harness({ w: 10, h: 10 });
    h.target.begin();
    h.target.end();
    h.target.begin();
    h.target.end();
    expect(h.pictures).toEqual(['picture-1', 'picture-2']);
    expect(() => h.target.end()).toThrow(/end\(\) without begin\(\)/);
  });

  it('paints the stage ground with the core paint, edge to edge', () => {
    const h = harness({ w: 40, h: 20 });
    h.target.begin();
    h.target.clear(PIXEL_STAGE_BG);
    expect(h.draws).toEqual([{
      op: 'rect',
      rect: { x: 0, y: 0, width: 40, height: 20 },
      paint: 'core',
      color: f32([11 / 255, 13 / 255, 18 / 255, 1]),
    }]);
  });

  it('routes the halo pass through the additive paint and the cores through SrcOver', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.setAdditive(true);
    h.target.fillCircle(5, 6, 2, 255, 0, 0, 0.16);
    h.target.setAdditive(false);
    h.target.fillRect(1, 2, 3, 4, 0, 255, 0);
    expect(h.draws.map((d) => d.paint)).toEqual(['halo', 'core']);
  });

  it('converts 0-255 channels and the halo alpha into an SkColor', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.setAdditive(true);
    h.target.fillCircle(5, 6, 2, 255, 128, 0, 0.16);
    expect(h.draws[0]).toEqual({
      op: 'circle', cx: 5, cy: 6, r: 2, paint: 'halo',
      color: f32([1, 128 / 255, 0, 0.16]),
    });
  });

  it('turns a centred ellipse into an SkRect, and draws lit cores opaque', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.fillEllipse(10, 20, 2, 3, 1, 2, 3);
    expect(h.draws[0]).toEqual({
      op: 'oval',
      rect: { x: 8, y: 17, width: 4, height: 6 },
      paint: 'core',
      color: f32([1 / 255, 2 / 255, 3 / 255, 1]),
    });
  });

  it('takes the painter snap verbatim for square cores — top-left, no rounding', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.fillRect(7, 9, 2, 2, 10, 20, 30);
    expect(h.draws[0]).toEqual({
      op: 'rect',
      rect: { x: 7, y: 9, width: 2, height: 2 },
      paint: 'core',
      color: f32([10 / 255, 20 / 255, 30 / 255, 1]),
    });
  });

  it('inks both ghost shapes with PIXEL_GHOST_INK', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.fillGhostRect(1, 2, 3, 4);
    h.target.fillGhostEllipse(10, 20, 2, 3);
    const ghost = cssColorToSkColor(PIXEL_GHOST_INK, new Float32Array(4));
    expect(h.draws[0].color).toEqual(Array.from(ghost));
    expect(h.draws[1].color).toEqual(Array.from(ghost));
    expect(h.draws[1]).toMatchObject({
      op: 'oval',
      rect: { x: 8, y: 17, width: 4, height: 6 },
    });
  });

  it('reopens each frame with the additive window CLOSED', () => {
    const h = harness({ w: 100, h: 100 });
    h.target.begin();
    h.target.setAdditive(true);
    h.target.end();
    h.target.begin();
    h.target.fillRect(0, 0, 1, 1, 1, 1, 1);
    expect(h.draws[0].paint).toBe('core');
  });
});
