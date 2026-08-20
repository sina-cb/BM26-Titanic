import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCaptainPadAuth, CAPTAINPAD_AUTH_CONSTANTS } from '../../lib/captainpad_auth.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'captainpad-auth-'));
  const secretsPath = path.join(dir, 'secrets.yaml');
  fs.writeFileSync(secretsPath, [
    'SinaAuth: alpha-pass',
    'MishaAuth: beta-pass',
    'MARITIME_TERM_FOR_SAILIOR_PASS: gamma-pass',
    '',
  ].join('\n'));
  return { dir, secretsPath };
}

function request(token) {
  return { headers: token ? { 'x-captainpad-session': token } : {} };
}

test('issues opaque remembered sessions that expire exactly after 30 minutes', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 1000;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    const login = auth.authenticate('alpha-pass', true, 'tablet-a');
    assert.equal(login.ok, true);
    assert.equal(login.principal, 'owner');
    assert.equal(login.expiresAt, timestamp + CAPTAINPAD_AUTH_CONSTANTS.REMEMBERED_SESSION_MS);
    assert.equal(auth.isPrivilegedRequest(request(login.token)), true);
    timestamp = login.expiresAt;
    assert.equal(auth.isPrivilegedRequest(request(login.token)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('revoke invalidates one session without affecting another', () => {
  const { dir, secretsPath } = fixture();
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath });
    const first = auth.authenticate('beta-pass', false, 'tablet-a');
    const second = auth.authenticate('gamma-pass', false, 'tablet-b');
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(auth.revokeRequest(request(first.token)), true);
    assert.equal(auth.isPrivilegedRequest(request(first.token)), false);
    assert.equal(auth.isPrivilegedRequest(request(second.token)), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rate limits repeated failures and never issues a token for invalid input', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 5000;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    for (let i = 0; i < CAPTAINPAD_AUTH_CONSTANTS.FAILURE_LIMIT; i += 1) {
      assert.equal(auth.authenticate('wrong-pass', false, 'tablet-a').status, 401);
    }
    assert.equal(auth.authenticate('alpha-pass', false, 'tablet-a').status, 429);
    timestamp += CAPTAINPAD_AUTH_CONSTANTS.LOCKOUT_MS + 1;
    assert.equal(auth.authenticate('alpha-pass', false, 'tablet-a').ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('active lockout survives the failure-window rollover', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 0;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    for (const seconds of [0, 10, 20, 30, 59]) {
      timestamp = seconds * 1000;
      assert.equal(auth.authenticate('wrong-pass', false, 'tablet-a').status, 401);
    }
    timestamp = 61 * 1000;
    assert.equal(auth.authenticate('alpha-pass', false, 'tablet-a').status, 429);
    timestamp = (59 * 1000) + CAPTAINPAD_AUTH_CONSTANTS.LOCKOUT_MS + 1;
    assert.equal(auth.authenticate('alpha-pass', false, 'tablet-a').ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('required mode fails loudly when credentials are missing or duplicated', () => {
  const { dir, secretsPath } = fixture();
  try {
    fs.writeFileSync(secretsPath, 'SinaAuth: same\nMishaAuth: same\nMARITIME_TERM_FOR_SAILIOR_PASS: same\n');
    assert.throws(() => createCaptainPadAuth({ required: true, secretsPath }), /distinct/);
    assert.throws(() => createCaptainPadAuth({ required: true, secretsPath: path.join(dir, 'missing') }), /could not read/);
    fs.writeFileSync(secretsPath, 'SinaAuth: private-test-literal\n  malformed: [\n');
    assert.throws(
      () => createCaptainPadAuth({ required: true, secretsPath }),
      (error) => /values redacted/.test(error.message) && !error.message.includes('private-test-literal'),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('environment mode must be explicit instead of silently disabling protection', () => {
  const prior = process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
  try {
    delete process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
    assert.throws(() => createCaptainPadAuth(), /explicitly set to 1 or 0/);
    process.env.BM26_CAPTAINPAD_AUTH_REQUIRED = 'unexpected';
    assert.throws(() => createCaptainPadAuth(), /explicitly set to 1 or 0/);
    process.env.BM26_CAPTAINPAD_AUTH_REQUIRED = '0';
    assert.equal(createCaptainPadAuth().required, false);
  } finally {
    if (prior === undefined) delete process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
    else process.env.BM26_CAPTAINPAD_AUTH_REQUIRED = prior;
  }
});

// ── PER-ATTEMPT TAKEOVER PASSCODE (operator ruling 2026-08-14) ─────────────
// "Pass code is required EVERY TIME." verifyPassphrase is the primitive the
// performance-mode takeover gate uses: it re-checks the credential itself on
// every attempt and issues NOTHING, so no session token, remembered login, or
// recent success can ever stand in for typing the passcode again.

test('verifyPassphrase authorises each of the three named principals and issues no session', () => {
  const { dir, secretsPath } = fixture();
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath });
    assert.deepEqual(auth.verifyPassphrase('alpha-pass', 'pad'), { ok: true, principal: 'owner' });
    assert.deepEqual(auth.verifyPassphrase('beta-pass', 'pad'), { ok: true, principal: 'collaborator' });
    assert.deepEqual(auth.verifyPassphrase('gamma-pass', 'pad'), { ok: true, principal: 'bringup' });
    // No session exists to be reused: a request carrying nothing is unprivileged,
    // and verify never returned a token to carry in the first place.
    assert.equal(auth.isPrivilegedRequest(request(null)), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an active privileged SESSION is not a substitute for the passcode', () => {
  const { dir, secretsPath } = fixture();
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath });
    const login = auth.authenticate('alpha-pass', true, 'pad');
    assert.equal(login.ok, true);
    assert.equal(auth.isPrivilegedRequest(request(login.token)), true, 'session is live');
    // …and the takeover gate still refuses anything that is not the passcode,
    // including the session token itself.
    assert.equal(auth.verifyPassphrase(login.token, 'pad').ok, false);
    assert.equal(auth.verifyPassphrase('', 'pad').ok, false);
    assert.equal(auth.verifyPassphrase(undefined, 'pad').status, 400);
    // Two consecutive takeovers each need their own passcode — a success does
    // not arm a grace period, it just returns ok again for the next entry.
    assert.equal(auth.verifyPassphrase('alpha-pass', 'pad').ok, true);
    assert.equal(auth.verifyPassphrase('alpha-pass', 'pad').ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyPassphrase shares the existing lockout policy and never echoes the secret', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 1000;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    for (let attempt = 0; attempt < CAPTAINPAD_AUTH_CONSTANTS.FAILURE_LIMIT; attempt++) {
      const result = auth.verifyPassphrase('wrong-pass', 'pad');
      assert.equal(result.status, 401);
      assert.equal(JSON.stringify(result).includes('wrong-pass'), false, 'the attempt leaked into the result');
    }
    const limited = auth.verifyPassphrase('alpha-pass', 'pad');
    assert.equal(limited.status, 429);
    assert.equal(limited.code, 'AUTH_RATE_LIMITED');
    timestamp += CAPTAINPAD_AUTH_CONSTANTS.LOCKOUT_MS + 1;
    assert.equal(auth.verifyPassphrase('alpha-pass', 'pad').ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with privileged auth DISABLED verifyPassphrase refuses rather than guessing', () => {
  const auth = createCaptainPadAuth({ required: false });
  assert.deepEqual(auth.verifyPassphrase('anything', 'pad'), {
    ok: false, status: 503, code: 'PRIVILEGED_AUTH_DISABLED',
  });
});

// ── OPERATOR PASSCODE WAIVER (operator ruling 2026-08-18) ─────────────────
// Separate from privileged sessions: minted only after passcode verification,
// scoped to operator-passcode gates, 30-minute lifetime, in-memory on engine.

test('mintPasscodeWaiver issues an opaque waiver without creating a session', () => {
  const { dir, secretsPath } = fixture();
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath });
    const minted = auth.mintPasscodeWaiver('gamma-pass', 'pad-a');
    assert.equal(minted.ok, true);
    assert.equal(typeof minted.token, 'string');
    assert.ok(minted.token.length > 0);
    assert.equal(minted.principal, 'bringup');
    assert.equal(minted.remainingMs, CAPTAINPAD_AUTH_CONSTANTS.REMEMBERED_SESSION_MS);
    assert.equal(auth.isPrivilegedRequest(request(minted.token)), false);
    const waiver = auth.waiverForToken(minted.token);
    assert.equal(waiver.principal, 'bringup');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passcode waivers expire after 30 minutes and never log the secret', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 1000;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    const minted = auth.mintPasscodeWaiver('alpha-pass', 'pad-a');
    assert.equal(minted.ok, true);
    assert.equal(auth.waiverForToken(minted.token).principal, 'owner');
    timestamp = minted.expiresAt;
    assert.equal(auth.waiverForToken(minted.token), null);
    assert.equal(JSON.stringify(minted).includes('alpha-pass'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mintPasscodeWaiver shares the passcode lockout policy', () => {
  const { dir, secretsPath } = fixture();
  let timestamp = 5000;
  try {
    const auth = createCaptainPadAuth({ required: true, secretsPath, now: () => timestamp });
    for (let i = 0; i < CAPTAINPAD_AUTH_CONSTANTS.FAILURE_LIMIT; i += 1) {
      assert.equal(auth.mintPasscodeWaiver('wrong-pass', 'pad-a').status, 401);
    }
    assert.equal(auth.mintPasscodeWaiver('alpha-pass', 'pad-a').status, 429);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
