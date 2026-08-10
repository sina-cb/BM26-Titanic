import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Persistence target. Tests (and any harness that must not mutate the tracked,
// comment-bearing config.yaml) set MARSIN_CONFIG_FILE to a scratch copy; the
// spawned engine inherits it. Unset in production → the real config.yaml.
const CONFIG_FILE = process.env.MARSIN_CONFIG_FILE || path.join(__dirname, '..', 'config.yaml');
// RUNTIME STATE LIVES BESIDE THE CONFIG, NEVER INSIDE IT.
//
// `active` / `delay_s` / `shuffle` change constantly while a show runs — every
// arm, every disarm, every deadman fire and every crash-boot revert sets them.
// They were being written straight back into config.yaml, which is TRACKED and
// comment-bearing, and `yaml.dump` rewrites the whole document: so normal show
// operation produced git diffs on the show server AND silently destroyed the
// file's comments (this is what kept turning `triggerMask: 0x07` into `7`).
//
// Config is what the operator chose; runtime state is what the show is doing.
// Splitting them keeps config.yaml pristine while persistence across restarts
// is unchanged — loadConfig overlays this file on top of the config below.
// Same precedent as the gitignored states/*/timeline_state.yaml.
// Derived from CONFIG_FILE so a test pointing at a scratch config automatically
// gets a scratch runtime file too.
const RUNTIME_FILE = CONFIG_FILE.replace(/\.ya?ml$/i, '') + '.autopilot_runtime.yaml';

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
    let cfg = {};
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        cfg = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
      }
    } catch(e) {}
    // Overlay the last RUNTIME playlist state on top of the configured default,
    // so active/delay/shuffle still survive a restart exactly as before — they
    // are just no longer stored in the tracked file.
    try {
      if (fs.existsSync(RUNTIME_FILE)) {
        const rt = yaml.load(fs.readFileSync(RUNTIME_FILE, 'utf8')) || {};
        if (rt && rt.playlist && typeof rt.playlist === 'object') {
          cfg.playlist = { ...(cfg.playlist || {}), ...rt.playlist };
        }
      }
    } catch(e) {}
    return cfg;
  }

  saveConfig() {
    // ONLY the runtime playlist block, and ONLY to the runtime file. config.yaml
    // is never written here — see the RUNTIME_FILE note at the top of this file.
    try {
      fs.writeFileSync(RUNTIME_FILE, yaml.dump({ playlist: this.config.playlist || {} }));
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
   * Runtime-only pause — used by the boot `--pattern` pin (operator-intent
   * ruling, see api_server's bootPatternPinDecision). Sets the in-memory
   * active flag false WITHOUT persisting to config.yaml: the on-disk value
   * is operator state, and only an explicit operator toggle
   * (updateState({active}), which saves) may rewrite it. Bumps the
   * generation so any in-flight tick bails, then reschedules — which, with
   * active now false, clears the timer and broadcasts the inactive state
   * via onSchedule.
   */
  suspend() {
    if (!this.config.playlist) this.config.playlist = {};
    this.config.playlist.active = false;
    this.generation++;
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
