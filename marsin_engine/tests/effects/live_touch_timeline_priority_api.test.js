// ══ TIMELINE PRIORITY OVER LIVE TOUCH — OPERATOR RULINGS 2026-08-14 ═══════
//
//  1. "The timeline resume when live touch takes over needs to disarm and
//      switch back to timeline when resume is pressed OR when the lease is
//      expired — EVEN IF THE ARM IS ACTIVE. The timeline is high priority."
//     (Lease-expiry coverage lives in live_touch_timeline_takeover_api.test.js;
//      this suite owns the RESUME edge.)
//  2. "Disarming the live touch should automatically resume the plan too."
//  3. "Take over in performance mode from the timeline needs to have either of
//      the passwords we have for Sina, Muisha, or Sailors" … "pass code is
//      required EVERY TIME."
//
// The credentials used here are TEST LITERALS written into the harness temp
// dir. No real credential material exists in this repo (see
// .agent/os/security_privacy.md); the engine reads its real ones exclusively
// from the external $BM26_SECRETS file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import '../helpers/setup_config_guard.mjs';
import {
  buildE2EPlan,
  createTimelineE2E,
  sleep,
  until,
} from '../e2e/timeline_e2e_harness.mjs';

const OWNER = 'live_priority_owner';
const OWNER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Touch-Control-Owner': OWNER,
};

// Test-only passphrases. Deliberately obvious placeholders.
const TEST_SECRETS = {
  owner: 'test-owner-passphrase',
  collaborator: 'test-collaborator-passphrase',
  bringup: 'test-bringup-passphrase',
};

function writeTestSecrets(dir) {
  const secretsPath = path.join(dir, 'test_secrets.yaml');
  fs.writeFileSync(secretsPath, [
    `SinaAuth: ${TEST_SECRETS.owner}`,
    `MishaAuth: ${TEST_SECRETS.collaborator}`,
    `MARITIME_TERM_FOR_SAILIOR_PASS: ${TEST_SECRETS.bringup}`,
    '',
  ].join('\n'), 'utf8');
  return secretsPath;
}

async function ownerApi(h, method, url, body, extraHeaders = {}) {
  const response = await fetch(h.base() + url, {
    method,
    headers: { ...OWNER_HEADERS, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function waitForFrame(client, startIndex, predicate, timeoutMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = client.frames.slice(startIndex).find(frame => predicate(frame.msg));
    if (found) return found.msg;
    await sleep(25);
  }
  assert.fail(`timed out waiting for a WS frame; saw ${JSON.stringify(
    client.frames.slice(startIndex).map(f => f.msg.type))}`);
}

/** ARM the desk and put Live Touch on air, taking the plan's rig. */
async function armAndGoLive(h, client) {
  let start = client.frames.length;
  client.ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER }));
  await waitForFrame(client, start, m => m.type === 'touchControlHelloAck');

  start = client.frames.length;
  client.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER, armed: true }));
  const armed = await waitForFrame(
    client, start,
    m => m.type === 'touchControlArmedAck' && m.ownerId === OWNER && m.requestedArmed === true,
  );
  assert.equal(armed.armed, true);

  let response = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', { pattern: 'test_const' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await ownerApi(h, 'POST', '/layers/activate', {
    target: 'live_touch', durationMs: 100, ownerId: OWNER, reason: 'timeline_priority_test',
  });
  // 202 = queued behind a blend that was already in flight (e.g. the boot
  // crash-revert). Either way the landing below is the real assertion.
  assert.ok(response.status === 200 || response.status === 202, JSON.stringify(response.data));
  await until(
    async () => (await h.api('GET', '/layers/state')).data,
    s => s.active === 'live_touch' && s.transition === null,
    { what: 'Live Touch landing' },
  );
  return response;
}

