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
import { evaluateTick, dateClockToEpochMs } from '../../lib/timeline/triggers.js';
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
// `pwb_pl` is the Party Window BASELINE playlist (report 356) — a name unique to
// the phase cue, so a test can tell it apart from the defaultCue's `ambient`.
const PLAYLISTS = ['ambient', 'party_high', 'party_low', 'baseline_pl', 'pwb_pl'];

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

test('a FIXED-duration session ends early only after 15 seconds without party detection', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: true, durationMin: 12 });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, false);
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();                       // starts the 15 s loss hold
  let st = h.svc.getPartyStatus();
  assert.equal(st.signalLossHeldSec, 0);
  assert.equal(st.signalLossRequiredSec, 15);
  h.setNow(IN_WINDOW + 14_000);
  await h.svc._tick();
  st = h.svc.getPartyStatus();
  assert.equal(st.effectiveState, 'in_session');
  assert.equal(st.signalLossHeldSec, 14);
  h.setNow(IN_WINDOW + 15_000);
  await h.svc._tick();
  st = h.svc.getPartyStatus();
  h.svc.stop();
  assert.notEqual(st.effectiveState, 'in_session',
    'a fixed session must release once the 15-second no-party hold completes');
  assert.ok(h.calls.loadPlaylist.some((call) => call.name === 'ambient'),
    'the calm/default cue must reclaim the deck after early release');
});

test('a party signal return inside the 15-second grace period resets the release hold', async () => {
  const h = setup();
  await inSession(h);
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  h.setNow(IN_WINDOW + 10_000);
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().signalLossHeldSec, 10);
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().signalLossHeldSec, 0);
  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  h.setNow(IN_WINDOW + 24_000);
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session',
    'the stale 10-second hold leaked through a recovered signal');
  h.svc.stop();
});

test('Force Party bypasses every gate and RETURN TO LIVE AUDIO cancels it immediately', async () => {
  const plan = partyPlan({
    phases: {
      closed_window: { start: { clock: '08:00' }, end: { clock: '09:00' } },
    },
  });
  plan.cues[0].trigger.whenPhase = 'closed_window';
  const h = setup(plan);
  await h.svc.start();
  h.svc.state.moodLastFire = { c_mood_to_party: IN_WINDOW };
  assert.equal(h.svc.getPartyStatus().partyWindowOpen, false);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'waiting_window');

  const forced = await h.svc.forcePartySession();
  assert.equal(forced.effectiveState, 'in_session');
  assert.equal(forced.sessionForced, true);
  assert.ok(h.calls.loadPlaylist.some((call) => call.name === 'party_high'));

  h.setNow(IN_WINDOW + 60_000);
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session',
    'a forced session listened to the absent signal before RETURN TO LIVE AUDIO');

  const returned = await h.svc.returnPartyToLiveAudio();
  assert.notEqual(returned.effectiveState, 'in_session');
  assert.equal(returned.sessionForced, false);
  assert.equal(h.svc.getPartyStatus().signalLossHeldSec, 0);
  assert.ok(h.calls.loadPlaylist.some((call) => call.name === 'ambient'),
    'the calm/default cue must reclaim the deck immediately');
  h.svc.stop();
});

test('operator can reset an active Party cooldown immediately', async () => {
  const h = setup();
  await inSession(h);
  await h.svc.setPartyConfig({ enabled: false });
  await h.svc.setPartyConfig({ enabled: true });
  assert.equal(h.svc.getPartyStatus().effectiveState, 'cooldown');
  // ASYNC since report 356 P0-3: the reset is serialized against the tick.
  const reset = await h.svc.resetPartyCooldown();
  assert.equal(reset.cooldownRemainingSec, 0);
  assert.equal(reset.effectiveState, 'armed');
  h.svc.stop();
});

// ════════════════════════════════════════════════════════════════════════════
// report 356 — the Party Window (P0-1) and FORCE/RETURN semantics (P0-2)
// ════════════════════════════════════════════════════════════════════════════

