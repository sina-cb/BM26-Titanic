/**
 * Real-engine contract for transient Live Touch brightness authority.
 *
 * This proves the HTTP/WS surface against the actual engine lifecycle, not a
 * helper stub: ARM ownership, optimistic revision writes, Dimmer Rack
 * precedence, fades, replay, and post-blend handback reset.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_ID = 'brightness_authority_api';
const OWNER_HEADERS = { 'X-Touch-Control-Owner': OWNER_ID };

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'touch-brightness-authority-api',
  portBase: 9100,
  portSpan: 300,
  extraEnv: {
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: '10000',
  },
  extraArgs: ['--dest', '127.0.0.9'],
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForMessage(messages, predicate, message, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(25);
  }
  assert.fail(`${message}; received: ${JSON.stringify(messages)}`);
}

async function waitForBrightness(predicate, message, timeoutMs = 5000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/touch-control/brightness');
    assert.equal(response.status, 200);
    last = response.data;
    if (predicate(last)) return last;
    await sleep(25);
  }
  assert.fail(`${message}; last brightness: ${JSON.stringify(last)}`);
}

async function waitForLayer(predicate, message, timeoutMs = 5000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/layers/state');
    assert.equal(response.status, 200);
    last = response.data;
    if (predicate(last)) return last;
    await sleep(25);
  }
  assert.fail(`${message}; last layer state: ${JSON.stringify(last)}`);
}

async function openControlSocket() {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const messages = [];
  ws.on('message', raw => {
    try {
      messages.push(JSON.parse(raw));
    } catch {
      // Other telemetry is irrelevant to this contract test.
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await waitForMessage(
    messages,
    message => message.type === 'touchControlBrightness',
    'late control socket did not receive brightness replay',
  );
  await waitForMessage(
    messages,
    message => message.type === 'dimmerState',
    'late control socket did not receive Dimmer Rack authority replay',
  );
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER_ID }));
  await waitForMessage(
    messages,
    message => message.type === 'touchControlHelloAck',
    'control hello was not acknowledged',
  );
  return { ws, messages };
}

async function arm(control) {
  const priorCount = control.messages.length;
  control.ws.send(JSON.stringify({
    type: 'touchControlArmed',
    ownerId: OWNER_ID,
    armed: true,
  }));
  return waitForMessage(
    control.messages,
    (message, index) => index >= priorCount
      && message.type === 'touchControlArmedAck'
      && message.armed === true,
    'ARM was not acknowledged',
  );
}

async function disarm(control) {
  const priorCount = control.messages.length;
  control.ws.send(JSON.stringify({
    type: 'touchControlArmed',
    ownerId: OWNER_ID,
    armed: false,
  }));
  return waitForMessage(
    control.messages,
    (message, index) => index >= priorCount
      && message.type === 'touchControlArmedAck'
      && message.requestedArmed === false,
    'DISARM was not acknowledged',
  );
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('Live brightness stays transient and subordinate to the writable Dimmer Rack', async () => {
  const initial = await h.api('GET', '/touch-control/brightness');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.active, false);
  assert.equal(initial.data.ownerId, null);
  assert.equal(initial.data.master, 1);
  assert.ok(Object.values(initial.data.groups).every(value => value === 1));

  let response = await h.api('PUT', '/touch-control/brightness', {
    expectedRevision: initial.data.revision,
    master: 0.5,
    groups: initial.data.groups,
  }, OWNER_HEADERS);
  assert.equal(response.status, 409, 'a stale/unarmed Touch owner must not write brightness');
  assert.equal(response.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');

  const control = await openControlSocket();
  const initialDimmerMessage = control.messages.find(message => message.type === 'dimmerState');
  assert.equal(initialDimmerMessage.revision, 0,
    'late-join rack replay starts with the process-local monotonic revision');
  await arm(control);

  const active = await waitForBrightness(
    state => state.active === true && state.ownerId === OWNER_ID,
    'ARM did not activate transient Live brightness',
  );
  const dimmerGroupsResponse = await h.api('GET', '/dimmer-groups');
  assert.equal(dimmerGroupsResponse.status, 200);
  const groupEntries = Object.entries(dimmerGroupsResponse.data);
  assert.ok(groupEntries.length > 0, 'test model must expose at least one Dimmer Rack group');
  const [groupName, sectionId] = groupEntries[0];

  const replacementGroups = Object.fromEntries(groupEntries.map(([name]) => [name, 1]));
  replacementGroups[groupName] = 0.5;
  response = await h.api('PUT', '/touch-control/brightness', {
    expectedRevision: active.revision,
    master: 0.8,
    groups: replacementGroups,
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.master, 0.8);
  assert.equal(response.data.groups[groupName], 0.5);
  assert.equal(response.data.effectiveCaps[groupName], 0.4);
  let revision = response.data.revision;

  const committed = response.data;
  response = await h.api('PATCH', '/touch-control/brightness', {
    expectedRevision: revision,
    master: 0.2,
    groups: { [groupName]: 2 },
  }, OWNER_HEADERS);
  assert.equal(response.status, 400, 'a partially-invalid patch must fail as one transaction');
  const afterRejectedPatch = await h.api('GET', '/touch-control/brightness');
  assert.equal(afterRejectedPatch.data.master, committed.master);
  assert.equal(afterRejectedPatch.data.groups[groupName], committed.groups[groupName]);
  assert.equal(afterRejectedPatch.data.revision, revision);

  response = await h.api('PATCH', '/touch-control/brightness', {
    expectedRevision: revision - 1,
    master: 0.6,
  }, OWNER_HEADERS);
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'TOUCH_BRIGHTNESS_STALE_REVISION');

  response = await h.api('PATCH', '/touch-control/brightness', {
    expectedRevision: revision,
    groups: { [groupName]: 0.25 },
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  revision = response.data.revision;

  // The higher-authority Dimmer Rack deliberately remains writable by its
  // untagged client even while Live Touch owns the lower ARM lease.
  response = await h.api('POST', '/section-brightness', {
    sectionId,
    brightness: 0.3,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.revision, initialDimmerMessage.revision + 1);
  const capped = await h.api('GET', '/touch-control/brightness');
  assert.equal(capped.data.master, 0.8);
  assert.equal(capped.data.groups[groupName], 0.25);
  assert.equal(capped.data.rackCeilings[groupName], 0.3);
  assert.ok(Math.abs(capped.data.effectiveCaps[groupName] - 0.06) < 1e-12);
  assert.equal(capped.data.rackRevision, response.data.revision,
    'brightness reads must identify the exact Dimmer Rack authority revision');

  const rackRevision = response.data.revision;
  response = await h.api('POST', '/section-brightness', {
    sectionId,
    brightness: 0.3,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.revision, rackRevision,
    'an idempotent rack write must not manufacture an authority revision');

  response = await h.api('POST', '/section-brightness', {
    sectionId,
    brightness: 1,
  }, OWNER_HEADERS);
  assert.equal(response.status, 403, 'Live Touch must not overwrite the authoritative rack');
  assert.equal(response.data.code, 'TOUCH_CANNOT_WRITE_DIMMER_RACK');

  response = await h.api('POST', '/touch-control/brightness/master/fade', {
    expectedRevision: revision,
    target: 0.4,
    durationMs: 100,
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(response.data.masterFade, 'fade endpoint must expose the in-flight engine ramp');
  revision = response.data.revision;
  const faded = await waitForBrightness(
    state => state.masterFade === null && state.master === 0.4,
    'engine-clocked Live master fade did not land exactly',
  );
  assert.equal(faded.revision, revision, 'fade progress must not manufacture write revisions');

  assert.ok(
    control.messages.some(message => message.type === 'touchControlBrightness'
      && message.active === true && message.ownerId === OWNER_ID),
    'brightness mutations must broadcast on the control topic',
  );
  assert.ok(
    control.messages.some(message => message.type === 'dimmerState'
      && message.revision === rackRevision
      && message.rackCeilings && message.rackCeilings[groupName] === 0.3),
    'Dimmer Rack changes must broadcast their higher-authority ceiling',
  );

  // Prove the lifecycle reset on the real canonical layer router. ARM remains
  // held through the outgoing blend and the post-landing cleanup window, then
  // the explicit ARM false releases every transient authority atomically.
  response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: 'test_const',
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 50,
    ownerId: OWNER_ID,
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(
    state => state.active === 'live_touch' && state.transition === null,
    'Live Touch did not land',
  );
  response = await h.api('POST', '/layers/activate', {
    target: 'deck',
    durationMs: 50,
    ownerId: OWNER_ID,
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null
      && state.liveTouch.armed === true,
    'Deck handback did not land with cleanup authorization held',
  );
  const releaseAck = await disarm(control);
  assert.equal(releaseAck.armed, false);
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null
      && state.liveTouch.armed === false,
    'explicit post-cleanup ARM false did not release ARM',
  );
  const reset = await waitForBrightness(
    state => state.active === false,
    'Deck handback did not reset transient brightness',
  );
  assert.equal(reset.ownerId, null);
  assert.equal(reset.master, 1);
  assert.ok(Object.values(reset.groups).every(value => value === 1));
  assert.equal(reset.rackCeilings[groupName], 0.3,
    'transient reset must not alter the authoritative rack');

  const dimmers = await h.api('GET', '/dimmers');
  assert.equal(dimmers.status, 200);
  assert.equal(dimmers.data[sectionId], 0.3, 'Dimmer Rack state must survive Live handback');
  control.ws.close();
});
