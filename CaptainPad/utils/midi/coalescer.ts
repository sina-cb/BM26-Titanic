// Per-control trailing throttle (~30 Hz). A fader sweep emits a CC flood
// (often >200 msgs/s); without coalescing each one becomes a REST POST and
// machine-guns the engine. This collapses them to one dispatch per control
// per ~33 ms window — leading edge fires immediately so the move feels live,
// and the LATEST value is always flushed on the trailing edge so the final
// resting position is never dropped (docs/34 §2 "latest value wins, flushed
// on release"). Discrete (note) events bypass this entirely.
//
// Generic over the payload so it can carry a ResolvedAction (or anything).
// Timers are injectable for deterministic unit tests.

export interface CoalescerTimers {
  setTimeout: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_TIMERS: CoalescerTimers = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h),
};

interface Slot<T> {
  timer: ReturnType<typeof setTimeout> | null;
  pending: T | null;
  hasPending: boolean;
}

export class ControlCoalescer<T> {
  private readonly intervalMs: number;
  private readonly flush: (controlId: string, payload: T) => void;
  private readonly timers: CoalescerTimers;
  private readonly slots = new Map<string, Slot<T>>();
  /** Set once dispose() begins; blocks push()/accumulate() from arming a NEW
   *  timer if the dispose-flush callback re-enters (no timer leak on teardown). */
  private disposed = false;

  constructor(
    intervalMs: number,
    flush: (controlId: string, payload: T) => void,
    timers: CoalescerTimers = DEFAULT_TIMERS,
  ) {
    this.intervalMs = intervalMs;
    this.flush = flush;
    this.timers = timers;
  }

  /** Feed a continuous-control value. Fires immediately if idle, otherwise
   *  stores it as pending to be flushed at the end of the current window. */
  push(controlId: string, payload: T): void {
    const slot = this.slots.get(controlId);
    if (!slot || slot.timer === null) {
      // Leading edge — fire now and open a window.
      this.flush(controlId, payload);
      this.openWindow(controlId);
      return;
    }
    // Inside a window — keep only the latest value.
    slot.pending = payload;
    slot.hasPending = true;
  }

  /** Feed a value that must ACCUMULATE across a window rather than last-write-
   *  wins (relative-encoder deltas — every tick counts, none may be dropped).
   *
   *  Unlike push(), this does NOT fire a leading edge: a relative delta is
   *  applied to the value as it is AT FLUSH TIME, so firing the first tick early
   *  and then flushing the accumulated sum (which re-reads the value) would
   *  double-apply the first tick. Instead every tick — including the first —
   *  folds into the pending payload via `combine` and a window is armed; the
   *  single accumulated payload flushes on the trailing edge (~one window later)
   *  and the slot resets. A lone detent still flushes on that first window.
   *
   *  `combine(existing, incoming)` merges two same-control payloads (e.g. sums
   *  their deltas); it is not called for the first tick of a window. */
  accumulate(controlId: string, payload: T, combine: (existing: T, incoming: T) => T): void {
    const slot = this.slots.get(controlId) ?? { timer: null, pending: null, hasPending: false };
    slot.pending = slot.hasPending && slot.pending !== null ? combine(slot.pending, payload) : payload;
    slot.hasPending = true;
    this.slots.set(controlId, slot);
    if (slot.timer === null) this.openWindow(controlId);
  }

  private openWindow(controlId: string): void {
    if (this.disposed) return; // teardown in progress — never arm a new timer
    const existing = this.slots.get(controlId);
    const slot: Slot<T> = existing ?? { timer: null, pending: null, hasPending: false };
    slot.timer = this.timers.setTimeout(() => this.onWindowEnd(controlId), this.intervalMs);
    this.slots.set(controlId, slot);
  }

  private onWindowEnd(controlId: string): void {
    const slot = this.slots.get(controlId);
    if (!slot) return;
    slot.timer = null;
    if (slot.hasPending && slot.pending !== null) {
      const payload = slot.pending;
      slot.pending = null;
      slot.hasPending = false;
      // Trailing flush of the latest value, then re-open a window so a still
      // moving fader keeps trickling at the throttled rate.
      this.flush(controlId, payload);
      this.openWindow(controlId);
    }
  }

  /** Cancel a SINGLE control's pending slot + timer without flushing it. Used
   *  by the encoder-push reset path to drop a same-encoder pending TURN so the
   *  reset write isn't immediately clobbered by a stale accumulated delta
   *  (the reset/turn race — do NOT merge key namespaces, which would break
   *  combine()'s same-kind invariant). No-op when the slot is idle/absent. */
  cancel(controlId: string): void {
    const slot = this.slots.get(controlId);
    if (!slot) return;
    if (slot.timer !== null) this.timers.clearTimeout(slot.timer);
    this.slots.delete(controlId);
  }

  /** FLUSH every pending trailing value, then cancel all timers (teardown).
   *  The module contract is "the final resting position is never dropped"
   *  (§ top-of-file), so a dispose mid-window must emit the last pending value,
   *  not silently discard it. Timers are cleared and slots cleared FIRST so a
   *  flush callback that re-enters push()/accumulate() can't re-arm a timer we
   *  then leak. */
  dispose(): void {
    this.disposed = true; // block re-entrant push()/accumulate() from re-arming
    const drained: Array<[string, T]> = [];
    for (const [controlId, slot] of this.slots) {
      if (slot.timer !== null) this.timers.clearTimeout(slot.timer);
      if (slot.hasPending && slot.pending !== null) drained.push([controlId, slot.pending]);
    }
    this.slots.clear();
    for (const [controlId, payload] of drained) this.flush(controlId, payload);
  }
}
