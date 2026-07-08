/**
 * effects/e2_waterline_sweep.js — E2 Waterline Sweep (report 20260708_2)
 *
 * A soft-edged band of light rolls across the rig using the pixels' own
 * normalized coordinates (nx / ny / nz, each in [0..1]) versus a moving
 * head position. The Titanic's "rising tide". First spatial global effect
 * in the library — every other effect is coordinate-blind.
 *
 * Two modes:
 *   - 'add'    (overlay): boost channels toward color6 where the band is
 *              (add color6 * t * amount, clamped). Additive brightness
 *              gesture — touches all 6 channels, u defaults to 0 in the
 *              preset color so UV boost is a deliberate opt-in.
 *   - 'darken' (gate): scale channels down by (1 - t * amount) where the
 *              band is — a moving shadow/wipe.
 *
 * Band shape: triangular falloff `t = 1 - |coord - head| / width`, then
 * squared to soften the edge. `t` is 0 outside the band, 1 at the head.
 *
 * Stateless: the controller owns the enabled flag, params, and the moving
 * head position (free-run or tempo-synced). Pure math here.
 *
 * Chain position: step 1.5 (AFTER colorWash, BEFORE feedbackTrails) so
 * trails capture the band and give it a free comet tail.
 *
 * ~10 ops/px, allocation-free, zero-cost when off (caller gates).
 */

/**
 * Select the normalized coordinate for a pixel on the chosen axis.
 * Falls back to 0 when a pixel lacks the field (some fixtures don't carry
 * coords — same `|| 0` convention as wasm_host). 'radial' uses distance
 * from the model center (0.5, 0.5) in the nx/ny plane, normalized to
 * [0..1] (max corner distance ~0.707 → /0.7071 keeps it in range-ish; we
 * clamp so a stray corner never overshoots the band math).
 *
 * @param {object} px    Pixel with optional nx/ny/nz.
 * @param {string} axis  'x' | 'y' | 'z' | 'radial'
 * @returns {number} coordinate in [0..1].
 */
export function axisCoord(px, axis) {
  if (axis === 'x') return px.nx || 0;
  if (axis === 'y') return px.ny || 0;
  if (axis === 'z') return px.nz || 0;
  // radial
  const dx = (px.nx || 0) - 0.5;
  const dy = (px.ny || 0) - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy) / 0.7071067811865476;
  return d > 1 ? 1 : d;
}

/**
 * Apply the waterline sweep band.
 *
 * @param {object}   args
 * @param {Array}    args.pixels   Post-mixer model.pixels (with nx/ny/nz).
 * @param {number}   args.head     Band center position, 0..1.
 * @param {number}   args.width    Band half-width, >0. Larger = softer/wider.
 * @param {number}   args.amount   0..1 effect strength.
 * @param {string}   args.axis     'x' | 'y' | 'z' | 'radial'.
 * @param {string}   args.mode     'add' (default) | 'darken'.
 * @param {number[]} args.color6   RGBWAU 6-tuple for 'add' mode.
 */
export function applyWaterlineSweep({ pixels, head, width, amount, axis = 'y', mode = 'add', color6 }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyWaterlineSweep: pixels array is required');
  }
  const amt = amount < 0 ? 0 : (amount > 1 ? 1 : amount);
  if (amt <= 0) return;
  const w = width > 0 ? width : 0.0001; // guard divide-by-zero
  const isAdd = mode !== 'darken';
  if (isAdd && (!Array.isArray(color6) || color6.length < 6)) {
    throw new Error('applyWaterlineSweep: color6 must be a 6-element array for add mode');
  }
  const c0 = isAdd ? color6[0] : 0;
  const c1 = isAdd ? color6[1] : 0;
  const c2 = isAdd ? color6[2] : 0;
  const c3 = isAdd ? color6[3] : 0;
  const c4 = isAdd ? color6[4] : 0;
  const c5 = isAdd ? color6[5] : 0;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const d = axisCoord(px, axis);
    let t = 1 - Math.abs(d - head) / w;
    if (t <= 0) continue; // outside the band — untouched
    t = t * t; // soften the edge
    const s = t * amt;
    if (isAdd) {
      px.r = Math.min(1, px.r + c0 * s);
      px.g = Math.min(1, px.g + c1 * s);
      px.b = Math.min(1, px.b + c2 * s);
      px.w = Math.min(1, px.w + c3 * s);
      px.a = Math.min(1, px.a + c4 * s);
      px.u = Math.min(1, px.u + c5 * s);
    } else {
      const k = 1 - s; // darken toward 0 at the band center
      px.r *= k;
      px.g *= k;
      px.b *= k;
      px.w *= k;
      px.a *= k;
      px.u *= k;
    }
  }
}

export const waterlineSweepEffect = {
  apply: applyWaterlineSweep,
  axisCoord,
};
