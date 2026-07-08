// Host-side velocity model for MFT relative encoders (MFT UX v2, feel round 3).
//
// WHY ROUND 3 — the round-2 curve was numerically right but FELT wrong, and
// the dynamics show why (simulated in accel.test.ts "dynamics" suite):
//
//   1. It computed gain from a 33 ms coalescer window's raw SUM. The same
//      physical turn rate lands 1 tick in one window and 2 in the next
//      (45 ticks/s → 1.485 ticks/window), and because gain(|sum|) is
//      superlinear the per-window output alternated 0.0025 / 0.0087 — a 3.5×
//      rate ripple at ~15 Hz. That is the "surging" the operator felt.
//   2. It stacked host acceleration ON TOP of the firmware's velocity coding.
//      The MFT already classifies turn speed into relative codes ±1/±2/±3, and
//      the profile mapped those to a 1:4:12 step triple; crossing a firmware
//      speed threshold jumped the output rate ~3.4× for the SAME physical
//      motion — a discontinuity no constant-tuning could hide.
//
// ROUND-3 DESIGN — one continuous velocity estimate, gain applied PER TICK:
//
//   - Every relative code is treated as a LINEAR count (±n = n detents of
//     travel, the standard relative-encoder offset semantics), so the raw
//     per-tick travel is code × steps[0] and the firmware speed classification
//     cannot introduce jumps (profile steps are now the linear triple
//     [S, 2S, 3S] — see DEFAULT_RELATIVE_STEPS).
//   - A per-encoder EMA tracks the turn RATE (unit-travel per second) from
//     inter-tick timestamps (Web MIDI's high-resolution event timeStamp).
//     The estimate evolves smoothly across coalescer windows, so the gain no
//     longer depends on how ticks happen to land in 33 ms buckets: the same
//     physical rate ALWAYS produces the same parameter rate (bucket-phase
//     independence is pinned by a property test).
//   - Gain is a smooth, bounded Hill curve of the smoothed rate:
//
//       gain(rate) = GAIN_MIN + (GAIN_MAX − GAIN_MIN) · r^P / (r^P + 1),
//       r = rate / HALF_RATE
//
//     Strictly monotonic, gain→GAIN_MIN at rest (sub-detent precision) and
//     saturates smoothly at GAIN_MAX (no min() kink like the old cap).
//   - The gain multiplies EACH tick's travel at accumulate time; the coalescer
//     window then just SUMS pre-gained deltas (linear — partitioning cannot
//     change the total), and the flush applies the plain sum to the anchor.
//   - The estimate RESETS to rest on an idle gap (> IDLE_RESET_MS) and on a
//     DIRECTION change, so a fresh gesture / a reversal always starts at
//     precision gain — an overshoot-correction nudge is fine-grained, and a
//     symmetric out-and-back lands exactly where it started (reversal
//     cleanliness is pinned by a test).
//
// FIRMWARE MODE — kept at MOVEMENTTYPE_VELOCITYSENSITIVE (mft/config.ts).
// Rationale: the codes are relative COUNT offsets, so treating them linearly
// already removes the double-acceleration; the velocity mode just packs
// multiple counts per message at speed (fewer MIDI messages, same travel).
// Switching to MOVEMENTTYPE_DIRECT_HIGHRESOLUTION would change the tick
// density per physical detent in ways we cannot verify without the hardware
// in hand — a blind flash risk for zero modelled benefit. If a hardware feel
// pass still shows firmware-side steppiness, that mode swap (plus re-tuning
// ACCEL_HALF_RATE) is the next experiment.
//
// Feel anchors with the constants below (simulated; S = steps[0] = 0.005):
//   isolated slow detent            → 0.0025           (Sina's 0.002–0.003)
//   slow crawl, 4 det/s             → ~0.0031 / detent
//   medium turn, 1 rev/s (24 det/s) → ~0.26 of range /s
//   hard flick, ~1.5 rev @100 cts/s → ~0.90 of range   (full sweep in ~1.5 rev)
//
// TUNING (hardware feel iterations expected — tweak ONE constant at a time):
//   ACCEL_GAIN_MIN       precision of a slow/isolated detent (lower = finer;
//                        effective slow step = GAIN_MIN × steps[0])
//   ACCEL_GAIN_MAX       the flick ceiling — how hard a fast spin sweeps
//   ACCEL_HALF_RATE      the turn rate (unit-travel/s) at the curve's middle;
//                        LOWER reaches fast gain sooner (whole curve shifts
//                        toward slower turns)
//   ACCEL_CURVE_POWER    steepness of the slow→fast transition (higher =
//                        sharper split between precise and fast regimes)
//   ACCEL_RATE_TAU_MS    rate-estimate smoothing; higher = more "inertia"
//                        (slower gain onset on a flick, steadier mid-turn),
//                        lower = snappier but jumpier
//   ACCEL_IDLE_RESET_MS  pause that starts a fresh (precise) gesture
//
// Pure math + one tiny state machine, unit-tested in accel.test.ts. Applied
// identically to focused-pattern locals, the global speed knob, and the
// global hue knob.

