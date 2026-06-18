// Unit tests for ParamCenter — schema defaults, setHsvField, setMany,
// onChange fan-out, hasPersistentDirty. See docs/24_osc_integration.md
// §7 and .agent/02_reports/202605/20260524_1_osc_impl.md Phase 1.
//
// Run:  cd marsin_engine && node --test tests/param_center.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ParamCenter } from '../lib/param_center.js';

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paramcenter_test_'));
  return path.join(dir, 'state.yaml');
}

// ── Schema defaults ────────────────────────────────────────────────────────

test('getSchema includes live / broadcastHz / persist / portWatch with sensible defaults', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  const bySpeed = schema.find(e => e.key === 'speed');
  assert.ok(bySpeed, 'speed entry exists');
  assert.equal(bySpeed.live, false, 'speed.live defaults false');
  assert.equal(bySpeed.broadcastHz, 30, 'speed.broadcastHz defaults 30');
  assert.equal(bySpeed.persist, true, 'speed.persist preserved');
  assert.equal(bySpeed.portWatch, true, 'speed.portWatch defaults true');
});

// (stems removed 2026-06-17 — the old "stemsVocals is registered…" test is
// gone; the mic bands cover the live-OSC-param policy below.)

test('the stems family is REMOVED from the schema (operator brief 2026-06-17)', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  for (const key of ['stemsBass', 'stemsDrums', 'stemsVocals',
    'stemsBassGain', 'stemsDrumsGain', 'stemsVocalsGain',
    'stemsBassRaw', 'stemsDrumsRaw', 'stemsVocalsRaw']) {
    assert.equal(schema.find(s => s.key === key), undefined, `${key} must not be registered`);
  }
});

test('audioReactivity is REMOVED from the schema (operator review 2026-05-26)', () => {
  // Master reactivity scale was retired; per-stem gains in the Audio
  // Analysis tab are now the only level controls on the audio path.
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  const e = schema.find(s => s.key === 'audioReactivity');
  assert.equal(e, undefined, 'audioReactivity must not be registered');
});

test('tempoBpm is a live OSC-driven param', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  const bpm = schema.find(s => s.key === 'tempoBpm');
  assert.ok(bpm);
  assert.equal(bpm.live, true);
  assert.equal(bpm.persist, false);
  assert.equal(bpm.broadcastHz, 5, 'bpm broadcasts at a slow scalar rate');
  assert.deepEqual(bpm.range, [0, 300]);
  assert.equal(bpm.oscAddress, '/lx/tempo/bpm', 'non-canonical LX address');
});

test('mic band live params (micLow/Mid/High/Kick) follow the live-param policy', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  for (const key of ['micLow', 'micMid', 'micHigh']) {
    const e = schema.find(s => s.key === key);
    assert.ok(e, `${key} present`);
    assert.equal(e.live, true);
    assert.equal(e.persist, false);
    assert.equal(e.portWatch, false);
    assert.equal(e.broadcastHz, 15);
    assert.deepEqual(e.range, [0, 1]);
  }
  const kick = schema.find(s => s.key === 'micKick');
  assert.equal(kick.broadcastHz, 30, 'kick broadcasts faster for crisp pulses');
});

test('mic per-band gains are persistent operator knobs with [0,2] range', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  for (const key of ['micLowGain', 'micMidGain', 'micHighGain', 'micKickGain']) {
    const e = schema.find(s => s.key === key);
    assert.ok(e, `${key} present`);
    assert.equal(e.persist, true);
    assert.deepEqual(e.range, [0, 2]);
    assert.equal(e.default, 1.0);
  }
});

