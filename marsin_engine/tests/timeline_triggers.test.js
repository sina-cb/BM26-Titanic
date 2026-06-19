import test from 'node:test';
import assert from 'node:assert/strict';

import { validateShowPlan } from '../companions/timeline/show_plan.js';
import { defaultTimelineState } from '../companions/timeline/timeline_state.js';
import {
  resolveDayTimes, evaluateTick, activePhase, clockToEpochMs, dayKeyFor,
} from '../companions/timeline/triggers.js';

const TZ = 'America/Los_Angeles';
const LOC = { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 };

function basePlan(overrides) {
  return validateShowPlan({
    schemaVersion: 1,
    name: 'test_plan',
    location: LOC,
    phases: {},
    looks: { l1: { playlist: 'default' } },
    cues: [],
    ...overrides,
  });
}

// A fixed reference instant: 2026-08-30 noon UTC (within the BRC day).
const NOON_UTC = new Date('2026-08-30T12:00:00Z').valueOf();

test('clockToEpochMs resolves local HH:MM to the right instant', () => {
  // 12:00 local in PDT (UTC-7) on 2026-08-30 = 19:00 UTC.
  const ms = clockToEpochMs('12:00', NOON_UTC, TZ);
  assert.equal(new Date(ms).toISOString(), '2026-08-30T19:00:00.000Z');
});

