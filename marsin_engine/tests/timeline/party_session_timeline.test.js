/*
 * party_session_timeline.test.js — the SERVICE-level half of the party×timeline
 * matrix (report 20260725_19). Split out of party_config.test.js purely so each
 * file stays under the Windows node:test worker-IPC volume that flakes a large
 * chatty file (see report 20260725_12 §7); the two are one logical suite.
 *
 * Covers: session fire + deck ownership, fire-time playlist/duration resolution,
 * disable-mid-session, human-takeover precedence, festival-window and no-plan
 * structural gates, effectiveState, cooldown, and FOLLOW-THE-MUSIC mode.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/party_session_timeline.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../../lib/timeline/show_plan.js';
import { evaluateTick } from '../../lib/timeline/triggers.js';
import {
  partyConfigOf, defaultTimelineState, loadTimelineState, saveTimelineState,
  PARTY_PLAYLIST_DEFAULT, PARTY_TIMING_DEFAULTS,
} from '../../lib/timeline/timeline_state.js';

// The TimelineService logs several lines per applied cue. Across this many
// service-level tests that stdout volume trips a known Windows node:test
// worker-IPC flake ("Unable to deserialize cloned data" — report 20260725_12
// §7) which TRUNCATES the run and reports a phantom file-level failure. Silence
// the service chatter for this file only; warnings/errors still surface.
const _origLog = console.log;
console.log = () => {};
process.on("exit", () => { console.log = _origLog; });

const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }, { id: 'bass_drop', c1: 0.02, c2: 0.9 }];
const PLAYLISTS = ['ambient', 'party_high', 'party_low', 'baseline_pl'];

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [], forceDeckView: [], releaseDeckView: [] };
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
    forceDeckView: () => { calls.forceDeckView.push(true); viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      calls.releaseDeckView.push(true);
      if (viewState.source === 'plan') { viewState.mode = null; viewState.source = null; }
    },
    getViewOverrideMode: () => viewState.mode,
  };
  calls.viewState = viewState;
  return { deps, calls };
}

// A plan with the REAL party shape: a mood→party cue firing a look that loads a
// playlist, plus a defaultCue to fall back to. Festival window covers "now".
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

const IN_WINDOW = Date.UTC(2026, 7, 30, 6, 0, 0);   // inside the festival window

function setup(plan = partyPlan(), { now = IN_WINDOW, mood = { party: 0, value: 0 } } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'party-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, calls } = makeDeps();
  let nowMs = now;
  const moodRef = { value: mood };
  const svc = new TimelineService({
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
  return {
    svc, deps, calls, stateDir, sceneDir, dir,
    setNow: (m) => { nowMs = m; },
    setMood: (m) => { moodRef.value = m; },
  };
}

// ── service-level: session lifecycle vs the timeline ─────────────────────────

/** Drive the service to a live party session and return the harness. */
async function inSession(h) {
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0 });
  // The mood cue ARMS while the mood sits at `from` (calm), then fires once the
  // mood holds at `to` (party) — exactly the real sequence.
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  return h;
}

test('a party session fires, owns the deck, and loads the CONFIGURED playlist', async () => {
  const h = setup();
  await inSession(h);
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('party_high'), `party playlist never loaded (got ${loaded.join(', ')})`);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session');
  h.svc.stop();
});

test('the party playlist is resolved at FIRE TIME from party-config, not the plan look', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, playlist: 'party_low' });
  await h.svc._tick();
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('party_low'),
    `the fire must load the CONFIGURED playlist, got ${loaded.join(', ') || 'nothing'}`);
  assert.ok(!loaded.includes('party_high'), "the plan look's own playlist must be overridden");
  h.svc.stop();
});

test('the session WINDOW comes from party-config durationMin, not the plan cue', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationMin: 2 });   // plan says 12
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'in_session');
  const windowMin = (st.sessionEndsAtMs - IN_WINDOW) / 60000;
  assert.ok(Math.abs(windowMin - 2) < 0.05, `session window should be 2 min, got ${windowMin}`);
  h.svc.stop();
});

test('DISABLING mid-session ends it immediately and the defaultCue reclaims the deck', async () => {
  const h = setup();
  await inSession(h);
  h.calls.loadPlaylist.length = 0;
  await h.svc.setPartyConfig({ enabled: false });
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  assert.ok(loaded.includes('ambient'),
    `the default cue must reclaim the deck, got ${loaded.join(', ') || 'nothing'}`);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'disabled');
  assert.equal(h.svc.getState().partyEnabled, false, '/timeline/state must expose the policy');
  h.svc.stop();
});

