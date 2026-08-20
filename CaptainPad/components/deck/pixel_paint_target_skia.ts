/**
 * pixel_paint_target_skia — the NATIVE half of the `PixelPaintTarget` seam.
 *
 * The iPad draws the same ship as the browser, from the same pass order in
 * `pixel_view_paint.ts`, onto an `SkCanvas` recorded into an `SkPicture`
 * (report _252, docs/60 §3). One picture per frame goes into a Reanimated
 * shared value, so the vis path still touches React ZERO times — the redraw
 * happens on the render thread.
 *
 * ── WHY THE SKIA API ARRIVES BY INJECTION ───────────────────────────────────
 *
 * This module imports NOTHING from `@shopify/react-native-skia`. It declares
 * the four structural shapes it uses and takes the factories from its caller
 * (`pixel_surface.tsx`, the only file that imports Skia for real). That is the
 * same idiom the paint scheduler uses for its clock: the adapter is then plain
 * TypeScript and its whole call sequence is unit-tested in node against a
 * recording fake canvas, with no simulator and no device.
 *
 * ── NO ALLOCATION PER GLYPH ─────────────────────────────────────────────────
 *
 * TWO paints are built once by the surface and reused for every glyph — one
 * pre-set to `BlendMode.Plus` (the additive halo pass) and one to `SrcOver`
 * (cores and ghosts) — exactly mirroring the web adapter's `globalCompositeOperation`
 * windowing. Colour goes through ONE reused `Float32Array`: Skia copies the
 * four floats into the paint at `setColor`, and the draw call bakes that paint
 * into the display list, so the buffer is free to be overwritten immediately.
 * The only per-frame allocations are the rect literal and the picture itself.
 */
import { PIXEL_GHOST_INK } from '@/components/deck/pixel_view_logic';
import type { PixelPaintTarget } from '@/components/deck/pixel_view_paint';

/** `SkRect` — a plain `{x,y,width,height}` record in RN Skia. */
export interface SkRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The `SkPaint` surface this adapter touches. Blend mode and anti-alias are
 *  set ONCE by the surface; only the colour changes per glyph. */
export interface SkPaintLike {
  setColor(color: Float32Array): void;
}

/** The `SkCanvas` surface this adapter touches. */
export interface SkCanvasLike {
  drawCircle(cx: number, cy: number, radius: number, paint: SkPaintLike): void;
  drawOval(oval: SkRectLike, paint: SkPaintLike): void;
  drawRect(rect: SkRectLike, paint: SkPaintLike): void;
}

/** The `SkPictureRecorder` surface this adapter touches. */
export interface SkPictureRecorderLike<TPicture> {
  beginRecording(bounds?: SkRectLike): SkCanvasLike;
  finishRecordingAsPicture(): TPicture;
}

export interface SkiaPaintTargetDeps<TPicture> {
  /** `Skia.PictureRecorder` — one per recorded frame. */
  createRecorder: () => SkPictureRecorderLike<TPicture>;
  /** Pre-built, `BlendMode.Plus`. Used for the additive halo pass. */
  haloPaint: SkPaintLike;
  /** Pre-built, `BlendMode.SrcOver`. Used for the stage, cores and ghosts. */
  corePaint: SkPaintLike;
  /** Current surface size in DP. RN Skia's canvas is already in DP and the
   *  surface is device-pixel backed, so there is no DPR transform here — the
   *  half-pixel snapping the painter applies lands on whole device pixels for
   *  the same reason it does on the web at DPR 2. */
  getSize: () => { w: number; h: number };
  /** Called once per completed frame with the finished picture. */
  onPicture: (picture: TPicture) => void;
}

/**
 * Parse the two CSS colour constants this surface uses into an `SkColor`
 * (a `Float32Array` of r,g,b,a in 0..1).
 *
 * Deliberately NOT Skia's own parser: `PIXEL_STAGE_BG` (`#0b0d12`) and
 * `PIXEL_GHOST_INK` (`rgba(150,170,205,0.20)`) are the only strings that ever
 * reach it, this conversion is then unit-testable in node, and anything else
 * throws by name instead of quietly rendering the wrong colour.
 */
