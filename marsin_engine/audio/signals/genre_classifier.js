/**
 * genre_classifier.js — coarse DANCE-MUSIC GENRE classifier for party mode.
 *
 * OBSERVE-AND-CLASSIFY: pure, allocation-free, like the other signals in this
 * directory. Driven ENTIRELY from signals the engine already derives (no new
 * FFT work): realtime BPM, kick density + regularity (from the micKickRaw
 * pulse train), the low/mid/high band balance and their variance, spectral
 * flux, and the note-change rate (pitch-class flips from NoteEstimator). It
 * aggregates these over a multi-second window into a small feature vector,
 * scores that vector against
 * a fixed bank of per-genre "musical prior" profiles, takes the argmax, then
 * applies temporal smoothing + hysteresis + a minimum dwell so the published
 * genre holds steady for several seconds instead of flickering bar-to-bar.
 *
 * ════════════════════════════════════════════════════════════════════════
 * GENRE ENUM (CANONICAL — order is a cross-module contract; do not reorder)
 * ════════════════════════════════════════════════════════════════════════
 *   0 ambient        NOT party / calm / breakdown — the default when
 *                    audioParty is off or the classifier is unsure.
 *   1 deep_house     ~118–124 BPM, warm rounded bass, soft kick, jazzy mid
 *                    chords, low high-band sparkle, relaxed.
 *   2 melodic_house  ~120–126 BPM, strong EVOLVING melodic mid (high
 *                    note-change rate), emotional.
 *   3 tech_house     ~122–128 BPM, groovy, offbeat hats (rhythmic high band)
 *                    + syncopation, moderate sparkle.
 *   4 techno         ~125–135 BPM, very steady 4-on-floor kick (high
 *                    regularity), low melodic content, driving sustained
 *                    low+mid, dark (low high-band sparkle).
 *   5 melodic_techno ~124–130 BPM, melodic + driving — between melodic_house
 *                    and techno.
 *   6 downtempo      ~90–115 BPM, organic, less rigid kick, mellow.
 *
 * Genre is meaningful ONLY inside party mode. When audioParty is off the
 * classifier publishes 0 (ambient) with confidence 0 and resets its window.
 *
 * Cost: a few µs/hop (a handful of EMAs + one 7-way dot product on the
 * windowed feature vector, computed only on the periodic re-score, not every
 * hop). No per-hop allocations.
 */

// Canonical genre index → name. Exported so siblings (companion UI, patterns)
// import the names rather than re-deriving them. Order MUST match the enum.
export const GENRE_NAMES = Object.freeze([
  'ambient',        // 0
  'deep_house',     // 1
  'melodic_house',  // 2
  'tech_house',     // 3
  'techno',         // 4
  'melodic_techno', // 5
  'downtempo',      // 6
]);

// Party genres are indices 1..6 (0 is the not-party default).
const FIRST_PARTY_GENRE = 1;
const LAST_PARTY_GENRE = 6;

// ── Feature vector layout ─────────────────────────────────────────────────
// Each feature is normalized to ~[0,1] before scoring so the per-genre
// profiles can be written as plain target vectors and matched by distance.
//   bpmNorm     : tempo mapped onto the dance-music band [85,140] → [0,1].
//   kickReg     : kick regularity 0..1 (1 = metronomic 4-on-floor).
//   kickDens    : kick density 0..1 (kicks/sec mapped onto [0,4] /beat-ish).
//   lowMid      : low+mid sustained drive 0..1 (band energy).
//   sparkle     : high-band content 0..1 (hats / air / brightness).
//   sparkleVar  : high-band variance 0..1 (offbeat-hat "groove" — rhythmic
//                 highs read as HIGH variance; a steady hiss reads LOW).
//   melodic     : note-change rate 0..1 (pitch-class flips per second).
//   flux        : spectral flux 0..1 (overall change / busyness).
//   bassW       : low-band SHARE of total band energy low/(low+mid+high) —
//                 bass dominance, robust to overall level. ENGINEERED v2.
//   midW        : mid-band SHARE mid/(low+mid+high) — melodic/chord weight.
//                 ENGINEERED v2.
//   tilt        : spectral tilt high/(low+mid) — brightness independent of
//                 absolute level (deep_house bright, downtempo dark).
//                 ENGINEERED v2.
//   fluxVar     : short-window variance of spectral flux — "busyness
//                 dynamics" (techno-family high, deep/downtempo low).
//                 ENGINEERED v2.
const F_BPM = 0, F_KICKREG = 1, F_KICKDENS = 2, F_LOWMID = 3,
      F_SPARKLE = 4, F_SPARKLEVAR = 5, F_MELODIC = 6, F_FLUX = 7,
      F_BASSW = 8, F_MIDW = 9, F_TILT = 10, F_FLUXVAR = 11;