const WIN_DAY0 = '2026-08-23';       // festival day 0
const WIN_DAY1 = '2026-08-24';
const WIN_DAY2 = '2026-08-25';
const winAt = (dateKey, hhmm) => dateClockToEpochMs(dateKey, hhmm, 'America/Los_Angeles');

// The operator's authored shape: a Party Window phase that wraps midnight, the
// Party Window BASELINE (an ambient PHASE cue on the same phase), and the party
// session cue gated on that phase. `days` targets ONE night, like `test_week`.
function windowPlan({ days = [0], baselineDays = [0] } = {}) {
  return {
    schemaVersion: 2,
    name: 'party_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    festival: { startDate: WIN_DAY0, days: 4 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: { pw: { start: { clock: '21:00' }, end: { clock: '09:00' } } },
    looks: {
      ambient: { playlist: 'ambient', palette: 'deep_sea' },
      party_high: { playlist: 'party_high', palette: 'bass_drop' },
    },
    defaultCue: { label: 'Default (from deck)', action: { type: 'look', look: 'ambient' } },
    cues: [
      {
        id: 'pwb',
        label: 'Party Window baseline',
        enabled: true,
        kind: 'ambient',
        days: baselineDays,
        trigger: { type: 'phase', phase: 'pw' },
        action: { type: 'playlist', name: 'pwb_pl', target: { channel: 'deck', id: null } },
      },
      {
        id: 'c_mood_to_party',
        label: 'Party 1',
        enabled: true,
        kind: 'mood',
        days,
        durationMin: 15,
        trigger: {
          type: 'mood', from: 'calm', to: 'party', minDwellSec: 15, cooldownSec: 60, whenPhase: 'pw',
        },
        action: { type: 'look', look: 'party_high' },
      },
    ],
  };
}

const loadedNames = (h) => h.calls.loadPlaylist.map((c) => c.name);
const lifecycleReasons = (h) => h.svc.recentFires
  .filter((e) => e.kind === 'lifecycle').map((e) => e.reason);

test('P0-1: a plan activated mid-window with the music ALREADY playing fires at minDwell', async () => {
  // THE headline bug (F1). `moodArmed` was never written because the evaluator
  // never saw CALM, so party could not fire until the next quiet gap — while
  // the card showed ✓ARMED the whole time.
  const start = winAt(WIN_DAY0, '22:00');
  const h = setup(windowPlan(), { now: start, mood: { party: 1, value: 1 } });
  await h.svc.start();
  assert.equal(h.svc.getPartyStatus().partyWindowOpen, true);
  assert.equal((h.svc.state.moodArmed || {}).c_mood_to_party, undefined,
    'setup: the latch is genuinely absent — the evaluator never saw calm');

  h.calls.loadPlaylist.length = 0;
  await h.svc._tick();
  assert.ok(!loadedNames(h).includes('party_high'), 'no INSTANT fire — the dwell must be served');

  h.setNow(start + 14_000);
  await h.svc._tick();
  assert.ok(!loadedNames(h).includes('party_high'), 'still inside the 15 s sustain');

  h.setNow(start + 16_000);
  await h.svc._tick();
  assert.ok(loadedNames(h).includes('party_high'),
    `the session must start one minDwell after activation, got ${loadedNames(h).join(', ') || 'nothing'}`);
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session');
  h.svc.stop();
});

