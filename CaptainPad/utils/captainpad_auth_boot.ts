import { fetchWithTimeout, getApiBaseAsync } from './api';
import {
  privilegedSessionFromResponse,
  sessionBelongsToEngineOrigin,
} from './captainpad_access_logic';
import { normalizedOrigin } from './privileged_request_scope';
import {
  clearPrivilegedSession,
  getPrivilegedSession,
  restorePrivilegedSession,
  setPrivilegedSession,
  type PrivilegedSession,
} from './privileged_session';
import {
  clearPasscodeWaiver,
  getPasscodeWaiverToken,
  getValidPasscodeWaiver,
  PASSCODE_WAIVER_HEADER,
  restorePasscodeWaiver,
  setPasscodeWaiver,
} from './passcode_waiver';

async function validateSession(session: PrivilegedSession): Promise<PrivilegedSession | null> {
  const base = await getApiBaseAsync();
  const engineOrigin = normalizedOrigin(base);
  if (!engineOrigin || !sessionBelongsToEngineOrigin(session, engineOrigin)) return null;
  const requestStartedAt = Date.now();
  const response = await fetchWithTimeout(
    `${base}/captainpad/auth/session`,
    {},
    5000,
    session,
  );
  if (!response.ok) return null;
  const body = await response.json();
  return privilegedSessionFromResponse(body, session.token, requestStartedAt, engineOrigin);
}

/** Cold-start restore for privileged session and passcode waiver. */
export async function restoreCaptainPadAuthOnBoot(): Promise<void> {
  const [restored, restoredWaiver] = await Promise.all([
    restorePrivilegedSession(),
    restorePasscodeWaiver(),
  ]);
  if (restored) {
    const validated = await validateSession(restored);
    if (validated) await setPrivilegedSession(validated);
    else await clearPrivilegedSession();
  }
  if (restoredWaiver) {
    await setPasscodeWaiver(restoredWaiver);
    const validatedWaiver = await getValidPasscodeWaiver();
    if (!validatedWaiver) await clearPasscodeWaiver();
  }
}

/** Symmetric cleanup when boot restore throws. */
export async function clearCaptainPadAuthOnBootFailure(): Promise<void> {
  await clearPrivilegedSession();
  await clearPasscodeWaiver();
}

/** Lock this CaptainPad: revoke engine-side session/waiver, then clear local auth. */
export async function lockCaptainPadAuth(): Promise<void> {
  const base = await getApiBaseAsync();
  const sessionToken = getPrivilegedSession();
  const waiverToken = getPasscodeWaiverToken();
  const headers: Record<string, string> = {};
  if (waiverToken) headers[PASSCODE_WAIVER_HEADER] = waiverToken;
  try {
    await fetchWithTimeout(
      `${base}/captainpad/auth/logout`,
      { method: 'POST', headers },
      5000,
      sessionToken,
    );
  } finally {
    await clearPrivilegedSession();
    await clearPasscodeWaiver();
  }
}
