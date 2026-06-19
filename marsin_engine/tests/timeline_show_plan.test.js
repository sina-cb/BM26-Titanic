import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultShowPlan, validateShowPlan, loadShowPlan, saveShowPlan, dumpShowPlan,
} from '../companions/timeline/show_plan.js';

test('defaultShowPlan validates', () => {
  const plan = validateShowPlan(defaultShowPlan());
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.name, 'playa_default');
  assert.equal(plan.cues.length, 4);
});

test('round-trips through dump -> load via a tmp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showplan-'));
  const file = path.join(dir, 'plan.yaml');
  const saved = saveShowPlan(defaultShowPlan(), file);
  const loaded = loadShowPlan(file);
  assert.deepEqual(loaded, saved);
  // dumpShowPlan is stable.
  assert.equal(dumpShowPlan(loaded), dumpShowPlan(saved));
});

test('loadShowPlan returns default on ENOENT', () => {
  const missing = path.join(os.tmpdir(), 'definitely-missing-showplan-xyz.yaml');
  const loaded = loadShowPlan(missing);
  assert.equal(loaded.name, 'playa_default');
});

test('dangling look reference throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].action = { type: 'look', look: 'no_such_look' };
  assert.throws(() => validateShowPlan(plan), /no_such_look.*is not a defined look/);
});

test('dangling phase trigger throws', () => {
  const plan = defaultShowPlan();
  plan.cues[1].trigger = { type: 'phase', phase: 'ghost_phase' };
  assert.throws(() => validateShowPlan(plan), /ghost_phase.*is not a defined phase/);
});

test('bad cue type throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].trigger = { type: 'telepathy' };
  assert.throws(() => validateShowPlan(plan), /type must be one of/);
});

test('clock at of 25:99 throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].trigger = { type: 'clock', at: '25:99' };
  assert.throws(() => validateShowPlan(plan), /HH:MM/);
});

test('duplicate cue id throws', () => {
  const plan = defaultShowPlan();
  plan.cues[1].id = plan.cues[0].id;
  assert.throws(() => validateShowPlan(plan), /not unique/);
});

test('mood whenPhase must exist', () => {
  const plan = defaultShowPlan();
  plan.cues[2].trigger.whenPhase = 'nope';
  assert.throws(() => validateShowPlan(plan), /whenPhase.*is not a defined phase/);
});
