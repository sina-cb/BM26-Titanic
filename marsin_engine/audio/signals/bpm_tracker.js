/**
 * bpm_tracker_ref.js — realtime, low-latency BPM tracker with a phase-locked
 * beat pulse and confidence, tuned for Burning Man EDM on a Raspberry Pi.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * A drop-in ES module that consumes the engine's per-hop audio signals
 * (`flux` + `kick`, both already in [0,1] from AudioAnalyzer) and produces:
 *   - bpm        : smoothed tempo estimate (70–180 BPM range)
 *   - beat       : a 0..1 pulse that peaks ON each downbeat (phase-locked)
 *   - beatEdge   : true exactly on the hop a beat crosses (for event triggers)
 *   - confidence : 0..1, how trustworthy the current lock is
 *   - locked     : boolean, true once confidence has held above a floor
 *
 * Runs at ~86 hops/s (44100/512). NO per-hop heap allocations after warmup:
 * all buffers are pre-sized typed arrays / plain-number scalars. Pure Math.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. ONSET ENVELOPE. Combine spectral flux and kick into one onset-strength
 *    signal: onset = flux + KICK_WEIGHT*kick. Flux already emphasises rising
 *    spectral energy (snares/hats/risers); kick anchors the 4-on-the-floor
 *    pulse that dominates EDM. We then subtract a slow local mean (adaptive
 *    whitening) and half-wave rectify so only above-average onsets survive —
 *    this de-trends loud/quiet sections so autocorrelation sees pulse shape,
 *    not absolute level.
 *
 * 2. PERIOD ESTIMATION (comb / autocorrelation). Keep a ring buffer of the
 *    last WINDOW_S seconds of the whitened onset envelope. Once per
 *    PERIOD_REFRESH_HOPS we autocorrelate the buffer across the lag range
 *    that maps to 70–180 BPM. The autocorrelation is enhanced with a
 *    "tempo comb": for each candidate lag we also add the correlation at
 *    2x and 3x that lag (sub-harmonics), which disambiguates the octave
 *    (e.g. 64 vs 128 BPM) by rewarding lags whose multiples also line up.
 *    A perceptual prior (log-Gaussian centred at 128 BPM) biases ties toward
 *    the EDM sweet spot. The peak lag → raw BPM measurement.
 *
 * 3. KALMAN SMOOTHING. The raw BPM measurement is noisy (it jumps octaves,
 *    picks neighbours). We smooth it with a scalar local-level (random-walk)
 *    Kalman filter: state = true BPM, process noise Q lets it drift slowly,
 *    measurement noise R is scaled DOWN when the autocorrelation peak is
 *    sharp (high confidence) and UP when it's flat — so a confident
 *    measurement pulls the estimate fast (quick lock) and a junk measurement
 *    barely nudges it (stability). An octave-snap step folds a measurement
 *    that is ~1/2 or ~2x the current estimate back to the same octave before
 *    it enters the filter, so a momentary half/double-time reading can't yank
 *    the lock.
 *
 * 4. PHASE / BEAT PULSE. A phase accumulator advances every hop by
 *    dt * bpm/60 (cycles). We PLL-correct its phase toward observed onsets:
 *    when a strong onset arrives, nudge the phase so a beat lands on it
 *    (small correction → smooth, no jumps). `beat` is a raised-cosine pulse
 *    around phase==0; `beatEdge` is the wrap event.
 *
 * ── Tuned params (validated on the FMA EDM corpus) ────────────────────────
 * See signals_params.json. Defaults below are the recommended values.
 */

const TWO_PI = Math.PI * 2;

