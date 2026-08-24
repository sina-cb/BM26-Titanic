import { describe, expect, it } from 'vitest';

import type { OverviewCue, OverviewDay, OverviewSun } from '../../utils/timelineApi';
import {
  authoringToWire,
  cueFirePreview,
  frameCueEntries,
  frameGutterLabels,
  FRAME_LEGEND_IDS,
  FRAME_MIDNIGHT_COLOR,
  FRAME_SUN_COLORS,
  frameDaysSummary,
  frameHeader,
  frameHourLabels,
  frameIndexForInstant,
  frameInstantAt,
  frameNowMarker,
  frameNowSentence,
  frameNowSpanIndex,
  frameNowStatus,
  frameOffset,
  framePartyBands,
  framePhaseBands,
  frameSpan,
  frameSunMarkers,
  frameTravelResolveDate,
  wireToFrameIndex,
  WORKING_DAY_START_MIN,
} from './day_frame_logic';

// A 4-day festival starting SUNDAY 2026-08-30 — the §B worked-example fixture.
// Sun 30th, Mon 31st, Tue 1st, Wed 2nd; the morning after Night 4 is Thu 3rd.
const DATES = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'];

function sun(overrides: Partial<OverviewSun> = {}): OverviewSun {
  return {
    sunrise: '06:17',
    sunset: '19:45',
    solarNoon: '13:01',
    civilDusk: '20:14',
    civilDawn: '05:49',
    goldenHourStart: '19:05',
    goldenHourEnd: '06:57',
    ...overrides,
  };
}

function cue(id: string, atLocal: string | null, extra: Partial<OverviewCue> = {}): OverviewCue {
  return {
    id,
    label: id,
    kind: 'ambient',
    trigger: atLocal ? { type: 'clock', at: atLocal } : { type: 'manual' },
    action: { type: 'playlist', name: 'default', target: { channel: 'deck', id: null } },
    atLocal,
    ...extra,
  };
}

function day(index: number, overrides: Partial<OverviewDay> = {}): OverviewDay {
  const date = DATES[index];
  return {
    index,
    date,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed'][index],
    sun: sun(),
    nextSun: { sunrise: '06:18', civilDawn: '05:50' },
    cues: [],
    phases: [],
    segments: [],
    partyWindow: null,
    ...overrides,
  };
}

function festival(overrides: Record<number, Partial<OverviewDay>> = {}): OverviewDay[] {
  return [0, 1, 2, 3].map((i) => day(i, overrides[i] ?? {}));
}

describe('frameSpan', () => {
  it('describes a working night as 6 PM on its date through 6 PM on the next', () => {
    const span = frameSpan('working', festival(), 0);
    expect(span.startDate).toBe('2026-08-30');
    expect(span.endDate).toBe('2026-08-31');
    expect(span.startMin).toBe(WORKING_DAY_START_MIN);
    expect(span.durationMin).toBe(1440);
    expect(span.nextDay?.date).toBe('2026-08-31');
  });

  it('marks the LAST night morning half as outside the span (nextDay null)', () => {
    const span = frameSpan('working', festival(), 3);
    expect(span.endDate).toBe('2026-09-03');
    expect(span.nextDay).toBeNull();
    expect(frameHeader(span).tailNote)
      .toBe('After THU 12:00 AM is past the festival — nothing can be scheduled there.');
  });

  it('describes a regular day as midnight to midnight on one date', () => {
    const span = frameSpan('regular', festival(), 1);
    expect(span.startDate).toBe('2026-08-31');
    expect(span.endDate).toBeNull();
    expect(span.startMin).toBe(0);
  });

  it('throws for an index outside the festival span (no Night 0, no Night N)', () => {
    expect(() => frameSpan('working', festival(), -1)).toThrow(/outside the festival span/);
    expect(() => frameSpan('working', festival(), 4)).toThrow(/outside the festival span/);
  });
});

