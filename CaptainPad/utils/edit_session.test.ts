/**
 * Pinned copy tests for the principal-scoped persistence refusals (docs/56).
 *
 * The point of every assertion here is the same: the operator must learn WHAT
 * happened and WHAT TO DO, and must never see the passcode they typed, a raw
 * engine body, or a deployment detail echoed back.
 */
import { describe, expect, it } from 'vitest';

import {
  EDIT_PRINCIPAL_READONLY,
  EDIT_SESSION_AUTH_INVALID,
  EDIT_SESSION_AUTH_RATE_LIMITED,
  EDIT_SESSION_PERFORMANCE_ACTIVE,
  EXIT_AUTH_INVALID,
  EXIT_AUTH_RATE_LIMITED,
  EXIT_AUTH_REQUIRED,
  EXIT_KEEP_SAVE_OWNER_ONLY,
  editSessionRefusalMessage,
  performanceExitFailureMessage,
  performanceExitRefusalMessage,
  principalReadonlyMessage,
} from './edit_session';

const SECRET = 'hunter2-not-a-real-passcode';

describe('performanceExitRefusalMessage', () => {
  it('maps only the exit family — anything else falls through to the caller', () => {
    expect(performanceExitRefusalMessage({ ok: false, code: EXIT_AUTH_REQUIRED }))
      .toContain('operator passcode');
    expect(performanceExitRefusalMessage({ ok: false, code: EXIT_AUTH_INVALID }))
      .toContain('rejected');
    expect(performanceExitRefusalMessage({ ok: false, code: 'PERFORMANCE_MODE' })).toBeNull();
    expect(performanceExitRefusalMessage({ ok: false })).toBeNull();
    expect(performanceExitRefusalMessage({ ok: true })).toBeNull();
  });

  it('the keep-save refusal names the way out, not just the wall', () => {
    const msg = performanceExitRefusalMessage({
      ok: false, code: EXIT_KEEP_SAVE_OWNER_ONLY, data: { principal: 'bringup' },
    });
    expect(msg).toContain('captain');
    // The two exits that DO work for this principal are named explicitly.
    expect(msg).toContain('KEEP WITHOUT SAVING');
    expect(msg).toContain('RESTORE PRE-SHOW');
  });

  it('reports the engine lockout window instead of inventing one', () => {
    expect(performanceExitRefusalMessage({
      ok: false, code: EXIT_AUTH_RATE_LIMITED, data: { retryAfterMs: 42_000 },
    })).toContain('42s');
    // No window supplied → say so honestly rather than guessing a number.
    const vague = performanceExitRefusalMessage({ ok: false, code: EXIT_AUTH_RATE_LIMITED });
    expect(vague).toContain('wait');
    expect(vague).not.toMatch(/\d+s/);
    // A malformed window is not a window.
    expect(performanceExitRefusalMessage({
      ok: false, code: EXIT_AUTH_RATE_LIMITED, data: { retryAfterMs: 'soon' },
    })).not.toMatch(/\d+s/);
  });
});

describe('editSessionRefusalMessage', () => {
  it('always returns copy — this sheet has nowhere else to put a failure', () => {
    expect(editSessionRefusalMessage({ ok: false, code: EDIT_SESSION_AUTH_INVALID })).toBeTruthy();
    expect(editSessionRefusalMessage({ ok: false, code: 'SOMETHING_NEW' })).toBeTruthy();
    expect(editSessionRefusalMessage({ ok: false })).toBeTruthy();
  });

  it('points at the exit flow when the show lock is still on', () => {
    expect(editSessionRefusalMessage({ ok: false, code: EDIT_SESSION_PERFORMANCE_ACTIVE }))
      .toContain('Performance mode is live');
  });

  it('explains an auth-disabled engine instead of implying a failure', () => {
    expect(editSessionRefusalMessage({ ok: false, code: 'PRIVILEGED_AUTH_DISABLED' }))
      .toContain('already saves');
  });

  it('shares the lockout wording with the exit family', () => {
    expect(editSessionRefusalMessage({
      ok: false, code: EDIT_SESSION_AUTH_RATE_LIMITED, data: { retryAfterMs: 9_000 },
    })).toContain('9s');
  });
});

describe('principalReadonlyMessage', () => {
  it('fires only for the 403 principal gate', () => {
    expect(principalReadonlyMessage({ ok: false, code: 'PERFORMANCE_MODE' })).toBeNull();
    expect(principalReadonlyMessage({ ok: false })).toBeNull();
  });

  it('names the session and the way out', () => {
    const sailor = principalReadonlyMessage({
      ok: false, code: EDIT_PRINCIPAL_READONLY, data: { principal: 'bringup' },
    });
    expect(sailor).toContain('Not saved');
    expect(sailor).toContain('sailor session');
    expect(sailor).toContain('captain');
    const crew = principalReadonlyMessage({
      ok: false, code: EDIT_PRINCIPAL_READONLY, data: { principal: 'collaborator' },
    });
    expect(crew).toContain('crew session');
  });
});

