import { describe, expect, it } from 'vitest';

import { roundTimelineLocalTime, shiftTimelineLocalTime } from './timeline_travel_model';

describe('Timeline travel time controls', () => {
  it('steps across midnight in both directions', () => {
    expect(shiftTimelineLocalTime('23:55', 15)).toBe('00:10');
    expect(shiftTimelineLocalTime('00:05', -15)).toBe('23:50');
  });

  it('fails loudly on malformed local time', () => {
    expect(() => shiftTimelineLocalTime('25:00', 15)).toThrow('Invalid Timeline local time');
    expect(() => shiftTimelineLocalTime('sunset', 15)).toThrow('Invalid Timeline local time');
  });

  it('rounds the initial target to the nearest interval', () => {
    const date = new Date(2026, 7, 24, 20, 8);
    expect(roundTimelineLocalTime(date)).toBe('20:15');
  });
});
