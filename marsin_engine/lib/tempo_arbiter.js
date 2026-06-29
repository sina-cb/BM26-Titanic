/**
 * TempoArbiter — coherent arbitration of the GLOBAL pattern tempo
 * (`mixer.tempoBpm`) between two orthogonal input streams:
 *
 *   1. The live OSC / audio BPM (Audio Companion → OSC `/marsin/audio/bpm`
 *      → CPC key `audioBpm`). When fresh, it AUTO-DRIVES the tempo.
 *   2. The operator's manual TAP (`POST /mixer/tempo {bpm}`), which OVERRIDES
 *      the auto-follow for a fixed hold window so a deliberate hand-set tempo
 *      is honored even while audio keeps streaming.
 *
 * Operator's ruled behaviour ("OSC auto-drives, tap overrides"):
 *
 *   - OSC live  → the engine continuously sets `mixer.tempoBpm` from the OSC
 *     BPM (clamped to [20,400]), but ONLY when the value actually changes
 *     (no per-frame churn / log spam).
 *   - Manual tap → sets the tempo immediately AND arms a manual-override hold
 *     (`_manualOverrideUntilMs = now + MANUAL_HOLD_MS`). While inside that
 *     window the OSC auto-follow MUST NOT overwrite the tempo. After it, if
 *     OSC is still streaming, auto-follow resumes (OSC reclaims).
 *   - OSC idle/stale → auto-follow never fires, so whatever was last set
 *     (tapped or last OSC value) simply holds. No clobber.
 *   - Explicit re-sync → `clearOverride()` drops the hold immediately so OSC
 *     reclaims on the very next tick if live.
 *
 * Liveness: the engine ParamCenter has no per-key timestamp, so this arbiter
 * subscribes to the CPC and records the wall-clock instant `audioBpm` was last
 * written with a finite, positive value (a non-positive value is treated as
 * "no signal", consistent with bpm_speed_sync §6.2 — fail SAFE, never follow a
 * stale/absent tempo). OSC is considered "live" when that instant is within
 * `OSC_STALENESS_MS`. This is a BPM-specific liveness signal (not generic OSC
 * traffic such as `oscStats.lastSeenMs`), so unrelated OSC messages can never
 * masquerade as a fresh tempo.
 *
 * INDEPENDENCE NOTE (do NOT unify): `bpm_speed_sync.js` separately maps
 * `audioBpm` → the SPEED knob (CPC `speed`). That is a DIFFERENT mechanism
 * with a DIFFERENT target. Both may be on at once — that is acceptable and
 * intended. The TempoArbiter drives ONLY `mixer.tempoBpm` (which affects
 * channels with `followsTempo:true`); it never touches `speed`.
 */

// Manual TAP override hold: how long a `POST /mixer/tempo` keeps OSC from
// reclaiming the tempo. 12s — long enough that a deliberate tap "sticks"
// through a few bars while audio keeps streaming, short enough that the
// operator isn't surprised when OSC quietly resumes after they walk away.
export const MANUAL_HOLD_MS = 12000;

// OSC BPM staleness window: a received `audioBpm` is "live" only if it landed
// within this many ms. Reuses the OSC staleness notion (~1500ms) so a paused
// or dropped audio feed stops driving the tempo within ~1.5s.
export const OSC_STALENESS_MS = 1500;

// Engine-supported musical tempo window. OSC-driven values are clamped into
// this range before being applied (the manual TAP route validates the same
// window at the API boundary).
export const TEMPO_MIN_BPM = 20;
export const TEMPO_MAX_BPM = 400;

// Stability deadband (BPM). The Companion emits audioBpm on every analysis
// frame (~50-100/s) and a beat tracker's estimate wobbles a BPM or two even
// when locked. Without damping, the arbiter rewrote mixer.tempoBpm on every
// wobble — so the readout "jumped a lot". Once OSC is driving, we ignore moves
// smaller than this; a genuine tempo change (>= this) still follows. The FIRST
// follow after (re)acquiring OSC or an explicit sync SNAPS regardless, so OSC
// is honored immediately. Applied values are also rounded to an integer BPM
// (the UI shows an integer) so sub-BPM wander never churns the tempo.
export const TEMPO_DEADBAND_BPM = 3;

export class TempoArbiter {
  /**
   * @param {object} deps
   * @param {object} deps.mixer        — PatternMixer (has setTempoBpm / tempoBpm).
   * @param {object} deps.paramCenter  — ParamCenter with subscribe(fn)→unsub.
   * @param {() => number} [deps.clock] — wall-clock ms source (default Date.now).
   *                                       Injectable for deterministic tests.
   */
  constructor({ mixer, paramCenter, clock } = {}) {
    if (!mixer || typeof mixer.setTempoBpm !== 'function') {
      throw new TypeError('TempoArbiter requires a mixer with setTempoBpm()');
    }
    if (!paramCenter || typeof paramCenter.subscribe !== 'function') {
      throw new TypeError('TempoArbiter requires a ParamCenter with subscribe()');
    }
    this._mixer = mixer;
    this._pc = paramCenter;
    this._clock = typeof clock === 'function' ? clock : Date.now;

    // Last finite/positive OSC BPM seen + the wall-clock instant it arrived.
    // null/0 means "never seen a live tempo".
    this._lastOscBpm = null;
    this._lastOscBpmMs = 0;

    // Manual-override hold expiry (wall-clock ms). now < this ⇒ tap owns the
    // tempo and OSC auto-follow is suppressed.
    this._manualOverrideUntilMs = 0;

    // Last value this arbiter pushed into setTempoBpm via auto-follow. Used to
    // suppress redundant setTempoBpm calls (no churn / log spam).
    this._lastAppliedOscBpm = null;

    this._unsubscribe = null;
  }

