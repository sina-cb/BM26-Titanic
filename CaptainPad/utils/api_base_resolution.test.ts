// api_base_resolution — the engine-address RESOLUTION order in utils/apiBase.ts
// (report _246).
//
// apiBase.ts is a platform leaf: it imports AsyncStorage, expo-constants,
// react-native's Platform and the YAML default. This node-env suite stubs all
// four per case and re-imports the module, because the resolution runs ONCE at
// module load — `vi.resetModules()` before every load is what makes each case
// a real cold start.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type LoadOptions = {
  platform?: 'web' | 'ios' | 'android';
  /** window.location.hostname the browser served the app from; undefined = no DOM. */
  webHostname?: string | undefined;
  /** Constants.expoConfig.hostUri */
  hostUri?: string | null;
  /** Constants.expoGoConfig.debuggerHost */
  debuggerHost?: string | null;
  /** AsyncStorage `API_BASE` value. */
  stored?: string | null;
  /** Parsed CaptainPad/config.yaml. */
  yaml?: unknown;
};

const storage = new Map<string, string>();

async function loadApiBase(opts: LoadOptions = {}) {
  const {
    platform = 'web',
    webHostname,
    hostUri = null,
    debuggerHost = null,
    stored = null,
    yaml = { api_base: 'http://127.0.0.1:6968' },
  } = opts;

  storage.clear();
  if (stored) storage.set('API_BASE', stored);

  if (webHostname === undefined) {
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = { location: { hostname: webHostname } };
  }

  vi.resetModules();
  vi.doMock('react-native', () => ({ Platform: { OS: platform } }));
  vi.doMock('expo-constants', () => ({
    default: {
      expoConfig: hostUri === null ? null : { hostUri },
      expoGoConfig: debuggerHost === null ? null : { debuggerHost },
    },
  }));
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => { storage.set(k, v); }),
      removeItem: vi.fn(async (k: string) => { storage.delete(k); }),
    },
  }));
  vi.doMock('@/config.yaml', () => ({ default: yaml }));

  return import('./apiBase');
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as any).window;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('react-native');
  vi.doUnmock('expo-constants');
  vi.doUnmock('@react-native-async-storage/async-storage');
  vi.doUnmock('@/config.yaml');
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe('engineBaseFromHostname', () => {
  it('pins http and the engine port onto a plain host', async () => {
    const { engineBaseFromHostname } = await loadApiBase();
    expect(engineBaseFromHostname('10.1.1.151')).toBe('http://10.1.1.151:6968');
    expect(engineBaseFromHostname('titanic.local')).toBe('http://titanic.local:6968');
  });

  it('brackets a bare IPv6 literal so the authority stays legal', async () => {
    const { engineBaseFromHostname } = await loadApiBase();
    expect(engineBaseFromHostname('::1')).toBe('http://[::1]:6968');
  });

  it('returns null for an unusable hostname instead of inventing one', async () => {
    const { engineBaseFromHostname } = await loadApiBase();
    expect(engineBaseFromHostname('')).toBeNull();
    expect(engineBaseFromHostname('   ')).toBeNull();
    expect(engineBaseFromHostname(null)).toBeNull();
    expect(engineBaseFromHostname(undefined)).toBeNull();
  });
});

