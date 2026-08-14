import test from 'node:test';
import assert from 'node:assert/strict';

import '../helpers/setup_config_guard.mjs';
import {
  buildE2EPlan,
  createTimelineE2E,
  sleep,
  until,
} from '../e2e/timeline_e2e_harness.mjs';

const OWNER = 'live_timeline_owner';
const OWNER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Touch-Control-Owner': OWNER,
};

async function ownerApi(h, method, path, body) {
  const response = await fetch(h.base() + path, {
    method,
    headers: OWNER_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function waitForFrame(client, startIndex, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = client.frames.slice(startIndex).find(frame => predicate(frame.msg));
    if (found) return found.msg;
    await sleep(25);
  }
  assert.fail(`timed out waiting for WS frame; got ${JSON.stringify(client.frames.slice(startIndex))}`);
}

test('Live Touch uses the activity-based Timeline lease and yields after inactivity', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'live_touch_takeover', showInMin: 240 });
  const h = createTimelineE2E({
    prefix: 'live-touch-timeline-takeover',
    plans: { live_touch_takeover: plan },
    activePlan: 'live_touch_takeover',
    timelinePatch: { operatorLeaseSec: 1 },
    // Ping every 500 ms, well inside the deliberately-short Timeline lease.
    extraEnv: { BM26_ARM_LEASE_MS: '1500' },
  });

  try {
    await h.start();
    const planned = await until(
      () => h.state(),
      state => state.planActive === true && state.forcingDeckView === true,
      { what: 'active Timeline plan pin' },
    );
    assert.equal(planned.mode, 'armed');

    const mixerChannel = await h.api('POST', '/mixer/channels', {
      pattern: '13_sparkle',
      name: 'Timeline handback readiness',
      mode: 'blend_screen',
      fader: 1,
    });
    assert.equal(mixerChannel.status, 200, JSON.stringify(mixerChannel.data));

    const passiveMixer = await h.api('POST', '/layers/activate', { target: 'mixer' });
    assert.equal(passiveMixer.status, 423, JSON.stringify(passiveMixer.data));
    assert.equal(passiveMixer.data.code, 'LAYER_SETTING_LOCKED');
    assert.equal(passiveMixer.data.heldBy, 'plan');
    const stillPinned = await h.api('GET', '/layers/state');
    assert.equal(stillPinned.data.active, 'deck');
    assert.equal(stillPinned.data.transition, null,
      'passive Mixer activation mutated the plan-owned layer router');

    // Seed a real future plan stimulus before ARM acquires the CPC source
    // lock. The c_party mood cue has a 2 s dwell, so it becomes due only after
    // Live has taken over and after the raw one-second operator lease elapsed.
    const mood = await h.api('POST', '/param-center', { audioPartyStrong: 1 });
    assert.equal(mood.status, 200, JSON.stringify(mood.data));

    const client = await h.client('live-owner');
    let start = client.frames.length;
    client.ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER }));
    await waitForFrame(client, start, message => message.type === 'touchControlHelloAck');

    start = client.frames.length;
    client.ws.send(JSON.stringify({
      type: 'touchControlArmed', ownerId: OWNER, armed: true,
    }));
    const armed = await waitForFrame(
      client,
      start,
      message => message.type === 'touchControlArmedAck'
        && message.ownerId === OWNER
        && message.requestedArmed === true,
    );
    assert.equal(armed.armed, true);

    let response = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', {
      pattern: 'test_const',
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));

    response = await ownerApi(h, 'POST', '/layers/activate', {
      target: 'live_touch', durationMs: 100, ownerId: OWNER,
      reason: 'timeline_takeover_contract',
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));

    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'live_touch' && state.transition === null,
      { what: 'Live Touch landing' },
    );
    const taken = await h.state();
    assert.equal(taken.mode, 'overridden');
    assert.equal(taken.forcingDeckView, false);
    assert.ok(taken.operatorLease && taken.operatorLease.expiresAtMs > Date.now());

    // ARM pongs prove only that the desk is alive. With no control changes the
    // ordinary Timeline inactivity lease must expire and take Deck back.
    await until(
      () => h.state(),
      state => state.mode === 'armed' && state.operatorLease === null,
      { what: 'Timeline lease expiry under idle Live ARM', timeoutMs: 5000 },
    );
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'deck' && state.transition === null,
      { what: 'Timeline Deck handback after Live inactivity', timeoutMs: 5000 },
    );

    // The next real Live mutation is the same takeover gesture as a Deck/Mixer
    // interaction: reacquire the lease and bring the isolated Live surface
    // back on air. Continued mutations, not socket heartbeats, keep it alive.
    response = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', {
      pattern: 'test_const',
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'live_touch' && state.transition === null,
      { what: 'Live Touch activity takeover' },
    );
    for (let i = 0; i < 7; i++) {
      await sleep(350);
      response = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', {
        pattern: 'test_const',
      });
      assert.equal(response.status, 200, JSON.stringify(response.data));
    }
    const held = await h.state();
    assert.equal(held.mode, 'overridden', 'real Live control activity did not renew the Timeline lease');
    assert.equal(held.forcingDeckView, false, 'the plan re-pinned Deck during active Live control');
    assert.ok(held.operatorLease && held.operatorLease.expiresAtMs > Date.now());
    const layers = await h.api('GET', '/layers/state');
    assert.equal(layers.data.active, 'live_touch');
    assert.equal(layers.data.transition, null);

    // A clean Live -> Mixer handback must not resume the plan and re-pin Deck
    // after Mixer has visibly landed.
    response = await ownerApi(h, 'POST', '/layers/activate', {
      target: 'mixer', durationMs: 100, ownerId: OWNER,
      reason: 'timeline_takeover_mixer_handback',
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'mixer' && state.transition === null,
      { what: 'Live handback to Mixer' },
    );

    start = client.frames.length;
    client.ws.send(JSON.stringify({
      type: 'touchControlArmed', ownerId: OWNER, armed: false,
    }));
    const released = await waitForFrame(
      client,
      start,
      message => message.type === 'touchControlArmedAck'
        && message.ownerId === OWNER
        && message.requestedArmed === false,
    );
    assert.equal(released.armed, false);
    const transferred = await h.state();
    assert.equal(transferred.mode, 'overridden',
      'clean handback resumed the plan instead of preserving Deck/Mixer takeover');
    assert.ok(transferred.operatorLease && transferred.operatorLease.expiresAtMs > Date.now());
    const mixerLayers = await h.api('GET', '/layers/state');
    assert.equal(mixerLayers.data.active, 'mixer',
      'plan release re-pinned Deck after the requested Mixer landing');

    const resume = await h.api('POST', '/timeline/resume');
    assert.equal(resume.status, 200, JSON.stringify(resume.data));
    client.close();
  } finally {
    await h.teardown();
  }
});
