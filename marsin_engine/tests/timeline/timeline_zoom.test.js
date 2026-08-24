/*
 * timeline_zoom.test.js — EVENT ZOOM (report _94 §3, slice S2): scoped operator
 * takeovers (`perform` / `travel`), POST /timeline/travel, the `zoom` broadcast
 * field, and the D3 pending-program DEFERRAL.
 *
 * The load-bearing guarantee proved here is the NEGATIVE one: a PLAIN (bodyless)
 * takeover keeps today's I2 30 s pending-program auto-start BYTE-IDENTICAL. The
 * deferral is scoped strictly to a zoom lease.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';
import { dateClockToEpochMs } from '../../lib/timeline/triggers.js';

// The service is chatty on every dispatch; a loud suite trips the Windows
// node:test worker-IPC flake (_91 §6.1).
const REAL_LOG = console.log;
const REAL_WARN = console.warn;
console.log = () => {};
console.warn = () => {};
process.on('exit', () => { console.log = REAL_LOG; console.warn = REAL_WARN; });

const TZ = 'America/Los_Angeles';
const PALETTES = [{ id: 'deep_sea', c1: 0.62, c2: 0.48 }];
// 10 s before the 20:30 program cue, on festival day 1.
const T0 = dateClockToEpochMs('2026-09-02', '20:29', TZ) + 50000;

function makePlan() {
  return validateShowPlan({
    schemaVersion: 2,
    name: 'zoom_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: TZ, elevationM: 1190 },
    festival: { startDate: '2026-09-01', days: 8 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {
      party_night: { start: { sun: 'sunset', offsetMin: 120 }, end: { sun: 'sunrise', offsetMin: -60 } },
    },
    looks: {
      evening: { playlist: 'evening_pl' },
      show: { playlist: 'show_pl', palette: 'deep_sea' },
      ambient: { playlist: 'ambient_pl' },
      morning: { playlist: 'morning_pl' },
    },
    cues: [
      {
        id: 'c_morning',
        label: 'Morning',
        kind: 'ambient',
        trigger: { type: 'clock', at: '07:00' },
        action: { type: 'look', look: 'morning' },
        durationMin: 60,
      },
      {
        id: 'c_evening',
        label: 'Evening',
        kind: 'ambient',
        trigger: { type: 'clock', at: '19:00' },
        action: { type: 'look', look: 'evening' },
      },
      {
        id: 'c_show',
        label: 'Scheduled show',
        kind: 'program',
        trigger: { type: 'clock', at: '20:30' },
        action: { type: 'look', look: 'show' },
        hold: { min: 90 },
      },
    ],
    defaultCue: { label: 'Ambient', action: { type: 'look', look: 'ambient' } },
  });
}

function makeDeps() {
  const deck = { playlist: null, palette: null, autopilot: null };
  const calls = { loadPlaylist: [], setAutopilot: [], forceDeckView: [], releaseDeckView: [] };
  const view = { mode: null, source: null };
  const deps = {
    loadPlaylist: ({ target, name }) => {
      calls.loadPlaylist.push(name);
      if (target.kind === 'deck') deck.playlist = name;
    },
    setAutopilot: ({ target, state }) => {
      calls.setAutopilot.push(state);
      if (target.kind === 'deck') deck.autopilot = state;
    },
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
    listPlaylists: () => [],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    setDeckHue: () => {},
    forceDeckView: () => { calls.forceDeckView.push(true); view.mode = 'deck'; view.source = 'plan'; },
    releaseDeckView: () => {
      calls.releaseDeckView.push(true);
      if (view.source === 'plan') { view.mode = null; view.source = null; }
    },
    getViewOverrideMode: () => view.mode,
  };
  return { deps, deck, calls };
}

async function setup({ startAt } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlzoom-'));
  const sceneDir = path.join(dir, 'timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const plan = makePlan();
  saveShowPlan(plan, path.join(sceneDir, 'zoom_plan.yaml'));

  const { deps, deck, calls } = makeDeps();
  const broadcasts = [];
  const clock = { now: startAt !== undefined ? startAt : T0 };
  const svc = new TimelineService({
    scene: 'zoom_scene',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: (s) => broadcasts.push(s),
    config: {
      enabled: true, activePlan: 'zoom_plan', tickMs: 1000,
      programLeaseSec: 30, operatorLeaseSec: 120,
      mood: { key: 'audioParty', partyThreshold: 0.5 },
      colorPalettes: PALETTES,
    },
    nowFn: () => clock.now,
  });
  await svc.start();
  svc.stop();   // one manual tick at a time — no wall-clock interval
  return {
    svc, deck, calls, broadcasts, clock, sceneDir, stateDir, plan,
    advance: (ms) => { clock.now += ms; },
  };
}

// ── plain takeover: BYTE-IDENTICAL ──────────────────────────────────────────

test('a BODYLESS takeover is exactly today plain takeover (no scope, no zoom)', async () => {
  const { svc, clock } = await setup();
  const r = svc.takeover();
  assert.equal(r.ok, true);
  assert.equal(r.operatorLease.expiresAtMs, clock.now + 120000);
  assert.equal(r.zoom, null);
  assert.deepEqual(Object.keys(svc.state.operatorLease), ['expiresAtMs'],
    'the persisted lease grows NO new keys for a plain takeover');
  assert.equal(svc.state.mode, 'overridden');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.getState().zoom, null);
  // The event-log line is unchanged.
  const lc = svc.recentFires.filter((e) => e.reason === 'takeover');
  assert.equal(lc[lc.length - 1].label, 'Operator takeover (lease armed)');
});

test('takeover({}) — what a BODYLESS POST yields — equals takeover() exactly', async () => {
  // The route now runs readBody, which turns an empty body into `{}`. That must
  // be indistinguishable from the old bodyless call.
  const a = await setup();
  const b = await setup();
  const ra = a.svc.takeover();
  const rb = b.svc.takeover({});
  assert.deepEqual(rb, ra);
  assert.deepEqual(b.svc.state.operatorLease, a.svc.state.operatorLease);
  assert.deepEqual(
    b.svc.recentFires.map((e) => [e.kind, e.reason, e.label]),
    a.svc.recentFires.map((e) => [e.kind, e.reason, e.label]),
  );
});

test('a plain takeover STILL auto-starts a due program after programLeaseSec (I2)', async () => {
  const { svc, advance } = await setup();
  svc.takeover();
  advance(15000);                      // 20:30:05 — the program comes due
  await svc._tick();
  assert.equal(svc.state.pendingProgram.cueId, 'c_show', 'lease armed, not fired');
  assert.equal(svc.state.controller, 'manual');
  const armed = svc.recentFires.filter((e) => e.reason === 'lease-armed');
  assert.equal(armed.length, 1, 'the shipped "Show pending" line still fires');
  assert.match(armed[0].label, /^Show pending: Scheduled show \(auto-starts in \d+s\)$/);

  advance(35000);                      // past the 30 s pending lease
  await svc._tick();
  assert.equal(svc.state.pendingProgram, null);
  assert.equal(svc.state.activeProgram.cueId, 'c_show', 'the show goes on');
  assert.equal(svc.state.controller, 'program');
});

// ── scoped takeover: PERFORM ────────────────────────────────────────────────

test('takeover {scope:"perform", cueId} tags the lease and surfaces `zoom`', async () => {
  const { svc, broadcasts } = await setup();
  const r = svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  assert.equal(r.zoom.scope, 'perform');
  assert.equal(r.zoom.cueId, 'c_evening');
  assert.equal(r.zoom.label, 'Evening');
  const st = svc.getState();
  assert.equal(st.zoom.scope, 'perform');
  assert.equal(st.zoom.cueId, 'c_evening');
  assert.equal(st.zoom.pendingDeferred, null);
  // The takeover itself is unchanged: still mode overridden + a normal lease.
  assert.equal(st.mode, 'overridden');
  assert.equal(st.controller, 'manual');
  assert.equal(st.planActive, false);
  assert.equal(typeof st.operatorLease.expiresAtMs, 'number');
  // Every client sees it — the zoom rides the normal timelineState broadcast.
  assert.equal(broadcasts[broadcasts.length - 1].zoom.scope, 'perform');
});

test('takeover rejects an unknown scope / an unknown cueId (fail loud)', async () => {
  const { svc } = await setup();
  assert.throws(() => svc.takeover({ scope: 'travel' }), /scope must be "perform"/);
  assert.throws(() => svc.takeover({ scope: 'nope' }), /scope must be "perform"/);
  assert.throws(() => svc.takeover({ scope: 'perform', cueId: 'c_nope' }), /not in active plan/);
  assert.equal(svc.state.mode, 'armed', 'a rejected takeover arms nothing');
});

test('a bodyless REFRESH under a live zoom keeps the scope (it is not a downgrade)', async () => {
  const { svc, advance } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  advance(20000);
  const r = svc.takeover();            // the deck touch-takeover hook re-calls it
  assert.equal(r.zoom.scope, 'perform');
  assert.equal(r.zoom.cueId, 'c_evening');
  assert.equal(svc.state.operatorLease.expiresAtMs, T0 + 20000 + 120000, 'expiry refreshed');
});

test('out of the festival window a scoped takeover arms nothing', async () => {
  const { svc } = await setup({ startAt: dateClockToEpochMs('2026-09-20', '21:00', TZ) });
  const r = svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  assert.equal(r.operatorLease, null);
  assert.equal(svc.getState().zoom, null);
});

// ── D3: the pending-program DEFERRAL ────────────────────────────────────────

test('D3: a program due during a PERFORM zoom is DEFERRED, never auto-started', async () => {
  const { svc, advance, deck } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  const deckBefore = deck.playlist;

  advance(15000);
  await svc._tick();
  assert.equal(svc.state.pendingProgram.cueId, 'c_show', 'the lease still ARMS');
  const deferred = svc.recentFires.filter((e) => e.reason === 'lease-deferred');
  assert.equal(deferred.length, 1);
  assert.equal(deferred[0].label, 'Show deferred: Scheduled show (starts when you exit the zoom)');
  assert.equal(svc.recentFires.filter((e) => e.reason === 'lease-armed').length, 0,
    'the misleading "auto-starts in Ns" line is NOT logged under a zoom');

  // Well past the 30 s pending lease — under a plain takeover this would have
  // seized the controller. Under a zoom it must not.
  for (const step of [20000, 20000, 20000]) {
    advance(step);
    await svc._tick();
  }
  assert.equal(svc.state.activeProgram, null, 'the program never seized the deck');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.state.pendingProgram.cueId, 'c_show', 'deferred, NOT dismissed');
  assert.equal(deck.playlist, deckBefore, 'the deck stayed where the performer left it');

  // …and it is surfaced for the banner, with the ENABLE affordance intact.
  const zoom = svc.getState().zoom;
  assert.equal(zoom.scope, 'perform');
  assert.equal(zoom.pendingDeferred.cueId, 'c_show');
  assert.equal(zoom.pendingDeferred.label, 'Scheduled show');
  assert.match(zoom.pendingDeferred.dueAtLocal, /^\d{2}:\d{2}$/);
});

test('D3: a deferred show is never DISMISSED — ENABLE still starts it now', async () => {
  const { svc, advance, deck } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  advance(15000);
  await svc._tick();
  advance(60000);
  await svc._tick();
  assert.equal(svc.state.activeProgram, null);

  const r = await svc.enableProgram();
  assert.equal(r.ok, true);
  assert.equal(svc.state.activeProgram.cueId, 'c_show');
  assert.equal(svc.state.controller, 'program');
  assert.equal(deck.playlist, 'show_pl');
  assert.equal(svc.getState().zoom, null, 'starting the show exits the zoom (lease cleared)');
});

test('D3: exiting the zoom hands the deck to the program via catchUp', async () => {
  const { svc, advance, deck } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  advance(15000);
  await svc._tick();
  advance(60000);
  await svc._tick();
  assert.equal(svc.state.activeProgram, null, 'still deferred');

  await svc.resume();                  // returning to the TIMELINE tab
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.activeProgram.cueId, 'c_show', 'catchUp fired the deferred show');
  assert.equal(svc.state.controller, 'program');
  assert.equal(deck.playlist, 'show_pl');
});

// ── TIME TRAVEL ─────────────────────────────────────────────────────────────

test('travel {date,time} enters a travel zoom and puts the resolved look on the deck', async () => {
  const { svc, deck } = await setup();
  const r = await svc.travel({ date: '2026-09-03', time: '07:30' });
  assert.equal(r.ok, true);
  assert.equal(r.zoom.scope, 'travel');
  assert.equal(r.zoom.targetDate, '2026-09-03');
  assert.equal(r.zoom.targetLocal, '07:30');
  assert.equal(r.resolved.owner.cueId, 'c_morning');
  assert.equal(r.resolved.playlist, 'morning_pl');
  assert.equal(deck.playlist, 'morning_pl', 'the REAL deck plays the traveled state');
  assert.equal(svc.state.mode, 'overridden', 'travel is a scoped takeover');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.getState().zoom.scope, 'travel');
});

test('travel leaves the LIVE plan bookkeeping completely untouched', async () => {
  const { svc } = await setup();
  const firedBefore = JSON.stringify(svc.state.firedToday);
  const windowCueBefore = svc._deckWindowCueId;
  const windowUntilBefore = svc._deckWindowUntilMs;
  const lastFiredBefore = svc.state.lastFiredCueId;
  const firesBefore = svc.recentFires.filter((e) => e.kind === 'fire').length;

  await svc.travel({ date: '2026-09-05', time: '21:00' });

  assert.equal(JSON.stringify(svc.state.firedToday), firedBefore,
    'no firedToday latch for the simulated day — the real night still happens');
  assert.equal(svc.state.activeProgram, null, 'no activeProgram is invented');
  assert.equal(svc._deckWindowCueId, windowCueBefore, 'the deck-ownership latch is untouched');
  assert.equal(svc._deckWindowUntilMs, windowUntilBefore);
  assert.equal(svc.state.lastFiredCueId, lastFiredBefore, 'a travel is not a cue fire');
  assert.equal(svc.recentFires.filter((e) => e.kind === 'fire').length, firesBefore,
    'a travel logs a LIFECYCLE entry, never a fire');
  const travels = svc.recentFires.filter((e) => e.reason === 'travel');
  assert.equal(travels.length, 1);
  assert.equal(travels[0].kind, 'lifecycle');
});

test('travel to a defaultCue gap resolves to the default cue, not a stale look', async () => {
  const { svc, deck } = await setup();
  const r = await svc.travel({ date: '2026-09-03', time: '10:00' }); // c_morning window elapsed
  assert.equal(r.resolved.owner.kind, 'defaultCue');
  assert.equal(deck.playlist, 'ambient_pl');
});

test('travel refuses an out-of-window / unresolvable target (fail loud, 400)', async () => {
  const { svc } = await setup();
  await assert.rejects(svc.travel({ date: '2026-09-20', time: '21:00' }), /outside the festival window/);
  await assert.rejects(svc.travel({ date: '2026-09-03', time: '25:00' }), /time must be HH:MM/);
  await assert.rejects(svc.travel({ date: '09/03/2026', time: '10:00' }), /date must be YYYY-MM-DD/);
  await assert.rejects(svc.travel({}), /requires \{ date, time \}/);
  assert.equal(svc.state.mode, 'armed', 'a refused travel arms no lease');
});

test('travel {cueId} targets that cue fire instant; retarget is idempotent', async () => {
  const { svc, deck } = await setup();
  const a = await svc.travel({ cueId: 'c_show', date: '2026-09-04' });
  assert.equal(a.zoom.targetLocal, '20:30');
  assert.equal(a.resolved.owner.cueId, 'c_show');
  assert.equal(a.resolved.controller, 'program', 'inside its own 90 min hold');
  assert.equal(deck.playlist, 'show_pl');

  const b = await svc.travel({ cueId: 'c_evening' });      // date defaults to the current target day
  assert.equal(b.zoom.targetDate, '2026-09-04');
  assert.equal(b.zoom.targetLocal, '19:00');
  assert.equal(deck.playlist, 'evening_pl');
  assert.equal(svc.getState().zoom.scope, 'travel', 'still ONE zoom session, retargeted');

  await assert.rejects(svc.travel({ cueId: 'c_nope' }), /no resolvable time/);
});

test('travel {cueId,leadSeconds} lands exactly before the cue and next steps into it', async () => {
  const { svc, deck } = await setup();
  const exact = svc.resolveAt({ cueId: 'c_show', date: '2026-09-04' });
  const before = await svc.travel({
    cueId: 'c_show',
    date: '2026-09-04',
    leadSeconds: 10,
  });

  assert.equal(before.zoom.targetMs, exact.atMs - 10000);
  assert.equal(before.zoom.targetLeadSec, 10);
  assert.equal(before.zoom.targetCueLabel, 'Scheduled show');
  assert.notEqual(before.resolved.owner.cueId, 'c_show');
  assert.notEqual(deck.playlist, 'show_pl', 'pre-roll shows the deck before the cue');

  const atCue = await svc.travel({ step: 'next' });
  assert.equal(atCue.resolved.owner.cueId, 'c_show');
  assert.equal(deck.playlist, 'show_pl', 'next-event applies the event snapshot');
});

test('travel leadSeconds is cue-only and range checked', async () => {
  const { svc } = await setup();
  await assert.rejects(
    svc.travel({ date: '2026-09-04', time: '20:30', leadSeconds: 10 }),
    /only valid with \{ cueId \}/,
  );
  await assert.rejects(
    svc.travel({ cueId: 'c_show', date: '2026-09-04', leadSeconds: 0 }),
    /integer from 1 to 300/,
  );
  await assert.rejects(
    svc.travel({ cueId: 'c_show', date: '2026-09-04', leadSeconds: 301 }),
    /integer from 1 to 300/,
  );
});

test('travel {cueId} targets the start of a phase-gated Party Window', async () => {
  const { svc, plan } = await setup();
  const partyPlan = validateShowPlan({
    ...plan,
    phases: {
      ...plan.phases,
      pw_c_party: { start: { clock: '23:00' }, end: { clock: '02:00' } },
    },
    cues: [
      ...plan.cues,
      {
        id: 'pwb_c_party',
        label: 'Party Window baseline',
        kind: 'ambient',
        trigger: { type: 'phase', phase: 'pw_c_party' },
        action: { type: 'look', look: 'ambient' },
        days: 'all',
      },
      {
        id: 'c_party',
        label: 'Party 1',
        kind: 'mood',
        trigger: {
          type: 'mood', from: 'calm', to: 'party', minDwellSec: 30,
          cooldownSec: 120, whenPhase: 'pw_c_party',
        },
        action: { type: 'look', look: 'evening' },
        durationMin: 12,
        days: 'all',
      },
    ],
  });
  await svc.savePlan(partyPlan);

  const result = await svc.travel({ cueId: 'c_party', date: '2026-09-04' });
  assert.equal(result.zoom.cueId, 'c_party');
  assert.equal(result.zoom.targetLocal, '23:00');
  assert.equal(result.zoom.targetDate, '2026-09-04');
});

test('travel {step} walks the day events and fails loud at the ends', async () => {
  const { svc } = await setup();
  await svc.travel({ cueId: 'c_evening', date: '2026-09-04' });   // 19:00
  const next = await svc.travel({ step: 'next' });
  assert.equal(next.zoom.cueId, 'c_show');
  assert.equal(next.zoom.targetLocal, '20:30');
  const back = await svc.travel({ step: 'prev' });
  assert.equal(back.zoom.cueId, 'c_evening');
  const first = await svc.travel({ step: 'prev' });
  assert.equal(first.zoom.cueId, 'c_morning');
  await assert.rejects(svc.travel({ step: 'prev' }), /no prev event on 2026-09-04/);
  await assert.rejects(svc.travel({ step: 'sideways' }), /step must be "prev" or "next"/);
});

test('step without an active travel is refused (no implicit "now" target)', async () => {
  const { svc } = await setup();
  await assert.rejects(svc.travel({ step: 'next' }), /requires an active time-travel target/);
});

// ── the read-only peek ──────────────────────────────────────────────────────

test('resolveAt is READ-ONLY — no lease, no mode change, no deck write', async () => {
  const { svc, deck } = await setup();
  const deckBefore = deck.playlist;
  const modeBefore = svc.state.mode;
  const r = svc.resolveAt({ date: '2026-09-03', time: '07:30' });
  assert.equal(r.owner.cueId, 'c_morning');
  assert.equal(r.playlist, 'morning_pl');
  assert.equal(r.atLocal, '07:30');
  assert.equal(r.date, '2026-09-03');
  assert.equal(r.tz, TZ);
  assert.equal(deck.playlist, deckBefore, 'nothing was dispatched');
  assert.equal(svc.state.mode, modeBefore);
  assert.equal(svc.state.operatorLease, null);
  assert.equal(svc.getState().zoom, null);
});

test('resolveAt refuses an out-of-window target', async () => {
  const { svc } = await setup();
  assert.throws(() => svc.resolveAt({ date: '2026-09-20', time: '21:00' }),
    /outside the festival window/);
});

// ── every exit path clears the zoom (the "never stuck" invariant) ───────────

test('EXIT: resume() clears the zoom and resumes the plan at now', async () => {
  const { svc } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  assert.ok(svc.getState().zoom);
  await svc.resume();
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.mode, 'armed');
  assert.equal(svc.state.operatorLease, null);
  assert.equal(svc.state.controller, 'autopilot');
});

test('EXIT: lease expiry (presence pings stopped) auto-releases the zoom', async () => {
  const { svc, advance } = await setup();
  await svc.travel({ date: '2026-09-03', time: '07:30' });
  advance(121000);                      // operatorLeaseSec = 120
  await svc._tick();
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.mode, 'armed');
  assert.equal(svc.state.operatorLease, null);
  // catchUp resumed the plan AT NOW — 20:31:51 is inside c_show's hold, so the
  // program is the correct owner. The point is that the rig is back on the plan.
  assert.equal(svc.getState().planActive, true);
  assert.equal(svc.state.controller, 'program');
  assert.equal(svc.state.activeProgram.cueId, 'c_show');
});

test('EXIT: activity() pings keep a zoom alive across the lease window', async () => {
  const { svc, advance } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  for (let i = 0; i < 5; i += 1) {
    advance(30000);
    svc.activity();
    await svc._tick();
    assert.ok(svc.getState().zoom, `zoom survived ping ${i}`);
    assert.equal(svc.getState().zoom.scope, 'perform', 'activity() must not drop the scope');
  }
});

test('EXIT: autopilot OFF clears the zoom', async () => {
  const { svc } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  await svc.setAutopilotEnabled(false);
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.operatorLease, null);
});

test('EXIT: saving over the ACTIVE plan exits the zoom (inherited catchUp behavior)', async () => {
  const { svc, plan } = await setup();
  await svc.travel({ date: '2026-09-03', time: '07:30' });
  assert.ok(svc.getState().zoom);
  await svc.savePlan({ ...plan, cues: plan.cues.map((c) => ({ ...c })) });
  assert.equal(svc.getState().zoom, null, 'editing the plan while zoomed exits the zoom');
  assert.equal(svc.state.mode, 'armed');
});

test('EXIT: activating another plan clears the zoom', async () => {
  const { svc, plan, sceneDir } = await setup();
  saveShowPlan({ ...plan, name: 'other_plan' }, path.join(sceneDir, 'other_plan.yaml'));
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  await svc.activatePlan('other_plan');
  assert.equal(svc.getState().zoom, null);
});

test('EXIT: an engine RESTART boots into the plan-at-now (zoom is runtime-only)', async () => {
  const { svc, sceneDir, stateDir, clock } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  assert.ok(svc.getState().zoom);
  assert.equal(svc.state.operatorLease.scope, 'perform');

  // A second service over the SAME persisted state = the restart.
  const { deps } = makeDeps();
  const rebooted = new TimelineService({
    scene: 'zoom_scene',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'zoom_plan', tickMs: 1000,
      programLeaseSec: 30, operatorLeaseSec: 120,
      mood: { key: 'audioParty', partyThreshold: 0.5 },
      colorPalettes: PALETTES,
    },
    nowFn: () => clock.now,
  });
  await rebooted.start();
  rebooted.stop();
  assert.equal(rebooted.getState().zoom, null, 'the ship wakes up in the present, always');
  assert.equal(rebooted.state.mode, 'armed');
  assert.equal(rebooted.state.operatorLease, null);
});

test('EXIT: the festival window closing ends a PERFORM zoom (nothing is live)', async () => {
  const { svc, clock } = await setup();
  svc.takeover({ scope: 'perform', cueId: 'c_evening' });
  clock.now = dateClockToEpochMs('2026-09-20', '21:00', TZ);
  await svc._tick();
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.operatorLease, null);
  assert.equal(svc.state.mode, 'armed');
});

// ── rehearsal: time travel while the plan is DORMANT (_94 §3.3) ─────────────

test('REHEARSAL: travel works while the plan is dormant, and survives the tick', async () => {
  // The bench case: gate day has not arrived, the plan is asleep (_91 §16).
  const { svc, deck, advance } = await setup({ startAt: dateClockToEpochMs('2026-08-20', '14:00', TZ) });
  assert.equal(svc.getState().inFestivalWindow, false);
  assert.equal(deck.playlist, null, 'a dormant plan drives nothing on boot');

  const r = await svc.travel({ date: '2026-09-03', time: '19:30' });
  assert.equal(r.zoom.scope, 'travel');
  assert.equal(deck.playlist, 'evening_pl', 'the rehearsal look is on the real deck');

  advance(1000);
  await svc._tick();
  assert.equal(svc.getState().zoom.scope, 'travel', 'the dormancy gate must not tear it down');
  assert.equal(deck.playlist, 'evening_pl', 'and must not clobber the rehearsal look');
  assert.equal(svc.state.activeProgram, null, 'the PLAN still owns nothing');
  assert.equal(svc.state.controller, 'manual');
});

test('NAMED REHEARSAL: resolves, travels, and steps without activating the selected plan', async () => {
  const { svc, plan, sceneDir, deck } = await setup();
  const rehearsal = {
    ...plan,
    name: 'selected_plan',
    looks: {
      ...plan.looks,
      evening: { ...plan.looks.evening, playlist: 'selected_evening' },
      show: { ...plan.looks.show, playlist: 'selected_show' },
    },
  };
  saveShowPlan(rehearsal, path.join(sceneDir, 'selected_plan.yaml'));

  const preview = svc.resolveAt({
    cueId: 'c_evening',
    date: '2026-09-02',
    planName: 'selected_plan',
  });
  assert.equal(preview.playlist, 'selected_evening');
  assert.equal(preview.rehearsingPlan, 'selected_plan');
  assert.equal(svc.activePlan, 'zoom_plan', 'preview must not activate the selected plan');

  const travelled = await svc.travel({
    cueId: 'c_evening',
    date: '2026-09-02',
    planName: 'selected_plan',
  });
  assert.equal(deck.playlist, 'selected_evening');
  assert.equal(travelled.rehearsingPlan, 'selected_plan');
  assert.equal(travelled.zoom.rehearsingPlan, 'selected_plan');
  assert.equal(svc.activePlan, 'zoom_plan', 'travel must not activate the selected plan');

  const stepped = await svc.travel({ step: 'next' });
  assert.equal(deck.playlist, 'selected_show');
  assert.equal(stepped.rehearsingPlan, 'selected_plan');
  assert.equal(stepped.zoom.rehearsingPlan, 'selected_plan');
  assert.equal(svc.activePlan, 'zoom_plan', 'step must stay inside named rehearsal');
});

test('REHEARSAL: exiting a dormant travel returns the plan to dormancy', async () => {
  const { svc } = await setup({ startAt: dateClockToEpochMs('2026-08-20', '14:00', TZ) });
  await svc.travel({ date: '2026-09-03', time: '19:30' });
  await svc.resume();
  assert.equal(svc.getState().zoom, null);
  assert.equal(svc.state.mode, 'armed');
  assert.equal(svc.state.controller, 'manual');
  assert.equal(svc.getState().inFestivalWindow, false);
  assert.equal(svc.getState().planActive, false);
});

test('REHEARSAL: a dormant travel lease STILL expires — never stuck', async () => {
  const { svc, advance } = await setup({ startAt: dateClockToEpochMs('2026-08-20', '14:00', TZ) });
  await svc.travel({ date: '2026-09-03', time: '19:30' });
  advance(121000);
  await svc._tick();
  assert.equal(svc.getState().zoom, null, 'the lease expired even out of window');
  assert.equal(svc.state.mode, 'armed');
  assert.equal(svc.state.operatorLease, null);
});
