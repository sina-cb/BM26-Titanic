// Unit tests for ModulationController.
// Run: node --test tests/modulation_controller.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ModulationController } from '../lib/modulation_controller.js';

function makeFakeMixer({ exports, baseValues = {} } = {}) {
  const writes = [];
  const wasmHost = {
    getExports: () => exports,
    setControl: (handle, id, v0, v1, v2) => writes.push({ handle, id, v0, v1, v2 }),
  };
  const localControls = {};
  for (const exp of exports) {
    if (baseValues[exp.name] !== undefined) {
      localControls[exp.id] = { v0: baseValues[exp.name], v1: 0, v2: 0 };
    }
  }
  const deckCh = { id: 'deck', handle: 7, pattern: 'p_test', localControls };
  return {
    getDeckChannel: () => deckCh,
    wasmHost,
    _writes: writes,
    _deckCh: deckCh,
  };
}

function makeFakePc(snapshot) {
  return { getAll: () => snapshot };
}

const SLIDER = 1;

test('applyFrame writes modulated value to wasmHost for mapped target', () => {
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.3 }],
    baseValues: { noiseScale: 0.3 },
  });
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ micLow: 0.5 }),
    broadcast: (m) => broadcasts.push(m),
  });
  ctrl.setActiveEntry({
    playlistName: 'default',
    entryId: 'e1',
    pattern: 'p_test',
    mappings: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
  });
  ctrl.applyFrame(1000);
  assert.equal(mixer._writes.length, 1);
  assert.equal(mixer._writes[0].id, 101);
  assert.ok(Math.abs(mixer._writes[0].v0 - 0.5) < 1e-9);
});

test('applyFrame broadcasts modulationState at throttled rate', () => {
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.3 }],
    baseValues: { noiseScale: 0.3 },
  });
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ micLow: 1 }),
    broadcast: (m) => broadcasts.push(m),
    broadcastHz: 20,
  });
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test',
    mappings: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
  });
  ctrl.applyFrame(0);
  ctrl.applyFrame(10);   // < 50ms → no second broadcast
  ctrl.applyFrame(60);   // > 50ms → broadcast
  assert.equal(broadcasts.length, 2);
  const msg = broadcasts[0];
  assert.equal(msg.type, 'modulationState');
  assert.equal(msg.deckId, 'main');
  assert.equal(msg.pattern, 'p_test');
  assert.ok(msg.parameters.noiseScale);
  assert.equal(msg.parameters.noiseScale.source, 'micLow');
  assert.equal(msg.parameters.noiseScale.mappingId, 'm1');
});

test('removing a mapping restores base on next frame (one-shot)', () => {
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.3 }],
    baseValues: { noiseScale: 0.3 },
  });
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ micLow: 1 }),
    broadcast: () => {},
  });
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test',
    mappings: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
  });
  ctrl.applyFrame(0);
  assert.equal(mixer._writes.length, 1);
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test', mappings: [],
  });
  ctrl.applyFrame(100);
  assert.equal(mixer._writes.length, 2, 'expected one-shot base restore');
  assert.equal(mixer._writes[1].id, 101);
  assert.equal(mixer._writes[1].v0, 0.3);
  // No further writes after restore
  ctrl.applyFrame(200);
  assert.equal(mixer._writes.length, 2);
});

test('skips frame entirely when deck channel is absent', () => {
  const mixer = {
    getDeckChannel: () => null,
    wasmHost: { getExports: () => [], setControl: () => {} },
  };
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({}),
    broadcast: (m) => broadcasts.push(m),
  });
  ctrl.setActiveEntry({
    playlistName: 'x', entryId: 'y', pattern: 'p',
    mappings: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 1], curve: 'linear',
    }],
  });
  ctrl.applyFrame(0);
  assert.equal(broadcasts.length, 0);
});

test('does not broadcast when there are no active mappings', () => {
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.3 }],
  });
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ micLow: 1 }),
    broadcast: (m) => broadcasts.push(m),
  });
  ctrl.applyFrame(0);
  ctrl.applyFrame(100);
  assert.equal(broadcasts.length, 0);
  assert.equal(mixer._writes.length, 0);
});

test('emits ONE final empty frame on >0 → 0 mapping transition (ghost clear)', () => {
  // Operator-reported regression: after tapping ✕ to remove a
  // mapping, the iPad's green slider-ghost overlay never cleared
  // because the throttled broadcast skipped emit when there were no
  // mappings. The fix: emit ONE empty-parameters frame on the
  // >0 → 0 transition so the client adopts an empty state.
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.3 }],
    baseValues: { noiseScale: 0.3 },
  });
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ micLow: 1 }),
    broadcast: (m) => broadcasts.push(m),
    broadcastHz: 20,
  });
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test',
    mappings: [{
      id: 'm1', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'micLow' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
  });
  ctrl.applyFrame(0);
  assert.equal(broadcasts.length, 1, 'first frame with mapping → 1 broadcast');
  assert.ok(broadcasts[0].parameters.noiseScale, 'first broadcast carries the mapping');

  // Operator deletes the mapping.
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test', mappings: [],
  });
  ctrl.applyFrame(100);
  assert.equal(broadcasts.length, 2, 'transition >0 → 0 fires the clearing frame');
  assert.deepEqual(broadcasts[1].parameters, {}, 'clearing frame has empty parameters');

  // Subsequent zero-mapping frames must NOT keep emitting.
  ctrl.applyFrame(200);
  ctrl.applyFrame(300);
  assert.equal(broadcasts.length, 2, 'steady-state empty does not keep emitting');
});

test('OSC stem sources fire modulation just like mic bands', () => {
  // The popover lets the operator pick stemsBass/Drums/Vocals as the
  // mod source — verify the controller actually consumes them from
  // the CPC snapshot (where the OscListener writes them).
  const mixer = makeFakeMixer({
    exports: [{ id: 101, name: 'noiseScale', kind: SLIDER, v0: 0.2 }],
    baseValues: { noiseScale: 0.2 },
  });
  const broadcasts = [];
  const ctrl = new ModulationController({
    mixer,
    paramCenter: makeFakePc({ stemsBass: 0.75 }),
    broadcast: (m) => broadcasts.push(m),
  });
  ctrl.setActiveEntry({
    playlistName: 'default', entryId: 'e1', pattern: 'p_test',
    mappings: [{
      id: 'm_stem', type: 'continuous', enabled: true,
      source: { scope: 'cpc', key: 'stemsBass' },
      target: { scope: 'pattern', parameter: 'noiseScale' },
      mode: 'offset', polarity: 'unipolar', range: [0, 0.4], curve: 'linear',
    }],
  });
  ctrl.applyFrame(0);
  // 0.2 base + 0.75 * 0.4 = 0.5
  assert.equal(mixer._writes.length, 1);
  assert.ok(Math.abs(mixer._writes[0].v0 - 0.5) < 1e-9, `expected 0.5, got ${mixer._writes[0].v0}`);
  assert.equal(broadcasts[0].parameters.noiseScale.source, 'stemsBass');
});