test('P0-1: the CLOSED→OPEN edge re-anchors the sustain clock', async () => {
  const beforeOpen = winAt(WIN_DAY0, '20:59');
  const opensAt = winAt(WIN_DAY0, '21:00');
  const h = setup(windowPlan(), { now: beforeOpen, mood: { party: 1, value: 1 } });
  await h.svc.start();
  assert.equal(h.svc.getPartyStatus().partyWindowOpen, false);
  assert.equal(h.svc.getPartyStatus().partyWindowOpensAtMs, opensAt,
    'a closed window must still say when it opens');
  await h.svc._tick();

  h.calls.loadPlaylist.length = 0;
  h.setNow(opensAt);
  await h.svc._tick();
  assert.ok(lifecycleReasons(h).includes('party-window-opened'),
    'the opening onto live music must be an operator-visible event');
  assert.equal(h.svc.state.moodSince, opensAt, 'the sustain clock restarts AT the opening');
  assert.ok(!loadedNames(h).includes('party_high'), 'and it does NOT fire instantly');

  h.setNow(opensAt + 14_000);
  await h.svc._tick();
  assert.ok(!loadedNames(h).includes('party_high'));
  h.setNow(opensAt + 16_000);
  await h.svc._tick();
  assert.ok(loadedNames(h).includes('party_high'), 'one full sustain after the opening → session');
  h.svc.stop();
});

test('P0-1: a window CLOSED by its night-day fires nothing — not the session, not the baseline', async () => {
  // THE F2 CASE. At 02:00 on festival day 2 the phase CLOCK is active, but the
  // open window belongs to the night that started on day 1 — and both cues are
  // authored for day 0. The evaluator used to fire both anyway (calendar-day
  // `applicableCues` + a clock-only whenPhase gate) while the status said
  // "WINDOW CLOSED".
  const h = setup(windowPlan(), {
    now: winAt(WIN_DAY2, '02:00'), mood: { party: 1, value: 1 },
  });
  await h.svc.start();
  h.calls.loadPlaylist.length = 0;
  for (let i = 0; i < 3; i += 1) await h.svc._tick();

  const st = h.svc.getState();
  assert.equal(st.currentPhase, 'pw', 'setup: the phase CLOCK really is active');
  assert.equal(st.partyWindow.open, false, '…and the WINDOW is nevertheless closed');
  assert.equal(h.svc.getPartyStatus().partyWindowOpen, false,
    '/party-config and /timeline/state must give the SAME answer');
  assert.equal(h.svc.getPartyStatus().effectiveState, 'waiting_window');
  assert.ok(!loadedNames(h).includes('party_high'), 'no party session outside the window');
  assert.ok(!loadedNames(h).includes('pwb_pl'), 'and no Party Window baseline either');
  h.svc.stop();
});

test('P0-1: the window BASELINE carries across midnight with the window it belongs to', async () => {
  // The other half of F2/F4: at 02:00 on day 1 the window opened at 21:00 on
  // day 0, so BOTH window-governed cues are still in the runtime plan even
  // though `days:[0]` no longer matches the calendar day.
  const now = winAt(WIN_DAY1, '02:00');
  const h = setup(windowPlan(), { now, mood: { party: 0, value: 0 } });
  await h.svc.start();
  const st = h.svc.getState();
  assert.equal(st.partyWindow.open, true);
  assert.equal(st.partyWindow.phaseId, 'pw');
  assert.equal(st.partyWindow.opensAtMs, winAt(WIN_DAY0, '21:00'));
  assert.equal(st.partyWindow.closesAtMs, winAt(WIN_DAY1, '09:00'));
  const runtime = h.svc._runtimeCuesAt(now, h.svc._sunEventsFor(now)).map((c) => c.id);
  assert.deepEqual(runtime.sort(), ['c_mood_to_party', 'pwb'],
    'both window-governed cues follow the WINDOW, not the calendar day');
  // P1-5: the baseline is also RESTORED on this restart, so a mid-window reboot
  // keeps the window's own look instead of dropping to the default cue.
  assert.equal(st.deckOwner.kind, 'cue');
  assert.equal(st.deckOwner.cueId, 'pwb');
  assert.ok(loadedNames(h).includes('pwb_pl'));
  h.svc.stop();
});

