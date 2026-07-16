import test from 'node:test';
import assert from 'node:assert/strict';

import { validateShowPlan } from '../../lib/timeline/show_plan.js';
import { defaultTimelineState } from '../../lib/timeline/timeline_state.js';
import { arbitrate, resolveHold } from '../../lib/timeline/arbiter.js';

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

test('program expiry + mood fire same tick → [resume, mood], mood wins (Fix 4)', () => {
  const plan = makePlan();
  const state = baseState({
    controller: 'program',
    activeProgram: { cueId: 'c_program', startedAtMs: NOW - 600000, untilMs: NOW - 1000 },
  });
  const r = arbitrate({
    now: NOW, plan, state,
    fires: [{ cueId: 'c_mood', reason: 'mood' }],
    dayTimes: DAY_TIMES,
  });
  assert.equal(r.controller, 'autopilot');
  assert.equal(r.state.activeProgram, null);
  // Resume MUST come first so the baseline re-arms, then the mood swap lands on
  // top and wins (a server applies actions in order).
  assert.equal(r.actions.length, 2);
  assert.equal(r.actions[0].cueId, '__autopilot_resume__');
  assert.equal(r.actions[1].cueId, 'c_mood');
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

// Post-§16: ap-off + idle is a MANUAL sub-state, so a due program ARMS a lease
// instead of firing immediately (covered in detail by V6 below).
test('autopilot disabled (idle) → program cue arms a lease, does NOT fire', () => {
  const plan = makePlan();
  const state = baseState({ autopilotEnabled: false, controller: 'manual' });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
  assert.equal(r.state.pendingProgram.cueId, 'c_program');
});

test('autopilot disabled → mood fire is suppressed (no autopilot layer)', () => {
  const plan = makePlan();
  const state = baseState({ autopilotEnabled: false, controller: 'manual' });
  const r = arbitrate({ now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 0);
});

test('overridden (takeover) → nothing fires (program suppressed under takeover)', () => {
  const plan = makePlan();
  const state = baseState({ mode: 'overridden' });
  const r = arbitrate({
    now: NOW, plan, state,
    fires: [{ cueId: 'c_program', reason: 'manual' }, { cueId: 'c_mood', reason: 'mood' }],
    dayTimes: DAY_TIMES,
  });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
});

test('ambient cue applies when not manual, drops under a takeover', () => {
  const plan = makePlan();
  // autopilot → ambient applies.
  let r = arbitrate({ now: NOW, plan, state: baseState(), fires: [{ cueId: 'c_ambient', reason: 'manual' }], dayTimes: DAY_TIMES });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_ambient');
  // overridden → ambient drops.
  r = arbitrate({ now: NOW, plan, state: baseState({ mode: 'overridden' }), fires: [{ cueId: 'c_ambient', reason: 'manual' }], dayTimes: DAY_TIMES });
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

// ── docs/38 §16 pending-program lease (arbiter pure-core coverage) ────────────

// V6 — MANUAL(idle, ap-off) + program due → lease ARMED, NOT fired, controller
// stays manual. The lease carries cueId/label/action + armed/expires stamps.
test('V6: MANUAL(idle) + program due → pendingProgram armed, not fired', () => {
  const plan = makePlan();
  const state = baseState({ autopilotEnabled: false, controller: 'manual' });
  const r = arbitrate({
    now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'sun' }],
    dayTimes: DAY_TIMES, leaseSec: 30,
  });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0, 'nothing fires while a lease is armed');
  assert.equal(r.state.activeProgram, null);
  assert.equal(r.state.pendingProgram.cueId, 'c_program');
  assert.equal(r.state.pendingProgram.armedAtMs, NOW);
  assert.equal(r.state.pendingProgram.expiresAtMs, NOW + 30 * 1000);
  assert.deepEqual(r.state.pendingProgram.action, { type: 'look', look: 'sunrise' });
});

// V6b — OVERRIDDEN (operator takeover) also arms a lease. (PAUSED/HOLDING were
// removed 2026-07-03; takeover is the only manual sub-state now.)
test('V6b: OVERRIDDEN + program due → lease armed (not fired)', () => {
  const plan = makePlan();
  const state = baseState({ mode: 'overridden' });
  const r = arbitrate({
    now: NOW, plan, state, fires: [{ cueId: 'c_program', reason: 'sun' }],
    dayTimes: DAY_TIMES, leaseSec: 30,
  });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
  assert.equal(r.state.pendingProgram.cueId, 'c_program');
});

// V7 — lease past expiry (now ≥ expiresAtMs) → auto-start: activeProgram set,
// pending cleared, controller=program, autopilotOff emitted (show goes on, I2).
test('V7: pending + now≥expiresAtMs → auto-start program', () => {
  const plan = makePlan();
  const state = baseState({
    autopilotEnabled: false, controller: 'manual',
    pendingProgram: {
      cueId: 'c_program', label: 'Sunrise', action: { type: 'look', look: 'sunrise' },
      armedAtMs: NOW - 31000, expiresAtMs: NOW - 1000,
    },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [], dayTimes: DAY_TIMES, leaseSec: 30 });
  assert.equal(r.controller, 'program');
  assert.equal(r.state.pendingProgram, null);
  assert.equal(r.state.activeProgram.cueId, 'c_program');
  assert.equal(r.state.activeProgram.startedAtMs, NOW);
  assert.equal(r.state.activeProgram.untilMs, NOW + 90 * 60000); // hold {min:90}
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].cueId, 'c_program');
  assert.equal(r.actions[0].autopilotOff, true);
});

