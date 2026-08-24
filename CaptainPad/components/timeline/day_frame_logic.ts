/**
 * day_frame_logic — THE frame model (report _359 §B/§C.2).
 *
 * A **frame** is how the pad slices festival time. The engine never learns
 * about frames; it keeps emitting CALENDAR days (`festival.js`) and this module
 * is the single view transform over them:
 *
 *   regular  — Day k  = wire day k, 00:00 → 24:00
 *   working  — Night k = wire day k 18:00 → wire day k+1 18:00
 *
 * Everything the strip, the DAY view, the editor, LIVE NEXT and TIME TRAVEL
 * need about "which day is this cue on" flows through here, so the 18:00
 * boundary exists as ONE constant in ONE module (_359 §F).
 *
 * P0, restated from the design: nothing here fabricates. There is no Night −1
 * and no Night N; a morning half that falls outside the festival span is
 * reported as such (`nextDay === null`) and every function that cannot answer
 * returns `null` so its caller can print a sentence instead of a guess.
 *
 * Type-only imports (erased at build) keep this module free of the
 * RN-flavoured module graph `utils/timelineApi.ts` sits in — the same
 * discipline as `zoom_logic.ts` and `cue_edit_logic.ts`. For the same reason
 * the 12-hour clock formatter below is a local copy rather than an import from
 * `timelineTemplate.ts`, which pulls in `constants/theme`.
 */
import type {
  CueDays,
  CueTrigger,
  OverviewCue,
  OverviewDay,
  OverviewPhase,
  OverviewSun,
} from '../../utils/timelineApi';

import {
  allPhaseBands,
  DAY_MINUTES,
  localToMinutes,
  ribbonRows,
  type RibbonRow,
} from './zoom_logic';
import { isPartyWindowImplementationCue } from './party_window_logic';

export type DayFrame = 'working' | 'regular';

export const DAY_FRAMES: readonly DayFrame[] = ['working', 'regular'] as const;

/** The working day opens at 18:00 local. The ONE copy of this boundary. */
export const WORKING_DAY_START_MIN = 1080;

/** Tap resolution on a day chart — 15 minutes is the honest finger accuracy. */
export const FRAME_SNAP_MIN = 15;

/** Hour-label cadence on the day ruler. */
export const FRAME_HOUR_LABEL_STEP_MIN = 180;

/** Which half of a working day a moment sits in. */
export type FrameHalf = 'evening' | 'morning';

/**
 * The sun events that belong to a working day's MORNING half (C-06). A cue
 * authored "this night" against one of these fires on wire day k+1; the evening
 * events stay on k. The engine resolves them all on their own calendar day —
 * this list only decides WHICH calendar day the operator meant.
 */
export const MORNING_SUN_EVENTS: readonly string[] = [
  'sunrise', 'civilDawn', 'nauticalDawn', 'goldenHourEnd', 'solarNoon',
] as const;

export interface FrameSpan {
  frame: DayFrame;
  /** 0-based frame index. Displayed 1-based ("NIGHT 1"). */
  index: number;
  /** Total spans in this frame (= festival days). */
  count: number;
  /** Calendar date the span opens on. */
  startDate: string;
  /**
   * Calendar date the span's second half lives on — working only. `null` in the
   * regular frame, where a span never leaves its own date.
   */
  endDate: string | null;
  /** Minutes-of-day the span opens at: 1080 (working) or 0 (regular). */
  startMin: number;
  durationMin: 1440;
  day: OverviewDay;
  /** The overview day for `endDate`. `null` ⇒ the morning half is OUTSIDE the
   *  festival span — the chart tail is hatched and nothing can be scheduled
   *  there (the engine's `cueAppliesOn` is false for it). */
  nextDay: OverviewDay | null;
  /** The preceding overview day, for the regular frame's carried party piece. */
  prevDay: OverviewDay | null;
  /**
   * The plan's Party Window phase id, when any day names one. Phase bands with
   * this id (and any `pw_`-prefixed phase) are excluded from `framePhaseBands`:
   * the party band is drawn from `partyWindow` ALONE (C-03).
   */
  partyPhaseId: string | null;
}

export interface FrameSunMarker {
  id: 'sunset' | 'civilDusk' | 'sunrise' | 'civilDawn';
  offset: number;
  /** "SUNSET 7:45 PM" */
  label: string;
  /** "SUNSET 7:45P" — for the 64 px strip gutter. */
  shortLabel: string;
  /** The calendar date this event happens on. */
  date: string;
}

export interface FrameCueEntry {
  cue: OverviewCue;
  /** The calendar date the cue fires on. */
  date: string;
  /** Short weekday of `date` ("MON"). */
  weekday: string;
  offset: number | null;
  endOffset: number | null;
  timing: 'plotted' | 'lead-in' | 'manual';
}

export interface FramePartyBand {
  fromOffset: number;
  toOffset: number;
  /** "MON 9:00 AM → 5:00 PM" */
  label: string;
  /** Set on the second piece of a window split across two REGULAR days. */
  continuesFrom?: number;
}

export interface FramePhaseEntry {
  phase: OverviewPhase;
  key: string;
  order: number;
  fromOffset: number;
  toOffset: number;
}

export interface FrameRibbonEntry {
  row: RibbonRow;
  date: string;
  fromLocal: string;
  toLocal: string;
  fromOffset: number;
  toOffset: number;
}

export interface FrameHourLabel {
  offset: number;
  label: string;
  /** "MON" on the midnight line of a working day. */
  dateStamp?: string;
}

export type FrameNowStatus =
  | { kind: 'inside'; index: number }
  | { kind: 'before-first'; opensLabel: string }
  | { kind: 'after-last' }
  | { kind: 'off-festival' };

export type FrameAuthoringResult =
  | { wireDays: number[] }
  | { error: string };

// ── small pure helpers ──────────────────────────────────────────────────

