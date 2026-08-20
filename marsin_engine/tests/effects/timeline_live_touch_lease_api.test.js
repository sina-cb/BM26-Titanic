import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import '../helpers/setup_config_guard.mjs';
import {
  buildE2EPlan,
  createTimelineE2E,
  sleep,
  until,
} from '../e2e/timeline_e2e_harness.mjs';

const OWNER = 'timeline_live_touch_owner';

async function request(harness, method, path, body, headers = {}) {
  const response = await fetch(harness.base() + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function waitForMessage(client, predicate, timeoutMs = 5000, startIndex = 0) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = client.frames.slice(startIndex).find((candidate) => predicate(candidate.msg));
    if (frame) return frame.msg;
    await sleep(25);
  }
  assert.fail(`timed out waiting for control frame: ${JSON.stringify(client.frames.slice(-12))}`);
}

async function arm(client, armed) {
  const frameStart = client.frames.length;
  client.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER, armed }));
  return waitForMessage(
    client,
    (message) => message.type === 'touchControlArmedAck'
      && message.ownerId === OWNER
      && message.requestedArmed === armed,
    5000,
    frameStart,
  );
}

function pausedJsonRequest(harness, method, path) {
  let request;
  const response = new Promise((resolve, reject) => {
    const url = new URL(harness.base() + path);
    request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: res.statusCode, data });
      });
    });
    request.on('error', reject);
  });
  return { request, response };
}