test('DISABLING during a HUMAN TAKEOVER never re-applies anything — human > everything', async () => {
  const h = setup();
  await inSession(h);
  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  h.calls.loadPlaylist.length = 0;
  await h.svc.setPartyConfig({ enabled: false });
  assert.deepEqual(h.calls.loadPlaylist, [],
    'party disable seized the deck from a human operator — it must not touch it');
  assert.equal(h.svc.getPartyStatus().effectiveState, 'disabled');
  h.svc.stop();
});

test('a HUMAN TAKEOVER blocks a pending party fire (the arbiter rule, no party special case)', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0 });
  await h.svc._tick();
  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  await h.svc._tick();
  assert.ok(!h.calls.loadPlaylist.some((c) => c.name === 'party_high'),
    'a party session started while a human held the deck');
  assert.equal(h.svc.getPartyStatus().effectiveState, 'manual');
  h.svc.stop();
});

test('OUT OF THE FESTIVAL WINDOW nothing fires — the plan is dormant (structural)', async () => {
  const h = setup(partyPlan(), { now: Date.UTC(2026, 6, 1, 6, 0, 0) });   // ~2 months early
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0 });
  await h.svc._tick();
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  await h.svc._tick();
  assert.ok(!h.calls.loadPlaylist.some((c) => c.name === 'party_high'),
    'a party session fired outside the festival window');
  assert.equal(h.svc.getPartyStatus().effectiveState, 'no_plan');
  assert.equal(h.svc.getPartyStatus().enabled, true, 'the POLICY is still armed — only the plan is dormant');
  h.svc.stop();
});

test('with no plan loaded there is no dwell and no session — the trigger lives in the plan', async () => {
  const h = setup();
  // Never started: plan + state are null, so _tick returns immediately.
  await h.svc._tick();
  assert.equal(h.calls.loadPlaylist.length, 0);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'no_plan');
  assert.equal(h.svc.getState().partyEnabled, true);
  assert.equal(h.svc.getState().partyPlaylist, PARTY_PLAYLIST_DEFAULT);
});

test('effectiveState distinguishes disabled / no_plan / manual / in_session / armed', async () => {
  const h = setup();
  await h.svc.start();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'armed');
  await h.svc.setPartyConfig({ enabled: false });
  assert.equal(h.svc.getPartyStatus().effectiveState, 'disabled', 'operator disable outranks everything else shown');
  await h.svc.setPartyConfig({ enabled: true });
  h.svc.takeover();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.svc.getPartyStatus().effectiveState, 'manual');
  h.svc.stop();
});

test('COOLDOWN is reported from party-config, and survives a restart mid-cooldown', async () => {
  const h = setup();
  await inSession(h);
  await h.svc.setPartyConfig({ cooldownSec: 600 });
  // End the session by disabling→enabling (the deck window clears).
  await h.svc.setPartyConfig({ enabled: false });
  await h.svc.setPartyConfig({ enabled: true });
  const st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'cooldown');
  assert.ok(st.cooldownRemainingSec > 0 && st.cooldownRemainingSec <= 600);
  // The mood-fire stamp is persisted state, so a restart still sees the cooldown.
  h.svc.stop();
  const onDisk = loadTimelineState(h.stateDir);
  assert.ok(onDisk.moodLastFire && typeof onDisk.moodLastFire.c_mood_to_party === 'number',
    'the cooldown stamp must be persisted — a restart must not hand out a free session');
  assert.equal(onDisk.partyCooldownSec, 600);
});

test('saveTimelineState/loadTimelineState carry the party fields verbatim', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partyst-'));
  const s = defaultTimelineState();
  s.partyEnabled = false; s.partyPlaylist = 'party_low';
  s.partyMinDwellSec = 30; s.partyDurationMin = 5; s.partyCooldownSec = 45;
  saveTimelineState(s, dir);
  assert.deepEqual(partyConfigOf(loadTimelineState(dir)), {
    enabled: false, playlist: 'party_low', minDwellSec: 30, durationMin: 5, cooldownSec: 45,
    durationEnabled: true, cooldownEnabled: true,
  });
});

// ── FOLLOW-THE-MUSIC mode (durationEnabled:false) ────────────────────────────
// ONE release sustain, and it lives in the COMPANION: `audioPartyStrong` only
// drops after the detector's own offConfirmMs of continuous disqualification,
// so the timeline ends the session the moment the signal drops. No second wait.

