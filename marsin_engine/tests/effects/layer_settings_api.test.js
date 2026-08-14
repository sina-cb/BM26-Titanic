import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_ID = 'layer_settings_api';
const OWNER_HEADERS = { 'X-Touch-Control-Owner': OWNER_ID };

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'layer-settings-api',
  portBase: 8400,
  portSpan: 300,
  extraEnv: {
    MARSIN_VSN1_DEPLOY: '0',
    BM26_ARM_LEASE_MS: '10000',
  },
  extraArgs: ['--dest', '127.0.0.9'],
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForLayer(predicate, message, timeoutMs = 5000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await h.api('GET', '/layers/state');
    assert.equal(response.status, 200);
    last = response.data;
    if (predicate(last)) return last;
    await sleep(50);
  }
  assert.fail(`${message}; last state: ${JSON.stringify(last)}`);
}

async function openControlSocket() {
  const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
  const messages = [];
  ws.on('message', raw => {
    try {
      messages.push(JSON.parse(raw));
    } catch {
      // Other control telemetry is irrelevant to this contract test.
    }
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER_ID }));
  await waitForMessage(messages, message => message.type === 'touchControlHelloAck');
  return { ws, messages };
}

async function waitForMessage(messages, predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = messages.find(predicate);
    if (found) return found;
    await sleep(25);
  }
  assert.fail(`timed out waiting for WS message; received: ${JSON.stringify(messages)}`);
}

