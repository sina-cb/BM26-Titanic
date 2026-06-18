/**
 * DerivedSignals — second-tier audio signals derived from the analyzer +
 * structure-detector outputs, for driving the lights. OBSERVE-AND-PUBLISH,
 * like AudioStructureDetector: it reads the live CPC keys each hop and writes
 * its own. All four sub-modules are pure, allocation-free, and were validated
 * offline on the FMA EDM corpus (report 202606; ~28 µs/hop total).
 *
 * Publishes:
 *   audioBpm          — realtime tempo (Kalman-smoothed), [0,300]
 *   audioBeat         — phase-locked beat pulse [0,1]
 *   audioParty        — loud-music gate, 0/1 (hysteresis + hold)
 *   audioNote         — dominant pitch class 0–11 (−1→0 when no stable note)
 *   audioNoteHue      — pitchClass/12 → [0,1], for "play the notes as colour"
 *   audioSwitchPattern— pulse: a musically-sensible moment to change PATTERN
 *   audioSwitchColor  — pulse: a musically-sensible moment to change COLOUR
 *
 * Inputs (RAW mic mirrors + detector keys): micFluxRaw, micKickRaw,
 *   micLowRaw/MidRaw/HighRaw, micDomFreq1/2 + micDomEnergy1/2, audioDropPulse,
 *   audioEnergyRatio, audioBuildScore, audioSlowZone, audioStructure.
 */
import { BpmTracker } from './bpm_tracker.js';
import { PartyMode } from './party_mode.js';
import { NoteEstimator } from './note_estimator.js';
import { SwitchSignals } from './switch_signals.js';

// Corpus-tuned params (signals_params.json). Hop rate ~86.13/s.
const PARAMS = Object.freeze({
  bpm:   { hopsPerSec: 86.13, minBpm: 70, maxBpm: 180, kickWeight: 1.5, whitenTau: 0.5, windowS: 4, periodRefreshHops: 8, combHarmonics: 3, combDecay: 0.5, priorBpm: 128, priorStrength: 0.15, octaveCorrFloor: 0.85, octaveVotes: 10, octaveStickiness: 0.6, warmupFill: 0.85, confPeakW: 0.6, kfQ: 0.15, kfRBase: 60, kfRMin: 4, phaseCorrGain: 0.08, onsetThreshForPhase: 0.15, beatPulseWidth: 0.18, lockConf: 0.25, lockHoldHops: 60 },
  party: { wLow: 0.4, wMid: 0.4, wHigh: 0.2, loudTau: 0.4, onThresh: 0.22, offThresh: 0.12, holdMs: 1200, offConfirmMs: 800 },
  note:  { minPitchHz: 40, maxPitchHz: 1200, preferLow: true, preferLowEnergyFrac: 0.5, energyGate: 0.05, medianN: 15, holdHops: 26, kfQ: 0.15, kfR: 8, stableHops: 26 },
  sw:    { startupGuardMs: 2000, patternMinDwellMs: 6000, dropMinDwellMs: 2500, energyRegimeHi: 0.6, energyRegimeLo: 0.3, regimeHoldMs: 1500, dropPulseFire: 0.5, slowZoneHi: 0.55, slowZoneLo: 0.35, quantizeToBeat: true, quantizeMaxWaitMs: 350, patternUrgeTau: 8, colorMinDwellMs: 2500, noteChangeMinDwellMs: 1800, colorUrgeTau: 4 },
});

export class DerivedSignals {
  /** @param {{paramCenter:object}} deps */
  constructor({ paramCenter }) {
    if (!paramCenter || typeof paramCenter.get !== 'function' || typeof paramCenter.setMany !== 'function') {
      throw new TypeError('DerivedSignals: paramCenter with get()/setMany() is required');
    }
    this.paramCenter = paramCenter;
    this._bpm = new BpmTracker();   // v2: tuned DEFAULTS baked in (2-state lock + beat/bar)
    this._party = new PartyMode(PARAMS.party);
    this._note = new NoteEstimator(PARAMS.note);
    this._switch = new SwitchSignals(PARAMS.sw);
    this._fatal = false;
    // Last note actually committed by the estimator. We HOLD this on the
    // published audioNote/audioNoteHue keys whenever the estimator currently
    // reports "no note" (pitchClass < 0) — silence/warmup/sub-gate energy must
    // NOT blink the colour to C. Until a first real note lands we hold pc 0 /
    // hue 0 (a defined, non-spurious neutral), then track the live note.
    this._heldPc = 0;
    this._heldHue = 0;
  }

