// Tests for the `danceMaker` frequency-domain op (docs/37 §2.2 "DanceMaker").
//
// The op promotes the legacy companion_server.js dom-dance spring
// (springStep / DANCE_OMEGA) into a selectable op. These tests prove:
//   1. PARITY — the op's output matches the legacy springStep math BIT-FOR-BIT
//      on the same input sequence (promoting it to an op did NOT change the
//      dance). The op and the visualizer share `danceSpringStep`, so this also
//      guards the one-source-of-truth contract.
//   2. SYNTHETIC — a step in Hz is spring-smoothed: it GLIDES to the target,
//      monotonically and WITHOUT overshoot (critically damped), and a larger
//      omega settles FASTER than a smaller one.
//   3. TYPE-AWARENESS — danceMaker validates on a frequency signal and is
//      rejected on an intensity signal (companion_config FREQUENCY_OPS gate).
//
// Run:  cd marsin_engine && node --test tests/dance_maker.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignalPostProcessor, validateChain,
  DANCE_OMEGA, danceSpringStep,
} from '../audio/postproc/signal_post_processor.js';
import { validateSignal, FREQUENCY_OPS } from '../audio/companion/companion_config.js';

// One analyzer hop at 44.1 kHz — the engine's real audio frame delta.
const DT = 512 / 44100; // ≈ 0.011610 s
const PROXY = 'micLow';

function makeParamCenter(initial = {}) {
  const store = { ...initial };
  return {
    get(key) {
      if (!(key in store)) throw new Error(`ParamCenter.get: unknown key ${key}`);
      return store[key];
    },
    has(key) { return key in store; },
    set(key, v) { store[key] = v; },
  };
}

// Drive a single danceMaker op through the REAL process() path (Hz mode).
function runDanceOp(inputs, { omega, dt = DT } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: makeParamCenter(), outputMode: 'frequency' });
  const params = omega === undefined ? {} : { omega };
  proc.putChain(PROXY, [{ id: 'dance', type: 'danceMaker', enabled: true, params }]);
  return inputs.map((x) => proc.process(PROXY, x, dt));
}

// The LEGACY spring, run inline EXACTLY as companion_server.js did historically
// (k = ω², c = 2ω, explicit Euler). This is the reference the op must match.
function legacySpring(inputs, omega = DANCE_OMEGA, dt = DT) {
  let x = 0, v = 0;
  const out = [];
  for (const target of inputs) {
    const k = omega * omega, c = 2 * omega;
    v += (k * (target - x) - c * v) * dt;
    x += v * dt;
    out.push(x);
  }
  return out;
}

// ── 1) PARITY ────────────────────────────────────────────────────────────────

test('danceMaker matches the legacy springStep output BIT-FOR-BIT (default omega)', () => {
  // A realistic dom-freq sequence: a held value, a jump, a wobble, a drop.
  const inputs = [];
  for (let i = 0; i < 50; i++) inputs.push(440);
  for (let i = 0; i < 80; i++) inputs.push(880);
  for (let i = 0; i < 40; i++) inputs.push(880 + 30 * Math.sin(i / 3));
  for (let i = 0; i < 60; i++) inputs.push(110);

  const got = runDanceOp(inputs);                 // op path, default omega
  const ref = legacySpring(inputs, DANCE_OMEGA);  // legacy inline spring

  assert.equal(got.length, ref.length);
  for (let i = 0; i < ref.length; i++) {
    // Bit-for-bit: the op reuses the SAME danceSpringStep helper the visualizer
    // calls, so there is no floating-point drift to tolerate.
    assert.equal(got[i], ref[i], `mismatch at hop ${i}: op=${got[i]} legacy=${ref[i]}`);
  }
});

test('danceMaker matches the legacy spring at a NON-default omega', () => {
  const inputs = [];
  for (let i = 0; i < 120; i++) inputs.push(i < 30 ? 200 : 2000);
  const omega = 3.5;
  const got = runDanceOp(inputs, { omega });
  const ref = legacySpring(inputs, omega);
  for (let i = 0; i < ref.length; i++) assert.equal(got[i], ref[i]);
});

