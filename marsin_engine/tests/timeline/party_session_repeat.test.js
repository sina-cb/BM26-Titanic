/*
 * party_session_repeat.test.js — REPEATING party sessions and the resume
 * boundary (report 20260725_21, defects D1/D2/D3/D4/D5/D7/D8 from 20260725_20).
 *
 * The operator-decided semantics under test:
 *   • with a time limit, sessions REPEAT — session (durationMin) → cooldown
 *     STAMPED AT SESSION END → the trigger re-arms → the next session fires
 *     while the music sustains (dwell is carried by moodSince, so a continuous
 *     party mood fires immediately at cooldown expiry);
 *   • an engine restart must never kill party for the night (boot re-arm);
 *   • a takeover release / savePlan must never RESURRECT or RESTART a session —
 *     it rejoins the ORIGINAL window or ends the session properly.
 *
 * Third file of the party×timeline suite for the SAME reason the other two were
 * split (report 20260725_12 §7): a large chatty service-level file trips a
 * Windows node:test worker-IPC flake that truncates the run.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/party_session_repeat.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';
import { loadTimelineState } from '../../lib/timeline/timeline_state.js';

// Service chatter would trip the worker-IPC flake described above.
const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }, { id: 'bass_drop', c1: 0.02, c2: 0.9 }];
const PLAYLISTS = ['ambient', 'party_high', 'party_low', 'baseline_pl'];

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [] };
  const viewState = { mode: null, source: null };
  const deps = {
    loadPlaylist: (a) => calls.loadPlaylist.push(a),
    setAutopilot: (a) => calls.setAutopilot.push(a),
    setParams: (a) => calls.setParams.push(a),
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [...PLAYLISTS],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    forceDeckView: () => { viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      if (viewState.source === 'plan') { viewState.mode = null; viewState.source = null; }
    },
    getViewOverrideMode: () => viewState.mode,
  };
  return { deps, calls };
}

function partyPlan(extra = {}) {
  return {
    schemaVersion: 2,
    name: 'party_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    festival: { startDate: '2026-08-25', days: 10 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {
      ambient: { playlist: 'ambient', palette: 'deep_sea' },
      party_high: { playlist: 'party_high', palette: 'bass_drop' },
    },
    defaultCue: { label: 'Ambient', action: { type: 'look', look: 'ambient' } },
    cues: [
      {
        id: 'c_mood_to_party',
        label: 'Party session',
        enabled: true,
        kind: 'mood',
        durationMin: 12,
        trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 120, cooldownSec: 120 },
        action: { type: 'look', look: 'party_high' },
      },
    ],
    ...extra,
  };
}

const IN_WINDOW = Date.UTC(2026, 7, 30, 6, 0, 0);
const MIN = 60000;

function setup(plan = partyPlan(), { now = IN_WINDOW, mood = { party: 0, value: 0 } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partyrep-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, calls } = makeDeps();
  let nowMs = now;
  const moodRef = { value: mood };
  const makeService = () => new TimelineService({
    scene: 'test_bench',
    sceneDir,
    stateDir,
    getMood: () => moodRef.value,
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioPartyStrong', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => nowMs,
  });
  const h = {
    svc: makeService(), deps, calls, stateDir, sceneDir, dir, makeService,
    setNow: (m) => { nowMs = m; },
    setMood: (m) => { moodRef.value = m; },
    loaded: () => calls.loadPlaylist.map((c) => c.name),
    clear: () => { calls.loadPlaylist.length = 0; },
  };
  return h;
}

/** Fire a live FIXED-duration session. Returns the harness. */
async function fireSession(h, { durationMin = 2, cooldownSec = 60 } = {}) {
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationMin, cooldownSec });
  await h.svc._tick();                        // arms while the mood is calm
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();                        // fires
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session', 'setup: session did not start');
  return h;
}

// ── D1 + D3 — sessions REPEAT while the music sustains ───────────────────────

