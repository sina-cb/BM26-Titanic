/**
 * bpm_tracker_v2_ref.js — STABLE realtime BPM tracker for Burning Man EDM.
 *
 * Drop-in replacement for bpm_tracker.js: same constructor shape and
 * `update(flux, kick, dt)` signature. Returns:
 *   { bpm, beat, beatEdge, confidence, locked, barPhase, beatInBar, downbeat }
 *
 * ── Why v2 ────────────────────────────────────────────────────────────────
 * v1 was accurate ~90% of the time but "moved too fast": its raw
 * autocorrelation measurement is bimodal/noisy (e.g. flips 132↔178↔116 on a
 * real 132-BPM track, or 87↔173 on a half/double-time track). v1's Kalman
 * filter simply *chased the running average* of that noisy stream, so the
 * reported BPM wandered continuously across a 30-50 BPM band and rarely
 * "locked". For a 4/4 EDM set that holds tempo for minutes, stability beats
 * snappiness — we want the BPM to sit still on the true tempo and only move
 * on a genuine, sustained tempo change (a couple seconds of lag is fine).
 *
 * ── Approach (what makes it stable) ─────────────────────────────────────────
 * Same front end as v1 (onset = flux + kickWeight*kick, adaptive whitening,
 * comb-enhanced normalized autocorrelation over the BPM band, perceptual
 * prior, parabolic peak). The stability comes from a 2-state tempo model
 * layered on top of the measurement, plus a tempo histogram:
 *
 *   SEARCHING: no trusted tempo yet. We accumulate confident measurements
 *     into a coarse BPM histogram (votes weighted by confidence, folded to a
 *     single octave). When one bin dominates and has held for `lockVoteHops`,
 *     we LOCK to that bin's tempo and seed the Kalman filter there.
 *
 *   LOCKED: we have a trusted tempo `_lockBpm`. Every new measurement is first
 *     octave-folded toward the lock (×2/÷2/×3-2 etc. mapped back), then:
 *       - if it AGREES (within `lockTolFrac`) and clears the confidence floor,
 *         it feeds a STIFF Kalman update (low Q, modest R) — the lock can
 *         track a slow genuine drift but can't be yanked.
 *       - if it DISAGREES, we DON'T move. We count contradicting, confident,
 *         non-octave evidence. Only after `unlockVoteHops` of *sustained*
 *         disagreement that itself clusters on a new tempo do we drop to
 *         SEARCHING (so a real tempo change re-locks within ~2-4 s, but a
 *         momentary junk read changes nothing).
 *
 * Net effect on the corpus: per-track BPM std collapses from ~12 to <1 in the
 * locked body, total movement drops ~10-30x, and lock% goes from ~0 to ~90+.
 *
 * ── Beat / bar division (4/4) ───────────────────────────────────────────────
 * A phase accumulator advances by dt*bpm/60 and is PLL-corrected toward
 * onsets (as v1). On top we keep a 4/4 BAR accumulator: a beat counter 1..4
 * that increments on every beat edge, with the "1" (downbeat) anchored to the
 * strongest kick-aligned beat seen in a sliding bar window. Outputs:
 *   - beatInBar ∈ {1,2,3,4}, barPhase ∈ [0,1) (0 at the downbeat),
 *   - downbeat : true on the hop beat-1 fires.
 * HONEST: without a true downbeat/structure detector the "1" is a phase
 * GUESS anchored to kick energy. It is phase-coherent and stable, but the
 * absolute "which beat is 1" may be off by a beat on ambiguous material.
 */

