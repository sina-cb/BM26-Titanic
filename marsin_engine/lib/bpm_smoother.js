/*
 * bpm_smoother.js — a QUICK one-pole low-pass (EMA) for BPM, shared by the
 * Audio Companion (smooths audioBpm BEFORE the UI + OSC read it) and the engine
 * (optionally re-smooths a received OSC bpm). One filter, identical maths, so
 * both runtimes behave the same (operator request 2026-06-29).
 *
 * WHY: the BpmTracker's per-frame estimate wobbles a couple BPM (adjacent
 * candidates), and with the arbiter deadband removed the readout follows every
 * wobble 1:1. A light EMA averages out that frame-to-frame jitter WITHOUT the
 * lag of a long window — the default time constant is short (250 ms) so a real
 * tempo change is still chased in well under a second.
 *
 * Frame-rate independent: the smoothing coefficient is derived from the actual
 * dt between samples (`alpha = 1 - exp(-dt/tau)`), so the same tau behaves the
 * same at the Companion's ~86 Hz analysis rate and the engine's irregular OSC
 * arrival rate. Pure + tiny so it's unit-testable without booting either side.
 */

// Default time constant (ms). SHORT on purpose — "quick smoother, minimal
// delay" (operator request): kills frame-to-frame jitter, settles to ~95% of a
// step in ~3·tau ≈ 0.75 s, so a genuine tempo change is followed promptly.
export const DEFAULT_BPM_SMOOTH_TAU_MS = 250;

export class BpmSmoother {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.enabled=true] — when false, push() is a pass-through.
   * @param {number}  [opts.tauMs=250]    — EMA time constant in ms (>0).
   */
  constructor({ enabled = true, tauMs = DEFAULT_BPM_SMOOTH_TAU_MS } = {}) {
    this.enabled = !!enabled;
    this._tauMs = Number.isFinite(tauMs) && tauMs > 0 ? tauMs : 0;
    this._value = null; // null = no sample yet (next push seeds directly)
  }

  /** Forget the running value so the next push() seeds directly (no ramp from
   *  a stale tempo — call this when the signal drops out). */
  reset() { this._value = null; }

  setEnabled(on) { this.enabled = !!on; }
  setTauMs(ms) { this._tauMs = Number.isFinite(ms) && ms > 0 ? ms : 0; }
  get value() { return this._value; }

  /**
   * Push a raw BPM sample and return the smoothed value.
   *   - disabled / tau<=0 / first-sample / non-positive dt ⇒ pass through (and
   *     seed the running value), so there is ZERO added delay on acquire.
   *   - otherwise one-pole EMA toward the raw value.
   * A non-finite raw sample is ignored (returns the last value) — never poisons
   * the running value with NaN (codex P0, fail safe).
   *
   * @param {number} rawBpm
   * @param {number} dtMs — ms since the previous sample.
   * @returns {number|null} the smoothed value (null only before any valid push).
   */
  push(rawBpm, dtMs) {
    if (!Number.isFinite(rawBpm)) return this._value;
    if (!this.enabled || this._tauMs <= 0 || this._value === null || !(dtMs > 0)) {
      this._value = rawBpm;
      return this._value;
    }
    const alpha = 1 - Math.exp(-dtMs / this._tauMs);
    this._value += alpha * (rawBpm - this._value);
    return this._value;
  }
}
