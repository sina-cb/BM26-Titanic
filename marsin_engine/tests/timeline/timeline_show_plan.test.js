import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultShowPlan, validateShowPlan, loadShowPlan, saveShowPlan, dumpShowPlan,
} from '../../lib/timeline/show_plan.js';

test('defaultShowPlan validates', () => {
  const plan = validateShowPlan(defaultShowPlan());
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.name, 'playa_default');
  // 4 recurring + 2 day-specific (burn night, temple).
  assert.equal(plan.cues.length, 6);
  assert.deepEqual(plan.festival, { startDate: '2026-08-30', days: 8 });
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

test('default plan cue kinds (party_start is ambient so mood can auto-fire)', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const byId = Object.fromEntries(plan.cues.map((c) => [c.id, c]));
  assert.equal(byId.c_visibility_on.kind, 'program');
  assert.equal(byId.c_party_start.kind, 'ambient');   // NOT a blocking program
  assert.equal(byId.c_mood_to_party.kind, 'mood');
  assert.equal(byId.c_sunrise.kind, 'program');
});

test('cue kind inference: mood-trigger -> mood, else program (when kind omitted)', () => {
  const base = validateShowPlan(defaultShowPlan());
  // Strip explicit kinds from two cues and re-validate to exercise inference.
  const draft = JSON.parse(JSON.stringify(base));
  const sun = draft.cues.find((c) => c.id === 'c_visibility_on');
  const mood = draft.cues.find((c) => c.id === 'c_mood_to_party');
  delete sun.kind;
  delete mood.kind;
  const re = validateShowPlan(draft);
  const byId = Object.fromEntries(re.cues.map((c) => [c.id, c]));
  assert.equal(byId.c_visibility_on.kind, 'program');  // non-mood trigger -> program
  assert.equal(byId.c_mood_to_party.kind, 'mood');     // mood trigger -> mood
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

// ── §15.2 schemaVersion 2 (festival + cue.days) ───────────────────────────────

function v1Plan() {
  // A bare schemaVersion:1 plan (no festival, no cue.days) — the pre-v2 shape.
  return {
    schemaVersion: 1,
    name: 'legacy_nightly',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: { enabled: true, playlist: 'default', delay_s: 45, shuffle: true, mood: true },
    phases: {},
    looks: { show: { playlist: 'default', palette: 'aurora' } },
    cues: [
      { id: 'c_one', trigger: { type: 'clock', at: '20:00' }, action: { type: 'look', look: 'show' } },
    ],
  };
}

test('v1 back-compat: loads and normalizes to v2 with festival:null, days:all', () => {
  const v = validateShowPlan(v1Plan());
  assert.equal(v.schemaVersion, 2);
  assert.equal(v.festival, null);
  assert.equal(v.cues[0].days, 'all');
});

test('schemaVersion 2 festival validates and round-trips', () => {
  const plan = defaultShowPlan();
  const v = validateShowPlan(plan);
  const round = validateShowPlan(JSON.parse(JSON.stringify(v)));
  assert.deepEqual(round, v);
});

test('festival.days out of [1,31] throws', () => {
  const plan = defaultShowPlan();
  plan.festival.days = 0;
  assert.throws(() => validateShowPlan(plan), /days must be an integer in \[1, 31\]/);
  plan.festival.days = 40;
  assert.throws(() => validateShowPlan(plan), /days must be an integer in \[1, 31\]/);
});

test('festival.startDate must be a valid calendar date', () => {
  const plan = defaultShowPlan();
  plan.festival.startDate = '2026-02-30';
  assert.throws(() => validateShowPlan(plan), /not a valid calendar date/);
  plan.festival.startDate = 'nope';
  assert.throws(() => validateShowPlan(plan), /must be a 'YYYY-MM-DD' date/);
});

test('cue days integer index out of range throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].days = [8]; // span is days:8 → valid indices 0..7
  assert.throws(() => validateShowPlan(plan), /day index 8 out of range \[0, 7\]/);
});

test('cue days date-string array validates', () => {
  const plan = defaultShowPlan();
  plan.cues[0].days = ['2026-09-01', '2026-09-03'];
  const v = validateShowPlan(plan);
  assert.deepEqual(v.cues[0].days, ['2026-09-01', '2026-09-03']);
});

test('cue days mixing ints and dates throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].days = [1, '2026-09-01'];
  assert.throws(() => validateShowPlan(plan), /all integer day-indices OR all 'YYYY-MM-DD'/);
});

