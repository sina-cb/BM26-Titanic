/**
 * signal_metrics.test.mjs — deterministic unit guard for the chain-feel
 * metrics. Pure arrays, no audio.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signalFeel, flickerRate, percentile } from './signal_metrics.mjs';

const HOP = 11.6; // ms/hop ≈ 512/44100

test('a smooth ramp has far lower flicker than an alternating signal', () => {
  const n = 500;
  const ramp = Array.from({ length: n }, (_, i) => i / n);
  const zig = Array.from({ length: n }, (_, i) => (i % 2 ? 0.8 : 0.2));
  assert.ok(flickerRate(ramp, HOP) < 1, `ramp flicker ${flickerRate(ramp, HOP)}`);
  assert.ok(flickerRate(zig, HOP) > 20, `zig flicker ${flickerRate(zig, HOP)}`);
});

test('pulseDepth reflects p95−p05 spread', () => {
  const flat = new Array(200).fill(0.5);
  const pumpy = Array.from({ length: 200 }, (_, i) => (i % 20 < 10 ? 0.1 : 0.9));
  assert.ok(signalFeel(flat, HOP).pulseDepth < 0.05);
  assert.ok(signalFeel(pumpy, HOP).pulseDepth > 0.5);
});

test('transient timing: a sharp pulse has a short attack', () => {
  // build a series with a sharp rise (2 hops) then slow decay.
  const a = [];
  for (let k = 0; k < 5; k++) {
    a.push(0, 0, 0.2, 1.0);                 // ~2-hop rise to peak
    for (let d = 0; d < 12; d++) a.push(1.0 * Math.exp(-d / 3)); // decay
  }
  const feel = signalFeel(a, HOP, { transient: true, peakMin: 0.5 });
  assert.ok(feel.onsets >= 3, `onsets ${feel.onsets}`);
  assert.ok(feel.attackMs !== null && feel.attackMs <= 3 * HOP, `attack ${feel.attackMs}`);
});

test('percentile is monotonic and bounded', () => {
  const a = Array.from({ length: 101 }, (_, i) => i / 100);
  assert.ok(percentile(a, 0.05) <= percentile(a, 0.5));
  assert.ok(percentile(a, 0.5) <= percentile(a, 0.95));
  assert.equal(percentile([], 0.5), 0);
});

test('signalFeel returns finite numbers on a constant signal', () => {
  const f = signalFeel(new Array(100).fill(0.3), HOP);
  for (const k of ['flickerHz', 'meanAbsDelta', 'variance', 'pulseDepth', 'mean']) {
    assert.ok(Number.isFinite(f[k]), `${k} not finite: ${f[k]}`);
  }
});
