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
 *
 * `phaseOffsetFrames` (default 0) shifts the ON window within the cycle.
 * The controller supplies a non-zero value when phase-locking the strobe
 * to the beat grid (via signals.audioBarPhase) so the ON frame lands on
 * the downbeat instead of free-running from startedAtFrame. Zero keeps
 * the original free-run behavior exactly.
 */
export function getFrameLockedStrobeGate({
  frameIndex,
  startedAtFrame,
  framesPerCycle,
  onFrames,
  phaseOffsetFrames = 0,
}) {
  const localFrame = Math.max(0, frameIndex - startedAtFrame);
  // Positive modulo so a negative offset still lands in [0, framesPerCycle).
  const phaseFrame = (((localFrame + phaseOffsetFrames) % framesPerCycle) + framesPerCycle) % framesPerCycle;
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
  // Primary intensity (VSN1 jog-wheel / GEM slot intensity registry): the
  // most party-meaningful single knob for this effect. A normalized 0..1
  // API value maps linearly onto [min,max] and is written into the slot's
  // `intensity` param override. For strobe that is the flash strength —
  // how hard the ON frame slams (0 = no flash, 1 = full whiteout).
  primaryIntensity: { label: 'Flash Strength', param: 'intensity', default: 1.0, min: 0, max: 1 },
  // Primary mode (VSN1 encoder press) = FREQUENCY. "Pulse" consolidates the
  // five old per-frequency presets (2/4/5/10/20 Hz) into ONE moded slot: the
  // jog-wheel sets Flash Strength (primaryIntensity above) and the encoder
  // press walks the strobe rate. Cycling writes the chosen Hz into the slot's
  // `hz` param, which flows through validateParams('strobe',…) and so is
  // re-checked against the [1..20] safety range on every step.
  //
  // Values are the five existing preset frequencies verbatim, so the mode and
  // the still-present presets (pulse_2hz…max_20hz) stay in lockstep and every
  // old playlist/state reference keeps resolving. The descriptor shape is the
  // exact { label, param, values, default } the registry validates (mirrors
  // beatPump/feedbackTrails/colorWash); `valueLabels` is an optional parallel
  // list the surfaces render on the VSN1 LCD + CaptainPad so the operator sees
  // "2 Hz · 1/4"-style names, never "M1/M2".
  //
  // Musical rationale (live electronic sets, ~120-128 BPM): 2 Hz ≈ a
  // quarter-note pulse at 120 BPM (the safe default), 4 Hz ≈ eighth notes,
  // 5 Hz a driving off-grid punch, 10 Hz a hard machine-gun strobe, 20 Hz the
  // ceiling flutter. Kept at these five (not re-gridded) to preserve preset +
  // state-file compatibility; the labels carry the beat framing.
  primaryMode: {
    label: 'Frequency',
    param: 'hz',
    values: [2, 4, 5, 10, 20],
    valueLabels: ['2 Hz · 1/4', '4 Hz · 1/8', '5 Hz Punch', '10 Hz Hard', '20 Hz Max'],
    default: 2,
  },
};
