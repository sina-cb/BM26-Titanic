// Synthetic-data test suite for OP CHAINING in the SignalPostProcessor
// (audio/postproc/signal_post_processor.js).
//
// PURPOSE
// -------
// The operator explicitly asked for CHAINED ops to be verified, and filed a
// bug: "changing op params shows no diff in output". This file proves:
//   1. multi-op chains compose in order (gain→lpf→schmitt, envelope→hold,
//      gain→compressor→clamp);
//   2. REORDERING ops changes the output (order matters);
//   3. re-loading a chain via loadChains()/putChain() with a CHANGED param
//      VISIBLY changes process() output — this is the crux of the bug report;
//   4. runtime state RESETS on chain reload (no stale yPrev/clock leaking).
//
// Determinism: fixed dt = 512/44100 s and hand-built synthetic inputs.
//
// Run:  cd marsin_engine && node --test tests/op_chains_synthetic.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignalPostProcessor,
} from '../audio/postproc/signal_post_processor.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

const DT = 512 / 44100;

function makeParamCenter(initial = {}) {
  const store = { ...initial };
  return {
    get(key) {
      if (!(key in store)) throw new Error(`ParamCenter.get: unknown key ${key}`);
      return store[key];
    },
    set(key, v) { store[key] = v; },
  };
}

function fullGainPC(extra = {}) {
  return makeParamCenter({
    micLowGain: 1.0, micMidGain: 1.0, micHighGain: 1.0, micKickGain: 1.0,
    micFluxGain: 1.0,
    stemsBassGain: 1.0, stemsDrumsGain: 1.0, stemsVocalsGain: 1.0,
    ...extra,
  });
}