/** Minutes-of-day → "2:14 PM". Local copy; see the module header. */
export function frameClock12h(mins: number): string {
  const norm = ((Math.round(mins) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hh24 = Math.floor(norm / 60);
  const mm = norm % 60;
  const period = hh24 < 12 ? 'AM' : 'PM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${hh12}:${String(mm).padStart(2, '0')} ${period}`;
}

/** "7:45 PM" → "7:45P" for the narrow strip gutter. */
function shortClock12h(mins: number): string {
  return frameClock12h(mins).replace(' AM', 'A').replace(' PM', 'P');
}

function minutesToHHMM(mins: number): string {
  const norm = ((Math.round(mins) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' + n calendar days. Anchored at UTC noon so no tz shifts it. */
export function frameDateShift(dateKey: string, days: number): string {
  const at = new Date(`${dateKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Short weekday of a calendar date, UPPER CASE ("MON"). */
export function frameWeekday(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const at = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' })
    .format(at)
    .toUpperCase();
}

/** Title-case weekday ("Mon") for prose subtitles. */
function frameWeekdayTitle(dateKey: string): string {
  const upper = frameWeekday(dateKey);
  return upper.slice(0, 1) + upper.slice(1).toLowerCase();
}

/**
 * Position of `date` in the overview's calendar-day array, `days.length` when
 * it is the day immediately AFTER the last one (the working frame's last
 * morning half lives there), else null.
 */
function wirePositionForDate(days: OverviewDay[], date: string | null): number | null {
  if (!date || days.length === 0) return null;
  const found = days.findIndex((day) => day.date === date);
  if (found >= 0) return found;
  if (frameDateShift(days[days.length - 1].date, 1) === date) return days.length;
  return null;
}

function partyPhaseIdOf(days: OverviewDay[]): string | null {
  for (const day of days) {
    if (day.partyWindow) return day.partyWindow.phaseId;
  }
  return null;
}

function isPartyPhaseName(name: string, partyPhaseId: string | null): boolean {
  return name.startsWith('pw_') || (partyPhaseId !== null && name === partyPhaseId);
}

// ── the span ────────────────────────────────────────────────────────────

/**
 * Build the span for frame index `index`. THROWS on an index outside
 * `0..days.length-1` — asking for Night 0 or Night N is a programming error,
 * not a data condition (_359 §B).
 */
export function frameSpan(frame: DayFrame, days: OverviewDay[], index: number): FrameSpan {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('frameSpan: the overview has no festival days.');
  }
  if (!Number.isInteger(index) || index < 0 || index > days.length - 1) {
    throw new Error(
      `frameSpan: index ${index} is outside the festival span [0, ${days.length - 1}].`,
    );
  }
  const day = days[index];
  const partyPhaseId = partyPhaseIdOf(days);
  if (frame === 'regular') {
    return {
      frame,
      index,
      count: days.length,
      startDate: day.date,
      endDate: null,
      startMin: 0,
      durationMin: DAY_MINUTES,
      day,
      nextDay: null,
      prevDay: days[index - 1] ?? null,
      partyPhaseId,
    };
  }
  return {
    frame,
    index,
    count: days.length,
    startDate: day.date,
    endDate: frameDateShift(day.date, 1),
    startMin: WORKING_DAY_START_MIN,
    durationMin: DAY_MINUTES,
    day,
    nextDay: days[index + 1] ?? null,
    prevDay: days[index - 1] ?? null,
    partyPhaseId,
  };
}

/**
 * The frame index that contains the instant `(date, minute)`, or null when no
 * span does. §B's instant rule:
 *   regular → k = w
 *   working → k = w when minute ≥ 18:00, else k = w − 1
 * Null for a date outside the festival, for `k < 0` ("before NIGHT 1 opens"),
 * and for `w = N` with minute ≥ 18:00 (past the last night).
 */
export function frameIndexForInstant(
  frame: DayFrame,
  days: OverviewDay[],
  date: string | null,
  minute: number | null,
): number | null {
  if (minute === null || !Number.isFinite(minute)) return null;
  const w = wirePositionForDate(days, date);
  if (w === null) return null;
  const k = frame === 'regular'
    ? w
    : (minute >= WORKING_DAY_START_MIN ? w : w - 1);
  if (k < 0 || k > days.length - 1) return null;
  return k;
}

/**
 * Y position of `(date, minute)` inside `span`, in span minutes, or null when
 * the instant is outside it. Geometric: the exclusive 18:00 end boundary is a
 * CUE rule (see frameCueEntries), not a geometry rule — a band may legitimately
 * end at exactly `durationMin`.
 */
export function frameOffset(
  span: FrameSpan,
  date: string | null,
  minute: number | null,
): number | null {
  if (!date || minute === null || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > DAY_MINUTES) return null;
  if (span.frame === 'regular') {
    return date === span.startDate ? minute : null;
  }
  if (date === span.startDate) {
    // 24:00 on the opening date IS 00:00 on the next one.
    if (minute === DAY_MINUTES) return DAY_MINUTES - WORKING_DAY_START_MIN;
    return minute >= WORKING_DAY_START_MIN ? minute - WORKING_DAY_START_MIN : null;
  }
  if (date === span.endDate) {
    return minute <= WORKING_DAY_START_MIN
      ? (DAY_MINUTES - WORKING_DAY_START_MIN) + minute
      : null;
  }
  return null;
}

/**
 * A tap at `offset` px-minutes → the instant it names, snapped to `snapMin`.
 * Null in the HATCHED TAIL (the last night's morning half, which lies outside
 * the festival) — the caller opens nothing and shows the hint line.
 */
export function frameInstantAt(
  span: FrameSpan,
  offset: number,
  snapMin: number = FRAME_SNAP_MIN,
): { date: string; time: string } | null {
  if (!Number.isFinite(offset)) return null;
  if (!Number.isFinite(snapMin) || snapMin <= 0) return null;
  let snapped = Math.round(Math.max(0, Math.min(span.durationMin, offset)) / snapMin) * snapMin;
  if (snapped >= span.durationMin) snapped = Math.max(0, span.durationMin - snapMin);
  if (span.frame === 'regular') {
    return { date: span.startDate, time: minutesToHHMM(snapped) };
  }
  const untilMidnight = DAY_MINUTES - WORKING_DAY_START_MIN;
  if (snapped < untilMidnight) {
    return { date: span.startDate, time: minutesToHHMM(WORKING_DAY_START_MIN + snapped) };
  }
  if (!span.nextDay || !span.endDate) return null;
  return { date: span.endDate, time: minutesToHHMM(snapped - untilMidnight) };
}

/** Offset of a working span's midnight line, or null in the regular frame. */
export function frameMidnightOffset(span: FrameSpan): number | null {
  return span.frame === 'working' ? DAY_MINUTES - WORKING_DAY_START_MIN : null;
}

/**
 * Offset where the HATCHED "past the festival" tail begins — the LAST working
 * night's morning half, which lies on a date the festival does not cover. Null
 * whenever the whole span is inside the festival.
 */
export function frameHatchOffset(span: FrameSpan): number | null {
  if (span.frame !== 'working' || span.nextDay) return null;
  return DAY_MINUTES - WORKING_DAY_START_MIN;
}

/** Every hour boundary on the span (the chart's grid lines). */
export function frameHourOffsets(span: FrameSpan): number[] {
  const out: number[] = [];
  for (let offset = 0; offset <= span.durationMin; offset += 60) out.push(offset);
  return out;
}

/**
 * The LABELLED ruler ticks — every three hours. The working frame stamps the
 * weekday on its midnight line so the morning half is never mistaken for the
 * evening one (C-04).
 */
export function frameHourLabels(span: FrameSpan): FrameHourLabel[] {
  const out: FrameHourLabel[] = [];
  const midnight = span.frame === 'working' ? DAY_MINUTES - WORKING_DAY_START_MIN : null;
  for (let offset = 0; offset <= span.durationMin; offset += FRAME_HOUR_LABEL_STEP_MIN) {
    const entry: FrameHourLabel = {
      offset,
      label: frameClock12h(span.startMin + offset),
    };
    if (midnight !== null && offset === midnight && span.endDate) {
      entry.dateStamp = frameWeekday(span.endDate);
    }
    out.push(entry);
  }
  return out;
}

export interface FrameNowMarker {
  offset: number;
  /** "NOW 11:27 AM" */
  label: string;
  /** "NOW 11:27A" — for the 64 px strip gutter. */
  shortLabel: string;
  /**
   * True when NOW is geometrically INSIDE this span. False when the span merely
   * CARRIES the bar because no span holds NOW (see `frameNowCarriedOffset`):
   * the clock is real either way, the span it is drawn on is the nearest one.
   */
  inside: boolean;
}

/**
 * The position a span CARRIES the NOW bar at when NOW is inside no span at all
 * — the operator's rule (override of C-01): the red line is never absent, it is
 * drawn at the offset whose ruler label IS the current clock time. Each clock
 * time occurs exactly once in a 24 h frame, so the position is unambiguous.
 *
 * Only two spans can ever carry: the FIRST one, before the festival's first
 * night opens (working frame, day-0 morning), and the LAST one, once the
 * festival's last span has closed. Null everywhere else — including for a date
 * off the festival entirely, where nothing may be drawn (P0: no fabrication).
 */
function frameNowCarriedOffset(
  span: FrameSpan,
  nowDate: string | null,
  nowMin: number | null,
): number | null {
  if (!nowDate || nowMin === null || !Number.isFinite(nowMin)) return null;
  if (nowMin < 0 || nowMin >= DAY_MINUTES) return null;
  const isFirst = span.index === 0;
  const isLast = span.index === span.count - 1;
  if (span.frame === 'regular') {
    // The calendar day AFTER the festival's last one: the bar lands on that
    // last card, at its own clock position.
    return isLast && frameDateShift(span.startDate, 1) === nowDate ? nowMin : null;
  }
  // Working frame, before NIGHT 1 opens: 11:27 AM on the opening date is 17 h
  // 27 m into a 6 PM-anchored frame — between the 9 AM and 12 PM gridlines.
  if (isFirst && nowDate === span.startDate && nowMin < WORKING_DAY_START_MIN) {
    return nowMin + (DAY_MINUTES - WORKING_DAY_START_MIN);
  }
  // Working frame, past the last night's 6 PM close.
  if (isLast && nowDate === span.endDate && nowMin >= WORKING_DAY_START_MIN) {
    return nowMin - WORKING_DAY_START_MIN;
  }
  return null;
}

/**
 * The NOW bar's position + gutter pill on this span, or null when another span
 * owns it. Two ways a span can own the bar:
 *
 *   inside  — NOW falls geometrically within the span (the ordinary case);
 *   carried — NOW falls inside NO span of the frame, and this is the nearest
 *             span the strip shows, so the bar is drawn at the offset whose
 *             clock label matches NOW (`frameNowCarriedOffset`).
 *
 * Exactly one span of a frame can return non-null for a given instant — pinned
 * by a test — so the red line is never drawn twice.
 */
export function frameNowMarker(
  span: FrameSpan,
  nowDate: string | null,
  nowMin: number | null,
): FrameNowMarker | null {
  if (nowMin === null || !Number.isFinite(nowMin)) return null;
  const inside = frameOffset(span, nowDate, nowMin);
  const offset = inside !== null && inside < span.durationMin
    ? inside
    : frameNowCarriedOffset(span, nowDate, nowMin);
  if (offset === null) return null;
  return {
    offset,
    label: `NOW ${frameClock12h(nowMin)}`,
    shortLabel: `NOW ${shortClock12h(nowMin)}`,
    inside: inside !== null && inside < span.durationMin,
  };
}

/**
 * WHICH span of the frame draws the NOW bar — the index side of
 * `frameNowMarker`, for callers that hold the day array rather than a span.
 * Null only when NOW is off the festival entirely (or unknown).
 */
export function frameNowSpanIndex(
  frame: DayFrame,
  days: OverviewDay[],
  nowDate: string | null,
  nowMin: number | null,
): number | null {
  if (!Array.isArray(days) || days.length === 0) return null;
  const status = frameNowStatus(frame, days, nowDate, nowMin);
  if (status.kind === 'inside') return status.index;
  if (status.kind === 'before-first') return 0;
  if (status.kind === 'after-last') return days.length - 1;
  return null;
}

/**
 * WHERE is now, relative to the whole festival in this frame? The four kinds
 * are exhaustive, and each has its own sentence (see frameNowSentence) — the
 * pre-18:00 case on festival day 0 is exactly the one that used to make NOW
 * vanish from every surface (C-01).
 */
export function frameNowStatus(
  frame: DayFrame,
  days: OverviewDay[],
  nowDate: string | null,
  nowMin: number | null,
): FrameNowStatus {
  if (nowMin === null || !Number.isFinite(nowMin)) return { kind: 'off-festival' };
  const w = wirePositionForDate(days, nowDate);
  if (w === null) return { kind: 'off-festival' };
  const k = frame === 'regular'
    ? w
    : (nowMin >= WORKING_DAY_START_MIN ? w : w - 1);
  if (k < 0) {
    return { kind: 'before-first', opensLabel: frameClock12h(WORKING_DAY_START_MIN) };
  }
  if (k > days.length - 1) return { kind: 'after-last' };
  return { kind: 'inside', index: k };
}

/** Frame vocabulary: "NIGHT" / "DAY", singular, upper case. */
export function frameSpanWord(frame: DayFrame): string {
  return frame === 'working' ? 'NIGHT' : 'DAY';
}

/**
 * The one sentence a surface prints when NOW is not inside any span. Null when
 * it IS inside one — the red bar says it instead (C-01).
 *
 * The bar is now drawn in the not-inside cases too (see `frameNowMarker`); this
 * sentence stays as the WORDS for what the carried bar cannot say — that the
 * first night has not opened yet, or that the last one has closed.
 */
export function frameNowSentence(
  frame: DayFrame,
  days: OverviewDay[],
  nowDate: string | null,
  nowMin: number | null,
): string | null {
  const status = frameNowStatus(frame, days, nowDate, nowMin);
  if (status.kind === 'inside') return null;
  const clock = nowMin === null ? null : frameClock12h(nowMin);
  const word = frameSpanWord(frame);
  if (status.kind === 'before-first') {
    return `NOW ${clock} · before ${word} 1 opens at ${status.opensLabel}`;
  }
  if (status.kind === 'after-last') {
    return `NOW ${clock} · the festival's last ${word.toLowerCase()} has ended`;
  }
  return clock === null
    ? 'NOW is unknown — no plan timezone has been read yet.'
    : `NOW ${clock} · outside this plan's festival span`;
}

// ── sun bars ────────────────────────────────────────────────────────────

function sunMarker(
  id: FrameSunMarker['id'],
  text: string,
  value: string | null | undefined,
  date: string,
  span: FrameSpan,
): FrameSunMarker | null {
  const minute = localToMinutes(value);
  if (minute === null) return null;
  const offset = frameOffset(span, date, minute);
  if (offset === null) return null;
  return {
    id,
    offset,
    label: `${text} ${frameClock12h(minute)}`,
    shortLabel: `${text} ${shortClock12h(minute)}`,
    date,
  };
}

/**
 * SUNSET / DUSK / SUNRISE / DAWN for this span, in offset order.
 *
 * The working frame takes its MORNING pair from `day.nextSun` — the engine's
 * per-day next-date sun (_359 §C.3) — and NOT from `nextDay.sun`, because the
 * last night has no next overview day yet has a real sunrise. An engine that
 * predates that field simply yields no morning markers; `frameMissingSunNote`
 * is the sentence that says so.
 */
export function frameSunMarkers(span: FrameSpan): FrameSunMarker[] {
  const out: FrameSunMarker[] = [];
  const sun: OverviewSun | undefined = span.day.sun;
  const push = (m: FrameSunMarker | null) => { if (m) out.push(m); };
  if (span.frame === 'regular') {
    push(sunMarker('civilDawn', 'DAWN', sun?.civilDawn, span.startDate, span));
    push(sunMarker('sunrise', 'SUNRISE', sun?.sunrise, span.startDate, span));
    push(sunMarker('sunset', 'SUNSET', sun?.sunset, span.startDate, span));
    push(sunMarker('civilDusk', 'DUSK', sun?.civilDusk, span.startDate, span));
  } else {
    push(sunMarker('sunset', 'SUNSET', sun?.sunset, span.startDate, span));
    push(sunMarker('civilDusk', 'DUSK', sun?.civilDusk, span.startDate, span));
    if (span.endDate) {
      const next = span.day.nextSun;
      push(sunMarker('civilDawn', 'DAWN', next?.civilDawn, span.endDate, span));
      push(sunMarker('sunrise', 'SUNRISE', next?.sunrise, span.endDate, span));
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * The loud note for an engine that has not sent this span's sun data. Null when
 * every bar this frame needs is present. Never a silent gap.
 */
export function frameMissingSunNote(span: FrameSpan): string | null {
  if (span.frame === 'working' && span.day.nextSun === undefined) {
    return 'This engine has not sent next-day sun times — SUNRISE and DAWN cannot be '
      + 'drawn on the morning half. Restart the engine to pick up the working-day slice.';
  }
  if (span.day.sun?.civilDawn === undefined) {
    return 'This engine has not sent civil dawn — the DAWN bar is not drawn.';
  }
  return null;
}

// ── the gutter (D.2) ────────────────────────────────────────────────────

/**
 * Structural marker colours (_359 §D.2). FIXED hexes, like the existing phase
 * bands: a sun bar means "sunset", not "the theme accent". DUSK/DAWN are the
 * same two hues at 55 % alpha so the pair reads as one family. NOW is
 * deliberately absent — it stays on the palette's `C.error` so it re-themes.
 */
export const FRAME_SUN_COLORS: Record<FrameSunMarker['id'], string> = {
  sunset: '#5b6cf5',
  civilDusk: '#5b6cf58c',
  sunrise: '#ffd166',
  civilDawn: '#ffd1668c',
};

/**
 * The GUTTER TEXT colours. The BAR keeps its fixed hue in every theme — that
 * hue IS the marker's identity — but 11 pt `#ffd166` on the light palette's
 * near-white surface is unreadable (`.agent/os/ui_design.md`: AA or better).
 * On light we print the same hue darkened to an AA-safe value; on dark the bar
 * colour is already the right answer.
 */
const FRAME_SUN_LABEL_ON_LIGHT: Record<FrameSunMarker['id'], string> = {
  sunset: '#3b49c9',
  civilDusk: '#5561cf',
  sunrise: '#8a6100',
  civilDawn: '#9b7420',
};

export function frameSunLabelColor(
  id: FrameSunMarker['id'],
  scheme: 'light' | 'dark',
): string {
  return scheme === 'light' ? FRAME_SUN_LABEL_ON_LIGHT[id] : FRAME_SUN_COLORS[id];
}

/** The Party Window band colour (unchanged from the shipped calendars). */
export const FRAME_PARTY_COLOR = '#b56dff';

/**
 * The MIDNIGHT divider — the working frame's one date-changing gridline, and
 * the only hour line that is not the theme's hairline. A muted, desaturated
 * green: legible against both surfaces without competing with the red NOW bar
 * or the blue/amber sun bars. Fixed hex, like every other structural marker.
 */
export const FRAME_MIDNIGHT_COLOR = '#4a8f6d';

/**
 * The legend's rows, in order (_359 §D.2). ONE list, shared by the week strip
 * and the DAY chart, so a marker can never be drawn without an entry here.
 * `sun` ids line up 1:1 with `FrameSunMarker['id']` (pinned by a test).
 */
export type FrameLegendId =
  | 'now' | 'sunset' | 'sunrise' | 'duskDawn'
  | 'party' | 'program' | 'mood' | 'ambient';

export const FRAME_LEGEND_IDS: readonly FrameLegendId[] = [
  'now', 'sunset', 'sunrise', 'duskDawn', 'party', 'program', 'mood', 'ambient',
] as const;

/** A marker label owns this many pixels of gutter above and below itself. */
export const FRAME_GUTTER_CLAIM_PX = 14;
/** How far a colliding second label is pushed down. */
export const FRAME_GUTTER_STACK_PX = 16;

export interface FrameGutterLabel {
  key: string;
  /** Where the BAR is drawn. */
  y: number;
  /** Where the LABEL is drawn — `y` unless it had to stack. */
  labelY: number;
  text: string;
  kind: 'now' | 'sun' | 'hour';
  /** Present for `kind === 'sun'`. */
  id?: FrameSunMarker['id'];
  /** True when the label was pushed off its bar and needs a leader line. */
  stacked: boolean;
  /** The date-changing MIDNIGHT hour label — drawn in FRAME_MIDNIGHT_COLOR. */
  midnight?: boolean;
}

/**
 * Lay out the left gutter (_359 §D.2 collision rule).
 *
 *   • NOW is placed first and never moves — it always wins its slot.
 *   • A sun label that lands within ±14 px of an already-placed label stacks
 *     16 px lower and gets a leader line.
 *   • An HOUR label inside any placed marker's ±14 px claim is dropped: the
 *     structural marker is what the operator is reading at 3 am.
 */
export function frameGutterLabels(args: {
  sun: FrameSunMarker[];
  hours: FrameHourLabel[];
  now: { offset: number; label: string; shortLabel?: string } | null;
  height: number;
  durationMin: number;
  /** Use the narrow strip labels ("SUNSET 7:45P"). */
  short?: boolean;
}): FrameGutterLabel[] {
  const { sun, hours, now, height, durationMin } = args;
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(durationMin) || durationMin <= 0) {
    return [];
  }
  const yFor = (offset: number) => (Math.max(0, Math.min(durationMin, offset)) / durationMin) * height;
  const placed: FrameGutterLabel[] = [];
  const claimFree = (candidate: number) =>
    !placed.some((p) => Math.abs(p.labelY - candidate) < FRAME_GUTTER_CLAIM_PX);

  if (now) {
    placed.push({
      key: 'now', y: yFor(now.offset), labelY: yFor(now.offset),
      text: (args.short && now.shortLabel) ? now.shortLabel : now.label,
      kind: 'now', stacked: false,
    });
  }
  for (const marker of [...sun].sort((a, b) => a.offset - b.offset)) {
    const y = yFor(marker.offset);
    let labelY = y;
    let stacked = false;
    // Bounded: at most one push per already-placed label.
    for (let i = 0; i <= placed.length && !claimFree(labelY); i += 1) {
      labelY += FRAME_GUTTER_STACK_PX;
      stacked = true;
    }
    placed.push({
      key: `sun:${marker.id}`,
      y,
      labelY,
      text: args.short ? marker.shortLabel : marker.label,
      kind: 'sun',
      id: marker.id,
      stacked,
    });
  }
  const markerLabels = [...placed];
  for (const hour of hours) {
    const y = yFor(hour.offset);
    if (markerLabels.some((p) => Math.abs(p.labelY - y) < FRAME_GUTTER_CLAIM_PX)) continue;
    // The narrow strip gutter drops the ":00" and puts the weekday stamp after
    // the hour ("12 AM MON") — the same information, legible at 64 px.
    const clock = args.short ? hour.label.replace(':00', '') : hour.label;
    placed.push({
      key: `hour:${hour.offset}`,
      y,
      labelY: y,
      text: hour.dateStamp
        ? (args.short ? `${clock} ${hour.dateStamp}` : `${clock} (${hour.dateStamp})`)
        : clock,
      kind: 'hour',
      stacked: false,
      // The stamped label IS the midnight one — `frameHourLabels` stamps the
      // weekday on exactly that tick.
      midnight: hour.dateStamp !== undefined,
    });
  }
  return placed;
}

// ── cues ────────────────────────────────────────────────────────────────

function cueEntry(
  span: FrameSpan,
  cue: OverviewCue,
  date: string,
): FrameCueEntry | null {
  const minute = localToMinutes(cue.atLocal);
  if (minute === null) return null;
  const offset = frameOffset(span, date, minute);
  if (offset === null) return null;
  const duration = typeof cue.durationMin === 'number' && cue.durationMin > 0
    ? cue.durationMin
    : 0;
  return {
    cue,
    date,
    weekday: frameWeekday(date),
    offset,
    endOffset: duration > 0 ? Math.min(span.durationMin, offset + duration) : offset,
    timing: 'plotted',
  };
}

/**
 * Every cue that belongs to this span, sorted by offset with the unplotted ones
 * last. Resolution uses `atLocal` ALONE — the engine already resolved sun and
 * party anchors on their own calendar day, so the event NAME is never consulted
 * (a "sunrise" cue is plotted where the engine says it fires).
 *
 * `timing`:
 *   plotted — has an offset inside the span
 *   lead-in — festival day 0's own pre-18:00 cues, which no earlier card can
 *             hold (working frame only); listed, never plotted
 *   manual  — no resolved time at all
 * Party Window IMPLEMENTATION cues (`pwb_` / `pwe_` / the phase baseline) are
 * hidden: the operator authored ONE window, not three cues.
 */
export function frameCueEntries(span: FrameSpan): FrameCueEntry[] {
  const dayCues = span.day.cues ?? [];
  const nextCues = span.nextDay?.cues ?? [];
  const allCues = [...dayCues, ...nextCues];
  const out: FrameCueEntry[] = [];

  for (const cue of dayCues) {
    if (isPartyWindowImplementationCue(cue, allCues)) continue;
    const minute = localToMinutes(cue.atLocal);
    if (minute === null) {
      out.push({
        cue,
        date: span.startDate,
        weekday: frameWeekday(span.startDate),
        offset: null,
        endOffset: null,
        timing: 'manual',
      });
      continue;
    }
    const entry = cueEntry(span, cue, span.startDate);
    if (entry) { out.push(entry); continue; }
    // Working frame, festival day 0: a cue authored on the calendar morning of
    // the first day has no preceding card to live on. Keep it visible.
    if (span.frame === 'working' && span.index === 0 && minute < WORKING_DAY_START_MIN) {
      out.push({
        cue,
        date: span.startDate,
        weekday: frameWeekday(span.startDate),
        offset: null,
        endOffset: null,
        timing: 'lead-in',
      });
    }
  }

  if (span.frame === 'working' && span.nextDay && span.endDate) {
    for (const cue of nextCues) {
      if (isPartyWindowImplementationCue(cue, allCues)) continue;
      const minute = localToMinutes(cue.atLocal);
      if (minute === null) continue;
      // 6:00 PM opens the NEXT working day; it is never this one's inclusive end.
      if (minute === WORKING_DAY_START_MIN) continue;
      const entry = cueEntry(span, cue, span.endDate);
      if (entry) out.push(entry);
    }
  }

  return out.sort((a, b) => {
    if (a.offset === null && b.offset === null) return 0;
    if (a.offset === null) return 1;
    if (b.offset === null) return -1;
    return a.offset - b.offset;
  });
}

// ── the party band ──────────────────────────────────────────────────────

function partyBandLabel(date: string, opensMin: number, closesMin: number): string {
  return `${frameWeekday(date)} ${frameClock12h(opensMin)} → ${frameClock12h(closesMin)}`;
}

function partyWindowMinutes(
  window: NonNullable<OverviewDay['partyWindow']>,
): { opensMin: number; closesMin: number; durationMin: number } | null {
  const opensMin = localToMinutes(window.opensLocal);
  const closesMin = localToMinutes(window.closesLocal);
  if (opensMin === null || closesMin === null) return null;
  const raw = closesMin - opensMin;
  const durationMin = raw > 0 ? raw : raw + DAY_MINUTES;
  return { opensMin, closesMin, durationMin };
}

/**
 * The PARTY WINDOW band(s) for this span, drawn from the engine's per-day
 * `partyWindow` ALONE (C-03). Empty on a night the party cue does not apply to
 * — the old `phases[]`-derived band lied on those nights.
 *
 * DEVIATION from _359 §C.2, which named a singular `framePartyBand`: a window
 * that wraps midnight occupies ONE band in the working frame but TWO pieces in
 * the regular frame (21:00→24:00 on Day k, 00:00→09:00 tagged "continues from
 * DAY k" on Day k+1). A day can hold both its own opening and the previous
 * day's tail, so this returns an array of 0–2 entries.
 */
export function framePartyBands(span: FrameSpan): FramePartyBand[] {
  const out: FramePartyBand[] = [];
  const own = span.day.partyWindow ?? null;

  if (span.frame === 'regular') {
    if (own) {
      const t = partyWindowMinutes(own);
      if (t) {
        out.push({
          fromOffset: t.opensMin,
          toOffset: Math.min(DAY_MINUTES, t.opensMin + t.durationMin),
          label: partyBandLabel(span.startDate, t.opensMin, t.closesMin),
        });
      }
    }
    const carried = span.prevDay?.partyWindow ?? null;
    if (carried && carried.wraps) {
      const t = partyWindowMinutes(carried);
      if (t && t.closesMin > 0) {
        out.push({
          fromOffset: 0,
          toOffset: Math.min(DAY_MINUTES, t.closesMin),
          label: partyBandLabel(span.prevDay!.date, t.opensMin, t.closesMin),
          continuesFrom: span.index - 1,
        });
      }
    }
    return out.sort((a, b) => a.fromOffset - b.fromOffset);
  }

  // Working frame: the window belongs to the span its OPENING falls in.
  const candidates: { window: NonNullable<OverviewDay['partyWindow']>; date: string }[] = [];
  if (own) candidates.push({ window: own, date: span.startDate });
  if (span.nextDay?.partyWindow && span.endDate) {
    candidates.push({ window: span.nextDay.partyWindow, date: span.endDate });
  }
  for (const { window, date } of candidates) {
    const t = partyWindowMinutes(window);
    if (!t) continue;
    const fromOffset = frameOffset(span, date, t.opensMin);
    if (fromOffset === null) continue;
    out.push({
      fromOffset,
      toOffset: Math.min(span.durationMin, fromOffset + t.durationMin),
      label: partyBandLabel(date, t.opensMin, t.closesMin),
    });
  }
  return out.sort((a, b) => a.fromOffset - b.fromOffset);
}

// ── phase bands + the resolved ribbon ───────────────────────────────────

/**
 * Phase bands for this span, EXCLUDING the party window's own phase — that one
 * is drawn from `partyWindow` so it can never appear on a night the party cue
 * does not apply to (C-03). Plan ORDER is preserved; never sort by name.
 */
export function framePhaseBands(span: FrameSpan): FramePhaseEntry[] {
  const out: FramePhaseEntry[] = [];
  const add = (phases: OverviewPhase[] | undefined, date: string) => {
    const source = Array.isArray(phases) ? phases : [];
    allPhaseBands(source).forEach((band, i) => {
      if (isPartyPhaseName(band.name, span.partyPhaseId)) return;
      const fromOffset = frameOffset(span, date, band.fromMin);
      const toOffset = frameOffset(span, date, band.toMin);
      if (fromOffset === null || toOffset === null || toOffset <= fromOffset) return;
      out.push({
        phase: source[band.order],
        key: `${date}:${band.name}:${i}`,
        order: band.order,
        fromOffset,
        toOffset,
      });
    });
  };
  add(span.day.phases, span.startDate);
  if (span.frame === 'working' && span.nextDay && span.endDate) {
    add(span.nextDay.phases, span.endDate);
  }
  // A band split by the span's own midnight is one band to the operator.
  const merged: FramePhaseEntry[] = [];
  for (const entry of out) {
    const crossing = merged.find((candidate) =>
      candidate.phase.name === entry.phase.name
        && Math.abs(candidate.toOffset - entry.fromOffset) < 0.001);
    if (crossing) {
      crossing.toOffset = entry.toOffset;
      crossing.key = `${crossing.key}+${entry.key}`;
    } else {
      merged.push({ ...entry });
    }
  }
  return merged;
}

/** The RESOLVED ribbon rows projected onto this span. */
export function frameRibbonEntries(span: FrameSpan): FrameRibbonEntry[] {
  const out: FrameRibbonEntry[] = [];
  const add = (rows: RibbonRow[], date: string) => {
    rows.forEach((row) => {
      const fromOffset = frameOffset(span, date, row.fromMin);
      const toOffset = frameOffset(span, date, row.toMin);
      if (fromOffset === null || toOffset === null || toOffset <= fromOffset) return;
      out.push({
        row,
        date,
        fromLocal: row.fromMin === DAY_MINUTES ? '24:00' : minutesToHHMM(row.fromMin),
        toLocal: row.toMin === DAY_MINUTES ? '24:00' : minutesToHHMM(row.toMin),
        fromOffset,
        toOffset,
      });
    });
  };
  add(ribbonRows(span.day.segments), span.startDate);
  if (span.frame === 'working' && span.nextDay && span.endDate) {
    add(ribbonRows(span.nextDay.segments), span.endDate);
  }
  return out;
}

// ── headers ─────────────────────────────────────────────────────────────

export interface FrameHeader {
  /** "NIGHT 1 · SUN → MON" / "DAY 1 · SUN" */
  title: string;
  /** "Sun 6:00 PM → Mon 6:00 PM · festival day 1 of 4" */
  subtitle: string;
  /** "N1 · SUN → MON" / "D1 · SUN" — the strip card title. */
  cardTitle: string;
  /** The hatched-tail warning on the last working night, else null. */
  tailNote: string | null;
}

export function frameHeader(span: FrameSpan): FrameHeader {
  const startWeekday = frameWeekday(span.startDate);
  const dayOf = `festival day ${span.index + 1} of ${span.count}`;
  if (span.frame === 'regular') {
    return {
      title: `DAY ${span.index + 1} · ${startWeekday}`,
      subtitle: `${frameWeekdayTitle(span.startDate)} 12:00 AM → 12:00 AM · ${dayOf}`,
      cardTitle: `D${span.index + 1} · ${startWeekday}`,
      tailNote: null,
    };
  }
  const endDate = span.endDate as string;
  const endWeekday = frameWeekday(endDate);
  return {
    title: `NIGHT ${span.index + 1} · ${startWeekday} → ${endWeekday}`,
    subtitle: `${frameWeekdayTitle(span.startDate)} 6:00 PM → ${frameWeekdayTitle(endDate)} 6:00 PM · ${dayOf}`,
    cardTitle: `N${span.index + 1} · ${startWeekday} → ${endWeekday}`,
    tailNote: span.nextDay
      ? null
      : `After ${endWeekday} 12:00 AM is past the festival — nothing can be scheduled there.`,
  };
}

/** The one sentence that explains the current frame, and names the other one. */
export function frameExplainer(frame: DayFrame): string {
  return frame === 'working'
    ? 'Working day: each night runs 6 PM to 6 PM the next day. Switch to CALENDAR DAY to see midnight-to-midnight.'
    : 'Calendar day: each day runs midnight to midnight. Switch to WORKING DAY to see one whole night on one card.';
}

// ── authoring ───────────────────────────────────────────────────────────

function triggerClock(trigger: CueTrigger): string | null {
  if (trigger.type === 'clock') return trigger.at;
  if (trigger.type === 'manual' && typeof trigger.placementAt === 'string') {
    return trigger.placementAt;
  }
  return null;
}

/** Which half of a working day a sun EVENT belongs to (C-06). */
export function sunEventHalf(event: string): FrameHalf {
  return MORNING_SUN_EVENTS.includes(event) ? 'morning' : 'evening';
}

/**
 * The wire day(s) a cue authored on frame index `index` must carry.
 *
 *   regular → always `[index]`.
 *   working → `[index]` for the evening half, `[index + 1]` for the morning
 *             half. A CLOCK/manual placement decides the half by its time; a
 *             SUN trigger decides it by its EVENT (C-06: "sunrise −20 on Night
 *             1" belongs to the morning AFTER Night 1 opens, not before it);
 *             everything else (phase / mood / the Party Window) keeps `index`,
 *             because the engine resolves those against its own day boundaries
 *             and the Party Window's start clock already names its calendar day.
 *
 * A morning cue on the LAST night has nowhere to land — that is refused with a
 * sentence, never clamped onto a day the operator did not choose.
 */
export function authoringToWire(
  frame: DayFrame,
  index: number,
  trigger: CueTrigger,
  festivalDays: number,
): FrameAuthoringResult {
  if (!Number.isInteger(index) || index < 0) {
    return { error: `Pick a ${frameSpanWord(frame).toLowerCase()} before saving this cue.` };
  }
  if (!Number.isInteger(festivalDays) || festivalDays <= 0) {
    return { error: 'This plan has no festival span — add one before authoring cues.' };
  }
  if (index > festivalDays - 1) {
    return {
      error: `${frameSpanWord(frame)} ${index + 1} is outside this plan's festival span `
        + `(1–${festivalDays}).`,
    };
  }
  if (frame === 'regular') return { wireDays: [index] };

  let half: FrameHalf = 'evening';
  if (trigger.type === 'sun') {
    half = sunEventHalf(trigger.event);
  } else {
    const clock = triggerClock(trigger);
    if (clock !== null) {
      const minute = localToMinutes(clock);
      if (minute === null) {
        return { error: `"${clock}" is not a valid HH:MM time.` };
      }
      half = minute >= WORKING_DAY_START_MIN ? 'evening' : 'morning';
    }
  }
  const wire = half === 'morning' ? index + 1 : index;
  if (wire > festivalDays - 1) {
    return {
      error: 'This lands on the morning after the last festival night, so it rolls past '
        + 'the last festival night — pick an evening time or add a day.',
    };
  }
  return { wireDays: [wire] };
}

/**
 * Display inverse of `authoringToWire`: which frame index does a stored wire
 * day belong to? `atLocalOrHalf` is the cue's RESOLVED "HH:MM" (preferred — it
 * is what the engine actually computed) or an explicit half.
 *
 * Null only in the working frame, for a morning cue stored on wire day 0: there
 * is no Night 0, so the calendar lists it as Night 1's lead-in instead.
 */
export function wireToFrameIndex(
  frame: DayFrame,
  wireDay: number,
  atLocalOrHalf: string | FrameHalf | null,
): number | null {
  if (!Number.isFinite(wireDay)) return null;
  if (frame === 'regular') return wireDay;
  let half: FrameHalf = 'evening';
  if (atLocalOrHalf === 'morning' || atLocalOrHalf === 'evening') {
    half = atLocalOrHalf;
  } else if (typeof atLocalOrHalf === 'string') {
    const minute = localToMinutes(atLocalOrHalf);
    if (minute !== null) half = minute >= WORKING_DAY_START_MIN ? 'evening' : 'morning';
  }
  if (half === 'evening') return wireDay;
  return wireDay >= 1 ? wireDay - 1 : null;
}

/**
 * The operator sentence under a cue's DAYS control: which spans does this cue
 * run on? `atHHMM` is the cue's clock (it decides the half in the working
 * frame); pass null for a trigger with no clock.
 */
export function frameDaysSummary(
  frame: DayFrame,
  days: CueDays | undefined,
  atHHMM: string | null,
  festivalDays: number,
): string {
  const word = frameSpanWord(frame);
  const wordTitle = word.slice(0, 1) + word.slice(1).toLowerCase();
  if (days === undefined || days === 'all') {
    return frame === 'working' ? 'Every night' : 'Every day';
  }
  if (!Array.isArray(days) || days.length === 0) return 'No day selected yet';
  if (typeof days[0] === 'string') {
    return `Dates: ${(days as string[]).join(', ')}`;
  }
  const numeric = [...(days as number[])].sort((a, b) => a - b);
  const labels = numeric.map((wireDay) => {
    const index = wireToFrameIndex(frame, wireDay, atHHMM);
    if (index === null) return `before ${word} 1`;
    if (index > festivalDays - 1) return `past ${word} ${festivalDays}`;
    return `${wordTitle} ${index + 1}`;
  });
  return labels.join(', ');
}

/**
 * The calendar date the ENGINE must resolve against for `time` on frame index
 * `index` (TIME TRAVEL's ADVANCED field). Null when the instant falls outside
 * the festival — the last night's morning is past the span, and nothing is
 * scheduled there.
 */
export function frameTravelResolveDate(
  frame: DayFrame,
  days: OverviewDay[],
  index: number | null,
  time: string,
): string | null {
  if (index === null || !Number.isInteger(index) || index < 0 || index > days.length - 1) {
    return null;
  }
  const minute = localToMinutes(time);
  if (minute === null) return null;
  if (frame === 'regular') return days[index].date;
  if (minute >= WORKING_DAY_START_MIN) return days[index].date;
  return days[index + 1]?.date ?? null;
}

// ── the editor's fire-time preview (D.4; used by slice S3) ──────────────

export type FrameFirePreview = { text: string } | { error: string };

function signedOffset(offsetMin: number | undefined): string {
  if (!offsetMin) return '';
  return offsetMin > 0 ? ` +${offsetMin}` : ` −${Math.abs(offsetMin)}`;
}

/**
 * The always-visible line under the cue editor's trigger block: WHEN does this
 * fire, in words, on the frame index the operator is authoring on (D.4).
 *
 * A sun trigger needs that date's resolved sun times (`sunByDate`, taken from
 * the overview). When they are missing the editor must BLOCK the save with the
 * returned error rather than guessing a clock time.
 */
export function cueFirePreview(args: {
  frame: DayFrame;
  index: number;
  trigger: CueTrigger;
  days: OverviewDay[];
  sunByDate: Record<string, OverviewSun>;
  partyWindow?: { opensLocal: string; closesLocal: string } | null;
}): FrameFirePreview {
  const { frame, index, trigger, days, sunByDate } = args;
  const wire = authoringToWire(frame, index, trigger, days.length);
  if ('error' in wire) return { error: wire.error };
  const wireDay = wire.wireDays[0];
  const date = days[wireDay]?.date ?? null;
  if (date === null) {
    return { error: 'That day is outside this plan\'s festival span.' };
  }
  const weekday = frameWeekday(date);
  const word = frameSpanWord(frame);
  const halfNote = frame === 'working' && wireDay !== index
    ? ` (morning half of ${word} ${index + 1})`
    : ` (${word} ${index + 1})`;

  if (trigger.type === 'clock' || (trigger.type === 'manual' && trigger.placementAt)) {
    const clock = triggerClock(trigger) as string;
    const minute = localToMinutes(clock);
    if (minute === null) return { error: `"${clock}" is not a valid HH:MM time.` };
    const verb = trigger.type === 'manual' ? 'Placed at' : 'Fires';
    return { text: `${verb} ${weekday} ${frameClock12h(minute)}${halfNote}` };
  }

  if (trigger.type === 'sun') {
    const sun = sunByDate[date];
    const at = sun ? sun[trigger.event] : undefined;
    const minute = localToMinutes(typeof at === 'string' ? at : null);
    if (minute === null) {
      return { error: 'Sun times for this night are not loaded — reconnect.' };
    }
    const fires = minute + (trigger.offsetMin || 0);
    return {
      text: `Fires ~${weekday} ${frameClock12h(fires)} (${trigger.event}${signedOffset(trigger.offsetMin)})`,
    };
  }

  if (trigger.type === 'mood' && trigger.to === 'party') {
    const window = args.partyWindow ?? days[wireDay]?.partyWindow ?? null;
    if (!window) {
      return { text: `Window on ${weekday} · detection armed inside it` };
    }
    const opens = localToMinutes(window.opensLocal);
    const closes = localToMinutes(window.closesLocal);
    if (opens === null || closes === null) {
      return { text: `Window on ${weekday} · detection armed inside it` };
    }
    return {
      text: `Window ${weekday} ${frameClock12h(opens)} → ${frameClock12h(closes)}`
        + ' · detection armed inside it',
    };
  }

  if (trigger.type === 'phase') {
    return { text: `Fires when phase "${trigger.phase}" opens on ${weekday}${halfNote}` };
  }
  return { text: `Fires on demand · placed on ${weekday}${halfNote}` };
}
