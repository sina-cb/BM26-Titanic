/**
 * effects/feedbackTrails.js — Feedback Trails / Ghost Trails
 *
 * Stateless apply step that consumes a Float32Array trail buffer
 * (length = pixelCount * 6, RGBWAU interleaved) owned by
 * GlobalEffectsController. Per-call: decays + injects current pixel
 * values into the trail, optionally applies a chromatic bleed, then
 * mixes the trail back into the live pixel buffer.
 */

export function applyFeedbackTrails({
  pixels,
  trailBuffer,
  decay,
  injection,
  mix,
  blendMode = 'add',
  colorBleed = 0,
}) {
  if (!trailBuffer) throw new Error('applyFeedbackTrails: trailBuffer is required');
  const expected = pixels.length * 6;
  if (trailBuffer.length < expected) {
    throw new Error(
      `applyFeedbackTrails: trailBuffer too small (need ${expected}, got ${trailBuffer.length})`
    );
  }

  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const off = i * 6;

    let tr = trailBuffer[off + 0];
    let tg = trailBuffer[off + 1];
    let tb = trailBuffer[off + 2];
    let tw = trailBuffer[off + 3];
    let ta = trailBuffer[off + 4];
    let tu = trailBuffer[off + 5];

    // Inject + decay
    tr = tr * decay + px.r * injection;
    tg = tg * decay + px.g * injection;
    tb = tb * decay + px.b * injection;
    tw = tw * decay + px.w * injection;
    ta = ta * decay + px.a * injection;
    tu = tu * decay + px.u * injection;

    // Chromatic bleed (green→red, red→blue)
    if (colorBleed > 0) {
      tr += tg * colorBleed;
      tb += tr * colorBleed;
    }

    trailBuffer[off + 0] = Math.min(1.0, tr);
    trailBuffer[off + 1] = Math.min(1.0, tg);
    trailBuffer[off + 2] = Math.min(1.0, tb);
    trailBuffer[off + 3] = Math.min(1.0, tw);
    trailBuffer[off + 4] = Math.min(1.0, ta);
    trailBuffer[off + 5] = Math.min(1.0, tu);

    // Mix trail back into the live frame.
    if (blendMode === 'replace') {
      px.r = px.r * (1 - mix) + trailBuffer[off + 0] * mix;
      px.g = px.g * (1 - mix) + trailBuffer[off + 1] * mix;
      px.b = px.b * (1 - mix) + trailBuffer[off + 2] * mix;
      px.w = px.w * (1 - mix) + trailBuffer[off + 3] * mix;
      px.a = px.a * (1 - mix) + trailBuffer[off + 4] * mix;
      px.u = px.u * (1 - mix) + trailBuffer[off + 5] * mix;
    } else if (blendMode === 'max') {
      px.r = Math.max(px.r, trailBuffer[off + 0] * mix);
      px.g = Math.max(px.g, trailBuffer[off + 1] * mix);
      px.b = Math.max(px.b, trailBuffer[off + 2] * mix);
      px.w = Math.max(px.w, trailBuffer[off + 3] * mix);
      px.a = Math.max(px.a, trailBuffer[off + 4] * mix);
      px.u = Math.max(px.u, trailBuffer[off + 5] * mix);
    } else {
      px.r = Math.min(1.0, px.r + trailBuffer[off + 0] * mix);
      px.g = Math.min(1.0, px.g + trailBuffer[off + 1] * mix);
      px.b = Math.min(1.0, px.b + trailBuffer[off + 2] * mix);
      px.w = Math.min(1.0, px.w + trailBuffer[off + 3] * mix);
      px.a = Math.min(1.0, px.a + trailBuffer[off + 4] * mix);
      px.u = Math.min(1.0, px.u + trailBuffer[off + 5] * mix);
    }
  }
}

export const feedbackTrailsEffect = {
  apply: applyFeedbackTrails,
};
