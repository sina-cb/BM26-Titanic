/*
 * party_config.test.js — the ENGINE-OWNED party authority (report 20260725_19)
 * and, more importantly, its COMPATIBILITY with the timeline.
 *
 * The operator's rule: party mode is a well-behaved citizen INSIDE the timeline,
 * never a bypass. Precedence is HUMAN > operator disable > plan automation, and
 * everywhere the timeline already has a rule, party follows it rather than
 * adding a special case. These tests pin exactly that:
 *
 *   • persistence round-trip (a disabled rig stays disabled across a restart)
 *   • strict validation — unknown playlist / bad bounds ⇒ throw, nothing applied
 *   • disable while a session is LIVE ends it and the defaultCue reclaims the deck
 *   • disable during a HUMAN TAKEOVER does NOT reach in and re-apply anything
 *   • no plan / dormant window ⇒ structurally no dwell, no session, ever
 *   • fire-time resolution of playlist AND the session numbers (no plan reload)
 *   • forced (fake-trigger) party is indistinguishable from real — and is still
 *     beaten by the disable flag (policy wins)
 *
 * Run:  cd marsin_engine && node --test tests/timeline/party_config.test.js
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

// ── state shape + persistence ────────────────────────────────────────────────

test('a fresh state ships ARMED, playlist + timing UNSEEDED until a plan loads', () => {
  const s = defaultTimelineState();
  assert.equal(s.partyEnabled, true);
  assert.equal(s.partyPlaylist, null, 'seeded from the plan on first load, not guessed');
  const cfg = partyConfigOf(s);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.playlist, PARTY_PLAYLIST_DEFAULT, 'the ultimate default when nothing seeds it');
  assert.equal(cfg.minDwellSec, null, 'unseeded until a plan loads');
});

test('a pre-feature state file migrates to ARMED, and a corrupt one THROWS', () => {
  assert.deepEqual(partyConfigOf({ mode: 'armed' }), {
    enabled: true, playlist: PARTY_PLAYLIST_DEFAULT,
    minDwellSec: null, durationMin: null, cooldownSec: null,
    durationEnabled: true, cooldownEnabled: true,
  });
  assert.throws(() => partyConfigOf({ partyEnabled: 'no' }), /must be a boolean/);
  assert.throws(() => partyConfigOf({ partyPlaylist: '' }), /non-empty string/);
  assert.throws(() => partyConfigOf({ partyMinDwellSec: 'soon' }), /finite number/);
  assert.throws(() => partyConfigOf({ partyDurationEnabled: 'sure' }), /must be a boolean/);
});

test('DISABLED survives a restart — the operator stays disabled through a supervisor bounce', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ enabled: false, playlist: 'party_low' });
  h.svc.stop();
  // On disk, before any new service reads it:
  const onDisk = loadTimelineState(h.stateDir);
  assert.equal(onDisk.partyEnabled, false);
  assert.equal(onDisk.partyPlaylist, 'party_low');

  // A fresh service over the SAME state dir honours it.
  const { deps } = makeDeps();
  const svc2 = new TimelineService({
    scene: 'test_bench', sceneDir: h.sceneDir, stateDir: h.stateDir,
    getMood: () => ({ party: 0, value: 0 }), deps, broadcast: () => {},
    config: { enabled: true, activePlan: 'party_plan', tickMs: 1000, colorPalettes: PALETTES },
    nowFn: () => IN_WINDOW,
  });
  await svc2.start();
  assert.equal(svc2.getPartyConfig().enabled, false, 'a restart re-armed party mode — it must not');
  assert.equal(svc2.getPartyConfig().playlist, 'party_low');
  svc2.stop();
});

// ── validation ───────────────────────────────────────────────────────────────

test('PUT validation: unknown playlist, non-boolean, unknown field, out-of-bounds — nothing applied', async () => {
  const h = setup();
  await h.svc.start();
  const before = h.svc.getPartyConfig();
  await assert.rejects(() => h.svc.setPartyConfig({ playlist: 'no_such_playlist' }), /unknown playlist/);
  await assert.rejects(() => h.svc.setPartyConfig({ enabled: 'yes' }), /must be a boolean/);
  await assert.rejects(() => h.svc.setPartyConfig({ nope: 1 }), /unknown field/);
  await assert.rejects(() => h.svc.setPartyConfig({ durationMin: 0 }), /must be 1\.\.120/);
  await assert.rejects(() => h.svc.setPartyConfig({ minDwellSec: -1 }), /must be 0\.\.3600/);
  await assert.rejects(() => h.svc.setPartyConfig({ cooldownSec: 7201 }), /must be 0\.\.7200/);
  // ALL-OR-NOTHING: a valid field alongside an invalid one applies neither.
  await assert.rejects(() => h.svc.setPartyConfig({ enabled: false, durationMin: 999 }), /durationMin/);
  assert.deepEqual(h.svc.getPartyConfig(), before, 'a rejected PUT left the config changed');
  h.svc.stop();
});

test('PUT validation: an EMPTY patch is refused like any other meaningless body (D10)', async () => {
  // `readBody` maps an empty request body to `{}`, so an empty PUT and a
  // literal `{}` are indistinguishable here — and both are meaningless under
  // the all-or-nothing contract every other bad body is held to (400).
  const h = setup();
  await h.svc.start();
  const before = h.svc.getPartyConfig();
  await assert.rejects(() => h.svc.setPartyConfig({}), /at least one writable field is required/);
  assert.deepEqual(h.svc.getPartyConfig(), before, 'an empty PUT changed the config');
  h.svc.stop();
});

test('a CORRUPT persisted party field refuses to load the state, naming the file (D11)', async () => {
  // Before this, the corrupt field parsed fine at load and threw inside EVERY
  // tick — 86 k unthrottled log lines/day while the WHOLE timeline was dead and
  // the engine looked healthy. Now it fails ONCE, at boot, like a broken YAML.
  const h = setup();
  await h.svc.start();
  h.svc.stop();
  const statePath = path.join(h.stateDir, 'timeline_state.yaml');
  fs.writeFileSync(statePath,
    fs.readFileSync(statePath, 'utf8').replace(/partyEnabled: true/, "partyEnabled: 'no'"), 'utf8');

  assert.throws(() => loadTimelineState(h.stateDir), (err) => {
    assert.match(err.message, /timeline state invalid/);
    assert.match(err.message, /timeline_state\.yaml/, 'the error must name the FILE');
    assert.match(err.message, /partyEnabled/, 'the error must name the FIELD');
    return true;
  });

  // …and the service refuses to half-run: start() rejects, no tick is armed.
  const { deps } = makeDeps();
  const svc2 = new TimelineService({
    scene: 'test_bench', sceneDir: h.sceneDir, stateDir: h.stateDir,
    getMood: () => ({ party: 0, value: 0 }), deps, broadcast: () => {},
    config: { enabled: true, activePlan: 'party_plan', tickMs: 1000, colorPalettes: PALETTES },
    nowFn: () => IN_WINDOW,
  });
  await assert.rejects(() => svc2.start(), /timeline state invalid/);
  assert.equal(svc2._tickHandle, null, 'a corrupt state file must not leave a ticking timeline');
});

test('timing numbers round-trip and persist', async () => {
  const h = setup();
  await h.svc.start();
  const out = await h.svc.setPartyConfig({ minDwellSec: 20, durationMin: 3, cooldownSec: 60 });
  assert.equal(out.minDwellSec, 20);
  assert.equal(out.durationMin, 3);
  assert.equal(out.cooldownSec, 60);
  const onDisk = loadTimelineState(h.stateDir);
  assert.equal(onDisk.partyMinDwellSec, 20);
  assert.equal(onDisk.partyDurationMin, 3);
  assert.equal(onDisk.partyCooldownSec, 60);
  h.svc.stop();
});

// ── seeding: party-config becomes the SINGLE authority ───────────────────────

test('timing seeds ONCE from the plan cue, then party-config wins', async () => {
  const h = setup();
  await h.svc.start();
  const cfg = h.svc.getPartyConfig();
  assert.equal(cfg.minDwellSec, 120, 'seeded from the plan cue trigger');
  assert.equal(cfg.durationMin, 12, 'seeded from the plan cue durationMin');
  assert.equal(cfg.cooldownSec, 120);
  // Change it; the plan still says 120/12/900 but the config is the authority.
  await h.svc.setPartyConfig({ minDwellSec: 5 });
  assert.equal(h.svc.getPartyConfig().minDwellSec, 5);
  // Re-seeding must NOT clobber the operator's value.
  h.svc._seedPartyTiming();
  assert.equal(h.svc.getPartyConfig().minDwellSec, 5, 're-seed overwrote an operator value');
  h.svc.stop();
});

test('saving the active plan applies its PARTY cue settings without changing the live enable gate', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({
    enabled: false,
    playlist: 'party_low',
    minDwellSec: 15,
    durationMin: 3,
    cooldownSec: 60,
  });

  const edited = partyPlan();
  edited.cues[0] = {
    ...edited.cues[0],
    durationMin: 20,
    trigger: {
      ...edited.cues[0].trigger,
      minDwellSec: 45,
      cooldownSec: 600,
    },
    action: {
      type: 'playlist',
      name: 'party_high',
      target: { channel: 'deck', id: null },
    },
  };
  await h.svc.savePlan(edited);

  const cfg = h.svc.getPartyConfig();
  assert.equal(cfg.enabled, false, 'saving a plan must not re-enable the live operator gate');
  assert.equal(cfg.playlist, 'party_high');
  assert.equal(cfg.minDwellSec, 45);
  assert.equal(cfg.durationMin, 20);
  assert.equal(cfg.cooldownSec, 600);
  const onDisk = loadTimelineState(h.stateDir);
  assert.equal(onDisk.partyPlaylist, 'party_high');
  assert.equal(onDisk.partyMinDwellSec, 45);
  assert.equal(onDisk.partyDurationMin, 20);
  assert.equal(onDisk.partyCooldownSec, 600);
  h.svc.stop();
});

test('activating a plan applies that plan party settings before catch-up', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ playlist: 'party_low', minDwellSec: 120 });
  const incoming = partyPlan({ name: 'incoming_party' });
  incoming.cues[0] = {
    ...incoming.cues[0],
    durationMin: 5,
    trigger: { ...incoming.cues[0].trigger, minDwellSec: 30, cooldownSec: 90 },
    action: { type: 'playlist', name: 'party_high', target: { channel: 'deck', id: null } },
  };
  saveShowPlan(incoming, path.join(h.sceneDir, 'incoming_party.yaml'));

  await h.svc.activatePlan('incoming_party');

  assert.deepEqual(
    {
      playlist: h.svc.getPartyConfig().playlist,
      minDwellSec: h.svc.getPartyConfig().minDwellSec,
      durationMin: h.svc.getPartyConfig().durationMin,
      cooldownSec: h.svc.getPartyConfig().cooldownSec,
    },
    { playlist: 'party_high', minDwellSec: 30, durationMin: 5, cooldownSec: 90 },
  );
  h.svc.stop();
});

test('party status exposes strong-signal sustain progress and readiness facts', async () => {
  const h = setup();
  await h.svc.start();
  await h.svc.setPartyConfig({ minDwellSec: 30 });
  h.svc.state.currentMood = 'party';
  h.svc.state.moodSince = IN_WINDOW - 12_000;

  const status = h.svc.getPartyStatus();

  assert.equal(status.strongSignal, true);
  assert.equal(status.sustainHeldSec, 12);
  assert.equal(status.sustainRequiredSec, 30);
  assert.equal(status.sustainProgress, 0.4);
  assert.deepEqual(status.readiness, {
    enabled: true,
    planActive: true,
    partyWindowOpen: true,
    planDriving: true,
    triggerArmed: true,
    cooldownClear: true,
  });
  h.svc.stop();
});

test('a day-targeted Party Window stays open and triggerable after midnight', async () => {
  const afterMidnight = Date.UTC(2026, 7, 23, 7, 10, 0); // 00:10 PDT
  const plan = partyPlan({
    festival: { startDate: '2026-08-22', days: 2 },
    phases: {
      party_night: { start: { clock: '23:15' }, end: { clock: '06:15' } },
    },
  });
  plan.cues[0] = {
    ...plan.cues[0],
    days: [0],
    trigger: { ...plan.cues[0].trigger, whenPhase: 'party_night' },
  };
  const h = setup(plan, { now: afterMidnight });
  await h.svc.start();

  assert.equal(h.svc.getPartyStatus().partyWindowOpen, true);
  assert.equal(
    h.svc._runtimeCuesAt(afterMidnight, h.svc._sunEventsFor(afterMidnight))
      .some((cue) => cue.id === 'c_mood_to_party'),
    true,
  );
  h.svc.stop();
});

test('with no party cue in the plan, timing seeds from the shipped defaults', async () => {
  const plan = partyPlan({ cues: [] });
  const h = setup(plan);
  await h.svc.start();
  assert.deepEqual(
    {
      minDwellSec: h.svc.getPartyConfig().minDwellSec,
      durationMin: h.svc.getPartyConfig().durationMin,
      cooldownSec: h.svc.getPartyConfig().cooldownSec,
    },
    { ...PARTY_TIMING_DEFAULTS },
  );
  h.svc.stop();
});

// ── the trigger gate (pure) ──────────────────────────────────────────────────

const triggerPlan = () => ({
  location: { tz: 'America/Los_Angeles' },
  phases: {},
  cues: partyPlan().cues,
});
const triggerDayTimes = () => ({ phases: {}, cueTimes: {}, sunEvents: {}, tz: 'America/Los_Angeles' });

function moodState(overrides = {}) {
  return {
    firedToday: {}, moodLastFire: {}, moodArmed: { c_mood_to_party: true },
    dayKey: null, prevMood: 1, moodSince: 0, currentPhase: null, ...overrides,
  };
}

test('DISABLED blocks the fire — and does NOT burn the arm latch or the cooldown', () => {
  const now = 1_000_000;
  const state = moodState({ moodSince: now - 200_000 });   // dwell long satisfied
  const off = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyEnabled: false,
  });
  assert.equal(off.fires.length, 0, 'a disabled party cue must not fire');
  assert.equal(off.state.moodArmed.c_mood_to_party, true, 'the arm latch must survive the block');
  assert.equal(off.state.moodLastFire.c_mood_to_party, undefined, 'the cooldown must not be stamped');

  // Re-enabling the very next tick fires immediately — nothing was consumed.
  const on = evaluateTick({
    now: now + 1000, plan: triggerPlan(), state: off.state, mood: { party: 1 },
    dayTimes: triggerDayTimes(), partyEnabled: true,
  });
  assert.deepEqual(on.fires.map((f) => f.cueId), ['c_mood_to_party']);
});

test('a FORCED (fake-trigger) party is indistinguishable from a real one to the trigger', () => {
  // The companion forces audioPartyStrong=1; the timeline only ever sees
  // mood.party===1, so the SAME evaluation runs. This is the point of the
  // publish-stage override.
  const now = 1_000_000;
  const r = evaluateTick({
    now, plan: triggerPlan(), state: moodState({ moodSince: now - 200_000 }),
    mood: { party: 1 }, dayTimes: triggerDayTimes(), partyEnabled: true,
  });
  assert.deepEqual(r.fires.map((f) => f.cueId), ['c_mood_to_party']);
});

test('party-config timing REPLACES the plan cue numbers at evaluation time', () => {
  const now = 1_000_000;
  // Only 30 s of dwell: the plan's 120 s would refuse, a config 20 s allows.
  const state = moodState({ moodSince: now - 30_000 });
  const planNumbers = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
  });
  assert.equal(planNumbers.fires.length, 0, "the plan's 120 s dwell should refuse at 30 s");
  const configNumbers = evaluateTick({
    now, plan: triggerPlan(), state, mood: { party: 1 }, dayTimes: triggerDayTimes(),
    partyTiming: { minDwellSec: 20, cooldownSec: 900 },
  });
  assert.deepEqual(configNumbers.fires.map((f) => f.cueId), ['c_mood_to_party'],
    'the operator-configured dwell must be what is evaluated — no plan reload');
});

test('a NON-party mood cue keeps its own authored numbers', () => {
  const now = 1_000_000;
  const plan = {
    location: { tz: 'America/Los_Angeles' },
    phases: {},
    cues: [{
      id: 'c_party_to_calm', enabled: true, kind: 'mood',
      trigger: { type: 'mood', from: 'party', to: 'calm', minDwellSec: 10 },
      action: { type: 'look', look: 'ambient' },
    }],
  };
  const state = moodState({ moodArmed: { c_party_to_calm: true }, prevMood: 0, moodSince: now - 20_000 });
  const r = evaluateTick({
    now, plan, state, mood: { party: 0 }, dayTimes: triggerDayTimes(),
    partyEnabled: false, partyTiming: { minDwellSec: 9999 },
  });
  assert.deepEqual(r.fires.map((f) => f.cueId), ['c_party_to_calm'],
    'the party override must only govern cues that go INTO party');
});
