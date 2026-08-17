/**
 * pixel_paint_scheduler — one shared, budgeted, round-robin painter for every
 * pixel-view canvas on screen (docs/58 §4.2).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Report _239 measured the paint this scheduler governs: a 720-glyph top-down
 * ship costs 1.8-2.6 ms median (p95 3.5 ms) per canvas, and that cost is per
 * GLYPH DRAWN — independent of both the transmitted sample count and the
 * canvas's CSS size. The mixer can put NINE of those canvases on screen at
 * once (8 channels + master). Painted synchronously inside one vis callback
 * that is ~20 ms of main thread, five times a second — a stolen fader frame,
 * every 200 ms, which is exactly the "mixer feels laggy" complaint the viz
 * architecture was rebuilt to kill.
 *
 * So the vis callback does NOT paint. It writes the frame into the
 * subscriber's own ref and asks the scheduler for a turn. One
 * requestAnimationFrame drains the queue round-robin, stops at PAINT_BUDGET_MS
 * and requeues the rest for the next frame. Worst case (9 canvases ≈ 20 ms)
 * spreads over ~3 animation frames ≈ 48 ms — every canvas still repaints well
 * inside one 200 ms vis period, and no single frame carries more than half its
 * 16 ms.
 *
 * ── LATEST-BUFFER-WINS, NOT A FRAME QUEUE ───────────────────────────────────
 *
 * The scheduler carries NO pixel data. A subscriber owns its own latest frame
 * (a ref its vis callback overwrites) and the scheduler only owns "this
 * subscriber owes a paint". A deferred canvas therefore never paints a stale
 * frame — it paints the CURRENT one, later. Enqueueing twice before a drain is
 * a no-op for the same reason: there is only ever one debt per subscriber.
 *
 * ── VISIBILITY GATING ───────────────────────────────────────────────────────
 *
 * `isVisible()` is asked at DRAIN time, not at enqueue time: a band that
 * collapsed, unmounted, scrolled out of the strip row, or whose tab went
 * hidden between the vis frame and its turn must cost 0 ms. That is what makes
 * an 8-channel scrolled row cheap in practice — only the strips actually on
 * screen ever draw.
 *
 * ── PURE, AND TESTED WITH A FAKE CLOCK ──────────────────────────────────────
 *
 * The class takes its clock and its frame scheduler by injection, so the
 * budget cutoff, the round-robin fairness and the unsubscribe semantics are
 * unit-tested deterministically with no browser. `sharedPixelPaintScheduler()`
 * builds the one real instance and FAILS LOUDLY if the platform has no
 * requestAnimationFrame / performance.now — both the browser and React Native
 * provide them (the bands paint on BOTH since report _252), so a missing
 * primitive is a bug to hear, never a setTimeout substitution (codex P0).
 */

/** Milliseconds of main thread one drain may consume before yielding. Half a
 *  60 Hz frame: the fader drag that shares this thread keeps the other half. */
export const PAINT_BUDGET_MS = 8;

export interface PaintSubscriber {
  /** Draw the subscriber's CURRENT frame. Called at most once per drain. */
  paint: () => void;
  /** Asked at drain time. False ⇒ skip entirely (costs nothing). */
  isVisible: () => boolean;
}

/** The two platform primitives, injected so tests can drive them. */
export interface PaintClock {
  now: () => number;
  /** Run `cb` on the next animation frame. */
  schedule: (cb: () => void) => void;
}

export interface PaintSchedulerStats {
  /** How many drains have run. */
  drains: number;
  /** How many paints have actually happened. */
  paints: number;
  /** How many turns were skipped because the subscriber was invisible. */
  skipped: number;
  /** Wall time of the most recent drain, in ms. */
  lastDrainMs: number;
  /** Worst drain seen since the last `resetStats()`. */
  maxDrainMs: number;
  /** Drains that hit the budget and deferred work to a later frame. */
  deferrals: number;
  /** Subscribers still queued at the end of the last drain. */
  lastCarryOver: number;
}

interface Handle {
  sub: PaintSubscriber;
  queued: boolean;
  dead: boolean;
}

export class PixelPaintScheduler {
  private readonly clock: PaintClock;
  private readonly budgetMs: number;
  /** FIFO of subscribers owing a paint. A subscriber that just painted only
   *  re-enters at the BACK when its next frame arrives, which is what makes
   *  the drain round-robin rather than starving the tail of the list. */
  private queue: Handle[] = [];
  private framePending = false;
  private stats: PaintSchedulerStats = emptyStats();

  constructor(clock: PaintClock, budgetMs: number = PAINT_BUDGET_MS) {
    if (!(budgetMs > 0)) {
      throw new Error(`[PixelPaintScheduler] budgetMs must be positive, got ${budgetMs}`);
    }
    this.clock = clock;
    this.budgetMs = budgetMs;
  }

