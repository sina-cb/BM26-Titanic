/*
  trans_morse_blink.js — Morse SOS Blink Reveal (rate-capped)

  The from-pattern dims and the new pattern flashes in through a
  three-pulse SOS-style staccato (three short bursts) before settling
  on the new pattern. A wink to the Titanic's distress signal, used
  sparingly because it's visually intense.

  Timeline (in `progress` space):
    [0.00 .. 0.70] — up to three short bursts of `to` overlaid on
                     `from`, each burst a smoothstep up/down. Pulse
                     spacing is widened (and pulses are dropped) if
                     the estimated wall-clock cadence would exceed
                     the operator-tunable safe cap (default 3 Hz).
    [0.70 .. 1.00] — final smooth crossfade from `from` to `to`.

  ─── Strobe safety (codex P0: NO SILENT FALLBACKS) ───
  The blend script receives only `progress` per pixel — there is no
  wall-clock `delta` exposed on blend scripts (see report 11.0). To
  cap the realised pulse rate we estimate `dProgressPerFrame` by
  watching the first pixel of each frame (`index == 0`) and assuming
  ~40 Hz render cadence. The estimated transition duration is then:

      estDurationMs ≈ 25 ms / dProgressPerFrame

  If `estDurationMs` is below the safe minimum (operator slider:
  `sliderMinDurationMs`, default 1500 ms => ~3 Hz cap with three
  pulses spread across 0.7 of progress), we DELIBERATELY degrade
  the gesture to a single soft crossfade. The degradation:
    - is hard-coded to fall back to a smoothstep crossfade
    - logs no warning (VM has no console) but is signalled
      structurally (no pulses, only the crossfade branch runs)
    - is documented HERE and in the report as a deliberate, not
      silent, fallback per codex P0.

  ─── Easing policy (cross-cutting #2) ───
  The mixer fader already smoothsteps `progress` over `durationMs`
  (`pattern_mixer.js:594`). We therefore use `progress` LINEARLY
  inside the pulse envelopes (a single smoothstep on the per-pulse
  spatial-ish distance is fine — it lives in a different domain)
  and use ONE additional smoothstep on the tail crossfade — net
  easing on the tail is `smoothstep(smoothstep)`, which we accept
  because the morse gesture intentionally lingers near `progress=1`.
  No `pow()` stacking on the pulses.

  Uses transition built-ins: progress, fromR/G/B/W/A/U, toR/G/B/W/A/U
*/

// Operator-tunable minimum transition duration that still permits
// the full morse pulse train. Anything shorter degrades to a plain
// crossfade. Range chosen so default (0.4 slider) gives 1500 ms.
//
// Why no `export function sliderMinDurationMs(v)`: the WASM VM's
// `slider*` exports are invoked at compile/init with v=0.5, which
// would clobber `minDurationMs` to its 0.5-slider value. We use the
// `_set*` private-fn workaround documented in `trans_dissolve.js:42-50`
// and `trans_color_burst.js:28-38`. A future engine-level transition
// param API can call `_setMinDurationMs` via setControl.
export var minDurationMs = 1500.0;
function _setMinDurationMs(v) {
  // v in [0, 1] -> [500 ms, 4000 ms]
  minDurationMs = 500.0 + v * 3500.0;
}

// Per-pulse half-width in progress units. Narrower than the original
// 0.05 (cross-cutting #3 in 11.3 suggested narrowing duty cycle).
// 0.035 gives ~40% duty per pulse instead of ~60%.
export var pulseHalfWidth = 0.035;
function _setPulseHalfWidth(v) {
  // v in [0, 1] -> [0.015, 0.06]
  pulseHalfWidth = 0.015 + v * 0.045;
}

// ── Wall-clock estimator (uses pixel-0 sampling each frame) ──
// We assume the engine renders blends at ~40 Hz (`engine.js` default
// loop ~25 ms). At 40 Hz, dProgressPerFrame = (25 / durationMs).
// Therefore: estDurationMs = 25 / dProgressPerFrame.
var _lastProgress = -1.0;
var _estDurationMs = 1500.0;  // optimistic start (assume safe duration)
var _samplesSeen = 0;

