/*
 * timeline_precedence_ambient.test.js — the `_98` timeline bugfix wave.
 *
 * Six behavior fixes found by the `_93` dry-run harness and pinned by `_95`.
 * Every test names its fix number; the root causes live in report
 * `.agent/reports/202607/20260725_98_timeline_bugfix_wave.md`.
 *
 *   FIX 1 — a SUPPRESSED mood fire consumes NOTHING (no arm latch, no cooldown).
 *   FIX 2 — catchUp disarms the baseline BEFORE applying a caught-up program.
 *   FIX 3 — an ambient cue never overwrites a LIVE program's look.
 *   FIX 5 — an open-ended AMBIENT owner returns after a timed window elapses.
 *   FIX 6 — the boot baseline never clobbers a restored cue's own playlist (F1).
 *   FIX 7 — a program hold expiring naturally lands on the ambient defaultCue (G1).
 *
 * Split into its own file for the same reason the party×timeline suite was
 * (report 20260725_12 §7): a large chatty service-level file trips a Windows
 * node:test worker-IPC flake that truncates the run.
 *
 * Run:  cd marsin_engine && node --test tests/timeline/timeline_precedence_ambient.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';
import { arbitrate } from '../../lib/timeline/arbiter.js';
import { dateClockToEpochMs, resolveDayTimes } from '../../lib/timeline/triggers.js';
import { computeSunEvents } from '../../lib/timeline/sun.js';

// Service chatter trips the Windows worker-IPC flake noted above.
const _origLog = console.log;
const _origError = console.error;
console.log = () => {};
console.error = () => {};
process.on('exit', () => { console.log = _origLog; console.error = _origError; });

const TZ = 'America/Los_Angeles';
const MIN = 60000;
const PALETTES = [
  { id: 'deep_sea', c1: 0.62, c2: 0.48 },
  { id: 'bass_drop', c1: 0.02, c2: 0.9 },
  { id: 'coral', c1: 0.05, c2: 0.15 },
];
const PLAYLISTS = ['baseline_pl', 'ambient_pl', 'party_pl', 'party_high_pl', 'show_pl'];

// ── a deck MIRROR: what the rig would actually be showing ────────────────────
function makeDeps() {
  const deck = { playlist: null, palette: null, autopilot: null };
  const view = { mode: null, source: null };
  const deps = {
    loadPlaylist: ({ target, name }) => { if (target.kind === 'deck') deck.playlist = name; },
    setAutopilot: ({ target, state }) => { if (target.kind === 'deck') deck.autopilot = { ...state }; },
    setParams: (obj) => {
      if (obj && obj.colorPalette1) {
        const hit = PALETTES.find((p) => p.c1 === obj.colorPalette1.h);
        deck.palette = hit ? hit.id : null;
      }
    },
    setMaster: () => {},
    requestScene: () => { throw new Error('no scene switches in this suite'); },
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [...PLAYLISTS],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => { view.mode = 'deck'; view.source = 'plan'; },
    releaseDeckView: () => { if (view.source === 'plan') { view.mode = null; view.source = null; } },
    getViewOverrideMode: () => view.mode,
  };
  return { deps, deck };
}

const CUE_SHOW = {
  id: 'c_show',
  label: 'Scheduled show',
  kind: 'program',
  trigger: { type: 'clock', at: '20:00' },
  action: { type: 'look', look: 'show' },
  hold: { min: 60 },                  // → 20:00 … 21:00
};
const CUE_PARTY_RAMP = {
  id: 'c_party_start',
  label: 'Party night ramp',
  kind: 'ambient',                    // the plan BACKGROUND layer: no durationMin
  trigger: { type: 'phase', phase: 'party_night' },
  action: { type: 'look', look: 'party' },
};
const CUE_MOOD = {
  id: 'c_mood_to_party',
  label: 'Party session',
  kind: 'mood',
  durationMin: 12,                    // a TIMED punch-through
  trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 120, cooldownSec: 120 },
  action: { type: 'look', look: 'party_high' },
};

// A plan shaped like the shipped one: a held program, an open-ended AMBIENT phase
// cue, a timed MOOD session cue, and an ambient defaultCue. Every look points at
// a DIFFERENT playlist — which is what makes the clobber/ownership bugs visible
// at all (on the shipped plan every look points at `default`, which is exactly
// why `_95` F1 was latent).
//
// `phaseStart` defaults to 20:30, i.e. STRICTLY INSIDE the c_show hold, so the
// program-vs-ambient collision is a real overlap and not a boundary tie.
function makePlan({ phaseStart = '20:30', cues = [CUE_SHOW, CUE_PARTY_RAMP, CUE_MOOD], ...over } = {}) {
  return validateShowPlan({
    schemaVersion: 2,
    name: 'precedence_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    festival: { startDate: '2026-08-30', days: 8 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: { party_night: { start: { clock: phaseStart }, end: { clock: '23:00' } } },
    looks: {
      show: {
        playlist: 'show_pl', palette: 'coral',
        autopilot: { active: true, delay_s: 90, shuffle: false },
      },
      party: {
        playlist: 'party_pl', palette: 'bass_drop',
        autopilot: { active: true, delay_s: 30, shuffle: true },
      },
      party_high: {
        playlist: 'party_high_pl', palette: 'bass_drop',
        autopilot: { active: true, delay_s: 30, shuffle: true },
      },
      ambient: {
        playlist: 'ambient_pl', palette: 'deep_sea',
        autopilot: { active: true, delay_s: 90, shuffle: true },
      },
    },
    defaultCue: { label: 'Ambient program', action: { type: 'look', look: 'ambient' } },
    cues,
    ...over,
  });
}

const AT = (clock) => dateClockToEpochMs('2026-09-01', clock, TZ);

function setup(plan = makePlan(), { now = AT('19:00'), party = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlprec-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, deck } = makeDeps();
  const clock = { now };
  const mood = { party };
  const svc = new TimelineService({
    scene: 'test_bench',
    sceneDir,
    stateDir,
    getMood: () => ({ party: mood.party, value: mood.party }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioPartyStrong', partyThreshold: 0.5 }, colorPalettes: PALETTES,
    },
    nowFn: () => clock.now,
  });
  return { svc, deps, deck, clock, mood, sceneDir, stateDir, plan };
}

// Boot the service and UNREF its 1 s interval — this suite drives _tick() by hand
// on an injected clock, and a live interval would hold node:test's loop open.
async function start(h) {
  await h.svc.start();
  if (h.svc._tickHandle && typeof h.svc._tickHandle.unref === 'function') h.svc._tickHandle.unref();
  return h.svc;
}

/** Tick forward `minutes` simulated minutes, one tick per minute. */
async function run(h, minutes) {
  for (let i = 0; i < minutes; i += 1) {
    h.clock.now += MIN;
    await h.svc._tick();
  }
}

