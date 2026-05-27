// Unit tests for lib/signal_post_processor.js (docs/29 Phase 2).
//
// Coverage:
//   - Per-op math vector tests against hand-computed expected values,
//     with the formula source cited inline for each op so the validator
//     can verify the math against the design doc Operator catalog.
//   - validateChain: happy path + every rejection branch.
//   - Chain integration: cascaded 4-op chain hand-checked.
//   - paramKey Gain: reads CPC LIVE every process() call.
//   - Hold timeout + exponential decay (time-based).
//   - PUT → snapshot → load → snapshot persistence round-trip.
//   - Schmitt refractory + hysteresis edge cases.
//
// Run:  cd marsin_engine && node --test tests/signal_post_processor.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SignalPostProcessor,
  validateChain,
  DEFAULT_CHAINS,
  KNOWN_SIGNALS,
  opCatalog,
} from '../lib/signal_post_processor.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeParamCenter(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    get(key) {
      if (!(key in store)) throw new Error(`ParamCenter.get: unknown key ${key}`);
      return store[key];
    },
    set(key, v) { store[key] = v; },
  };
}

/** All gain CPC params populated to 1.0 so DEFAULT_CHAINS round-trip works. */
function fullGainPC() {
  return makeParamCenter({
    micLowGain: 1.0, micMidGain: 1.0, micHighGain: 1.0, micKickGain: 1.0,
    stemsBassGain: 1.0, stemsDrumsGain: 1.0, stemsVocalsGain: 1.0,
  });
}

function approxEqual(actual, expected, eps = 1e-9, msg = '') {
  assert.ok(Math.abs(actual - expected) < eps,
    `${msg} expected ≈${expected}, got ${actual} (diff=${actual - expected})`);
}

// Single-op chain for math verification: feed an array of {x, dt}, get
// out the post-op value after each tick.
function runSingleOp(opCfg, sequence, { signalKey = 'micLow', pc = null } = {}) {
  const proc = new SignalPostProcessor({ paramCenter: pc || fullGainPC() });
  proc.putChain(signalKey, [opCfg]);
  return sequence.map(({ x, dt }) => proc.process(signalKey, x, dt));
}

// ── KNOWN_SIGNALS / DEFAULT_CHAINS sanity ────────────────────────────────────

test('KNOWN_SIGNALS covers the 7 docs/29 signals', () => {
  assert.deepEqual(
    [...KNOWN_SIGNALS].sort(),
    ['micHigh', 'micKick', 'micLow', 'micMid', 'stemsBass', 'stemsDrums', 'stemsVocals'],
  );
});

test('DEFAULT_CHAINS has an entry per known signal', () => {
  for (const sig of KNOWN_SIGNALS) {
    assert.ok(Array.isArray(DEFAULT_CHAINS[sig]), `missing default chain for ${sig}`);
    assert.ok(DEFAULT_CHAINS[sig].length >= 1, `default chain for ${sig} is empty`);
  }
});

test('default mic chains are single-op Gain tied to *Gain CPC paramKey (Wireframe A backward-compat)', () => {
  for (const sig of ['micLow', 'micMid', 'micHigh']) {
    const chain = DEFAULT_CHAINS[sig];
    assert.equal(chain.length, 1, `${sig} default chain should be single-op`);
    assert.equal(chain[0].type, 'gain');
    assert.equal(chain[0].params.paramKey, `${sig}Gain`);
  }
});

test('micKick default chain has Envelope → Schmitt → Hold per design doc Wireframe A', () => {
  const chain = DEFAULT_CHAINS.micKick;
  const types = chain.map(o => o.type);
  // Default ships: gain → envelope → schmitt → hold. Operator can drop
  // the gain or insert a bandpass when Phase 7 adds it.
  assert.ok(types.includes('envelope'));
  assert.ok(types.includes('schmitt'));
  assert.ok(types.includes('hold'));
});

test('stems default chains are single-op Gain (loopback OSC — Hold NOT in default)', () => {
  for (const sig of ['stemsBass', 'stemsDrums', 'stemsVocals']) {
    const chain = DEFAULT_CHAINS[sig];
    assert.equal(chain.length, 1, `stems default for ${sig} should be single Gain op`);
    assert.equal(chain[0].type, 'gain', `stems ${sig} default op should be gain`);
    assert.ok(!chain.some(op => op.type === 'hold'), `${sig} default must NOT include Hold (loopback OSC)`);
    assert.equal(chain[0].params.paramKey, `${sig}Gain`);
  }
});

// ── validateChain — happy path + every rejection branch ─────────────────────

test('validateChain: happy path with a 4-op chain', () => {
  const chain = [
    { id: 'g',  type: 'gain',     params: { value: 1.5 } },
    { id: 'l',  type: 'lpf',      params: { cutoffHz: 5.0 } },
    { id: 's',  type: 'schmitt',  params: { tHigh: 0.8, tLow: 0.4, refractoryMs: 100 } },
    { id: 'h',  type: 'hold',     params: { timeoutMs: 200, decayMs: 150 } },
  ];
  const r = validateChain('micLow', chain);
  assert.equal(r.ok, true);
  assert.equal(r.normalized.length, 4);
  // enabled defaults to true.
  assert.equal(r.normalized[0].enabled, true);
});

