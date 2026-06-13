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
 *   micLowRaw, micHighRaw, micKickRaw, micFlux
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
  dropEnergyJump:    1.5,    // short-energy ×-jump that signals a drop
  stemsTimeoutMs:    300,    // stems older than this read as stale (offline)
  eventRefractoryMs: 2000,   // suppress repeat dropFired within this window
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

const EPS = 1e-9;
// energyRatio display map: log1p(rawRatio) / log1p(3) → [0,1]-ish.
const ENERGY_RATIO_DENOM = Math.log1p(3.0);

// State enum, float-encoded for the live key (review §2.2 — no int-typed
// live keys in this codebase).
const STATE = Object.freeze({ THIN: 0, BUILD: 1, SUSTAIN: 2 });
const STATE_NAME = Object.freeze({ 0: 'THIN', 1: 'BUILD', 2: 'SUSTAIN' });

function clamp01(x) {
  if (!(x > 0)) return 0;
  return x < 1 ? x : 1;
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
    this._buildScore = 0;
    this._energyRatio = 0;
    this._dropPulse = 0;

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
      // constructor and on every disable edge — so we only flip the flag.
      this._wasEnabled = true;
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

    // RAW (pre-gain) inputs (review §2.1).
    const micLow  = this.paramCenter.get('micLowRaw');
    const micFlux = this.paramCenter.get('micFlux');

    // 1. Short / long energy envelopes (causal one-pole IIR).
    if (dt > 0) {
      this._shortEnv += (dt / SHORT_ENV_TAU) * (micLow - this._shortEnv);
      this._longEnv  += (dt / LONG_ENV_TAU)  * (micLow - this._longEnv);
    }
    const rawRatio = this._shortEnv / Math.max(this._longEnv, EPS);
    const energyRatio = clamp01(Math.log1p(rawRatio) / ENERGY_RATIO_DENOM);

    // 2. Build score from spectral flux (review §2.2 — prefer micFlux
    //    over differencing micHigh). EMA, tau ~2 s.
    if (dt > 0) {
      const target = clamp01(micFlux * BUILD_GAIN);
      this._buildScore += (dt / BUILD_TAU) * (target - this._buildScore);
      this._buildScore = clamp01(this._buildScore);
    }

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
    //   short/long energy LEVEL RATIO (drop edge): short envelope ≥
    //   dropEnergyJump × long. NOTE: this is a steady level ratio, not the
    //   rate-of-change "jump in < 500 ms" docs/30 §5 describes — a slow
    //   build whose ratio drifts past the threshold can fire. Fidelity
    //   tuning (true windowed delta) is deferred to docs/30 Phase 3.
    const energyLevelRatio = this._shortEnv / Math.max(this._longEnv, EPS);
    const dropEdge = energyLevelRatio > cfg.dropEnergyJump;

    // 5. State machine.
    const prevState = this._state;
    switch (this._state) {
      case STATE.THIN: {
        if (this._buildScore > cfg.buildThreshold && energyRisingFor1s) {
          this._enterBuild(now);
        }
        break;
      }
      case STATE.BUILD: {
        this._buildPeak = Math.max(this._buildPeak, this._buildScore);
        const buildDecaying = this._buildScore < this._buildPeak * 0.7;
        if (dropEdge && (stemsFull || !stemsFresh) && nearDownbeat) {
          // DROP.
          this._state = STATE.SUSTAIN;
          const stemsBoost = stemsFull ? 1.0 : 0.7;
          const conf = clamp01(this._buildScore * energyLevelRatio * stemsBoost);
          const buildDurationMs = now - this._buildStartedAtMs;
          this._dropPulse = 1.0;
          this._fireDrop(now, conf, buildDurationMs, stemsFresh, cfg);
          this._logTransition(now, 'BUILD→SUSTAIN drop', conf);
        } else if ((now - this._buildStartedAtMs) > 6000 && buildDecaying) {
          this._state = STATE.SUSTAIN; // false build, never dropped
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
        } else if (this._buildScore > cfg.buildThreshold && energyRisingFor1s) {
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
   * @private fire (or suppress) a drop event. Honours the 2 s refractory
   * and the N-in-M self-quiet (review §2.4 / doc Open Q2).
   */
  _fireDrop(now, confidence, buildDurationMs, stemsFresh, cfg) {
    // Refractory: suppress a repeat within eventRefractoryMs.
    if ((now - this._lastDropAtMs) < cfg.eventRefractoryMs) return;
    // Self-quiet window active?
    if (now < this._quietUntilMs) return;

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
  }

  /** @private one stdout line per state transition (operator wants all). */
  _logTransition(now, label, confidence) {
    console.log(`[audioStructure] ${new Date(now).toISOString()} ${label} buildScore=${this._buildScore.toFixed(2)} energyRatio=${this._energyRatio.toFixed(2)} conf=${Number(confidence).toFixed(2)}`);
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
