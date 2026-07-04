import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService, buildOverview } from '../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../lib/timeline/show_plan.js';

// ── fakes ─────────────────────────────────────────────────────────────────

function makeDeps() {
  const calls = {
    loadPlaylist: [],
    setAutopilot: [],
    setParams: [],
    setMaster: [],
    requestScene: [],
    patchScheduledTask: [],
    fireScheduledTask: [],
    setDeckTransition: [],
    setDeckOverlaysEnabled: [],
    setColorAutopilot: [],
    setGlobalHue: [],
    forceDeckView: [],
    releaseDeckView: [],
  };
  // The real engine deps branch on target.kind ('deck' | 'mixer'); a target
  // missing `kind` would silently fall into the mixer branch. Mirror that
  // contract here so a mis-shaped target throws in tests, not just live.
  const assertTarget = (t) => {
    if (!t || (t.kind !== 'deck' && t.kind !== 'mixer')) {
      throw new Error(`dep target must carry kind deck|mixer, got ${JSON.stringify(t)}`);
    }
    if (t.kind === 'mixer' && (t.id === undefined || t.id === null)) {
      throw new Error(`mixer target requires an id, got ${JSON.stringify(t)}`);
    }
  };
  // Mirror the engine's view-override pin so `forcingDeckView` is testable:
  // forceDeckView() pins → 'deck'; getViewOverrideMode() reads it back. A test
  // can clear it (simulating an operator switching the view to mixer).
  // `source` mirrors the engine controlLockSource so a test can prove
  // releaseDeckView clears a 'plan' pin but never a 'portwatch' one.
  const viewState = { mode: null, source: null };
  const deps = {
    loadPlaylist: (a) => { assertTarget(a.target); calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { assertTarget(a.target); calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    // Mirror the engine's setMaster dep (routes a `master` global to the deck
    // grand master, not the CPC). Records the value so a test can prove a
    // look/globals master lands here and NOT in setParams.
    setMaster: (v) => { calls.setMaster.push(v); },
    requestScene: (a) => { calls.requestScene.push(a); },
    patchScheduledTask: (id, patch) => { calls.patchScheduledTask.push({ id, patch }); },
    fireScheduledTask: (id) => { calls.fireScheduledTask.push(id); },
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
    setDeckTransition: (patch) => { calls.setDeckTransition.push(patch); },
    setDeckOverlaysEnabled: (enabled) => { calls.setDeckOverlaysEnabled.push(enabled); },
    setColorAutopilot: (wire) => { calls.setColorAutopilot.push(wire); },
    setGlobalHue: (degrees) => { calls.setGlobalHue.push(degrees); },
    forceDeckView: () => { calls.forceDeckView.push(true); viewState.mode = 'deck'; viewState.source = 'plan'; },
    // Mirror timelineReleaseDeckView: only clears a 'plan'-owned pin, never a
    // real 'portwatch' hardware lock.
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

// A minimal plan with an autopilot baseline, a daytime look, a program cue,
// and a mood cue (calm→party). Times are clock anchors so they're tz-stable.
function makePlan() {
  return {
    schemaVersion: 1,
    name: 'test_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {
      show: { playlist: 'show_pl', palette: 'deep_sea' },
      party: { playlist: 'party_pl' },
    },
    cues: [
      {
        id: 'c_show',
        label: 'Scheduled show',
        kind: 'program',
        trigger: { type: 'clock', at: '12:00' },
        action: { type: 'look', look: 'show' },
        hold: { min: 90 },
      },
      {
        id: 'c_mood',
        label: 'calm to party',
        trigger: { type: 'mood', from: 'calm', to: 'party' },
        action: { type: 'look', look: 'party' },
      },
    ],
  };
}

const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }];

function setup({ mood, now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlsvc-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  // Write the active plan so the service loads it (no default-plan write).
  saveShowPlan(makePlan(), path.join(sceneDir, 'test_plan.yaml'));

  const { deps, calls } = makeDeps();
  const broadcasts = [];
  let moodState = mood || { party: 0, value: 0 };
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => moodState,
    deps,
    broadcast: (s) => broadcasts.push(s),
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 },
      colorPalettes: PALETTES,
    },
    nowFn: () => (now !== undefined ? now : Date.UTC(2026, 7, 30, 2, 0, 0)), // 19:00 PT, before 12:00 next-day-ish
  });
  return { svc, deps, calls, broadcasts, sceneDir, stateDir, setMood: (m) => { moodState = m; } };
}

// ── tests ───────────────────────────────────────────────────────────────────

test('getState shape carries controller / autopilotEnabled / activeProgram', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const st = svc.getState();
  assert.equal(st.type, 'timelineState');
  assert.ok('controller' in st, 'has controller');
  assert.ok('autopilotEnabled' in st, 'has autopilotEnabled');
  assert.ok('activeProgram' in st, 'has activeProgram');
  assert.equal(typeof st.autopilotEnabled, 'boolean');
  assert.ok(Array.isArray(st.cues));
});

test('boot establishes the autopilot baseline (load + autopilot on)', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  // Baseline = load the plan-level autopilot playlist + autopilot active:true.
  const loaded = calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('baseline_pl'), `expected baseline_pl load, got ${JSON.stringify(loaded)}`);
  const apOn = calls.setAutopilot.find((c) => c.state && c.state.active === true);
  assert.ok(apOn, 'expected an autopilot active:true call on boot');
});

test('manual fire of a program cue → loadPlaylist + setAutopilot(off)', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  // Clear boot-baseline calls so we isolate the program fire.
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;

  const r = await svc.fireCue('c_show');
  assert.equal(r.controller, 'program');
  // The program look loads its playlist.
  const loaded = calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('show_pl'), `program should load show_pl, got ${JSON.stringify(loaded)}`);
  // A program turns the baseline autopilot OFF (docs/38 §14 autopilotOff).
  const apOff = calls.setAutopilot.find((c) => c.state && c.state.active === false);
  assert.ok(apOff, 'program fire must turn deck autopilot off');
  // The look's palette is pushed to the CPC.
  assert.ok(calls.setParams.some((p) => p.colorPalette1), 'palette should be written to CPC');
});

test('mood swap is gated to autopilot (suppressed under a program)', async () => {
  const { svc, calls, setMood } = setup();
  await svc.start();
  // Start a program so the controller is "program".
  await svc.fireCue('c_show');
  assert.equal(svc.getState().controller, 'program');
  calls.loadPlaylist.length = 0;

  // A calm→party swap under a program must NOT drive the lights.
  setMood({ party: 0, value: 0 });
  await svc._tick(); // arm at calm
  setMood({ party: 1, value: 1 });
  await svc._tick(); // would-fire, but suppressed
  svc.stop();

  const loadedParty = calls.loadPlaylist.map((c) => c.name);
  assert.ok(!loadedParty.includes('party_pl'), 'mood cue must be suppressed under a program');
  // The suppressed intent is surfaced (never silent).
  const st = svc.getState();
  assert.ok(st.wouldFire.some((w) => w.cueId === 'c_mood'), 'suppressed mood fire should surface in wouldFire');
});

test('mood swap drives the lights under autopilot', async () => {
  const { svc, calls, setMood } = setup();
  await svc.start();
  svc.stop();
  // No program → controller is autopilot. Clear boot calls.
  calls.loadPlaylist.length = 0;
  setMood({ party: 0, value: 0 });
  await svc._tick();           // arm at calm
  setMood({ party: 1, value: 1 });
  await svc._tick();           // fire under autopilot
  const loaded = calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('party_pl'), `mood cue should load party_pl under autopilot, got ${JSON.stringify(loaded)}`);
});

