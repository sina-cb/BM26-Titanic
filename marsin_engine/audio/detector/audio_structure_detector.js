/**
 * AudioStructureDetector — build / drop / sustain cue detector.
 *
 * Design doc: docs/30_[todo]_audio_structure_detector.md (Phase 1).
 * Feasibility review corrections (folded in, override the doc where
 * they conflict):
 * .agent/02_reports/202606/20260612_2_audio_analysis_review_docs30_feasibility.md §2
 *
 * OBSERVE-AND-PUBLISH ONLY. This module watches the music (via the
 * ParamCenter live keys the analyzer + OSC stems publish), runs a small
 * 3-state machine (THIN → BUILD → SUSTAIN), and:
 *   - publishes five live keys back to CPC
 *     (audioStructure / audioBuildScore / audioEnergyRatio /
 *      audioVocalsHot / audioDropPulse), and
 *   - emits a sparse `dropFired` WS event on the broadcast hook the
 *     instant a drop lands.
 * It NEVER triggers an irreversible action — no deck swaps, blackouts,
 * playlist advances or GEM macros. The operator (or a future opt-in
 * automation) decides what to do with the cues.
 *
 * Codex P0 (no fallbacks): stems freshness is a HARD prerequisite. When
 * stems go stale we KNOW it and act differently (booleans false, lower
 * confidence, status 'offline') — we never pretend a stale stemsBass=0
 * is a real reading.
 *
 * Pattern after lib/modulation_controller.js: a class with tick(now, dt),
 * reset(), getStatus(). Pure JS, no new deps, no WASM.
 *
 * Inputs (read each tick from paramCenter live keys — the RAW, pre-gain
 * mirrors per review §2.1, so the detector models the music not the
 * operator's gain sliders):
 *   micLowRaw, micHighRaw, micKickRaw, micFluxRaw
 *   stemsBassRaw, stemsDrumsRaw, stemsVocalsRaw  (only when fresh)
 *   tempoBpm
 *   barPhase                                      (NOT bound on this rig)
 */

