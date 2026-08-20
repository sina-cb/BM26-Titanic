// SPECIAL EVENTS — the authored FLASH RELEASE reaches the controller
// (docs/57 §2.4, report `_240`).
//
// The envelope math is pinned in tests/effects/effect_release_envelope.test.js.
// THIS file pins the RUNNER's half of the contract, which is entirely about
// which calls carry the release opts and which deliberately do not:
//
//   • a `holdMs` pulse's expiry passes { releaseMs, releaseTo };
//   • an explicit `state: false` unlatch passes them too;
//   • an action that authors NO release leaves setEffect a TWO-ARGUMENT call —
//     `undefined` opts, not `{ releaseMs: 0 }` — so the historical hard cut is
//     bit-for-bit what it always was;
//   • a rising edge never carries a release;
//   • `_releaseAllEffects()` (FINISH / ABORT / PANIC teardown) is ALWAYS
//     instant. A teardown must not linger in a decay tail — panic precedence,
//     docs/52 §4.2. This is the assertion that stops someone "helpfully"
//     threading the opts through the teardown path later;
//   • a strobe burst forwards its fadeOutMs and waits out the fade before the
//     runner's own hard stop lands.
//
// Fake deps throughout: this is about the CALLS, so the calls are what is
// recorded. The service is driven through its action entry point directly —
// no engine, no ports, no sockets.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import '../helpers/setup_config_guard.mjs';
import { SpecialEventsService } from '../../lib/special_events/special_events_service.js';
import { validateAction } from '../../lib/special_events/show_schema.js';

/** Every dep the service requires, recording the two we care about. */
function makeService({ nowFn = null, timeline = null } = {}) {
  const calls = {
    setEffect: [], startStrobe: [], strobe: [], stopStrobe: 0,
    recalls: [], timelineRelease: [],
  };
  const noop = () => {};
  const deps = {
    activatePlaylist: noop,
    listPlaylists: () => [],
    inspectPlaylist: () => ({ exists: true, entries: 1, loadable: 1, missingPatterns: [] }),
    setDeckControl: noop,
    fadeMaster: noop,
    setMaster: noop,
    getMaster: () => 1,
    setGlobals: noop,
    captureGlobals: () => ({}),
    setEffect: (...args) => calls.setEffect.push(args),
    startStrobe: (...args) => calls.startStrobe.push(args),
    fireStrobeBurst: (...args) => calls.strobe.push(args),
    stopStrobe: () => { calls.stopStrobe += 1; },
    captureSnapshot: noop,
    recallSnapshotFade: (...args) => calls.recalls.push(args),
    getAutopilotFlags: () => ({ patternAutopilot: false, colorAutopilot: null }),
    setPatternAutopilot: noop,
    setColorAutopilot: noop,
    getPatternAutopilot: () => ({ active: false, delay_s: 30, shuffle: false, nextSwapAtMs: null }),
    getDeckTransition: () => ({ enabled: false }),
    setDeckTransition: noop,
    getDeckNowPlaying: () => null,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-release-'));
  const svc = new SpecialEventsService({
    scene: 'test_bench',
    showsDir: path.join(dir, 'shows'),
    stateDir: path.join(dir, 'state'),
    deps,
    broadcast: noop,
    nowFn,
    timeline,
  });
  return { svc, calls, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const effect = (raw) => validateAction({ type: 'effect', ...raw }, 'a');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a pulse\'s hold-expiry carries the authored release opts', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  svc._applyEffectAction(effect({
    effectId: 'blastWhite', holdMs: 40, releaseMs: 700, releaseTo: 'show',
  }));
  // The rising edge is a plain ON — nothing to release yet.
  assert.deepEqual(calls.setEffect[0], ['blastWhite', true]);

  await sleep(160);
  assert.equal(calls.setEffect.length, 2, 'the hold must have expired by now');
  assert.deepEqual(calls.setEffect[1],
    ['blastWhite', false, { releaseMs: 700, releaseTo: 'show' }],
    'the falling edge is where the release rides');
});

test('an explicit unlatch carries the release; a latch ON never does', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  svc._applyEffectAction(effect({ effectId: 'uvBlast', state: true }));
  assert.deepEqual(calls.setEffect[0], ['uvBlast', true],
    'a rising edge is a two-argument call — there is no falling edge to soften');

  svc._applyEffectAction(effect({
    effectId: 'uvBlast', state: false, releaseMs: 800, releaseTo: 'dark',
  }));
  assert.deepEqual(calls.setEffect[1],
    ['uvBlast', false, { releaseMs: 800, releaseTo: 'dark' }]);
});

