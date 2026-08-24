import { describe, expect, it } from 'vitest';

import type {
  OverviewCue as TimelineCueWire,
  OverviewDay as TimelineDayOverview,
  TimelineOverview,
  OverviewSegment as TimelineResolvedSegment,
  TimelineState,
} from './timelineApi';
import {
  currentResolvedSegment,
  manualTimelineCues,
  overviewForTimelineView,
  resolveTimelineNowOwner,
  timelineLiveStatus,
  timelineOwnerKindLabel,
  timelineTravelCuesForDay,
  timelineTravelDayLabel,
  timelineTravelResolveDateForOperatorTime,
  upcomingTimelineCues,
} from './timeline_operator_model';

function cue(
  id: string,
  label: string,
  atLocal: string | null,
  trigger: TimelineCueWire['trigger'] = { type: 'clock', at: atLocal || '00:00' },
): TimelineCueWire {
  return {
    id,
    label,
    kind: 'ambient',
    atLocal,
    trigger,
    action: {
      type: 'playlist',
      name: `${id}_playlist`,
      palette: `${id}_palette`,
    },
  };
}

function segment(overrides: Partial<TimelineResolvedSegment> = {}): TimelineResolvedSegment {
  return {
    fromMs: 0,
    toMs: 1,
    fromLocal: '20:00',
    toLocal: '21:00',
    owner: { kind: 'cue', cueId: 'c_now', label: 'Now Cue' },
    playlist: 'c_now_playlist',
    palette: 'c_now_palette',
    controller: 'autopilot',
    source: 'cue',
    ...overrides,
  };
}

function day(overrides: Partial<TimelineDayOverview> = {}): TimelineDayOverview {
  return {
    date: '2026-08-24',
    weekday: 'MONDAY',
    index: 0,
    sun: {
      sunrise: null,
      sunset: null,
      solarNoon: null,
      civilDusk: null,
      goldenHourStart: null,
      goldenHourEnd: null,
    },
    phases: [],
    cues: [cue('c_now', 'Now Cue', '20:00'), cue('c_next', 'Next Cue', '21:00')],
    segments: [segment()],
    ...overrides,
  };
}

function overview(days = [day()]): TimelineOverview {
  return {
    plan: 'live_plan',
    festival: { startDate: '2026-08-24', days: days.length },
    location: { lat: 0, lon: 0, tz: 'America/Los_Angeles' },
    days,
  };
}

