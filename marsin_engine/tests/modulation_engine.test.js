// Unit tests for ModulationEngine.
// Run: node --test tests/modulation_engine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyContinuousModulation,
  applyCurve,
  resolveModulationSources,
  applyModulations,
  validateModulationMapping,
} from '../lib/modulation_engine.js';

function approx(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
}

test('applyCurve: linear is identity', () => {
  for (const v of [0, 0.25, 0.5, 0.75, 1]) approx(applyCurve(v, 'linear'), v);
});

test('applyCurve: easeIn / easeOut endpoints', () => {
  approx(applyCurve(0, 'easeIn'), 0);
  approx(applyCurve(1, 'easeIn'), 1);
  approx(applyCurve(0, 'easeOut'), 0);
  approx(applyCurve(1, 'easeOut'), 1);
  // easeIn(0.5) = 0.25, easeOut(0.5) = 0.75
  approx(applyCurve(0.5, 'easeIn'), 0.25);
  approx(applyCurve(0.5, 'easeOut'), 0.75);
});

test('offset + unipolar: source 0 → min, source 1 → max', () => {
  const base = 0.4;
  const v0 = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0, mode: 'offset', polarity: 'unipolar',
    range: [0.0, 0.35], curve: 'linear',
  });
  const v1 = applyContinuousModulation({
    baseNorm: base, sourceNorm: 1, mode: 'offset', polarity: 'unipolar',
    range: [0.0, 0.35], curve: 'linear',
  });
  approx(v0, base + 0.0);
  approx(v1, base + 0.35);
});

test('offset + bipolar: signal centre (0.5) = no movement (linear)', () => {
  const base = 0.6;
  const out = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0.5, mode: 'offset', polarity: 'bipolar',
    range: [-0.25, 0.25], curve: 'linear',
  });
  approx(out, base);
});

test('offset + bipolar: spans [static+min, static+max] (linear)', () => {
  const base = 0.5;
  const down = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0, mode: 'offset', polarity: 'bipolar',
    range: [-0.2, 0.2], curve: 'linear',
  });
  const up = applyContinuousModulation({
    baseNorm: base, sourceNorm: 1, mode: 'offset', polarity: 'bipolar',
    range: [-0.2, 0.2], curve: 'linear',
  });
  approx(down, 0.3);   // static + min
  approx(up, 0.7);     // static + max
});

test('offset + bipolar is SYMMETRIC: swing = max(|min|,|max|) around static', () => {
  const base = 0.5;
  // Asymmetric range [-0.3, 0.1] ⇒ mag = max(0.3,0.1) = 0.3, symmetric ±0.3.
  const up = applyContinuousModulation({
    baseNorm: base, sourceNorm: 1, mode: 'offset', polarity: 'bipolar',
    range: [-0.3, 0.1], curve: 'linear',
  });
  const mid = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0.5, mode: 'offset', polarity: 'bipolar',
    range: [-0.3, 0.1], curve: 'linear',
  });
  const down = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0, mode: 'offset', polarity: 'bipolar',
    range: [-0.3, 0.1], curve: 'linear',
  });
  approx(up, 0.8);    // static + mag
  approx(mid, 0.5);   // static (0.5 = neutral under linear)
  approx(down, 0.2);  // static - mag (symmetric, not the asymmetric +0.1/-0.3)
});

test('CURVE is applied to the SIGNAL: easeIn moves less at mid-signal (offset/unipolar)', () => {
  const base = 0.4;
  // linear: sc=0.5 → scaled = 0.5*0.4 = 0.2 → 0.6.
  const lin = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0.5, mode: 'offset', polarity: 'unipolar',
    range: [0, 0.4], curve: 'linear',
  });
  approx(lin, 0.6);
  // easeIn(0.5) = 0.25 → scaled = 0.25*0.4 = 0.1 → 0.5 (less than linear).
  const ease = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0.5, mode: 'offset', polarity: 'unipolar',
    range: [0, 0.4], curve: 'easeIn',
  });
  approx(ease, 0.5);
  assert.ok(ease < lin, 'easeIn shapes the signal down at mid');
  // Endpoints are unchanged by any curve (curve(0)=0, curve(1)=1).
  approx(applyContinuousModulation({ baseNorm: base, sourceNorm: 1, mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'easeIn' }), 0.8);
});

