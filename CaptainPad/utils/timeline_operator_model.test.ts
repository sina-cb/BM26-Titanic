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
  timelineTravelCuesForDay,
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

    expect(upcomingTimelineCues(overview([first, second]), first.date, '23:00', 4)
      .map((item) => [item.cue.id, item.relativeDay])).toEqual([
      ['c_late', 0],
      ['c_dawn', 1],
    ]);
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

    expect(timelineTravelCuesForDay(live, live.days[0].date).map((item) => item.cue.id))
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

    expect(timelineTravelCuesForDay(live, saturday.date).map((entry) => [
      entry.cue.id,
      entry.operatorDate,
      entry.resolveDate,
    ])).toEqual([
      ['c_sat_night', '2026-08-22', '2026-08-22'],
      ['c_sat_morning', '2026-08-22', '2026-08-23'],
    ]);
    expect(timelineTravelCuesForDay(live, sunday.date).map((entry) => entry.cue.id))
      .toEqual(['c_sun_night']);
    expect(timelineTravelResolveDateForOperatorTime(live, saturday.date, '10:00'))
      .toBe('2026-08-23');
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

    expect(timelineTravelCuesForDay(live, live.days[0].date).map((item) => item.cue.id))
      .toEqual(['c_party']);
    expect(upcomingTimelineCues(live, live.days[0].date, '19:00', 4)
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