test('clock cue fires once when crossed, latches, then re-fires next day', () => {
  const plan = basePlan({
    cues: [{ id: 'c_clock', trigger: { type: 'clock', at: '12:00' }, action: { type: 'look', look: 'l1' } }],
  });
  const sunEvents = {};
  const fireMs = clockToEpochMs('12:00', NOON_UTC, TZ);
  let state = { ...defaultTimelineState() };

  // Before the time: no fire.
  let dayTimes = resolveDayTimes({ plan, now: fireMs - 60000, sunEvents });
  let r = evaluateTick({ now: fireMs - 60000, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;

  // At/after the time: fires once.
  dayTimes = resolveDayTimes({ plan, now: fireMs, sunEvents });
  r = evaluateTick({ now: fireMs, plan, state, mood: { party: 0 }, dayTimes });
  assert.deepEqual(r.fires, [{ cueId: 'c_clock', reason: 'clock' }]);
  state = r.state;

  // Same day, later: does NOT fire again (latched).
  r = evaluateTick({ now: fireMs + 60000, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;

  // Next day after the cue time: fires again (day rolled over).
  const nextDay = NOON_UTC + 24 * 3600 * 1000;
  const nextFireMs = clockToEpochMs('12:00', nextDay, TZ);
  dayTimes = resolveDayTimes({ plan, now: nextFireMs, sunEvents });
  r = evaluateTick({ now: nextFireMs, plan, state, mood: { party: 0 }, dayTimes });
  assert.deepEqual(r.fires, [{ cueId: 'c_clock', reason: 'clock' }]);
});

test('sun cue uses sunEvents + offset', () => {
  const sunset = new Date('2026-08-31T02:42:00Z'); // ~19:42 PDT
  const plan = basePlan({
    cues: [{ id: 'c_sun', trigger: { type: 'sun', event: 'sunset', offsetMin: -45 }, action: { type: 'look', look: 'l1' } }],
  });
  const sunEvents = { sunset };
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents });
  const expected = sunset.valueOf() - 45 * 60000;
  assert.equal(dayTimes.cueTimes.c_sun, expected);

  const state = { ...defaultTimelineState() };
  // Just before: no fire.
  let r = evaluateTick({ now: expected - 1000, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  // At time: fires.
  r = evaluateTick({ now: expected, plan, state: r.state, mood: { party: 0 }, dayTimes });
  assert.deepEqual(r.fires, [{ cueId: 'c_sun', reason: 'sun' }]);
});

test('sun cue with null event never fires', () => {
  const plan = basePlan({
    cues: [{ id: 'c_sun', trigger: { type: 'sun', event: 'sunset' }, action: { type: 'look', look: 'l1' } }],
  });
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: { sunset: null } });
  assert.equal(dayTimes.cueTimes.c_sun, null);
  const r = evaluateTick({ now: NOON_UTC, plan, state: defaultTimelineState(), mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
});

test('phase cue fires on rising edge only', () => {
  // A clock-anchored phase window 12:00..14:00 local.
  const plan = basePlan({
    phases: { p1: { start: { clock: '12:00' }, end: { clock: '14:00' } } },
    cues: [{ id: 'c_phase', trigger: { type: 'phase', phase: 'p1' }, action: { type: 'look', look: 'l1' } }],
  });
  const start = clockToEpochMs('12:00', NOON_UTC, TZ);
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: {} });

  let state = defaultTimelineState();
  // Before the window: not active, no fire; currentPhase null.
  let r = evaluateTick({ now: start - 60000, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  assert.equal(r.state.currentPhase, null);
  state = r.state;

  // Entering window: rising edge fires.
  r = evaluateTick({ now: start, plan, state, mood: { party: 0 }, dayTimes });
  assert.deepEqual(r.fires, [{ cueId: 'c_phase', reason: 'phase' }]);
  assert.equal(r.state.currentPhase, 'p1');
  state = r.state;

  // Still inside: no re-fire.
  r = evaluateTick({ now: start + 60000, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  assert.equal(r.state.currentPhase, 'p1');
});

test('activePhase handles a midnight-crossing window', () => {
  const plan = basePlan({
    phases: { night: { start: { clock: '22:00' }, end: { clock: '06:00' } } },
  });
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: {} });
  const at23 = clockToEpochMs('23:00', NOON_UTC, TZ);
  const at03 = clockToEpochMs('03:00', NOON_UTC, TZ);
  const at12 = clockToEpochMs('12:00', NOON_UTC, TZ);
  assert.equal(activePhase({ plan, now: at23, dayTimes }), 'night');
  assert.equal(activePhase({ plan, now: at03, dayTimes }), 'night');
  assert.equal(activePhase({ plan, now: at12, dayTimes }), null);
});

test('mood calm->party fires only inside whenPhase, respects dwell and cooldown', () => {
  const plan = basePlan({
    phases: { party_night: { start: { clock: '12:00' }, end: { clock: '23:59' } } },
    cues: [{
      id: 'c_mood',
      trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 20, cooldownSec: 300, whenPhase: 'party_night' },
      action: { type: 'look', look: 'l1' },
    }],
  });
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: {} });
  const inPhase = clockToEpochMs('13:00', NOON_UTC, TZ); // inside party_night
  const sec = 1000;

  // Establish calm baseline inside the phase.
  let state = defaultTimelineState();
  let r = evaluateTick({ now: inPhase, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;

  // Flip to party: edge tick, dwell NOT yet satisfied → no fire.
  r = evaluateTick({ now: inPhase + sec, plan, state, mood: { party: 1 }, dayTimes });
  assert.equal(r.fires.length, 0, 'should not fire before dwell');
  state = r.state;

  // 10s later (still < 20s dwell): no fire.
  r = evaluateTick({ now: inPhase + 11 * sec, plan, state, mood: { party: 1 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;

  // 21s after the flip: dwell satisfied → fires.
  r = evaluateTick({ now: inPhase + 22 * sec, plan, state, mood: { party: 1 }, dayTimes });
  assert.deepEqual(r.fires, [{ cueId: 'c_mood', reason: 'mood' }]);
  state = r.state;

  // Flip back to calm then to party again within cooldown (300s): no fire.
  r = evaluateTick({ now: inPhase + 30 * sec, plan, state, mood: { party: 0 }, dayTimes });
  state = r.state;
  r = evaluateTick({ now: inPhase + 60 * sec, plan, state, mood: { party: 1 }, dayTimes });
  state = r.state;
  r = evaluateTick({ now: inPhase + 90 * sec, plan, state, mood: { party: 1 }, dayTimes });
  assert.equal(r.fires.length, 0, 'second flip within cooldown should not fire');
});

test('mood blip that reverts before dwell does NOT fire', () => {
  const plan = basePlan({
    phases: { party_night: { start: { clock: '12:00' }, end: { clock: '23:59' } } },
    cues: [{
      id: 'c_mood',
      trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 20, cooldownSec: 0, whenPhase: 'party_night' },
      action: { type: 'look', look: 'l1' },
    }],
  });
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: {} });
  const inPhase = clockToEpochMs('13:00', NOON_UTC, TZ);
  const sec = 1000;

  let state = defaultTimelineState();
  let r = evaluateTick({ now: inPhase, plan, state, mood: { party: 0 }, dayTimes });
  state = r.state;
  // Blip to party for 5s then back to calm.
  r = evaluateTick({ now: inPhase + 2 * sec, plan, state, mood: { party: 1 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;
  r = evaluateTick({ now: inPhase + 5 * sec, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0);
  state = r.state;
  // Stay calm well past 20s — the blip must never retroactively fire.
  r = evaluateTick({ now: inPhase + 40 * sec, plan, state, mood: { party: 0 }, dayTimes });
  assert.equal(r.fires.length, 0, 'reverted blip must not fire');
});

test('mood cue does not fire outside whenPhase', () => {
  const plan = basePlan({
    phases: { party_night: { start: { clock: '20:00' }, end: { clock: '23:59' } } },
    cues: [{
      id: 'c_mood',
      trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 0, cooldownSec: 0, whenPhase: 'party_night' },
      action: { type: 'look', look: 'l1' },
    }],
  });
  const dayTimes = resolveDayTimes({ plan, now: NOON_UTC, sunEvents: {} });
  const outside = clockToEpochMs('13:00', NOON_UTC, TZ); // not inside party_night

  let state = defaultTimelineState();
  let r = evaluateTick({ now: outside, plan, state, mood: { party: 0 }, dayTimes });
  state = r.state;
  r = evaluateTick({ now: outside + 1000, plan, state, mood: { party: 1 }, dayTimes });
  assert.equal(r.fires.length, 0, 'mood outside whenPhase must not fire');
});

test('evaluateTick never mutates the input state', () => {
  const plan = basePlan({
    phases: { p1: { start: { clock: '12:00' }, end: { clock: '14:00' } } },
    cues: [
      { id: 'c_phase', trigger: { type: 'phase', phase: 'p1' }, action: { type: 'look', look: 'l1' } },
      { id: 'c_clock', trigger: { type: 'clock', at: '12:00' }, action: { type: 'look', look: 'l1' } },
    ],
  });
  const start = clockToEpochMs('12:00', NOON_UTC, TZ);
  const dayTimes = resolveDayTimes({ plan, now: start, sunEvents: {} });
  const input = defaultTimelineState();
  const snapshot = structuredClone(input);
  const r = evaluateTick({ now: start, plan, state: input, mood: { party: 1 }, dayTimes });
  // Something fired (so the function did real work) ...
  assert.ok(r.fires.length > 0);
  // ... yet the input object is byte-for-byte unchanged.
  assert.deepEqual(input, snapshot);
  // and the returned state is a different object.
  assert.notEqual(r.state, input);
});

test('dayKeyFor formats YYYY-MM-DD in tz', () => {
  // 06:00 UTC on 2026-08-30 is 2026-08-29 23:00 PDT.
  const ms = new Date('2026-08-30T06:00:00Z').valueOf();
  assert.equal(dayKeyFor(ms, TZ), '2026-08-29');
});