// Hard defaults for the detector tuning. The engine merges
// audio.structureDetector from config/scene over these via getConfig();
// every field is range-checked in audio_config.js validateLivePatch.
const DETECTOR_DEFAULTS = Object.freeze({
  enabled:           false,
  buildThreshold:    0.35,   // buildScore must clear this to enter BUILD
  // short-energy ×-jump that signals a drop. Raised 1.5→1.8 in the 2026-06-20
  // detector super-tuning pass: with the new dropMinLevel floor, 1.8 drives
  // spurious drops on calm/ambient/build passages to ZERO across all mic tiers
  // (detection_sweep) while keeping precision at 1.00 — a phantom drop on a
  // calm Burning Man passage is far worse than missing one, so we tune for
  // zero false positives first.
  // Re-tuned 1.8→1.9 with the FFT 1024→2048 bump (report 20260620_14): the
  // finer spectrum sharpens the windowed rate-of-change ratio, so genuine drops
  // read a slightly larger jump. At 1.9 the labeled-scenario score is
  // P=1.00 R=0.78 F1=0.875 (vs 1.8→P=0.86 R=0.67 F1=0.75 at 2048, and the old
  // 1024 default P=1.00 R=0.56 F1=0.71) — strictly better precision AND recall.
  // P0-1 real-audio re-tune (report 20260620_23): raised 1.9→4.0. The
  // fire-population diagnostic over the 60-track real corpus vs the synthetic
  // positives is unambiguous — the BULK of real-music phantom drops (57 of 89
  // gate-off fires) cluster at a windowed ratio of ≈1.9–2.0, i.e. they BARELY
  // clear the old 1.9 threshold, while a genuine MODERATE-tier synthetic drop
  // reads ratio 5–13. So a 4.0 jump cuts the entire phantom cluster in one
  // stroke. The honest cost (documented, accepted): a CLEAN-tier synthetic drop
  // ALSO reads ratio ≈ 1.90 (the synth's idealised line-in step is gentle and
  // indistinguishable from a busy-music transient), so this gate cannot pass it
  // — clean/heavy synthetic recall drops, moderate-tier (the realistic playa-mic
  // case) is retained. Per the codex + operator directive a phantom drop on the
  // dance floor is worse than a miss, so we tune the real false-fire rate down
  // and accept the synthetic-recall trade-off.
  dropEnergyJump:    4.0,
  // Drop-edge discriminator:
  //   'level'    — short/long LEVEL ratio > dropEnergyJump (the original
  //                behavior; re-fires in a loud body because the slow long
  //                envelope lags for seconds — docs/30 Phase-3 fidelity gap).
  //   'windowed' — true rate-of-change: short envelope NOW vs short envelope
  //                dropDeltaWindowMs ago > dropEnergyJump. Plateaus stop
  //                qualifying once the lagged value catches up, killing
  //                in-body re-fires AND the slow-build false edge.
  //   'kalman'   — OPT-IN (NOT default). A Kalman+NIS change detector on
  //                micLow ∧ micFlux: each signal is tracked by a local-level
  //                Kalman filter; a drop fires when BOTH signals' Normalized
  //                Innovation Squared (NIS) clear a χ² gate within a short
  //                co-occurrence window and micLow is RISING. The shipped
  //                tuning UNDER-FIRES on the labeled corpus (KALMAN_Q floored
  //                the NIS scale; report 202606/..._kalman_nis_drop_detector.md
  //                + the 2026-06-16 review). dropKalmanQ + dropCoWindowMs are
  //                exposed for the pending re-tune; until that lands + passes
  //                the corpus regression, the product default stays 'windowed'.
  dropEdgeMode:      'windowed', // 'level' | 'windowed' | 'kalman'(opt-in, see above)
  // Absolute sub-energy floor a drop must reach. A REAL drop slams the sub
  // (micLow short-envelope) to a SUSTAINED high level; a build's rising sub
  // sits near zero (especially through the playa mic, which compresses the
  // build's small sub away — measured: build micLow ≈ 0.00–0.02, drop micLow
  // ≈ 0.10–0.65 across SNR tiers). Requiring shortEnv ≥ dropMinLevel kills the
  // windowed/level edge's biggest false-positive source: a tiny-over-tinier
  // RATIO spike during a near-silent build (0.004 / 0.002 = 2× but it is
  // noise, not a drop). This is the single change that recovered drop recall +
  // precision on the labeled scenarios (detection_eval). Tuned to sit above the
  // moderate/heavy build floor and below the drop level. 0 disables the gate.
  dropMinLevel:      0.06,
  // Windowed-edge LEVEL ASSIST: also fire when the steady short/long level
  // ratio clears dropEnergyJump (catches post-breakdown second drops + heavy-
  // mic-compressed slams the pure rate-of-change edge under-shoots). It DOES
  // lift recall (0.56→0.78 on the labeled scenarios) but at the cost of
  // spurious drops on calm/build passages (negFP 0→3) — unacceptable on a
  // dance floor, where a phantom drop is worse than a miss. So it ships OFF;
  // an operator who wants the higher-recall arm can enable it per-scene via
  // PATCH /audio/config {structureDetector:{dropLevelAssist:true}}.
  dropLevelAssist:   false,
  // BUILD→DROP transition gate + recall recovery (2026-06-20 detector-recall
  // pass). The windowed/level drop edge used to fire ONLY from the BUILD state,
  // so a drop was missed whenever the brittle THIN→BUILD entry gate
  // (energyRatio "rising for >1s") didn't latch in time — which happens through
  // the playa mic, where the build saturates energyRatio at 1.0 (no monotone
  // rise) and the drop lands while still in THIN. That cost ~all heavy-tier
  // drops and the post-breakdown second drop. The fix: let the edge fire from
  // THIN *or* BUILD, gated NOT on the state machine but on a RECENT BUILD-SCORE
  // memory — a real drop is preceded by a riser (buildScore ≥ dropBuildGate in
  // the last dropBuildMemoryMs), while a loud steady-body onset (techno start,
  // sustain start) is not. Measured: real drops carry a 3 s build-peak of
  // 0.74–0.99 across all tiers; techno/sustain onsets carry ≤ 0.22 — a clean
  // 0.5 separation. This recovers the missed drops with ZERO new false-fires.
  dropBuildGate:     0.5,    // recent buildScore peak required to fire from THIN
  dropBuildMemoryMs: 3000,   // how long a build-score peak counts as "recent"
  // The build-memory THIN-firing edge additionally requires we're NOT in a slow
  // zone (slowZone < this). A real drop lands in an active section (measured
  // slowZone ≤0.32 at every real drop across tiers); a build's ONSET right out
  // of a breakdown crosses the build gate while slowZone is still high (≈0.49–
  // 0.51) — the build STARTING, not a drop. Tightened 0.4→0.30 in the P0-1
  // real-audio re-tune (report 23): a couple of real busy-music phantom fires
  // landed at slowZone ≈ 0.36, and the moderate-tier true synthetic drops sit at
  // slowZone ≤ 0.26, so 0.30 rejects the former without touching the latter.
  dropSlowZoneMax:   0.30,   // build-mem edge only fires when slowZone is below this
  // ── P0-1 real-audio false-fire fix (report 20260620_22 / 23) ──────────────
  // The windowed drop edge fired 1.48 phantom drops/min on 60 min of continuous
  // real DJ music. The FIRST pass (report 22) gated only the build-memory THIN
  // edge (rise 0.15 + novelty 2.5) and got to 0.87/min — NOT at target. Report
  // 23 measured WHY: with the THIN edge fully OFF, 33 of 52 phantom drops STILL
  // fire — from the BUILD STATE, which latches readily on busy continuous music.
  // So BOTH edges had to be gated, AND the gates had to be stronger. The
  // fire-population diagnostic (gate-off fires on the real corpus vs the
  // synthetic positives) showed the clean separator and its hard limit:
  //   - the BULK of phantom fires sit at windowed ratio ≈ 1.9–2.0 → handled by
  //     dropEnergyJump 1.9→4.0 above (a moderate-tier true drop reads 5–13).
  //   - the residual phantom fires are caught by two ADDITIVE music-shape gates
  //     applied to BOTH the THIN and the BUILD edge (a real drop is a NOVEL
  //     windowed-ratio outlier preceded by a real buildScore RISE, regardless of
  //     which state the machine is in; busy music is neither):
  //
  //   dropBuildRise — the buildScore must have actually RISEN by ≥ this within
  //     the memory window (recentBuildPeak − recentBuildTrough). A flat high
  //     plateau (busy music) has a tiny rise; a real build climbs. Measured at
  //     fire time: moderate-tier true drops carry rise ≥ 0.30; the residual
  //     phantom fires sit at rise ≤ 0.22. 0 disables (revert to peak-only).
  //   dropNoveltyRatio — the windowed drop ratio that triggered the edge must be
  //     a NOVEL OUTLIER vs the recent windowed-ratio MEDIAN (ratioNow / recent
  //     median ≥ this). On busy music the firing ratio is TYPICAL (the windowed
  //     edge crosses constantly, curOverMed ≈ 1.9–2.1); a real drop's slam is a
  //     strong outlier (curOverMed ≥ 5). 0 disables.
  // Pareto point chosen (report 23): jump 4.0 + rise 0.30 + novelty 5.0 +
  // slowZoneMax 0.30 → REAL ff/min 0.87→0.117 (7 phantom drops over 59.8 min,
  // 6/60 tracks), at the cost of synthetic DROP recall 0.94→0.28 (only the
  // realistic MODERATE mic tier still fires; clean/heavy true drops read the same
  // gentle ratio ≈ 1.9–3.4 as busy music and are inseparable from a phantom —
  // an inherent limit, see report 23 §frontier). The codex + operator directive
  // is explicit: when real-ff and synthetic recall conflict, prefer FEW false
  // fires — a phantom drop on a Burning Man dance floor is worse than a miss.
  // An operator who wants the higher-recall arm can relax these per-scene via
  // PATCH /audio/config {structureDetector:{dropEnergyJump:1.9, dropBuildRise:0,
  // dropNoveltyRatio:0}}.
  dropBuildRise:     0.30,   // both drop edges: required buildScore rise over the memory window
  dropNoveltyRatio:  5.0,    // both drop edges: required windowed-ratio novelty vs recent median (0 = off)
  dropNoveltyWindowMs: 12000, // lookback for the recent windowed-ratio median (novelty baseline)
  // Mic-gain-RELATIVE drop floor — SHIPPED OFF by default. dropMinLevel is an
  // ABSOLUTE micLow floor, calibrated against the harness's SNR-renormalized
  // tiers (drop micLow ≈ 0.11). A real venue's mic gain / AGC can land a genuine
  // drop below 0.06 (quiet feed) — report 20260620_9's "mic-gain dependence".
  // When dropRelLevel>0 the floor becomes
  //   effFloor = clamp(dropRelLevel · loudnessRef, DROP_FLOOR_HARD_MIN, dropMinLevel)
  // where loudnessRef is a running peak-follower of the short envelope, so the
  // floor SCALES with this feed: a quiet venue shrinks it (real drops still
  // clear), a hot feed is capped at dropMinLevel (same protection as the
  // absolute floor). It is OPT-IN because on the SNR-renormalized harness tiers
  // the absolute floor already lands correctly, and relaxing it there
  // reintroduces false-fires on the mic-compressed negatives (measured:
  // dropRelLevel:0.5 → falseFiresPerMin 0→0.38 on the scenario set — a phantom
  // drop on calm music is the worst dance-floor failure). So the SAFE default is
  // the pure absolute floor; an operator at a quiet-feed venue can enable the
  // relative floor per-scene via PATCH {structureDetector:{dropRelLevel:0.5}}.
  // 0 = pure absolute dropMinLevel (default).
  dropRelLevel:      0,      // OPT-IN: effFloor = clamp(this·loudnessRef, hardMin, dropMinLevel)
  dropNisThreshold:  6.63,   // χ²₁ 99% gate for the kalman edge (lower → more sensitive)
  dropKalmanQ:       0.001,  // kalman-edge process noise (was a hardcoded 0.01 that floored NIS)
  dropCoWindowMs:    60,     // kalman-edge: low & flux NIS may clear within this window (not same-hop)
  // Slow-zone soft-knee center + half-width on activity = max(micLow, micFlux).
  // slowZoneRef was 0.5 (calibrated for clean line-in); through the playa mic
  // that left BOTH calm and active passages reading ~0.75 (no separation). The
  // measured knee that splits calm (activity ≈ 0.04) from active (≈ 0.10–0.6)
  // sits near 0.12 with a ±0.06 half-width — verified by the detection_eval
  // slow-zone separation margin (0.26 → ~0.6+). A wider width tolerates the
  // moderate/heavy mic floor; a tighter one sharpens the calm/party boundary.
  slowZoneRef:       0.07,   // activity (max micLow, micFlux−floor) knee center → slow zone
  slowZoneWidth:     0.04,   // soft-knee half-width around slowZoneRef
  slowFluxFloor:     0.10,   // discount mic flux floor below this from "activity"
  dropDeltaWindowMs: 400,    // look-back window for the windowed drop edge
  stemsTimeoutMs:    300,    // stems older than this read as stale (offline)
  eventRefractoryMs: 3500,   // suppress repeat dropFired within this window
  falseFireCount:    3,      // N drops …
  falseFireWindowMs: 30000,  // … within M ms …
  falseFireQuietMs:  60000,  // … → suppress dropFired for this long
});

