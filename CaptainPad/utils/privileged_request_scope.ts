export function normalizedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isEngineOriginRequest(requestUrl: string, engineApiBase: string): boolean {
  const requestOrigin = normalizedOrigin(requestUrl);
  const engineOrigin = normalizedOrigin(engineApiBase);
  return requestOrigin !== null && engineOrigin !== null && requestOrigin === engineOrigin;
}

export function shouldClearPrivilegedSession(
  responseStatus: number,
  engineOriginRequest: boolean,
  sessionTokenSent: boolean,
): boolean {
  return responseStatus === 401 && engineOriginRequest && sessionTokenSent;
}

export function shouldClearSessionForEngineOriginChange(
  previousBase: string,
  nextBase: string,
): boolean {
  const previousOrigin = normalizedOrigin(previousBase);
  const nextOrigin = normalizedOrigin(nextBase);
  return previousOrigin === null || nextOrigin === null || previousOrigin !== nextOrigin;
}
