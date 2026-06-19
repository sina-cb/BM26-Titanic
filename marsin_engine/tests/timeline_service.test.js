import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../lib/timeline/show_plan.js';

// ── fakes ─────────────────────────────────────────────────────────────────

function makeDeps() {
  const calls = {
    loadPlaylist: [],
    setAutopilot: [],
    setParams: [],
    requestScene: [],
    patchScheduledTask: [],
    fireScheduledTask: [],
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
  const deps = {
    loadPlaylist: (a) => { assertTarget(a.target); calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { assertTarget(a.target); calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    requestScene: (a) => { calls.requestScene.push(a); },
    patchScheduledTask: (id, patch) => { calls.patchScheduledTask.push({ id, patch }); },
    fireScheduledTask: (id) => { calls.fireScheduledTask.push(id); },
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
  };
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
  svc.savePlan(authored);
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
  assert.throws(() => svc.savePlan({ schemaVersion: 1, name: 'bad' }), /location|cues/);
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

// ── Fix 8: hold() updates controller immediately ──────────────────────────────

test('hold() sets controller to manual immediately (Fix 8)', async () => {
  const { svc } = setup();
  await svc.start();
  svc.stop();
  assert.equal(svc.state.controller, 'autopilot');
  svc.hold(5);
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
