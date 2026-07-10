/**
 * effects/e1_beat_pump.js — E1 Beat Pump (report 20260708_2 Table 2)
 *
 * BPM-locked sidechain duck: the whole rig's brightness dips on the beat
 * and swells back, like a sidechained pad. Pure global luminance gate —
 * scales all 6 channels (RGBWAU) by a single per-frame factor, so it is a
 * brightness gesture (NOT a chroma op) and touches every channel exactly
 * like strobe/dropHit.
 *
 * Stateless: GlobalEffectsController owns the enabled flag + params and
 * supplies the beat phase. This module is pure math.
 *
 * Chain position: END of applyMacros (beside strobe — it IS a soft
 * strobe). Trails run BEFORE it so trail history isn't pump-modulated.
 *
 * scale = 1 - depth * (1 - pow(beatPhase, curve))
 *   - beatPhase 0..1 within the current beat (0 = just hit the beat).
 *   - at beatPhase=0: env=0 → scale = 1 - depth   (deepest dip on the kick)
 *   - as beatPhase→1: env→1 → scale → 1           (recovered before next beat)
 *   - curve>1 eases the recovery (fast dip, slow swell back).
 *
 * ~6 mults/px, allocation-free, zero-cost when off (caller gates).
 */

/**
 * Compute the per-frame pump scale factor. Returns a scalar in
 * [1-depth, 1]. Pulled out so the controller can compute it once and the
 * apply loop just multiplies.
 *
 * @param {object} args
 * @param {number} args.beatPhase  0..1 position within the current beat.
 * @param {number} args.depth      0..1 dip depth (0 = no pump).
 * @param {number} args.curve      recovery shaping exponent (>=1 typical).
 * @returns {number} scale in [1-depth, 1].
 */
export function beatPumpScale({ beatPhase, depth, curve = 2 }) {
  const p = beatPhase < 0 ? 0 : (beatPhase > 1 ? 1 : beatPhase);
  const d = depth < 0 ? 0 : (depth > 1 ? 1 : depth);
  const c = curve > 0 ? curve : 1;
  const env = c === 1 ? p : Math.pow(p, c);
  return 1 - d * (1 - env);
}

/**
 * Scale every pixel channel by a precomputed pump factor. When scale >= 1
 * (no dip this frame) the caller should skip this entirely; we still
 * guard here so a direct call at scale=1 is a cheap no-op-ish pass.
 *
 * @param {object} args
 * @param {Array}  args.pixels  Post-mixer model.pixels.
 * @param {number} args.scale   Per-frame pump factor (from beatPumpScale).
 */
export function applyBeatPump({ pixels, scale }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyBeatPump: pixels array is required');
  }
  if (scale >= 1) return; // nothing to dim this frame
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    px.r *= scale;
    px.g *= scale;
    px.b *= scale;
    px.w *= scale;
    px.a *= scale;
    px.u *= scale;
  }
}

export const beatPumpEffect = {
  apply: applyBeatPump,
  scale: beatPumpScale,
  // Primary intensity: the pump depth — how deep the rig dips on each beat
  // (0 = no duck, 1 = full blackout on the kick). Normalized 0..1 maps
  // straight onto the `depth` param.
  primaryIntensity: { label: 'Pump Depth', param: 'depth', default: 0.5, min: 0, max: 1 },
  // Primary mode: the tempo division the pump locks to (half-time, on-beat,
  // double-time). The VSN1 encoder press cycles these; writes the `rate`
  // param (beats-per-pump multiplier).
  primaryMode: { label: 'Tempo', param: 'rate', values: [0.5, 1, 2], default: 1 },
};
