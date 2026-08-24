import type {
  OverviewCue,
  OverviewDay,
  OverviewPhase,
} from '../../utils/timelineApi';

import {
  allPhaseBands,
  DAY_MINUTES,
  localToMinutes,
  ribbonRows,
  type RibbonRow,
} from './zoom_logic';
import {
  isPartyWindowImplementationCue,
} from './party_window_logic';

export interface NightAxis {
  sunsetMin: number;
  sunriseMin: number;
  durationMin: number;
}

export interface NightCueEntry {
  cue: OverviewCue;
  date: string;
  timing: 'lead-in' | 'night' | 'manual';
  startOffset: number | null;
  endOffset: number | null;
}

export interface NightPhaseEntry {
  phase: OverviewPhase;
  key: string;
  order: number;
  fromOffset: number;
  toOffset: number;
}

export interface NightRibbonEntry {
  row: RibbonRow;
  date: string;
  fromLocal: string;
  toLocal: string;
  fromOffset: number;
  toOffset: number;
}

export interface NightTapTarget {
  date: string;
  time: string;
}

/** Operator day: 6 PM on the card's date through 6 PM on the next date. */
export const TIMELINE_DAY_START_MIN = 18 * 60;
export const TIMELINE_DAY_DURATION_MIN = DAY_MINUTES;
export const TIMELINE_OPERATOR_SNAP_MIN = 15;
export const TIMELINE_HOUR_STEP_MIN = 60;

/** Every hour boundary on the shared 6 PM → 6 PM operator-day axis. */
export function timelineHourOffsets(
  durationMin = TIMELINE_DAY_DURATION_MIN,
): number[] {
  if (!Number.isFinite(durationMin) || durationMin <= 0) return [];
  const count = Math.floor(durationMin / TIMELINE_HOUR_STEP_MIN);
  const offsets = Array.from(
    { length: count + 1 },
    (_, index) => index * TIMELINE_HOUR_STEP_MIN,
  );
  if (offsets.at(-1) !== durationMin) offsets.push(durationMin);
  return offsets;
}

