import type {
  OverviewCue as TimelineCueWire,
  OverviewDay as TimelineDayOverview,
  TimelineOverview,
  OverviewSegment as TimelineResolvedSegment,
  TimelineState,
} from './timelineApi';
import { isPartyWindowImplementationCue } from '../components/timeline/party_window_logic';
import {
  frameClock12h,
  frameCueEntries,
  frameHeader,
  frameIndexForInstant,
  frameSpan,
  frameTravelResolveDate,
  frameWeekday,
  type DayFrame,
} from '../components/timeline/day_frame_logic';

export type TimelineOperatorView = 'live' | 'calendar' | 'travel' | 'edit';

export interface TimelineNowOwner {
  source: 'resolved-segment' | 'active-cue' | 'runtime-owner' | 'baseline';
  kind: 'program' | 'cue' | 'defaultCue' | 'manual' | 'baseline';
  label: string;
  cueId: string | null;
  playlist: string | null;
  palette: string | null;
  fromLocal: string | null;
  toLocal: string | null;
  /**
   * Operator copy for the provenance badge on the NOW card. The ENGINE's own
   * `deckOwner` reads "ENGINE OWNER"; the resolved ribbon's guess still reads
   * "RESOLVED PLAN OWNER" so the two can never be confused (_356 F4).
   */
  sourceLabel: string;
  /**
   * The window line under the title. `"HH:MM–HH:MM"` only when a resolved
   * segment genuinely describes THIS owner; otherwise the engine's next-cue
   * countdown ("until Party Window end 09:00"), or null when neither is known.
   */
  rangeLabel: string | null;
}

const OWNER_KIND_LABEL: Record<TimelineNowOwner['kind'], string> = {
  program: 'PROGRAM',
  cue: 'CUE',
  defaultCue: 'DEFAULT CUE',
  manual: 'MANUAL',
  baseline: 'BASELINE',
};

/** Eyebrow copy for an owner kind ("NOW · DEFAULT CUE"). */
export function timelineOwnerKindLabel(kind: TimelineNowOwner['kind']): string {
  return OWNER_KIND_LABEL[kind];
}

export interface TimelineNextCue {
  cue: TimelineCueWire;
  date: string;
  dayLabel: string;
  time: string;
  relativeDay: number;
  /**
   * The row's operator-facing label in the ACTIVE FRAME (_359 §D.7):
   * "TONIGHT 11:30 PM" / "MON 2:00 AM" / "TOMORROW NIGHT 7:14 PM" (working),
   * "TODAY 7:14 PM" / "MON 7:14 PM" (regular). Never says TONIGHT or TODAY
   * when NOW is outside the festival — T-07, no fake today.
   */
  rowLabel: string;
}

