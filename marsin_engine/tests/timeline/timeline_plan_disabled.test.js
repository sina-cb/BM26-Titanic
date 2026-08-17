// ══ PLAN DISABLED = TOTALLY INERT — OPERATOR-CRITICAL INVARIANT ═══════════
//
// Operator ruling 2026-08-14: "When the timeline plan is disabled or not
// enabled: the Deck and other places must NOT show the plan warning; the plan
// is ACTUALLY disabled — not active anymore; all active cues end right away.
// Please make that a bulletproof mechanism."
//
// Every test here pins one clause of that invariant. If one of them starts
// failing, a disabled plan has begun owning something again — that is a show
// bug, not a test nuance. See TimelineService.planEnabled / _goDormant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [], forceDeckView: [], releaseDeckView: [] };
  const viewState = { mode: null, source: null };
  const deps = {
    loadPlaylist: (a) => { calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    setMaster: () => {},
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => { calls.forceDeckView.push(true); viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      calls.releaseDeckView.push(true);
      if (viewState.mode === 'deck' && viewState.source === 'plan') {
        viewState.mode = null;
        viewState.source = null;
      }
    },
    getViewOverrideMode: () => viewState.mode,
  };
  calls.viewState = viewState;
  return { deps, calls };
}

function makePlan() {
  return {
    schemaVersion: 1,
    name: 'disable_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: false,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: { show: { playlist: 'show_pl' } },
    cues: [
      {
        id: 'c_show',
        label: 'Scheduled show',
        kind: 'program',
        trigger: { type: 'clock', at: '12:00' },
        action: { type: 'look', look: 'show' },
        hold: { min: 90 },
      },
    ],
  };
}

// 11:59 PT the day before the cue, so a test can step the clock across 12:00.
const BEFORE_CUE_MS = Date.UTC(2026, 7, 30, 18, 59, 0);

function setup({ stateDir: reuseStateDir } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-disabled-'));
  const sceneDir = path.join(dir, 'scene');
  const stateDir = reuseStateDir || path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(makePlan(), path.join(sceneDir, 'disable_plan.yaml'));

  const { deps, calls } = makeDeps();
  const clock = { now: BEFORE_CUE_MS };
  const svc = new TimelineService({
    scene: 'test_bench',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'disable_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: [],
    },
    nowFn: () => clock.now,
  });
  return { svc, calls, clock, stateDir, sceneDir };
}

test('DISABLE ends an active program immediately — not at its natural end', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  await svc.fireCue('c_show');
  assert.equal(svc.state.activeProgram.cueId, 'c_show', 'program is running');
  assert.equal(svc.getState().planActive, true);

  await svc.setAutopilotEnabled(false);

  assert.equal(svc.state.activeProgram, null, 'the active cue must END on disable, not later');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.getState().planActive, false, 'a disabled plan is never planActive');
  assert.equal(calls.viewState.mode, null, 'the plan deck-pin must be released on disable');
});

test('DISABLE clears a pending program lease and no lease can arm while disabled', async () => {
  const { svc, clock } = setup();
  await svc.start();
  svc.takeover();                       // manual owner → a due program arms a lease
  clock.now = Date.UTC(2026, 7, 30, 19, 0, 0);   // 12:00 PT, the cue is due
  await svc._tick();
  assert.equal(svc.state.pendingProgram.cueId, 'c_show', 'lease armed while merely taken over');

  await svc.setAutopilotEnabled(false);
  assert.equal(svc.state.pendingProgram, null, 'disable must drop the pending lease');

  // …and the lease must not come back, nor auto-start, while disabled.
  clock.now += 60_000;
  await svc._tick();
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.pendingProgram, null, 'a DISABLED plan armed a program lease');
  assert.equal(svc.state.activeProgram, null, 'a DISABLED plan auto-started a program');
  assert.equal(svc.getState().planActive, false);
});

test('a DISABLED plan fires no cues on the tick and raises no deck-pin', async () => {
  const { svc, calls, clock } = setup();
  await svc.start();
  await svc.setAutopilotEnabled(false);
  calls.loadPlaylist.length = 0;
  calls.forceDeckView.length = 0;

  clock.now = Date.UTC(2026, 7, 30, 19, 0, 0);   // the 12:00 cue comes due
  for (let i = 0; i < 5; i++) { clock.now += 1000; await svc._tick(); }
  svc.stop();

  assert.deepEqual(calls.loadPlaylist, [], 'a disabled plan loaded a playlist');
  assert.deepEqual(calls.forceDeckView, [], 'a disabled plan pinned the deck');
  assert.equal(svc.state.activeProgram, null);
  assert.equal(svc.state.pendingProgram, null);
  assert.equal(svc.getState().planActive, false);
});

