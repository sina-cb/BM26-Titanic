/**
 * DerivedSignals — second-tier audio signals derived from the analyzer +
 * structure-detector outputs, for driving the lights. OBSERVE-AND-PUBLISH,
 * like AudioStructureDetector: it reads the live CPC keys each hop and writes
 * its own. All four sub-modules are pure, allocation-free, and were validated
 * offline on the FMA EDM corpus (report 202606; ~28 µs/hop total).
 *
 * Publishes:
 *   audioBpm          — realtime tempo (Kalman-smoothed), [0,180] (BpmTracker v2 clamp)
 *   audioBeat         — phase-locked beat pulse [0,1]
 *   audioParty        — loud-music gate, 0/1 (hysteresis + hold)
 *   audioPartyStrong  — HARD party gate, 0/1 (level×calibrated-floor AND rhythmic
 *                       evidence AND spectral shape AND not-silent, 20 s on /
 *                       30 s off). THIS is the key the show director trusts.
 *   audioLoudness     — the slow loudness scalar audioPartyStrong thresholds on
 *                       (the number the operator watches to calibrate)
 *   audioKickRate     — kick onsets per second, 0 when the beat stops
 *   audioKickReg      — kick regularity, 1 - CV of the interval ring
 *   audioBpmLocked    — BpmTracker lock state 0/1 (was computed + thrown away)
 *   audioBpmConf      — BpmTracker confidence [0,1] (was computed + thrown away)
 *   audioNote         — dominant pitch class 0–11 (−1→0 when no stable note)
 *   audioNoteHue      — pitchClass/12 → [0,1], for "play the notes as colour"
 *   audioSwitchPattern— pulse: a musically-sensible moment to change PATTERN
 *   audioSwitchColor  — pulse: a musically-sensible moment to change COLOUR
 *   audioGenre        — coarse dance-genre index (0 ambient .. 6 downtempo;
 *                       see GENRE_NAMES in genre_classifier.js). Meaningful
 *                       only in party mode; 0 when audioParty is off/unsure.
 *   audioGenreConf    — 0..1 confidence of the current genre
 *
 * Inputs (RAW mic mirrors + detector keys): micFluxRaw, micKickRaw,
 *   micLowRaw/MidRaw/HighRaw, micDomFreq1/2 + micDomEnergy1/2, audioDropPulse,
 *   audioEnergyRatio, audioBuildScore, audioSlowZone, audioStructure.
 *
 * FAIL-LOUD POLICY (codex P0 — no fail-quiet):
 *   A throwing sub-module must NOT silently disable the WHOLE derived chain for
 *   the session (the old behaviour: one bad signal blanked BPM/party/note/genre
 *   permanently). Instead each sub-module update is isolated: a throw is logged
 *   LOUDLY (console.error, once per module so we don't spam), records the module
 *   into an operator-visible `getStatus().moduleErrors` map + sets `degraded`,
 *   and that ONE module's outputs fall back to its last-good / zero for THAT hop
 *   only — every healthy module keeps publishing. The engine surfaces `degraded`
 *   + the failing module names in the `audioStatus` broadcast so the operator
 *   SEES the failure, not just stderr. Only a failure of the CPC publish path
 *   itself (`paramCenter.setMany`) — which means nothing audio works — escalates
 *   to a loud `_fatal` (the publish target is gone; there is nowhere to write).
 */
import { BpmTracker } from './bpm_tracker.js';
import { PartyMode } from './party_mode.js';
import { PartyModeStrong } from './party_mode_strong.js';
import { NoteEstimator } from './note_estimator.js';
import { SwitchSignals } from './switch_signals.js';
// ── analyzer_features (slot 3): per-band onsets + sub-bass chest hit ──────────
import { BandOnsetBank } from './band_onsets.js';
import { SubBass } from './sub_bass.js';
// ── genre_signals (slot 0): party-mode dance-genre classifier ────────────────
import { GenreClassifier } from './genre_classifier.js';
// ── new_derived_signals: riser/anticipation, track-change, climax, phrase,
//    drop-countdown (report 20260620_2 #1/#3/#8/#6/#7) ─────────────────────────
import { BuildAnticipation } from './build_anticipation.js';
import { TrackChange } from './track_change.js';
import { Climax } from './climax.js';
import { PhraseTracker } from './phrase_tracker.js';
import { DropCountdown } from './drop_countdown.js';