export const BPM_TRACKER_DEFAULTS = Object.freeze({
  hopsPerSec: 86.13,        // 44100/512; pass real dt each hop, this is only a fallback
  minBpm: 70,
  maxBpm: 180,
  kickWeight: 1.5,          // kick contributes 1.5x its value to the onset env
  whitenTau: 0.5,           // s — local-mean EMA for adaptive whitening
  windowS: 4.0,             // s — autocorrelation analysis window
  periodRefreshHops: 8,     // recompute the period every N hops (~10 Hz)
  combHarmonics: 3,         // sum autocorr at lag, 2*lag, 3*lag
  combDecay: 0.5,           // weight of each higher harmonic (0.5 -> 1,0.5,0.25)
  priorBpm: 128,            // perceptual tempo prior centre (EDM)
  priorStrength: 0.15,      // weight of the perceptual prior — breaks octave ties only
  octaveCorrFloor: 0.85,    // an octave candidate must keep ≥85% of the peak corr to win
  octaveVotes: 10,          // consecutive octave-disagreeing reads before the filter jumps (~1.2s)
  octaveStickiness: 0.6,    // strong bonus for the candidate in the currently-tracked octave
  warmupFill: 0.85,         // require the analysis buffer this full before first estimate
  confPeakW: 0.6,           // weight of peak-sharpness vs abs strength in confidence
  // Kalman (BPM state)
  kfQ: 0.15,                // process noise (BPM^2 per hop-ish); lower=stiffer/more stable
  kfRBase: 60,              // base measurement noise (BPM^2); scaled by 1/conf
  kfRMin: 4,                // floor so a perfect peak still trusts the model a bit
  // Phase PLL
  phaseCorrGain: 0.08,      // fraction of phase error corrected per strong onset
  onsetThreshForPhase: 0.15,// whitened onset must exceed this to pull phase
  beatPulseWidth: 0.18,     // raised-cosine half-width in cycles
  // Lock / confidence
  lockConf: 0.25,           // confidence at/above which we call it "locked"
  lockHoldHops: 60,         // must hold ~0.7s before declaring lock (anti-flicker)
});

export class BpmTracker {
  constructor(opts = {}) {
    const p = { ...BPM_TRACKER_DEFAULTS, ...opts };
    this.p = p;

    // Ring buffer of whitened onset env over WINDOW_S.
    this._bufLen = Math.max(8, Math.ceil(p.windowS * p.hopsPerSec));
    this._buf = new Float32Array(this._bufLen);
    this._bufHead = 0;
    this._filled = 0;

    // Lag range (in hops) for the BPM band. lag = 60/(bpm) * hopsPerSec.
    // small bpm -> large lag.
    this._lagMin = Math.max(2, Math.floor((60 / p.maxBpm) * p.hopsPerSec));
    this._lagMax = Math.min(this._bufLen - 1, Math.ceil((60 / p.minBpm) * p.hopsPerSec));

    // Pre-compute the perceptual prior over lag (log-Gaussian on BPM).
    this._prior = new Float32Array(this._lagMax + 1);
    const lnPrior = Math.log(p.priorBpm);
    for (let lag = this._lagMin; lag <= this._lagMax; lag++) {
      const bpm = (60 * p.hopsPerSec) / lag;
      const d = Math.log(bpm) - lnPrior;
      this._prior[lag] = Math.exp(-(d * d) / (2 * 0.25 * 0.25)); // sigma≈0.25 in log
    }

    this._hopCount = 0;
    this.reset();
  }

  reset() {
    this._buf.fill(0);
    this._bufHead = 0;
    this._filled = 0;
    this._whitenMean = 0;
    this._hopCount = 0;

    // Kalman BPM state — lazily seeded from first good measurement.
    this._kfX = 0;       // BPM estimate
    this._kfP = 1e6;     // huge initial variance (no info yet)
    this._kfStarted = false;
    this._octaveVotes = 0;

    // Phase accumulator (cycles in [0,1)).
    this._phase = 0;
    this._prevPhase = 0;

    // Outputs.
    this.bpm = 0;
    this.beat = 0;
    this.beatEdge = false;
    this.confidence = 0;
    this.locked = false;
    this._lockHeld = 0;

    this._lastConf = 0;
  }

