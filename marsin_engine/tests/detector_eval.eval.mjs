/**
 * detector_eval.eval.mjs — regression guard that LOCKS IN the 2026-06-20
 * detector super-tuning (drop / slow-zone / build) against the labeled
 * synthetic scenarios, degraded through the virtual playa mic.
 *
 * These assertions encode the acceptance bar the tuning was accepted at
 * (tools/detection_eval). They are deliberately set a notch BELOW the measured
 * numbers so normal noise doesn't flake them, but tight enough that a
 * regression (e.g. someone reverts dropMinLevel, or breaks the slow-zone
 * soft-knee) trips immediately.
 *
 * Measured at tuning time (shipped DETECTOR_DEFAULTS, all 3 mic tiers):
 *   DROP   P=1.00 R=0.56 F1=0.71 lat≈196ms  negFP=0
 *   BUILD  corr=0.97  peakErr≈-6ms
 *   SLOW   margin=0.65 acc=0.91  (slow=0.83 vs nonSlow=0.18)
 *
 * P0-1 real-audio precision-first re-tune (report 20260620_23):
 *   The above synthetic recall (0.56) was a SYNTHETIC artifact — the same loose
 *   windowed-edge tuning that scored it fired 1.48 phantom drops/min on 60 min of
 *   REAL continuous DJ music (the synthetic negatives are structurally blind to
 *   busy-music false-fires). The re-tune (jump 1.9→4.0, rise/novelty gates on
 *   BOTH drop edges, slowZoneMax 0.4→0.30) drives REAL falseFiresPerMin to 0.12
 *   (≤ 0.15 target) at the honest cost of synthetic DROP recall → 0.28 (only the
 *   realistic MODERATE mic tier still fires; clean/heavy true drops read the same
 *   gentle windowed ratio as busy music and are inseparable from a phantom).
 *   Per codex + operator: a phantom drop on the dance floor is worse than a miss.
 *   Re-measured shipped DETECTOR_DEFAULTS (all 3 tiers):
 *     DROP   P=1.00 R=0.28 F1=0.43 lat≈202ms  negFP=0  REAL ff/min=0.12
 *
 * Run:  cd marsin_engine && node --test tests/detector_eval.eval.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evalConfig, evalRealCorpus } from '../tools/detection_eval.mjs';
import { buildScenarios } from './integration/detector_scenarios.mjs';
import { applyMicModel } from './integration/mic_model.mjs';
import { runClip, dropMetrics, buildCorrelation, slowZoneSeparation } from './integration/run_analysis.mjs';

// The shipped product default detector (DETECTOR_DEFAULTS via the merge —
// only `enabled` is forced on). This is what the regression protects.
const SHIPPED = { enabled: true };

test('drop scoring: ZERO false positives on calm/build scenarios (the dance-floor invariant)', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  // The single most important property: never fire a phantom drop on calm,
  // ambient, building, or steady-techno music. negFp counts spurious drops on
  // ALL no-drop scenarios across all tiers.
  assert.equal(r.drop.negFp, 0, `spurious drops on negative scenarios: ${r.drop.negFp}`);
});

test('honest metrics: with ZERO false-fires, guardedPrecision == precision and falseFiresPerMin == 0', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  // The shipped detector fires no phantom drops, so the honest guarded
  // precision must equal the positive-only precision and the headline
  // false-fire rate must be exactly zero.
  assert.equal(r.drop.negFp, 0, 'precondition: shipped config has no phantom drops');
  assert.equal(r.drop.guardedPrecision, r.drop.precision,
    `guardedPrecision ${r.drop.guardedPrecision} != precision ${r.drop.precision} with negFp=0`);
  assert.equal(r.drop.falseFiresPerMin, 0,
    `falseFiresPerMin ${r.drop.falseFiresPerMin} != 0 with no phantom drops`);
  assert.ok(r.drop.negDurationMs > 0, 'negative-clip duration must be measured (denominator)');
});

test('honest metrics: a config with KNOWN phantom drops exposes falseFiresPerMin>0 and guardedPrecision<precision', () => {
  // The `level`-edge baseline historically false-fires on the calm/steady
  // NEGATIVE scenarios. The positive-only precision can still look healthy
  // because it ignores those phantom drops (`negFp`) — exactly the dishonesty
  // the guarded metrics are here to catch. This is the "inject a known phantom
  // drop → falseFiresPerMin > 0" assertion.
  const r = evalConfig({ enabled: true, dropEdgeMode: 'level', eventRefractoryMs: 2000 },
    { quiet: true });
  assert.ok(r.drop.negFp > 0, `expected the baseline to false-fire; negFp=${r.drop.negFp}`);
  assert.ok(r.drop.falseFiresPerMin > 0,
    `falseFiresPerMin ${r.drop.falseFiresPerMin} must be > 0 when negFp=${r.drop.negFp}`);
  // guardedPrecision folds negFp into the denominator, so it must be STRICTLY
  // lower than the positive-only precision whenever there are phantom drops —
  // the honest number cannot be flattered by them.
  assert.ok(r.drop.guardedPrecision < r.drop.precision,
    `guardedPrecision ${r.drop.guardedPrecision} should be < precision ${r.drop.precision}`);
  // Verify the exact formulas (no rounding fudge).
  const expectedGuarded = r.drop.tp / (r.drop.tp + r.drop.fp + r.drop.negFp);
  assert.ok(Math.abs(r.drop.guardedPrecision - expectedGuarded) < 1e-12,
    `guardedPrecision ${r.drop.guardedPrecision} != tp/(tp+fp+negFp) ${expectedGuarded}`);
  const expectedFfpm = r.drop.negFp / (r.drop.negDurationMs / 60000);
  assert.ok(Math.abs(r.drop.falseFiresPerMin - expectedFfpm) < 1e-9,
    `falseFiresPerMin ${r.drop.falseFiresPerMin} != negFp/min ${expectedFfpm}`);
});

test('drop scoring: high precision + (precision-first) recall + low latency on labeled drops', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  assert.ok(r.drop.precision >= 0.9, `drop precision ${r.drop.precision} < 0.9`);
  // PRECISION-FIRST recall bar (P0-1 re-tune, report 23). The recall floor is
  // deliberately LOW: the shipped gates trade synthetic recall (clean/heavy mic
  // tiers, whose synthetic drops are indistinguishable from real busy music) for
  // a near-zero REAL false-fire rate. We keep a meaningful floor so a regression
  // that kills ALL drops trips, but never re-raise this without re-proving the
  // REAL falseFiresPerMin stays ≤ 0.15 (the real_corpus test below).
  assert.ok(r.drop.recall >= 0.25, `drop recall ${r.drop.recall} < 0.25`);
  assert.ok(r.drop.f1 >= 0.40, `drop F1 ${r.drop.f1} < 0.40`);
  // Latency is the signed detected−labeled mean; a drop fires AFTER its
  // downbeat but must stay within ~½ bar.
  assert.ok(Math.abs(r.drop.meanLatencyMs) <= 600, `drop latency ${r.drop.meanLatencyMs}ms exceeds 600ms`);
});

test('REAL-corpus dance-floor safety: falseFiresPerMin ≤ 0.15 (skipped when corpus absent)', (t) => {
  // The headline P0-1 invariant (report 23): on 60 min of continuous real DJ
  // music — which has NO EDM drops in its windows, so every dropFired is a false
  // positive — the shipped detector must stay below the dance-floor safety bar.
  // The corpus is real audio in ~/tmp and is NOT present in CI; when absent the
  // eval returns { available:false } and we skip cleanly (codex offline-readiness
  // — no fabricated pass, no fallback). This is the test that would have caught
  // the original 1.48/min regression the synthetic suite was blind to.
  const real = evalRealCorpus(SHIPPED, { quiet: true });
  if (!real.available) { t.skip(`real corpus absent (${real.corpusDir})`); return; }
  assert.ok(real.falseFiresPerMin <= 0.15,
    `REAL falseFiresPerMin ${real.falseFiresPerMin} exceeds 0.15 (${real.drops} phantom drops over ${real.minutes.toFixed(1)} min)`);
  // P0-2: no Infinity buildDurationMs ever broadcast (the THIN-edge clamp).
  assert.equal(real.infiniteBuildDur, 0,
    `${real.infiniteBuildDur} dropFired carried a non-finite buildDurationMs`);
});

test('build scoring: buildScore tracks the riser (high correlation) and peaks at the drop', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  assert.ok(r.build.meanCorrelation >= 0.85,
    `build/ramp correlation ${r.build.meanCorrelation} < 0.85`);
  // The buildScore peak should land within ~1 s of the true drop.
  assert.ok(Math.abs(r.build.meanPeakErrMs) <= 1000,
    `build-peak vs drop error ${r.build.meanPeakErrMs}ms exceeds 1000ms`);
});

test('slow-zone scoring: clean calm-vs-active separation', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  assert.ok(r.slow.meanMargin >= 0.45,
    `slow-zone separation margin ${r.slow.meanMargin} < 0.45`);
  assert.ok(r.slow.meanAccuracy >= 0.8,
    `slow-zone threshold accuracy ${r.slow.meanAccuracy} < 0.8`);
  assert.ok(r.slow.meanSlow >= 0.6, `slow regions read too low (${r.slow.meanSlow})`);
  assert.ok(r.slow.meanNonSlow <= 0.4, `non-slow regions read too high (${r.slow.meanNonSlow})`);
});

// ── Per-scenario behavioural guards (the operator's three named asks) ─────

test('edm_drop arc: at least one drop fires within tolerance of a true drop (moderate mic)', () => {
  const clip = buildScenarios().find((c) => c.name === 'full_arc');
  const deg = applyMicModel(clip.samples, clip.sampleRate, { tier: 'moderate', seed: 0x5EED });
  const rec = runClip({ ...clip, samples: deg.samples }, { mode: 'stems-fed', detectorConfig: SHIPPED });
  const dm = dropMetrics(rec, 1200);
  assert.ok(dm.tp >= 1, `expected ≥1 matched drop on full_arc@moderate, got tp=${dm.tp}`);
  assert.equal(dm.fp, 0, `full_arc@moderate fired ${dm.fp} false drops`);
});

test('ambient/silence: slowZone high, NO drop fires (moderate mic)', () => {
  const clip = buildScenarios().find((c) => c.name === 'ambient_long');
  const deg = applyMicModel(clip.samples, clip.sampleRate, { tier: 'moderate', seed: 0x5EED });
  const rec = runClip({ ...clip, samples: deg.samples }, { mode: 'mic-only', detectorConfig: SHIPPED });
  assert.equal(rec.dropFired.length, 0, 'ambient must not fire a drop');
  const sz = slowZoneSeparation(rec);
  assert.ok(sz.slowMean >= 0.6, `ambient slowZone too low (${sz.slowMean})`);
});

test('riser: buildScore rises monotonic-ish up to the drop (single_drop_long, clean)', () => {
  const clip = buildScenarios().find((c) => c.name === 'single_drop_long');
  const deg = applyMicModel(clip.samples, clip.sampleRate, { tier: 'clean', seed: 0x5EED });
  const rec = runClip({ ...clip, samples: deg.samples }, { mode: 'stems-fed', detectorConfig: SHIPPED });
  const bc = buildCorrelation(rec);
  assert.ok(bc && bc.meanCorrelation >= 0.85,
    `riser build correlation ${bc && bc.meanCorrelation} < 0.85`);
});

test('techno_steady: driving-but-steady body does NOT false-fire drops (all tiers)', () => {
  const clip = buildScenarios().find((c) => c.name === 'techno_steady');
  for (const tier of ['clean', 'moderate', 'heavy']) {
    const deg = applyMicModel(clip.samples, clip.sampleRate, { tier, seed: 0x5EED });
    const rec = runClip({ ...clip, samples: deg.samples }, { mode: 'mic-only', detectorConfig: SHIPPED });
    assert.equal(rec.dropFired.length, 0, `techno_steady@${tier} fired ${rec.dropFired.length} phantom drops`);
  }
});
