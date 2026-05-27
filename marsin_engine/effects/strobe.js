/**
 * effects/strobe.js — Software Sync Strobe
 *
 * Frame-locked ON/OFF gate. All math is pure / stateless — runtime
 * state (current cycle, frame anchor, hold/burst timers) is owned by
 * GlobalEffectsController. See docs/28 §3.1.
 */

/**
 * Quantize a desired Hz to the engine frame grid.
 *   framesPerCycle = round(frameRate / hz)  (min 2)
 *   onFrames       = round(framesPerCycle * duty) (min 1)
 *   actualHz       = frameRate / framesPerCycle
 */
export function getFrameLockedStrobeTiming({ hz, duty = 0.5, frameRate = 40 }) {
  const framesPerCycle = Math.max(2, Math.round(frameRate / hz));
  const onFrames = Math.max(1, Math.round(framesPerCycle * duty));
  return {
    framesPerCycle,
    onFrames,
    actualHz: frameRate / framesPerCycle,
  };
}

/**
 * Returns 1.0 (ON) or 0.0 (OFF) for the strobe gate at this frame.
 */
export function getFrameLockedStrobeGate({ frameIndex, startedAtFrame, framesPerCycle, onFrames }) {
  const localFrame = Math.max(0, frameIndex - startedAtFrame);
  const phaseFrame = localFrame % framesPerCycle;
  return phaseFrame < onFrames ? 1.0 : 0.0;
}

/**
 * Scale every pixel channel by `gate * intensity`. When gate=0 every
 * channel is forced to 0 (frame is dark). When gate=1 channels are
 * scaled by `intensity` (default 1.0 == passthrough).
 */
export function applySoftwareStrobe({ pixels, gate, intensity = 1.0 }) {
  const scale = gate > 0 ? intensity : 0.0;
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

export const strobeEffect = {
  apply: applySoftwareStrobe,
  getTiming: getFrameLockedStrobeTiming,
  getGate: getFrameLockedStrobeGate,
};
