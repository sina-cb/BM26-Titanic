import { describe, expect, it } from 'vitest';

import {
  isEngineOriginRequest,
  normalizedOrigin,
  shouldClearPrivilegedSession,
  shouldClearSessionForEngineOriginChange,
} from './privileged_request_scope';

describe('privileged request scoping', () => {
  const engineBase = 'http://show-host.local:6968';

  it('allows only the configured engine origin', () => {
    expect(isEngineOriginRequest('http://show-host.local:6968/performance-mode', engineBase)).toBe(true);
    expect(isEngineOriginRequest('http://show-host.local:6968/captainpad/auth/session', engineBase)).toBe(true);
  });

  it('blocks arbitrary probes and embedded service origins', () => {
    expect(isEngineOriginRequest('http://show-host.local:6966/', engineBase)).toBe(false);
    expect(isEngineOriginRequest('http://show-host.local:6969/simulation/', engineBase)).toBe(false);
    expect(isEngineOriginRequest('http://another-host.local:6968/status', engineBase)).toBe(false);
    expect(isEngineOriginRequest('not-a-url', engineBase)).toBe(false);
  });

  it('normalizes paths while preserving the issuing origin boundary', () => {
    expect(normalizedOrigin('http://show-host.local:6968/api/')).toBe('http://show-host.local:6968');
    expect(normalizedOrigin('not-a-url')).toBeNull();
  });

  it('does not log out on a cross-origin probe response', () => {
    expect(shouldClearPrivilegedSession(401, false, false)).toBe(false);
    expect(shouldClearPrivilegedSession(401, true, true)).toBe(true);
    expect(shouldClearPrivilegedSession(409, true, true)).toBe(false);
  });

  it('relocks when CaptainPad switches to a different engine origin', () => {
    expect(shouldClearSessionForEngineOriginChange(
      'http://show-host.local:6968/api',
      'http://show-host.local:6968/other',
    )).toBe(false);
    expect(shouldClearSessionForEngineOriginChange(
      'http://show-host.local:6968',
      'http://other-host.local:6968',
    )).toBe(true);
  });
});
