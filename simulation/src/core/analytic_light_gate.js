/**
 * analytic_light_gate.js — which pixels are allowed to hold an analytic
 * SpotLight slot.
 *
 * The SpotLight pool (light_pool.js) is a FIXED, GPU-bounded set of slots,
 * handed each frame to the requesting pixels CLOSEST TO CAMERA. A slot is a
 * scarce resource: the pool size is capped precisely because too many
 * simultaneous spotlights drop frame rate and, past ~160, break WebGPU shaders
 * on some drivers.
 *
 * A SpotLight's contribution to the image is colour × intensity × falloff, so a
 * slot holding a BLACK pixel adds exactly nothing — it is pure waste, and worse,
 * it evicts a pixel that IS emitting.
 *
 * WHY THIS EXISTS (operator, 2026-07-30): *"a big leak — the par light halos on
 * the right side are being mapped, but they are not patched, please fix!"*
 * Measured live on his running titanic scene (report 20260725_82): **36 of 60
 * active pool slots — 60% of the analytic budget — were held by UNPATCHED,
 * undriven, pure-black right-side fixtures** (Right Front Wall 8, Right Back
 * Wall 8, TE Sign + TE Sign 2 12, Right Front Rails 3, Right Back Rails 3,
 * Right SmokeStacks 2), each emitting nothing, while the patched LEFT side that
 * was actually being driven got only 24. Unpatched fixtures were being mapped
 * into the light pool. He named it exactly.
 *
 * The rule is about EMISSION, not about patching — which is why it is stated
 * here in one place instead of as a patch check in the pool:
 *   - unpatched + undriven (black under `Show Unpatched (Red)` off) → no slot;
 *   - patched but at blackout (engine fader down)                   → no slot;
 *   - a group or master switched off                                 → no slot;
 *   - the same pixel one frame later, lit                            → competes
 *     on distance exactly as before.
 * Requests are rebuilt every frame, so nothing is sticky and nothing is hidden:
 * a pixel that is dark contributes nothing whether or not it holds a slot.
 *
 * Note the deliberate interaction with the operator's diagnostic: with
 * "Show Unpatched (Red)" ON, undriven fixtures are painted red (report
 * 20260725_81) — they are then genuinely emitting, and they take pool slots
 * again. That is his diagnostic doing its job, not a regression.
 */

// One 8-bit code value. Below this there is no visible light to carry: the
// preview quantises to #000000 and the analytic contribution rounds away.
export const MIN_ANALYTIC_LIGHT_LUMINANCE = 1 / 255;

/**
 * Does this colour carry light worth a pool slot?
 * @param {{r:number,g:number,b:number}} color — a THREE.Color or any {r,g,b}
 * @returns {boolean}
 */
export function emitsVisibleLight(color) {
  if (!color
    || !Number.isFinite(color.r)
    || !Number.isFinite(color.g)
    || !Number.isFinite(color.b)) {
    throw new TypeError(
      '[analytic_light_gate] emitsVisibleLight(color): a finite {r,g,b} colour is required — ' +
      'a malformed colour must fail loudly here, not silently win or lose a SpotLight slot');
  }
  return Math.max(color.r, color.g, color.b) >= MIN_ANALYTIC_LIGHT_LUMINANCE;
}