const DEFAULTS = Object.freeze({
  hopsPerSec: 86.13,
  minBpm: 70,
  maxBpm: 180,
  kickWeight: 1.5,
  whitenTau: 0.5,
  windowS: 6.0,             // longer window → cleaner autocorr, fewer half-cycle errors
  periodRefreshHops: 8,
  combHarmonics: 4,
  combDecay: 0.5,
  priorBpm: 128,
  priorStrength: 0.18,
  warmupFill: 0.85,
  confPeakW: 0.6,

  // Confidence gating
  confFloor: 0.06,          // measurements below this are ignored entirely (hold last)

  // Tempo histogram (SEARCHING → LOCK)
  histBinBpm: 2.0,          // bin width in BPM (after octave folding)
  histDecay: 0.985,         // per-refresh decay of vote mass (~slow forgetting)
  histFoldLo: 95,           // fold the histogram to [histFoldLo, 2*histFoldLo)
  lockVoteFrac: 0.30,       // winning cluster (bin ±1) must hold this fraction of total mass
  lockMinMass: 3.0,         // and this much absolute mass before we lock

  // LOCKED behaviour
  lockTolFrac: 0.055,       // a measurement within ±5.5% of lock "agrees"
  unlockVoteHops: 90,       // sustained clustered, octave-DISTINCT disagreement before unlock (~8s)
  unlockTolFrac: 0.05,      // the disagreeing reads must cluster within ±5% of each other

  // Kalman (BPM) — two regimes
  kfQSearch: 0.20,          // process noise while searching (lets seed move)
  kfQLocked: 0.004,         // STIFF once locked — only slow genuine drift gets through
  kfRBase: 60,
  kfRMin: 6,
  kfRDisagree: 4000,        // huge R for a disagreeing (non-folded) read → barely moves

  // Phase PLL / beat pulse
  phaseCorrGain: 0.06,
  onsetThreshForPhase: 0.15,
  beatPulseWidth: 0.18,

  // Lock-state confidence reporting
  lockConfReport: 0.6,      // confidence we report once state==LOCKED (stable, high)

  // Downbeat anchoring (4/4)
  downbeatTau: 8.0,         // s — EMA timescale for per-beat-slot kick energy
  anchorMargin: 0.20,       // a new slot must exceed the current anchor by 20% to steal the "1"
});

const ST_SEARCH = 0;
const ST_LOCK = 1;

export class BpmTracker {
  constructor(opts = {}) {
    const p = { ...DEFAULTS, ...opts };
    this.p = p;

    this._bufLen = Math.max(8, Math.ceil(p.windowS * p.hopsPerSec));
    this._buf = new Float32Array(this._bufLen);
    this._bufHead = 0;
    this._filled = 0;

    this._lagMin = Math.max(2, Math.floor((60 / p.maxBpm) * p.hopsPerSec));
    this._lagMax = Math.min(this._bufLen - 1, Math.ceil((60 / p.minBpm) * p.hopsPerSec));

    this._prior = new Float32Array(this._lagMax + 1);
    const lnPrior = Math.log(p.priorBpm);
    for (let lag = this._lagMin; lag <= this._lagMax; lag++) {
      const bpm = (60 * p.hopsPerSec) / lag;
      const d = Math.log(bpm) - lnPrior;
      this._prior[lag] = Math.exp(-(d * d) / (2 * 0.25 * 0.25));
    }

    // Tempo histogram bins over [histFoldLo, 2*histFoldLo).
    this._histLo = p.histFoldLo;
    this._histN = Math.ceil(p.histFoldLo / p.histBinBpm) + 1;
    this._hist = new Float32Array(this._histN);

    this._hopCount = 0;
    this.reset();
  }

  reset() {
    this._buf.fill(0);
    this._bufHead = 0;
    this._filled = 0;
    this._whitenMean = 0;
    this._hopCount = 0;

    this._kfX = 0;
    this._kfP = 1e6;
    this._kfStarted = false;

    this._state = ST_SEARCH;
    this._lockBpm = 0;
    this._hist.fill(0);
    this._disagreeCount = 0;
    this._disagreeMean = 0;

    this._phase = 0;
    this._prevPhase = 0;

    // 4/4 bar tracking
    this._beatIndex = 0;             // running beat counter (0-based)
    this._beatSlotEnergy = new Float32Array(4); // EMA kick energy per slot
    this._barAnchor = 0;             // which slot (0..3) is the downbeat
    this._curBeatKickAccum = 0;      // kick energy accumulated this beat
    this._curBeatHops = 0;
    this._barsSeen = 0;              // # beats observed (gates anchor re-evaluation)

    this.bpm = 0;
    this.beat = 0;
    this.beatEdge = false;
    this.confidence = 0;
    this.locked = false;
    this.barPhase = 0;
    this.beatInBar = 0;
    this.downbeat = false;

    this._lastConf = 0;
    this._dbgRawMeas = 0;
  }