test('effective values: follow-the-music has no duration and NO cooldown at all', async () => {
  const h = setup();
  await h.svc.start();
  let cfg = h.svc.getPartyConfig();
  assert.equal(cfg.effectiveDurationMin, 12);
  assert.equal(cfg.effectiveCooldownEnabled, true);
  assert.equal(cfg.effectiveCooldownSec, 120, 'shipped cooldown is 2 minutes');

  await h.svc.setPartyConfig({ durationEnabled: false });
  cfg = h.svc.getPartyConfig();
  assert.equal(cfg.effectiveDurationMin, null, 'no fixed length in follow-the-music');
  assert.equal(cfg.effectiveCooldownEnabled, false, 'cooldown is forced off with duration off');
  assert.equal(cfg.effectiveCooldownSec, 0);
  assert.equal(cfg.cooldownEnabled, true, 'the STORED preference is untouched — only the effect changes');

  // cooldownEnabled:false inside durationEnabled:true also zeroes the effect.
  await h.svc.setPartyConfig({ durationEnabled: true, cooldownEnabled: false });
  cfg = h.svc.getPartyConfig();
  assert.equal(cfg.effectiveCooldownSec, 0);
  assert.equal(cfg.effectiveDurationMin, 12);
  h.svc.stop();
});

test('a follow-the-music session opens with NO window and ends when the signal drops', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();                       // arms on calm
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();                       // fires
  let st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'in_session');
  assert.equal(st.sessionEndsAtMs, null, 'an open-ended session must have no end time');
  assert.equal(st.sessionFollowsMusic, true);

  // The music keeps going: many ticks, still in session (NOT ended early).
  for (let i = 0; i < 5; i++) await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session',
    'a follow-the-music session ended while the music was still playing');

  // Signal drops (the detector already waited out offConfirmMs) → ends promptly.
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.ok(loaded.includes('ambient'), `the default cue must reclaim the deck, got ${loaded.join(', ') || 'nothing'}`);
  assert.notEqual(st.effectiveState, 'in_session', 'the session must be over once the signal dropped');
});

test('after a follow-the-music session there is NO cooldown — re-trigger needs only the dwell', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false, cooldownSec: 7200 });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();                       // session released, cue re-arms
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();                       // must fire again immediately
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  const cooling = h.svc.getPartyStatus().cooldownRemainingSec;
  h.svc.stop();
  assert.ok(loaded.includes('party_high'),
    `a 7200 s cooldown must be IGNORED in follow-the-music mode, got ${loaded.join(', ') || 'nothing'}`);
  assert.equal(cooling, 0, 'no cooldown may be reported in follow-the-music mode');
});

test('the timeline does NOT re-implement debounce: it follows the already-debounced signal 1:1', async () => {
  // The division of labour: the companion swallows transients (offConfirmMs);
  // the timeline reacts to the DEBOUNCED signal. A transient the detector
  // filtered never reaches the timeline, so the session must ride straight
  // through it — and the timeline must not add drop logic of its own.
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  for (let i = 0; i < 20; i++) await h.svc._tick();
  const held = h.svc.getPartyStatus().effectiveState;
  h.svc.stop();
  assert.equal(held, 'in_session',
    'the timeline added its own drop logic — it must follow the debounced signal only');
});

test('a STALE mood (companion died) ends a follow-the-music session — forced CALM is honoured', async () => {
  // The staleness guard forces CALM when the companion stops republishing. An
  // open-ended session MUST end on that, not pin the rig in party forever.
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session');
  // MoodSource forces CALM: party 0 with the frozen raw value still 1.
  h.calls.loadPlaylist.length = 0;
  h.setMood({ party: 0, value: 0, stale: true, rawValue: 1 });
  await h.svc._tick();
  const loaded = h.calls.loadPlaylist.map((c) => c.name);
  h.svc.stop();
  assert.ok(loaded.includes('ambient'),
    'a dead companion must drop the show to ambient, not hold party forever');
});

test('a LIVE session keeps the mode it STARTED with when the toggle flips mid-session', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, true);
  // Flip to fixed-duration MID-SESSION: the running session stays open-ended.
  await h.svc.setPartyConfig({ durationEnabled: true });
  await h.svc._tick();
  const stillOpen = h.svc.getPartyStatus();
  assert.equal(stillOpen.effectiveState, 'in_session');
  assert.equal(stillOpen.sessionEndsAtMs, null, 'the running session was retro-converted — it must not be');
  assert.equal(stillOpen.sessionFollowsMusic, true);
  // ...and it still ends on the signal drop, the way it started.
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  const after = h.svc.getPartyStatus();
  h.svc.stop();
  assert.notEqual(after.effectiveState, 'in_session');
});

test('a FIXED-duration session is not ended by a signal drop — its window governs', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: true, durationMin: 12 });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, false);
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  const st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(st.effectiveState, 'in_session',
    'a fixed-duration session must ride out a breakdown — that is what durationMin is for');
});

test('toggles round-trip to disk and survive a restart', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ durationEnabled: false, cooldownEnabled: false });
  h.svc.stop();
  const onDisk = loadTimelineState(h.stateDir);
  assert.equal(onDisk.partyDurationEnabled, false);
  assert.equal(onDisk.partyCooldownEnabled, false);
  assert.equal(partyConfigOf(onDisk).durationEnabled, false);
});
