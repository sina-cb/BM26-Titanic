// revert_clears_spatial — audit C1/H5/H17 (report 20260810_2).
//
// THE CRITICAL: a panel dying mid-ERASE left spatial paint with touch:true in
// controller memory. applySpatialStage runs every frame while sp.enabled, so
// the erase kept multiplying the composed pixels toward 0 FOREVER — on top of
// the automatic show revertToAutomaticShow had just restored. No failsafe
// cleared it, because the revert never touched spatial state, and the XY
// strobe/walk (presetId 'xy_pad', no slot) were equally invisible to the
// disable-all slot sweep.
//
// These tests drive a REAL engine subprocess and assert:
//   1. DEADMAN REVERT — arm over /ws/control, assert an ERASE with touch:true
//      plus an XY strobe and walk, hard-kill the socket, wait out the close
//      grace: spatial must be DISABLED, strobe and movement OFF.
//   2. TOUCH STALENESS — with a live panel that simply stops sending, the
//      stage itself lifts a touch nobody refreshed (BM26_* shrinks nothing
//      here: the window is a controller property, so this test reaches it via
//      the paint still being live but the touch dropping).
//   3. STRICT BLACKOUT — /global-blackout rejects every non-boolean state;
//      {"state":"false"} used to ENGAGE the blackout and persist it.
//
// Engine spawns with `--dest 192.0.2.9` — TEST-NET-1 (RFC 5737), never routed —
// so sACN never reaches the live sim. Loopback is NOT a black hole: the sim's
// sACN receiver binds every local interface.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