describe('frameIndexForInstant (§B instant rule)', () => {
  const days = festival();
  it('working: an evening instant stays on its own wire day', () => {
    expect(frameIndexForInstant('working', days, '2026-08-31', 20 * 60)).toBe(1);
  });
  it('working: a morning instant belongs to the PREVIOUS night', () => {
    expect(frameIndexForInstant('working', days, '2026-08-31', 2 * 60)).toBe(0);
  });
  it('working: day-0 morning is before Night 1 — null, never Night 0', () => {
    expect(frameIndexForInstant('working', days, '2026-08-30', 2 * 60)).toBeNull();
  });
  it('working: the morning after the last night still belongs to Night 4', () => {
    expect(frameIndexForInstant('working', days, '2026-09-03', 2 * 60)).toBe(3);
  });
  it('working: 6 PM on the day after the last night is past the festival', () => {
    expect(frameIndexForInstant('working', days, '2026-09-03', 18 * 60)).toBeNull();
  });
  it('regular: the index is the wire day, morning or evening', () => {
    expect(frameIndexForInstant('regular', days, '2026-08-30', 2 * 60)).toBe(0);
    expect(frameIndexForInstant('regular', days, '2026-08-30', 20 * 60)).toBe(0);
    expect(frameIndexForInstant('regular', days, '2026-09-03', 2 * 60)).toBeNull();
  });
  it('is null for a date outside the festival entirely', () => {
    expect(frameIndexForInstant('working', days, '2026-08-20', 20 * 60)).toBeNull();
  });
});

describe('frameOffset', () => {
  const days = festival();
  it('working: 6 PM is 0, midnight is 360, the closing 6 PM is 1440', () => {
    const span = frameSpan('working', days, 0);
    expect(frameOffset(span, '2026-08-30', 18 * 60)).toBe(0);
    expect(frameOffset(span, '2026-08-30', 1440)).toBe(360);
    expect(frameOffset(span, '2026-08-31', 0)).toBe(360);
    expect(frameOffset(span, '2026-08-31', 2 * 60)).toBe(480);
    expect(frameOffset(span, '2026-08-31', 18 * 60)).toBe(1440);
  });
  it('working: an instant before 6 PM on the opening date is outside', () => {
    const span = frameSpan('working', days, 0);
    expect(frameOffset(span, '2026-08-30', 9 * 60)).toBeNull();
    expect(frameOffset(span, '2026-08-31', 19 * 60)).toBeNull();
  });
  it('regular: the offset IS the minute-of-day, on that date only', () => {
    const span = frameSpan('regular', days, 0);
    expect(frameOffset(span, '2026-08-30', 9 * 60)).toBe(540);
    expect(frameOffset(span, '2026-08-31', 9 * 60)).toBeNull();
  });
});

describe('frameInstantAt', () => {
  const days = festival();
  it('working: taps map into the evening half and then the morning half', () => {
    const span = frameSpan('working', days, 0);
    expect(frameInstantAt(span, 0)).toEqual({ date: '2026-08-30', time: '18:00' });
    expect(frameInstantAt(span, 480)).toEqual({ date: '2026-08-31', time: '02:00' });
  });
  it('working: a tap in the LAST night hatched tail opens nothing', () => {
    const span = frameSpan('working', days, 3);
    expect(frameInstantAt(span, 0)).toEqual({ date: '2026-09-02', time: '18:00' });
    expect(frameInstantAt(span, 480)).toBeNull();
  });
  it('regular: taps map straight onto the calendar day', () => {
    const span = frameSpan('regular', days, 0);
    expect(frameInstantAt(span, 540)).toEqual({ date: '2026-08-30', time: '09:00' });
  });
});

describe('frameHourLabels', () => {
  it('working: 6 PM … 12 AM stamped MON … 6 PM', () => {
    const labels = frameHourLabels(frameSpan('working', festival(), 0));
    expect(labels[0]).toEqual({ offset: 0, label: '6:00 PM' });
    const midnight = labels.find((l) => l.offset === 360);
    expect(midnight).toEqual({ offset: 360, label: '12:00 AM', dateStamp: 'MON' });
    expect(labels.at(-1)).toEqual({ offset: 1440, label: '6:00 PM' });
  });
  it('regular: 12 AM … 12 PM … 12 AM, no weekday stamp', () => {
    const labels = frameHourLabels(frameSpan('regular', festival(), 0));
    expect(labels[0]).toEqual({ offset: 0, label: '12:00 AM' });
    expect(labels.find((l) => l.offset === 720)).toEqual({ offset: 720, label: '12:00 PM' });
    expect(labels.every((l) => l.dateStamp === undefined)).toBe(true);
  });
});

