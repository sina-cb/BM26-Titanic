// timeline_draft_saver — single-flight, latest-wins Timeline plan persistence.
//
// Timeline maker edits are debounced by the screen, but HTTP writes can outlive
// that debounce. Without a queue, a slow older save can land after a newer one
// and put stale plan content back on disk. This coordinator permits exactly one
// request at a time, keeps the newest unsaved draft after a rejection, and only
// reports SAVED for the version the engine actually acknowledged.

export interface TimelineDraftSaveResult {
  ok: boolean;
  error?: string;
  status?: number;
  data?: unknown;
}

export type TimelineDraftSaveFailureKind =
  | 'live_touch_held'
  | 'stale_owner'
  | 'priority_handoff'
  | 'invalid'
  | 'transport';

export interface TimelineDraftSaveFailure {
  kind: TimelineDraftSaveFailureKind;
  title: string;
  detail: string;
}

export type TimelineDraftSaveEvent =
  | { phase: 'pending'; version: number }
  | { phase: 'saving'; version: number }
  | { phase: 'saved'; version: number }
  | { phase: 'error'; version: number; result: TimelineDraftSaveResult };

interface QueuedDraft<T> {
  version: number;
  draft: T;
}

function errorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function heldBy(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const owner = (data as { heldBy?: unknown }).heldBy;
  return typeof owner === 'string' && owner.length > 0 ? owner : null;
}

export function describeTimelineDraftSaveFailure(
  result: TimelineDraftSaveResult,
): TimelineDraftSaveFailure {
  const code = errorCode(result.data);
  if (code === 'TOUCH_CONTROL_LEASE_HELD') {
    const owner = heldBy(result.data);
    return {
      kind: 'live_touch_held',
      title: 'NOT SAVED — LIVE TOUCH IS ARMED',
      detail: owner
        ? `Live Touch owner '${owner}' has the rig. Your draft is kept on this pad and will retry after DISARM.`
        : 'Live Touch has the rig. Your draft is kept on this pad and will retry after DISARM.',
    };
  }
  if (code === 'TOUCH_CONTROL_LEASE_INACTIVE') {
    return {
      kind: 'stale_owner',
      title: 'NOT SAVED — OWNER LEASE EXPIRED',
      detail: 'The request carried a stale Live Touch owner. The draft is still on this pad; reconnect and retry.',
    };
  }
  if (code === 'TIMELINE_LIVE_TOUCH_PREEMPT_FAILED') {
    return {
      kind: 'priority_handoff',
      title: 'NOT SAVED — TIMELINE PRIORITY FAILED',
      detail: `${result.error || 'The engine did not confirm the Live Touch handoff.'} `
        + 'The draft is still on this pad and was not applied; retry after resolving the engine error.',
    };
  }
  if (result.status === 400) {
    return {
      kind: 'invalid',
      title: 'NOT SAVED — DRAFT INVALID',
      detail: result.error || 'The engine rejected this plan. Fix the draft and retry.',
    };
  }
  return {
    kind: 'transport',
    title: 'NOT SAVED',
    detail: `${result.error || 'The engine did not confirm the write.'} Your draft is still on this pad; retry when the engine is reachable.`,
  };
}

export class TimelineDraftSaver<T> {
  private pending: QueuedDraft<T> | null = null;
  private inFlight = false;
  private disposed = false;
  private lastSavedVersion: number | null = null;
  private invalidatedThroughVersion = -1;
  private retryAfterFlight = false;

  constructor(
    private readonly save: (draft: T) => Promise<TimelineDraftSaveResult>,
    private readonly onEvent: (event: TimelineDraftSaveEvent) => void,
  ) {}

  markSaved(version: number): void {
    this.requireVersion(version);
    if (this.lastSavedVersion !== null && version < this.lastSavedVersion) return;
    this.lastSavedVersion = version;
    this.invalidatedThroughVersion = Math.max(this.invalidatedThroughVersion, version);
    if (this.pending && this.pending.version <= version) this.pending = null;
    if (!this.disposed) this.onEvent({ phase: 'saved', version });
  }

  enqueue(version: number, draft: T): void {
    this.requireVersion(version);
    if (this.disposed) return;
    if (this.lastSavedVersion !== null && version <= this.lastSavedVersion) return;
    if (!this.pending || version >= this.pending.version) {
      this.pending = { version, draft };
      this.onEvent({ phase: 'pending', version });
    }
  }

  async flush(): Promise<void> {
    if (this.disposed || this.inFlight || !this.pending) return;
    const attempt = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.onEvent({ phase: 'saving', version: attempt.version });

    let result: TimelineDraftSaveResult;
    try {
      result = await this.save(attempt.draft);
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.inFlight = false;
    if (this.disposed) return;
    const retryAfterFlight = this.retryAfterFlight;
    this.retryAfterFlight = false;
    const queuedAfterAttempt = this.currentPending();

    // Loading/acknowledging a newer plan or invalidating the current draft can
    // happen while an older request is in flight. Its late response no longer
    // has authority to regress saved state or resurrect an obsolete draft.
    if (attempt.version <= this.invalidatedThroughVersion) {
      if (queuedAfterAttempt) await this.flush();
      return;
    }

    if (result.ok) {
      this.lastSavedVersion = this.lastSavedVersion === null
        ? attempt.version
        : Math.max(this.lastSavedVersion, attempt.version);
      if (queuedAfterAttempt && queuedAfterAttempt.version > attempt.version) {
        await this.flush();
        return;
      }
      this.onEvent({ phase: 'saved', version: attempt.version });
      return;
    }

    const newerPending = !!queuedAfterAttempt && queuedAfterAttempt.version > attempt.version;
    if (newerPending) {
      await this.flush();
      return;
    }
    this.pending = attempt;
    this.onEvent({
      phase: 'error',
      version: attempt.version,
      result,
    });
    // A DISARM/reconnect may arrive while the refused request is still in
    // flight. Remember that edge and retry after the refusal has restored the
    // exact draft; otherwise the one recovery signal is lost.
    if (retryAfterFlight) await this.flush();
  }

  retry(): Promise<void> {
    if (this.inFlight) {
      this.retryAfterFlight = true;
      return Promise.resolve();
    }
    return this.flush();
  }

  hasPending(): boolean {
    return this.pending !== null || this.inFlight;
  }

  discardPending(version: number): void {
    this.requireVersion(version);
    this.pending = null;
    this.retryAfterFlight = false;
    this.invalidatedThroughVersion = Math.max(this.invalidatedThroughVersion, version);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  private requireVersion(version: number): void {
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(`Timeline draft version must be a non-negative integer, got ${version}`);
    }
  }

  private currentPending(): QueuedDraft<T> | null {
    return this.pending;
  }
}
