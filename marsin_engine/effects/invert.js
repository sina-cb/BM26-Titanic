/**
 * effects/invert.js — GLOBAL color Invert (post-composite, RGB-only)
 *
 * Stateless RGB inversion applied to the post-mixer pixel buffer
 * (model.pixels, floats 0..1 with .r/.g/.b/.w/.a/.u). Runtime state
 * (the enabled flag) is owned by GlobalEffectsController; this module is
 * pure math.
 *
 * RULE (mission-critical, docs/39 §F-invert): only the RGB triad is
 * inverted (1 - v). W (warm white), A (amber) and U (UV) carry NO color
 * concept — flipping them would invert the mission-critical exterior
 * whites the Titanic depends on at night, turning a lit hull dark. They
 * are left BYTE-FOR-BYTE untouched here (the loop never reads or writes
 * px.w / px.a / px.u). This mirrors effects/hue_shift.js, which protects
 * the same channels for the same reason.
 *
 * GATING (Codex P0, zero-cost default): the caller MUST early-return when
 * disabled so the default rig pays nothing. This function also early-
 * returns when `enabled` is false as a defensive belt-and-suspenders, so a
 * direct call is still a no-op when off.
 *
 * Allocation-free: no per-call array/object creation in the hot path.
 */

/**
 * Invert the RGB of every pixel (1 - v) in place. W/A/U untouched.
 *
 * @param {object}  args
 * @param {Array}   args.pixels   Post-mixer model.pixels (objects with r/g/b floats).
 * @param {boolean} args.enabled  When false ⇒ no-op.
 */
export function applyInvert({ pixels, enabled }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyInvert: pixels array is required');
  }
  // Belt-and-suspenders no-op when off; the gate also lives in the
  // controller so the hot path is skipped entirely when invert is off.
  if (!enabled) return;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    // W/A/U (px.w / px.a / px.u) are NOT touched. Clamp the inverted value into
    // [0,1] — an over-gamut input (e.g. an additive blend leaving r=1.2) would
    // otherwise invert to a negative, leaving an out-of-range value in the
    // buffer for any downstream stage. Mirrors hue_shift's post-clamp.
    px.r = clamp01(1 - px.r);
    px.g = clamp01(1 - px.g);
    px.b = clamp01(1 - px.b);
  }
}

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

export const invertEffect = {
  apply: applyInvert,
  // Primary intensity: NONE. Invert is a pure boolean chroma flip with no
  // tunable magnitude, so it declares `null` explicitly (a deliberate "no
  // primary" — distinct from a MISSING declaration, which the registry
  // treats as a loud startup error). A slot bound to invert reports no
  // intensity and the intensity endpoints 400 for it.
  primaryIntensity: null,
  // Primary mode: NONE. No discrete secondary control — explicit null.
  primaryMode: null,
};