test('activatePlan / savePlan roundtrip', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();

  // savePlan writes an authored plan; getPlan reads it back.
  const authored = makePlan();
  authored.name = 'authored_plan';
  authored.cues = authored.cues.filter((c) => c.id === 'c_show');
  await svc.savePlan(authored);
  const plans = svc.listPlans();
  assert.ok(plans.includes('authored_plan'), `listPlans should include authored_plan, got ${JSON.stringify(plans)}`);
  const got = svc.getPlan('authored_plan');
  assert.equal(got.name, 'authored_plan');
  assert.equal(got.cues.length, 1);

  // activatePlan switches the active plan.
  const name = await svc.activatePlan('authored_plan');
  assert.equal(name, 'authored_plan');
  assert.equal(svc.getState().activePlan, 'authored_plan');
});

test('savePlan rejects an invalid plan (fail loud)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  // savePlan is async (save-over-active hot-reloads) — validation rejects.
  await assert.rejects(() => svc.savePlan({ schemaVersion: 1, name: 'bad' }), /location|cues/);
});

test('setAutopilotEnabled(false) → controller manual, autopilot off', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  calls.setAutopilot.length = 0;
  const r = await svc.setAutopilotEnabled(false);
  assert.equal(r.autopilotEnabled, false);
  assert.equal(r.controller, 'manual');
  assert.ok(calls.setAutopilot.some((c) => c.state && c.state.active === false), 'disable should turn deck autopilot off');
});

// ── Fix 5: autopilotOff disarms the BASELINE's configured target ──────────────

// A plan whose autopilot baseline targets ALL channels (deck + mixer). A
// program preempting it must disarm autopilot on deck AND mixer, not just deck.
function makeAllTargetPlan() {
  const plan = makePlan();
  plan.autopilot.target = { channel: 'all', id: null };
  return plan;
}

function setupAllTarget({ now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlsvc-all-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(makeAllTargetPlan(), path.join(sceneDir, 'test_plan.yaml'));

  const { deps, calls } = makeDeps();
  // Override listMixerChannelIds so 'all' resolves to deck + one mixer channel.
  deps.listMixerChannelIds = () => ['mix_a'];
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => (now !== undefined ? now : Date.UTC(2026, 7, 30, 2, 0, 0)),
  });
  return { svc, calls };
}

test('program preempting an all-channel baseline disarms deck AND mixer (Fix 5)', async () => {
  const { svc, calls } = setupAllTarget();
  await svc.start();
  svc.stop();
  calls.setAutopilot.length = 0;

  await svc.fireCue('c_show'); // program cue → autopilotOff

  const offTargets = calls.setAutopilot
    .filter((c) => c.state && c.state.active === false)
    .map((c) => (c.target.kind === 'deck' ? 'deck' : `mixer:${c.target.id}`));
  assert.ok(offTargets.includes('deck'), `expected deck disarm, got ${JSON.stringify(offTargets)}`);
  assert.ok(offTargets.includes('mixer:mix_a'), `expected mixer disarm, got ${JSON.stringify(offTargets)}`);
});

// ── Fix 8: takeover() updates controller immediately ──────────────────────────

test('takeover() sets controller to manual immediately (Fix 8)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  assert.equal(svc.state.controller, 'autopilot');
  svc.takeover();
  assert.equal(svc.state.controller, 'manual');
});

// ── Fix 9: activatePlan clears stale fires/errors ─────────────────────────────

test('activatePlan clears recentFires / wouldFire / cueErrors (Fix 9)', async () => {
  const { svc, sceneDir } = setup();
  await svc.start();
  svc.stop();
  // Seed stale history.
  svc.recentFires.push({ cueId: 'stale', atMs: 0, reason: 'x' });
  svc.wouldFire.push({ cueId: 'stale', reason: 'x', controller: 'autopilot', atMs: 0 });
  svc.cueErrors.stale = 'boom';

  // Write a second plan and activate it.
  const authored = makePlan();
  authored.name = 'authored_plan';
  saveShowPlan(authored, path.join(sceneDir, 'authored_plan.yaml'));
  await svc.activatePlan('authored_plan');

  assert.ok(!svc.recentFires.some((f) => f.cueId === 'stale'), 'recentFires cleared');
  assert.ok(!svc.wouldFire.some((f) => f.cueId === 'stale'), 'wouldFire cleared');
  assert.equal(svc.cueErrors.stale, undefined, 'cueErrors cleared');
});

// ── docs/38 §16 pending-program lease (service-level coverage) ────────────────

// Arm a lease directly on the running service's state (the arbiter's job is
// covered in timeline_arbiter.test.js — here we exercise the operator actions).
function armPendingLease(svc, { expiresAtMs } = {}) {
  const now = svc.nowFn();
  svc.state.pendingProgram = {
    cueId: 'c_show',
    label: 'Scheduled show',
    action: { type: 'look', look: 'show' },
    armedAtMs: now,
    expiresAtMs: typeof expiresAtMs === 'number' ? expiresAtMs : now + 30000,
  };
}

// V8 — enableProgram() starts the program immediately, clears the lease.
test('V8: enableProgram → program starts now, pending cleared', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  await svc.setAutopilotEnabled(false); // go idle/manual
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;
  armPendingLease(svc);

  const r = await svc.enableProgram();
  assert.equal(r.ok, true);
  assert.equal(r.controller, 'program');
  assert.equal(svc.state.pendingProgram, null, 'lease cleared');
  assert.equal(svc.state.activeProgram.cueId, 'c_show');
  // Program look loaded + baseline autopilot disarmed.
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'), 'show playlist loaded');
  assert.ok(calls.setAutopilot.some((c) => c.state && c.state.active === false), 'baseline disarmed');
  // firedToday latched so it does not re-arm today.
  assert.ok(svc.state.firedToday.c_show, 'firedToday latched on enable');
});

test('enableProgram with no pending → {ok:false}', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const r = await svc.enableProgram();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no pending program');
});

// V9 — a clock cue that comes due in MANUAL arms a lease via the tick; dismiss
// cancels it, latches firedToday, and a re-tick does NOT re-arm the same day.
test('V9: due program arms a lease, dismiss latches firedToday (no re-arm)', async () => {
  // Boot BEFORE the cue time (11:59 PT) so catchUp does not latch c_show, then
  // advance the clock to 12:00 PT so the cue comes due on the tick.
  let nowMs = Date.UTC(2026, 7, 30, 18, 59, 0); // 11:59 PT
  const { svc } = setup({ now: 0 });
  svc.nowFn = () => nowMs;
  await svc.start();
  await svc.setAutopilotEnabled(false); // manual/idle
  nowMs = Date.UTC(2026, 7, 30, 19, 0, 0); // 12:00 PT — cue now due
  await svc._tick();
  assert.ok(svc.state.pendingProgram && svc.state.pendingProgram.cueId === 'c_show', 'lease armed by tick');

  const r = svc.dismissProgram();
  assert.equal(r.ok, true);
  assert.equal(svc.state.pendingProgram, null, 'lease cleared');
  assert.ok(svc.state.firedToday.c_show, 'firedToday latched on dismiss');

  // Re-tick same day → must NOT re-arm.
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.pendingProgram, null, 'dismissed lease does not re-arm today');
});

test('dismissProgram with no pending → {ok:false}', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const r = svc.dismissProgram();
  assert.equal(r.ok, false);
});

// V11 — pending + setAutopilotEnabled(true) → program fires (not just baseline).
test('V11: pending + ap-on → program fires', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  await svc.setAutopilotEnabled(false);
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;
  armPendingLease(svc);

  const r = await svc.setAutopilotEnabled(true);
  assert.equal(r.controller, 'program');
  assert.equal(svc.state.pendingProgram, null);
  assert.equal(svc.state.activeProgram.cueId, 'c_show');
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'), 'program look loaded on ap-on');
});

// Lease auto-expiry through the tick → program auto-starts (V7 at service level).
test('lease auto-expiry through tick → program auto-starts', async () => {
  const { svc, calls } = setup();
  await svc.start();
  await svc.setAutopilotEnabled(false);
  calls.loadPlaylist.length = 0;
  // Arm an already-expired lease, then tick.
  armPendingLease(svc, { expiresAtMs: svc.nowFn() - 1000 });
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.pendingProgram, null, 'expired lease cleared');
  assert.equal(svc.state.activeProgram.cueId, 'c_show');
  assert.equal(svc.state.controller, 'program');
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'), 'auto-started program loaded its look');
});

