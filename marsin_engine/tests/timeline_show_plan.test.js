import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultShowPlan, validateShowPlan, loadShowPlan, saveShowPlan, dumpShowPlan,
} from '../lib/timeline/show_plan.js';

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

// ── §14 control-precedence schema additions ───────────────────────────────────

test('defaultShowPlan carries the autopilot baseline block', () => {
  const plan = validateShowPlan(defaultShowPlan());
  assert.deepEqual(plan.autopilot, {
    enabled: true,
    playlist: 'default',
    delay_s: 45,
    shuffle: true,
    target: { channel: 'deck', id: null },
    mood: true,
  });
});

test('missing autopilot block defaults to enabled baseline', () => {
  const plan = defaultShowPlan();
  delete plan.autopilot;
  const v = validateShowPlan(plan);
  assert.equal(v.autopilot.enabled, true);
  assert.equal(v.autopilot.delay_s, 45);
  assert.equal(v.autopilot.shuffle, true);
  assert.equal(v.autopilot.mood, true);
  assert.deepEqual(v.autopilot.target, { channel: 'deck', id: null });
  assert.equal(v.autopilot.playlist, undefined);
});

test('autopilot.delay_s <= 0 throws', () => {
  const plan = defaultShowPlan();
  plan.autopilot.delay_s = 0;
  assert.throws(() => validateShowPlan(plan), /delay_s must be a number > 0/);
});

test('cue kind inference: mood-trigger -> mood, else program', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const byId = Object.fromEntries(plan.cues.map((c) => [c.id, c]));
  assert.equal(byId.c_visibility_on.kind, 'program');
  assert.equal(byId.c_party_start.kind, 'program');
  assert.equal(byId.c_mood_to_party.kind, 'mood');
  assert.equal(byId.c_sunrise.kind, 'program');
});

test('default sunrise cue is a program with hold:{min:90}', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const sunrise = plan.cues.find((c) => c.id === 'c_sunrise');
  assert.equal(sunrise.kind, 'program');
  assert.deepEqual(sunrise.hold, { min: 90 });
});

test('bad cue kind throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].kind = 'whoa';
  assert.throws(() => validateShowPlan(plan), /kind must be one of program, mood, ambient/);
});

test('explicit cue kind is preserved', () => {
  const plan = defaultShowPlan();
  plan.cues[0].kind = 'ambient';
  const v = validateShowPlan(plan);
  assert.equal(v.cues[0].kind, 'ambient');
});

test('hold:{min} validates and hold:{min:0} throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].hold = { min: 30 };
  assert.deepEqual(validateShowPlan(plan).cues[0].hold, { min: 30 });
  plan.cues[0].hold = { min: 0 };
  assert.throws(() => validateShowPlan(plan), /min must be a number > 0/);
});

test('hold:{until:anchor} validates; hold with both min and until throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].hold = { until: { clock: '06:30' } };
  assert.deepEqual(validateShowPlan(plan).cues[0].hold, { until: { clock: '06:30' } });
  plan.cues[0].hold = { min: 30, until: { clock: '06:30' } };
  assert.throws(() => validateShowPlan(plan), /exactly one of/);
});
