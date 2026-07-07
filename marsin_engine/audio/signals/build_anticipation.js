/**
 * build_anticipation.js — riser / build-up ANTICIPATION → `audioRiserScore`,
 * `audioBuildEta`, `audioRiserConf` (report 20260620_2 #1).
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * Lets the rig CHARGE UP (brightness ramp / accelerating chase) BEFORE the
 * drop, instead of only reacting on the transient. A build is the simultaneous
 * RISE of three cheap signals over a few seconds:
 *   - spectral flux        (micFluxRaw)    — increasing transient density,
 *   - high-band energy      (micHighRaw)    — risers sweep UP into the highs,
 *   - overall energy ratio  (audioEnergyRatio, when the detector is enabled).
 * When the structure detector is ON we ALSO fold in its `audioBuildScore` and
 * gate the score to its BUILD state — that is the strongest single evidence.
 * But the detector is OFF by default (opt-in, codex), so the riser MUST stand
 * on the raw mic slopes alone too; the detector inputs only ASSIST.
 *
 * Outputs (published by DerivedSignals):
 *   audioRiserScore  0..1 — how strongly we are building right now.
 *   audioBuildEta    sec  — best-effort seconds until the predicted drop, from
 *                           bars-to-the-next-16-bar-boundary × beat duration.
 *                           0 when no honest estimate exists (NOT a guess).
 *   audioRiserConf   0..1 — honest confidence in the riser/ETA (slope agreement
 *                           × BPM-lock × build-score corroboration). The ETA is
 *                           only meaningful when conf is high — consumers gate on it.
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. SLOPES. Each input gets a fast EMA (`fastTau`) and a slow EMA (`slowTau`);
 *    the normalized rise = clamp01((fast − slow) / slopeRef). A build needs ALL
 *    THREE rising together (flux ∧ high ∧ energy) — the score is their soft
 *    product (geometric-mean-ish) so a lone rising hat doesn't read as a build.
 * 2. BUILD-SCORE ASSIST. When the detector is enabled (buildScore>0 ∨
 *    structure==BUILD), blend its buildScore in and boost confidence; when it's
 *    disabled (buildScore==0 the whole session) the raw slopes carry the score
 *    and confidence is capped (we are guessing more).
 * 3. ETA. Only when BPM is locked AND barPhase is published: bars since the
 *    riser began rising → bars to the next 8/16-bar boundary → × beat seconds.
 *    Without a lock we publish ETA 0 and low conf (fail honest, codex P0).
 * 4. RESET ON DROP. A drop pulse (audioDropPulse) ends the build — score/ETA
 *    collapse so the rig stops "anticipating" the instant the drop lands.
 *
 * Pure Math, allocation-free. Warmup-seeds the EMAs so a loud first frame can't
 * phantom-build. Validated offline (synth bank): `riser`/`edm_drop` ramp the
 * score and reset it on the drop; `silence`/`full_track` (steady) stay low.
 */

export const BUILD_ANTICIPATION_DEFAULTS = Object.freeze({
  // The build evidence is the simultaneous RISE of spectral flux, high-band
  // energy, and overall loudness over a few seconds. A build ramp is SLOW (a
  // 7–16-bar riser), so the slow baseline EMA must be long and the slope
  // normalizer small — a several-second climb only opens a ~0.08 fast/slow gap.
  fastTau: 0.35,        // s — fast EMA (tracks the current level)
  slowTau: 4.0,         // s — slow EMA (the multi-second baseline the rise is measured from)
  slopeRef: 0.08,       // (fast−slow) normalizer: a rise of this reads as full slope
  riseGate: 0.10,       // flux AND high slope must each clear this to count as "building"
  loudW: { low: 0.3, mid: 0.3, high: 0.4 },   // loudness proxy (energy term; high-weighted)
  scoreTau: 0.25,       // s — output smoothing on the score (no per-hop jitter)
  buildAssist: 0.45,    // weight of audioBuildScore when the detector is enabled
  dropResetMs: 250,     // hold the post-drop reset this long (collapse the build)
  barsToPredict: 16,    // predict the drop at the next N-bar boundary (8 or 16)
  beatsPerBar: 4,       // 4/4 assumption (matches bpm_tracker barPhase)
  warmupHops: 30,       // seed the EMAs before scoring (no phantom build at boot)
  confNoDetector: 0.8,  // confidence ceiling when the detector is OFF (raw slopes only)
  // ── ETA honesty gate (E2 P1-5, 2026-06-20) ──────────────────────────────
  // On REAL continuous tracks the raw flux/high slopes wobble above the score
  // threshold constantly, so a bars-to-boundary ETA was published for ~69 % of
  // hops — fiction (there is no impending drop on a steady track). The ETA is
  // now published ONLY when the riser is genuinely confident: riserConf ≥
  // `etaMinConf` (and the detector, when enabled, corroborates BUILD). Else 0.
  etaMinConf: 0.55,     // riserConf must clear this for a nonzero ETA (honest)
});