const N_FEAT = 12;

// Per-genre prior PROFILES (target feature vectors) + per-feature WEIGHTS
// (how discriminating each feature is for the match). Index 0 (ambient) has no
// profile — it is the not-party default and is never scored against these.
//
// profile = the "ideal" normalized feature vector for the genre.
// weight   = relative importance of matching that feature (0 = ignore).
//
// ════════════════════════════════════════════════════════════════════════
// PROFILE TUNING NOTE v2 (2026-06-20 — REAL-AUDIO DATA-DRIVEN RETUNE):
// The v1 targets/weights were tuned on a SYNTHETIC bank and collapsed to
// ~14–22% on a real 60-track CC dance-music corpus (chance ≈ 17%). They are
// now re-anchored to the MEASURED per-genre feature centroids from
// `tools/genre_eval.mjs --corpus ~/tmp/genre_corpus --fft 2048` (the deployed
// fftSize) and re-weighted by each feature's measured SEPARABILITY (a Fisher
// between/within-genre variance ratio over the corpus). Key empirical facts
// that shaped this:
//   • BPM is now NOISY/UNRELIABLE on real audio (the tracker octave-doubles —
//     downtempo reads FAST, ~0.71 norm). Its Fisher score is low; weight ≈ 0.
//   • `kickDens` saturates (~0.63–0.97) → near-dead; weight ≈ 0.
//   • `melodic` does NOT saturate as v1 assumed; on real audio it is a
//     compressed-but-ORDERED signal (melodic_house ~0.30 highest, tech_house
//     ~0.10 lowest). Its RELATIVE ordering is one of the most separable axes
//     (Fisher ~0.57) — so it is KEPT (re-anchored to real values), NOT dropped.
//   • `kickReg` is the single most separable feature (Fisher ~0.59): melodic_
//     house lowest (~0.29), melodic_techno highest (~0.69).
//   • FOUR new ENGINEERED features add a working 2nd/3rd axis beyond BPM:
//     bassW (tech_house high), midW (melodic_house high), tilt (deep_house
//     bright), fluxVar (techno-family high). Each is cheap, allocation-free,
//     derived from bands the classifier already receives.
//   • `sparkle`/`sparkleVar` lost their v1 polarity on real audio; weights
//     dropped and targets re-anchored to measured values.
// Profiles below ARE the measured centroids; one shared weight vector encodes
// the measured separability (see GENRE_WEIGHTS).
//
// Feature order: [bpm,kickReg,kickDens,lowMid,sparkle,sparkleVar,melodic,flux,
//                 bassW,midW,tilt,fluxVar]
// Weights from an in-engine corpus search (faithful replay of the smoothing +
// hysteresis + tail-vote decision over the 36 scored tracks at fft 2048). The
// search zeroed BPM (noisy/octave-doubled), kickDens (saturated), and
// sparkle/sparkleVar (lost polarity on real audio) and leaned on the separable
// axes: kickReg, melodic (relative ordering), the engineered midW + bassW, flux.
const GENRE_WEIGHTS = Object.freeze(
  [0.00, 1.01, 0.00, 0.36, 0.00, 0.00, 1.40, 0.69, 0.46, 1.20, 0.11, 0.32]);

