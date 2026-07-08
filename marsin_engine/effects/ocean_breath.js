/**
 * effects/ocean_breath.js — E9 Ocean Breath (AMBIENT)
 *
 * A very slow full-rig luminance swell with a subtle amber-warmth drift
 * that breathes UP as the rig dims — the between-sets / sunrise / chill
 * mode (docs report-1 §E9). The one effect that needs no spatial or
 * temporal detail, so it reads perfectly everywhere including the
 * mission-critical exterior.
 *
 * This is a brightness/warmth GATE, not a chroma op: it scales all light
 * channels (R/G/B/W/U) by the swell `b`, and deliberately breathes the
 * amber floor (px.a) UP at the trough so the rig glows warm as it rests.
 * This is the one place amber is intentionally driven — it is a warmth
 * gesture, not a hue rotation. UV (px.u) rides the swell but gets no
 * warmth add.
 *
 * Self-clocked: phase is derived from `nowMs` and `periodMs` — NO signals
 * bag, NO tempo, NO audio. Stateless (no buffers).
 *
 * Per-frame math (computed ONCE per frame, not per pixel):
 *   phase = 2π * nowMs / periodMs
 *   b     = 1 - depth*(0.5 + 0.5*cos(phase))     // swell, never below 1-depth
 *   warm  = warmth*(0.5 + 0.5*cos(phase + π))    // amber peaks at the dim trough
 *
 * GATING (Codex P0, zero-cost default): the caller MUST early-return when
 * disabled. This also early-returns when depth<=0 AND warmth<=0 (nothing
 * to do) as a defensive no-op.
 *
 * Per-frame cost: one cos + a handful of scalars once per frame, then
 * ~6 mul/add per pixel. Allocation-free hot loop.
 */

const TWO_PI = Math.PI * 2;

/**
 * Compute the per-frame swell/warmth scalars. Pure — no pixel access.
 * @returns {{b: number, warm: number}}
 */
export function oceanBreathPhase({ nowMs, periodMs, depth, warmth }) {
  // A zero/negative period would divide-by-zero into NaN — fail loud rather
  // than silently freeze the breath (Codex P0: no silent fallbacks).
  if (!(periodMs > 0)) {
    throw new Error('oceanBreathPhase: periodMs must be > 0');
  }
  const phase = (TWO_PI * nowMs) / periodMs;
  const swell = 0.5 + 0.5 * Math.cos(phase);
  const b = 1 - depth * swell;                 // in [1-depth, 1]
  // cos(phase + π) === -cos(phase), so warm peaks exactly when b troughs.
  const warm = warmth * (0.5 - 0.5 * Math.cos(phase));
  return { b, warm };
}

/**
 * Apply the ocean-breath swell + amber floor to pixels in place.
 *
 * @param {object} args
 * @param {Array}  args.pixels    Post-mixer model.pixels.
 * @param {number} args.nowMs     Monotonic clock (ms).
 * @param {number} args.periodMs  Swell period (ms), must be > 0.
 * @param {number} args.depth     Swell depth in [0..1] (0 = no dimming).
 * @param {number} args.warmth    Amber-floor amount in [0..1] (0 = no warmth).
 */
export function applyOceanBreath({ pixels, nowMs, periodMs, depth, warmth }) {
  if (!Array.isArray(pixels)) {
    throw new Error('applyOceanBreath: pixels array is required');
  }
  const d = depth < 0 ? 0 : depth > 1 ? 1 : depth;
  const wm = warmth < 0 ? 0 : warmth > 1 ? 1 : warmth;
  // Defensive no-op: no swell and no warmth ⇒ identity.
  if (d <= 0 && wm <= 0) return;

  const { b, warm } = oceanBreathPhase({ nowMs, periodMs, depth: d, warmth: wm });

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    // Gate all light-bearing channels by the swell. Amber is handled below.
    px.r *= b;
    px.g *= b;
    px.b *= b;
    px.w *= b;
    px.u *= b;
    // Amber breathes UP at the trough: it rides the swell like the rest but
    // gains the warmth floor, clamped to gamut. This is the ambient seed.
    const a = px.a * b + warm;
    px.a = a > 1 ? 1 : a;
  }
}

export const oceanBreathEffect = {
  apply: applyOceanBreath,
  phase: oceanBreathPhase,
};