describe('frameNowStatus / frameNowMarker (C-01)', () => {
  const days = festival();
  it('names the pre-6 PM day-0 case instead of silently dropping NOW', () => {
    const status = frameNowStatus('working', days, '2026-08-30', 14 * 60 + 14);
    expect(status).toEqual({ kind: 'before-first', opensLabel: '6:00 PM' });
    expect(frameNowSentence('working', days, '2026-08-30', 14 * 60 + 14))
      .toBe('NOW 2:14 PM · before NIGHT 1 opens at 6:00 PM');
  });
  it('draws NOW at 14:14 on DAY 1 in the regular frame', () => {
    expect(frameNowStatus('regular', days, '2026-08-30', 14 * 60 + 14))
      .toEqual({ kind: 'inside', index: 0 });
    expect(frameNowSentence('regular', days, '2026-08-30', 14 * 60 + 14)).toBeNull();
    expect(frameNowMarker(frameSpan('regular', days, 0), '2026-08-30', 14 * 60 + 14))
      .toEqual({ offset: 854, label: 'NOW 2:14 PM', shortLabel: 'NOW 2:14P', inside: true });
  });
  it('reports after-last and off-festival distinctly', () => {
    expect(frameNowStatus('working', days, '2026-09-03', 20 * 60)).toEqual({ kind: 'after-last' });
    expect(frameNowStatus('working', days, '2026-07-04', 20 * 60)).toEqual({ kind: 'off-festival' });
    expect(frameNowSentence('working', days, '2026-09-03', 20 * 60))
      .toBe("NOW 8:00 PM · the festival's last night has ended");
  });
  it('reports off-festival when no plan timezone yields a minute', () => {
    expect(frameNowStatus('working', days, '2026-08-30', null)).toEqual({ kind: 'off-festival' });
  });
});

// The operator's override of C-01: the red NOW line is ALWAYS drawn, on the
// span whose clock position matches the current time — before NIGHT 1 opens as
// much as during it. Only a date off the festival draws nothing.
describe('frameNowMarker — the always-drawn NOW line', () => {
  const days = festival();

  it('working, before NIGHT 1 opens: 11:27 AM is carried at 17 h 27 m into N1', () => {
    const marker = frameNowMarker(frameSpan('working', days, 0), '2026-08-30', 11 * 60 + 27);
    expect(marker).toEqual({
      offset: 17 * 60 + 27,
      label: 'NOW 11:27 AM',
      shortLabel: 'NOW 11:27A',
      inside: false,
    });
    // …and the position's own ruler label IS 11:27 AM's hour, between the 9 AM
    // and 12 PM ticks of the 6 PM-anchored frame.
    const labels = frameHourLabels(frameSpan('working', days, 0));
    const before = [...labels].reverse().find((l) => l.offset <= marker!.offset)!;
    const after = labels.find((l) => l.offset >= marker!.offset)!;
    expect(before.label).toBe('9:00 AM');
    expect(after.label).toBe('12:00 PM');
  });

  it('working, before NIGHT 1: no OTHER night draws the line', () => {
    for (const index of [1, 2, 3]) {
      expect(frameNowMarker(frameSpan('working', days, index), '2026-08-30', 11 * 60 + 27))
        .toBeNull();
    }
  });

  it('working, past the last night: the line is carried on N4 at its clock spot', () => {
    expect(frameNowMarker(frameSpan('working', days, 3), '2026-09-03', 20 * 60))
      .toEqual({ offset: 120, label: 'NOW 8:00 PM', shortLabel: 'NOW 8:00P', inside: false });
    // 6:00 PM exactly on that date is the first offset past the close.
    expect(frameNowMarker(frameSpan('working', days, 3), '2026-09-03', 18 * 60)?.offset).toBe(0);
  });

  it('regular, the day after the festival: the line is carried on DAY 4', () => {
    expect(frameNowMarker(frameSpan('regular', days, 3), '2026-09-03', 11 * 60 + 27))
      .toEqual({
        offset: 11 * 60 + 27, label: 'NOW 11:27 AM', shortLabel: 'NOW 11:27A', inside: false,
      });
    expect(frameNowMarker(frameSpan('regular', days, 2), '2026-09-03', 11 * 60 + 27)).toBeNull();
  });

  it('draws NOTHING for a date off the festival, and none for an unknown clock', () => {
    for (const frame of ['working', 'regular'] as const) {
      for (let i = 0; i < days.length; i += 1) {
        expect(frameNowMarker(frameSpan(frame, days, i), '2026-07-04', 20 * 60)).toBeNull();
        expect(frameNowMarker(frameSpan(frame, days, i), '2026-08-31', null)).toBeNull();
      }
    }
    expect(frameNowSpanIndex('working', days, '2026-07-04', 20 * 60)).toBeNull();
    expect(frameNowSpanIndex('working', days, '2026-08-31', null)).toBeNull();
  });

  it('never draws the line twice, and always agrees with frameNowSpanIndex', () => {
    const dates = ['2026-08-29', ...DATES, '2026-09-03', '2026-09-04'];
    for (const frame of ['working', 'regular'] as const) {
      for (const date of dates) {
        for (let minute = 0; minute < 1440; minute += 7) {
          const drawn: number[] = [];
          for (let i = 0; i < days.length; i += 1) {
            if (frameNowMarker(frameSpan(frame, days, i), date, minute)) drawn.push(i);
          }
          expect(drawn.length).toBeLessThanOrEqual(1);
          const expected = frameNowSpanIndex(frame, days, date, minute);
          expect(drawn).toEqual(expected === null ? [] : [expected]);
        }
      }
    }
  });

  it('the line lands on a span for EVERY minute of every festival date', () => {
    for (const frame of ['working', 'regular'] as const) {
      for (const date of DATES) {
        for (let minute = 0; minute < 1440; minute += 1) {
          expect(frameNowSpanIndex(frame, days, date, minute)).not.toBeNull();
        }
      }
    }
  });
});

