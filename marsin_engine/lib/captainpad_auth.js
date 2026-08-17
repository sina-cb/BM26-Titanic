import crypto from 'crypto';
import fs from 'fs';
import yaml from 'js-yaml';

const REMEMBERED_SESSION_MS = 30 * 60 * 1000;
const TRANSIENT_SESSION_MS = 8 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 60 * 1000;
const FAILURE_LIMIT = 5;
const LOCKOUT_MS = 60 * 1000;

const SECRET_KEYS = Object.freeze([
  ['owner', 'SinaAuth'],
  ['collaborator', 'MishaAuth'],
  ['bringup', 'MARITIME_TERM_FOR_SAILIOR_PASS'],
]);

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function bearerToken(req) {
  const value = req && req.headers ? req.headers['x-captainpad-session'] : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function loadCredentials(secretsPath) {
  if (!secretsPath) {
    throw new Error('BM26_SECRETS is required when CaptainPad privileged auth is enabled');
  }
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(secretsPath, 'utf8'));
  } catch {
    // js-yaml error messages include a source excerpt. Never forward one: a
    // malformed line adjacent to a credential could otherwise reach launcher
    // logs in this public-repo workflow.
    throw new Error('CaptainPad privileged auth could not read or parse BM26_SECRETS (values redacted)');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('BM26_SECRETS must contain a YAML mapping');
  }
  const credentials = SECRET_KEYS.map(([principal, key]) => {
    const value = parsed[key];
    if (typeof value !== 'string' || value.length < 3) {
      throw new Error(`BM26_SECRETS is missing a valid ${key} value`);
    }
    return { principal, digest: digest(value) };
  });
  const unique = new Set(credentials.map((entry) => entry.digest.toString('hex')));
  if (unique.size !== credentials.length) {
    throw new Error('CaptainPad privileged auth passphrases must be distinct');
  }
  return credentials;
}

/**
 * In-memory CaptainPad privileged-session authority.
 *
 * Raw passphrases and raw session tokens are never logged or retained. An
 * engine restart invalidates every session. The remembered session lifetime is
 * deliberately fixed at 30 minutes; the client decides whether the opaque
 * token survives a page/app reload.
 */
export function createCaptainPadAuth({
  required,
  secretsPath = process.env.BM26_SECRETS,
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  if (required === undefined) {
    const mode = process.env.BM26_CAPTAINPAD_AUTH_REQUIRED;
    if (mode !== '1' && mode !== '0') {
      throw new Error('BM26_CAPTAINPAD_AUTH_REQUIRED must be explicitly set to 1 or 0');
    }
    required = mode === '1';
  }
  if (typeof required !== 'boolean') {
    throw new TypeError('CaptainPad privileged auth required mode must be boolean');
  }
  const credentials = required ? loadCredentials(secretsPath) : [];
  const sessions = new Map();
  const failures = new Map();

  function cleanupSessions() {
    const timestamp = now();
    for (const [key, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(key);
    }
  }

  function failureState(remoteKey) {
    const key = remoteKey || 'unknown';
    const timestamp = now();
    const prior = failures.get(key);
    // A lockout can extend beyond the original counting window. Check it
    // first; rolling the window must never erase an active penalty.
    if (prior && prior.lockedUntil > timestamp) return prior;
    if (!prior || timestamp - prior.windowStartedAt >= FAILURE_WINDOW_MS) {
      const fresh = { windowStartedAt: timestamp, count: 0, lockedUntil: 0 };
      failures.set(key, fresh);
      return fresh;
    }
    return prior;
  }

  /**
   * The ONE credential check: rate-limit gate → constant-time digest compare →
   * failure bookkeeping. Issues nothing. Both `authenticate` (which mints a
   * session on top) and `verifyPassphrase` (which deliberately does not) go
   * through here, so the lockout policy can never diverge between them.
   */
  function checkPassphrase(passphrase, remoteKey) {
    if (!required) return { ok: false, status: 503, code: 'PRIVILEGED_AUTH_DISABLED' };
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      return { ok: false, status: 400, code: 'INVALID_BODY' };
    }
    const attempt = failureState(remoteKey);
    const timestamp = now();
    if (attempt.lockedUntil > timestamp) {
      return {
        ok: false, status: 429, code: 'AUTH_RATE_LIMITED',
        retryAfterMs: attempt.lockedUntil - timestamp,
      };
    }

    const candidate = digest(passphrase);
    let principal = null;
    for (const credential of credentials) {
      const matches = crypto.timingSafeEqual(candidate, credential.digest);
      if (matches) principal = credential.principal;
    }
    if (!principal) {
      attempt.count += 1;
      if (attempt.count >= FAILURE_LIMIT) attempt.lockedUntil = timestamp + LOCKOUT_MS;
      return { ok: false, status: 401, code: 'AUTH_INVALID' };
    }

    failures.delete(remoteKey || 'unknown');
    return { ok: true, principal, timestamp };
  }

  /**
   * Verify a passphrase and issue NOTHING (operator ruling 2026-08-14: the
   * performance-mode takeover passcode "is required EVERY TIME").
   *
   * A caller that gates an action on this can never be satisfied by a stored
   * session token, a remembered 30-minute session, or a trusted device — the
   * only thing that passes is the operator typing one of the live credentials
   * again, right now. The returned principal is a NAME ('owner' /
   * 'collaborator' / 'bringup'), never credential material.
   */
  function verifyPassphrase(passphrase, remoteKey) {
    const result = checkPassphrase(passphrase, remoteKey);
    if (!result.ok) return result;
    return { ok: true, principal: result.principal };
  }

  function authenticate(passphrase, remember30, remoteKey) {
    if (typeof remember30 !== 'boolean') {
      // Preserved ahead of the credential check so a malformed body is still a
      // 400 rather than a credential attempt that burns a failure slot.
      if (!required) return { ok: false, status: 503, code: 'PRIVILEGED_AUTH_DISABLED' };
      return { ok: false, status: 400, code: 'INVALID_BODY' };
    }
    const checked = checkPassphrase(passphrase, remoteKey);
    if (!checked.ok) return checked;
    const principal = checked.principal;
    const timestamp = checked.timestamp;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = timestamp + (remember30 ? REMEMBERED_SESSION_MS : TRANSIENT_SESSION_MS);
    sessions.set(digest(token).toString('hex'), { principal, expiresAt, remembered: remember30 });
    return {
      ok: true,
      token,
      principal,
      expiresAt,
      remainingMs: expiresAt - timestamp,
      remembered: remember30,
    };
  }

  function sessionForToken(token) {
    if (!required || typeof token !== 'string' || token.length === 0) return null;
    cleanupSessions();
    return sessions.get(digest(token).toString('hex')) || null;
  }

  function sessionForRequest(req) {
    return sessionForToken(bearerToken(req));
  }

  function revokeRequest(req) {
    const token = bearerToken(req);
    if (!token) return false;
    return sessions.delete(digest(token).toString('hex'));
  }

  return Object.freeze({
    required,
    authenticate,
    verifyPassphrase,
    sessionForRequest,
    revokeRequest,
    isPrivilegedRequest: (req) => sessionForRequest(req) !== null,
  });
}

export const CAPTAINPAD_AUTH_CONSTANTS = Object.freeze({
  REMEMBERED_SESSION_MS,
  TRANSIENT_SESSION_MS,
  FAILURE_LIMIT,
  LOCKOUT_MS,
});
