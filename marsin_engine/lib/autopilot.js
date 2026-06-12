// Persisted runtime state shape (autopilot_state.yaml). Historically
// this lived as the `playlist:` block inside config.yaml — which meant
// every PLAY/PAUSE tap rewrote the engine's tracked settings file. Now
// the state rides the gitignored runtime dir via an injected store
// (see api_server.js), and config.yaml is read-only at runtime.
const DEFAULT_STATE = { active: false, delay_s: '30', shuffle: false };

/**
 * Autopilot daemon — cycles the deck's pattern on a self-rescheduling
 * timer.
 *
 * Why setTimeout (not setInterval):
 *   The interval-based version (pre-May 2026) fired every `delay_s`
 *   regardless of whether the previous pattern swap had finished. With
 *   the new soft-swap transitions a swap can take 5 s, so a 1 s delay
 *   would fire while the previous transition was mid-air — overlapping
 *   transitions, dropped picks, the works.
 *
 *   New model:
 *     wait delay_s  →  await swap (transition or instant)  →  repeat
 *
 *   We use setTimeout that self-reschedules in the .then() of the swap
 *   promise. Every state change (PLAY/PAUSE/delay/shuffle) bumps a
 *   `generation` counter; any tick whose captured gen != current gen
 *   is a no-op. This makes stop semantics deterministic — when you
 *   pause the autopilot, no further cycles run, even if a tick was
 *   waiting in the JS event queue at the moment you flipped the toggle.
 *
 *   `changePattern()` (the callback from api_server.js) may return a
 *   Promise; we await it. The Promise resolves on transition complete
 *   (or immediately if transitions are disabled).
 */
export class Autopilot {
  /**
   * @param store — { load(): object|null, save(state): void } persistence
   *   for the autopilot's {active, delay_s, shuffle} state. api_server
   *   wires this to states/<model>/autopilot_state.yaml via StateManager.
   */
  constructor(listPatternsFn, patternsDir, currentPatternCb, changePatternFn, store) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
      throw new Error('Autopilot requires a state store ({ load, save })');
    }
    this.listPatterns = listPatternsFn;
    this.patternsDir = patternsDir;
    this.currentPatternCb = currentPatternCb;
    this.changePattern = changePatternFn;
    this.store = store;
    this.cycleTimer = null;
    // generation counter: bumped on every state change. A scheduled
    // tick captures the current gen at schedule time and bails on
    // execution if it doesn't match — i.e. someone changed state
    // (pause / new delay / new shuffle pick) between schedule and fire.
    this.generation = 0;

    const loaded = this.store.load();
    this._state = (loaded && typeof loaded === 'object')
      ? {
          active: !!loaded.active,
          delay_s: String(loaded.delay_s ?? DEFAULT_STATE.delay_s),
          shuffle: !!loaded.shuffle,
        }
      : { ...DEFAULT_STATE };
    // Write the file on first boot so the state is visible in the
    // runtime dir (and gets captured by /state/promote) even before
    // the operator touches the controls.
    if (!loaded) this.store.save(this._state);
  }

  get state() {
    return this._state;
  }

  updateState(newState) {
    if (newState.active !== undefined) this._state.active = newState.active;
    if (newState.delay_s !== undefined) this._state.delay_s = newState.delay_s.toString();
    if (newState.shuffle !== undefined) this._state.shuffle = newState.shuffle;
    this.store.save(this._state);
    // Bump generation FIRST so any in-flight tick that's about to
    // execute reads the new generation and bails before doing work.
    this.generation++;
    this._scheduleNext();
  }

  start() {
    this._scheduleNext();
  }

  /**
   * Schedule the next tick `delay_s` seconds from now, if active.
   * Clears any existing timer first. Captures the current generation
   * so the scheduled callback can bail if state has since changed.
   */
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

  /**
   * Execute one pattern advance. Bails if state has changed since
   * schedule time. After the swap completes (whether instant or
   * post-transition), schedule the next tick if still active.
   */
  async _runTick(scheduledGen) {
    if (scheduledGen !== this.generation) return;   // state changed mid-wait
    if (!this.state.active) return;                  // belt-and-suspenders

    try {
      const ret = this.changePattern();
      // Callback may be sync (no return) or return a Promise (the new
      // loadPlaylistEntryWithTransition returns { done: Promise }).
      // We accept both: a real Promise to await, or undefined/sync.
      if (ret && typeof ret.then === 'function') {
        await ret;
      }
    } catch (e) {
      console.warn('[Autopilot] tick failed:', e && e.message ? e.message : e);
    }

    // Re-check state — the swap could have taken seconds, and the
    // operator may have hit PAUSE during it. Also confirm gen still
    // matches: a new updateState would have bumped it AND scheduled
    // its own next tick, so we should not double-schedule.
    if (scheduledGen !== this.generation) return;
    if (!this.state.active) return;
    this._scheduleNext();
  }

  // ── Back-compat shim ─────────────────────────────────────────────
  // External callers (older tests, hot-reload tools) used to call
  // `triggerNext()` to manually advance one step. Kept as a no-await
  // pass-through so they still work, but new code should rely on the
  // self-scheduled cycle.
  triggerNext() {
    return this._runTick(this.generation);
  }
}