test('the shared danceSpringStep helper IS the math both callers use', () => {
  // Sanity: a single helper step equals one inline Euler step.
  const [x, v] = danceSpringStep(100, 5, 880, DT, DANCE_OMEGA);
  const k = DANCE_OMEGA * DANCE_OMEGA, c = 2 * DANCE_OMEGA;
  let vRef = 5 + (k * (880 - 100) - c * 5) * DT;
  let xRef = 100 + vRef * DT;
  assert.equal(x, xRef);
  assert.equal(v, vRef);
});

// ── 2) SYNTHETIC: glides, no overshoot, omega = settle speed ──────────────────

test('a step in Hz GLIDES to target with no overshoot (critically damped)', () => {
  const TARGET = 1000;
  const inputs = new Array(400).fill(TARGET);
  const out = runDanceOp(inputs);

  // Monotonic rise toward the target — never decreasing (critically damped: no
  // ringing), and never crossing above the target (no overshoot).
  let prev = 0;
  let maxSeen = 0;
  for (const y of out) {
    assert.ok(y >= prev - 1e-9, `not monotonic: ${y} < ${prev}`);
    assert.ok(y <= TARGET + 1e-6, `overshoot: ${y} > ${TARGET}`);
    prev = y;
    maxSeen = Math.max(maxSeen, y);
  }
  // It actually converges close to the target within the window.
  assert.ok(out[out.length - 1] > TARGET * 0.98, `did not settle: ${out[out.length - 1]}`);
  assert.ok(maxSeen <= TARGET + 1e-6, 'peak overshot the target');
  // And it does NOT start AT the target (it glides — the first hop is small).
  assert.ok(out[0] < TARGET * 0.1, `first hop should be a small glide, got ${out[0]}`);
});

test('a larger omega settles FASTER than a smaller omega', () => {
  const TARGET = 1000;
  const inputs = new Array(60).fill(TARGET); // short window so settle differs
  const slow = runDanceOp(inputs, { omega: 3 });
  const fast = runDanceOp(inputs, { omega: 12 });
  // After the same number of hops, the faster spring is closer to the target.
  assert.ok(fast[fast.length - 1] > slow[slow.length - 1],
    `fast=${fast[fast.length - 1]} should exceed slow=${slow[slow.length - 1]}`);
});

// ── 3) TYPE-AWARENESS (frequency-only op) ─────────────────────────────────────

test('danceMaker is in the FREQUENCY_OPS palette', () => {
  assert.ok(FREQUENCY_OPS.includes('danceMaker'), 'danceMaker offered on frequency signals');
});

test('danceMaker VALIDATES on a frequency signal', () => {
  const sig = {
    id: 'dom1', label: 'DOM1', source: 'rawDom1', type: 'frequency', output: true,
    chain: [
      { id: 'd', type: 'danceMaker', enabled: true, params: { omega: 7 } },
      { id: 'o', type: 'osc_out', enabled: true, params: { address: '/marsin/dom/freq1', cpcKey: 'micDomFreq1' } },
    ],
  };
  const v = validateSignal(sig);
  assert.equal(v.ok, true, v.error);
});

test('danceMaker is REJECTED on an intensity signal', () => {
  const sig = {
    id: 'low', label: 'LOW', source: 'rawLow', type: 'intensity', output: true,
    chain: [
      { id: 'd', type: 'danceMaker', enabled: true, params: { omega: 7 } },
      { id: 'o', type: 'osc_out', enabled: true, params: { address: '/marsin/mic/low', cpcKey: 'micLow' } },
    ],
  };
  const v = validateSignal(sig);
  assert.equal(v.ok, false);
  assert.match(v.error, /intensity-only|danceMaker/);
});

test('danceMaker op is in the catalog as a frequency-domain spring (omega param)', () => {
  // Round-trips through validateChain in Hz mode with the default omega.
  const r = validateChain('micLow', [
    { id: 'd', type: 'danceMaker', enabled: true, params: {} },
  ], { hz: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.normalized[0].params.omega, DANCE_OMEGA, 'default omega injected');
});