describe('frameSunMarkers', () => {
  it('working: sunset/dusk from this day, sunrise/dawn from nextSun', () => {
    const markers = frameSunMarkers(frameSpan('working', festival(), 0));
    expect(markers.map((m) => m.id)).toEqual(['sunset', 'civilDusk', 'civilDawn', 'sunrise']);
    expect(markers[0].label).toBe('SUNSET 7:45 PM');
    expect(markers[0].shortLabel).toBe('SUNSET 7:45P');
    expect(markers[1].label).toBe('DUSK 8:14 PM');
    expect(markers[2].label).toBe('DAWN 5:50 AM');
    expect(markers[2].date).toBe('2026-08-31');
    expect(markers[3].label).toBe('SUNRISE 6:18 AM');
  });

  it('working: the LAST night still gets a sunrise (nextSun, not nextDay)', () => {
    const markers = frameSunMarkers(frameSpan('working', festival(), 3));
    expect(markers.map((m) => m.id)).toEqual(['sunset', 'civilDusk', 'civilDawn', 'sunrise']);
    expect(markers[3].date).toBe('2026-09-03');
  });

  it('regular: all four come from the day itself, in clock order', () => {
    const markers = frameSunMarkers(frameSpan('regular', festival(), 0));
    expect(markers.map((m) => m.id)).toEqual(['civilDawn', 'sunrise', 'sunset', 'civilDusk']);
    expect(markers[0].offset).toBe(5 * 60 + 49);
  });

  it('draws no morning bars when the engine sent no nextSun (never invents one)', () => {
    const days = festival({ 0: { nextSun: undefined } });
    const markers = frameSunMarkers(frameSpan('working', days, 0));
    expect(markers.map((m) => m.id)).toEqual(['sunset', 'civilDusk']);
  });
});

describe('frameCueEntries (§B worked rows)', () => {
  it('working: a 02:00 cue on wire day 1 plots in NIGHT 1 morning half', () => {
    const days = festival({ 1: { cues: [cue('c_morning', '02:00')] } });
    const entries = frameCueEntries(frameSpan('working', days, 0));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2026-08-31', weekday: 'MON', offset: 480, timing: 'plotted',
    });
  });

  it('working: an existing 02:00 cue on wire day 0 is NIGHT 1 lead-in, unplotted', () => {
    const days = festival({ 0: { cues: [cue('c_early', '02:00')] } });
    const entries = frameCueEntries(frameSpan('working', days, 0));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ timing: 'lead-in', offset: null, weekday: 'SUN' });
  });

  it('working: a wire-day-2 02:00 cue never appears on NIGHT 3 as a lead-in', () => {
    const days = festival({ 2: { cues: [cue('c_morning', '02:00')] } });
    expect(frameCueEntries(frameSpan('working', days, 2))).toHaveLength(0);
    expect(frameCueEntries(frameSpan('working', days, 1))).toHaveLength(1);
  });

  it('working: 6:00 PM on the next date opens the NEXT night, not this one', () => {
    const days = festival({ 1: { cues: [cue('c_six', '18:00')] } });
    expect(frameCueEntries(frameSpan('working', days, 0))).toHaveLength(0);
    expect(frameCueEntries(frameSpan('working', days, 1))).toHaveLength(1);
  });

  it('regular: a 02:00 cue plots on its own calendar day', () => {
    const days = festival({ 0: { cues: [cue('c_early', '02:00')] } });
    const entries = frameCueEntries(frameSpan('regular', days, 0));
    expect(entries[0]).toMatchObject({ offset: 120, timing: 'plotted', date: '2026-08-30' });
  });

  it('lists a time-less cue as manual instead of dropping it', () => {
    const days = festival({ 0: { cues: [cue('c_manual', null)] } });
    const entries = frameCueEntries(frameSpan('working', days, 0));
    expect(entries[0]).toMatchObject({ timing: 'manual', offset: null });
  });

  it('hides the Party Window implementation cues', () => {
    const partyCue: OverviewCue = {
      ...cue('c_party', '09:00'),
      kind: 'mood',
      trigger: { type: 'mood', from: 'calm', to: 'party', whenPhase: 'pw_c_party' },
    };
    const baseline: OverviewCue = {
      ...cue('pwb_c_party', '09:00'),
      trigger: { type: 'phase', phase: 'pw_c_party' },
    };
    const closer = cue('pwe_c_party', '17:00');
    const days = festival({ 1: { cues: [partyCue, baseline, closer] } });
    const entries = frameCueEntries(frameSpan('working', days, 0));
    expect(entries.map((e) => e.cue.id)).toEqual(['c_party']);
  });

  it('carries a cue duration into endOffset, clamped at the span end', () => {
    const days = festival({ 0: { cues: [cue('c_block', '23:00', { durationMin: 600 })] } });
    const entries = frameCueEntries(frameSpan('working', days, 0));
    expect(entries[0].offset).toBe(300);
    expect(entries[0].endOffset).toBe(900);
  });
});

