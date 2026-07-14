import { describe, it, expect } from 'vitest';

import { windowPadNumber, recenterWindowStart } from './window_slot';

describe('windowPadNumber', () => {
  it('returns null when no window is published', () => {
    expect(windowPadNumber(null, 0)).toBeNull();
    expect(windowPadNumber(undefined, 3)).toBeNull();
  });

  it('maps the window rows to pads 1..size (top pad = top entry)', () => {
    const w = { start: 0, size: 6 };
    expect(windowPadNumber(w, 0)).toBe(1);
    expect(windowPadNumber(w, 1)).toBe(2);
    expect(windowPadNumber(w, 5)).toBe(6);
  });

  it('returns null for rows outside the window', () => {
    const w = { start: 0, size: 6 };
    expect(windowPadNumber(w, -1)).toBeNull();
    expect(windowPadNumber(w, 6)).toBeNull();
    expect(windowPadNumber(w, 42)).toBeNull();
  });

  it('follows a paged window (scroll moved the cursor)', () => {
    const w = { start: 4, size: 6 };
    // Rows before the window stay unhighlighted…
    expect(windowPadNumber(w, 3)).toBeNull();
    // …the window rows renumber from pad 1 at the new start…
    expect(windowPadNumber(w, 4)).toBe(1);
    expect(windowPadNumber(w, 7)).toBe(4);
    expect(windowPadNumber(w, 9)).toBe(6);
    // …and rows past the window end are out again.
    expect(windowPadNumber(w, 10)).toBeNull();
  });

  it('handles a window larger than the playlist (short list, size stays 6)', () => {
    // The manager clamps the cursor but keeps size = WINDOW_SIZE even when the
    // playlist has fewer entries; rows that exist all map, and there is simply
    // no row for the trailing pads (they render as a dim frame on hardware).
    const w = { start: 0, size: 6 };
    expect(windowPadNumber(w, 2)).toBe(3); // 3-entry playlist: last row = pad 3
  });
});

describe('recenterWindowStart', () => {
  it('re-centres the window around a selection that falls BELOW the window', () => {
    // 20-entry list, window [0..5], select row 10 → centred window starts at
    // 10 - floor(6/2) = 7, so the window [7..12] surrounds the selection.
    expect(recenterWindowStart({ activeIndex: 10, currentStart: 0, size: 6, length: 20 })).toBe(7);
  });

  it('re-centres around a selection ABOVE the current window', () => {
    // window [10..15], select row 2 → centre = 2 - 3 = -1 → clamped to 0.
    expect(recenterWindowStart({ activeIndex: 2, currentStart: 10, size: 6, length: 20 })).toBe(0);
  });

  it('clamps at the END of the playlist (window never runs past the last row)', () => {
    // Last row (19) of a 20-entry list: centre = 16, but max = 20-6 = 14 → 14,
    // so the window [14..19] ends exactly on the last row.
    expect(recenterWindowStart({ activeIndex: 19, currentStart: 0, size: 6, length: 20 })).toBe(14);
  });

  it('clamps at the START of the playlist', () => {
    expect(recenterWindowStart({ activeIndex: 0, currentStart: 8, size: 6, length: 20 })).toBe(0);
  });

  it('leaves the window put when the selection is already INSIDE it (no churn)', () => {
    // window [2..7], select row 5 (inside) → start unchanged (a manual scroll
    // is preserved; the pads already map around the selection).
    expect(recenterWindowStart({ activeIndex: 5, currentStart: 2, size: 6, length: 20 })).toBe(2);
    // Selection on the window's exact top / bottom edge is still "inside".
    expect(recenterWindowStart({ activeIndex: 2, currentStart: 2, size: 6, length: 20 })).toBe(2);
    expect(recenterWindowStart({ activeIndex: 7, currentStart: 2, size: 6, length: 20 })).toBe(2);
  });

  it('pins to 0 for a playlist SHORTER than the window (max = 0)', () => {
    // 3-entry list, size 6 → max = 0; every selection keeps start at 0.
    expect(recenterWindowStart({ activeIndex: 0, currentStart: 0, size: 6, length: 3 })).toBe(0);
    expect(recenterWindowStart({ activeIndex: 2, currentStart: 0, size: 6, length: 3 })).toBe(0);
    // Even a stale non-zero cursor collapses back to 0 (clamped to max).
    expect(recenterWindowStart({ activeIndex: 1, currentStart: 4, size: 6, length: 3 })).toBe(0);
  });

  it('holds position (clamped) when there is no active row to follow', () => {
    expect(recenterWindowStart({ activeIndex: -1, currentStart: 3, size: 6, length: 20 })).toBe(3);
    // An out-of-range active index is treated as "no row" — never a move.
    expect(recenterWindowStart({ activeIndex: 99, currentStart: 3, size: 6, length: 20 })).toBe(3);
    // …and a held position past the end is clamped in-bounds.
    expect(recenterWindowStart({ activeIndex: -1, currentStart: 40, size: 6, length: 20 })).toBe(14);
  });
});