test('P0-1: a stranded moodArmed:false with no live session SELF-HEALS', async () => {
  // The mood is held at PARTY so the evaluator's own "the mood sits at `from`"
  // re-arm cannot be what heals it — this isolates the service-level self-heal.
  const h = setup(windowPlan(), {
    now: winAt(WIN_DAY0, '22:00'), mood: { party: 1, value: 1 },
  });
  await h.svc.start();
  h.svc.state.moodArmed = { c_mood_to_party: false };
  assert.equal(h.svc.getPartyStatus().triggerArmed, false);
  await h.svc._tick();
  assert.equal(h.svc.state.moodArmed.c_mood_to_party, true, 'the latch must not strand party for the night');
  assert.ok(lifecycleReasons(h).includes('party-rearm'), 'and the heal is logged, never silent');
  h.svc.stop();
});

test('P0-1: the self-heal REFUSES to hide a dispatch error — cueError is surfaced instead', async () => {
  const h = setup(windowPlan(), {
    now: winAt(WIN_DAY0, '22:00'), mood: { party: 1, value: 1 },
  });
  await h.svc.start();
  h.svc.state.moodArmed = { c_mood_to_party: false };
  h.svc.cueErrors.c_mood_to_party = 'playlist "party_high" not found';
  await h.svc._tick();
  assert.equal(h.svc.state.moodArmed.c_mood_to_party, false,
    'a real failure must stay visible, not be papered over by a re-arm');
  assert.equal(h.svc.getPartyStatus().cueError, 'playlist "party_high" not found',
    '/party-config carries the error so the SESSION chip can go red');
  h.svc.stop();
});

// ── P0-2 — FORCE / RETURN ───────────────────────────────────────────────────

test('P0-2: RETURN ends a DETECTED session too, and stamps the cooldown', async () => {
  // F5: RETURN used to end ONLY a forced session. On a detected one it logged
  // "Live audio already controlled Party detection" and left the party playing —
  // the operator's stop button did nothing.
  const h = setup();
  await inSession(h);
  assert.equal(h.svc.getPartyStatus().sessionForced, false, 'setup: this is a DETECTED session');
  h.calls.loadPlaylist.length = 0;

  const returned = await h.svc.returnPartyToLiveAudio();
  assert.notEqual(returned.effectiveState, 'in_session', 'the session must actually END');
  assert.equal(h.svc.state.moodLastFire.c_mood_to_party, IN_WINDOW,
    'the cooldown is anchored at the end, like every other session end (D3)');
  assert.ok(returned.cooldownRemainingSec > 0);
  assert.ok(h.calls.loadPlaylist.map((c) => c.name).includes('ambient'),
    'and the plan default cue reclaims the deck');
  h.svc.stop();
});

test('P0-2: RETURN with NO live session THROWS instead of pretending it did something', async () => {
  const h = setup();
  await h.svc.start();
  await assert.rejects(() => h.svc.returnPartyToLiveAudio(), /LIVE Party session/);
  h.svc.stop();
});

test('P0-2: a FORCED session survives a rejoin (savePlan) and RETURN still cancels it', async () => {
  const h = setup();
  await h.svc.start();
  const forced = await h.svc.forcePartySession();
  assert.equal(forced.sessionForced, true);

  // A save over the ACTIVE plan hot-reloads and re-joins the session. The mood
  // is CALM throughout — a forced session bypasses the signal by definition.
  await h.svc.savePlan(partyPlan());
  const afterSave = h.svc.getPartyStatus();
  assert.equal(afterSave.effectiveState, 'in_session', 'the rejoin must keep the session alive');
  assert.equal(afterSave.sessionForced, true, 'and must not demote it to a detected session');

  const returned = await h.svc.returnPartyToLiveAudio();
  assert.notEqual(returned.effectiveState, 'in_session');
  assert.equal(returned.sessionForced, false);
  h.svc.stop();
});

