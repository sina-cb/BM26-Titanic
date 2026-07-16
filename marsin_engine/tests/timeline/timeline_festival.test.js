import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  festivalDayIndex, cueAppliesOn, applicableCues, festivalDateFor,
} from '../../lib/timeline/festival.js';
import { defaultShowPlan, validateShowPlan, saveShowPlan } from '../../lib/timeline/show_plan.js';
import { TimelineService, buildOverview } from '../../lib/timeline/timeline_service.js';

// BRC festival: startDate 2026-08-30, 8 days. tz America/Los_Angeles is
// PDT (UTC-7) across the whole span, so local noon = 19:00 UTC.
const TZ = 'America/Los_Angeles';
function localNoonUtc(yyyy, mm, dd) {
  // 12:00 PDT == 19:00 UTC.
  return Date.UTC(yyyy, mm - 1, dd, 19, 0, 0);
}

function brcPlan() {
  return validateShowPlan(defaultShowPlan());
}

// ── festivalDayIndex ──────────────────────────────────────────────────────────

test('festivalDayIndex maps each day of the span (tz-aware)', () => {
  const plan = brcPlan();
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 8, 30)), 0);
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 9, 5)), 6); // burn night
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 9, 6)), 7); // temple
});

test('festivalDayIndex is null outside the span', () => {
  const plan = brcPlan();
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 8, 29)), null); // day before
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 9, 7)), null);  // day after
});

test('festivalDayIndex respects tz boundaries (UTC midnight is still prev day in PT)', () => {
  const plan = brcPlan();
  // 2026-08-31 00:30 UTC == 2026-08-30 17:30 PT → still day 0.
  assert.equal(festivalDayIndex(plan, Date.UTC(2026, 7, 31, 0, 30, 0)), 0);
  // 2026-08-31 07:30 UTC == 2026-08-31 00:30 PT → day 1.
  assert.equal(festivalDayIndex(plan, Date.UTC(2026, 7, 31, 7, 30, 0)), 1);
});

test('festivalDayIndex is null when the plan has no festival', () => {
  const plan = brcPlan();
  plan.festival = null;
  assert.equal(festivalDayIndex(plan, localNoonUtc(2026, 8, 30)), null);
});

// ── cueAppliesOn ──────────────────────────────────────────────────────────────

test('cueAppliesOn: days:all is always true', () => {
  const plan = brcPlan();
  const cue = { days: 'all', trigger: { type: 'clock', at: '20:00' } };
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 8, 30)), true);
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 9, 7)), true); // even outside span
});

test('cueAppliesOn: integer index array matches the festival day only', () => {
  const plan = brcPlan();
  const cue = { days: [6], trigger: { type: 'sun', event: 'sunset' } };
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 9, 5)), true);  // day 6
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 9, 6)), false); // day 7
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 8, 30)), false); // day 0
});

test('cueAppliesOn: date-string array matches today in tz', () => {
  const plan = brcPlan();
  const cue = { days: ['2026-09-01'], trigger: { type: 'clock', at: '20:00' } };
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 9, 1)), true);
  assert.equal(cueAppliesOn(cue, plan, localNoonUtc(2026, 9, 2)), false);
});

test('cueAppliesOn: no-festival plan rejects BOTH index and date forms (Fix 10)', () => {
  const plan = brcPlan();
  plan.festival = null;
  const idxCue = { days: [0], trigger: { type: 'clock', at: '20:00' } };
  const dateCue = { days: ['2026-08-30'], trigger: { type: 'clock', at: '20:00' } };
  // Both must be false — no asymmetry where a date-array applies but an index
  // array does not.
  assert.equal(cueAppliesOn(idxCue, plan, localNoonUtc(2026, 8, 30)), false);
  assert.equal(cueAppliesOn(dateCue, plan, localNoonUtc(2026, 8, 30)), false);
});

// ── applicableCues ────────────────────────────────────────────────────────────

test('applicableCues filters by festival day', () => {
  const plan = brcPlan();
  const day0 = applicableCues(plan, localNoonUtc(2026, 8, 30)).map((c) => c.id);
  const day6 = applicableCues(plan, localNoonUtc(2026, 9, 5)).map((c) => c.id);
  // Recurring cues present every day; burn/temple only on their days.
  assert.ok(day0.includes('c_sunrise'));
  assert.ok(!day0.includes('c_burn_night'));
  assert.ok(day6.includes('c_burn_night'));
  assert.ok(!day6.includes('c_temple'));
});

test('festivalDateFor computes the calendar date of each index', () => {
  const f = { startDate: '2026-08-30', days: 8 };
  assert.equal(festivalDateFor(f, 0), '2026-08-30');
  assert.equal(festivalDateFor(f, 2), '2026-09-01'); // crosses month boundary
  assert.equal(festivalDateFor(f, 7), '2026-09-06');
  assert.throws(() => festivalDateFor(f, 8), /out of range/);
});