export class BuildAnticipation {
  constructor(opts = {}) {
    this.p = { ...BUILD_ANTICIPATION_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._fFlux = 0; this._sFlux = 0;
    this._fHigh = 0; this._sHigh = 0;
    this._fLoud = 0; this._sLoud = 0;
    this._warmSum = { flux: 0, high: 0, loud: 0 };
    this._warmHops = 0;
    this._warmedUp = false;
    this._score = 0;
    this._risingSinceMs = null;   // when the current build began rising
    this._lastDropMs = -Infinity;
    this.riserScore = 0;
    this.buildEta = 0;
    this.riserConf = 0;
  }

  static _ema(prev, x, dt, tau) {
    if (dt <= 0) return prev;
    const a = 1 - Math.exp(-dt / tau);
    return prev + a * (x - prev);
  }

  /**
   * @param {object} s
   *   s.flux, s.high              — raw rising-evidence signals [0,1]
   *   s.low, s.mid                — for the loudness (energy) proxy [0,1]
   *   s.buildScore               — detector buildScore [0,1] (0 if disabled)
   *   s.structure                — 0 THIN / 1 BUILD / 2 SUSTAIN
   *   s.dropPulse                — audioDropPulse [0,1]
   *   s.bpm, s.bpmLocked, s.barPhase — tempo grid (ETA)
   *   s.dt (seconds), s.nowMs
   * @returns {{riserScore:number, buildEta:number, riserConf:number}}
   */
  update(s) {
    const p = this.p;
    const dt = s.dt > 0 ? s.dt : 0;
    const flux = clamp01(s.flux), high = clamp01(s.high);
    // Loudness proxy = the "energy rising" term (works detector-OFF, where
    // audioEnergyRatio is 0). High-weighted because risers brighten upward.
    const loud = p.loudW.low * clamp01(s.low) + p.loudW.mid * clamp01(s.mid) + p.loudW.high * high;

    if (!this._warmedUp) {
      this._warmSum.flux += flux; this._warmSum.high += high; this._warmSum.loud += loud;
      this._warmHops++;
      if (this._warmHops >= p.warmupHops) {
        const n = this._warmHops;
        this._fFlux = this._sFlux = this._warmSum.flux / n;
        this._fHigh = this._sHigh = this._warmSum.high / n;
        this._fLoud = this._sLoud = this._warmSum.loud / n;
        this._warmedUp = true;
      }
      this.riserScore = 0; this.buildEta = 0; this.riserConf = 0;
      return { riserScore: 0, buildEta: 0, riserConf: 0 };
    }

    // Dual-EMA slopes.
    this._fFlux = BuildAnticipation._ema(this._fFlux, flux, dt, p.fastTau);
    this._sFlux = BuildAnticipation._ema(this._sFlux, flux, dt, p.slowTau);
    this._fHigh = BuildAnticipation._ema(this._fHigh, high, dt, p.fastTau);
    this._sHigh = BuildAnticipation._ema(this._sHigh, high, dt, p.slowTau);
    this._fLoud = BuildAnticipation._ema(this._fLoud, loud, dt, p.fastTau);
    this._sLoud = BuildAnticipation._ema(this._sLoud, loud, dt, p.slowTau);

    const slope = (f, sl) => clamp01((f - sl) / p.slopeRef);
    const sFlux = slope(this._fFlux, this._sFlux);
    const sHigh = slope(this._fHigh, this._sHigh);
    const sLoud = slope(this._fLoud, this._sLoud);

    // FLUX ∧ HIGH are the reliable build evidence (a riser = more transients +
    // brighter top end); the LOUDNESS rise corroborates as the energy term. The
    // gate is flux∧high rising together (so a lone hat or a lone swell doesn't
    // read as a build); loudness folds into the magnitude via the soft product.
    const rawRise = Math.cbrt(sFlux * sHigh * Math.max(sLoud, 0.15));
    const slopesAgree = (sFlux > p.riseGate && sHigh > p.riseGate) ? 1 : 0;

    // Detector assist (only meaningful when the structure detector is enabled).
    const detectorOn = s.buildScore > 0 || s.structure === 1;
    let target = rawRise;
    if (detectorOn) {
      const buildGate = s.structure === 1 ? 1 : 0.6;   // full credit inside BUILD
      target = (1 - p.buildAssist) * rawRise + p.buildAssist * (clamp01(s.buildScore) * buildGate);
    }

    // Post-drop reset: a drop ends the build — collapse the score immediately.
    if (s.dropPulse >= 0.5) this._lastDropMs = s.nowMs;
    const inDropReset = (s.nowMs - this._lastDropMs) < p.dropResetMs;
    if (inDropReset) target = 0;

    // Smooth the output score.
    this._score = BuildAnticipation._ema(this._score, target, dt, p.scoreTau);
    if (this._score < 1e-3) this._score = 0;
    this.riserScore = this._score;

    // Track when the build began rising (for bars-since-start → ETA bars).
    if (!inDropReset && this._score >= 0.25 && slopesAgree) {
      if (this._risingSinceMs === null) this._risingSinceMs = s.nowMs;
    } else if (this._score < 0.12 || inDropReset) {
      this._risingSinceMs = null;
    }

    // ── Confidence ──────────────────────────────────────────────────────────
    // Slope agreement is the base; BPM-lock and detector corroboration raise it.
    let conf = rawRise * (slopesAgree ? 1 : 0.5);
    if (s.bpmLocked) conf = Math.min(1, conf * 1.15);
    if (detectorOn) conf = Math.min(1, conf + 0.2 * clamp01(s.buildScore));
    else conf = Math.min(conf, p.confNoDetector);   // honest cap: raw slopes only
    if (inDropReset) conf = 0;
    this.riserConf = clamp01(conf);

    // ── ETA (best-effort, honest) ─────────────────────────────────────────────
    // Only with a real tempo grid AND a CONFIDENT build: bars to the next
    // barsToPredict-boundary. Without a BPM lock, a building score, OR high
    // confidence we publish 0 (no dishonest guess). The riserConf gate is what
    // stops a steady-track slope wobble from emitting a fictional ETA (E2 P1-5):
    // on real continuous music conf rarely clears etaMinConf, so the ETA is
    // nonzero only during a genuine, confident build.
    let eta = 0;
    const detectorOnEta = s.buildScore > 0 || s.structure === 1;
    const detectorCorroborates = !detectorOnEta || s.structure === 1 || clamp01(s.buildScore) >= 0.3;
    if (s.bpmLocked && s.bpm > 0 && this._risingSinceMs !== null && this._score >= 0.25
        && this.riserConf >= p.etaMinConf && detectorCorroborates) {
      const beatSec = 60 / s.bpm;
      const barSec = beatSec * p.beatsPerBar;
      // Bars elapsed since the build began (continuous), then bars to the next
      // N-bar phrase boundary where DJ drops conventionally land.
      const elapsedSec = (s.nowMs - this._risingSinceMs) / 1000;
      const elapsedBars = elapsedSec / barSec;
      const barsToBoundary = p.barsToPredict - (elapsedBars % p.barsToPredict);
      eta = barsToBoundary * barSec;
      // Don't predict implausibly far out — if the build just started we may be
      // a full phrase away; cap to a single phrase so the number stays useful.
      const maxEta = p.barsToPredict * barSec;
      if (!(eta > 0) || eta > maxEta) eta = 0;
    }
    this.buildEta = eta;

    return { riserScore: this.riserScore, buildEta: this.buildEta, riserConf: this.riserConf };
  }
}

function clamp01(v) { return Number.isFinite(v) ? (v < 0 ? 0 : (v > 1 ? 1 : v)) : 0; }

export default BuildAnticipation;