test('D1: continuous party mood → session → cooldown → SECOND session at cooldown expiry', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 2, cooldownSec: 60 });
  const endMs = IN_WINDOW + 2 * MIN;

  // The window elapses with the music still playing.
  h.clear();
  h.setNow(endMs + 1000);
  await h.svc._tick();
  assert.ok(h.loaded().includes('ambient'), 'the default cue must reclaim the deck at the window end');
  let st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'cooldown', `after the session it must COOL DOWN, got ${st.effectiveState}`);

  // Mid-cooldown, with the mood still party: nothing may fire.
  h.clear();
  h.setNow(endMs + 30000);
  await h.svc._tick();
  assert.ok(!h.loaded().includes('party_high'), 'a session fired DURING the cooldown');

  // Cooldown expires → the next session fires immediately (dwell is carried by
  // the continuously-party mood; moodSince is never touched by a session end).
  h.clear();
  h.setNow(endMs + 61000);
  await h.svc._tick();
  st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.ok(h.loaded().includes('party_high'),
    `party must fire again after the cooldown, got ${h.loaded().join(', ') || 'nothing'}`);
  assert.equal(st.effectiveState, 'in_session');
});

test('D3: the cooldown clock starts at SESSION END — 0 during the session, full at the end', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 2, cooldownSec: 120 });

  // Inside the session the cooldown has not started yet.
  assert.equal(h.svc.getPartyStatus().cooldownRemainingSec, 0,
    'a countdown inside the session is the misleading readout D3 pinned');
  h.setNow(IN_WINDOW + 60000);
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().cooldownRemainingSec, 0);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session');

  // At the window end the FULL cooldown starts counting from the end instant.
  const endMs = IN_WINDOW + 2 * MIN;
  h.setNow(endMs + 1000);
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'cooldown', "'cooldown' must be reachable with the shipped numbers");
  assert.ok(st.cooldownRemainingSec >= 118 && st.cooldownRemainingSec <= 120,
    `cooldown must be ~120 s at the session end, got ${st.cooldownRemainingSec}`);
  assert.equal(h.svc.state.moodLastFire.c_mood_to_party, endMs,
    'the cooldown stamp must be the SESSION END instant, not the fire instant');

  // …and it counts down to armed.
  h.setNow(endMs + 121000);
  await h.svc._tick();
  const armed = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(armed.cooldownRemainingSec, 0);
  assert.equal(armed.effectiveState, 'in_session',
    'with the music still on, the cue re-fires the moment the cooldown expires');
});

// ── D2 — an engine restart must never kill party for the night ───────────────

test('D2: a restart mid-session boots RE-ARMED — party is not dead for the night', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 2, cooldownSec: 60 });
  // The session dies with the process, latch persisted false.
  h.svc.stop();
  const dead = loadTimelineState(h.stateDir);
  assert.equal(dead.moodArmed.c_mood_to_party, false,
    'setup: the evaluator must have latched the cue during the session');

  // Cold restart with the music STILL PLAYING and the fire-time cooldown elapsed.
  h.setNow(IN_WINDOW + 5 * MIN);
  h.svc = h.makeService();
  await h.svc.start();
  h.clear();
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.ok(h.loaded().includes('party_high'),
    `a restart killed party for the night, got ${h.loaded().join(', ') || 'nothing'}`);
  assert.equal(st.effectiveState, 'in_session');
});

test('D2: the boot re-arm still honours a persisted COOLDOWN — no free session', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 2, cooldownSec: 600 });
  const endMs = IN_WINDOW + 2 * MIN;
  h.setNow(endMs + 1000);
  await h.svc._tick();                        // window elapsed → cooldown stamped at END
  h.svc.stop();

  // Restart 60 s into a 600 s cooldown: re-armed, but refused by the stamp.
  h.setNow(endMs + 60000);
  h.svc = h.makeService();
  await h.svc.start();
  h.clear();
  await h.svc._tick();
  assert.ok(!h.loaded().includes('party_high'), 'a restart handed out a FREE session mid-cooldown');
  assert.equal(h.svc.getPartyStatus().effectiveState, 'cooldown');

  // …and it fires normally once the persisted cooldown really expires.
  h.setNow(endMs + 601000);
  h.clear();
  await h.svc._tick();
  h.svc.stop();
  assert.ok(h.loaded().includes('party_high'), 'the session never resumed after the persisted cooldown');
});

// ── D4 / D5 — the resume boundary (takeover release, savePlan) ───────────────