export interface TimelineTravelCue {
  cue: TimelineCueWire;
  /** The frame span the operator picked, named by its OPENING calendar date. */
  operatorDate: string;
  /** Calendar date the engine must use to resolve this cue's actual fire. */
  resolveDate: string;
  /** The row's label in the active frame ("MON 2:00 AM"). */
  rowLabel: string;
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

function rangeFromSegment(segment: TimelineResolvedSegment | null): string | null {
  if (!segment) return null;
  return `${segment.fromLocal}–${segment.toLocal}`;
}

/**
 * "until {label} {HH:MM}" from the engine's own next-cue countdown. The clock
 * time is `nowLocal + inSec` in the plan tz (the same clock the playhead uses),
 * so it never contradicts the countdown next to it. Null when the engine has no
 * next cue — we say nothing rather than inventing an end time.
 */
function rangeUntilNextCue(state: TimelineState | null, nowLocal: string): string | null {
  const next = state?.nextCue;
  if (!next || typeof next.inSec !== 'number' || !Number.isFinite(next.inSec)) return null;
  const now = localMinutes(nowLocal);
  if (now === null) return null;
  const at = (((now + Math.round(next.inSec / 60)) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(at / 60)).padStart(2, '0');
  const mm = String(at % 60).padStart(2, '0');
  return `until ${next.label} ${hh}:${mm}`;
}

/**
 * True when a resolved ribbon segment is describing the SAME thing the engine
 * says owns the deck. Only then may the segment lend its time range to the NOW
 * card. Two defaultCue owners match even though both carry a null cueId; a
 * cue-vs-defaultCue pair never does (_356 §4: the ribbon may supply the RANGE,
 * never the OWNER).
 */
function segmentDescribesOwner(
  segment: TimelineResolvedSegment | null,
  owner: NonNullable<TimelineState['deckOwner']>,
): boolean {
  if (!segment) return false;
  const segmentOwner = segment.owner;
  if (!segmentOwner) return false;
  if (segmentOwner.kind === 'defaultCue' && owner.kind === 'defaultCue') return true;
  return segmentOwner.cueId !== null && segmentOwner.cueId === owner.cueId;
}

/**
 * Resolve the large NOW card from engine authority. Precedence (_356 §2/§4):
 * running program → operator manual → the engine's runtime `deckOwner` → the
 * resolved overview segment → the plan baseline.
 *
 * `deckOwner` outranks the ribbon because the ribbon's resolver cannot see
 * phase-baseline cues: while a Party Window baseline owned the deck the ribbon
 * cheerfully rendered "Default (from deck) 00:00→24:00" and the NOW card
 * repeated it (_356 F4). The segment is still useful — it is the only place a
 * real start/end time exists — so it lends its RANGE whenever it is talking
 * about the same owner.
 */
export function resolveTimelineNowOwner(
  state: TimelineState | null,
  liveOverview: TimelineOverview | null,
  today: TimelineDayOverview | null,
  nowLocal: string,
): TimelineNowOwner {
  const currentSegment = currentResolvedSegment(today, nowLocal);
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
      sourceLabel: 'RUNTIME OWNER',
      rangeLabel: rangeFromSegment(currentSegment),
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
      sourceLabel: 'RUNTIME OWNER',
      rangeLabel: null,
    };
  }

