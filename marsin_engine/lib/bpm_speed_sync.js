/**
 * BpmSpeedSync — drive CPC `speed` from the ARBITRATED tempo when enabled.
 *
 * See docs/39_channels_deck_mixer.md (tempo arbitration) for the design.
 *
 * Behaviour:
 *   - Subscribes to ParamCenter via `paramCenter.subscribe(...)`.
 *   - On every change event that touches an input key (`audioBpm` — the raw
 *     OSC tempo readout — or any of `bpmSpeedSync` / `bpmSpeedMin` /
 *     `bpmSpeedMax`), it recomputes. The TEMPO it maps is NOT `audioBpm`
 *     alone — it is the ARBITRATED pattern clock (`mixer.tempoBpm`), i.e.
 *     whatever is actually driving the clock: OSC auto-follow OR a manual TAP
 *     override. When `bpmSpeedSync` is on and the tempo is sensible, it maps
 *
 *        speed = clamp01((bpm - bpmSpeedMin) / (bpmSpeedMax - bpmSpeedMin))
 *
 *     and writes to `speed` with source `'bpm-sync'` + origin
 *     `'bpm-sync:auto'`. The named source lets CaptainPad badge the
 *     speed knob and lets a future source-lock policy block manual
 *     overrides when the auto-driver is active.
 *   - `recompute()` is a public, idempotent re-evaluation the engine calls
 *     when the arbitrated tempo can change WITHOUT a CPC event — a manual TAP
 *     (`POST /mixer/tempo`) writes `mixer.tempoBpm` directly, and the
 *     per-frame OSC auto-follow does too. It only writes `speed` when the
 *     mapped value actually changes, so it is safe to call per-frame.
 *
 * SOURCE-AGNOSTIC (tempo arbitration): the sync follows the SAME applied
 * tempo the BPM tile shows. When a `getTempoBpm` resolver is injected (the
 * engine passes `() => mixer.tempoBpm`), that arbitrated value is the tempo —
 * so SPEED tracks a tapped tempo too, not only the analyzed OSC `audioBpm`.
 * When no resolver is injected (legacy / unit-test default), it falls back to
 * reading `audioBpm` off the event so the pure mapping stays trivially
 * testable. When the resolved tempo is 0/absent the sync simply doesn't
 * drive — fail SAFE, no fallback to a stale tempo.
 *
 * Why a separate module (not folded into AudioAnalyzer or api_server):
 *   - It composes cleanly with the multi-subscriber CPC API and keeps the
 *     BPM-input side decoupled from "where the tempo comes from" (now the
 *     arbiter's applied `mixer.tempoBpm`).
 *   - Trivially unit-testable with a stub paramCenter.
 *
 * The class holds no time-domain state — it's a pure mapping that
 * gets called per event / per recompute. Constructed once at boot,
 * attached, and forgotten.
 */

export class BpmSpeedSync {
  /**
   * @param {object} paramCenter — anything with `subscribe(fn) → unsubscribe`,
   *                                `set(key, value, source, origin)`, and a
   *                                `getCanonicalState()` returning
   *                                `{ params: { key: { value } } }` (used by
   *                                recompute()).
   * @param {object} [opts]
   * @param {() => number} [opts.getTempoBpm] — resolver for the ARBITRATED
   *        tempo (OSC OR tap). The engine passes `() => mixer.tempoBpm`. When
   *        omitted, the mapping reads `audioBpm` off the event (legacy/test).
   * @param {string} [opts.source='bpm-sync']
   * @param {string} [opts.origin='bpm-sync:auto']
   */
  constructor(paramCenter, opts = {}) {
    if (!paramCenter || typeof paramCenter.subscribe !== 'function') {
      throw new TypeError('BpmSpeedSync requires a ParamCenter with subscribe()');
    }
    this._pc = paramCenter;
    this._getTempoBpm = typeof opts.getTempoBpm === 'function' ? opts.getTempoBpm : null;
    this._source = opts.source || 'bpm-sync';
    this._origin = opts.origin || 'bpm-sync:auto';
    this._unsubscribe = null;
    // Last speed value this driver wrote — lets recompute() short-circuit when
    // nothing changed, so it's safe to call per-frame (no CPC churn).
    this._lastSpeed = null;
    // MULTIPLICATIVE SPEED SCALE (docs/25 §6.1): a [0,1] factor another driver
    // can LAYER on top of the tempo→speed mapping so the final `speed` is
    // `baseSpeed * scale`, then re-clamped to [0,1]. The audio_reactive autopilot
    // profile drives this with its energy arc: a lower scale on a calm SLOWS the
    // pattern (calm → slower), a scale of 1 on a peak leaves the tempo mapping
    // untouched. Defaults to 1 so the sync behaves EXACTLY as before when no
    // driver sets it. Set via setSpeedScale(); the caller must then recompute()
    // (or wait for the next CPC/tempo event) for it to take effect.
    this._speedScale = 1;
  }

