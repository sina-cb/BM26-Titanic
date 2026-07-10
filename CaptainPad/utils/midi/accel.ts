// Host-side velocity model for MFT relative encoders (MFT UX v2, feel round 4).
//
// WHY ROUND 4 — round 3 was numerically smooth but FAST TWISTS UNDER-TRAVELLED
// badly (Sina: "the knob is useless on a fast flick"). The dynamics show why,
// and the fix is a change in what the rate estimate is SEEDED from, not a
// firmware swap:
//
//   THE SIGNAL. The MFT is in MOVEMENTTYPE_VELOCITYSENSITIVE + relative-encoder
//   mode (mft/config.ts). Per detent tick it sends a relative CC whose VALUE is
//   the firmware's own velocity-multiplied count: value = 64 + ticks × mult,
//   where mult ramps 1 → 17 with turn speed (DJTT firmware encoders.c, and the
//   operator's live capture: a hard spin saturates at value 81 = +17). The
//   resolver maps that count LINEARLY through steps[0], so the raw `delta`
//   reaching applyTick is already `count × steps[0]` — the PER-MESSAGE speed
//   signal, no timing needed to read. At speed the firmware ALSO raises the
//   message rate. So the true instantaneous turn rate is (counts/message) ×
//   (messages/s) = |delta|/dt in unit-travel/s — which the estimator computes.
//
//   THE BUG (round 3) — the ramp was too slow AND too aggressively reset for the
//   SHORT fast flick:
//     1. The EMA time constant (90 ms, ~3× = 270 ms to full gain) was longer
//        than a short flick lasts. Steady-state gain was fine; the TRANSIENT
//        never got there — a wrist snap ended while gain was still ramping.
//     2. The SAME smoothing governed speeding up and slowing down, so making the
//        attack fast enough for a flick would have made the tail chatter.
//   Net: fast != far, exactly Sina's complaint.
//
// ROUND-4 DESIGN — ramp fast, release slow, retuned ceiling:
//
//   - ASYMMETRIC smoothing (fast attack, slow release). Speeding UP snaps the
//     estimate toward the (higher) instantaneous rate quickly (ATTACK_TAU_MS,
//     short) so a flick reaches its ceiling within a couple of ticks; slowing
//     DOWN eases off gently (RELEASE_TAU_MS, longer) so the tail of a flick and
//     a settling hand don't chatter. This is what makes a SHORT flick sweep,
//     while the first tick of every gesture still starts at rest (precision).
//   - A retuned ceiling + half-rate so a moderate flick reaches strong gain
//     sooner and a short flick, which ends before the curve saturates, still
//     sweeps far. GAIN_MAX is deliberately MODEST (3.0, feel-round 5): because
//     the full-range decode + linear step already carry the firmware's own
//     1→17 velocity multiply, a tall host ceiling on TOP would double-count
//     speed and overshoot on a real fast twist. This value is the one the
//     operator hardware-confirmed as the correct feel (slow precise, fast
//     sweeps to the ends, no jumpiness) — treat it as load-bearing.
//   - Gain is the same smooth bounded Hill curve of the smoothed rate:
//
//       gain(rate) = GAIN_MIN + (GAIN_MAX − GAIN_MIN) · r^P / (r^P + 1),
//       r = rate / HALF_RATE
//
//     Strictly monotonic, gain→GAIN_MIN at rest (sub-detent precision), saturates
//     smoothly toward GAIN_MAX (no hard-cap kink).
//   - The gain multiplies EACH tick's raw travel at accumulate time; the
//     coalescer window then just SUMS pre-gained deltas (linear — partitioning
//     cannot change the total), and the flush applies the plain sum to the anchor.
//   - The estimate RESETS to rest on an idle gap (> IDLE_RESET_MS) and on a
//     DIRECTION change — but "reset" now means "re-seed from the first tick of
//     the new gesture", not "start at zero". A reversal still starts fine-grained
//     (its first tick is a single slow detent), and a symmetric out-and-back at
//     the same speed nets exactly zero (reversal cleanliness pinned by a test).
//
// FIRMWARE MODE — kept at MOVEMENTTYPE_VELOCITYSENSITIVE (mft/config.ts). The
// velocity-multiplied count IS the speed signal; round 4 reads it on the first
// tick, so no firmware change is needed. MOVEMENTTYPE_DIRECT_HIGHRESOLUTION (1
// detent = 1 message, so message COUNT tracks speed) would only be the fix if
// the value did NOT carry speed — it does (value = 64 + ticks × mult, verified
// in the decode path + live capture) — so switching it would just trade a
// working signal for higher tick density and a mandatory hardware reconnect.
// Not done.
//
// Feel anchors with the constants below (simulated; S = steps[0] = 0.005):
//   isolated slow detent            → 0.0025           (Sina's 0.002–0.003)
//   slow crawl, 4 det/s             → ~0.0025 / detent (stays precise)
//   short wrist flick (~8 × ±2 @ 15 ms) → sweeps most of the range
//   hard flick, saturated +17 stream → ≈ full sweep
//
// TUNING (hardware feel iterations expected — tweak ONE constant at a time):
//   ACCEL_GAIN_MIN       precision of a slow/isolated detent (lower = finer;
//                        effective slow step = GAIN_MIN × steps[0])
//   ACCEL_GAIN_MAX       the flick ceiling — RAISE if fast twists still don't
//                        sweep far enough; LOWER if a flick overshoots the range
//                        (operator-confirmed at 3.0 — the firmware's own 1→17
//                        multiply does most of the speed work, so this stays low)
//   ACCEL_HALF_RATE      the turn rate (unit-travel/s) at the curve's middle;
//                        LOWER reaches fast gain sooner (whole curve shifts
//                        toward slower turns → fast feels stronger earlier)
//   ACCEL_CURVE_POWER    steepness of the slow→fast transition (higher =
//                        sharper split between precise and fast regimes)
//   ACCEL_ATTACK_TAU_MS  how fast gain RAMPS UP on a flick (lower = snappier
//                        fast response; this is the round-4 fast-twist lever)
//   ACCEL_RELEASE_TAU_MS how gently gain EASES OFF when slowing (higher =
//                        steadier tail, less chatter as the hand settles)
//   ACCEL_IDLE_RESET_MS  pause that starts a fresh gesture (rate back to rest)
//
// Pure math + one tiny state machine, unit-tested in accel.test.ts. Applied
// identically to focused-pattern locals, the global speed knob, and the
// global hue knob.