const constSig = (v, n) => Array.from({ length: n }, () => v);
const stepSig = (lo, hi, nLo, nHi) => [...constSig(lo, nLo), ...constSig(hi, nHi)];
const last = (arr) => arr[arr.length - 1];
const approx = (actual, expected, eps, msg = '') =>
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg} expected ≈${expected}, got ${actual} (diff=${actual - expected})`);

// Drive a whole chain on a signal and return per-sample post-chain output.
function runChain(chain, inputs, { signalKey = 'micLow', pc = null, dt = DT } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: pc || fullGainPC() });
  proc.putChain(signalKey, chain);
  return inputs.map((x) => proc.process(signalKey, x, dt));
}

// ── Composed-chain behaviour ─────────────────────────────────────────────────

test('chain gain→lpf→schmitt composes: gained+smoothed crossing fires schmitt', () => {
  // Raw pulses at 0.5; gain 1.6 lifts them to 0.8; lpf smooths; schmitt fires
  // a clean 0/1 when the smoothed value crosses tHigh.
  const sig = [...constSig(0.5, 25), ...constSig(0, 25)];
  const chain = [
    { id: 'g', type: 'gain', params: { value: 1.6 } },
    { id: 'l', type: 'lpf', params: { cutoffHz: 12 } },
    { id: 's', type: 'schmitt', params: { tHigh: 0.6, tLow: 0.3, refractoryMs: 0 } },
  ];
  const out = runChain(chain, sig);
  // Output is strictly a 0/1 train (schmitt is the last op).
  for (const v of out) assert.ok(v === 0 || v === 1, `schmitt output is binary: got ${v}`);
  // It fires (reaches 1) once the smoothed, gained signal crosses tHigh.
  assert.ok(out.slice(0, 25).includes(1), 'chain fires during the high segment');
  // And releases back to 0 in the silent tail.
  assert.equal(last(out), 0, 'chain releases in the silent tail');
});

test('chain gain→compressor→clamp composes and stays within the clamp window', () => {
  const loud = constSig(0.8, 100);
  const chain = [
    { id: 'g', type: 'gain', params: { value: 1.1 } },
    { id: 'k', type: 'compressor', params: { threshold: 0.3, ratio: 6, attackMs: 5, releaseMs: 50 } },
    { id: 'c', type: 'clamp', params: { min: 0.1, max: 0.6 } },
  ];
  const out = runChain(chain, loud);
  // Final clamp caps everything into [0.1, 0.6].
  for (const v of out) assert.ok(v >= 0.1 - 1e-9 && v <= 0.6 + 1e-9, `clamped into window: ${v}`);
});

test('chain envelope→hold composes: attack-shaped pulse held then decayed', () => {
  // A short kick: envelope shapes the attack/release, hold gives a visible
  // minimum width then decays.
  const kick = [...constSig(1, 3), ...constSig(0, 40)];
  const chain = [
    { id: 'e', type: 'envelope', params: { attackMs: 4, releaseMs: 40 } },
    { id: 'h', type: 'hold', params: { timeoutMs: 60, decayMs: 80 } },
  ];
  const out = runChain(chain, kick);
  assert.ok(out[2] > 0.3, `envelope+hold builds during the pulse: out[2]=${out[2]}`);
  assert.ok(last(out) < out[3], 'value decays in the tail after the hold timeout');
});

// ── Order matters ────────────────────────────────────────────────────────────

test('reordering ops changes the output (clamp before vs after gain)', () => {
  // gain×2 then clamp[0,0.5] vs clamp[0,0.5] then gain×2 — different results.
  const sig = constSig(0.4, 5);
  const gainThenClamp = runChain([
    { id: 'g', type: 'gain', params: { value: 2 } },
    { id: 'c', type: 'clamp', params: { min: 0, max: 0.5 } },
  ], sig);
  const clampThenGain = runChain([
    { id: 'c', type: 'clamp', params: { min: 0, max: 0.5 } },
    { id: 'g', type: 'gain', params: { value: 2 } },
  ], sig);
  // gain→clamp: 0.4×2=0.8 → clamp 0.5.
  approx(last(gainThenClamp), 0.5, 1e-9, 'gain then clamp = 0.5');
  // clamp→gain: 0.4 (in window) → ×2 = 0.8.
  approx(last(clampThenGain), 0.8, 1e-9, 'clamp then gain = 0.8');
  assert.notEqual(last(gainThenClamp), last(clampThenGain), 'op ORDER changes output');
});

test('reordering bias and curve changes the output', () => {
  const sig = constSig(0.3, 3);
  const biasThenCurve = runChain([
    { id: 'b', type: 'bias', params: { value: 0.2 } },     // 0.3 → 0.5
    { id: 'c', type: 'curve', params: { shape: 'easeIn' } }, // 0.5^2 = 0.25
  ], sig);
  const curveThenBias = runChain([
    { id: 'c', type: 'curve', params: { shape: 'easeIn' } }, // 0.3^2 = 0.09
    { id: 'b', type: 'bias', params: { value: 0.2 } },       // 0.09 + 0.2 = 0.29
  ], sig);
  approx(last(biasThenCurve), 0.25, 1e-9, 'bias→curve');
  approx(last(curveThenBias), 0.29, 1e-9, 'curve→bias');
  assert.notEqual(last(biasThenCurve), last(curveThenBias), 'reordering changes output');
});

// ── THE BUG REPORT: param change must change process() output ────────────────

test('putChain with a CHANGED param visibly changes process() output (gain)', () => {
  const pc = fullGainPC();
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 0.3 } }]);
  const before = proc.process('micLow', 0.5, DT);
  approx(before, 0.15, 1e-9, 'value 0.3 → 0.15');
  // Operator edits the gain to 0.9 and re-PUTs the chain.
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 0.9 } }]);
  const after = proc.process('micLow', 0.5, DT);
  approx(after, 0.45, 1e-9, 'value 0.9 → 0.45 after re-PUT');
  assert.notEqual(before, after, 'param edit via putChain changes output (NOT the reported bug)');
});

test('loadChains with a CHANGED param visibly changes process() output (lpf cutoff)', () => {
  // The exact failure the operator reported, exercised through loadChains
  // (the YAML-block path) — change cutoffHz and confirm the step response moves.
  const step = stepSig(0, 1, 0, 15);

  const procA = new SignalPostProcessor({ paramCenter: fullGainPC() });
  procA.loadChains({ micLow: [{ id: 'l', type: 'lpf', params: { cutoffHz: 2 } }] });
  const slow = step.map((x) => procA.process('micLow', x, DT));

  const procB = new SignalPostProcessor({ paramCenter: fullGainPC() });
  procB.loadChains({ micLow: [{ id: 'l', type: 'lpf', params: { cutoffHz: 20 } }] });
  const fast = step.map((x) => procB.process('micLow', x, DT));

  assert.ok(fast[5] > slow[5] + 0.1,
    `loadChains cutoff change is visible: fast[5]=${fast[5]} slow[5]=${slow[5]}`);

  // Same processor, swap the chain in place — output must change too.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.loadChains({ micLow: [{ id: 'l', type: 'lpf', params: { cutoffHz: 2 } }] });
  const s = step.map((x) => proc.process('micLow', x, DT));
  proc.loadChains({ micLow: [{ id: 'l', type: 'lpf', params: { cutoffHz: 20 } }] });
  const f = step.map((x) => proc.process('micLow', x, DT));
  assert.ok(f[5] > s[5] + 0.1, 'in-place loadChains param swap changes output');
});

test('patchOp with a CHANGED param visibly changes process() output (schmitt tHigh)', () => {
  // PATCH path (mid-show nudge). Same input crosses one tHigh but not a higher one.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 's', type: 'schmitt', params: { tHigh: 0.4, tLow: 0.2 } }]);
  // Input 0.5 crosses tHigh=0.4 → fires.
  assert.equal(proc.process('micLow', 0.5, DT), 1, 'fires at tHigh=0.4');

  // Operator raises tHigh to 0.8 via PATCH. A fresh-state 0.5 input no longer fires.
  const proc2 = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc2.putChain('micLow', [{ id: 's', type: 'schmitt', params: { tHigh: 0.4, tLow: 0.2 } }]);
  const r = proc2.patchOp('micLow', 's', { params: { tHigh: 0.8 } });
  assert.equal(r.ok, true, 'patch accepted');
  assert.equal(proc2.process('micLow', 0.5, DT), 0, 'does NOT fire after tHigh raised to 0.8');
});

test('replacing a whole chain via loadChains swaps behaviour entirely', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  // Start with a passthrough-ish gain; output tracks input.
  proc.loadChains({ micLow: [{ id: 'g', type: 'gain', params: { value: 1 } }] });
  approx(proc.process('micLow', 0.5, DT), 0.5, 1e-9, 'gain=1 passthrough');
  // Swap to an easeIn curve; same input now squares.
  proc.loadChains({ micLow: [{ id: 'c', type: 'curve', params: { shape: 'easeIn' } }] });
  approx(proc.process('micLow', 0.5, DT), 0.25, 1e-9, 'curve easeIn after swap');
});

// ── Runtime-state reset on reload ────────────────────────────────────────────

test('runtime state RESETS on putChain (no stale lpf history leaks)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'l', type: 'lpf', params: { cutoffHz: 5 } }]);
  // Drive the LPF up toward 1 so yPrev is high.
  for (let i = 0; i < 50; i++) proc.process('micLow', 1.0, DT);
  // Re-PUT the SAME chain — runtime must reset to yPrev=0.
  proc.putChain('micLow', [{ id: 'l', type: 'lpf', params: { cutoffHz: 5 } }]);
  // First sample after reset of a step from 0 equals alpha (fresh state),
  // NOT a value near the previously-charged ~1.0.
  const alpha = 1 - Math.exp(-2 * Math.PI * 5 * DT);
  approx(proc.process('micLow', 1.0, DT), alpha, 1e-9, 'lpf state reset after re-PUT');
});

test('runtime state RESETS on loadChains (schmitt latch does not leak)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.loadChains({ micLow: [{ id: 's', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.2 } }] });
  // Latch it high.
  assert.equal(proc.process('micLow', 0.9, DT), 1, 'latched high');
  // Reload the same chain — the latch (yPrev=1) must reset to 0.
  proc.loadChains({ micLow: [{ id: 's', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.2 } }] });
  // A below-tLow input on fresh state stays 0 (if state leaked, a latched
  // schmitt would still read 1 until it dropped below tLow — but 0.3 > tLow
  // 0.2 means a leaked latch would STAY 1). Fresh state → 0.
  assert.equal(proc.process('micLow', 0.3, DT), 0, 'schmitt latch reset after reload');
});

test('loadChains leaves un-mentioned signals untouched (partial block)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  // Only override micLow; micMid keeps its DEFAULT chain (gain→lpf).
  proc.loadChains({ micLow: [{ id: 'g', type: 'gain', params: { value: 0.5 } }] });
  approx(proc.process('micLow', 0.8, DT), 0.4, 1e-9, 'micLow overridden');
  // micMid still has its default gain(=1 via micMidGain)→lpf; first step sample
  // is the LPF alpha of the default 8 Hz cutoff (gain=1 passes 0.8 through).
  const aMid = 1 - Math.exp(-2 * Math.PI * 8.0 * DT);
  approx(proc.process('micMid', 0.8, DT), 0.8 * aMid, 1e-9, 'micMid kept its default chain');
});

// ── micKick default chain end-to-end (the shipped 4-op trigger shaper) ───────

test('default micKick chain (gain→envelope→schmitt→hold) shapes a kick into a pulse', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  // Use the shipped default chain (no putChain). Feed a sharp kick then silence.
  const kick = [...constSig(1.0, 4), ...constSig(0, 30)];
  const out = kick.map((x) => proc.process('micKick', x, DT));
  // The chain should produce a visible pulse (some sample well above 0)...
  assert.ok(Math.max(...out) > 0.5, `kick chain produces a pulse: max=${Math.max(...out)}`);
  // ...that decays toward 0 in the silent tail (hold timeout + decay).
  assert.ok(last(out) < 0.5, `kick pulse decays in the tail: last=${last(out)}`);
});
