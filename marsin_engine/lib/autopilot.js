/**
 * Per-channel autopilot pool (docs/19 §11, §13 — Phase 2.3).
 *
 * Pre-2.3 there was a single, deck-bound `Autopilot` daemon: one
 * self-rescheduling setTimeout loop that cycled the deck's playlist.
 * Phase 2.3 promotes that into a POOL of independent loops, one per
 * channel (the deck channel + every mixer overlay channel). Each loop
 * reads ITS OWN channel's `playlist.autopilot` ({active, delay_s,
 * shuffle}) and advances ITS OWN playlist entry, on ITS OWN timer.
 *
 * The proven single-loop machinery is preserved verbatim per channel:
 *
 *   wait delay_s  →  await advance (transition or instant)  →  repeat
 *
 * We use a setTimeout that self-reschedules in the .then() of the
 * advance promise. Every state change (arm / disarm / delay / shuffle)
 * bumps a per-channel `generation` counter; any tick whose captured gen
 * != current gen is a no-op. This makes stop semantics deterministic —
 * disarming a channel clears its timer, and even a tick already sitting
 * in the JS event queue at the moment of the flip reads the new
 * generation and bails before doing work.
 *
 * The advance callback may be sync or return a Promise (the deck's
 * `loadPlaylistEntryWithTransition` returns `{ done: Promise }`); we
 * await it so the inter-pattern timer stays decoupled from transition
 * duration.
 *
 * No fallback / silent behaviour (codex P0): a channel armed with
 * `autopilot.active` but no loaded `playlist.name` simply does nothing
 * (the advance callback short-circuits) — it is not an error.
 */

/**
 * One self-rescheduling autopilot loop bound to a single channel id.
 * Internal to AutopilotPool; not exported on its own.
 */
class ChannelAutopilot {
  /**
   * @param {string} channelId            The channel this loop drives.
   * @param {Function} readStateFn        () => { active, delay_s, shuffle }
   *   Reads the LIVE autopilot sub-state for this channel (e.g. off
   *   `channel.playlist.autopilot`). Never cached — re-read every
   *   schedule/tick so an in-place mutation is always seen.
   * @param {Function} advanceFn          async () => (void | { done: Promise })
   *   Advances this channel to its next playlist entry.
   */
  constructor(channelId, readStateFn, advanceFn) {
    this.channelId = channelId;
    this.readState = readStateFn;
    this.advance = advanceFn;
    this.cycleTimer = null;
    // Bumped on every state change. A scheduled tick captures the
    // current gen at schedule time and bails on execution if it no
    // longer matches — i.e. someone re-armed / disarmed / changed the
    // delay between schedule and fire.
    this.generation = 0;
  }

  get state() {
    const s = this.readState();
    return s || { active: false, delay_s: 30, shuffle: false };
  }

  /**
   * (Re)arm the loop from the channel's current autopilot state. Clears
   * any existing timer first so a state change re-arms ONLY this channel
   * with a clean baseline. A disabled channel ends up with no timer.
   */
  rearm() {
    this.generation++;
    this._scheduleNext();
  }

  /** Clear this channel's timer. Idempotent. */
  clear() {
    this.generation++;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
  }

  _scheduleNext() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (!this.state.active) return;
    const delayMs = (parseInt(this.state.delay_s, 10) || 30) * 1000;
    const gen = this.generation;
    this.cycleTimer = setTimeout(() => this._runTick(gen), delayMs);
  }

  async _runTick(scheduledGen) {
    if (scheduledGen !== this.generation) return; // state changed mid-wait
    if (!this.state.active) return;               // belt-and-suspenders

    try {
      const ret = this.advance();
      // advance() may be sync (no return) or return a Promise (the deck's
      // loadPlaylistEntryWithTransition returns { done: Promise }); accept
      // both — a real Promise to await, or undefined/sync.
      if (ret && typeof ret.then === 'function') {
        await ret;
      }
    } catch (e) {
      console.warn(`[Autopilot:${this.channelId}] tick failed:`, e && e.message ? e.message : e);
    }

    // Re-check after the (possibly seconds-long) advance: a disarm or a
    // re-arm could have landed during it. A new rearm() would have bumped
    // the gen AND scheduled its own next tick, so bailing here avoids a
    // double-schedule.
    if (scheduledGen !== this.generation) return;
    if (!this.state.active) return;
    this._scheduleNext();
  }
}

/**
 * Pool of per-channel autopilot loops, keyed by channel id. The deck is
 * simply the entry whose id is the deck base id — it has no special
 * status inside the pool beyond the advance callback the caller wires
 * for it.
 */
export class AutopilotPool {
  constructor() {
    // channelId -> ChannelAutopilot
    this.loops = new Map();
  }

  /**
   * Register (or replace) a channel's loop. Replacing first clears the
   * existing loop's timer so no orphan fires. Does NOT arm — call
   * `rearm(channelId)` after, or pass nothing and rely on the boot/route
   * arming. Most callers register THEN rearm in one breath via `arm()`.
   *
   * @param {string} channelId
   * @param {Function} readStateFn  () => { active, delay_s, shuffle }
   * @param {Function} advanceFn    async () => void | { done: Promise }
   */
  register(channelId, readStateFn, advanceFn) {
    if (!channelId) throw new Error('AutopilotPool.register requires a channelId');
    const existing = this.loops.get(channelId);
    if (existing) existing.clear();
    this.loops.set(channelId, new ChannelAutopilot(channelId, readStateFn, advanceFn));
    return this.loops.get(channelId);
  }

  /** True iff a loop is registered for this channel id. */
  has(channelId) {
    return this.loops.has(channelId);
  }

  /**
   * Register + arm in one call. Convenience for the route/boot paths
   * that always want the loop live immediately afterwards.
   */
  arm(channelId, readStateFn, advanceFn) {
    this.register(channelId, readStateFn, advanceFn);
    this.rearm(channelId);
  }

  /**
   * (Re)arm an already-registered channel's loop from its current
   * autopilot state. No-op (loud warn) if the channel was never
   * registered — a missing loop means a wiring bug, not a silent skip.
   */
  rearm(channelId) {
    const loop = this.loops.get(channelId);
    if (!loop) {
      console.warn(`[AutopilotPool] rearm('${channelId}') for an unregistered channel — ignoring`);
      return;
    }
    loop.rearm();
  }

  /** Clear+drop a channel's loop entirely (e.g. mixer channel removed). */
  drop(channelId) {
    const loop = this.loops.get(channelId);
    if (!loop) return;
    loop.clear();
    this.loops.delete(channelId);
  }

  /** Read a channel's live autopilot state (or null if not registered). */
  getState(channelId) {
    const loop = this.loops.get(channelId);
    return loop ? loop.state : null;
  }

  /** Clear every loop's timer (engine shutdown). Loops stay registered. */
  clearAll() {
    for (const loop of this.loops.values()) loop.clear();
  }
}
