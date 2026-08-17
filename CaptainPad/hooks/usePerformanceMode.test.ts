import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/engineEvents', () => ({
  engineEvents: {
    subscribe: () => () => undefined,
    subscribeStatus: () => () => undefined,
  },
}));

vi.mock('@/utils/api', () => ({
  fetchPerformanceMode: async () => ({ ok: false }),
}));

vi.mock('@/hooks/use_captainpad_access', () => ({
  useCaptainPadAccess: () => ({ session: null, loading: false }),
}));

import {
  applyPerformanceModeResponse,
  getPerformanceModeState,
} from './usePerformanceMode';

describe('applyPerformanceModeResponse', () => {
  afterEach(() => {
    applyPerformanceModeResponse({ active: false, enteredAt: null, dirtyCount: 0, dirtyEntries: [] });
  });

  it('reconciles an accepted enter POST without waiting for a websocket echo', () => {
    const accepted = applyPerformanceModeResponse({
      active: true,
      enteredAt: '2026-08-14T19:27:38.801Z',
    });

    expect(accepted).toBe(true);
    expect(getPerformanceModeState()).toMatchObject({
      active: true,
      enteredAt: '2026-08-14T19:27:38.801Z',
    });
  });

  it('refuses a malformed POST body rather than changing the visible lock', () => {
    applyPerformanceModeResponse({ active: false, enteredAt: null });

    expect(applyPerformanceModeResponse({ active: 'true' })).toBe(false);
    expect(getPerformanceModeState()).toMatchObject({ active: false, enteredAt: null });
  });
});
