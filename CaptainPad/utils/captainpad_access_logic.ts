export interface PrivilegedSessionShape {
  token: string;
  principal: string;
  expiresAt: number;
  remembered: boolean;
  engineOrigin: string;
}

const REMEMBERED_SESSION_MS = 30 * 60 * 1000;
const TRANSIENT_SESSION_MS = 8 * 60 * 60 * 1000;

interface AuthSessionResponse {
  authenticated?: unknown;
  token?: unknown;
  principal?: unknown;
  remainingMs?: unknown;
  remembered?: unknown;
}

export function privilegedSessionFromResponse(
  body: AuthSessionResponse,
  existingToken: string | null,
  requestStartedAt: number,
  engineOrigin: string,
): PrivilegedSessionShape {
  if (body.authenticated !== true) throw new Error('Authentication failed');
  const token = typeof body.token === 'string' ? body.token : existingToken;
  if (!token || typeof body.principal !== 'string' || body.principal.length === 0) {
    throw new Error('Authentication response is malformed');
  }
  if (typeof engineOrigin !== 'string' || engineOrigin.length === 0) {
    throw new Error('Authentication response engine origin is malformed');
  }
  if (typeof body.remembered !== 'boolean'
      || typeof body.remainingMs !== 'number'
      || !Number.isFinite(body.remainingMs)) {
    throw new Error('Authentication response lifetime is malformed');
  }
  const maximumMs = body.remembered ? REMEMBERED_SESSION_MS : TRANSIENT_SESSION_MS;
  if (body.remainingMs <= 0 || body.remainingMs > maximumMs) {
    throw new Error('Authentication response lifetime is out of range');
  }
  return {
    token,
    principal: body.principal,
    expiresAt: requestStartedAt + body.remainingMs,
    remembered: body.remembered,
    engineOrigin,
  };
}

export function isValidPrivilegedSession(
  session: PrivilegedSessionShape | null,
  now = Date.now(),
): session is PrivilegedSessionShape {
  return !!session
    && typeof session.token === 'string'
    && session.token.length > 0
    && typeof session.principal === 'string'
    && session.principal.length > 0
    && Number.isFinite(session.expiresAt)
    && session.expiresAt > now
    && typeof session.remembered === 'boolean'
    && typeof session.engineOrigin === 'string'
    && session.engineOrigin.length > 0;
}

export function sessionBelongsToEngineOrigin(
  session: PrivilegedSessionShape | null,
  engineOrigin: string | null,
  now = Date.now(),
): session is PrivilegedSessionShape {
  return engineOrigin !== null
    && isValidPrivilegedSession(session, now)
    && session.engineOrigin === engineOrigin;
}

export function isEffectivePerformanceLock(
  globalPerformanceActive: boolean,
  session: PrivilegedSessionShape | null,
  accessLoading = false,
  now = Date.now(),
): boolean {
  return globalPerformanceActive
    && (accessLoading || !isValidPrivilegedSession(session, now));
}

export type PerformancePrimaryAction = 'enter-global' | 'authenticate' | 'local-lock';

export function performancePrimaryAction(
  globalPerformanceActive: boolean,
  privileged: boolean,
): PerformancePrimaryAction {
  if (!globalPerformanceActive) return 'enter-global';
  return privileged ? 'local-lock' : 'authenticate';
}

/**
 * Authentication failures deliberately map from engine codes to fixed copy.
 * The client never echoes a passphrase, raw response body, or deployment-file
 * detail back into the operator UI.
 */
export function captainPadAuthFailureMessage(code: unknown): string {
  switch (code) {
    case 'AUTH_INVALID':
      return 'This code was not accepted by the running engine. If credentials were just corrected, '
        + 'the running engine still has its boot-time credential set; ask the show lead to restart it before retrying.';
    case 'AUTH_RATE_LIMITED':
      return 'Too many edit-code attempts. Wait one minute before trying again.';
    case 'PRIVILEGED_AUTH_DISABLED':
      return 'Edit authentication is unavailable on this engine.';
    default:
      return 'Edit authentication could not be completed. Check the engine connection and try again.';
  }
}

export function shouldRevalidatePrivilegedSession(
  session: PrivilegedSessionShape | null,
  now = Date.now(),
): boolean {
  return isValidPrivilegedSession(session, now);
}