test('validateChain: rejects unknown signalKey', () => {
  const r = validateChain('notAKey', [{ id: 'g', type: 'gain', params: { value: 1.0 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown signalKey/);
});

test('validateChain: rejects non-array chain', () => {
  const r = validateChain('micLow', { not: 'an array' });
  assert.equal(r.ok, false);
  assert.match(r.error, /must be an array/);
});

test('validateChain: rejects unknown op type', () => {
  const r = validateChain('micLow', [{ id: 'mystery', type: 'reverse_polarity', params: {} }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown op type "reverse_polarity"/);
});

test('validateChain: rejects op missing id', () => {
  const r = validateChain('micLow', [{ type: 'gain', params: { value: 1.0 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /id must be a non-empty string/);
});

test('validateChain: rejects out-of-range param', () => {
  const r = validateChain('micLow', [{ id: 'l', type: 'lpf', params: { cutoffHz: -5 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('validateChain: rejects unknown param key (no silent ignore, Codex P0)', () => {
  const r = validateChain('micLow', [{ id: 'g', type: 'gain', params: { value: 1.0, mystery: 42 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown param "mystery"/);
});

test('validateChain: rejects duplicate op ids', () => {
  const r = validateChain('micLow', [
    { id: 'dup', type: 'gain', params: { value: 1.0 } },
    { id: 'dup', type: 'bias', params: { value: 0.1 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /duplicate op id "dup"/);
});

test('validateChain: rejects Schmitt with tHigh <= tLow (hysteresis inversion)', () => {
  const r = validateChain('micKick', [
    { id: 'sch', type: 'schmitt', params: { tHigh: 0.3, tLow: 0.5 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /tHigh > tLow/);
});

test('validateChain: rejects Clamp with max < min', () => {
  const r = validateChain('micLow', [
    { id: 'cl', type: 'clamp', params: { min: 0.6, max: 0.4 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /max >= min/);
});

test('validateChain: rejects gain with BOTH value and paramKey', () => {
  const r = validateChain('micLow', [
    { id: 'g', type: 'gain', params: { value: 1.0, paramKey: 'micLowGain' } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /exactly one of/);
});

test('validateChain: rejects gain with NEITHER value nor paramKey', () => {
  const r = validateChain('micLow', [
    { id: 'g', type: 'gain', params: {} },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /exactly one of/);
});

test('validateChain: rejects non-finite param value', () => {
  const r = validateChain('micLow', [
    { id: 'g', type: 'gain', params: { value: Number.NaN } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /finite/);
});

test('validateChain: rejects non-boolean enabled', () => {
  const r = validateChain('micLow', [
    { id: 'g', type: 'gain', enabled: 'yes', params: { value: 1.0 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /enabled must be a boolean/);
});

// ── Per-op math vector tests ────────────────────────────────────────────────

// ── Gain (static value) ───
// Source: design doc §Operator catalog row "Gain" — y = clamp01(x * value).
test('Gain (static value): y = clamp01(x * value)', () => {
  const out = runSingleOp({ id: 'g', type: 'gain', params: { value: 2.0 } },
    [{ x: 0.3, dt: 0.025 }, { x: 0.6, dt: 0.025 }, { x: 0.9, dt: 0.025 }]);
  // 0.3*2=0.6; 0.6*2=1.2→clamp 1.0; 0.9*2=1.8→clamp 1.0.
  approxEqual(out[0], 0.6);
  approxEqual(out[1], 1.0);
  approxEqual(out[2], 1.0);
});

test('Gain (paramKey): reads CPC LIVE each process() call (operator slider stays source-of-truth)', () => {
  const pc = makeParamCenter({ micLowGain: 1.0 });
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } }]);
  // First tick: gain 1.0.
  approxEqual(proc.process('micLow', 0.5, 0.025), 0.5);
  // Operator twists knob mid-show → CPC mutated.
  pc.set('micLowGain', 2.0);
  // SECOND tick must see the NEW value — no cache.
  approxEqual(proc.process('micLow', 0.4, 0.025), 0.8);
});

// ── Bias ───
// Source: design doc §Operator catalog row "Bias" — y = clamp01(x + value).
test('Bias: y = clamp01(x + value), negative bias clamps at 0', () => {
  const out = runSingleOp({ id: 'b', type: 'bias', params: { value: 0.2 } },
    [{ x: 0.1, dt: 0.025 }, { x: 0.9, dt: 0.025 }]);
  approxEqual(out[0], 0.3);  // 0.1 + 0.2
  approxEqual(out[1], 1.0);  // 0.9 + 0.2 = 1.1 → clamp
  const neg = runSingleOp({ id: 'b', type: 'bias', params: { value: -0.3 } },
    [{ x: 0.1, dt: 0.025 }]);
  approxEqual(neg[0], 0); // 0.1 - 0.3 = -0.2 → clamp 0
});

// ── Clamp ───
// Source: design doc §Operator catalog row "Clamp" — y = max(min, min(max, x)).
test('Clamp: y = max(min, min(max, x))', () => {
  const out = runSingleOp({ id: 'c', type: 'clamp', params: { min: 0.2, max: 0.7 } },
    [{ x: 0.05, dt: 0.025 }, { x: 0.5, dt: 0.025 }, { x: 0.95, dt: 0.025 }]);
  approxEqual(out[0], 0.2);
  approxEqual(out[1], 0.5);
  approxEqual(out[2], 0.7);
});

// ── LPF (one-pole IIR / EMA) ───
// Source: design doc §Operator catalog row "LPF / Lag" — α = 1 − exp(−2π fc dt);
// y = α·x + (1−α)·y_prev. y_prev starts at 0.
test('LPF: one-pole IIR, hand-computed against α = 1 − exp(−2π fc dt)', () => {
  const fc = 5.0; // Hz
  const dt = 0.025; // 40 fps frame
  const alpha = 1 - Math.exp(-2 * Math.PI * fc * dt);
  // Sequence: constant 1.0 → y should approach 1.0 from 0.
  const out = runSingleOp({ id: 'l', type: 'lpf', params: { cutoffHz: fc } },
    [{ x: 1.0, dt }, { x: 1.0, dt }, { x: 1.0, dt }]);
  // y1 = α·1 + (1−α)·0 = α
  approxEqual(out[0], alpha, 1e-9, 'LPF first sample = α');
  // y2 = α·1 + (1−α)·α  = α + (1−α)·α
  const y2 = alpha + (1 - alpha) * alpha;
  approxEqual(out[1], y2, 1e-9, 'LPF second sample');
  // y3 = α·1 + (1−α)·y2
  const y3 = alpha + (1 - alpha) * y2;
  approxEqual(out[2], y3, 1e-9, 'LPF third sample');
});

// ── Envelope (asymmetric attack/release) ───
// Source: design doc §Operator catalog row "Envelope" — α_a = 1 − exp(−dt/τ_a),
// α_r = 1 − exp(−dt/τ_r); α = α_a if x > y_prev else α_r.
test('Envelope: rising uses attackMs, falling uses releaseMs', () => {
  const dt = 0.025;
  const attackMs = 8;
  const releaseMs = 180;
  const tauA = attackMs / 1000;
  const tauR = releaseMs / 1000;
  const alphaA = 1 - Math.exp(-dt / tauA);
  const alphaR = 1 - Math.exp(-dt / tauR);
  const out = runSingleOp({ id: 'env', type: 'envelope', params: { attackMs, releaseMs } },
    [
      { x: 1.0, dt }, // rising from 0 → attack
      { x: 1.0, dt }, // still rising (1 > y_prev)
      { x: 0.0, dt }, // falling → release
    ],
  );
  // y1 = α_a·1 + (1−α_a)·0 = α_a
  approxEqual(out[0], alphaA, 1e-9);
  const y2 = alphaA + (1 - alphaA) * alphaA;
  approxEqual(out[1], y2, 1e-9);
  // y3 = α_r·0 + (1−α_r)·y2 (falling)
  const y3 = (1 - alphaR) * y2;
  approxEqual(out[2], y3, 1e-9);
});

test('Envelope: attack much faster than release means peaks track quickly, releases bleed', () => {
  // Asserts the asymmetry: attackMs=1, releaseMs=1000 → near-instant
  // rise, very slow fall.
  const out = runSingleOp({ id: 'env', type: 'envelope', params: { attackMs: 1, releaseMs: 1000 } },
    [
      { x: 1.0, dt: 0.025 },
      { x: 0.0, dt: 0.025 },
    ]);
  assert.ok(out[0] > 0.9, `expected fast attack to ~1, got ${out[0]}`);
  // After one 25 ms release tick with τ=1s, y2 should still be > 0.9.
  assert.ok(out[1] > 0.9, `expected slow release to hold, got ${out[1]}`);
});

// ── Schmitt (hysteresis + refractory) ───
// Source: design doc §Operator catalog row "Schmitt" — Schmitt 1938;
// Horowitz & Hill (3rd ed., 2015, §4.3.2).
test('Schmitt: classic hysteresis — fires above tHigh, releases below tLow, holds between', () => {
  const out = runSingleOp(
    { id: 'sch', type: 'schmitt', params: { tHigh: 0.8, tLow: 0.4, refractoryMs: 0 } },
    [
      { x: 0.5, dt: 0.025 }, // below tHigh, y stays 0
      { x: 0.9, dt: 0.025 }, // above tHigh → fires (y=1)
      { x: 0.6, dt: 0.025 }, // between thresholds, y stays 1 (hold)
      { x: 0.3, dt: 0.025 }, // below tLow → releases (y=0)
      { x: 0.5, dt: 0.025 }, // below tHigh, y stays 0
    ],
  );
  assert.equal(out[0], 0);
  assert.equal(out[1], 1);
  assert.equal(out[2], 1);  // <-- HYSTERESIS: 0.6 is below tHigh but above tLow → hold
  assert.equal(out[3], 0);
  assert.equal(out[4], 0);
});

test('Schmitt: refractoryMs blocks re-fire within window', () => {
  // refractoryMs=200; ticks at dt=0.025 (25 ms each); 8 ticks = 200 ms.
  const out = runSingleOp(
    { id: 'sch', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.3, refractoryMs: 200 } },
    [
      { x: 0.9, dt: 0.025 },   // tick 0 (clock=25ms): fire → 1
      { x: 0.2, dt: 0.025 },   // tick 1 (clock=50ms): release → 0
      { x: 0.9, dt: 0.025 },   // tick 2 (clock=75ms): within refractory → blocked
      { x: 0.2, dt: 0.025 },   // tick 3 (clock=100ms): irrelevant
      { x: 0.9, dt: 0.150 },   // tick 4 (clock=250ms): outside refractory → fire
    ],
  );
  assert.equal(out[0], 1, 'first fire');
  assert.equal(out[1], 0, 'released');
  assert.equal(out[2], 0, 'refractory should block re-fire');
  assert.equal(out[4], 1, 'fires again after refractory expires');
});

// ── Hold (sample-and-hold + exponential decay) ───
// Source: design doc §Operator catalog row "Hold" — TD CHOP Hold + Speed.
// If now − lastInputAt > timeoutMs: y = y_prev · exp(−dt/τ_decay).
// Else y = max(x, y_prev · exp(−dt/τ_decay)).
test('Hold: latches peak, then decays exponentially after timeout', () => {
  // timeoutMs=100, decayMs=100 → τ_decay = 0.1 s.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{ id: 'h', type: 'hold', params: { timeoutMs: 100, decayMs: 100 } }]);
  // Tick 1: x=1, dt=0.025. lastInputAt=25ms; clock=25ms. y = max(1, 0*exp(...)) = 1.
  let y = proc.process('micKick', 1.0, 0.025);
  approxEqual(y, 1.0);
  // Tick 2: x=0, dt=0.025. clock=50ms. now-lastInputAt = 50-25 = 25 ≤ 100 → y = max(0, 1*exp(-0.025/0.1)) = exp(-0.25) ≈ 0.7788.
  y = proc.process('micKick', 0, 0.025);
  approxEqual(y, Math.exp(-0.25), 1e-9);
  // Tick 3: x=0, dt=0.025. clock=75ms. now-lastInputAt = 50 ≤ 100 → y = max(0, prev*exp(-0.25)) = exp(-0.5).
  y = proc.process('micKick', 0, 0.025);
  approxEqual(y, Math.exp(-0.5), 1e-9);
  // Tick 4: x=0, dt=0.100. clock=175ms. now-lastInputAt = 150 > 100 → y = prev * exp(-0.1/0.1) = exp(-0.5)*exp(-1).
  y = proc.process('micKick', 0, 0.100);
  approxEqual(y, Math.exp(-0.5) * Math.exp(-1), 1e-9);
});

test('Hold: positive sample re-latches even before timeout expires', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{ id: 'h', type: 'hold', params: { timeoutMs: 500, decayMs: 100 } }]);
  // Latch high.
  proc.process('micKick', 1.0, 0.025);
  // Decay a bit.
  proc.process('micKick', 0, 0.025);
  // Re-trigger before timeout — should re-latch to 1.
  const y = proc.process('micKick', 1.0, 0.025);
  approxEqual(y, 1.0);
});

// ── Chain integration: 4-op cascade ─────────────────────────────────────────

test('Chain integration: Bias → Clamp → LPF → Envelope produces hand-computed cascade', () => {
  // Pin a deterministic 4-op chain and hand-compute the output.
  const dt = 0.025;
  const chain = [
    { id: 'b', type: 'bias',     params: { value: 0.1 } },        // y = x + 0.1
    { id: 'c', type: 'clamp',    params: { min: 0.0, max: 0.7 } }, // y = min(0.7, y)
    { id: 'l', type: 'lpf',      params: { cutoffHz: 5.0 } },      // y = αx+(1−α)y_prev
    { id: 'e', type: 'envelope', params: { attackMs: 8, releaseMs: 180 } },
  ];
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const put = proc.putChain('micLow', chain);
  assert.equal(put.ok, true);

  const alpha = 1 - Math.exp(-2 * Math.PI * 5.0 * dt);
  const alphaA = 1 - Math.exp(-dt / 0.008);
  // Tick 1: x=0.5 → bias 0.6 → clamp 0.6 → LPF α*0.6 → envelope α_a*lpf
  const inExpected1 = alpha * 0.6;
  const envExpected1 = alphaA * inExpected1;
  const got1 = proc.process('micLow', 0.5, dt);
  approxEqual(got1, envExpected1, 1e-9, 'tick 1');

  // Tick 2: x=0.95 → bias 1.05 → clamp 0.7 → LPF α*0.7 + (1−α)*inExpected1 → envelope α_a*lpf + (1−α_a)*envExpected1
  const inExpected2 = alpha * 0.7 + (1 - alpha) * inExpected1;
  const envExpected2 = alphaA * inExpected2 + (1 - alphaA) * envExpected1;
  const got2 = proc.process('micLow', 0.95, dt);
  approxEqual(got2, envExpected2, 1e-9, 'tick 2');
});

// ── Disabled ops are bypassed ────────────────────────────────────────────────

test('Disabled op is bypassed: value flows past unchanged', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [
    { id: 'g', type: 'gain', enabled: false, params: { value: 10.0 } },
  ]);
  approxEqual(proc.process('micLow', 0.5, 0.025), 0.5);
});

// ── Codex P0: unknown signalKey throws on process() ─────────────────────────

test('Codex P0: process() throws on unknown signalKey (never silent identity)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  assert.throws(
    () => proc.process('notARealSignal', 0.5, 0.025),
    /unknown signalKey/,
  );
});

test('Codex P0: process() throws on negative dtSeconds', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  assert.throws(
    () => proc.process('micLow', 0.5, -0.001),
    /dtSeconds/,
  );
});

test('Codex P0: Gain with unknown CPC paramKey is rejected at putChain (fail loudly EARLY)', () => {
  // Old behavior let the typo sail through PUT and only threw on the
  // first audio-hot-path process() call. New contract: validate at
  // PUT/PATCH so the operator gets a 400 with a clear message, never
  // a mid-show crash on the first frame.
  const pc = makeParamCenter({}); // no gain key
  const proc = new SignalPostProcessor({ paramCenter: pc });
  const r = proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /paramKey/);
  assert.match(r.error, /micLowGain/);
});

// ── PUT / PATCH / reset ──────────────────────────────────────────────────────

test('putChain rejects unknown signal key', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const r = proc.putChain('mystery', [{ id: 'g', type: 'gain', params: { value: 1.0 } }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown signalKey/);
});

test('patchOp updates enabled flag, preserves other op params', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [
    { id: 'g', type: 'gain', params: { value: 1.5 } },
  ]);
  const r = proc.patchOp('micLow', 'g', { enabled: false });
  assert.equal(r.ok, true);
  assert.equal(r.op.enabled, false);
  assert.equal(r.op.params.value, 1.5);
});

test('patchOp rejects op type change (use PUT for that)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 1.0 } }]);
  const r = proc.patchOp('micLow', 'g', { type: 'bias' });
  assert.equal(r.ok, false);
  assert.match(r.error, /type change not allowed/);
});

test('patchOp rejects unknown op id', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 1.0 } }]);
  const r = proc.patchOp('micLow', 'ghost', { enabled: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown opId/);
});

test('patchOp re-validates with cross-param invariants (Schmitt tHigh > tLow)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{ id: 'sch', type: 'schmitt', params: { tHigh: 0.8, tLow: 0.4 } }]);
  const r = proc.patchOp('micKick', 'sch', { params: { tHigh: 0.2 } }); // now < tLow
  assert.equal(r.ok, false);
  assert.match(r.error, /tHigh > tLow/);
});

// ── patchOp runtime-state continuity (operator tweak ≠ visible pop) ─────────
//
// MAJOR contract from the file docstrings (lines ~366, ~428, ~716): PATCH
// preserves per-op runtime state so a mid-show param tweak does NOT cause
// the chain to "snap back to zero" while smoothing/hold history rebuilds.
// One test per stateful op: build state with N process() calls, snapshot,
// patchOp the param, process ONE more sample, and assert post is roughly
// continuous from the snapshot (NOT reset to the default initial state).
//
// We use a generous epsilon on each post check because the new param may
// legitimately affect the next sample's value (e.g. a smaller attackMs
// reaches steady-state faster) — what we are pinning is "yPrev did NOT
// reset to default" (which would manifest as a giant drop toward 0).

function _processN(proc, sig, value, dt, n) {
  let last = 0;
  for (let i = 0; i < n; i++) last = proc.process(sig, value, dt);
  return last;
}

test('patchOp preserves runtime state — LPF (yPrev does not reset on cutoff tweak)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'lpf', type: 'lpf', params: { cutoffHz: 2.0 } }]);
  // Build yPrev close to 1 with sustained input=1.0.
  const before = _processN(proc, 'micLow', 1.0, 0.025, 200);
  assert.ok(before > 0.99, `LPF should be near steady-state before patch (got ${before})`);
  // Patch the cutoff and process ONE more frame at the same input.
  const r = proc.patchOp('micLow', 'lpf', { params: { cutoffHz: 10.0 } });
  assert.equal(r.ok, true);
  const after = proc.process('micLow', 1.0, 0.025);
  assert.ok(after > 0.95,
    `LPF yPrev must be preserved across patchOp — expected post ≈ ${before}, got ${after} (yPrev was reset to 0?)`);
});

test('patchOp preserves runtime state — Envelope (yPrev does not reset on attack tweak)', () => {
  // The exact scenario from the validator's reproduction.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{
    id: 'env', type: 'envelope',
    params: { attackMs: 50, releaseMs: 100 },
  }]);
  // Run enough steps to drive yPrev near 1.
  const before = _processN(proc, 'micLow', 1.0, 0.025, 300);
  assert.ok(before > 0.99, `Envelope should be near steady-state (got ${before})`);
  // Patch attackMs and process ONE more input=1.0 sample.
  const r = proc.patchOp('micLow', 'env', { params: { attackMs: 10 } });
  assert.equal(r.ok, true);
  const after = proc.process('micLow', 1.0, 0.025);
  // If yPrev had been reset to 0, post would drop to roughly
  // alpha * 1 + (1 - alpha) * 0 ≈ 0.7 (the validator's 0.6988 number).
  // With preservation, post stays right next to 1.0.
  assert.ok(after > 0.95,
    `Envelope yPrev must survive patchOp — expected post ≈ ${before}, got ${after} (operator-visible pop if this fails)`);
});

test('patchOp preserves runtime state — Schmitt (yPrev/lastFireAt do not reset on tHigh tweak)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{
    id: 'sch', type: 'schmitt',
    params: { tHigh: 0.8, tLow: 0.3, refractoryMs: 100 },
  }]);
  // Drive the schmitt high.
  const fired = proc.process('micKick', 0.95, 0.025);
  assert.equal(fired, 1, 'schmitt should have fired on first high sample');
  // Patch tHigh while it's HIGH. yPrev=1, lastFireAt is set. After
  // the patch, an input BELOW tLow should release (proving yPrev was
  // preserved as 1, otherwise we wouldn't be in the "high" branch).
  const r = proc.patchOp('micKick', 'sch', { params: { tHigh: 0.7 } });
  assert.equal(r.ok, true);
  const stillHigh = proc.process('micKick', 0.5, 0.025); // tLow < 0.5 < tHigh → hold high
  assert.equal(stillHigh, 1, 'schmitt should still be HIGH after patch (yPrev preserved)');
  const released = proc.process('micKick', 0.1, 0.025); // < tLow → release
  assert.equal(released, 0, 'schmitt should release on input < tLow');
});

test('patchOp preserves runtime state — Hold (yPrev/lastInputAt do not reset on decay tweak)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{
    id: 'hold', type: 'hold',
    params: { timeoutMs: 500, decayMs: 200 },
  }]);
  // Drive the hold high (sustained input=1.0).
  const before = _processN(proc, 'micKick', 1.0, 0.025, 50);
  assert.ok(before > 0.99, `Hold should be near 1.0 with sustained input (got ${before})`);
  // Patch decayMs while held high.
  const r = proc.patchOp('micKick', 'hold', { params: { decayMs: 500 } });
  assert.equal(r.ok, true);
  // One more sustained sample — held high should stay held high (NOT
  // snap to 0 because yPrev got reset).
  const after = proc.process('micKick', 1.0, 0.025);
  assert.ok(after > 0.95,
    `Hold yPrev must survive patchOp — expected ≈ ${before}, got ${after}`);
});

