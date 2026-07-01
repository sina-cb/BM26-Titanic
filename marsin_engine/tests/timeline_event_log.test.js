/*
 * timeline_event_log.test.js — the EVENT LOG ring (docs/38 §15.2).
 *
 * The `recentFires` ring (wire name kept for compat) now carries the plan's
 * LIFECYCLE, not just cue fires. Pinned wire shape for every entry:
 *   { kind:'fire'|'lifecycle', cueId?, label, reason, source, atMs }
 *
 * These tests prove, with a simulated clock:
 *   - every lifecycle transition logs (activate/boot, pause/arm, resume, hold
 *     + hold-expiry, autopilot toggle, takeover + lease release, program end,
 *     pending-program lease armed/auto-start/dismissed);
 *   - logging is EDGE-ONLY (re-posting the same mode/toggle, activity pings,
 *     and steady-state ticks add NOTHING — no per-tick spam);
 *   - the ring stays bounded at its cap;
 *   - every entry carries the pinned wire shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TimelineService } from '../lib/timeline/timeline_service.js';
import { saveShowPlan } from '../lib/timeline/show_plan.js';

// ── fakes (mirrors timeline_service.test.js, with a MUTABLE clock) ──────────

function makeDeps() {
  const viewState = { mode: null, source: null };
  return {
    loadPlaylist: () => {},
    setAutopilot: () => {},
    setParams: () => {},
    requestScene: () => {},
    patchScheduledTask: () => {},
    fireScheduledTask: () => {},
    listMixerChannelIds: () => [],
    listPlaylists: () => [{ name: 'default' }],
    setDeckTransition: () => {},
    setDeckOverlaysEnabled: () => {},
    setColorAutopilot: () => {},
    forceDeckView: () => { viewState.mode = 'deck'; viewState.source = 'plan'; },
    releaseDeckView: () => {
      if (viewState.mode === 'deck' && viewState.source === 'plan') {
        viewState.mode = null; viewState.source = null;
      }
    },
    getViewOverrideMode: () => viewState.mode,
  };
}

function makePlan() {
  return {
    schemaVersion: 1,
    name: 'test_plan',
    location: { lat: 40.7864, lon: -119.2065, tz: 'America/Los_Angeles', elevationM: 1190 },
    autopilot: {
      enabled: true, playlist: 'baseline_pl', delay_s: 45, shuffle: true,
      target: { channel: 'deck', id: null }, mood: true,
    },
    phases: {},
    looks: { show: { playlist: 'show_pl' } },
    cues: [
      {
        id: 'c_show',
        label: 'Scheduled show',
        kind: 'program',
        trigger: { type: 'clock', at: '12:00' },
        action: { type: 'look', look: 'show' },
        hold: { min: 90 },
      },
    ],
  };
}

// Boot at 2026-08-29 19:00 PDT (after the plan's 12:00 cue, so boot catchUp
// restores it once and firedToday latches for the day).
const BOOT_MS = Date.UTC(2026, 7, 30, 2, 0, 0);
// 2026-08-30 11:59 PDT — next day, one minute before the 12:00 clock cue.
const NEXT_DAY_1159_MS = Date.UTC(2026, 7, 30, 18, 59, 0);

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlevlog-'));
  const sceneDir = path.join(dir, 'scene_timeline');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  saveShowPlan(makePlan(), path.join(sceneDir, 'test_plan.yaml'));

  const clock = { now: BOOT_MS };
  const svc = new TimelineService({
    scene: 'summer_camp_dome',
    sceneDir,
    stateDir,
    getMood: () => ({ party: 0, value: 0 }),
    deps: makeDeps(),
    broadcast: () => {},
    config: {
      enabled: true, activePlan: 'test_plan', tickMs: 1000,
      programLeaseSec: 30,
      mood: { key: 'audioParty', partyThreshold: 0.5 },
      colorPalettes: [],
    },
    nowFn: () => clock.now,
  });
  await svc.start();
  svc.stop(); // no wall-clock interval; ticks are driven explicitly
  return { svc, clock };
}

const lifecycles = (svc) => svc.recentFires.filter((e) => e.kind === 'lifecycle');
const byReason = (svc, reason) => lifecycles(svc).filter((e) => e.reason === reason);

// ── wire shape ───────────────────────────────────────────────────────────────

test('every event entry carries the pinned wire shape', async () => {
  const { svc, clock } = await setup();
  await svc.setMode('paused');
  clock.now += 1000;
  await svc.resume();
  assert.ok(svc.recentFires.length >= 3, 'boot + pause + resume expected');
  for (const e of svc.recentFires) {
    assert.ok(e.kind === 'fire' || e.kind === 'lifecycle', `kind pinned, got ${e.kind}`);
    assert.equal(typeof e.label, 'string');
    assert.equal(typeof e.reason, 'string');
    assert.equal(typeof e.source, 'string');
    assert.equal(typeof e.atMs, 'number');
    assert.ok('cueId' in e, 'cueId key present (may be null)');
  }
});

test('boot logs "Plan activated" lifecycle and cue fires stay kind:fire', async () => {
  const { svc } = await setup();
  const boot = byReason(svc, 'boot');
  assert.equal(boot.length, 1);
  assert.equal(boot[0].label, 'Plan activated: test_plan');
  assert.equal(boot[0].source, 'auto');
  // Boot catchUp restored c_show (12:00 was in the past) — as a FIRE entry.
  const fires = svc.recentFires.filter((e) => e.kind === 'fire');
  assert.ok(fires.some((f) => f.cueId === 'c_show' && f.source === 'catchUp'),
    `catchUp fire expected, got ${JSON.stringify(svc.recentFires)}`);
  // The activation precedes the catch-up fire in ring order.
  assert.ok(svc.recentFires.indexOf(boot[0]) < svc.recentFires.findIndex((e) => e.kind === 'fire'));
});

// ── pause / resume / hold ────────────────────────────────────────────────────

test('pause + resume log once each — edge-only under repeats', async () => {
  const { svc, clock } = await setup();
  await svc.setMode('paused');
  await svc.setMode('paused'); // repeat: no new event
  assert.equal(byReason(svc, 'pause').length, 1);
  assert.equal(byReason(svc, 'pause')[0].label, 'Timeline paused');
  assert.equal(byReason(svc, 'pause')[0].source, 'manual');

  clock.now += 1000;
  await svc.resume();
  assert.equal(byReason(svc, 'resume').length, 1);
  assert.equal(byReason(svc, 'resume')[0].label, 'Plan resumed by operator');
  // Resuming while already armed (nothing held) logs nothing new.
  await svc.resume();
  assert.equal(byReason(svc, 'resume').length, 1);
});

test('hold logs with minutes; natural expiry logs "Hold expired" exactly once', async () => {
  const { svc, clock } = await setup();
  svc.hold(5);
  const held = byReason(svc, 'hold');
  assert.equal(held.length, 1);
  assert.equal(held[0].label, 'Hold for 5 min');
  // Ticks INSIDE the window log nothing.
  clock.now += 60 * 1000;
  await svc._tick();
  assert.equal(byReason(svc, 'hold-expired').length, 0);
  // Past the window → exactly one expiry event, and re-ticks never repeat it.
  clock.now += 5 * 60 * 1000;
  await svc._tick();
  clock.now += 1000;
  await svc._tick();
  const expired = byReason(svc, 'hold-expired');
  assert.equal(expired.length, 1);
  assert.equal(expired[0].label, 'Hold expired — plan resumes');
  assert.equal(expired[0].source, 'auto');
});

test('explicit resume during a hold suppresses the hold-expiry event', async () => {
  const { svc, clock } = await setup();
  svc.hold(5);
  clock.now += 1000;
  await svc.resume();
  clock.now += 10 * 60 * 1000; // way past where the hold would have lapsed
  await svc._tick();
  assert.equal(byReason(svc, 'hold-expired').length, 0);
  assert.equal(byReason(svc, 'resume').length, 1);
});

// ── autopilot toggle ─────────────────────────────────────────────────────────

test('autopilot toggle logs on the edge only', async () => {
  const { svc } = await setup();
  await svc.setAutopilotEnabled(false);
  await svc.setAutopilotEnabled(false); // repeat: no new event
  const off = lifecycles(svc).filter((e) => e.label === 'Autopilot disabled');
  assert.equal(off.length, 1);
  assert.equal(off[0].source, 'manual');
  await svc.setAutopilotEnabled(true);
  const on = lifecycles(svc).filter((e) => e.label === 'Autopilot enabled');
  assert.equal(on.length, 1);
});

// ── takeover / lease release ─────────────────────────────────────────────────

test('takeover logs once (refreshes and activity pings add nothing); lease release logs on expiry', async () => {
  const { svc, clock } = await setup();
  const before = svc.recentFires.length;
  svc.takeover();
  svc.takeover();  // refresh — no new event
  svc.activity();  // ping — no new event
  const took = byReason(svc, 'takeover');
  assert.equal(took.length, 1);
  assert.equal(took[0].label, 'Operator takeover (lease armed)');
  assert.equal(svc.recentFires.length, before + 1);

  // Expire the lease → tick auto-releases + resumes: exactly one release event.
  clock.now += (svc.operatorLeaseSec + 1) * 1000;
  await svc._tick();
  const released = byReason(svc, 'lease-released');
  assert.equal(released.length, 1);
  assert.equal(released[0].label, 'Operator lease released — plan resumed');
  assert.equal(released[0].source, 'auto');
});

// ── program end ──────────────────────────────────────────────────────────────

test('endProgram logs "Program ended" with the cue label; no-op end logs nothing', async () => {
  const { svc } = await setup();
  await svc.fireCue('c_show'); // manual program start (fire entry)
  assert.equal(svc.getState().controller, 'program');
  await svc.endProgram();
  const ended = byReason(svc, 'program-end');
  assert.equal(ended.length, 1);
  assert.equal(ended[0].label, 'Program ended: Scheduled show');
  assert.equal(ended[0].cueId, 'c_show');
  await svc.endProgram(); // nothing active → nothing logged
  assert.equal(byReason(svc, 'program-end').length, 1);
});

test('program hold expiry logs "Program ended (hold expired)" from the tick', async () => {
  const { svc, clock } = await setup();
  await svc.fireCue('c_show'); // hold {min:90}
  clock.now += 91 * 60 * 1000;
  await svc._tick();
  clock.now += 1000;
  await svc._tick(); // no repeat
  const ended = byReason(svc, 'hold-expired')
    .filter((e) => e.label.startsWith('Program ended'));
  assert.equal(ended.length, 1);
  assert.equal(ended[0].cueId, 'c_show');
  // The end precedes the autopilot-resume fire it causes.
  const resumeIdx = svc.recentFires.findIndex((e) => e.kind === 'fire' && e.reason === 'resume');
  assert.ok(resumeIdx > svc.recentFires.indexOf(ended[0]), 'end → resume ordering');
});

// ── pending-program lease: armed → auto-start / dismissed ────────────────────

test('lease armed logs once (no per-tick spam), auto-start logs + fires', async () => {
  const { svc, clock } = await setup();
  // Move to the NEXT day just before the 12:00 cue, PAUSED (manual owner).
  clock.now = NEXT_DAY_1159_MS;
  await svc._tick(); // day rollover resets firedToday
  await svc.setMode('paused');
  clock.now += 2 * 60 * 1000; // 12:01 → cue due while manual → lease ARMS
  await svc._tick();
  clock.now += 1000;
  await svc._tick(); // steady-state tick: nothing new
  const armed = byReason(svc, 'lease-armed');
  assert.equal(armed.length, 1);
  assert.equal(armed[0].cueId, 'c_show');
  assert.ok(armed[0].label.startsWith('Show pending: Scheduled show'));

  // Let the 30 s lease lapse → the arbiter auto-starts the program.
  clock.now += 31 * 1000;
  await svc._tick();
  const auto = byReason(svc, 'lease-expired');
  assert.equal(auto.length, 1);
  assert.equal(auto[0].label, 'Show auto-started: Scheduled show');
  // And the program application itself is a FIRE entry after the lifecycle.
  const fireIdx = svc.recentFires.findIndex((e) => e.kind === 'fire' && e.cueId === 'c_show' && e.source === 'auto');
  assert.ok(fireIdx > svc.recentFires.indexOf(auto[0]), 'auto-start lifecycle precedes its fire');
});

test('dismissProgram logs "Show dismissed" once', async () => {
  const { svc, clock } = await setup();
  clock.now = NEXT_DAY_1159_MS;
  await svc._tick();
  await svc.setMode('paused');
  clock.now += 2 * 60 * 1000;
  await svc._tick(); // lease arms
  const r = svc.dismissProgram();
  assert.equal(r.ok, true);
  const dismissed = byReason(svc, 'lease-dismissed');
  assert.equal(dismissed.length, 1);
  assert.equal(dismissed[0].label, 'Show dismissed: Scheduled show');
  assert.equal(dismissed[0].source, 'manual');
  assert.equal(svc.dismissProgram().ok, false); // nothing pending → no event
  assert.equal(byReason(svc, 'lease-dismissed').length, 1);
});

// ── activate / anti-spam / ring bound ────────────────────────────────────────

test('activatePlan clears the ring and opens it with "Plan activated"', async () => {
  const { svc } = await setup();
  await svc.setMode('paused'); // seed some history
  await svc.activatePlan('test_plan');
  const first = svc.recentFires[0];
  assert.equal(first.kind, 'lifecycle');
  assert.equal(first.reason, 'activate');
  assert.equal(first.label, 'Plan activated: test_plan');
  assert.equal(first.source, 'manual');
  // The outgoing history is gone; only the activation (+ its catchUp) remain.
  assert.equal(byReason(svc, 'pause').length, 0);
});

test('steady-state ticks add no events (a reconcile loop never spams the log)', async () => {
  const { svc, clock } = await setup();
  await svc._tick();
  const after = svc.recentFires.length;
  for (let i = 0; i < 10; i += 1) {
    clock.now += 1000;
    await svc._tick();
  }
  assert.equal(svc.recentFires.length, after, 'no per-tick lifecycle spam');
});

test('the ring is bounded at its cap and getState mirrors it', async () => {
  const { svc, clock } = await setup();
  for (let i = 0; i < 60; i += 1) {
    clock.now += 1000;
    await svc.setMode(i % 2 === 0 ? 'paused' : 'armed'); // 60 genuine edges
  }
  assert.ok(svc.recentFires.length <= 50, `ring bounded, got ${svc.recentFires.length}`);
  const st = svc.getState();
  assert.ok(st.recentFires.length <= 50);
  // Oldest entries were shifted out — the boot event is gone, newest kept.
  assert.equal(byReason(svc, 'boot').length, 0);
  assert.equal(st.recentFires[st.recentFires.length - 1].kind, 'lifecycle');
});
