// Unit tests for ParamPresetManager (round-2 #9: named per-channel param
// presets).
//
// Covers: capture→list shows it (with pattern scope); load round-trips the
// exact controls; capture deep-copies (a later channel edit can't mutate the
// saved preset); missing preset ⇒ null (caller 404s); malformed YAML / shape
// ⇒ ParamPresetError (caller 400s, never a silent empty preset); bad name ⇒
// throws (caller 400s); persist+reload across a fresh manager; delete removes
// it. The pattern-mismatch (409) + live-handle-replay behaviour is an
// api_server concern and is exercised end-to-end in the HIL test.
//
// Run:  cd marsin_engine && node --test tests/param_preset.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { StateManager } from '../lib/state_manager.js';
import { ParamPresetManager, ParamPresetError } from '../lib/param_preset_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'param_preset_'));
}

function makeManager() {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  const mgr = new ParamPresetManager(dir, sm);
  return { dir, sm, mgr };
}

// A minimal stand-in for a live PatternChannel: only the fields the manager
// reads (id / pattern / localControls). localControls keys are numeric export
// control ids → {v0,v1,v2}.
function sampleChannel(overrides = {}) {
  return {
    id: 'ch_o1',
    pattern: 'rainbow_sweep',
    localControls: {
      3: { v0: 0.5, v1: 0, v2: 0 },
      7: { v0: 0.2, v1: 0.4, v2: 0.6 },
    },
    ...overrides,
  };
}

test('capture then list shows the preset with its pattern scope', () => {
  const { mgr } = makeManager();
  mgr.captureParamPreset('warm', sampleChannel());
  const list = mgr.listParamPresets();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'warm');
  assert.equal(list[0].pattern, 'rainbow_sweep');
  assert.ok(list[0].savedAt, 'savedAt stamped in list');
});

test('capture then load round-trips the exact controls + scope', () => {
  const { mgr } = makeManager();
  mgr.captureParamPreset('warm', sampleChannel());
  const loaded = mgr.loadParamPreset('warm');
  assert.equal(loaded.name, 'warm');
  assert.equal(loaded.pattern, 'rainbow_sweep');
  assert.equal(loaded.capturedFromChannel, 'ch_o1');
  // YAML keys come back as strings; values are exact.
  assert.deepEqual(loaded.controls['3'], { v0: 0.5, v1: 0, v2: 0 });
  assert.deepEqual(loaded.controls['7'], { v0: 0.2, v1: 0.4, v2: 0.6 });
});

test('capture deep-copies — later channel edits do not mutate the saved preset', () => {
  const { mgr } = makeManager();
  const ch = sampleChannel();
  mgr.captureParamPreset('warm', ch);
  // Mutate the live channel after capture.
  ch.localControls[3].v0 = 0.99;
  ch.localControls[99] = { v0: 1, v1: 1, v2: 1 };
  const loaded = mgr.loadParamPreset('warm');
  assert.equal(loaded.controls['3'].v0, 0.5, 'saved value unchanged by live edit');
  assert.equal(loaded.controls['99'], undefined, 'no leak of a control added after capture');
});

test('capture coerces non-finite control components to 0 (no silent NaN persist)', () => {
  const { mgr } = makeManager();
  const ch = sampleChannel({ localControls: { 5: { v0: NaN, v1: undefined, v2: 2 } } });
  mgr.captureParamPreset('x', ch);
  assert.deepEqual(mgr.loadParamPreset('x').controls['5'], { v0: 0, v1: 0, v2: 2 });
});

test('capture rejects a channel with no pattern (fail loud)', () => {
  const { mgr } = makeManager();
  assert.throws(() => mgr.captureParamPreset('x', sampleChannel({ pattern: '' })), /no pattern/);
  assert.throws(() => mgr.captureParamPreset('x', null), /channel is required/);
});

test('missing preset load returns null (caller 404s)', () => {
  const { mgr } = makeManager();
  assert.equal(mgr.loadParamPreset('nope'), null);
});

