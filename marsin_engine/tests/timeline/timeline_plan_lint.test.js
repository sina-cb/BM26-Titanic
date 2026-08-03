/*
 * timeline_plan_lint.test.js — the SHOW PLAN LINT (report `_98` fix 4).
 *
 * The bug (`_93` §5.4): a `kind: program` cue is dispatched with
 * `autopilotOff: true`, so the service disarms the plan's baseline autopilot
 * BEFORE applying the cue's action. If that action declares no `autopilot` block
 * of its own, nothing re-arms pattern cycling and the deck FREEZES on a single
 * pattern for the whole hold — measured at 90 minutes for `c_sunrise` and 120
 * minutes each for the burn-night and temple holds on the shipped plan.
 *
 * `lintShowPlan` turns that from a 2am surprise into an AUTHORING error reported
 * at validation time. It is deliberately a LOUD DIAGNOSTIC rather than a throw:
 * the operator's shipped plan trips it today, and refusing to LOAD the running
 * show would trade a frozen pattern for a dark boat. See the rationale block on
 * `lintShowPlan` itself.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/timeline_plan_lint.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lintShowPlan, validateShowPlan, defaultShowPlan } from '../../lib/timeline/show_plan.js';

const TZ = 'America/Los_Angeles';

function makePlan(overrides = {}) {
  return validateShowPlan({
    schemaVersion: 2,
    name: 'lint_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {
      frozen: { playlist: 'show_pl', palette: 'deep_sea' },
      cycling: {
        playlist: 'show_pl', palette: 'deep_sea',
        autopilot: { active: true, delay_s: 60, shuffle: false },
      },
      mixer_only: { playlist: 'show_pl', target: { channel: 'mixer', id: 'ch1' } },
    },
    cues: [],
    ...overrides,
  });
}

const CUE = (over = {}) => ({
  id: 'c_show',
  label: 'Scheduled show',
  kind: 'program',
  trigger: { type: 'clock', at: '21:00' },
  action: { type: 'look', look: 'frozen' },
  hold: { min: 90 },
  ...over,
});

test('a program LOOK with no autopilot block is reported', () => {
  const plan = makePlan({ cues: [CUE()] });
  const findings = lintShowPlan(plan);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'program_action_no_autopilot');
  assert.equal(findings[0].severity, 'error');
  assert.equal(findings[0].cueId, 'c_show');
  assert.equal(findings[0].look, 'frozen');
  assert.match(findings[0].message, /FREEZE on one pattern/);
});

test('the same look WITH an autopilot block is clean', () => {
  const plan = makePlan({ cues: [CUE({ action: { type: 'look', look: 'cycling' } })] });
  assert.deepEqual(lintShowPlan(plan), []);
});

test('a program PLAYLIST action is linted the same way', () => {
  const frozen = makePlan({
    cues: [CUE({ action: { type: 'playlist', name: 'show_pl' } })],
  });
  assert.equal(lintShowPlan(frozen).length, 1);
  assert.equal(lintShowPlan(frozen)[0].look, null);

  const cycling = makePlan({
    cues: [CUE({
      action: {
        type: 'playlist', name: 'show_pl',
        autopilot: { active: true, delay_s: 30, shuffle: true },
      },
    })],
  });
  assert.deepEqual(lintShowPlan(cycling), []);
});

test('only PROGRAM cues are linted — ambient/mood never disarm the baseline', () => {
  for (const kind of ['ambient', 'mood']) {
    const cue = kind === 'mood'
      ? CUE({ kind, trigger: { type: 'mood', from: 'calm', to: 'party' } })
      : CUE({ kind });
    assert.deepEqual(lintShowPlan(makePlan({ cues: [cue] })), [], `kind ${kind}`);
  }
});

test('a disabled cue, a non-deck target and a disabled plan baseline are all exempt', () => {
  assert.deepEqual(lintShowPlan(makePlan({ cues: [CUE({ enabled: false })] })), [],
    'a disabled cue never fires, so it can never freeze the deck');
  assert.deepEqual(
    lintShowPlan(makePlan({ cues: [CUE({ action: { type: 'look', look: 'mixer_only' } })] })), [],
    'a mixer-only look never touches the deck baseline');
  const noBaseline = makePlan({
    autopilot: {
      enabled: false, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    cues: [CUE()],
  });
  assert.deepEqual(lintShowPlan(noBaseline), [],
    'with the plan baseline off the deck was never cycling — nothing to freeze');
});

test('a program cue with a non-deck-content action (scene/tasks) is exempt', () => {
  const plan = makePlan({ cues: [CUE({ action: { type: 'tasks', enable: ['t1'], disable: [] } })] });
  assert.deepEqual(lintShowPlan(plan), []);
});

test('lint is PURE — it never mutates the plan', () => {
  const plan = makePlan({ cues: [CUE()] });
  const before = JSON.stringify(plan);
  lintShowPlan(plan);
  assert.equal(JSON.stringify(plan), before);
});

test('VERDICT on the engine built-in default plan (finding, not fix)', () => {
  // `_98` fix 4 asks for the verdict on record. The engine's own template trips
  // the rule on the same looks the operator's on-disk plan does — `sunrise`,
  // `burn_night` and `temple` are all program looks with no autopilot block.
  // Recorded here rather than "fixed" because changing the template is an
  // authoring decision (does a held show CYCLE?), and the plan must still LOAD.
  const findings = lintShowPlan(validateShowPlan(defaultShowPlan()));
  assert.deepEqual(findings.map((f) => f.cueId).sort(), ['c_burn_night', 'c_sunrise', 'c_temple']);
  for (const f of findings) assert.equal(f.code, 'program_action_no_autopilot');
});
