/**
 * band_onsets.js — per-band ONSET → spatial-chase pulse triggers.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * The analyzer emits THREE raw band-onset strengths each hop — the
 * half-wave-rectified spectral flux RESTRICTED to the LOW / MID / HIGH bin
 * ranges (`onsetLow/Mid/High`, [0,1], same scale as the bands). They answer
 * "did energy just RISE in this band?" — i.e. a drum-kit-following onset
 * strength: a kick lights LOW, a snare/mid stab lights MID, a hat lights HIGH.
 *
 * This module turns each continuous onset-strength into a clean PULSE so a
 * pattern can map kick→one hull zone, snare→another, hats→another (a spatial
 * chase = a big "alive" win for exterior visibility). One `BandOnset` shaper
 * per band; `BandOnsetBank` runs all three. Published as `micOnsetLow/Mid/High`.
 *
 * ── Algorithm (mirrors the analyzer kick schmitt/hold) ────────────────────
 * 1. ADAPTIVE THRESHOLD. Track a slow EMA of the onset strength (the band's
 *    "typical rising flux right now"). Asymmetric attack/release like the kick
 *    EMA: slow UP so a loud sustained section doesn't raise the bar (transients
 *    can still clear it), faster DOWN so it recovers in quiet. A fresh onset
 *    fires when `instant > ema * threshold` AND `instant > absFloor` (a silence
 *    floor so noise never fires), outside the `refractoryMs` window.
 * 2. HOLD + DECAY. On fire, the pulse snaps to 1.0 then decays over `decayMs`
 *    (exponential), exactly like the kick envelope — so a pattern sees a clean
 *    spike-and-fall, not a noisy continuous value.
 *
 * Pure Math, allocation-free. Warmup-seeds the EMA from the first hops so a
 * single loud first frame can't phantom-fire (same trick as the kick).
 *
 * Validated offline (synth bank): kick_4floor → micOnsetLow fires; hats →
 * micOnsetHigh fires; chord_stab → micOnsetMid; silence → nothing fires.
 */

export const BAND_ONSET_DEFAULTS = Object.freeze({
  threshold: 1.8,        // instant must exceed ema × this to fire
  absFloor: 0.03,        // silence floor — instant must also clear this
  refractoryMs: 90,      // min spacing between fires (≈ a 16th at 160 BPM)
  decayMs: 70,           // pulse exponential decay after a fire
  emaAlphaUp: 0.01,      // slow attack — don't chase a loud sustained band
  emaAlphaDown: 0.08,    // faster release — recover the threshold in quiet
  warmupHops: 30,        // seed the EMA from this many hops before firing
});

class BandOnset {
  constructor(opts = {}) {
    this.p = { ...BAND_ONSET_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._ema = 0;
    this._warmSum = 0;
    this._warmHops = 0;
    this._warmedUp = false;
    this._pulse = 0;
    this._lastFireMs = -Infinity;
  }

  /**
   * @param {number} onset  raw band-onset strength this hop, [0,1]
   * @param {number} dtMs   ms since previous hop (for the decay envelope)
   * @param {number} nowMs  hop clock (ms) for the refractory window
   * @returns {{pulse:number, fired:boolean}}
   */
  update(onset, dtMs, nowMs) {
    const p = this.p;
    const x = Number.isFinite(onset) ? Math.max(0, onset) : 0;

    if (!this._warmedUp) {
      this._warmSum += x;
      this._warmHops++;
      if (this._warmHops >= p.warmupHops) {
        this._ema = this._warmSum / this._warmHops;
        this._warmedUp = true;
      }
      // No fires during warmup — we have no stable reference yet.
      this._pulse = 0;
      return { pulse: 0, fired: false };
    }

    // Asymmetric adaptive threshold (kick-EMA pattern): slow up, faster down.
    const a = x > this._ema ? p.emaAlphaUp : p.emaAlphaDown;
    this._ema = a * x + (1 - a) * this._ema;

    // Effective fire bar = the adaptive baseline×threshold, but never below the
    // absolute silence floor. This lets a fresh onset rising out of true silence
    // (ema≈0) still fire (the spatial chase wants the first hit), while a loud
    // sustained band needs a real prominence to clear the adaptive bar.
    const refractoryOk = (nowMs - this._lastFireMs) >= p.refractoryMs;
    const bar = Math.max(this._ema * p.threshold, p.absFloor);
    const fired = refractoryOk && x > bar;

    if (fired) {
      this._pulse = 1.0;
      this._lastFireMs = nowMs;
    } else if (this._pulse > 0) {
      const decay = Math.exp(-(dtMs > 0 ? dtMs : 0) / p.decayMs);
      this._pulse *= decay;
      if (this._pulse < 1e-3) this._pulse = 0;
    }
    return { pulse: this._pulse, fired };
  }
}

/** Runs the three band-onset shapers (low / mid / high). */
export class BandOnsetBank {
  constructor(opts = {}) {
    this._low  = new BandOnset(opts.low  || opts);
    this._mid  = new BandOnset(opts.mid  || opts);
    this._high = new BandOnset(opts.high || opts);
  }

  reset() { this._low.reset(); this._mid.reset(); this._high.reset(); }

  /**
   * @param {number} onsetLow  [0,1]
   * @param {number} onsetMid  [0,1]
   * @param {number} onsetHigh [0,1]
   * @param {number} dtMs  ms since previous hop
   * @param {number} nowMs hop clock (ms)
   * @returns {{low:number, mid:number, high:number,
   *            firedLow:boolean, firedMid:boolean, firedHigh:boolean}}
   */
  update(onsetLow, onsetMid, onsetHigh, dtMs, nowMs) {
    const l = this._low.update(onsetLow, dtMs, nowMs);
    const m = this._mid.update(onsetMid, dtMs, nowMs);
    const h = this._high.update(onsetHigh, dtMs, nowMs);
    return {
      low: l.pulse, mid: m.pulse, high: h.pulse,
      firedLow: l.fired, firedMid: m.fired, firedHigh: h.fired,
    };
  }
}

export default BandOnsetBank;