test('P0-2: activating a plan clears the FORCED latch', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.forcePartySession();
  assert.equal(h.svc._partySessionForced, true);
  saveShowPlan(partyPlan({ name: 'other_plan' }), path.join(h.sceneDir, 'other_plan.yaml'));
  await h.svc.activatePlan('other_plan');
  assert.equal(h.svc._partySessionForced, false, 'a new plan holds no session, forced or otherwise');
  assert.notEqual(h.svc.getPartyStatus().effectiveState, 'in_session');
  h.svc.stop();
});

// ════════════════════════════════════════════════════════════════════════════
// live-verifier defects (report 356 follow-up)
//   A — every party-session END must hand the deck to the PHASE BASELINE, not
//       to the flat authored defaultCue (the elapse path already did).
//   B — FORCE is a START button: it must refuse to extend a live session.
// ════════════════════════════════════════════════════════════════════════════

/** `windowPlan()` with the operator's `defaultCue.phaseAware: true`. */
function phaseAwarePlan(opts = {}) {
  const plan = windowPlan(opts);
  plan.defaultCue.phaseAware = true;
  return plan;
}

const WIN_NIGHT = winAt(WIN_DAY0, '22:00');       // mid Party Window, festival day 0
const fireEvents = (h) => h.svc.recentFires.filter((e) => e.kind === 'fire');

/** Drive a phase-aware window plan to a DETECTED party session at 22:00. */
async function inWindowSession(h) {
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, cooldownSec: 600 });
  await h.svc._tick();                             // arms on calm
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();                             // fires the session
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session', 'setup: session must be live');
  return h;
}

/** Assert the deck landed on the Party Window baseline, exactly once. */
function assertBaselineReclaimed(h, reason) {
  assert.equal(h.svc._deckWindowCueId, 'pwb',
    `the deck must go back to the Party Window baseline, owner is ${h.svc._deckWindowCueId}`);
  assert.equal(h.svc.getState().deckOwner.cueId, 'pwb', '/timeline/state must agree');
  assert.equal(h.svc._defaultCueActive, false,
    'the phase baseline owns the deck — the defaultCue latch must be OFF');
  assert.deepEqual(loadedNames(h), ['pwb_pl'],
    `exactly one baseline apply, got ${loadedNames(h).join(', ') || 'nothing'}`);
  const fires = fireEvents(h);
  assert.ok(!fires.some((f) => f.cueId === '__default_cue__'),
    `the flat defaultCue must not fill inside an open window, got ${JSON.stringify(fires)}`);
  assert.deepEqual(fires.filter((f) => f.reason === reason).map((f) => f.cueId), ['pwb'],
    `exactly one "${reason}" apply, and it is the baseline: ${JSON.stringify(fires)}`);
  assert.ok(!fires.some((f) => f.reason === 'no-owning-cue'),
    `a tick-driven follow-up apply is the F3 race, got ${JSON.stringify(fires)}`);
}

test('DEFECT A: RETURN on a DETECTED session hands the deck to the PHASE BASELINE', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  assert.equal(h.svc.getPartyStatus().sessionForced, false, 'setup: this is a DETECTED session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();                             // the ordinary next tick must add nothing
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-live-audio');
});

test('DEFECT A: RETURN on a FORCED session hands the deck to the PHASE BASELINE', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.forcePartySession();
  assert.equal(h.svc.getPartyStatus().sessionForced, true, 'setup: this is a FORCED session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-live-audio');
});

test('DEFECT A: DISABLING party mid-session hands the deck to the PHASE BASELINE', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.setPartyConfig({ enabled: false });
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-disabled');
});

test('DEFECT A: a follow-the-music session released on SIGNAL LOSS lands on the baseline', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, true, 'setup: open-ended session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();                             // the music stopped → release
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-music-stopped');
});

test('DEFECT A: a FIXED session released on SIGNAL LOSS lands on the baseline', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();                             // starts the 15 s loss hold
  h.setNow(WIN_NIGHT + 15_000);
  await h.svc._tick();                             // hold complete → release
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-signal-lost');
});

