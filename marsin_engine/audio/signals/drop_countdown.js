/**
 * drop_countdown.js — "4…3…2…1…DROP" beat-synced pulse train → `audioDropCountdown`
 * (report 20260620_2 #7). Depends on the riser (#1) + the beat grid.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * On the final bar(s) of a CONFIDENT build, flash a beat-synced countdown so the
 * crowd FEELS the drop coming. One clean pulse per beat while the build is
 * peaking, then it goes quiet (the drop itself is the climax, handled elsewhere).
 *
 * Output (published by DerivedSignals):
 *   audioDropCountdown  pulse — fires once per beat during the countdown window,
 *                               0 otherwise. A pulse TRAIN, not a level.
 *
 * ── Why peak-gated, not ETA-gated (codex P0 honesty) ──────────────────────
 * An absolute "seconds-to-drop" ETA is UNRELIABLE from audio alone: BPM can lock
 * an octave off during a build (the riser has no clean kick), and phrase
 * alignment is unknowable without labels (report #1/#7 caveat). So the countdown
 * does NOT trust the raw ETA seconds. Instead it gates on the RELIABLE proximate:
 * the riser score has climbed to its PEAK and is SUSTAINED there — which is
 * exactly the final stretch of a real build, the moment right before the drop.
 * A steady track never peaks the riser, so it never counts down ("NOT on false
 * builds"). The raw ETA seconds are NOT used — the bars-to-phrase grid reads a
 * full phrase out even on a genuine build, so it is fiction at this granularity.
 *
 * ── Algorithm (gate HARD — under-fire ≫ false countdown) ───────────────────
 * REAL-AUDIO RE-TUNE (E2 P1-4, 2026-06-20): on the 60-track no-drop corpus the
 * v1 gate fired 338 spurious count-ins (35/60 tracks) because the riser
 * momentarily crosses `peakScore` on normal flux/high wobble. Two gates fix it:
 *   • MONOTONIC CLIMB: the riser must have been clearly LOW (≤ `climbFromScore`)
 *     within `climbWindowMs` before reaching the peak — a real build CLIMBS in,
 *     it does not merely sit near the peak.
 *   • BOUNDED PEAK: a countdown is the FINAL bars — a SHORT top right before the
 *     drop. If the riser stays peaked longer than `peakMaxMs` it is steady-state
 *     (a busy continuous track reads "building" indefinitely), so we DISARM.
 * ARM only when ALL of:
 *   - riser is peaking:  riserScore ≥ `peakScore` AND riserConf ≥ `minConfArm`,
 *   - it CLIMBED into the peak from a recent low (monotonic-climb gate),
 *   - the peak has been HELD in [`peakHoldMs`, `peakMaxMs`] (not a spike, not
 *     a chronic steady-state plateau),
 *   - the BPM is locked  (we need a real beat to flash on),
 *   - no drop in the last `dropRefractoryMs` (don't count down right after a drop).
 * While armed, fire ONE pulse per beat rising edge (audioBeat crossing up). A
 * drop pulse, or the riser falling out of its peak, DISARMS immediately — a build
 * that fizzles must NOT keep counting (the riser resets its score on the real
 * drop, so the countdown naturally stops there).
 *
 * Pure Math, allocation-free. Validated offline: `edm_drop` fires a countdown
 * train in the final build beats and NOT during the steady sustain; `full_track`
 * (no build) and `silence` fire nothing.
 */