test('cue days index/date without a festival block throws', () => {
  const plan = v1Plan();
  plan.schemaVersion = 2;
  plan.cues[0].days = [0];
  assert.throws(() => validateShowPlan(plan), /no festival block/);
});

test('default day-specific cues: burn night days:[6], temple days:[7]', () => {
  const v = validateShowPlan(defaultShowPlan());
  const byId = Object.fromEntries(v.cues.map((c) => [c.id, c]));
  assert.deepEqual(byId.c_burn_night.days, [6]);
  assert.deepEqual(byId.c_temple.days, [7]);
  assert.equal(byId.c_sunrise.days, 'all');
});

// ── tz IANA validation (Fix 2) ────────────────────────────────────────────────

test('invalid IANA tz throws a clear error', () => {
  const plan = defaultShowPlan();
  plan.location.tz = 'Not/AZone';
  assert.throws(() => validateShowPlan(plan), /location\.tz "Not\/AZone" is not a valid IANA time zone/);
});

test('valid IANA tz passes', () => {
  const plan = defaultShowPlan();
  plan.location.tz = 'America/New_York';
  assert.equal(validateShowPlan(plan).location.tz, 'America/New_York');
});

// ── effect action presetId/params (Fix 6) ─────────────────────────────────────

test('effect with just effectId validates (presetId optional)', () => {
  const plan = defaultShowPlan();
  plan.cues[0].action = { type: 'effect', effectId: 'strobe' };
  const v = validateShowPlan(plan);
  assert.deepEqual(v.cues[0].action, { type: 'effect', effectId: 'strobe' });
});

test('effect with params throws (not supported in v1)', () => {
  const plan = defaultShowPlan();
  plan.cues[0].action = { type: 'effect', effectId: 'strobe', params: { speed: 2 } };
  assert.throws(() => validateShowPlan(plan), /params is not supported in v1/);
});

// ── cue-count cap (Fix 7a) ────────────────────────────────────────────────────

test('plan with > 512 cues throws', () => {
  const plan = defaultShowPlan();
  plan.cues = [];
  for (let i = 0; i < 513; i += 1) {
    plan.cues.push({
      id: `c_${i}`, days: 'all',
      trigger: { type: 'clock', at: '20:00' },
      action: { type: 'scene', scene: 'aurora' },
    });
  }
  assert.throws(() => validateShowPlan(plan), /plan has too many cues \(max 512\)/);
});

// ── §16.11 cue durationMin + plan-level defaultCue ────────────────────────────

test('cue durationMin accepts a number > 0', () => {
  const plan = defaultShowPlan();
  plan.cues[0].durationMin = 30;
  const v = validateShowPlan(plan);
  assert.equal(v.cues[0].durationMin, 30);
});

test('cue durationMin <= 0 or NaN throws', () => {
  const plan = defaultShowPlan();
  plan.cues[0].durationMin = 0;
  assert.throws(() => validateShowPlan(plan), /durationMin must be a number > 0/);
  plan.cues[0].durationMin = -5;
  assert.throws(() => validateShowPlan(plan), /durationMin must be a number > 0/);
  plan.cues[0].durationMin = 'later';
  assert.throws(() => validateShowPlan(plan), /durationMin must be a number > 0/);
});

test('absent durationMin → key omitted (today\'s behavior, no regression)', () => {
  const plan = defaultShowPlan();
  const v = validateShowPlan(plan);
  assert.equal('durationMin' in v.cues[0], false);
});

test('plan defaultCue {label, action} validates + normalizes (deck target)', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { label: 'House ambient', action: { type: 'look', look: 'daytime' } };
  const v = validateShowPlan(plan);
  assert.equal(v.defaultCue.label, 'House ambient');
  assert.deepEqual(v.defaultCue.action, { type: 'look', look: 'daytime' });
});

test('plan defaultCue with a playlist deck action validates', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { action: { type: 'playlist', name: 'default' } };
  const v = validateShowPlan(plan);
  assert.equal(v.defaultCue.action.type, 'playlist');
  assert.deepEqual(v.defaultCue.action.target, { channel: 'deck', id: null });
});

test('plan defaultCue without an action throws', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { label: 'oops' };
  assert.throws(() => validateShowPlan(plan), /defaultCue\.action is required/);
});

test('plan defaultCue targeting a non-deck channel throws', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { action: { type: 'playlist', name: 'default', target: { channel: 'mixer', id: 'm1' } } };
  assert.throws(() => validateShowPlan(plan), /defaultCue\.action must target the deck/);
});

