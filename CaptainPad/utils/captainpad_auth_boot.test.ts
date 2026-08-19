import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  fetchWithTimeout: vi.fn(),
  getApiBaseAsync: vi.fn(async () => 'http://engine.test:6968'),
}));

vi.mock('./privileged_session', () => ({
  clearPrivilegedSession: vi.fn(async () => undefined),
  getPrivilegedSession: vi.fn(),
  restorePrivilegedSession: vi.fn(),
  setPrivilegedSession: vi.fn(async () => undefined),
}));

vi.mock('./passcode_waiver', () => ({
  PASSCODE_WAIVER_HEADER: 'X-CaptainPad-Passcode-Waiver',
  clearPasscodeWaiver: vi.fn(async () => undefined),
  getPasscodeWaiverToken: vi.fn(),
  getValidPasscodeWaiver: vi.fn(),
  restorePasscodeWaiver: vi.fn(),
  setPasscodeWaiver: vi.fn(async () => undefined),
}));

import { fetchWithTimeout } from './api';
import {
  clearCaptainPadAuthOnBootFailure,
  lockCaptainPadAuth,
  restoreCaptainPadAuthOnBoot,
} from './captainpad_auth_boot';
import {
  clearPasscodeWaiver,
  getPasscodeWaiverToken,
  getValidPasscodeWaiver,
  PASSCODE_WAIVER_HEADER,
  restorePasscodeWaiver,
  setPasscodeWaiver,
} from './passcode_waiver';
import {
  clearPrivilegedSession,
  getPrivilegedSession,
  restorePrivilegedSession,
  setPrivilegedSession,
} from './privileged_session';

const restoreSession = vi.mocked(restorePrivilegedSession);
const restoreWaiver = vi.mocked(restorePasscodeWaiver);
const validateWaiver = vi.mocked(getValidPasscodeWaiver);
const waiverToken = vi.mocked(getPasscodeWaiverToken);
const fetchMock = vi.mocked(fetchWithTimeout);

beforeEach(() => {
  restoreSession.mockReset();
  restoreWaiver.mockReset();
  validateWaiver.mockReset();
  waiverToken.mockReset();
  fetchMock.mockReset();
  vi.mocked(clearPrivilegedSession).mockClear();
  vi.mocked(clearPasscodeWaiver).mockClear();
  vi.mocked(setPrivilegedSession).mockClear();
  vi.mocked(setPasscodeWaiver).mockClear();
  vi.mocked(getPrivilegedSession).mockReturnValue(null);
  restoreSession.mockResolvedValue(null);
  restoreWaiver.mockResolvedValue(null);
  waiverToken.mockReturnValue(null);
  fetchMock.mockResolvedValue({ ok: true } as Response);
});

describe('restoreCaptainPadAuthOnBoot', () => {
  it('re-validates a restored waiver and clears it when the engine rejects it', async () => {
    restoreWaiver.mockResolvedValue({
      token: 'stored-waiver',
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test:6968',
    });
    validateWaiver.mockResolvedValue(null);

    await restoreCaptainPadAuthOnBoot();

    expect(setPasscodeWaiver).toHaveBeenCalled();
    expect(clearPasscodeWaiver).toHaveBeenCalled();
  });
});

describe('clearCaptainPadAuthOnBootFailure', () => {
  it('clears both privileged session and passcode waiver', async () => {
    await clearCaptainPadAuthOnBootFailure();
    expect(clearPrivilegedSession).toHaveBeenCalled();
    expect(clearPasscodeWaiver).toHaveBeenCalled();
  });
});

describe('boot restore failure handling', () => {
  it('clears both auth surfaces when restore throws', async () => {
    restoreSession.mockRejectedValue(new Error('storage unavailable'));

    await expect(restoreCaptainPadAuthOnBoot()).rejects.toThrow('storage unavailable');
    await clearCaptainPadAuthOnBootFailure();

    expect(clearPrivilegedSession).toHaveBeenCalled();
    expect(clearPasscodeWaiver).toHaveBeenCalled();
  });
});

describe('lockCaptainPadAuth', () => {
  it('sends the active waiver header on logout and always clears local auth', async () => {
    waiverToken.mockReturnValue('active-waiver-token');

    await lockCaptainPadAuth();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine.test:6968/captainpad/auth/logout',
      { method: 'POST', headers: { [PASSCODE_WAIVER_HEADER]: 'active-waiver-token' } },
      5000,
      null,
    );
    expect(clearPrivilegedSession).toHaveBeenCalled();
    expect(clearPasscodeWaiver).toHaveBeenCalled();
  });

  it('still clears local auth when logout throws', async () => {
    waiverToken.mockReturnValue('active-waiver-token');
    fetchMock.mockRejectedValue(new Error('Engine unreachable'));

    await expect(lockCaptainPadAuth()).rejects.toThrow('Engine unreachable');

    expect(fetchMock).toHaveBeenCalled();
    expect(clearPrivilegedSession).toHaveBeenCalled();
    expect(clearPasscodeWaiver).toHaveBeenCalled();
  });
});