// Corpus-tuned params (signals_params.json). Hop rate ~86.13/s.
const PARAMS = Object.freeze({
  // NOTE: there is intentionally NO `bpm` block here. BPM uses the BpmTracker v2
  // baked-in DEFAULTS, which are the corpus-validated ones (see bpm_tracker.js
  // header). A former `PARAMS.bpm` was dead config (never passed to the tracker)
  // and carried stale v1-only keys (octaveCorrFloor/octaveVotes/lockConf/…) that
  // no longer exist in v2 — removed to stop it lying about what runs.
  party: { wLow: 0.4, wMid: 0.4, wHigh: 0.2, loudTau: 0.4, onThresh: 0.22, offThresh: 0.12, holdMs: 1200, offConfirmMs: 800, warmupMs: 1500 },
  note:  { minPitchHz: 40, maxPitchHz: 1200, preferLow: true, preferLowEnergyFrac: 0.5, energyGate: 0.05, medianN: 15, holdHops: 26, kfQ: 0.15, kfR: 8, stableHops: 26 },
  sw:    { startupGuardMs: 2000, patternMinDwellMs: 6000, dropMinDwellMs: 2500, energyRegimeHi: 0.6, energyRegimeLo: 0.3, regimeHoldMs: 1500, dropPulseFire: 0.5, slowZoneHi: 0.55, slowZoneLo: 0.35, quantizeToBeat: true, quantizeMaxWaitMs: 350, patternUrgeTau: 8, colorMinDwellMs: 2500, noteChangeMinDwellMs: 1800, colorUrgeTau: 4 },
});

// Safe per-module result shapes used when a sub-module update() throws this hop.
// These mirror the field names the publish step reads, holding the neutral /
// zero value so a single failing module degrades to "off" rather than poisoning
// the others. (Frozen — never mutated; the publish step only reads them.)
const SAFE_BPM = Object.freeze({ bpm: 0, beat: 0, beatEdge: false, locked: false, confidence: 0, beatInBar: 0, barPhase: 0, downbeat: false });
const SAFE_NOTE = Object.freeze({ pitchClass: -1, hue: 0, stable: false });
const SAFE_PARTY = Object.freeze({ party: false });
// partyStrong's safe shape: OFF + all metrics zero. A failing detector must read
// "no party" (ambient), never a frozen 1 — the whole point of the hard gate.
const SAFE_PARTY_STRONG = Object.freeze({
  party: false, loudness: 0, kickRate: 0, kickReg: 0, lowShare: 0, highShare: 0, qualify: false,
});
const SAFE_SWITCH = Object.freeze({ switchPattern: false, switchColor: false });
const SAFE_ONSETS = Object.freeze({ low: 0, mid: 0, high: 0 });
const SAFE_SUB = Object.freeze({ pulse: 0 });
const SAFE_GENRE = Object.freeze({ genre: 0, confidence: 0 });
const SAFE_RISER = Object.freeze({ riserScore: 0, buildEta: 0, riserConf: 0 });
const SAFE_TRACK = Object.freeze({ silence: false, trackChange: false });
const SAFE_CLIMAX = Object.freeze({ climax: 0 });
const SAFE_PHRASE = Object.freeze({ phrasePhase: 0, phraseBoundary: false });
const SAFE_COUNTDOWN = Object.freeze({ countdown: 0 });