// getState surfaces the pending lease as {cueId,label,expiresAtMs}.
test('getState surfaces pendingProgram {cueId,label,expiresAtMs}', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  await svc.setAutopilotEnabled(false);
  armPendingLease(svc);
  const st = svc.getState();
  assert.ok(st.pendingProgram, 'pendingProgram present');
  assert.equal(st.pendingProgram.cueId, 'c_show');
  assert.equal(st.pendingProgram.label, 'Scheduled show');
  assert.equal(typeof st.pendingProgram.expiresAtMs, 'number');
});

// Boot drops a persisted pendingProgram (re-derive, §16.6/I6).
test('boot drops a persisted pendingProgram', async () => {
  const { svc, stateDir } = setup();
  await svc.start();
  svc.stop();
  // Persist a stale lease into the state file.
  svc.state.pendingProgram = {
    cueId: 'c_show', label: 'Scheduled show', action: { type: 'look', look: 'show' },
    armedAtMs: 0, expiresAtMs: 1,
  };
  svc._persistAndBroadcast();

  // A fresh service over the SAME stateDir must drop the stale lease on boot.
  const { deps } = makeDeps();
  const svc2 = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir: svc.sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => Date.UTC(2026, 7, 30, 2, 0, 0),
  });
  await svc2.start();
  svc2.stop();
  assert.equal(svc2.state.pendingProgram, null, 'persisted lease dropped on boot');
});

// ── docs/38 §16 operator-takeover lease ───────────────────────────────────────

test('getState surfaces planActive / operatorLease / operatorLeaseSec', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const st = svc.getState();
  assert.ok('planActive' in st, 'has planActive');
  assert.ok('forcingDeckView' in st, 'has forcingDeckView');
  assert.ok('operatorLease' in st, 'has operatorLease');
  assert.ok('operatorLeaseSec' in st, 'has operatorLeaseSec');
  // No takeover yet → plan is driving (autopilot baseline), lease null.
  assert.equal(st.planActive, true, 'planActive true under autopilot');
  assert.equal(st.operatorLease, null);
  assert.equal(st.operatorLeaseSec, 120, 'default operatorLeaseSec surfaced');
});

test('takeover() sets mode overridden + arms lease; planActive false', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const r = svc.takeover();
  assert.equal(r.ok, true);
  assert.equal(typeof r.operatorLease.expiresAtMs, 'number');
  assert.equal(svc.state.mode, 'overridden');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.state.operatorLease.expiresAtMs, svc.nowFn() + 120000, 'lease = now + operatorLeaseSec');
  const st = svc.getState();
  assert.equal(st.planActive, false, 'planActive false under overridden takeover');
  assert.ok(st.operatorLease && st.operatorLease.expiresAtMs, 'lease surfaced in state');
});

test('takeover() is idempotent — re-calling refreshes expiry', async () => {
  let nowMs = 1000;
  const { svc } = setup({ now: 0 });
  svc.nowFn = () => nowMs;
  await svc.start();
  svc.stop();
  svc.takeover();
  const first = svc.state.operatorLease.expiresAtMs;
  nowMs += 5000;
  const r = svc.takeover();
  assert.ok(r.operatorLease.expiresAtMs > first, 'second takeover pushes expiry forward');
  assert.equal(svc.state.operatorLease.expiresAtMs, nowMs + 120000);
});

test('activity() extends the lease expiry while overridden', async () => {
  let nowMs = 1000;
  const { svc } = setup({ now: 0 });
  svc.nowFn = () => nowMs;
  await svc.start();
  svc.stop();
  svc.takeover();
  const before = svc.state.operatorLease.expiresAtMs;
  nowMs += 10000;
  const r = svc.activity();
  assert.equal(r.ok, true);
  assert.ok(svc.state.operatorLease.expiresAtMs > before, 'activity pushed expiry forward');
  assert.equal(svc.state.operatorLease.expiresAtMs, nowMs + 120000);
});

test('activity() is a no-op when no lease is held', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  // No takeover → no lease. activity must not arm one.
  const r = svc.activity();
  assert.equal(r.ok, true);
  assert.equal(svc.state.operatorLease, null, 'activity must not arm a lease on its own');
});

test('tick past lease expiry → mode armed, lease cleared, catchUp resumed plan', async () => {
  let nowMs = Date.UTC(2026, 7, 30, 2, 0, 0); // 19:00 PT
  const { svc, calls } = setup({ now: 0 });
  svc.nowFn = () => nowMs;
  await svc.start();
  svc.takeover();
  assert.equal(svc.state.mode, 'overridden');
  // Clear boot/baseline calls so we can prove catchUp re-established the baseline.
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;
  // Advance past the lease expiry, then tick.
  nowMs = svc.state.operatorLease.expiresAtMs + 1000;
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.mode, 'armed', 'mode released to armed');
  assert.equal(svc.state.operatorLease, null, 'lease cleared on release');
  // catchUp re-established the autopilot baseline (resume-at-now).
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('baseline_pl'),
    'catchUp re-established the baseline playlist on release');
  assert.equal(svc.getState().planActive, true, 'plan driving again after release');
});

test('resume() clears operator lease + runs catchUp', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  svc.takeover();
  assert.ok(svc.state.operatorLease, 'lease held after takeover');
  calls.loadPlaylist.length = 0;
  const r = await svc.resume();
  assert.equal(r.mode, 'armed');
  assert.equal(svc.state.operatorLease, null, 'resume clears the operator lease');
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('baseline_pl'),
    'resume re-established the baseline via catchUp');
});

test('boot drops a persisted operatorLease (never resume stale)', async () => {
  const { svc, stateDir } = setup();
  await svc.start();
  svc.stop();
  // Persist a stale operator lease into the state file.
  svc.state.mode = 'overridden';
  svc.state.operatorLease = { expiresAtMs: 1 };
  svc._persistAndBroadcast();

  // A fresh service over the SAME stateDir must drop the stale lease on boot.
  const { deps } = makeDeps();
  const svc2 = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir: svc.sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => Date.UTC(2026, 7, 30, 2, 0, 0),
  });
  await svc2.start();
  svc2.stop();
  assert.equal(svc2.state.operatorLease, null, 'persisted operator lease dropped on boot');
  // Regression (bug 2026-07-02): dropping the lease must ALSO exit
  // 'overridden'. A persisted mode 'overridden' whose lease was nulled used to
  // survive boot forever (the tick release required a lease), so CaptainPad
  // read leaseHeld=true permanently and the deck/mixer never re-locked.
  assert.equal(svc2.state.mode, 'armed', 'persisted overridden mode released on boot');
  assert.equal(svc2.getState().planActive, true, 'plan drives again after boot heal');
});

test('tick self-heals an orphaned overridden mode (no lease)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  // Force the trap state directly: mode 'overridden' with NO lease (as a
  // pre-fix persisted state or any future bug could leave behind).
  svc.state.mode = 'overridden';
  svc.state.operatorLease = null;
  await svc._tick();
  assert.equal(svc.state.mode, 'armed', 'orphaned overridden released by the tick');
  assert.equal(svc.state.operatorLease, null);
  assert.equal(svc.getState().planActive, true, 'plan drives again after self-heal');
});

// ── docs/38 §17 deck transition + overlays + mixer→deck pin ───────────────────

import { validateShowPlan } from '../lib/timeline/show_plan.js';

// Build a plan whose mood cue loads a DECK playlist with a transition + overlays.
// (Re-uses makePlan's baseline; only the cue action gains the §17 fields.)
function makePlanWithDeckKnobs(action) {
  const plan = makePlan();
  plan.cues = [
    {
      id: 'c_deck',
      label: 'Deck playlist with knobs',
      trigger: { type: 'mood', from: 'calm', to: 'party' },
      action,
    },
  ];
  return plan;
}

