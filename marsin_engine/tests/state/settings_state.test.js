// Unit tests for StateManager engine-settings persistence (auto-save toggle).
// Run:  cd marsin_engine && node --test tests/settings_state.test.js
//
// The `autoSave` setting gates every automatic persistence trigger, so it
// lives in its OWN file (settings_state.yaml) — a toggle that gates auto-save
// can't live in a file whose writes it gates. These tests pin the default,
// the round-trip, and the defensive coercion (a malformed autoSave must fail
// SAFE = keep saving, never silently stop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { StateManager } from '../../lib/state_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'settings_state_'));
}

test('loadSettingsState returns {autoSave:true} when the file is missing', () => {
  const sm = new StateManager(tmpStateDir());
  assert.deepEqual(sm.loadSettingsState(), { autoSave: true });
});

test('saveSettingsState → loadSettingsState round-trips autoSave:false', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.saveSettingsState({ autoSave: false });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'settings_state.yaml'), 'utf8'));
  assert.deepEqual(onDisk, { autoSave: false });
  assert.deepEqual(sm.loadSettingsState(), { autoSave: false });
});

test('saveSettingsState coerces a truthy non-boolean to a real boolean', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.saveSettingsState({ autoSave: 1 });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'settings_state.yaml'), 'utf8'));
  assert.strictEqual(onDisk.autoSave, true);
});

test('loadSettingsState coerces a malformed autoSave to the SAFE default (true)', () => {
  // Fail-safe direction: a hand-edited junk value must keep auto-save ON
  // ("keep saving the operator's work"), never silently disable persistence.
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.save('settings_state.yaml', { autoSave: 'nope' });
  assert.deepEqual(sm.loadSettingsState(), { autoSave: true });
});