test('patchOp preserves runtime state — disabled-only patch keeps yPrev intact', () => {
  // PATCH with only `enabled: false` must not blow runtime away
  // either — re-enabling later should resume from the last yPrev,
  // not from a fresh zero (otherwise the re-enable would pop too).
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'lpf', type: 'lpf', params: { cutoffHz: 2.0 } }]);
  const before = _processN(proc, 'micLow', 1.0, 0.025, 200);
  assert.ok(before > 0.99);
  // Disable then re-enable.
  assert.equal(proc.patchOp('micLow', 'lpf', { enabled: false }).ok, true);
  // While disabled, process passes value through unchanged (but yPrev
  // must stay frozen at its prior value, not reset to 0).
  proc.process('micLow', 0.0, 0.025);
  assert.equal(proc.patchOp('micLow', 'lpf', { enabled: true }).ok, true);
  const after = proc.process('micLow', 1.0, 0.025);
  assert.ok(after > 0.95,
    `LPF yPrev must persist through disable/enable cycle — expected ≈ ${before}, got ${after}`);
});

// ── putChain / patchOp paramKey validation (Codex P0 — fail early) ──────────

test('putChain rejects Gain op with a typo paramKey (error mentions paramKey + key name)', () => {
  // The bogus paramKey used to sail through PUT and only crash on the
  // first process() call (audio hot path). New contract: caught at PUT.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const r = proc.putChain('micLow', [
    { id: 'g', type: 'gain', params: { paramKey: 'micLowGainX' } },
  ]);
  assert.equal(r.ok, false, 'putChain must reject unknown paramKey');
  assert.match(r.error, /paramKey/, 'error should mention paramKey');
  assert.match(r.error, /micLowGainX/, 'error should mention the unknown key name');
});

