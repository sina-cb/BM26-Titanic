// Effects v2 — the /global-effects/page HTTP contract, from the CaptainPad side.
//
// REGRESSION LOCK for the live 400 Sina hit: the engine's canonical body/response
// key is `effectsPage` (see marsin_engine report 20260709_1 — PATCH
// /global-effects/page {effectsPage}; GET returns {effectsPage}; WS broadcasts
// {type:'effectsPage', effectsPage}). CaptainPad had been sending `{ page }`, so
// the engine parsed `undefined` and rejected with
//   400 {"error":"effectsPage must be an integer in [0..3] (got undefined)"}.
// These tests assert the sender now emits the canonical key and the reader parses
// it back — one key, no dual-key fallback.
//
// api.ts pulls RN (`Platform`) + engineEvents (subscribes at load) + apiBase
// (AsyncStorage/config.yaml). This suite is node-env, so we stub all three and
// the global `fetch`, then import the two functions under test.

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

import { setEffectsPage, fetchEffectsPage } from './api';

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
    return okResponse({ status: 'ok', effectsPage: 2 });
  }));
});

describe('setEffectsPage — PATCH /global-effects/page body key', () => {
  it('sends the canonical `effectsPage` key (NOT `page`)', async () => {
    const r = await setEffectsPage(2);
    expect(r.ok).toBe(true);
    expect(lastUrl).toBe('http://engine.test/global-effects/page');
    expect(lastInit?.method).toBe('PATCH');
    const body = JSON.parse(String(lastInit?.body));
    // The exact regression: the engine reads data.effectsPage, so THIS must be it.
    expect(body).toEqual({ effectsPage: 2 });
    expect(body).not.toHaveProperty('page');
  });

  it('surfaces the engine 400 verbatim (fail-loud, no fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400,
      json: async () => ({}),
      text: async () => '{"error":"effectsPage must be an integer in [0..3] (got undefined)"}',
    } as Response)));
    const r = await setEffectsPage(1);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain('HTTP 400');
    expect(r.ok ? '' : r.error).toContain('effectsPage must be an integer');
  });
});

describe('fetchEffectsPage — GET /global-effects/page response key', () => {
  it('reads the canonical `effectsPage` key back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ effectsPage: 3 })));
    const r = await fetchEffectsPage();
    expect(r.ok).toBe(true);
    expect(r.data?.effectsPage).toBe(3);
  });
});
