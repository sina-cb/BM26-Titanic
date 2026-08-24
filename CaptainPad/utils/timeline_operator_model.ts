import type {
  OverviewCue as TimelineCueWire,
  OverviewDay as TimelineDayOverview,
  TimelineOverview,
  OverviewSegment as TimelineResolvedSegment,
  TimelineState,
} from './timelineApi';
import { isPartyWindowImplementationCue } from '../components/timeline/party_window_logic';

export type TimelineOperatorView = 'live' | 'calendar' | 'travel' | 'edit';

export interface TimelineNowOwner {
  source: 'resolved-segment' | 'active-cue' | 'baseline';
  kind: 'program' | 'cue' | 'manual' | 'baseline';
  label: string;
  cueId: string | null;
  playlist: string | null;
  palette: string | null;
  fromLocal: string | null;
  toLocal: string | null;
}

export interface TimelineNextCue {
  cue: TimelineCueWire;
  date: string;
  dayLabel: string;
  time: string;
  relativeDay: number;
}

export interface TimelineTravelCue {
  cue: TimelineCueWire;
  /** Operator-day button selected in Time Travel (6 PM → following 6 PM). */
  operatorDate: string;
  /** Calendar date the engine must use to resolve this cue's actual fire. */
  resolveDate: string;
}

export interface TimelineLiveStatus {
  sentence: string;
  tone: 'primary' | 'warning' | 'danger';
}

function localMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)
      || hour < 0 || hour > 24 || minute < 0 || minute > 59
      || (hour === 24 && minute !== 0)) {
    return null;
  }
  return (hour * 60) + minute;
}

function cuePlaylist(cue: TimelineCueWire | null | undefined): string | null {
  const action = cue?.action;
  if (!action) return null;
  if (action.type === 'playlist') return action.name;
  if (action.type === 'look') return action.look;
  return null;
}

function cuePalette(cue: TimelineCueWire | null | undefined): string | null {
  const action = cue?.action;
  return action?.type === 'playlist' && typeof action.palette === 'string'
    ? action.palette
    : null;
}

function cueById(overview: TimelineOverview | null, cueId: string): TimelineCueWire | null {
  if (!overview) return null;
  for (const day of overview.days) {
    const cue = day.cues.find((candidate) => candidate.id === cueId);
    if (cue) return cue;
  }
  return null;
}

function segmentCueId(segment: TimelineResolvedSegment): string | null {
  return segment.owner?.cueId ?? null;
}

export function currentResolvedSegment(
  day: TimelineDayOverview | null,
  nowLocal: string,
): TimelineResolvedSegment | null {
  if (!day) return null;
  const now = localMinutes(nowLocal);
  if (now === null) return null;
  return (day.segments || []).find((segment) => {
    const from = localMinutes(segment.fromLocal);
    const to = localMinutes(segment.toLocal);
    return from !== null && to !== null && now >= from && now < to;
  }) ?? null;
}

/**
 * Resolve the large NOW card from engine authority. Runtime ownership wins;
 * otherwise the current resolved overview segment wins. `activeCue` is never
 * used as the sole source when a resolved segment is available.
 */