// IIR time constants (seconds). Causal one-pole envelopes per the doc's
// pseudocode §1–§2.
const SHORT_ENV_TAU = 0.2;   // ~200 ms short-energy envelope
const LONG_ENV_TAU  = 10.0;  // ~10 s long-energy envelope
const BUILD_TAU     = 2.0;   // ~2 s build-score EMA
const DROP_PULSE_TAU = 0.6;  // ~600 ms drop-pulse decay
const BUILD_GAIN    = 4.0;   // maps per-hop flux into the build-score EMA

// Kalman+NIS drop detector (adopted from the offline corpus experiment —
// local-level model, χ² 99% AND-gate on micLow ∧ micFlux, with a warmup).
const KALMAN_Q       = 0.01;   // process noise (level random-walk) — tuned winner
const KALMAN_R_FLOOR = 1e-6;   // measurement-noise floor (just keeps NIS finite on flat
                               // input; must stay BELOW the envelope-smoothed low band's
                               // real noise ~5e-5, else it crushes the sub's NIS — the
                               // adaptive estimate, matching the offline MAD R, does the work)
const KALMAN_R_ALPHA = 0.02;   // EMA rate for the adaptive measurement-noise estimate
const DROP_WARMUP_MS = 1000;   // ignore drops in the first second after enable (filter init)
const SLOW_ZONE_TAU  = 1.5;    // s — slow-zone EMA tau (a sustained zone, not a flicker)
// Running loudness reference for the mic-gain-RELATIVE drop floor. We track the
// recent loud-passage level of the short envelope: a fast attack (so a drop's
// loud body lifts it within a beat or two) and a slow release (so a quiet
// breakdown doesn't immediately collapse the reference and re-arm a tiny floor).
// This is a peak-follower, not a mean — the floor must scale with how loud the
// LOUD parts of THIS feed are, not the average.
const LOUDNESS_ATTACK_TAU  = 0.5;  // s — fast rise toward a louder short-env
const LOUDNESS_RELEASE_TAU = 8.0;  // s — slow decay when the music quiets
// Hard lower bound on the mic-gain-relative drop floor: it never relaxes below
// this, so a dead-silent / pure-noise input can't drive the floor to zero and
// admit a noise-ratio false edge. Sits just under the analyzer noiseGate (0.04)
// region so a genuine quiet drop (just above the gate) can still clear it.
const DROP_FLOOR_HARD_MIN = 0.02;

const EPS = 1e-9;
// energyRatio display map: log1p(rawRatio) / log1p(3) → [0,1]-ish.
const ENERGY_RATIO_DENOM = Math.log1p(3.0);
// Minimum gap between emitted state-transition log lines. Transitions can
// legitimately come in quick succession (BUILD→drop→SUSTAIN), but a flapping
// edge must not print one line per analyser hop; lines closer than this are
// suppressed and counted, then summarised on the next emitted line.
const TRANSITION_LOG_MIN_GAP_MS = 1500;

// State enum, float-encoded for the live key (review §2.2 — no int-typed
// live keys in this codebase).
const STATE = Object.freeze({ THIN: 0, BUILD: 1, SUSTAIN: 2 });
const STATE_NAME = Object.freeze({ 0: 'THIN', 1: 'BUILD', 2: 'SUSTAIN' });

function clamp01(x) {
  if (!(x > 0)) return 0;
  return x < 1 ? x : 1;
}

/**
 * Falling smoothstep soft-knee: 1 when x ≤ center−width, 0 when x ≥
 * center+width, a smooth Hermite transition (3u²−2u³) across the knee. Used
 * for the slow-zone target so a measured activity threshold cleanly separates
 * calm from active without a hard step or the old saturating linear ramp.
 */
function _smoothKneeDown(x, center, width) {
  const w = width > 0 ? width : 1e-6;
  const u = (x - (center - w)) / (2 * w);  // 0 at lo edge, 1 at hi edge
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  const s = u * u * (3 - 2 * u);
  return 1 - s;
}

export class AudioStructureDetector {
  /**
   * @param {object} deps
   * @param {object} deps.paramCenter — CPC; reads inputs via get(key),
   *   writes outputs via set(key, value, source).
   * @param {(msg: object) => void} deps.broadcast — WS broadcast hook
   *   (the engine's existing audioStatus publisher). Used for dropFired.
   * @param {() => object} deps.getConfig — returns the live
   *   audio.structureDetector config block (merged config/scene/PATCH).
   *   Read fresh each tick so a hot PATCH takes effect immediately.
   */
  constructor({ paramCenter, broadcast, getConfig }) {
    if (!paramCenter || typeof paramCenter.get !== 'function' || typeof paramCenter.setMany !== 'function') {
      throw new TypeError('AudioStructureDetector: paramCenter with get()/setMany() is required');
    }
    if (typeof broadcast !== 'function') {
      throw new TypeError('AudioStructureDetector: broadcast function is required');
    }
    if (typeof getConfig !== 'function') {
      throw new TypeError('AudioStructureDetector: getConfig function is required');
    }
    this.paramCenter = paramCenter;
    this.broadcast = broadcast;
    this.getConfig = getConfig;

    // Subscribe to CPC writes so we record per-stem last-write timestamps
    // ourselves (the doc's clean path — osc_listener's _lastDispatchAt is
    // private). We watch the RAW stem mirrors since those are what we read.
    //
    // CRITICAL: stem-freshness must be stamped on the SAME clock tick()
    // is driven by — the analyzer hop clock (`now`), not wall time. The
    // engine passes Date.now() as `now`, so in production these coincide;
    // but a test (or any DI'd clock) drives `now` directly, and comparing
    // a synthetic `now` against a real Date.now() stamp would make the
    // freshness test nonsense. We stamp from the last `now` tick() saw.
    this._stemsLastUpdateMs = -Infinity;
    this._lastSeenNow = -Infinity;
    this._unsubscribe = null;
    if (typeof paramCenter.subscribe === 'function') {
      this._unsubscribe = paramCenter.subscribe((ev) => {
        if (!ev || !Array.isArray(ev.changedKeys)) return;
        for (const k of ev.changedKeys) {
          if (k === 'stemsBassRaw' || k === 'stemsDrumsRaw' || k === 'stemsVocalsRaw') {
            this._stemsLastUpdateMs = this._lastSeenNow;
            return;
          }
        }
      });
    }

    // Once-only fatal latch: a paramCenter write failure disables the
    // detector for the session (codex P0 — no silent retry loop).
    this._fatal = false;

    this.reset();
  }