describe('framePartyBands (C-03)', () => {
  const window = {
    phaseId: 'pw_c_party', cueId: 'c_party',
    opensLocal: '09:00', closesLocal: '17:00', wraps: false,
  };
  const wrapping = {
    phaseId: 'pw_c_party', cueId: 'c_party',
    opensLocal: '21:00', closesLocal: '09:00', wraps: true,
  };

  it('working: a 09:00 → 17:00 window on wire day 1 lands in NIGHT 1 morning half', () => {
    const days = festival({ 1: { partyWindow: window } });
    expect(framePartyBands(frameSpan('working', days, 0))).toEqual([{
      fromOffset: 900, toOffset: 1380, label: 'MON 9:00 AM → 5:00 PM',
    }]);
  });

  it('working: nights whose day has no partyWindow draw NO band', () => {
    const days = festival({ 1: { partyWindow: window } });
    expect(framePartyBands(frameSpan('working', days, 1))).toEqual([]);
    expect(framePartyBands(frameSpan('working', days, 2))).toEqual([]);
    expect(framePartyBands(frameSpan('working', days, 3))).toEqual([]);
  });

  it('working: a 21:00 → 09:00 window is ONE band across the midnight line', () => {
    const days = festival({ 0: { partyWindow: wrapping } });
    expect(framePartyBands(frameSpan('working', days, 0))).toEqual([{
      fromOffset: 180, toOffset: 900, label: 'SUN 9:00 PM → 9:00 AM',
    }]);
  });

  it('regular: a wrapping window is TWO pieces, the second tagged continuesFrom', () => {
    const days = festival({ 0: { partyWindow: wrapping } });
    expect(framePartyBands(frameSpan('regular', days, 0))).toEqual([{
      fromOffset: 1260, toOffset: 1440, label: 'SUN 9:00 PM → 9:00 AM',
    }]);
    expect(framePartyBands(frameSpan('regular', days, 1))).toEqual([{
      fromOffset: 0, toOffset: 540, label: 'SUN 9:00 PM → 9:00 AM', continuesFrom: 0,
    }]);
  });

  it('regular: a same-day window is one band on its own day only', () => {
    const days = festival({ 1: { partyWindow: window } });
    expect(framePartyBands(frameSpan('regular', days, 1))).toEqual([{
      fromOffset: 540, toOffset: 1020, label: 'MON 9:00 AM → 5:00 PM',
    }]);
    expect(framePartyBands(frameSpan('regular', days, 2))).toEqual([]);
  });
});

describe('framePhaseBands', () => {
  it('excludes the party phase — that band comes from partyWindow alone', () => {
    const days = festival({
      1: {
        partyWindow: {
          phaseId: 'pw_c_party', cueId: 'c_party',
          opensLocal: '09:00', closesLocal: '17:00', wraps: false,
        },
        phases: [
          { name: 'pw_c_party', startLocal: '09:00', endLocal: '17:00' },
          { name: 'philharmonic', startLocal: '02:00', endLocal: '03:00' },
        ],
      },
    });
    const bands = framePhaseBands(frameSpan('working', days, 0));
    expect(bands.map((b) => b.phase.name)).toEqual(['philharmonic']);
  });

  it('still excludes it on a day whose party cue does not apply (C-03)', () => {
    const days = festival({
      1: {
        partyWindow: {
          phaseId: 'party_night', cueId: 'c_party',
          opensLocal: '21:00', closesLocal: '05:00', wraps: true,
        },
      },
      2: { phases: [{ name: 'party_night', startLocal: '21:00', endLocal: '05:00' }] },
    });
    const bands = framePhaseBands(frameSpan('working', days, 2));
    expect(bands).toEqual([]);
  });
});