/** Tick until `pred(h)` holds; THROWS loud (never silently gives up) at `maxMin`. */
async function runUntil(h, pred, maxMin, what) {
  for (let i = 0; i < maxMin; i += 1) {
    if (pred(h)) return i;
    h.clock.now += MIN;
    await h.svc._tick();
  }
  if (pred(h)) return maxMin;
  throw new Error(`runUntil: "${what}" never happened within ${maxMin} simulated minutes`);
}

const ownerIs = (id) => (h) => h.svc._deckWindowCueId === id;

// ── FIX 1 — a SUPPRESSED mood fire consumes NOTHING ─────────────────────────

test('FIX 1: a mood fire the arbiter drops burns neither the arm latch nor the cooldown', async () => {
  const h = setup(makePlan(), { now: AT('19:40'), party: 0 });
  await start(h);
  await run(h, 2);                              // arm the cue while the mood is CALM
  h.mood.party = 1;
  await runUntil(h, ownerIs('c_mood_to_party'), 20, 'the first party session starts');
  assert.equal(h.deck.playlist, 'party_high_pl');

  // 20:00: the program seizes the deck. The session ends properly (superseded),
  // which re-arms the trigger and stamps the cooldown at that instant.
  await runUntil(h, (x) => x.svc.state.controller === 'program', 30, 'the show starts');
  assert.equal(h.deck.playlist, 'show_pl');
  const cueId = 'c_mood_to_party';
  const stampAtShowStart = h.svc.state.moodLastFire[cueId];
  assert.equal(h.svc.state.moodArmed[cueId], true);

  // The music never stops, so the mood cue re-asks on EVERY tick of the hold and
  // the arbiter drops it every time. None of that may consume anything.
  await run(h, 40);
  assert.equal(h.svc.state.controller, 'program', 'still inside the hold');
  assert.equal(h.svc.state.moodArmed[cueId], true, 'the arm latch survives suppression');
  assert.equal(h.svc.state.moodLastFire[cueId], stampAtShowStart, 'the cooldown is not re-stamped');
  assert.equal(h.svc.getPartyStatus().triggerArmed, true, 'and getPartyStatus tells the truth');

  // The whole episode is ONE wouldFire entry, not one per tick.
  assert.equal(h.svc.wouldFire.filter((w) => w.cueId === cueId).length, 1,
    'edge-only suppression logging');

  // …and the moment the hold ends, party resumes. Before `_98` a single
  // suppression killed party for the rest of the night (0 sessions, all night).
  await runUntil(h, ownerIs(cueId), 30, 'party resumes after the hold');
  assert.equal(h.deck.playlist, 'party_high_pl');
  h.svc.stop();
});

