export interface PasscodeWaiverShape {
  token: string;
  principal: string;
  expiresAt: number;
  engineOrigin: string;
}

export const PASSCODE_WAIVER_MS = 30 * 60 * 1000;

interface PasscodeWaiverResponse {
  ok?: unknown;
  token?: unknown;
  principal?: unknown;
  remainingMs?: unknown;
}

export function passcodeWaiverFromResponse(
  body: PasscodeWaiverResponse,
  requestStartedAt: number,
  engineOrigin: string,
): PasscodeWaiverShape {
  if (body.ok !== true) throw new Error('Passcode waiver mint failed');
  if (typeof body.token !== 'string' || body.token.length === 0) {
    throw new Error('Passcode waiver response is malformed');
  }
  if (typeof body.principal !== 'string' || body.principal.length === 0) {
    throw new Error('Passcode waiver response is malformed');
  }
  if (typeof engineOrigin !== 'string' || engineOrigin.length === 0) {
    throw new Error('Passcode waiver engine origin is malformed');
  }
  if (typeof body.remainingMs !== 'number'
      || !Number.isFinite(body.remainingMs)
      || body.remainingMs <= 0
      || body.remainingMs > PASSCODE_WAIVER_MS) {
    throw new Error('Passcode waiver lifetime is out of range');
  }
  return {
    token: body.token,
    principal: body.principal,
    expiresAt: requestStartedAt + body.remainingMs,
    engineOrigin,
  };
}

export function isValidPasscodeWaiver(
  waiver: PasscodeWaiverShape | null,
  now = Date.now(),
): waiver is PasscodeWaiverShape {
  return !!waiver
    && typeof waiver.token === 'string'
    && waiver.token.length > 0
    && typeof waiver.principal === 'string'
    && waiver.principal.length > 0
    && Number.isFinite(waiver.expiresAt)
    && waiver.expiresAt > now
    && typeof waiver.engineOrigin === 'string'
    && waiver.engineOrigin.length > 0;
}

export function passcodeWaiverBelongsToEngineOrigin(
  waiver: PasscodeWaiverShape | null,
  engineOrigin: string | null,
  now = Date.now(),
): waiver is PasscodeWaiverShape {
  return engineOrigin !== null
    && isValidPasscodeWaiver(waiver, now)
    && waiver.engineOrigin === engineOrigin;
}

export function shouldClearPasscodeWaiver(
  responseStatus: number,
  engineOriginRequest: boolean,
  waiverTokenSent: boolean,
): boolean {
  return (responseStatus === 401 || responseStatus === 403)
    && engineOriginRequest
    && waiverTokenSent;
}
