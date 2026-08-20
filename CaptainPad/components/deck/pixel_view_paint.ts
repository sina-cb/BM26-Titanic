/**
 * pixel_view_paint — the ONE imperative paint every pixel-view surface uses.
 *
 * Extracted verbatim from `pixel_view_window.tsx` (report _225/_239) when the
 * mixer grew its own pixel-view bands (docs/58): two surfaces drawing the same
 * ship from the same buffers must not be two copies of the halo pass, the
 * ghost ink, the half-pixel snapping and the glyph floor. A fork here would
 * mean the deck and the mixer slowly disagreeing about what the rig looks
 * like, which is the one thing a monitoring surface may never do.
 *
 * Report _252 widened that rule from two SURFACES to two PLATFORMS. The pass
 * order below is now platform-neutral: it emits into a `PixelPaintTarget`,
 * which a browser fulfils with a 2D context (`pixel_paint_target_canvas.ts`)
 * and the iPad fulfils with an `SkCanvas` recorded into an `SkPicture`
 * (`pixel_paint_target_skia.ts`). Nothing about the drawing changed in that
 * move either — the geometry, colour and honesty arithmetic all still live in
 * `pixel_view_logic.ts`; this module only owns the ORDER of the passes.
 */
import {
  PIXEL_STAGE_BG,
  previewBrighten,
  layoutView,
  sampleToDisplayRgb,
  type FlatPixelView,
  type PixelViewDesign,
} from '@/components/deck/pixel_view_logic';

/** Glow pass geometry. A pixel's halo is drawn additively so overlapping
 *  strands bloom into each other the way real LEDs do. */
export const GLOW_SCALE = 2.1;
export const GLOW_ALPHA = 0.16;
/** Below this display luminance a pixel is dark enough to skip the glow pass
 *  entirely — most of the rig is off most of the time, and this is what keeps
 *  the frame cost proportional to the LIT pixels rather than to all of them. */
export const GLOW_MIN_LUMA = 24;
/** Minimum on-screen size of a glyph, in CSS px. The sim's design units shrink
 *  a strand pixel to well under a pixel in a deck column (and further in a
 *  112 px mixer band); without a floor the ship dissolves into grey mush at
 *  exactly the sizes these surfaces run at. */
export const MIN_GLYPH_PX = 1.6;

/**
 * The whole vocabulary this drawing needs: a ground, an additive window, three
 * glyph shapes and two inks. Small on purpose — every method a target has to
 * implement is a method two platforms have to agree about.
 *
 * Colours arrive as 0-255 channel NUMBERS rather than CSS strings so the Skia
 * target never has to parse anything on the frame path; the canvas target
 * builds the same `rgb()`/`rgba()` strings the painter used to build inline.
 */
export interface PixelPaintTarget {
  /** Size the backing store and answer the surface size in CSS px / DP.
   *  `null` = nothing to draw onto (no context, or a zero-sized surface). */
  begin(): { w: number; h: number } | null;
  /** Paint the stage ground edge to edge (`PIXEL_STAGE_BG`). */
  clear(color: string): void;
  /** Open (`true`) and close (`false`) the additive halo window. */
  setAdditive(on: boolean): void;
  /** Halo glyph. */
  fillCircle(
    x: number, y: number, r: number,
    cr: number, cg: number, cb: number, alpha: number,
  ): void;
  /** Lit core of a ROUND pixel. `x,y` is the centre. */
  fillEllipse(
    x: number, y: number, rx: number, ry: number,
    cr: number, cg: number, cb: number,
  ): void;
  /** Unlit core of a ROUND pixel, in `PIXEL_GHOST_INK`. */
  fillGhostEllipse(x: number, y: number, rx: number, ry: number): void;
  /** Lit core of a SQUARE pixel. `x,y` is the TOP-LEFT and every argument is
   *  already half-pixel snapped by the painter — a target must not re-round,
   *  because two targets rounding independently is exactly the drift this seam
   *  exists to prevent. */
  fillRect(
    x: number, y: number, w: number, h: number,
    cr: number, cg: number, cb: number,
  ): void;
  /** Unlit core of a SQUARE pixel, in `PIXEL_GHOST_INK`. Same snapped
   *  top-left/size contract as `fillRect`. */
  fillGhostRect(x: number, y: number, w: number, h: number): void;
  /** The frame is complete — commit it (a no-op for an immediate-mode
   *  context, the picture handoff for Skia). */
  end(): void;
}

