/*
 * timeline_resolve_deck_state.test.js — the PURE resolver (report _94 §4.1,
 * operator ruling D5). Three independent proofs:
 *
 *   1. LEGACY-CORE EQUIVALENCE — a verbatim copy of _catchUp's pre-refactor
 *      selection core is run against the resolver over a matrix of instants ×
 *      plans. Any drift in the extracted core fails here.
 *   2. LIVE-SERVICE ORACLE (the _94 §3.4 cross-check, D5(b) as the test oracle)
 *      — a THROWAWAY TimelineService with recording deps and an injected clock
 *      is booted AT each instant; what it actually put on the deck must equal
 *      what the resolver says would be there.
 *   3. PURITY — no mutation of the input plan, no clock of its own.
 *
 * Plus the additive overview data (phases + the resolved ribbon).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService, buildOverview } from '../../lib/timeline/timeline_service.js';
import { resolveDeckStateAt, buildDaySegments } from '../../lib/timeline/resolve_deck_state.js';
import { saveShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';
import { computeSunEvents } from '../../lib/timeline/sun.js';
import { resolveDayTimes, dateClockToEpochMs } from '../../lib/timeline/triggers.js';
import { applicableCues } from '../../lib/timeline/festival.js';
import { resolveHold } from '../../lib/timeline/arbiter.js';

// node:test on Windows trips a worker-IPC flake when a suite logs heavily
// (see _91 §6.1) — the service is chatty on every dispatch.
const QUIET = () => {};
const REAL_LOG = console.log;
const REAL_WARN = console.warn;
console.log = QUIET;
console.warn = QUIET;
process.on('exit', () => { console.log = REAL_LOG; console.warn = REAL_WARN; });

const TZ = 'America/Los_Angeles';
const START_DATE = '2026-08-30';
const PALETTES = [
  { id: 'deep_sea', c1: 0.62, c2: 0.48 },
  { id: 'bass_drop', c1: 0.9, c2: 0.1 },
];

function makePlan(overrides = {}) {
  return validateShowPlan({
    schemaVersion: 2,
    name: 'resolver_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    festival: { startDate: START_DATE, days: 8 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {
      philharmonic: { start: { sun: 'sunset', offsetMin: -30 }, end: { sun: 'sunset', offsetMin: 60 } },
      party_night: { start: { sun: 'sunset', offsetMin: 120 }, end: { sun: 'sunrise', offsetMin: -60 } },
    },
    looks: {
      day: { playlist: 'day_pl' },
      philharmonic: { playlist: 'phil_pl', palette: 'deep_sea' },
      party: { playlist: 'party_pl', palette: 'bass_drop' },
      ambient: { playlist: 'ambient_pl' },
      burn: { playlist: 'burn_pl' },
    },
    cues: [
      {
        id: 'c_morning',
        label: 'Morning',
        kind: 'ambient',
        trigger: { type: 'clock', at: '06:00' },
        action: { type: 'look', look: 'day' },
        durationMin: 120,
      },
      {
        id: 'c_nocatch',
        label: 'No catch-up',
        kind: 'ambient',
        trigger: { type: 'clock', at: '08:00' },
        action: { type: 'look', look: 'day' },
        catchUp: false,
      },
      {
        id: 'c_disabled',
        label: 'Disabled',
        kind: 'ambient',
        enabled: false,
        trigger: { type: 'clock', at: '09:00' },
        action: { type: 'look', look: 'day' },
      },
      {
        id: 'c_visibility',
        label: 'Visibility on',
        kind: 'program',
        trigger: { type: 'sun', event: 'sunset', offsetMin: -45 },
        action: { type: 'look', look: 'philharmonic' },
        hold: { min: 90 },
      },
      {
        id: 'c_party_start',
        label: 'Party night',
        kind: 'ambient',
        trigger: { type: 'sun', event: 'sunset', offsetMin: 120 },
        action: { type: 'look', look: 'party' },
      },
      {
        id: 'c_burn',
        label: 'Burn night',
        kind: 'program',
        days: [6],
        trigger: { type: 'clock', at: '21:00' },
        action: { type: 'look', look: 'burn' },
        hold: { min: 120 },
      },
      {
        id: 'c_mood',
        label: 'Party detected',
        trigger: { type: 'mood', from: 'calm', to: 'party', minDwellSec: 120, cooldownSec: 120 },
        action: { type: 'look', look: 'party' },
        durationMin: 12,
      },
    ],
    defaultCue: { label: 'Ambient', action: { type: 'look', look: 'ambient' } },
    ...overrides,
  });
}

// The SAME plan without a defaultCue — exercises the autopilot-baseline branch.
function makeNoDefaultPlan() {
  const plan = makePlan();
  delete plan.defaultCue;
  return plan;
}

// ── 1. the LEGACY selection core, copied VERBATIM from _catchUp before the
//       extraction (timeline_service.js:1719-1743 + the window re-anchor at
//       :1753-1757). This is the byte-identical guard: if the extracted core
//       ever drifts, the matrix below fails.
function legacyCatchUpCore(plan, now) {
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon, date: new Date(now), tz: plan.location.tz,
  });
  const dayPlan = { ...plan, cues: applicableCues(plan, now) };
  const dayTimes = resolveDayTimes({ plan: dayPlan, now, sunEvents });

  const firedToday = [];
  let best = null;
  for (const cue of dayPlan.cues) {
    if (cue.enabled === false) continue;
    const t = cue.trigger;
    if (t.type !== 'clock' && t.type !== 'sun') continue;
    const fireMs = dayTimes.cueTimes[cue.id];
    if (typeof fireMs !== 'number' || fireMs > now) continue;
    firedToday.push(cue.id);
    const restorable = (cue.action.type === 'look' || cue.action.type === 'playlist') && cue.catchUp !== false;
    if (restorable && (best === null || fireMs > best.fireMs)) best = { cue, fireMs };
  }

  let programCaughtUp = false;
  let activeProgram = null;
  if (best && best.cue.kind === 'program') {
    const untilMs = resolveHold(best.cue.hold, best.fireMs, dayTimes);
    if (typeof untilMs === 'number' && untilMs > now) {
      activeProgram = { cueId: best.cue.id, startedAtMs: best.fireMs, untilMs };
      programCaughtUp = true;
    }
  }

  let windowUntilMs = null;
  if (best) {
    const dur = best.cue.durationMin;
    if (typeof dur === 'number' && dur > 0) windowUntilMs = best.fireMs + dur * 60000;
  }

  return {
    firedToday,
    bestCueId: best ? best.cue.id : null,
    fireMs: best ? best.fireMs : null,
    programCaughtUp,
    activeProgram,
    windowUntilMs,
  };
}

// The matrix: every festival day × a spread of local instants (pre-dawn, day,
// the sunset ramp, deep night). ~8 days × 13 times = 104 instants per plan.
const MATRIX_TIMES = [
  '00:30', '03:00', '05:45', '06:00', '06:01', '07:59', '08:30',
  '12:00', '17:00', '19:00', '20:30', '21:30', '23:45',
];

function matrixInstants(plan) {
  const out = [];
  for (let d = 0; d < plan.festival.days; d += 1) {
    const [y, m, dd] = START_DATE.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, dd + d));
    const dateKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    for (const time of MATRIX_TIMES) {
      out.push({ dateKey, time, atMs: dateClockToEpochMs(dateKey, time, TZ) });
    }
  }
  return out;
}

test('resolver matches the pre-refactor _catchUp selection core over the whole matrix', () => {
  for (const plan of [makePlan(), makeNoDefaultPlan()]) {
    const instants = matrixInstants(plan);
    assert.equal(instants.length, 104, 'matrix size');
    for (const { dateKey, time, atMs } of instants) {
      const legacy = legacyCatchUpCore(plan, atMs);
      const r = resolveDeckStateAt({ plan, atMs });
      const where = `${dateKey} ${time}`;

      // `restored` IS the selection core — the byte-identical surface catchUp
      // consumes. Every field it takes must match the legacy computation.
      assert.deepEqual(r.passedCueIds, legacy.firedToday, `firedToday latch set @ ${where}`);
      assert.equal(r.restored ? r.restored.cueId : null, legacy.bestCueId, `selected cue @ ${where}`);
      assert.equal(r.restored ? r.restored.fireMs : null, legacy.fireMs, `cue fire time @ ${where}`);
      assert.equal(
        !!(r.restored && r.restored.programLive), legacy.programCaughtUp,
        `programCaughtUp @ ${where}`,
      );
      if (legacy.programCaughtUp) {
        assert.equal(r.restored.holdUntilMs, legacy.activeProgram.untilMs, `hold untilMs @ ${where}`);
        assert.equal(r.restored.cueId, legacy.activeProgram.cueId, `program cueId @ ${where}`);
        assert.equal(r.restored.fireMs, legacy.activeProgram.startedAtMs, `program start @ ${where}`);
      }
      assert.equal(
        r.restored ? r.restored.windowUntilMs : null, legacy.windowUntilMs,
        `re-anchored window @ ${where}`,
      );
    }
  }
});

test('resolver is PURE — no plan mutation, deterministic, no clock of its own', () => {
  const plan = makePlan();
  const before = JSON.stringify(plan);
  const atMs = dateClockToEpochMs('2026-09-02', '21:00', TZ);
  const a = resolveDeckStateAt({ plan, atMs });
  const b = resolveDeckStateAt({ plan, atMs });
  assert.equal(JSON.stringify(plan), before, 'the plan must never be mutated');
  assert.deepEqual(a.owner, b.owner);
  assert.equal(a.playlist, b.playlist);
  assert.equal(a.controller, b.controller);
  // Injecting the day's sun events must not change the answer (only save work).
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon, date: new Date(atMs), tz: TZ,
  });
  const c = resolveDeckStateAt({ plan, atMs, sunEvents });
  assert.deepEqual(c.owner, a.owner);
  assert.equal(c.playlist, a.playlist);
});

test('resolver fails LOUD on a bad plan / bad instant (no fallback to now)', () => {
  const plan = makePlan();
  assert.throws(() => resolveDeckStateAt({ plan, atMs: undefined }), /finite epoch ms/);
  assert.throws(() => resolveDeckStateAt({ plan, atMs: NaN }), /finite epoch ms/);
  assert.throws(() => resolveDeckStateAt({ plan: null, atMs: 0 }), /plan is required/);
});

test('out of the festival window the resolver reports DORMANT, not a look', () => {
  const plan = makePlan();
  const r = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-20', '21:00', TZ) });
  assert.equal(r.inWindow, false);
  assert.equal(r.owner, null);
  assert.equal(r.action, null);
  assert.equal(r.controller, 'manual');
  assert.equal(r.source, 'dormant');
  assert.deepEqual(r.passedCueIds, []);
});

test('owner kinds: cue → defaultCue → autopilot baseline', () => {
  const plan = makePlan();
  // 07:00 — c_morning (06:00) owns the deck.
  const owned = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-01', '07:00', TZ) });
  assert.equal(owned.owner.kind, 'cue');
  assert.equal(owned.owner.cueId, 'c_morning');
  assert.equal(owned.playlist, 'day_pl');
  assert.equal(owned.source, 'cue');

  // 03:00 — nothing has fired yet today → the plan's defaultCue fills.
  const gap = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-01', '03:00', TZ) });
  assert.equal(gap.owner.kind, 'defaultCue');
  assert.equal(gap.playlist, 'ambient_pl');
  assert.equal(gap.source, 'default-cue');

  // Same instant, plan with NO defaultCue → the autopilot baseline.
  const bare = resolveDeckStateAt({
    plan: makeNoDefaultPlan(), atMs: dateClockToEpochMs('2026-09-01', '03:00', TZ),
  });
  assert.equal(bare.owner.kind, 'baseline');
  assert.equal(bare.playlist, 'baseline_pl');
  assert.equal(bare.source, 'autopilot-baseline');
  assert.equal(bare.action, null);
});

test('a program inside its hold reports controller=program; expired does not', () => {
  const plan = makePlan();
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon,
    date: new Date(dateClockToEpochMs('2026-09-01', '12:00', TZ)), tz: TZ,
  });
  const fireMs = sunEvents.sunset.valueOf() - 45 * 60000;
  const inHold = resolveDeckStateAt({ plan, atMs: fireMs + 30 * 60000 });
  assert.equal(inHold.owner.cueId, 'c_visibility');
  assert.equal(inHold.controller, 'program');
  assert.equal(inHold.holdUntilMs, fireMs + 90 * 60000);

  // `_98` FIX 7 (G1): an EXPIRED hold owns nothing at all — the deck goes to the
  // plan's ambient defaultCue, so the owner is no longer the cue. (Before `_98`
  // the cue kept the ownership latch while the baseline playlist played under it.)
  const afterHold = resolveDeckStateAt({ plan, atMs: fireMs + 100 * 60000 });
  assert.equal(afterHold.owner.kind, 'defaultCue');
  assert.equal(afterHold.controller, 'autopilot', 'an expired hold must not seize the controller');
  assert.equal(afterHold.holdUntilMs, null);
  assert.equal(afterHold.restored.cueId, 'c_visibility', 'catchUp still re-applies the look');
  assert.equal(afterHold.restored.holdExpired, true);
});

test('G1 is FIXED: an expired program hold yields the deck to the defaultCue', () => {
  // `_98` FIX 7. This test previously PINNED the _91 G1 bug ("an expired program
  // hold plays the BASELINE playlist"): the service's `__resume_autopilot__`
  // handler reloaded plan.autopilot.playlist but never cleared the deck-ownership
  // latch, so `_reconcileDefaultCue` early-returned and the ambient defaultCue was
  // unreachable — the inverse of the operator requirement "ambient is dominant".
  // The service now releases the latch on hold expiry and hands the deck straight
  // to the defaultCue, so `source:'hold-expired-baseline'` is no longer emitted.
  const plan = makePlan();
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon,
    date: new Date(dateClockToEpochMs('2026-09-01', '12:00', TZ)), tz: TZ,
  });
  const fireMs = sunEvents.sunset.valueOf() - 45 * 60000;

  const held = resolveDeckStateAt({ plan, atMs: fireMs + 30 * 60000 });
  assert.equal(held.playlist, 'phil_pl', 'inside the hold the program own playlist plays');
  assert.equal(held.source, 'cue');

  const expired = resolveDeckStateAt({ plan, atMs: fireMs + 100 * 60000 });
  assert.equal(expired.owner.kind, 'defaultCue', 'the expired program owns nothing');
  assert.equal(expired.playlist, 'ambient_pl', 'the AMBIENT default cue is what plays');
  assert.equal(expired.palette, null, 'the default cue own palette (the ambient look declares none)');
  assert.equal(expired.source, 'default-cue');
  // The catchUp selection is untouched by this — `restored` still names the cue
  // and its own action, which is exactly what catchUp re-applies (and then
  // releases, because holdExpired says the program owns nothing).
  assert.equal(expired.restored.cueId, 'c_visibility');
  assert.equal(expired.restored.holdExpired, true);
  assert.deepEqual(expired.restored.action, { type: 'look', look: 'philharmonic' });

  // A plan with NO defaultCue keeps the baseline as its deck fill — unchanged.
  const bare = resolveDeckStateAt({ plan: makeNoDefaultPlan(), atMs: fireMs + 100 * 60000 });
  assert.equal(bare.owner.kind, 'baseline');
  assert.equal(bare.playlist, 'baseline_pl');
  assert.equal(bare.source, 'autopilot-baseline');
});

test('per-day cue targeting is honoured (a days:[6] cue only owns on day 6)', () => {
  const plan = makePlan();
  // 21:10 is past c_burn (21:00) but before c_party_start (sunset+120 ≈ 21:26).
  const day6 = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-05', '21:10', TZ) });
  assert.equal(day6.owner.cueId, 'c_burn');
  assert.equal(day6.festivalDayIndex, 6);
  const day5 = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-04', '21:10', TZ) });
  assert.notEqual(day5.owner.cueId, 'c_burn');
  assert.ok(!day5.passedCueIds.includes('c_burn'), 'a day-6 cue never latches on day 5');
});

test('catchUp:false and enabled:false cues are never the restored cue', () => {
  const plan = makePlan();
  // 08:30 is past c_nocatch (08:00) but it is not restorable → c_morning stands.
  const r = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-01', '08:30', TZ) });
  assert.equal(r.restored.cueId, 'c_morning');
  assert.ok(r.passedCueIds.includes('c_nocatch'), 'it still latches fired');
  assert.ok(!r.passedCueIds.includes('c_disabled'), 'a disabled cue never latches');
});

test('an ELAPSED durationMin window yields the deck to the defaultCue', () => {
  const plan = makePlan();
  // c_morning fires 06:00 with durationMin 120 → its window closes at 08:00.
  const inWindow = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-01', '07:00', TZ) });
  assert.equal(inWindow.owner.kind, 'cue');
  assert.equal(inWindow.owner.cueId, 'c_morning');
  assert.equal(inWindow.playlist, 'day_pl');

  const elapsed = resolveDeckStateAt({ plan, atMs: dateClockToEpochMs('2026-09-01', '09:00', TZ) });
  assert.equal(elapsed.restored.cueId, 'c_morning', 'catchUp still re-applies it…');
  assert.equal(elapsed.owner.kind, 'defaultCue', '…but the deck has already reverted');
  assert.equal(elapsed.playlist, 'ambient_pl');
  assert.equal(elapsed.source, 'default-cue');
});

test('a LIVE program hold owns the deck even past its own durationMin window', () => {
  // c_visibility is a program with hold 90 min and no durationMin, so the hold
  // is the only thing that can end it.
  const plan = makePlan();
  const sunEvents = computeSunEvents({
    lat: plan.location.lat, lon: plan.location.lon,
    date: new Date(dateClockToEpochMs('2026-09-01', '12:00', TZ)), tz: TZ,
  });
  const fireMs = sunEvents.sunset.valueOf() - 45 * 60000;
  const held = resolveDeckStateAt({ plan, atMs: fireMs + 60 * 60000 });
  assert.equal(held.owner.cueId, 'c_visibility');
  assert.equal(held.controller, 'program');
  assert.equal(held.owner.cueKind, 'program');
});

// ── 2. the LIVE-SERVICE ORACLE (design §3.4 cross-check) ────────────────────

function makeOracleDeps() {
  const deck = { playlist: null, palette: null, autopilot: null };
  const view = { mode: null, source: null };
  const deps = {
    loadPlaylist: ({ target, name }) => { if (target.kind === 'deck') deck.playlist = name; },
    setAutopilot: ({ target, state }) => { if (target.kind === 'deck') deck.autopilot = state; },
    setParams: (obj) => {
      if (obj && obj.colorPalette1) {
        const hit = PALETTES.find((p) => p.c1 === obj.colorPalette1.h);
        deck.palette = hit ? hit.id : null;
      }
    },
    setMaster: () => {},
    requestScene: () => { throw new Error('oracle refuses a scene switch'); },
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [],
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

// Boot a THROWAWAY TimelineService with an injected clock pinned at `atMs` and
// report what it actually put on the deck. This is the D5(b) implementation used
// purely as the test ORACLE (the shipped path is the extracted resolver).
async function bootServiceAt(plan, atMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlresolve-'));
  const sceneDir = path.join(dir, 'timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, deck } = makeOracleDeps();
  const svc = new TimelineService({
    scene: 'oracle',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 },
      colorPalettes: PALETTES,
    },
    nowFn: () => atMs,
  });
  await svc.start();
  svc.stop();
  return { svc, deck };
}

test('ORACLE: a service booted AT the instant lands exactly where the resolver says', async () => {
  const plan = makePlan();
  // A representative walk of one festival night, plus the theme night and a gap.
  const probes = [
    ['2026-09-01', '03:00'], ['2026-09-01', '07:00'], ['2026-09-01', '09:00'],
    ['2026-09-01', '19:30'], ['2026-09-01', '20:30'], ['2026-09-01', '23:00'],
    ['2026-09-05', '21:10'], ['2026-09-03', '12:00'],
  ];
  for (const [dateKey, time] of probes) {
    const atMs = dateClockToEpochMs(dateKey, time, TZ);
    const r = resolveDeckStateAt({ plan, atMs });
    const { svc, deck } = await bootServiceAt(plan, atMs);
    const where = `${dateKey} ${time}`;

    // `_98` FIX 6 (report `_95` finding F1, the BOOT-BASELINE CLOBBER) is now
    // FIXED, so this term flips from pin-the-bug to assert-the-fix: a boot inside
    // ANY live owner's window lands on THAT owner's playlist and palette, exactly
    // what the resolver says. (`_95` pinned the opposite — `_catchUp` used to
    // dispatch the restored cue and then reload plan.autopilot.playlist on top of
    // it, invisible on the shipped plan only because every look points at
    // `default`.) There is no clobber term left in this oracle.
    assert.equal(deck.playlist, r.playlist, `deck playlist @ ${where}`);
    if (r.palette !== null) {
      assert.equal(deck.palette, r.palette, `deck palette @ ${where}`);
    }
    // firedToday latch set = exactly the resolver's passed cues.
    assert.deepEqual(
      Object.keys(svc.state.firedToday).sort(), [...r.passedCueIds].sort(),
      `firedToday @ ${where}`,
    );
    // controller: the resolver's plan-derived controller (the service's own
    // 'program' only differs while autopilot is toggled off at runtime).
    assert.equal(svc.state.controller, r.controller, `controller @ ${where}`);
    if (r.controller === 'program') {
      assert.equal(svc.state.activeProgram.cueId, r.restored.cueId, `activeProgram @ ${where}`);
      assert.equal(svc.state.activeProgram.untilMs, r.restored.holdUntilMs, `program untilMs @ ${where}`);
      assert.equal(svc.state.activeProgram.startedAtMs, r.restored.fireMs, `program start @ ${where}`);
    } else {
      assert.equal(svc.state.activeProgram, null, `no program @ ${where}`);
    }
    // The §16.11 deck-ownership window is re-anchored to the TRUE fire time.
    // (A defaultCue reclaim nulls it — exactly what an elapsed window means.)
    const expectedWindow = r.owner.kind === 'cue'
      ? (r.restored ? r.restored.windowUntilMs : null) : null;
    assert.equal(svc._deckWindowUntilMs, expectedWindow, `deck window @ ${where}`);
  }
});

test('ORACLE: dormant out of window — the service drives nothing, resolver agrees', async () => {
  const plan = makePlan();
  const atMs = dateClockToEpochMs('2026-09-20', '21:00', TZ);
  const r = resolveDeckStateAt({ plan, atMs });
  const { svc, deck } = await bootServiceAt(plan, atMs);
  assert.equal(r.inWindow, false);
  assert.equal(deck.playlist, null, 'a dormant plan loads nothing');
  assert.equal(svc.state.controller, 'manual');
});

// ── 3. overview: phases + the resolved ribbon ───────────────────────────────

test('overview days carry PHASES resolved against that day own sun anchors', () => {
  const plan = makePlan();
  const ov = buildOverview(plan, dateClockToEpochMs('2026-09-01', '12:00', TZ));
  assert.equal(ov.days.length, 8);
  for (const day of ov.days) {
    assert.ok(Array.isArray(day.phases), 'each day carries phases');
    assert.deepEqual(day.phases.map((p) => p.name), ['philharmonic', 'party_night'],
      'plan order is preserved (first phase in plan order wins overlaps)');
    for (const p of day.phases) {
      assert.match(p.startLocal, /^\d{2}:\d{2}$/);
      assert.match(p.endLocal, /^\d{2}:\d{2}$/);
    }
  }
  // Sun anchors shift day to day — the bands must not be copies of day 0.
  assert.notEqual(ov.days[0].phases[0].startLocal, ov.days[7].phases[0].startLocal);
});

test('overview days carry the RESOLVED RIBBON (segments) covering 00:00 → 24:00', () => {
  const plan = makePlan();
  const ov = buildOverview(plan, dateClockToEpochMs('2026-09-01', '12:00', TZ));
  for (const day of ov.days) {
    assert.ok(Array.isArray(day.segments) && day.segments.length > 0, 'each day has a ribbon');
    assert.equal(day.segments[0].fromLocal, '00:00', 'the ribbon opens the day');
    assert.equal(day.segments[day.segments.length - 1].toLocal, '24:00', 'and closes it');
    for (let i = 1; i < day.segments.length; i += 1) {
      assert.equal(day.segments[i - 1].toMs, day.segments[i].fromMs, 'no gaps, no overlaps');
    }
    for (const s of day.segments) {
      assert.ok(['cue', 'defaultCue', 'baseline'].includes(s.owner.kind), `owner kind ${s.owner.kind}`);
      assert.ok(
        ['cue', 'hold-expired-baseline', 'default-cue', 'autopilot-baseline'].includes(s.source),
        `source ${s.source}`,
      );
      assert.ok(['program', 'autopilot'].includes(s.controller));
    }
  }
});

test('the ribbon tells the TRUTH of the shipped plan (the gap runs the defaultCue)', () => {
  const plan = makePlan();
  const segs = buildDaySegments({ plan, dateKey: '2026-09-01' });
  const owners = segs.map((s) => `${s.owner.kind}:${s.owner.cueId || s.playlist}`);
  // Night opens on the defaultCue (nothing fired yet today), then the morning
  // cue, then the philharmonic program, then the party look.
  assert.equal(owners[0], 'defaultCue:ambient_pl');
  assert.ok(owners.includes('cue:c_morning'), `expected c_morning, got ${JSON.stringify(owners)}`);
  assert.ok(owners.includes('cue:c_visibility'), `expected c_visibility, got ${JSON.stringify(owners)}`);
  assert.ok(owners.includes('cue:c_party_start'), `expected c_party_start, got ${JSON.stringify(owners)}`);
  // The philharmonic program segment reports controller 'program' while held.
  const phil = segs.find((s) => s.owner.cueId === 'c_visibility');
  assert.equal(phil.controller, 'program');
  // …and the party look is plain autopilot (kind: ambient — the _91 G2 finding).
  const party = segs.find((s) => s.owner.cueId === 'c_party_start');
  assert.equal(party.controller, 'autopilot');
  assert.equal(party.playlist, 'party_pl');
});

test('buildDaySegments rejects a malformed date (fail loud, no "today" fallback)', () => {
  const plan = makePlan();
  assert.throws(() => buildDaySegments({ plan, dateKey: '9/1/2026' }), /YYYY-MM-DD/);
  assert.throws(() => buildDaySegments({ plan, dateKey: undefined }), /YYYY-MM-DD/);
});

// ── B1 (report `_100`): the ribbon must sample HAND-BACK boundaries ──────────
// The e2e ribbon-honesty scenario (C1/C2) caught this: buildDaySegments only
// sampled the instants cues START (fire times + phase edges), never the instants
// they HAND THE DECK BACK. So a segment ran from a cue's fire time all the way to
// the next unrelated boundary, reporting the cue as owning the deck — with its
// playlist and `controller:'program'` — for hours after it had finished. On the
// shipped plan that mis-stated exactly the stretch `_98` FIX 7 gives the ambient
// defaultCue, i.e. the review surface lied about the thing day zoom exists for.

test('B1: an elapsed durationMin window ENDS its ribbon segment', () => {
  const plan = makePlan();
  const segs = buildDaySegments({ plan, dateKey: '2026-09-01' });
  const morning = segs.filter((s) => s.owner.cueId === 'c_morning');
  assert.equal(morning.length, 1, 'c_morning should own exactly one segment');
  // 06:00 + durationMin 120 → the segment must close at 08:00, not run on.
  assert.equal(morning[0].fromLocal, '06:00');
  assert.equal(morning[0].toLocal, '08:00',
    'the ribbon kept an elapsed durationMin cue owning the deck past its window');
  const next = segs[segs.indexOf(morning[0]) + 1];
  assert.equal(next.owner.kind, 'defaultCue', 'the defaultCue must reclaim at the window end');
});

test('B1: a program hold END closes its ribbon segment (the `_98` FIX 7 hand-off is visible)', () => {
  const plan = makePlan();
  const dateKey = '2026-09-01';
  const segs = buildDaySegments({ plan, dateKey });
  const held = segs.filter((s) => s.owner.cueId === 'c_visibility' && s.controller === 'program');
  assert.equal(held.length, 1);
  // hold: { min: 90 } — the program segment may not outlive its own hold.
  const spanMin = (held[0].toMs - held[0].fromMs) / 60000;
  assert.equal(spanMin, 90, `a 90-minute hold is reported as owning ${spanMin} minutes`);
  // …and what follows is the plan's ambient defaultCue, not the dead program.
  const after = segs[segs.indexOf(held[0]) + 1];
  assert.equal(after.owner.kind, 'defaultCue');
  assert.equal(after.playlist, 'ambient_pl');
  assert.notEqual(after.source, 'hold-expired-baseline');
});

test('B1: every ribbon segment agrees with a direct resolver probe at its own start', () => {
  // The strongest statement of the invariant: the ribbon is a LOSSLESS merge of
  // the resolver, so probing the resolver anywhere inside a segment must return
  // that segment's owner. Probes at start, middle and one ms before the end.
  const plan = makePlan();
  for (const dateKey of ['2026-08-30', '2026-09-01', '2026-09-05']) {
    const segs = buildDaySegments({ plan, dateKey });
    for (const s of segs) {
      for (const atMs of [s.fromMs, Math.floor((s.fromMs + s.toMs) / 2), s.toMs - 1]) {
        const r = resolveDeckStateAt({ plan, atMs });
        const ownerId = r.owner === null ? 'dormant' : `${r.owner.kind}:${r.owner.cueId}`;
        assert.equal(ownerId, `${s.owner.kind}:${s.owner.cueId}`,
          `${dateKey} ${s.fromLocal}-${s.toLocal}: the ribbon claims ${s.owner.kind}:${s.owner.cueId} `
          + `but the resolver says ${ownerId} at ${new Date(atMs).toISOString()}`);
        assert.equal(r.playlist, s.playlist);
        assert.equal(r.controller, s.controller);
      }
    }
  }
});
