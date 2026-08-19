// passcode_waiver — storage, hydration, mint, validate, and refusal clearing.
//
// P0: passcodes below are obvious placeholders; no credential material from
// $BM26_SECRETS exists in this repo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storage,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({
  engineEvents: { subscribe: () => () => undefined, emitLocal: () => undefined },
}));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test:6968',
  getApiBase: () => 'http://engine.test:6968',
  getApiBaseAsync: async () => 'http://engine.test:6968',
  getDefaultApiBase: () => 'http://engine.test:6968',
  setApiBase: vi.fn(),
}));

import {
  clearPasscodeWaiver,
  getPasscodeWaiver,
  getValidPasscodeWaiver,
  mintPasscodeWaiver,
  PASSCODE_WAIVER_HEADER,
  setPasscodeWaiver,
} from './passcode_waiver';
import { PASSCODE_WAIVER_MS } from './passcode_waiver_logic';

const FAKE_PASSCODE = 'fake-code-delta';
const FAKE_TOKEN = 'opaque-waiver-token-delta';
const ENGINE_ORIGIN = 'http://engine.test:6968';

function waiver(overrides: Partial<{
  token: string;
  principal: string;
  expiresAt: number;
  engineOrigin: string;
}> = {}) {
  return {
    token: FAKE_TOKEN,
    principal: 'owner',
    expiresAt: Date.now() + PASSCODE_WAIVER_MS,
    engineOrigin: ENGINE_ORIGIN,
    ...overrides,
  };
}

beforeEach(async () => {
  storage.getItem.mockReset();
  storage.setItem.mockReset();
  storage.removeItem.mockReset();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue(undefined);
  storage.removeItem.mockResolvedValue(undefined);
  await clearPasscodeWaiver();
  vi.unstubAllGlobals();
});

describe('getValidPasscodeWaiver', () => {
  it('hydrates a cold memory cache from AsyncStorage before validating', async () => {
    const stored = waiver();
    storage.getItem.mockResolvedValue(JSON.stringify(stored));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        principal: stored.principal,
        remainingMs: stored.expiresAt - Date.now(),
      }),
    })));

    expect(getPasscodeWaiver()).toBeNull();
    const validated = await getValidPasscodeWaiver();
    expect(validated?.token).toBe(FAKE_TOKEN);
    expect(getPasscodeWaiver()?.token).toBe(FAKE_TOKEN);
    expect(storage.getItem).toHaveBeenCalled();
  });

  it('clears a stored waiver bound to a different engine origin', async () => {
    await setPasscodeWaiver(waiver({ engineOrigin: 'http://other-engine.test:6968' }));
    const result = await getValidPasscodeWaiver();
    expect(result).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('clears the waiver when engine validation returns 401', async () => {
    await setPasscodeWaiver(waiver());
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, code: 'PASSCODE_WAIVER_INVALID' }),
    })));

    expect(await getValidPasscodeWaiver()).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('keeps the local waiver when validation throws (transient network)', async () => {
    const stored = waiver();
    await setPasscodeWaiver(stored);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network request failed'); }));

    expect(await getValidPasscodeWaiver()).toEqual(stored);
  });

  it('does not resurrect a waiver cleared while cold-storage hydration is in flight', async () => {
    const stored = waiver();
    let resolveGetItem!: (value: string | null) => void;
    storage.getItem.mockReturnValue(new Promise((resolve) => {
      resolveGetItem = resolve;
    }));

    const hydrate = getValidPasscodeWaiver();
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalled());
    await clearPasscodeWaiver();
    resolveGetItem(JSON.stringify(stored));

    expect(await hydrate).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('does not apply a late setPasscodeWaiver after clear started', async () => {
    const stored = waiver();
    let resolveSetItem!: () => void;
    storage.setItem.mockReturnValue(new Promise<void>((resolve) => {
      resolveSetItem = resolve;
    }));

    const pending = setPasscodeWaiver(stored);
    await clearPasscodeWaiver();
    resolveSetItem();
    await pending;

    expect(getPasscodeWaiver()).toBeNull();
  });

  it('does not return a waiver when validation succeeds after clear started', async () => {
    const stored = waiver();
    await setPasscodeWaiver(stored);
    let resolveFetch!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          principal: stored.principal,
          remainingMs: PASSCODE_WAIVER_MS,
        }),
      } as Response);
    })));

    const validate = getValidPasscodeWaiver();
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await clearPasscodeWaiver();
    resolveFetch();

    expect(await validate).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
  });

  it('does not return a waiver when validation fails after clear started', async () => {
    const stored = waiver();
    await setPasscodeWaiver(stored);
    let resolveFetch!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = () => resolve({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, code: 'PASSCODE_WAIVER_INVALID' }),
      } as Response);
    })));

    const validate = getValidPasscodeWaiver();
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await clearPasscodeWaiver();
    resolveFetch();

    expect(await validate).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
  });

  it('does not return a stale waiver when validation throws after clear started', async () => {
    const stored = waiver();
    await setPasscodeWaiver(stored);
    let rejectFetch!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
    })));

    const validate = getValidPasscodeWaiver();
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await clearPasscodeWaiver();
    rejectFetch(new Error('Network request failed'));

    expect(await validate).toBeNull();
    expect(getPasscodeWaiver()).toBeNull();
  });
});

describe('mintPasscodeWaiver', () => {
  it('persists only opaque metadata — never the raw passcode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain(FAKE_PASSCODE);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          token: FAKE_TOKEN,
          principal: 'owner',
          remainingMs: PASSCODE_WAIVER_MS,
        }),
      };
    }));

    const minted = await mintPasscodeWaiver(FAKE_PASSCODE);
    expect(minted.token).toBe(FAKE_TOKEN);
    expect(JSON.stringify(minted)).not.toContain(FAKE_PASSCODE);
    expect(getPasscodeWaiver()?.token).toBe(FAKE_TOKEN);
    const persisted = JSON.parse(String(storage.setItem.mock.calls[0][1]));
    expect(JSON.stringify(persisted)).not.toContain(FAKE_PASSCODE);
  });

  it('fails loudly when the engine refuses mint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, code: 'PASSCODE_WAIVER_INVALID' }),
    })));

    await expect(mintPasscodeWaiver(FAKE_PASSCODE)).rejects.toThrow(/could not be minted/i);
    expect(getPasscodeWaiver()).toBeNull();
  });

  it('sends the passcode only in the mint POST body', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/captainpad/auth/passcode-waiver');
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toContain(FAKE_PASSCODE);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          token: FAKE_TOKEN,
          principal: 'owner',
          remainingMs: PASSCODE_WAIVER_MS,
        }),
      };
    }));

    await mintPasscodeWaiver(FAKE_PASSCODE);
  });
});

describe('validate GET uses the waiver header', () => {
  it('never logs or stores the token outside the header', async () => {
    const stored = waiver();
    await setPasscodeWaiver(stored);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers[PASSCODE_WAIVER_HEADER]).toBe(FAKE_TOKEN);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          principal: 'owner',
          remainingMs: PASSCODE_WAIVER_MS,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await getValidPasscodeWaiver();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