/** Gain at rest — an isolated detent moves GAIN_MIN × steps[0]
 *  (0.5 × 0.005 = 0.0025, the sub-detent precision Sina asked for). */
export const ACCEL_GAIN_MIN = 0.5;

/** THE shared per-flush-window speed ceiling for EVERY relative knob, in
 *  unit-travel (0..1) per ~33 ms coalescer window (Sina 2026-07-10: "they
 *  must be controlling the same 0→1 parameter so they must have the same
 *  behavior"). One flat-out spin covers the full range in ~0.65 s
 *  (0.05 × 30 windows/s). Hue rides the SAME cap — its degrees are just
 *  unit × 360 (an 18°/window ceiling). This is the ONE knob to tune if every
 *  encoder feels too fast (lower it) or too slow (raise it); per-detent
 *  precision at the slow end is untouched (far below the ceiling). */
export const MAX_WINDOW_STEP = 0.05;

/** Gain ceiling for a hard flick (the Hill curve saturates toward this —
 *  smoothly, never a hard cap kink). MODEST (3.0) on purpose: the full-range
 *  decode + linear step already carry the firmware's own 1→17 velocity
 *  multiply, so a tall host ceiling would double-count speed and overshoot.
 *  This is the value the operator hardware-confirmed as the correct feel.
 *  RAISE if a hard flick no longer reaches the ends; LOWER if it overshoots. */
export const ACCEL_GAIN_MAX = 3.0;

/** Turn rate (unit-travel per second) at which gain sits halfway between
 *  GAIN_MIN and GAIN_MAX. 0.18/s ≈ 36 raw counts/s ≈ 1.5 rev/s. Lower than
 *  round 3's 0.25 so a moderate flick reaches strong gain sooner. */
export const ACCEL_HALF_RATE = 0.18;

/** Hill exponent — steepness of the slow→fast transition. */
export const ACCEL_CURVE_POWER = 1.6;

/** EMA time constant (ms) while SPEEDING UP — the fast-attack path. ~2× this is
 *  the ramp to full flick gain, so a short wrist flick (a handful of ticks)
 *  reaches its ceiling. This is the primary round-4 fast-twist lever: LOWER for
 *  a snappier, more immediate flick. */
export const ACCEL_ATTACK_TAU_MS = 35;

/** EMA time constant (ms) while SLOWING DOWN — the slow-release path. Longer
 *  than attack so the tail of a flick and a settling hand don't chatter the
 *  gain; the value keeps flowing smoothly as the hand eases off. */
export const ACCEL_RELEASE_TAU_MS = 140;

/** An inter-tick gap longer than this starts a FRESH gesture: the rate estimate
 *  resets to rest so the first detents of a new gesture are precise again (and a
 *  slow crawl at this cadence stays fine-grained rather than accumulating gain). */
export const ACCEL_IDLE_RESET_MS = 300;

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
    const mag = Math.abs(delta);
    if (gapMs > ACCEL_IDLE_RESET_MS || sign !== this.lastSign) {
      // Fresh gesture (pause or direction change) → start at rest. The FIRST
      // tick therefore always lands at precision gain (GAIN_MIN), so a lone slow
      // detent and a same-timestamp batch's first tick are both fine-grained. A
      // real flick's speed is read from the very next tick's short inter-tick
      // gap through the FAST-attack path below, which reaches high gain within a
      // couple of ticks — that (not a first-tick magnitude seed) is what makes a
      // short flick sweep. Magnitude alone can't be trusted on tick 1: profile
      // step size is unknown here, so a ±1 and a ±2 first tick are
      // indistinguishable without timing.
      this.emaRate = 0;
    } else {
      const dtMs = Math.max(gapMs, ACCEL_MIN_TICK_DT_MS);
      const instRate = mag / (dtMs / 1000);
      // Asymmetric, time-constant-correct EMA: attack FAST when speeding up so a
      // short flick reaches its ceiling; release SLOWLY when slowing down so the
      // tail doesn't chatter. Alpha uses the REAL elapsed gap, so a zero-gap
      // same-timestamp batch (Web MIDI delivering several detents at once) makes
      // alpha 0 → the estimate is untouched, and the batch can't self-accelerate.
      const tau = instRate > this.emaRate ? ACCEL_ATTACK_TAU_MS : ACCEL_RELEASE_TAU_MS;
      const alpha = 1 - Math.exp(-gapMs / tau);
      this.emaRate += alpha * (instRate - this.emaRate);
    }
    this.lastTickMs = nowMs;
    this.lastSign = sign;
    return delta * gainForRate(this.emaRate);
  }
}