test('patchOp rejects switching to a typo paramKey', () => {
  // Note: the dual-mode XOR means we have to switch via a chain that's
  // already in paramKey mode. (Switching value→paramKey via PATCH is
  // an out-of-scope Phase-5 concern — operator UI translates that to
  // PUT. We test the paramKey→paramKey rename path here.)
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [
    { id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } },
  ]);
  const r = proc.patchOp('micLow', 'g', { params: { paramKey: 'micLowGainX' } });
  assert.equal(r.ok, false, 'patchOp must reject unknown paramKey');
  assert.match(r.error, /paramKey/);
  assert.match(r.error, /micLowGainX/);
});

test('putChain ACCEPTS a known paramKey when paramCenter exposes getSchema()', () => {
  // The real ParamCenter exposes getSchema(); our test fullGainPC()
  // helper only exposes get/set, which exercises the get-throws
  // fallback. Confirm the schema path also works.
  const pc = {
    _store: { micLowGain: 1.0 },
    get(k) { if (!(k in this._store)) throw new Error(`unknown ${k}`); return this._store[k]; },
    getSchema() { return [{ key: 'micLowGain', label: 'Mic Low Gain', type: 'number' }]; },
  };
  const proc = new SignalPostProcessor({ paramCenter: pc });
  const r = proc.putChain('micLow', [
    { id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } },
  ]);
  assert.equal(r.ok, true, `expected success, got ${r.error}`);
  // And the rejection path with getSchema also fires:
  const r2 = proc.putChain('micMid', [
    { id: 'g', type: 'gain', params: { paramKey: 'micMidGainX' } },
  ]);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /micMidGainX/);
});

test('resetSignal restores the documented default chain', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [
    { id: 'custom', type: 'bias', params: { value: 0.5 } },
  ]);
  proc.resetSignal('micLow');
  const got = proc.getChain('micLow');
  assert.deepEqual(got.map(o => ({ id: o.id, type: o.type })),
    DEFAULT_CHAINS.micLow.map(o => ({ id: o.id, type: o.type })));
});

// ── Persistence round-trip ──────────────────────────────────────────────────

test('Persistence round-trip: putChain → snapshot → loadChains → snapshot matches', () => {
  const proc1 = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const customChain = [
    { id: 'b', type: 'bias',     params: { value: 0.05 } },
    { id: 'l', type: 'lpf',      params: { cutoffHz: 7.5 } },
    { id: 's', type: 'schmitt',  params: { tHigh: 0.7, tLow: 0.3, refractoryMs: 150 } },
  ];
  const putRes = proc1.putChain('micLow', customChain);
  assert.equal(putRes.ok, true);
  const snapshot = proc1.getAllChains();

  // Simulate engine restart: fresh processor, load YAML block.
  const proc2 = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc2.loadChains(snapshot);
  const reloaded = proc2.getAllChains();
  assert.deepEqual(reloaded, snapshot,
    'after putChain → snapshot → loadChains round-trip, chains must be identical');
});

