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

    // Real Live control changes — not socket heartbeats — renew the Timeline
    // lease, exactly like Deck/Mixer interaction.
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

    // ── TIMELINE PRIORITY: lease expiry FORCE-DISARMS the ARM ────────────
    // Operator ruling 2026-08-14. ARM pongs prove only that the desk is alive;
    // with no control changes the Timeline inactivity lease expires, and the
    // plan takes the rig back EVEN THOUGH THE ARM IS ACTIVE — the desk is
    // disarmed, not merely pushed off air.
    start = client.frames.length;
    await until(
      () => h.state(),
      state => state.mode === 'armed' && state.operatorLease === null,
      { what: 'Timeline lease expiry under idle Live ARM', timeoutMs: 6000 },
    );
    const forced = await waitForFrame(
      client,
      start,
      message => message.type === 'liveTouchForceDisarm' && message.ownerId === OWNER,
    );
    assert.equal(forced.source, 'timeline');
    assert.equal(forced.autoRearm, false, 'the client must never auto-re-arm after a force-disarm');
    assert.match(forced.why, /lease expired/i);
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'deck' && state.transition === null,
      { what: 'Timeline Deck handback after Live inactivity', timeoutMs: 6000 },
    );
    const disarmed = await h.api('GET', '/layers/state');
    assert.equal(disarmed.data.liveTouch.armed, false, 'the ARM lease survived the lease expiry');
    assert.equal(disarmed.data.liveTouch.ownerId, null);

    // The plan is DRIVING again, not merely un-overridden.
    await until(
      () => h.state(),
      state => state.planActive === true && state.forcingDeckView === true,
      { what: 'plan driving again after the forced disarm', timeoutMs: 6000 },
    );

    // A force-disarmed owner cannot write, and therefore cannot silently
    // reacquire the Timeline lease behind the operator's back.
    const staleWrite = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', {
      pattern: 'test_const',
    });
    assert.equal(staleWrite.status, 409, JSON.stringify(staleWrite.data));
    assert.equal(staleWrite.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');
    await sleep(1100);
    const stillPlan = await h.state();
    assert.equal(stillPlan.mode, 'armed', 'a rejected write reacquired the Timeline lease');
    assert.equal(stillPlan.operatorLease, null);

    // ── DISARM ALWAYS RESUMES THE PLAN ───────────────────────────────────
    // Re-arm explicitly (no auto-re-arm happened above), go on air, then do a
    // CLEAN disarm: the plan must be running again with no RESUME press.
    start = client.frames.length;
    client.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER, armed: true }));
    const rearmed = await waitForFrame(
      client, start,
      message => message.type === 'touchControlArmedAck' && message.requestedArmed === true,
    );
    assert.equal(rearmed.armed, true);
    response = await ownerApi(h, 'POST', '/layers/activate', {
      target: 'live_touch', durationMs: 100, ownerId: OWNER,
      reason: 'timeline_takeover_contract_rearm',
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active === 'live_touch' && state.transition === null,
      { what: 'Live Touch re-landing' },
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
    assert.equal(released.requestedArmed, false);
    // The panel's cooperative handback lands first, then the explicit ARM-off.
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.active !== 'live_touch' && state.transition === null,
      { what: 'Live handback landing', timeoutMs: 6000 },
    );
    client.ws.send(JSON.stringify({
      type: 'touchControlArmed', ownerId: OWNER, armed: false,
    }));
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      state => state.liveTouch.armed === false,
      { what: 'ARM released by the clean disarm', timeoutMs: 6000 },
    );
    // …and the plan is RUNNING again by itself — no RESUME press, no limbo.
    await until(
      () => h.state(),
      state => state.mode === 'armed' && state.operatorLease === null
        && state.planActive === true,
      { what: 'plan auto-resumed by the clean disarm', timeoutMs: 6000 },
    );
    client.close();
  } finally {
    await h.teardown();
  }
});