function setupWithPlan(plan, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlsvc-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, calls } = makeDeps();
  let moodState = opts.mood || { party: 0, value: 0 };
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => moodState,
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => Date.UTC(2026, 7, 30, 2, 0, 0),
  });
  return { svc, deps, calls, setMood: (m) => { moodState = m; } };
}

test('§16.9 schema: playlist action round-trips transition + overlays', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl',
    target: { channel: 'deck', id: null },
    transition: { mode: 'trans_dissolve', durationMs: 1500, enabled: true },
    overlays: 'enable',
  });
  const norm = validateShowPlan(plan);
  const act = norm.cues[0].action;
  assert.deepEqual(act.transition, { mode: 'trans_dissolve', durationMs: 1500, enabled: true });
  assert.equal(act.overlays, 'enable');
});

test('§16.9 schema: rejects an unknown transition mode (allowed list in message)', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    transition: { mode: 'trans_bogus' },
  });
  assert.throws(() => validateShowPlan(plan), /trans_crossfade, trans_flash, trans_color_burst/);
});

test('§16.9 schema: accepts the full 16-blend set (e.g. trans_iris) + shuffle round-trip', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl',
    target: { channel: 'deck', id: null },
    transition: { mode: 'trans_iris', durationMs: 800, enabled: true, shuffle: true },
  });
  const norm = validateShowPlan(plan);
  assert.deepEqual(norm.cues[0].action.transition, {
    mode: 'trans_iris', durationMs: 800, enabled: true, shuffle: true,
  });
});

test('§16.9 schema: rejects a non-boolean transition shuffle', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    transition: { mode: 'trans_crossfade', shuffle: 'yes' },
  });
  assert.throws(() => validateShowPlan(plan), /\.shuffle must be a boolean/);
});

test('§16.9 apply: an authored transition shuffle reaches setDeckTransition', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    transition: { mode: 'trans_iris', durationMs: 800, shuffle: true },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setDeckTransition.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setDeckTransition.length, 1, 'setDeckTransition called once');
  assert.deepEqual(calls.setDeckTransition[0], {
    mode: 'trans_iris', enabled: true, durationMs: 800, shuffle: true,
  });
});

test('§16.9 schema: transition requires mode when present', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    transition: { durationMs: 1000 },
  });
  assert.throws(() => validateShowPlan(plan), /\.mode is required/);
});

test('§16.9 schema: transition on a non-deck target throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'mixer', id: 'ch_a' },
    transition: { mode: 'trans_flash' },
  });
  assert.throws(() => validateShowPlan(plan), /transition is only valid for a deck target/);
});

test('§16.9 schema: overlays on a non-deck target throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'all', id: null },
    overlays: 'enable',
  });
  assert.throws(() => validateShowPlan(plan), /overlays is only valid for a deck target/);
});

test('§16.9 schema: rejects a bad overlays value', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    overlays: 'toggle',
  });
  assert.throws(() => validateShowPlan(plan), /overlays must be one of enable, disable/);
});

test('§16.9 apply: deck playlist cue calls setDeckTransition + overlays + forceDeckView', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    transition: { mode: 'trans_dissolve', durationMs: 1500 },
    overlays: 'disable',
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  // Isolate from the boot baseline (which also pins the deck view).
  calls.setDeckTransition.length = 0;
  calls.setDeckOverlaysEnabled.length = 0;
  calls.forceDeckView.length = 0;
  calls.loadPlaylist.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();                 // arm at calm
  setMood({ party: 1, value: 1 });
  await svc._tick();                 // fire the deck cue under autopilot
  svc.stop();

  assert.equal(calls.setDeckTransition.length, 1, 'setDeckTransition called once');
  // enabled defaults true when the cue didn't say otherwise; duration passed through.
  assert.deepEqual(calls.setDeckTransition[0], { mode: 'trans_dissolve', enabled: true, durationMs: 1500 });
  assert.deepEqual(calls.setDeckOverlaysEnabled, [false], 'overlays:disable → setDeckOverlaysEnabled(false)');
  assert.ok(calls.forceDeckView.length >= 1, 'forceDeckView asserted for the deck cue');
  assert.ok(calls.loadPlaylist.some((c) => c.name === 'party_pl'), 'deck playlist loaded');
});

test('§16.9 apply: absent transition/overlays leave the deck knobs untouched', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setDeckTransition.length = 0;
  calls.setDeckOverlaysEnabled.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setDeckTransition.length, 0, 'no transition cue → setDeckTransition untouched');
  assert.equal(calls.setDeckOverlaysEnabled.length, 0, 'no overlays field → setDeckOverlaysEnabled untouched');
});

test('§16.9 boot baseline pins the deck view (forceDeckView)', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  // The plan-level autopilot baseline targets the deck → output pinned to deck.
  assert.ok(calls.forceDeckView.length >= 1, 'boot baseline forces the deck view');
});

test('§16.9 getState surfaces forcingDeckView (plan active AND output pinned to deck)', async () => {
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  // Boot baseline pinned the deck view → plan active + pinned = forcingDeckView.
  let st = svc.getState();
  assert.equal(st.planActive, true, 'plan is driving the deck on boot');
  assert.equal(st.forcingDeckView, true, 'forcingDeckView true while plan pins the deck');

  // Simulate the operator switching the view to mixer (UI clears the pin). The
  // engine does NOT auto-takeover; forcingDeckView simply drops to false because
  // the output is no longer pinned to deck.
  calls.viewState.mode = null;
  st = svc.getState();
  assert.equal(st.planActive, true, 'plan still active (no engine-side takeover)');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false once the pin is cleared');

  // A takeover (operator-confirmed) drops planActive → forcingDeckView false too.
  calls.viewState.mode = 'deck';
  svc.takeover();
  st = svc.getState();
  assert.equal(st.planActive, false, 'planActive false under overridden takeover');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false when plan not active');
});

test('§16.9 takeover then lease-expiry resume re-asserts the deck pin', async () => {
  // The engine does NOT auto-arm takeover from a view event (§16.9 confirm-gated
  // in the UI). This proves the PRIMITIVES the UI drives: an explicit takeover()
  // (what CaptainPad calls on confirm) → after operatorLeaseSec of inactivity the
  // tick auto-releases → catchUp → the baseline re-pins the deck view.
  let nowMs = Date.UTC(2026, 7, 30, 2, 0, 0);
  const { svc, calls } = setup();
  svc.nowFn = () => nowMs;
  await svc.start();
  // Operator confirmed manual takeover (UI → POST /timeline/takeover).
  svc.takeover();
  assert.equal(svc.state.mode, 'overridden');
  assert.ok(svc.state.operatorLease, 'operator lease armed by takeover');
  calls.forceDeckView.length = 0;

  // Inactivity past the lease → tick auto-releases + resumes the plan at now.
  nowMs = svc.state.operatorLease.expiresAtMs + 1000;
  await svc._tick();
  svc.stop();
  assert.equal(svc.state.operatorLease, null, 'lease released on expiry');
  assert.equal(svc.state.mode, 'armed', 'mode back to armed after release');
  assert.ok(calls.forceDeckView.length >= 1, 'resume re-asserts the deck pin via the baseline');
});

test('§16.9 forceDeckView fails loud when the dep is missing', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
  });
  const { svc, deps, setMood } = setupWithPlan(plan);
  await svc.start();
  // Drop the dep AFTER boot to prove the per-cue path fails loud, not silently.
  delete deps.forceDeckView;
  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();
  // The cue error surfaces (never silent) — the tick records it.
  const st = svc.getState();
  assert.ok(
    st.lastError && /forceDeckView dep is required/.test(st.lastError),
    `expected a loud forceDeckView dep error, got ${JSON.stringify(st.lastError)}`,
  );
});

// ── docs/39 color autopilot on a deck playlist cue ────────────────────────────