test('DEFECT A: a plan with NO phase baseline still falls to the authored defaultCue', async () => {
  // The fall-through must be bit-for-bit unchanged: phaseAware is ON, but the
  // resolver finds nothing owning 22:00, so the static defaultCue is the loud
  // last resort — exactly the legacy answer.
  const plan = phaseAwarePlan();
  plan.cues = plan.cues.filter((c) => c.id !== 'pwb');
  const h = setup(plan, { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();
  h.svc.stop();
  assert.deepEqual(loadedNames(h), ['ambient'],
    `the authored defaultCue must reclaim the deck, got ${loadedNames(h).join(', ') || 'nothing'}`);
  assert.equal(h.svc._defaultCueActive, true, 'the defaultCue latch must be ON when IT drives');
  assert.deepEqual(fireEvents(h).map((f) => [f.cueId, f.reason]), [['__default_cue__', 'party-live-audio']],
    `exactly one defaultCue apply, got ${JSON.stringify(fireEvents(h))}`);
});

// ── A, part 2: the SAME must hold for the plain pad-authored plan ───────────
// CaptainPad's party-window editor emits `pwb` (kind:ambient, trigger:phase),
// `pwe` and the mood cue — and a `defaultCue` with NO `phaseAware` flag. P1-5
// already restores `pwb` at boot/save/resume for every plan, so a live session
// end must give the same answer or the deck disagrees with a restart for the
// rest of the night (a phase trigger is rising-edge, once per night).

test('DEFECT A2: RETURN on a DETECTED session lands on the baseline — NON-phaseAware plan', async () => {
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  assert.equal(h.svc.plan, null, 'setup: nothing loaded yet');
  await inWindowSession(h);
  assert.equal(h.svc.plan.defaultCue.phaseAware, undefined, 'setup: the pad emits NO phaseAware flag');
  assert.equal(h.svc.getPartyStatus().sessionForced, false, 'setup: a DETECTED session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-live-audio');
  assert.equal(h.svc.state.currentPhase, 'pw',
    'the phase stays latched so the next tick does not re-fire the rising edge');
});

test('DEFECT A2: RETURN on a FORCED session lands on the baseline — NON-phaseAware plan', async () => {
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.forcePartySession();
  assert.equal(h.svc.getPartyStatus().sessionForced, true, 'setup: a FORCED session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-live-audio');
});

test('DEFECT A2: DISABLING mid-session lands on the baseline — NON-phaseAware plan', async () => {
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.setPartyConfig({ enabled: false });
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-disabled');
});

test('DEFECT A2: a follow-the-music drop lands on the baseline — NON-phaseAware plan', async () => {
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationEnabled: false });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().sessionFollowsMusic, true, 'setup: open-ended session');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();
  await h.svc._tick();
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-music-stopped');
});

test('DEFECT A2: a FIXED session signal loss lands on the baseline — NON-phaseAware plan', async () => {
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  h.setMood({ party: 0, value: 0 });
  await h.svc._tick();                             // starts the 15 s loss hold
  h.setNow(WIN_NIGHT + 15_000);
  await h.svc._tick();                             // hold complete → release
  h.svc.stop();
  assertBaselineReclaimed(h, 'party-signal-lost');
});

test('DEFECT A2: the durationMin WINDOW ELAPSE lands on the baseline — NON-phaseAware plan', async () => {
  // The path that was already correct for `phaseAware` plans must now be correct
  // for the pad's plans too: a session that simply runs out its window inside an
  // open Party Window goes back to the window's baseline, not to the flat default.
  const h = setup(windowPlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 0, durationMin: 2, cooldownSec: 600 });
  await h.svc._tick();
  h.setMood({ party: 1, value: 1 });
  await h.svc._tick();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session', 'setup: session live');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  h.setNow(WIN_NIGHT + 2 * 60_000 + 1000);         // the 2-minute window elapsed
  await h.svc._tick();
  await h.svc._tick();
  h.svc.stop();
  // The elapse path reaches the baseline through FIX 5's displaced-owner restore
  // (`owner-restored`) rather than the resolver — same destination, one apply.
  assertBaselineReclaimed(h, 'owner-restored');
});