function minutesToHHMM(mins: number): string {
  const norm = ((mins % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hh = Math.floor(norm / 60);
  const mm = norm % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function nightAxisFor(_day: OverviewDay, _nextDay?: OverviewDay | null): NightAxis {
  return {
    sunsetMin: TIMELINE_DAY_START_MIN,
    sunriseMin: TIMELINE_DAY_START_MIN,
    durationMin: TIMELINE_DAY_DURATION_MIN,
  };
}

export function nightOffset(
  minute: number,
  dayOffset: 0 | 1,
  axis: NightAxis,
): number | null {
  if (!Number.isFinite(minute)) return null;
  if (dayOffset === 0) {
    if (minute < axis.sunsetMin || minute > DAY_MINUTES) return null;
    return minute - axis.sunsetMin;
  }
  if (minute < 0 || minute > axis.sunriseMin) return null;
  return (DAY_MINUTES - axis.sunsetMin) + minute;
}

export function yForNightOffset(offset: number | null, height: number, axis: NightAxis): number | null {
  if (offset === null || !Number.isFinite(height) || height <= 0) return null;
  return (Math.max(0, Math.min(axis.durationMin, offset)) / axis.durationMin) * height;
}

/** Which half of this displayed operator day contains NOW, if either. */
export function nightNowDayOffset(
  day: OverviewDay,
  nextDay: OverviewDay | null | undefined,
  todayIndex: number | null,
  nowMinutes: number | null,
  axis: NightAxis,
): 0 | 1 | null {
  if (todayIndex === null || nowMinutes === null) return null;
  if (todayIndex === day.index && nowMinutes >= axis.sunsetMin) return 0;
  if (nextDay && todayIndex === nextDay.index && nowMinutes < axis.sunriseMin) return 1;
  return null;
}

export function nightTapTarget(
  y: number,
  height: number,
  axis: NightAxis,
  day: OverviewDay,
  nextDay?: OverviewDay | null,
  snapMin = TIMELINE_OPERATOR_SNAP_MIN,
): NightTapTarget | null {
  if (!Number.isFinite(y) || !Number.isFinite(height) || height <= 0) return null;
  if (!Number.isFinite(snapMin) || snapMin <= 0) return null;
  const ratio = Math.max(0, Math.min(1, y / height));
  let offset = Math.round((ratio * axis.durationMin) / snapMin) * snapMin;
  if (offset >= axis.durationMin) offset = Math.max(0, axis.durationMin - snapMin);
  const untilMidnight = DAY_MINUTES - axis.sunsetMin;
  if (offset < untilMidnight) {
    return { date: day.date, time: minutesToHHMM(axis.sunsetMin + offset) };
  }
  if (!nextDay) return null;
  return { date: nextDay.date, time: minutesToHHMM(offset - untilMidnight) };
}

export function nightCueEntries(
  day: OverviewDay,
  nextDay: OverviewDay | null | undefined,
  axis: NightAxis,
): NightCueEntry[] {
  const out: NightCueEntry[] = [];
  const allCues = [...day.cues, ...(nextDay?.cues ?? [])];
  const add = (cue: OverviewCue, date: string, dayOffset: 0 | 1) => {
    if (isPartyWindowImplementationCue(cue, allCues)) return;
    const minute = localToMinutes(cue.atLocal);
    if (minute === null) {
      if (dayOffset === 0) {
        out.push({ cue, date, timing: 'manual', startOffset: null, endOffset: null });
      }
      return;
    }
    // 6:00 PM belongs to the new operator day, never the preceding day's
    // inclusive end boundary. Phase/ribbon end geometry may still use 18:00.
    if (dayOffset === 1 && minute === axis.sunriseMin) return;
    const startOffset = nightOffset(minute, dayOffset, axis);
    if (startOffset === null) return;
    const duration = typeof cue.durationMin === 'number' && cue.durationMin > 0
      ? cue.durationMin
      : 0;
    out.push({
      cue,
      date,
      timing: 'night',
      startOffset,
      endOffset: duration > 0
        ? Math.min(axis.durationMin, startOffset + duration)
        : startOffset,
    });
  };
  day.cues.forEach((cue) => add(cue, day.date, 0));
  nextDay?.cues.forEach((cue) => add(cue, nextDay.date, 1));
  return out.sort((a, b) => {
    if (a.startOffset === null && b.startOffset === null) return 0;
    if (a.startOffset === null) return 1;
    if (b.startOffset === null) return -1;
    return a.startOffset - b.startOffset;
  });
}

/**
 * The fixed 6 PM→6 PM operator day normally needs no lead-in. Festival day 1
 * has no preceding card, though, so cues authored on its calendar morning
 * would otherwise disappear from every day agenda. Keep those legacy/early
 * setup cues in an explicit unplotted list; later mornings belong to the
 * preceding operator-day card and are already included by nightCueEntries.
 */
export function nightLeadInCueEntries(
  day: OverviewDay,
  axis: NightAxis,
  _lookbackMin = 120,
): NightCueEntry[] {
  if (day.index !== 0) return [];
  return day.cues
    .filter((cue) => {
      if (isPartyWindowImplementationCue(cue, day.cues)) return false;
      const minute = localToMinutes(cue.atLocal);
      return minute !== null && minute < axis.sunsetMin;
    })
    .sort((left, right) =>
      (localToMinutes(left.atLocal) ?? 0) - (localToMinutes(right.atLocal) ?? 0))
    .map((cue) => ({
      cue,
      date: day.date,
      timing: 'lead-in' as const,
      startOffset: null,
      endOffset: null,
    }));
}

export function nightPhaseEntries(
  day: OverviewDay,
  nextDay: OverviewDay | null | undefined,
  axis: NightAxis,
): NightPhaseEntry[] {
  const out: NightPhaseEntry[] = [];
  const add = (phases: OverviewPhase[] | undefined, dayOffset: 0 | 1) => {
    const source = Array.isArray(phases) ? phases : [];
    allPhaseBands(source).forEach((band, index) => {
      const fromMin = dayOffset === 0
        ? Math.max(axis.sunsetMin, band.fromMin)
        : Math.max(0, band.fromMin);
      const toMin = dayOffset === 0
        ? Math.min(DAY_MINUTES, band.toMin)
        : Math.min(axis.sunriseMin, band.toMin);
      if (toMin <= fromMin) return;
      const fromOffset = nightOffset(fromMin, dayOffset, axis);
      const toOffset = nightOffset(toMin, dayOffset, axis);
      if (fromOffset === null || toOffset === null || toOffset <= fromOffset) return;
      out.push({
        phase: source[band.order],
        key: `${dayOffset}:${band.name}:${index}`,
        order: band.order,
        fromOffset,
        toOffset,
      });
    });
  };
  add(day.phases, 0);
  add(nextDay?.phases, 1);
  const merged: NightPhaseEntry[] = [];
  for (const entry of out) {
    const crossing = merged.find((candidate) =>
      candidate.phase.name === entry.phase.name
        && Math.abs(candidate.toOffset - entry.fromOffset) < 0.001,
    );
    if (crossing) {
      crossing.toOffset = entry.toOffset;
      crossing.key = `${crossing.key}+${entry.key}`;
    } else {
      merged.push({ ...entry });
    }
  }
  return merged;
}

export function nightRibbonEntries(
  day: OverviewDay,
  nextDay: OverviewDay | null | undefined,
  axis: NightAxis,
): NightRibbonEntry[] {
  const out: NightRibbonEntry[] = [];
  const add = (
    rows: RibbonRow[],
    date: string,
    dayOffset: 0 | 1,
  ) => {
    rows.forEach((row) => {
      const fromMin = dayOffset === 0
        ? Math.max(axis.sunsetMin, row.fromMin)
        : Math.max(0, row.fromMin);
      const toMin = dayOffset === 0
        ? Math.min(DAY_MINUTES, row.toMin)
        : Math.min(axis.sunriseMin, row.toMin);
      if (toMin <= fromMin) return;
      const fromOffset = nightOffset(fromMin, dayOffset, axis);
      const toOffset = nightOffset(toMin, dayOffset, axis);
      if (fromOffset === null || toOffset === null || toOffset <= fromOffset) return;
      out.push({
        row,
        date,
        fromLocal: fromMin === DAY_MINUTES ? '24:00' : minutesToHHMM(fromMin),
        toLocal: toMin === DAY_MINUTES ? '24:00' : minutesToHHMM(toMin),
        fromOffset,
        toOffset,
      });
    });
  };
  add(ribbonRows(day.segments), day.date, 0);
  if (nextDay) add(ribbonRows(nextDay.segments), nextDay.date, 1);
  return out;
}