test('docs/39 schema: deck playlist cue round-trips colorAutopilot', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: false },
  });
  const norm = validateShowPlan(plan);
  assert.deepEqual(norm.cues[0].action.colorAutopilot, {
    active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: false, transitionMs: 0,
  });
});

test('docs/39 schema: colorAutopilot transitionMs round-trips and defaults to 0', () => {
  const withTm = validateShowPlan(makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 2, transitionMs: 1500 },
  }));
  assert.equal(withTm.cues[0].action.colorAutopilot.transitionMs, 1500);

  const noTm = validateShowPlan(makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 2 },
  }));
  assert.equal(noTm.cues[0].action.colorAutopilot.transitionMs, 0);
});

test('docs/39 schema: colorAutopilot rejects a negative transitionMs', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 2, transitionMs: -1 },
  });
  assert.throws(() => validateShowPlan(plan), /colorAutopilot\.transitionMs must be a number >= 0/);
});

test('docs/39 schema: colorAutopilot shuffle defaults to false', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 5 },
  });
  const norm = validateShowPlan(plan);
  assert.equal(norm.cues[0].action.colorAutopilot.shuffle, false);
});

test('docs/39 schema: colorAutopilot rejects delay_s <= 0', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 0 },
  });
  assert.throws(() => validateShowPlan(plan), /colorAutopilot\.delay_s must be a number > 0/);
});

test('docs/39 schema: colorAutopilot rejects an empty palettes array', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: [], delay_s: 3 },
  });
  assert.throws(() => validateShowPlan(plan), /palettes must be a non-empty array/);
});

test('docs/39 schema: colorAutopilot on a non-deck target throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'mixer', id: 'ch_a' },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 3 },
  });
  assert.throws(() => validateShowPlan(plan), /colorAutopilot is only valid for a deck target/);
});

test('docs/39 schema: colorAutopilot rejects a non-boolean active', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: 'yes', palettes: ['aurora'], delay_s: 3 },
  });
  assert.throws(() => validateShowPlan(plan), /colorAutopilot\.active must be a boolean/);
});

test('docs/39 apply: deck cue with colorAutopilot calls setColorAutopilot via deps', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: true },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setColorAutopilot.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setColorAutopilot.length, 1, 'setColorAutopilot called once for the deck cue');
  assert.deepEqual(calls.setColorAutopilot[0], {
    active: true, palettes: ['aurora', 'bass_drop'], delay_s: 2, shuffle: true, transitionMs: 0,
  });
});

test('docs/39 apply: absent colorAutopilot leaves the daemon untouched', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setColorAutopilot.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setColorAutopilot.length, 0, 'no colorAutopilot field → setColorAutopilot untouched');
});

test('docs/39 apply: colorAutopilot fails loud when the dep is missing', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    colorAutopilot: { active: true, palettes: ['aurora'], delay_s: 2 },
  });
  const { svc, deps, setMood } = setupWithPlan(plan);
  await svc.start();
  delete deps.setColorAutopilot;
  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();
  const st = svc.getState();
  assert.ok(
    st.lastError && /setColorAutopilot dep is required/.test(st.lastError),
    `expected a loud setColorAutopilot dep error, got ${JSON.stringify(st.lastError)}`,
  );
});

// ── pattern-autopilot GROUP LOCALITY + global HUE on a deck cue ──────────────

test('group locality schema: autopilot round-trips groupMode/groupSize/groupDwell', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    autopilot: { active: true, delay_s: 30, shuffle: false, groupMode: true, groupSize: 4, groupDwell: 8 },
  });
  const norm = validateShowPlan(plan);
  assert.deepEqual(norm.cues[0].action.autopilot, {
    active: true, delay_s: 30, shuffle: false, groupMode: true, groupSize: 4, groupDwell: 8,
  });
});

test('group locality schema: a non-boolean groupMode throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    autopilot: { active: true, delay_s: 30, shuffle: false, groupMode: 'yes' },
  });
  assert.throws(() => validateShowPlan(plan), /groupMode must be a boolean/);
});

test('group locality schema: a non-integer groupSize throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    autopilot: { active: true, delay_s: 30, shuffle: false, groupSize: 2.5 },
  });
  assert.throws(() => validateShowPlan(plan), /groupSize must be an integer/);
});

test('group locality apply: cue group fields reach setAutopilot in state', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    autopilot: { active: true, delay_s: 30, shuffle: false, groupMode: true, groupSize: 4, groupDwell: 8 },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setAutopilot.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  const apCall = calls.setAutopilot.find((c) => c.state && c.state.groupMode !== undefined);
  assert.ok(apCall, 'expected a setAutopilot call carrying the group fields');
  assert.equal(apCall.state.groupMode, true);
  assert.equal(apCall.state.groupSize, 4);
  assert.equal(apCall.state.groupDwell, 8);
});

test('hue schema: hue on a deck playlist action round-trips', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    hue: 200,
  });
  const norm = validateShowPlan(plan);
  assert.equal(norm.cues[0].action.hue, 200);
});

test('hue schema: hue normalizes into [0,360) (380 → 20)', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    hue: 380,
  });
  const norm = validateShowPlan(plan);
  assert.equal(norm.cues[0].action.hue, 20);
});

test('hue schema: hue on a non-deck target throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'mixer', id: 'ch_a' },
    hue: 200,
  });
  assert.throws(() => validateShowPlan(plan), /hue is only valid for a deck target/);
});

test('hue apply: deck cue with hue reaches setGlobalHue with normalized degrees', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    hue: 380,
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setGlobalHue.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setGlobalHue.length, 1, 'setGlobalHue called once for the deck cue');
  assert.equal(calls.setGlobalHue[0], 20, 'hue normalized 380 → 20 before apply');
});

test('globals schema: SPEED/SIZE/SYNC on a deck playlist action round-trip', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    globals: { speed: 0.2, size: 0.75, bpmSpeedSync: 0 },
  });
  const norm = validateShowPlan(plan);
  assert.deepEqual(norm.cues[0].action.globals, { speed: 0.2, size: 0.75, bpmSpeedSync: 0 });
});

test('globals schema: globals on a non-deck target throws', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'mixer', id: 'ch1' },
    globals: { speed: 0.2 },
  });
  assert.throws(() => validateShowPlan(plan), /globals is only valid for a deck target/);
});

test('globals apply: a deck cue with globals reaches setParams (SPEED/SIZE/SYNC)', async () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    globals: { speed: 0.2, size: 0.75, bpmSpeedSync: 1 },
  });
  const { svc, calls, setMood } = setupWithPlan(plan);
  await svc.start();
  calls.setParams.length = 0;

  setMood({ party: 0, value: 0 });
  await svc._tick();
  setMood({ party: 1, value: 1 });
  await svc._tick();
  svc.stop();

  assert.equal(calls.setParams.length, 1, 'setParams called once for the deck cue globals');
  assert.deepEqual(calls.setParams[0], { speed: 0.2, size: 0.75, bpmSpeedSync: 1 });
});

test('globals schema: a non-finite globals value throws (no silent clamp)', () => {
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'deck', id: null },
    globals: { speed: Infinity },
  });
  assert.throws(() => validateShowPlan(plan), /must be a finite number/);
});

test('group schema: group locality on a MIXER target round-trips (not deck-gated, so the mixer apply can honor it)', () => {
  // groupMode/groupSize/groupDwell live on the autopilot block, which is NOT
  // deck-only (unlike hue/globals/transition). The validator must keep them for
  // a mixer target so timelineSetAutopilotOnMixer can mirror them — otherwise
  // they'd be a silent partial apply.
  const plan = makePlanWithDeckKnobs({
    type: 'playlist', name: 'party_pl', target: { channel: 'mixer', id: 'ch1' },
    autopilot: { active: true, delay_s: 30, shuffle: false, groupMode: true, groupSize: 4, groupDwell: 8 },
  });
  const norm = validateShowPlan(plan);
  assert.deepEqual(norm.cues[0].action.autopilot, {
    active: true, delay_s: 30, shuffle: false, groupMode: true, groupSize: 4, groupDwell: 8,
  });
});

