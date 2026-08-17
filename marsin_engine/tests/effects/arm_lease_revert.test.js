/**
 * arm_lease_revert — the TOUCH CONTROL deadman and its revert to the automatic show.
 *
 * Arming the panel takes the whole rig: the params are source-locked, both
 * autopilots go off, every effect is disabled and the overlay faders drop to
 * zero. Before the arm lease, a panel that stopped answering left ALL of that
 * in place with nobody driving — the ship frozen mid-look and the automatic
 * show unable to come back. On a playa install that is the failure that matters.
 *
 * These tests drive a REAL engine subprocess over a real /ws/control socket and
 * pin the four properties the recovery depends on:
 *
 *   1. WS-CLOSE REVERT  — the armed socket goes away -> the engine hands the
 *                         deck back to the automatic show and LIGHTS the ship.
 *   2. ONE DESK         — a second LIVE panel arming is refused, not silently
 *                         given a lease that clobbers the first.
 *   3. STALE EVICTION   — a holder whose socket is dead must NOT lock the desk;
 *                         a live panel takes over. ('close' is not guaranteed —
 *                         a hard-killed client leaves the socket half-open,
 *                         which is exactly why the ping exists.)
 *   4. LIGHT FIRST      — the revert clears the blackout and restores a zeroed
 *                         grand master, because clearing one without the other
 *                         still leaves a dark hull.
 *
 * The engine is spawned with `--dest 192.0.2.9` — TEST-NET-1 (RFC 5737), never
 * routed — so its sACN can never reach the operator's live sim bridge (see
 * spawn_engine.mjs). A loopback dest would NOT do: the sim's sACN receiver
 * binds every local interface and would relay the frames on to the rig.
 *
 * Run: node --import ./tests/helpers/setup_config_guard.mjs \
 *        --test marsin_engine/tests/effects/arm_lease_revert.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

// Short lease so expiry is exercised in about a second rather than fifteen.
const LEASE_MS = 1200;

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'arm-lease-revert',
  portBase: 7700,
  portSpan: 200,
  extraEnv: {
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: String(LEASE_MS),
  },
  extraArgs: ['--dest', '192.0.2.9'],
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Open a /ws/control socket, announce an owner, and collect its messages. */
async function control(ownerId) {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const msgs = [];
  ws.on('message', raw => {
    try { msgs.push(JSON.parse(raw)); } catch { /* non-JSON frames are not ours */ }
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId }));
  await sleep(150);
  return { ws, msgs, ownerId };
}

const arm = (c, armed = true) =>
  c.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: c.ownerId, armed }));

before(async () => {
  await h.spawnEngine();
  await h.waitForReady();
});

after(async () => { await h.teardown(); });

test('a dead control socket reverts the rig to the automatic show', async () => {
  // Put the rig into the state an armed panel leaves behind.
  await h.api('POST', '/param-center/source-lock', {
    mode: 'per-param', leases: { speed: 'api', rotate: 'api' },
  });
  await h.api('POST', '/global-blackout', { state: true });

  const c = await control('panel_dies');
  arm(c);
  await sleep(300);

  // Hard-close. The lease shortens to its grace window, then expires.
  c.ws.close();
  await sleep(LEASE_MS + 2500);

  const lock = await h.api('GET', '/param-center');
  assert.equal(lock.data.sourceLock, null,
    'the source lock must be released — otherwise the automatic show cannot change colour or speed');

  const globals = await h.api('GET', '/globals');
  assert.equal(globals.data.blackout, false, 'the revert must clear the blackout');

  const fade = await h.api('GET', '/arm-fade');
  assert.equal(fade.data.armFade, 1,
    'the arm envelope must be released — a panel that died mid-fade must not leave the ship dimmed');
});

test('a second LIVE panel is refused the desk, not silently given it', async () => {
  const a = await control('desk_holder');
  arm(a);
  await sleep(300);

  const b = await control('second_panel');
  arm(b);
  await sleep(400);

  const rejected = b.msgs.find(m => m.type === 'touchControlArmedRejected');
  const acked = b.msgs.find(m => m.type === 'touchControlArmedAck' && m.armed === true);
  assert.ok(rejected, 'the second panel must be told the desk is held');
  assert.equal(rejected.heldBy, 'desk_holder', 'and told WHO holds it, so it is actionable');
  assert.ok(!acked, 'it must NOT also receive an arm acknowledgement');

  arm(a, false);
  a.ws.close(); b.ws.close();
  await sleep(300);
});

