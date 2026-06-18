/**
 * BpmSpeedSync — drive CPC `speed` from `audioBpm` when enabled.
 *
 * See docs/25_marsin_audio_analysis.md §6 for the design.
 *
 * Behaviour:
 *   - Subscribes to ParamCenter via `paramCenter.subscribe(...)`.
 *   - On every change event that touches `audioBpm`, if `bpmSpeedSync`
 *     is on and the BPM value is sensible, maps
 *
 *        speed = clamp01((bpm - bpmSpeedMin) / (bpmSpeedMax - bpmSpeedMin))
 *
 *     and writes to `speed` with source `'bpm-sync'` + origin
 *     `'bpm-sync:auto'`. The named source lets CaptainPad badge the
 *     speed knob and lets a future source-lock policy block manual
 *     overrides when the auto-driver is active.
 *
 * Tempo SOURCE (2026-06-17 contract): the Audio Companion is the sole
 * analyzer. It computes the tempo (DerivedSignals/BpmTracker) and streams
 * it to the engine over OSC `/marsin/audio/bpm` → CPC key `audioBpm`. The
 * sync follows THAT analyzed tempo. When `audioBpm` is 0/absent the sync
 * simply doesn't drive — fail SAFE, no fallback to a stale tempo.
 *
 * Why a separate module (not folded into AudioAnalyzer or
 * api_server):
 *   - It composes cleanly with the new multi-subscriber CPC API and
 *     keeps the BPM-input side decoupled from "where BPM comes from"
 *     (the Companion's analyzed `audioBpm` today).
 *   - Trivially unit-testable with a stub paramCenter.
 *
 * The class holds no time-domain state — it's a pure mapping that
 * gets called per event. Constructed once at boot, attached, and
 * forgotten.
 */

export class BpmSpeedSync {
  /**
   * @param {object} paramCenter — anything with `subscribe(fn) → unsubscribe`,
   *                                `set(key, value, source, origin)`, and a
   *                                `getAll()` returning `{ key: value }`.
   * @param {object} [opts]
   * @param {string} [opts.source='bpm-sync']
   * @param {string} [opts.origin='bpm-sync:auto']
   */
  constructor(paramCenter, opts = {}) {
    if (!paramCenter || typeof paramCenter.subscribe !== 'function') {
      throw new TypeError('BpmSpeedSync requires a ParamCenter with subscribe()');
    }
    this._pc = paramCenter;
    this._source = opts.source || 'bpm-sync';
    this._origin = opts.origin || 'bpm-sync:auto';
    this._unsubscribe = null;
  }

  /** Subscribe to the CPC. Idempotent. Returns the unsubscribe fn. */
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

  /** @private */
  _onChange(ev) {
    if (!ev || !Array.isArray(ev.changedKeys)) return;
    if (!ev.changedKeys.includes('audioBpm')) return;

    const params = ev.state && ev.state.params;
    if (!params) return;

    const enabled = (params.bpmSpeedSync?.value ?? 0) >= 0.5;
    if (!enabled) return;

    const bpm = Number(params.audioBpm?.value);
    if (!Number.isFinite(bpm) || bpm <= 0) return;   // §6.2: no signal → no write

    let min = Number(params.bpmSpeedMin?.value);
    let max = Number(params.bpmSpeedMax?.value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    if (min === max) {
      // §6.2: avoid div-by-zero, pin to midpoint.
      this._pc.set('speed', 0.5, this._source, this._origin);
      return;
    }
    if (min > max) { const t = min; min = max; max = t; }   // swap, operator clearly meant this

    const span = max - min;
    let speed = (bpm - min) / span;
    if (speed < 0) speed = 0;
    if (speed > 1) speed = 1;
    this._pc.set('speed', speed, this._source, this._origin);
  }
}
