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
 * ── Algorithm (REAL-AUDIO RE-BASELINE, 2026-06-20 / E2 P0-3) ───────────────
 * The v1 gate measured "near the recent ceiling" against a fast 4 s-tau ceiling.
 * On REAL continuous dance music that ceiling tracks the steady-state level, so
 * a normal loud groove sits at ≥ceilFrac of it the WHOLE time → climax saturated
 * (≥0.5 for ~48 % of hops, 88 % of tracks). A climax is a SPECIAL MOMENT, not
 * steady state, so the gate is now:
 *   1. LONG-HISTORY CEILING. We keep a coarse ring of the loudest the track has
 *      been over a LONG window (`historySec`, ~40 s) and take its TOP-DECILE as
 *      the reference peak. The current loudness must reach `ceilFrac` of THAT —
 *      i.e. near the loudest the section has been over tens of seconds, not the
 *      last few.
 *   2. A RECENT RISE INTO THE PLATEAU. A climax is reached by CLIMBING into it:
 *      the current loudness must exceed a slow baseline (`baseTau`, ~12 s) by
 *      `riseDelta`. A flat steady groove never opens this gap (fast≈slow), so it
 *      no longer reads as a climax; a post-drop / hands-up slam that rose out of
 *      a build or breakdown does. Once on the plateau the rise requirement is
 *      RELAXED for `plateauGraceMs` so the climax HOLDS through the peak section
 *      instead of dropping the instant the climb flattens.
 *   3. FULL-SPECTRUM SLAM. micHigh ≥ `highFloor` AND micLow ≥ `lowFloor` AND
 *      loudness ≥ `absFloor` (bass body + bright top — separates a climax from a
 *      bare riser), held `holdMs` (or `postDropHoldMs` just after a drop).
 * Output is an EMA-smoothed gate (attack while held, release otherwise).
 *
 * Pure Math, allocation-free. Warmup-seeds the baseline so the first frames
 * can't phantom-climax. Validated on the REAL 60-track corpus: climax ≥0.5 for a
 * SMALL fraction of hops (no over-fire on steady tracks) while a genuine rise-
 * into-peak still ramps it high.
 */

export const CLIMAX_DEFAULTS = Object.freeze({
  wLow: 0.4, wMid: 0.35, wHigh: 0.25,
  // Long-history peak reference (top-decile of a coarse loudness ring).
  historySec: 40,        // s — how far back the peak reference looks
  historyBins: 80,       // ring resolution (one bin ≈ historySec/historyBins s)
  ceilFrac: 0.95,        // loudness must reach this fraction of the long peak
                         // (relaxed for natural per-bar ripple; the rise-into-
                         //  plateau gate is the primary steady-state discriminator)
  // Rise-into-plateau gate.
  baseTau: 12.0,         // s — slow baseline the current loudness must rise above
  riseDelta: 0.16,       // loudness must exceed the slow baseline by this to "rise"
  plateauGraceMs: 2500,  // once on the plateau, relax the rise test this long (HOLD)
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
    // Coarse long-history loudness ring (one slot per historyBin). Pre-sized,
    // no per-hop alloc. Each slot holds the MAX loudness seen in that time bin.
    this._hist = new Float32Array(this.p.historyBins);
    this.reset();
  }

  reset() {
    this._loud = 0;
    this._base = 0;            // slow baseline (the rise is measured above this)
    this._warmSum = 0;
    this._warmHops = 0;
    this._warmedUp = false;
    this._plateauSinceMs = null;
    this._lastRiseMs = -Infinity;   // last time the loudness was meaningfully rising
    this._lastDropMs = -Infinity;
    this._out = 0;
    // Long-history ring state.
    this._hist.fill(0);
    this._histHead = 0;
    this._histBinStartMs = null;
    this.climax = 0;
    this.loudness = 0;
  }

  /** @private push the current loudness into the coarse long-history ring and
   * return the TOP-DECILE peak over the populated bins (the long peak reference). */
  _historyPeak(nowMs) {
    const p = this.p;
    const binMs = (p.historySec / p.historyBins) * 1000;
    if (this._histBinStartMs === null) { this._histBinStartMs = nowMs; this._hist[this._histHead] = this._loud; }
    // Track the max within the current bin; roll to a fresh bin when it expires.
    if (this._loud > this._hist[this._histHead]) this._hist[this._histHead] = this._loud;
    while (nowMs - this._histBinStartMs >= binMs) {
      this._histBinStartMs += binMs;
      this._histHead = (this._histHead + 1) % p.historyBins;
      this._hist[this._histHead] = this._loud;   // seed the new bin with the current level
    }
    // Top-decile peak over the populated ring: the 90th-percentile-ish bin max.
    // Cheap robust "near the loudest" reference that ignores a single spike.
    let mx = 0, mx2 = 0;
    for (let i = 0; i < p.historyBins; i++) {
      const v = this._hist[i];
      if (v > mx) { mx2 = mx; mx = v; } else if (v > mx2) mx2 = v;
    }
    // Use the 2nd-highest bin (a robust top-decile proxy) so one transient bin
    // can't inflate the reference; fall back to the max if the ring is sparse.
    return mx2 > 0 ? mx2 : mx;
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

    // Slow baseline EMA — the level the rise-into-plateau is measured against.
    if (dt > 0) {
      const ab = 1 - Math.exp(-dt / p.baseTau);
      this._base += ab * (this._loud - this._base);
    } else {
      this._base = this._loud;
    }

    if (!this._warmedUp) {
      this._warmSum += this._loud;
      this._warmHops++;
      if (this._warmHops >= p.warmupHops) {
        this._base = this._warmSum / this._warmHops;
        this._warmedUp = true;
      }
      // Still seed the long-history ring during warmup so the peak ref is warm.
      this._historyPeak(s.nowMs);
      this.climax = 0;
      return { climax: 0 };
    }

    // Long-history top-decile peak reference (over ~historySec, not 4 s).
    const longPeak = this._historyPeak(s.nowMs);

    if (s.dropPulse >= 0.5) this._lastDropMs = s.nowMs;
    const postDrop = (s.nowMs - this._lastDropMs) < p.postDropWindowMs;
    const holdNeeded = postDrop ? p.postDropHoldMs : p.holdMs;

    // RISE-INTO-PLATEAU: the loudness must have climbed meaningfully above its
    // own slow baseline recently. A flat steady groove never opens this gap, so
    // it no longer reads as a climax. A post-drop / breakdown→peak climb does.
    const rising = (this._loud - this._base) >= p.riseDelta;
    if (rising) this._lastRiseMs = s.nowMs;
    // Once we're already on the plateau, a brief grace window keeps the climax
    // HELD even after the climb flattens (the peak section is sustained, not a
    // forever-climbing ramp). A drop also primes the rise (it IS a rise event).
    const onPlateauNow = this._plateauSinceMs !== null;
    const graceMs = (postDrop ? p.postDropWindowMs : p.plateauGraceMs);
    const recentlyRose = (s.nowMs - this._lastRiseMs) < graceMs;
    const roseIntoPlateau = rising || (onPlateauNow && recentlyRose) || postDrop;

    // Plateau test: near the LONG peak AND we rose into it AND a FULL-spectrum
    // slam (bright top end AND bass body) AND above the absolute floor.
    const nearPeak = longPeak > 1e-4 && this._loud >= p.ceilFrac * longPeak;
    const onPlateau = nearPeak && roseIntoPlateau && this._loud >= p.absFloor
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
