// Unit tests for the quick BPM EMA smoother (lib/bpm_smoother.js), shared by
// the Audio Companion (smooths before UI + OSC) and the engine arbiter.
//
// Run:  cd marsin_engine && node --test tests/bpm_smoother.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BpmSmoother, DEFAULT_BPM_SMOOTH_TAU_MS } from '../../lib/bpm_smoother.js';

test('default tau is the short, quick value', () => {
  assert.equal(DEFAULT_BPM_SMOOTH_TAU_MS, 250);
});

test('first push seeds directly (zero added delay on acquire)', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  assert.equal(s.push(128, 11.6), 128);
  assert.equal(s.value, 128);
});

test('disabled ⇒ pure pass-through', () => {
  const s = new BpmSmoother({ enabled: false, tauMs: 250 });
  assert.equal(s.push(128, 11.6), 128);
  assert.equal(s.push(140, 11.6), 140, 'no smoothing when disabled');
});

test('tauMs<=0 ⇒ pass-through', () => {
  const s = new BpmSmoother({ tauMs: 0 });
  s.push(128, 11.6);
  assert.equal(s.push(140, 11.6), 140);
});

test('EMA pulls toward the new value but does not jump there in one step', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  s.push(128, 11.6);                 // seed 128
  const out = s.push(140, 11.6);     // step toward 140
  // alpha = 1 - exp(-11.6/250) ≈ 0.0453 → 128 + 0.0453*12 ≈ 128.54
  assert.ok(out > 128 && out < 129, `expected a small step, got ${out}`);
});

test('jitter around a center averages to ~center (de-jitter)', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  let out = s.push(130, 11.6);       // seed
  for (let i = 0; i < 200; i++) {    // alternate 128/132 around 130
    out = s.push(i % 2 === 0 ? 128 : 132, 11.6);
  }
  assert.ok(Math.abs(out - 130) < 1, `jitter should settle near 130, got ${out}`);
});

test('quick: a real step is mostly followed within ~3·tau', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  s.push(120, 11.6);                 // seed 120
  // Feed 160 for 750ms (~3·tau) at the ~86 Hz rate.
  let out = 120;
  for (let t = 0; t < 750; t += 11.6) out = s.push(160, 11.6);
  assert.ok(out > 158, `should reach ~95% of the step in 3·tau, got ${out}`);
});

test('a long gap (re-acquire) self-seeds to the fresh value', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  s.push(120, 11.6);
  // 5s gap → alpha ≈ 1 → snaps to the new value.
  const out = s.push(160, 5000);
  assert.ok(out > 159.9, `long gap should snap, got ${out}`);
});

test('non-finite sample is ignored (no NaN poisoning)', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  s.push(128, 11.6);
  assert.equal(s.push(NaN, 11.6), 128, 'NaN ignored, last value held');
  assert.equal(s.value, 128);
});

test('reset() drops the running value so the next push seeds directly', () => {
  const s = new BpmSmoother({ tauMs: 250 });
  s.push(120, 11.6);
  s.reset();
  assert.equal(s.value, null);
  assert.equal(s.push(160, 11.6), 160, 'seeds directly after reset');
});
