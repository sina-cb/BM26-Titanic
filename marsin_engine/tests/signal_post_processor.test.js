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

test('Codex P0: Gain with paramKey propagates missing CPC key error', () => {
  const pc = makeParamCenter({}); // no gain key
  const proc = new SignalPostProcessor({ paramCenter: pc });
  // putChain itself succeeds (paramKey existence is not validated —
  // CPC keys can be added by registry overrides), but the first
  // process() call will throw via pc.get().
  proc.putChain('micLow', [{ id: 'g', type: 'gain', params: { paramKey: 'micLowGain' } }]);
  assert.throws(
    () => proc.process('micLow', 0.5, 0.025),
    /unknown key micLowGain/,
  );
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

test('opCatalog lists the 7 Phase-2 op types', () => {
  const cat = opCatalog();
  const types = Object.keys(cat).sort();
  assert.deepEqual(types, ['bias', 'clamp', 'envelope', 'gain', 'hold', 'lpf', 'schmitt']);
  assert.equal(cat.gain.paramKeyOrValue, true);
  assert.equal(cat.bias.paramKeyOrValue, false);
});

// ── Constructor guards ──────────────────────────────────────────────────────

test('SignalPostProcessor requires a paramCenter with .get()', () => {
  assert.throws(() => new SignalPostProcessor({}), /paramCenter/);
  assert.throws(() => new SignalPostProcessor({ paramCenter: {} }), /paramCenter/);
});
