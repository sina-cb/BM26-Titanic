/**
 * pixel_strip_logic.test.ts — the strip's sampling contract (report _239).
 *
 * The regression this file exists to prevent is subtle and silent: handed a
 * full-rate 964-sample buffer, a strip that draws "the first N" shows the bow
 * of the ship across a bar the operator reads as the whole rig. Nothing looks
 * broken; it is simply wrong. So the span is asserted, not just the count.
 */
import { describe, it, expect } from 'vitest';

import {
  BYTES_PER_PIXEL,
  STRIP_MAX_SEGMENTS,
  stripSampleIndex,
  stripSegmentCount,
} from '@/components/ui/pixel_strip_logic';

const TITANIC_PIXELS = 964;

describe('stripSegmentCount', () => {
  it('caps a large buffer at the strip budget', () => {
    expect(stripSegmentCount(TITANIC_PIXELS, STRIP_MAX_SEGMENTS)).toBe(STRIP_MAX_SEGMENTS);
  });

  it('draws every sample of a buffer smaller than the budget', () => {
    expect(stripSegmentCount(40, STRIP_MAX_SEGMENTS)).toBe(40);
  });

  it('an empty buffer draws nothing', () => {
    expect(stripSegmentCount(0, STRIP_MAX_SEGMENTS)).toBe(0);
  });

  it('refuses nonsense rather than guessing', () => {
    expect(() => stripSegmentCount(-1, 10)).toThrow(/sampleCount/);
    expect(() => stripSegmentCount(1.5, 10)).toThrow(/sampleCount/);
    expect(() => stripSegmentCount(10, 0)).toThrow(/maxSegments/);
    expect(() => stripSegmentCount(10, 2.5)).toThrow(/maxSegments/);
  });
});

describe('stripSampleIndex', () => {
  it('is the identity when the budget is not binding', () => {
    for (let i = 0; i < 40; i += 1) expect(stripSampleIndex(i, 40, 40)).toBe(i);
    // A capped BUFFER (fewer samples than segments cannot happen — segments is
    // min(samples, budget) — but the rule must still be total).
    expect(stripSampleIndex(5, 40, 12)).toBe(5);
  });

  it('spans the WHOLE buffer, not its head — the _239 regression', () => {
    const segments = stripSegmentCount(TITANIC_PIXELS, STRIP_MAX_SEGMENTS);
    const first = stripSampleIndex(0, segments, TITANIC_PIXELS);
    const last = stripSampleIndex(segments - 1, segments, TITANIC_PIXELS);
    expect(first).toBe(0);
    // The final segment must land in the last percent of the rig — proof the
    // strip is showing the stern, not stopping at sample 99.
    expect(last).toBeGreaterThanOrEqual(TITANIC_PIXELS - Math.ceil(TITANIC_PIXELS / segments));
    expect(last).toBeLessThan(TITANIC_PIXELS);
  });

  it('is monotonic and in range across the whole strip', () => {
    const segments = stripSegmentCount(TITANIC_PIXELS, STRIP_MAX_SEGMENTS);
    let previous = -1;
    for (let i = 0; i < segments; i += 1) {
      const index = stripSampleIndex(i, segments, TITANIC_PIXELS);
      expect(index).toBeGreaterThan(previous);
      expect(index).toBeLessThan(TITANIC_PIXELS);
      previous = index;
    }
  });

  it('matches the engine subsample table byte for byte', () => {
    // marsin_engine/lib/vis_budget.js: sampleIdx[i] = floor(i * pixelCount / budget)
    const segments = 100;
    for (let i = 0; i < segments; i += 1) {
      expect(stripSampleIndex(i, segments, TITANIC_PIXELS))
        .toBe(Math.floor((i * TITANIC_PIXELS) / segments));
    }
  });

  it('refuses a zero segment count', () => {
    expect(() => stripSampleIndex(0, 0, 100)).toThrow(/segments/);
  });
});

describe('the shipped budget', () => {
  it('is exactly what the strips drew before _239 — zero cost delta', () => {
    // The engine capped every key to 100 and the strips drew all of them.
    expect(STRIP_MAX_SEGMENTS).toBe(100);
  });

  it('speaks the engine frame layout', () => {
    expect(BYTES_PER_PIXEL).toBe(6);
  });
});