test('FIX 1: a mood fire the arbiter ACCEPTS still consumes the latch + cooldown', async () => {
  // The rollback must be surgical — a fire that actually PLAYED is bookkept
  // exactly as before (that is what stops a live session re-firing every tick).
  const h = setup(makePlan(), { now: AT('19:40'), party: 0 });
  await start(h);
  await run(h, 2);
  h.mood.party = 1;
  await runUntil(h, ownerIs('c_mood_to_party'), 20, 'the session starts');
  assert.equal(h.svc.state.moodArmed.c_mood_to_party, false, 'a played fire burns the latch');
  assert.equal(typeof h.svc.state.moodLastFire.c_mood_to_party, 'number');
  assert.equal(h.svc.getPartyStatus().triggerArmed, false);
  h.svc.stop();
});

// ── FIX 3 — an ambient cue never overwrites a LIVE program's look ────────────

test('FIX 3 (arbiter): an ambient fire is suppressed while a program owns control', () => {
  const plan = makePlan();
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon, date: new Date(AT('12:00')), tz: TZ,
  });
  const now = AT('20:30');
  const dayTimes = resolveDayTimes({ plan, now, sunEvents });
  const base = { autopilotEnabled: true, mode: 'armed', pendingProgram: null, operatorLease: null };
  const fires = [{ cueId: 'c_party_start', reason: 'phase' }];

  const underProgram = arbitrate({
    now,
    plan,
    state: {
      ...base,
      activeProgram: { cueId: 'c_show', startedAtMs: now - 30 * MIN, untilMs: now + 30 * MIN },
    },
    fires,
    dayTimes,
  });
  assert.equal(underProgram.controller, 'program');
  assert.deepEqual(underProgram.actions, [], 'the program keeps BOTH precedence and its look');

  const underAutopilot = arbitrate({
    now, plan, state: { ...base, activeProgram: null }, fires, dayTimes,
  });
  assert.equal(underAutopilot.actions.length, 1, 'and it still lands under plain autopilot');
  assert.equal(underAutopilot.actions[0].cueId, 'c_party_start');
});

test('FIX 3 (service): the show survives its full hold with a phase cue due mid-hold', async () => {
  const h = setup(makePlan(), { now: AT('19:55'), party: 0 });
  await start(h);
  await runUntil(h, (x) => x.svc.state.controller === 'program', 20, 'the show starts');
  assert.equal(h.deck.playlist, 'show_pl');
  await run(h, 40);                             // past 20:30, the phase edge, still holding
  assert.equal(h.deck.playlist, 'show_pl', 'the burn-night class of bug: the show is NOT wiped');
  assert.equal(h.svc._deckWindowCueId, 'c_show');
  const wouldFire = h.svc.wouldFire.filter((w) => w.cueId === 'c_party_start');
  assert.equal(wouldFire.length, 1, 'the dropped ambient fire is surfaced, never silent');
  assert.equal(wouldFire[0].controller, 'program');
  h.svc.stop();
});

