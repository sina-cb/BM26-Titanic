import { describe, expect, it } from 'vitest';

import { mixerChannelPerformanceState } from './mixer_channel_performance';

describe('Mixer channel Performance presentation', () => {
  it('removes the entire management region while the Performance face is active', () => {
    expect(mixerChannelPerformanceState(
      { locked: false },
      { performanceModeActive: false, performanceAuthorityLocked: false },
    ).managementVisible).toBe(true);

    expect(mixerChannelPerformanceState(
      { locked: false },
      { performanceModeActive: true, performanceAuthorityLocked: true },
    ).managementVisible).toBe(false);
  });

  it('overlays the authority lock without mutating persisted channel state', () => {
    const originallyUnlocked = Object.freeze({ id: 'one', locked: false });
    const originallyLocked = Object.freeze({ id: 'two', locked: true });

    const duringPerformance = mixerChannelPerformanceState(originallyUnlocked, {
      performanceModeActive: true,
      performanceAuthorityLocked: true,
    });
    expect(duringPerformance.effectiveLocked).toBe(true);
    expect(originallyUnlocked.locked).toBe(false);

    const afterPerformance = mixerChannelPerformanceState(originallyUnlocked, {
      performanceModeActive: false,
      performanceAuthorityLocked: false,
    });
    expect(afterPerformance.effectiveLocked).toBe(false);
    expect(originallyUnlocked.locked).toBe(false);

    const lockedAfterPerformance = mixerChannelPerformanceState(originallyLocked, {
      performanceModeActive: false,
      performanceAuthorityLocked: false,
    });
    expect(lockedAfterPerformance.effectiveLocked).toBe(true);
    expect(originallyLocked.locked).toBe(true);
  });

  it('uses the existing authority bypass without exposing management chrome', () => {
    const state = mixerChannelPerformanceState(
      { locked: false },
      { performanceModeActive: true, performanceAuthorityLocked: false },
    );
    expect(state.effectiveLocked).toBe(false);
    expect(state.managementVisible).toBe(false);
  });
});
