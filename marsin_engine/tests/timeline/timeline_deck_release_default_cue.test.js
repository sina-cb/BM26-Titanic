/*
 * timeline_deck_release_default_cue.test.js — service-level tests for:
 *   P1 (docs/38 §16.9): releaseDeckView on every transition where the plan stops
 *       driving the deck (takeover / autopilot-off). Proves the plan's
 *       soft deck-pin clears (forcingDeckView → false) and, critically, that a
 *       real PortWatch device lock is NEVER cleared by the plan.
 *   P2 (docs/38 §16.11): cue durationMin + plan-level defaultCue — the deck
 *       reverts to defaultCue when a durationMin window elapses, when the plan
 *       has no owning cue, and NEVER when a cue with no durationMin is driving
 *       (today's behavior, no regression).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';

// The service logs a line per cue apply / default-cue reconcile. Run in the full
// batch that chatter is absorbed, but run ALONE it trips the Windows node:test
// worker-IPC flake ("Unable to deserialize cloned data") and truncates the run —
// the same reason party_session_repeat.test.js mutes it (report 20260725_91 §6.1).
const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }];

// A deps fake that mirrors the engine's controlLock machinery closely enough to
// prove the release semantics: forceDeckView() pins with source 'plan';
// releaseDeckView() clears ONLY a 'plan'-owned pin (never 'portwatch'). A test
// can seed source='portwatch' to simulate a real device lock.
function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [], forceDeckView: [], releaseDeckView: [] };
  const assertTarget = (t) => {
    if (!t || (t.kind !== 'deck' && t.kind !== 'mixer')) {
      throw new Error(`dep target must carry kind deck|mixer, got ${JSON.stringify(t)}`);
    }
  };
  const viewState = { mode: null, source: null };
  const deps = {
    loadPlaylist: (a) => { assertTarget(a.target); calls.loadPlaylist.push(a); },
    setAutopilot: (a) => { assertTarget(a.target); calls.setAutopilot.push(a); },
    setParams: (a) => { calls.setParams.push(a); },
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    forceDeckView: () => { calls.forceDeckView.push(true); viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      calls.releaseDeckView.push(true);
      if (viewState.mode === 'deck' && viewState.source === 'plan') { viewState.mode = null; viewState.source = null; }
    },
    getViewOverrideMode: () => viewState.mode,
  };
  calls.viewState = viewState;
  return { deps, calls };
}

function basePlan(extra = {}) {
  return {
    schemaVersion: 1,
    name: 'release_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: { house: { playlist: 'house_pl', palette: 'deep_sea' } },
    cues: [],
    ...extra,
  };
}

function setup(plan, { now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlrel-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, calls } = makeDeps();
  let nowMs = now !== undefined ? now : Date.UTC(2026, 7, 30, 2, 0, 0);
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => nowMs,
  });
  return { svc, deps, calls, setNow: (m) => { nowMs = m; } };
}

// ── P1: releaseDeckView on pause / autopilot-off / takeover ───────────────────

test('P1 takeover releases the plan deck-pin (forcingDeckView → false, pin cleared)', async () => {
  const { svc, calls } = setup(basePlan());
  await svc.start();
  // Boot baseline pinned the deck.
  assert.equal(svc.getState().forcingDeckView, true, 'plan pins deck on boot');
  assert.equal(calls.viewState.mode, 'deck');

  // takeover()'s deck-pin release is fire-and-forget; flush the microtasks.
  svc.takeover();
  await new Promise((r) => setImmediate(r));
  svc.stop();
  assert.ok(calls.releaseDeckView.length >= 1, 'takeover called releaseDeckView');
  assert.equal(calls.viewState.mode, null, 'deck pin cleared on takeover');
  const st = svc.getState();
  assert.equal(st.planActive, false, 'planActive false when overridden');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false when overridden');
});

test('P1 autopilot-off releases the plan deck-pin', async () => {
  const { svc, calls } = setup(basePlan());
  await svc.start();
  assert.equal(calls.viewState.mode, 'deck');

  await svc.setAutopilotEnabled(false);
  svc.stop();
  assert.ok(calls.releaseDeckView.length >= 1, 'autopilot-off called releaseDeckView');
  assert.equal(calls.viewState.mode, null, 'deck pin cleared on autopilot-off');
  const st = svc.getState();
  assert.equal(st.planActive, false, 'planActive false with autopilot off');
  assert.equal(st.forcingDeckView, false, 'forcingDeckView false with autopilot off');

  // Turning autopilot back on re-pins (symmetry).
  calls.forceDeckView.length = 0;
  await svc.setAutopilotEnabled(true);
  assert.ok(calls.forceDeckView.length >= 1, 're-enabling autopilot re-pins the deck');
  assert.equal(svc.getState().forcingDeckView, true, 'forcingDeckView true again');
});

test('P1 takeover releases the plan deck-pin', async () => {
  const { svc, calls } = setup(basePlan());
  await svc.start();
  assert.equal(calls.viewState.mode, 'deck');
  svc.takeover();
  // takeover release is fire-and-forget; let the microtask flush.
  await Promise.resolve();
  svc.stop();
  assert.ok(calls.releaseDeckView.length >= 1, 'takeover called releaseDeckView');
  assert.equal(calls.viewState.mode, null, 'deck pin cleared on takeover');
});

test('P1 a PortWatch device lock is NEVER cleared by the plan release', async () => {
  const { svc, calls } = setup(basePlan());
  await svc.start();
  // Simulate a real PortWatch device grabbing the deck AFTER the plan pinned it.
  calls.viewState.mode = 'deck';
  calls.viewState.source = 'portwatch';

  svc.takeover();
  await new Promise((r) => setImmediate(r));
  await svc.setAutopilotEnabled(false);
  svc.stop();
  // The plan asked to release, but the fake (like the engine) refuses to clear a
  // 'portwatch' pin — the hardware lock stands.
  assert.ok(calls.releaseDeckView.length >= 1, 'plan attempted release');
  assert.equal(calls.viewState.mode, 'deck', 'portwatch deck pin untouched');
  assert.equal(calls.viewState.source, 'portwatch', 'portwatch source untouched');
});

// ── P2: default cue fills gaps + durationMin windows ──────────────────────────

test('P2 empty-cues plan with a defaultCue drives the deck with the default cue', async () => {
  const plan = basePlan({ defaultCue: { label: 'House', action: { type: 'look', look: 'house' } } });
  const { svc, calls } = setup(plan);
  await svc.start();
  svc.stop();
  // The default cue applied a look → its playlist (house_pl) loaded on the deck.
  const loaded = calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('house_pl'), `expected default-cue playlist load, got ${JSON.stringify(loaded)}`);
  // Default cue pins the deck like any deck cue.
  assert.equal(svc.getState().forcingDeckView, true, 'default cue pins the deck');
});

test('P2 durationMin window elapsing → deck reverts to the defaultCue', async () => {
  // A program cue at 12:00 with a 30-min duration; after 12:30 the deck reverts
  // to the default cue. Clock trigger so it's tz-stable.
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'look', look: 'house' } },
    cues: [
      {
        id: 'c_show', label: 'Show', kind: 'program',
        trigger: { type: 'clock', at: '12:00' },
        action: { type: 'playlist', name: 'show_pl', target: { channel: 'deck', id: null } },
        durationMin: 30,
      },
    ],
  });
  // Boot BEFORE the cue fires (11:00 PT).
  const boot = Date.UTC(2026, 7, 30, 18, 0, 0); // 11:00 PT
  const { svc, calls, setNow } = setup(plan, { now: boot });
  await svc.start();

  // 12:00 PT — the cue fires, opens a 30-min deck window.
  setNow(Date.UTC(2026, 7, 30, 19, 0, 0));
  await svc._tick();
  const afterFire = calls.loadPlaylist.map((c) => c.name);
  assert.ok(afterFire.includes('show_pl'), 'the show cue loaded show_pl on the deck');
  calls.loadPlaylist.length = 0;

  // 12:15 PT — still inside the window: the default cue must NOT fill yet.
  setNow(Date.UTC(2026, 7, 30, 19, 15, 0));
  await svc._tick();
  assert.equal(calls.loadPlaylist.map((c) => c.name).includes('house_pl'), false,
    'default cue must NOT fill inside the durationMin window');

  // 12:31 PT — window elapsed: the deck reverts to the default cue (house_pl).
  setNow(Date.UTC(2026, 7, 30, 19, 31, 0));
  await svc._tick();
  svc.stop();
  assert.ok(calls.loadPlaylist.map((c) => c.name).includes('house_pl'),
    'default cue fills the deck once the durationMin window elapses');
});

test('P2 no-durationMin deck cue keeps today\'s behavior (default cue does NOT fill under it)', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'look', look: 'house' } },
    cues: [
      {
        id: 'c_hold', label: 'Hold', kind: 'program',
        trigger: { type: 'clock', at: '12:00' },
        action: { type: 'playlist', name: 'show_pl', target: { channel: 'deck', id: null } },
        hold: { min: 120 },
        // NO durationMin.
      },
    ],
  });
  const boot = Date.UTC(2026, 7, 30, 18, 0, 0); // 11:00 PT
  const { svc, calls, setNow } = setup(plan, { now: boot });
  await svc.start();

  setNow(Date.UTC(2026, 7, 30, 19, 0, 0)); // 12:00 fire
  await svc._tick();
  calls.loadPlaylist.length = 0;

  // 12:45 — no durationMin window, program still holds → default must NOT fill.
  setNow(Date.UTC(2026, 7, 30, 19, 45, 0));
  await svc._tick();
  svc.stop();
  assert.equal(calls.loadPlaylist.map((c) => c.name).includes('house_pl'), false,
    'no-durationMin cue holds the deck; default cue does not fill (no regression)');
});

test('P2 the default cue is subject to the P1 release (takeover clears its pin)', async () => {
  const plan = basePlan({ defaultCue: { label: 'House', action: { type: 'look', look: 'house' } } });
  const { svc, calls } = setup(plan);
  await svc.start();
  assert.equal(svc.getState().forcingDeckView, true, 'default cue pins the deck');
  svc.takeover();
  await new Promise((r) => setImmediate(r));
  svc.stop();
  assert.ok(calls.releaseDeckView.length >= 1, 'takeover released the default-cue deck pin');
  assert.equal(svc.getState().forcingDeckView, false, 'default-cue pin cleared on takeover');
});

test('P2 absent defaultCue → autopilot baseline stands (no regression)', async () => {
  const { svc, calls } = setup(basePlan()); // no defaultCue, no cues
  await svc.start();
  svc.stop();
  const loaded = calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('baseline_pl'), 'baseline playlist drives the deck');
  assert.equal(loaded.includes('house_pl'), false, 'no default cue applied');
  assert.equal(svc.getState().planActive, true, 'plan still active on the baseline');
});
