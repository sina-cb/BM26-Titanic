/*
 * timeline_tick_serialization.test.js — P0-3 of report 356 (finding F3).
 *
 * The tick must NEVER interleave with a plan or party MUTATION. `_ticking` only
 * ever guarded tick-vs-tick, and every mutation (activate / save / resume /
 * lease-release / the party HTTP controls) awaits device work — so the 1 s tick
 * ran straight through the middle of them. Observed live: the tick fired the
 * Party Window baseline while `activatePlan` was mid-catchUp, and the
 * mutation's own baseline step applied the default cue on top of it a second
 * later. A phase trigger is rising-edge and `currentPhase` is persisted, so the
 * baseline never came back for the rest of the night. RETURN TO LIVE AUDIO had
 * the same shape: two default-cue applies two seconds apart.
 *
 * Split into its own file for the reason report 20260725_12 §7 documents: a
 * large chatty service-level file trips a Windows node:test worker-IPC flake
 * that truncates the run.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/timeline_tick_serialization.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';

// Service chatter trips the Windows worker-IPC flake noted above.
const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

const TZ = 'America/Los_Angeles';
const DAY0 = '2026-08-23';
const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }];

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [] };
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
    listPlaylists: () => ['baseline_pl', 'pwb_pl', 'ambient_pl', 'party_pl'],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => { viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      if (viewState.source === 'plan') { viewState.mode = null; viewState.source = null; }
    },
    getViewOverrideMode: () => viewState.mode,
  };
  return { deps, calls };
}

// The operator authored shape: a wrapping Party Window, its ambient PHASE
// baseline, and the party session cue gated on the same phase.
function makePlan(name) {
  return {
    schemaVersion: 2,
    name,
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    festival: { startDate: DAY0, days: 4 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: false,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: { pw: { start: { clock: '21:00' }, end: { clock: '09:00' } } },
    looks: {
      pwb: { playlist: 'pwb_pl' },
      ambient: { playlist: 'ambient_pl' },
      party: { playlist: 'party_pl' },
    },
    defaultCue: { label: 'Default (from deck)', action: { type: 'look', look: 'ambient' } },
    cues: [
      {
        id: 'pwb',
        label: 'Party Window baseline',
        kind: 'ambient',
        days: [0],
        trigger: { type: 'phase', phase: 'pw' },
        action: { type: 'look', look: 'pwb' },
      },
      {
        id: 'c_party',
        label: 'Party 1',
        kind: 'mood',
        days: [0],
        durationMin: 15,
        trigger: {
          type: 'mood', from: 'calm', to: 'party', minDwellSec: 0, cooldownSec: 60, whenPhase: 'pw',
        },
        action: { type: 'look', look: 'party' },
      },
    ],
  };
}

// A harness whose `loadPlaylist` can be BLOCKED, so a mutation is caught
// genuinely mid-flight and a tick can be issued underneath it.
function setup(nowMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlser-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(makePlan('boot_plan'), path.join(sceneDir, 'boot_plan.yaml'));
  saveShowPlan(makePlan('window_plan'), path.join(sceneDir, 'window_plan.yaml'));

  const { deps, calls } = makeDeps();
  const record = deps.loadPlaylist;
  const gate = { blocked: false, release: null };
  deps.loadPlaylist = async (a) => {
    record(a);
    if (gate.blocked) await new Promise((r) => { gate.release = r; });
  };
  let now = nowMs;
  const svc = new TimelineService({
    scene: 'test_bench',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'boot_plan', tickMs: 1000,
      mood: { key: 'audioPartyStrong', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => now,
  });
  return {
    svc,
    calls,
    fires: () => svc.recentFires.filter((e) => e.kind === 'fire'),
    blockLoads: () => { gate.blocked = true; },
    openGate: () => {
      gate.blocked = false;
      if (gate.release) { gate.release(); gate.release = null; }
    },
    setNow: (m) => { now = m; },
  };
}

// 22:00 local on festival day 0 — inside the Party Window.
const NOW = Date.UTC(2026, 7, 24, 5, 0, 0);
const settle = () => new Promise((r) => setImmediate(r));

test('a tick issued DURING activatePlan is a no-op — one pwb fire, no default-cue clobber', async () => {
  const h = setup(NOW);
  await h.svc.start();
  h.svc.recentFires.length = 0;

  h.blockLoads();
  const activating = h.svc.activatePlan('window_plan');
  await settle();                                       // let the mutation reach the dep

  const beforeTick = h.fires().length;
  await h.svc._tick();                                  // must not run at all
  assert.equal(h.fires().length, beforeTick, 'the tick fired something underneath the mutation');

  h.openGate();
  await activating;
  await h.svc._tick();                                  // the ordinary next tick
  h.svc.stop();

  const pwbFires = h.fires().filter((f) => f.cueId === 'pwb');
  assert.equal(pwbFires.length, 1, `exactly one baseline fire, got ${JSON.stringify(h.fires())}`);
  assert.ok(!h.fires().some((f) => f.cueId === '__default_cue__'),
    `the default cue must never clobber a live baseline, got ${JSON.stringify(h.fires())}`);
  assert.equal(h.svc._deckWindowCueId, 'pwb', 'the baseline still owns the deck');
  assert.equal(h.svc.getState().deckOwner.cueId, 'pwb');
});

test('RETURN TO LIVE AUDIO produces exactly ONE default apply, tick or no tick', async () => {
  const h = setup(NOW);
  await h.svc.start();
  await h.svc.forcePartySession();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session');
  h.svc.recentFires.length = 0;

  h.blockLoads();
  const returning = h.svc.returnPartyToLiveAudio();
  await settle();
  await h.svc._tick();                                  // must not run at all
  h.openGate();
  await returning;
  await h.svc._tick();
  h.svc.stop();

  // ONE deck-fill apply, attributed to the operator action. Since the P1-5
  // follow-up it lands on the Party Window BASELINE rather than the flat
  // defaultCue — RETURN inside an open window gives the same answer a restart at
  // that instant does — but the F3 race this test exists for is unchanged: one
  // apply, no tick-driven follow-up.
  const fills = h.fires().filter((f) => f.reason === 'party-live-audio');
  assert.deepEqual(fills.map((f) => f.cueId), ['pwb'],
    `one deck-fill apply, on the window baseline, got ${JSON.stringify(h.fires())}`);
  assert.ok(!h.fires().some((f) => f.cueId === '__default_cue__'),
    `the flat defaultCue must not fill inside an open window, got ${JSON.stringify(h.fires())}`);
  assert.equal(h.svc._deckWindowCueId, 'pwb', 'and the baseline holds the ownership latch');
  assert.ok(!h.fires().some((f) => f.reason === 'no-owning-cue'),
    'a second, tick-driven default apply is the F3 race — it must be gone');
});

test('catchUp reports WHY it ran — a resume is not logged as a boot', async () => {
  const h = setup(NOW);
  await h.svc.start();
  h.svc.takeover();
  await settle();
  h.svc.recentFires.length = 0;
  await h.svc.resume();
  h.svc.stop();
  const reasons = h.svc.recentFires.map((e) => e.reason);
  assert.ok(!reasons.includes('boot'),
    `a resume must not be logged as "boot", got ${JSON.stringify(reasons)}`);
});

test('an expired operator lease still releases from INSIDE the tick (no deadlock)', async () => {
  // `_releaseOperatorLease` is the one mutation the TICK ITSELF invokes: it must
  // claim the mutation floor WITHOUT awaiting the tick it is running inside.
  const h = setup(NOW);
  await h.svc.start();
  h.svc.takeover();
  await settle();
  h.setNow(h.svc.state.operatorLease.expiresAtMs + 1000);
  await h.svc._tick();
  h.svc.stop();
  assert.equal(h.svc.state.mode, 'armed', 'the lease must auto-release from inside the tick');
  assert.equal(h.svc._mutationDepth, 0, 'and the mutation floor must be handed back');
});