test('RESUME force-disarms an active Live Touch ARM and the plan takes over', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'live_priority', showInMin: 240 });
  const h = createTimelineE2E({
    prefix: 'live-touch-priority-resume',
    plans: { live_priority: plan },
    activePlan: 'live_priority',
    // Long operator lease so ONLY the explicit RESUME can end the takeover.
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: { BM26_ARM_LEASE_MS: '15000', BM26_CAPTAINPAD_AUTH_REQUIRED: '0' },
  });

  try {
    await h.start();
    await until(
      () => h.state(),
      s => s.planActive === true && s.forcingDeckView === true,
      { what: 'active Timeline plan pin' },
    );

    const client = await h.client('live-priority');
    await armAndGoLive(h, client);

    const taken = await h.state();
    assert.equal(taken.mode, 'overridden', 'Live Touch did not take the plan over');
    assert.equal(taken.planActive, false);

    // ── THE RULING ──────────────────────────────────────────────────────
    const start = client.frames.length;
    const resume = await h.api('POST', '/timeline/resume');
    assert.equal(resume.status, 200, JSON.stringify(resume.data));

    // 1. The Live client is told, over WS, exactly why it lost the desk.
    const forced = await waitForFrame(
      client, start,
      m => m.type === 'liveTouchForceDisarm' && m.ownerId === OWNER,
    );
    assert.equal(forced.source, 'timeline');
    assert.equal(forced.autoRearm, false);
    assert.match(forced.why, /resume/i);

    // 2. The ARM is genuinely gone — not merely pushed off air.
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      s => s.liveTouch.armed === false && s.active === 'deck' && s.transition === null,
      { what: 'forced disarm + Deck landing', timeoutMs: 8000 },
    );
    const layers = await h.api('GET', '/layers/state');
    assert.equal(layers.data.liveTouch.ownerId, null);

    // 3. The plan is DRIVING again.
    await until(
      () => h.state(),
      s => s.mode === 'armed' && s.operatorLease === null
        && s.planActive === true && s.forcingDeckView === true,
      { what: 'plan driving after RESUME', timeoutMs: 8000 },
    );

    // 4. The disarmed owner cannot write, so it cannot silently re-arm itself.
    const stale = await ownerApi(h, 'PUT', '/layers/live_touch/pattern', { pattern: 'test_const' });
    assert.equal(stale.status, 409, JSON.stringify(stale.data));
    assert.equal(stale.data.code, 'TOUCH_CONTROL_LEASE_INACTIVE');
    await sleep(400);
    const still = await h.state();
    assert.equal(still.planActive, true, 'a rejected Live write took the rig back');

    client.close();
  } finally {
    await h.teardown();
  }
});

test('PANIC still outranks everything, armed or not', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'live_panic', showInMin: 240 });
  const h = createTimelineE2E({
    prefix: 'live-touch-priority-panic',
    plans: { live_panic: plan },
    activePlan: 'live_panic',
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: { BM26_ARM_LEASE_MS: '15000', BM26_CAPTAINPAD_AUTH_REQUIRED: '0' },
  });

  try {
    await h.start();
    await until(
      () => h.state(),
      s => s.planActive === true && s.forcingDeckView === true,
      { what: 'active Timeline plan pin' },
    );
    // Let any boot-revert blend land before arming, or the ARM activation is
    // queued behind it and dropped.
    await until(
      async () => (await h.api('GET', '/layers/state')).data,
      s => s.transition === null && s.queued === null,
      { what: 'settled layer router' },
    );
    const client = await h.client('live-panic');
    await armAndGoLive(h, client);

    // /mixer/panic is an EMERGENCY path: reachable from every surface, with no
    // owner header and no lease of any kind, even while a desk is armed.
    const panic = await h.api('POST', '/mixer/panic');
    assert.equal(panic.status, 200, JSON.stringify(panic.data));
    const blackout = await h.api('POST', '/global-blackout', { state: true });
    assert.equal(blackout.status, 200, JSON.stringify(blackout.data));

    client.close();
  } finally {
    await h.teardown();
  }
});