async function setArmed(control, armed) {
  const priorCount = control.messages.length;
  await new Promise((resolve, reject) => {
    control.ws.send(JSON.stringify({
      type: 'touchControlArmed',
      ownerId: OWNER_ID,
      armed,
    }), error => error ? reject(error) : resolve());
  });
  return waitForMessage(
    control.messages,
    (message, index) => index >= priorCount &&
      message.type === 'touchControlArmedAck' &&
      message.requestedArmed === armed,
  );
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('layer settings API gates Live with ARM and owns both handback paths', async () => {
  const initial = await h.api('GET', '/layers/state');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.type, 'layerSettings');
  assert.equal(initial.data.active, 'deck');
  assert.equal(initial.data.transition, null);
  assert.deepEqual(initial.data.liveTouch, {
    armed: false,
    ownerId: null,
    ready: false,
    pattern: null,
  });

  let response = await h.api('POST', '/layers/activate', { target: 'unknown' });
  assert.equal(response.status, 400);
  assert.equal(response.data.code, 'INVALID_LAYER_SETTING');

  response = await h.api('PUT', '/layers/live_touch/pattern', { pattern: 'test_const' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.pattern, 'test_const');

  response = await h.api(
    'PUT',
    '/layers/live_touch/pattern',
    { pattern: 'test_const' },
    OWNER_HEADERS,
  );
  assert.equal(response.status, 409,
    'an owner-scoped Live write must not be accepted before its ARM session exists');
  assert.equal(response.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');

  response = await h.api('GET', '/layers/live_touch/exports');
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(Array.isArray(response.data));

  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 100,
    ownerId: OWNER_ID,
  });
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'LIVE_TOUCH_ARM_REQUIRED');

  // Deck and Mixer need no ARM and use the same canonical transition API.
  // Mixer must first have a configured contributor; accepting an empty stack
  // would report success while crossfading the rig to black.
  response = await h.api('POST', '/mixer/channels', {
    pattern: '13_sparkle',
    name: 'Layer settings readiness',
    mode: 'blend_screen',
    fader: 1,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await h.api('POST', '/layers/activate', {
    target: 'mixer',
    durationMs: 100,
    reason: 'api_contract_test',
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.transition.from, 'deck');
  assert.equal(response.data.transition.to, 'mixer');
  await waitForLayer(
    state => state.active === 'mixer' && state.transition === null,
    'Deck -> Mixer did not land',
  );

  response = await h.api('POST', '/layers/activate', {
    target: 'deck',
    durationMs: 100,
    reason: 'api_contract_test',
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null,
    'Mixer -> Deck did not land',
  );

  const deckBefore = await h.api('GET', '/deck/channel');
  assert.equal(deckBefore.status, 200);
  const deckPatternBefore = deckBefore.data.pattern;
  const control = await openControlSocket();
  assert.ok(control.messages.some(message => message.type === 'layerSettings'),
    'a late control socket must receive the canonical layerSettings replay');

  let armAck = await setArmed(control, true);
  assert.equal(armAck.armed, true);

  response = await h.api(
    'PUT',
    '/layers/live_touch/pattern',
    { pattern: 'test_const' },
    OWNER_HEADERS,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.pattern, 'test_const');

  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 100,
    ownerId: OWNER_ID,
  });
  assert.equal(response.status, 423, 'an armed activation without the lease header must be rejected');
  assert.equal(response.data.code, 'TOUCH_CONTROL_LEASE_HELD');

  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 100,
    ownerId: 'wrong_owner',
  }, OWNER_HEADERS);
  assert.equal(response.status, 409);
  assert.equal(response.data.code, 'LIVE_TOUCH_OWNER_MISMATCH');

  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 100,
    ownerId: OWNER_ID,
    reason: 'api_contract_test',
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.transition.from, 'deck');
  assert.equal(response.data.transition.to, 'live_touch');

  await waitForLayer(
    state => state.active === 'live_touch' && state.transition === null &&
      state.liveTouch.armed === true,
    'Deck -> Live Touch did not land with ARM held',
  );
  const deckDuringLive = await h.api('GET', '/deck/channel');
  assert.equal(deckDuringLive.data.pattern, deckPatternBefore,
    'staging/performing Live Touch must preserve the independent Deck pattern');

  // Leaving for Mixer keeps ARM through the outgoing blend and after landing.
  // That post-landing authorization window lets the surface clean its private
  // Live state without mutating the visible outgoing look. The explicit ARM
  // false is the atomic release acknowledgement.
  response = await h.api('POST', '/layers/activate', {
    target: 'mixer',
    durationMs: 100,
    ownerId: OWNER_ID,
    reason: 'api_contract_test',
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.liveTouch.armed, true);
  const mixerLanding = await waitForLayer(
    state => state.active === 'mixer' && state.transition === null &&
      state.liveTouch.armed === true,
    'Live Touch -> Mixer did not land with cleanup authorization held',
  );
  assert.equal(mixerLanding.liveTouch.ownerId, OWNER_ID);

  response = await h.api('POST', '/global-effects/disable-all', {}, OWNER_HEADERS);
  assert.equal(response.status, 200,
    'owner-scoped cleanup must remain authorized after visual handback lands');

  let releaseAck = await setArmed(control, false);
  assert.equal(releaseAck.armed, false);
  await waitForLayer(
    state => state.active === 'mixer' && state.transition === null &&
      state.liveTouch.armed === false,
    'explicit post-cleanup ARM false did not release the Live session',
  );

  // An explicit ARM-off while steady Live is engine-owned: it blends back to
  // Deck and only then drops the lease.
  armAck = await setArmed(control, true);
  assert.equal(armAck.armed, true);
  response = await h.api('POST', '/layers/activate', {
    target: 'live_touch',
    durationMs: 100,
    ownerId: OWNER_ID,
  }, OWNER_HEADERS);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await waitForLayer(
    state => state.active === 'live_touch' && state.transition === null,
    'Mixer -> Live Touch did not land',
  );

  const disarmAck = await setArmed(control, false);
  assert.equal(disarmAck.armed, true, 'lease stays held during the outgoing blend');
  assert.equal(disarmAck.landing.target, 'deck');
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null &&
      state.liveTouch.armed === true,
    'engine-owned disarm did not land on Deck with cleanup authorization held',
  );

  releaseAck = await setArmed(control, false);
  assert.equal(releaseAck.armed, false);
  await waitForLayer(
    state => state.active === 'deck' && state.transition === null &&
      state.liveTouch.armed === false,
    'post-landing ARM false did not clear the Live session',
  );

  control.ws.close();
});
