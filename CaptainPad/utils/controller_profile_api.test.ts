// patchControllerProfile — the PATCH /global-effects/profile HTTP contract from
// the CaptainPad side, with the sb_2 spurious-flip provenance tag.
//
// The engine's canonical body key for the profile is `controllerProfile`
// ('edit' | 'play'); it 400s on any other value. The anti-spurious-flip work
// adds an OPTIONAL `source` provenance tag (a SECOND body key — the profile key
// is unchanged) that the engine logs + echoes in its WS broadcast so an
// unexplained edit↔play flip is attributable to the surface that caused it.
// These tests lock: (a) the profile rides `controllerProfile`, (b) `source` is
// sent as its own body key when provided, (c) `source` is omitted when absent.
//
// api.ts pulls RN (`Platform`) + engineEvents (subscribes at load) + apiBase.
// This suite is node-env, so we stub all three and the global `fetch`, then
// import the function under test (mirrors effects_page_api.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({ engineEvents: { subscribe: () => () => undefined } }));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
  getDefaultApiBase: () => 'http://engine.test',
  setApiBase: () => undefined,
}));

import { patchControllerProfile } from './api';

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response);

let lastInit: RequestInit | undefined;
let lastUrl: string | undefined;

beforeEach(() => {
  lastInit = undefined;
  lastUrl = undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    return okResponse({ status: 'ok', controllerProfile: 'play' });
  }));
});

describe('patchControllerProfile — PATCH /global-effects/profile body', () => {
  it('PATCHes the canonical `controllerProfile` key with the source tag', async () => {
    const r = await patchControllerProfile('play', 'vsn1_sb2');
    expect(r.ok).toBe(true);
    expect(lastUrl).toBe('http://engine.test/global-effects/profile');
    expect(lastInit?.method).toBe('PATCH');
    const body = JSON.parse(String(lastInit?.body));
    // The profile itself stays under `controllerProfile`; `source` is a SEPARATE
    // provenance key — exactly the sb_2 tag the dispatcher threads through.
    expect(body).toEqual({ controllerProfile: 'play', source: 'vsn1_sb2' });
  });

  it('omits `source` entirely when no tag is supplied', async () => {
    const r = await patchControllerProfile('edit');
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(lastInit?.body));
    expect(body).toEqual({ controllerProfile: 'edit' });
    expect(body).not.toHaveProperty('source');
  });

  it('surfaces the engine 400 verbatim (fail-loud, no fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({}), text: async () => 'bad profile',
    } as Response)));
    const r = await patchControllerProfile('play', 'vsn1_sb2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/400/);
  });
});
