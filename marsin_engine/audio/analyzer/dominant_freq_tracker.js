/**
 * DominantFreqTracker — tracks the N most dominant frequencies in a
 * magnitude spectrum across hops, emitting per-track {freqHz, energy}.
 *
 * Drop-in reference for marsin_engine/audio/analyzer/audio_analyzer.js.
 * It consumes the SAME positive-frequency magnitude array the analyzer
 * already computes (length fftSize/2, mag[k] = hypot(re,im)), so it adds
 * zero extra FFT cost. Pure: depends only on Math. No per-hop heap
 * allocations in the hot path (all scratch buffers are pre-sized in the
 * constructor) so it is cheap enough for a Raspberry Pi.
 *
 * Pipeline per hop:
 *   1. Peak-pick: local maxima of mag above a relative floor (a fraction
 *      of the hop's max magnitude) AND an absolute floor; keep the top
 *      `numPeaks` by magnitude.
 *   2. Parabolic (quadratic) interpolation on each peak's 3 log-magnitude
 *      bins for sub-bin frequency + true peak magnitude. Critical at
 *      fftSize=1024 where one bin is ~43 Hz — far too coarse for bass.
 *   3. Main-lobe energy: integrate magnitude over +-mainLobeBins around
 *      the peak bin so the reported energy is the partial's lobe, not a
 *      single bin (a Hann lobe is ~4 bins wide).
 *   4. Track association: greedy nearest-frequency match of this hop's
 *      peaks to existing tracks within `maxJumpHz`. Unmatched strong
 *      peaks BIRTH a new track (replacing the weakest/dead track if all
 *      slots are full). A track that goes unmatched decays; if its
 *      smoothed energy stays below `deathEnergy` for `deathHops` it DIES.
 *   5. Smoothing: per-track 2-state ([freq, energy]) constant-velocity-ish
 *      Kalman OR scalar EMA, selected by `useKalman`. Both keep the
 *      output from jittering bin-to-bin while still following real moves.
 *   6. Energy map: softCompress(energyGain * lobeEnergy) -> [0,1), the
 *      SAME family of map the analyzer's bands use, so the value is
 *      directly comparable to low/mid/high band values.
 *
 * Output order is STABLE: index 0 is the track that has held the most
 * energy recently (a slow energy-ranked sort), so dom1/dom2 don't swap
 * labels every hop. Dead/empty slots emit {freqHz:0, energy:0}.
 */

const TWO_PI = Math.PI * 2;

function softCompress(x) {
  // Maps [0, +inf) -> [0, 1). Matches audio_analyzer.js.
  return x / (1 + x);
}

/**
 * Parabolic peak interpolation on three samples y(-1), y0, y(+1) where y0
 * is a local max. Returns the fractional offset of the vertex in [-0.5,
 * 0.5] and the interpolated peak value. (Smith, "Spectral Audio Signal
 * Processing", QIFFT.) Operates on whatever the caller passes — we pass
 * log-magnitude, which makes the Gaussian-ish Hann lobe closer to a true
 * parabola and improves the frequency estimate.
 */
function parabolicVertex(ym1, y0, yp1) {
  const denom = ym1 - 2 * y0 + yp1;
  if (denom === 0) return { delta: 0, value: y0 };
  const delta = (0.5 * (ym1 - yp1)) / denom;
  const value = y0 - 0.25 * (ym1 - yp1) * delta;
  return { delta, value };
}

class Track {
  constructor() {
    this.active = false;
    this.freqHz = 0;       // smoothed frequency
    this.energy = 0;       // smoothed [0,1)-ish energy
    this.loHz = 0;         // cluster window low edge (the dominance region)
    this.hiHz = 0;         // cluster window high edge
    this.rankEnergy = 0;   // slow energy for stable output ordering
    this.lowHops = 0;      // consecutive hops below death threshold
    this.id = 0;
    // Kalman state: x = [freq, energy], P diagonal-ish (we keep a small
    // full 2x2 per element since freq & energy are independent here -> two
    // scalar Kalmans, stored flat to avoid object churn).
    this.fP = 1;           // freq variance
    this.eP = 1;           // energy variance
  }
}

