/**
 * Apply the complete Live Touch creative look to the isolated Live buffer.
 *
 * This stage intentionally mirrors engine.js's established global creative
 * order. It runs only while Live Touch is a canonical render participant and
 * before the shared Deck/Mixer/Live linear blend. Shared safety authority
 * (grand master, Dimmer Rack, arm envelope, blackout) remains downstream.
 */
export function applyLayerSettingCreativeBuffer({
  buffer6ch,
  modelPixels,
  globalEffectsController,
  brightnessController = null,
  master = 1,
  frameIndex,
  nowMs,
  signals = {},
}) {
  if (!(buffer6ch instanceof Uint8Array)) {
    throw new TypeError('Live Touch creative buffer must be a Uint8Array');
  }
  if (!Array.isArray(modelPixels) || buffer6ch.length !== modelPixels.length * 6) {
    throw new RangeError('Live Touch creative buffer/model size mismatch');
  }
  if (typeof master !== 'number' || !Number.isFinite(master) || master < 0 || master > 1) {
    throw new RangeError(`layer-setting master must be a finite number in [0,1], got ${master}`);
  }

  const pixels = modelPixels;
  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 6;
    const pixel = pixels[i];
    pixel.r = buffer6ch[offset] / 255;
    pixel.g = buffer6ch[offset + 1] / 255;
    pixel.b = buffer6ch[offset + 2] / 255;
    pixel.w = buffer6ch[offset + 3] / 255;
    pixel.a = buffer6ch[offset + 4] / 255;
    pixel.u = buffer6ch[offset + 5] / 255;
  }

  if (globalEffectsController) {
    globalEffectsController.applyPixels(pixels);
    globalEffectsController.applyGroupFixedColors(pixels, 'pre');

    const effectMask = globalEffectsController.effectGroupMask;
    let protectedPixels = null;
    if (effectMask) {
      protectedPixels = [];
      for (let i = 0; i < pixels.length; i++) {
        const pixel = pixels[i];
        if (!pixel || effectMask.has(pixel.group)) continue;
        protectedPixels.push([
          i,
          pixel.r, pixel.g, pixel.b,
          pixel.w, pixel.a, pixel.u,
        ]);
      }
    }

    globalEffectsController.applyMacros({ pixels, frameIndex, nowMs, signals });
    globalEffectsController.applyInvert(pixels);
    globalEffectsController.applyPostInvert({ pixels, frameIndex, nowMs, signals });

    if (protectedPixels) {
      for (const saved of protectedPixels) {
        const pixel = pixels[saved[0]];
        pixel.r = saved[1]; pixel.g = saved[2]; pixel.b = saved[3];
        pixel.w = saved[4]; pixel.a = saved[5]; pixel.u = saved[6];
      }
    }

    globalEffectsController.applyGroupFixedColors(pixels, 'post');
    globalEffectsController.applySpatialStage({ pixels, nowMs });
  }

  // The established grand master belongs to the complete setting look. During
  // a transition involving Live it runs before the pair blend so each
  // setting's own parked-group mask is respected independently. Live
  // brightness remains later and therefore still dims a parked group: it is a
  // setting-local authority, not the shared creative grand master.
  if (master < 1) {
    const parked = globalEffectsController
      ? globalEffectsController.parkedGroupMask
      : null;
    for (const pixel of pixels) {
      if (parked && parked.has(pixel.group)) continue;
      pixel.r *= master; pixel.g *= master; pixel.b *= master;
      pixel.w *= master; pixel.a *= master; pixel.u *= master;
    }
  }

  // Live factors are the final setting-local stage so every path controlled by
  // Live (pattern, effect macro, fixed paint, spatial paint) obeys the same
  // master/group faders. The shared Dimmer Rack is still applied once after
  // the canonical pair blend in IntensityController.apply().
  if (brightnessController) {
    brightnessController.apply(pixels);
    // Live Touch never owns Dimmer Rack bypass authority. applyPixels() may
    // have set legacy per-lane bypass flags on the shared model scratch; clear
    // them before engine.js applies the rack to the blended frame.
    for (const pixel of pixels) {
      pixel.ignoreDimmerForRGB = false;
      pixel.ignoreDimmerForW = false;
      pixel.ignoreDimmerForA = false;
      pixel.ignoreDimmerForU = false;
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 6;
    const pixel = pixels[i];
    buffer6ch[offset] = toByte(pixel.r);
    buffer6ch[offset + 1] = toByte(pixel.g);
    buffer6ch[offset + 2] = toByte(pixel.b);
    buffer6ch[offset + 3] = toByte(pixel.w);
    buffer6ch[offset + 4] = toByte(pixel.a);
    buffer6ch[offset + 5] = toByte(pixel.u);
  }
}

export function applyLiveTouchCreativeBuffer(options) {
  return applyLayerSettingCreativeBuffer({
    ...options,
    brightnessController: options.liveBrightnessController,
  });
}

/**
 * Remove creative dimmer-bypass metadata only when Live Touch participated in
 * the canonical surface render. Deck/Mixer retain their explicit bypass
 * policy on ordinary frames; a pair containing Live cannot carry per-setting
 * metadata through its byte-wise blend, so the shared Dimmer Rack must own all
 * lanes for that frame.
 */
export function enforceLiveDimmerAuthority(pixels, liveTouchParticipated) {
  if (!liveTouchParticipated) return;
  for (const pixel of pixels) {
    pixel.ignoreDimmerForRGB = false;
    pixel.ignoreDimmerForW = false;
    pixel.ignoreDimmerForA = false;
    pixel.ignoreDimmerForU = false;
  }
}

function toByte(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