export const DROP_COUNTDOWN_DEFAULTS = Object.freeze({
  peakScore: 0.7,          // riser score must reach this peak to arm the countdown
  peakHoldMs: 600,         // the peak must hold this long (not a momentary spike)
  dropPeakExit: 0.55,      // riser falling below this exits the peak (disarm)
  // ── Monotonic-climb arm gate (E2 P1-4, 2026-06-20) ───────────────────────
  // On REAL continuous tracks the riser momentarily crosses peakScore on a
  // normal flux/high wobble, and a confident-looking but stationary riser then
  // counted down (338 spurious count-ins / 35 tracks). A real build CLIMBS into
  // the peak: it must have been clearly LOW (`climbFromScore`) within a recent
  // window (`climbWindowMs`) before reaching the peak. A steady track that just
  // sits near peakScore never satisfies the "was low → climbed" history, so it
  // no longer arms. The drop pulse / riser reset clears the climb memory.
  climbFromScore: 0.3,     // the riser must have been ≤ this recently …
  climbWindowMs: 4000,     // … within this lookback to count as a real climb-in
  minConfArm: 0.7,         // and confidence must clear this stricter bar to arm
  // A countdown is the FINAL bars of a build — a SHORT window right before the
  // drop. If the riser sits peaked LONGER than `peakMaxMs` it is steady-state
  // (a busy continuous track reads "building" indefinitely), NOT a build top, so
  // we DISARM. This bounds the countdown to a genuine short climb→top→drop arc;
  // a no-drop corpus, where the riser is chronically high, never produces the
  // bounded climb-then-brief-peak shape and so stops counting in.
  peakMaxMs: 4000,         // riser may be peaked at most this long for a countdown
  beatFire: 0.6,           // audioBeat above this = on-beat (rising edge fires)
  beatRearm: 0.3,          // audioBeat must fall below this to re-arm a beat fire
  refractoryMs: 180,       // min spacing between countdown pulses (one per beat)
  dropFire: 0.5,           // a drop pulse disarms + opens the refractory
  dropRefractoryMs: 4000,  // no countdown for this long after a drop
  pulseDecayMs: 80,        // pulse exponential decay after a fire
});

export class DropCountdown {
  constructor(opts = {}) {
    this.p = { ...DROP_COUNTDOWN_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this._armed = true;        // beat schmitt: ready to fire on the next rising edge
    this._pulse = 0;
    this._lastFireMs = -Infinity;
    this._peakSinceMs = null;  // when the riser first entered its peak
    this._lastDropMs = -Infinity;
    this._lastLowMs = -Infinity; // last time the riser was clearly LOW (climb origin)
    this.countdown = 0;
    this._active = false;      // currently inside a countdown window (for tests)
  }

  /**
   * @param {object} s
   *   s.riserScore, s.riserConf  — from BuildAnticipation
   *   s.buildEta                 — seconds to predicted drop (unused; see header)
   *   s.bpm, s.bpmLocked, s.beat — beat grid
   *   s.dropPulse                — audioDropPulse [0,1]
   *   s.dtMs, s.nowMs
   * @returns {{countdown:number, active:boolean, fired:boolean}}
   */
  update(s) {
    const p = this.p;
    if (s.dropPulse >= p.dropFire) this._lastDropMs = s.nowMs;
    const postDrop = (s.nowMs - this._lastDropMs) < p.dropRefractoryMs;

    // Climb memory: note the last time the riser was clearly LOW. Arming later
    // requires that this was RECENT — i.e. the riser CLIMBED from low into the
    // peak (a real build), not merely sat near the peak (a steady-track wobble).
    if (s.riserScore <= p.climbFromScore) this._lastLowMs = s.nowMs;
    const climbedIn = (s.nowMs - this._lastLowMs) <= p.climbWindowMs;

    // Peak hold: the riser must be at/above peakScore (confident) and STAY there,
    // AND have climbed into the peak from a recent low (monotonic-climb gate).
    const peaking = s.riserScore >= p.peakScore && s.riserConf >= p.minConfArm && climbedIn;
    if (peaking) {
      if (this._peakSinceMs === null) this._peakSinceMs = s.nowMs;
    } else if (s.riserScore < p.dropPeakExit) {
      this._peakSinceMs = null;   // fell out of the peak — reset the hold
    }
    const peakAgeMs = this._peakSinceMs !== null ? (s.nowMs - this._peakSinceMs) : 0;
    const peakHeld = this._peakSinceMs !== null
      && peakAgeMs >= p.peakHoldMs && peakAgeMs <= p.peakMaxMs;

    this._active = s.bpmLocked && peakHeld && !postDrop;

    let fired = false;
    if (this._active) {
      const refractoryOk = (s.nowMs - this._lastFireMs) >= p.refractoryMs;
      if (this._armed && s.beat >= p.beatFire && refractoryOk) {
        fired = true;
        this._armed = false;
        this._pulse = 1.0;
        this._lastFireMs = s.nowMs;
      } else if (!this._armed && s.beat <= p.beatRearm) {
        this._armed = true;
      }
    } else {
      this._armed = true;   // re-arm so the next valid window starts cleanly
    }

    if (!fired && this._pulse > 0) {
      const dtMs = s.dtMs > 0 ? s.dtMs : 0;
      this._pulse *= Math.exp(-dtMs / p.pulseDecayMs);
      if (this._pulse < 1e-3) this._pulse = 0;
    }
    this.countdown = this._pulse;
    return { countdown: this._pulse, active: this._active, fired };
  }
}

export default DropCountdown;