test('loadChains rejects an invalid block atomically (no half-loaded state)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const before = proc.getAllChains();
  assert.throws(() => proc.loadChains({
    micLow: [{ id: 'ok', type: 'gain', params: { value: 1.0 } }],
    micKick: [{ id: 'bad', type: 'NOT_A_REAL_OP', params: {} }],
  }), /unknown op type/);
  // micLow MUST NOT have been mutated (atomic).
  assert.deepEqual(proc.getAllChains(), before, 'failed loadChains must not partially apply');
});

test('loadChains rejects unknown signalKey in block (Codex P0 — operator typo surfaces)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  assert.throws(() => proc.loadChains({
    micLoww: [{ id: 'g', type: 'gain', params: { value: 1.0 } }],
  }), /unknown signalKey "micLoww"/);
});

// ── Editor subscription gate ────────────────────────────────────────────────

test('snapshotForEditor returns 0 stubs when editor NOT subscribed (zero-cost when off)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 2.0 } }]);
  proc.process('micLow', 0.4, 0.025); // runs the chain
  // editor not subscribed
  const snap = proc.snapshotForEditor('micLow');
  assert.equal(snap.signalKey, 'micLow');
  assert.equal(snap.ops[0].pre, 0);  // stub
  assert.equal(snap.ops[0].post, 0); // stub
});

test('snapshotForEditor reflects live pre/post when editor IS subscribed', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 2.0 } }]);
  proc.setEditorSubscribed(true);
  proc.process('micLow', 0.4, 0.025);
  const snap = proc.snapshotForEditor('micLow');
  approxEqual(snap.ops[0].pre,  0.4);
  approxEqual(snap.ops[0].post, 0.8);
});

test('Schmitt snapshot reports firing flag', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micKick', [{ id: 'sch', type: 'schmitt', params: { tHigh: 0.5, tLow: 0.3 } }]);
  proc.setEditorSubscribed(true);
  proc.process('micKick', 0.9, 0.025); // fires
  const snap = proc.snapshotForEditor('micKick');
  const schmittOp = snap.ops.find(o => o.id === 'sch');
  assert.equal(schmittOp.firing, true);
});

// ── audioChainsChanged broadcast ────────────────────────────────────────────

test('putChain triggers audioChainsChanged broadcast', () => {
  const received = [];
  const proc = new SignalPostProcessor({
    paramCenter: fullGainPC(),
    broadcast: (msg) => received.push(msg),
  });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 1.5 } }]);
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'audioChainsChanged');
  assert.ok(received[0].chains.micLow);
});

test('patchOp triggers audioChainsChanged broadcast', () => {
  const received = [];
  const proc = new SignalPostProcessor({
    paramCenter: fullGainPC(),
    broadcast: (msg) => received.push(msg),
  });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 1.0 } }]);
  received.length = 0;
  proc.patchOp('micLow', 'g', { params: { value: 1.5 } });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'audioChainsChanged');
});

test('resetSignal triggers audioChainsChanged broadcast', () => {
  const received = [];
  const proc = new SignalPostProcessor({
    paramCenter: fullGainPC(),
    broadcast: (msg) => received.push(msg),
  });
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { value: 2.0 } }]);
  received.length = 0;
  proc.resetSignal('micLow');
  assert.equal(received.length, 1);
});

// ── opCatalog (public for iPad picker) ──────────────────────────────────────

test('opCatalog lists the 12 op types (7 Phase-2 + 5 Phase-7)', () => {
  const cat = opCatalog();
  const types = Object.keys(cat).sort();
  assert.deepEqual(types, [
    'bias', 'biquad', 'clamp', 'compressor', 'curve',
    'envelope', 'gain', 'hold', 'lpf', 'schmitt',
    'slew', 'slope',
  ]);
  assert.equal(cat.gain.paramKeyOrValue, true);
  assert.equal(cat.bias.paramKeyOrValue, false);
  // Phase 7 schema spot-checks (the iPad picker / chain editor reads these).
  assert.equal(cat.curve.params.shape.default, 'linear');
  assert.deepEqual(cat.curve.params.shape.oneOf, ['linear', 'easeIn', 'easeOut', 'exp']);
  assert.equal(cat.compressor.params.ratio.min, 1);
  assert.equal(cat.biquad.params.cutoffHz.default, 8.0);
  assert.equal(cat.slope.params.bipolar.default, false);
  assert.equal(cat.slew.params.maxStepPerSec.default, 4.0);
});

// ── Constructor guards ──────────────────────────────────────────────────────

test('SignalPostProcessor requires a paramCenter with .get()', () => {
  assert.throws(() => new SignalPostProcessor({}), /paramCenter/);
  assert.throws(() => new SignalPostProcessor({ paramCenter: {} }), /paramCenter/);
});

// ════════════════════════════════════════════════════════════════════════════
// PHASE 7 — 5 new ops (Curve, Slew, Compressor, Biquad LPF, Slope).
// Each test cites the source formula in a comment so the validator can
// trace the math back to the design doc §Operator catalog.
// ════════════════════════════════════════════════════════════════════════════

// ── Curve ───────────────────────────────────────────────────────────────────
// Source: design doc §Operator catalog row "Curve" — TD CHOP Lookup;
// matches modulation_engine.js applyCurve(). Shapes:
//   linear  : y = x
//   easeIn  : y = x^2
//   easeOut : y = 1 − (1 − x)^2
//   exp     : y = x^gamma  (gamma exposed by the op; default 2.0)

test('Curve(linear): y = x for every sample', () => {
  const out = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'linear' } },
    [{ x: 0, dt: 0.025 }, { x: 0.25, dt: 0.025 }, { x: 0.5, dt: 0.025 },
     { x: 0.75, dt: 0.025 }, { x: 1.0, dt: 0.025 }],
  );
  approxEqual(out[0], 0);
  approxEqual(out[1], 0.25);
  approxEqual(out[2], 0.5);
  approxEqual(out[3], 0.75);
  approxEqual(out[4], 1.0);
});

test('Curve(easeIn): y = x^2', () => {
  const out = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'easeIn' } },
    [{ x: 0, dt: 0.025 }, { x: 0.25, dt: 0.025 }, { x: 0.5, dt: 0.025 },
     { x: 0.75, dt: 0.025 }, { x: 1.0, dt: 0.025 }],
  );
  approxEqual(out[0], 0);
  approxEqual(out[1], 0.0625);
  approxEqual(out[2], 0.25);
  approxEqual(out[3], 0.5625);
  approxEqual(out[4], 1.0);
});

test('Curve(easeOut): y = 1 − (1 − x)^2', () => {
  const out = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'easeOut' } },
    [{ x: 0, dt: 0.025 }, { x: 0.25, dt: 0.025 }, { x: 0.5, dt: 0.025 },
     { x: 0.75, dt: 0.025 }, { x: 1.0, dt: 0.025 }],
  );
  approxEqual(out[0], 0);
  approxEqual(out[1], 1 - 0.75 * 0.75);   // 0.4375
  approxEqual(out[2], 0.75);              // 1 − 0.25
  approxEqual(out[3], 1 - 0.25 * 0.25);   // 0.9375
  approxEqual(out[4], 1.0);
});

test('Curve(exp): y = x^gamma — gamma applies only to exp shape', () => {
  // Default gamma = 2.0 ⇒ exp matches easeIn numerically. Bump gamma to
  // 3.0 ⇒ matches modulation_engine.js applyCurve(_, 'exp').
  const outG2 = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'exp', gamma: 2.0 } },
    [{ x: 0.5, dt: 0.025 }, { x: 0.8, dt: 0.025 }],
  );
  approxEqual(outG2[0], 0.25);
  approxEqual(outG2[1], 0.64);

  const outG3 = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'exp', gamma: 3.0 } },
    [{ x: 0.5, dt: 0.025 }, { x: 0.8, dt: 0.025 }],
  );
  approxEqual(outG3[0], 0.125);                  // 0.5^3
  approxEqual(outG3[1], 0.512, 1e-9);            // 0.8^3

  // And gamma is IGNORED for non-exp shapes — easeIn is fixed x^2.
  const outEaseInG5 = runSingleOp(
    { id: 'cv', type: 'curve', params: { shape: 'easeIn', gamma: 5.0 } },
    [{ x: 0.5, dt: 0.025 }],
  );
  approxEqual(outEaseInG5[0], 0.25, 1e-9, 'gamma must NOT affect easeIn');
});