  /**
   * Hard reset — state machine to THIN, all envelopes + trend trackers
   * zeroed, five live keys zeroed, drop bookkeeping cleared. Called on
   * construction and whenever the detector is disabled (no half-state).
   */
  reset() {
    this._state = STATE.THIN;
    this._shortEnv = 0;
    this._longEnv = 0;
    // Ring of recent {t, v:_shortEnv} for the windowed-delta drop edge.
    this._shortEnvHist = [];
    this._buildScore = 0;
    this._energyRatio = 0;
    this._dropPulse = 0;
    this._slowZone = 0;

    // Recent build-score memory for the build→drop transition gate: a sliding
    // peak of buildScore, so the windowed/level drop edge can fire from THIN
    // when a riser PRECEDED the slam (a real drop) but NOT on a bare loud-body
    // onset (techno/sustain start, where buildScore stayed low). One sample per
    // hop kept; entries older than dropBuildMemoryMs pruned at read.
    this._buildHist = [];      // [{ t, v:buildScore }]
    // Recent windowed-drop-ratio history for the refractory-relative novelty
    // gate (P0-1). One sample per hop {t, v:windowedRatio}; entries older than
    // dropNoveltyWindowMs pruned at read. The median over this window is the
    // baseline a real drop's slam must outlier above (dropNoveltyRatio).
    this._ratioHist = [];      // [{ t, v:windowedRatio }]
    // Running loudness reference (peak-follower of the short envelope) driving
    // the mic-gain-RELATIVE drop floor. Seeded at 0; warms up over the first
    // few seconds of music.
    this._loudnessRef = 0;

    // Kalman+NIS drop detector state — one local-level filter per signal
    // (micLow, micFlux). `started` defers init to the first real reading so
    // x seeds from the signal, not 0. `rEma` is the adaptive measurement
    // noise (online analog of the experiment's MAD-derived R).
    this._kfLow  = { x: 0, P: 1, prevZ: 0, rEma: KALMAN_R_FLOOR, started: false };
    this._kfFlux = { x: 0, P: 1, prevZ: 0, rEma: KALMAN_R_FLOOR, started: false };
    // Kalman-edge co-occurrence stamps: the last hop each signal's NIS cleared
    // the gate. A drop fires when both are within `dropCoWindowMs` (low must be
    // rising) — looser than the old same-hop AND, which halved recall because
    // the sub-slam and the flux burst land a hop or two apart.
    this._lowHotAtMs  = -Infinity;
    this._fluxHotAtMs = -Infinity;
    this._enabledAtMs = -Infinity;   // warmup anchor (set on the enable edge)

    // Trend trackers (review §2.3 — explicit timestamp state for the
    // "rising for > 1 s" / "decaying" / "< 0.3 for > 1 s" conditions).
    this._energyRisingSinceMs = null;   // when energyRatio started rising
    this._energyLowSinceMs = null;      // when energyRatio dropped below 0.3
    this._lastEnergyRatio = 0;
    this._buildPeak = 0;                // peak buildScore this BUILD (decay test)
    this._buildStartedAtMs = -Infinity; // entry-to-BUILD timestamp

    // Drop-event bookkeeping.
    this._lastDropAtMs = -Infinity;     // refractory window anchor
    this._dropHistory = [];             // recent drop timestamps (self-quiet)
    this._quietUntilMs = -Infinity;     // self-quiet expiry

    // Status / diagnostics.
    this._lastTickMs = null;
    this._tickP99Ms = 0;
    // Transition-log throttle: state transitions are diagnostic, not the
    // sparse `dropFired` event. A flapping edge (or just a busy mix) must not
    // spam one line per ~12 ms hop, so we rate-limit identical-rate logging
    // and fold the suppressed count into the next emitted line.
    this._lastTransitionLogMs = -Infinity;
    this._suppressedTransitionLogs = 0;
    this._tickSamples = [];
    this._lastStemsFresh = false;
    this._lastSeenNow = -Infinity;
    this._stemsLastUpdateMs = -Infinity;

    this._wasEnabled = false;
    this._zeroLiveKeys();
  }

  /** Resolve the live config, merged over defaults. */
  _cfg() {
    const raw = this.getConfig() || {};
    return { ...DETECTOR_DEFAULTS, ...raw };
  }

  /**
   * Per-hop step. Pass the analyzer hop's wall clock `now` (ms) and
   * `dt` (seconds since the previous hop). No-ops when disabled (and
   * resets ONCE on the enabled→disabled edge so the keys go to zero and
   * no half-state lingers). Auto-pauses when the analyzer is off because
   * it's only called from onAnalysis (docs/30 recommendation 1).
   *
   * @param {number} now — ms since epoch (analyzer hop clock)
   * @param {number} dt — seconds since the previous hop
   */
  tick(now, dt) {
    if (this._fatal) return;
    // Track the hop clock so the stems-freshness subscriber stamps on the
    // same time base tick() uses (see constructor note).
    this._lastSeenNow = now;
    const cfg = this._cfg();
    const enabled = cfg.enabled === true;

    if (!enabled) {
      // Reset ONCE on the disable edge — zero keys, drop to THIN.
      if (this._wasEnabled) this.reset();
      return;
    }
    if (!this._wasEnabled) {
      // Enable edge. State is already clean here — reset() runs on the
      // constructor and on every disable edge — so we only flip the flag
      // and stamp the warmup anchor (the kalman drop edge is suppressed
      // for DROP_WARMUP_MS so the filters' cold start can't false-fire).
      this._wasEnabled = true;
      this._enabledAtMs = now;
    }

    const t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : 0;

    // dt guard. First hop after enable has dt=0 (engine convention);
    // treat it as a no-update step for the IIRs but still publish.
    const safeDt = (typeof dt === 'number' && dt > 0) ? dt : 0;

    try {
      this._step(now, safeDt, cfg);
    } catch (e) {
      // A paramCenter.set / read failure is fatal for the session
      // (codex P0 — no silent retry, no muddled neutral state).
      this._fatal = true;
      console.error(`[audioStructure] ${new Date(now).toISOString()} FATAL — disabling detector for session: ${e && e.message}`);
      return;
    }

    if (t0) {
      const elapsed = performance.now() - t0;
      this._recordTickTime(elapsed);
    }
    this._lastTickMs = now;
  }

