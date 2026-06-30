/**
 * sub_bass.js — sub-bass "chest hit" transient → pulse (`audioChestHit`).
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * The analyzer emits `micSub` — narrow sub-band energy (~30–60 Hz), the
 * body-FELT slam, distinct from the kick CLICK (50–110 Hz). This shaper turns
 * the sustained sub energy into a TRANSIENT-emphasized pulse for the visceral
 * full-hull brightness thump on the big moments. Published as `audioChestHit`.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. TRANSIENT EMPHASIS. The sub band is mostly SUSTAINED (a held 808 reads
 *    high continuously) — we want the HIT, not the drone. Track a slow EMA of
 *    micSub (the "drone floor") and emphasize the rising edge:
 *      transient = max(0, micSub − ema) / (1 − ema)   (re-normalized to [0,1])
 *    so a fresh slam over the held floor pops; a steady drone reads ~0.
 * 2. SCHMITT + HOLD (mirrors the kick shaper). Fire when the transient clears
 *    `tHigh` AND micSub clears `absFloor` (silence floor) outside the refractory
 *    window; the pulse holds at 1.0 then decays over `decayMs`. Hysteresis
 *    (`tLow`) re-arms only after the transient falls back, so one slam = one hit.
 *
 * Pure Math, allocation-free. Warmup-seeds the drone EMA so the first frame
 * can't phantom-fire. At the shipped fftSize 2048 (~21.5 Hz/bin) micSub keys off
 * the real 30–60 Hz sub fundamental (bins 1–2) rather than the kick: an 80 Hz
 * kick tone reads micSub ~0.13 vs ~0.49 at the old 1024, so the chest-hit is now
 * the body-felt sub slam, not a kick duplicate (report 20260620_14).
 *
 * Validated offline (synth bank): bassline / kick_4floor / edm_drop fire
 * audioChestHit; silence fires nothing (gate holds).
 */

export const SUB_BASS_DEFAULTS = Object.freeze({
  droneTau: 0.5,        // s — slow EMA tracking the sustained sub "floor"
  tHigh: 0.18,          // transient above this → fire
  tLow: 0.08,           // and must fall below this to re-arm (hysteresis)
  absFloor: 0.05,       // silence floor — micSub must clear this to fire
  refractoryMs: 110,    // min spacing between hits
  decayMs: 90,          // pulse exponential decay after a fire
  warmupHops: 30,       // seed the drone EMA before firing
});

export class SubBass {
  constructor(opts = {}) {
    this.p = { ...SUB_BASS_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._drone = 0;
    this._warmSum = 0;
    this._warmHops = 0;
    this._warmedUp = false;
    this._armed = true;      // schmitt: ready to fire
    this._pulse = 0;
    this._lastFireMs = -Infinity;
    this.transient = 0;      // exposed for diagnostics/tests
  }

  /**
   * @param {number} sub   raw sub-band energy this hop, [0,1]
   * @param {number} dt    seconds since previous hop (for the drone EMA)
   * @param {number} dtMs  ms since previous hop (for the decay envelope)
   * @param {number} nowMs hop clock (ms) for the refractory window
   * @returns {{pulse:number, fired:boolean, transient:number}}
   */
  update(sub, dt, dtMs, nowMs) {
    const p = this.p;
    const x = Number.isFinite(sub) ? Math.max(0, Math.min(1, sub)) : 0;

    if (!this._warmedUp) {
      this._warmSum += x;
      this._warmHops++;
      if (this._warmHops >= p.warmupHops) {
        this._drone = this._warmSum / this._warmHops;
        this._warmedUp = true;
      }
      this._pulse = 0;
      this.transient = 0;
      return { pulse: 0, fired: false, transient: 0 };
    }

    // Drone EMA + rising-edge transient, re-normalized so a slam over the held
    // floor reads near 1 while a steady drone reads ~0.
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / p.droneTau);
      this._drone += a * (x - this._drone);
    }
    const headroom = 1 - this._drone;
    const transient = headroom > 1e-4 ? Math.max(0, x - this._drone) / headroom : 0;
    this.transient = transient;

    const refractoryOk = (nowMs - this._lastFireMs) >= p.refractoryMs;
    let fired = false;
    if (this._armed) {
      if (transient >= p.tHigh && x > p.absFloor && refractoryOk) {
        fired = true;
        this._armed = false;
        this._pulse = 1.0;
        this._lastFireMs = nowMs;
      }
    } else if (transient <= p.tLow) {
      this._armed = true;   // re-arm once the transient falls back
    }

    if (!fired && this._pulse > 0) {
      const decay = Math.exp(-(dtMs > 0 ? dtMs : 0) / p.decayMs);
      this._pulse *= decay;
      if (this._pulse < 1e-3) this._pulse = 0;
    }
    return { pulse: this._pulse, fired, transient };
  }
}

export default SubBass;
