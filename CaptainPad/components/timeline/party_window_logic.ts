import type {
  ActionPlaylist,
  CueDays,
  PlanCue,
  PlanPhase,
  ShowPlan,
} from '@/utils/timelineApi';

export interface PartyWindowSpec {
  startAt: string;
  windowDurationMin: number;
  baselineAction: ActionPlaylist;
  partyAction: ActionPlaylist;
  minDwellSec: number;
  sessionDurationMin: number;
  cooldownSec: number;
}

export interface PartyWindowSeed extends PartyWindowSpec {
  phaseId: string;
  baselineCueId: string;
}

function clockMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToClock(value: number): string {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function boundedId(prefix: string, cueId: string): string {
  return `${prefix}${cueId}`.replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
}

export function partyWindowPhaseId(cueId: string): string {
  return boundedId('pw_', cueId);
}

export function partyWindowBaselineCueId(cueId: string): string {
  return boundedId('pwb_', cueId);
}

export function partyWindowEndCueId(cueId: string): string {
  return boundedId('pwe_', cueId);
}

export function isPartyWindowInternalCueId(cueId: string): boolean {
  return cueId.startsWith('pwb_') || cueId.startsWith('pwe_');
}

/**
 * Hide both current synthetic ids and legacy phase-baseline cues from
 * operator cue lists. The Party Window itself remains visible as the mood cue.
 */
export function isPartyWindowImplementationCue(
  cue: Pick<PlanCue, 'id' | 'trigger'>,
  cues: readonly Pick<PlanCue, 'id' | 'trigger'>[],
): boolean {
  if (isPartyWindowInternalCueId(cue.id)) return true;
  if (cue.trigger.type !== 'phase') return false;
  const phaseName = cue.trigger.phase;
  return cues.some((candidate) =>
    candidate.trigger.type === 'mood'
      && candidate.trigger.to === 'party'
      && candidate.trigger.whenPhase === phaseName,
  );
}

export function isPartyWindowCue(cue: Pick<PlanCue, 'trigger'>): boolean {
  return cue.trigger.type === 'mood'
    && cue.trigger.to === 'party'
    && !!cue.trigger.whenPhase
    && cue.trigger.whenPhase.startsWith('pw_');
}

function addDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/* ── THE PARTY WINDOW DAY RULE ────────────────────────────────────────────
 *
 * A cue's `days` is a CALENDAR festival-day index in the plan timezone —
 * `cueAppliesOn` in marsin_engine/lib/timeline/festival.js resolves it against
 * the calendar day the cue fires on. For a Party Window the engine resolves the
 * party cue's `days` against `nightStartMs`, the instant the window OPENED
 * (marsin_engine/lib/timeline/party_window.js, NIGHT-START-DAY SEMANTICS). So:
 *
 *   phase baseline (pwb_) + party cue → the day the window OPENS   [N]
 *   closer (pwe_, a clock cue at endAt) → the day the window ENDS
 *       non-wrapping (start + length  <  24 h) → [N]
 *       wrapping     (start + length >= 24 h) → [N+1]
 *
 * The 6 PM operator-day shift ordinary clock cues use (`operatorDayToWireDay`
 * in cue_edit_logic.ts) must NOT be applied to a Party Window: it moved a
 * daytime window (09:00 → 17:00) authored for festival day N onto day N+1, so
 * the engine reported the window opening TOMORROW while the operator was
 * standing in it (bug, 2026-08-23). The window's own start clock already says
 * which calendar day it belongs to; there is nothing to shift.
 */

/** Does the window cross midnight (its end clock lands on the NEXT day)? */
export function partyWindowWrapsMidnight(startAt: string, windowDurationMin: number): boolean {
  const startMin = clockMinutes(startAt);
  if (startMin === null) {
    throw new Error(`Party Window start must be HH:MM, got ${JSON.stringify(startAt)}.`);
  }
  if (!Number.isFinite(windowDurationMin) || windowDurationMin <= 0 || windowDurationMin > 1440) {
    throw new Error('Party Window length must be between 1 and 1,440 minutes.');
  }
  return startMin + windowDurationMin >= 1440;
}

export interface PartyWindowDaysResult {
  days: CueDays;
  /** Non-null when the selection cannot be authored — surface it, don't clamp. */
  overflowError: string | null;
}

/**
 * Serialize the editor's DAYS selection for the Party Window's OPENING day.
 * Calendar semantics: the selection IS the wire day. Numeric entries are
 * range-checked against the festival span so the editor fails loudly instead of
 * emitting a day index the engine's `validateCueDays` will reject.
 */
export function partyWindowStartDays(
  selection: CueDays | undefined,
  festivalDays: number,
): PartyWindowDaysResult {
  if (selection === undefined || selection === 'all') return { days: 'all', overflowError: null };
  if (!Array.isArray(selection) || selection.length === 0) {
    return {
      days: selection ?? 'all',
      overflowError: 'Pick at least one day for this Party Window, or choose All days.',
    };
  }
  if (selection.every((entry) => typeof entry === 'string')) {
    return { days: selection, overflowError: null };
  }
  if (!selection.every((entry) => typeof entry === 'number')) {
    return {
      days: selection,
      overflowError: 'A Party Window\'s days must be all day numbers or all dates, not a mix.',
    };
  }
  const numeric = selection as number[];
  const outOfSpan = numeric.find((day) =>
    !Number.isInteger(day) || day < 0 || day > festivalDays - 1);
  if (outOfSpan !== undefined) {
    return {
      days: selection,
      overflowError:
        `Day ${outOfSpan + 1} is outside this plan's festival span (D1–D${festivalDays}).`,
    };
  }
  return { days: [...numeric].sort((a, b) => a - b), overflowError: null };
}

/**
 * The closer's days: the same day for a window that ends before midnight, the
 * NEXT day for one that wraps. A wrapping window on the LAST festival day has
 * no day to close on — THROW (the engine's own validator rejects an index past
 * the span, and silently dropping the closer would leave the window open
 * forever).
 */
export function partyWindowEndDays(
  days: PlanCue['days'],
  plan: ShowPlan,
  wraps: boolean,
): PlanCue['days'] {
  if (days === undefined || days === 'all') return 'all';
  if (days.length === 0) {
    throw new Error('A Party Window needs at least one day; pick a day or choose All days.');
  }
  if (!wraps) return days;
  if (typeof days[0] === 'number') {
    const max = plan.festival ? plan.festival.days - 1 : null;
    return (days as number[]).map((day) => {
      const closer = day + 1;
      if (max !== null && closer > max) {
        throw new Error(
          `This Party Window runs past midnight, so it closes on day D${closer + 1} — `
          + `past the last festival day (D${max + 1}). Add a festival day, or end the `
          + 'window before midnight.',
        );
      }
      return closer;
    });
  }
  return (days as string[]).map((date) => addDate(date, 1));
}

/** 'YYYY-MM-DD' → "Sun, Aug 23". Parsed at UTC noon so no tz shifts the date. */
function shortDateLabel(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const at = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  }).format(at);
}

