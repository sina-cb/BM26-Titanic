import { describe, expect, it } from 'vitest';

import type { OverviewCue, OverviewDay } from '../../utils/timelineApi';

import {
  nightAxisFor,
  nightCueEntries,
  nightLeadInCueEntries,
  nightNowDayOffset,
  nightOffset,
  nightPhaseEntries,
  nightTapTarget,
  timelineHourOffsets,
  yForNightOffset,
} from './night_calendar_logic';

function cue(id: string, atLocal: string | null, durationMin?: number): OverviewCue {
  return {
    id,
    label: id,
    kind: id.includes('party') ? 'mood' : 'program',
    trigger: { type: 'manual' },
    action: { type: 'playlist', name: 'test', target: { channel: 'deck', id: null } },
    atLocal,
    ...(durationMin === undefined ? {} : { durationMin }),
  };
}

function day(
  index: number,
  date: string,
  sunrise: string,
  sunset: string,
  cues: OverviewCue[],
): OverviewDay {
  return {
    index,
    date,
    weekday: index === 0 ? 'Friday' : 'Saturday',
    sun: {
      sunrise,
      sunset,
      solarNoon: '13:00',
      civilDusk: '20:30',
      goldenHourStart: '19:00',
      goldenHourEnd: '20:00',
    },
    cues,
    phases: [],
    segments: [],
  };
}

describe('night calendar axis', () => {
  const friday = day(
    0,
    '2026-08-28',
    '06:10',
    '20:00',
    [
      cue('friday-morning', '05:00'),
      cue('visibility-lead-in', '19:15'),
      cue('friday-show', '21:00', 90),
      cue('manual', null),
    ],
  );
  const saturday = day(
    1,
    '2026-08-29',
    '06:00',
    '19:58',
    [cue('party-after-midnight', '01:30', 30), cue('saturday-day', '12:00')],
  );

  it('runs from 6 PM through 6 PM the following date', () => {
    const axis = nightAxisFor(friday, saturday);
    expect(axis).toEqual({ sunsetMin: 1080, sunriseMin: 1080, durationMin: 1440 });
    expect(nightOffset(1080, 0, axis)).toBe(0);
    expect(nightOffset(1440, 0, axis)).toBe(360);
    expect(nightOffset(90, 1, axis)).toBe(450);
    expect(nightOffset(1080, 1, axis)).toBe(1440);
    expect(yForNightOffset(720, 720, axis)).toBe(360);
    expect(timelineHourOffsets(axis.durationMin)).toHaveLength(25);
    expect(timelineHourOffsets(axis.durationMin).slice(0, 4)).toEqual([0, 60, 120, 180]);
  });

  it('uses evening cues from the starting date and all pre-6 PM cues from the next date', () => {
    const axis = nightAxisFor(friday, saturday);
    const entries = nightCueEntries(friday, saturday, axis);
    expect(entries.map((entry) => [entry.cue.id, entry.date, entry.startOffset])).toEqual([
      ['visibility-lead-in', '2026-08-28', 75],
      ['friday-show', '2026-08-28', 180],
      ['party-after-midnight', '2026-08-29', 450],
      ['saturday-day', '2026-08-29', 1080],
      ['manual', '2026-08-28', null],
    ]);
  });

  it('keeps first-day morning cues visible because there is no preceding card', () => {
    const axis = nightAxisFor(friday, saturday);
    const entries = nightLeadInCueEntries(friday, axis);
    expect(entries.map((entry) => [entry.cue.id, entry.timing, entry.startOffset])).toEqual([
      ['friday-morning', 'lead-in', null],
    ]);
  });

  it('renders a midnight-crossing Party Window as one continuous band', () => {
    const first = day(0, '2026-08-28', '06:10', '20:00', []);
    const second = day(1, '2026-08-29', '06:11', '19:59', []);
    first.phases = [{ name: 'pw_c_party', startLocal: '21:00', endLocal: '01:00' }];
    second.phases = [{ name: 'pw_c_party', startLocal: '21:00', endLocal: '01:00' }];
    const axis = nightAxisFor(first, second);

    expect(axis).not.toBeNull();
    const entries = nightPhaseEntries(first, second, axis);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ fromOffset: 180, toOffset: 420 });
  });

  it('returns the correct date as taps cross midnight', () => {
    const axis = nightAxisFor(friday, saturday);
    expect(nightTapTarget(0, 600, axis, friday, saturday)).toEqual({
      date: '2026-08-28',
      time: '18:00',
    });
    expect(nightTapTarget(300, 600, axis, friday, saturday)).toEqual({
      date: '2026-08-29',
      time: '06:00',
    });
  });

  it('snaps visual placement to 15-minute increments', () => {
    const axis = nightAxisFor(friday, saturday);
    expect(nightTapTarget(7, 600, axis, friday, saturday)).toEqual({
      date: '2026-08-28',
      time: '18:15',
    });
  });

  it('places NOW on the displayed operator day that contains the instant', () => {
    const axis = nightAxisFor(friday, saturday);
    expect(nightNowDayOffset(friday, saturday, friday.index, 21 * 60, axis)).toBe(0);
    expect(nightNowDayOffset(friday, saturday, saturday.index, 10 * 60, axis)).toBe(1);
    expect(nightNowDayOffset(friday, saturday, saturday.index, 20 * 60, axis)).toBeNull();
  });

  it('does not depend on sunset data', () => {
    const missingSunset = {
      ...friday,
      sun: { ...friday.sun, sunset: null },
    };
    expect(nightAxisFor(missingSunset, saturday)).toEqual({
      sunsetMin: 1080,
      sunriseMin: 1080,
      durationMin: 1440,
    });
  });
});