  /** Subscribe to the CPC to track `audioBpm` freshness. Idempotent. */
  attach() {
    if (this._unsubscribe) return this._unsubscribe;
    this._unsubscribe = this._pc.subscribe((ev) => this._onChange(ev));
    return this._unsubscribe;
  }

  /** Stop subscribing. Idempotent. */
  detach() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /** @private — record the latest live OSC BPM + its arrival time. */
  _onChange(ev) {
    if (!ev || !Array.isArray(ev.changedKeys)) return;
    if (!ev.changedKeys.includes('audioBpm')) return;
    const params = ev.state && ev.state.params;
    if (!params) return;
    const bpm = Number(params.audioBpm?.value);
    // Non-finite or <= 0 means "no signal" (Companion emits 0 when it can't
    // resolve a tempo) — do NOT refresh the liveness clock. Fail SAFE.
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    this._lastOscBpm = bpm;
    this._lastOscBpmMs = this._clock();
  }

  /**
   * Arm the manual-override hold and return the expiry. The caller
   * (`POST /mixer/tempo`) sets the tempo itself via mixer.setTempoBpm; this
   * just starts the window during which OSC auto-follow is suppressed.
   * @param {number} [nowMs] — wall clock; defaults to the injected clock.
   * @returns {number} the new override expiry (ms).
   */
  noteManualTap(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    this._manualOverrideUntilMs = now + MANUAL_HOLD_MS;
    return this._manualOverrideUntilMs;
  }

  /**
   * Drop the manual override immediately so OSC reclaims on the next tick if
   * live (the `POST /mixer/tempo/sync` route).
   */
  clearOverride() {
    this._manualOverrideUntilMs = 0;
    // Forget the last applied OSC value so the next tick SNAPS to the live OSC
    // tempo (the deadband below only suppresses jitter once we're already
    // following). This makes "use OSC" / sync land exactly on the OSC bpm.
    this._lastAppliedOscBpm = null;
  }

  /** True if a live OSC BPM landed within the staleness window. */
  isOscLive(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    return this._lastOscBpm != null
      && (now - this._lastOscBpmMs) <= OSC_STALENESS_MS;
  }

  /** True while a manual tap still owns the tempo. */
  isManualOverrideActive(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    return now < this._manualOverrideUntilMs;
  }

  /**
   * The live OSC BPM (clamped into the supported window) for display, or null
   * when OSC is stale/off. NOT the applied tempo — the raw source value.
   */
  oscTempoBpm(nowMs) {
    if (!this.isOscLive(nowMs)) return null;
    return this._clampBpm(this._lastOscBpm);
  }

  /**
   * Tempo source for UI display:
   *   'osc'    — OSC live AND not in a manual-override window (auto-driving).
   *   'manual' — inside the manual-override window (the tap owns it).
   *   'held'   — OSC stale/off (the last value, tapped or OSC, is just holding).
   */
  deriveSource(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    if (this.isManualOverrideActive(now)) return 'manual';
    if (this.isOscLive(now)) return 'osc';
    return 'held';
  }

  /**
   * Per-frame auto-follow. Composed into the render loop's beforeFrame hook.
   * Hot-path safe: reads two fields + one timestamp compare, allocates
   * nothing, and only calls setTempoBpm when the OSC value actually changed.
   *
   * @param {number} [nowMs] — wall clock; defaults to the injected clock.
   *                            (The beforeFrame hook passes performance.now(),
   *                            which is NOT the same epoch as the Date.now()
   *                            timestamps recorded in _onChange — so the
   *                            engine wiring passes Date.now() explicitly.)
   */
  tick(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    // Manual tap owns the tempo for the hold window — never clobber it.
    if (this.isManualOverrideActive(now)) return;
    // OSC must be live to drive.
    if (!this.isOscLive(now)) return;
    // Round to an integer BPM (the UI shows an integer) so sub-BPM tracker
    // wander never churns the tempo.
    const target = Math.round(this._clampBpm(this._lastOscBpm));
    // Already there (tap matched, or restore) — record + skip the setter.
    if (this._mixer.tempoBpm === target) {
      this._lastAppliedOscBpm = target;
      return;
    }
    // STABILITY DEADBAND: once we're following OSC (a prior applied value
    // exists), ignore jitter smaller than TEMPO_DEADBAND_BPM so the readout
    // stays steady. The first follow after (re)acquire / sync (no prior applied
    // value) snaps so OSC is honored immediately.
    if (this._lastAppliedOscBpm !== null
        && Math.abs(target - this._mixer.tempoBpm) < TEMPO_DEADBAND_BPM) {
      return;
    }
    this._mixer.setTempoBpm(target);
    this._lastAppliedOscBpm = target;
  }

  /** @private — clamp a BPM into the supported musical window. */
  _clampBpm(bpm) {
    if (bpm < TEMPO_MIN_BPM) return TEMPO_MIN_BPM;
    if (bpm > TEMPO_MAX_BPM) return TEMPO_MAX_BPM;
    return bpm;
  }
}
