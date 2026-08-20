import { describe, expect, it } from 'vitest';

import { advanceTraceClock } from './audio_trace_logic';

describe('audio trace publication cadence', () => {
  it.each([60, 120])('advances exactly 24 samples over one second at %i fps', (fps) => {
    let accumulator = 0;
    let steps = 0;
    for (let frame = 0; frame < fps; frame += 1) {
      const next = advanceTraceClock(accumulator, 1 / fps, 24);
      accumulator = next.remainder;
      steps += next.steps;
    }
    expect(steps).toBe(24);
    expect(accumulator).toBeLessThan(0.000001);
  });

  it('carries fractional progress without publishing a React frame', () => {
    const next = advanceTraceClock(0.1, 1 / 120, 24);
    expect(next.steps).toBe(0);
    expect(next.remainder).toBeCloseTo(0.3);
  });

  it('fails loudly on an invalid cadence', () => {
    expect(() => advanceTraceClock(0, 0.1, 0)).toThrow('advanceHz');
  });
});