// ── buildOverview carries durationMin (BUG 2 regression guard) ──────────────
// A cue authored with durationMin>0 must surface durationMin on its overview
// cue object so the maker strip renders it as a deck-owned BLOCK (start→
// start+durationMin), not a point marker. A cue with no durationMin must omit
// the field (point event).
test('buildOverview carries durationMin on cues that own a deck window', () => {
  const plan = validateShowPlan({
    schemaVersion: 2,
    name: 'dur_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles' },
    festival: { startDate: '2026-08-30', days: 2 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {},
    cues: [
      {
        id: 'c_block',
        label: 'Sixty-minute block',
        kind: 'program',
        trigger: { type: 'clock', at: '20:00' },
        action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
        durationMin: 60,
        days: 'all',
      },
      {
        id: 'c_point',
        label: 'Point cue',
        kind: 'program',
        trigger: { type: 'clock', at: '21:00' },
        action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
        days: 'all',
      },
    ],
  });

  const overview = buildOverview(plan, Date.UTC(2026, 7, 30, 12, 0, 0));
  assert.ok(overview.days.length >= 1, 'overview must have at least one day');
  const day0 = overview.days[0];
  const block = day0.cues.find((c) => c.id === 'c_block');
  const point = day0.cues.find((c) => c.id === 'c_point');
  assert.ok(block, 'c_block must appear in the day overview');
  assert.equal(block.durationMin, 60, 'a durationMin cue must carry durationMin on its overview object');
  assert.ok(typeof block.atLocal === 'string' && /^\d{2}:\d{2}$/.test(block.atLocal), 'block must resolve atLocal');
  assert.ok(point, 'c_point must appear in the day overview');
  assert.equal(point.durationMin, undefined, 'a point cue (no durationMin) must omit durationMin');
});

// ── recentFires records AUTOMATIC cue fires (operator bug) ────────────────────
// The CaptainPad "RECENT FIRES" log renders state.recentFires. A MANUAL fire was
// recorded, but an AUTOMATIC one (a mood cue firing under autopilot, a scheduled
// clock cue, the default cue, catchUp) must ALSO land in the ring with the cue
// id, label, a timestamp, and a source. These guard that.

test('recentFires records an AUTO-fired mood cue with id/label/atMs/source', async () => {
  const { svc, setMood } = setup();
  await svc.start();
  // No program → controller is autopilot. Drive a calm→party mood swap: it fires
  // AUTOMATICALLY through the arbiter/tick path, NOT via fireCue.
  setMood({ party: 0, value: 0 });
  await svc._tick();           // arm at calm
  setMood({ party: 1, value: 1 });
  await svc._tick();           // AUTO-fire under autopilot
  svc.stop();

  const st = svc.getState();
  const entry = st.recentFires.find((f) => f.cueId === 'c_mood');
  assert.ok(entry, `auto-fired mood cue must appear in recentFires, got ${JSON.stringify(st.recentFires)}`);
  assert.equal(entry.label, 'calm to party', 'entry carries the cue label');
  assert.equal(entry.source, 'auto', 'a scheduled/mood fire is source "auto"');
  assert.equal(typeof entry.atMs, 'number', 'entry carries a timestamp');
  assert.equal(entry.reason, 'mood', 'entry carries the fine-grained trigger reason');
});

test('recentFires distinguishes a MANUAL fire (source manual)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  await svc.fireCue('c_show');
  const st = svc.getState();
  // The manual fire is the most recent entry for c_show (catchUp may have logged
  // an earlier boot entry) — assert on the LAST one.
  const entry = st.recentFires.filter((f) => f.cueId === 'c_show').pop();
  assert.ok(entry, 'manual fire recorded');
  assert.equal(entry.source, 'manual', 'a fireCue is source "manual"');
  assert.equal(entry.label, 'Scheduled show', 'manual entry carries the label');
});

test('recentFires records the plan DEFAULT CUE auto-application (source default)', async () => {
  // A plan with NO owning cues + a plan-level defaultCue → the default cue fills
  // the deck automatically on boot and must be logged.
  const plan = makePlan();
  plan.cues = []; // no cues own the deck → default cue drives it
  plan.defaultCue = {
    label: 'House ambient',
    action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
  };
  const { svc } = setupWithPlan(plan);
  await svc.start();
  svc.stop();
  const st = svc.getState();
  const entry = st.recentFires.find((f) => f.source === 'default');
  assert.ok(entry, `default cue must appear in recentFires, got ${JSON.stringify(st.recentFires)}`);
  assert.equal(entry.cueId, '__default_cue__', 'default cue uses the synthetic id');
  assert.equal(entry.label, 'House ambient', 'default cue carries its authored label');
});

// ── AUTO OFF drops planActive; AUTO ON re-engages the plan + re-pins deck ───
// (operator: "AUTO ON = plan on"). PAUSE was removed, so autopilot OFF is the
// persistent idle-manual state; toggling it back ON re-activates the plan.
test('setAutopilotEnabled(false→true) drops then re-engages the plan', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  await svc.setAutopilotEnabled(false);
  assert.equal(svc.getState().planActive, false, 'AUTO OFF drops planActive');
  await svc.setAutopilotEnabled(true);
  const st = svc.getState();
  assert.equal(st.mode, 'armed');
  assert.equal(st.autopilotEnabled, true);
  assert.equal(st.planActive, true, 'plan must be active (lock/warning engages) after AUTO ON');
});

// ── disabling the plan (AUTO OFF) ends an in-progress takeover ─────────────
// (operator report 2026-07-03: taken over → AUTO OFF → the "taken over" banner
// lingered because the lease/overridden weren't cleared).
test('setAutopilotEnabled(false) clears an in-progress takeover lease + exits overridden', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  svc.takeover();
  assert.ok(svc.state.operatorLease, 'lease armed by takeover');
  assert.equal(svc.state.mode, 'overridden');
  await svc.setAutopilotEnabled(false);
  const st = svc.getState();
  assert.equal(svc.state.operatorLease, null, 'AUTO OFF clears the takeover lease');
  assert.equal(st.mode, 'armed', 'AUTO OFF exits overridden');
  assert.equal(st.planActive, false, 'plan not driving after AUTO OFF');
  // Both banners drop: planActive false (no lock) AND no lease (no takeover pill).
});

// ── savePlan over the ACTIVE plan hot-reloads it (no re-activate needed) ───
test('savePlan over the active plan hot-reloads the in-memory plan and keeps the event ring', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  const ringBefore = svc.getState().recentFires.length;
  const updated = makePlan();
  updated.cues = [...updated.cues, {
    id: 'c_hot_added',
    label: 'Hot added',
    kind: 'ambient',
    trigger: { type: 'clock', at: '03:00' },
    action: { type: 'playlist', name: 'baseline_pl', target: { channel: 'deck', id: null } },
    durationMin: 30,
    days: 'all',
  }];
  await svc.savePlan(updated);
  // In-memory plan now carries the new cue (the live overview / fires see it).
  assert.ok(svc.plan.cues.some((c) => c.id === 'c_hot_added'), 'active plan must hot-reload on save');
  // The event ring is preserved (unlike activatePlan) and gains the lifecycle entry.
  const ring = svc.getState().recentFires;
  assert.ok(ring.length >= ringBefore, 'save must not clear the event ring');
  const evt = ring.find((e) => e.kind === 'lifecycle' && e.reason === 'save');
  assert.ok(evt, 'save-over-active must log a "Plan updated (live)" lifecycle event');
});

// ── Task A/B: festival-window gating of the plan soft deck-pin ──────────────
// The 'plan' controlLock (yellow "PLAN IS RUNNING" soft-lock) must engage ONLY
// while the plan is "in time" (today inside its festival span). Out of window
// the plan may still drive the deck's CONTENT, but must NOT pin the view /
// raise the lock. getState also surfaces the window state + a pre-festival
// countdown for CaptainPad.