test('Timeline preview stays ownerless while explicit Timeline writes preempt Live Touch', async () => {
  const plan = buildE2EPlan(Date.now(), {
    name: 'timeline_live_touch_lease',
    showInMin: 240,
  });
  const harness = createTimelineE2E({
    prefix: 'timeline-live-touch-lease-api',
    plans: { timeline_live_touch_lease: plan },
    activePlan: 'timeline_live_touch_lease',
    timelinePatch: { operatorLeaseSec: 30 },
    portBase: 41000,
    portSpan: 1000,
    extraEnv: {
      BM26_ARM_LEASE_MS: '15000',
      BM26_CAPTAINPAD_AUTH_REQUIRED: '0',
    },
  });

  try {
    await harness.start();
    const client = await harness.client('timeline-live-touch-owner');
    client.ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER }));
    await waitForMessage(client, (message) => message.type === 'touchControlHelloAck');
    await arm(client, true);
    const layersBefore = await request(harness, 'GET', '/layers/state');
    assert.equal(layersBefore.data.liveTouch.armed, true);
    assert.equal(layersBefore.data.liveTouch.ownerId, OWNER);

    const preview = await request(harness, 'POST', '/timeline/overview', plan);
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.plan, plan.name);

    const invalidPreview = await request(harness, 'POST', '/timeline/overview', {
      ...plan,
      location: { ...plan.location, tz: 'not/a-real-timezone' },
    });
    assert.equal(invalidPreview.status, 400, JSON.stringify(invalidPreview.data));
    assert.match(invalidPreview.data.error, /time.?zone|timezone|tz/i);

    const ownerPreview = await request(
      harness,
      'POST',
      '/timeline/overview',
      plan,
      { 'X-Touch-Control-Owner': OWNER },
    );
    assert.equal(ownerPreview.status, 200, JSON.stringify(ownerPreview.data));
    const layersAfterOwnerPreview = await request(harness, 'GET', '/layers/state');
    assert.equal(layersAfterOwnerPreview.data.liveTouch.armed, true);
    assert.equal(layersAfterOwnerPreview.data.liveTouch.ownerId, OWNER);

    const parallel = await Promise.all(Array.from(
      { length: 8 },
      () => request(harness, 'POST', '/timeline/overview', plan),
    ));
    assert.deepEqual(parallel.map((response) => response.status), Array(8).fill(200));

    // Keep the Timeline authority hold across body parsing: Live Touch must not
    // re-arm after the release confirmation but before this original mutation
    // reaches its route handler and commits.
    const priorityFrameStart = client.frames.length;
    const paused = pausedJsonRequest(harness, 'PUT', '/party-config');
    paused.request.write('{"enabled"');
    await waitForMessage(
      client,
      message => message.type === 'liveTouchForceDisarm' && message.ownerId === OWNER,
      5000,
      priorityFrameStart,
    );
    const rearmFrameStart = client.frames.length;
    client.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER, armed: true }));
    const rearmRejected = await waitForMessage(
      client,
      message => message.type === 'touchControlArmedRejected'
        && message.ownerId === OWNER
        && message.heldBy === 'timeline',
      5000,
      rearmFrameStart,
    );
    assert.match(rearmRejected.reason, /Timeline priority handoff/i);
    paused.request.end(':false}');
    const pausedResult = await paused.response;
    assert.equal(pausedResult.status, 200, JSON.stringify(pausedResult.data));
    await arm(client, true);

    for (const [method, path, body] of [
      ['POST', '/timeline/plans', plan],
      ['POST', '/timeline/plan/activate', { name: plan.name }],
      ['POST', '/timeline/cues/c_live/fire', undefined],
      ['POST', '/timeline/travel', { cueId: 'c_live' }],
      ['PUT', '/party-config', { enabled: false }],
    ]) {
      const frameStart = client.frames.length;
      const applied = await request(harness, method, path, body);
      assert.equal(applied.status, 200, `${method} ${path}: ${JSON.stringify(applied.data)}`);
      const forced = await waitForMessage(
        client,
        (message) => message.type === 'liveTouchForceDisarm'
          && message.ownerId === OWNER
          && message.source === 'timeline',
        5000,
        frameStart,
      );
      assert.equal(forced.autoRearm, false, `${method} ${path}`);
      assert.match(forced.why, new RegExp(`${method} ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
      const released = await request(harness, 'GET', '/layers/state');
      assert.equal(released.data.liveTouch.armed, false, `${method} ${path}`);
      assert.equal(released.data.liveTouch.ownerId, null, `${method} ${path}`);
      await arm(client, true);
    }

    const staleOwnerTimelineWrite = await request(
      harness,
      'POST',
      '/timeline/plans',
      plan,
      { 'X-Touch-Control-Owner': 'stale_timeline_owner' },
    );
    assert.equal(staleOwnerTimelineWrite.status, 200, JSON.stringify(staleOwnerTimelineWrite.data));
    const afterStaleOwnerTimelineWrite = await request(harness, 'GET', '/layers/state');
    assert.equal(afterStaleOwnerTimelineWrite.data.liveTouch.armed, false);

    await arm(client, true);
    const activeOwnerLiveWrite = await request(
      harness,
      'PUT',
      '/layers/live_touch/pattern',
      { pattern: 'test_const' },
      { 'X-Touch-Control-Owner': OWNER },
    );
    assert.equal(activeOwnerLiveWrite.status, 200, JSON.stringify(activeOwnerLiveWrite.data));

    const frameStart = client.frames.length;
    const concurrent = await Promise.all([
      request(harness, 'POST', '/timeline/plans', plan),
      request(harness, 'PUT', '/party-config', { enabled: true }),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status), [200, 200]);
    await until(
      async () => (await request(harness, 'GET', '/layers/state')).data,
      (layers) => layers.liveTouch.armed === false,
      { what: 'concurrent Timeline priority handoff' },
    );
    const forcedFrames = client.frames.slice(frameStart).filter(
      (frame) => frame.msg.type === 'liveTouchForceDisarm' && frame.msg.ownerId === OWNER,
    );
    assert.equal(forcedFrames.length, 1, 'concurrent Timeline writes disarmed Live Touch twice');

    const releasedOwner = await request(
      harness,
      'PUT',
      '/layers/live_touch/pattern',
      { pattern: 'test_const' },
      { 'X-Touch-Control-Owner': OWNER },
    );
    assert.equal(releasedOwner.status, 409, JSON.stringify(releasedOwner.data));
    assert.equal(releasedOwner.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');
  } finally {
    await harness.teardown();
  }
});
