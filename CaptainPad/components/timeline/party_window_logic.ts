import type {
  ActionPlaylist,
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

function partyWindowEndDays(days: PlanCue['days'], plan: ShowPlan): PlanCue['days'] | null {
  if (days === undefined || days === 'all') return 'all';
  if (days.length === 0) return days;
  if (typeof days[0] === 'number') {
    const max = plan.festival ? plan.festival.days - 1 : Number.MAX_SAFE_INTEGER;
    const shifted = (days as number[]).map((day) => day + 1).filter((day) => day <= max);
    return shifted.length > 0 ? shifted : null;
  }
  return (days as string[]).map((date) => addDate(date, 1));
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
  const endDays = partyWindowEndDays(cue.days, plan);
  const endCue: PlanCue | null = endDays === null ? null : {
    id: endCueId,
    label: 'Default after Party Window',
    enabled: cue.enabled,
    kind: 'ambient',
    trigger: { type: 'clock', at: endAt },
    action: plan.defaultCue.action,
    days: endDays,
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
    cues: [...cues, baselineCue, ...(endCue ? [endCue] : []), partyCue],
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
