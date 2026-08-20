/*
 * clock_backstep_clamp.test.js — regression for L2 (report _116 / _115):
 * a BACKWARD wall-clock step permanently strands the party cue.
 *
 * The mood dwell + cooldown gates in triggers.js compare `now` against ABSOLUTE
 * epoch stamps persisted in state (`moodSince`, `moodLastFire[id]`). The playa
 * has no internet, so an RTC drift or a BIOS AC-restore boot can step the wall
 * clock BACKWARD — after which those stamps sit in the FUTURE relative to `now`,
 * `now - stamp` goes NEGATIVE, and dwell/cooldown can never satisfy: the party
 * cue never fires again for the duration of the jump. The fix clamps any
 * future-dated stamp down to `now` (negative elapsed = "just happened"), so a
 * backward step becomes a self-healing re-arm.
 *
 * Flipped from the red-team repro (~/tmp/redteam_api / _115 L2) into a GREEN
 * regression. Pure — no engine, no IO.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateTick } from '../../lib/timeline/triggers.js';

const PARTY_CUE = 'c_mood_to_party';

const triggerPlan = () => ({
  location: { tz: 'America/Los_Angeles' },
  phases: {},
  cues: [{
    id: PARTY_CUE,
    enabled: true,
    trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 120, cooldownSec: 120 },
    action: { type: 'look', look: 'party_high' },
    kind: 'mood',
  }],
});
const triggerDayTimes = () => ({ phases: {}, cueTimes: {}, sunEvents: {}, tz: 'America/Los_Angeles' });

test('L2: a state whose mood stamps are in the FUTURE (clock stepped back) is clamped to now', () => {
  const now = 1_000_000_000;
  // Simulate a 6-hour backward clock step: the persisted stamps were written
  // when the clock read 6 h LATER than it does now.
  const future = now + 6 * 3600 * 1000;
  const state = {
    firedToday: {}, moodLastFire: { [PARTY_CUE]: future }, moodArmed: { [PARTY_CUE]: true },
    dayKey: null, prevMood: 1, moodSince: future, currentPhase: null,
  };
  const r = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyEnabled: true,
  });
  // The clamp pulled both future stamps down to `now` (re-derive).
  assert.equal(r.state.moodSince, now, 'moodSince must be clamped to now');
  assert.equal(r.state.moodLastFire[PARTY_CUE], now, 'moodLastFire must be clamped to now');
  // dwell just restarted from `now`, so it does NOT fire on this exact tick…
  assert.equal(r.fires.length, 0, 'dwell restarts at the clamp — no instant fire');
});

test('L2: after the clamp the party cue SELF-HEALS and fires again (was stranded forever)', () => {
  const now = 1_000_000_000;
  const future = now + 24 * 3600 * 1000; // a full day backward step
  let state = {
    firedToday: {}, moodLastFire: { [PARTY_CUE]: future }, moodArmed: { [PARTY_CUE]: true },
    dayKey: null, prevMood: 1, moodSince: future, currentPhase: null,
  };
  // Tick 1 at `now` — clamp both stamps to now, dwell restarts.
  const t1 = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyEnabled: true,
  });
  assert.equal(t1.fires.length, 0);
  state = t1.state;
  // Tick 2 well past the 120 s dwell AND cooldown (both restarted at `now`),
  // party sustained the whole time → it FIRES. Before the clamp this could
  // never happen: `now - moodSince` stayed negative for the whole 24 h jump.
  const later = now + 130_000;
  const t2 = evaluateTick({
    now: later, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyEnabled: true,
  });
  assert.deepEqual(t2.fires.map((f) => f.cueId), [PARTY_CUE],
    'the party cue must fire again after a backward clock step — no permanent strand');
});

test('L2: a NORMAL (past) stamp is left untouched — the clamp only pulls FUTURE stamps', () => {
  const now = 1_000_000_000;
  const past = now - 500_000; // 500 s ago — dwell already satisfied
  const state = {
    firedToday: {}, moodLastFire: {}, moodArmed: { [PARTY_CUE]: true },
    dayKey: null, prevMood: 1, moodSince: past, currentPhase: null,
  };
  const r = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyEnabled: true,
  });
  assert.equal(r.state.moodSince, past, 'a past moodSince must not be clamped');
  assert.deepEqual(r.fires.map((f) => f.cueId), [PARTY_CUE], 'a normally-satisfied dwell still fires');
});
