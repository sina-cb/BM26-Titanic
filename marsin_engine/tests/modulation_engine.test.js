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

test('offset + bipolar: source 0.5 → no movement', () => {
  const base = 0.6;
  const out = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0.5, mode: 'offset', polarity: 'bipolar',
    range: [-0.25, 0.25], curve: 'linear',
  });
  approx(out, base);
});

test('offset + bipolar: source 0 and 1 move symmetrically', () => {
  const base = 0.5;
  const down = applyContinuousModulation({
    baseNorm: base, sourceNorm: 0, mode: 'offset', polarity: 'bipolar',
    range: [-0.2, 0.2], curve: 'linear',
  });
  const up = applyContinuousModulation({
    baseNorm: base, sourceNorm: 1, mode: 'offset', polarity: 'bipolar',
    range: [-0.2, 0.2], curve: 'linear',
  });
  approx(down, 0.3);
  approx(up, 0.7);
});

test('scale mode: base 0 stays 0 (closed-gate semantics)', () => {
  const out = applyContinuousModulation({
    baseNorm: 0, sourceNorm: 1, mode: 'scale', polarity: 'unipolar',
    range: [0, 1], curve: 'linear',
  });
  approx(out, 0);
});

test('scale mode: base 0.5 with +1 delta clamps to 1', () => {
  const out = applyContinuousModulation({
    baseNorm: 0.5, sourceNorm: 1, mode: 'scale', polarity: 'unipolar',
    range: [0, 2], curve: 'linear',
  });
  approx(out, 1);
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

test('resolveModulationSources: missing keys default to 0', () => {
  const out = resolveModulationSources({ paramCenterSnapshot: { micLow: 0.7 } });
  approx(out.micLow, 0.7);
  approx(out.micMid, 0);
  approx(out.micHigh, 0);
  approx(out.micKick, 0);
});

test('resolveModulationSources: handles null snapshot', () => {
  const out = resolveModulationSources({ paramCenterSnapshot: null });
  approx(out.micLow, 0);
  approx(out.micKick, 0);
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
  assert.throws(() => validateModulationMapping({ ...base, source: { scope: 'cpc', key: 'tempoBpm' } }), /source\.key/);
  assert.throws(() => validateModulationMapping({ ...base, target: { scope: 'global', parameter: 'size' } }), /target\.scope/);
  assert.throws(() => validateModulationMapping({ ...base, target: { scope: 'pattern', parameter: '' } }), /target\.parameter/);
  assert.throws(() => validateModulationMapping({ ...base, mode: 'add' }), /mode must be 'offset' or 'scale'/);
  assert.throws(() => validateModulationMapping({ ...base, polarity: 'tri' }), /polarity/);
  assert.throws(() => validateModulationMapping({ ...base, curve: 'log' }), /curve/);
  assert.throws(() => validateModulationMapping({ ...base, range: [0] }), /range must be \[min, max\]/);
  assert.throws(() => validateModulationMapping({ ...base, range: [0, 2] }), /range values must be within/);
});