  reset() {
    this._bpm.reset(); this._party.reset(); this._note.reset(); this._switch.reset();
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

  /** Per-hop step. `now` ms (analyzer hop clock), `dt` seconds since last hop. */
  tick(now, dt) {
    if (this._fatal) return;
    const pc = this.paramCenter;
    // Finite guard (fail loud, don't die): a key dropout / NaN must not poison
    // the BPM/note/party state for the session. Non-finite → 0 + warn once.
    const g = (key) => { const v = pc.get(key); if (Number.isFinite(v)) return v; this._warnNonFinite(key, v); return 0; };
    try {
      const b = this._bpm.update(g('micFluxRaw'), g('micKickRaw'), dt);
      const n = this._note.update(g('micDomFreq1'), g('micDomEnergy1'), g('micDomFreq2'), g('micDomEnergy2'));
      const p = this._party.update(g('micLowRaw'), g('micMidRaw'), g('micHighRaw'), dt, now);
      // NOTE PUBLISH: the estimator returns pitchClass = -1 ("no note") during
      // silence, warmup, or sub-gate energy. Publishing that as 0 collapses the
      // colour to a permanent C whenever the live dom-freq energy is below the
      // gate (the "NOTE always C" bug). HOLD the last committed note instead —
      // the estimator's own design says colour should freeze, not blink to C.
      if (n.pitchClass >= 0) {
        this._heldPc = n.pitchClass;
        this._heldHue = n.hue;
      }
      const s = this._switch.update({
        nowMs: now, dt,
        dropPulse: g('audioDropPulse'), energyRatio: g('audioEnergyRatio'),
        buildScore: g('audioBuildScore'), slowZone: g('audioSlowZone'),
        structure: g('audioStructure'), beatEdge: b.beatEdge, bpmLocked: b.locked,
        pitchClass: n.pitchClass, noteStable: n.stable,
      });
      pc.setMany([
        { kind: 'scalar', key: 'audioBpm',           value: b.bpm },
        { kind: 'scalar', key: 'audioBeat',          value: b.beat },
        { kind: 'scalar', key: 'audioParty',         value: p.party ? 1.0 : 0.0 },
        { kind: 'scalar', key: 'audioNote',          value: this._heldPc },
        { kind: 'scalar', key: 'audioNoteHue',       value: this._heldHue },
        { kind: 'scalar', key: 'audioSwitchPattern', value: s.switchPattern ? 1.0 : 0.0 },
        { kind: 'scalar', key: 'audioSwitchColor',   value: s.switchColor ? 1.0 : 0.0 },
        { kind: 'scalar', key: 'audioBeatInBar',     value: b.beatInBar || 0 },
        { kind: 'scalar', key: 'audioBarPhase',      value: b.barPhase || 0 },
        { kind: 'scalar', key: 'audioDownbeat',      value: b.downbeat ? 1.0 : 0.0 },
      ], 'derivedSignals');
    } catch (e) {
      this._fatal = true;
      console.error(`[derivedSignals] FATAL — disabling for session: ${e && e.message}`);
    }
  }

  _zero() {
    this.paramCenter.setMany([
      { kind: 'scalar', key: 'audioBpm', value: 0.0 }, { kind: 'scalar', key: 'audioBeat', value: 0.0 },
      { kind: 'scalar', key: 'audioParty', value: 0.0 }, { kind: 'scalar', key: 'audioNote', value: 0.0 },
      { kind: 'scalar', key: 'audioNoteHue', value: 0.0 }, { kind: 'scalar', key: 'audioSwitchPattern', value: 0.0 },
      { kind: 'scalar', key: 'audioSwitchColor', value: 0.0 },
      { kind: 'scalar', key: 'audioBeatInBar', value: 0.0 }, { kind: 'scalar', key: 'audioBarPhase', value: 0.0 },
      { kind: 'scalar', key: 'audioDownbeat', value: 0.0 },
    ], 'derivedSignals');
  }
}
