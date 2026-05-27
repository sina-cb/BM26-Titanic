/**
 * effects/dropHit.js — Drop Hit / Whiteout envelope
 *
 * Attack → Hold → Release envelope generator + per-frame pixel apply.
 * Stateless: GlobalEffectsController owns `triggeredAtMs` per active
 * envelope.
 */

export function envelopeValue({ elapsedMs, attackMs, holdMs, releaseMs }) {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < attackMs) {
    return attackMs > 0 ? elapsedMs / attackMs : 1.0;
  }
  if (elapsedMs < attackMs + holdMs) {
    return 1.0;
  }
  const r = elapsedMs - attackMs - holdMs;
  if (r < releaseMs) {
    return releaseMs > 0 ? 1.0 - r / releaseMs : 0.0;
  }
  return 0.0;
}

export function envelopeDurationMs({ attackMs, holdMs, releaseMs }) {
  return Math.max(0, attackMs) + Math.max(0, holdMs) + Math.max(0, releaseMs);
}

/**
 * Apply a drop-hit punch to pixels.
 * @param {object} args
 * @param {Array}  args.pixels
 * @param {number[]} args.color6  RGBWAU 6-tuple in [0..1].
 * @param {number} args.amount    Envelope value × intensity in [0..1].
 * @param {string} args.blendMode 'add' (default) | 'replace' | 'max'
 */
export function applyDropHit({ pixels, color6, amount, blendMode = 'add' }) {
  if (amount <= 0.001) return;
  if (!Array.isArray(color6) || color6.length < 6) {
    throw new Error('applyDropHit: color6 must be a 6-element array');
  }

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const c0 = color6[0] * amount;
    const c1 = color6[1] * amount;
    const c2 = color6[2] * amount;
    const c3 = color6[3] * amount;
    const c4 = color6[4] * amount;
    const c5 = color6[5] * amount;

    if (blendMode === 'replace') {
      const inv = 1.0 - amount;
      px.r = px.r * inv + color6[0] * amount;
      px.g = px.g * inv + color6[1] * amount;
      px.b = px.b * inv + color6[2] * amount;
      px.w = px.w * inv + color6[3] * amount;
      px.a = px.a * inv + color6[4] * amount;
      px.u = px.u * inv + color6[5] * amount;
    } else if (blendMode === 'max') {
      px.r = Math.max(px.r, c0);
      px.g = Math.max(px.g, c1);
      px.b = Math.max(px.b, c2);
      px.w = Math.max(px.w, c3);
      px.a = Math.max(px.a, c4);
      px.u = Math.max(px.u, c5);
    } else {
      // Default: additive saturate
      px.r = Math.min(1.0, px.r + c0);
      px.g = Math.min(1.0, px.g + c1);
      px.b = Math.min(1.0, px.b + c2);
      px.w = Math.min(1.0, px.w + c3);
      px.a = Math.min(1.0, px.a + c4);
      px.u = Math.min(1.0, px.u + c5);
    }
  }
}

export const dropHitEffect = {
  apply: applyDropHit,
  envelopeValue,
  envelopeDurationMs,
};
