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
  // A sun cue resolves to an HH:MM atLocal. The party-mood cue is authored
  // with `whenPhase`, so buildOverview now surfaces its phase start as an
  // operator-facing Party Window timing (a plain non-phase mood cue would
  // still resolve to null — this one is the deliberate Party surface).
  const sunriseCue = day0.cues.find((c) => c.id === 'c_sunrise');
  assert.match(sunriseCue.atLocal, /^\d{2}:\d{2}$/);
  const moodCue = day0.cues.find((c) => c.id === 'c_mood_to_party');
  assert.match(moodCue.atLocal, /^\d{2}:\d{2}$/);
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

// ── the WORKING-DAY overview additions (report _359 §C.3) ─────────────────────

// A plan whose Party Window is CLOCK-anchored, so the test can pin the exact
// open/close clocks instead of chasing that day's sun. `days` selects which
// festival days the party cue applies to.
function clockPartyPlan({ start, end, days }) {
  const plan = brcPlan();
  plan.phases.party_night = { start: { clock: start }, end: { clock: end } };
  plan.cues.find((c) => c.id === 'c_mood_to_party').days = days;
  return plan;
}

test('buildOverview: partyWindow only on the days the party cue applies to (C-03)', () => {
  const plan = clockPartyPlan({ start: '09:00', end: '17:00', days: [1] });
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));

  assert.equal(ov.days[0].partyWindow, null);
  assert.deepEqual(ov.days[1].partyWindow, {
    phaseId: 'party_night',
    cueId: 'c_mood_to_party',
    opensLocal: '09:00',
    closesLocal: '17:00',
    wraps: false,
  });
  for (const day of ov.days.slice(2)) {
    assert.equal(day.partyWindow, null, `day ${day.index} must have no party window`);
  }
});

test('buildOverview: a 21:00 → 09:00 window reports wraps:true on every applying day', () => {
  const plan = clockPartyPlan({ start: '21:00', end: '09:00', days: 'all' });
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  for (const day of ov.days) {
    assert.deepEqual(day.partyWindow, {
      phaseId: 'party_night',
      cueId: 'c_mood_to_party',
      opensLocal: '21:00',
      closesLocal: '09:00',
      wraps: true,
    }, `day ${day.index}`);
  }
});

test('buildOverview: a disabled party cue yields no partyWindow anywhere', () => {
  const plan = clockPartyPlan({ start: '21:00', end: '09:00', days: 'all' });
  plan.cues.find((c) => c.id === 'c_mood_to_party').enabled = false;
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  for (const day of ov.days) assert.equal(day.partyWindow, null);
});

test('buildOverview: civilDawn is surfaced alongside civilDusk', () => {
  const plan = brcPlan();
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  for (const day of ov.days) {
    assert.ok('civilDawn' in day.sun, `day ${day.index} sun has civilDawn`);
    assert.match(day.sun.civilDawn, /^\d{2}:\d{2}$/);
  }
});

test('buildOverview: nextSun is present on EVERY day, including the last', () => {
  const plan = brcPlan();
  const ov = buildOverview(plan, localNoonUtc(2026, 8, 30));
  for (const day of ov.days) {
    assert.match(day.nextSun.sunrise, /^\d{2}:\d{2}$/, `day ${day.index} nextSun.sunrise`);
    assert.match(day.nextSun.civilDawn, /^\d{2}:\d{2}$/, `day ${day.index} nextSun.civilDawn`);
  }
  // The last day's nextSun is a REAL sunrise for 2026-09-07 — a date the
  // overview has no entry for — and it must equal that day's own sun if the
  // festival were one day longer (no synthetic extra day is invented).
  const last = ov.days[ov.days.length - 1];
  assert.equal(ov.days.length, 8);
  assert.equal(last.date, '2026-09-06');
  const longer = brcPlan();
  longer.festival = { startDate: '2026-08-30', days: 9 };
  const ov9 = buildOverview(longer, localNoonUtc(2026, 8, 30));
  assert.equal(ov9.days[8].date, '2026-09-07');
  assert.equal(last.nextSun.sunrise, ov9.days[8].sun.sunrise);
  assert.equal(last.nextSun.civilDawn, ov9.days[8].sun.civilDawn);
  // Each day's nextSun matches the NEXT overview day's own sun.
  for (let i = 0; i < ov.days.length - 1; i += 1) {
    assert.equal(ov.days[i].nextSun.sunrise, ov.days[i + 1].sun.sunrise, `day ${i}`);
    assert.equal(ov.days[i].nextSun.civilDawn, ov.days[i + 1].sun.civilDawn, `day ${i}`);
  }
});

// ── service fires ONLY today's cues (fake clock day 0 vs day 6) ────────────────

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [], setMaster: [] };
  const deps = {
    loadPlaylist: (a) => { calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    // The shipped burn_night / temple looks carry a `master` global, and
    // `_writeGlobals` THROWS without this dep (codex P0 — an authored global is
    // never silently dropped). Omitting it made those applies fail half-way,
    // which is why the day-6 probe used to be asserted on a palette side effect
    // rather than on the cue actually landing (report 356, P1-5).
    setMaster: (v) => { calls.setMaster.push(v); },
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
  // On boot, catchUp restores the cue that owns the moment among those
  // applicable TODAY. We boot at the same LOCAL evening time on day 6 vs day 0
  // and assert the burn-night CUE is restored only on day 6.
  //
  // TWO changes since report 356 P1-5, both about the PROXY, not the rule:
  //   • the assertion reads the restored CUE ID, not a palette. The old proxy
  //     was the bass_drop hue (0.8), which the recurring `party` look shares
  //     with `burn_night` — and P1-5 now correctly restores the AMBIENT
  //     `party_night` phase cue on EVERY day, so the hue stopped separating
  //     the two days. The cue id always did.
  //   • the probe moved from 23:00 to 22:00 local, i.e. INSIDE the burn-night
  //     program's 120-minute hold. At 23:00 that hold has already expired
  //     (sunset+90 ≈ 20:52 → 22:52), and an expired program owns nothing: the
  //     honest owner there is the party-night ramp, on day 6 as much as day 0.
  //     The day-targeting rule this test exists for is unchanged.

  // Day 6 (2026-09-05) 22:00 PT == 2026-09-06 05:00 UTC.
  const day6Evening = Date.UTC(2026, 8, 6, 5, 0, 0);
  const { svc: svc6 } = setupService(day6Evening);
  await svc6.start();
  const day6Fires = svc6.recentFires.filter((e) => e.kind === 'fire').map((e) => e.cueId);
  svc6.stop();
  assert.ok(day6Fires.includes('c_burn_night'),
    `day 6 should restore the burn-night cue, got ${JSON.stringify(day6Fires)}`);

  // Day 0 (2026-08-30) 22:00 PT == 2026-08-31 05:00 UTC — the burn-night cue
  // does not apply, so it must never be restored.
  const day0Evening = Date.UTC(2026, 7, 31, 5, 0, 0);
  const { svc: svc0 } = setupService(day0Evening);
  await svc0.start();
  const day0Fires = svc0.recentFires.filter((e) => e.kind === 'fire').map((e) => e.cueId);
  svc0.stop();
  assert.ok(!day0Fires.includes('c_burn_night'),
    `day 0 must NOT restore the burn-night cue, got ${JSON.stringify(day0Fires)}`);
});
