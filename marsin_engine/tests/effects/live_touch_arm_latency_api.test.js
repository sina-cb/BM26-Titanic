import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import yaml from 'js-yaml';
import { WebSocket } from 'ws';

import { writeBlackHoledConfig } from '../e2e/timeline_e2e_harness.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_ID = 'live_touch_arm_latency';
const OWNER_HEADERS = { 'X-Touch-Control-Owner': OWNER_ID };
const SAMPLE_COUNT = 12;

const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-arm-latency-config-'));
const configPath = writeBlackHoledConfig(configDir, { enabled: false });
const isolatedConfig = yaml.load(fs.readFileSync(configPath, 'utf8'));
isolatedConfig.fire_sync = { ...(isolatedConfig.fire_sync || {}), enabled: false };
fs.writeFileSync(configPath, yaml.dump(isolatedConfig), 'utf8');

const h = createEngineHarness({
  scene: 'titanic',
  pattern: '13_sparkle',
  prefix: 'live-touch-arm-latency',
  portBase: 31569,
  portSpan: 1,
  extraEnv: {
    MARSIN_CONFIG_FILE: configPath,
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: '10000',
  },
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForMessage(messages, predicate, timeoutMs = 4000) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(10);
  }
  assert.fail(`timed out waiting for WS message; received ${JSON.stringify(messages)}`);
}

async function openControl() {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const messages = [];
  ws.on('message', raw => {
    try { messages.push(JSON.parse(raw)); } catch { /* unrelated binary telemetry */ }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER_ID }));
  await waitForMessage(messages, message => message.type === 'touchControlHelloAck');
  return { ws, messages };
}

async function setArmed(control, armed) {
  const priorCount = control.messages.length;
  const startedAt = performance.now();
  control.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER_ID, armed }));
  const ack = await waitForMessage(
    control.messages,
    (message, index) => index >= priorCount
      && message.type === 'touchControlArmedAck'
      && message.requestedArmed === armed,
  );
  return { ack, roundTripMs: performance.now() - startedAt };
}

async function waitForLanding(target, startedAt, timeoutMs = 500) {
  let last = null;
  while (performance.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/layers/state');
    assert.equal(response.status, 200);
    last = response.data;
    if (last.active === target && last.transition === null) {
      return performance.now() - startedAt;
    }
    await sleep(5);
  }
  assert.fail(`layer ${target} did not land; last=${JSON.stringify(last)}`);
}

function percentile(samples, percentileValue) {
  const ordered = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentileValue * ordered.length) - 1);
  return ordered[index];
}

function buildOperations(groups, hue, localControlId) {
  const pixelIndices = Array.from({ length: 964 }, (_, index) => index);
  const operations = [
    { method: 'POST', path: '/global-effects/disable-all', body: {} },
    { method: 'POST', path: '/audio-bindings/clear', body: {} },
    { method: 'PUT', path: '/effect-groups', body: { groups: null } },
    { method: 'PUT', path: '/parked-groups', body: { groups: null } },
    {
      method: 'POST',
      path: '/param-center',
      body: {
        speed: 0.57,
        colorPalette1: { h: hue, s: 0.83, v: 0.91 },
        colorPalette2: { h: (hue + 0.5) % 1, s: 0.74, v: 0.87 },
        colorTransitionMs: 0,
      },
    },
    { method: 'PATCH', path: '/global-effect-slots/1', body: { label: 'Prepared Live' } },
    { method: 'POST', path: '/global-effect', body: { effect: 'uvBlast', state: true } },
    {
      method: 'POST',
      path: '/spatial-paint',
      body: {
        enabled: true, touch: false, targetX: 0.5, targetY: 0.5,
        axisX: 'nx', axisY: 'nz', pixelIndices, fadeSeconds: 0.5,
      },
    },
    {
      method: 'PUT',
      path: `/audio-bindings/groups/${encodeURIComponent(groups[0])}`,
      body: { source: 'bpmPulse', mode: 'level', depth: 0.4 },
    },
    {
      method: 'POST',
      path: '/layers/live_touch/control',
      body: { id: localControlId, v0: 0.63, v1: 0, v2: 0 },
    },
  ];
  for (const group of groups) {
    operations.push({
      method: 'PUT',
      path: `/group-fixed-colors/${encodeURIComponent(group)}`,
      body: {
        color: [hue, 0.31, 0.72, 0.18, 0.22, 0.09],
        brightness: 0.68,
      },
    });
  }
  return operations;
}

function buildBrightness(brightnessState, scalar) {
  return {
    expectedRevision: brightnessState.revision,
    master: scalar,
    groups: Object.fromEntries(Object.keys(brightnessState.groups).map(name => [name, scalar])),
  };
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
    assert.ok(actual[name].equals(expected[name]), `${name} changed during atomic Live prepare`);
  }
}