test('the disable transition is idempotent and safe to fire redundantly', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  await svc.fireCue('c_show');
  await svc.setAutopilotEnabled(false);
  const first = JSON.stringify(svc.getState());
  await svc.setAutopilotEnabled(false);
  await svc._tick();
  await svc._tick();
  const after = JSON.stringify(svc.getState());
  assert.equal(svc.state.activeProgram, null);
  assert.equal(svc.getState().planActive, false);
  assert.equal(first.includes('"planActive":false'), true);
  assert.equal(after.includes('"planActive":false'), true);
});

test('a disable that lands mid-cue-fire cannot leave a half-active cue', async () => {
  // Race shape: the arbiter has already promoted a due program into
  // activeProgram on this tick when the operator's disable lands. The next tick
  // must reconcile it away rather than let the half-started cue keep the rig.
  const { svc, clock } = setup();
  await svc.start();
  svc.takeover();
  clock.now = Date.UTC(2026, 7, 30, 19, 0, 0);
  await svc._tick();                         // lease armed
  clock.now += 31_000;
  await svc._tick();                         // lease auto-start → program live
  assert.equal(svc.state.activeProgram.cueId, 'c_show');

  await svc.setAutopilotEnabled(false);      // the disable lands mid-program
  assert.equal(svc.state.activeProgram, null, 'the mid-flight cue survived the disable');
  clock.now += 1000;
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.activeProgram, null);
  assert.equal(svc.state.pendingProgram, null);
  assert.equal(svc.getState().planActive, false);
});

test('an engine RESTART with the plan disabled boots disabled and cue-free', async () => {
  const first = setup();
  await first.svc.start();
  await first.svc.setAutopilotEnabled(false);
  first.svc.stop();

  // Same state dir = the same engine restarted.
  const second = setup({ stateDir: first.stateDir });
  await second.svc.start();
  second.svc.stop();

  assert.equal(second.svc.state.autopilotEnabled, false, 'the disable did not survive the restart');
  assert.equal(second.svc.getState().planActive, false, 'a restarted disabled plan is active again');
  assert.equal(second.svc.state.activeProgram, null);
  assert.equal(second.svc.state.pendingProgram, null);
  assert.deepEqual(second.calls.loadPlaylist, [], 'a disabled plan restored a cue look on boot');
  assert.deepEqual(second.calls.forceDeckView, [], 'a disabled plan pinned the deck on boot');
});

test('planActive is EXACTLY the one predicate — no second derivation', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  // Enabled + driving.
  assert.equal(svc.getState().planActive, svc._isPlanDrivingDeck());
  assert.equal(svc.planEnabled(), true);
  // Taken over.
  svc.takeover();
  assert.equal(svc.getState().planActive, svc._isPlanDrivingDeck());
  // Disabled.
  await svc.setAutopilotEnabled(false);
  assert.equal(svc.planEnabled(), false);
  assert.equal(svc._isPlanDrivingDeck(), false);
  assert.equal(svc.getState().planActive, false);
  // Re-enabled.
  await svc.setAutopilotEnabled(true);
  assert.equal(svc.planEnabled(), true);
  assert.equal(svc.getState().planActive, svc._isPlanDrivingDeck());
});

test('resume / lease expiry never resurrect a DISABLED plan', async () => {
  const { svc, calls } = setup();
  await svc.start();
  await svc.setAutopilotEnabled(false);
  calls.loadPlaylist.length = 0;
  calls.forceDeckView.length = 0;

  await svc.resume();                       // the operator presses RESUME
  assert.equal(svc.getState().planActive, false, 'RESUME resurrected a disabled plan');
  await svc._releaseOperatorLease();        // an orphaned lease expires
  svc.stop();
  assert.equal(svc.getState().planActive, false, 'lease expiry resurrected a disabled plan');
  assert.deepEqual(calls.loadPlaylist, [], 'a disabled plan loaded a look on resume');
  assert.deepEqual(calls.forceDeckView, [], 'a disabled plan pinned the deck on resume');
});

test('the Live Touch yield dep fires on resume AND on lease expiry, and never blocks', async () => {
  const { svc } = setup();
  const seen = [];
  svc.deps.yieldLiveTouch = (why) => { seen.push(why); };
  await svc.start();

  await svc.resume();
  assert.equal(seen.length, 1);
  assert.match(seen[0], /resume/i);

  svc.takeover();
  await svc._releaseOperatorLease();
  assert.equal(seen.length, 2);
  assert.match(seen[1], /lease expired/i);

  // A broken Live client must NEVER hold the show hostage.
  svc.deps.yieldLiveTouch = () => { throw new Error('live touch is wedged'); };
  await svc.resume();
  svc.stop();
  assert.match(svc.lastError, /live touch yield/);
  assert.equal(svc.state.mode, 'armed', 'the plan did not take over after a failed yield');
});
