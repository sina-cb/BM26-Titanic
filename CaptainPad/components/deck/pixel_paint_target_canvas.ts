/**
 * pixel_paint_target_canvas — the WEB half of the `PixelPaintTarget` seam.
 *
 * Everything in here was LIFTED, not rewritten, out of `pixel_view_paint.ts`
 * (report _252): the DPR backing-store block, the `lighter` composite, the
 * `rgba()`/`rgb()` colour strings and the ghost ink are byte-for-byte what the
 * painter used to do inline. That is the whole point — the refactor that let
 * the iPad draw the same ship with Skia may not move a single web pixel, and
 * the parity gate in `pixel_paint_target_canvas.test.ts` pins the exact call
 * sequence this adapter makes against a recording 2D context.
 *
 * This module is imported ONLY by `pixel_surface.web.tsx`, so nothing about a
 * browser 2D context ever reaches the native bundle.
 */
import { PIXEL_GHOST_INK } from '@/components/deck/pixel_view_logic';
import type { PixelPaintTarget } from '@/components/deck/pixel_view_paint';

/** Backing-store cap. Above 2× the extra pixels cost real milliseconds and buy
 *  nothing the eye can find on a 1.6 px glyph. */
export const CANVAS_MAX_DPR = 2;

/** The 2D-context surface this adapter actually uses. Declared structurally so
 *  the parity test can drive a recording fake with no browser. */
export interface Canvas2DContextLike {
  /** Widened to `string | object` only so a real `CanvasRenderingContext2D`
   *  (whose `fillStyle` also admits gradients and patterns) satisfies this
   *  interface. This adapter never assigns anything but a CSS colour string. */
  fillStyle: string | object;
  globalCompositeOperation: string;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(
    x: number, y: number, rx: number, ry: number,
    rotation: number, start: number, end: number,
  ): void;
  fill(): void;
}

export interface Canvas2DElementLike {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getContext(kind: '2d'): Canvas2DContextLike | null;
}

/**
 * Wrap a `<canvas>` as a paint target.
 *
 * The context is resolved lazily on the first `begin()` and then kept: a canvas
 * hands back the SAME context object every time, so re-asking per frame was
 * only ever a lookup. A canvas that has no 2D context, or that is currently
 * zero-sized (collapsed or off-screen), answers `null` from `begin()` — which
 * is how `paintPixelView` still tells "skipped" from "painted".
 */
export function createCanvasPaintTarget(canvas: Canvas2DElementLike): PixelPaintTarget {
  let ctx: Canvas2DContextLike | null = null;
  let w = 0;
  let h = 0;

  return {
    begin() {
      if (!ctx) ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const dpr = Math.min(
        CANVAS_MAX_DPR,
        (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1,
      );
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (cssW <= 0 || cssH <= 0) return null;
      const wantW = Math.max(1, Math.round(cssW * dpr));
      const wantH = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width = wantW;
        canvas.height = wantH;
      }

      // AFTER the resize: writing width/height resets the context state.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = cssW;
      h = cssH;
      return { w: cssW, h: cssH };
    },

    clear(color: string) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
    },

    setAdditive(on: boolean) {
      (ctx as Canvas2DContextLike).globalCompositeOperation = on ? 'lighter' : 'source-over';
    },

    fillCircle(x, y, r, cr, cg, cb, alpha) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    },

    fillEllipse(x, y, rx, ry, cr, cg, cb) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = `rgb(${cr},${cg},${cb})`;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    },

    fillGhostEllipse(x, y, rx, ry) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = PIXEL_GHOST_INK;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    },

    fillRect(x, y, rw, rh, cr, cg, cb) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = `rgb(${cr},${cg},${cb})`;
      c.fillRect(x, y, rw, rh);
    },

    fillGhostRect(x, y, rw, rh) {
      const c = ctx as Canvas2DContextLike;
      c.fillStyle = PIXEL_GHOST_INK;
      c.fillRect(x, y, rw, rh);
    },

    end() {
      // A 2D context draws as it is told; there is nothing to commit.
    },
  };
}