describe('hostnameFromMetroHostUri', () => {
  it('drops the Metro port — it is not the engine port', async () => {
    const { hostnameFromMetroHostUri } = await loadApiBase();
    expect(hostnameFromMetroHostUri('10.1.1.151:8081')).toBe('10.1.1.151');
  });

  it('strips a scheme and a path', async () => {
    const { hostnameFromMetroHostUri } = await loadApiBase();
    expect(hostnameFromMetroHostUri('exp://10.1.1.151:8081')).toBe('10.1.1.151');
    expect(hostnameFromMetroHostUri('http://titanic.local:8081/_expo/loading')).toBe('titanic.local');
  });

  it('handles a bracketed IPv6 authority', async () => {
    const { hostnameFromMetroHostUri } = await loadApiBase();
    expect(hostnameFromMetroHostUri('[fe80::1]:8081')).toBe('fe80::1');
    expect(hostnameFromMetroHostUri('[fe80::1')).toBeNull();
  });

  it('accepts a bare host with no port', async () => {
    const { hostnameFromMetroHostUri } = await loadApiBase();
    expect(hostnameFromMetroHostUri('localhost')).toBe('localhost');
  });

  it('returns null for anything carrying no host', async () => {
    const { hostnameFromMetroHostUri } = await loadApiBase();
    expect(hostnameFromMetroHostUri('')).toBeNull();
    expect(hostnameFromMetroHostUri('   ')).toBeNull();
    expect(hostnameFromMetroHostUri(null)).toBeNull();
    expect(hostnameFromMetroHostUri(undefined)).toBeNull();
    expect(hostnameFromMetroHostUri(':8081')).toBeNull();
  });
});

// ── Source 2: derived from the serving host ──────────────────────────────

describe('derivation from the serving host', () => {
  it('web: derives from window.location.hostname, not the YAML loopback', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: '10.1.1.151',
      yaml: { api_base: 'http://127.0.0.1:6968' },
    });
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.151:6968');
    expect(mod.getDefaultApiBaseSource()).toBe('served-host');
    expect(mod.getApiBase()).toBe('http://10.1.1.151:6968');
  });

  it('web: keeps only the hostname — the serving port never leaks in', async () => {
    // The pad may be served from :6967 (prod's static dist or a dev Metro) or
    // from an agent's ephemeral 71xx verification server; every one of them must
    // resolve the engine on the pinned 6968.
    const mod = await loadApiBase({ platform: 'web', webHostname: '192.168.50.4' });
    expect(mod.getDefaultApiBase()).toBe(`http://192.168.50.4:${mod.ENGINE_API_PORT}`);
    expect(mod.ENGINE_API_PORT).toBe(6968);
  });

  it('web: logs exactly one console.info naming the derived base', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await loadApiBase({ platform: 'web', webHostname: '10.1.1.151' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain('http://10.1.1.151:6968');
  });

  it('native: derives from expo-constants hostUri', async () => {
    const mod = await loadApiBase({
      platform: 'ios',
      hostUri: '10.1.1.151:8081',
      yaml: { api_base: 'http://127.0.0.1:6968' },
    });
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.151:6968');
    expect(mod.getDefaultApiBaseSource()).toBe('metro-host');
  });

  it('native: falls to the Expo Go debuggerHost key when hostUri is absent', async () => {
    const mod = await loadApiBase({
      platform: 'ios',
      hostUri: null,
      debuggerHost: '10.1.1.77:8081',
    });
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.77:6968');
    expect(mod.getDefaultApiBaseSource()).toBe('metro-host');
  });

  it('native: ignores a web window that RN happens to define', async () => {
    // react-native defines a global `window`; it has no location. A native
    // bundle must read Metro, never a phantom page host.
    const mod = await loadApiBase({
      platform: 'android',
      webHostname: undefined,
      hostUri: '10.1.1.9:8081',
    });
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.9:6968');
  });

  it('web: ignores expo-constants — a page host is the web truth', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: '10.1.1.151',
      hostUri: '172.16.9.9:8081',
    });
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.151:6968');
  });
});

// ── Source 3: config.yaml, the last resort ───────────────────────────────

