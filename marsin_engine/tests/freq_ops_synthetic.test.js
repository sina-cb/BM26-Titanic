// Synthetic-data tests for FREQUENCY-mode signal post-processing
// (audio/postproc/signal_post_processor.js `outputMode: 'frequency'`).
//
// PURPOSE
// -------
// Closes the Audio Companion gap: frequency-domain ops (lpf/clamp/slew) were
// offered + validated in the UI but NOT applied to the Hz value server-side
// (the bypass in companion_server.js). The fix runs frequency signals through
// the SAME SignalPostProcessor in a Hz output mode that:
//   - runs the IDENTICAL _applyOp math (lpf/clamp/slew are range-agnostic),
//   - SKIPS the final [0,1] output clamp (so a Hz value survives),
//   - allows the clamp op's min/max to be Hz bounds.
//
// These tests prove, on a FREQUENCY signal:
//   - lpf one-pole-smooths a step in Hz (lower cutoff = slower),
//   - clamp bounds the Hz to [min,max] Hz (e.g. 40–4000),
//   - slew rate-limits the Hz in Hz/second,
// AND that intensity signals are UNCHANGED (the [0,1] clamp regression).
//
// Run:  cd marsin_engine && node --test tests/freq_ops_synthetic.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignalPostProcessor, validateChain,
} from '../audio/postproc/signal_post_processor.js';
import { validateSignal, FREQUENCY_OPS } from '../audio/companion/companion_config.js';

// One analyzer hop at 44.1 kHz — the engine's real audio frame delta.
const DT = 512 / 44100; // ≈ 0.011610 s

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
    micFluxGain: 1.0, stemsBassGain: 1.0, stemsDrumsGain: 1.0, stemsVocalsGain: 1.0,
    ...extra,
  });
}

// Drive a single-op FREQUENCY chain through the REAL process() path in Hz mode.
const PROXY = 'micLow';
function runFreqOp(opCfg, inputs, { dt = DT } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC(), outputMode: 'frequency' });
  proc.putChain(PROXY, [opCfg]);
  return inputs.map((x) => proc.process(PROXY, x, dt));
}
function runIntensityOp(opCfg, inputs, { dt = DT } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() }); // default mode
  proc.putChain(PROXY, [opCfg]);
  return inputs.map((x) => proc.process(PROXY, x, dt));
}