const PROFILES = Object.freeze([
  // 1 deep_house: brightest (high tilt/sparkle), low bassW, low fluxVar.
  { genre: 1, w: GENRE_WEIGHTS,
    p: [0.447, 0.599, 0.877, 0.541, 0.514, 0.503, 0.178, 0.367, 0.288, 0.398, 0.464, 0.154] },
  // 2 melodic_house: low kickReg, high midW (chord/melody weight), low fluxVar.
  { genre: 2, w: GENRE_WEIGHTS,
    p: [0.609, 0.285, 0.633, 0.520, 0.372, 0.549, 0.297, 0.348, 0.277, 0.487, 0.339, 0.137] },
  // 3 tech_house: high bassW, LOW flux, lowest melodic — groovy and dry.
  { genre: 3, w: GENRE_WEIGHTS,
    p: [0.779, 0.588, 0.909, 0.445, 0.329, 0.615, 0.104, 0.226, 0.376, 0.370, 0.367, 0.181] },
  // 4 techno: high fluxVar + high lowMid + high sparkleVar — driving, busy.
  { genre: 4, w: GENRE_WEIGHTS,
    p: [0.722, 0.497, 0.912, 0.556, 0.381, 0.716, 0.201, 0.301, 0.335, 0.416, 0.351, 0.191] },
  // 5 melodic_techno: highest kickReg + kickDens — relentless + melodic.
  { genre: 5, w: GENRE_WEIGHTS,
    p: [0.703, 0.691, 0.967, 0.525, 0.381, 0.693, 0.170, 0.308, 0.310, 0.442, 0.354, 0.182] },
  // 6 downtempo: darkest (low tilt), low kickDens, low fluxVar — organic.
  { genre: 6, w: GENRE_WEIGHTS,
    p: [0.713, 0.465, 0.686, 0.520, 0.326, 0.609, 0.252, 0.339, 0.356, 0.432, 0.296, 0.137] },
]);

