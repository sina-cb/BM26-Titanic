/**
 * party_mode_ref.js — boolean "is LOUD music playing right now".
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * A debounced on/off flag that is ON only when loud, full-band music is
 * detected and OFF in quiet / silence / ambient. Drives the master "go
 * crazy" gate for the lighting: when partyMode is OFF the rig stays calm.
 *
 * Outputs:
 *   - party     : boolean
 *   - loudness  : smoothed 0..1 loudness used for the decision (for display)
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. LOUDNESS. Combine the three bands into one loudness scalar. We use a
 *    weighted sum that rewards FULL-band content (so a lone bass rumble or a
 *    lone hiss doesn't count as "party"): loudness = 0.4*low + 0.4*mid +
 *    0.2*high, then EMA-smoothed (tau ~0.4 s) so it tracks sections not hits.
 *    Rationale: EDM "on" sections light up low+mid together; quiet intros /
 *    breakdowns drop mid out first. max() over bands was tried but a single
 *    loud sub in an otherwise sparse breakdown then reads as "party", which
 *    is wrong — the weighted FULL-band sum is the better discriminator.
 * 2. HYSTERESIS. Schmitt trigger: turn ON above `onThresh`, OFF below
 *    `offThresh` (offThresh < onThresh) so it doesn't chatter at the boundary.
 * 3. HOLD. After turning ON, stay ON for at least `holdMs` even if loudness
 *    dips (covers a 1-bar breakdown inside an otherwise loud track). After
 *    turning OFF, require `offConfirmMs` of sustained quiet before flipping
 *    (covers a momentary gap between songs / a snare gap).
 *
 * Pure Math, no allocations. Tuned on the FMA EDM corpus (see params).
 */

export const PARTY_MODE_DEFAULTS = Object.freeze({
  wLow: 0.4, wMid: 0.4, wHigh: 0.2,
  loudTau: 0.4,        // s — loudness EMA
  onThresh: 0.22,      // loudness must exceed this to turn ON
  offThresh: 0.12,     // and drop below this to turn OFF (hysteresis gap)
  holdMs: 1200,        // min ON time once triggered
  offConfirmMs: 800,   // sustained-quiet time required before OFF
});

export class PartyMode {
  constructor(opts = {}) {
    this.p = { ...PARTY_MODE_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._loud = 0;
    this.party = false;
    this.loudness = 0;
    this._onSinceMs = -Infinity;
    this._quietSinceMs = null;
  }

  /**
   * @param {number} low  [0,1]
   * @param {number} mid  [0,1]
   * @param {number} high [0,1]
   * @param {number} dt   seconds since previous hop
   * @param {number} nowMs current hop clock (ms)
   * @returns {{party:boolean, loudness:number}}
   */
  update(low, mid, high, dt, nowMs) {
    const p = this.p;
    const target = p.wLow * low + p.wMid * mid + p.wHigh * high;
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / p.loudTau);
      this._loud += a * (target - this._loud);
    }
    this.loudness = this._loud;

    if (!this.party) {
      // OFF → ON when we clear the high threshold.
      if (this._loud >= p.onThresh) {
        this.party = true;
        this._onSinceMs = nowMs;
        this._quietSinceMs = null;
      }
    } else {
      // ON → OFF only after sustained quiet AND past the min-hold time.
      if (this._loud < p.offThresh) {
        if (this._quietSinceMs === null) this._quietSinceMs = nowMs;
      } else {
        this._quietSinceMs = null;
      }
      const heldLongEnough = (nowMs - this._onSinceMs) >= p.holdMs;
      const quietLongEnough = this._quietSinceMs !== null
        && (nowMs - this._quietSinceMs) >= p.offConfirmMs;
      if (heldLongEnough && quietLongEnough) {
        this.party = false;
        this._quietSinceMs = null;
      }
    }

    return { party: this.party, loudness: this.loudness };
  }
}

export default PartyMode;
