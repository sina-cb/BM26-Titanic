/**
 * TempoArbiter — coherent arbitration of the GLOBAL pattern tempo
 * (`mixer.tempoBpm`) between two input streams, governed by a STICKY operator
 * source preference (`mixer.tempoSourcePref`, 'osc' | 'tap'):
 *
 *   1. The live OSC / audio BPM (Audio Companion → OSC `/marsin/audio/bpm`
 *      → CPC key `audioBpm`).
 *   2. The operator's manual TAP (`POST /mixer/tempo {bpm}`).
 *
 * STICKY-SOURCE behaviour (operator request 2026-06-29 — replaces the old
 * "tap overrides for 12s then OSC reclaims" auto-revert, which made the source
 * jump OSC↔TAP whenever a tap landed or OSC liveness flapped):
 *
 *   - pref === 'osc' → the engine sets `mixer.tempoBpm` to the RAW live OSC BPM
 *     (clamped to [20,400]) verbatim — the system tempo IS the OSC value, with
 *     no deadband, so the applied tempo never lags or differs from the OSC
 *     readout. (Stability comes from the Companion's Kalman-smoothed INTEGER
 *     emit, not from quantizing here.) Only redundant identical sets are
 *     skipped. The selection STAYS on OSC; a brief OSC dropout reads as `held`
 *     (the selector still shows OSC), never a flip to TAP.
 *   - pref === 'tap' → OSC auto-follow is fully suppressed; the manually
 *     set/tapped tempo HOLDS indefinitely. Stable until the operator picks OSC.
 *   - A manual TAP (`POST /mixer/tempo`) implies the operator is hand-driving,
 *     so it sets pref → 'tap' (sticky). "Use OSC" (`clearOverride` / select
 *     OSC) sets pref → 'osc' and snaps to the live OSC value on the next tick.
 *
 * The preference is PERSISTED on the mixer (`mixer.tempoSourcePref`) and rides
 * the mixer-state broadcast, so the deck and the mixer UIs always agree on the
 * selected source — there is ONE source of truth, not a per-surface guess.
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

// The two sticky source modes. Default 'osc' (OSC auto-drives until the
// operator taps or explicitly selects TAP).
export const TEMPO_SOURCE_PREFS = ['osc', 'tap'];
export const DEFAULT_TEMPO_SOURCE_PREF = 'osc';

// OSC BPM staleness window: a received `audioBpm` is "live" only if it landed
// within this many ms. Reuses the OSC staleness notion (~1500ms) so a paused
// or dropped audio feed stops driving the tempo within ~1.5s.
export const OSC_STALENESS_MS = 1500;

// Engine-supported musical tempo window. OSC-driven values are clamped into
// this range before being applied (the manual TAP route validates the same
// window at the API boundary).
export const TEMPO_MIN_BPM = 20;
export const TEMPO_MAX_BPM = 400;

// NB: the old stability DEADBAND was removed 2026-06-29. With OSC selected the
// system tempo must be the RAW OSC value (operator request), so the arbiter
// applies the Companion's value verbatim. Stability now lives at the source:
// the Companion's BpmTracker is Kalman-smoothed and bpm_emit.js rounds to an
// INTEGER before sending, so consecutive emits are steady integers — no
// engine-side deadband is needed to stop sub-BPM churn.

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

    // The STICKY source preference is PERSISTED on the mixer so it survives a
    // restart and rides the mixer-state broadcast (one source of truth across
    // the deck + mixer UIs). Seed a sane default if the mixer has none yet.
    if (this._mixer.tempoSourcePref !== 'osc' && this._mixer.tempoSourcePref !== 'tap') {
      this._mixer.tempoSourcePref = DEFAULT_TEMPO_SOURCE_PREF;
    }

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

  /** The current sticky source preference ('osc' | 'tap'). */
  sourcePref() {
    return this._mixer.tempoSourcePref === 'tap' ? 'tap' : 'osc';
  }

  /**
   * Set the sticky source preference. 'tap' suppresses OSC auto-follow (the
   * current tempo holds); 'osc' resumes auto-follow and snaps to the live OSC
   * value on the next tick. Invalid input fails loud (codex P0). Returns the
   * applied preference.
   * @param {'osc'|'tap'} pref
   */
  setSourcePref(pref) {
    if (pref !== 'osc' && pref !== 'tap') {
      throw new Error(`setSourcePref requires 'osc' | 'tap', got '${pref}'`);
    }
    this._mixer.tempoSourcePref = pref;
    // OSC mode applies the raw live OSC value verbatim on the next tick (no
    // deadband); TAP mode leaves the current tempo holding. Nothing else to
    // reset here.
    return pref;
  }

  /**
   * A manual tap (`POST /mixer/tempo`) means the operator is hand-driving the
   * tempo, so it makes TAP the sticky source. The caller sets the tempo itself
   * via mixer.setTempoBpm; this just flips the preference.
   */
  noteManualTap() {
    this._mixer.tempoSourcePref = 'tap';
    return 'tap';
  }

  /**
   * "Use OSC" — select OSC as the sticky source so the live OSC BPM reclaims
   * the tempo on the next tick if live (the `POST /mixer/tempo/sync` route).
   */
  clearOverride() {
    this.setSourcePref('osc');
  }

  /** True if a live OSC BPM landed within the staleness window. */
  isOscLive(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    return this._lastOscBpm != null
      && (now - this._lastOscBpmMs) <= OSC_STALENESS_MS;
  }

  /** True while TAP is the sticky source (OSC auto-follow suppressed). */
  isManualOverrideActive() {
    return this.sourcePref() === 'tap';
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
   * Tempo source for UI display (the LIVE status, distinct from the sticky
   * `sourcePref()` the selector highlights):
   *   'manual' — TAP is the sticky source (the tapped tempo owns it).
   *   'osc'    — OSC selected AND live (auto-driving).
   *   'held'   — OSC selected but stale/off (the last value just holds; the
   *              selector still shows OSC — it does NOT flip to TAP).
   */
  deriveSource(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : this._clock();
    if (this.sourcePref() === 'tap') return 'manual';
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
    // TAP is the sticky source — OSC auto-follow is suppressed; the tapped
    // tempo holds until the operator selects OSC. Never clobber it.
    if (this.sourcePref() === 'tap') return;
    // OSC must be live to drive.
    if (!this.isOscLive(now)) return;
    // When OSC is selected the system tempo IS the raw OSC value (operator
    // request 2026-06-29: "when OSC is selected, the BPM must be the raw OSC
    // received from the Audio Companion"). The Companion already emits a
    // Kalman-smoothed INTEGER bpm (bpm_emit.js rounds), so `_lastOscBpm` is the
    // raw integer; we clamp to the musical window and apply it verbatim — NO
    // deadband, so mixer.tempoBpm never lags or differs from the OSC readout.
    // Math.round is a safety no-op for the (already-integer) emitted value.
    const target = Math.round(this._clampBpm(this._lastOscBpm));
    // Only the no-churn guard remains: skip a redundant set when the value is
    // unchanged (avoids re-broadcasting an identical tempo every frame).
    if (this._mixer.tempoBpm === target) return;
    this._mixer.setTempoBpm(target);
  }

  /** @private — clamp a BPM into the supported musical window. */
  _clampBpm(bpm) {
    if (bpm < TEMPO_MIN_BPM) return TEMPO_MIN_BPM;
    if (bpm > TEMPO_MAX_BPM) return TEMPO_MAX_BPM;
    return bpm;
  }
}