describe('authoringToWire (§B authoring rule + C-06 sun halves)', () => {
  it('working: an evening clock stays on the night, a morning clock rolls forward', () => {
    expect(authoringToWire('working', 0, { type: 'clock', at: '20:00' }, 4))
      .toEqual({ wireDays: [0] });
    expect(authoringToWire('working', 0, { type: 'clock', at: '02:00' }, 4))
      .toEqual({ wireDays: [1] });
  });

  it('regular: the frame index IS the wire day, whatever the clock', () => {
    expect(authoringToWire('regular', 0, { type: 'clock', at: '02:00' }, 4))
      .toEqual({ wireDays: [0] });
    expect(authoringToWire('regular', 3, { type: 'clock', at: '02:00' }, 4))
      .toEqual({ wireDays: [3] });
  });

  it('working: refuses a 02:00 cue on the LAST night', () => {
    const result = authoringToWire('working', 3, { type: 'clock', at: '02:00' }, 4);
    expect(result).toEqual({
      error: 'This lands on the morning after the last festival night, so it rolls past '
        + 'the last festival night — pick an evening time or add a day.',
    });
  });

  it('working: an EVENING sun event keeps the night (sunset −30 on NIGHT 2 → wire 1)', () => {
    expect(authoringToWire('working', 1, { type: 'sun', event: 'sunset', offsetMin: -30 }, 4))
      .toEqual({ wireDays: [1] });
  });

  it('working: a MORNING sun event rolls forward (sunrise −20 on NIGHT 2 → wire 2)', () => {
    expect(authoringToWire('working', 1, { type: 'sun', event: 'sunrise', offsetMin: -20 }, 4))
      .toEqual({ wireDays: [2] });
    expect(authoringToWire('working', 1, { type: 'sun', event: 'civilDawn' }, 4))
      .toEqual({ wireDays: [2] });
    expect(authoringToWire('working', 1, { type: 'sun', event: 'goldenHourEnd' }, 4))
      .toEqual({ wireDays: [2] });
    expect(authoringToWire('working', 1, { type: 'sun', event: 'civilDusk' }, 4))
      .toEqual({ wireDays: [1] });
  });

  it('working: a Party Window keeps its authored day — its start clock names it', () => {
    expect(authoringToWire(
      'working', 1,
      { type: 'mood', from: 'calm', to: 'party', whenPhase: 'pw_c_party' },
      4,
    )).toEqual({ wireDays: [1] });
  });

  it('refuses an index outside the span', () => {
    expect(authoringToWire('working', 4, { type: 'clock', at: '20:00' }, 4))
      .toEqual({ error: "NIGHT 5 is outside this plan's festival span (1–4)." });
  });
});

describe('wireToFrameIndex', () => {
  it('working: an evening cue keeps its wire day, a morning cue steps back', () => {
    expect(wireToFrameIndex('working', 1, '20:00')).toBe(1);
    expect(wireToFrameIndex('working', 1, '02:00')).toBe(0);
  });
  it('working: a day-0 morning cue belongs to no night (null, never Night −1)', () => {
    expect(wireToFrameIndex('working', 0, '02:00')).toBeNull();
  });
  it('working: an explicit half wins when there is no resolved clock', () => {
    expect(wireToFrameIndex('working', 2, 'morning')).toBe(1);
    expect(wireToFrameIndex('working', 2, 'evening')).toBe(2);
    expect(wireToFrameIndex('working', 2, null)).toBe(2);
  });
  it('regular: identity', () => {
    expect(wireToFrameIndex('regular', 0, '02:00')).toBe(0);
    expect(wireToFrameIndex('regular', 3, '20:00')).toBe(3);
  });
});

describe('frameDaysSummary', () => {
  it('names every night / every day', () => {
    expect(frameDaysSummary('working', 'all', '23:30', 4)).toBe('Every night');
    expect(frameDaysSummary('regular', 'all', '23:30', 4)).toBe('Every day');
  });
  it('maps wire days through the frame', () => {
    expect(frameDaysSummary('working', [0, 2], '23:30', 4)).toBe('Night 1, Night 3');
    expect(frameDaysSummary('working', [1], '02:00', 4)).toBe('Night 1');
    expect(frameDaysSummary('regular', [1], '02:00', 4)).toBe('Day 2');
  });
  it('says so when a stored day maps before the first night', () => {
    expect(frameDaysSummary('working', [0], '02:00', 4)).toBe('before NIGHT 1');
  });
  it('lists explicit dates verbatim', () => {
    expect(frameDaysSummary('working', ['2026-08-30'], '23:30', 4))
      .toBe('Dates: 2026-08-30');
  });
});