// Short arm lease so the deadman fires in ~2 s: grace = clamp(lease/3, 1s, 5s).
const ARM_LEASE_MS = 3000;
const ALL_PIXEL_INDICES = Array.from({ length: 166 }, (_, index) => index);
// 'whole_group' movement (like every one_per_color/pulse mode) is a palette
// overlay: it needs the authoritative five-colour Live Touch session palette
// staged first (LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED otherwise).
const OVERLAY_PALETTE = [
  { h: 0.00, s: 1, v: 1 },
  { h: 0.16, s: 1, v: 1 },
  { h: 0.33, s: 1, v: 1 },
  { h: 0.55, s: 1, v: 1 },
  { h: 0.78, s: 1, v: 1 },
];

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'revert-spatial',
  portBase: 7700,
  portSpan: 200,
  extraEnv: {
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: String(ARM_LEASE_MS),
  },
  extraArgs: ['--dest', '192.0.2.9'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openControlWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 8000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function rpc(ws, msg, expectType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no '${expectType}' reply`)), 8000);
    function onMsg(raw) {
      let d; try { d = JSON.parse(raw.toString()); } catch { return; }
      if (d.type !== expectType) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(d);
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
  });
}

async function spatial(headers = {}) {
  const { data } = await h.api('GET', '/spatial-paint', undefined, headers);
  return data;
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => { await h.teardown(); });

test('deadman revert clears a stuck ERASE and the slot-less strobe/walk', async () => {
  const ownerHeaders = { 'X-Touch-Control-Owner': 'revert-test' };
  const ws = await openControlWs();
  const ack = await rpc(ws, { type: 'touchControlArmed', armed: true, ownerId: 'revert-test' },
    'touchControlArmedAck');
  assert.equal(ack.armed, true, 'the engine must ack the arm');

  // The dead panel's last words: an ERASE mid-stroke, a strobe, a walk.
  let r = await h.api('POST', '/spatial-paint', {
    enabled: true, touch: true, targetX: 0.5, targetY: 0.5,
    axisX: 'nx', axisY: 'nz', pixelIndices: ALL_PIXEL_INDICES,
    mode: 'erase', radius: 0.4, radiusY: 0.4, amount: 1,
  }, ownerHeaders);
  assert.equal(r.status, 200, `spatial assert failed: ${JSON.stringify(r.data)}`);
  r = await h.api('POST', '/strobe-rate', { active: true, hz: 4, duty: 0.5, intensity: 1 },
    ownerHeaders);
  assert.equal(r.status, 200, `strobe assert failed: ${JSON.stringify(r.data)}`);
  // movement-rate is retired for Live Touch (LIVE_TOUCH_OVERLAY_ACTION_REQUIRED):
  // driving movement now goes through the authoritative overlay slot action —
  // bind a slot to the movementTrace effect, then dispatch it via
  // POST /global-effect-slots/:id/movement-rate. Slot 20 is outside the
  // pre-seeded 1..13 DEFAULT_SLOT_CONFIG range (create-on-patch).
  const MOVEMENT_SLOT_ID = 20;
  r = await h.api('POST', '/layers/live_touch/palette', { colorPalette: OVERLAY_PALETTE }, ownerHeaders);
  assert.equal(r.status, 200, `palette stage failed: ${JSON.stringify(r.data)}`);
  r = await h.api('PATCH', `/global-effect-slots/${MOVEMENT_SLOT_ID}`, {
    enabled: true, effectId: 'movementTrace', presetId: 'whole_group_repeat', behavior: 'toggle',
  }, ownerHeaders);
  assert.equal(r.status, 200, `movement slot bind failed: ${JSON.stringify(r.data)}`);
  r = await h.api('POST', `/global-effect-slots/${MOVEMENT_SLOT_ID}/movement-rate`, {
    active: true, pixelsPerSecond: 5,
  }, ownerHeaders);
  assert.equal(r.status, 200, `movement assert failed: ${JSON.stringify(r.data)}`);

  const sp = await spatial(ownerHeaders);
  assert.equal(sp.enabled, true, 'precondition: spatial live');
  assert.equal(sp.touch, true, 'precondition: touch held');

  // Kill the panel the hard way. Grace = clamp(3000/3, 1s, 5s) = 1s.
  ws.terminate();
  await sleep(2500);

  const sharedAfter = await spatial();
  assert.equal(sharedAfter.enabled, false,
    'private Live ERASE must never touch the shared spatial controller');
  assert.equal(sharedAfter.touch, false);

  const fresh = await openControlWs();
  const freshOwner = 'revert-test-fresh';
  const freshHeaders = { 'X-Touch-Control-Owner': freshOwner };
  const freshAck = await rpc(fresh, {
    type: 'touchControlArmed', armed: true, ownerId: freshOwner,
  }, 'touchControlArmedAck');
  assert.equal(freshAck.armed, true);
  const freshSpatial = await spatial(freshHeaders);
  assert.equal(freshSpatial.enabled, false, 'dead ERASE must not survive into a fresh session');
  assert.equal(freshSpatial.touch, false);
  assert.equal((await h.api('GET', '/strobe-rate', undefined, freshHeaders)).data.active, false,
    'dead private strobe must not survive into a fresh session');
  assert.equal((await h.api('GET', '/movement-rate', undefined, freshHeaders)).data.active, false,
    'dead private movement must not survive into a fresh session');
  await rpc(fresh, {
    type: 'touchControlArmed', armed: false, ownerId: freshOwner,
  }, 'touchControlArmedAck');
  fresh.close();
});

test('a touch nobody refreshes goes stale and lifts on its own', async () => {
  // Live panel this time — no socket kill, no revert. The stage itself must
  // lift the touch after spatialTouchStaleMs of silence. The window is a
  // controller property defaulting to 10 s; this test drives it for ~12 s of
  // wall time, which is the honest price of black-box-testing the deadman
  // (shrinking it would mean an env knob the show build does not need).
  const r = await h.api('POST', '/spatial-paint', {
    enabled: true, touch: true, targetX: 0.3, targetY: 0.3, mode: 'trail',
    axisX: 'nx', axisY: 'nz', pixelIndices: ALL_PIXEL_INDICES,
  });
  assert.equal(r.status, 200);
  assert.equal((await spatial()).touch, true, 'precondition: touch held');

  await sleep(11_500);   // > 10 s staleness window, no refresh in between

  const sp = await spatial();
  assert.equal(sp.touch, false,
    'TOUCH MUST GO STALE — writes stopped 11.5 s ago; a slow stroke is 33 ms');
  // Cleanup so later tests start neutral.
  await h.api('POST', '/spatial-paint', { enabled: false, touch: false, clear: true });
});

test('/global-blackout rejects every non-boolean state', async () => {
  for (const bad of ['false', 'true', 1, 0, null, [], {}]) {
    const { status } = await h.api('POST', '/global-blackout', { state: bad });
    assert.equal(status, 400,
      `state=${JSON.stringify(bad)} must be rejected — "false" used to ENGAGE the blackout`);
  }
  // The real booleans still work, and false leaves the ship lit.
  let r = await h.api('POST', '/global-blackout', { state: true });
  assert.equal(r.status, 200);
  r = await h.api('POST', '/global-blackout', { state: false });
  assert.equal(r.status, 200);
  assert.equal(r.data.blackoutActive, false);
});