  /**
   * Register a canvas. Returns `{ request, release }`:
   *   `request()` — "I have a new frame in my ref, give me a turn."
   *   `release()` — unsubscribe; any pending turn is dropped.
   */
  subscribe(sub: PaintSubscriber): { request: () => void; release: () => void } {
    const handle: Handle = { sub, queued: false, dead: false };
    return {
      request: () => this.request(handle),
      release: () => {
        handle.dead = true;
        handle.queued = false;
      },
    };
  }

  private request(handle: Handle): void {
    if (handle.dead || handle.queued) return;
    handle.queued = true;
    this.queue.push(handle);
    if (!this.framePending) {
      this.framePending = true;
      this.clock.schedule(() => this.drain());
    }
  }

  /** Drain one animation frame's worth of work. Public for the tests + the
   *  paint-budget measurement harness; production only ever reaches it
   *  through the scheduled callback. */
  drain(): void {
    this.framePending = false;
    const start = this.clock.now();
    let hitBudget = false;

    while (this.queue.length > 0) {
      const handle = this.queue.shift() as Handle;
      handle.queued = false;
      if (handle.dead) continue;
      if (!handle.sub.isVisible()) {
        this.stats.skipped += 1;
        continue;
      }
      handle.sub.paint();
      this.stats.paints += 1;
      // Budget is checked AFTER a paint, never before: the point is to stop
      // adding work once the frame is spent, not to refuse the first canvas.
      if (this.clock.now() - start >= this.budgetMs) {
        hitBudget = true;
        break;
      }
    }

    const elapsed = this.clock.now() - start;
    this.stats.drains += 1;
    this.stats.lastDrainMs = elapsed;
    if (elapsed > this.stats.maxDrainMs) this.stats.maxDrainMs = elapsed;
    this.stats.lastCarryOver = this.queue.length;
    if (hitBudget) this.stats.deferrals += 1;

    // Anything left over rides the next frame — with whatever buffer it holds
    // by then, which is the freshest one (latest-buffer-wins).
    if (this.queue.length > 0 && !this.framePending) {
      this.framePending = true;
      this.clock.schedule(() => this.drain());
    }
  }

  /** Number of subscribers currently owing a paint. */
  pendingCount(): number {
    return this.queue.length;
  }

  getStats(): PaintSchedulerStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = emptyStats();
  }
}

function emptyStats(): PaintSchedulerStats {
  return {
    drains: 0,
    paints: 0,
    skipped: 0,
    lastDrainMs: 0,
    maxDrainMs: 0,
    deferrals: 0,
    lastCarryOver: 0,
  };
}

let _shared: PixelPaintScheduler | null = null;

type PixelPaintRuntime = {
  navigator?: { product?: string };
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  setImmediate?: (cb: () => void) => unknown;
  performance?: { now?: () => number };
};

/** React Native exposes navigator.product = 'ReactNative' on Hermes/JSC. */
export function isReactNativePixelPaintRuntime(runtime: PixelPaintRuntime): boolean {
  return runtime.navigator?.product === 'ReactNative';
}

/**
 * Build the platform's real scheduling clock. Web paints on the display frame.
 * React Native deliberately uses the next JS turn: Expo's native rAF is tied
 * to the UI frame loop and can defer these paints until unrelated UI work,
 * even while fresh visualization buffers keep arriving.
 */
export function createPixelPaintClock(runtime: PixelPaintRuntime): PaintClock {
  const now = runtime.performance?.now
    ? runtime.performance.now.bind(runtime.performance)
    : null;
  if (now === null) {
    throw new Error('[PixelPaintScheduler] this platform has no performance.now');
  }

  if (isReactNativePixelPaintRuntime(runtime)) {
    const immediate = runtime.setImmediate;
    if (typeof immediate !== 'function') {
      throw new Error(
        '[PixelPaintScheduler] React Native has no setImmediate — native pixel '
        + 'views require a next-turn JS clock',
      );
    }
    return { now, schedule: (cb) => { immediate(cb); } };
  }

  const raf = runtime.requestAnimationFrame;
  if (typeof raf !== 'function') {
    throw new Error(
      '[PixelPaintScheduler] this browser has no requestAnimationFrame — web '
      + 'pixel views require the display frame clock',
    );
  }
  return { now, schedule: (cb) => { raf(cb); } };
}

/**
 * The ONE scheduler every band shares — sharing is the whole point, since a
 * per-band scheduler would give each canvas its own 8 ms and reinstate the
 * 20 ms burst this exists to prevent.
 */
export function sharedPixelPaintScheduler(): PixelPaintScheduler {
  if (_shared) return _shared;
  _shared = new PixelPaintScheduler(createPixelPaintClock(globalThis as PixelPaintRuntime));
  return _shared;
}

/** Test seam: drop the shared instance so a suite can install its own clock. */
export function resetSharedPixelPaintScheduler(): void {
  _shared = null;
}