// This is the backwards-compatibility assertion. `undefined` (not `{}` and not
// `{releaseMs: 0}`) is what keeps every pre-existing show file meaning exactly
// what it always meant.
test('an action with NO authored release leaves setEffect a two-argument call', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  svc._applyEffectAction(effect({ effectId: 'blastWhite', holdMs: 40 }));
  await sleep(160);
  assert.equal(calls.setEffect.length, 2);
  assert.deepEqual(calls.setEffect[1], ['blastWhite', false],
    'no opts argument at all — the historical hard cut, bit for bit');
  assert.equal(calls.setEffect[1].length, 2);

  svc._applyEffectAction(effect({ effectId: 'vintageWhite', state: false }));
  assert.deepEqual(calls.setEffect[2], ['vintageWhite', false]);
  assert.equal(calls.setEffect[2].length, 2,
    'and a plain unlatch stays two-argument too, so vintageWhite keeps riding '
    + 'its configured fire-sync release');
});

// The line that must not move: a teardown is a STOP.
test('_releaseAllEffects is ALWAYS instant, even for a stage that authored a release', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  // Latch two slams ON, both authored with generous releases.
  svc._applyEffectAction(effect({ effectId: 'blastWhite', state: true }));
  svc._applyEffectAction(effect({ effectId: 'uvBlast', state: true }));
  calls.setEffect.length = 0;

  svc._releaseAllEffects();

  assert.equal(calls.setEffect.length, 2, 'both latched effects come back off');
  for (const call of calls.setEffect) {
    assert.equal(call[1], false);
    assert.equal(call.length, 2,
      `teardown must not carry a release (${call[0]}) — FINISH / ABORT / PANIC `
      + 'must never linger in a decay tail');
  }
});

test('a strobe burst forwards fadeOutMs and waits the fade out before stopping', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  svc._applyEffectAction(effect({
    effectId: 'strobe', hz: 6, durationMs: 40, fadeOutMs: 400,
  }));
  assert.deepEqual(calls.strobe[0], [6, 40, 400], 'hz, duration, and the soft exit');

  // The runner's own cleanup must land AFTER the fade, or it would cut it.
  await sleep(160);
  assert.equal(calls.stopStrobe, 0,
    "the runner's hard stop must not land during the fade tail");
});

test('a strobe burst with no fadeOutMs snaps off exactly as before', async (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);

  svc._applyEffectAction(effect({ effectId: 'strobe', hz: 6, durationMs: 40 }));
  assert.deepEqual(calls.strobe[0], [6, 40, 0], 'fadeOutMs 0 is the snap-off default');
});

test('a strobe toggle alternates ON/OFF and teardown always forces it off', (t) => {
  const { svc, calls, cleanup } = makeService();
  t.after(cleanup);
  const toggle = effect({ effectId: 'strobe', hz: 6, toggle: true });

  svc._applyEffectAction(toggle);
  assert.deepEqual(calls.startStrobe, [[6]]);
  assert.equal(calls.stopStrobe, 0);

  svc._applyEffectAction(toggle);
  assert.equal(calls.stopStrobe, 1);

  svc._applyEffectAction(toggle);
  svc._releaseAllEffects();
  assert.equal(calls.stopStrobe, 2, 'terminal teardown stops a latched toggle');
});

test('the absolute show lease expires from ARM time and cannot be refreshed', async (t) => {
  let now = 0;
  let activityCalls = 0;
  let releaseCalls = 0;
  const timeline = {
    authorityHeld: () => true,
    activity: () => { activityCalls += 1; },
    release: () => { releaseCalls += 1; },
  };
  const { svc, calls, cleanup } = makeService({ nowFn: () => now, timeline });
  t.after(cleanup);
  svc.run = {
    status: 'armed',
    showId: 'demo',
    show: { name: 'Demo', stages: [] },
    stageIndex: null,
    stageId: null,
    choiceId: null,
    armedAtMs: 0,
    startedAtMs: null,
    stageStartedAtMs: null,
    countdownEndsAtMs: null,
    leaseExpiresAtMs: 1800000,
    leaseHeld: true,
    priorPatternAutopilot: { active: false, delay_s: 30, shuffle: false },
    priorColorAutopilot: null,
    priorDeckTransition: { enabled: false },
    priorGlobals: {},
    priorMaster: 1,
    autopilot: null,
    autopilotStageId: null,
  };
  svc._broadcast = () => {};

  now = 1799999;
  await svc._tick();
  assert.ok(svc.run, 'one millisecond before expiry the show still holds');
  assert.equal(activityCalls, 1, 'the short timeline lease is refreshed before the hard stop');

  now = 1800000;
  await svc._tick();
  assert.equal(svc.run, null, 'the absolute deadline disarms the show');
  assert.equal(svc.ended.reason, 'finished');
  assert.match(svc.ended.detail, /lease expired/);
  assert.deepEqual(calls.recalls, [['ev_prev', 3000]], 'expiry restores the pre-show snapshot');
  assert.equal(activityCalls, 1, 'activity at the deadline cannot renew the absolute lease');
  assert.equal(releaseCalls, 1, 'expiry releases timeline authority');
});