/** "D2 · Mon, Aug 24" for a festival day index, or "D2" on a plan with no span. */
export function partyWindowDayLabel(plan: ShowPlan, dayIndex: number): string {
  const name = `D${dayIndex + 1}`;
  if (!plan.festival) return name;
  return `${name} · ${shortDateLabel(addDate(plan.festival.startDate, dayIndex))}`;
}

/**
 * The one sentence the editor renders under DAYS so the operator can SEE which
 * calendar day the window they are authoring lands on — the choice used to be
 * implicit in a "This day" pill (bug, 2026-08-23). Pure so vitest pins the copy.
 */
export function partyWindowDaysSummary(args: {
  plan: ShowPlan;
  days: CueDays | undefined;
  startAt: string;
  windowDurationMin: number;
}): string {
  const { plan, days, startAt, windowDurationMin } = args;
  const wraps = partyWindowWrapsMidnight(startAt, windowDurationMin);
  const startMin = clockMinutes(startAt) as number; // validated above
  const endAt = minutesToClock(startMin + windowDurationMin);
  const clock = `${startAt} → ${endAt}`;
  if (days === undefined || days === 'all') {
    return wraps
      ? `Opens ${clock} EVERY festival day and closes the next morning.`
      : `Opens ${clock} EVERY festival day and closes the same day.`;
  }
  if (!Array.isArray(days) || days.length === 0) {
    return `Opens ${clock} — no day selected yet.`;
  }
  if (typeof days[0] !== 'number') {
    return `Opens ${clock} on ${(days as string[]).join(', ')}`
      + (wraps ? ' and closes the next morning.' : ' and closes the same day.');
  }
  const numeric = [...(days as number[])].sort((a, b) => a - b);
  const opens = numeric.map((day) => partyWindowDayLabel(plan, day)).join(', ');
  if (!wraps) return `Opens ${clock} on ${opens} and closes the same day.`;
  const closes = numeric.map((day) => partyWindowDayLabel(plan, day + 1)).join(', ');
  return `Opens ${clock} on ${opens} and closes the next morning on ${closes}.`;
}

