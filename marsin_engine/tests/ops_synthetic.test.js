// Synthetic-data test suite for the SignalPostProcessor OP CATALOG
// (audio/postproc/signal_post_processor.js — the 13 DSP operators).
//
// PURPOSE
// -------
// Directly supports the operator bug report "changing op params shows no
// diff in output". For EVERY op we:
//   1. drive it with a deterministic synthetic input stream (step / impulse
//      / ramp / sinusoid / alternating ±) through the REAL runtime path
//      (SignalPostProcessor.process(), which runs validateChain + _applyOp),
//   2. assert the DSP does what the math says, and
//   3. assert that varying each param VISIBLY changes the output.
//
// Determinism: fixed dt = 512/44100 s (~11.6 ms — one analyzer hop) and
// hand-built input sequences. All comparisons use tolerances.
//
// Run:  cd marsin_engine && node --test tests/ops_synthetic.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignalPostProcessor,
} from '../audio/postproc/signal_post_processor.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

// One analyzer hop at 44.1 kHz — the engine's real audio frame delta.
const DT = 512 / 44100; // ≈ 0.011610 s

/** Minimal ParamCenter stub: .get(key) returns the stored value or throws. */
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

/** All gain CPC params populated so DEFAULT_CHAINS validate on construction. */
function fullGainPC(extra = {}) {
  return makeParamCenter({
    micLowGain: 1.0, micMidGain: 1.0, micHighGain: 1.0, micKickGain: 1.0,
    micFluxGain: 1.0,
    stemsBassGain: 1.0, stemsDrumsGain: 1.0, stemsVocalsGain: 1.0,
    ...extra,
  });
}

// Drive a single-op chain through the REAL process() path. `inputs` is an
// array of raw scalars; dt is fixed. Returns the per-sample post-chain output.
function runOp(opCfg, inputs, { signalKey = 'micLow', pc = null, dt = DT } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: pc || fullGainPC() });
  proc.putChain(signalKey, [opCfg]);
  return inputs.map((x) => proc.process(signalKey, x, dt));
}

// Synthetic input generators.
const constSig = (v, n) => Array.from({ length: n }, () => v);
const stepSig = (lo, hi, nLo, nHi) => [...constSig(lo, nLo), ...constSig(hi, nHi)];
const rampSig = (from, to, n) =>
  Array.from({ length: n }, (_, i) => from + (to - from) * (i / (n - 1)));
const sinSig = (freqHz, n, dt = DT, amp = 0.5, off = 0.5) =>
  Array.from({ length: n }, (_, i) => off + amp * Math.sin(2 * Math.PI * freqHz * i * dt));