describe('Timeline operator authority model', () => {
  it('uses the resolved segment as NOW instead of activeCue alone', () => {
    const live = overview();
    const state = {
      activeCue: { id: 'c_stale', label: 'Stale Active Cue' },
      activeProgram: null,
    } as TimelineState;

    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      source: 'resolved-segment',
      label: 'Now Cue',
      cueId: 'c_now',
      playlist: 'c_now_playlist',
      palette: 'c_now_palette',
      fromLocal: '20:00',
      toLocal: '21:00',
    });
  });

  it('finds the current segment by local interval', () => {
    const current = segment({ fromLocal: '23:00', toLocal: '24:00' });
    expect(currentResolvedSegment(day({ segments: [current] }), '23:59')).toBe(current);
    expect(currentResolvedSegment(day({ segments: [current] }), '22:59')).toBeNull();
  });

  it('makes manual ownership explicit instead of presenting the waiting plan as NOW', () => {
    const live = overview();
    const state = {
      controller: 'manual',
      activeCue: null,
      activeProgram: null,
      zoom: null,
    } as TimelineState;
    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      kind: 'manual',
      label: 'OPERATOR CONTROL',
    });
  });

  it('builds NEXT across midnight and excludes manual cues', () => {
    const first = day({
      cues: [
        cue('c_early', 'Already happened', '20:00'),
        cue('c_late', 'Late', '23:45'),
        cue('c_manual', 'Manual', null, { type: 'manual' }),
      ],
    });
    const second = day({
      date: '2026-08-25',
      weekday: 'TUESDAY',
      index: 1,
      cues: [cue('c_dawn', 'Dawn', '00:15')],
    });

    expect(upcomingTimelineCues(overview([first, second]), 'working', first.date, '23:00', 4)
      .map((item) => [item.cue.id, item.relativeDay])).toEqual([
      ['c_late', 0],
      ['c_dawn', 1],
    ]);
  });

  it('labels NEXT rows in the WORKING frame: tonight, then the same night morning', () => {
    const first = day({ cues: [cue('c_late', 'Late', '23:45')] });
    const second = day({
      date: '2026-08-25', weekday: 'TUESDAY', index: 1,
      cues: [cue('c_dawn', 'Dawn', '00:15'), cue('c_next_night', 'Next night', '19:14')],
    });
    expect(upcomingTimelineCues(overview([first, second]), 'working', first.date, '23:00', 4)
      .map((item) => item.rowLabel)).toEqual([
      'TONIGHT 11:45 PM',
      'TUE 12:15 AM',
      'TOMORROW NIGHT 7:14 PM',
    ]);
  });

  it('labels NEXT rows in the CALENDAR frame by today / weekday', () => {
    const first = day({ cues: [cue('c_late', 'Late', '23:45')] });
    const second = day({
      date: '2026-08-25', weekday: 'TUESDAY', index: 1,
      cues: [cue('c_dawn', 'Dawn', '00:15')],
    });
    expect(upcomingTimelineCues(overview([first, second]), 'regular', first.date, '23:00', 4)
      .map((item) => item.rowLabel)).toEqual([
      'TODAY 11:45 PM',
      'TUE 12:15 AM',
    ]);
  });

  it('never says TONIGHT when now is outside the festival (T-07)', () => {
    const first = day({ cues: [cue('c_late', 'Late', '23:45')] });
    expect(upcomingTimelineCues(overview([first]), 'working', '2026-07-04', '23:00', 4)
      .map((item) => item.rowLabel)).toEqual(['MON 11:45 PM']);
  });

  it('deduplicates recurring ON DEMAND cues', () => {
    const manual = cue('c_manual', 'Manual', null, { type: 'manual' });
    expect(manualTimelineCues(overview([
      day({ cues: [manual] }),
      day({ date: '2026-08-25', cues: [manual] }),
    ]))).toEqual([manual]);
  });

  it('lists timed cues for the selected Time Travel day in clock order', () => {
    const manual = cue('c_manual', 'Manual', null, { type: 'manual' });
    const late = cue('c_late', 'Late', '22:00');
    const early = cue('c_early', 'Early', '19:30');
    const live = overview([day({ cues: [late, manual, early] })]);

    expect(timelineTravelCuesForDay(live, 'working', live.days[0].date).map((item) => item.cue.id))
      .toEqual(['c_early', 'c_late']);
  });

  it('keeps next-calendar-day morning cues under the operator day where they were authored', () => {
    const saturday = day({
      date: '2026-08-22',
      weekday: 'SATURDAY',
      index: 0,
      cues: [cue('c_sat_night', 'Saturday night', '21:00')],
    });
    const sunday = day({
      date: '2026-08-23',
      weekday: 'SUNDAY',
      index: 1,
      cues: [
        cue('c_sat_morning', 'Saturday operator morning', '10:00'),
        cue('c_sun_night', 'Sunday night', '20:00'),
      ],
    });
    const live = overview([saturday, sunday]);

    expect(timelineTravelCuesForDay(live, 'working', saturday.date).map((entry) => [
      entry.cue.id,
      entry.operatorDate,
      entry.resolveDate,
    ])).toEqual([
      ['c_sat_night', '2026-08-22', '2026-08-22'],
      ['c_sat_morning', '2026-08-22', '2026-08-23'],
    ]);
    expect(timelineTravelCuesForDay(live, 'working', sunday.date).map((entry) => entry.cue.id))
      .toEqual(['c_sun_night']);
    expect(timelineTravelResolveDateForOperatorTime(live, 'working', saturday.date, '10:00'))
      .toBe('2026-08-23');
  });

  it('keeps every cue on its own calendar day in the CALENDAR frame', () => {
    const saturday = day({
      date: '2026-08-22', weekday: 'SATURDAY', index: 0,
      cues: [cue('c_sat_night', 'Saturday night', '21:00')],
    });
    const sunday = day({
      date: '2026-08-23', weekday: 'SUNDAY', index: 1,
      cues: [
        cue('c_sun_morning', 'Sunday morning', '10:00'),
        cue('c_sun_night', 'Sunday night', '20:00'),
      ],
    });
    const live = overview([saturday, sunday]);

    expect(timelineTravelCuesForDay(live, 'regular', saturday.date).map((e) => e.cue.id))
      .toEqual(['c_sat_night']);
    expect(timelineTravelCuesForDay(live, 'regular', sunday.date).map((e) => [
      e.cue.id, e.resolveDate,
    ])).toEqual([
      ['c_sun_morning', '2026-08-23'],
      ['c_sun_night', '2026-08-23'],
    ]);
    expect(timelineTravelResolveDateForOperatorTime(live, 'regular', saturday.date, '10:00'))
      .toBe('2026-08-22');
  });

  it('refuses to resolve a morning time past the last festival night', () => {
    const saturday = day({ date: '2026-08-22', weekday: 'SATURDAY', index: 0 });
    const live = overview([saturday]);
    expect(timelineTravelResolveDateForOperatorTime(live, 'working', saturday.date, '02:00'))
      .toBeNull();
    expect(timelineTravelResolveDateForOperatorTime(live, 'working', saturday.date, '20:00'))
      .toBe('2026-08-22');
  });

  it('labels the Time Travel day grid in the active frame', () => {
    const saturday = day({ date: '2026-08-22', weekday: 'SATURDAY', index: 0 });
    const sunday = day({ date: '2026-08-23', weekday: 'SUNDAY', index: 1 });
    const live = overview([saturday, sunday]);
    expect(timelineTravelDayLabel(live, 'working', 0)).toBe('N1 · SAT → SUN');
    expect(timelineTravelDayLabel(live, 'regular', 0)).toBe('D1 · SAT');
    expect(timelineTravelDayLabel(live, 'working', 5)).toBeNull();
  });

  it('shows the operator Party Window and hides its implementation cues everywhere', () => {
    const party = cue(
      'c_party',
      'Party 1',
      '20:00',
      {
        type: 'mood',
        from: 'calm',
        to: 'party',
        minDwellSec: 30,
        cooldownSec: 120,
        whenPhase: 'pw_c_party',
      },
    );
    const baseline = cue(
      'legacy_party_baseline',
      'Party Window baseline',
      null,
      { type: 'phase', phase: 'pw_c_party' },
    );
    const end = cue('pwe_c_party', 'Default after Party Window', '23:00');
    const live = overview([day({ cues: [end, baseline, party] })]);

    expect(timelineTravelCuesForDay(live, 'working', live.days[0].date).map((item) => item.cue.id))
      .toEqual(['c_party']);
    expect(upcomingTimelineCues(live, 'working', live.days[0].date, '19:00', 4)
      .map((item) => item.cue.id)).toEqual(['c_party']);
  });

  it('distinguishes a selected-but-dormant plan from a manual takeover', () => {
    const status = timelineLiveStatus({
      activePlan: 'test_week',
      planActive: false,
      controller: 'manual',
      autopilotEnabled: true,
      inFestivalWindow: false,
      festivalStartsInDays: 3,
      zoom: null,
    } as TimelineState);

    expect(status).toEqual({
      sentence: '“test_week” is the active plan, but it is DORMANT because its schedule starts in 3 days. The operator controls Deck output until the schedule is active.',
      tone: 'warning',
    });
  });

  it('uses manual-takeover wording only while an active plan can actually drive', () => {
    expect(timelineLiveStatus({
      activePlan: 'test_week',
      planActive: true,
      controller: 'manual',
      autopilotEnabled: true,
      inFestivalWindow: true,
      festivalStartsInDays: null,
      zoom: null,
    } as TimelineState).sentence).toBe(
      '“test_week” is the active plan and inside its schedule window, but an operator takeover controls Deck output; Timeline will resume when the lease ends or you press RESUME TIMELINE NOW.',
    );
  });

  it('does not call an in-window waiting plan dormant', () => {
    expect(timelineLiveStatus({
      activePlan: 'test_week',
      planActive: false,
      controller: 'manual',
      autopilotEnabled: true,
      inFestivalWindow: true,
      festivalStartsInDays: null,
      zoom: null,
    } as TimelineState).sentence).toBe(
      '“test_week” is the active plan and inside its schedule window, but an operator takeover controls Deck output; Timeline will resume when the lease ends or you press RESUME TIMELINE NOW.',
    );
  });

  it('identifies Timeline OFF before describing operator ownership', () => {
    expect(timelineLiveStatus({
      activePlan: 'test_week',
      planActive: false,
      controller: 'manual',
      autopilotEnabled: false,
      inFestivalWindow: true,
      festivalStartsInDays: null,
      zoom: null,
    } as TimelineState)).toEqual({
      sentence: '“test_week” is the active plan and inside its schedule window, but Timeline is OFF. The operator controls Deck output until you press RESUME TIMELINE NOW.',
      tone: 'danger',
    });
  });

  it('states the missing-plan prerequisite for Resume Autopilot', () => {
    expect(timelineLiveStatus({
      activePlan: null,
      controller: 'manual',
    } as TimelineState).sentence).toContain(
      'Activate a plan before resuming Timeline.',
    );
  });

  it('uses active truth only in LIVE and selected-plan truth in planning views', () => {
    const live = overview();
    const draft = { ...overview(), plan: 'draft_plan' };
    expect(overviewForTimelineView('live', live, draft)).toBe(live);
    expect(overviewForTimelineView('calendar', live, draft)).toBe(draft);
    expect(overviewForTimelineView('travel', live, draft)).toBe(draft);
    expect(overviewForTimelineView('edit', live, draft)).toBe(draft);
  });
});