  /** @private the actual per-hop math + state machine. */
  _step(now, dt, cfg) {
    // 0. Stems freshness — HARD PREREQUISITE.
    const stemsFresh = (now - this._stemsLastUpdateMs) < cfg.stemsTimeoutMs;
    this._lastStemsFresh = stemsFresh;

    // RAW (pre-gain) inputs (review §2.1) — including micFluxRaw, the
    // pre-chain spectral-flux mirror, so an operator nudging micFluxGain
    // can't shift the build score (consistent with the other raw reads).
    const micLowRead     = this.paramCenter.get('micLowRaw');
    const micFluxRead    = this.paramCenter.get('micFluxRaw');
    // Finite guard (fail loud, don't die): a key dropout / NaN must not poison
    // the envelopes + Kalman state for the whole session. Treat non-finite as
    // 0 for this hop and warn once. (Codex P0: fail loudly — we warn — but a
    // transient dropout must not silently kill the detector.)
    const micLow     = Number.isFinite(micLowRead)  ? micLowRead  : (this._warnNonFinite('micLowRaw', micLowRead), 0);
    const micFluxRaw = Number.isFinite(micFluxRead) ? micFluxRead : (this._warnNonFinite('micFluxRaw', micFluxRead), 0);

    // 1. Short / long energy envelopes (causal one-pole IIR).
    if (dt > 0) {
      this._shortEnv += (dt / SHORT_ENV_TAU) * (micLow - this._shortEnv);
      this._longEnv  += (dt / LONG_ENV_TAU)  * (micLow - this._longEnv);
      // Running loudness reference: peak-follower of the short envelope (fast
      // attack, slow release). Drives the mic-gain-relative drop floor below.
      const lTau = this._shortEnv > this._loudnessRef ? LOUDNESS_ATTACK_TAU : LOUDNESS_RELEASE_TAU;
      this._loudnessRef += (dt / lTau) * (this._shortEnv - this._loudnessRef);
      if (this._loudnessRef < 0) this._loudnessRef = 0;
    }
    const rawRatio = this._shortEnv / Math.max(this._longEnv, EPS);
    const energyRatio = clamp01(Math.log1p(rawRatio) / ENERGY_RATIO_DENOM);

    // 2. Build score from spectral flux (review §2.2 — prefer micFluxRaw
    //    over differencing micHigh). EMA, tau ~2 s.
    if (dt > 0) {
      const target = clamp01(micFluxRaw * BUILD_GAIN);
      this._buildScore += (dt / BUILD_TAU) * (target - this._buildScore);
      this._buildScore = clamp01(this._buildScore);
    }
    // Record build-score history + compute the recent build peak (the riser
    // memory for the build→drop transition gate). Prune entries older than the
    // memory window; the peak over what remains tells us whether a riser
    // recently happened — the discriminator between a real drop (preceded by a
    // build) and a bare loud-body onset (no build).
    this._buildHist.push({ t: now, v: this._buildScore });
    const buildCutoff = now - cfg.dropBuildMemoryMs;
    while (this._buildHist.length > 1 && this._buildHist[0].t < buildCutoff) {
      this._buildHist.shift();
    }
    let recentBuildPeak = 0;
    let recentBuildTrough = 1;
    for (const b of this._buildHist) {
      if (b.v > recentBuildPeak) recentBuildPeak = b.v;
      if (b.v < recentBuildTrough) recentBuildTrough = b.v;
    }
    // P0-1: how much buildScore actually ROSE across the memory window. A real
    // EDM build climbs (large rise + crest); busy continuous music sits at a
    // high plateau (peak high but rise small). The build-mem THIN edge requires
    // a genuine rise, not merely a sustained-high peak.
    const recentBuildRise = recentBuildPeak - recentBuildTrough;

    // 2b. Kalman+NIS drop edge + slow-zone signal.
    //   Each of micLow / micFlux is tracked by a local-level Kalman filter;
    //   the Normalized Innovation Squared (NIS = innovation² / S) spikes when
    //   the signal steps. A drop = BOTH NIS clear the χ² gate on the same hop
    //   AND both innovations are RISING (a drop slams energy UP — a breakdown
    //   ENTRANCE steps down and must not qualify). Self-normalising, so unlike
    //   buildScore it can't saturate; the AND-gate kills most false fires.
    const kLow  = this._kalmanNis(this._kfLow,  micLow,     dt, cfg.dropKalmanQ);
    const kFlux = this._kalmanNis(this._kfFlux, micFluxRaw, dt, cfg.dropKalmanQ);
    const warmupOk = (now - this._enabledAtMs) >= DROP_WARMUP_MS;
    //   A drop = sub-bass slams UP (micLow innovation positive) AND a spectral
    //   change is happening (micFlux NIS clears the gate — flux is already a
    //   rectified rising-flux measure, so its sign carries no extra info; the
    //   micLow RISING test is what rejects a breakdown ENTRANCE, where the sub
    //   steps DOWN). Requiring both NIS on the SAME hop was too strict (sub +
    //   flux peak a hop or two apart) and halved recall — so we stamp the last
    //   hop each cleared its gate and fire when both are within dropCoWindowMs.
    if (kLow.nis  >= cfg.dropNisThreshold && kLow.y > 0) this._lowHotAtMs  = now;
    if (kFlux.nis >= cfg.dropNisThreshold)               this._fluxHotAtMs = now;
    const lowHot  = (now - this._lowHotAtMs)  <= cfg.dropCoWindowMs;
    const fluxHot = (now - this._fluxHotAtMs) <= cfg.dropCoWindowMs;
    // Same absolute sub floor as the windowed/level edges: a real drop's sub
    // is sustained-high, so reject a kalman co-occurrence that lands while the
    // short envelope is still near the noise floor (a near-silent build blip).
    const kalmanLevelOk = !(cfg.dropMinLevel > 0) || this._shortEnv >= cfg.dropMinLevel;
    const kalmanDropEdge = warmupOk && lowHot && fluxHot && kalmanLevelOk;
    const kalmanConf = clamp01(Math.min(kLow.nis, kFlux.nis) / (2 * cfg.dropNisThreshold));

    //   Slow-zone: how much we're in a sparse / breakdown / ambient section.
    //   Activity = max(micLow, micFlux). A calm/ambient passage has near-ZERO
    //   sub (micLow) and no sustained flux; a drop body, sustain, or driving
    //   techno body has high sub and/or flux. (Measured through the playa mic:
    //   slow micLow ≈ 0.00–0.04 vs non-slow micLow ≈ 0.07–0.60; slow flux floor
    //   ≈ 0.08 vs non-slow flux up to 0.55 — see detection_eval slow probe.)
    //
    //   slowness = a SMOOTHSTEP soft-knee centered on slowZoneRef with half-
    //   width slowZoneWidth: ~1 well below (ref−width), ~0 well above
    //   (ref+width), smooth across the knee. The old linear (ref−act)/ref map
    //   with ref=0.5 kept BOTH slow and non-slow regions reading ~0.75 once the
    //   mic compressed the dynamic range — a useless separation. The knee at a
    //   measured ref (~0.12) cleanly splits the two. EMA-smoothed over
    //   SLOW_ZONE_TAU so it marks a sustained ZONE, not a flicker.
    //   Activity discounts the mic FLUX FLOOR: the playa mic posts a constant
    //   ~0.08–0.10 flux even on silence (capsule/room noise differenced hop to
    //   hop), so a raw max(micLow, micFlux) reads ambient as "active". We only
    //   count flux ABOVE slowFluxFloor as real activity (a build/riser), while
    //   micLow (sub presence) always counts. Measured: this collapses ambient
    //   activity to ≈0.04 while drop/sustain/techno bodies stay ≥0.09 across
    //   all mic tiers (detection_eval slow probe) — a clean calm/active split.
    const fluxActivity = Math.max(0, micFluxRaw - cfg.slowFluxFloor);
    const activity = Math.max(micLow, fluxActivity);
    const slowTarget = _smoothKneeDown(activity, cfg.slowZoneRef, cfg.slowZoneWidth);
    if (dt > 0) this._slowZone += (dt / SLOW_ZONE_TAU) * (slowTarget - this._slowZone);
    this._slowZone = clamp01(this._slowZone);

    // 3. Stems booleans (only meaningful when fresh).
    let stemsBass = 0, stemsDrums = 0, stemsVocals = 0;
    if (stemsFresh) {
      stemsBass   = this.paramCenter.get('stemsBassRaw');
      stemsDrums  = this.paramCenter.get('stemsDrumsRaw');
      stemsVocals = this.paramCenter.get('stemsVocalsRaw');
    }
    const stemsFull = stemsFresh && stemsBass > 0.4 && stemsDrums > 0.4;
    const stemsThin = stemsFresh && stemsBass < 0.15 && stemsDrums < 0.15;
    const vocalsHot = stemsFresh && stemsVocals > 0.4;

    // 4. Bar-phase gate — not bound on this rig (review §2.4). barPhase
    //    absent → nearDownbeat defaults true; gate effectively disabled.
    const nearDownbeat = true;

    const windowedEdge = cfg.dropEdgeMode === 'windowed';

    // Trend trackers (review §2.3).
    //   energyRatio rising → record when the rise began.
    if (energyRatio > this._lastEnergyRatio + 1e-4) {
      if (this._energyRisingSinceMs === null) this._energyRisingSinceMs = now;
    } else if (energyRatio < this._lastEnergyRatio - 1e-4) {
      this._energyRisingSinceMs = null;
    }
    const energyRisingFor1s = this._energyRisingSinceMs !== null
      && (now - this._energyRisingSinceMs) > 1000;
    //   energyRatio low (< 0.3) sustained for > 1 s.
    if (energyRatio < 0.3) {
      if (this._energyLowSinceMs === null) this._energyLowSinceMs = now;
    } else {
      this._energyLowSinceMs = null;
    }
    const energyLowFor1s = this._energyLowSinceMs !== null
      && (now - this._energyLowSinceMs) > 1000;
    //   DROP EDGE. Two discriminators (cfg.dropEdgeMode):
    //   'level'    — steady short/long LEVEL ratio > dropEnergyJump. Re-fires
    //                in a loud body (the slow long envelope lags for seconds)
    //                and can fire on a slow build that drifts past threshold.
    //   'windowed' — TRUE rate-of-change: short envelope NOW vs the short
    //                envelope dropDeltaWindowMs ago. A real drop is a fast
    //                step up; a plateau stops qualifying once the lagged
    //                value catches up (≈ window later), so it fires ONCE per
    //                genuine edge instead of every refractory window
    //                (docs/30 Phase-3 fidelity fix, report §4.1).
    const energyLevelRatio = this._shortEnv / Math.max(this._longEnv, EPS);
    let dropEdge;
    let dropEdgeRatio = energyLevelRatio; // value used for confidence
    if (windowedEdge) {
      this._shortEnvHist.push({ t: now, v: this._shortEnv });
      const cutoff = now - cfg.dropDeltaWindowMs;
      // Drop history older than the window (keep one straddling sample so we
      // always have a value ~window ago).
      while (this._shortEnvHist.length > 2 && this._shortEnvHist[1].t <= cutoff) {
        this._shortEnvHist.shift();
      }
      const past = this._shortEnvHist[0].v;
      const windowedRatio = this._shortEnv / Math.max(past, EPS);
      dropEdge = windowedRatio > cfg.dropEnergyJump;
      dropEdgeRatio = windowedRatio;
      // LEVEL ASSIST (windowed only). The pure rate-of-change edge misses two
      // real drops: (a) the SECOND drop after a breakdown — the short envelope
      // had already been nudged up by build noise so the window ratio under-
      // shoots, but the steady short/long LEVEL ratio is huge (long env is low
      // from the breakdown); and (b) a drop through the heavy mic, where the
      // slam is compressed to a smaller step. So ALSO fire when the steady
      // level ratio clears the jump. This re-introduces the level edge's only
      // failure mode — in-body re-fire — which is now independently prevented
      // by the SUSTAIN-entry rising-tracker reset + the eventRefractory, so it
      // is safe. The absolute floor below gates BOTH. Disable via
      // dropLevelAssist:false to get the pure rate-of-change edge.
      if (cfg.dropLevelAssist !== false && energyLevelRatio > cfg.dropEnergyJump) {
        dropEdge = true;
        if (energyLevelRatio > dropEdgeRatio) dropEdgeRatio = energyLevelRatio;
      }
    } else {
      dropEdge = energyLevelRatio > cfg.dropEnergyJump;
    }
    // Sub-energy floor (both ratio edges), mic-gain-RELATIVE. A drop's sub slams
    // to a SUSTAINED high level; a near-silent build can post a huge RATIO off
    // noise-floor sub but its absolute shortEnv stays tiny. When dropRelLevel>0
    // the effective floor is a fraction of the running loudness reference —
    //   effFloor = clamp(dropRelLevel · loudnessRef, DROP_FLOOR_HARD_MIN, dropMinLevel)
    // so it SCALES with this feed's mic gain: a quiet venue (loudnessRef small)
    // shrinks the floor so a real but quiet drop still clears it, while a hot
    // feed is capped at dropMinLevel (the same protection the absolute floor
    // gave) and a hard min keeps it above the analyzer noise floor on a
    // dead-silent input. The build→drop transition gate (recentBuildPeak) is the
    // primary near-silent-build rejection now, so the floor can safely relax on
    // quiet feeds. dropRelLevel:0 → the pure absolute dropMinLevel floor (the
    // pre-recall-pass behavior).
    let effDropFloor;
    if ((cfg.dropRelLevel || 0) > 0) {
      const rel = cfg.dropRelLevel * this._loudnessRef;
      const cap = cfg.dropMinLevel || 0;
      effDropFloor = Math.min(cap > 0 ? cap : rel, Math.max(DROP_FLOOR_HARD_MIN, rel));
    } else {
      effDropFloor = cfg.dropMinLevel || 0;
    }
    if (effDropFloor > 0 && this._shortEnv < effDropFloor) {
      dropEdge = false;
    }

    // P0-1 refractory-relative NOVELTY (build-mem THIN edge only). Track the
    // windowed drop ratio every hop; a real drop's slam ratio is a strong
    // OUTLIER above the recent median, while on busy continuous music the
    // windowed edge crosses constantly so the firing ratio is TYPICAL (≈ the
    // median). We compute the median over dropNoveltyWindowMs EXCLUDING the most
    // recent ~500 ms so the drop's own ramp doesn't inflate its baseline, then
    // form noveltyRatio = ratioNow / medianRatio. The gate (in the build-mem
    // edge below) requires noveltyRatio ≥ dropNoveltyRatio. Only meaningful on
    // the windowed edge (dropEdgeRatio is the windowed ratio there).
    this._ratioHist.push({ t: now, v: dropEdgeRatio });
    const noveltyCutoff = now - (cfg.dropNoveltyWindowMs || 0);
    while (this._ratioHist.length > 1 && this._ratioHist[0].t < noveltyCutoff) {
      this._ratioHist.shift();
    }
    let dropNovelty = Infinity; // ∞ when novelty gating is disabled / no baseline
    if ((cfg.dropNoveltyRatio || 0) > 0) {
      const baseline = [];
      for (const r of this._ratioHist) if (r.t <= now - 500) baseline.push(r.v);
      if (baseline.length >= 8) {
        baseline.sort((a, b) => a - b);
        const med = baseline[Math.floor(baseline.length * 0.5)];
        dropNovelty = dropEdgeRatio / Math.max(med, EPS);
      }
      // baseline too short (clip just started) → leave ∞ so the gate passes; the
      // buildGate + rise + slowZone gates still apply, and a true drop in the
      // first few seconds is rare enough that this is the safe (no-suppress) side.
    }

    // 5. State machine.
    const useKalman = cfg.dropEdgeMode === 'kalman';
    const prevState = this._state;

    // Kalman drop fires from ANY state — a drop can land straight out of a
    // breakdown without a textbook 1 s build, which the BUILD-gated windowed
    // edge would miss. Handled before the switch so it pre-empts the normal
    // transitions on the firing hop.
    let droppedThisTick = false;
    if (useKalman && kalmanDropEdge && (stemsFull || !stemsFresh) && nearDownbeat) {
      this._executeDrop(now, kalmanConf, stemsFresh, cfg, 'DROP→SUSTAIN (kalman)');
      droppedThisTick = true;
    }

    // Windowed/level drop edge — fire from THIN or BUILD when a riser PRECEDED
    // the slam (recentBuildPeak ≥ dropBuildGate). This is the recall fix: the
    // brittle THIN→BUILD state-entry gate (energyRatio "rising for >1s")
    // frequently fails to latch through the mic (energyRatio saturates at 1.0,
    // so there's no monotone rise), leaving the machine in THIN when the drop
    // lands — and the old edge fired ONLY from BUILD, so it was missed. Gating
    // on the recent build-score MEMORY instead of the state machine catches the
    // drop regardless of whether BUILD latched, while the build-peak threshold
    // (0.5; real drops carry 0.74–0.99, bare loud-body onsets ≤0.22) keeps the
    // techno/sustain onset from false-firing. The dropBuildGate:0 escape hatch
    // reverts to the BUILD-state-only behavior. The BUILD-state case below still
    // owns its own confidence (buildScore·ratio·stemsBoost); here, fired from
    // THIN, we use the recentBuildPeak as the build proxy for confidence.
    //   …and we are NOT currently in a slow/calm zone. A real drop lands in an
    //   ACTIVE section (measured slowZone ≤0.32); the false edges this opened
    //   were a build's ONSET right out of a breakdown, where buildScore just
    //   crosses the gate while slowZone is still high (≈0.49–0.51) — the build
    //   STARTING, not a drop. Requiring slowZone below dropSlowZoneMax rejects
    //   that onset without touching any real drop (separation 0.32 vs ~0.5).
    const notInSlowZone = this._slowZone < cfg.dropSlowZoneMax;
    // P0-1 gates (report 23): a genuine buildScore RISE (not a flat high plateau)
    // AND the firing windowed ratio must be a NOVEL outlier vs the recent median
    // (not a routine busy-music transient). Both default-on; set the cfg key to 0
    // to disable either. These gate BOTH drop edges — the THIN build-mem edge
    // here AND the BUILD-state edge below — because the real-corpus diagnostic
    // showed the BUILD edge is an equal false-fire source on busy continuous
    // music (33 of 52 phantom drops survive with the THIN edge fully off). A real
    // drop is a novel rising-build outlier in EITHER state; busy music is neither.
    const buildRoseEnough = recentBuildRise >= (cfg.dropBuildRise || 0);
    const noveltyEnough = dropNovelty >= (cfg.dropNoveltyRatio || 0);
    if (!droppedThisTick && !useKalman && dropEdge && recentBuildPeak >= cfg.dropBuildGate
        && buildRoseEnough && noveltyEnough
        && notInSlowZone && (stemsFull || !stemsFresh) && nearDownbeat) {
      const stemsBoost = stemsFull ? 1.0 : 0.7;
      this._executeDrop(now, clamp01(recentBuildPeak * dropEdgeRatio * stemsBoost),
        stemsFresh, cfg, `${STATE_NAME[this._state]}→SUSTAIN drop (build-mem)`);
      droppedThisTick = true;
    }

    if (!droppedThisTick) switch (this._state) {
      case STATE.THIN: {
        // Guard against the degenerate flap: a flat-but-nonzero buildScore
        // leaves `_energyRisingSinceMs` stale-true (a flat signal never clears
        // it), so without this the machine would enter BUILD and immediately
        // collapse on `energyLowFor1s` every hop. An energy ratio that has sat
        // low for over a second is not a build, whatever the flux score says.
        if (this._buildScore > cfg.buildThreshold && energyRisingFor1s && !energyLowFor1s) {
          this._enterBuild(now);
        }
        break;
      }
      case STATE.BUILD: {
        this._buildPeak = Math.max(this._buildPeak, this._buildScore);
        const buildDecaying = this._buildScore < this._buildPeak * 0.7;
        // P0-1 (report 23): the BUILD-state edge is NOT immune to real-music
        // false-fires. The adversarial corpus showed that with the THIN build-mem
        // edge fully OFF, 33 of 52 phantom drops SURVIVE — they fire from the
        // BUILD state, which latches readily on busy continuous music (sustained-
        // high buildScore + a routine windowed bump). So the same two music-shape
        // gates that protect the THIN edge MUST also guard the BUILD edge: a real
        // drop is a NOVEL windowed-ratio outlier preceded by a buildScore RISE,
        // whether the state machine happens to be in THIN or BUILD. A flat-high
        // busy-music plateau (small rise, typical ratio) is rejected from BOTH.
        // The gates are config-driven (both 0 ⇒ disabled), so the BUILD edge can
        // revert to its pre-P0-1 behavior per-scene if an operator needs it.
        if (!useKalman && dropEdge && buildRoseEnough && noveltyEnough
            && (stemsFull || !stemsFresh) && nearDownbeat) {
          // DROP (windowed / level edge). _executeDrop resets the rising-trend
          // tracker on entry to SUSTAIN: energyRatio is pinned at the ceiling
          // through a loud body, so the tracker would otherwise stay "rising"
          // forever and immediately bounce SUSTAIN→BUILD. A genuine NEW build
          // must re-accumulate a fresh > 1 s rise (after a dip) to re-enter.
          const stemsBoost = stemsFull ? 1.0 : 0.7;
          this._executeDrop(now, clamp01(this._buildScore * dropEdgeRatio * stemsBoost),
            stemsFresh, cfg, 'BUILD→SUSTAIN drop');
        } else if ((now - this._buildStartedAtMs) > 6000 && buildDecaying) {
          this._state = STATE.SUSTAIN; // false build, never dropped
          this._energyRisingSinceMs = null;
          this._logTransition(now, 'BUILD→SUSTAIN (false build)', 0);
        } else if (energyLowFor1s) {
          this._state = STATE.THIN;    // collapsed before drop
          this._logTransition(now, 'BUILD→THIN (collapse)', 0);
        }
        break;
      }
      case STATE.SUSTAIN: {
        if (energyRatio < 0.5 && (stemsThin || !stemsFresh)) {
          this._state = STATE.THIN;
          this._logTransition(now, 'SUSTAIN→THIN', 0);
        } else if (this._buildScore > cfg.buildThreshold && energyRisingFor1s && !energyLowFor1s) {
          this._enterBuild(now);
          this._logTransition(now, 'SUSTAIN→BUILD', 0);
        }
        break;
      }
      default:
        break;
    }

    // 6. Decay the drop pulse every tick.
    if (dt > 0) {
      this._dropPulse += (dt / DROP_PULSE_TAU) * (0 - this._dropPulse);
      if (this._dropPulse < 1e-3) this._dropPulse = 0;
    }

    this._energyRatio = energyRatio;
    this._lastEnergyRatio = energyRatio;

    // 7. Publish — single setMany so the onChange fan-out (which
    //    deep-copies the CPC store) fires ONCE per hop for all five keys,
    //    matching the mic path's batching right beside us in engine.js.
    this.paramCenter.setMany([
      { kind: 'scalar', key: 'audioStructure',   value: this._state },
      { kind: 'scalar', key: 'audioBuildScore',  value: this._buildScore },
      { kind: 'scalar', key: 'audioEnergyRatio', value: this._energyRatio },
      { kind: 'scalar', key: 'audioVocalsHot',   value: vocalsHot ? 1.0 : 0.0 },
      { kind: 'scalar', key: 'audioDropPulse',   value: this._dropPulse },
      { kind: 'scalar', key: 'audioSlowZone',    value: this._slowZone },
    ], 'audioStructureDetector');

    // THIN→BUILD logged inside _enterBuild only when it logs; ensure a
    // transition log line for the plain THIN→BUILD edge too.
    if (prevState === STATE.THIN && this._state === STATE.BUILD) {
      this._logTransition(now, 'THIN→BUILD', this._buildScore);
    }
  }