  /**
   * Set the multiplicative speed scale [0,1] layered on the tempo mapping.
   * A non-finite or out-of-range value is a programming error and THROWS
   * (Codex P0 — no silent clamp of a caller mistake). Does NOT itself write
   * `speed`; the caller drives that via recompute() so the write cadence stays
   * the caller's to control. Returns nothing.
   */
  setSpeedScale(scale) {
    const s = Number(scale);
    if (!Number.isFinite(s) || s < 0 || s > 1) {
      throw new RangeError(`BpmSpeedSync.setSpeedScale requires a [0,1] number, got '${scale}'`);
    }
    this._speedScale = s;
  }

  /** Current multiplicative speed scale (1 = no attenuation). */
  getSpeedScale() {
    return this._speedScale;
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

  /** @private — keys whose change should re-evaluate the mapping. */
  _touchesInput(changedKeys) {
    return changedKeys.includes('audioBpm')
      || changedKeys.includes('bpmSpeedSync')
      || changedKeys.includes('bpmSpeedMin')
      || changedKeys.includes('bpmSpeedMax');
  }

  /** @private */
  _onChange(ev) {
    if (!ev || !Array.isArray(ev.changedKeys)) return;
    if (!this._touchesInput(ev.changedKeys)) return;
    const params = ev.state && ev.state.params;
    if (!params) return;
    this._apply(params, ev);
  }

  /**
   * Re-evaluate the mapping NOW, against the current CPC + arbitrated tempo.
   * Idempotent: only writes `speed` when the mapped value changed. The engine
   * calls this when the arbitrated tempo can move without a CPC event — a
   * manual TAP, or the per-frame OSC auto-follow.
   */
  recompute() {
    // Need the `{ key: { value } }` slot shape (same as the event's
    // `ev.state.params`), so read the canonical state — NOT getAll(), which
    // returns flat `{ key: value }`.
    const state = typeof this._pc.getCanonicalState === 'function'
      ? this._pc.getCanonicalState()
      : null;
    const params = state && state.params;
    if (!params) return;
    this._apply(params, null);
  }

  /**
   * @private — the shared mapping. `params` is the CPC param map; `ev` is the
   * triggering event (or null for recompute()). Reads the tempo from the
   * injected arbitrated resolver when present, else from `audioBpm`.
   */
  _apply(params, ev) {
    const enabled = (this._numOf(params.bpmSpeedSync) ?? 0) >= 0.5;
    if (!enabled) return;

    const bpm = this._resolveTempo(params);
    if (!Number.isFinite(bpm) || bpm <= 0) return;   // no signal → no write (fail SAFE)

    let min = this._numOf(params.bpmSpeedMin);
    let max = this._numOf(params.bpmSpeedMax);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;

    let speed;
    if (min === max) {
      // avoid div-by-zero, pin to midpoint.
      speed = 0.5;
    } else {
      if (min > max) { const t = min; min = max; max = t; }   // swap, operator clearly meant this
      const span = max - min;
      speed = (bpm - min) / span;
      if (speed < 0) speed = 0;
      if (speed > 1) speed = 1;
    }

    // Layer the multiplicative energy scale ON TOP of the tempo mapping, then
    // re-clamp. scale=1 (the default) is a no-op; a lower scale SAGS `speed`
    // below the tempo-mapped value (the audio_reactive calm-slows-down arc).
    speed = speed * this._speedScale;
    if (speed < 0) speed = 0;
    if (speed > 1) speed = 1;

    if (this._lastSpeed === speed) return;   // idempotent — no churn
    this._lastSpeed = speed;
    this._pc.set('speed', speed, this._source, this._origin);
  }

  /**
   * @private — resolve the tempo to map. Prefer the injected ARBITRATED tempo
   * (OSC OR tap) so SPEED tracks whatever drives the clock; fall back to the
   * raw `audioBpm` param when no resolver is wired (legacy / unit tests).
   */
  _resolveTempo(params) {
    if (this._getTempoBpm) {
      const t = Number(this._getTempoBpm());
      return Number.isFinite(t) ? t : NaN;
    }
    return this._numOf(params.audioBpm);
  }

  /** @private — read a numeric `.value` off a CPC param slot. */
  _numOf(slot) {
    if (!slot) return NaN;
    return Number(slot.value);
  }
}
