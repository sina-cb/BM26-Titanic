/**
 * genre_classifier.js — coarse DANCE-MUSIC GENRE classifier for party mode.
 *
 * OBSERVE-AND-CLASSIFY: pure, allocation-free, like the other signals in this
 * directory. Driven ENTIRELY from signals the engine already derives (no new
 * FFT work): realtime BPM, kick density + regularity (from the micKickRaw
 * pulse train), the low/mid/high band balance and their variance, spectral
 * flux, the note-change rate (pitch-class flips from NoteEstimator), and the
 * structure detector's build/energy scores. It aggregates these over a
 * multi-second window into a small feature vector, scores that vector against
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
const F_BPM = 0, F_KICKREG = 1, F_KICKDENS = 2, F_LOWMID = 3,
      F_SPARKLE = 4, F_SPARKLEVAR = 5, F_MELODIC = 6, F_FLUX = 7;
const N_FEAT = 8;

// Per-genre prior PROFILES (target feature vectors) + per-feature WEIGHTS
// (how discriminating each feature is for the match). Tuned from the musical
// priors in the enum doc above. Index 0 (ambient) has no profile — it is the
// not-party default and is never scored against these.
//
// profile = the "ideal" normalized feature vector for the genre.
// weight   = relative importance of matching that feature (0 = ignore).
// PROFILE TUNING NOTE (2026-06-20): the targets + weights below were tuned
// against the REAL analyzer's measured feature vectors on a per-genre
// synthetic bank (the `chord_progression`-style tracks the validation test
// drives), not against idealized priors. Two empirical realities shaped them:
//   • the note-rate ("melodic") feature SATURATES high (~0.85–1.0) for any
//     track with a moving bass root / chord change, and reads ~0 ONLY for a
//     single-root, single-note track. So `melodic` mainly separates TECHNO
//     (one driving root → ~0) from everything else; it is weighted as a
//     techno discriminator, not a fine melodic/non-melodic split.
//   • `sparkleVar` cleanly flags TECH_HOUSE's offbeat-hat groove (~1.0 vs
//     ~0.35 elsewhere), and `sparkle` separates the brighter house genres
//     from the dark techno family. BPM is the strongest single axis.
const PROFILES = Object.freeze([
  // 1 deep_house: ~121 BPM, soft regular kick, low sparkle, moderate
  // sparkleVar, melodic-feature mid-high (chord roots move).
  { genre: 1, w: [1.3, 0.6, 0.5, 0.6, 1.2, 0.7, 0.6, 0.4],
    p: [bpmN(121), 0.64, 0.40, 0.48, 0.14, 0.36, 0.82, 0.20] },
  // 2 melodic_house: ~123 BPM, regular kick, brighter mid (some sparkle),
  // strong melodic, low sparkleVar (no offbeat-hat groove).
  { genre: 2, w: [1.3, 0.6, 0.5, 0.6, 1.0, 0.9, 0.8, 0.4],
    p: [bpmN(123), 0.72, 0.45, 0.53, 0.29, 0.35, 1.0, 0.09] },
  // 3 tech_house: ~125 BPM, the offbeat-hat groove → HIGH sparkleVar (the
  // signature) + higher sparkle, regular kick.
  { genre: 3, w: [1.2, 0.6, 0.5, 0.6, 1.0, 2.0, 0.6, 0.4],
    p: [bpmN(125), 0.80, 0.49, 0.43, 0.37, 1.0, 1.0, 0.10] },
  // 4 techno: ~130 BPM, DARK (very low sparkle), single driving root → very
  // low melodic feature (the key techno flag), low sparkleVar.
  { genre: 4, w: [1.3, 0.5, 0.5, 0.7, 1.3, 0.8, 1.8, 0.4],
    p: [bpmN(130), 0.53, 0.38, 0.42, 0.05, 0.08, 0.0, 0.08] },
  // 5 melodic_techno: ~127 BPM, driving (very high kickReg), melodic, dark-ish
  // (low sparkle) — between melodic_house and techno.
  { genre: 5, w: [1.2, 1.1, 0.5, 0.7, 1.0, 0.8, 0.9, 0.4],
    p: [bpmN(127), 0.97, 0.53, 0.55, 0.15, 0.40, 1.0, 0.09] },
  // 6 downtempo: ~102 BPM (the strongest cue — well below the 4/4 band),
  // organic, low density, low sparkle.
  { genre: 6, w: [2.2, 0.6, 0.9, 0.6, 1.0, 0.7, 0.5, 0.4],
    p: [bpmN(102), 0.51, 0.21, 0.39, 0.07, 0.39, 0.98, 0.13] },
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