describe('config.yaml last resort', () => {
  it('web with no DOM (expo export prerender / bare test env) uses the YAML', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: undefined,
      yaml: { api_base: 'http://127.0.0.1:6968' },
    });
    expect(mod.getDefaultApiBase()).toBe('http://127.0.0.1:6968');
    expect(mod.getDefaultApiBaseSource()).toBe('config-yaml');
  });

  it('web with an empty hostname uses the YAML rather than http://:6968', async () => {
    const mod = await loadApiBase({ platform: 'web', webHostname: '' });
    expect(mod.getDefaultApiBaseSource()).toBe('config-yaml');
    expect(mod.getDefaultApiBase()).toBe('http://127.0.0.1:6968');
  });

  it('standalone native build (no dev server at all) uses the YAML', async () => {
    const mod = await loadApiBase({ platform: 'ios', hostUri: null, debuggerHost: null });
    expect(mod.getDefaultApiBaseSource()).toBe('config-yaml');
  });

  it('logs the YAML last resort LOUDLY (warn, not info)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadApiBase({ platform: 'web', webHostname: undefined });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('config.yaml');
  });

  it('does NOT throw at import time when there is no serving host', async () => {
    await expect(loadApiBase({ platform: 'web', webHostname: undefined })).resolves.toBeTruthy();
  });
});

// ── Source 1: the AsyncStorage override always wins ──────────────────────

describe('AsyncStorage override', () => {
  it('beats a derived host', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: '10.1.1.151',
      stored: 'http://10.9.9.9:6968',
    });
    await expect(mod.getApiBaseAsync()).resolves.toBe('http://10.9.9.9:6968');
    expect(mod.getApiBase()).toBe('http://10.9.9.9:6968');
    expect(mod.getApiBaseSource()).toBe('async-storage');
    // the derived default is still reportable — it is what RESET returns to
    expect(mod.getDefaultApiBase()).toBe('http://10.1.1.151:6968');
  });

  it('beats the YAML last resort', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: undefined,
      stored: 'http://10.9.9.9:6968',
    });
    await expect(mod.getApiBaseAsync()).resolves.toBe('http://10.9.9.9:6968');
  });

  it('an absent override resolves to the derived default', async () => {
    const mod = await loadApiBase({ platform: 'web', webHostname: '10.1.1.151', stored: null });
    await expect(mod.getApiBaseAsync()).resolves.toBe('http://10.1.1.151:6968');
    expect(mod.getApiBaseSource()).toBe('served-host');
  });

  it('setApiBase to the derived default CLEARS the stored override', async () => {
    const mod = await loadApiBase({
      platform: 'web',
      webHostname: '10.1.1.151',
      stored: 'http://10.9.9.9:6968',
    });
    await mod.getApiBaseAsync();
    await mod.setApiBase(mod.getDefaultApiBase());
    expect(storage.has('API_BASE')).toBe(false);
    expect(mod.getApiBase()).toBe('http://10.1.1.151:6968');
    expect(mod.getApiBaseSource()).toBe('served-host');
  });

  it('setApiBase to anything else PERSISTS it', async () => {
    const mod = await loadApiBase({ platform: 'web', webHostname: '10.1.1.151' });
    await mod.setApiBase('http://10.2.2.2:6968');
    expect(storage.get('API_BASE')).toBe('http://10.2.2.2:6968');
    expect(mod.getApiBaseSource()).toBe('async-storage');
  });
});

// ── Fail-fast on a malformed YAML (unchanged from before _246) ───────────

describe('config.yaml fail-fast', () => {
  it('throws when api_base is missing', async () => {
    await expect(loadApiBase({ yaml: {} })).rejects.toThrow(/must define `api_base`/);
  });

  it('throws when api_base is empty', async () => {
    await expect(loadApiBase({ yaml: { api_base: '' } })).rejects.toThrow(/must define `api_base`/);
  });

  it('throws when the loader handed back an asset URI string, not an object', async () => {
    await expect(loadApiBase({ yaml: 'asset:/config.yaml' })).rejects.toThrow(/must define `api_base`/);
  });

  it('throws EVEN when a serving host could have been derived', async () => {
    // The YAML contract is validated at import, before resolution runs —
    // a broken config must never be masked by a lucky page host.
    await expect(
      loadApiBase({ platform: 'web', webHostname: '10.1.1.151', yaml: {} }),
    ).rejects.toThrow(/must define `api_base`/);
  });
});