  /** @private enter BUILD: stamp start, reset peak tracker. */
  _enterBuild(now) {
    this._state = STATE.BUILD;
    this._buildStartedAtMs = now;
    this._buildPeak = this._buildScore;
  }

  /**
   * @private execute a drop: → SUSTAIN, reset the rising-trend tracker, fire
   * (honouring refractory/self-quiet), pulse only on an ACTUAL fire, log.
   * Shared by the kalman edge (any state) and the windowed/level edge (BUILD).
   */
  _executeDrop(now, conf, stemsFresh, cfg, label) {
    this._state = STATE.SUSTAIN;
    this._energyRisingSinceMs = null;
    // P0-2 clamp (report 20260620_22): the windowed/level edge can fire from THIN
    // via the build-memory gate WITHOUT BUILD ever latching, so _buildStartedAtMs
    // is still its -Infinity sentinel and `now - (-Infinity)` = Infinity, which we
    // were broadcasting to WS consumers as buildDurationMs. Report 0 when no BUILD
    // was entered (a drop straight out of THIN has no measured build duration).
    const buildDurationMs = this._buildStartedAtMs > 0
      ? now - this._buildStartedAtMs
      : 0;
    if (this._fireDrop(now, clamp01(conf), buildDurationMs, stemsFresh, cfg)) {
      this._dropPulse = 1.0;
    }
    this._logTransition(now, label, conf);
  }

