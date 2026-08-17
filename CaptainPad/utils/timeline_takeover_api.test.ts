// POST /timeline/takeover on the wire: the performance-mode operator passcode
// rides as the `X-CaptainPad-Passcode` HEADER of the ONE request it authorises
// (operator ruling 2026-08-14) — never in the URL, never in the body, and
// never on any other timeline route.
//
// timelineApi pulls api.ts (RN `Platform` + engineEvents + apiBase), so this
// node-env suite stubs those three plus global fetch — same recipe as
// effect_banks_api.test.ts.
//
// P0: the passcodes here are obvious placeholders; no credential material from
// $BM26_SECRETS exists in this repo.

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
  postTimelineTakeover,
  postTimelineActivity,
  resumeTimeline,
  TAKEOVER_PASSCODE_HEADER,
} from './timelineApi';

const FAKE_PASSCODE = 'fake-code-alpha';

let calls: { url: string; init?: RequestInit }[] = [];

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok, status, text: async () => JSON.stringify(body) } as unknown as Response;
  }));
}

function headerOf(index: number, name: string): string | null {
  const headers = calls[index].init?.headers;
  return headers instanceof Headers ? headers.get(name) : null;
}

beforeEach(() => {
  calls = [];
  stubFetch({ ok: true });
});

describe('postTimelineTakeover — passcode header', () => {
  it('omits the header entirely when no passcode is supplied', async () => {
    await postTimelineTakeover();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://engine.test/timeline/takeover');
    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeNull();
    expect(calls[0].init?.body).toBeUndefined();
  });

  it('sends the passcode as the header of that one request, never in the body or URL', async () => {
    await postTimelineTakeover({ scope: 'perform', cueId: 'cue_1' }, FAKE_PASSCODE);

    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBe(FAKE_PASSCODE);
    expect(calls[0].url).not.toContain(FAKE_PASSCODE);
    expect(String(calls[0].init?.body)).not.toContain(FAKE_PASSCODE);
    expect(String(calls[0].init?.body)).toContain('"scope":"perform"');
    // The JSON content type is still set — the header is merged, not replaced.
    expect(headerOf(0, 'Content-Type')).toBe('application/json');
  });

  it('does not leak the passcode into the NEXT takeover', async () => {
    await postTimelineTakeover(undefined, FAKE_PASSCODE);
    await postTimelineTakeover();

    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBe(FAKE_PASSCODE);
    expect(headerOf(1, TAKEOVER_PASSCODE_HEADER)).toBeNull();
  });

  it('never attaches a passcode to the routes that GIVE the rig back', async () => {
    // The reverse direction is deliberately never gated engine-side; these must
    // stay bodyless and header-free so an armed desk can always hand back.
    await resumeTimeline();
    await postTimelineActivity();

    expect(headerOf(0, TAKEOVER_PASSCODE_HEADER)).toBeNull();
    expect(headerOf(1, TAKEOVER_PASSCODE_HEADER)).toBeNull();
  });

  it('surfaces the engine refusal envelope verbatim (code included)', async () => {
    stubFetch({ error: 'performance mode is live', code: 'TAKEOVER_AUTH_REQUIRED' }, false, 401);

    const result = await postTimelineTakeover(undefined, FAKE_PASSCODE);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe('performance mode is live');
    expect((result.data as { code?: string }).code).toBe('TAKEOVER_AUTH_REQUIRED');
  });
});
