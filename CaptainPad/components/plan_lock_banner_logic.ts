import type { TimelineState } from '@/utils/timelineApi';

export const PLAN_RUNNING_QUOTES = [
  'Plan is running. Fuck your burn—artistically.',
  'Radical self-reliance includes not touching locked controls.',
  'The playa provides. The Timeline provides on schedule.',
  'Your emergency is not necessarily the cue’s emergency.',
  'Dust is temporary. Bad programming is archived forever.',
  'Trust the plan. It has fewer feelings than the crew.',
  'No spectators. Also no random button mashing.',
  'The Man burns. This cue still has twelve minutes.',
  'Immediacy called. It said wait for the next cue.',
  'Welcome home. Keep your hands off the live deck.',
  'Consent applies to lighting controls too.',
  'Leave no trace, especially not in the active playlist.',
  'The plan has the wheel. Go hydrate dramatically.',
  'You are the dust. The schedule is the mountain.',
  'This is not a bug. It is radical scheduling.',
  'Fuck your burn, but please respect the operator lease.',
  'The lights know what time it is. Do you?',
  'Acculturation complete: stop poking the live rig.',
  'Your vibe is valid. Your unscheduled fade is not.',
  'Ten principles, zero reasons to smash TAKE OVER.',
  'The cue is live. Your opinion can join the waitlist.',
  'Nothing is permanent except playa dust in the faders.',
  'The plan is sober enough to drive.',
  'Do-ocracy ends where the control lock begins.',
  'That button looks delicious. Do not lick it.',
  'The Temple is quiet. This banner is not.',
  'Default world has meetings. We have a running plan.',
  'Blinking lights: intentional. Blinking operator: hydrate.',
  'The schedule abides, even when time is a flat playa.',
  'Current status: art happening; chaos politely queued.',
] as const;

export const PLAN_QUOTE_ROTATE_MS = 12_000;

export function planRunningQuote(nowMs: number): string {
  const slot = Math.floor(Math.max(0, nowMs) / PLAN_QUOTE_ROTATE_MS);
  return PLAN_RUNNING_QUOTES[slot % PLAN_RUNNING_QUOTES.length];
}

export function formatPlanClock(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatMSS(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function planRemainingStatus(
  state: TimelineState | null,
  nowMs: number,
): { label: string; value: string } {
  const untilMs = state?.activeCue?.untilMs ?? state?.activeProgram?.untilMs ?? null;
  if (untilMs !== null && Number.isFinite(untilMs)) {
    return {
      label: 'LEFT',
      value: formatMSS((untilMs - nowMs) / 1000),
    };
  }
  if (!state?.activeCue && typeof state?.nextCue?.inSec === 'number') {
    return {
      label: 'NEXT IN',
      value: formatMSS(state.nextCue.inSec),
    };
  }
  return {
    label: 'WINDOW',
    value: state?.activeCue ? 'OPEN' : 'BASELINE',
  };
}