test('bpmSpeedSync snaps to {0, 1} and persists; min/max are ints in [60,180]', () => {
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  const sync = schema.find(s => s.key === 'bpmSpeedSync');
  assert.equal(sync.persist, true);
  assert.deepEqual(sync.options, [0, 1]);
  // Any continuous write snaps to nearest option.
  pc.set('bpmSpeedSync', 0.7, 'api');
  assert.equal(pc.getAll().bpmSpeedSync, 1);
  pc.set('bpmSpeedSync', 0.3, 'api');
  assert.equal(pc.getAll().bpmSpeedSync, 0);
  const bMin = schema.find(s => s.key === 'bpmSpeedMin');
  const bMax = schema.find(s => s.key === 'bpmSpeedMax');
  assert.equal(bMin.type, 'int');
  // BPM-sync range tightened to [60, 180] on 2026-05-25 per operator
  // brief: musically useful EDM bounds, no values outside this allowed.
  assert.deepEqual(bMin.range, [60, 180]);
  assert.deepEqual(bMax.range, [60, 180]);
  assert.equal(bMin.default, 60);
  assert.equal(bMax.default, 160);
});

// ── Multi-subscriber API ──────────────────────────────────────────────────

test('subscribe() fires for each mutation with the same shape as onChange', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  const unsub = pc.subscribe(ev => events.push(ev));
  pc.set('speed', 0.3, 'api');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedKeys, ['speed']);
  assert.equal(events[0].state.params.speed.value, 0.3);
  unsub();
  pc.set('speed', 0.7, 'api');
  assert.equal(events.length, 1, 'no fires after unsubscribe');
});

test('multiple subscribers all fire alongside legacy onChange', () => {
  const pc = new ParamCenter(tmpStatePath());
  const log = [];
  pc.subscribe(() => log.push('s1'));
  pc.subscribe(() => log.push('s2'));
  pc.onChange = () => log.push('legacy');
  pc.set('speed', 0.3, 'api');
  assert.deepEqual(log, ['s1', 's2', 'legacy']);
});

test('a throwing subscriber does not break other subscribers or onChange', () => {
  const pc = new ParamCenter(tmpStatePath());
  const log = [];
  pc.subscribe(() => { throw new Error('boom'); });
  pc.subscribe(() => log.push('s2'));
  pc.onChange = () => log.push('legacy');
  // Squash the console.warn the impl emits so the test output stays clean.
  const origWarn = console.warn;
  console.warn = () => {};
  try { pc.set('speed', 0.3, 'api'); }
  finally { console.warn = origWarn; }
  assert.deepEqual(log, ['s2', 'legacy']);
});

test('subscribe throws on non-function input', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.throws(() => pc.subscribe('not a fn'), TypeError);
});

test('per-band mic gains are persistent operator knobs with range [0,2] by default', () => {
  // (stems gains removed 2026-06-17 — mic gains are now the only audio gains.)
  const pc = new ParamCenter(tmpStatePath());
  const schema = pc.getSchema();
  for (const key of ['micLowGain', 'micMidGain', 'micHighGain', 'micKickGain', 'micFluxGain']) {
    const e = schema.find(s => s.key === key);
    assert.ok(e, `${key} present in schema`);
    assert.equal(e.persist, true, `${key} persists with scene/model params`);
    assert.equal(e.live, false);
    assert.deepEqual(e.range, [0, 2]);
    assert.equal(e.default, 1.0);
  }
});

test('registryOverrides reshapes a mic gain range and re-clamps default', () => {
  // Simulate engine.js with osc.gainMax: 4 → range becomes [0, 4].
  const pcWide = new ParamCenter(tmpStatePath(), {
    registryOverrides: {
      micLowGain: { range: [0, 4], default: 1.0 },
    },
  });
  const wide = pcWide.getSchema().find(s => s.key === 'micLowGain');
  assert.deepEqual(wide.range, [0, 4]);
  assert.equal(wide.default, 1.0);
  // Tight cap: osc.gainMax: 0.5 → default re-clamped to 0.5 (not 1.0).
  const pcTight = new ParamCenter(tmpStatePath(), {
    registryOverrides: {
      micLowGain: { range: [0, 0.5], default: 1.0 },
    },
  });
  const tight = pcTight.getSchema().find(s => s.key === 'micLowGain');
  assert.deepEqual(tight.range, [0, 0.5]);
  assert.equal(tight.default, 0.5, 'default re-clamped into the new range');
  // Override for an unknown key is a silent no-op.
  assert.doesNotThrow(() => new ParamCenter(tmpStatePath(), {
    registryOverrides: { totallyUnknown: { range: [0, 5] } },
  }));
});