// ── buildOverview ─────────────────────────────────────────────────────────────

test('buildOverview returns one entry per festival day with sun + cues + atLocal', () => {
  const plan = brcPlan();
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  assert.equal(ov.plan, 'playa_default');
  assert.deepEqual(ov.festival, { startDate: '2026-08-30', days: 8 });
  assert.equal(ov.days.length, 8);

  const day0 = ov.days[0];
  assert.equal(day0.index, 0);
  assert.equal(day0.date, '2026-08-30');
  assert.equal(day0.weekday, 'Sun'); // 2026-08-30 is a Sunday
  // Sun events present as HH:MM (BRC is not polar) for the required keys.
  for (const k of ['sunrise', 'sunset', 'solarNoon', 'civilDusk', 'goldenHourStart', 'goldenHourEnd']) {
    assert.ok(k in day0.sun, `sun has ${k}`);
    assert.match(day0.sun[k], /^\d{2}:\d{2}$/, `${k} is HH:MM`);
  }
  // A sun cue resolves to an HH:MM atLocal; mood cue → null.
  const sunriseCue = day0.cues.find((c) => c.id === 'c_sunrise');
  assert.match(sunriseCue.atLocal, /^\d{2}:\d{2}$/);
  const moodCue = day0.cues.find((c) => c.id === 'c_mood_to_party');
  assert.equal(moodCue.atLocal, null);
  // A phase cue → null (no resolved clock/sun time).
  const phaseCue = day0.cues.find((c) => c.id === 'c_party_start');
  assert.equal(phaseCue.atLocal, null);

  // Day 6 includes the burn-night cue; day 0 does not.
  assert.ok(!day0.cues.some((c) => c.id === 'c_burn_night'));
  assert.ok(ov.days[6].cues.some((c) => c.id === 'c_burn_night'));
});

test('buildOverview with no festival yields a single "today" entry', () => {
  const plan = brcPlan();
  plan.festival = null;
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  assert.equal(ov.festival, null);
  assert.equal(ov.days.length, 1);
  assert.equal(ov.days[0].date, '2026-08-30');
});

// ── service fires ONLY today's cues (fake clock day 0 vs day 6) ────────────────

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [] };
  const deps = {
    loadPlaylist: (a) => { calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
  };
  return { deps, calls };
}

const PALETTES = [
  { id: 'deep_sea', c1: 0.62, c2: 0.48 },
  { id: 'sunset_coral', c1: 0.05, c2: 0.1 },
  { id: 'bass_drop', c1: 0.8, c2: 0.9 },
  { id: 'aurora', c1: 0.4, c2: 0.5 },
];

function setupService(nowMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlfest-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(defaultShowPlan(), path.join(sceneDir, 'playa_default.yaml'));
  const { deps, calls } = makeDeps();
  const svc = new TimelineService({
    scene: 'brc',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'playa_default', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => nowMs,
  });
  return { svc, calls };
}

test('service fires only today\'s cues: burn-night look absent on day 0, present on day 6', async () => {
  // The burn-night cue (days:[6]) applies a look whose palette is bass_drop
  // (c1 hue 0.8). On boot, catchUp restores the latest already-passed program
  // cue applicable TODAY. We boot the service at the same LOCAL evening time on
  // day 6 vs day 0 and assert the burn-night palette is written only on day 6.

  // Day 6 (2026-09-05) 23:00 PT == 2026-09-06 06:00 UTC.
  const day6Evening = Date.UTC(2026, 8, 6, 6, 0, 0);
  const { svc: svc6, calls: calls6 } = setupService(day6Evening);
  await svc6.start();
  svc6.stop();
  const day6Palettes = calls6.setParams.filter((p) => p.colorPalette1).map((p) => p.colorPalette1.h);
  assert.ok(day6Palettes.includes(0.8), `day 6 should apply burn_night palette, got ${JSON.stringify(day6Palettes)}`);

  // Day 0 (2026-08-30) 23:00 PT == 2026-08-31 06:00 UTC — burn-night cue does
  // not apply, so its palette must never be written.
  const day0Evening = Date.UTC(2026, 7, 31, 6, 0, 0);
  const { svc: svc0, calls: calls0 } = setupService(day0Evening);
  await svc0.start();
  svc0.stop();
  const day0Palettes = calls0.setParams.filter((p) => p.colorPalette1).map((p) => p.colorPalette1.h);
  assert.ok(!day0Palettes.includes(0.8), `day 0 must NOT apply burn_night palette, got ${JSON.stringify(day0Palettes)}`);
});