export class DerivedSignals {
  /** @param {{paramCenter:object}} deps */
  constructor({ paramCenter }) {
    if (!paramCenter || typeof paramCenter.get !== 'function' || typeof paramCenter.setMany !== 'function') {
      throw new TypeError('DerivedSignals: paramCenter with get()/setMany() is required');
    }
    this.paramCenter = paramCenter;
    this._bpm = new BpmTracker();   // v2: tuned DEFAULTS baked in (2-state lock + beat/bar)
    this._party = new PartyMode(PARAMS.party);
    // Hard party gate (report 20260725_10 §4.1). Its thresholds are OPERATOR
    // tunables, not corpus constants: the companion applies config.yaml's
    // `party:` block on boot via setPartyStrongParams().
    this._partyStrong = new PartyModeStrong();
    this._note = new NoteEstimator(PARAMS.note);
    this._switch = new SwitchSignals(PARAMS.sw);
    // analyzer_features (slot 3): band-onset chase + sub-bass chest hit shapers.
    this._onsets = new BandOnsetBank();
    this._sub = new SubBass();
    this._genre = new GenreClassifier();   // genre_signals (slot 0): tuned DEFAULTS baked in
    // new_derived_signals: anticipation/track-change/climax/phrase/countdown.
    this._riser = new BuildAnticipation();
    this._trackChange = new TrackChange();
    this._climax = new Climax();
    this._phrase = new PhraseTracker();
    this._countdown = new DropCountdown();
    this._fatal = false;
    // Per-module failure tracking (fail-loud + operator-visible, NOT fail-quiet).
    // moduleErrors maps a module name → its last error message; degraded is true
    // whenever any module has failed at least once this session. _warnedModules
    // rate-limits the loud console.error to once per module.
    this._moduleErrors = {};
    this._degraded = false;
    this._warnedModules = new Set();
    // Last note actually committed by the estimator. We HOLD this on the
    // published audioNote/audioNoteHue keys whenever the estimator currently
    // reports "no note" (pitchClass < 0) — silence/warmup/sub-gate energy must
    // NOT blink the colour to C. Until a first real note lands we hold pc 0 /
    // hue 0 (a defined, non-spurious neutral), then track the live note.
    this._heldPc = 0;
    this._heldHue = 0;

    // ── Hoisted publish payload (codex: allocation-free hot path) ─────────────
    // The {kind,key} shapes are static; only `.value` changes each hop. Build
    // the array + its objects ONCE here and mutate `.value` in place every tick
    // instead of allocating ~25 fresh objects + an array per hop (~2150 obj/s at
    // 86 Hz). param_center.setMany() reads each entry synchronously and never
    // retains the array or its objects, so reuse is safe.
    this._publishWrites = [
      { kind: 'scalar', key: 'audioBpm',           value: 0.0 },
      { kind: 'scalar', key: 'audioBeat',          value: 0.0 },
      { kind: 'scalar', key: 'audioParty',         value: 0.0 },
      { kind: 'scalar', key: 'audioNote',          value: 0.0 },
      { kind: 'scalar', key: 'audioNoteHue',       value: 0.0 },
      { kind: 'scalar', key: 'audioSwitchPattern', value: 0.0 },
      { kind: 'scalar', key: 'audioSwitchColor',   value: 0.0 },
      { kind: 'scalar', key: 'audioBeatInBar',     value: 0.0 },
      { kind: 'scalar', key: 'audioBarPhase',      value: 0.0 },
      { kind: 'scalar', key: 'audioDownbeat',      value: 0.0 },
      // analyzer_features (slot 3): band-onset chase + sub-bass chest hit.
      { kind: 'scalar', key: 'micOnsetLow',        value: 0.0 },
      { kind: 'scalar', key: 'micOnsetMid',        value: 0.0 },
      { kind: 'scalar', key: 'micOnsetHigh',       value: 0.0 },
      { kind: 'scalar', key: 'audioChestHit',      value: 0.0 },
      // genre_signals (slot 0): party-mode dance-genre + confidence.
      { kind: 'scalar', key: 'audioGenre',         value: 0.0 },
      { kind: 'scalar', key: 'audioGenreConf',     value: 0.0 },
      // new_derived_signals: riser/anticipation, track-change/silence, climax,
      // phrase, drop-countdown (report 20260620_2 #1/#3/#8/#6/#7).
      { kind: 'scalar', key: 'audioRiserScore',     value: 0.0 },
      { kind: 'scalar', key: 'audioBuildEta',       value: 0.0 },
      { kind: 'scalar', key: 'audioRiserConf',      value: 0.0 },
      { kind: 'scalar', key: 'audioSilence',        value: 0.0 },
      { kind: 'scalar', key: 'audioTrackChange',    value: 0.0 },
      { kind: 'scalar', key: 'audioClimax',         value: 0.0 },
      { kind: 'scalar', key: 'audioPhrasePhase',    value: 0.0 },
      { kind: 'scalar', key: 'audioPhraseBoundary', value: 0.0 },
      { kind: 'scalar', key: 'audioDropCountdown',  value: 0.0 },
      // party_detection (R1, report 20260725_10): the hard party gate + the five
      // raw metrics it decides on. Published so the operator can WATCH the gate
      // decide (GET /param-center) and calibrate the thresholds on the playa.
      { kind: 'scalar', key: 'audioPartyStrong',    value: 0.0 },
      { kind: 'scalar', key: 'audioLoudness',       value: 0.0 },
      { kind: 'scalar', key: 'audioKickRate',       value: 0.0 },
      { kind: 'scalar', key: 'audioKickReg',        value: 0.0 },
      { kind: 'scalar', key: 'audioBpmLocked',      value: 0.0 },
      { kind: 'scalar', key: 'audioBpmConf',        value: 0.0 },
    ];
    // Index map for O(1) in-place writes by key in the publish step.
    this._wIdx = {};
    for (let i = 0; i < this._publishWrites.length; i++) {
      this._wIdx[this._publishWrites[i].key] = i;
    }
  }