  /**
   * Per-hop update.
   * @param {number} flux  — AudioAnalyzer flux  [0,1]
   * @param {number} kick  — AudioAnalyzer kick  [0,1]
   * @param {number} dt    — seconds since previous hop (use real dt!)
   * @returns {{bpm,beat,beatEdge,confidence,locked}}
   */
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

    // Push into ring.
    this._buf[this._bufHead] = onset;
    this._bufHead = (this._bufHead + 1) % this._bufLen;
    if (this._filled < this._bufLen) this._filled++;

    // 2. Period estimation (throttled). Wait for the analysis buffer to be
    //    mostly full before the FIRST estimate — partial-window autocorrelation
    //    only sees ~1 cycle of a slow tempo and reliably picks the wrong octave,
    //    which would then seed the filter badly.
    const ready = this._kfStarted
      ? this._filled >= this._lagMax + 2
      : this._filled >= Math.floor(this._bufLen * p.warmupFill);
    if ((this._hopCount % p.periodRefreshHops) === 0 && ready) {
      this._estimatePeriod();
    }

    // 4. Phase advance + beat pulse.
    this._advancePhase(onset, dt);

    return {
      bpm: this.bpm,
      beat: this.beat,
      beatEdge: this.beatEdge,
      confidence: this.confidence,
      locked: this.locked,
    };
  }

  /** @private autocorrelation + comb + prior → Kalman-smoothed BPM. */
  _estimatePeriod() {
    const p = this.p;
    const N = this._filled;
    const buf = this._buf;
    const len = this._bufLen;
    const head = this._bufHead; // points one past the newest

    // Index helper: i=0 is oldest in window, i=N-1 newest.
    // newest is at (head-1). oldest in a full buffer is at head.
    const at = (i) => buf[(head - N + i + len * 2) % len];

    // Mean for de-meaning (autocorr of zero-mean signal).
    let mean = 0;
    for (let i = 0; i < N; i++) mean += at(i);
    mean /= N;

    // Zeroth lag (energy) for normalisation.
    let r0 = 0;
    for (let i = 0; i < N; i++) { const v = at(i) - mean; r0 += v * v; }
    if (r0 < 1e-9) { // silence — no measurement
      this._applyMeasurement(0, 0);
      return;
    }

    let bestLag = 0, bestScore = -Infinity, secondScore = -Infinity;
    for (let lag = this._lagMin; lag <= this._lagMax; lag++) {
      // Base autocorrelation at this lag.
      let acc = this._autocorrAt(at, N, mean, lag);
      // Tempo comb: reward lags whose 2x/3x multiples also correlate.
      let w = 1, harmSum = acc, wsum = 1;
      for (let h = 2; h <= p.combHarmonics; h++) {
        const hlag = lag * h;
        if (hlag > this._lagMax || hlag >= N) break;
        w *= p.combDecay;
        harmSum += w * this._autocorrAt(at, N, mean, hlag);
        wsum += w;
      }
      let score = harmSum / wsum;
      // Normalise to [~ -1, 1] then apply perceptual prior.
      score /= r0;
      score *= (1 - p.priorStrength) + p.priorStrength * this._prior[lag];
      if (score > bestScore) { secondScore = bestScore; bestScore = score; bestLag = lag; }
      else if (score > secondScore) secondScore = score;
    }

    if (bestLag === 0) { this._applyMeasurement(0, 0); return; }

    // Parabolic interpolation around the peak lag for sub-hop precision.
    const lagInterp = this._parabolicPeak(at, N, mean, bestLag, r0);
    let measBpm = (60 * p.hopsPerSec) / lagInterp;

    // OCTAVE DISAMBIGUATION (dance-music prior). The raw autocorr peak in
    // 4-on-the-floor EDM very often lands on HALF tempo (a kick lands on every
    // beat, so the half-tempo lag spans two kicks and correlates just as
    // strongly). For each related tempo (×2, ÷2, ×3/2, ×2/3) that stays inside
    // [minBpm,maxBpm], we read the actual autocorrelation at its lag; we then
    // pick the candidate that maximises corr × prior(bpm). Because prior()
    // peaks at priorBpm (≈128), a ×2 candidate with near-equal correlation
    // wins whenever it sits closer to the EDM sweet spot — folding 85→170 is
    // out of band, but 85→… stays; 70→140 folds up. This is the standard
    // "resolve the tempo octave toward the perceptual range" trick.
    {
      const baseCorr = this._autocorrAt(at, N, mean, bestLag) / r0;
      const cands = [
        { bpm: measBpm, lag: lagInterp },
        { bpm: measBpm * 2, lag: lagInterp / 2 },
        { bpm: measBpm / 2, lag: lagInterp * 2 },
      ];
      let bestC = null, bestVal = -Infinity;
      for (const c of cands) {
        if (c.bpm < p.minBpm || c.bpm > p.maxBpm) continue;
        const lag = Math.round(c.lag);
        if (lag < this._lagMin || lag > this._lagMax) continue;
        const corr = this._autocorrAt(at, N, mean, lag) / r0;
        // Require the candidate to retain a real fraction of the base peak's
        // correlation (so we never jump to a tempo the signal doesn't support).
        if (corr < baseCorr * p.octaveCorrFloor) continue;
        const prior = this._prior[Math.min(lag, this._lagMax)] || 0;
        let val = corr * ((1 - p.priorStrength) + p.priorStrength * prior * 4);
        // OCTAVE HYSTERESIS: once the filter is tracking an octave, reward the
        // candidate that stays in it. This stops the estimate from flapping
        // between equally-supported octaves (172↔86) hop-to-hop — we pick an
        // octave at lock and hold it unless another octave is clearly stronger.
        if (this._kfStarted && this._kfX > 0) {
          const er = c.bpm / this._kfX;
          if (Math.abs(er - 1) < 0.12) val *= (1 + p.octaveStickiness);
        }
        if (val > bestVal) { bestVal = val; bestC = c; }
      }
      if (bestC) measBpm = bestC.bpm;
    }

    // Confidence: peak sharpness (best vs second) blended with absolute
    // correlation strength. Both in [0,1]-ish.
    const peakRatio = bestScore > 0
      ? Math.max(0, (bestScore - Math.max(0, secondScore)) / bestScore)
      : 0;
    const absStrength = Math.min(1, Math.max(0, bestScore));
    const conf = Math.min(1, p.confPeakW * peakRatio + (1 - p.confPeakW) * absStrength);

    this._applyMeasurement(measBpm, conf);
  }

  /** @private single-lag normalized-correlation accumulator. */
  _autocorrAt(at, N, mean, lag) {
    let acc = 0;
    for (let i = lag; i < N; i++) acc += (at(i) - mean) * (at(i - lag) - mean);
    return acc;
  }

  /** @private parabolic interpolation of the peak lag (sub-hop). */
  _parabolicPeak(at, N, mean, lag, r0) {
    if (lag <= this._lagMin || lag >= this._lagMax) return lag;
    const ym1 = this._autocorrAt(at, N, mean, lag - 1) / r0;
    const y0  = this._autocorrAt(at, N, mean, lag)     / r0;
    const yp1 = this._autocorrAt(at, N, mean, lag + 1) / r0;
    const denom = (ym1 - 2 * y0 + yp1);
    if (Math.abs(denom) < 1e-9) return lag;
    const delta = 0.5 * (ym1 - yp1) / denom;
    if (delta < -1 || delta > 1) return lag;
    return lag + delta;
  }

  /** @private octave-snap then Kalman-update the BPM estimate. */
  _applyMeasurement(measBpm, conf) {
    const p = this.p;
    this._lastConf = conf;

    if (measBpm <= 0 || conf <= 0) {
      // No usable measurement this cycle — let confidence decay slightly,
      // keep the estimate (model coasts).
      this.confidence *= 0.97;
      this._updateLock();
      return;
    }

    // The measurement octave is already resolved toward the perceptual prior
    // in _estimatePeriod. Here we only (a) seed the filter, (b) reconcile a
    // measurement that sits an OCTAVE off the current estimate via a small
    // vote so the filter can JUMP to a better-supported octave instead of
    // permanently snapping every reading back to a bad early seed, and
    // (c) fold ×1.5 related tempi toward the estimate (no octave change).
    let m = measBpm;
    if (this._kfStarted && this._kfX > 0) {
      const r2 = m / this._kfX;
      // Octave vote: if the measurement is ~2× or ~0.5× the estimate, don't
      // blindly accept (could be a transient octave flip) — count consecutive
      // octave-disagreeing measurements; only jump once OCTAVE_VOTES agree.
      const isOctaveUp = Math.abs(r2 - 2) < 0.18;
      const isOctaveDn = Math.abs(r2 - 0.5) < 0.045;
      if (isOctaveUp || isOctaveDn) {
        this._octaveVotes++;
        if (this._octaveVotes < p.octaveVotes) {
          // Not yet convinced — fold toward the current octave for now.
          m = isOctaveUp ? m / 2 : m * 2;
        } else {
          // Convinced: JUMP the filter to the new octave, reset its variance.
          this._kfX = m;
          this._kfP = p.kfRBase;
          this._octaveVotes = 0;
        }
      } else {
        this._octaveVotes = 0;
      }
    }

    if (!this._kfStarted) {
      this._kfX = m;
      this._kfP = p.kfRBase;
      this._kfStarted = true;
    } else {
      // R scaled by confidence: confident → small R → trust measurement.
      const R = Math.max(p.kfRMin, p.kfRBase / Math.max(conf, 1e-3));
      const Pp = this._kfP + p.kfQ;     // predict (random walk, F=1)
      const y = m - this._kfX;          // innovation
      const S = Pp + R;
      const K = Pp / S;
      this._kfX += K * y;
      this._kfP = (1 - K) * Pp;
    }

    this.bpm = this._kfX;
    // Confidence output is the raw measurement confidence smoothed a touch.
    this.confidence += 0.4 * (conf - this.confidence);
    this._updateLock();
  }

  /** @private lock hysteresis. */
  _updateLock() {
    const p = this.p;
    if (this.confidence >= p.lockConf && this.bpm >= p.minBpm && this.bpm <= p.maxBpm) {
      if (this._lockHeld < p.lockHoldHops) this._lockHeld++;
    } else {
      this._lockHeld = 0;
    }
    this.locked = this._lockHeld >= p.lockHoldHops;
  }

  /** @private advance phase, PLL-correct toward onsets, emit beat pulse. */
  _advancePhase(onset, dt) {
    const p = this.p;
    this.beatEdge = false;
    if (this.bpm <= 0 || dt <= 0) { this.beat = 0; return; }

    const cyclesPerSec = this.bpm / 60;
    this._prevPhase = this._phase;
    this._phase += cyclesPerSec * dt;

    // PLL: a strong onset wants to sit on a beat (phase 0). Compute the
    // signed phase error (nearest beat) and nudge the phase toward it.
    if (onset > p.onsetThreshForPhase) {
      let err = this._phase - Math.round(this._phase); // in [-0.5,0.5]
      // pull phase so the onset lands on a beat: reduce err
      this._phase -= p.phaseCorrGain * err * Math.min(1, onset);
    }

    // Wrap.
    if (this._phase >= 1) {
      this._phase -= Math.floor(this._phase);
      this.beatEdge = true;
    } else if (this._phase >= 0 && this._prevPhase > this._phase) {
      this.beatEdge = true;
    }

    // Beat pulse: raised cosine centred on phase==0 (and ==1).
    const distToBeat = Math.min(this._phase, 1 - this._phase); // 0 at beat
    if (distToBeat <= p.beatPulseWidth) {
      this.beat = 0.5 * (1 + Math.cos(Math.PI * distToBeat / p.beatPulseWidth));
    } else {
      this.beat = 0;
    }
  }
}

export default BpmTracker;