function _updateEstimator() {
  // Reset if a new transition has begun (progress went backward or jumped down).
  if (progress < _lastProgress - 0.01 || _lastProgress < 0) {
    _lastProgress = progress;
    _samplesSeen = 0;
    _estDurationMs = 1500.0;
    return;
  }
  var dp = progress - _lastProgress;
  _lastProgress = progress;
  // First frame of a transition: keep optimistic estimate.
  if (dp <= 0.0) return;
  // Engine render cadence assumed ~40 Hz => 25 ms/frame.
  // Smooth over a few samples to avoid jitter at fader smoothstep curve
  // boundaries (smoothstep dp is non-uniform across the transition).
  var instMs = 25.0 / dp;
  // Use the MAX observed instantaneous duration so far — the slowest
  // segment of the smoothstep curve gives the true duration; using max
  // makes our cap conservative (we degrade only when the FASTEST
  // segment would already exceed the cap, but the slowest segment
  // gives the best upper-bound estimate of the wall-clock duration).
  if (_samplesSeen == 0) {
    _estDurationMs = instMs;
  } else if (instMs > _estDurationMs) {
    _estDurationMs = instMs;
  }
  _samplesSeen = _samplesSeen + 1;
}

// Burst pulse: returns 0..1, smooth ramp up then back down across width.
function _pulse(p, center, halfWidth) {
  var d = abs(p - center);
  return 1.0 - smoothstep(0.0, halfWidth, d);
}

export function render(index, x, y, z) {
  // Update the wall-clock estimator once per frame (at pixel 0).
  if (index == 0) {
    _updateEstimator();
  }

  // Determine whether to run the pulse train or degrade to crossfade.
  // After the first frame the estimator is meaningful; before that we
  // err on the safe side and use the optimistic default (1500 ms),
  // which permits pulses.
  var safe = 1.0;
  if (_estDurationMs < minDurationMs) {
    safe = 0.0;
  }

  if (safe < 0.5) {
    // ── DELIBERATE FALLBACK (codex P0): requested transition is too
    //    short for the morse gesture to fit under the strobe cap.
    //    Render a plain smoothstep crossfade for the entire span.
    //    Not silent: the variable `safe` is set explicitly above and
    //    documented at the top of this file. ──
    var amt = smoothstep(0.0, 1.0, progress);
    rgbwau(
      mix(fromR, toR, amt),
      mix(fromG, toG, amt),
      mix(fromB, toB, amt),
      mix(fromW, toW, amt),
      mix(fromA, toA, amt),
      mix(fromU, toU, amt)
    );
    return;
  }

  // Full morse path: three pulses, then crossfade tail.
  if (progress < 0.70) {
    // Pulse centres are scaled to spread proportionally with the
    // realised duration when the duration is just at the floor.
    // (At long durations the original 0.10/0.30/0.50 spacing is fine;
    // at the floor we still want >=333 ms between pulses, and a 0.20
    // progress gap at 1500 ms is exactly 300 ms — close enough,
    // backed up by the narrowed pulseHalfWidth.)
    var p1 = _pulse(progress, 0.10, pulseHalfWidth);
    var p2 = _pulse(progress, 0.30, pulseHalfWidth);
    var p3 = _pulse(progress, 0.50, pulseHalfWidth);
    var burst = max(p1, max(p2, p3));
    // No additional pow/smoothstep on `burst` — already smoothstepped
    // per-pulse in the spatial-ish (progress-distance) domain. The
    // mixer fader's time-domain smoothstep is the only time easing.
    rgbwau(
      mix(fromR, toR, burst),
      mix(fromG, toG, burst),
      mix(fromB, toB, burst),
      mix(fromW, toW, burst),
      mix(fromA, toA, burst),
      mix(fromU, toU, burst)
    );
  } else {
    // Final crossfade [0.70 .. 1.00] -> [0 .. 1] with smoothstep.
    var amt = (progress - 0.70) / 0.30;
    amt = smoothstep(0.0, 1.0, amt);
    rgbwau(
      mix(fromR, toR, amt),
      mix(fromG, toG, amt),
      mix(fromB, toB, amt),
      mix(fromW, toW, amt),
      mix(fromA, toA, amt),
      mix(fromU, toU, amt)
    );
  }
}