test('performance mode gates takeover FROM the timeline on a fresh passcode', async () => {
  const plan = buildE2EPlan(Date.now(), { name: 'live_auth', showInMin: 240 });
  const h = createTimelineE2E({
    prefix: 'live-touch-priority-auth',
    plans: { live_auth: plan },
    activePlan: 'live_auth',
    timelinePatch: { operatorLeaseSec: 600 },
    extraEnv: { BM26_ARM_LEASE_MS: '15000' },
  });
  // Written before start() so the engine reads it at boot.
  const secretsPath = writeTestSecrets(h.root);
  process.env.BM26_SECRETS = secretsPath;
  process.env.BM26_CAPTAINPAD_AUTH_REQUIRED = '1';

  try {
    await h.start();
    await until(() => h.state(), s => s.planActive === true, { what: 'plan pin' });

    // docs/56 D1: an auth-REQUIRED engine BOOTS locked. Leave the lock with the
    // captain's passcode first so the perf-mode-OFF assertions below start from
    // the state they were written for.
    const bootLocked = await h.api('GET', '/performance-mode');
    assert.equal(bootLocked.data.active, true, 'auth-required engine did not boot locked');
    const bootExit = await fetch(h.base() + '/performance-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Passcode': TEST_SECRETS.owner },
      body: JSON.stringify({ active: false, exitAction: 'keep' }),
    });
    assert.equal(bootExit.status, 200);

    // Performance mode OFF → no new gate at all (unchanged behaviour).
    const openTakeover = await h.api('POST', '/timeline/takeover', {});
    assert.equal(openTakeover.status, 200, JSON.stringify(openTakeover.data));
    const resumed = await h.api('POST', '/timeline/resume');
    assert.equal(resumed.status, 200, JSON.stringify(resumed.data));

    const enter = await h.api('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));

    // No passcode → refused, and the plan keeps running.
    const bare = await h.api('POST', '/timeline/takeover', {});
    assert.equal(bare.status, 401, JSON.stringify(bare.data));
    assert.equal(bare.data.code, 'TAKEOVER_AUTH_REQUIRED');
    assert.equal(JSON.stringify(bare.data).includes(TEST_SECRETS.owner), false);
    assert.equal((await h.state()).mode, 'armed', 'a refused takeover still took the rig');

    // Wrong passcode → refused, and the message never echoes what was tried.
    const wrong = await fetch(h.base() + '/timeline/takeover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Passcode': 'not-the-passcode' },
      body: '{}',
    });
    const wrongBody = await wrongBodyText(wrong);
    assert.equal(wrong.status, 401);
    assert.equal(wrongBody.code, 'TAKEOVER_AUTH_INVALID');
    assert.equal(JSON.stringify(wrongBody).includes('not-the-passcode'), false);

    // A privileged SESSION is NOT a substitute — the passcode is required EVERY
    // TIME, even inside a live 30-minute privileged session.
    const login = await h.api('POST', '/captainpad/auth/login', {
      passphrase: TEST_SECRETS.owner, remember30: true,
    });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    assert.equal(typeof login.data.token, 'string');
    const withSession = await fetch(h.base() + '/timeline/takeover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Session': login.data.token },
      body: '{}',
    });
    assert.equal(withSession.status, 401, 'a session token bypassed the takeover passcode');

    // Each of the three named principals authorises, and EACH ATTEMPT needs its
    // own passcode — two consecutive takeovers, two passcode entries.
    for (const passphrase of Object.values(TEST_SECRETS)) {
      const ok = await fetch(h.base() + '/timeline/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Passcode': passphrase },
        body: '{}',
      });
      assert.equal(ok.status, 200, `principal passphrase refused (${ok.status})`);
      // …and the very next attempt without one is refused again.
      const again = await h.api('POST', '/timeline/takeover', {});
      assert.equal(again.status, 401, 'a prior authorised takeover created a grace period');
      assert.equal(again.data.code, 'TAKEOVER_AUTH_REQUIRED');
    }

    // THE REVERSE DIRECTION IS NEVER GATED — getting BACK to the plan is free.
    const backToPlan = await h.api('POST', '/timeline/resume');
    assert.equal(backToPlan.status, 200, JSON.stringify(backToPlan.data));

    // No credential material anywhere in the engine's own output.
    for (const secret of Object.values(TEST_SECRETS)) {
      assert.equal(h.stdout.includes(secret), false, 'a passphrase reached the engine log');
    }

    // docs/56 D2: the exit takes a fresh passcode, never a session token.
    const sessionOnlyExit = await fetch(h.base() + '/performance-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Session': login.data.token },
      body: JSON.stringify({ active: false, exitAction: 'keep' }),
    });
    assert.equal(sessionOnlyExit.status, 401, 'a session token ended performance mode');

    const exit = await fetch(h.base() + '/performance-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CaptainPad-Passcode': TEST_SECRETS.owner },
      body: JSON.stringify({ active: false, exitAction: 'keep' }),
    });
    assert.equal(exit.status, 200);
  } finally {
    delete process.env.BM26_SECRETS;
    delete process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
    try { fs.rmSync(secretsPath, { force: true }); } catch { /* temp dir goes anyway */ }
    await h.teardown();
  }
});

async function wrongBodyText(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
