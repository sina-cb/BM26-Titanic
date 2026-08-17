import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storage,
}));

import {
  clearPrivilegedSession,
  getPrivilegedSession,
  setPrivilegedSession,
  subscribePrivilegedSession,
  type PrivilegedSession,
} from './privileged_session';

const SESSION: PrivilegedSession = {
  token: 'opaque-session-token',
  principal: 'operator',
  expiresAt: Date.now() + 60_000,
  remembered: true,
  engineOrigin: 'http://show-host.local:6968',
};

describe('privileged session persistence ordering', () => {
  beforeEach(async () => {
    storage.getItem.mockReset();
    storage.setItem.mockReset();
    storage.removeItem.mockReset();
    storage.removeItem.mockResolvedValue(undefined);
    await clearPrivilegedSession();
  });

  it('does not unlock until remembered access is persisted', async () => {
    let finishPersist!: () => void;
    storage.setItem.mockImplementation(() => new Promise<void>((resolve) => {
      finishPersist = resolve;
    }));

    const pending = setPrivilegedSession(SESSION);
    expect(getPrivilegedSession()).toBeNull();
    finishPersist();
    await pending;
    expect(getPrivilegedSession()?.token).toBe(SESSION.token);
  });

  it('stays locked when persistence fails', async () => {
    storage.setItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(setPrivilegedSession(SESSION)).rejects.toThrow('storage unavailable');
    expect(getPrivilegedSession()).toBeNull();
  });

  it('reads the already-locked null state without rebroadcasting during render', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrivilegedSession(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPrivilegedSession()).toBeNull();
    expect(getPrivilegedSession()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