  /**
   * @private one local-level Kalman step → { nis, y }. Tracks a scalar level
   * with a random-walk model; returns the Normalized Innovation Squared
   * (innovation² / S) and the signed innovation `y` (so the caller can require
   * a RISING step for a drop). Measurement noise R is estimated online from
   * the variance of first-differences (E[(Δz)²] ≈ 2R for a slowly-varying
   * level + white noise) — the live analog of the experiment's MAD-derived R —
   * floored so a flat input can't drive NIS to infinity.
   */
  _kalmanNis(kf, z, dt, Q = KALMAN_Q) {
    if (!kf.started) { kf.x = z; kf.prevZ = z; kf.started = true; return { nis: 0, y: 0 }; }
    const dz = z - kf.prevZ; kf.prevZ = z;
    // Robust adaptive R: a drop is a huge first-difference outlier; if we let
    // it into the noise EMA it would inflate R and desensitise the detector
    // for seconds after (the mean-of-Δ² problem). Clip |dz| to ~3σ of the
    // current noise estimate before squaring — the online analog of the
    // experiment's MAD (median) R, which ignored the drop-sized tails.
    // rEma ≈ E[(Δz)²] = Var(Δz), so σ(Δz) = √rEma (NOT √(2·rEma) — that was a
    // units bug that made the clip ~1.4× too loose, letting loud passages
    // inflate R and suppress drops afterwards).
    const sigma = Math.sqrt(kf.rEma);
    const dzClip = Math.max(-3 * sigma, Math.min(3 * sigma, dz));
    kf.rEma = (1 - KALMAN_R_ALPHA) * kf.rEma + KALMAN_R_ALPHA * (dzClip * dzClip);
    const R = Math.max(0.5 * kf.rEma, KALMAN_R_FLOOR);
    const Pp = kf.P + Q;                 // predict (F = 1)
    const y = z - kf.x;                  // innovation
    const S = Pp + R;
    const K = Pp / S;
    kf.x = kf.x + K * y;                 // update
    kf.P = (1 - K) * Pp;
    return { nis: (y * y) / S, y };
  }

