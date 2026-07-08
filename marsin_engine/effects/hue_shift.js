/**
 * effects/hue_shift.js — Hue rotation reference implementation (RGB-only)
 *
 * Stateless YIQ hue rotation on float pixel objects (0..1 with
 * .r/.g/.b/.w/.a/.u). Pure math, no runtime state.
 *
 * NOTE (2026-07, operator decision): the GLOBAL post-mixer hue shifter
 * that used to call this every frame was REMOVED — hue is PER-CHANNEL
 * ONLY now, applied on the interleaved byte buffers by
 * `applyHueShift6chU8` in lib/pattern_mixer.js (the SAME YIQ rotation,
 * expressed on 0-255 bytes). This float module stays as the reference
 * implementation + unit-test ground truth for that rotation.
 *
 * RULE (mission-critical, docs/39 §F-hue): only the RGB triad is
 * rotated. W (warm white), A (amber) and U (UV) carry NO hue concept —
 * rotating them would dim or tint the mission-critical exterior whites
 * the Titanic depends on at night. They are left BYTE-FOR-BYTE untouched
 * here (the loop never reads or writes px.w / px.a / px.u).
 *
 * Hue rotation is the classic luminance-preserving YIQ rotation: convert
 * RGB→YIQ, rotate the (I,Q) chroma plane by the hue angle, convert back.
 * Collapsed to a single 3x3 RGB→RGB matrix whose coefficients depend only
 * on cos(theta)/sin(theta) — so we precompute cos/sin ONCE per call and
 * spend ~9 multiplies per pixel. Reference matrix (Graphics Gems /
 * standard NTSC luma weights 0.299/0.587/0.114).
 *
 * GATING (Codex P0, zero-cost default): the caller MUST early-return at
 * degrees === 0 so the default rig pays nothing. This function also
 * early-returns at a zero rotation as a defensive belt-and-suspenders, so
 * a direct call is still a no-op at 0.
 *
 * Allocation-free: no per-call array/object creation in the hot path.
 */

const DEG_TO_RAD = Math.PI / 180;

/**
 * Rotate the RGB hue of every pixel by `degrees` in place. W/A/U untouched.
 *
 * @param {object}  args
 * @param {Array}   args.pixels   Post-mixer model.pixels (objects with r/g/b floats).
 * @param {number}  args.degrees  Hue rotation in degrees. 0 ⇒ no-op.
 */
export function applyHueShift({ pixels, degrees }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyHueShift: pixels array is required');
  }
  // Belt-and-suspenders no-op at the default; the gate also lives in the
  // controller so the hot path is skipped entirely at hue=0.
  if (!degrees) return;

  const theta = degrees * DEG_TO_RAD;
  const c = Math.cos(theta);
  const s = Math.sin(theta);

  // YIQ hue-rotation matrix coefficients (NTSC luma weights). Computed
  // ONCE per call from cos/sin; the per-pixel loop is pure arithmetic.
  const m00 = 0.299 + 0.701 * c + 0.168 * s;
  const m01 = 0.587 - 0.587 * c + 0.330 * s;
  const m02 = 0.114 - 0.114 * c - 0.497 * s;

  const m10 = 0.299 - 0.299 * c - 0.328 * s;
  const m11 = 0.587 + 0.413 * c + 0.035 * s;
  const m12 = 0.114 - 0.114 * c + 0.292 * s;

  const m20 = 0.299 - 0.300 * c + 1.250 * s;
  const m21 = 0.587 - 0.588 * c - 1.050 * s;
  const m22 = 0.114 + 0.886 * c - 0.203 * s;

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const r = px.r;
    const g = px.g;
    const b = px.b;

    // Rotate, then clamp back into [0,1] (the rotation can push a fully
    // saturated channel slightly out of gamut). W/A/U are NOT touched.
    let nr = m00 * r + m01 * g + m02 * b;
    let ng = m10 * r + m11 * g + m12 * b;
    let nb = m20 * r + m21 * g + m22 * b;

    if (nr < 0) nr = 0; else if (nr > 1) nr = 1;
    if (ng < 0) ng = 0; else if (ng > 1) ng = 1;
    if (nb < 0) nb = 0; else if (nb > 1) nb = 1;

    px.r = nr;
    px.g = ng;
    px.b = nb;
  }
}

export const hueShiftEffect = {
  apply: applyHueShift,
};
