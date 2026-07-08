/**
 * effects/palette_crush.js — E6 Palette Crush (Posterize)
 *
 * Quantizes the RGB triad of the post-mixer pixel buffer to N discrete
 * levels per channel, then blends the quantized value back toward the
 * original by `amount`. Smooth gradients collapse into bold stepped
 * bands — an instant "harder" color grammar (docs report-1 §E6).
 *
 * RULE (mission-critical, mirrors effects/invert.js & hue_shift.js): this
 * is a CHROMA op, so ONLY the RGB triad is touched. W (warm white),
 * A (amber) and U (UV) carry no color concept and would corrupt the
 * mission-critical exterior whites if quantized — the loop NEVER reads or
 * writes px.w / px.a / px.u.
 *
 * Stateless: no buffers, no phase, no per-effect state. The controller
 * owns the enabled flag; this module is pure math and the cheapest effect
 * in the library.
 *
 * GATING (Codex P0, zero-cost default): the caller MUST early-return when
 * disabled. This function also early-returns when `amount <= 0` (nothing
 * to blend) as a defensive no-op.
 *
 * Per-frame cost: ~9 ops/px (3 channels × [mul, round, mul, lerp]) plus a
 * single reciprocal computed once per frame. Allocation-free hot loop.
 */

const MIN_LEVELS = 2;
const MAX_LEVELS = 8;

/**
 * Quantize a [0..1] value to `levels` evenly-spaced steps.
 *   levels=2 → {0, 1};  levels=4 → {0, 1/3, 2/3, 1}
 * @param {number} v      input in [0..1]
 * @param {number} steps  levels - 1 (precomputed by the caller)
 * @param {number} inv    1 / steps (precomputed by the caller)
 */
function quantize(v, steps, inv) {
  return Math.round(v * steps) * inv;
}

/**
 * Posterize the RGB of every pixel in place. W/A/U untouched.
 *
 * @param {object}  args
 * @param {Array}   args.pixels  Post-mixer model.pixels (objects with r/g/b floats 0..1).
 * @param {number}  args.levels  Discrete levels per channel, clamped to [2..8].
 * @param {number}  args.amount  Crush blend in [0..1] (0 = original, 1 = fully quantized).
 */
export function applyPaletteCrush({ pixels, levels, amount }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyPaletteCrush: pixels array is required');
  }
  const amt = amount < 0 ? 0 : amount > 1 ? 1 : amount;
  // Defensive no-op — the controller also gates this off entirely.
  if (amt <= 0) return;

  // Clamp + integer-snap the level count, then precompute the step math once.
  let lv = Math.round(levels);
  if (lv < MIN_LEVELS) lv = MIN_LEVELS;
  if (lv > MAX_LEVELS) lv = MAX_LEVELS;
  const steps = lv - 1;
  const inv = 1 / steps;
  const iamt = 1 - amt;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    // W/A/U (px.w / px.a / px.u) are NOT touched. mix(px, quantize(px)).
    px.r = px.r * iamt + quantize(px.r, steps, inv) * amt;
    px.g = px.g * iamt + quantize(px.g, steps, inv) * amt;
    px.b = px.b * iamt + quantize(px.b, steps, inv) * amt;
  }
}

export const paletteCrushEffect = {
  apply: applyPaletteCrush,
  quantize,
  MIN_LEVELS,
  MAX_LEVELS,
};
