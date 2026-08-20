import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import {
  buildE2EPlan,
  createTimelineE2E,
  sleep,
  until,
} from '../e2e/timeline_e2e_harness.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_FIXTURE = 'test-owner';
const COLLABORATOR_FIXTURE = 'test-collaborator';
const BRINGUP_FIXTURE = 'test-bringup';
const secretsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captainpad-auth-api-'));
const secretsPath = path.join(secretsDir, 'secrets.yaml');
fs.writeFileSync(secretsPath, [
  `SinaAuth: ${OWNER_FIXTURE}`,
  `MishaAuth: ${COLLABORATOR_FIXTURE}`,
  `MARITIME_TERM_FOR_SAILIOR_PASS: ${BRINGUP_FIXTURE}`,
  '',
].join('\n'));

const harness = createEngineHarness({
  scene: 'summer_camp_dome',
  pattern: '13_sparkle',
  prefix: 'captainpad-auth-api',
  portBase: 31920,
  portSpan: 20,
  extraEnv: {
    BM26_CAPTAINPAD_AUTH_REQUIRED: '1',
    BM26_SECRETS: secretsPath,
  },
  // TEST-NET-1 (RFC 5737) black hole — loopback is not one.
  extraArgs: ['--dest', '192.0.2.9'],
});

async function request(method, route, body, token, passcode, waiverToken) {
  const response = await fetch(`${harness.base()}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { 'X-CaptainPad-Session': token } : {}),
      ...(passcode ? { 'X-CaptainPad-Passcode': passcode } : {}),
      ...(waiverToken ? { 'X-CaptainPad-Passcode-Waiver': waiverToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return {
    status: response.status,
    data,
    cacheControl: response.headers.get('cache-control'),
  };
}

async function requestAt(base, method, route, body, headers = {}) {
  const response = await fetch(`${base}${route}`, {
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

async function waitForControlFrame(client, startIndex, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = client.frames.slice(startIndex).map((frame) => frame.msg).find(predicate);
    if (found) return found;
    await sleep(25);
  }
  assert.fail(`timed out waiting for control frame; got ${JSON.stringify(client.frames.slice(startIndex))}`);
}

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
});

after(async () => {
  await harness.teardown();
  fs.rmSync(secretsDir, { recursive: true, force: true });
});

test('privileged session bypasses only this device while global Performance remains active', async () => {
  // docs/56 D1: an auth-REQUIRED engine is a show engine — it BOOTS locked,
  // with no edit session, before it serves its first request. Nothing had to
  // POST an enter for this to be true.
  const booted = await request('GET', '/performance-mode');
  assert.equal(booted.status, 200);
  assert.equal(booted.data.active, true, 'auth-required engine did not boot into performance mode');
  assert.equal(booted.data.editPrincipal, null, 'boot-locked engine handed out an edit session');

  const blocked = await request('POST', '/pattern', { pattern: '13_sparkle' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'PERFORMANCE_MODE');

  const unauthExit = await request('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  assert.equal(unauthExit.status, 401);
  assert.equal(unauthExit.data.code, 'EXIT_AUTH_REQUIRED');

  const login = await request('POST', '/captainpad/auth/login', {
    passphrase: OWNER_FIXTURE,
    remember30: true,
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.authenticated, true);
  assert.equal(typeof login.data.token, 'string');
  assert.equal(login.data.remainingMs, 30 * 60 * 1000);

  const staleDevice = await request(
    'POST',
    '/pattern',
    { pattern: '13_sparkle' },
    'expired-or-restarted-session',
  );
  assert.equal(staleDevice.status, 401);
  assert.equal(staleDevice.data.code, 'CAPTAINPAD_SESSION_INVALID');

  const privilegedMutation = await request(
    'POST',
    '/pattern',
    { pattern: '13_sparkle' },
    login.data.token,
  );
  assert.equal(privilegedMutation.status, 200);

  const stillGlobal = await request('GET', '/performance-mode');
  assert.equal(stillGlobal.data.active, true);
  const stillBlockedOtherDevice = await request('POST', '/pattern', { pattern: '13_sparkle' });
  assert.equal(stillBlockedOtherDevice.status, 409);

  // docs/56 D2: a privileged SESSION can no longer end the show lock. Leaving
  // performance mode establishes WHO owns persistence for the edit session that
  // follows, so the passcode is re-verified per attempt — sessions buy nothing.
  const sessionOnlyExit = await request(
    'POST',
    '/performance-mode',
    { active: false, exitAction: 'keep' },
    login.data.token,
  );
  assert.equal(sessionOnlyExit.status, 401, 'a session token exited performance mode');
  assert.equal(sessionOnlyExit.data.code, 'EXIT_AUTH_REQUIRED');

  const exit = await request(
    'POST',
    '/performance-mode',
    { active: false, exitAction: 'keep' },
    undefined,
    OWNER_FIXTURE,
  );
  assert.equal(exit.status, 200);
  assert.equal(exit.data.active, false);
  assert.equal(exit.data.editPrincipal, 'owner');
});

test('logout revokes the opaque session', async () => {
  const login = await request('POST', '/captainpad/auth/login', {
    passphrase: COLLABORATOR_FIXTURE,
    remember30: false,
  });
  assert.equal(login.status, 200);
  const validSession = await request('GET', '/captainpad/auth/session', undefined, login.data.token);
  assert.equal(validSession.status, 200);
  assert.equal(validSession.cacheControl, 'no-store');
  assert.ok(validSession.data.remainingMs > 0);
  assert.equal((await request('POST', '/captainpad/auth/logout', undefined, login.data.token)).status, 200);
  const revokedSession = await request('GET', '/captainpad/auth/session', undefined, login.data.token);
  assert.equal(revokedSession.status, 401);
  assert.equal(revokedSession.cacheControl, 'no-store');
});

test('passcode waiver mints, validates, and authorises exit without the raw passcode', async () => {
  let mode = await request('GET', '/performance-mode');
  if (!mode.data.active) {
    const enter = await request('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));
    mode = await request('GET', '/performance-mode');
  }
  assert.equal(mode.status, 200);
  assert.equal(mode.data.active, true);

  const mint = await request('POST', '/captainpad/auth/passcode-waiver', { passcode: OWNER_FIXTURE });
  assert.equal(mint.status, 200);
  assert.equal(mint.data.ok, true);
  assert.equal(typeof mint.data.token, 'string');
  assert.equal(mint.data.principal, 'owner');
  assert.equal(mint.data.remainingMs, 30 * 60 * 1000);
  assert.equal(JSON.stringify(mint.data).includes(OWNER_FIXTURE), false);

  const validate = await request('GET', '/captainpad/auth/passcode-waiver', undefined, undefined, undefined, mint.data.token);
  assert.equal(validate.status, 200);
  assert.equal(validate.data.ok, true);
  assert.equal(validate.data.principal, 'owner');
  assert.ok(validate.data.remainingMs > 0);

  const exit = await request(
    'POST',
    '/performance-mode',
    { active: false, exitAction: 'keep' },
    undefined,
    undefined,
    mint.data.token,
  );
  assert.equal(exit.status, 200);
  assert.equal(exit.data.active, false);
  assert.equal(exit.data.editPrincipal, 'owner');
});

test('logout revokes a presented passcode waiver so the old token cannot authorise again', async () => {
  let mode = await request('GET', '/performance-mode');
  if (!mode.data.active) {
    const enter = await request('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));
    mode = await request('GET', '/performance-mode');
  }
  assert.equal(mode.data.active, true);

  const mint = await request('POST', '/captainpad/auth/passcode-waiver', { passcode: OWNER_FIXTURE });
  assert.equal(mint.status, 200);
  assert.equal(typeof mint.data.token, 'string');

  const logout = await request(
    'POST',
    '/captainpad/auth/logout',
    undefined,
    undefined,
    undefined,
    mint.data.token,
  );
  assert.equal(logout.status, 200);

  const validate = await request(
    'GET',
    '/captainpad/auth/passcode-waiver',
    undefined,
    undefined,
    undefined,
    mint.data.token,
  );
  assert.equal(validate.status, 401);

  const exit = await request(
    'POST',
    '/performance-mode',
    { active: false, exitAction: 'keep' },
    undefined,
    undefined,
    mint.data.token,
  );
  assert.equal(exit.status, 401);
  assert.equal(exit.data.code, 'EXIT_AUTH_WAIVER_INVALID');
});

test('auth-required SIGKILL relocks Performance, invalidates the old token, and permits a fresh privileged exit', async () => {
  const oldLogin = await request('POST', '/captainpad/auth/login', {
    passphrase: OWNER_FIXTURE,
    remember30: true,
  });
  assert.equal(oldLogin.status, 200);

  // Entering the lock is never gated (docs/56 D2) — a token is not needed and
  // not consulted. The previous test left the rig in performance mode.
  let mode = await request('GET', '/performance-mode');
  if (!mode.data.active) {
    const enter = await request('POST', '/performance-mode', { active: true });
    assert.equal(enter.status, 200, JSON.stringify(enter.data));
    assert.equal(enter.data.editPrincipal, null, 'entering performance mode kept an edit session');
  }

  const crashedProcess = harness.proc;
  assert.ok(crashedProcess, 'auth harness has no engine process to crash');
  const exited = new Promise((resolve) => crashedProcess.once('exit', resolve));
  crashedProcess.kill('SIGKILL');
  await Promise.race([
    exited,
    sleep(5000).then(() => assert.fail('SIGKILL engine did not exit within 5 seconds')),
  ]);

  harness.spawnEngine();
  await harness.waitForReady();

  const resumed = await request('GET', '/performance-mode');
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.active, true, 'restart exposed Edit instead of resuming the global lock');

  const oldSession = await request(
    'GET',
    '/captainpad/auth/session',
    undefined,
    oldLogin.data.token,
  );
  assert.equal(oldSession.status, 401, 'an in-memory token survived its issuing engine process');

  const unprivilegedMutation = await request('POST', '/pattern', { pattern: '13_sparkle' });
  assert.equal(unprivilegedMutation.status, 409);
  assert.equal(unprivilegedMutation.data.code, 'PERFORMANCE_MODE');

  const staleMutation = await request(
    'POST',
    '/pattern',
    { pattern: '13_sparkle' },
    oldLogin.data.token,
  );
  assert.equal(staleMutation.status, 401);
  assert.equal(staleMutation.data.code, 'CAPTAINPAD_SESSION_INVALID');

  const freshLogin = await request('POST', '/captainpad/auth/login', {
    passphrase: OWNER_FIXTURE,
    remember30: false,
  });
  assert.equal(freshLogin.status, 200);
  assert.notEqual(freshLogin.data.token, oldLogin.data.token);

  const exit = await request(
    'POST',
    '/performance-mode',
    { active: false, exitAction: 'keep' },
    freshLogin.data.token,
    OWNER_FIXTURE,
  );
  assert.equal(exit.status, 200);
  assert.equal(exit.data.active, false);
  assert.equal(exit.data.editPrincipal, 'owner');
});

test('auth routes bypass an armed Live Touch desk without renewing its Timeline activity lease', async () => {
  // The global auth harness is no longer needed. Stop it before starting the
  // Timeline engine so their fixed OSC/fire-sync listeners cannot overlap.
  await harness.teardown();

  const plan = buildE2EPlan(Date.now(), {
    name: 'captainpad_auth_lease_isolation',
    showInMin: 240,
  });
  const timelineHarness = createTimelineE2E({
    prefix: 'captainpad-auth-lease-isolation',
    plans: { captainpad_auth_lease_isolation: plan },
    activePlan: 'captainpad_auth_lease_isolation',
    timelinePatch: { operatorLeaseSec: 5 },
    extraEnv: {
      BM26_CAPTAINPAD_AUTH_REQUIRED: '1',
      BM26_SECRETS: secretsPath,
      BM26_ARM_LEASE_MS: '15000',
    },
    portBase: 31960,
    portSpan: 20,
  });

  try {
    await timelineHarness.start();
    await until(
      () => timelineHarness.state(),
      (state) => state.planActive === true && state.forcingDeckView === true,
      { what: 'active Timeline plan before auth lease isolation' },
    );
    // docs/56 D1: this harness runs with privileged auth ON, so its engine
    // BOOTS locked. Leave the lock with the captain's passcode before the
    // Live Touch takeover assertions below, which were written for edit mode.
    const bootExit = await requestAt(
      timelineHarness.base(),
      'POST',
      '/performance-mode',
      { active: false, exitAction: 'keep' },
      { 'X-CaptainPad-Passcode': OWNER_FIXTURE },
    );
    assert.equal(bootExit.status, 200, JSON.stringify(bootExit.data));

    const ownerId = 'auth_lease_owner';
    const ownerHeaders = { 'X-Touch-Control-Owner': ownerId };
    const client = await timelineHarness.client('auth-lease-owner');

    let startIndex = client.frames.length;
    client.ws.send(JSON.stringify({ type: 'touchControlHello', ownerId }));
    await waitForControlFrame(
      client,
      startIndex,
      (message) => message.type === 'touchControlHelloAck' && message.ownerId === ownerId,
    );

    startIndex = client.frames.length;
    client.ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId, armed: true }));
    const armed = await waitForControlFrame(
      client,
      startIndex,
      (message) => message.type === 'touchControlArmedAck'
        && message.ownerId === ownerId
        && message.requestedArmed === true,
    );
    assert.equal(armed.armed, true);

    let response = await requestAt(
      timelineHarness.base(),
      'PUT',
      '/layers/live_touch/pattern',
      { pattern: 'test_const' },
      ownerHeaders,
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    response = await requestAt(
      timelineHarness.base(),
      'POST',
      '/layers/activate',
      {
        target: 'live_touch',
        durationMs: 100,
        ownerId,
        reason: 'captainpad_auth_lease_isolation',
      },
      ownerHeaders,
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));

    await until(
      async () => (await timelineHarness.api('GET', '/layers/state')).data,
      (state) => state.active === 'live_touch' && state.transition === null,
      { what: 'Live Touch landing for auth lease isolation' },
    );
    const beforeAuth = await timelineHarness.state();
    assert.equal(beforeAuth.mode, 'overridden');
    assert.ok(beforeAuth.operatorLease?.expiresAtMs > Date.now());
    const originalExpiry = beforeAuth.operatorLease.expiresAtMs;

    // No owner header: these POST/GET requests must bypass the armed-desk 423.
    const login = await requestAt(
      timelineHarness.base(),
      'POST',
      '/captainpad/auth/login',
      { passphrase: COLLABORATOR_FIXTURE, remember30: false },
    );
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const session = await requestAt(
      timelineHarness.base(),
      'GET',
      '/captainpad/auth/session',
      undefined,
      { 'X-CaptainPad-Session': login.data.token },
    );
    assert.equal(session.status, 200, JSON.stringify(session.data));

    // Live activity is throttled to one note per lease/3. Wait beyond that
    // throttle, then send owner-tagged logout. If auth were wrapped as ordinary
    // Live activity, this successful POST would move expiresAtMs forward.
    await sleep(1800);
    const beforeLogout = await timelineHarness.state();
    assert.equal(beforeLogout.operatorLease?.expiresAtMs, originalExpiry);
    const logout = await requestAt(
      timelineHarness.base(),
      'POST',
      '/captainpad/auth/logout',
      undefined,
      {
        ...ownerHeaders,
        'X-CaptainPad-Session': login.data.token,
      },
    );
    assert.equal(logout.status, 200, JSON.stringify(logout.data));

    const afterAuth = await timelineHarness.state();
    assert.equal(afterAuth.mode, 'overridden');
    assert.equal(
      afterAuth.operatorLease?.expiresAtMs,
      originalExpiry,
      'auth traffic incorrectly counted as Live Touch Timeline activity',
    );
    client.close();
  } finally {
    await timelineHarness.teardown();
  }
});