  /**
   * @private fire (or suppress) a drop event. Honours the refractory and
   * the N-in-M self-quiet (review §2.4 / doc Open Q2).
   * @returns {boolean} true if a dropFired was actually broadcast (false if
   *   suppressed) — the caller pulses audioDropPulse only on a real fire.
   */
  _fireDrop(now, confidence, buildDurationMs, stemsFresh, cfg) {
    // Refractory: suppress a repeat within eventRefractoryMs.
    if ((now - this._lastDropAtMs) < cfg.eventRefractoryMs) return false;
    // Self-quiet window active?
    if (now < this._quietUntilMs) return false;

    // Record this drop in the rolling history and evaluate the self-quiet
    // trigger (N drops within falseFireWindowMs → quiet for falseFireQuietMs).
    this._dropHistory.push(now);
    const windowStart = now - cfg.falseFireWindowMs;
    this._dropHistory = this._dropHistory.filter(t => t >= windowStart);
    this._lastDropAtMs = now;

    if (this._dropHistory.length >= cfg.falseFireCount) {
      this._quietUntilMs = now + cfg.falseFireQuietMs;
      this._dropHistory = [];
      console.log(`[audioStructure] ${new Date(now).toISOString()} self-quiet ENGAGED — ${cfg.falseFireCount} drops in ${cfg.falseFireWindowMs}ms; suppressing dropFired for ${cfg.falseFireQuietMs}ms`);
      // This Nth drop still fires — the quiet applies to subsequent ones.
    }

    const payload = {
      type: 'dropFired',
      confidence,
      buildDurationMs,          // doc Open Q1 — YES (review §2.6)
      ts: now,
      source: 'audioStructureDetector',
      stemsFresh,
    };
    try {
      this.broadcast(payload);
    } catch (e) {
      console.warn(`[audioStructure] dropFired broadcast threw: ${e && e.message}`);
    }
    console.log(`[audioStructure] ${new Date(now).toISOString()} dropFired confidence=${confidence.toFixed(2)} buildMs=${Math.round(buildDurationMs)} stemsFresh=${stemsFresh}`);
    return true;
  }

  /** @private warn ONCE per non-finite input key (fail loud, don't spam/die). */
  _warnNonFinite(key, val) {
    if (!this._nfWarned) this._nfWarned = new Set();
    if (this._nfWarned.has(key)) return;
    this._nfWarned.add(key);
    console.warn(`[audioStructure] non-finite ${key}=${val} — treating as 0 this hop (key dropout?)`);
  }

  /** @private one stdout line per state transition (operator wants all). */
  _logTransition(now, label, confidence) {
    // Rate-limit: a transition closer than TRANSITION_LOG_MIN_GAP_MS to the
    // last emitted line is suppressed and counted (flap guard). The count is
    // folded into the next line that does emit, so nothing is silently lost.
    if ((now - this._lastTransitionLogMs) < TRANSITION_LOG_MIN_GAP_MS) {
      this._suppressedTransitionLogs += 1;
      return;
    }
    const suppressed = this._suppressedTransitionLogs;
    this._suppressedTransitionLogs = 0;
    this._lastTransitionLogMs = now;
    const tail = suppressed > 0 ? ` (+${suppressed} suppressed)` : '';
    console.log(`[audioStructure] ${new Date(now).toISOString()} ${label} buildScore=${this._buildScore.toFixed(2)} energyRatio=${this._energyRatio.toFixed(2)} conf=${Number(confidence).toFixed(2)}${tail}`);
  }

  /** @private rolling p99 of tick() wall time (perf budget, doc §Perf). */
  _recordTickTime(ms) {
    this._tickSamples.push(ms);
    if (this._tickSamples.length > 200) this._tickSamples.shift();
    const sorted = this._tickSamples.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
    this._tickP99Ms = sorted[idx];
  }

  /** @private zero all five live keys (disable / reset / boot). */
  _zeroLiveKeys() {
    if (this._fatal) return;
    try {
      this.paramCenter.setMany([
        { kind: 'scalar', key: 'audioStructure',   value: 0.0 },
        { kind: 'scalar', key: 'audioBuildScore',  value: 0.0 },
        { kind: 'scalar', key: 'audioEnergyRatio', value: 0.0 },
        { kind: 'scalar', key: 'audioVocalsHot',   value: 0.0 },
        { kind: 'scalar', key: 'audioDropPulse',   value: 0.0 },
        { kind: 'scalar', key: 'audioSlowZone',    value: 0.0 },
      ], 'audioStructureDetector');
    } catch (e) {
      this._fatal = true;
      console.error(`[audioStructure] FATAL on key zero — disabling detector: ${e && e.message}`);
    }
  }

  /**
   * Diagnostics snapshot. Surfaces the self-quiet status, stems mode,
   * and bar-phase availability (review §2.4 — barPhaseAvailable:false).
   */
  getStatus() {
    const cfg = this._cfg();
    // selfQuiet is measured on the hop clock (`_quietUntilMs` is set from
    // tick's `now`), so compare against the last hop clock we saw.
    const now = this._lastSeenNow;
    return {
      enabled: cfg.enabled === true,
      fatal: this._fatal,
      state: STATE_NAME[this._state],
      buildScore: this._buildScore,
      energyRatio: this._energyRatio,
      dropPulse: this._dropPulse,
      slowZone: this._slowZone,
      structureDetectorStems: this._lastStemsFresh ? 'fresh' : 'offline',
      barPhaseAvailable: false,
      selfQuiet: now < this._quietUntilMs,
      quietUntilMs: this._quietUntilMs,
      recentDrops: this._dropHistory.length,
      lastDropAtMs: this._lastDropAtMs === -Infinity ? null : this._lastDropAtMs,
      tickP99Ms: this._tickP99Ms,
    };
  }

  /** Tear down the CPC subscription (test teardown / engine shutdown). */
  dispose() {
    if (typeof this._unsubscribe === 'function') {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }
}