test('Curve edge inputs: 0 maps to 0, 1 maps to 1 for every shape', () => {
  for (const shape of ['linear', 'easeIn', 'easeOut', 'exp']) {
    const out = runSingleOp(
      { id: 'cv', type: 'curve', params: { shape, gamma: 2.5 } },
      [{ x: 0, dt: 0.025 }, { x: 1, dt: 0.025 }],
    );
    approxEqual(out[0], 0, 1e-9, `${shape}: 0 → 0`);
    approxEqual(out[1], 1, 1e-9, `${shape}: 1 → 1`);
  }
});

test('Curve: rejects unknown shape at validateChain (Codex P0 strict)', () => {
  const r = validateChain('micLow', [
    { id: 'cv', type: 'curve', params: { shape: 'bouncyHouse' } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /shape/);
  assert.match(r.error, /bouncyHouse/);
});

test('Curve: rejects non-finite gamma at validateChain (Codex P0 strict)', () => {
  const r = validateChain('micLow', [
    { id: 'cv', type: 'curve', params: { shape: 'exp', gamma: Number.NaN } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /finite/);
});

// ── Slew Limiter ────────────────────────────────────────────────────────────
// Source: design doc §Operator catalog row "Slew Limiter" — TD CHOP
// Limit (step mode). step = maxStepPerSec * dt; y = clamp(x, y_prev −
// step, y_prev + step). With y_prev = 0, dt = 0.025 s, maxStepPerSec
// = 4 → step = 0.1 per frame; a 1.0 input takes 10 frames to reach 1.

test('Slew: input rising faster than maxStepPerSec is clamped to ±step per tick', () => {
  const dt = 0.025;
  const step = 4.0 * dt; // 0.1
  // Input jumps to 1.0 from 0 — output should rise by `step` per tick.
  const out = runSingleOp(
    { id: 'sl', type: 'slew', params: { maxStepPerSec: 4.0 } },
    [
      { x: 1.0, dt }, // y_prev=0; y = min(1.0, 0+step) = 0.1
      { x: 1.0, dt }, // y = min(1.0, 0.1+step) = 0.2
      { x: 1.0, dt }, // y = 0.3
      { x: 1.0, dt }, // y = 0.4
    ],
  );
  approxEqual(out[0], step,     1e-9, 'tick 0');
  approxEqual(out[1], 2 * step, 1e-9, 'tick 1');
  approxEqual(out[2], 3 * step, 1e-9, 'tick 2');
  approxEqual(out[3], 4 * step, 1e-9, 'tick 3');
});

test('Slew: input rising slower than maxStepPerSec passes through unchanged', () => {
  // maxStepPerSec=10 ⇒ step = 0.25/tick at dt=0.025. Input rises by 0.1/tick.
  const out = runSingleOp(
    { id: 'sl', type: 'slew', params: { maxStepPerSec: 10.0 } },
    [
      { x: 0.1, dt: 0.025 },
      { x: 0.2, dt: 0.025 },
      { x: 0.3, dt: 0.025 },
    ],
  );
  approxEqual(out[0], 0.1);
  approxEqual(out[1], 0.2);
  approxEqual(out[2], 0.3);
});

test('Slew: falling input also rate-limited (symmetric)', () => {
  const dt = 0.025;
  const step = 4.0 * dt;
  // Climb a bit, then crash to 0.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'sl', type: 'slew', params: { maxStepPerSec: 4.0 } }]);
  // Pull y_prev up to 0.5.
  for (let i = 0; i < 5; i++) proc.process('micLow', 1.0, dt); // 5 * 0.1 = 0.5
  // Now drop input to 0 — output should fall by `step` per tick.
  approxEqual(proc.process('micLow', 0, dt), 0.5 - step, 1e-9);
  approxEqual(proc.process('micLow', 0, dt), 0.5 - 2 * step, 1e-9);
});

test('Slew: rejects non-positive maxStepPerSec', () => {
  const r = validateChain('micLow', [
    { id: 'sl', type: 'slew', params: { maxStepPerSec: 0 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

// ── Compressor ──────────────────────────────────────────────────────────────
// Source: design doc §Operator catalog row "Compressor" — Bob Katz,
// *Mastering Audio* (3rd ed. 2014, ch. 7); RBJ-cookbook smoothing
// constants for the envelope on the gain-reduction signal.
//
// over_dB = max(0, 20·log10(x+ε) − thresh_dB)
// targetGR_dB = −over_dB · (1 − 1/ratio)
// gr_dB ← gr_dB + α · (targetGR_dB − gr_dB)
// y = clamp01(x · 10^(gr_dB/20))

test('Compressor: input strictly below threshold passes unchanged (zero reduction)', () => {
  const out = runSingleOp(
    { id: 'cmp', type: 'compressor',
      params: { threshold: 0.5, ratio: 4.0, attackMs: 5, releaseMs: 80 } },
    [{ x: 0.1, dt: 0.025 }, { x: 0.3, dt: 0.025 }, { x: 0.4, dt: 0.025 }],
  );
  // Below thresh → over_dB ≤ 0 → targetGR_dB = 0; gr_dB stays at 0
  // → gain = 1.0 → y = x. (Within numeric precision.)
  approxEqual(out[0], 0.1, 1e-9);
  approxEqual(out[1], 0.3, 1e-9);
  approxEqual(out[2], 0.4, 1e-9);
});

test('Compressor: steady-state reduction above threshold matches hand-computed gr_dB', () => {
  // Pin a steady input at x = 1.0, threshold = 0.5, ratio = 4.
  //   x_dB = 20·log10(1) = 0
  //   thresh_dB = 20·log10(0.5) ≈ −6.0206
  //   over_dB = 0 − (−6.0206) = 6.0206
  //   targetGR_dB = −6.0206 · (1 − 1/4) = −4.5154
  //   At steady state, gr_dB = targetGR_dB.
  //   gain_linear = 10^(−4.5154/20) ≈ 0.5946
  //   y_steady = 1.0 · 0.5946 = 0.5946
  const dt = 0.025;
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{
    id: 'cmp', type: 'compressor',
    params: { threshold: 0.5, ratio: 4.0, attackMs: 1, releaseMs: 1 },
  }]);
  // Hammer it long enough that the 1 ms attack converges (~50 ticks plenty).
  let y;
  for (let i = 0; i < 200; i++) y = proc.process('micLow', 1.0, dt);
  const expectedThreshDb = 20 * Math.log10(0.5);
  const expectedOverDb = 0 - expectedThreshDb;
  const expectedTargetGrDb = -expectedOverDb * (1 - 1 / 4);
  const expectedGainLin = Math.pow(10, expectedTargetGrDb / 20);
  const expectedY = 1.0 * expectedGainLin;
  approxEqual(y, expectedY, 1e-4,
    `Compressor steady-state: gr_dB=${expectedTargetGrDb.toFixed(4)}, expected y≈${expectedY.toFixed(4)}`);
});

test('Compressor: attack envelope ramps gr_dB toward target per α=1−exp(−dt/τ)', () => {
  // attackMs=10, dt=25 ⇒ α = 1 − exp(−0.025/0.010) = 1 − exp(−2.5)
  //                       ≈ 0.9179. One step should pull gr_dB ~92% of the way.
  const dt = 0.025;
  const attackMs = 10;
  const releaseMs = 80;
  const alpha = 1 - Math.exp(-dt / (attackMs / 1000));
  const threshold = 0.5;
  const ratio = 4.0;
  // Hand-compute expected after exactly ONE tick with x=1.0.
  const xDb = 20 * Math.log10(1.0 + 1e-9);
  const threshDb = 20 * Math.log10(threshold);
  const overDb = xDb - threshDb;
  const targetGrDb = -overDb * (1 - 1 / ratio);
  const expectedGrDbAfter1 = 0 + alpha * (targetGrDb - 0);
  const expectedY1 = 1.0 * Math.pow(10, expectedGrDbAfter1 / 20);
  const out = runSingleOp(
    { id: 'cmp', type: 'compressor', params: { threshold, ratio, attackMs, releaseMs } },
    [{ x: 1.0, dt }],
  );
  approxEqual(out[0], expectedY1, 1e-6,
    `attack tick 1: α=${alpha.toFixed(4)}, expected y=${expectedY1.toFixed(6)}`);
});

test('Compressor: rejects ratio < 1 (Codex P0)', () => {
  const r = validateChain('micLow', [
    { id: 'cmp', type: 'compressor', params: { threshold: 0.5, ratio: 0.5 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('Compressor: rejects non-finite attackMs (Codex P0)', () => {
  const r = validateChain('micLow', [
    { id: 'cmp', type: 'compressor',
      params: { threshold: 0.5, ratio: 4, attackMs: Number.POSITIVE_INFINITY } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /finite/);
});

// ── Biquad LPF ──────────────────────────────────────────────────────────────
// Source: design doc §Operator catalog row "Biquad LPF" — RBJ EQ
// Cookbook (W3C-Note, 2021) §LPF, Direct-Form-1.
//
// Coefficients (recomputed per sample because dt can vary):
//   ω₀ = 2π · fc · dt; α = sin(ω₀)/(2Q)
//   b0 = (1−cos ω₀)/2; b1 = 1−cos ω₀; b2 = (1−cos ω₀)/2
//   a0 = 1+α; a1 = −2 cos ω₀; a2 = 1−α
//   y[n] = (b0·x[n] + b1·x[n−1] + b2·x[n−2]
//          − a1·y[n−1] − a2·y[n−2]) / a0

test('Biquad LPF: impulse response matches closed-form Direct-Form-1 at fc=8 Hz, Q=0.707', () => {
  const fc = 8.0;
  const dt = 0.025;
  const Q = 0.707;
  // Hand-compute coefficients ONCE (dt is constant here).
  const w0 = 2 * Math.PI * fc * dt;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * Q);
  const b0 = (1 - cosW0) / 2;
  const b1 =  1 - cosW0;
  const b2 = (1 - cosW0) / 2;
  const a0 =  1 + alpha;
  const a1 = -2 * cosW0;
  const a2 =  1 - alpha;

  // Impulse: 1, 0, 0, 0, 0. Walk the DF-1 recursion by hand.
  let xP1 = 0, xP2 = 0, yP1 = 0, yP2 = 0;
  const expected = [];
  for (const x of [1, 0, 0, 0, 0]) {
    const y = (b0 * x + b1 * xP1 + b2 * xP2 - a1 * yP1 - a2 * yP2) / a0;
    expected.push(y);
    xP2 = xP1; xP1 = x; yP2 = yP1; yP1 = y;
  }
  const out = runSingleOp(
    { id: 'bq', type: 'biquad', params: { cutoffHz: fc, Q } },
    [1, 0, 0, 0, 0].map(x => ({ x, dt })),
  );
  for (let i = 0; i < expected.length; i++) {
    // The framework's final clamp01 in process() will clamp negative
    // ringing tail samples to 0 — biquad LPFs CAN ring slightly negative
    // at low Q. Assert against max(0, expected) so the hand-checked
    // values match the post-clamp output.
    const expClamped = expected[i] < 0 ? 0 : (expected[i] > 1 ? 1 : expected[i]);
    approxEqual(out[i], expClamped, 1e-9, `impulse sample[${i}]`);
  }
});

test('Biquad LPF: impulse response is stable (bounded) over many samples', () => {
  // Stability check — feed an impulse and let it ring for 500 samples.
  // A well-formed RBJ LPF should decay; assert no value blows past [-2, 2].
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'bq', type: 'biquad', params: { cutoffHz: 8.0, Q: 0.707 } }]);
  proc.setEditorSubscribed(true); // capture pre-clamp post via snapshot
  proc.process('micLow', 1.0, 0.025); // impulse
  for (let i = 0; i < 500; i++) proc.process('micLow', 0, 0.025);
  const snap = proc.snapshotForEditor('micLow');
  // Confirm runtime hasn't blown up — the recursive state words should
  // still be bounded. (We probe via snapshot.post.)
  assert.ok(Math.abs(snap.ops[0].post) < 2,
    `biquad post-value out of bounds: ${snap.ops[0].post} (impulse should have decayed)`);
});

test('Biquad LPF: rejects Q ≤ 0 (Codex P0)', () => {
  const r = validateChain('micLow', [
    { id: 'bq', type: 'biquad', params: { cutoffHz: 8.0, Q: -1 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('Biquad LPF: rejects cutoffHz ≤ 0 (Codex P0)', () => {
  const r = validateChain('micLow', [
    { id: 'bq', type: 'biquad', params: { cutoffHz: 0, Q: 0.707 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

// ── Slope ───────────────────────────────────────────────────────────────────
// Source: design doc §Operator catalog row "Slope" — TD CHOP Slope.
// y = (x − x_prev) / dt / scale. With bipolar:false (default) the
// output is clamped to [0, 1] (falling input ⇒ 0). With bipolar:true
// the output is clamped to [-1, 1]; the chain's final clamp01 will
// then clamp negatives to 0 for the CPC sink, so bipolar Slope is
// only meaningful mid-chain (where snapshotForEditor exposes the
// pre-final-clamp value via snap.ops[i].post).

test('Slope (unipolar default): rising input gives positive scaled derivative', () => {
  const dt = 0.025;
  const scale = 4.0;
  // x rises by 0.1 per tick ⇒ raw = 0.1 / 0.025 / 4 = 1.0 (saturates to 1).
  // Use a gentler ramp: 0.05 per tick ⇒ raw = 0.05/0.025/4 = 0.5.
  const out = runSingleOp(
    { id: 'sp', type: 'slope', params: { scale } },
    [
      { x: 0.05, dt }, // x_prev=0; raw = 0.05/0.025/4 = 0.5
      { x: 0.10, dt }, // raw = 0.05/0.025/4 = 0.5
      { x: 0.15, dt }, // raw = 0.5
    ],
  );
  approxEqual(out[0], 0.5, 1e-9, 'tick 0');
  approxEqual(out[1], 0.5, 1e-9, 'tick 1');
  approxEqual(out[2], 0.5, 1e-9, 'tick 2');
});

test('Slope (unipolar): falling input clamps to 0', () => {
  // Build up x_prev, then drop. Default scale=4.
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'sp', type: 'slope', params: { scale: 4.0 } }]);
  // First tick: x=0.5, x_prev=0. raw=0.5/0.025/4 = 5 ⇒ clamp to 1.
  approxEqual(proc.process('micLow', 0.5, 0.025), 1.0, 1e-9);
  // Second tick: x=0.0, x_prev=0.5. raw = -0.5/0.025/4 = -5 ⇒ unipolar clamps to 0.
  approxEqual(proc.process('micLow', 0.0, 0.025), 0, 1e-9);
});

test('Slope (bipolar:true): falling input outputs negative value mid-chain (visible via snapshot)', () => {
  // bipolar:true preserves negative output [-1, 1], but the chain's
  // final clamp01 wipes it for the return value. Use snapshotForEditor
  // to read the pre-final-clamp `post` field per the design doc note
  // ("can output negative if bipolar:true").
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'sp', type: 'slope', params: { scale: 4.0, bipolar: true } }]);
  proc.setEditorSubscribed(true);
  // Push x_prev up.
  proc.process('micLow', 0.5, 0.025);
  // Drop: x=0, x_prev=0.5 ⇒ raw = -0.5/0.025/4 = -5 ⇒ bipolar clamps to -1.
  proc.process('micLow', 0.0, 0.025);
  const snap = proc.snapshotForEditor('micLow');
  approxEqual(snap.ops[0].post, -1.0, 1e-9,
    'bipolar slope should emit −1 on a hard fall (pre-final-clamp)');
});

test('Slope: scale parameter divides the derivative — bigger scale → smaller output', () => {
  // Same input ramp, two different scales.
  const inputs = [{ x: 0.05, dt: 0.025 }, { x: 0.10, dt: 0.025 }];
  const outSmall = runSingleOp(
    { id: 'sp', type: 'slope', params: { scale: 1.0 } }, inputs);
  const outLarge = runSingleOp(
    { id: 'sp', type: 'slope', params: { scale: 10.0 } }, inputs);
  // outSmall samples saturate (raw = 0.05/0.025/1 = 2 ⇒ clamp 1).
  approxEqual(outSmall[1], 1.0, 1e-9);
  // outLarge: raw = 0.05/0.025/10 = 0.2 (well under 1).
  approxEqual(outLarge[1], 0.2, 1e-9);
});

test('Slope: rejects scale ≤ 0 (Codex P0)', () => {
  const r = validateChain('micLow', [
    { id: 'sp', type: 'slope', params: { scale: 0 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('Slope: rejects non-boolean bipolar (Codex P0 strict)', () => {
  const r = validateChain('micLow', [
    { id: 'sp', type: 'slope', params: { scale: 4.0, bipolar: 'yes' } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /boolean/);
});

test('Slope: dt floor protects against zero-dt frames (no Infinity)', () => {
  // Framework allows dt=0; the slope op floors it to 1e-6 internally so
  // raw = (0.5 − 0) / 1e-6 / 4 = 125 000 ⇒ clamps to 1 (not Infinity / NaN).
  const out = runSingleOp(
    { id: 'sp', type: 'slope', params: { scale: 4.0 } },
    [{ x: 0.5, dt: 0 }],
  );
  assert.ok(Number.isFinite(out[0]), `slope must not emit non-finite at dt=0 (got ${out[0]})`);
  approxEqual(out[0], 1.0, 1e-9);
});

// ── PATCH preserves runtime state for the new stateful ops ──────────────────
//
// docs/29 §Chain runtime state + Phase 2 fix 5642b48: PATCH must not
// reset per-op runtime so a mid-show param tweak doesn't pop. Phase 7
// adds three new stateful ops: Biquad (xPrev1/2, yPrev1/2), Slope
// (xPrev), Compressor (grDb). Slew also gets a yPrev that must
// survive PATCH so the rate-limit clock keeps ticking. Curve is
// stateless beyond yPrev (covered by the framework's existing slot).

test('patchOp preserves runtime state — Biquad (xPrev/yPrev history not reset)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'bq', type: 'biquad', params: { cutoffHz: 5.0, Q: 0.707 } }]);
  // Drive sustained input — biquad LPF should converge near 1.0.
  const before = _processN(proc, 'micLow', 1.0, 0.025, 400);
  assert.ok(before > 0.95, `biquad should be near steady-state (got ${before})`);
  // Patch Q while held high.
  const r = proc.patchOp('micLow', 'bq', { params: { Q: 1.5 } });
  assert.equal(r.ok, true);
  const after = proc.process('micLow', 1.0, 0.025);
  // If history were reset to 0, the next sample would be ≈ b0/a0 — a
  // tiny number — instead of staying near 1. Assert >0.9 to pin
  // continuity without over-constraining the new-Q response.
  assert.ok(after > 0.9,
    `Biquad runtime history must survive patchOp — expected ≈ ${before}, got ${after}`);
});

test('patchOp preserves runtime state — Slope (xPrev not reset)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'sp', type: 'slope', params: { scale: 4.0 } }]);
  // Push x_prev up to 0.5 via one tick.
  proc.process('micLow', 0.5, 0.025);
  // Patch scale (x_prev should NOT reset to 0).
  const r = proc.patchOp('micLow', 'sp', { params: { scale: 2.0 } });
  assert.equal(r.ok, true);
  // Next tick at x=0.5 (no change). If xPrev were preserved at 0.5, raw
  // = (0.5 − 0.5)/dt/scale = 0. If it had been reset to 0, raw =
  // (0.5 − 0)/0.025/2 = 10 ⇒ clamp 1. Assert it's 0 (continuity).
  const after = proc.process('micLow', 0.5, 0.025);
  approxEqual(after, 0, 1e-9,
    `Slope xPrev must survive patchOp — expected 0 (continuity), got ${after}`);
});

test('patchOp preserves runtime state — Compressor (grDb envelope not reset)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{
    id: 'cmp', type: 'compressor',
    params: { threshold: 0.5, ratio: 4.0, attackMs: 5, releaseMs: 80 },
  }]);
  // Drive sustained loud input — grDb converges to its target negative value.
  const before = _processN(proc, 'micLow', 1.0, 0.025, 400);
  assert.ok(before < 0.8, `Compressor should be reducing gain on sustained 1.0 (got ${before})`);
  // Patch attackMs.
  const r = proc.patchOp('micLow', 'cmp', { params: { attackMs: 1 } });
  assert.equal(r.ok, true);
  // Next sample at 1.0 — grDb should still be near its prior value, so
  // the output should still be near `before`. If grDb were reset to 0,
  // the output would briefly jump back near 1.0 (an audible/visible pop).
  const after = proc.process('micLow', 1.0, 0.025);
  approxEqual(after, before, 0.05,
    `Compressor grDb must survive patchOp — before=${before.toFixed(4)}, after=${after.toFixed(4)}`);
});

test('patchOp preserves runtime state — Slew (yPrev not reset)', () => {
  const proc = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc.putChain('micLow', [{ id: 'sl', type: 'slew', params: { maxStepPerSec: 4.0 } }]);
  // Climb yPrev to 0.5 over 5 ticks (step=0.1).
  for (let i = 0; i < 5; i++) proc.process('micLow', 1.0, 0.025);
  // Patch maxStepPerSec.
  const r = proc.patchOp('micLow', 'sl', { params: { maxStepPerSec: 8.0 } });
  assert.equal(r.ok, true);
  // Next tick at x=1.0; step is now 0.2. If yPrev were preserved at 0.5,
  // output = min(1.0, 0.5 + 0.2) = 0.7. If reset to 0, output = min(1.0,
  // 0 + 0.2) = 0.2. Assert preservation.
  const after = proc.process('micLow', 1.0, 0.025);
  approxEqual(after, 0.7, 1e-9,
    `Slew yPrev must survive patchOp — expected 0.7, got ${after}`);
});

// ── Persistence round-trip with a Phase 7 op ────────────────────────────────

test('Persistence round-trip: a Biquad-bearing chain survives putChain → snapshot → loadChains', () => {
  const proc1 = new SignalPostProcessor({ paramCenter: fullGainPC() });
  const customChain = [
    { id: 'bq',  type: 'biquad',     params: { cutoffHz: 12.0, Q: 1.2 } },
    { id: 'cmp', type: 'compressor', params: { threshold: 0.4, ratio: 6.0, attackMs: 3, releaseMs: 60 } },
    { id: 'cv',  type: 'curve',      params: { shape: 'exp', gamma: 2.5 } },
    { id: 'sp',  type: 'slope',      params: { scale: 8.0, bipolar: true } },
    { id: 'sl',  type: 'slew',       params: { maxStepPerSec: 2.5 } },
  ];
  const putRes = proc1.putChain('micLow', customChain);
  assert.equal(putRes.ok, true, `expected putChain ok, got error: ${putRes.error}`);
  const snapshot = proc1.getAllChains();

  // Simulate engine restart.
  const proc2 = new SignalPostProcessor({ paramCenter: fullGainPC() });
  proc2.loadChains(snapshot);
  assert.deepEqual(proc2.getAllChains(), snapshot,
    'Phase 7 ops must round-trip through YAML snapshot/loadChains');
});

// ── Default chains: unchanged after Phase 7 (no new default-installed ops) ──

test('Phase 7 contract: NO new ops added to DEFAULT_CHAINS (7 existing chains unchanged)', () => {
  // The 7 default chains stay as they were after Phase 2. The new ops
  // are available via the catalog for operators to add manually.
  const phase7Types = new Set(['curve', 'slew', 'compressor', 'biquad', 'slope']);
  for (const sig of KNOWN_SIGNALS) {
    const types = DEFAULT_CHAINS[sig].map(op => op.type);
    for (const t of types) {
      assert.ok(!phase7Types.has(t),
        `default chain for ${sig} must not include Phase 7 op "${t}"`);
    }
  }
});