// ── _356 P0-4: the engine's runtime deckOwner is the NOW card's authority ──
// The resolved ribbon cannot see phase-baseline cues, so while a Party Window
// baseline owned the deck the segment said "Default (from deck) 00:00→24:00"
// and the NOW card repeated it (F4). deckOwner now outranks the segment; the
// segment keeps its one real job — supplying a start/end time — but only when
// it is describing the SAME owner.

function deckOwner(
  overrides: Partial<NonNullable<TimelineState['deckOwner']>> = {},
): NonNullable<TimelineState['deckOwner']> {
  return {
    kind: 'cue',
    cueId: 'pwb',
    label: 'Party Window baseline',
    untilMs: null,
    ...overrides,
  };
}

describe('resolveTimelineNowOwner — runtime deck ownership (_356)', () => {
  it('the engine owner beats the resolved segment and is badged ENGINE OWNER', () => {
    const live = overview();
    const state = {
      controller: 'autopilot',
      activeProgram: null,
      activeCue: null,
      deckOwner: deckOwner(),
      nextCue: { id: 'pwe', label: 'Party Window end', inSec: 3600 },
    } as TimelineState;

    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      source: 'runtime-owner',
      kind: 'cue',
      label: 'Party Window baseline',
      cueId: 'pwb',
      sourceLabel: 'ENGINE OWNER',
    });
  });

  it('a segment about a DIFFERENT owner lends no time range — the next cue does', () => {
    const live = overview();   // segment owner is c_now, not pwb
    const state = {
      controller: 'autopilot',
      deckOwner: deckOwner(),
      nextCue: { id: 'pwe', label: 'Party Window end', inSec: 30 * 60 },
    } as TimelineState;

    const owner = resolveTimelineNowOwner(state, live, live.days[0], '20:30');
    expect(owner.fromLocal).toBeNull();
    expect(owner.toLocal).toBeNull();
    expect(owner.rangeLabel).toBe('until Party Window end 21:00');
  });

  it('a segment about the SAME cue supplies the real window', () => {
    const live = overview();
    const state = {
      controller: 'autopilot',
      deckOwner: deckOwner({ cueId: 'c_now', label: 'Now Cue' }),
      nextCue: { id: 'c_next', label: 'Next Cue', inSec: 1800 },
    } as TimelineState;

    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      source: 'runtime-owner',
      fromLocal: '20:00',
      toLocal: '21:00',
      rangeLabel: '20:00–21:00',
      playlist: 'c_now_playlist',
      palette: 'c_now_palette',
    });
  });

  it('two defaultCue owners match even though both carry a null cueId', () => {
    const live = overview([day({
      segments: [segment({
        owner: { kind: 'defaultCue', cueId: null, label: 'Default (from deck)' },
        source: 'default-cue',
      })],
    })]);
    const state = {
      controller: 'autopilot',
      deckOwner: deckOwner({ kind: 'defaultCue', cueId: null, label: 'Default (from deck)' }),
    } as TimelineState;

    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      kind: 'defaultCue',
      fromLocal: '20:00',
      toLocal: '21:00',
    });
  });

  it('with no next cue it claims no range at all rather than inventing an end', () => {
    const live = overview();
    const state = { controller: 'autopilot', deckOwner: deckOwner(), nextCue: null } as TimelineState;
    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30').rangeLabel).toBeNull();
  });

  it('a running program and an operator takeover still outrank deckOwner', () => {
    const live = overview();
    const program = {
      activeProgram: { cueId: 'c_show', startedAtMs: 0, untilMs: null },
      activeCue: { id: 'c_show', label: 'Main Show', kind: 'program', untilMs: null },
      deckOwner: deckOwner(),
    } as TimelineState;
    expect(resolveTimelineNowOwner(program, live, live.days[0], '20:30')).toMatchObject({
      kind: 'program', label: 'Main Show',
    });

    const manual = {
      controller: 'manual',
      activeCue: null,
      activeProgram: null,
      zoom: null,
      deckOwner: deckOwner(),
    } as TimelineState;
    expect(resolveTimelineNowOwner(manual, live, live.days[0], '20:30')).toMatchObject({
      kind: 'manual', label: 'OPERATOR CONTROL',
    });
  });

  it('an engine with no deckOwner still resolves from the ribbon as before', () => {
    const live = overview();
    const state = { controller: 'autopilot', activeCue: null, activeProgram: null } as TimelineState;
    expect(resolveTimelineNowOwner(state, live, live.days[0], '20:30')).toMatchObject({
      source: 'resolved-segment',
      sourceLabel: 'RESOLVED PLAN OWNER',
      rangeLabel: '20:00–21:00',
    });
  });

  it('names owner kinds in operator words', () => {
    expect(timelineOwnerKindLabel('defaultCue')).toBe('DEFAULT CUE');
    expect(timelineOwnerKindLabel('baseline')).toBe('BASELINE');
  });
});

describe('timelineLiveStatus — the banner names the same owner as the NOW card (_356 F7)', () => {
  it('names the engine deckOwner and drops the word autopilot', () => {
    const status = timelineLiveStatus({
      activePlan: 'test_week',
      planActive: true,
      controller: 'autopilot',
      autopilotEnabled: true,
      inFestivalWindow: true,
      festivalStartsInDays: null,
      zoom: null,
      deckOwner: deckOwner(),
    } as TimelineState);

    expect(status).toEqual({
      sentence: '“test_week” is the active plan and inside its schedule window; the Timeline is driving the deck — now: Party Window baseline.',
      tone: 'primary',
    });
    expect(status.sentence).not.toMatch(/autopilot/i);
  });

  it('an engine that sends no owner simply does not name one', () => {
    expect(timelineLiveStatus({
      activePlan: 'test_week',
      planActive: true,
      controller: 'autopilot',
      autopilotEnabled: true,
      inFestivalWindow: true,
      festivalStartsInDays: null,
      zoom: null,
    } as TimelineState).sentence).toBe(
      '“test_week” is the active plan and inside its schedule window; the Timeline is driving the deck.',
    );
  });
});