/** Gain at rest — an isolated detent moves GAIN_MIN × steps[0]
 *  (0.5 × 0.005 = 0.0025, the sub-detent precision Sina asked for). */
export const ACCEL_GAIN_MIN = 0.5;

/** Gain ceiling for a hard flick (the Hill curve saturates toward this —
 *  smoothly, never a hard cap kink). */
export const ACCEL_GAIN_MAX = 8.0;

/** Turn rate (unit-travel per second) at which gain sits halfway between
 *  GAIN_MIN and GAIN_MAX. 0.25/s ≈ 50 raw counts/s ≈ 2 rev/s. */
export const ACCEL_HALF_RATE = 0.25;

/** Hill exponent — steepness of the slow→fast transition. */
export const ACCEL_CURVE_POWER = 1.6;

/** EMA time constant for the rate estimate (ms). ~3× this is the ramp to full
 *  flick gain — the "inertia" of the knob. */
export const ACCEL_RATE_TAU_MS = 90;

/** An inter-tick gap longer than this starts a FRESH gesture: the rate
 *  estimate resets to rest so the first detents are precise again. */
export const ACCEL_IDLE_RESET_MS = 250;

/** Floor for the inter-tick interval used in the instantaneous-rate estimate.
 *  Web MIDI can deliver a batch of ticks with (near-)identical timestamps;
 *  without a floor the instantaneous rate would spike unboundedly. */
export const ACCEL_MIN_TICK_DT_MS = 4;

/**
 * The gain curve: smooth, strictly monotonic, bounded Hill function of the
 * smoothed turn rate (unit-travel per second). Pure — exported for tests and
 * for computing expected values.
 */
export function gainForRate(rate: number): number {
  if (rate <= 0) return ACCEL_GAIN_MIN;
  const x = Math.pow(rate / ACCEL_HALF_RATE, ACCEL_CURVE_POWER);
  return ACCEL_GAIN_MIN + (ACCEL_GAIN_MAX - ACCEL_GAIN_MIN) * (x / (x + 1));
}

/**
 * Per-encoder continuous velocity tracker + per-tick gain. One instance per
 * relative CONTROL (the manager keys them by control id); feed every decoded
 * tick through `applyTick` at arrival time (BEFORE coalescing) and accumulate
 * the returned effective delta — the coalescer sum then needs no further
 * curving.
 */
export class TickAccelerator {
  /** Smoothed turn rate, unit-travel per second. 0 = at rest. */
  private emaRate = 0;
  /** Timestamp (ms) of the previous tick; null = no gesture in progress. */
  private lastTickMs: number | null = null;
  /** Sign of the previous tick's delta (+1/-1); 0 = none yet. */
  private lastSign = 0;

  /**
   * Consume one tick: `delta` is the RAW signed unit travel (profile step ×
   * relative count sign), `nowMs` the tick's transport timestamp. Returns the
   * effective (gained, still signed) delta to accumulate. A zero delta is
   * returned unchanged without touching the estimator state.
   */
  applyTick(delta: number, nowMs: number): number {
    if (delta === 0) return 0;
    const sign = delta < 0 ? -1 : 1;
    const gapMs = this.lastTickMs === null ? Infinity : nowMs - this.lastTickMs;
    if (gapMs > ACCEL_IDLE_RESET_MS || sign !== this.lastSign) {
      // Fresh gesture (pause or direction change) → start at precision gain.
      this.emaRate = 0;
    } else {
      const dtMs = Math.max(gapMs, ACCEL_MIN_TICK_DT_MS);
      const instRate = Math.abs(delta) / (dtMs / 1000);
      // Time-constant-correct EMA step: alpha depends on the REAL elapsed gap
      // so the smoothing behaves identically at any message rate.
      const alpha = 1 - Math.exp(-gapMs / ACCEL_RATE_TAU_MS);
      this.emaRate += alpha * (instRate - this.emaRate);
    }
    this.lastTickMs = nowMs;
    this.lastSign = sign;
    return delta * gainForRate(this.emaRate);
  }
}
