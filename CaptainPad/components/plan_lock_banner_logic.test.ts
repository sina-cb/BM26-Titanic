import { describe, expect, it } from 'vitest';

import type { TimelineState } from '@/utils/timelineApi';
import {
  PLAN_QUOTE_ROTATE_MS,
  PLAN_RUNNING_QUOTES,
  formatPlanClock,
  planRemainingStatus,
  planRunningQuote,
} from './plan_lock_banner_logic';

describe('plan lock banner status', () => {
  it('ships exactly 30 distinct Burn quotes', () => {
    expect(PLAN_RUNNING_QUOTES).toHaveLength(30);
    expect(new Set(PLAN_RUNNING_QUOTES).size).toBe(30);
  });

  it('rotates quotes deterministically', () => {
    expect(planRunningQuote(0)).toBe(PLAN_RUNNING_QUOTES[0]);
    expect(planRunningQuote(PLAN_QUOTE_ROTATE_MS)).toBe(PLAN_RUNNING_QUOTES[1]);
    expect(planRunningQuote(PLAN_QUOTE_ROTATE_MS * 30)).toBe(PLAN_RUNNING_QUOTES[0]);
  });

  it('shows the live cue time remaining before the next-cue fallback', () => {
    const nowMs = 1_000_000;
    expect(planRemainingStatus({
      activeCue: {
        id: 'c_live',
        label: 'Live cue',
        kind: 'cue',
        untilMs: nowMs + 90_000,
      },
      activeProgram: null,
      nextCue: { id: 'c_next', label: 'Next', inSec: 20 },
    } as TimelineState, nowMs)).toEqual({
      label: 'LEFT',
      value: '1:30',
    });
  });

  it('shows time to next cue while the baseline owns the deck', () => {
    expect(planRemainingStatus({
      activeCue: null,
      activeProgram: null,
      nextCue: { id: 'c_next', label: 'Next', inSec: 75 },
    } as TimelineState, 0)).toEqual({
      label: 'NEXT IN',
      value: '1:15',
    });
  });

  it('formats a live clock with seconds', () => {
    expect(formatPlanClock(Date.now())).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
