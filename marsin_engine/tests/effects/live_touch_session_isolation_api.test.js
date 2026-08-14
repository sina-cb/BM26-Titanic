/**
 * Real-engine proof that Live Touch is a setting-local creative session.
 *
 * Owner-tagged compatibility routes deliberately retain their familiar URLs,
 * but while ARM is held they write only the private Live context. Deck/Mixer
 * CPC, effects, paint, slots, bindings, tempo, and state files must not move.
 */
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import * as osc from 'osc-min';
import { WebSocket } from 'ws';

import { writeBlackHoledConfig } from '../e2e/timeline_e2e_harness.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const CLEAN_OWNER = 'live_session_isolation';
const DEAD_OWNER = 'live_session_deadman';
const GROUP = 'ParLights';
const OTHER_GROUP = 'VintageLights';
const CLEAN_HEADERS = { 'X-Touch-Control-Owner': CLEAN_OWNER };
const DEAD_HEADERS = { 'X-Touch-Control-Owner': DEAD_OWNER };
const OSC_PORT = 31570;
const ALL_PIXEL_INDICES = Array.from({ length: 166 }, (_, index) => index);

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-session-isolation-config-'));
const configPath = writeBlackHoledConfig(configDir, { enabled: false });
const isolatedConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
isolatedConfig.osc = {
  ...(isolatedConfig.osc || {}),
  enabled: true,
  host: '127.0.0.1',
  port: OSC_PORT,
};
isolatedConfig.fire_sync = { ...(isolatedConfig.fire_sync || {}), enabled: false };
fs.writeFileSync(configPath, yaml.dump(isolatedConfig), 'utf8');

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'live-touch-session-isolation',
  portBase: 9450,
  portSpan: 200,
  extraEnv: {
    MARSIN_CONFIG_FILE: configPath,
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: '1200',
  },
  extraArgs: ['--dest', '127.0.0.9'],
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openControl(ownerId) {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const messages = [];
  ws.on('message', raw => {
    try { messages.push(JSON.parse(raw)); } catch { /* unrelated binary telemetry */ }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId }));
  await waitForMessage(messages, message => message.type === 'touchControlHelloAck');
  return { ws, messages, ownerId };
}

async function waitForMessage(messages, predicate, timeoutMs = 4000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(25);
  }
  assert.fail(`timed out waiting for WS message; received ${JSON.stringify(messages)}`);
}

async function setArmed(control, armed) {
  const priorCount = control.messages.length;
  control.ws.send(JSON.stringify({
    type: 'touchControlArmed',
    ownerId: control.ownerId,
    armed,
  }));
  return waitForMessage(
    control.messages,
    (message, index) => index >= priorCount
      && message.type === 'touchControlArmedAck'
      && message.requestedArmed === armed,
  );
}

async function waitForLayer(predicate, timeoutMs = 6000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/layers/state');
    assert.equal(response.status, 200);
    last = response.data;
    if (predicate(last)) return last;
    await sleep(40);
  }
  assert.fail(`timed out waiting for layer state; last ${JSON.stringify(last)}`);
}

async function waitForSharedSpeed(expected, timeoutMs = 2500) {
  const startedAt = Date.now();
  let last;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/param-center');
    last = response.data.params.speed.value;
    if (Math.abs(last - expected) < 1e-5) return last;
    await sleep(30);
  }
  assert.fail(`shared speed did not reach ${expected}; last ${last}`);
}

async function sendOscSpeed(value) {
  const packet = osc.toBuffer({
    address: '/marsin/param/speed',
    args: [{ type: 'float', value }],
  });
  const buffer = Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength);
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.send(buffer, OSC_PORT, '127.0.0.1', error => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

function stateFileSnapshot() {
  const snapshot = {};
  for (const name of fs.readdirSync(h.stateDir).sort()) {
    const file = path.join(h.stateDir, name);
    if (fs.statSync(file).isFile()) snapshot[name] = fs.readFileSync(file);
  }
  return snapshot;
}

function assertStateFilesEqual(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const name of Object.keys(expected)) {
    assert.ok(actual[name].equals(expected[name]), `${name} changed during a private Live session`);
  }
}

async function sharedCreativeSnapshot() {
  const [params, effectGroups, parkedGroups, colors, spatial, slots, bindings, globals, mixer] =
    await Promise.all([
      h.api('GET', '/param-center'),
      h.api('GET', '/effect-groups'),
      h.api('GET', '/parked-groups'),
      h.api('GET', '/group-fixed-colors'),
      h.api('GET', '/spatial-paint'),
      h.api('GET', '/global-effect-slots'),
      h.api('GET', '/audio-bindings'),
      h.api('GET', '/globals'),
      h.api('GET', '/mixer'),
    ]);
  for (const response of [
    params, effectGroups, parkedGroups, colors, spatial, slots, bindings, globals, mixer,
  ]) assert.equal(response.status, 200);
  return {
    params: params.data,
    effectGroups: effectGroups.data,
    parkedGroups: parkedGroups.data,
    colors: colors.data,
    spatial: spatial.data,
    slots: slots.data,
    bindings: bindings.data.bindings,
    effects: globals.data.effects,
    tempo: {
      tempoBpm: mixer.data.tempoBpm,
      tempoSource: mixer.data.tempoSource,
      tempoSourcePref: mixer.data.tempoSourcePref,
    },
  };
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
  fs.rmSync(configDir, { recursive: true, force: true });
});

