// Effect-banks HTTP contract from the CaptainPad side. Named, ordered effect
// banks replace the old edit/play controller profile: the sb_2 button CYCLES
// (POST /global-effects/banks/next), and the UI creates/deletes/renames banks.
// These tests lock the wire shape of each api fn: the right method + path, the
// `source` provenance tag threaded into the body when supplied (omitted when
// absent), and the fail-loud 400 surfacing (no fallback).
//
// api.ts pulls RN (`Platform`) + engineEvents (subscribes at load) + apiBase.
// This suite is node-env, so we stub all three and the global `fetch`, then
// import the functions under test (mirrors effects_page_api.test.ts).

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

import {
  fetchEffectBanks,
  nextEffectBank,
  setActiveEffectBank,
  createEffectBank,
  deleteEffectBank,
  renameEffectBank,
} from './api';

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response);

let lastInit: RequestInit | undefined;
let lastUrl: string | undefined;

function stubFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    return okResponse(body);
  }));
}

beforeEach(() => {
  lastInit = undefined;
  lastUrl = undefined;
  stubFetch({ ok: true });
});

describe('fetchEffectBanks — GET /global-effects/banks', () => {
  it('returns the ordered banks + activeBankId', async () => {
    stubFetch({ banks: [{ id: 'a', name: 'A', slotCount: 3 }], activeBankId: 'a' });
    const r = await fetchEffectBanks();
    expect(lastUrl).toBe('http://engine.test/global-effects/banks');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.activeBankId).toBe('a');
      expect(r.data?.banks).toEqual([{ id: 'a', name: 'A', slotCount: 3 }]);
    }
  });

  it('surfaces a non-ok status (fail-loud)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    const r = await fetchEffectBanks();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/500/);
  });
});

describe('nextEffectBank — POST /global-effects/banks/next (atomic cycle)', () => {
  it('POSTs the cycle with the source provenance tag in the body', async () => {
    stubFetch({ activeBankId: 'b', bankName: 'B', index: 1, count: 3 });
    const r = await nextEffectBank('vsn1_sb2');
    expect(lastUrl).toBe('http://engine.test/global-effects/banks/next');
    expect(lastInit?.method).toBe('POST');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ source: 'vsn1_sb2' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ activeBankId: 'b', bankName: 'B', index: 1, count: 3 });
  });

  it('omits `source` entirely when no tag is supplied', async () => {
    await nextEffectBank();
    expect(JSON.parse(String(lastInit?.body))).toEqual({});
  });

  it('surfaces the engine 400 verbatim (fail-loud, no fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({}), text: async () => 'no banks',
    } as Response)));
    const r = await nextEffectBank('vsn1_sb2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/400/);
  });
});

describe('setActiveEffectBank — PATCH /global-effects/banks/active', () => {
  it('PATCHes the bankId (+ source) in the body', async () => {
    stubFetch({ activeBankId: 'c' });
    const r = await setActiveEffectBank('c', 'ui_tap');
    expect(lastUrl).toBe('http://engine.test/global-effects/banks/active');
    expect(lastInit?.method).toBe('PATCH');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ bankId: 'c', source: 'ui_tap' });
    expect(r.ok).toBe(true);
  });

  it('omits source when absent', async () => {
    await setActiveEffectBank('c');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ bankId: 'c' });
  });
});

describe('createEffectBank — POST /global-effects/banks', () => {
  it('POSTs the optional name', async () => {
    stubFetch({ id: 'new', name: 'Party' });
    const r = await createEffectBank('Party');
    expect(lastUrl).toBe('http://engine.test/global-effects/banks');
    expect(lastInit?.method).toBe('POST');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ name: 'Party' });
    expect(r.ok).toBe(true);
  });

  it('POSTs an empty body when no name (engine names it)', async () => {
    await createEffectBank();
    expect(JSON.parse(String(lastInit?.body))).toEqual({});
  });
});

describe('deleteEffectBank — DELETE /global-effects/banks/:id', () => {
  it('DELETEs the path-encoded id', async () => {
    stubFetch({ activeBankId: 'a' });
    const r = await deleteEffectBank('bank/with space');
    expect(lastUrl).toBe('http://engine.test/global-effects/banks/bank%2Fwith%20space');
    expect(lastInit?.method).toBe('DELETE');
    expect(r.ok).toBe(true);
  });

  it('surfaces the engine 409 on the LAST bank (fail-loud, not swallowed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({}), text: async () => 'cannot delete last bank',
    } as Response)));
    const r = await deleteEffectBank('only');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/409/);
      expect(r.error).toMatch(/last bank/);
    }
  });
});

describe('renameEffectBank — PATCH /global-effects/banks/:id', () => {
  it('PATCHes the new name for the path-encoded id', async () => {
    stubFetch({ id: 'a', name: 'Renamed' });
    const r = await renameEffectBank('a', 'Renamed');
    expect(lastUrl).toBe('http://engine.test/global-effects/banks/a');
    expect(lastInit?.method).toBe('PATCH');
    expect(JSON.parse(String(lastInit?.body))).toEqual({ name: 'Renamed' });
    expect(r.ok).toBe(true);
  });

  it('surfaces a non-ok status verbatim (fail-loud)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, json: async () => ({}), text: async () => 'no such bank',
    } as Response)));
    const r = await renameEffectBank('missing', 'X');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/404/);
  });
});