// ── onChange behaviour ─────────────────────────────────────────────────────

test('set() fires onChange with single-key changedKeys', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  pc.set('speed', 0.42, 'api');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedKeys, ['speed']);
  assert.equal(events[0].state.params.speed.value, 0.42);
  assert.equal(events[0].state.params.speed.lastSource, 'api');
});

test('setHsvField() fires onChange via delegated set()', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  pc.setHsvField('colorPalette1', 'h', 0.75, 'osc', 'osc:test');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedKeys, ['colorPalette1']);
  assert.equal(events[0].state.params.colorPalette1.value.h, 0.75);
  assert.equal(events[0].state.params.colorPalette1.value.s, 1);
  assert.equal(events[0].state.params.colorPalette1.value.v, 1);
  assert.equal(events[0].state.params.colorPalette1.lastSource, 'osc');
  assert.equal(events[0].state.params.colorPalette1.lastOrigin, 'osc:test');
});

test('set() does NOT fire onChange on source-lock rejection', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.setSourceLock({ mode: 'global', source: 'ipad' });
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  const res = pc.set('speed', 0.5, 'osc');
  assert.equal(res.status, 'ignored');
  assert.equal(events.length, 0);
});

test('setHsvField rejects non-hsv key', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  const res = pc.setHsvField('speed', 'h', 0.5, 'osc');
  assert.equal(res.status, 'ignored');
  assert.equal(res.reason, 'not_hsv');
  assert.equal(events.length, 0);
});

test('setHsvField rejects bad field', () => {
  const pc = new ParamCenter(tmpStatePath());
  const res = pc.setHsvField('colorPalette1', 'x', 0.5, 'osc');
  assert.equal(res.status, 'ignored');
  assert.equal(res.reason, 'bad_field');
});

// ── setMany batching ───────────────────────────────────────────────────────

test('setMany applies multiple writes and fires onChange ONCE with all changedKeys', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  const res = pc.setMany([
    { kind: 'scalar', key: 'speed',  value: 0.3 },
    { kind: 'scalar', key: 'rotate', value: 0.7 },
    { kind: 'hsv',    key: 'colorPalette1', field: 'v', value: 0.5 },
  ], 'osc', 'osc:test');
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.changedKeys.sort(), ['colorPalette1', 'rotate', 'speed']);
  assert.equal(events.length, 1, 'exactly one onChange fire for the whole batch');
  assert.deepEqual(events[0].changedKeys.sort(), ['colorPalette1', 'rotate', 'speed']);
  assert.equal(events[0].state.params.speed.value, 0.3);
  assert.equal(events[0].state.params.rotate.value, 0.7);
  assert.equal(events[0].state.params.colorPalette1.value.v, 0.5);
});

test('setMany with per-write rejection only includes accepted keys in changedKeys', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.setSourceLock({ mode: 'per-param', leases: { speed: 'ipad' } });
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  const res = pc.setMany([
    { kind: 'scalar', key: 'speed',  value: 0.3 },  // rejected (locked to ipad)
    { kind: 'scalar', key: 'rotate', value: 0.7 },  // accepted
  ], 'osc');
  assert.deepEqual(res.changedKeys, ['rotate']);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changedKeys, ['rotate']);
});

test('setMany with all writes rejected does NOT fire onChange', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.setSourceLock({ mode: 'global', source: 'ipad' });
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  const res = pc.setMany([
    { kind: 'scalar', key: 'speed',  value: 0.3 },
    { kind: 'scalar', key: 'rotate', value: 0.7 },
  ], 'osc');
  assert.deepEqual(res.changedKeys, []);
  assert.equal(events.length, 0);
});

test('setMany with empty / non-array input is a safe no-op', () => {
  const pc = new ParamCenter(tmpStatePath());
  const events = [];
  pc.onChange = (ev) => events.push(ev);
  assert.equal(pc.setMany([], 'osc').status, 'ok');
  assert.equal(pc.setMany(null, 'osc').status, 'ok');
  assert.equal(events.length, 0);
});

// ── HSV component atomicity ────────────────────────────────────────────────

