// Regression: the "Follow the DJ: calm -> party" cue MUST auto-fire from the
// audio-analysis mood signal during the party-night AUTOPILOT window — it must
// not be suppressed by a hanging program. Pins the default-plan structure that
// makes this true (party_start is ambient, golden-hour show has a hold).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaultShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';
import { arbitrate } from '../../lib/timeline/arbiter.js';

const baseState = () => ({
  autopilotEnabled: true,
  mode: 'armed',
  activeProgram: null,
});

const dayTimes = (plan) => ({ phases: {}, sunEvents: {}, tz: plan.location.tz });

test('default plan: calm->party mood AUTO-fires during party_night autopilot', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const r = arbitrate({
    now: Date.now(), plan, state: baseState(),
    fires: [{ cueId: 'c_mood_to_party', reason: 'mood:calm->party' }],
    dayTimes: dayTimes(plan),
  });
  assert.equal(r.controller, 'autopilot');
  assert.ok(
    r.actions.some((a) => a.cueId === 'c_mood_to_party'),
    'the mood cue action must be applied automatically (not suppressed)',
  );
});

test('default plan: party_start is AMBIENT — never a blocking program', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const cue = plan.cues.find((c) => c.id === 'c_party_start');
  assert.equal(cue.kind, 'ambient', 'party_start must be ambient so it does not suppress mood');
  const r = arbitrate({
    now: Date.now(), plan, state: baseState(),
    fires: [{ cueId: 'c_party_start', reason: 'phase:party_night' }],
    dayTimes: dayTimes(plan),
  });
  assert.equal(r.state.activeProgram, null, 'ambient cue must not set activeProgram');
  assert.equal(r.controller, 'autopilot');
});

test('precedence still holds: mood SUPPRESSED while a program is active', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const now = Date.now();
  const state = {
    ...baseState(),
    activeProgram: { cueId: 'c_visibility_on', startedAtMs: now - 1000, untilMs: now + 60_000 },
  };
  const r = arbitrate({
    now, plan, state,
    fires: [{ cueId: 'c_mood_to_party', reason: 'mood:calm->party' }],
    dayTimes: dayTimes(plan),
  });
  assert.equal(r.controller, 'program');
  assert.ok(
    !r.actions.some((a) => a.cueId === 'c_mood_to_party'),
    'mood must be suppressed while a program owns the window',
  );
});

test('default plan: golden-hour show has a hold so it returns to autopilot', () => {
  const plan = validateShowPlan(defaultShowPlan());
  const cue = plan.cues.find((c) => c.id === 'c_visibility_on');
  assert.equal(cue.kind, 'program');
  assert.ok(cue.hold && cue.hold.min > 0, 'golden-hour program must hold then release to autopilot');
});