export class DominantFreqTracker {
  /**
   * @param {object} opts
   * @param {number} opts.sampleRate
   * @param {number} opts.fftSize        — FFT length the mag array came from
   * @param {number} [opts.numTracks=2]  — how many partials to report
   * @param {number} [opts.numPeaks]     — candidate peaks picked per hop
   * @param {number} [opts.mainLobeBins] — half-width of lobe energy window
   * @param {number} [opts.relFloor]     — peak floor as fraction of hop max
   * @param {number} [opts.absFloor]     — absolute mag floor (post /fftSize style off; raw mag)
   * @param {number} [opts.maxJumpHz]    — association gate
   * @param {number} [opts.minFreqHz]    — ignore peaks below this (DC/rumble)
   * @param {number} [opts.maxFreqHz]    — ignore peaks above this
   * @param {number} [opts.energyGain]   — gain into softCompress for energy
   * @param {number} [opts.deathEnergy]  — track dies if energy stays below
   * @param {number} [opts.deathHops]    — ...for this many hops
   * @param {number} [opts.birthEnergy]  — min lobe energy (mapped) to birth
   * @param {boolean}[opts.useKalman=true]
   * @param {number} [opts.emaFreqAlpha] — EMA smoothing (if !useKalman)
   * @param {number} [opts.emaEnergyAlpha]
   * @param {number} [opts.kfFreqQ]      — Kalman process noise (freq)
   * @param {number} [opts.kfFreqR]      — Kalman measurement noise (freq)
   * @param {number} [opts.kfEnergyQ]
   * @param {number} [opts.kfEnergyR]
   * @param {number} [opts.rankAlpha]    — slow EMA for output ordering
   */
  constructor(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('DominantFreqTracker requires options');
    }
    const sampleRate = +opts.sampleRate;
    const fftSize = opts.fftSize | 0;
    if (!(sampleRate > 0)) throw new RangeError('sampleRate must be > 0');
    if (fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
      throw new RangeError('fftSize must be a positive power of two');
    }

    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.numBins = fftSize >> 1;            // length of mag array we consume
    this.binHz = sampleRate / fftSize;      // Hz per bin

    this.numTracks    = opts.numTracks    ?? 2;
    this.numPeaks     = opts.numPeaks     ?? 6;
    this.mainLobeBins = opts.mainLobeBins ?? 2;       // (legacy; energy now uses a dynamic window)
    // Dynamic energy window — frequency-proportional band summed around the
    // peak (constant-Q-ish), so dom energy tracks the partial's loudness.
    this.energyWindowFrac  = opts.energyWindowFrac  ?? 0.12;  // ±12% of the freq …
    this.energyWindowMinHz = opts.energyWindowMinHz ?? 40;    // … clamped to [40, 400] Hz
    this.energyWindowMaxHz = opts.energyWindowMaxHz ?? 400;
    this.relFloor     = opts.relFloor     ?? 0.12;
    this.absFloor     = opts.absFloor     ?? 1e-4;
    this.maxJumpHz    = opts.maxJumpHz    ?? 80;
    // Association gate is PROPORTIONAL to frequency (constant-Q): a flat 80 Hz
    // is >1 semitone at the bass (so a coasting bass track wrongly grabs a
    // different nearby note → freq smear/jump), but tiny up high. Gate =
    // clamp(freq·maxJumpFrac, minJumpHz, maxJumpHz). ~6% ≈ one semitone.
    this.maxJumpFrac  = opts.maxJumpFrac  ?? 0.06;
    this.minJumpHz    = opts.minJumpHz    ?? 12;
    this.minFreqHz    = opts.minFreqHz    ?? 30;
    this.maxFreqHz    = opts.maxFreqHz    ?? 8000;
    this.energyGain   = opts.energyGain   ?? 8.0;
    this.deathEnergy  = opts.deathEnergy  ?? 0.06;
    this.deathHops    = opts.deathHops    ?? 12;
    this.birthEnergy  = opts.birthEnergy  ?? 0.10;
    this.useKalman    = opts.useKalman    ?? true;
    this.emaFreqAlpha   = opts.emaFreqAlpha   ?? 0.35;
    this.emaEnergyAlpha = opts.emaEnergyAlpha ?? 0.30;
    this.kfFreqQ   = opts.kfFreqQ   ?? 40;     // Hz^2 per hop the freq may drift
    this.kfFreqR   = opts.kfFreqR   ?? 25;     // Hz^2 measurement noise
    this.kfEnergyQ = opts.kfEnergyQ ?? 0.01;
    this.kfEnergyR = opts.kfEnergyR ?? 0.02;
    this.rankAlpha = opts.rankAlpha ?? 0.05;
    // Cluster window: the dominance region is the peak ± neighbours staying
    // above clusterThresh × peak (bounded by clusterMaxHz).
    this.clusterThresh = opts.clusterThresh ?? 0.35;
    this.clusterMaxHz  = opts.clusterMaxHz  ?? 500;
    // Software input gain (mic preamp) — scales the reported energy so dom
    // energy tracks the operator's gain like the bands/spectrum. Live-settable.
    this.inputGain     = opts.inputGain     ?? 1;

