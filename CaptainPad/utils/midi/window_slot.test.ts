import { describe, it, expect } from 'vitest';

import { windowPadNumber } from './window_slot';

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