test('D4: a takeover release mid-session REJOINS the original window (never a fresh one)', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 12, cooldownSec: 60 });
  const originalEnd = h.svc.getPartyStatus().sessionEndsAtMs;
  assert.equal(originalEnd, IN_WINDOW + 12 * MIN);

  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  // The operator walks away; the 120 s lease expires 5 minutes in, music still on.
  h.setNow(IN_WINDOW + 5 * MIN);
  h.clear();
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(st.effectiveState, 'in_session', 'the session must continue after the release');
  assert.equal(st.sessionEndsAtMs, originalEnd,
    `the release granted a FRESH window (ends ${st.sessionEndsAtMs}, original ${originalEnd})`);
  assert.ok(h.loaded().includes('party_high'), 'the party look must be re-applied over the operator edit');
});

test('D4: a takeover release after the window EXPIRED ends the session, cooldown from the window end', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 2, cooldownSec: 600 });
  const endMs = IN_WINDOW + 2 * MIN;
  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  // Released 5 minutes in — the 2-minute window expired during the takeover.
  h.setNow(IN_WINDOW + 5 * MIN);
  h.clear();
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.notEqual(st.effectiveState, 'in_session', 'the session was RESURRECTED after its window expired');
  assert.equal(st.effectiveState, 'cooldown');
  assert.equal(h.svc.state.moodLastFire.c_mood_to_party, endMs,
    'the cooldown must be credited from the SCHEDULED window end');
  assert.ok(h.loaded().includes('ambient'), 'the default cue must reclaim the deck');
});

test('D4: a takeover release with the MUSIC STOPPED ends the session — no party at CALM', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 12, cooldownSec: 60 });
  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  h.setMood({ party: 0, value: 0 });          // the music stopped during the takeover
  h.setNow(IN_WINDOW + 5 * MIN);
  h.clear();
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.notEqual(st.effectiveState, 'in_session',
    'party was re-applied with the mood at CALM — a session must not outlive its signal here');
  assert.ok(!h.loaded().includes('party_high'), 'the party look must NOT be written with the music off');
  assert.ok(h.loaded().includes('ambient'), 'the default cue must reclaim the deck');
});

test('D5: savePlan mid-session preserves sessionEndsAtMs (no fresh window)', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 12, cooldownSec: 60 });
  const originalEnd = h.svc.getPartyStatus().sessionEndsAtMs;
  h.setNow(IN_WINDOW + 10 * MIN);
  await h.svc.savePlan(partyPlan({ looks: {
    ambient: { playlist: 'ambient', palette: 'deep_sea' },
    party_high: { playlist: 'party_high', palette: 'bass_drop' },
  } }));
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(st.effectiveState, 'in_session');
  assert.equal(st.sessionEndsAtMs, originalEnd,
    `a hot-reload restarted the session window (ends ${st.sessionEndsAtMs}, original ${originalEnd})`);
});

test('D7: savePlan mid FOLLOW-THE-MUSIC session does not flash the deck through ambient', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, true, 'setup: not an open-ended session');

  h.clear();
  h.setNow(IN_WINDOW + 3 * MIN);
  await h.svc.savePlan(partyPlan());
  const st = h.svc.getPartyStatus();
  const wrote = h.loaded();
  h.svc.stop();
  assert.ok(!wrote.includes('ambient'), `the save flashed the deck through ambient: ${wrote.join(', ')}`);
  assert.equal(st.effectiveState, 'in_session', 'the open-ended session must survive the save');
  assert.equal(st.sessionEndsAtMs, null, 'the session must keep its open-ended shape');
  assert.equal(st.sessionFollowsMusic, true);
});

test('D8: a savePlan that REMOVES the party cue mid-session hands the deck to the defaultCue', async () => {
  const h = setup();
  await fireSession(h, { durationMin: 12, cooldownSec: 60 });
  h.clear();
  h.setNow(IN_WINDOW + 3 * MIN);
  await h.svc.savePlan(partyPlan({ cues: [] }));
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.ok(h.loaded().includes('ambient'),
    `the deck was stranded on the autopilot baseline, got ${h.loaded().join(', ') || 'nothing'}`);
  assert.equal(st.effectiveState, 'no_plan', 'with no party cue there is nothing that can fire');
  assert.equal(h.svc._deckWindowCueId, null, 'the ownership latch must not point at a deleted cue');
});
