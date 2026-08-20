// Unit tests for StateManager engine-settings persistence.
// Run:  cd marsin_engine && node --test tests/state/settings_state.test.js
//
// The `autoSave` setting gates every automatic persistence trigger, so it
// lives in its OWN file (settings_state.yaml) — a toggle that gates auto-save
// can't live in a file whose writes it gates. These tests pin the default,
// the round-trip, and the defensive coercion (a malformed autoSave must fail
// SAFE = keep saving, never silently stop).
//
// `bootMode` (report _236) shares that file and that posture: which face the
// engine comes up in is an operator preference that must survive a restart, and
// an unreadable value must fail SAFE = 'performance' (the show gate stays ON).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { StateManager, BOOT_MODES, normalizeBootMode } from '../../lib/state_manager.js';

function tmpStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'settings_state_'));
}

test('loadSettingsState returns the documented defaults when the file is missing', () => {
  const sm = new StateManager(tmpStateDir());
  assert.deepEqual(sm.loadSettingsState(), { autoSave: true, bootMode: 'performance' });
});

test('saveSettingsState → loadSettingsState round-trips autoSave:false', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.saveSettingsState({ autoSave: false });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'settings_state.yaml'), 'utf8'));
  assert.deepEqual(onDisk, { autoSave: false, bootMode: 'performance' });
  assert.deepEqual(sm.loadSettingsState(), { autoSave: false, bootMode: 'performance' });
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
  assert.deepEqual(sm.loadSettingsState(), { autoSave: true, bootMode: 'performance' });
});

// ── bootMode (report _236) ────────────────────────────────────────────────

test('bootMode round-trips through the same file as autoSave', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.saveSettingsState({ autoSave: false, bootMode: BOOT_MODES.EDIT });
  const onDisk = yaml.load(fs.readFileSync(path.join(dir, 'settings_state.yaml'), 'utf8'));
  assert.deepEqual(onDisk, { autoSave: false, bootMode: 'edit' });
  assert.deepEqual(sm.loadSettingsState(), { autoSave: false, bootMode: 'edit' });
});

test('an UNREADABLE bootMode loads as performance — a gate never opens itself', () => {
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  for (const junk of ['edti', 'EDIT', '', 0, true, null, { mode: 'edit' }]) {
    sm.save('settings_state.yaml', { autoSave: true, bootMode: junk });
    assert.equal(sm.loadSettingsState().bootMode, 'performance',
      `bootMode '${JSON.stringify(junk)}' did not fail safe`);
  }
});

test('an OLD settings file without bootMode loads as performance', () => {
  // Every engine that ran before _236 has exactly this file on disk. It must
  // keep the shipped docs/56 D1 behaviour, not acquire a new boot face.
  const dir = tmpStateDir();
  const sm = new StateManager(dir);
  sm.save('settings_state.yaml', { autoSave: false });
  assert.deepEqual(sm.loadSettingsState(), { autoSave: false, bootMode: 'performance' });
});

test('normalizeBootMode accepts exactly the two engine values', () => {
  assert.equal(normalizeBootMode('edit'), BOOT_MODES.EDIT);
  assert.equal(normalizeBootMode('performance'), BOOT_MODES.PERFORMANCE);
  for (const junk of ['EDIT', 'Edit', '', undefined, null, 1, {}, []]) {
    assert.equal(normalizeBootMode(junk), BOOT_MODES.PERFORMANCE);
  }
});
