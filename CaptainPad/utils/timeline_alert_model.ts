export type TimelineAlertTone = 'danger' | 'warning' | 'info' | 'success';

export interface TimelineAlert {
  key: string;
  tone: TimelineAlertTone;
  title: string;
  detail: string;
}

export interface TimelineAlertInputs {
  connected: boolean;
  receivedAtMs: number | null;
  nowMs: number;
  timelineError?: string | null;
  actionError?: string | null;
  planWarnings?: readonly unknown[] | null;
  priorityMessage?: string | null;
  priorityFailed?: boolean;
  performanceViewOnly?: boolean;
  liveTouchActive?: boolean;
  liveTouchOwner?: string | null;
  zoomActive?: boolean;
  zoomScope?: string | null;
  saveError?: string | null;
  activePlanHotReload?: boolean;
}

export const TIMELINE_STALE_AFTER_MS = 10_000;

export function timelinePlanWarningMessage(warning: unknown): string {
  if (typeof warning === 'string' && warning.trim()) return warning.trim();
  if (warning && typeof warning === 'object') {
    const candidate = warning as {
      message?: unknown;
      code?: unknown;
      cueId?: unknown;
    };
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
    if (typeof candidate.code === 'string' && candidate.code.trim()) {
      const cueSuffix = typeof candidate.cueId === 'string' && candidate.cueId.trim()
        ? ` (${candidate.cueId.trim()})`
        : '';
      return `${candidate.code.trim()}${cueSuffix}`;
    }
  }
  return 'The active plan reported an unknown validation warning.';
}

/** Return exactly one highest-priority operator alert. */
export function primaryTimelineAlert(input: TimelineAlertInputs): TimelineAlert | null {
  if (!input.connected) {
    return {
      key: 'offline',
      tone: 'danger',
      title: 'ENGINE OFFLINE',
      detail: 'Live state is unavailable. All Timeline actions are disabled.',
    };
  }

  if (input.receivedAtMs === null || input.nowMs - input.receivedAtMs > TIMELINE_STALE_AFTER_MS) {
    const ageSec = input.receivedAtMs === null
      ? null
      : Math.max(0, Math.floor((input.nowMs - input.receivedAtMs) / 1000));
    return {
      key: 'stale',
      tone: 'danger',
      title: 'TIMELINE DATA STALE',
      detail: ageSec === null
        ? 'Waiting for the first authoritative Timeline state.'
        : `Last authoritative Timeline state was ${ageSec}s ago. Actions are disabled.`,
    };
  }

  if (input.timelineError || input.actionError) {
    return {
      key: 'rejected',
      tone: 'danger',
      title: 'TIMELINE ACTION REJECTED',
      detail: input.actionError || input.timelineError || 'The engine rejected the request.',
    };
  }

  if (input.planWarnings && input.planWarnings.length > 0) {
    return {
      key: 'invalid-plan',
      tone: 'danger',
      title: 'ACTIVE PLAN HAS WARNINGS',
      detail: timelinePlanWarningMessage(input.planWarnings[0]),
    };
  }

  if (input.priorityMessage) {
    return {
      key: 'priority-handoff',
      tone: input.priorityFailed ? 'danger' : 'warning',
      title: input.priorityFailed ? 'HANDOFF FAILED' : 'OWNERSHIP HANDOFF',
      detail: input.priorityMessage,
    };
  }

  if (input.performanceViewOnly) {
    return {
      key: 'performance-view-only',
      tone: 'warning',
      title: 'PERFORMANCE MODE · VIEW ONLY',
      detail: 'Timeline stays visible, but operator mutations remain locked because these engine routes are not passcode-gated.',
    };
  }

  if (input.liveTouchActive) {
    return {
      key: 'live-touch',
      tone: 'warning',
      title: 'LIVE TOUCH OWNS CONTROL',
      detail: input.liveTouchOwner
        ? `Timeline action will request handoff from ${input.liveTouchOwner}.`
        : 'Timeline action will request a control handoff.',
    };
  }

  if (input.zoomActive) {
    return {
      key: 'zoom',
      tone: 'info',
      title: input.zoomScope === 'travel' ? 'TIME TRAVEL ACTIVE' : 'OPERATOR PERFORMANCE ACTIVE',
      detail: 'Timeline autopilot is paused until RESUME LIVE.',
    };
  }

  if (input.activePlanHotReload) {
    return {
      key: 'hot-reload',
      tone: 'warning',
      title: 'EDITING ACTIVE PLAN! :)',
      detail: '',
    };
  }

  if (input.saveError) {
    return {
      key: 'save-error',
      tone: 'danger',
      title: 'DRAFT NOT SAVED',
      detail: input.saveError,
    };
  }

  return null;
}