test('setHsvField mutates only the requested component', () => {
  const pc = new ParamCenter(tmpStatePath());
  // Default colorPalette2 is { h: 0.5, s: 1, v: 1 }.
  pc.setHsvField('colorPalette2', 's', 0.25, 'osc');
  const v = pc.getAll().colorPalette2;
  assert.equal(v.h, 0.5);
  assert.equal(v.s, 0.25);
  assert.equal(v.v, 1);
});

// ── hasPersistentDirty ─────────────────────────────────────────────────────

test('hasPersistentDirty true for ["speed"]', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.equal(pc.hasPersistentDirty(['speed']), true);
});

test('hasPersistentDirty false for ["micLow"] (live, non-persistent)', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.equal(pc.hasPersistentDirty(['micLow']), false);
});

test('hasPersistentDirty true for ["speed"] (operator-tuned, persists)', () => {
  // Replaces the audioReactivity check from before the master scale
  // was retired — `speed` is the equivalent persistent operator knob.
  const pc = new ParamCenter(tmpStatePath());
  assert.equal(pc.hasPersistentDirty(['speed']), true);
});

test('hasPersistentDirty true if any key persists', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.equal(pc.hasPersistentDirty(['micLow', 'speed']), true);
});

test('hasPersistentDirty false for unknown keys', () => {
  const pc = new ParamCenter(tmpStatePath());
  assert.equal(pc.hasPersistentDirty(['nonexistent']), false);
  assert.equal(pc.hasPersistentDirty([]), false);
  assert.equal(pc.hasPersistentDirty(null), false);
});

// ── Modulators-only audio policy (operator decision 2026-06-17) ─────────────
// Patterns must NOT read live audio signals natively. registerChannel must
// refuse to bind a live audio-family `export var` into pattern globals, while
// still binding normal slider/param/color exports (modulators depend on that
// general control-write path). See lib/param_center.js step 1 +
// audio/postproc/audio_signals.js isLiveAudioSharedFnName.

// Probe the control map a channel built. registerChannel stores it on
// pc._channels[channelId].controlMap (key → { id, fnName }).
function controlMapFor(pc, channelId) {
  return pc._channels?.[channelId]?.controlMap || {};
}

test('registerChannel does NOT bind live audio exports into pattern globals', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { __h: true }, [
    { id: 1, name: 'micLow' },
    { id: 2, name: 'micDomEnergy1' },
    { id: 3, name: 'micDomFreq1' },
    { id: 4, name: 'audioBuildScore' },
    { id: 5, name: 'tempoBpm' },
  ]);
  const cm = controlMapFor(pc, 'deck');
  for (const k of ['micLow', 'micDomEnergy1', 'micDomFreq1', 'audioBuildScore', 'tempoBpm']) {
    assert.equal(cm[k], undefined, `${k} must not bind (modulators-only audio policy)`);
    assert.equal(pc.isSharedExport('deck', k), false, `${k} not a bound shared export`);
  }
});

test('registerChannel STILL binds non-audio shared exports (color/rotate)', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { __h: true }, [
    { id: 10, name: 'colorPalette1' },
    { id: 11, name: 'rotate' },
    { id: 12, name: 'micDomEnergy1' }, // audio — excluded
  ]);
  const cm = controlMapFor(pc, 'deck');
  assert.deepEqual(cm.colorPalette1, { id: 10, fnName: 'colorPalette1' });
  assert.deepEqual(cm.rotate, { id: 11, fnName: 'rotate' });
  assert.equal(cm.micDomEnergy1, undefined, 'audio still excluded alongside non-audio binds');
});

test('engine-owned globals (speed/size) remain unbound — unchanged by audio policy', () => {
  const pc = new ParamCenter(tmpStatePath());
  pc.registerChannel('deck', { __h: true }, [
    { id: 20, name: 'speed' },
    { id: 21, name: 'size' },
  ]);
  const cm = controlMapFor(pc, 'deck');
  assert.equal(cm.speed, undefined, 'speed is engine-owned, never injected');
  assert.equal(cm.size, undefined, 'size is engine-owned, never injected');
});