// ── Report _236: the exit flow may never end without a sentence ────────────
//
// The regression this pins: `doExit` used to route every failure outside the
// four edit-session codes to `Alert.alert`, which react-native-web implements
// as `static alert() {}` — an empty stub. A 400 / 423 / 500 / timeout therefore
// left the exit sheet open with no message and no mode change, which is what
// the operator reported as "the buttons aren't making progress anymore".
describe('performanceExitFailureMessage', () => {
  const CODES = [
    EXIT_AUTH_REQUIRED,
    EXIT_AUTH_INVALID,
    EXIT_AUTH_RATE_LIMITED,
    EXIT_KEEP_SAVE_OWNER_ONLY,
    'PERFORMANCE_MODE_NOT_ACTIVE',
    'PERFORMANCE_MODE_SNAPSHOT_MISSING',
    'PERFORMANCE_MODE_SNAPSHOT_MALFORMED',
    'PERFORMANCE_MODE_INVALID_EXIT',
    'INVALID_BODY',
    'TOUCH_CONTROL_LEASE_HELD',
    'TOUCH_CONTROL_LEASE_INACTIVE',
    'SPECIAL_EVENT',
    'PERFORMANCE_MODE',
    'SOME_CODE_THAT_DOES_NOT_EXIST_YET',
  ];

  it('ALWAYS returns a real sentence — there is no silent branch', () => {
    for (const code of [...CODES, undefined]) {
      const msg = performanceExitFailureMessage({ ok: false, code });
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(20);
      expect(msg.trim().endsWith('.')).toBe(true);
    }
  });

  it('keeps the four edit-session refusals byte-identical to the family mapper', () => {
    for (const code of [
      EXIT_AUTH_REQUIRED, EXIT_AUTH_INVALID, EXIT_AUTH_RATE_LIMITED, EXIT_KEEP_SAVE_OWNER_ONLY,
    ]) {
      const result = { ok: false, code, data: { retryAfterMs: 42_000 } };
      expect(performanceExitFailureMessage(result))
        .toBe(performanceExitRefusalMessage(result));
    }
  });

  it('names the cause AND the way out for the non-family refusals', () => {
    expect(performanceExitFailureMessage({ ok: false, code: 'PERFORMANCE_MODE_NOT_ACTIVE' }))
      .toContain('already off');
    expect(performanceExitFailureMessage({ ok: false, code: 'PERFORMANCE_MODE_SNAPSHOT_MISSING' }))
      .toContain('KEEP LIVE STATE');
    expect(performanceExitFailureMessage({ ok: false, code: 'TOUCH_CONTROL_LEASE_HELD' }))
      .toContain('Touch Control');
    expect(performanceExitFailureMessage({ ok: false, code: 'SPECIAL_EVENT' }))
      .toContain('Events tab');
    expect(performanceExitFailureMessage({ ok: false, code: 'INVALID_BODY' }))
      .toContain('Reload');
  });

  it('carries the machine code for a refusal it has never seen', () => {
    // A code this build does not know about is still LOUD: the operator can
    // read it out to whoever debugs the engine.
    expect(performanceExitFailureMessage({ ok: false, code: 'BRAND_NEW_ENGINE_CODE' }))
      .toContain('BRAND_NEW_ENGINE_CODE');
  });

  it('covers the no-code case (offline engine / client timeout)', () => {
    const msg = performanceExitFailureMessage({ ok: false });
    expect(msg).toContain('did not answer');
    expect(msg).toContain('unchanged');
  });
});

describe('secret hygiene', () => {
  it('no refusal copy can ever contain the attempted passcode', () => {
    // Every mapper is keyed off the machine CODE, so even an engine body that
    // (wrongly) echoed a secret could not carry it into the operator UI.
    const poisoned = { retryAfterMs: 1000, principal: 'bringup', error: SECRET, passcode: SECRET };
    const messages = [
      performanceExitRefusalMessage({ ok: false, code: EXIT_AUTH_INVALID, data: poisoned }),
      performanceExitRefusalMessage({ ok: false, code: EXIT_AUTH_RATE_LIMITED, data: poisoned }),
      performanceExitRefusalMessage({ ok: false, code: EXIT_KEEP_SAVE_OWNER_ONLY, data: poisoned }),
      editSessionRefusalMessage({ ok: false, code: EDIT_SESSION_AUTH_INVALID, data: poisoned }),
      editSessionRefusalMessage({ ok: false, code: 'ANYTHING', data: poisoned }),
      principalReadonlyMessage({ ok: false, code: EDIT_PRINCIPAL_READONLY, data: poisoned }),
      // _236's total mapper included — it is the one that now renders on EVERY
      // failed exit, so it is the one most likely to meet a poisoned body.
      performanceExitFailureMessage({ ok: false, code: EXIT_AUTH_INVALID, data: poisoned }),
      performanceExitFailureMessage({ ok: false, code: SECRET, data: poisoned }),
      performanceExitFailureMessage({ ok: false, data: poisoned }),
    ];
    for (const msg of messages) {
      expect(msg ?? '').not.toContain(SECRET);
    }
  });
});