  /**
   * Apply the operator's `party:` tunables (config.yaml) to the hard party gate.
   * Throws on an unknown key / non-finite value — a typo in the operator's
   * config must fail LOUD at boot, not run silently on defaults.
   * @param {object} opts — see PARTY_MODE_STRONG_DEFAULTS
   */
  setPartyStrongParams(opts) {
    return this._partyStrong.setParams(opts);
  }

  /** The hard party gate's live tunables (for the operator read-out). */
  getPartyStrongParams() {
    return { ...this._partyStrong.p };
  }

  /**
   * The hard party gate's full operator read model — metrics, per-term
   * verdicts, the level threshold, debounce progress and the live tunables.
   * Backs the Audio Companion's PARTY tab (report 20260725_19).
   *
   * @param {number} nowMs — the analyzer hop clock
   */
  getPartyStrongState(nowMs) {
    return this._partyStrong.getState(nowMs);
  }

  reset() {
    this._bpm.reset(); this._party.reset(); this._partyStrong.reset();
    this._note.reset(); this._switch.reset();
    this._onsets.reset(); this._sub.reset();   // analyzer_features (slot 3)
    this._genre.reset();                        // genre_signals (slot 0)
    // new_derived_signals: anticipation/track-change/climax/phrase/countdown.
    this._riser.reset(); this._trackChange.reset(); this._climax.reset();
    this._phrase.reset(); this._countdown.reset();
    this._heldPc = 0; this._heldHue = 0;
    if (!this._fatal) this._zero();
  }

  /** @private warn ONCE per non-finite input key (fail loud, don't spam/die). */
  _warnNonFinite(key, val) {
    if (!this._nfWarned) this._nfWarned = new Set();
    if (this._nfWarned.has(key)) return;
    this._nfWarned.add(key);
    console.warn(`[derivedSignals] non-finite ${key}=${val} — treating as 0 (key dropout?)`);
  }

  /**
   * @private Run one sub-module update under an isolated guard. On throw: log
   * LOUDLY (once per module), record into the operator-visible status, mark the
   * chain degraded, and return the module's SAFE fallback so the OTHER modules
   * keep publishing this hop. This is the fail-loud-but-isolated contract that
   * replaces the old session-killing `try { …everything… } catch { _fatal }`.
   * @param {string} name  module name (for the loud log + status map)
   * @param {() => object} fn  the module update closure
   * @param {object} safe  frozen safe fallback result for a failed hop
   */
  _runModule(name, fn, safe) {
    try {
      return fn();
    } catch (e) {
      const msg = (e && e.message) || String(e);
      this._moduleErrors[name] = msg;
      this._degraded = true;
      if (!this._warnedModules.has(name)) {
        this._warnedModules.add(name);
        // LOUD: a sub-module failing is a real defect — surface it, don't bury
        // it. We isolate (other modules keep running) but we do NOT go quiet.
        console.error(`[derivedSignals] module '${name}' FAILED — isolating (other signals keep running): ${msg}`);
      }
      return safe;
    }
  }