export function resolveTimelineNowOwner(
  state: TimelineState | null,
  liveOverview: TimelineOverview | null,
  today: TimelineDayOverview | null,
  nowLocal: string,
): TimelineNowOwner {
  const currentSegment = currentResolvedSegment(today, nowLocal);
  const activeCueId = state?.activeCue?.id ?? null;
  const segmentOwnerId = currentSegment ? segmentCueId(currentSegment) : null;

  if (state?.activeProgram && state.activeCue) {
    const cue = cueById(liveOverview, state.activeCue.id);
    return {
      source: 'active-cue',
      kind: 'program',
      label: state.activeCue.label,
      cueId: state.activeCue.id,
      playlist: cuePlaylist(cue),
      palette: cuePalette(cue),
      fromLocal: currentSegment?.fromLocal ?? null,
      toLocal: currentSegment?.toLocal ?? null,
    };
  }

  if (state?.controller === 'manual') {
    const cue = state.activeCue ? cueById(liveOverview, state.activeCue.id) : null;
    return {
      source: state.activeCue ? 'active-cue' : 'baseline',
      kind: 'manual',
      label: state.zoom?.scope === 'travel'
        ? `TIME TRAVEL · ${state.zoom.targetLocal || 'SNAPSHOT'}`
        : state.activeCue?.label || 'OPERATOR CONTROL',
      cueId: state.activeCue?.id ?? null,
      playlist: cuePlaylist(cue),
      palette: cuePalette(cue),
      fromLocal: null,
      toLocal: null,
    };
  }

  if (currentSegment) {
    const cue = segmentOwnerId ? cueById(liveOverview, segmentOwnerId) : null;
    return {
      source: 'resolved-segment',
      kind: currentSegment.source === 'cue' || segmentOwnerId ? 'cue' : 'baseline',
      label: currentSegment.owner?.label || cue?.label || 'AUTOPILOT BASELINE',
      cueId: segmentOwnerId,
      playlist: currentSegment.playlist,
      palette: currentSegment.palette,
      fromLocal: currentSegment.fromLocal,
      toLocal: currentSegment.toLocal,
    };
  }

  if (state?.activeCue) {
    const cue = cueById(liveOverview, state.activeCue.id);
    return {
      source: 'active-cue',
      kind: 'cue',
      label: state.activeCue.label,
      cueId: state.activeCue.id,
      playlist: cuePlaylist(cue),
      palette: cuePalette(cue),
      fromLocal: null,
      toLocal: null,
    };
  }

  return {
    source: 'baseline',
    kind: 'baseline',
    label: 'AUTOPILOT BASELINE',
    cueId: null,
    playlist: null,
    palette: null,
    fromLocal: null,
    toLocal: null,
  };
}

export function upcomingTimelineCues(
  overview: TimelineOverview | null,
  todayDate: string | null,
  nowLocal: string,
  limit = 4,
): TimelineNextCue[] {
  if (!overview || limit <= 0) return [];
  const todayIndex = todayDate
    ? overview.days.findIndex((day) => day.date === todayDate)
    : 0;
  const startIndex = Math.max(0, todayIndex);
  const now = localMinutes(nowLocal) ?? 0;
  const result: TimelineNextCue[] = [];

  for (let index = startIndex; index < overview.days.length && result.length < limit; index += 1) {
    const day = overview.days[index];
    const relativeDay = index - startIndex;
    const cues = day.cues
      .filter((cue) => !isPartyWindowImplementationCue(cue, day.cues))
      .filter((cue) => cue.trigger?.type !== 'manual' && typeof cue.atLocal === 'string')
      .filter((cue) => relativeDay > 0 || (localMinutes(cue.atLocal) ?? -1) > now)
      .sort((left, right) => (localMinutes(left.atLocal) ?? 0) - (localMinutes(right.atLocal) ?? 0));
    for (const cue of cues) {
      result.push({
        cue,
        date: day.date,
        dayLabel: day.weekday,
        time: cue.atLocal || '—',
        relativeDay,
      });
      if (result.length >= limit) break;
    }
  }
  return result;
}

export function manualTimelineCues(overview: TimelineOverview | null): TimelineCueWire[] {
  if (!overview) return [];
  const seen = new Set<string>();
  const cues: TimelineCueWire[] = [];
  for (const day of overview.days) {
    for (const cue of day.cues) {
      if (isPartyWindowImplementationCue(cue, day.cues)
          || cue.trigger?.type !== 'manual'
          || seen.has(cue.id)) continue;
      seen.add(cue.id);
      cues.push(cue);
    }
  }
  return cues;
}

export function timelineTravelCuesForDay(
  overview: TimelineOverview | null,
  date: string | null,
): TimelineTravelCue[] {
  if (!overview || !date) return [];
  const dayPosition = overview.days.findIndex((candidate) => candidate.date === date);
  const day = dayPosition >= 0 ? overview.days[dayPosition] : null;
  if (!day) return [];
  const nextDay = overview.days[dayPosition + 1] ?? null;
  const entries: TimelineTravelCue[] = [];
  const add = (
    sourceDay: TimelineDayOverview,
    include: (minutes: number) => boolean,
  ) => {
    for (const cue of sourceDay.cues) {
      if (isPartyWindowImplementationCue(cue, sourceDay.cues)
          || cue.trigger.type === 'manual') continue;
      const minutes = localMinutes(cue.atLocal);
      if (minutes === null || !include(minutes)) continue;
      entries.push({
        cue,
        operatorDate: day.date,
        resolveDate: sourceDay.date,
      });
    }
  };
  // Operator day D is 6 PM on D through 5:59 PM on D+1. This inverse
  // projection keeps a cue authored on Saturday morning under SATURDAY even
  // though its engine wire day is Sunday.
  add(day, (minutes) => minutes >= 18 * 60);
  if (nextDay) add(nextDay, (minutes) => minutes < 18 * 60);
  return entries.sort((left, right) => {
    const leftMinutes = localMinutes(left.cue.atLocal) ?? 0;
    const rightMinutes = localMinutes(right.cue.atLocal) ?? 0;
    const leftOffset = leftMinutes >= 18 * 60 ? leftMinutes : leftMinutes + 24 * 60;
    const rightOffset = rightMinutes >= 18 * 60 ? rightMinutes : rightMinutes + 24 * 60;
    return leftOffset - rightOffset;
  });
}

