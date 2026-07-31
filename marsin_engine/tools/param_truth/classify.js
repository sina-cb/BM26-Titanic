// classify.js — turn a measured sweep into a verdict.
//
// Verdicts
// ────────
//  TRUE          the claimed effect was measured, with the sign/monotonicity
//                the name implies.
//  DEAD          nothing measurably changed anywhere in the parameter's range.
//  WRONG         something real changed, but NOT the thing the name claims
//                (or it moved the wrong way, e.g. "speed" that slows down).
//  WEAK          a real but sub-visible effect — below the operator-visible
//                threshold across the whole range.
//  UNKNOWN_CLAIM the name makes no claim this harness knows how to falsify;
//                the measured effect is recorded for a human to judge.
//
// Every branch below cites the threshold it used, and the returned record
// carries the numbers, so a verdict is auditable rather than asserted.

import { FAMILY, NON_FALSIFIABLE, THRESHOLDS, monotonicity } from './claims.js';
import { normalisedChange, rankMovers, hueDistance, correlate } from './metrics.js';

export const VERDICT = {
  TRUE: 'TRUE',
  DEAD: 'DEAD',
  WRONG: 'WRONG',
  WEAK: 'WEAK',
  UNKNOWN_CLAIM: 'UNKNOWN_CLAIM',
};

/** Pull one feature's value at each sweep point. */
function seriesOf(vectors, feature) {
  return vectors.map(v => v[feature]);
}

/** Max-over-min ratio of a series, guarded against a zero floor. */
function ratioOf(series) {
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  return hi / Math.max(lo, 1e-6);
}

/**
 * Effective normalised change of a feature: the raw swing minus the pattern's
 * own measured noise floor for that feature. Renders are deterministic today,
 * so the floor is normally 0 — but measuring it means a pattern that ever
 * becomes nondeterministic is caught instead of generating phantom verdicts.
 */
function effective(feature, vectors, noise) {
  return Math.max(0, normalisedChange(feature, vectors) - (noise[feature] || 0)
    * THRESHOLDS.noiseMultiple);
}

/** Best (largest) effective change among a set of features. */
function bestOf(features, vectors, noise) {
  let best = { feature: features[0], change: 0 };
  for (const f of features) {
    const c = effective(f, vectors, noise);
    if (c > best.change) best = { feature: f, change: c };
  }
  return best;
}

/**
 * Level-family test: a claim about "how much light" is met by an absolute
 * swing OR by a proportional one.
 *
 * A sparkle pattern's white glints can double in output while the model-wide
 * mean moves 0.004 — plainly visible on the rig, invisible to an absolute
 * threshold. So the ratio path exists, gated by `relFloor` so it cannot fire
 * on two numbers that are both effectively zero.
 *
 * @param {string} feature
 * @param {Record<string, number>[]} vectors
 * @param {Record<string, number>} noise
 * @param {number} absThreshold
 * @returns {{ met: boolean, change: number, ratio: number, via: string }}
 */
function levelMet(feature, vectors, noise, absThreshold) {
  const change = effective(feature, vectors, noise);
  const ratio = ratioOf(seriesOf(vectors, feature));
  if (change >= absThreshold) return { met: true, change, ratio, via: 'absolute' };
  if (ratio >= THRESHOLDS.levelRatio && change >= THRESHOLDS.relFloor) {
    return { met: true, change, ratio, via: 'ratio' };
  }
  return { met: false, change, ratio, via: 'none' };
}

/** levelMet over several candidate features; best (met first, then change). */
function bestLevel(features, vectors, noise, absThreshold) {
  let best = null;
  for (const f of features) {
    const r = { feature: f, ...levelMet(f, vectors, noise, absThreshold) };
    if (!best || (r.met && !best.met) || (r.met === best.met && r.change > best.change)) {
      best = r;
    }
  }
  return best;
}

const SPATIAL_FEATURES = ['spatialFreqX', 'spatialFreqY', 'spatialFreqZ',
  'edgeSharpnessX', 'edgeSharpnessY', 'edgeSharpnessZ',
  'spatialStd', 'litFraction'];
const WHITE_FEATURES = ['wMean', 'aMean'];
const BRIGHT_FEATURES = ['lumaMean', 'outputMean'];