export function cssColorToSkColor(css: string, out: Float32Array): Float32Array {
  const text = css.trim();

  if (text.charAt(0) === '#') {
    const hex = text.slice(1);
    if (hex.length !== 6) {
      throw new Error(`[pixel_paint_target_skia] unsupported hex colour ${css}`);
    }
    const value = Number.parseInt(hex, 16);
    if (!Number.isFinite(value)) {
      throw new Error(`[pixel_paint_target_skia] unparseable hex colour ${css}`);
    }
    out[0] = ((value >> 16) & 0xff) / 255;
    out[1] = ((value >> 8) & 0xff) / 255;
    out[2] = (value & 0xff) / 255;
    out[3] = 1;
    return out;
  }

  const match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (!match) throw new Error(`[pixel_paint_target_skia] unsupported colour ${css}`);
  const parts = match[1].split(',').map((piece) => Number(piece.trim()));
  if (parts.length < 3 || parts.length > 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`[pixel_paint_target_skia] unparseable colour ${css}`);
  }
  out[0] = parts[0] / 255;
  out[1] = parts[1] / 255;
  out[2] = parts[2] / 255;
  out[3] = parts.length === 4 ? parts[3] : 1;
  return out;
}

/**
 * Wrap a picture recorder as a paint target.
 *
 * `begin()` answers `null` for a zero-sized surface exactly as the canvas
 * adapter does, and in that case NO recording is started and NO picture is
 * emitted — the shared value keeps whatever it last held rather than being
 * blanked by a frame nobody could draw.
 */
export function createSkiaPaintTarget<TPicture>(
  deps: SkiaPaintTargetDeps<TPicture>,
): PixelPaintTarget {
  const color = new Float32Array(4);
  let recorder: SkPictureRecorderLike<TPicture> | null = null;
  let canvas: SkCanvasLike | null = null;
  let additive = false;
  let w = 0;
  let h = 0;

  /** The paint the CURRENT pass writes through — the native mirror of the web
   *  adapter's `globalCompositeOperation` window. */
  function pass(): SkPaintLike {
    return additive ? deps.haloPaint : deps.corePaint;
  }

  function paintWith(cr: number, cg: number, cb: number, alpha: number): SkPaintLike {
    const paint = pass();
    color[0] = cr / 255;
    color[1] = cg / 255;
    color[2] = cb / 255;
    color[3] = alpha;
    paint.setColor(color);
    return paint;
  }

  function ghostPaint(): SkPaintLike {
    const paint = pass();
    paint.setColor(cssColorToSkColor(PIXEL_GHOST_INK, color));
    return paint;
  }

  return {
    begin() {
      const size = deps.getSize();
      if (!(size.w > 0) || !(size.h > 0)) return null;
      w = size.w;
      h = size.h;
      recorder = deps.createRecorder();
      canvas = recorder.beginRecording({ x: 0, y: 0, width: w, height: h });
      additive = false;
      return { w, h };
    },

    clear(css: string) {
      const paint = deps.corePaint;
      paint.setColor(cssColorToSkColor(css, color));
      (canvas as SkCanvasLike).drawRect({ x: 0, y: 0, width: w, height: h }, paint);
    },

    setAdditive(on: boolean) { additive = on; },

    fillCircle(
      x: number, y: number, r: number,
      cr: number, cg: number, cb: number, alpha: number,
    ) {
      (canvas as SkCanvasLike).drawCircle(x, y, r, paintWith(cr, cg, cb, alpha));
    },

    fillEllipse(
      x: number, y: number, rx: number, ry: number,
      cr: number, cg: number, cb: number,
    ) {
      (canvas as SkCanvasLike).drawOval(
        { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 },
        paintWith(cr, cg, cb, 1),
      );
    },

    fillGhostEllipse(x: number, y: number, rx: number, ry: number) {
      (canvas as SkCanvasLike).drawOval(
        { x: x - rx, y: y - ry, width: rx * 2, height: ry * 2 },
        ghostPaint(),
      );
    },

    fillRect(
      x: number, y: number, rw: number, rh: number,
      cr: number, cg: number, cb: number,
    ) {
      (canvas as SkCanvasLike).drawRect(
        { x, y, width: rw, height: rh },
        paintWith(cr, cg, cb, 1),
      );
    },

    fillGhostRect(x: number, y: number, rw: number, rh: number) {
      (canvas as SkCanvasLike).drawRect({ x, y, width: rw, height: rh }, ghostPaint());
    },

    end() {
      const active = recorder;
      recorder = null;
      canvas = null;
      if (!active) throw new Error('[pixel_paint_target_skia] end() without begin()');
      deps.onPicture(active.finishRecordingAsPicture());
    },
  };
}
