/**
 * detection_metrics.test.mjs — fast deterministic unit guards for the
 * detection scoring math (run_analysis exports) + the scenario generator,
 * with no mic model / analyzer in the loop. These protect the EVAL HARNESS
 * itself so a metrics bug can't silently flatter (or sandbag) a tuning pass.
 *
 * Run:  cd marsin_engine && node --test tests/integration/detection_metrics.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { f1Score, pearson, buildCorrelation, slowZoneSeparation } from './run_analysis.mjs';
import { buildScenarios } from './detector_scenarios.mjs';

test('f1Score is the harmonic mean of precision and recall', () => {
  assert.equal(f1Score(1, 1), 1);
  assert.equal(f1Score(0, 0), 0);
  assert.ok(Math.abs(f1Score(0.5, 1) - (2 / 3)) < 1e-9);
  assert.equal(f1Score(null, 0.5), null);
});

test('pearson: +1 for a perfect rising line, −1 for inverse, ~0 for constant', () => {
  const up = [0, 1, 2, 3, 4];
  assert.ok(Math.abs(pearson(up, [0, 2, 4, 6, 8]) - 1) < 1e-9);
  assert.ok(Math.abs(pearson(up, [8, 6, 4, 2, 0]) + 1) < 1e-9);
  assert.equal(pearson(up, [5, 5, 5, 5, 5]), null); // zero variance → undefined
});

test('buildCorrelation: a buildScore that tracks the ramp scores high; flat scores null/low', () => {
  // Synthetic rec: one build ramp 0→1000ms peaking at 1000ms. detectorSeries
  // buildScore rising linearly should correlate ~1.
  const tMs = []; const rising = []; const flat = [];
  for (let t = 0; t <= 1000; t += 50) { tMs.push(t); rising.push(t / 1000); flat.push(0.5); }
  const base = { labels: { build: [{ startMs: 0, endMs: 1000, peakAtMs: 1000 }] } };
  const recUp = { ...base, detectorSeries: { tMs, buildScore: rising } };
  const bcUp = buildCorrelation(recUp);
  assert.ok(bcUp.meanCorrelation >= 0.99, `rising build corr ${bcUp.meanCorrelation}`);
  const recFlat = { ...base, detectorSeries: { tMs, buildScore: flat } };
  const bcFlat = buildCorrelation(recFlat);
  assert.equal(bcFlat.ramps[0].correlation, null); // flat → undefined correlation
  // No build labels → null.
  assert.equal(buildCorrelation({ labels: {}, detectorSeries: { tMs, buildScore: rising } }), null);
});

test('slowZoneSeparation: high slowZone in slow regions vs low elsewhere → big margin', () => {
  // 0–4 s slow region (slowZone≈0.9), 4–8 s active (slowZone≈0.1).
  const tMs = []; const slowZone = [];
  for (let t = 0; t < 8000; t += 100) { tMs.push(t); slowZone.push(t < 4000 ? 0.9 : 0.1); }
  const rec = { labels: { slow: [{ startMs: 0, endMs: 4000 }] }, detectorSeries: { tMs, slowZone } };
  const sz = slowZoneSeparation(rec, { settleMs: 500 });
  assert.ok(sz.slowMean > 0.8, `slowMean ${sz.slowMean}`);
  assert.ok(sz.nonSlowMean < 0.2, `nonSlowMean ${sz.nonSlowMean}`);
  assert.ok(sz.margin > 0.6, `margin ${sz.margin}`);
  assert.ok(sz.accuracy > 0.9, `accuracy ${sz.accuracy}`);
});

test('scenarios are deterministic, well-labeled, and have the expected shape', () => {
  const a = buildScenarios();
  const b = buildScenarios();
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    // Byte-identical samples (seeded).
    assert.equal(a[i].samples.length, b[i].samples.length);
    assert.equal(a[i].samples[1234], b[i].samples[1234]);
    // Every clip carries the extended label tracks.
    assert.ok(Array.isArray(a[i].labels.regions));
    assert.ok(Array.isArray(a[i].labels.drops));
    assert.ok(Array.isArray(a[i].labels.slow));
    assert.ok(Array.isArray(a[i].labels.build));
  }
  // full_arc has exactly two labeled drops + two build ramps + breakdown slow.
  const arc = a.find((c) => c.name === 'full_arc');
  assert.equal(arc.labels.drops.length, 2, 'full_arc should label 2 drops');
  assert.equal(arc.labels.build.length, 2, 'full_arc should label 2 build ramps');
  assert.ok(arc.labels.slow.length >= 2, 'full_arc should label intro + breakdown slow');
  // Each labeled build ramp peaks at (≈) a labeled drop.
  for (const bld of arc.labels.build) {
    const nearDrop = arc.labels.drops.some((d) => Math.abs(d.ts - bld.peakAtMs) < 1);
    assert.ok(nearDrop, `build ramp peak ${bld.peakAtMs} should align with a drop`);
  }
});