test('DEFECT A2: OUTSIDE the window there is no baseline — the flat defaultCue fills', async () => {
  // The `pw` phase is CLOSED at 12:00, so no phase baseline applies and the
  // behaviour is exactly today's: the authored defaultCue. Nothing about the
  // non-baseline case changes. FORCE is how a session exists out of window.
  const noon = winAt(WIN_DAY0, '12:00');
  const h = setup(windowPlan(), { now: noon, mood: { party: 0, value: 0 } });
  await h.svc.start();
  assert.equal(h.svc.getPartyStatus().partyWindowOpen, false, 'setup: the Party Window is CLOSED');
  await h.svc.forcePartySession();
  assert.equal(h.svc.getPartyStatus().effectiveState, 'in_session', 'setup: session live');
  h.calls.loadPlaylist.length = 0;
  h.svc.recentFires.length = 0;

  await h.svc.returnPartyToLiveAudio();
  await h.svc._tick();
  h.svc.stop();
  assert.deepEqual(loadedNames(h), ['ambient'],
    `the authored defaultCue must fill, got ${loadedNames(h).join(', ') || 'nothing'}`);
  assert.equal(h.svc._defaultCueActive, true, 'the defaultCue latch must be ON when IT drives');
  assert.deepEqual(fireEvents(h).map((f) => [f.cueId, f.reason]), [['__default_cue__', 'party-live-audio']],
    `exactly one defaultCue apply, got ${JSON.stringify(fireEvents(h))}`);
});

test('DEFECT B: FORCE refuses to extend a DETECTED session that is already live', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await inWindowSession(h);
  const endsAt = h.svc.getPartyStatus().sessionEndsAtMs;
  h.calls.loadPlaylist.length = 0;

  await assert.rejects(() => h.svc.forcePartySession(), /already LIVE \(detected\)/);
  const after = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(after.sessionEndsAtMs, endsAt, 'a refused FORCE must not extend the session');
  assert.equal(after.sessionForced, false, '…nor promote a detected session to a forced one');
  assert.deepEqual(loadedNames(h), [], 'a refused FORCE must not re-dispatch the cue');
});

test('DEFECT B: FORCE refuses to extend a session it already forced', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.forcePartySession();
  const endsAt = h.svc.getPartyStatus().sessionEndsAtMs;
  h.calls.loadPlaylist.length = 0;

  await assert.rejects(() => h.svc.forcePartySession(), /already LIVE \(forced\)/);
  const after = h.svc.getPartyStatus();
  h.svc.stop();
  assert.equal(after.sessionEndsAtMs, endsAt, 'a second press must not push the end time out');
  assert.equal(after.sessionForced, true, 'and the running forced session is untouched');
  assert.deepEqual(loadedNames(h), [], 'a refused FORCE must not re-dispatch the cue');
});

test('DEFECT B: FORCE succeeds again once RETURN ended the session', async () => {
  const h = setup(phaseAwarePlan(), { now: WIN_NIGHT, mood: { party: 0, value: 0 } });
  await h.svc.start();
  await h.svc.forcePartySession();
  await h.svc.returnPartyToLiveAudio();
  assert.notEqual(h.svc.getPartyStatus().effectiveState, 'in_session', 'setup: the session ended');
  await h.svc.resetPartyCooldown();
  h.calls.loadPlaylist.length = 0;

  const forced = await h.svc.forcePartySession();
  h.svc.stop();
  assert.equal(forced.effectiveState, 'in_session', 'FORCE must work again after a clean end');
  assert.equal(forced.sessionForced, true);
  assert.ok(loadedNames(h).includes('party_high'),
    `the new session must dispatch the party look, got ${loadedNames(h).join(', ') || 'nothing'}`);
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
