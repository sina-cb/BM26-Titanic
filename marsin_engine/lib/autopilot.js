import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'config.yaml');

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
  constructor(listPatternsFn, patternsDir, currentPatternCb, changePatternFn, onScheduleFn) {
    this.listPatterns = listPatternsFn;
    this.patternsDir = patternsDir;
    this.currentPatternCb = currentPatternCb;
    this.changePattern = changePatternFn;
    // The active autopilot PROFILE (timing behaviour). Injected by the host
    // (api_server) via setProfile(). A profile's `nextDelayMs(state)` decides
    // HOW the daemon schedules: a finite number arms the self-rescheduling
    // setTimeout at that delay (the classic `random` timer path); `null` means
    // EVENT-DRIVEN — the daemon arms NO timer and instead waits for the profile
    // to call `requestAdvance()` (e.g. on an audio pulse). Until a profile is
    // injected we default to the legacy fixed-delay timing so an un-wired host
    // still cycles exactly as before. `_profile` never null after boot wiring.
    this._profile = null;
    // Optional hook fired on EVERY (re)schedule — including after each swap — so
    // the server can re-broadcast the fresh next-swap time for the deck
    // countdown (operator request 2026-07-02: show when the next pattern
    // transition lands). Works identically for operator- and plan-driven
    // autopilot: both flow through updateState → _scheduleNext.
    this.onSchedule = typeof onScheduleFn === 'function' ? onScheduleFn : null;
    // Wall-clock ms when the next cycle fires (null when inactive). The deck
    // subtracts Date.now() to render the countdown — same absolute-ms
    // convention as the operator-lease / program countdowns.
    this._nextSwapAtMs = null;
    this.cycleTimer = null;
    // generation counter: bumped on every state change. A scheduled
    // tick captures the current gen at schedule time and bails on
    // execution if it doesn't match — i.e. someone changed state
    // (pause / new delay / new shuffle pick) between schedule and fire.
    this.generation = 0;
    this.config = this.loadConfig();

    if (!this.config.playlist) {
      this.config.playlist = {
        active: false,
        delay_s: "30",
        shuffle: false
      };
      this.saveConfig();
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
      }
    } catch(e) {}
    return {};
  }

  saveConfig() {
    try {
       fs.writeFileSync(CONFIG_FILE, yaml.dump(this.config));
    } catch(e) {}
  }

  get state() {
    return this.config.playlist || { active: false, delay_s: "30", shuffle: false };
  }

  updateState(newState) {
    if (!this.config.playlist) this.config.playlist = {};
    if (newState.active !== undefined) this.config.playlist.active = newState.active;
    if (newState.delay_s !== undefined) this.config.playlist.delay_s = newState.delay_s.toString();
    if (newState.shuffle !== undefined) this.config.playlist.shuffle = newState.shuffle;
    this.saveConfig();
    // Bump generation FIRST so any in-flight tick that's about to
    // execute reads the new generation and bails before doing work.
    this.generation++;
    this._scheduleNext();
  }

  start() {
    this._scheduleNext();
  }

  /**
   * Swap the active timing profile. Bumps the generation (so any in-flight
   * tick bails) and reschedules under the new profile's timing. The profile's
   * attach/detach lifecycle (subscriptions, CPC globals) is owned by the HOST
   * (api_server), not here — this method only governs the daemon's timer.
   */
  setProfile(profile) {
    this._profile = profile || null;
    this.generation++;
    this._scheduleNext();
  }

  /**
   * Compute the next delay in ms from the active profile, or null for an
   * event-driven profile (no timer). Falls back to the legacy fixed-delay
   * timing when no profile is injected, so an un-wired host still cycles as
   * before (parseInt(delay_s)||30 seconds).
   */
  _nextDelayMs() {
    if (this._profile && typeof this._profile.nextDelayMs === 'function') {
      return this._profile.nextDelayMs(this.state);
    }
    return (parseInt(this.state.delay_s, 10) || 30) * 1000;
  }

  /**
   * Schedule the next tick, if active. TIMER profiles arm a setTimeout
   * `delay_s` seconds out (classic behaviour); EVENT-DRIVEN profiles
   * (`nextDelayMs` → null) arm NO timer and rely on `requestAdvance()`.
   * Clears any existing timer first. Captures the current generation so the
   * scheduled callback can bail if state has since changed.
   */
  _scheduleNext() {
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (!this.state.active) {
      this._nextSwapAtMs = null;
      if (this.onSchedule) this.onSchedule();
      return;
    }
    const delayMs = this._nextDelayMs();
    // EVENT-DRIVEN: a null (or non-finite) delay means the profile advances on
    // its own external trigger (audio pulse, etc.), not on a wall-clock timer.
    // Arm no timer; the countdown is meaningless, so surface no next-swap time.
    if (delayMs === null || !Number.isFinite(delayMs)) {
      this._nextSwapAtMs = null;
      if (this.onSchedule) this.onSchedule();
      return;
    }
    const gen = this.generation;
    this._nextSwapAtMs = Date.now() + delayMs;
    this.cycleTimer = setTimeout(() => this._runTick(gen), delayMs);
    if (this.onSchedule) this.onSchedule();
  }

  /**
   * Event-driven advance entry point. A profile calls this (via its ctx) when
   * an external trigger says "advance now". Routes through the SAME _runTick
   * path as the timer so generation guards, await-swap, and the EBUSY skip all
   * still apply. A call while paused or mid-swap is a harmless no-op.
   */
  requestAdvance() {
    return this._runTick(this.generation);
  }

  /** Wall-clock ms when the next pattern swap fires, or null when inactive. */
  get nextSwapAtMs() {
    return this.state.active && typeof this._nextSwapAtMs === 'number' ? this._nextSwapAtMs : null;
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