    this._minBin = Math.max(1, Math.floor(this.minFreqHz / this.binHz));
    this._maxBin = Math.min(this.numBins - 2, Math.ceil(this.maxFreqHz / this.binHz));

    // Pre-allocated scratch (no per-hop allocation in update()).
    this._peakFreq = new Float64Array(this.numPeaks);
    this._peakEner = new Float64Array(this.numPeaks);
    this._peakLo   = new Float64Array(this.numPeaks);
    this._peakHi   = new Float64Array(this.numPeaks);
    this._peakCount = 0;
    // Candidate collection buffers (over all local maxima before top-K).
    this._candBin  = new Int32Array(this.numBins);
    this._candMag  = new Float64Array(this.numBins);
    this._matched  = new Uint8Array(this.numPeaks);

    this._tracks = [];
    for (let i = 0; i < this.numTracks; i++) this._tracks.push(new Track());
    this._out = [];
    for (let i = 0; i < this.numTracks; i++) this._out.push({ freqHz: 0, energy: 0, loHz: 0, hiHz: 0 });
    this._nextId = 1;
  }

  reset() {
    for (const t of this._tracks) {
      t.active = false;
      t.freqHz = 0; t.energy = 0; t.loHz = 0; t.hiHz = 0; t.rankEnergy = 0;
      t.lowHops = 0; t.id = 0; t.fP = 1; t.eP = 1;
    }
    this._nextId = 1;
  }

  /**
   * @param {Float64Array|Float32Array} magSpectrum — positive-freq
   *   magnitudes, length fftSize/2, mag[k] = hypot(re_k, im_k).
   * @param {number} dtSec — seconds since last update (informational; the
   *   Kalman/EMA here are per-hop tuned, dt is accepted for API symmetry
   *   and future variable-rate use).
   * @returns {Array<{freqHz:number, energy:number}>} length numTracks,
   *   stable energy-ranked order. Reused array — copy if you retain it.
   */
  update(magSpectrum, dtSec) {
    this._pickPeaks(magSpectrum);
    this._associateAndUpdate();
    return this._emit();
  }

  // ── peak picking + parabolic interp + lobe energy ──────────────────
  _pickPeaks(mag) {
    const minBin = this._minBin, maxBin = this._maxBin;

    // hop max for the relative floor.
    let hopMax = 0;
    for (let k = minBin; k <= maxBin; k++) {
      const m = mag[k];
      if (m > hopMax) hopMax = m;
    }
    const floor = Math.max(this.absFloor, this.relFloor * hopMax);

    // collect local maxima above floor.
    let nCand = 0;
    for (let k = minBin; k <= maxBin; k++) {
      const m = mag[k];
      if (m < floor) continue;
      if (m >= mag[k - 1] && m > mag[k + 1]) {
        this._candBin[nCand] = k;
        this._candMag[nCand] = m;
        nCand++;
      }
    }

    // partial selection of top numPeaks by magnitude (selection sort over
    // K, cheap since K is small).
    const K = Math.min(this.numPeaks, nCand);
    for (let i = 0; i < K; i++) {
      let best = i;
      for (let j = i + 1; j < nCand; j++) {
        if (this._candMag[j] > this._candMag[best]) best = j;
      }
      if (best !== i) {
        const tb = this._candBin[i]; this._candBin[i] = this._candBin[best]; this._candBin[best] = tb;
        const tm = this._candMag[i]; this._candMag[i] = this._candMag[best]; this._candMag[best] = tm;
      }
    }

    // refine each chosen peak: parabolic freq + lobe energy + mapped energy.
    this._peakCount = K;
    for (let i = 0; i < K; i++) {
      const k = this._candBin[i];
      // log-magnitude parabola (add tiny epsilon to avoid log(0)).
      const ym1 = Math.log(mag[k - 1] + 1e-12);
      const y0  = Math.log(mag[k]     + 1e-12);
      const yp1 = Math.log(mag[k + 1] + 1e-12);
      const { delta } = parabolicVertex(ym1, y0, yp1);
      const binF = k + (delta > 0.5 ? 0.5 : delta < -0.5 ? -0.5 : delta);
      const freqHz = binF * this.binHz;

      // Cluster (dominance-region) window: expand left/right from the peak
      // while the magnitude stays above clusterThresh × the peak, bounded by
      // clusterMaxHz — i.e. "the cluster of frequencies in that dominance
      // area". The summed energy over this cluster is the partial's intensity
      // (its ups and downs), and [loHz, hiHz] is the window we draw on the
      // spectrum. Data-driven: widens for a fat bass, tightens for a pure lead.
      const peakMag = mag[k];
      const thr = peakMag * this.clusterThresh;
      const maxBins = Math.max(1, Math.round(this.clusterMaxHz / this.binHz));
      let lo = k, hi = k;
      while (lo > 1 && (k - lo) < maxBins && mag[lo - 1] >= thr) lo--;
      while (hi < this.numBins - 1 && (hi - k) < maxBins && mag[hi + 1] >= thr) hi++;
      // Sum energy over the cluster AND its energy-weighted CENTROID — the
      // centroid (the average frequency of the dominance window, mag-weighted)
      // is the reported dom frequency: smoother + more stable than the raw
      // peak bin, since it averages over the whole cluster. Kalman then
      // smooths it further across hops.
      let sum = 0, fsum = 0;
      for (let b = lo; b <= hi; b++) { const m = mag[b]; sum += m; fsum += m * (b * this.binHz); }
      const energy = softCompress(this.energyGain * this.inputGain * (sum / this.fftSize));
      const centroidHz = sum > 0 ? fsum / sum : freqHz;

      this._peakFreq[i] = centroidHz;
      this._peakEner[i] = energy;
      this._peakLo[i] = lo * this.binHz;
      this._peakHi[i] = hi * this.binHz;
    }
  }

  // ── data association + birth/death + smoothing ─────────────────────
  _associateAndUpdate() {
    const tracks = this._tracks;
    const P = this._peakCount;
    for (let i = 0; i < P; i++) this._matched[i] = 0;

    // 1) match each ACTIVE track to its nearest unused peak within gate.
    for (const t of tracks) {
      if (!t.active) continue;
      let best = -1, bestDf = Infinity;
      for (let i = 0; i < P; i++) {
        if (this._matched[i]) continue;
        const df = Math.abs(this._peakFreq[i] - t.freqHz);
        if (df < bestDf) { bestDf = df; best = i; }
      }
      const gate = Math.min(this.maxJumpHz, Math.max(this.minJumpHz, t.freqHz * this.maxJumpFrac));
      if (best >= 0 && bestDf <= gate) {
        this._matched[best] = 1;
        this._updateTrack(t, this._peakFreq[best], this._peakEner[best], this._peakLo[best], this._peakHi[best]);
        if (t.energy < this.deathEnergy) t.lowHops++; else t.lowHops = 0;
      } else {
        // no measurement: coast, decay energy toward 0 (keep last window).
        this._updateTrack(t, t.freqHz, 0, t.loHz, t.hiHz);
        t.lowHops++;
      }
      if (t.lowHops >= this.deathHops) {
        t.active = false;
        t.energy = 0; t.rankEnergy = 0;
      }
    }

    // 2) birth: strongest unmatched peak above birthEnergy claims a free
    //    slot (or evicts the weakest active track if it's stronger).
    for (let i = 0; i < P; i++) {
      if (this._matched[i]) continue;
      if (this._peakEner[i] < this.birthEnergy) continue;
      // find a free slot.
      let slot = null;
      for (const t of tracks) { if (!t.active) { slot = t; break; } }
      if (!slot) {
        // evict weakest active track if this peak is clearly stronger.
        let weakest = null;
        for (const t of tracks) {
          if (!weakest || t.rankEnergy < weakest.rankEnergy) weakest = t;
        }
        if (weakest && this._peakEner[i] > weakest.rankEnergy * 1.5) slot = weakest;
      }
      if (slot) {
        this._matched[i] = 1;
        slot.active = true;
        slot.id = this._nextId++;
        slot.freqHz = this._peakFreq[i];
        slot.energy = this._peakEner[i];
        slot.loHz = this._peakLo[i];
        slot.hiHz = this._peakHi[i];
        slot.rankEnergy = this._peakEner[i];
        slot.lowHops = 0;
        slot.fP = this.kfFreqR;   // seed covariance at measurement noise
        slot.eP = this.kfEnergyR;
      }
    }
  }

  _updateTrack(t, measFreq, measEnergy, measLo, measHi) {
    if (measEnergy > 0) { t.loHz = measLo; t.hiHz = measHi; }   // keep last window on coast
    if (this.useKalman) {
      // Scalar Kalman per dimension (random-walk model: x_{k} = x_{k-1}).
      // freq:
      let fP = t.fP + this.kfFreqQ;             // predict (state stays)
      const fK = fP / (fP + this.kfFreqR);      // gain
      t.freqHz = t.freqHz + fK * (measFreq - t.freqHz);
      t.fP = (1 - fK) * fP;
      // energy:
      let eP = t.eP + this.kfEnergyQ;
      const eK = eP / (eP + this.kfEnergyR);
      t.energy = t.energy + eK * (measEnergy - t.energy);
      t.eP = (1 - eK) * eP;
      if (t.energy < 0) t.energy = 0;
    } else {
      const fa = this.emaFreqAlpha, ea = this.emaEnergyAlpha;
      // only pull freq toward a real measurement (don't drift on coast).
      if (measEnergy > 0) t.freqHz = fa * measFreq + (1 - fa) * t.freqHz;
      t.energy = ea * measEnergy + (1 - ea) * t.energy;
    }
    t.rankEnergy = this.rankAlpha * t.energy + (1 - this.rankAlpha) * t.rankEnergy;
  }

  _emit() {
    // stable order: sort track indices by rankEnergy desc into _out.
    const tracks = this._tracks;
    // simple insertion sort of indices (numTracks is tiny).
    const idx = [];
    for (let i = 0; i < tracks.length; i++) idx.push(i);
    idx.sort((a, b) => tracks[b].rankEnergy - tracks[a].rankEnergy);
    for (let i = 0; i < this.numTracks; i++) {
      const t = tracks[idx[i]];
      const o = this._out[i];
      if (t.active) { o.freqHz = t.freqHz; o.energy = t.energy < 1 ? t.energy : 1; o.loHz = t.loHz; o.hiHz = t.hiHz; }
      else { o.freqHz = 0; o.energy = 0; o.loHz = 0; o.hiHz = 0; }
    }
    // Separation: dom2's CENTROID must not sit inside dom1's cluster window
    // (overlapping windows are fine, a redundant centroid is not). If it does,
    // retarget dom2 to the strongest current peak whose centroid is OUTSIDE
    // dom1's window — a genuinely distinct partial.
    const d1 = this._out[0];
    if (this.numTracks >= 2 && d1.freqHz > 0) {
      const d2 = this._out[1];
      if (d2.freqHz >= d1.loHz && d2.freqHz <= d1.hiHz) {
        let bestI = -1, bestE = this.birthEnergy;
        for (let i = 0; i < this._peakCount; i++) {
          const f = this._peakFreq[i];
          if (f >= d1.loHz && f <= d1.hiHz) continue;     // inside dom1's window → skip
          if (this._peakEner[i] > bestE) { bestE = this._peakEner[i]; bestI = i; }
        }
        if (bestI >= 0) { d2.freqHz = this._peakFreq[bestI]; d2.energy = this._peakEner[bestI]; d2.loHz = this._peakLo[bestI]; d2.hiHz = this._peakHi[bestI]; }
        else { d2.freqHz = 0; d2.energy = 0; d2.loHz = 0; d2.hiHz = 0; }   // nothing distinct → no dom2
      }
    }
    return this._out;
  }
}

export default DominantFreqTracker;