const constSig = (v, n) => Array.from({ length: n }, () => v);
const stepSig = (lo, hi, nLo, nHi) => [...constSig(lo, nLo), ...constSig(hi, nHi)];
const last = (arr) => arr[arr.length - 1];
const approx = (actual, expected, eps, msg = '') =>
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg} expected ≈${expected}, got ${actual} (diff=${actual - expected}, eps=${eps})`);

// ── construction / mode guard ────────────────────────────────────────────────

test('outputMode must be one of the known modes (fail loud, codex P0)', () => {
  assert.throws(
    () => new SignalPostProcessor({ paramCenter: fullGainPC(), outputMode: 'bananas' }),
    /outputMode must be one of/,
  );
});

// ── frequency lpf — one-pole smooths a Hz step ───────────────────────────────

test('freq lpf: a Hz step rises GRADUALLY (not instant); lower cutoff = slower', () => {
  // Step 100 Hz → 1000 Hz. A bypassing chain would jump straight to 1000.
  const step = stepSig(100, 1000, 1, 40);
  const fast = runFreqOp({ id: 'l', type: 'lpf', params: { cutoffHz: 20 } }, step);
  const slow = runFreqOp({ id: 'l', type: 'lpf', params: { cutoffHz: 2 } }, step);
  // The step value at the boundary index (index 1 is the first 1000 Hz sample).
  // Post-LPF, the first 1000 Hz sample must NOT have jumped to 1000 — it
  // smooths from the held 100 Hz toward 1000 Hz.
  assert.ok(fast[1] > 100 && fast[1] < 1000, `lpf smooths the Hz step: got ${fast[1]}`);
  // The Hz value survived (NOT clamped to [0,1]) — the whole point of Hz mode.
  assert.ok(last(fast) > 1, `Hz value survives the chain (not clamped to ≤1): ${last(fast)}`);
  // Closed-form one-pole response. The lpf starts at yPrev=0, so:
  //   y0 = a·100                       (index 0, the single held 100 Hz sample)
  //   y1 = a·1000 + (1-a)·y0           (index 1, first 1000 Hz sample)
  const a20 = 1 - Math.exp(-2 * Math.PI * 20 * DT);
  const y0 = a20 * 100;
  approx(fast[1], a20 * 1000 + (1 - a20) * y0, 1e-6, 'freq lpf samples match one-pole math');
  // Lower cutoff smooths slower → after a few samples it's still lower.
  assert.ok(fast[5] > slow[5] + 10, `lower cutoff is slower in Hz: fast[5]=${fast[5]} slow[5]=${slow[5]}`);
  // Both eventually approach the 1000 Hz target.
  assert.ok(last(fast) > 950, `fast lpf approaches the 1000 Hz target: ${last(fast)}`);
});

// ── frequency clamp — bounds the Hz to [min,max] Hz ──────────────────────────

test('freq clamp: bounds the Hz to a musical [40, 4000] window', () => {
  const inputs = [20, 40, 200, 4000, 8000];
  const out = runFreqOp({ id: 'c', type: 'clamp', params: { min: 40, max: 4000 } }, inputs);
  approx(out[0], 40, 1e-9, 'below-min Hz clamps up to 40');
  approx(out[1], 40, 1e-9, 'at min passes');
  approx(out[2], 200, 1e-9, 'in-range Hz passes');
  approx(out[3], 4000, 1e-9, 'at max passes');
  approx(out[4], 4000, 1e-9, 'above-max Hz clamps down to 4000');
});

test('freq clamp: Hz bounds VALIDATE on a frequency signal (not [0,1])', () => {
  // Through the engine validator with hz:true (the companion path).
  const r = validateChain(PROXY, [{ id: 'c', type: 'clamp', params: { min: 40, max: 4000 } }], { hz: true });
  assert.equal(r.ok, true, r.error);
  // And via the companion's validateSignal on a frequency signal end-to-end.
  const sig = {
    id: 'd', label: 'D', source: 'rawDom1', type: 'frequency',
    chain: [
      { id: 'c', type: 'clamp', params: { min: 40, max: 4000 } },
      { id: 'o', type: 'osc_out', params: { name: 'micDomFreq1' } },
    ],
  };
  const v = validateSignal(sig);
  assert.equal(v.ok, true, `Hz clamp bounds should validate on a frequency signal: ${v.error || ''}`);
});

test('freq clamp: an out-of-range (above Nyquist) Hz bound still rejects (fail loud)', () => {
  const r = validateChain(PROXY, [{ id: 'c', type: 'clamp', params: { min: 0, max: 99999 } }], { hz: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('intensity clamp still rejects Hz bounds ([0,1] mode unchanged)', () => {
  // Without hz:true, a 4000 Hz max is out of the [0,1] range — regression pin.
  const r = validateChain(PROXY, [{ id: 'c', type: 'clamp', params: { min: 40, max: 4000 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range \[0, 1\]/);
});

// ── frequency slew — rate-limits Hz/second ───────────────────────────────────

test('freq slew: Hz cannot move faster than maxStepPerSec (Hz/s)', () => {
  // Step 100 → 2000 Hz; with maxStepPerSec = 5000 Hz/s, the per-hop step is
  // 5000·DT ≈ 58 Hz, so the jump is rate-limited over many hops.
  const step = stepSig(100, 2000, 1, 80);
  const rate = 5000; // Hz/s
  const out = runFreqOp({ id: 'w', type: 'slew', params: { maxStepPerSec: rate } }, step);
  // First sample is at 100 (held). The step to 2000 is rate-limited: each hop
  // can move at most rate·DT Hz.
  const maxStep = rate * DT;
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i] - out[i - 1] <= maxStep + 1e-6,
      `slew respects Hz/s rate @${i}: Δ=${out[i] - out[i - 1]} > ${maxStep}`);
  }
  // It has NOT instantly reached 2000 right after the step (it's rate-limited).
  assert.ok(out[2] < 2000, `slew rate-limits the Hz jump: out[2]=${out[2]}`);
  // A faster rate climbs quicker (param visibly affects the Hz trajectory).
  const fastOut = runFreqOp({ id: 'w', type: 'slew', params: { maxStepPerSec: 20000 } }, step);
  assert.ok(fastOut[5] > out[5] + 50, `faster slew climbs quicker in Hz: ${fastOut[5]} vs ${out[5]}`);
});

// ── full Hz chain: lpf → clamp → osc_out (the real companion shape) ───────────

test('freq chain lpf→clamp→osc_out: smooths then bounds Hz, tap is identity', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC(), outputMode: 'frequency' });
  proc.putChain(PROXY, [
    { id: 'l', type: 'lpf', params: { cutoffHz: 8 } },
    { id: 'c', type: 'clamp', params: { min: 40, max: 4000 } },
    { id: 'o', type: 'osc_out', params: { name: 'micDomFreq1' } },
  ]);
  // Hammer a high Hz that the clamp must cap, then settle.
  let y = 0;
  for (let i = 0; i < 200; i++) y = proc.process(PROXY, 8000, DT);
  // The LPF rises toward 8000 but the clamp caps the OUTPUT at 4000.
  approx(y, 4000, 1e-6, 'lpf+clamp caps the settled Hz at the 4000 ceiling');
});

// ── INTENSITY REGRESSION — unchanged behaviour ───────────────────────────────

test('regression: intensity mode still clamps the final value to [0,1]', () => {
  // A gain that pushes above 1 must still clamp at the CPC boundary.
  const out = runIntensityOp({ id: 'g', type: 'gain', params: { value: 100 } }, [0.9]);
  approx(out[0], 1, 1e-12, 'intensity final clamp caps at 1 (unchanged)');
  const neg = runIntensityOp({ id: 'b', type: 'bias', params: { value: -1 } }, [0.2]);
  approx(neg[0], 0, 1e-12, 'intensity final clamp floors at 0 (unchanged)');
});

test('regression: identical lpf math in BOTH modes within [0,1] (no fork)', () => {
  // Feed a [0,1] step through the SAME lpf in intensity and frequency modes;
  // since the values stay in [0,1] the final clamp is a no-op and the two
  // modes must produce BIT-IDENTICAL output — proving one shared math path.
  const step = stepSig(0, 1, 1, 30);
  const intens = runIntensityOp({ id: 'l', type: 'lpf', params: { cutoffHz: 10 } }, step);
  const freq = runFreqOp({ id: 'l', type: 'lpf', params: { cutoffHz: 10 } }, step);
  for (let i = 0; i < step.length; i++) {
    approx(freq[i], intens[i], 1e-12, `same lpf math in both modes @${i}`);
  }
});

test('regression: frequency mode does NOT clamp a >1 value (the bug being fixed)', () => {
  // The exact failure the bypass existed for: a Hz value > 1 must survive the
  // chain. Use lpf (a frequency-valid op with no internal clamp) settled on a
  // 440 Hz input — in INTENSITY mode the final clamp would force this to 1.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC(), outputMode: 'frequency' });
  proc.putChain(PROXY, [{ id: 'l', type: 'lpf', params: { cutoffHz: 50 } }]);
  let y = 0;
  for (let i = 0; i < 200; i++) y = proc.process(PROXY, 440, DT);
  approx(y, 440, 1e-3, 'frequency mode preserves a settled 440 Hz value (no [0,1] clamp)');
});

// ── sanity: the contract's Hz-valid op set all validate on a freq signal ─────

test('all Hz-valid ops validate on a frequency signal (lpf/clamp/slew/osc_out)', () => {
  for (const opType of FREQUENCY_OPS.filter(t => t !== 'kalman' && t !== 'osc_out')) {
    const params = opType === 'clamp' ? { min: 40, max: 4000 }
      : opType === 'lpf' ? { cutoffHz: 5 }
        : opType === 'danceMaker' ? { omega: 7 }
          : opType === 'normalizer' ? { windowSec: 30, strength: 1 }
            : { maxStepPerSec: 4 };
    const sig = {
      id: 'd', label: 'D', source: 'rawDom1', type: 'frequency',
      chain: [
        { id: 'op', type: opType, params },
        { id: 'o', type: 'osc_out', params: { name: 'micDomFreq1' } },
      ],
    };
    const r = validateSignal(sig);
    assert.equal(r.ok, true, `${opType} should validate on a frequency signal: ${r.error || ''}`);
  }
});
