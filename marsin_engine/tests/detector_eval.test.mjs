/**
 * detector_eval.test.mjs — regression guard that LOCKS IN the 2026-06-20
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
 * Run:  cd marsin_engine && node --test tests/detector_eval.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evalConfig } from '../tools/detection_eval.mjs';
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

test('drop scoring: high precision + meaningful recall + low latency on labeled drops', () => {
  const r = evalConfig(SHIPPED, { quiet: true });
  assert.ok(r.drop.precision >= 0.9, `drop precision ${r.drop.precision} < 0.9`);
  assert.ok(r.drop.recall >= 0.5, `drop recall ${r.drop.recall} < 0.5`);
  assert.ok(r.drop.f1 >= 0.65, `drop F1 ${r.drop.f1} < 0.65`);
  // Latency is the signed detected−labeled mean; a drop fires AFTER its
  // downbeat but must stay within ~½ bar.
  assert.ok(Math.abs(r.drop.meanLatencyMs) <= 600, `drop latency ${r.drop.meanLatencyMs}ms exceeds 600ms`);
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