async function sharedSnapshot() {
  const [params, colors, effects, mixer] = await Promise.all([
    h.api('GET', '/param-center'),
    h.api('GET', '/group-fixed-colors'),
    h.api('GET', '/globals'),
    h.api('GET', '/mixer'),
  ]);
  for (const response of [params, colors, effects, mixer]) {
    assert.equal(response.status, 200, JSON.stringify(response.data));
  }
  return {
    params: params.data,
    colors: colors.data,
    effects: effects.data.effects,
    tempo: {
      tempoBpm: mixer.data.tempoBpm,
      tempoSource: mixer.data.tempoSource,
      tempoSourcePref: mixer.data.tempoSourcePref,
    },
  };
}

test('ARM prepare atomically replaces 24-group Live state and lands in 100 ms', async () => {
  let control = null;
  try {
    h.spawnEngine();
    await h.waitForReady();
    let response = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: 0,
      operations: [{ method: 'POST', path: '/global-effects/disable-all', body: {} }],
    }, OWNER_HEADERS);
    assert.equal(response.status, 409);
    assert.equal(response.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');

    control = await openControl();

    const armed = await setArmed(control, true);
    assert.equal(armed.ack.armed, true);
    assert.ok(Number.isInteger(armed.ack.sessionRevision));
    assert.ok(armed.ack.timing.serverMs >= 0);
    assert.ok(armed.roundTripMs < 250, `ARM lease took ${armed.roundTripMs.toFixed(1)} ms`);

    let startedAt = performance.now();
    response = await h.api(
      'PUT',
      '/layers/live_touch/pattern',
      { pattern: '13_sparkle' },
      OWNER_HEADERS,
    );
    const stageRoundTripMs = performance.now() - startedAt;
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.ok(response.data.timing.stageMs >= 0);
    const stageServerMs = response.data.timing.stageMs;
    assert.ok(
      stageRoundTripMs < 1000,
      `Live pattern staging took ${stageRoundTripMs.toFixed(1)} ms`,
    );

    const exportsResponse = await h.api(
      'GET', '/layers/live_touch/exports', undefined, OWNER_HEADERS,
    );
    assert.equal(exportsResponse.status, 200, JSON.stringify(exportsResponse.data));
    const localControl = exportsResponse.data.find(entry => entry.kind === 1);
    assert.ok(localControl, '13_sparkle must expose a setting-local slider for prepare');

    let brightness = (await h.api(
      'GET', '/touch-control/brightness', undefined, OWNER_HEADERS,
    )).data;
    const colors = await h.api('GET', '/group-fixed-colors', undefined, OWNER_HEADERS);
    assert.equal(colors.status, 200, JSON.stringify(colors.data));
    const groups = colors.data.groups;
    assert.equal(groups.length, 24, 'Titanic prepare benchmark must cover all 24 fixture groups');
    const sharedBeforePrepare = await sharedSnapshot();
    const filesBeforePrepare = stateFileSnapshot();

    let sessionRevision = response.data.sessionRevision;
    const initialOperations = buildOperations(groups, 0.17, localControl.id);
    response = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: armed.ack.sessionRevision,
      operations: initialOperations,
      brightness: buildBrightness(brightness, 0.74),
    }, OWNER_HEADERS);
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(response.data.code, 'LIVE_TOUCH_PREPARE_STALE_REVISION',
      'pattern staging must invalidate the ARM acknowledgement revision');

    startedAt = performance.now();
    response = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: sessionRevision,
      operations: initialOperations,
      brightness: buildBrightness(brightness, 0.74),
    }, OWNER_HEADERS);
    const initialPrepareRoundTripMs = performance.now() - startedAt;
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.operationCount, initialOperations.length);
    assert.ok(response.data.timing.totalMs >= 0);
    sessionRevision = response.data.sessionRevision;
    brightness = (await h.api(
      'GET', '/touch-control/brightness', undefined, OWNER_HEADERS,
    )).data;

    const beforeInvalid = {
      params: (await h.api('GET', '/param-center', undefined, OWNER_HEADERS)).data,
      colors: (await h.api('GET', '/group-fixed-colors', undefined, OWNER_HEADERS)).data,
      brightness,
    };
    const invalidOperations = buildOperations(groups, 0.91, localControl.id);
    invalidOperations.push({
      method: 'PUT',
      path: '/group-fixed-colors/not-a-model-group',
      body: { color: [1, 0, 0, 0, 0, 0], brightness: 1 },
    });
    response = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: sessionRevision,
      operations: invalidOperations,
      brightness: buildBrightness(brightness, 0.12),
    }, OWNER_HEADERS);
    assert.equal(response.status, 400, JSON.stringify(response.data));
    assert.equal(response.data.code, 'LIVE_TOUCH_PREPARE_INVALID');
    assert.equal(response.data.operationIndex, invalidOperations.length - 1);
    assert.deepEqual(
      (await h.api('GET', '/param-center', undefined, OWNER_HEADERS)).data,
      beforeInvalid.params,
      'a rejected prepare must not partially change CPC state',
    );
    assert.deepEqual(
      (await h.api('GET', '/group-fixed-colors', undefined, OWNER_HEADERS)).data,
      beforeInvalid.colors,
      'a rejected prepare must not partially change 24-group paint',
    );
    assert.deepEqual(
      (await h.api('GET', '/touch-control/brightness', undefined, OWNER_HEADERS)).data,
      beforeInvalid.brightness,
      'a rejected prepare must not partially change Live brightness',
    );

    const prepareSamples = [];
    const serverSamples = [];
    for (let index = 0; index < SAMPLE_COUNT; index++) {
      const hue = (0.23 + index * 0.047) % 1;
      const operations = buildOperations(groups, hue, localControl.id);
      startedAt = performance.now();
      response = await h.api('POST', '/layers/live_touch/prepare', {
        expectedSessionRevision: sessionRevision,
        operations,
        brightness: buildBrightness(brightness, 0.55 + (index % 3) * 0.1),
      }, OWNER_HEADERS);
      prepareSamples.push(performance.now() - startedAt);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      serverSamples.push(response.data.timing.totalMs);
      sessionRevision = response.data.sessionRevision;
      brightness = (await h.api(
        'GET', '/touch-control/brightness', undefined, OWNER_HEADERS,
      )).data;
    }
    assert.deepEqual(await sharedSnapshot(), sharedBeforePrepare,
      'atomic Live prepare leaked creative state into Deck/Mixer authorities');
    assertStateFilesEqual(stateFileSnapshot(), filesBeforePrepare);

    const prepareP50 = percentile(prepareSamples, 0.50);
    const prepareP95 = percentile(prepareSamples, 0.95);
    const serverP50 = percentile(serverSamples, 0.50);
    const serverP95 = percentile(serverSamples, 0.95);
    assert.ok(prepareP95 < 500, `atomic prepare p95 took ${prepareP95.toFixed(1)} ms`);

    startedAt = performance.now();
    response = await h.api('POST', '/layers/activate', {
      target: 'live_touch',
      ownerId: OWNER_ID,
      reason: 'latency_contract',
    }, OWNER_HEADERS);
    const activateAckMs = performance.now() - startedAt;
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.transition.durationMs, 100);
    assert.equal(response.data.transition.curve, 'linear');
    assert.equal(response.data.timing.blendDurationMs, 100);
    const liveLandMs = await waitForLanding('live_touch', startedAt);
    assert.ok(liveLandMs >= 75, `Live blend landed too early at ${liveLandMs.toFixed(1)} ms`);
    assert.ok(liveLandMs <= 350, `Live blend landed too late at ${liveLandMs.toFixed(1)} ms`);

    startedAt = performance.now();
    response = await h.api('POST', '/layers/activate', {
      target: 'deck', ownerId: OWNER_ID, reason: 'latency_contract_cleanup',
    }, OWNER_HEADERS);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    await waitForLanding('deck', startedAt);
    const disarmed = await setArmed(control, false);
    assert.equal(disarmed.ack.armed, false);

    process.stdout.write(`live_touch_arm_latency=${JSON.stringify({
      armRoundTripMs: Number(armed.roundTripMs.toFixed(3)),
      armServerMs: armed.ack.timing.serverMs,
      armLeaseMutationMs: armed.ack.timing.leaseMutationMs,
      stageRoundTripMs: Number(stageRoundTripMs.toFixed(3)),
      stageServerMs,
      initialPrepareRoundTripMs: Number(initialPrepareRoundTripMs.toFixed(3)),
      prepareRoundTripP50Ms: Number(prepareP50.toFixed(3)),
      prepareRoundTripP95Ms: Number(prepareP95.toFixed(3)),
      prepareServerP50Ms: serverP50,
      prepareServerP95Ms: serverP95,
      activateAckMs: Number(activateAckMs.toFixed(3)),
      liveLandMs: Number(liveLandMs.toFixed(3)),
      groups: groups.length,
      operationsPerPrepare: initialOperations.length,
      samples: SAMPLE_COUNT,
    })}\n`);
  } finally {
    if (control) control.ws.close();
    await h.teardown();
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