/**
 * Direction check: do the two ENDS of the sweep travel opposite ways?
 *
 * Endpoints, not min/max: a "direction" slider promises that the bottom of its
 * range goes one way and the top goes the other. A sign wobble somewhere in the
 * middle of the range is not a reversal, and taking min/max would score that
 * wobble as a pass — which it did, on 01_cylon_sweep, before this was tightened.
 *
 * Measured on the LAUNCH window (see claims.LAUNCH_FRAMES): ping-pong sweeps
 * average to zero net drift over a long window, so the honest question is which
 * way the pattern sets off. Every axis is tried, because patterns travel along
 * y and z too.
 *
 * @param {Record<string, number>[]} vectors — launch-window feature vectors.
 * @param {Record<string, number>} noise
 * @returns {object} best axis evidence.
 */
function directionEvidence(launch, longWindow, noise) {
  let best = null;
  for (const axis of ['X', 'Y', 'Z']) {
    const f = `drift${axis}`;
    const series = seriesOf(launch, f);
    const first = series[0];
    const last = series[series.length - 1];

    // Path 1 — net travel. A unidirectional scroller shows a clean sign flip
    // between the bottom and the top of the slider's range.
    const netReversed = Math.abs(first) >= THRESHOLDS.driftFloor
      && Math.abs(last) >= THRESHOLDS.driftFloor
      && Math.sign(first) !== Math.sign(last);

    // Path 2 — anticorrelated motion. A ping-pong sweep nets to ~0 travel in
    // BOTH directions, so net drift can never show its reversal. But if the
    // slider truly reverses it, the per-frame velocity series at the two ends
    // of the range run opposite: correlation goes strongly negative.
    const sA = longWindow[0][`driftSeries${axis}`];
    const sB = longWindow[longWindow.length - 1][`driftSeries${axis}`];
    const corr = correlate(sA, sB);
    const motion = Math.max(...longWindow.map(v => Math.abs(v[`gradEnergy${axis}`])));
    const corrReversed = corr <= THRESHOLDS.reversalCorrelation && motion > 0;

    const cand = {
      axis,
      series,
      first,
      last,
      corr,
      reversed: netReversed || corrReversed,
      via: netReversed ? 'net_travel' : (corrReversed ? 'anticorrelated_motion' : 'none'),
      moved: Math.max(Math.abs(first), Math.abs(last)),
      swing: effective(f, launch, noise),
    };
    if (!best || (cand.reversed && !best.reversed)
      || (cand.reversed === best.reversed && cand.moved > best.moved)) {
      best = cand;
    }
  }
  return best;
}

/**
 * Classify one swept parameter.
 *
 * @param {object} args
 * @param {string} args.control — control name (e.g. `sliderLocalSpeed`).
 * @param {string} args.family — claim family from claims.claimOf().
 * @param {Record<string, number>[]} args.vectors — feature vector per sweep point.
 * @param {Record<string, number>} args.noise — per-feature noise floor.
 * @param {boolean} args.identical — every sweep point rendered byte-identical.
 * @param {Record<string, number>[]} [args.launchVectors] — feature vectors from
 *   the no-warmup launch window; DIRECTION claims are judged on these.
 * @returns {object} verdict record.
 */
