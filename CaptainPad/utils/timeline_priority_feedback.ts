export type TimelinePriorityPhase = 'preempting' | 'succeeded' | 'failed';

export interface TimelinePriorityFeedback {
  attemptId: number;
  phase: TimelinePriorityPhase;
  operation: string;
  ownerId: string | null;
  detail: string | null;
}

export function beginTimelinePriorityFeedback(
  attemptId: number,
  operation: string,
  liveTouchArmed: boolean,
  ownerId: string | null,
): TimelinePriorityFeedback | null {
  if (!Number.isInteger(attemptId) || attemptId < 1) {
    throw new Error(`Timeline priority attempt id must be a positive integer, got ${attemptId}`);
  }
  if (typeof operation !== 'string' || operation.trim().length === 0) {
    throw new Error('Timeline priority operation is required');
  }
  if (!liveTouchArmed) return null;
  return {
    attemptId,
    phase: 'preempting',
    operation: operation.trim(),
    ownerId,
    detail: null,
  };
}

export function settleTimelinePriorityFeedback(
  current: TimelinePriorityFeedback | null,
  attemptId: number,
  ok: boolean,
  detail: string | null = null,
): TimelinePriorityFeedback | null {
  if (!current || current.attemptId !== attemptId || current.phase !== 'preempting') {
    return current;
  }
  return {
    ...current,
    phase: ok ? 'succeeded' : 'failed',
    detail: ok ? null : detail || 'The engine did not confirm the Live Touch handoff.',
  };
}

export function timelinePriorityFeedbackText(feedback: TimelinePriorityFeedback): string {
  const owner = feedback.ownerId ? ` '${feedback.ownerId}'` : '';
  if (feedback.phase === 'preempting') {
    return `PREEMPTING LIVE TOUCH${owner} — ${feedback.operation}`;
  }
  if (feedback.phase === 'succeeded') {
    return `TIMELINE TOOK PRIORITY — LIVE TOUCH${owner} DISARMED · ${feedback.operation}`;
  }
  return `TIMELINE PRIORITY FAILED — ${feedback.operation} · ${feedback.detail}`;
}
