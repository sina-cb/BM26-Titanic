// The performance-mode EXIT and POST /edit-session on the wire (docs/56).
//
// Both are identity-establishing acts, so the operator passcode rides as the
// `X-CaptainPad-Passcode` HEADER of the ONE request it authorises — never in
// the URL (where it would land in logs and history), never in the body, and
// never carried over to the next request. These tests are the wire-level proof
// of the storage promise in utils/takeover_passcode.ts.
//
// api.ts pulls RN `Platform` + engineEvents + apiBase, so this node-env suite
// stubs those plus global fetch — same recipe as timeline_takeover_api.test.ts.
//
// P0: the passcodes here are obvious placeholders; no credential material from
// $BM26_SECRETS exists in this repo.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({
  engineEvents: { subscribe: () => () => undefined, emitLocal: () => undefined },
}));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
  getDefaultApiBase: () => 'http://engine.test',
  setApiBase: () => undefined,
}));
vi.mock('./passcode_waiver', () => ({
  PASSCODE_WAIVER_HEADER: 'X-CaptainPad-Passcode-Waiver',
  getValidPasscodeWaiver: vi.fn(async () => null),
  mintPasscodeWaiver: vi.fn(async () => ({
    token: 'waiver-token-bravo',
    principal: 'owner',
    expiresAt: Date.now() + 30 * 60 * 1000,
    engineOrigin: 'http://engine.test',
  })),
  clearPasscodeWaiver: vi.fn(async () => undefined),
}));

import {
  assertEditSession,
  setPerformanceMode,
  TAKEOVER_PASSCODE_HEADER,
} from './api';
import { mintPasscodeWaiver, getValidPasscodeWaiver, PASSCODE_WAIVER_HEADER } from './passcode_waiver';

const FAKE_PASSCODE = 'fake-code-bravo';

let calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }));
}

/** fetchWithTimeout may hand `fetch` either a Headers instance or a plain
 *  object depending on how it merges; read both shapes so this suite pins the
 *  VALUE that goes on the wire, not an implementation detail of the wrapper. */
function headerOf(index: number, name: string): string | undefined {
  const headers = calls[index].init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const bag = headers as Record<string, string>;
  const key = Object.keys(bag).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : bag[key];
}

beforeEach(() => {
  calls = [];
  stubFetch({ active: false, editPrincipal: 'owner', authRequired: true });
  vi.mocked(mintPasscodeWaiver).mockClear();
  vi.mocked(getValidPasscodeWaiver).mockReset();
  vi.mocked(getValidPasscodeWaiver).mockResolvedValue(null);
});

describe('setPerformanceMode — exit passcode header', () => {
  it('omits the header entirely when no passcode is supplied', async () => {
    await setPerformanceMode({ active: true });
    expect(calls).toHaveLength(1);
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
  });

  it('sends the passcode as a header only — never the URL or the body', async () => {
    await setPerformanceMode({ active: false, exitAction: 'keep' }, { passcode: FAKE_PASSCODE });
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBe(FAKE_PASSCODE);
    expect(calls[0].url).not.toContain(FAKE_PASSCODE);
    expect(String(calls[0].init?.body)).not.toContain(FAKE_PASSCODE);
    // The exit action itself still travels in the body, as before.
    expect(String(calls[0].init?.body)).toContain('keep');
  });

  it('does not leak into the NEXT request — every attempt carries its own', async () => {
    await setPerformanceMode({ active: false, exitAction: 'keep' }, { passcode: FAKE_PASSCODE });
    await setPerformanceMode({ active: true });
    expect(headerOf(1, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
  });

  it('surfaces the engine refusal envelope, code included', async () => {
    stubFetch({ error: 'nope', code: 'EXIT_KEEP_SAVE_OWNER_ONLY', principal: 'bringup' }, false, 400);
    const result = await setPerformanceMode(
      { active: false, exitAction: 'keep-save' }, { passcode: FAKE_PASSCODE },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('EXIT_KEEP_SAVE_OWNER_ONLY');
    // The caller needs the body to name the principal in its copy.
    expect((result.data as { principal?: string })?.principal).toBe('bringup');
  });

  it('remember30 mints a waiver header instead of sending the raw passcode', async () => {
    await setPerformanceMode(
      { active: false, exitAction: 'keep' },
      { passcode: FAKE_PASSCODE, remember30: true },
    );
    expect(vi.mocked(mintPasscodeWaiver)).toHaveBeenCalledWith(FAKE_PASSCODE);
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
    expect(headerOf(0, PASSCODE_WAIVER_HEADER)).toBe('waiver-token-bravo');
  });

  it('uses a stored waiver for exit when no fresh passcode is supplied', async () => {
    vi.mocked(getValidPasscodeWaiver).mockResolvedValueOnce({
      token: 'stored-waiver-token',
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test',
    });
    await setPerformanceMode({ active: false, exitAction: 'keep' }, {});
    expect(vi.mocked(mintPasscodeWaiver)).not.toHaveBeenCalled();
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
    expect(headerOf(0, PASSCODE_WAIVER_HEADER)).toBe('stored-waiver-token');
  });
});

describe('assertEditSession', () => {
  it('POSTs an empty body with the passcode in the header', async () => {
    await assertEditSession({ passcode: FAKE_PASSCODE });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://engine.test/edit-session');
    expect(calls[0].init?.method).toBe('POST');
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBe(FAKE_PASSCODE);
    expect(calls[0].init?.body).toBe('{}');
    expect(calls[0].url).not.toContain(FAKE_PASSCODE);
  });

  it('returns the new principal on success', async () => {
    const result = await assertEditSession({ passcode: FAKE_PASSCODE });
    expect(result.ok).toBe(true);
    expect(result.data?.editPrincipal).toBe('owner');
  });

  it('surfaces a refusal code instead of a phantom success', async () => {
    stubFetch({ error: 'rejected', code: 'EDIT_SESSION_AUTH_INVALID' }, false, 401);
    const result = await assertEditSession({ passcode: FAKE_PASSCODE });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('EDIT_SESSION_AUTH_INVALID');
    expect(result.error).not.toContain(FAKE_PASSCODE);
  });

  it('remember30 mints a waiver header instead of sending the raw passcode', async () => {
    await assertEditSession({ passcode: FAKE_PASSCODE, remember30: true });
    expect(vi.mocked(mintPasscodeWaiver)).toHaveBeenCalledWith(FAKE_PASSCODE);
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
    expect(headerOf(0, PASSCODE_WAIVER_HEADER)).toBe('waiver-token-bravo');
  });

  it('uses a stored waiver for the edit-session fast path (no fresh passcode)', async () => {
    vi.mocked(getValidPasscodeWaiver).mockResolvedValueOnce({
      token: 'stored-waiver-token',
      principal: 'owner',
      expiresAt: Date.now() + 60_000,
      engineOrigin: 'http://engine.test',
    });
    await assertEditSession({});
    expect(vi.mocked(mintPasscodeWaiver)).not.toHaveBeenCalled();
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeUndefined();
    expect(headerOf(0, PASSCODE_WAIVER_HEADER)).toBe('stored-waiver-token');
  });
});