export function partyWindowSeed(plan: ShowPlan, cue: PlanCue | null): PartyWindowSeed | null {
  if (!cue
      || cue.trigger.type !== 'mood'
      || cue.trigger.to !== 'party'
      || !cue.trigger.whenPhase?.startsWith('pw_')) return null;
  const trigger = cue.trigger;
  const phaseId = trigger.whenPhase;
  if (!phaseId) return null;
  const phase = plan.phases[phaseId];
  if (!phase || !('clock' in phase.start) || !('clock' in phase.end)) return null;
  const startMin = clockMinutes(phase.start.clock);
  const endMin = clockMinutes(phase.end.clock);
  if (startMin === null || endMin === null) return null;
  const windowDurationMin = ((endMin - startMin + 1440) % 1440) || 1440;
  const baseline = plan.cues.find((candidate) =>
    candidate.trigger.type === 'phase'
      && candidate.trigger.phase === phaseId
      && candidate.kind === 'ambient',
  );
  if (!baseline || baseline.action.type !== 'playlist' || cue.action.type !== 'playlist') return null;
  return {
    phaseId,
    baselineCueId: baseline.id,
    startAt: phase.start.clock,
    windowDurationMin,
    baselineAction: baseline.action,
    partyAction: cue.action,
    minDwellSec: trigger.minDwellSec ?? 30,
    sessionDurationMin: cue.durationMin ?? 12,
    cooldownSec: trigger.cooldownSec ?? 120,
  };
}