export function classify({ control, family, vectors, noise, identical, launchVectors = null }) {
  const movers = rankMovers(vectors, noise);
  const top = movers.slice(0, 4).map(m => ({
    feature: m.feature,
    change: Number(m.change.toFixed(5)),
  }));
  const effectScore = movers[0].change;

  const base = { control, family, effectScore: Number(effectScore.toFixed(5)), topMovers: top };

  // ── DEAD: byte-identical output, or nothing above the dead floor ──────
  if (identical) {
    return {
      ...base,
      verdict: VERDICT.DEAD,
      reason: 'byte_identical_across_full_range',
      detail: 'every sweep point rendered byte-identical frames — the control '
        + 'is not read, or is read into a term that cancels out',
    };
  }
  if (effectScore < THRESHOLDS.dead) {
    return {
      ...base,
      verdict: VERDICT.DEAD,
      reason: 'below_dead_threshold',
      detail: `largest normalised change ${effectScore.toFixed(5)} < `
        + `${THRESHOLDS.dead} on every measured feature`,
    };
  }

  const realEffect = effectScore >= THRESHOLDS.weak;

  // ── Family-specific claim checks ─────────────────────────────────────
  let claimMet = false;
  let claimDetail = '';
  let claimReason = '';

  if (family === FAMILY.SPEED) {
    const rate = seriesOf(vectors, 'temporalRate');
    const freq = seriesOf(vectors, 'temporalFreq');
    const rMono = monotonicity(rate);
    const fMono = monotonicity(freq);
    const rRatio = ratioOf(rate);
    const fRatio = ratioOf(freq);
    const rOk = rMono.monotonic && rMono.direction === 1 && rRatio >= THRESHOLDS.speedRatio;
    const fOk = fMono.monotonic && fMono.direction === 1 && fRatio >= THRESHOLDS.speedRatio;
    const inverted = (rMono.monotonic && rMono.direction === -1
      && rRatio >= THRESHOLDS.speedRatio)
      || (fMono.monotonic && fMono.direction === -1 && fRatio >= THRESHOLDS.speedRatio);
    claimMet = rOk || fOk;
    claimDetail = `temporalRate ${rate.map(v => v.toFixed(4)).join('/')} `
      + `(ratio ${rRatio.toFixed(2)}, mono ${rMono.direction}); `
      + `temporalFreq ratio ${fRatio.toFixed(2)}, mono ${fMono.direction}`;
    if (!claimMet && inverted) claimReason = 'speed_inverted';
    else if (!claimMet) claimReason = 'temporal_rate_did_not_track_slider';
  } else if (family === FAMILY.DIRECTION) {
    const ev = directionEvidence(launchVectors || vectors, vectors, noise);
    claimMet = ev.reversed;
    claimDetail = `launch drift${ev.axis} ${ev.series.map(v => v.toFixed(4)).join('/')} `
      + `(ends ${ev.first.toFixed(4)} → ${ev.last.toFixed(4)}, floor ±${THRESHOLDS.driftFloor}); `
      + `velocity-series correlation low↔high ${ev.corr.toFixed(3)} `
      + `(reversal at ≤ ${THRESHOLDS.reversalCorrelation})`
      + (ev.via !== 'none' ? ` [via ${ev.via}]` : '');
    if (!claimMet) {
      claimReason = ev.moved < THRESHOLDS.driftFloor
        ? 'no_measurable_motion_to_reverse'
        : 'no_reversal_net_travel_or_velocity_series';
    }
  } else if (family === FAMILY.HUE) {
    const change = effective('hueMean', vectors, noise);
    const satChange = effective('satMean', vectors, noise);
    claimMet = change >= THRESHOLDS.claim || satChange >= THRESHOLDS.claim;
    claimDetail = `hue circular swing ${(change * 0.5).toFixed(4)} turns `
      + `(normalised ${change.toFixed(4)}), saturation swing ${satChange.toFixed(4)}`;
    if (!claimMet) claimReason = 'hue_and_saturation_static';
  } else if (family === FAMILY.BRIGHTNESS) {
    const b = bestLevel(BRIGHT_FEATURES, vectors, noise, THRESHOLDS.claim);
    const mono = monotonicity(seriesOf(vectors, b.feature));
    claimMet = b.met && mono.monotonic && mono.direction === 1;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via}), monotonic ${mono.direction}`;
    if (!claimMet && b.met && mono.direction === -1) claimReason = 'brightness_inverted';
    else if (!claimMet && b.met) claimReason = 'brightness_not_monotonic';
    else if (!claimMet) claimReason = 'luma_did_not_track_slider';
  } else if (family === FAMILY.DARKNESS) {
    // A "blackout depth" / "shadow depth" knob removes light as it rises — and
    // it can do that by dimming everything (luma) OR by pushing more of the rig
    // to black (litFraction). 44_apex_gyro_vortex moves the second and barely
    // the first, so judging on luma alone called a working knob a liar.
    const b = bestLevel([...BRIGHT_FEATURES, 'litFraction'], vectors, noise,
      THRESHOLDS.claim);
    const mono = monotonicity(seriesOf(vectors, b.feature));
    claimMet = b.met && mono.monotonic && mono.direction === -1;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via}), monotonic ${mono.direction} (expected falling)`;
    if (!claimMet && b.met && mono.direction === 1) claimReason = 'darkness_inverted_adds_light';
    else if (!claimMet) claimReason = 'output_did_not_fall_with_slider';
  } else if (family === FAMILY.WHITE) {
    const b = bestLevel(WHITE_FEATURES, vectors, noise, THRESHOLDS.emitter);
    claimMet = b.met;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via}, threshold ${THRESHOLDS.emitter})`;
    if (!claimMet) claimReason = 'white_amber_emitters_unchanged';
  } else if (family === FAMILY.UV) {
    const b = bestLevel(['uvMean'], vectors, noise, THRESHOLDS.emitter);
    claimMet = b.met;
    claimDetail = `uvMean swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via}, threshold ${THRESHOLDS.emitter})`;
    if (!claimMet) claimReason = 'uv_emitter_unchanged';
  } else if (family === FAMILY.WARMTH) {
    // Warmth is a warm↔cool tint: it may act on the W/A emitters, on the UV
    // emitter (the cool end of the ship's palette), or on RGB colour balance.
    const b = bestLevel([...WHITE_FEATURES, 'uvMean', 'rMean', 'bMean'],
      vectors, noise, THRESHOLDS.emitter);
    const hue = effective('hueMean', vectors, noise);
    claimMet = b.met || hue >= THRESHOLDS.claim;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via}), hue ${hue.toFixed(4)}`;
    if (!claimMet) claimReason = 'neither_emitters_nor_colour_balance_moved';
  } else if (family === FAMILY.SPATIAL) {
    const b = bestOf(SPATIAL_FEATURES, vectors, noise);
    const mono = monotonicity(seriesOf(vectors, b.feature));
    claimMet = b.change >= THRESHOLDS.claim;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)}, monotonic ${mono.direction}`;
    if (claimMet && !mono.monotonic) claimDetail += ' [non-monotonic]';
    if (!claimMet) claimReason = 'spatial_statistics_unchanged';
  } else if (family === FAMILY.TRAIL) {
    const b = bestOf([...SPATIAL_FEATURES, 'temporalRate'], vectors, noise);
    claimMet = b.change >= THRESHOLDS.claim;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)}`;
    if (!claimMet) claimReason = 'trail_extent_and_persistence_unchanged';
  } else if (family === FAMILY.CONTRAST) {
    const b = bestLevel(['contrastRatio', 'spatialStd'], vectors, noise, THRESHOLDS.claim);
    claimMet = b.met;
    claimDetail = `${b.feature} swing ${b.change.toFixed(4)} ratio ${b.ratio.toFixed(2)} `
      + `(via ${b.via})`;
    if (!claimMet) claimReason = 'spatial_contrast_unchanged';
  } else {
    // MAGNITUDE / UNKNOWN_CLAIM — the name promises only that there is an
    // amount of something. Any real, above-threshold effect satisfies it.
    claimMet = effectScore >= THRESHOLDS.claim;
    claimDetail = `dominant mover ${movers[0].feature} ${effectScore.toFixed(4)}`;
  }

  // ── Verdict assembly ─────────────────────────────────────────────────
  if (claimMet) {
    // An effect can satisfy its claim yet still be too small to find on a
    // fader; say so rather than calling it a clean pass.
    if (effectScore < THRESHOLDS.weak && family !== FAMILY.SPEED) {
      return {
        ...base,
        verdict: VERDICT.WEAK,
        reason: 'claim_met_but_sub_visible',
        detail: claimDetail,
      };
    }
    if (family === FAMILY.UNKNOWN_CLAIM) {
      return {
        ...base,
        verdict: VERDICT.UNKNOWN_CLAIM,
        reason: 'name_makes_no_falsifiable_claim',
        detail: claimDetail,
      };
    }
    return { ...base, verdict: VERDICT.TRUE, reason: 'claim_met', detail: claimDetail };
  }

  // Claim not met.
  if (family === FAMILY.UNKNOWN_CLAIM) {
    return {
      ...base,
      verdict: VERDICT.UNKNOWN_CLAIM,
      reason: 'name_makes_no_falsifiable_claim',
      detail: claimDetail,
    };
  }
  if (!realEffect) {
    return {
      ...base,
      verdict: VERDICT.WEAK,
      reason: claimReason || 'effect_below_visible_threshold',
      detail: claimDetail,
    };
  }
  if (NON_FALSIFIABLE.has(family)) {
    return {
      ...base,
      verdict: VERDICT.WEAK,
      reason: 'amount_claim_effect_below_threshold',
      detail: claimDetail,
    };
  }
  return {
    ...base,
    verdict: VERDICT.WRONG,
    reason: claimReason,
    detail: `${claimDetail} — but the sweep DID move `
      + `${movers[0].feature} by ${effectScore.toFixed(4)}`,
  };
}

export { hueDistance };
