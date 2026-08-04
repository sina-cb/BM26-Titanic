import { describe, it, expect } from 'vitest';
import { wheelToHorizontalDelta, WHEEL_LINE_PX } from './wheel_scroll_logic';

// Contract under test (dimmer rack fader row, report 20260725_130):
// vertical-dominant wheel deltas map onto the horizontal axis; deltaX-
// dominant events return null so native horizontal scrolling keeps them.

const PAGE = 950; // typical visible row width

describe('wheelToHorizontalDelta', () => {
  it('maps a plain vertical mouse-wheel tick (pixel mode) 1:1', () => {
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: 120, deltaMode: 0 }, PAGE)).toBe(120);
  });

  it('maps upward wheel to negative (leftward) scroll', () => {
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: -120, deltaMode: 0 }, PAGE)).toBe(-120);
  });

  it('keeps vertical-dominant diagonal trackpad deltas on the horizontal axis', () => {
    expect(wheelToHorizontalDelta({ deltaX: 30, deltaY: 100, deltaMode: 0 }, PAGE)).toBe(100);
  });

  it('returns null for horizontal-dominant deltas (trackpad pan / shift+wheel axis swap)', () => {
    expect(wheelToHorizontalDelta({ deltaX: 120, deltaY: 0, deltaMode: 0 }, PAGE)).toBeNull();
    expect(wheelToHorizontalDelta({ deltaX: -80, deltaY: 20, deltaMode: 0 }, PAGE)).toBeNull();
  });

  it('returns null on an exact tie — native handling wins ambiguous input', () => {
    expect(wheelToHorizontalDelta({ deltaX: 50, deltaY: 50, deltaMode: 0 }, PAGE)).toBeNull();
    expect(wheelToHorizontalDelta({ deltaX: -50, deltaY: 50, deltaMode: 0 }, PAGE)).toBeNull();
  });

  it('returns null for an empty event', () => {
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: 0, deltaMode: 0 }, PAGE)).toBeNull();
  });

  it('scales line mode (Firefox) by WHEEL_LINE_PX', () => {
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, PAGE)).toBe(3 * WHEEL_LINE_PX);
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: -3, deltaMode: 1 }, PAGE)).toBe(-3 * WHEEL_LINE_PX);
  });

  it('scales page mode by the visible row width', () => {
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, PAGE)).toBe(PAGE);
    expect(wheelToHorizontalDelta({ deltaX: 0, deltaY: -2, deltaMode: 2 }, PAGE)).toBe(-2 * PAGE);
  });
});
