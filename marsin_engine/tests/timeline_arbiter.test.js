import test from 'node:test';
import assert from 'node:assert/strict';

import { validateShowPlan } from '../companions/timeline/show_plan.js';
import { defaultTimelineState } from '../companions/timeline/timeline_state.js';
import { arbitrate, resolveHold } from '../companions/timeline/arbiter.js';

const TZ = 'America/Los_Angeles';
const LOC = { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 };
const NOW = new Date('2026-08-30T12:00:00Z').valueOf();

// A plan with one program cue (sunrise, manual trigger so we can fire it on
// demand), one mood cue, and one ambient cue.
function makePlan(overrides) {
  return validateShowPlan({
    schemaVersion: 1,
    name: 'arb_plan',
    location: LOC,
    autopilot: { enabled: true, playlist: 'night', delay_s: 45, shuffle: true, mood: true },
    phases: {},
    looks: { sunrise: { playlist: 'default' }, party: { playlist: 'default' } },
    cues: [
      {
        id: 'c_program', kind: 'program', trigger: { type: 'manual' },
        action: { type: 'look', look: 'sunrise' }, hold: { min: 90 },
      },
      {
        id: 'c_mood', trigger: { type: 'mood', from: 'calm', to: 'party' },
        action: { type: 'look', look: 'party' },
      },
      {
        id: 'c_ambient', kind: 'ambient', trigger: { type: 'manual' },
        action: { type: 'globals', set: { master: 0.3 } },
      },
    ],
    ...overrides,
  });
}

function baseState(overrides) {
  return { ...defaultTimelineState(), ...overrides };
}

// dayTimes shape the arbiter consumes (tz + sunEvents for hold anchors).
const DAY_TIMES = { phases: {}, cueTimes: {}, tz: TZ, sunEvents: {} };

test('program fire preempts autopilot: autopilotOff emitted, controller program', () => {
  const plan = makePlan();
  const state = baseState();
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'program');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_program');
  assert.equal(r.actions[0].autopilotOff, true);
  assert.equal(r.state.activeProgram.cueId, 'c_program');
  assert.equal(r.state.activeProgram.untilMs, NOW + 90 * 60000);
});

test('mood fire is SUPPRESSED while a program is active (no action emitted)', () => {
  const plan = makePlan();
  const state = baseState({
    controller: 'program',
    activeProgram: { cueId: 'c_program', startedAtMs: NOW - 1000, untilMs: NOW + 600000 },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'program');
  assert.equal(r.actions.length, 0);
});

test('mood fire is APPLIED under autopilot', () => {
  const plan = makePlan();
  const state = baseState();   // autopilotEnabled true, no program
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'autopilot');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_mood');
  assert.equal(r.actions[0].autopilotOff, undefined);
});

test('mood is dropped when plan.autopilot.mood === false', () => {
  const plan = makePlan({
    autopilot: { enabled: true, playlist: 'night', delay_s: 45, shuffle: true, mood: false },
  });
  const state = baseState();
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 0);
});

test('program expiry emits resume + controller autopilot', () => {
  const plan = makePlan();
  const state = baseState({
    controller: 'program',
    activeProgram: { cueId: 'c_program', startedAtMs: NOW - 600000, untilMs: NOW - 1000 },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'autopilot');
  assert.equal(r.state.activeProgram, null);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, '__autopilot_resume__');
  assert.equal(r.actions[0].action.type, '__resume_autopilot__');
});

test('program expiry with autopilot disabled → manual, no resume', () => {
  const plan = makePlan();
  const state = baseState({
    autopilotEnabled: false,
    controller: 'program',
    activeProgram: { cueId: 'c_program', startedAtMs: NOW - 600000, untilMs: NOW - 1000 },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'manual');
  assert.equal(r.state.activeProgram, null);
  assert.equal(r.actions.length, 0);
});

test('autopilot disabled → controller manual, but a program cue still fires', () => {
  const plan = makePlan();
  const state = baseState({ autopilotEnabled: false, controller: 'manual' });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'program');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_program');
  assert.equal(r.actions[0].autopilotOff, true);
});

test('autopilot disabled → mood fire is suppressed (no autopilot layer)', () => {
  const plan = makePlan();
  const state = baseState({ autopilotEnabled: false, controller: 'manual' });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 0);
});

test('paused → nothing fires (program suppressed under hard takeover)', () => {
  const plan = makePlan();
  const state = baseState({ mode: 'paused' });
  const r = arbitrate({
    now: NOW, plan, state,
    fires: [{ cueId: 'c_program', reason: 'manual' }, { cueId: 'c_mood', reason: 'mood' }],
    dayTimes: DAY_TIMES,
  });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
});

test('holding → program suppressed, controller manual', () => {
  const plan = makePlan();
  const state = baseState({ mode: 'armed', manualHoldUntilMs: NOW + 600000 });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
});

test('ambient cue applies when not manual, drops under manual', () => {
  const plan = makePlan();
  // autopilot → ambient applies.
  let r = arbitrate({ now: NOW, plan, state: baseState(), fires: [{ cueId: 'c_ambient', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_ambient');
  // paused → ambient drops.
  r = arbitrate({ now: NOW, plan, state: baseState({ mode: 'paused' }), fires: [{ cueId: 'c_ambient', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 0);
});

test('program with hold:{min} sets untilMs = now + min*60000', () => {
  const plan = makePlan();
  const r = arbitrate({ now: NOW, plan, state: baseState(), fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.state.activeProgram.untilMs, NOW + 90 * 60000);
});

test('program without hold → untilMs null (holds until next program)', () => {
  const plan = makePlan({
    cues: [{ id: 'c_program', kind: 'program', trigger: { type: 'manual' }, action: { type: 'look', look: 'sunrise' } }],
  });
  const r = arbitrate({ now: NOW, plan, state: baseState(), fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.state.activeProgram.untilMs, null);
});

test('mood is suppressed on the SAME tick a program starts', () => {
  const plan = makePlan();
  const state = baseState();
  const r = arbitrate({
    now: NOW, plan, state,
    fires: [{ cueId: 'c_program', reason: 'manual' }, { cueId: 'c_mood', reason: 'mood' }],
    dayTimes: DAY_TIMES,
  });
  // only the program action — mood dropped because the program took this tick.
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_program');
  assert.equal(r.controller, 'program');
});

test('arbitrate is pure: input state is not mutated', () => {
  const plan = makePlan();
  const state = baseState();
  const snapshot = JSON.stringify(state);
  arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(JSON.stringify(state), snapshot);
});

test('resolveHold: min, until clock anchor, and omitted', () => {
  assert.equal(resolveHold({ min: 30 }, NOW, DAY_TIMES), NOW + 30 * 60000);
  assert.equal(resolveHold(undefined, NOW, DAY_TIMES), null);
  assert.equal(resolveHold(null, NOW, DAY_TIMES), null);
  const untilMs = resolveHold({ until: { clock: '06:30' } }, NOW, DAY_TIMES);
  assert.equal(typeof untilMs, 'number');
});