  const deckOwner = state?.deckOwner;
  if (deckOwner) {
    const matched = segmentDescribesOwner(currentSegment, deckOwner) ? currentSegment : null;
    const cue = deckOwner.cueId ? cueById(liveOverview, deckOwner.cueId) : null;
    return {
      source: 'runtime-owner',
      kind: deckOwner.kind,
      label: deckOwner.label,
      cueId: deckOwner.cueId,
      playlist: matched ? matched.playlist : cuePlaylist(cue),
      palette: matched ? matched.palette : cuePalette(cue),
      fromLocal: matched ? matched.fromLocal : null,
      toLocal: matched ? matched.toLocal : null,
      sourceLabel: 'ENGINE OWNER',
      rangeLabel: matched ? rangeFromSegment(matched) : rangeUntilNextCue(state, nowLocal),
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
      sourceLabel: 'RESOLVED PLAN OWNER',
      rangeLabel: rangeFromSegment(currentSegment),
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
      sourceLabel: 'RUNTIME OWNER',
      rangeLabel: rangeUntilNextCue(state, nowLocal),
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
    sourceLabel: 'RESOLVED PLAN OWNER',
    rangeLabel: null,
  };
}

/**
 * The LIVE NEXT row label in the active frame (_359 §D.7). `nowIndex` is the
 * frame span NOW sits in, or null when NOW is outside every span — in which
 * case the row never claims TONIGHT / TODAY (T-07: no fake today).
 */
function nextCueRowLabel(args: {
  frame: DayFrame;
  cueIndex: number | null;
  nowIndex: number | null;
  cueDate: string;
  todayDate: string | null;
  minutes: number;
}): string {
  const { frame, cueIndex, nowIndex, cueDate, todayDate, minutes } = args;
  const clock = frameClock12h(minutes);
  const weekday = frameWeekday(cueDate);
  if (nowIndex === null || cueIndex === null) return `${weekday} ${clock}`;
  if (frame === 'regular') {
    return cueDate === todayDate ? `TODAY ${clock}` : `${weekday} ${clock}`;
  }
  if (cueIndex === nowIndex) {
    return cueDate === todayDate ? `TONIGHT ${clock}` : `${weekday} ${clock}`;
  }
  if (cueIndex === nowIndex + 1) return `TOMORROW NIGHT ${clock}`;
  return `NIGHT ${cueIndex + 1} · ${weekday} ${clock}`;
}

export function upcomingTimelineCues(
  overview: TimelineOverview | null,
  frame: DayFrame,
  todayDate: string | null,
  nowLocal: string,
  limit = 4,
): TimelineNextCue[] {
  if (!overview || limit <= 0) return [];
  const todayIndex = todayDate
    ? overview.days.findIndex((day) => day.date === todayDate)
    : 0;
  const startIndex = Math.max(0, todayIndex);
  const nowMinutes = localMinutes(nowLocal);
  const now = nowMinutes ?? 0;
  // Only a date the overview actually holds can be "now" — an off-festival
  // clock gets plain weekday labels rather than an invented TONIGHT (T-07).
  const nowIndex = todayIndex >= 0
    ? frameIndexForInstant(frame, overview.days, todayDate, nowMinutes)
    : null;
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
      const minutes = localMinutes(cue.atLocal);
      result.push({
        cue,
        date: day.date,
        dayLabel: day.weekday,
        time: cue.atLocal || '—',
        relativeDay,
        rowLabel: minutes === null
          ? (cue.atLocal || '—')
          : nextCueRowLabel({
            frame,
            cueIndex: frameIndexForInstant(frame, overview.days, day.date, minutes),
            nowIndex,
            cueDate: day.date,
            todayDate,
            minutes,
          }),
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

/**
 * The cues the operator can time-travel to on ONE frame span, in span order
 * (_359 §D.5). The span is named by its OPENING calendar date, which is what
 * the day grid's buttons carry. The 18:00 boundary is not repeated here — the
 * frame model owns it, so the working and calendar frames cannot disagree.
 */
export function timelineTravelCuesForDay(
  overview: TimelineOverview | null,
  frame: DayFrame,
  date: string | null,
): TimelineTravelCue[] {
  if (!overview || !date) return [];
  const index = overview.days.findIndex((candidate) => candidate.date === date);
  if (index < 0) return [];
  const span = frameSpan(frame, overview.days, index);
  return frameCueEntries(span)
    .filter((entry) => entry.timing === 'plotted' && entry.cue.trigger.type !== 'manual')
    .map((entry) => {
      const minutes = localMinutes(entry.cue.atLocal);
      return {
        cue: entry.cue,
        operatorDate: date,
        resolveDate: entry.date,
        rowLabel: minutes === null
          ? (entry.cue.atLocal || '—')
          : (frame === 'working'
            ? `${entry.weekday} ${frameClock12h(minutes)}`
            : frameClock12h(minutes)),
      };
    });
}

/** The day-grid button label for one frame span ("N1 · SUN → MON" / "D1 · SUN"). */
export function timelineTravelDayLabel(
  overview: TimelineOverview | null,
  frame: DayFrame,
  index: number,
): string | null {
  if (!overview || index < 0 || index > overview.days.length - 1) return null;
  return frameHeader(frameSpan(frame, overview.days, index)).cardTitle;
}

export function timelineTravelResolveDateForOperatorTime(
  overview: TimelineOverview | null,
  frame: DayFrame,
  operatorDate: string | null,
  time: string,
): string | null {
  if (!overview || !operatorDate) return null;
  const index = overview.days.findIndex((day) => day.date === operatorDate);
  if (index < 0) return null;
  return frameTravelResolveDate(frame, overview.days, index, time);
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

  // _356 F7: the banner and the NOW card must name the SAME thing. "autopilot"
  // is an engine word the operator never sees anywhere else, and the old
  // sentence named no owner at all while the card showed one — so the two read
  // as two different claims. Name the engine's own deckOwner when it sends one.
  const owner = state.deckOwner ? ` — now: ${state.deckOwner.label}` : '';
  return {
    sentence: `${plan} and ${schedule}; the Timeline is driving the deck${owner}.`,
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