const altSig = (a, b, n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

const last = (arr) => arr[arr.length - 1];
const approx = (actual, expected, eps, msg = '') =>
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg} expected ≈${expected}, got ${actual} (diff=${actual - expected}, eps=${eps})`);

// ── gain ─────────────────────────────────────────────────────────────────────

test('gain: output = input × value (static), proportional to value', () => {
  // process() clamps the FINAL value to [0,1], so keep input×value ≤ 1.
  const inputs = [0.0, 0.2, 0.4, 0.5];
  const g05 = runOp({ id: 'g', type: 'gain', params: { value: 0.5 } }, inputs);
  for (let i = 0; i < inputs.length; i++) {
    approx(g05[i], inputs[i] * 0.5, 1e-9, `gain×0.5 @${i}`);
  }
  // Changing the value changes the output proportionally.
  const g15 = runOp({ id: 'g', type: 'gain', params: { value: 1.5 } }, [0.2, 0.4]);
  approx(g15[0], 0.3, 1e-9, 'gain×1.5 @0');
  approx(g15[1], 0.6, 1e-9, 'gain×1.5 @1');
  assert.ok(g15[0] > g05[1], 'higher gain value yields higher output (param affects output)');
});

test('gain: paramKey reads the LIVE CPC value each process() call', () => {
  const pc = fullGainPC({ micLowGain: 0.5 });
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } }]);
  approx(proc.process('micLow', 0.6, DT), 0.3, 1e-9, 'live gain 0.5');
  // Operator moves the slider mid-show → next frame reflects it immediately.
  pc.set('micLowGain', 1.0);
  approx(proc.process('micLow', 0.6, DT), 0.6, 1e-9, 'live gain 1.0 after slider move');
});

// ── bias ─────────────────────────────────────────────────────────────────────

test('bias: output = input + value; changing value shifts output', () => {
  const inputs = [0.1, 0.3, 0.5];
  const b02 = runOp({ id: 'b', type: 'bias', params: { value: 0.2 } }, inputs);
  for (let i = 0; i < inputs.length; i++) {
    approx(b02[i], inputs[i] + 0.2, 1e-9, `bias+0.2 @${i}`);
  }
  // Negative bias subtracts; different value → different output.
  const bNeg = runOp({ id: 'b', type: 'bias', params: { value: -0.1 } }, [0.5]);
  approx(bNeg[0], 0.4, 1e-9, 'bias-0.1');
  assert.notEqual(b02[2], bNeg[0], 'bias value change is visible in output');
});

// ── clamp ────────────────────────────────────────────────────────────────────

test('clamp: clamps into [min,max]; in-range passes', () => {
  const inputs = [0.0, 0.2, 0.5, 0.8, 1.0];
  const out = runOp({ id: 'c', type: 'clamp', params: { min: 0.3, max: 0.7 } }, inputs);
  approx(out[0], 0.3, 1e-9, 'below-min clamps up');
  approx(out[1], 0.3, 1e-9, 'below-min clamps up');
  approx(out[2], 0.5, 1e-9, 'in-range passes');
  approx(out[3], 0.7, 1e-9, 'above-max clamps down');
  approx(out[4], 0.7, 1e-9, 'above-max clamps down');
  // Widening the window changes the clamped output (param affects output).
  const wide = runOp({ id: 'c', type: 'clamp', params: { min: 0.1, max: 0.9 } }, [0.8]);
  approx(wide[0], 0.8, 1e-9, 'wider window passes 0.8');
  assert.notEqual(out[3], wide[0], 'clamp max change is visible in output');
});

// ── lpf (one-pole EMA) ───────────────────────────────────────────────────────

test('lpf: step input rises toward target; LOWER cutoff = SLOWER rise', () => {
  // Feed a unit step (0→1) and compare the rise after N samples at two cutoffs.
  const step = stepSig(0, 1, 0, 30);
  const fast = runOp({ id: 'l', type: 'lpf', params: { cutoffHz: 20 } }, step);
  const slow = runOp({ id: 'l', type: 'lpf', params: { cutoffHz: 2 } }, step);
  // Both rise monotonically toward 1.
  assert.ok(fast[5] > fast[0], 'fast lpf rises');
  assert.ok(last(fast) <= 1.0, 'lpf never overshoots the target (asymptotes to 1)');
  // The crux of the bug report: a different cutoff MUST change the trajectory.
  assert.ok(fast[5] > slow[5] + 0.05,
    `lower cutoff rises slower: fast[5]=${fast[5]} should exceed slow[5]=${slow[5]}`);
  // Verify against the closed-form one-pole step response after the 1st sample:
  //   alpha = 1 - exp(-2π fc dt);  y1 = alpha (from y0=0, x=1).
  const a20 = 1 - Math.exp(-2 * Math.PI * 20 * DT);
  approx(fast[0], a20, 1e-9, 'lpf first-sample = alpha');
});

test('lpf: impulse decays back toward zero (leaky integrator)', () => {
  // Single 1.0 impulse then zeros: output jumps then leaks down.
  const impulse = [1, 0, 0, 0, 0, 0];
  const out = runOp({ id: 'l', type: 'lpf', params: { cutoffHz: 10 } }, impulse);
  assert.ok(out[0] > 0, 'impulse produces output');
  assert.ok(out[1] < out[0], 'lpf leaks down after impulse');
  assert.ok(out[5] < out[1], 'lpf keeps decaying');
});

// ── biquad (RBJ LPF) ─────────────────────────────────────────────────────────

test('biquad: attenuates a HIGH-freq sinusoid more than a LOW-freq one', () => {
  // Drive two sinusoids through the same LPF; measure steady-state peak-to-peak.
  const cutoff = 6.0;
  const n = 400;
  const lowSig = sinSig(2, n);    // 2 Hz — below cutoff, should pass
  const highSig = sinSig(40, n);  // 40 Hz — above cutoff, should be attenuated
  const lowOut = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: cutoff, Q: 0.707 } }, lowSig);
  const highOut = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: cutoff, Q: 0.707 } }, highSig);
  // Measure peak-to-peak over the settled tail (skip the transient).
  const ptp = (arr) => Math.max(...arr.slice(100)) - Math.min(...arr.slice(100));
  const lowPtp = ptp(lowOut);
  const highPtp = ptp(highOut);
  assert.ok(lowPtp > highPtp * 2,
    `LPF passes low (ptp=${lowPtp.toFixed(4)}) more than high (ptp=${highPtp.toFixed(4)})`);
});

test('biquad: changing cutoffHz changes high-freq attenuation', () => {
  const n = 400;
  const highSig = sinSig(30, n);
  const ptp = (arr) => Math.max(...arr.slice(100)) - Math.min(...arr.slice(100));
  const lowCut = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: 4, Q: 0.707 } }, highSig);
  const highCut = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: 25, Q: 0.707 } }, highSig);
  // A higher cutoff lets more of the 30 Hz tone through.
  assert.ok(ptp(highCut) > ptp(lowCut) * 1.5,
    `higher cutoff passes more: highCut ptp=${ptp(highCut).toFixed(4)} vs lowCut ptp=${ptp(lowCut).toFixed(4)}`);
});

test('biquad: changing Q changes the response (resonance)', () => {
  // At a tone near cutoff, a higher Q gives a peakier response than a low Q.
  const n = 400;
  const tone = sinSig(8, n); // near the 8 Hz cutoff
  const ptp = (arr) => Math.max(...arr.slice(150)) - Math.min(...arr.slice(150));
  const lowQ = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: 8, Q: 0.5 } }, tone);
  const highQ = runOp({ id: 'q', type: 'biquad', params: { cutoffHz: 8, Q: 5 } }, tone);
  assert.ok(Math.abs(ptp(highQ) - ptp(lowQ)) > 0.01,
    `Q change is visible: lowQ ptp=${ptp(lowQ).toFixed(4)} highQ ptp=${ptp(highQ).toFixed(4)}`);
});

// ── envelope (attack/release follower) ───────────────────────────────────────

test('envelope: rises fast on attack, falls slow on release', () => {
  // Step up to 1 (attack), hold, then step to 0 (release).
  const sig = [...constSig(1, 20), ...constSig(0, 60)];
  const out = runOp({ id: 'e', type: 'envelope', params: { attackMs: 5, releaseMs: 200 } }, sig);
  // Attack: rises quickly toward 1 within the held-high segment.
  assert.ok(out[10] > 0.8, `attack reaches >0.8 by sample 10, got ${out[10]}`);
  // Release: after stepping to 0, decays but is still well above 0 (slow).
  assert.ok(out[40] > 0.2 && out[40] < out[19],
    `release decays slowly: out[40]=${out[40]} (below peak ${out[19]}, above 0.2)`);
});

test('envelope: different attackMs/releaseMs give different trajectories', () => {
  const sig = [...constSig(1, 15), ...constSig(0, 40)];
  const fastA = runOp({ id: 'e', type: 'envelope', params: { attackMs: 2, releaseMs: 200 } }, sig);
  const slowA = runOp({ id: 'e', type: 'envelope', params: { attackMs: 60, releaseMs: 200 } }, sig);
  // Faster attack is higher early in the rise.
  assert.ok(fastA[3] > slowA[3] + 0.1,
    `faster attack higher early: fastA[3]=${fastA[3]} slowA[3]=${slowA[3]}`);
  // Different release at the tail.
  const fastR = runOp({ id: 'e', type: 'envelope', params: { attackMs: 5, releaseMs: 50 } }, sig);
  const slowR = runOp({ id: 'e', type: 'envelope', params: { attackMs: 5, releaseMs: 500 } }, sig);
  assert.ok(slowR[40] > fastR[40] + 0.05,
    `slower release holds higher: slowR[40]=${slowR[40]} fastR[40]=${fastR[40]}`);
});

// ── schmitt (hysteresis + refractory) ────────────────────────────────────────

test('schmitt: fires when input crosses tHigh, holds until below tLow', () => {
  // Ramp up across tHigh, then ramp down across tLow.
  const up = rampSig(0, 1, 20);
  const down = rampSig(1, 0, 20);
  const out = runOp(
    { id: 's', type: 'schmitt', params: { tHigh: 0.6, tLow: 0.3, refractoryMs: 0 } },
    [...up, ...down],
  );
  // Before crossing tHigh, output is 0.
  assert.equal(out[5], 0, 'below tHigh: not firing');
  // After crossing tHigh, output latches to 1.
  assert.equal(last(up.map((_, i) => out[i])), 1, 'crossed tHigh: firing');
  // Hysteresis: while ramping down but still above tLow, stays latched at 1.
  // Sample 20 starts the down-ramp at x≈1; it stays 1 until x < tLow.
  assert.equal(out[22], 1, 'above tLow on the way down: still firing (hysteresis)');
  // At the bottom of the down-ramp (x→0 < tLow), it has released to 0.
  assert.equal(last(out), 0, 'below tLow: released');
});

test('schmitt: refractoryMs suppresses re-fire within the window', () => {
  // Two pulses spaced ~58 ms apart (5 samples × 11.6 ms). A 200 ms refractory
  // should block the second fire; a 0 ms refractory should allow it.
  const pulse = [...constSig(1, 2), ...constSig(0, 3)];
  const sig = [...pulse, ...pulse, ...pulse]; // 3 pulses, ~58 ms apart
  const noRefr = runOp(
    { id: 's', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.2, refractoryMs: 0 } }, sig);
  const withRefr = runOp(
    { id: 's', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.2, refractoryMs: 200 } }, sig);
  const fires = (arr) => arr.reduce((acc, v, i) => acc + (v === 1 && (i === 0 || arr[i - 1] === 0) ? 1 : 0), 0);
  assert.equal(fires(noRefr), 3, 'no refractory: all 3 pulses fire');
  assert.equal(fires(withRefr), 1, 'long refractory: only the first pulse fires');
});

// ── hold (sample-and-hold + timeout + exp decay) ─────────────────────────────

test('hold: holds the last value, then decays after timeout', () => {
  // A single 1.0 pulse, then zeros. With a short timeout the value should
  // be held briefly then decay exponentially.
  const sig = [1, ...constSig(0, 40)];
  const out = runOp({ id: 'h', type: 'hold', params: { timeoutMs: 50, decayMs: 100 } }, sig);
  assert.equal(out[0], 1, 'pulse passes through at full');
  // While the pulse decays (decayMs=100 ms) it stays high for a few samples.
  assert.ok(out[2] > 0.75, `still high shortly after the pulse: out[2]=${out[2]}`);
  // Long after the pulse it has decayed toward 0.
  assert.ok(last(out) < 0.2, `decayed in the tail: last=${last(out)}`);
});

test('hold: decayMs changes the decay trajectory', () => {
  // decayMs is the working lever for hold: a longer decay holds the value
  // higher for longer once the input goes quiet.
  const sig = [1, ...constSig(0, 40)];
  const fastDecay = runOp({ id: 'h', type: 'hold', params: { timeoutMs: 5, decayMs: 30 } }, sig);
  const slowDecay = runOp({ id: 'h', type: 'hold', params: { timeoutMs: 5, decayMs: 400 } }, sig);
  assert.ok(slowDecay[15] > fastDecay[15] + 0.1,
    `slower decay holds higher: slow[15]=${slowDecay[15]} fast[15]=${fastDecay[15]}`);
});

// FINDING (engine-side half of the operator's "param change shows no diff"
// bug): for the Hold op, `timeoutMs` has NO observable effect on the output
// for ANY input stream. In _applyOp's hold case the two branches are:
//     expired:      y = decayed              (decayed = yPrev·exp(-dt/τ))
//     within window: y = max(x, decayed)
// They differ only when x > decayed. But any x > 0 sets lastInputAt = now,
// so the "expired" branch is only ever reached when x has been 0 (i.e.
// x ≤ decayed), where max(x, decayed) == decayed. The branches are therefore
// algebraically identical and timeoutMs is dead. This test PINS that finding:
// changing only timeoutMs leaves process() output bit-identical. If the op is
// fixed so timeoutMs gates the sample-and-hold (hold flat, THEN decay), this
// test should be updated to assert a visible difference.
// Engine fix (was: the operator's "param change shows no diff" — hold.timeoutMs
// was a dead knob because the old code decayed INSIDE the hold window too, making
// the two branches algebraically identical). The op now holds FLAT for timeoutMs,
// THEN decays. This test verifies timeoutMs visibly changes the output.
test('hold: timeoutMs holds the peak flat longer before decaying', () => {
  const sig = [1, 0, 0, 0, 0, 0, 0, 0];     // pulse then silence
  const shortT = runOp({ id: 'h', type: 'hold', params: { timeoutMs: 5, decayMs: 100 } }, sig);
  const longT  = runOp({ id: 'h', type: 'hold', params: { timeoutMs: 5000, decayMs: 100 } }, sig);
  // both latch the peak on the trigger sample …
  approx(shortT[0], 1, 1e-9, 'short latches peak');
  approx(longT[0], 1, 1e-9, 'long latches peak');
  // … but a 5 ms timeout (< one ~11.6 ms hop) expires immediately and decays,
  // while a 5000 ms timeout holds 1.0 flat across the whole window.
  let differ = false;
  for (let i = 1; i < sig.length; i++) {
    assert.ok(longT[i] >= shortT[i] - 1e-9, `long timeout holds ≥ short @${i}`);
    if (Math.abs(longT[i] - shortT[i]) > 1e-6) differ = true;
    approx(longT[i], 1.0, 1e-9, `long timeout holds flat @${i}`);
    assert.ok(shortT[i] < 1.0, `short timeout has begun decaying @${i}`);
  }
  assert.ok(differ, 'timeoutMs must change the output (it was a dead knob before the fix)');
});

// ── curve (shape lookup + gamma) ─────────────────────────────────────────────

test('curve: each shape maps as documented (linear/easeIn/easeOut/exp)', () => {
  const xs = [0, 0.25, 0.5, 0.75, 1];
  const lin = runOp({ id: 'c', type: 'curve', params: { shape: 'linear' } }, xs);
  const easeIn = runOp({ id: 'c', type: 'curve', params: { shape: 'easeIn' } }, xs);
  const easeOut = runOp({ id: 'c', type: 'curve', params: { shape: 'easeOut' } }, xs);
  for (let i = 0; i < xs.length; i++) {
    approx(lin[i], xs[i], 1e-9, `linear @${xs[i]}`);
    approx(easeIn[i], xs[i] * xs[i], 1e-9, `easeIn @${xs[i]}`);
    approx(easeOut[i], 1 - (1 - xs[i]) * (1 - xs[i]), 1e-9, `easeOut @${xs[i]}`);
  }
  // easeIn pulls the midpoint DOWN, easeOut pulls it UP vs linear.
  assert.ok(easeIn[2] < lin[2], 'easeIn below linear at 0.5');
  assert.ok(easeOut[2] > lin[2], 'easeOut above linear at 0.5');
});

test('curve: gamma changes the exp shape', () => {
  const xs = [0.25, 0.5, 0.75];
  const g2 = runOp({ id: 'c', type: 'curve', params: { shape: 'exp', gamma: 2 } }, xs);
  const g4 = runOp({ id: 'c', type: 'curve', params: { shape: 'exp', gamma: 4 } }, xs);
  for (let i = 0; i < xs.length; i++) {
    approx(g2[i], Math.pow(xs[i], 2), 1e-9, `exp^2 @${xs[i]}`);
    approx(g4[i], Math.pow(xs[i], 4), 1e-9, `exp^4 @${xs[i]}`);
  }
  // Higher gamma pushes mid values lower.
  assert.ok(g4[1] < g2[1] - 0.05, `gamma change visible: g4=${g4[1]} g2=${g2[1]}`);
});

// ── slew (rate limiter) ──────────────────────────────────────────────────────

test('slew: a step is rate-limited; lower maxStepPerSec = slower', () => {
  // Step 0→1; output can move at most maxStepPerSec·dt per sample.
  const step = stepSig(0, 1, 0, 30);
  const fast = runOp({ id: 'w', type: 'slew', params: { maxStepPerSec: 50 } }, step);
  const slow = runOp({ id: 'w', type: 'slew', params: { maxStepPerSec: 5 } }, step);
  // First sample exactly equals one step from y_prev=0.
  approx(slow[0], 5 * DT, 1e-9, 'slew first step = maxStepPerSec·dt');
  approx(fast[0], 50 * DT, 1e-9, 'slew first step (fast) = maxStepPerSec·dt');
  // No sample-to-sample jump exceeds the configured rate (with float slack).
  for (let i = 1; i < slow.length; i++) {
    assert.ok(slow[i] - slow[i - 1] <= 5 * DT + 1e-9, `slew respects rate @${i}`);
  }
  // Lower rate is slower to reach the target.
  assert.ok(fast[5] > slow[5] + 0.05, `faster slew rises quicker: fast[5]=${fast[5]} slow[5]=${slow[5]}`);
});

// ── compressor (dB-domain) ───────────────────────────────────────────────────

test('compressor: above threshold reduces gain; below threshold passes', () => {
  // Steady loud input above threshold → settled output is reduced below input.
  const loud = constSig(0.9, 80);
  const out = runOp(
    { id: 'k', type: 'compressor', params: { threshold: 0.3, ratio: 8, attackMs: 5, releaseMs: 50 } },
    loud);
  assert.ok(last(out) < 0.9 - 0.05, `loud input compressed: last=${last(out)} (< input 0.9)`);
  // A quiet input below threshold passes through ~unchanged.
  const quiet = constSig(0.2, 80);
  const qOut = runOp(
    { id: 'k', type: 'compressor', params: { threshold: 0.5, ratio: 8, attackMs: 5, releaseMs: 50 } },
    quiet);
  approx(last(qOut), 0.2, 1e-3, 'below-threshold input passes ~unchanged');
});

test('compressor: higher ratio and lower threshold increase gain reduction', () => {
  const loud = constSig(0.9, 120);
  const r2 = runOp({ id: 'k', type: 'compressor', params: { threshold: 0.3, ratio: 2, attackMs: 5, releaseMs: 50 } }, loud);
  const r10 = runOp({ id: 'k', type: 'compressor', params: { threshold: 0.3, ratio: 10, attackMs: 5, releaseMs: 50 } }, loud);
  assert.ok(last(r10) < last(r2) - 0.02,
    `higher ratio reduces more: r10=${last(r10)} r2=${last(r2)}`);
  // Lower threshold → more "over" → more reduction at the same ratio.
  const tHi = runOp({ id: 'k', type: 'compressor', params: { threshold: 0.6, ratio: 6, attackMs: 5, releaseMs: 50 } }, loud);
  const tLo = runOp({ id: 'k', type: 'compressor', params: { threshold: 0.1, ratio: 6, attackMs: 5, releaseMs: 50 } }, loud);
  assert.ok(last(tLo) < last(tHi) - 0.02,
    `lower threshold reduces more: tLo=${last(tLo)} tHi=${last(tHi)}`);
});

// ── slope (discrete derivative) ──────────────────────────────────────────────

test('slope: constant input → ~0; a ramp → ~constant positive slope', () => {
  const constOut = runOp({ id: 'p', type: 'slope', params: { scale: 4 } }, constSig(0.5, 20));
  // After the first sample (which sees a jump from the initial 0), constant
  // input gives zero derivative.
  for (let i = 1; i < constOut.length; i++) {
    approx(constOut[i], 0, 1e-9, `constant → 0 slope @${i}`);
  }
  // A gentle linear ramp gives a constant per-sample slope = (Δx/dt)/scale.
  // Keep Δx small so the slope stays within the unipolar [0,1] clamp window:
  // ramp 0→0.4 over 21 samples → Δx=0.02 → slope = 0.02/DT/4 ≈ 0.43 (< 1).
  const ramp = rampSig(0, 0.4, 21);
  const dx = 0.4 / 20;
  const scale = 4;
  const slopeOut = runOp({ id: 'p', type: 'slope', params: { scale } }, ramp);
  const expected = dx / DT / scale;
  assert.ok(expected < 1, 'sanity: chosen ramp slope is inside the unipolar clamp');
  for (let i = 2; i < slopeOut.length; i++) {
    approx(slopeOut[i], expected, 1e-6, `ramp → constant slope @${i}`);
  }
  // scale param visibly changes magnitude (double scale → half slope).
  const slopeOut2 = runOp({ id: 'p', type: 'slope', params: { scale: 8 } }, ramp);
  approx(slopeOut2[5], expected / 2, 1e-6, 'larger scale lowers slope output proportionally');
});

test('slope: bipolar preserves negative slope; unipolar clamps to 0', () => {
  // A falling ramp: derivative is negative. Note process()'s final clamp01
  // forces the BIPOLAR negative to 0 at the CPC boundary, so to see the
  // negative we chain slope → bias(+0.5) so the raw negative becomes visible.
  const fall = rampSig(1, 0, 21);
  // Unipolar (default): per-op output clamps negatives to 0 already.
  const uni = runOp({ id: 'p', type: 'slope', params: { scale: 4, bipolar: false } }, fall);
  for (let i = 1; i < uni.length; i++) {
    assert.equal(uni[i], 0, `unipolar clamps falling input to 0 @${i}`);
  }
  // Bipolar: chain a +0.5 bias so the negative derivative reads below 0.5.
  const pc = fullGainPC();
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [
    { id: 'p', type: 'slope', params: { scale: 4, bipolar: true } },
    { id: 'b', type: 'bias', params: { value: 0.5 } },
  ]);
  const biOut = fall.map((x) => proc.process('micLow', x, DT));
  // After the transient, the +0.5-biased negative slope sits below 0.5.
  assert.ok(biOut[5] < 0.5, `bipolar preserves negative slope (biased < 0.5): ${biOut[5]}`);
});

// ── normalizer (AGC to [0,1]) ────────────────────────────────────────────────

test('normalizer: a scaled-down input still normalizes toward [0,1]', () => {
  // A low-amplitude oscillation (0.1..0.3) should, over windowSec, be
  // auto-leveled so peaks approach 1 and troughs approach 0.
  const n = 4000; // ~46 s of frames at DT — several windowSec=10 spans
  const sig = sinSig(0.5, n, DT, 0.1, 0.2); // amplitude 0.1 around 0.2 → [0.1,0.3]
  const out = runOp({ id: 'z', type: 'normalizer', params: { windowSec: 10, strength: 1 } }, sig);
  // Examine the settled tail (after several windows).
  const tail = out.slice(Math.floor(n * 0.7));
  const tMax = Math.max(...tail);
  const tMin = Math.min(...tail);
  assert.ok(tMax > 0.7, `normalizer lifts peaks toward 1: tailMax=${tMax.toFixed(3)}`);
  assert.ok(tMin < 0.3, `normalizer pushes troughs toward 0: tailMin=${tMin.toFixed(3)}`);
  // The output span should be wider than the raw input span (0.2) — AGC gain.
  assert.ok((tMax - tMin) > 0.4, `normalizer expands dynamic range: span=${(tMax - tMin).toFixed(3)}`);
});

test('normalizer: strength=0 is a passthrough; strength=1 fully normalizes', () => {
  const n = 3000;
  const sig = sinSig(0.5, n, DT, 0.1, 0.2);
  const pass = runOp({ id: 'z', type: 'normalizer', params: { windowSec: 10, strength: 0 } }, sig);
  const full = runOp({ id: 'z', type: 'normalizer', params: { windowSec: 10, strength: 1 } }, sig);
  // strength=0 → output == input (no AGC). Compare against the raw input.
  for (let i = 0; i < n; i += 250) {
    approx(pass[i], sig[i], 1e-9, `strength=0 passthrough @${i}`);
  }
  // strength=1 expands the range far beyond the raw 0.2 span.
  const fullTail = full.slice(Math.floor(n * 0.7));
  assert.ok((Math.max(...fullTail) - Math.min(...fullTail)) > 0.4,
    'strength=1 fully normalizes (wide span)');
});

// ── edge cases ───────────────────────────────────────────────────────────────

test('edge: zero input stays zero through every stateless op', () => {
  const zeros = constSig(0, 10);
  approx(last(runOp({ id: 'g', type: 'gain', params: { value: 2 } }, zeros)), 0, 1e-12, 'gain·0');
  approx(last(runOp({ id: 'l', type: 'lpf', params: { cutoffHz: 5 } }, zeros)), 0, 1e-12, 'lpf·0');
  approx(last(runOp({ id: 'c', type: 'curve', params: { shape: 'easeIn' } }, zeros)), 0, 1e-12, 'curve·0');
  approx(last(runOp({ id: 's', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.2 } }, zeros)), 0, 1e-12, 'schmitt·0');
});

test('edge: process() final clamp keeps output within [0,1]', () => {
  // A big static gain on a high input must not exceed 1 at the CPC boundary.
  const out = runOp({ id: 'g', type: 'gain', params: { value: 100 } }, [0.9]);
  approx(out[0], 1, 1e-12, 'final clamp caps at 1');
  // A negative bias below zero clamps to 0.
  const neg = runOp({ id: 'b', type: 'bias', params: { value: -1 } }, [0.2]);
  approx(neg[0], 0, 1e-12, 'final clamp floors at 0');
});