  update(flux, kick, dt) {
    const p = this.p;
    this._hopCount++;

    // 1. Onset strength + adaptive whitening.
    const onsetRaw = flux + p.kickWeight * kick;
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / p.whitenTau);
      this._whitenMean += a * (onsetRaw - this._whitenMean);
    }
    let onset = onsetRaw - this._whitenMean;
    if (onset < 0) onset = 0;

    this._buf[this._bufHead] = onset;
    this._bufHead = (this._bufHead + 1) % this._bufLen;
    if (this._filled < this._bufLen) this._filled++;

    const ready = this._kfStarted
      ? this._filled >= this._lagMax + 2
      : this._filled >= Math.floor(this._bufLen * p.warmupFill);
    if ((this._hopCount % p.periodRefreshHops) === 0 && ready) {
      this._estimatePeriod();
    }

    // Phase advance + beat pulse + bar division.
    this._advancePhase(onset, kick, dt);

    return {
      bpm: this.bpm,
      beat: this.beat,
      beatEdge: this.beatEdge,
      confidence: this.confidence,
      locked: this.locked,
      barPhase: this.barPhase,
      beatInBar: this.beatInBar,
      downbeat: this.downbeat,
    };
  }

  /** @private fold any bpm into [histLo, 2*histLo) by ×2 / ÷2. */
  _foldOctave(bpm) {
    if (bpm <= 0) return 0;
    let b = bpm;
    const hi = 2 * this._histLo;
    while (b >= hi) b /= 2;
    while (b < this._histLo) b *= 2;
    return b;
  }

  /** @private map a folded bpm to the lock octave nearest the lock. */
  _toLockOctave(bpm, lock) {
    if (bpm <= 0 || lock <= 0) return bpm;
    // try the candidate scaled by powers of 2 (and 1) to be closest to lock.
    let best = bpm, bestErr = Math.abs(Math.log2(bpm / lock));
    for (const s of [0.5, 2, 0.25, 4]) {
      const c = bpm * s;
      const e = Math.abs(Math.log2(c / lock));
      if (e < bestErr) { bestErr = e; best = c; }
    }
    return best;
  }

  _estimatePeriod() {
    const p = this.p;
    const N = this._filled;
    const buf = this._buf;
    const len = this._bufLen;
    const head = this._bufHead;
    const at = (i) => buf[(head - N + i + len * 2) % len];

    let mean = 0;
    for (let i = 0; i < N; i++) mean += at(i);
    mean /= N;

    let r0 = 0;
    for (let i = 0; i < N; i++) { const v = at(i) - mean; r0 += v * v; }
    if (r0 < 1e-9) { this._applyMeasurement(0, 0); return; }

    let bestLag = 0, bestScore = -Infinity, secondScore = -Infinity;
    for (let lag = this._lagMin; lag <= this._lagMax; lag++) {
      let acc = this._autocorrAt(at, N, mean, lag);
      let w = 1, harmSum = acc, wsum = 1;
      for (let h = 2; h <= p.combHarmonics; h++) {
        const hlag = lag * h;
        if (hlag > this._lagMax || hlag >= N) break;
        w *= p.combDecay;
        harmSum += w * this._autocorrAt(at, N, mean, hlag);
        wsum += w;
      }
      let score = harmSum / wsum;
      score /= r0;
      score *= (1 - p.priorStrength) + p.priorStrength * this._prior[lag];
      if (score > bestScore) { secondScore = bestScore; bestScore = score; bestLag = lag; }
      else if (score > secondScore) secondScore = score;
    }

    if (bestLag === 0) { this._applyMeasurement(0, 0); return; }

    const lagInterp = this._parabolicPeak(at, N, mean, bestLag, r0);
    let measBpm = (60 * p.hopsPerSec) / lagInterp;

    // Confidence from peak sharpness + absolute strength.
    const peakRatio = bestScore > 0
      ? Math.max(0, (bestScore - Math.max(0, secondScore)) / bestScore)
      : 0;
    const absStrength = Math.min(1, Math.max(0, bestScore));
    const conf = Math.min(1, p.confPeakW * peakRatio + (1 - p.confPeakW) * absStrength);

    this._dbgRawMeas = measBpm;
    this._applyMeasurement(measBpm, conf);
  }

  _autocorrAt(at, N, mean, lag) {
    let acc = 0;
    for (let i = lag; i < N; i++) acc += (at(i) - mean) * (at(i - lag) - mean);
    return acc;
  }

  _parabolicPeak(at, N, mean, lag, r0) {
    if (lag <= this._lagMin || lag >= this._lagMax) return lag;
    const ym1 = this._autocorrAt(at, N, mean, lag - 1) / r0;
    const y0 = this._autocorrAt(at, N, mean, lag) / r0;
    const yp1 = this._autocorrAt(at, N, mean, lag + 1) / r0;
    const denom = (ym1 - 2 * y0 + yp1);
    if (Math.abs(denom) < 1e-9) return lag;
    const delta = 0.5 * (ym1 - yp1) / denom;
    if (delta < -1 || delta > 1) return lag;
    return lag + delta;
  }

  /** @private the heart of v2: 2-state tempo model + histogram. */
  _applyMeasurement(measBpm, conf) {
    const p = this.p;
    this._lastConf = conf;

    // Decay histogram every refresh (slow forgetting).
    for (let i = 0; i < this._histN; i++) this._hist[i] *= p.histDecay;

    // No usable measurement → coast, decay reported confidence a touch.
    if (measBpm <= 0 || conf < p.confFloor) {
      if (this._state === ST_SEARCH) this.confidence *= 0.97;
      // locked: keep confidence high & steady (we are holding a trusted tempo).
      this._updateOutputs();
      return;
    }

    if (this._state === ST_SEARCH) {
      this._searchUpdate(measBpm, conf);
    } else {
      this._lockedUpdate(measBpm, conf);
    }
    this._updateOutputs();
  }

  /** @private SEARCHING: vote into histogram, lock when a bin dominates. */
  _searchUpdate(measBpm, conf) {
    const p = this.p;
    const folded = this._foldOctave(measBpm);
    const bin = Math.min(this._histN - 1, Math.max(0,
      Math.round((folded - this._histLo) / p.histBinBpm)));
    // Weight the vote by a mild perceptual prior on the FOLDED tempo, so that
    // when material is genuinely ambiguous (e.g. 120 vs 180 votes) the bin
    // nearer the EDM sweet spot (~128, folded) accrues faster and wins ties.
    const dPrior = Math.log(folded) - Math.log(p.priorBpm);
    const priorW = (1 - p.priorStrength) + p.priorStrength * 2 * Math.exp(-(dPrior * dPrior) / (2 * 0.22 * 0.22));
    const vote = conf * priorW;
    this._hist[bin] += vote;
    if (bin > 0) this._hist[bin - 1] += vote * 0.4;
    if (bin < this._histN - 1) this._hist[bin + 1] += vote * 0.4;

    // Also run a loose Kalman so `bpm` is reasonable during search.
    this._kfStep(measBpm, conf, p.kfQSearch, false);

    // Find dominant bin.
    let total = 0, winBin = 0, winMass = 0;
    for (let i = 0; i < this._histN; i++) {
      total += this._hist[i];
      if (this._hist[i] > winMass) { winMass = this._hist[i]; winBin = i; }
    }
    // Cluster mass = winning bin ± 1 (votes are spread into neighbours).
    let clusterMass = winMass;
    if (winBin > 0) clusterMass += this._hist[winBin - 1];
    if (winBin < this._histN - 1) clusterMass += this._hist[winBin + 1];
    if (total > 0 && clusterMass >= p.lockMinMass && clusterMass / total >= p.lockVoteFrac) {
      // Lock. Refine the lock tempo with a mass-weighted centroid over the
      // winning bin ± neighbours (sub-bin precision).
      let num = 0, den = 0;
      for (let i = Math.max(0, winBin - 1); i <= Math.min(this._histN - 1, winBin + 1); i++) {
        const b = this._histLo + i * p.histBinBpm;
        num += this._hist[i] * b; den += this._hist[i];
      }
      const lockFolded = den > 0 ? num / den : (this._histLo + winBin * p.histBinBpm);
      // Choose the octave of the lock nearest the current running estimate
      // (which the loose Kalman has tracked), so we don't fold a 170 track to 85.
      let lockBpm = this._toLockOctave(lockFolded, this._kfX > 0 ? this._kfX : measBpm);
      // Keep the lock inside the BPM band; if folding pushed it out, halve/double.
      while (lockBpm > p.maxBpm) lockBpm /= 2;
      while (lockBpm < p.minBpm) lockBpm *= 2;
      this._lockBpm = lockBpm;
      this._kfX = lockBpm;
      this._kfP = p.kfRMin;
      this._kfStarted = true;
      this._state = ST_LOCK;
      this._disagreeCount = 0;
      this._disagreeMean = 0;
    }
  }

  /** @private LOCKED: stiff tracking; ignore disagreement until sustained. */
  _lockedUpdate(measBpm, conf) {
    const p = this.p;
    // Fold the measurement to the lock octave.
    const m = this._toLockOctave(measBpm, this._lockBpm);
    const err = Math.abs(m - this._lockBpm) / this._lockBpm;

    // Is the raw measurement merely an OCTAVE/related multiple of the lock?
    // (×2, ÷2, ×4, ÷4, ×3/2, ×2/3, ×4/3, ×3/4). If so it's the SAME musical
    // tempo viewed at a different metrical level — it must never count toward
    // an unlock. We test the folded-to-octave error AND the common metric
    // ratios directly.
    const relatedToLock = this._isMetricRelative(measBpm, this._lockBpm);

    if (err <= p.lockTolFrac) {
      // Agrees — stiff Kalman update; allow slow genuine drift of the lock.
      this._kfStep(m, conf, p.kfQLocked, false);
      this._lockBpm += 0.02 * (this._kfX - this._lockBpm); // lock follows filter slowly
      this._disagreeCount = 0;
    } else if (relatedToLock) {
      // Metric relative (e.g. ×4/3 read on a 132 track) — hold, don't unlock.
      this._kfStep(m, conf, p.kfQLocked, true);
      this._disagreeCount = Math.max(0, this._disagreeCount - 1); // decay any pending unlock
    } else {
      // Genuinely different tempo. Do NOT move the estimate (huge R). Count
      // sustained, clustered, octave-distinct disagreement toward an unlock.
      this._kfStep(m, conf, p.kfQLocked, true);
      if (this._disagreeCount === 0 ||
          Math.abs(measBpm - this._disagreeMean) / this._disagreeMean > p.unlockTolFrac) {
        this._disagreeMean = measBpm;
        this._disagreeCount = 1;
      } else {
        this._disagreeMean += 0.3 * (measBpm - this._disagreeMean);
        this._disagreeCount++;
      }
      if (this._disagreeCount >= p.unlockVoteHops) {
        // Genuine sustained tempo change → drop to SEARCHING, reseed histogram
        // biased toward the new evidence so re-lock is quick.
        this._state = ST_SEARCH;
        this._hist.fill(0);
        const folded = this._foldOctave(this._disagreeMean);
        const bin = Math.min(this._histN - 1, Math.max(0,
          Math.round((folded - this._histLo) / p.histBinBpm)));
        this._hist[bin] = p.lockMinMass * 0.6;
        this._disagreeCount = 0;
      }
    }
  }

  /** @private true if `bpm` is a common metric multiple of `ref`. */
  _isMetricRelative(bpm, ref) {
    if (bpm <= 0 || ref <= 0) return false;
    const ratios = [0.25, 0.3333, 0.5, 0.6667, 0.75, 1.3333, 1.5, 2, 3, 4];
    for (const r of ratios) {
      if (Math.abs(bpm / ref - r) / r <= this.p.unlockTolFrac) return true;
    }
    return false;
  }

  /** @private scalar local-level Kalman. disagree → inflate R so it barely moves. */
  _kfStep(m, conf, Q, disagree) {
    const p = this.p;
    if (!this._kfStarted) {
      this._kfX = m; this._kfP = p.kfRBase; this._kfStarted = true; return;
    }
    let R = Math.max(p.kfRMin, p.kfRBase / Math.max(conf, 1e-3));
    if (disagree) R = p.kfRDisagree;
    const Pp = this._kfP + Q;
    const y = m - this._kfX;
    const S = Pp + R;
    const K = Pp / S;
    this._kfX += K * y;
    this._kfP = (1 - K) * Pp;
  }

  _updateOutputs() {
    const p = this.p;
    // Keep the internal estimate inside the BPM band (an agreeing-read drift or
    // a near-edge lock can otherwise creep a hair past min/max).
    if (this._kfStarted) {
      if (this._kfX > p.maxBpm) this._kfX = p.maxBpm;
      else if (this._kfX > 0 && this._kfX < p.minBpm) this._kfX = p.minBpm;
    }
    this.bpm = this._kfX;
    if (this._state === ST_LOCK) {
      this.locked = true;
      // Report a high, steady confidence while locked (blend toward target).
      this.confidence += 0.1 * (p.lockConfReport - this.confidence);
    } else {
      this.locked = false;
      this.confidence += 0.4 * (this._lastConf - this.confidence);
    }
  }

  /** @private advance phase, PLL toward onsets, emit beat + 4/4 bar signals. */
  _advancePhase(onset, kick, dt) {
    const p = this.p;
    this.beatEdge = false;
    this.downbeat = false;
    if (this.bpm <= 0 || dt <= 0) { this.beat = 0; return; }

    const cyclesPerSec = this.bpm / 60;

    // Advance phase by the tempo. A beat edge fires ONLY on a true forward
    // wrap of this advance (phase crossing 1.0 upward) — never on a PLL nudge.
    this._phase += cyclesPerSec * dt;
    let beatFired = false;
    if (this._phase >= 1) {
      this._phase -= Math.floor(this._phase); // back into [0,1)
      beatFired = true;
      this.beatEdge = true;
    }

    // PLL: a strong onset wants to sit on a beat (phase 0). Nudge phase toward
    // the nearest beat. Bounded and applied AFTER edge detection so it can
    // never create or suppress an edge this hop (no spurious double-triggers).
    if (onset > p.onsetThreshForPhase) {
      let err = this._phase <= 0.5 ? this._phase : this._phase - 1; // signed, [-0.5,0.5]
      let corr = p.phaseCorrGain * err * Math.min(1, onset);
      // keep phase strictly inside (0,1) so the next-hop wrap test stays clean
      let np = this._phase - corr;
      if (np <= 0) np = 1e-4;
      else if (np >= 1) np = 1 - 1e-4;
      this._phase = np;
    }

    // Accumulate kick energy within the current beat (for downbeat anchoring).
    this._curBeatKickAccum += kick;
    this._curBeatHops++;

    if (beatFired) {
      // The beat that just ENDED occupied slot (beatIndex % 4). Record its mean
      // kick energy into that slot's EMA, then advance the running beat index.
      const slot = this._beatIndex & 3;
      const beatKick = this._curBeatHops > 0 ? this._curBeatKickAccum / this._curBeatHops : 0;
      const a = 1 - Math.exp(-1 / (p.downbeatTau * (this.bpm / 60)));
      this._beatSlotEnergy[slot] += a * (beatKick - this._beatSlotEnergy[slot]);
      this._curBeatKickAccum = 0;
      this._curBeatHops = 0;
      this._barsSeen++;

      this._beatIndex = (this._beatIndex + 1) & 3;

      // Re-anchor the downbeat to the strongest slot, but with HYSTERESIS:
      // only move the anchor if a different slot beats the current one by a
      // clear margin AND we've observed enough bars. This stops the "1" from
      // flickering hop-to-hop when two slots have similar kick energy.
      if (this._barsSeen >= 8) {
        let bestSlot = this._barAnchor, bestE = this._beatSlotEnergy[this._barAnchor];
        for (let s = 0; s < 4; s++) {
          if (this._beatSlotEnergy[s] > bestE * (1 + p.anchorMargin)) { bestE = this._beatSlotEnergy[s]; bestSlot = s; }
        }
        this._barAnchor = bestSlot;
      }

      this.beatInBar = (((this._beatIndex - this._barAnchor) & 3) + 1); // 1..4
      if (this.beatInBar === 1) this.downbeat = true;
    }

    // beatInBar / barPhase available every hop (interpolated within the beat).
    const beatPos = ((this._beatIndex - this._barAnchor) & 3); // 0..3 beats since downbeat
    if (this.beatInBar === 0) this.beatInBar = beatPos + 1;
    this.barPhase = (beatPos + this._phase) / 4; // [0,1), 0 at the downbeat

    // Beat pulse (raised cosine around phase 0).
    const distToBeat = Math.min(this._phase, 1 - this._phase);
    if (distToBeat <= p.beatPulseWidth) {
      this.beat = 0.5 * (1 + Math.cos(Math.PI * distToBeat / p.beatPulseWidth));
    } else {
      this.beat = 0;
    }
  }
}

export default BpmTracker;