export function timelineTravelResolveDateForOperatorTime(
  overview: TimelineOverview | null,
  operatorDate: string | null,
  time: string,
): string | null {
  if (!overview || !operatorDate) return null;
  const dayPosition = overview.days.findIndex((day) => day.date === operatorDate);
  if (dayPosition < 0) return null;
  const minutes = localMinutes(time);
  if (minutes === null) return null;
  if (minutes >= 18 * 60) return overview.days[dayPosition].date;
  return overview.days[dayPosition + 1]?.date ?? null;
}

export function timelineLiveStatus(state: TimelineState | null): TimelineLiveStatus {
  if (!state) {
    return {
      sentence: 'Waiting for authoritative Timeline status.',
      tone: 'warning',
    };
  }

  if (!state.activePlan) {
    return {
      sentence: state.controller === 'manual'
        ? 'No live plan is active; the operator controls Deck output. Activate a plan before resuming Timeline.'
        : 'No live plan is active, so Timeline has no schedule to run.',
      tone: 'danger',
    };
  }

  const plan = `“${state.activePlan}” is the active plan`;
  const schedule = state.inFestivalWindow
    ? 'inside its schedule window'
    : typeof state.festivalStartsInDays === 'number'
      ? `starts in ${state.festivalStartsInDays} ${state.festivalStartsInDays === 1 ? 'day' : 'days'}`
      : 'outside its schedule window';

  // Festival-window authority is independent of current deck ownership.
  // `planActive:false` can also mean an in-window plan is waiting/manual, so
  // never translate that flag alone into "outside its schedule".
  if (state.inFestivalWindow === false) {
    const dormantReason = typeof state.festivalStartsInDays === 'number'
      ? `its schedule starts in ${state.festivalStartsInDays} ${state.festivalStartsInDays === 1 ? 'day' : 'days'}`
      : 'today is outside its schedule window';
    return {
      sentence: `${plan}, but it is DORMANT because ${dormantReason}. The operator controls Deck output until the schedule is active.`,
      tone: 'warning',
    };
  }

  if (state.zoom?.scope === 'travel') {
    return {
      sentence: `${plan} and ${schedule}, but Time Travel controls the deck until RESUME LIVE.`,
      tone: 'warning',
    };
  }

  if (!state.autopilotEnabled) {
    return {
      sentence: `${plan} and ${schedule}, but Timeline is OFF. The operator controls Deck output until you press RESUME TIMELINE NOW.`,
      tone: 'danger',
    };
  }

  if (state.controller === 'manual') {
    return {
      sentence: `${plan} and ${schedule}, but an operator takeover controls Deck output; Timeline will resume when the lease ends or you press RESUME TIMELINE NOW.`,
      tone: 'warning',
    };
  }

  if (state.planActive === false) {
    return {
      sentence: `${plan} and ${schedule}, but Timeline is not driving the deck yet.`,
      tone: 'warning',
    };
  }

  if (state.controller === 'program') {
    return {
      sentence: `${plan} and ${schedule}; its active program controls the deck now.`,
      tone: 'primary',
    };
  }

  return {
    sentence: `${plan} and ${schedule}; Timeline autopilot controls the deck now.`,
    tone: state.inFestivalWindow ? 'primary' : 'warning',
  };
}

export function overviewForTimelineView(
  view: TimelineOperatorView,
  liveOverview: TimelineOverview | null,
  draftOverview: TimelineOverview | null,
): TimelineOverview | null {
  return view === 'live' ? liveOverview : (draftOverview ?? liveOverview);
}