test('multiply mode: scaled signal is a MULTIPLIER over the static value', () => {
  // base 0.5, signal 1, range [1.0, 1.2] → multiplier 1.2 → 0.6.
  approx(applyContinuousModulation({
    baseNorm: 0.5, sourceNorm: 1, mode: 'multiply', polarity: 'unipolar',
    range: [1.0, 1.2], curve: 'linear',
  }), 0.6);
  // signal 0 → multiplier 1.0 → no change.
  approx(applyContinuousModulation({
    baseNorm: 0.5, sourceNorm: 0, mode: 'multiply', polarity: 'unipolar',
    range: [1.0, 1.2], curve: 'linear',
  }), 0.5);
  // base 0 stays 0 (0 × anything = 0).
  approx(applyContinuousModulation({
    baseNorm: 0, sourceNorm: 1, mode: 'multiply', polarity: 'unipolar',
    range: [1.0, 1.2], curve: 'linear',
  }), 0);
  // clamps: 0.9 × 1.2 = 1.08 → 1.
  approx(applyContinuousModulation({
    baseNorm: 0.9, sourceNorm: 1, mode: 'multiply', polarity: 'unipolar',
    range: [1.0, 1.2], curve: 'linear',
  }), 1);
});

test("'scale' is accepted as a legacy alias for multiply (validation migrates it)", () => {
  const ok = validateModulationMapping({
    id: 'm', type: 'continuous', enabled: true,
    source: { scope: 'cpc', key: 'micLow' },
    target: { scope: 'pattern', parameter: 'p' },
    mode: 'scale', polarity: 'unipolar', range: [1.0, 1.2], curve: 'linear',
  });
  assert.equal(ok.mode, 'multiply');
});

test('override mode: param is driven DIRECTLY by the scaled signal, ignoring static', () => {
  // base ignored entirely. signal 1, range [0,1] → 1. signal 0 → 0.
  approx(applyContinuousModulation({
    baseNorm: 0.9, sourceNorm: 1, mode: 'override', polarity: 'unipolar',
    range: [0, 1], curve: 'linear',
  }), 1);
  approx(applyContinuousModulation({
    baseNorm: 0.9, sourceNorm: 0, mode: 'override', polarity: 'unipolar',
    range: [0, 1], curve: 'linear',
  }), 0);
  // a sub-range maps the signal into [0.2, 0.8] regardless of base.
  approx(applyContinuousModulation({
    baseNorm: 0.05, sourceNorm: 0.5, mode: 'override', polarity: 'unipolar',
    range: [0.2, 0.8], curve: 'linear',
  }), 0.5);
});

test('clamps output to [0, 1]', () => {
  const high = applyContinuousModulation({
    baseNorm: 0.9, sourceNorm: 1, mode: 'offset', polarity: 'unipolar',
    range: [0, 1], curve: 'linear',
  });
  approx(high, 1);
  const low = applyContinuousModulation({
    baseNorm: 0.1, sourceNorm: 0, mode: 'offset', polarity: 'unipolar',
    range: [-1, 0], curve: 'linear',
  });
  approx(low, 0);
});

test('resolveModulationSources: passes the whole snapshot through (no allow-list)', () => {
  // ANY finite numeric key the pipeline feeds in is a usable source — mic
  // bands, dom energy, detectors, an arbitrary Companion key. No seeding,
  // no allow-list.
  const out = resolveModulationSources({
    paramCenterSnapshot: { micDomEnergy1: 0.6, micFlux: 0.3, audioParty: 0.9, crowd_roar_xyz: 0.4 },
  });
  approx(out.micDomEnergy1, 0.6);
  approx(out.micFlux, 0.3);
  approx(out.audioParty, 0.9);
  approx(out.crowd_roar_xyz, 0.4);
});