export interface PixelViewDrawState {
  flat: FlatPixelView;
  design: PixelViewDesign;
  /** Glyph → transmitted-sample lookup, ONLY when the engine capped the
   *  broadcast. `null` = full rate: every glyph reads its own model pixel
   *  straight out of `flat.modelIndex` and no resampling happens at all. */
  lut: Int32Array | null;
  /** Latest decoded vis buffer (RGBWAU), or null before the first frame. */
  samples: Uint8Array | null;
  sampleCount: number;
  /** Have we resolved a lookup for `sampleCount` yet? (`lut` is legitimately
   *  null at full rate, so it cannot double as the "not built" flag.) */
  lutReady: boolean;
}

/**
 * Draw `state`'s current frame into `target`. Returns false when there was
 * nothing to draw onto (the target refused to begin — no drawing context, or a
 * zero-sized surface because it is collapsed or off-screen), so a caller can
 * tell "skipped" from "painted".
 *
 * This function touches React zero times, allocates nothing per glyph, and is
 * safe to call at any cadence: the shared paint scheduler
 * (`components/mixer/pixel_paint_scheduler.ts`) is what decides how often it
 * actually runs.
 */
export function paintPixelView(target: PixelPaintTarget, state: PixelViewDrawState): boolean {
  const size = target.begin();
  if (!size) return false;
  const cssW = size.w;
  const cssH = size.h;

  // The stage is painted, not cleared: the ground is the sim's fixed
  // near-black on EVERY theme (see PIXEL_STAGE_BG). Light is only legible on
  // dark, and this surface's content is light.
  target.clear(PIXEL_STAGE_BG);

  const { flat, samples } = state;
  // ONE transform per panel: a view's panels each fill the sim's whole
  // design space and must be given their own column, or the two halves of
  // the ship land on top of each other (report _239).
  const transforms = layoutView(flat, state.design, cssW, cssH);
  // Full rate ⇒ no lookup table at all; the glyph's own model index IS the
  // sample index (see buildSampleLookup).
  const lut = state.lut || flat.modelIndex;
  const haveColour = samples !== null && state.lutReady;
  const rgb = { r: 0, g: 0, b: 0 };

  // ── Pass A: additive halos, LIT pixels only ──────────────────────────
  // Drawn first and additively so overlapping strands bloom together
  // instead of the last one painted winning.
  if (samples && haveColour) {
    target.setAdditive(true);
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
        target.fillCircle(x, y, r, rgb.r, rgb.g, rgb.b, GLOW_ALPHA);
      }
    }
    target.setAdditive(false);
  }

  // ── Pass B: the crisp cores ──────────────────────────────────────────
  // Every mapped pixel, always — an unlit one as a faint ghost so the ship
  // keeps its shape through a blackout.
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

      if (flat.round[i]) {
        if (lit) target.fillEllipse(x, y, w / 2, h / 2, rgb.r, rgb.g, rgb.b);
        else target.fillGhostEllipse(x, y, w / 2, h / 2);
      } else {
        // Half-pixel snapping keeps a 2px square a SQUARE rather than a
        // 3px-wide smear of two half-lit columns. This is the whole
        // difference between "pixel art" and "blurry dots" — and it is done
        // HERE, once, so both platforms snap identically by construction.
        const left = Math.round(x - w / 2);
        const top = Math.round(y - h / 2);
        const rw = Math.max(1, Math.round(w));
        const rh = Math.max(1, Math.round(h));
        if (lit) target.fillRect(left, top, rw, rh, rgb.r, rgb.g, rgb.b);
        else target.fillGhostRect(left, top, rw, rh);
      }
    }
  }

  target.end();
  return true;
}