test('owner-scoped Live creative state never mutates Deck/Mixer or persistence', async () => {
  let response = await h.api('PUT', '/layers/live_touch/pattern', { pattern: 'test_const' });
  assert.equal(response.status, 200, JSON.stringify(response.data));

  response = await h.api('POST', '/param-center', {
    speed: 0.61,
    colorPalette1: { h: 0.13, s: 0.72, v: 0.81 },
    colorTransitionMs: 345,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('PUT', '/effect-groups', { groups: [GROUP] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('PUT', '/parked-groups', { groups: [OTHER_GROUP] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('PUT', `/group-fixed-colors/${GROUP}`, {
    color: [0.11, 0.22, 0.33, 0.44, 0.55, 0.66],
    brightness: 0.58,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/global-effect', { effect: 'uvBlast', state: true });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('PATCH', '/global-effect-slots/1', { label: 'Shared Slot One' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('PUT', `/audio-bindings/groups/${GROUP}`, {
    source: 'bpmPulse', mode: 'level', depth: 0.41,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/mixer/tempo', { bpm: 137 });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/spatial-paint', {
    enabled: true,
    axisX: 'nx', axisY: 'nz', pixelIndices: ALL_PIXEL_INDICES,
    touch: false,
    targetX: 0.2,
    targetY: 0.7,
    mode: 'trail',
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));

  // Let every ordinary shared-state debounce settle before taking the durable
  // baseline. No Live request below is allowed to touch these bytes.
  await sleep(700);
  const before = await sharedCreativeSnapshot();
  const filesBefore = stateFileSnapshot();

  const control = await openControl(CLEAN_OWNER);
  const armAck = await setArmed(control, true);
  assert.equal(armAck.armed, true);

  // ONE DESK: WS and OSC writes to shared CPC are rejected while the private
  // Live API remains writable by the lease owner.
  const rejectionStart = control.messages.length;
  control.ws.send(JSON.stringify({
    type: 'setSharedParam', key: 'speed', value: 0.02, origin: 'competing_ws',
  }));
  const rejected = await waitForMessage(
    control.messages,
    (message, index) => index >= rejectionStart
      && message.type === 'paramRejected'
      && message.key === 'speed',
  );
  assert.equal(rejected.reason, 'source_lock');
  await sendOscSpeed(0.03);
  await sleep(150);
  assert.equal((await h.api('GET', '/param-center')).data.params.speed.value, 0.61,
    'OSC must not mutate shared CPC while Live owns the source lock');

  const writes = [
    h.api('POST', '/param-center', {
      speed: 0.14,
      colorPalette1: { h: 0.87, s: 0.91, v: 0.93 },
      colorTransitionMs: 876,
    }, CLEAN_HEADERS),
    h.api('PUT', '/effect-groups', { groups: [OTHER_GROUP] }, CLEAN_HEADERS),
    h.api('PUT', '/parked-groups', { groups: [GROUP] }, CLEAN_HEADERS),
    h.api('PUT', `/group-fixed-colors/${GROUP}`, {
      color: [0.91, 0.12, 0.23, 0.34, 0.45, 0.56],
      brightness: 0.27,
    }, CLEAN_HEADERS),
    h.api('POST', '/global-effect', { effect: 'blastWhite', state: true }, CLEAN_HEADERS),
    h.api('PATCH', '/global-effect-slots/1', { label: 'Private Live Slot' }, CLEAN_HEADERS),
    h.api('PUT', `/audio-bindings/groups/${GROUP}`, {
      source: 'bpmPulse', mode: 'level', depth: 0.88,
    }, CLEAN_HEADERS),
    h.api('POST', '/mixer/tempo', { bpm: 177 }, CLEAN_HEADERS),
    h.api('POST', '/spatial-paint', {
      enabled: true,
      axisX: 'nx', axisY: 'nz', pixelIndices: ALL_PIXEL_INDICES,
      touch: true,
      targetX: 0.8,
      targetY: 0.3,
      mode: 'erase',
      radius: 0.2,
      radiusY: 0.2,
      amount: 0.7,
    }, CLEAN_HEADERS),
  ];
  for (const result of await Promise.all(writes)) {
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }

  const localParams = await h.api('GET', '/param-center', undefined, CLEAN_HEADERS);
  assert.equal(localParams.data.params.speed.value, 0.14);
  assert.deepEqual((await h.api('GET', '/effect-groups', undefined, CLEAN_HEADERS)).data.groups,
    [OTHER_GROUP]);
  assert.deepEqual((await h.api('GET', '/parked-groups', undefined, CLEAN_HEADERS)).data.groups,
    [GROUP]);
  assert.equal((await h.api('GET', '/group-fixed-colors', undefined, CLEAN_HEADERS))
    .data.overrides[GROUP].brightness, 0.27);
  assert.equal((await h.api('GET', '/global-effect-slots', undefined, CLEAN_HEADERS))
    .data.slots[0].label, 'Private Live Slot');
  assert.equal((await h.api('GET', '/mixer', undefined, CLEAN_HEADERS)).data.tempoBpm, 177);

  // The private writes are visible through owner-tagged reads but every shared
  // API and every durable file remains byte-for-byte at its pre-ARM value.
  assert.deepEqual(await sharedCreativeSnapshot(), {
    ...before,
    params: {
      ...before.params,
      sourceLock: { mode: 'global', source: 'api' },
    },
  });
  assertStateFilesEqual(stateFileSnapshot(), filesBefore);

  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch', durationMs: 80, ownerId: CLEAN_OWNER,
  }, CLEAN_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(state => state.active === 'live_touch' && state.transition === null);
  response = await h.api('POST', '/layers/activate', {
    target: 'deck', durationMs: 80, ownerId: CLEAN_OWNER,
  }, CLEAN_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(state => state.active === 'deck' && state.transition === null
    && state.liveTouch.armed === true);
  const disarmAck = await setArmed(control, false);
  assert.equal(disarmAck.armed, false);
  await waitForLayer(state => state.active === 'deck' && !state.liveTouch.armed);

  assert.deepEqual(await sharedCreativeSnapshot(), before,
    'clean disarm must restore the exact pre-ARM shared creative state');
  assertStateFilesEqual(stateFileSnapshot(), filesBefore);

  // Prove the OSC packet above was blocked by ownership, not by a dead input
  // path: once the exact source lock is restored, the same source may write.
  await sendOscSpeed(0.72);
  await waitForSharedSpeed(0.72);
  response = await h.api('POST', '/param-center', { speed: 0.61 });
  assert.equal(response.status, 200);
  control.ws.close();
});

test('deadman discards private Live paint but preserves pre-existing durable paint', async () => {
  await sleep(400);
  const durableBefore = await h.api('GET', '/group-fixed-colors');
  assert.ok(durableBefore.data.overrides[GROUP], 'precondition: durable group paint exists');

  const control = await openControl(DEAD_OWNER);
  await setArmed(control, true);
  let response = await h.api('PUT', `/group-fixed-colors/${GROUP}`, {
    color: [0.99, 0.01, 0.02, 0.03, 0.04, 0.05],
    brightness: 0.19,
  }, DEAD_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/spatial-paint', {
    enabled: true,
    axisX: 'nx', axisY: 'nz', pixelIndices: ALL_PIXEL_INDICES,
    touch: true,
    targetX: 0.5,
    targetY: 0.5,
    mode: 'erase',
    radius: 0.3,
    radiusY: 0.3,
    amount: 1,
  }, DEAD_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch', durationMs: 80, ownerId: DEAD_OWNER,
  }, DEAD_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(state => state.active === 'live_touch' && state.transition === null);

  control.ws.terminate();
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null
      && state.liveTouch.armed === false,
    7000,
  );

  const durableAfter = await h.api('GET', '/group-fixed-colors');
  assert.deepEqual(durableAfter.data.overrides[GROUP], durableBefore.data.overrides[GROUP],
    'deadman must not delete or replace the durable color underneath Live paint');
  const globalsText = fs.readFileSync(path.join(h.stateDir, 'globals_state.yaml'), 'utf8');
  assert.match(globalsText, /groupFixedColors:/);
  assert.match(globalsText, /ParLights:/);

  // A fresh owner begins from a fresh private context; no dead paint or stuck
  // ERASE survives the liveness handback.
  const fresh = await openControl('live_session_fresh');
  await setArmed(fresh, true);
  const freshHeaders = { 'X-Touch-Control-Owner': 'live_session_fresh' };
  assert.equal((await h.api('GET', '/group-fixed-colors', undefined, freshHeaders))
    .data.overrides[GROUP], undefined);
  const freshSpatial = await h.api('GET', '/spatial-paint', undefined, freshHeaders);
  assert.equal(freshSpatial.data.enabled, false);
  assert.equal(freshSpatial.data.touch, false);
  await setArmed(fresh, false);
  fresh.ws.close();
});