test('resolveModulationSources: normalizes builtin wide-range keys (Hz/bpm) into [0,1]', () => {
  // A raw Hz dom-freq / a bpm would otherwise pin the modulation at 1.0. They
  // get normalized by their curated descriptor range; [0,1] keys are identity;
  // dynamic/unknown keys pass through raw (source-normalized in the Companion).
  const out = resolveModulationSources({
    paramCenterSnapshot: {
      micDomFreq1: 11025,   // half of [0, 22050]
      micDomFreq2: 22050,   // top of range
      audioBpm: 150,        // half of [0, 300]
      tempoBpm: 75,         // quarter of [0, 300]
      micLow: 0.4,          // [0,1] -> identity
      crowd_xyz: 0.7,       // dynamic/unknown -> raw passthrough
    },
  });
  approx(out.micDomFreq1, 0.5);
  approx(out.micDomFreq2, 1.0);
  approx(out.audioBpm, 0.5);
  approx(out.tempoBpm, 0.25);
  approx(out.micLow, 0.4);
  approx(out.crowd_xyz, 0.7);
});

test('resolveModulationSources: absent keys are simply not present (apply no-ops them)', () => {
  const out = resolveModulationSources({ paramCenterSnapshot: { micLow: 0.7 } });
  approx(out.micLow, 0.7);
  // A key the pipeline didn't feed this frame is absent (undefined), NOT 0 —
  // applyModulations skips an absent source so the mapping is a no-op.
  assert.equal(out.micMid, undefined);
  assert.equal(out.micDomEnergy1, undefined);
});

test('resolveModulationSources: non-finite values are dropped', () => {
  const out = resolveModulationSources({ paramCenterSnapshot: { a: NaN, b: Infinity, c: 0.5, d: 'x' } });
  assert.equal(out.a, undefined);
  assert.equal(out.b, undefined);
  assert.equal(out.d, undefined);
  approx(out.c, 0.5);
});

test('resolveModulationSources: handles null snapshot', () => {
  const out = resolveModulationSources({ paramCenterSnapshot: null });
  assert.deepEqual(out, {});
});

test('applyModulations: disabled mapping is bypassed', () => {
  const result = applyModulations({
    baseParams: { noiseScale: 0.3 },
    targetDefs: [{ name: 'noiseScale' }],
    modulations: [{
      id: 'm1', type: 'continuous', enabled: false,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.5], curve: 'linear',
    }],
    sourceValues: { micLow: 1 },
  });
  approx(result.values.noiseScale.base, 0.3);
  approx(result.values.noiseScale.modulated, 0.3);
  assert.equal(result.values.noiseScale.mappingId, undefined);
});

test('applyModulations: applies single enabled mapping', () => {
  const result = applyModulations({
    baseParams: { noiseScale: 0.3 },
    targetDefs: [{ name: 'noiseScale' }],
    modulations: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
    sourceValues: { micLow: 0.5 },
  });
  approx(result.values.noiseScale.base, 0.3);
  approx(result.values.noiseScale.modulated, 0.5);
  assert.equal(result.values.noiseScale.source, 'micLow');
  assert.equal(result.values.noiseScale.mappingId, 'm1');
});

test('applyModulations: unknown target is skipped without crashing', () => {
  const result = applyModulations({
    baseParams: { knownParam: 0.5 },
    targetDefs: [{ name: 'knownParam' }],
    modulations: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'unknownParam' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
    sourceValues: { micLow: 1 },
  });
  approx(result.values.knownParam.base, 0.5);
  approx(result.values.knownParam.modulated, 0.5);
  assert.equal(result.values.unknownParam, undefined);
});