// ── FIX 7 — a hold expiring naturally lands on the ambient defaultCue ────────

test('FIX 7 (G1): the deck goes to the defaultCue when a program hold expires', async () => {
  // The PARTY RAMP is deliberately absent, EXACTLY like the boot half below
  // (report 356, P1-5): with `c_party_start` in the plan the ramp's phase is
  // still active at 21:00, so both boot AND a live hold expiry correctly land on
  // the ramp — pinned by the companion test right after this one. What FIX 7
  // pins is the narrower rule this isolated plan still shows: an EXPIRED program
  // hold owns nothing afterwards, so with no other owner the deck goes to the
  // defaultCue.
  const h = setup(makePlan({ cues: [CUE_SHOW, CUE_MOOD] }), { now: AT('19:55'), party: 0 });
  await start(h);
  await runUntil(h, (x) => x.svc.state.controller === 'program', 20, 'the show starts');
  assert.equal(h.svc._deckWindowCueId, 'c_show');

  await runUntil(h, (x) => x.svc.state.controller === 'autopilot', 90, 'the hold expires');
  assert.equal(h.deck.playlist, 'ambient_pl', 'the AMBIENT default cue owns the deck…');
  assert.equal(h.deck.palette, 'deep_sea', '…including its palette');
  assert.equal(h.svc._deckWindowCueId, null, 'the ownership latch is released');
  assert.equal(h.svc._defaultCueActive, true);
  const fires = h.svc.recentFires.filter((f) => f.kind === 'fire' && f.reason === 'hold-expired');
  assert.equal(fires.length, 1);
  assert.equal(fires[0].cueId, '__default_cue__');
  assert.equal(
    h.svc.recentFires.filter((f) => f.kind === 'lifecycle' && f.reason === 'hold-expired').length, 1,
    'the "Program ended (hold expired)" lifecycle line is still logged',
  );
  h.svc.stop();
});

test('FIX 7 (P1-5): with the RAMP in the plan, hold expiry lands on it — boot and runtime agree', async () => {
  // The live half of the boot rule the FIX 7 comments describe. `c_party_start`
  // is a PHASE BASELINE (kind:ambient on a phase trigger) whose phase opened at
  // 20:30 while the show still held, so the arbiter SUPPRESSED its one
  // rising-edge fire (FIX 3 above). When the hold expires at 21:00 the plan's
  // background layer for party_night is what owns the moment — `resolveDeckStateAt`
  // says so at boot, and the live deck must not disagree. Before this fix a
  // restart at 21:01 played party_pl while the running engine played ambient_pl,
  // and the ramp never came back for the rest of the night.
  const h = setup(makePlan(), { now: AT('19:55'), party: 0 });
  await start(h);
  await runUntil(h, (x) => x.svc.state.controller === 'program', 20, 'the show starts');
  await runUntil(h, (x) => x.svc.state.controller === 'autopilot', 90, 'the hold expires');
  assert.equal(h.deck.playlist, 'party_pl', 'the suppressed phase BASELINE owns the deck…');
  assert.equal(h.deck.palette, 'bass_drop', '…including its palette');
  assert.equal(h.svc._deckWindowCueId, 'c_party_start', 'and it holds the ownership latch');
  assert.equal(h.svc._defaultCueActive, false, 'the flat defaultCue is NOT what drives here');
  assert.equal(h.svc.state.currentPhase, 'party_night',
    'the phase is latched so the next tick does not re-fire the rising edge');
  const fires = h.svc.recentFires.filter((f) => f.kind === 'fire' && f.reason === 'hold-expired');
  assert.deepEqual(fires.map((f) => f.cueId), ['c_party_start'], 'exactly one apply, and it is the ramp');
  assert.ok(!h.svc.recentFires.some((f) => f.kind === 'fire' && f.reason === 'no-owning-cue'),
    'and no tick-driven follow-up apply');
  h.svc.stop();
});