  /** Per-hop step. `now` ms (analyzer hop clock), `dt` seconds since last hop. */
  tick(now, dt) {
    if (this._fatal) return;
    const pc = this.paramCenter;
    // Finite guard (fail loud, don't die): a key dropout / NaN must not poison
    // the BPM/note/party state for the session. Non-finite → 0 + warn once.
    const g = (key) => { const v = pc.get(key); if (Number.isFinite(v)) return v; this._warnNonFinite(key, v); return 0; };

    // Each sub-module runs under its OWN guard (_runModule): a throw in one
    // (e.g. the genre classifier) can no longer blank BPM/party/note — it
    // degrades only its own keys for that hop and is reported loud + visible.
    const b = this._runModule('bpm', () => this._bpm.update(g('micFluxRaw'), g('micKickRaw'), dt), SAFE_BPM);
    const n = this._runModule('note', () => this._note.update(g('micDomFreq1'), g('micDomEnergy1'), g('micDomFreq2'), g('micDomEnergy2')), SAFE_NOTE);
    const p = this._runModule('party', () => this._party.update(g('micLowRaw'), g('micMidRaw'), g('micHighRaw'), dt, now), SAFE_PARTY);
    // NOTE PUBLISH: the estimator returns pitchClass = -1 ("no note") during
    // silence, warmup, or sub-gate energy. Publishing that as 0 collapses the
    // colour to a permanent C whenever the live dom-freq energy is below the
    // gate (the "NOTE always C" bug). HOLD the last committed note instead —
    // the estimator's own design says colour should freeze, not blink to C.
    if (n.pitchClass >= 0) {
      this._heldPc = n.pitchClass;
      this._heldHue = n.hue;
    }
    const s = this._runModule('switch', () => this._switch.update({
      nowMs: now, dt,
      dropPulse: g('audioDropPulse'), energyRatio: g('audioEnergyRatio'),
      buildScore: g('audioBuildScore'), slowZone: g('audioSlowZone'),
      structure: g('audioStructure'), beatEdge: b.beatEdge, bpmLocked: b.locked,
      pitchClass: n.pitchClass, noteStable: n.stable,
    }), SAFE_SWITCH);
    // ── analyzer_features (slot 3): per-band onsets + sub-bass chest hit ─────
    // Reads the RAW analyzer mirrors (micOnsetLow/Mid/HighRaw, micSubRaw) the
    // engine publishes each hop and shapes them into pulse keys.
    const dtMs = dt * 1000;
    const ob = this._runModule('onsets', () => this._onsets.update(
      g('micOnsetLowRaw'), g('micOnsetMidRaw'), g('micOnsetHighRaw'), dtMs, now,
    ), SAFE_ONSETS);
    const sb = this._runModule('sub', () => this._sub.update(g('micSubRaw'), dt, dtMs, now), SAFE_SUB);
    // ── genre_signals (slot 0): party-mode dance-genre classifier ───────────
    const gn = this._runModule('genre', () => this._genre.update({
      nowMs: now, dt, party: p.party,
      bpm: b.bpm, low: g('micLowRaw'), mid: g('micMidRaw'), high: g('micHighRaw'),
      flux: g('micFluxRaw'), kick: g('micKickRaw'),
      pitchClass: n.pitchClass, noteStable: n.stable,
      // genre_chroma (report 20260620_30): the analyzer's RAW chroma/timbre
      // mirrors — the harmonic axis the 8 original features lacked.
      tonalStability: g('micTonalStabilityRaw'), chromaFlux: g('micChromaFluxRaw'),
      chromaTilt: g('micChromaTiltRaw'),
    }), SAFE_GENRE);
    // ── new_derived_signals: riser/anticipation, track-change/silence, ──────
    //    climax, phrase, drop-countdown (report 20260620_2 #1/#3/#8/#6/#7).
    const rz = this._runModule('riser', () => this._riser.update({
      flux: g('micFluxRaw'), high: g('micHighRaw'),
      low: g('micLowRaw'), mid: g('micMidRaw'),
      buildScore: g('audioBuildScore'), structure: g('audioStructure'),
      dropPulse: g('audioDropPulse'), bpm: b.bpm, bpmLocked: b.locked,
      barPhase: b.barPhase || 0, dt, nowMs: now,
    }), SAFE_RISER);
    const tc = this._runModule('trackChange', () => this._trackChange.update({
      low: g('micLowRaw'), mid: g('micMidRaw'), high: g('micHighRaw'),
      bpm: b.bpm, bpmLocked: b.locked,
      pitchClass: n.pitchClass, noteStable: n.stable, dt, nowMs: now,
    }), SAFE_TRACK);
    // ── party_detection (R1): the HARD party gate. Runs AFTER trackChange so
    //    it can use this hop's silence flag, and reads the BPM tracker's lock
    //    state directly (not the published key) so it never lags a hop.
    const ps = this._runModule('partyStrong', () => this._partyStrong.update({
      low: g('micLowRaw'), mid: g('micMidRaw'), high: g('micHighRaw'),
      kick: g('micKickRaw'), silence: tc.silence ? 1 : 0,
      bpmLocked: b.locked === true, dt, nowMs: now,
    }), SAFE_PARTY_STRONG);
    const cx = this._runModule('climax', () => this._climax.update({
      low: g('micLowRaw'), mid: g('micMidRaw'), high: g('micHighRaw'),
      dropPulse: g('audioDropPulse'), dt, nowMs: now,
    }), SAFE_CLIMAX);
    const ph = this._runModule('phrase', () => this._phrase.update({
      downbeat: b.downbeat ? 1.0 : 0.0, barPhase: b.barPhase || 0,
      dropPulse: g('audioDropPulse'), bpmLocked: b.locked, active: p.party, nowMs: now,
    }), SAFE_PHRASE);
    const cd = this._runModule('countdown', () => this._countdown.update({
      riserScore: rz.riserScore, riserConf: rz.riserConf, buildEta: rz.buildEta,
      bpm: b.bpm, bpmLocked: b.locked, beat: b.beat,
      dropPulse: g('audioDropPulse'), dtMs, nowMs: now,
    }), SAFE_COUNTDOWN);

    // ── PUBLISH: mutate the hoisted payload in place, then one setMany ────────
    const w = this._publishWrites;
    const idx = this._wIdx;
    w[idx.audioBpm].value           = b.bpm;
    w[idx.audioBeat].value          = b.beat;
    w[idx.audioParty].value         = p.party ? 1.0 : 0.0;
    w[idx.audioNote].value          = this._heldPc;
    w[idx.audioNoteHue].value       = this._heldHue;
    w[idx.audioSwitchPattern].value = s.switchPattern ? 1.0 : 0.0;
    w[idx.audioSwitchColor].value   = s.switchColor ? 1.0 : 0.0;
    w[idx.audioBeatInBar].value     = b.beatInBar || 0;
    w[idx.audioBarPhase].value      = b.barPhase || 0;
    w[idx.audioDownbeat].value      = b.downbeat ? 1.0 : 0.0;
    w[idx.micOnsetLow].value        = ob.low;
    w[idx.micOnsetMid].value        = ob.mid;
    w[idx.micOnsetHigh].value       = ob.high;
    w[idx.audioChestHit].value      = sb.pulse;
    w[idx.audioGenre].value         = gn.genre;
    w[idx.audioGenreConf].value     = gn.confidence;
    w[idx.audioRiserScore].value     = rz.riserScore;
    w[idx.audioBuildEta].value       = rz.buildEta;
    w[idx.audioRiserConf].value      = rz.riserConf;
    w[idx.audioSilence].value        = tc.silence ? 1.0 : 0.0;
    w[idx.audioTrackChange].value    = tc.trackChange ? 1.0 : 0.0;
    w[idx.audioClimax].value         = cx.climax;
    w[idx.audioPhrasePhase].value    = ph.phrasePhase;
    w[idx.audioPhraseBoundary].value = ph.phraseBoundary ? 1.0 : 0.0;
    w[idx.audioDropCountdown].value  = cd.countdown;
    // party_detection (R1): the gate + the metrics it decided on.
    w[idx.audioPartyStrong].value    = ps.party ? 1.0 : 0.0;
    w[idx.audioLoudness].value       = ps.loudness;
    w[idx.audioKickRate].value       = ps.kickRate;
    w[idx.audioKickReg].value        = ps.kickReg;
    w[idx.audioBpmLocked].value      = b.locked ? 1.0 : 0.0;
    w[idx.audioBpmConf].value        = b.confidence || 0;

    // Only a failure of the PUBLISH PATH itself (the CPC target is gone) is
    // truly fatal — there is nowhere left to write any signal. That escalates
    // loud + disables (the operator sees `audioStructure`/derived go flat and
    // the FATAL line). A sub-module throw never reaches here.
    try {
      pc.setMany(w, 'derivedSignals');
    } catch (e) {
      this._fatal = true;
      console.error(`[derivedSignals] FATAL — CPC publish path failed, disabling for session: ${e && e.message}`);
    }
  }

  /**
   * Operator-visible health snapshot (parallels AudioStructureDetector.getStatus).
   * The engine folds `degraded` + `moduleErrors` into the `audioStatus` broadcast
   * so a failing sub-module is VISIBLE in CaptainPad / the companion, not buried
   * in stderr. `fatal` means the whole chain is disabled (publish path gone).
   */
  getStatus() {
    return {
      fatal: this._fatal,
      degraded: this._degraded,
      // shallow copy so callers can't mutate our internal map
      moduleErrors: { ...this._moduleErrors },
    };
  }

  _zero() {
    // Reuse the hoisted payload (already all-zero at construction; re-zero in
    // case a prior tick left live values) for the disable/reset publish.
    const w = this._publishWrites;
    for (let i = 0; i < w.length; i++) w[i].value = 0.0;
    this.paramCenter.setMany(w, 'derivedSignals');
  }
}