test('plan defaultCue with a dangling look reference throws', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { action: { type: 'look', look: 'no_such_look' } };
  assert.throws(() => validateShowPlan(plan), /no_such_look.*is not a defined look/);
});

test('absent defaultCue → key omitted (autopilot baseline stands, no regression)', () => {
  const v = validateShowPlan(defaultShowPlan());
  assert.equal('defaultCue' in v, false);
});

test('defaultCue round-trips through dump -> load', () => {
  const plan = defaultShowPlan();
  plan.defaultCue = { label: 'House', action: { type: 'look', look: 'daytime' } };
  plan.cues[0].durationMin = 45;
  const round = validateShowPlan(JSON.parse(JSON.stringify(validateShowPlan(plan))));
  assert.deepEqual(round.defaultCue, { label: 'House', action: { type: 'look', look: 'daytime' } });
  assert.equal(round.cues[0].durationMin, 45);
});

// ── §16.11 overlapping-cue safety net ─────────────────────────────────────────
// Two cues whose deck windows [start, start+durationMin) overlap on a SHARED day
// must be rejected. Windows are half-open: touching endpoints do NOT overlap.
// mood/manual/phase cues (no scheduled time) never participate.

function overlapPlan(cues, festival) {
  return {
    schemaVersion: 2,
    name: 'overlap_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles' },
    festival: festival === undefined ? { startDate: '2026-08-30', days: 3 } : festival,
    autopilot: {
      enabled: true, playlist: 'default', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {},
    cues,
  };
}

function deckPlaylistCue(id, at, durationMin, days) {
  const cue = {
    id, label: id, kind: 'program',
    trigger: { type: 'clock', at },
    action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
    durationMin,
  };
  if (days !== undefined) cue.days = days;
  return cue;
}

test('overlapping clock cues on a shared day are REJECTED (fail loud)', () => {
  // c_a: 20:00 for 60min → [20:00,21:00). c_b: 20:30 for 30min → [20:30,21:00).
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60),
    deckPlaylistCue('c_b', '20:30', 30),
  ]);
  assert.throws(() => validateShowPlan(plan), /overlap.*c_a.*c_b|c_a.*c_b.*overlap/i);
});

test('ADJACENT (touching) clock windows are ACCEPTED (half-open, endpoints touch)', () => {
  // c_a: 20:00 for 60min → [20:00,21:00). c_b: 21:00 for 30min → [21:00,21:30).
  // They touch at 21:00 but do NOT overlap.
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60),
    deckPlaylistCue('c_b', '21:00', 30),
  ]);
  assert.doesNotThrow(() => validateShowPlan(plan));
});

test('overlapping windows on DIFFERENT days are ACCEPTED (no shared day)', () => {
  // Same clock times + durations but disjoint day-sets → no shared day → legal.
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60, [0]),
    deckPlaylistCue('c_b', '20:30', 30, [1]),
  ]);
  assert.doesNotThrow(() => validateShowPlan(plan));
});

test('overlapping windows sharing ONE day (via days:all vs a day index) are REJECTED', () => {
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60, 'all'),
    deckPlaylistCue('c_b', '20:30', 30, [1]),
  ]);
  assert.throws(() => validateShowPlan(plan), /overlap/i);
});

test('a mood cue (no scheduled time) never participates in overlap', () => {
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60),
    {
      id: 'c_mood', label: 'mood', kind: 'mood',
      trigger: { type: 'mood', from: 'calm', to: 'party' },
      action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
      durationMin: 60,
    },
  ]);
  assert.doesNotThrow(() => validateShowPlan(plan));
});

test('cues WITHOUT durationMin do not participate (point cues never overlap)', () => {
  // Both at 20:00 but no durationMin → no windows → no overlap.
  const plan = overlapPlan([
    { id: 'c_a', label: 'a', kind: 'program', trigger: { type: 'clock', at: '20:00' },
      action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } } },
    { id: 'c_b', label: 'b', kind: 'program', trigger: { type: 'clock', at: '20:00' },
      action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } } },
  ]);
  assert.doesNotThrow(() => validateShowPlan(plan));
});

test('a DISABLED overlapping cue is ignored (owns no window)', () => {
  const plan = overlapPlan([
    deckPlaylistCue('c_a', '20:00', 60),
    { ...deckPlaylistCue('c_b', '20:30', 30), enabled: false },
  ]);
  assert.doesNotThrow(() => validateShowPlan(plan));
});