test('FIX 7: a plan with NO defaultCue keeps the autopilot baseline on hold expiry', async () => {
  const bare = makePlan();
  delete bare.defaultCue;
  const h = setup(bare, { now: AT('19:55'), party: 0 });
  await start(h);
  await runUntil(h, (x) => x.svc.state.controller === 'program', 20, 'the show starts');
  await runUntil(h, (x) => x.svc.state.controller === 'autopilot', 90, 'the hold expires');
  assert.equal(h.deck.playlist, 'baseline_pl', 'the baseline IS the deck fill here — unchanged');
  assert.equal(h.svc.recentFires.filter((f) => f.cueId === '__autopilot_resume__').length, 1,
    'and the "Autopilot resumed" line is still logged');
  h.svc.stop();
});

// ── FIX 2 / FIX 6 — the catchUp (boot / resume / lease-release) path ─────────

test('FIX 2: a restart INSIDE a program hold keeps the look own pattern autopilot', async () => {
  // The look asks for 90 s sequential. Before `_98` catchUp disarmed the baseline
  // AFTER applying the look, cancelling exactly that — `ap OFF` for the whole hold.
  const h = setup(makePlan(), { now: AT('20:30'), party: 0 });
  await start(h);
  assert.equal(h.svc.state.controller, 'program');
  assert.equal(h.deck.playlist, 'show_pl');
  assert.deepEqual(h.deck.autopilot, { active: true, delay_s: 90, shuffle: false },
    'the caught-up program cycles exactly as a live fire would');
  assert.equal(h.svc._baselineArmed, false, 'and the plan baseline stays disarmed');

  await run(h, 20);                             // the per-tick reconcile must not flip it off
  assert.equal(h.deck.autopilot.active, true);
  h.svc.stop();
});

test('FIX 6 (F1): the boot baseline does not clobber a restored non-program cue', async () => {
  // A timed AMBIENT cue restored mid-window. Its look points at `party_pl`; the
  // plan baseline points at `baseline_pl`. Before `_98` the boot landed on
  // `baseline_pl` — latent on the shipped plan only because every look there
  // already points at the baseline playlist.
  const plan = makePlan({
    cues: [{
      id: 'c_timed_ambient',
      label: 'Timed ambient',
      kind: 'ambient',
      trigger: { type: 'clock', at: '20:00' },
      action: { type: 'look', look: 'party' },
      durationMin: 60,
    }],
  });
  const h = setup(plan, { now: AT('20:30'), party: 0 });
  await start(h);
  assert.equal(h.deck.playlist, 'party_pl', 'the RESTORED cue own playlist is on the deck');
  assert.equal(h.deck.palette, 'bass_drop', 'and its palette');
  assert.deepEqual(h.deck.autopilot, { active: true, delay_s: 30, shuffle: true },
    'and its own autopilot, not the baseline 45s shuffle');
  assert.equal(h.svc.state.controller, 'autopilot');

  await run(h, 31);                             // the window still elapses normally
  assert.equal(h.deck.playlist, 'ambient_pl');
  h.svc.stop();
});

test('FIX 7 (boot half): a restart AFTER a hold expired lands on the defaultCue', async () => {
  // The PARTY RAMP is deliberately absent from this plan (report 356, P1-5).
  // Since P1-5 the resolver restores an AMBIENT `phase` cue whose phase is still
  // active, so with `c_party_start` in the plan a 21:30 restart correctly lands
  // on the ramp, not on the defaultCue — that is the F4 fix, and it is pinned by
  // party_window / resolve_deck_state's own P1-5 cases. What FIX 7 pins is the
  // narrower rule this plan still isolates: an EXPIRED program hold owns nothing
  // afterwards, so with no other owner the deck goes to the defaultCue.
  const h = setup(makePlan({ cues: [CUE_SHOW, CUE_MOOD] }), { now: AT('21:30'), party: 0 });
  await start(h);
  assert.equal(h.deck.playlist, 'ambient_pl', 'boot and runtime give the SAME answer');
  assert.equal(h.svc._deckWindowCueId, null);
  assert.equal(h.svc.state.activeProgram, null);
  h.svc.stop();
});

