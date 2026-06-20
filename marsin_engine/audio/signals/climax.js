/**
 * climax.js — sustained-peak / "hands-up" climax → `audioClimax`
 * (report 20260620_2 #8).
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * The complement of the transition detector: it finds a SUSTAINED max-energy
 * PLATEAU — the post-drop "hands up" section where everything is slamming and
 * holding — so the rig can sit on its biggest look instead of re-triggering.
 *
 * Output (published by DerivedSignals):
 *   audioClimax  0..1 — how firmly we are on a sustained peak right now. Ramps
 *                       up while the plateau holds, decays when energy falls.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * A climax is THREE things at once, sustained:
 *   1. ENERGY CEILING. Loudness (full-band) sits near the recent ceiling — we
 *      track a slow-decaying `_ceiling` (the loudest the track has been lately)
 *      and require the current loudness to be ≥ `ceilFrac` of it.
 *   2. HIGH-BAND PRESENCE. A real climax has bright top end (hats/leads), not
 *      just a bass drone — require micHigh ≥ `highFloor`.
 *   3. SUSTAIN. The above must HOLD for `holdMs` before audioClimax ramps up
 *      (a single loud beat is not a climax). A recent DROP (post-drop window)
 *      LOWERS the hold requirement — the section right after a drop is exactly
 *      where the climax lives, so we get there faster.
 * The output is an EMA-smoothed gate: rises (attack) while the plateau holds,
 * decays (release) when it breaks. Pure presence, no events.
 *
 * Pure Math, allocation-free. Warmup-seeds the ceiling so the first frame can't
 * phantom-climax. Validated offline (synth bank): a sustained `full_track` /
 * the drop section of `edm_drop` ramp audioClimax high and HOLD; `silence` /
 * `riser` (rising but not yet peaked) stay low.
 */

export const CLIMAX_DEFAULTS = Object.freeze({
  wLow: 0.4, wMid: 0.35, wHigh: 0.25,
  ceilTau: 4.0,          // s — slow ceiling tracker (the recent loudness max)
  ceilDecay: 0.9985,     // per-hop ceiling bleed so it forgets old peaks slowly
  ceilFrac: 0.8,         // loudness must be ≥ this fraction of the ceiling
  absFloor: 0.18,        // and clear this absolute loudness (no climax in quiet)
  highFloor: 0.12,       // micHigh must clear this (bright top end present)
  lowFloor: 0.2,         // micLow must clear this — a climax is a FULL-spectrum slam,
                         // not just bright top end. This is what separates a climax
                         // (drop/sustain: bass+everything) from a RISER (bright,
                         // rising, but NO bass body yet).
  holdMs: 900,           // plateau must hold this long before climax ramps
  postDropHoldMs: 350,   // reduced hold within postDropWindowMs of a drop
  postDropWindowMs: 6000, // a drop primes a faster climax for this long after
  attackTau: 0.5,        // s — output rise time while the plateau holds
  releaseTau: 0.8,       // s — output fall time when the plateau breaks
  warmupHops: 30,
});

export class Climax {
  constructor(opts = {}) {
    this.p = { ...CLIMAX_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._loud = 0;
    this._ceiling = 0;
    this._warmSum = 0;
    this._warmHops = 0;
    this._warmedUp = false;
    this._plateauSinceMs = null;
    this._lastDropMs = -Infinity;
    this._out = 0;
    this.climax = 0;
    this.loudness = 0;
  }

  /**
   * @param {object} s
   *   s.low, s.mid, s.high  — raw bands [0,1]
   *   s.dropPulse           — audioDropPulse [0,1]
   *   s.dt (seconds), s.nowMs
   * @returns {{climax:number}}
   */
  update(s) {
    const p = this.p;
    const dt = s.dt > 0 ? s.dt : 0;
    const low = clamp01(s.low), mid = clamp01(s.mid), high = clamp01(s.high);
    const loud = p.wLow * low + p.wMid * mid + p.wHigh * high;

    // Loudness EMA (short — track the section level, but smooth per-beat ripple).
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / 0.3);
      this._loud += a * (loud - this._loud);
    } else {
      this._loud = loud;
    }
    this.loudness = this._loud;

    if (!this._warmedUp) {
      this._warmSum += this._loud;
      this._warmHops++;
      if (this._warmHops >= p.warmupHops) {
        this._ceiling = Math.max(this._warmSum / this._warmHops, this._loud);
        this._warmedUp = true;
      }
      this.climax = 0;
      return { climax: 0 };
    }

    // Slow ceiling: rises quickly to a new peak (EMA up), bleeds down slowly so
    // the "near the ceiling" test is relative to the track's RECENT loudness.
    if (this._loud > this._ceiling) {
      const a = 1 - Math.exp(-dt / p.ceilTau);
      this._ceiling += a * (this._loud - this._ceiling);
      if (this._loud > this._ceiling) this._ceiling = this._loud;   // never below the instant peak
    } else {
      this._ceiling *= p.ceilDecay;
      if (this._ceiling < this._loud) this._ceiling = this._loud;
    }

    if (s.dropPulse >= 0.5) this._lastDropMs = s.nowMs;
    const postDrop = (s.nowMs - this._lastDropMs) < p.postDropWindowMs;
    const holdNeeded = postDrop ? p.postDropHoldMs : p.holdMs;

    // Plateau test: near the ceiling AND a FULL-spectrum slam (bright top end AND
    // bass body) AND above the absolute floor. The bass-body requirement is what
    // keeps a bright RISER (high but no low) from reading as a climax.
    const nearCeiling = this._ceiling > 1e-4 && this._loud >= p.ceilFrac * this._ceiling;
    const onPlateau = nearCeiling && this._loud >= p.absFloor
      && high >= p.highFloor && low >= p.lowFloor;

    if (onPlateau) {
      if (this._plateauSinceMs === null) this._plateauSinceMs = s.nowMs;
    } else {
      this._plateauSinceMs = null;
    }
    const held = this._plateauSinceMs !== null && (s.nowMs - this._plateauSinceMs) >= holdNeeded;

    // Output gate: attack toward 1 while held, release toward 0 otherwise.
    const targetTau = held ? p.attackTau : p.releaseTau;
    const goal = held ? 1 : 0;
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / targetTau);
      this._out += a * (goal - this._out);
    }
    if (this._out < 1e-3) this._out = 0;
    this.climax = clamp01(this._out);
    return { climax: this.climax };
  }
}

function clamp01(v) { return Number.isFinite(v) ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : 0; }

export default Climax;