// Map a BPM onto the dance band [85,140] → [0,1] (clamped). Defined as a
// function so the profile literals above read in real BPM, not magic floats.
function bpmN(bpm) {
  const lo = 85, hi = 140;
  const x = (bpm - lo) / (hi - lo);
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

export const GENRE_DEFAULTS = Object.freeze({
  hopsPerSec: 86.13,
  // Aggregation window: EMA timescales (seconds) for the slow windowed
  // features. ~4 s = "a couple of bars", long enough to characterize a
  // section but short enough to follow a genuine genre switch in a DJ set.
  featTau: 4.0,
  // Faster EMA for the high-band variance estimator's mean tracker.
  sparkleVarTau: 1.2,
  // Faster EMA for the flux-variance estimator's mean tracker (fluxVar feature).
  fluxVarTau: 1.2,
  // fluxVar scale: turn the small absolute flux RMS-deviation into a 0..1
  // feature. Anchored so the measured techno-family fluxVar (~0.19) and
  // house/downtempo (~0.14) land where the PROFILES expect them (they store
  // the raw RMS deviation directly, so this is 1.0 — kept explicit for tuning).
  fluxVarScale: 1.0,
  // Re-score the profile bank every this-many hops (not every hop — the
  // windowed features barely move between hops). ~8 hops ≈ 0.09 s.
  scoreEveryHops: 8,
  // Kick regularity: we measure the coefficient of variation of inter-kick
  // intervals over a short ring of recent kicks. regularity = 1 - cv (clamped).
  kickRingN: 12,
  kickMinIntervalMs: 120,   // debounce: ignore double-triggers closer than this
  // Melodic rate: note-change events per second, mapped onto [0, noteRateFull]
  // → [0,1]. ~1.5 changes/s already reads as "very melodic".
  noteRateFull: 1.5,
  noteRateTau: 6.0,
  // Decision smoothing: per-genre score EMA, then argmax with hysteresis.
  scoreTau: 2.5,            // s — smooth the per-genre match scores
  minDwellMs: 4000,         // hold a committed genre at least this long
  switchMargin: 0.03,       // challenger must beat the incumbent score by this
  confSpread: 0.12,         // confidence = clamp01(spread / confSpread) — the
                            //   real inter-genre score gap is small (~0.02–0.1)
                            //   so a 0.12 scale puts a clean win near full conf.
  // Party gate: only classify when we've been in party mode for a beat. The
  // windowed EMAs (featTau ~4 s) need a few seconds to characterize the
  // section before the FIRST commit, or a transient opening reads as the
  // wrong genre and the min-dwell then pins it.
  warmupMs: 5000,
});

export class GenreClassifier {
  constructor(opts = {}) {
    this.p = { ...GENRE_DEFAULTS, ...opts };
    // Pre-size the kick-interval ring (no per-hop alloc).
    this._kickIntervals = new Float32Array(this.p.kickRingN);
    // Per-genre smoothed score buffer (indices 1..6 used; 0 unused).
    this._score = new Float64Array(LAST_PARTY_GENRE + 1);
    // Scratch feature vector, reused every re-score.
    this._feat = new Float64Array(N_FEAT);
    this.reset();
  }

  reset() {
    // Windowed feature EMAs.
    this._emaLow = 0; this._emaMid = 0; this._emaHigh = 0;
    this._emaFlux = 0; this._emaKickReg = 0; this._emaKickDens = 0;
    this._emaNoteRate = 0;
    // High-band variance tracking (mean + EMA of squared deviation).
    this._sparkleMean = 0; this._sparkleVar = 0;
    // Engineered v2 features.
    //  Band-share EMAs (bassW, midW) + spectral-tilt EMA.
    this._emaBassW = 0; this._emaMidW = 0; this._emaTilt = 0;
    //  Flux-variance estimator (fast mean + EMA of squared deviation).
    this._fluxMean = 0; this._fluxVar = 0;
    // Kick edge detection + interval ring.
    this._prevKick = 0; this._lastKickMs = -Infinity;
    this._kickIntervals.fill(0); this._kickFilled = 0; this._kickHead = 0;
    // Note-change edge detection.
    this._prevPc = -1;
    this._noteEventAccum = 0;   // decayed count of recent note changes
    // Decision state.
    this._score.fill(0);
    this._committed = 0;        // current published genre (0 = ambient)
    this._committedMs = -Infinity;
    this._hopCount = 0;
    this._partySinceMs = null;

    this.genre = 0;
    this.confidence = 0;
  }

  /**
   * Per-hop step.
   * @param {object} s
   *   s.party     — boolean party gate (audioParty)
   *   s.bpm       — realtime BPM
   *   s.low,s.mid,s.high — RAW band levels [0,1]
   *   s.flux      — spectral flux [0,1]
   *   s.kick      — RAW kick level [0,1] (pulse train)
   *   s.pitchClass— committed pitch class 0..11 or -1 (NoteEstimator)
   *   s.noteStable— bool
   *   s.nowMs, s.dt
   * @returns {{genre:number, confidence:number}}
   */
  update(s) {
    const p = this.p;
    this._hopCount++;
    const now = s.nowMs;
    const dt = s.dt > 0 ? s.dt : 1 / p.hopsPerSec;

    // ── Party gate. Outside party mode there is no genre: publish ambient. ──
    if (!s.party) {
      this._partySinceMs = null;
      // Bleed the decision toward ambient so re-entry starts clean.
      this._committed = 0;
      this.genre = 0;
      this.confidence = 0;
      // Keep the band/flux EMAs decaying so a brief party blip doesn't carry
      // a stale window into the next section.
      this._decayWindow(dt);
      return { genre: 0, confidence: 0 };
    }
    if (this._partySinceMs === null) this._partySinceMs = now;

    // ── Update windowed features. ──
    this._updateBands(s.low, s.mid, s.high, s.flux, dt);
    this._updateKick(s.kick, now, dt);
    this._updateNoteRate(s.pitchClass, s.noteStable, dt);

    // ── Warmup: hold ambient until the window has had time to fill. ──
    if ((now - this._partySinceMs) < p.warmupMs) {
      this.genre = 0;
      this.confidence = 0;
      return { genre: 0, confidence: 0 };
    }

    // ── Periodically re-score the profile bank + run the decision. ──
    if ((this._hopCount % p.scoreEveryHops) === 0) {
      this._buildFeatures(s.bpm);
      this._scoreAndDecide(now, dt);
    }

    this.genre = this._committed;
    return { genre: this.genre, confidence: this.confidence };
  }

  /** @private decay the slow EMAs toward 0 (used while not in party mode). */
  _decayWindow(dt) {
    const a = 1 - Math.exp(-dt / this.p.featTau);
    this._emaLow += a * (0 - this._emaLow);
    this._emaMid += a * (0 - this._emaMid);
    this._emaHigh += a * (0 - this._emaHigh);
    this._emaFlux += a * (0 - this._emaFlux);
    this._emaKickReg += a * (0 - this._emaKickReg);
    this._emaKickDens += a * (0 - this._emaKickDens);
    this._emaNoteRate += a * (0 - this._emaNoteRate);
    // Engineered v2 EMAs decay too, so a brief party blip carries no stale state.
    this._emaBassW += a * (0 - this._emaBassW);
    this._emaMidW += a * (0 - this._emaMidW);
    this._emaTilt += a * (0 - this._emaTilt);
  }

  /** @private slow band + flux EMAs and the high-band variance estimator. */
  _updateBands(low, mid, high, flux, dt) {
    const p = this.p;
    const a = 1 - Math.exp(-dt / p.featTau);
    this._emaLow += a * (low - this._emaLow);
    this._emaMid += a * (mid - this._emaMid);
    this._emaHigh += a * (high - this._emaHigh);
    this._emaFlux += a * (flux - this._emaFlux);
    // High-band variance: track a faster mean, accumulate squared deviation.
    const av = 1 - Math.exp(-dt / p.sparkleVarTau);
    this._sparkleMean += av * (high - this._sparkleMean);
    const dev = high - this._sparkleMean;
    this._sparkleVar += av * (dev * dev - this._sparkleVar);
    // ── Engineered v2 ──
    // Band SHARES (bass/mid weight) + spectral tilt. Computed per-hop on the
    // instantaneous bands (level-robust ratios), then slow-EMA'd over the
    // section window so they characterize the genre, not a single transient.
    const tot = low + mid + high + 1e-6;
    this._emaBassW += a * (low / tot - this._emaBassW);
    this._emaMidW  += a * (mid / tot - this._emaMidW);
    this._emaTilt  += a * (high / (low + mid + 1e-6) - this._emaTilt);
    // Flux variance: fast mean + EMA of squared deviation → "busyness dynamics".
    const afv = 1 - Math.exp(-dt / p.fluxVarTau);
    this._fluxMean += afv * (flux - this._fluxMean);
    const fdev = flux - this._fluxMean;
    this._fluxVar += afv * (fdev * fdev - this._fluxVar);
  }

  /** @private kick density + regularity from the raw kick pulse train. */
  _updateKick(kick, now, dt) {
    const p = this.p;
    // Rising edge over a mid threshold = a kick onset.
    const edge = kick >= 0.5 && this._prevKick < 0.5;
    this._prevKick = kick;
    if (edge && (now - this._lastKickMs) >= p.kickMinIntervalMs) {
      if (this._lastKickMs > -Infinity) {
        const interval = now - this._lastKickMs;
        this._kickIntervals[this._kickHead] = interval;
        this._kickHead = (this._kickHead + 1) % p.kickRingN;
        if (this._kickFilled < p.kickRingN) this._kickFilled++;
      }
      this._lastKickMs = now;
    }

    // Regularity from the coefficient of variation of the interval ring.
    let reg = 0, dens = 0;
    if (this._kickFilled >= 3) {
      let mean = 0;
      for (let i = 0; i < this._kickFilled; i++) mean += this._kickIntervals[i];
      mean /= this._kickFilled;
      let varAcc = 0;
      for (let i = 0; i < this._kickFilled; i++) {
        const d = this._kickIntervals[i] - mean; varAcc += d * d;
      }
      varAcc /= this._kickFilled;
      const cv = mean > 0 ? Math.sqrt(varAcc) / mean : 1;
      reg = clamp01(1 - cv);
      // Density: kicks/sec from the mean interval, mapped onto [0,4]/4.
      const kicksPerSec = mean > 0 ? 1000 / mean : 0;
      dens = clamp01(kicksPerSec / 4);
    }
    const a = 1 - Math.exp(-dt / p.featTau);
    this._emaKickReg += a * (reg - this._emaKickReg);
    this._emaKickDens += a * (dens - this._emaKickDens);
  }

  /** @private note-change rate (pitch-class flips per second). */
  _updateNoteRate(pitchClass, noteStable, dt) {
    const p = this.p;
    if (noteStable && pitchClass >= 0 && pitchClass !== this._prevPc) {
      if (this._prevPc >= 0) this._noteEventAccum += 1;
      this._prevPc = pitchClass;
    }
    // Decay the event accumulator on the note-rate timescale, then read it as
    // an instantaneous rate (events/sec) smoothed into the windowed EMA.
    const decay = Math.exp(-dt / p.noteRateTau);
    const instRate = this._noteEventAccum / p.noteRateTau; // events/sec estimate
    this._noteEventAccum *= decay;
    const a = 1 - Math.exp(-dt / p.featTau);
    this._emaNoteRate += a * (clamp01(instRate / p.noteRateFull) - this._emaNoteRate);
  }

  /** @private assemble the normalized feature vector for scoring. */
  _buildFeatures(bpm) {
    const f = this._feat;
    f[F_BPM] = bpmN(bpm);
    f[F_KICKREG] = clamp01(this._emaKickReg);
    f[F_KICKDENS] = clamp01(this._emaKickDens);
    // low+mid drive: average of the two sustained bands.
    f[F_LOWMID] = clamp01(0.5 * (this._emaLow + this._emaMid));
    f[F_SPARKLE] = clamp01(this._emaHigh);
    // sparkleVar: map the high-band variance onto [0,1]. Offbeat-hat grooves
    // produce a much higher variance than a steady hiss; the scale constant
    // turns the small absolute variance into a usable 0..1 feature.
    f[F_SPARKLEVAR] = clamp01(Math.sqrt(this._sparkleVar) * 6);
    f[F_MELODIC] = clamp01(this._emaNoteRate);
    f[F_FLUX] = clamp01(this._emaFlux);
    // Engineered v2 features (already ~[0,1] ratios / small RMS values).
    f[F_BASSW] = clamp01(this._emaBassW);
    f[F_MIDW] = clamp01(this._emaMidW);
    f[F_TILT] = clamp01(this._emaTilt);
    f[F_FLUXVAR] = clamp01(Math.sqrt(this._fluxVar) * this.p.fluxVarScale);
  }

  /** @private score the profile bank, smooth, argmax-with-hysteresis. */
  _scoreAndDecide(now, dt) {
    const p = this.p;
    const f = this._feat;
    // Weighted-distance → similarity for each genre profile.
    const a = 1 - Math.exp(-(dt * p.scoreEveryHops) / p.scoreTau);
    for (const prof of PROFILES) {
      let dist2 = 0, wsum = 0;
      for (let k = 0; k < N_FEAT; k++) {
        const w = prof.w[k];
        const d = f[k] - prof.p[k];
        dist2 += w * d * d;
        wsum += w;
      }
      // RMS weighted distance → similarity in [0,1]. wsum normalizes so all
      // genres are on the same scale regardless of total weight.
      const rms = Math.sqrt(dist2 / (wsum || 1));
      const sim = clamp01(1 - rms);
      this._score[prof.genre] += a * (sim - this._score[prof.genre]);
    }

    // Argmax + runner-up over the smoothed scores. Seed bestS = -Infinity (NOT
    // score[FIRST_PARTY_GENRE]): self-seeding made the first genre's own score
    // fall into the `else if` on iteration 0 → secondS = bestS → spread 0 →
    // confidence ALWAYS 0 whenever genre 1 (deep_house) won. Seeding -Infinity
    // lets the real runner-up populate secondS.
    let best = FIRST_PARTY_GENRE, bestS = -Infinity, secondS = -Infinity;
    for (let gIdx = FIRST_PARTY_GENRE; gIdx <= LAST_PARTY_GENRE; gIdx++) {
      const sc = this._score[gIdx];
      if (sc > bestS) { secondS = bestS; bestS = sc; best = gIdx; }
      else if (sc > secondS) secondS = sc;
    }

    // Confidence = how separated the winner is from the field.
    const spread = secondS > -Infinity ? (bestS - secondS) : bestS;
    this.confidence = clamp01(spread / p.confSpread);

    // Hysteresis + min dwell. The committed genre only changes when a
    // challenger clearly beats it AND the incumbent has been held minDwellMs.
    if (this._committed < FIRST_PARTY_GENRE) {
      // Coming from ambient (party just started / re-scored) — adopt the best.
      this._commit(best, now);
    } else if (best !== this._committed) {
      const incumbentS = this._score[this._committed];
      const dwellOk = (now - this._committedMs) >= p.minDwellMs;
      if (dwellOk && (bestS - incumbentS) >= p.switchMargin) {
        this._commit(best, now);
      }
    }
  }

  /** @private commit a genre, stamping the dwell clock. */
  _commit(genre, now) {
    this._committed = genre;
    this._committedMs = now;
  }
}

export default GenreClassifier;