describe('frameHeader', () => {
  it('working: names both days and the festival position', () => {
    const header = frameHeader(frameSpan('working', festival(), 0));
    expect(header.title).toBe('NIGHT 1 · SUN → MON');
    expect(header.subtitle).toBe('Sun 6:00 PM → Mon 6:00 PM · festival day 1 of 4');
    expect(header.cardTitle).toBe('N1 · SUN → MON');
  });
  it('regular: names one day', () => {
    const header = frameHeader(frameSpan('regular', festival(), 0));
    expect(header.title).toBe('DAY 1 · SUN');
    expect(header.subtitle).toBe('Sun 12:00 AM → 12:00 AM · festival day 1 of 4');
    expect(header.cardTitle).toBe('D1 · SUN');
  });
});

describe('frameTravelResolveDate', () => {
  const days = festival();
  it('working: 02:00 on NIGHT 1 resolves to the Monday date', () => {
    expect(frameTravelResolveDate('working', days, 0, '02:00')).toBe('2026-08-31');
    expect(frameTravelResolveDate('working', days, 0, '20:00')).toBe('2026-08-30');
  });
  it('working: the last night morning is outside the festival — null', () => {
    expect(frameTravelResolveDate('working', days, 3, '02:00')).toBeNull();
    expect(frameTravelResolveDate('working', days, 3, '20:00')).toBe('2026-09-02');
  });
  it('regular: always the day itself', () => {
    expect(frameTravelResolveDate('regular', days, 0, '02:00')).toBe('2026-08-30');
  });
  it('is null without a selected day or a valid time', () => {
    expect(frameTravelResolveDate('working', days, null, '02:00')).toBeNull();
    expect(frameTravelResolveDate('working', days, 0, 'nope')).toBeNull();
  });
});