test('malformed name throws (caller 400s)', () => {
  const { mgr } = makeManager();
  assert.throws(() => mgr.captureParamPreset('Bad Name!', sampleChannel()), /Invalid param preset name/);
  assert.throws(() => mgr.captureParamPreset('../escape', sampleChannel()), /Invalid param preset name/);
  assert.throws(() => mgr.captureParamPreset('', sampleChannel()), /Invalid param preset name/);
  assert.throws(() => mgr.loadParamPreset('UPPER'), /Invalid param preset name/);
});

test('corrupt YAML ⇒ ParamPresetError, never a silent empty preset', () => {
  const { dir, mgr } = makeManager();
  const f = path.join(dir, 'param_presets', 'broken.yaml');
  fs.writeFileSync(f, 'this: : : not valid yaml: [');
  assert.throws(() => mgr.loadParamPreset('broken'), (e) => {
    assert.ok(e instanceof ParamPresetError);
    assert.equal(e.code, 'PARAM_PRESET_MALFORMED');
    return true;
  });
});

test('structurally invalid preset (missing pattern / controls) ⇒ ParamPresetError', () => {
  const { dir, mgr } = makeManager();
  const noPattern = path.join(dir, 'param_presets', 'no_pattern.yaml');
  fs.writeFileSync(noPattern, 'name: no_pattern\ncontrols: {}\n');
  assert.throws(() => mgr.loadParamPreset('no_pattern'), /missing its 'pattern' scope/);

  const noControls = path.join(dir, 'param_presets', 'no_controls.yaml');
  fs.writeFileSync(noControls, 'name: no_controls\npattern: p1\n');
  assert.throws(() => mgr.loadParamPreset('no_controls'), /missing a 'controls' object/);
});

test('a corrupt file in the dir makes listParamPresets fail loud', () => {
  const { dir, mgr } = makeManager();
  mgr.captureParamPreset('good', sampleChannel());
  fs.writeFileSync(path.join(dir, 'param_presets', 'rotten.yaml'), 'oops: [');
  assert.throws(() => mgr.listParamPresets(), ParamPresetError);
});

test('persist then reload across a fresh manager', () => {
  const { dir, sm, mgr } = makeManager();
  mgr.captureParamPreset('persisted', sampleChannel());
  // A brand-new manager on the same dir must see the saved preset.
  const mgr2 = new ParamPresetManager(dir, sm);
  const loaded = mgr2.loadParamPreset('persisted');
  assert.equal(loaded.pattern, 'rainbow_sweep');
  assert.deepEqual(loaded.controls['7'], { v0: 0.2, v1: 0.4, v2: 0.6 });
});

test('delete removes the preset; second delete returns false', () => {
  const { mgr } = makeManager();
  mgr.captureParamPreset('temp', sampleChannel());
  assert.equal(mgr.deleteParamPreset('temp'), true);
  assert.equal(mgr.loadParamPreset('temp'), null);
  assert.equal(mgr.deleteParamPreset('temp'), false, 'deleting a missing preset is a clean false, not a throw');
  assert.equal(mgr.listParamPresets().length, 0);
});

test('list is sorted by name', () => {
  const { mgr } = makeManager();
  mgr.captureParamPreset('zebra', sampleChannel());
  mgr.captureParamPreset('alpha', sampleChannel());
  mgr.captureParamPreset('mango', sampleChannel());
  assert.deepEqual(mgr.listParamPresets().map(p => p.name), ['alpha', 'mango', 'zebra']);
});

test('capture overwrites an existing preset of the same name', () => {
  const { mgr } = makeManager();
  mgr.captureParamPreset('warm', sampleChannel());
  mgr.captureParamPreset('warm', sampleChannel({ pattern: 'other', localControls: { 1: { v0: 9, v1: 0, v2: 0 } } }));
  const loaded = mgr.loadParamPreset('warm');
  assert.equal(loaded.pattern, 'other');
  assert.deepEqual(loaded.controls['1'], { v0: 9, v1: 0, v2: 0 });
  assert.equal(mgr.listParamPresets().length, 1, 'no duplicate entry');
});
