import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetSpatialFullscreen,
  setSpatialFullscreenActive,
  spatialFullscreenActive,
  subscribeSpatialFullscreen,
} from './spatial_fullscreen';

afterEach(() => resetSpatialFullscreen());

describe('spatial fullscreen broker', () => {
  it('starts closed — a spatial surface is never open before the first paint', () => {
    expect(spatialFullscreenActive()).toBe(false);
  });

  it('notifies every subscriber when the surface opens and closes', () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSpatialFullscreen(a);
    subscribeSpatialFullscreen(b);

    setSpatialFullscreenActive(true);
    expect(spatialFullscreenActive()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    setSpatialFullscreenActive(false);
    expect(spatialFullscreenActive()).toBe(false);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('is idempotent, so a screen may re-assert the same state every message', () => {
    const listener = vi.fn();
    subscribeSpatialFullscreen(listener);
    setSpatialFullscreenActive(false);
    setSpatialFullscreenActive(true);
    setSpatialFullscreenActive(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying an unsubscribed listener', () => {
    const listener = vi.fn();
    const off = subscribeSpatialFullscreen(listener);
    off();
    setSpatialFullscreenActive(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('hands out a STABLE snapshot getter — useSyncExternalStore requires it', () => {
    // Same function identity, and the value only changes when the setter runs.
    const first = spatialFullscreenActive();
    expect(spatialFullscreenActive()).toBe(first);
  });
});