test('applyModulations: duplicate target — first wins', () => {
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const result = applyModulations({
      baseParams: { noiseScale: 0.5 },
      targetDefs: [{ name: 'noiseScale' }],
      modulations: [
        {
          id: 'first', type: 'continuous', enabled: true,
          source: { scope: 'cpc', key: 'micLow' },
          target: { scope: 'pattern', parameter: 'noiseScale' },
          mode: 'offset', polarity: 'unipolar', range: [0, 0.2], curve: 'linear',
        },
        {
          id: 'second', type: 'continuous', enabled: true,
          source: { scope: 'cpc', key: 'micKick' },
          target: { scope: 'pattern', parameter: 'noiseScale' },
          mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
        },
      ],
      sourceValues: { micLow: 1, micKick: 1 },
    });
    approx(result.values.noiseScale.modulated, 0.7);
    assert.equal(result.values.noiseScale.mappingId, 'first');
    assert.ok(warned, 'expected a duplicate-target warning');
  } finally {
    console.warn = origWarn;
  }
});

test('validateModulationMapping: accepts a well-formed mapping', () => {
  const good = {
    id: 'mod_noiseScale_micLow',
    type: 'continuous',
    enabled: true,
    source: { scope: 'cpc', key: 'micLow' },
    target: { scope: 'pattern', parameter: 'noiseScale' },
    mode: 'offset',
    polarity: 'unipolar',
    range: [0, 0.35],
    curve: 'linear',
  };
  const out = validateModulationMapping(good);
  assert.equal(out.id, 'mod_noiseScale_micLow');
});

test('validateModulationMapping: rejects bad fields with specific messages', () => {
  const base = {
    id: 'm', type: 'continuous', enabled: true,
    source: { scope: 'cpc', key: 'micLow' },
    target: { scope: 'pattern', parameter: 'noiseScale' },
    mode: 'offset', polarity: 'unipolar', range: [0, 0.35], curve: 'linear',
  };
  assert.throws(() => validateModulationMapping(null), /must be an object/);
  assert.throws(() => validateModulationMapping({ ...base, id: '' }), /id must be a non-empty string/);
  assert.throws(() => validateModulationMapping({ ...base, type: 'trigger' }), /type must be 'continuous'/);
  assert.throws(() => validateModulationMapping({ ...base, enabled: 'yes' }), /enabled must be boolean/);
  assert.throws(() => validateModulationMapping({ ...base, source: { scope: 'lfo', key: 'micLow' } }), /source\.scope/);
  // Sources are NOT allow-listed — ANY non-empty CPC key is valid (all
  // incoming signals are assignable: mic bands, dom energy, detectors, an
  // arbitrary Companion key, even keys like tempoBpm). An absent key just
  // no-ops at apply time.
  for (const k of ['micLow', 'micFlux', 'micDomEnergy1', 'micDomFreq1', 'tempoBpm', 'audioParty', 'crowd_roar_xyz']) {
    const ok = validateModulationMapping({ ...base, source: { scope: 'cpc', key: k } });
    assert.equal(ok.source.key, k);
  }
  // An empty/non-string source key is still rejected.
  assert.throws(() => validateModulationMapping({ ...base, source: { scope: 'cpc', key: '' } }), /source\.key/);
  assert.throws(() => validateModulationMapping({ ...base, target: { scope: 'global', parameter: 'size' } }), /target\.scope/);
  assert.throws(() => validateModulationMapping({ ...base, target: { scope: 'pattern', parameter: '' } }), /target\.parameter/);
  assert.throws(() => validateModulationMapping({ ...base, mode: 'add' }), /mode must be 'offset', 'multiply', or 'override'/);
  assert.throws(() => validateModulationMapping({ ...base, polarity: 'tri' }), /polarity/);
  assert.throws(() => validateModulationMapping({ ...base, curve: 'log' }), /curve/);
  assert.throws(() => validateModulationMapping({ ...base, range: [0] }), /range must be \[min, max\]/);
  // Multiplier ranges > 1 are allowed now (e.g. [1.0, 1.2]); only beyond ±4 is rejected.
  assert.deepEqual(validateModulationMapping({ ...base, range: [1.0, 1.2] }).range, [1.0, 1.2]);
  assert.throws(() => validateModulationMapping({ ...base, range: [0, 5] }), /range values must be within/);
});