describe('the shared legend covers every marker the frames can draw (D.2)', () => {
  it('pins the legend rows and their marker ids', () => {
    expect(FRAME_LEGEND_IDS).toEqual([
      'now', 'sunset', 'sunrise', 'duskDawn', 'party', 'program', 'mood', 'ambient',
    ]);
  });

  it('gives every sun marker id a colour — nothing is drawn without a legend row', () => {
    const drawn = new Set<string>();
    for (const frame of ['working', 'regular'] as const) {
      for (let i = 0; i < 4; i += 1) {
        for (const marker of frameSunMarkers(frameSpan(frame, festival(), i))) {
          drawn.add(marker.id);
        }
      }
    }
    expect([...drawn].sort()).toEqual(['civilDawn', 'civilDusk', 'sunrise', 'sunset']);
    for (const id of drawn) {
      expect(FRAME_SUN_COLORS[id as keyof typeof FRAME_SUN_COLORS]).toMatch(/^#[0-9a-f]{6,8}$/);
    }
    // DUSK and DAWN share the one "DUSK / DAWN" legend row, by hue family.
    expect(FRAME_SUN_COLORS.civilDusk.startsWith(FRAME_SUN_COLORS.sunset)).toBe(true);
    expect(FRAME_SUN_COLORS.civilDawn.startsWith(FRAME_SUN_COLORS.sunrise)).toBe(true);
  });
});

describe('frameGutterLabels (D.2 collision rule)', () => {
  const base = {
    hours: [{ offset: 0, label: '6:00 PM' }, { offset: 720, label: '6:00 AM' }],
    height: 720,
    durationMin: 1440,
  };

  it('NOW always wins its slot; a colliding sun label stacks with a leader', () => {
    const out = frameGutterLabels({
      ...base,
      now: { offset: 100, label: 'NOW 7:40 PM' },
      sun: [{
        id: 'sunset', offset: 105, label: 'SUNSET 7:45 PM',
        shortLabel: 'SUNSET 7:45P', date: '2026-08-30',
      }],
    });
    const now = out.find((l) => l.kind === 'now')!;
    const sunset = out.find((l) => l.id === 'sunset')!;
    expect(now.labelY).toBe(now.y);
    expect(sunset.stacked).toBe(true);
    expect(sunset.labelY).toBeGreaterThan(sunset.y);
  });

  it('drops an hour label that falls inside a marker label claim', () => {
    const out = frameGutterLabels({
      ...base,
      now: { offset: 2, label: 'NOW 6:02 PM' },
      sun: [],
    });
    expect(out.some((l) => l.key === 'hour:0')).toBe(false);
    expect(out.some((l) => l.key === 'hour:720')).toBe(true);
  });

  it('keeps well-separated labels on their own bars', () => {
    const out = frameGutterLabels({
      ...base,
      now: null,
      sun: [
        { id: 'sunset', offset: 105, label: 'SUNSET 7:45 PM', shortLabel: 'S', date: 'd' },
        { id: 'sunrise', offset: 800, label: 'SUNRISE 6:17 AM', shortLabel: 'S', date: 'd' },
      ],
    });
    expect(out.filter((l) => l.kind === 'sun').every((l) => !l.stacked)).toBe(true);
  });

  it('flags the date-changing MIDNIGHT label so it can take the divider colour', () => {
    const out = frameGutterLabels({
      hours: frameHourLabels(frameSpan('working', festival(), 0)),
      height: 720,
      durationMin: 1440,
      now: null,
      sun: [],
    });
    const midnight = out.find((l) => l.midnight)!;
    expect(midnight.key).toBe('hour:360');
    expect(midnight.text).toBe('12:00 AM (MON)');
    expect(out.filter((l) => l.midnight)).toHaveLength(1);
    expect(FRAME_MIDNIGHT_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('flags nothing on a regular day — it has no date-changing line', () => {
    const out = frameGutterLabels({
      hours: frameHourLabels(frameSpan('regular', festival(), 0)),
      height: 720,
      durationMin: 1440,
      now: null,
      sun: [],
    });
    expect(out.some((l) => l.midnight)).toBe(false);
  });

  it('uses the short labels for the narrow strip gutter', () => {
    const out = frameGutterLabels({
      ...base,
      now: null,
      short: true,
      sun: [{
        id: 'sunset', offset: 105, label: 'SUNSET 7:45 PM',
        shortLabel: 'SUNSET 7:45P', date: 'd',
      }],
    });
    expect(out.find((l) => l.id === 'sunset')!.text).toBe('SUNSET 7:45P');
  });
});

describe('cueFirePreview (D.4)', () => {
  const days = festival();
  const sunByDate: Record<string, OverviewSun> = {
    '2026-08-30': sun(),
    '2026-08-31': sun(),
    '2026-09-01': sun({ sunrise: '06:18' }),
    '2026-09-02': sun(),
  };

  it('clock: names the calendar day and the half', () => {
    expect(cueFirePreview({
      frame: 'working', index: 0, trigger: { type: 'clock', at: '02:00' }, days, sunByDate,
    })).toEqual({ text: 'Fires MON 2:00 AM (morning half of NIGHT 1)' });
    expect(cueFirePreview({
      frame: 'regular', index: 0, trigger: { type: 'clock', at: '02:00' }, days, sunByDate,
    })).toEqual({ text: 'Fires SUN 2:00 AM (DAY 1)' });
  });

  it('sun: resolves through sunByDate on the day the half lands on', () => {
    expect(cueFirePreview({
      frame: 'working',
      index: 1,
      trigger: { type: 'sun', event: 'sunrise', offsetMin: -20 },
      days,
      sunByDate,
    })).toEqual({ text: 'Fires ~TUE 5:58 AM (sunrise −20)' });
  });

  it('sun: blocks with a sentence when the night has no sun table', () => {
    expect(cueFirePreview({
      frame: 'working',
      index: 1,
      trigger: { type: 'sun', event: 'sunrise', offsetMin: -20 },
      days,
      sunByDate: {},
    })).toEqual({ error: 'Sun times for this night are not loaded — reconnect.' });
  });

  it('party: describes the window and where detection is armed', () => {
    expect(cueFirePreview({
      frame: 'working',
      index: 1,
      trigger: { type: 'mood', from: 'calm', to: 'party', whenPhase: 'pw_c_party' },
      days,
      sunByDate,
      partyWindow: { opensLocal: '09:00', closesLocal: '17:00' },
    })).toEqual({ text: 'Window MON 9:00 AM → 5:00 PM · detection armed inside it' });
  });

  it('surfaces the last-night refusal instead of a preview', () => {
    expect(cueFirePreview({
      frame: 'working', index: 3, trigger: { type: 'clock', at: '02:00' }, days, sunByDate,
    })).toEqual({
      error: 'This lands on the morning after the last festival night, so it rolls past '
        + 'the last festival night — pick an evening time or add a day.',
    });
  });
});