function makeFestivalPlan() {
  const plan = makePlan();
  plan.schemaVersion = 2;
  // BRC 2026 span: 2026-08-30 .. 2026-09-06 (8 days) in America/Los_Angeles.
  plan.festival = { startDate: '2026-08-30', days: 8 };
  return plan;
}

function setupFestival({ now }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlsvc-fest-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(makeFestivalPlan(), path.join(sceneDir, 'test_plan.yaml'));
  const { deps, calls } = makeDeps();
  let nowMs = now;
  const svc = new TimelineService({
    scene: 'summer_camp_dome', sceneDir, stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps, broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => nowMs,
  });
  return { svc, calls, setNow: (n) => { nowMs = n; } };
}

// 2026-08-31 10:00 PT — festival day index 1 (inside the span).
const FEST_IN_WINDOW = Date.UTC(2026, 7, 31, 17, 0, 0);
// 2026-08-20 10:00 PT — ten calendar days BEFORE the span.
const FEST_BEFORE_WINDOW = Date.UTC(2026, 7, 20, 17, 0, 0);

test('Task A/B: out of festival window → DORMANT (planActive false, no pin, countdown surfaced)', async () => {
  const { svc, calls } = setupFestival({ now: FEST_BEFORE_WINDOW });
  await svc.start();
  await svc._tick();                 // exercise the dormant path
  svc.stop();
  const st = svc.getState();
  assert.equal(st.inFestivalWindow, false, 'today is before the festival span');
  assert.equal(st.festivalStartsInDays, 10, 'ten calendar days until startDate');
  // Out of window the plan drives NOTHING (operator request 2026-07-03): the
  // ONLY signal is the timeline-tab countdown. planActive false → no deck/mixer
  // lock, no takeover.
  assert.equal(st.planActive, false, 'plan is DORMANT out of window — drives nothing');
  assert.equal(st.controller, 'manual', 'dormant → controller manual (baseline not armed)');
  assert.equal(calls.forceDeckView.length, 0, 'plan must NOT pin the deck out of window');
  assert.equal(calls.viewState.mode, null, 'nothing pinned → controlLock cascades null');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false out of window');
});

test('Task A/B: in festival window → deck-pin engaged, plan lock on, no countdown', async () => {
  const { svc, calls } = setupFestival({ now: FEST_IN_WINDOW });
  await svc.start();
  svc.stop();
  const st = svc.getState();
  assert.equal(st.inFestivalWindow, true, 'today is inside the festival span');
  assert.equal(st.festivalStartsInDays, null, 'no countdown once the festival has started');
  assert.equal(st.planActive, true);
  assert.ok(calls.forceDeckView.length >= 1, 'plan pins the deck in window');
  assert.equal(calls.viewState.mode, 'deck', 'deck pinned → controlLock plan');
  assert.equal(st.forcingDeckView, true, 'forcingDeckView true in window');
});

test('out of window: takeover is a no-op + AUTO OFF never strands a lease (dormant)', async () => {
  // Operator report 2026-07-03: on boot out of window the autopilot was "on"
  // and turning it off flashed a "plan taken over" warning. Out of window the
  // plan must be inert: no baseline driving, and no takeover can arm.
  const { svc, calls } = setupFestival({ now: FEST_BEFORE_WINDOW });
  await svc.start();
  await svc._tick();
  assert.equal(svc.getState().planActive, false, 'dormant: planActive false');
  assert.equal(svc._baselineArmed, false, 'dormant: baseline autopilot NOT armed');
  // A stray takeover must NOT arm a lease out of window.
  const r = svc.takeover();
  assert.equal(r.operatorLease, null, 'takeover is a no-op out of window');
  assert.equal(svc.state.operatorLease, null, 'no lease armed');
  assert.notEqual(svc.state.mode, 'overridden', 'never enters overridden out of window');
  // Toggling autopilot never leaves a stranded lease / overridden.
  await svc.setAutopilotEnabled(false);
  await svc.setAutopilotEnabled(true);
  await svc._tick();
  const st = svc.getState();
  assert.equal(st.planActive, false, 'still dormant regardless of the AUTO toggle');
  assert.equal(st.operatorLease, null, 'no takeover lease → no "taken over" banner');
  assert.equal(calls.forceDeckView.length, 0, 'never pins the deck out of window');
  svc.stop();
});

test('Task A: leaving the festival window releases the plan deck-pin', async () => {
  const { svc, calls, setNow } = setupFestival({ now: FEST_IN_WINDOW });
  await svc.start();
  assert.equal(calls.viewState.mode, 'deck', 'pinned in window on boot');
  // Advance the clock past the festival span (2026-09-08, well after index 7).
  setNow(Date.UTC(2026, 8, 8, 17, 0, 0));
  await svc._tick();                 // reconcile releases the pin
  svc.stop();
  const st = svc.getState();
  assert.equal(st.inFestivalWindow, false, 'clock moved out of the span');
  assert.ok(calls.releaseDeckView.length >= 1, 'the pin is released on leaving the window');
  assert.equal(calls.viewState.mode, null, 'controlLock cascades null after release');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false once out of window');
});

test('Task B: a no-festival plan is always in window (unchanged behavior)', async () => {
  // makePlan() (schemaVersion 1) has NO festival → recurring-nightly, always locks.
  const { svc, calls } = setup();
  await svc.start();
  svc.stop();
  const st = svc.getState();
  assert.equal(st.inFestivalWindow, true, 'a no-festival plan is always in window');
  assert.equal(st.festivalStartsInDays, null, 'no festival → no countdown');
  assert.ok(calls.forceDeckView.length >= 1, 'no-festival plan still pins the deck (unchanged)');
});

// ── 2026-07-02 audit regressions (bulletproofing pass) ──────────────────────

test('audit H2: festival window OPENING mid-run re-pins on the next tick', async () => {
  // Boot BEFORE the window: the plan is DORMANT (2026-07-03 isolation — no
  // baseline, no pin). No cue transition fires at midnight either, so only the
  // tick-side re-establish + re-pin can engage the lock when startDate arrives.
  const { svc, calls, setNow } = setupFestival({ now: FEST_BEFORE_WINDOW });
  await svc.start();
  assert.equal(calls.viewState.mode, null, 'not pinned before the window (dormant)');
  // Clock crosses into the festival span (day 1, 2026-08-31 10:00 PT).
  setNow(FEST_IN_WINDOW);
  await svc._tick();
  svc.stop();
  assert.equal(calls.viewState.mode, 'deck', 'window opened → tick re-pins the deck');
  assert.equal(svc.getState().forcingDeckView, true, 'lock engaged without any cue transition');
});

test('audit S8: boot honors the PERSISTED active plan over the config default', async () => {
  const { svc, sceneDir, stateDir } = setup();
  await svc.start();
  svc.stop();
  // Operator activates a different plan; the activation persists to state.
  const other = makePlan();
  other.name = 'operator_plan';
  await svc.savePlan(other);
  await svc.activatePlan('operator_plan');
  // Reboot with the CONFIG still naming test_plan (the pre-fix path silently
  // loaded test_plan's CONTENT while reporting activePlan operator_plan).
  const { deps } = makeDeps();
  const svc2 = new TimelineService({
    scene: 'summer_camp_dome', sceneDir, stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps, broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => Date.UTC(2026, 7, 30, 2, 0, 0),
  });
  await svc2.start();
  svc2.stop();
  assert.equal(svc2.plan.name, 'operator_plan', 'boot must RUN the persisted active plan');
  assert.equal(svc2.getState().activePlan, 'operator_plan', 'reported name matches the running content');
});

test('audit C1: resume() after a takeover clears the lease (no orphan)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  svc.takeover();
  assert.ok(svc.state.operatorLease, 'lease armed by takeover');
  await svc.resume();
  assert.equal(svc.state.operatorLease, null, 'resume must not strand the lease');
  assert.equal(svc.state.mode, 'armed');
});

