import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearWaiver = vi.fn(async () => undefined);
const clearSession = vi.fn(async () => undefined);

vi.mock('./passcode_waiver', () => ({
  clearPasscodeWaiver: () => clearWaiver(),
}));

vi.mock('./privileged_session', () => ({
  clearPrivilegedSession: () => clearSession(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({
  engineEvents: { subscribe: () => () => undefined, emitLocal: () => undefined },
}));

let apiBase = 'http://old-engine.test:6968';

vi.mock('./apiBase', () => ({
  get api_base() { return apiBase; },
  getApiBase: () => apiBase,
  getApiBaseAsync: async () => apiBase,
  getDefaultApiBase: () => apiBase,
  setApiBase: vi.fn(async (value: string) => {
    apiBase = value;
  }),
}));

import { setApiBase } from './api';

beforeEach(() => {
  apiBase = 'http://old-engine.test:6968';
  clearWaiver.mockClear();
  clearSession.mockClear();
});

describe('setApiBase', () => {
  it('clears the passcode waiver when the engine origin changes', async () => {
    await setApiBase('http://new-engine.test:6968');
    expect(clearSession).toHaveBeenCalled();
    expect(clearWaiver).toHaveBeenCalled();
  });

  it('does not clear auth when the origin is unchanged', async () => {
    await setApiBase('http://old-engine.test:6968/other-path');
    expect(clearSession).not.toHaveBeenCalled();
    expect(clearWaiver).not.toHaveBeenCalled();
  });
});