export function planWithPartyWindow(
  plan: ShowPlan,
  cue: PlanCue,
  spec: PartyWindowSpec,
): ShowPlan {
  if (!cue.id) throw new Error('A Party Window cue must have an id before plan validation.');
  const otherPartyCue = plan.cues.find((candidate) =>
    candidate.id !== cue.id
      && candidate.trigger.type === 'mood'
      && candidate.trigger.to === 'party',
  );
  if (otherPartyCue) {
    throw new Error(`This plan already has a Party Window (${otherPartyCue.label || otherPartyCue.id}). Edit it instead.`);
  }
  const startMin = clockMinutes(spec.startAt);
  if (startMin === null) throw new Error(`Party Window start must be HH:MM, got ${JSON.stringify(spec.startAt)}.`);
  if (!Number.isFinite(spec.windowDurationMin) || spec.windowDurationMin <= 0 || spec.windowDurationMin > 1440) {
    throw new Error('Party Window length must be between 1 and 1,440 minutes.');
  }
  if (!spec.partyAction.name.trim()) throw new Error('Party detected playlist is required.');

  const authoredPhaseId = cue.trigger.type === 'mood' ? cue.trigger.whenPhase : undefined;
  const legacyBaseline = plan.cues.find((candidate) =>
    candidate.kind === 'ambient'
      && candidate.trigger.type === 'phase'
      && candidate.trigger.phase.includes('party')
      && !candidate.id.startsWith('pwb_'),
  );
  const legacyPhaseId = legacyBaseline?.trigger.type === 'phase'
    ? legacyBaseline.trigger.phase
    : undefined;
  const previousPhaseId = authoredPhaseId
    ?? legacyPhaseId;
  const phaseId = partyWindowPhaseId(cue.id);
  const baselineCueId = partyWindowBaselineCueId(cue.id);
  const endCueId = partyWindowEndCueId(cue.id);
  if (!plan.defaultCue) {
    throw new Error('A Party Window requires a Default Cue so the deck can return when the window closes.');
  }
  const endAt = minutesToClock(startMin + spec.windowDurationMin);
  const phase: PlanPhase = {
    start: { clock: spec.startAt },
    end: { clock: endAt },
  };
  const partyCue: PlanCue = {
    ...cue,
    kind: 'mood',
    trigger: {
      type: 'mood',
      from: 'calm',
      to: 'party',
      minDwellSec: spec.minDwellSec,
      cooldownSec: spec.cooldownSec,
      whenPhase: phaseId,
    },
    action: {
      ...spec.partyAction,
      target: { channel: 'deck', id: null },
    },
    durationMin: spec.sessionDurationMin,
  };
  const baselineCue: PlanCue = {
    id: baselineCueId,
    label: 'Party Window baseline',
    enabled: cue.enabled,
    kind: 'ambient',
    trigger: { type: 'phase', phase: phaseId },
    action: spec.baselineAction,
    days: cue.days,
  };
  // The closer lands on the day the window ENDS — the same day when it ends
  // before midnight, the next day only when it wraps. See THE PARTY WINDOW DAY
  // RULE above; an out-of-span closer throws rather than being dropped.
  const endCue: PlanCue = {
    id: endCueId,
    label: 'Default after Party Window',
    enabled: cue.enabled,
    kind: 'ambient',
    trigger: { type: 'clock', at: endAt },
    action: plan.defaultCue.action,
    days: partyWindowEndDays(
      cue.days,
      plan,
      partyWindowWrapsMidnight(spec.startAt, spec.windowDurationMin),
    ),
  };

  const removedIds = new Set([cue.id, baselineCueId, endCueId]);
  if (legacyBaseline) removedIds.add(legacyBaseline.id);
  const cues = plan.cues.filter((current) => {
    if (removedIds.has(current.id)) return false;
    if (!previousPhaseId || previousPhaseId === phaseId) return true;
    return !(current.trigger.type === 'phase'
      && current.trigger.phase === previousPhaseId
      && current.kind === 'ambient');
  });
  const phases = { ...plan.phases, [phaseId]: phase };
  if (previousPhaseId && previousPhaseId !== phaseId) delete phases[previousPhaseId];
  if (legacyPhaseId && legacyPhaseId !== phaseId) delete phases[legacyPhaseId];
  return {
    ...plan,
    phases,
    cues: [...cues, baselineCue, endCue, partyCue],
  };
}

export function planWithoutPartyWindow(plan: ShowPlan, cueId: string): ShowPlan {
  const cue = plan.cues.find((candidate) => candidate.id === cueId);
  const phaseId = cue?.trigger.type === 'mood' && cue.trigger.to === 'party'
    ? cue.trigger.whenPhase
    : undefined;
  if (!phaseId) {
    return { ...plan, cues: plan.cues.filter((candidate) => candidate.id !== cueId) };
  }
  const baselineCueId = partyWindowBaselineCueId(cueId);
  const endCueId = partyWindowEndCueId(cueId);
  const phases = { ...plan.phases };
  if (phaseId) delete phases[phaseId];
  return {
    ...plan,
    phases,
    cues: plan.cues.filter((candidate) =>
      candidate.id !== cueId
        && candidate.id !== baselineCueId
        && candidate.id !== endCueId
        && !(phaseId
          && candidate.trigger.type === 'phase'
          && candidate.trigger.phase === phaseId
          && candidate.kind === 'ambient'),
    ),
  };
}