// ── FIX 5 — the displaced open-ended AMBIENT owner comes back ────────────────

// No program cue: this is the "party night runs on autopilot" arc in isolation.
const rampPlan = (over = {}) => makePlan({
  phaseStart: '21:00', cues: [CUE_PARTY_RAMP, CUE_MOOD], ...over,
});

test('FIX 5: the ambient background look returns after every session', async () => {
  const h = setup(rampPlan(), { now: AT('20:58'), party: 0 });
  await start(h);
  await runUntil(h, ownerIs('c_party_start'), 10, 'the phase ramp takes the deck');
  assert.equal(h.deck.playlist, 'party_pl');

  h.mood.party = 1;
  await runUntil(h, ownerIs('c_mood_to_party'), 20, 'session 1 punches through');
  assert.equal(h.deck.playlist, 'party_high_pl');
  assert.equal(h.svc._displacedDeckOwnerCueId, 'c_party_start', 'the background layer is remembered');

  await runUntil(h, (x) => x.svc._deckWindowCueId !== 'c_mood_to_party', 20, 'session 1 ends');
  assert.equal(h.svc._deckWindowCueId, 'c_party_start', 'it comes BACK, not the defaultCue');
  assert.equal(h.deck.playlist, 'party_pl');
  assert.equal(h.svc.recentFires.filter((f) => f.reason === 'owner-restored').length, 1);

  // …and it survives a SECOND session, which is the whole point: before `_98` the
  // FIRST session evicted it for the rest of the night.
  await runUntil(h, ownerIs('c_mood_to_party'), 20, 'session 2 starts');
  await runUntil(h, (x) => x.svc._deckWindowCueId !== 'c_mood_to_party', 20, 'session 2 ends');
  assert.equal(h.svc._deckWindowCueId, 'c_party_start');
  assert.equal(h.svc.recentFires.filter((f) => f.reason === 'owner-restored').length, 2);
  h.svc.stop();
});

test('FIX 5: a PHASE-triggered owner is not restored once its phase has ended', async () => {
  // party_night ends at 23:00 — the party-night ramp must never come back at 07:00.
  // Timed so the session's 12-minute window elapses AFTER the phase closes.
  const h = setup(rampPlan(), { now: AT('22:48'), party: 0 });
  await start(h);
  await runUntil(h, ownerIs('c_party_start'), 5, 'the ramp owns the deck (phase already open)');
  h.mood.party = 1;
  await runUntil(h, ownerIs('c_mood_to_party'), 15, 'a session starts before the phase closes');
  assert.equal(h.svc._displacedDeckOwnerCueId, 'c_party_start');
  await runUntil(h, (x) => x.svc._deckWindowCueId !== 'c_mood_to_party', 20, 'the window elapses');
  assert.equal(h.svc._deckWindowCueId, null, 'no restore outside the phase');
  assert.equal(h.deck.playlist, 'ambient_pl', 'the defaultCue fills instead');
  h.svc.stop();
});

test('FIX 5: only an AMBIENT predecessor is remembered (a session is never resurrected)', async () => {
  // Boot into the defaultCue with no ambient owner: a session displaces nothing,
  // so the window elapsing must fall back to the defaultCue exactly as before.
  const h = setup(makePlan({ cues: [CUE_MOOD] }), { now: AT('21:30'), party: 0 });
  await start(h);
  assert.equal(h.deck.playlist, 'ambient_pl');
  await run(h, 2);                              // arm the cue while the mood is CALM
  h.mood.party = 1;
  await runUntil(h, ownerIs('c_mood_to_party'), 20, 'the session starts');
  assert.equal(h.svc._displacedDeckOwnerCueId, null,
    'a defaultCue predecessor is not a background layer');
  await runUntil(h, (x) => x.svc._deckWindowCueId !== 'c_mood_to_party', 20, 'the window elapses');
  assert.equal(h.deck.playlist, 'ambient_pl');
  assert.equal(h.svc.recentFires.filter((f) => f.reason === 'owner-restored').length, 0);
  h.svc.stop();
});
