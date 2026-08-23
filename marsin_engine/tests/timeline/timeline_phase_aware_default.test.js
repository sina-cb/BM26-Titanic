/*
 * timeline_phase_aware_default.test.js — G1 (docs/77 §5.1 / §11): phase-aware
 * `defaultCue` resolution.
 *
 * LEGACY (docs/38 §16.11) always falls to the plan's single static
 * `defaultCue` on release (event/program end, hold expiry, durationMin
 * elapse, no owning cue) regardless of the time of night. With
 * `defaultCue.phaseAware: true` authored, the service instead resolves the
 * cue that OWNS the CURRENT moment via the SAME selection core `_catchUp`
 * uses on boot/resume (`resolveDeckStateAt`, resolve_deck_state.js) and
 * re-applies THAT cue — the authored `defaultCue` stays the loud last resort
 * for when no cue owns the moment.
 *
 * BACKWARD COMPATIBILITY IS P0: every test in the "legacy" group proves a
 * plan without the flag behaves bit-for-bit like today.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TimelineService } from '../../lib/timeline/timeline_service.js';
import { saveShowPlan, validateShowPlan } from '../../lib/timeline/show_plan.js';

// See timeline_deck_release_default_cue.test.js for why this mute exists: run
// alone the service's per-tick console chatter trips the Windows node:test
// worker-IPC flake ("Unable to deserialize cloned data").
const _origLog = console.log;
console.log = () => {};
process.on('exit', () => { console.log = _origLog; });

// ── time helpers ───────────────────────────────────────────────────────────
// All plans below use tz 'America/Los_Angeles' (PDT, UTC-7 in late July/early
// August). `localMs(day, h, m)` returns the epoch ms for wall-clock h:m PT on
// July `day` 2026 — Date.UTC() normalizes an overflowing hour/day component
// (h+7 >= 24) into the next UTC calendar day for free, so day 31 h:m PT is
// exactly "the small hours after the night of July 30" the deep-night blocks
// (docs/77 §3.2) are authored against.
function localMs(day, h, m) {
  return Date.UTC(2026, 7, day, h + 7, m, 0);
}

// ── service test scaffolding (mirrors timeline_deck_release_default_cue.test.js) ──

function makeDeps() {
  const calls = { loadPlaylist: [], setAutopilot: [], setParams: [], forceDeckView: [], releaseDeckView: [] };
  const assertTarget = (t) => {
    if (!t || (t.kind !== 'deck' && t.kind !== 'mixer')) {
      throw new Error(`dep target must carry kind deck|mixer, got ${JSON.stringify(t)}`);
    }
  };
  const viewState = { mode: null, source: null };
  const deps = {
    loadPlaylist: (a) => {
      assertTarget(a.target);
      if (calls.failPlaylist && calls.failPlaylist === a.name) {
        throw new Error(`simulated dep failure loading "${a.name}"`);
      }
      calls.loadPlaylist.push(a);
    },
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
    name: 'phase_aware_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {},
    cues: [],
    ...extra,
  };
}

function setup(plan, { now } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlphase-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(plan, path.join(sceneDir, `${plan.name}.yaml`));
  const { deps, calls } = makeDeps();
  let nowMs = now !== undefined ? now : localMs(30, 12, 0);
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps,
    broadcast: () => {},
    config: {
      enabled: true, activePlan: plan.name, tickMs: 1000,
      mood: { key: 'audioParty', partyThreshold: 0.5 }, colorPalettes: [],
    },
    nowFn: () => nowMs,
  });
  return { svc, deps, calls, setNow: (m) => { nowMs = m; } };
}

function names(calls) { return calls.loadPlaylist.map((c) => c.name); }

// ── SCHEMA: defaultCue.phaseAware (show_plan.js validateDefaultCue) ──────────

function minimalPlan(defaultCueOverrides) {
  return {
    schemaVersion: 1,
    name: 'phase_schema_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: {},
    cues: [],
    defaultCue: { label: 'Default', action: { type: 'playlist', name: 'default_pl' }, ...defaultCueOverrides },
  };
}

test('schema: defaultCue.phaseAware accepts true', () => {
  const out = validateShowPlan(minimalPlan({ phaseAware: true }));
  assert.equal(out.defaultCue.phaseAware, true);
});

test('schema: defaultCue.phaseAware accepts false', () => {
  const out = validateShowPlan(minimalPlan({ phaseAware: false }));
  assert.equal(out.defaultCue.phaseAware, false);
});

test('schema: defaultCue.phaseAware rejects a non-boolean loudly', () => {
  assert.throws(
    () => validateShowPlan(minimalPlan({ phaseAware: 'yes' })),
    /phaseAware/,
  );
});

test('schema: defaultCue.phaseAware absent → key not present in normalized plan', () => {
  const out = validateShowPlan(minimalPlan({}));
  assert.equal(Object.prototype.hasOwnProperty.call(out.defaultCue, 'phaseAware'), false);
});

// ── LEGACY (no flag): bit-for-bit unchanged behavior ──────────────────────────

test('legacy: program hold expiry lands on the static defaultCue, not the owning ambient cue', async () => {
  const plan = basePlan({
    // NO phaseAware — legacy plan.
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' } },
    cues: [
      { id: 'c_a', label: 'A', kind: 'ambient', trigger: { type: 'clock', at: '20:00' }, action: { type: 'playlist', name: 'a_pl' } },
      {
        id: 'c_p', label: 'P', kind: 'program', trigger: { type: 'clock', at: '21:00' },
        hold: { min: 30 }, action: { type: 'playlist', name: 'p_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 19, 0) });
  await svc.start();

  setNow(localMs(30, 20, 0));
  await svc._tick();
  assert.ok(names(calls).includes('a_pl'), 'ambient cue A fired at 20:00');
  calls.loadPlaylist.length = 0;

  setNow(localMs(30, 21, 0));
  await svc._tick();
  assert.ok(names(calls).includes('p_pl'), 'program cue P fired at 21:00');
  calls.loadPlaylist.length = 0;

  // 21:30 — P's 30-min hold expires. LEGACY behavior: the deck falls to the
  // single static defaultCue, NOT back to the phase-appropriate A.
  setNow(localMs(30, 21, 30));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), ['default_pl'], 'legacy: hold expiry lands on the static default, not on A');
  assert.equal(svc._deckWindowCueId, null, 'legacy: no ownership latch after the default cue fills');
  assert.equal(svc._defaultCueActive, true);
});

// ── FLAG ON: hold-expiry resumes the cue owning "now" ─────────────────────────

test('phaseAware: program hold expiry (event ending 01:30) resumes the deep-night block owning 01:10, not the static default', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      {
        id: 'c_block_uv', label: 'UV block', kind: 'ambient',
        trigger: { type: 'clock', at: '01:10' }, action: { type: 'playlist', name: 'uv_pl' },
      },
      {
        id: 'c_event', label: 'Event', kind: 'program', trigger: { type: 'manual' },
        hold: { min: 20 }, action: { type: 'playlist', name: 'event_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(31, 0, 50) });
  await svc.start();

  // 01:10 — the UV block fires on its own clock trigger and owns the deck.
  setNow(localMs(31, 1, 10));
  await svc._tick();
  assert.ok(names(calls).includes('uv_pl'), 'UV block fired at 01:10');
  assert.equal(svc._deckWindowCueId, 'c_block_uv');
  calls.loadPlaylist.length = 0;

  // 01:10 — the operator (or a placeholder slot) fires the EVENT, preempting
  // the block for a 20-min hold that ends exactly at 01:30 (docs/77 §5.1's
  // own example).
  await svc.fireCue('c_event');
  assert.ok(names(calls).includes('event_pl'), 'event preempted the block');
  calls.loadPlaylist.length = 0;

  // 01:30 — the event's hold expires. Phase-aware resolution must land back on
  // the UV block (the cue that owns 01:30), not the static defaultCue.
  setNow(localMs(31, 1, 30));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), ['uv_pl'], 'phase-aware: hold expiry resumes the block owning 01:30');
  assert.equal(svc._deckWindowCueId, 'c_block_uv', 'ownership latch mirrors the resolved owner');
  const fire = svc.recentFires[svc.recentFires.length - 1];
  assert.equal(fire.cueId, 'c_block_uv');
  assert.equal(fire.reason, 'hold-expired');
});

// ── FLAG ON: durationMin window elapse (displaced-owner OR phase resolution) ──

test('phaseAware: durationMin window elapse returns the deck to the displaced ambient block', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_b', label: 'B', kind: 'ambient', trigger: { type: 'clock', at: '22:00' }, action: { type: 'playlist', name: 'b_pl' } },
      {
        id: 'c_c', label: 'C', kind: 'ambient', trigger: { type: 'clock', at: '22:30' },
        durationMin: 10, action: { type: 'playlist', name: 'c_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 21, 50) });
  await svc.start();

  setNow(localMs(30, 22, 0));
  await svc._tick();
  assert.ok(names(calls).includes('b_pl'));
  calls.loadPlaylist.length = 0;

  setNow(localMs(30, 22, 30));
  await svc._tick();
  assert.ok(names(calls).includes('c_pl'), 'the timed cue punches through the open-ended block');
  calls.loadPlaylist.length = 0;

  // 22:41 — C's 10-min window has elapsed. The deck must return to B (either
  // via the pre-existing FIX 5 displaced-owner restore, or via phase
  // resolution — either mechanism is correct; what matters is the end state).
  setNow(localMs(30, 22, 41));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), ['b_pl'], 'the deck returns to B, not the static default');
  assert.equal(svc._deckWindowCueId, 'c_b');
});

// ── FLAG ON: nothing owns the moment → the authored defaultCue is the last resort ──

test('phaseAware: before the first cue of the night, the authored defaultCue still fills the gap', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_evening', label: 'Evening', kind: 'ambient', trigger: { type: 'clock', at: '20:00' }, action: { type: 'playlist', name: 'evening_pl' } },
    ],
  });
  const { svc, calls } = setup(plan, { now: localMs(30, 10, 0) }); // well before 20:00
  await svc.start();
  svc.stop();
  // Boot loads the autopilot baseline (plan.autopilot.playlist) FIRST, then —
  // since no cue owns 10:00 — the authored defaultCue fills on top of it: the
  // FINAL deck state (last load) is what matters, not the intermediate one.
  const loaded = names(calls);
  assert.ok(loaded.includes('default_pl'), 'no cue owns 10:00 — the authored default is the loud last resort');
  assert.equal(loaded[loaded.length - 1], 'default_pl', 'the default cue is the LAST (final) load, not overwritten');
  assert.equal(svc._deckWindowCueId, null);
  assert.equal(svc._defaultCueActive, true);
});

// ── FLAG ON: endProgram() release edges ───────────────────────────────────────

test('phaseAware: endProgram() on a no-hold (dust-storm-analog) program resumes the owning block, clears its own latch, controller → autopilot', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_blockx', label: 'Block X', kind: 'ambient', trigger: { type: 'clock', at: '22:00' }, action: { type: 'playlist', name: 'blockx_pl' } },
      { id: 'c_dust', label: 'Dust', kind: 'program', trigger: { type: 'manual' }, action: { type: 'playlist', name: 'dust_pl' } }, // NO hold — holds until ended
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 21, 50) });
  await svc.start();

  setNow(localMs(30, 22, 0));
  await svc._tick();
  assert.ok(names(calls).includes('blockx_pl'));
  calls.loadPlaylist.length = 0;

  setNow(localMs(30, 22, 10));
  await svc.fireCue('c_dust');
  assert.ok(names(calls).includes('dust_pl'), 'the dust cue preempted the block');
  assert.equal(svc._deckWindowCueId, 'c_dust');
  assert.equal(svc.getState().activeProgram.cueId, 'c_dust');
  calls.loadPlaylist.length = 0;

  setNow(localMs(30, 22, 20));
  await svc.endProgram();
  svc.stop();
  // _establishBaselineIfActive reloads the autopilot baseline FIRST, then the
  // phase-aware fill lands on top — the LAST load is the final deck state.
  const loaded = names(calls);
  assert.ok(loaded.includes('blockx_pl'), 'endProgram() resumes the block owning "now", not the static default');
  assert.equal(loaded[loaded.length - 1], 'blockx_pl', 'the block is the FINAL load, never default_pl');
  assert.equal(loaded.includes('default_pl'), false);
  assert.equal(svc._deckWindowCueId, 'c_blockx', 'the dust cue\'s own latch is cleared before the fill re-derives the owner');
  assert.equal(svc.getState().activeProgram, null);
  assert.equal(svc.getState().controller, 'autopilot');
});

test('phaseAware: endProgram() of a manual event fired mid-hold of a later program restores that program with its TRUE hold end (morning_watch analog)', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      {
        id: 'c_m', label: 'Morning watch analog', kind: 'program', trigger: { type: 'clock', at: '08:00' },
        hold: { until: { clock: '09:00' } }, action: { type: 'playlist', name: 'm_pl' },
      },
      {
        id: 'c_event2', label: 'Event 2', kind: 'program', trigger: { type: 'manual' },
        hold: { min: 10 }, action: { type: 'playlist', name: 'event2_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(31, 7, 50) });
  await svc.start();

  // 08:00 — M fires, holds until 09:00.
  setNow(localMs(31, 8, 0));
  await svc._tick();
  assert.ok(names(calls).includes('m_pl'));
  assert.equal(svc.getState().activeProgram.cueId, 'c_m');
  assert.equal(svc.getState().activeProgram.untilMs, localMs(31, 9, 0));
  calls.loadPlaylist.length = 0;

  // 08:10 — a MANUAL event preempts M mid-hold.
  setNow(localMs(31, 8, 10));
  await svc.fireCue('c_event2');
  assert.ok(names(calls).includes('event2_pl'));
  assert.equal(svc.getState().activeProgram.cueId, 'c_event2');
  calls.loadPlaylist.length = 0;

  // 08:15 — the operator ends the event. M's hold (until 09:00) is still
  // genuinely in the future — endProgram() must re-establish M, not the
  // static default, with M's TRUE hold end (09:00), not a fresh window.
  setNow(localMs(31, 8, 15));
  await svc.endProgram();
  svc.stop();
  const loaded = names(calls);
  assert.ok(loaded.includes('m_pl'), 'M is restored, not the static default');
  assert.equal(loaded[loaded.length - 1], 'm_pl', 'M is the FINAL load');
  assert.equal(loaded.includes('default_pl'), false);
  const ap = svc.getState().activeProgram;
  assert.equal(ap.cueId, 'c_m');
  assert.equal(ap.untilMs, localMs(31, 9, 0), 'M\'s hold end is its TRUE fire time + hold, not re-anchored to now');
  assert.equal(svc.getState().controller, 'program');
});

// ── FLAG ON: operator takeover/resume mid-block ───────────────────────────────
// _catchUp already resolves the plan at "now" via resolveDeckStateAt on every
// boot/resume/lease-release, INDEPENDENT of the phaseAware flag (docs/77
// §5.1's own morning_watch self-heal note). This test proves that edge was
// already phase-correct pre-G1 — it is included per the operator-review
// course correction, but it is not new behavior this slice introduces.

test('takeover + resume mid-block: _catchUp already self-heals to the block owning "now" (pre-existing, flag-independent)', async () => {
  const plan = basePlan({
    // Deliberately phaseAware:false — proves this edge does not depend on G1.
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: false },
    cues: [
      { id: 'c_blocky', label: 'Blocky', kind: 'ambient', trigger: { type: 'clock', at: '22:00' }, action: { type: 'playlist', name: 'blocky_pl' } },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 21, 50) });
  await svc.start();

  setNow(localMs(30, 22, 0));
  await svc._tick();
  assert.ok(names(calls).includes('blocky_pl'));
  assert.equal(svc._deckWindowCueId, 'c_blocky');
  calls.loadPlaylist.length = 0;

  setNow(localMs(30, 22, 10));
  svc.takeover();
  await new Promise((r) => setImmediate(r));
  assert.equal(svc.getState().controller, 'manual', 'operator owns the deck during takeover');

  setNow(localMs(30, 22, 30));
  await svc.resume();
  svc.stop();
  assert.ok(names(calls).includes('blocky_pl'), 'resume catchUp re-applies the block owning 22:30');
  assert.equal(names(calls).includes('default_pl'), false, 'never the static default while the block still owns the moment');
  assert.equal(svc._deckWindowCueId, 'c_blocky');
  assert.equal(svc.getState().controller, 'autopilot');
});

// ── FLAG ON: never silently fall back when the resolved cue's OWN apply throws ──

test('phaseAware: a throwing resolved cue surfaces the error and never silently falls back to the static default', async () => {
  // Mirrors the "hold expiry resumes the block owning now" test exactly, but
  // the resolved BLOCK's own apply throws. The resolver still correctly picks
  // c_broken as the owner of 01:30 (it is the LATEST passed clock/sun cue —
  // c_event is manual-trigger and never enters that scan) — the failure must
  // surface loudly, never mask itself behind a "helpful" default_pl load.
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_broken', label: 'Broken block', kind: 'ambient', trigger: { type: 'clock', at: '01:10' }, action: { type: 'playlist', name: 'broken_pl' } },
      {
        id: 'c_event', label: 'Event', kind: 'program', trigger: { type: 'manual' },
        hold: { min: 20 }, action: { type: 'playlist', name: 'event_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(31, 0, 50) });
  await svc.start();

  setNow(localMs(31, 1, 10));
  await svc._tick(); // c_broken fires fine the FIRST time — the fail-latch is armed on the resume path below
  assert.ok(names(calls).includes('broken_pl'));
  calls.loadPlaylist.length = 0;

  await svc.fireCue('c_event');
  assert.ok(names(calls).includes('event_pl'));
  calls.loadPlaylist.length = 0;

  // From here on, re-applying c_broken throws (simulates a dep failure at the
  // moment of release — e.g. a playlist deleted out from under a live plan).
  calls.failPlaylist = 'broken_pl';

  // 01:30 — hold expires; phase resolution picks c_broken (the owner of
  // "now"), whose apply throws. The service must surface the error LOUDLY and
  // must NOT silently fall back to default_pl.
  setNow(localMs(31, 1, 30));
  await svc._tick();
  svc.stop();
  assert.equal(names(calls).includes('broken_pl'), false, 'the throwing apply never actually loaded anything');
  assert.equal(names(calls).includes('default_pl'), false, 'never a silent fallback to the static default on a resolved-cue failure');
  assert.ok(svc.lastError, 'the failure is surfaced, not swallowed');
});

// ── NO shipped-plan assertions in this suite (incident 2026-08-20, _338) ─────
//
// A prior revision of this file loaded the OPERATOR-OWNED shipped plans
// (simulation/scenes/titanic/timeline/*.yaml) and asserted over their content
// ("no phaseAware key yet"). That went stale the moment the external night-arc
// authoring track landed the flag — and worse, it made THIS engine suite red
// whenever a foreign wave's in-progress plan edit was on disk. Shipped plans
// are foreign-owned: this suite asserts ONLY against its own fixtures above;
// plan validation belongs to the offline harness (tools/timeline_dryrun.mjs
// --assert), run against explicit plan paths, never baked into unit tests.

// ── FOLLOW-UP (report _338 addendum) — scheduled-program release edges ────────

test('phaseAware: END SHOW on a still-live scheduled program does not resurrect it (no earlier owner, so defaultCue)', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      {
        id: 'c_ign', label: 'Ignition analog', kind: 'program',
        trigger: { type: 'clock', at: '20:00' }, hold: { min: 120 },
        action: { type: 'playlist', name: 'ign_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 19, 50) });
  await svc.start();

  setNow(localMs(30, 20, 0));
  await svc._tick();
  assert.ok(names(calls).includes('ign_pl'), 'the scheduled program fired at 20:00');
  assert.equal(svc.getState().activeProgram.cueId, 'c_ign');
  calls.loadPlaylist.length = 0;

  // 20:30 — END SHOW while the hold is still live until 22:00. The pure
  // resolver alone would answer "c_ign still owns now" — the phase-aware fill
  // must EXCLUDE the just-ended program and (nothing earlier owns) fall to the
  // authored defaultCue. Resurrection = this exact test failing.
  setNow(localMs(30, 20, 30));
  await svc.endProgram();
  assert.equal(svc.getState().activeProgram, null, 'END SHOW is final: the program is not re-established');
  const loaded = names(calls);
  assert.equal(loaded.includes('ign_pl'), false, 'the ended program is NEVER re-applied by the fill');
  assert.equal(loaded[loaded.length - 1], 'default_pl', 'nothing earlier owns 20:30 so the defaultCue is the loud last resort');
  assert.equal(svc.getState().controller, 'autopilot');
  calls.loadPlaylist.length = 0;

  // The NEXT tick must not bring it back either (firedToday is latched; the
  // default-cue idempotency latch holds).
  setNow(localMs(30, 20, 31));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), [], 'no resurrection on subsequent ticks');
  assert.equal(svc.getState().activeProgram, null);
});

test('phaseAware: END SHOW on a still-live scheduled program resumes the earlier open-ended block, not the ended program', async () => {
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_pre', label: 'Pre block', kind: 'ambient', trigger: { type: 'clock', at: '19:00' }, action: { type: 'playlist', name: 'pre_pl' } },
      {
        id: 'c_ign', label: 'Ignition analog', kind: 'program',
        trigger: { type: 'clock', at: '20:00' }, hold: { min: 120 },
        action: { type: 'playlist', name: 'ign_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 18, 50) });
  await svc.start();

  setNow(localMs(30, 19, 0));
  await svc._tick();
  assert.ok(names(calls).includes('pre_pl'), 'the open-ended block fired at 19:00');
  setNow(localMs(30, 20, 0));
  await svc._tick();
  assert.ok(names(calls).includes('ign_pl'), 'the program preempted the block at 20:00');
  calls.loadPlaylist.length = 0;

  // 20:30 — END SHOW. The ended program is excluded; the WALK-BACK must find
  // the 19:00 block (still the moment's owner), never the static default.
  setNow(localMs(30, 20, 30));
  await svc.endProgram();
  svc.stop();
  const loaded = names(calls);
  assert.equal(loaded.includes('ign_pl'), false, 'the ended program is never re-applied');
  assert.equal(loaded[loaded.length - 1], 'pre_pl', 'the earlier still-owning block is the FINAL load');
  assert.equal(loaded.includes('default_pl'), false, 'the static default is not reached while a cue owns the moment');
  assert.equal(svc._deckWindowCueId, 'c_pre', 'ownership latch mirrors the walked-back owner');
  assert.equal(svc.getState().activeProgram, null);
  assert.equal(svc.getState().controller, 'autopilot');
});

test('phaseAware: natural hold expiry of a SCHEDULED program walks back to the earlier still-owning ambient cue, not the static default', async () => {
  // Deliberately the SAME shape as the "legacy:" test above, with the flag ON:
  // the expired program is itself the LATEST passed restorable cue, so the
  // selection core alone answers "defaultCue" — the WALK-BACK must skip the
  // dead program and restore A (follow-up item 3; the legacy pair proves the
  // flag-off behavior is untouched).
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      { id: 'c_a', label: 'A', kind: 'ambient', trigger: { type: 'clock', at: '20:00' }, action: { type: 'playlist', name: 'a_pl' } },
      {
        id: 'c_p', label: 'P', kind: 'program', trigger: { type: 'clock', at: '21:00' },
        hold: { min: 30 }, action: { type: 'playlist', name: 'p_pl' },
      },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 19, 0) });
  await svc.start();

  setNow(localMs(30, 20, 0));
  await svc._tick();
  assert.ok(names(calls).includes('a_pl'));
  setNow(localMs(30, 21, 0));
  await svc._tick();
  assert.ok(names(calls).includes('p_pl'));
  calls.loadPlaylist.length = 0;

  // 21:31 — P's hold has expired (no aligned next cue: nothing fires at this
  // instant, so no coalesce — the restore itself must land A back on the deck).
  setNow(localMs(30, 21, 31));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), ['a_pl'], 'natural expiry restores the earlier time-owning ambient cue');
  assert.equal(svc._deckWindowCueId, 'c_a');
  const fire = svc.recentFires[svc.recentFires.length - 1];
  assert.equal(fire.cueId, 'c_a');
  assert.equal(fire.reason, 'hold-expired');
});

test('phaseAware: aligned hold end + next cue start dispatch the next cue EXACTLY once (21:30 boundary, no double reload)', async () => {
  // The real plan's party-boundary seam (follow-up item 4): the evening
  // program's hold ends AT the early-night cue's own clock fire. Both land in
  // the same tick — the phase-aware restore must COALESCE into the cue's own
  // fire instead of reloading the same playlist twice (operator-visible
  // flicker at a show boundary).
  const plan = basePlan({
    defaultCue: { label: 'House', action: { type: 'playlist', name: 'default_pl' }, phaseAware: true },
    cues: [
      {
        id: 'c_first', label: 'First', kind: 'program', trigger: { type: 'clock', at: '21:00' },
        hold: { until: { clock: '21:30' } }, action: { type: 'playlist', name: 'first_pl' },
      },
      { id: 'c_early', label: 'Early night', kind: 'ambient', trigger: { type: 'clock', at: '21:30' }, action: { type: 'playlist', name: 'early_pl' } },
    ],
  });
  const { svc, calls, setNow } = setup(plan, { now: localMs(30, 20, 50) });
  await svc.start();

  setNow(localMs(30, 21, 0));
  await svc._tick();
  assert.ok(names(calls).includes('first_pl'));
  calls.loadPlaylist.length = 0;

  // 21:30 — ONE tick carries both the hold expiry and c_early's own fire.
  setNow(localMs(30, 21, 30));
  await svc._tick();
  svc.stop();
  assert.deepEqual(names(calls), ['early_pl'], 'exactly ONE load of the boundary cue — restore coalesced into its own fire');
  const earlyFires = svc.recentFires.filter((f) => f.cueId === 'c_early');
  assert.equal(earlyFires.length, 1, 'exactly one recorded fire for the boundary cue');
  assert.equal(svc._deckWindowCueId, 'c_early', 'the boundary cue owns the deck after the seam');
  assert.equal(svc.getState().activeProgram, null, 'the expired program is gone');
});