test('audit C1 backstop: the tick drops an orphaned lease on a non-overridden mode', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  // Force the trap state directly (any pre-fix mode exit could leave this).
  svc.state.mode = 'armed';
  svc.state.operatorLease = { expiresAtMs: svc.nowFn() + 999999 };
  await svc._tick();
  assert.equal(svc.state.operatorLease, null, 'orphaned lease dropped by the tick');
  assert.equal(svc.state.mode, 'armed');
});

// ── Task 1: a `master` global operates the DECK GRAND MASTER (not a dead CPC) ──
// Before the fix, a look/globals `master` wrote an unregistered CPC key that
// nothing reads (silent no-op). It must route to the setMaster dep (the same
// mixer.setMaster path the operator's master fader uses); every OTHER global key
// still goes to the CPC via setParams.

function makeMasterLookPlan() {
  const plan = makePlan();
  // A look that bundles a master global (→ setMaster) with a real CPC param
  // (size → setParams) so we can prove the split.
  plan.looks.masterlook = { playlist: 'show_pl', globals: { master: 0.4, size: 0.2 } };
  plan.cues = [{
    id: 'c_master', label: 'Master look', kind: 'ambient',
    trigger: { type: 'manual' }, action: { type: 'look', look: 'masterlook' },
  }];
  return plan;
}

test('Task 1: a look `master` global routes to setMaster; other globals to setParams', async () => {
  const { svc, calls } = setupWithPlan(makeMasterLookPlan());
  await svc.start();
  svc.stop();
  calls.setMaster.length = 0;
  calls.setParams.length = 0;

  await svc.fireCue('c_master');

  assert.deepEqual(calls.setMaster, [0.4], 'master global lands on the deck grand-master dep');
  // The remaining CPC globals go to setParams — and `master` must NOT be among them.
  const paramWrites = Object.assign({}, ...calls.setParams);
  assert.equal(paramWrites.size, 0.2, 'non-master globals still write to the CPC');
  assert.equal('master' in paramWrites, false, 'master must NOT be written to the CPC');
});

test('Task 1: a master global fails loud when the setMaster dep is missing', async () => {
  const { svc, deps } = setupWithPlan(makeMasterLookPlan());
  await svc.start();
  svc.stop();
  delete deps.setMaster; // simulate a mis-wired engine
  await assert.rejects(() => svc.fireCue('c_master'), /setMaster dep is required/);
});

// ── Task 3: RESUME re-applies the CURRENTLY-ACTIVE (deck-window-owning) cue ────
// A mood / phase / ambient / manual cue that owns the deck has NO schedulable
// trigger, so the clock/sun `best` catchUp never restores it. On resume (and on
// operator-lease auto-release) the deck must reset to that cue's COMPLETE action,
// overwriting any operator change made during the takeover.

function makeResumeOwnerPlan() {
  const plan = makePlan();
  // A manual-trigger ambient DECK playlist cue with a colorAutopilot block: it
  // owns the deck window but has no clock/sun trigger, so only the new
  // `_deckWindowCueId` re-dispatch can restore it on resume.
  plan.cues = [{
    id: 'c_owner', label: 'Deck owner', kind: 'ambient',
    trigger: { type: 'manual' },
    action: {
      type: 'playlist', name: 'show_pl', target: { channel: 'deck', id: null },
      autopilot: { active: true, delay_s: 20, shuffle: false },
      colorAutopilot: { active: true, palettes: ['deep_sea'], delay_s: 2, shuffle: false },
    },
  }];
  return plan;
}

test('Task 3: resume() re-applies the deck-window cue (playlist + colorAutopilot)', async () => {
  const { svc, calls } = setupWithPlan(makeResumeOwnerPlan());
  await svc.start();
  // Fire the ambient deck owner → it takes the deck window.
  await svc.fireCue('c_owner');
  assert.equal(svc._deckWindowCueId, 'c_owner', 'the ambient cue owns the deck window');

  // Operator takes over and changes the deck (simulated: clear the dep log so a
  // re-apply is observable, and imagine colorAutopilot was toggled off).
  svc.takeover();
  calls.loadPlaylist.length = 0;
  calls.setAutopilot.length = 0;
  calls.setColorAutopilot.length = 0;

  await svc.resume();
  svc.stop();

  // The FULL cue action is re-applied: playlist reload, pattern autopilot, and
  // the colorAutopilot are all re-asserted to the plan's authored values.
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'),
    `resume must reload the owner playlist, got ${JSON.stringify(calls.loadPlaylist)}`);
  assert.equal(calls.setColorAutopilot.length, 1, 'resume re-applies the cue colorAutopilot');
  assert.deepEqual(calls.setColorAutopilot[0], {
    active: true, palettes: ['deep_sea'], delay_s: 2, shuffle: false, transitionMs: 0,
  });
  assert.ok(calls.setAutopilot.some((c) => c.state && c.state.active === true),
    'resume re-applies the cue pattern autopilot');
  // A 'resume' fire is recorded and the deck window ownership is restored.
  assert.ok(svc.getState().recentFires.some((f) => f.cueId === 'c_owner' && f.reason === 'resume'),
    'resume re-apply is logged as a fire');
  assert.equal(svc._deckWindowCueId, 'c_owner', 'deck window ownership restored to the plan cue');
});

test('Task 3: a look owner (palette) is re-applied on resume', async () => {
  const plan = makePlan();
  plan.looks.ownerlook = { playlist: 'show_pl', palette: 'deep_sea' };
  plan.cues = [{
    id: 'c_look_owner', label: 'Look owner', kind: 'ambient',
    trigger: { type: 'manual' }, action: { type: 'look', look: 'ownerlook' },
  }];
  const { svc, calls } = setupWithPlan(plan);
  await svc.start();
  await svc.fireCue('c_look_owner');
  assert.equal(svc._deckWindowCueId, 'c_look_owner');

  svc.takeover();
  calls.loadPlaylist.length = 0;
  calls.setParams.length = 0;

  await svc.resume();
  svc.stop();

  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'), 'look playlist re-applied');
  assert.ok(calls.setParams.some((p) => p.colorPalette1), 'look palette (global color) re-applied on resume');
});

test('Task 3: operator-lease AUTO-release re-applies the deck-window cue', async () => {
  let nowMs = Date.UTC(2026, 7, 30, 2, 0, 0);
  const { svc, calls } = setupWithPlan(makeResumeOwnerPlan());
  svc.nowFn = () => nowMs;
  await svc.start();
  await svc.fireCue('c_owner');
  svc.takeover();
  calls.loadPlaylist.length = 0;
  calls.setColorAutopilot.length = 0;

  // Inactivity past the lease → the tick auto-releases and resumes at now.
  nowMs = svc.state.operatorLease.expiresAtMs + 1000;
  await svc._tick();
  svc.stop();

  assert.equal(svc.state.mode, 'armed', 'lease auto-released');
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('show_pl'),
    'auto-release re-applies the owner playlist');
  assert.equal(calls.setColorAutopilot.length, 1, 'auto-release re-applies the cue colorAutopilot');
});

test('Task 3: boot catchUp does NOT spuriously re-dispatch (priorDeckWindowCueId null)', async () => {
  // On a fresh boot the deck-window owner is null, so the new re-apply branch
  // must not fire a phantom cue — only the baseline is established.
  const { svc, calls } = setupWithPlan(makeResumeOwnerPlan());
  await svc.start();
  svc.stop();
  // c_owner is manual/ambient and never fired on boot → no resume re-apply.
  assert.ok(!svc.getState().recentFires.some((f) => f.reason === 'resume'),
    'boot must not log a resume re-apply');
  // colorAutopilot was never armed (owner never fired) on a clean boot.
  assert.equal(calls.setColorAutopilot.length, 0, 'boot does not arm the owner colorAutopilot');
});
