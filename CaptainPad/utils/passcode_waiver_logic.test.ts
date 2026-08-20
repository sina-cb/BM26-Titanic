import { describe, expect, it } from 'vitest';

import {
  isValidPasscodeWaiver,
  passcodeWaiverBelongsToEngineOrigin,
  passcodeWaiverFromResponse,
  PASSCODE_WAIVER_MS,
  shouldClearPasscodeWaiver,
} from './passcode_waiver_logic';

const ENGINE_ORIGIN = 'http://engine.test:6968';
const NOW = 1_700_000_000_000;

describe('passcodeWaiverFromResponse', () => {
  it('binds expiry to requestStartedAt + remainingMs', () => {
    const waiver = passcodeWaiverFromResponse(
      { ok: true, token: 'tok', principal: 'owner', remainingMs: 60_000 },
      NOW,
      ENGINE_ORIGIN,
    );
    expect(waiver.expiresAt).toBe(NOW + 60_000);
    expect(waiver.engineOrigin).toBe(ENGINE_ORIGIN);
  });

  it('refuses lifetimes outside the 30-minute cap', () => {
    expect(() => passcodeWaiverFromResponse(
      { ok: true, token: 'tok', principal: 'owner', remainingMs: PASSCODE_WAIVER_MS + 1 },
      NOW,
      ENGINE_ORIGIN,
    )).toThrow(/out of range/i);
  });
});

describe('isValidPasscodeWaiver', () => {
  it('rejects expired waivers', () => {
    expect(isValidPasscodeWaiver({
      token: 'tok',
      principal: 'owner',
      expiresAt: NOW - 1,
      engineOrigin: ENGINE_ORIGIN,
    }, NOW)).toBe(false);
  });
});

describe('passcodeWaiverBelongsToEngineOrigin', () => {
  it('requires a matching engine origin', () => {
    const valid = {
      token: 'tok',
      principal: 'owner',
      expiresAt: NOW + PASSCODE_WAIVER_MS,
      engineOrigin: ENGINE_ORIGIN,
    };
    expect(passcodeWaiverBelongsToEngineOrigin(valid, ENGINE_ORIGIN, NOW)).toBe(true);
    expect(passcodeWaiverBelongsToEngineOrigin(valid, 'http://other.test:6968', NOW)).toBe(false);
  });
});

describe('shouldClearPasscodeWaiver', () => {
  it('clears only engine-origin 401/403 refusals that sent a waiver header', () => {
    expect(shouldClearPasscodeWaiver(401, true, true)).toBe(true);
    expect(shouldClearPasscodeWaiver(403, true, true)).toBe(true);
    expect(shouldClearPasscodeWaiver(401, false, true)).toBe(false);
    expect(shouldClearPasscodeWaiver(401, true, false)).toBe(false);
    expect(shouldClearPasscodeWaiver(409, true, true)).toBe(false);
  });
});