test('the armed owner is the only HTTP writer until its lease is released', async () => {
  const c = await control('http_owner');
  arm(c);
  await sleep(300);

  let r = await h.api('POST', '/param-center', { speed: 0.25 });
  assert.equal(r.status, 423, 'an unowned HTTP client must not overwrite the armed desk');
  assert.equal(r.data.code, 'TOUCH_CONTROL_LEASE_HELD');

  r = await h.api('POST', '/param-center', { speed: 0.5 },
    { 'X-Touch-Control-Owner': 'wrong_owner' });
  assert.equal(r.status, 409, 'a forged/stale owner must not overwrite the armed desk');
  assert.equal(r.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');

  r = await h.api('POST', '/param-center', { speed: 0.75 },
    { 'X-Touch-Control-Owner': 'http_owner' });
  assert.equal(r.status, 200, `the active owner must retain control: ${JSON.stringify(r.data)}`);

  // E-stop paths remain available even when the desk is held.
  r = await h.api('POST', '/global-blackout', { state: false });
  assert.equal(r.status, 200, 'emergency blackout control must remain reachable from another surface');

  arm(c, false);
  await sleep(300);

  r = await h.api('POST', '/param-center', { speed: 0.4 },
    { 'X-Touch-Control-Owner': 'http_owner' });
  assert.equal(r.status, 409, 'a released panel must not keep writing with its stale identity');

  r = await h.api('POST', '/param-center', { speed: 0.6 });
  assert.equal(r.status, 200, 'ordinary clients regain write access after the desk is cleanly released');

  c.ws.close();
  await sleep(200);
});

test('a superseded same-owner socket cannot detach the replacement ARM lease', async () => {
  const first = await control('reconnecting_owner');
  arm(first);
  await sleep(300);

  const replacement = await control('reconnecting_owner');
  arm(replacement);
  await sleep(300);
  const rebound = replacement.msgs.find(
    message => message.type === 'touchControlArmedAck' && message.armed === true,
  );
  assert.ok(rebound, 'the replacement socket did not rebind the existing owner lease');

  first.ws.close();
  await sleep(LEASE_MS + 800);
  const stillOwned = await h.api('POST', '/param-center', { speed: 0.72 }, {
    'X-Touch-Control-Owner': 'reconnecting_owner',
  });
  assert.equal(stillOwned.status, 200,
    'the old socket close detached or expired the replacement owner lease');

  arm(replacement, false);
  replacement.ws.close();
  await sleep(300);
});

test('a STALE holder never locks the desk — a live panel takes over', async () => {
  const ghost = await control('ghost_panel');
  arm(ghost);
  await sleep(300);
  // terminate() kills the socket WITHOUT a close handshake, the half-open case
  // that 'close' does not reliably cover.
  ghost.ws.terminate();
  await sleep(400);

  const live = await control('live_panel');
  arm(live);
  await sleep(500);

  const acked = live.msgs.find(m => m.type === 'touchControlArmedAck' && m.armed === true);
  const rejected = live.msgs.find(m => m.type === 'touchControlArmedRejected');
  assert.ok(acked, 'a live panel must be able to take a desk whose holder is gone');
  assert.ok(!rejected, 'a dead holder must never refuse a live panel');

  arm(live, false);
  live.ws.close();
  await sleep(300);
});

test('the revert LIGHTS the ship: a zeroed grand master is raised, not just the blackout', async () => {
  // Clearing the blackout does not light a ship whose master is at 0 — they are
  // independent ways to be dark and the panel drives both.
  await h.api('PATCH', '/mixer', { master: 0 });
  await h.api('POST', '/global-blackout', { state: true });

  const c = await control('dark_ship_panel');
  arm(c);
  await sleep(300);
  c.ws.close();
  await sleep(LEASE_MS + 2500);

  const mixer = await h.api('GET', '/mixer');
  assert.ok(mixer.data.master > 0,
    'the revert must raise a zeroed grand master — otherwise the hull stays dark with the blackout off');

  const globals = await h.api('GET', '/globals');
  assert.equal(globals.data.blackout, false, 'and the blackout must be clear');
});
