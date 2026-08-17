import { describe, expect, it } from 'vitest';

import {
  captainPadAuthFailureMessage,
  isEffectivePerformanceLock,
  isValidPrivilegedSession,
  performancePrimaryAction,
  privilegedSessionFromResponse,
  sessionBelongsToEngineOrigin,
  shouldRevalidatePrivilegedSession,
  type PrivilegedSessionShape,
} from './captainpad_access_logic';

const NOW = 1_000;
const SESSION: PrivilegedSessionShape = {
  token: 'opaque-session-token',
  principal: 'operator',
  expiresAt: NOW + 30_000,
  remembered: true,
  engineOrigin: 'http://show-host.local:6968',
};

describe('CaptainPad effective performance lock', () => {
  it('keeps edit unlocked while global Performance is inactive', () => {
    expect(isEffectivePerformanceLock(false, null, false, NOW)).toBe(false);
  });

  it('locks an unauthenticated device while global Performance is active', () => {
    expect(isEffectivePerformanceLock(true, null, false, NOW)).toBe(true);
  });

  it('unlocks only the device holding a valid privileged session', () => {
    expect(isEffectivePerformanceLock(true, SESSION, false, NOW)).toBe(false);
  });

  it('fails closed during restore and after expiration', () => {
    expect(isEffectivePerformanceLock(true, SESSION, true, NOW)).toBe(true);
    expect(isEffectivePerformanceLock(true, SESSION, false, SESSION.expiresAt)).toBe(true);
  });

  it('keeps per-device lock separate from ending global Performance', () => {
    expect(performancePrimaryAction(false, false)).toBe('enter-global');
    expect(performancePrimaryAction(true, false)).toBe('authenticate');
    expect(performancePrimaryAction(true, true)).toBe('local-lock');
  });
});

describe('CaptainPad authentication failure copy', () => {
  it('explains a stale running engine without exposing any credential value', () => {
    expect(captainPadAuthFailureMessage('AUTH_INVALID')).toBe(
      'This code was not accepted by the running engine. If credentials were just corrected, '
      + 'the running engine still has its boot-time credential set; ask the show lead to restart it before retrying.',
    );
  });

  it('keeps rate-limit and unknown failures actionable but non-sensitive', () => {
    expect(captainPadAuthFailureMessage('AUTH_RATE_LIMITED')).toMatch(/one minute/i);
    expect(captainPadAuthFailureMessage('unknown')).toMatch(/engine connection/i);
  });
});

describe('privileged session validation', () => {
  it('rejects malformed session fields', () => {
    expect(isValidPrivilegedSession({ ...SESSION, token: '' }, NOW)).toBe(false);
    expect(isValidPrivilegedSession({ ...SESSION, principal: '' }, NOW)).toBe(false);
    expect(isValidPrivilegedSession({ ...SESSION, expiresAt: Number.NaN }, NOW)).toBe(false);
  });

  it('does not leave revalidation pending after a session expires offline', () => {
    expect(shouldRevalidatePrivilegedSession(SESSION, NOW)).toBe(true);
    expect(shouldRevalidatePrivilegedSession(SESSION, SESSION.expiresAt)).toBe(false);
    expect(shouldRevalidatePrivilegedSession(null, NOW)).toBe(false);
  });

  it('derives expiry from server remaining time without trusting wall clocks', () => {
    const session = privilegedSessionFromResponse({
      authenticated: true,
      token: 'new-token',
      principal: 'operator',
      remainingMs: 30 * 60 * 1000,
      remembered: true,
    }, null, NOW, SESSION.engineOrigin);
    expect(session.expiresAt).toBe(NOW + 30 * 60 * 1000);
  });

  it('rejects invalid or overlong server lifetimes', () => {
    const response = {
      authenticated: true,
      token: 'new-token',
      principal: 'operator',
      remembered: true,
    };
    expect(() => privilegedSessionFromResponse({ ...response, remainingMs: 0 }, null, NOW, SESSION.engineOrigin)).toThrow();
    expect(() => privilegedSessionFromResponse({ ...response, remainingMs: 30 * 60 * 1000 + 1 }, null, NOW, SESSION.engineOrigin)).toThrow();
    expect(() => privilegedSessionFromResponse({ ...response, remainingMs: Number.NaN }, null, NOW, SESSION.engineOrigin)).toThrow();
  });

  it('scopes a session to the engine origin that issued it', () => {
    expect(sessionBelongsToEngineOrigin(SESSION, SESSION.engineOrigin, NOW)).toBe(true);
    expect(sessionBelongsToEngineOrigin(SESSION, 'http://other-host.local:6968', NOW)).toBe(false);
  });
});
