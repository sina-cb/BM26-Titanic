import { describe, it, expect } from 'vitest';

import {
  isUserInitiated,
  isRowVisible,
  shouldScrollIntoView,
  centeredScrollTarget,
  clampScrollTarget,
  USER_SELECT_GRACE_MS,
} from './pattern_scroll_logic';

describe('isUserInitiated', () => {
  it('is true inside the grace window after a tap', () => {
    expect(isUserInitiated(1000, 1000)).toBe(true);
    expect(isUserInitiated(1000, 1000 + USER_SELECT_GRACE_MS - 1)).toBe(true);
  });
  it('is false once the grace window elapses', () => {
    expect(isUserInitiated(1000, 1000 + USER_SELECT_GRACE_MS)).toBe(false);
    expect(isUserInitiated(1000, 5000)).toBe(false);
  });
  it('is false when there was never a tap', () => {
    expect(isUserInitiated(0, 1000)).toBe(false);
  });
});

describe('isRowVisible', () => {
  it('is true when the row sits fully inside the viewport', () => {
    expect(isRowVisible({ rowY: 100, rowH: 40, scrollY: 80, viewportH: 200 })).toBe(true);
  });
  it('is false when the row is above the viewport', () => {
    expect(isRowVisible({ rowY: 10, rowH: 40, scrollY: 80, viewportH: 200 })).toBe(false);
  });
  it('is false when the row is below the viewport', () => {
    expect(isRowVisible({ rowY: 300, rowH: 40, scrollY: 80, viewportH: 200 })).toBe(false);
  });
  it('is false when the row is only partially visible at the bottom edge', () => {
    // row spans 260..300, viewport 80..280 → bottom is clipped → not fully visible.
    expect(isRowVisible({ rowY: 260, rowH: 40, scrollY: 80, viewportH: 200 })).toBe(false);
  });
  it('treats an unmeasured viewport (height 0) as visible (never scroll on bogus measure)', () => {
    expect(isRowVisible({ rowY: 999, rowH: 40, scrollY: 0, viewportH: 0 })).toBe(true);
  });
});

describe('shouldScrollIntoView', () => {
  it('NEVER scrolls a user-initiated change, even when off-screen', () => {
    expect(shouldScrollIntoView({ userInitiated: true, visible: false })).toBe(false);
    expect(shouldScrollIntoView({ userInitiated: true, visible: true })).toBe(false);
  });
  it('scrolls an external change ONLY when the row is off-screen', () => {
    expect(shouldScrollIntoView({ userInitiated: false, visible: false })).toBe(true);
    expect(shouldScrollIntoView({ userInitiated: false, visible: true })).toBe(false);
  });
});

describe('centeredScrollTarget + clampScrollTarget', () => {
  it('centres the row in the viewport', () => {
    // row 200..240 centred in a 200-tall viewport → 220 - 100 = 120.
    expect(centeredScrollTarget(200, 40, 200)).toBe(120);
  });
  it('clamps to the top edge (never negative)', () => {
    expect(clampScrollTarget(-50, 1000, 200)).toBe(0);
  });
  it('clamps to the bottom edge (never past content)', () => {
    // max scroll = contentH - viewportH = 1000 - 200 = 800.
    expect(clampScrollTarget(950, 1000, 200)).toBe(800);
  });
  it('pins to 0 when content is shorter than the viewport', () => {
    expect(clampScrollTarget(120, 150, 200)).toBe(0);
  });
});