// V10 — OVERRIDDEN + lease past expiry still auto-starts (show goes on even
// during a takeover).
test('V10: OVERRIDDEN pending + lease-exp → auto-start (show goes on)', () => {
  const plan = makePlan();
  const state = baseState({
    mode: 'overridden',
    pendingProgram: {
      cueId: 'c_program', label: 'Sunrise', action: { type: 'look', look: 'sunrise' },
      armedAtMs: NOW - 31000, expiresAtMs: NOW - 1000,
    },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [], dayTimes: DAY_TIMES, leaseSec: 30 });
  assert.equal(r.controller, 'program');
  assert.equal(r.state.pendingProgram, null);
  assert.equal(r.state.activeProgram.cueId, 'c_program');
  assert.equal(r.actions[0].autopilotOff, true);
});

// A newer due program replaces an un-actioned pending lease (one at a time).
test('newer program due replaces an un-actioned pending lease', () => {
  const plan = makePlan({
    looks: { sunrise: { playlist: 'default' }, party: { playlist: 'default' }, dusk: { playlist: 'default' } },
    cues: [
      { id: 'c_program', kind: 'program', trigger: { type: 'manual' }, action: { type: 'look', look: 'sunrise' }, hold: { min: 90 } },
      { id: 'c_program2', kind: 'program', trigger: { type: 'manual' }, action: { type: 'look', look: 'dusk' }, hold: { min: 30 } },
    ],
  });
  const state = baseState({
    mode: 'overridden',
    pendingProgram: {
      cueId: 'c_program', label: 'Sunrise', action: { type: 'look', look: 'sunrise' },
      armedAtMs: NOW - 5000, expiresAtMs: NOW + 25000,
    },
  });
  const r = arbitrate({
    now: NOW, plan, state, fires: [{ cueId: 'c_program2', reason: 'sun' }],
    dayTimes: DAY_TIMES, leaseSec: 30,
  });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
  assert.equal(r.state.pendingProgram.cueId, 'c_program2');
  assert.equal(r.state.pendingProgram.expiresAtMs, NOW + 30 * 1000);
});

// Mood never arms a lease — still suppressed in manual (no pending created).
test('mood in MANUAL is suppressed and arms NO lease', () => {
  const plan = makePlan();
  const state = baseState({ mode: 'overridden' });
  const r = arbitrate({
    now: NOW, plan, state, fires: [{ cueId: 'c_mood', reason: 'mood' }],
    dayTimes: DAY_TIMES, leaseSec: 30,
  });
  assert.equal(r.actions.length, 0);
  assert.equal(r.state.pendingProgram, null);
});

// A pending lease that has NOT yet expired survives an idle tick unchanged.
test('un-expired pending survives a quiet tick (no fire, stays pending)', () => {
  const plan = makePlan();
  const state = baseState({
    mode: 'overridden',
    pendingProgram: {
      cueId: 'c_program', label: 'Sunrise', action: { type: 'look', look: 'sunrise' },
      armedAtMs: NOW - 5000, expiresAtMs: NOW + 25000,
    },
  });
  const r = arbitrate({ now: NOW, plan, state, fires: [], dayTimes: DAY_TIMES, leaseSec: 30 });
  assert.equal(r.controller, 'manual');
  assert.equal(r.actions.length, 0);
  assert.equal(r.state.pendingProgram.cueId, 'c_program');
});
