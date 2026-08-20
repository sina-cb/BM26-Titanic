import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateTimelinePlan,
  previewTimelineOverview,
  saveTimelinePlan,
} from './timelineApi';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./engineEvents', () => ({ engineEvents: { subscribe: () => () => undefined } }));
vi.mock('./apiBase', () => ({
  api_base: 'http://engine.test',
  getApiBase: () => 'http://engine.test',
  getApiBaseAsync: async () => 'http://engine.test',
  getDefaultApiBase: () => 'http://engine.test',
  setApiBase: () => undefined,
}));

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

describe('Timeline preview/save ownership wire contract', () => {
  it('sends a draft preview as the exact body-bearing read-only endpoint', async () => {
    const draft = { name: 'draft_plan' } as any;
    await previewTimelineOverview(draft);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://engine.test/timeline/overview');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe(JSON.stringify(draft));
    expect(headerOf(0, 'X-Touch-Control-Owner')).toBeNull();
  });

  it('never borrows the Live Touch owner for background saves or activation', async () => {
    await saveTimelinePlan({ name: 'draft_plan' });
    await activateTimelinePlan('draft_plan');

    expect(headerOf(0, 'X-Touch-Control-Owner')).toBeNull();
    expect(headerOf(1, 'X-Touch-Control-Owner')).toBeNull();
  });

  it('preserves lease refusal status, code, and owner for truthful save UI', async () => {
    stubFetch({
      error: "touch control is armed by 'live_owner'",
      code: 'TOUCH_CONTROL_LEASE_HELD',
      heldBy: 'live_owner',
    }, false, 423);

    const result = await saveTimelinePlan({ name: 'draft_plan' });

    expect(result).toMatchObject({
      ok: false,
      status: 423,
      error: "touch control is armed by 'live_owner'",
      data: { code: 'TOUCH_CONTROL_LEASE_HELD', heldBy: 'live_owner' },
    });
  });
});
