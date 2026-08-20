// operatorAuthHeaders — typed passcode / remember30 / waiver precedence.
//
// Pure header construction; passcode_waiver I/O is mocked so this suite stays
// in plain Node without AsyncStorage or fetch.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_PASSCODE = 'fake-code-charlie';
const FAKE_WAIVER_TOKEN = 'opaque-waiver-token';

vi.mock('./passcode_waiver', () => ({
  PASSCODE_WAIVER_HEADER: 'X-CaptainPad-Passcode-Waiver',
  getValidPasscodeWaiver: vi.fn(),
  mintPasscodeWaiver: vi.fn(),
  clearPasscodeWaiver: vi.fn(),
}));

vi.mock('./apiBase', () => ({
  getApiBase: () => 'http://engine.test:6968',
}));

import { TAKEOVER_PASSCODE_HEADER } from './edit_session';
import {
  clearOperatorAuthOnRefusal,
  operatorAuthHeaders,
} from './operator_auth';
import {
  clearPasscodeWaiver,
  getValidPasscodeWaiver,
  mintPasscodeWaiver,
  PASSCODE_WAIVER_HEADER,
} from './passcode_waiver';

const getValid = vi.mocked(getValidPasscodeWaiver);
const mintWaiver = vi.mocked(mintPasscodeWaiver);
const clearWaiver = vi.mocked(clearPasscodeWaiver);

beforeEach(() => {
  getValid.mockReset();
  mintWaiver.mockReset();
  clearWaiver.mockReset();
  getValid.mockResolvedValue(null);
  mintWaiver.mockResolvedValue({
    token: FAKE_WAIVER_TOKEN,
    principal: 'owner',
    expiresAt: Date.now() + 30 * 60 * 1000,
    engineOrigin: 'http://engine.test',
  });
});

describe('operatorAuthHeaders', () => {
  it('returns {} when no passcode, waiver, or stored waiver exist', async () => {
    expect(await operatorAuthHeaders({})).toEqual({});
  });

  it('does not treat a raw string as a passcode — callers must pass { passcode }', async () => {
    // Regression: doExit / assertEditSession used to pass bare strings, which
    // produced {} and EXIT_AUTH_REQUIRED on every gated exit.
    expect(await operatorAuthHeaders(FAKE_PASSCODE as unknown as { passcode: string }))
      .toEqual({});
  });

  it('sends the passcode header when remember30 is false or absent', async () => {
    expect(await operatorAuthHeaders({ passcode: FAKE_PASSCODE })).toEqual({
      [TAKEOVER_PASSCODE_HEADER]: FAKE_PASSCODE,
    });
    expect(getValid).not.toHaveBeenCalled();
    expect(await operatorAuthHeaders({ passcode: FAKE_PASSCODE, remember30: false })).toEqual({
      [TAKEOVER_PASSCODE_HEADER]: FAKE_PASSCODE,
    });
    expect(getValid).not.toHaveBeenCalled();
  });

  it('remember30 mints a waiver and sends the waiver header — never the raw passcode', async () => {
    const headers = await operatorAuthHeaders({ passcode: FAKE_PASSCODE, remember30: true });
    expect(mintWaiver).toHaveBeenCalledWith(FAKE_PASSCODE);
    expect(headers).toEqual({ [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN });
    expect(headers[TAKEOVER_PASSCODE_HEADER as keyof typeof headers]).toBeUndefined();
  });

  it('uses a stored waiver when no fresh passcode is supplied', async () => {
    getValid.mockResolvedValue({
      token: FAKE_WAIVER_TOKEN,
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test',
    });
    expect(await operatorAuthHeaders({})).toEqual({
      [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN,
    });
  });

  it('prefers an explicit waiverToken over stored waiver and passcode', async () => {
    getValid.mockResolvedValue({
      token: 'stored-token',
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test',
    });
    expect(await operatorAuthHeaders({
      waiverToken: 'explicit-token',
      passcode: FAKE_PASSCODE,
    })).toEqual({ [PASSCODE_WAIVER_HEADER]: 'explicit-token' });
    expect(getValid).not.toHaveBeenCalled();
    expect(mintWaiver).not.toHaveBeenCalled();
  });

  it('does not validate a stored waiver when a fresh passcode is supplied', async () => {
    getValid.mockResolvedValue({
      token: 'stored-token',
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test',
    });
    await operatorAuthHeaders({ passcode: FAKE_PASSCODE, remember30: true });
    expect(getValid).not.toHaveBeenCalled();
    expect(mintWaiver).toHaveBeenCalledWith(FAKE_PASSCODE);
  });
});

describe('clearOperatorAuthOnRefusal', () => {
  const engineUrl = 'http://engine.test:6968/performance-mode';

  it('clears a waiver header after an engine-origin 401/403', async () => {
    await clearOperatorAuthOnRefusal({ [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN }, 401, engineUrl);
    expect(clearWaiver).toHaveBeenCalled();
  });

  it('ignores passcode-header refusals, non-auth statuses, and cross-origin probes', async () => {
    await clearOperatorAuthOnRefusal({ [TAKEOVER_PASSCODE_HEADER]: FAKE_PASSCODE }, 401, engineUrl);
    expect(clearWaiver).not.toHaveBeenCalled();
    await clearOperatorAuthOnRefusal({ [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN }, 400, engineUrl);
    expect(clearWaiver).not.toHaveBeenCalled();
    await clearOperatorAuthOnRefusal(
      { [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN },
      401,
      'http://other-host.test:6968/performance-mode',
    );
    expect(clearWaiver).not.toHaveBeenCalled();
    await clearOperatorAuthOnRefusal({ [PASSCODE_WAIVER_HEADER]: FAKE_WAIVER_TOKEN }, 403, engineUrl);
    expect(clearWaiver).toHaveBeenCalledTimes(1);
  });
});
