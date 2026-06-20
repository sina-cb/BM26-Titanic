/**
 * switch_signals_ref.js — derived "switch pattern" and "switch color" events
 * for the lighting director. Both are EVENTS (edge booleans) plus a 0..1
 * "urge" level, derived purely from signals the engine already publishes.
 *
 * These answer: "when should the rig change what it's doing?" — distinct from
 * the continuous reactive signals (bands, beat) that modulate the CURRENT look.
 *
 * ════════════════════════════════════════════════════════════════════════
 * SWITCH PATTERN  (change the geometry / animation)
 * ════════════════════════════════════════════════════════════════════════
 * A pattern swap should land on big STRUCTURAL moments, not every beat:
 *   - a DROP (audioDropPulse spikes) — the canonical "everything changes" cue;
 *   - a sustained ENERGY-REGIME change — energyRatio crossing into a new
 *     regime (quiet↔loud) and holding, i.e. entering or leaving a breakdown;
 *   - entering / leaving a SLOW ZONE (audioSlowZone), so ambient sections get
 *     a calm pattern and the return to energy gets a fresh one.
 * We also enforce a MIN dwell time so patterns get a chance to read, and we
 * (optionally) quantise the fire to the next beat from the BPM tracker so the
 * swap snaps to the music instead of landing mid-bar.
 *
 * switchPattern   : boolean edge (fire once)
 * switchPatternUrge: 0..1 how "due" a change is (for soft crossfades)
 *
 * ════════════════════════════════════════════════════════════════════════
 * SWITCH COLOR  (change the palette / hue)
 * ════════════════════════════════════════════════════════════════════════
 * Colour should change more often than pattern but still feel motivated:
 *   - a NOTE / pitch-class change (from NoteEstimator) — harmonic colour;
 *   - a BUILD→DROP transition (drop pulse) — punch a new palette on the drop;
 *   - a STRUCTURE state change (THIN/BUILD/SUSTAIN) — section colour.
 * Min dwell prevents strobing; note changes are rate-limited separately so a
 * busy melodic line doesn't flicker the palette every note.
 *
 * switchColor     : boolean edge
 * switchColorUrge : 0..1
 *
 * Pure Math, no allocations. Inputs are the live keys + the derived BPM/note
 * outputs. Tuned on the FMA EDM corpus (see params).
 */

export const SWITCH_DEFAULTS = Object.freeze({
  // --- pattern ---
  startupGuardMs: 2000,        // suppress pattern swaps in the first 2 s
  patternMinDwellMs: 6000,     // never swap pattern faster than this (regime/slow cues)
  dropMinDwellMs: 2500,        // a DROP can swap this soon after the last swap (it bypasses the long dwell)
  energyRegimeHi: 0.6,         // energyRatio above → "loud regime"
  energyRegimeLo: 0.3,         // below → "quiet regime" (hysteresis)
  regimeHoldMs: 1500,          // regime must hold this long to count as a change
  dropPulseFire: 0.5,          // dropPulse above → drop event
  slowZoneHi: 0.55,            // entering slow zone
  slowZoneLo: 0.35,            // leaving slow zone (hysteresis)
  quantizeToBeat: true,        // snap the fire to the next beat edge if BPM locked
  quantizeMaxWaitMs: 350,      // but don't wait longer than this for a beat
  patternUrgeTau: 8.0,         // s — urge ramps up the longer since last swap

  // --- color ---
  colorMinDwellMs: 2500,       // never change colour faster than this
  noteChangeMinDwellMs: 1800,  // a note change can recolor at most this often
  colorUrgeTau: 4.0,
});

export class SwitchSignals {
  constructor(opts = {}) {
    this.p = { ...SWITCH_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    // pattern
    this.switchPattern = false;
    this.switchPatternUrge = 0;
    this._lastPatternMs = -Infinity;
    this._regime = 0;             // -1 quiet, +1 loud, 0 unknown
    this._regimeCandSinceMs = null;
    this._regimeCand = 0;
    this._slowState = false;      // in slow zone?
    this._pendPattern = false;    // a fire is pending beat-quantisation
    this._pendPatternSinceMs = -Infinity;

    // color
    this.switchColor = false;
    this.switchColorUrge = 0;
    this._lastColorMs = -Infinity;
    this._lastNoteChangeMs = -Infinity;
    this._prevPc = -1;
    this._prevState = -1;
    this._pendNote = false;       // a note change waiting to recolour
    this._pendNotePc = -1;
    this._firstTickMs = null;     // hop clock of the first update() (startup anchor)

    this._prevDropPulse = 0;
  }

  /**
   * @param {object} s
   *   s.energyRatio, s.buildScore, s.slowZone, s.dropPulse, s.structure (0/1/2)
   *   s.pitchClass (0..11 or -1), s.noteStable (bool)
   *   s.beatEdge (bool), s.bpmLocked (bool)
   *   s.nowMs, s.dt
   * @returns {{switchPattern,switchPatternUrge,switchColor,switchColorUrge}}
   */
  update(s) {
    const p = this.p;
    const now = s.nowMs;
    this.switchPattern = false;
    this.switchColor = false;

    // ───────────── PATTERN ─────────────
    // 1. Drop event (rising edge of dropPulse over threshold).
    const dropEvent = s.dropPulse >= p.dropPulseFire && this._prevDropPulse < p.dropPulseFire;

    // 2. Energy-regime change with hold.
    let regimeNow = this._regime;
    if (s.energyRatio >= p.energyRegimeHi) regimeNow = 1;
    else if (s.energyRatio <= p.energyRegimeLo) regimeNow = -1;
    let regimeChanged = false;
    if (regimeNow !== this._regime && regimeNow !== 0) {
      // candidate regime must hold regimeHoldMs.
      if (this._regimeCand !== regimeNow) { this._regimeCand = regimeNow; this._regimeCandSinceMs = now; }
      else if (this._regimeCandSinceMs !== null && (now - this._regimeCandSinceMs) >= p.regimeHoldMs) {
        this._regime = regimeNow; regimeChanged = true; this._regimeCandSinceMs = null;
      }
    } else {
      this._regimeCand = 0; this._regimeCandSinceMs = null;
    }

    // 3. Slow-zone enter/leave (hysteresis).
    let slowChanged = false;
    if (!this._slowState && s.slowZone >= p.slowZoneHi) { this._slowState = true; slowChanged = true; }
    else if (this._slowState && s.slowZone <= p.slowZoneLo) { this._slowState = false; slowChanged = true; }

    // Startup guard: suppress all pattern fires in the first startupGuardMs so
    // the song's opening transient (regime/slow flip as levels first rise)
    // doesn't burn a swap before the music has even started. `now` is the engine
    // hop clock (absolute epoch ms), so the guard MUST be measured relative to
    // the first tick — comparing `now >= startupGuardMs` against epoch ms made
    // the guard always-true (dead). Anchor on the first update() instead.
    if (this._firstTickMs === null) this._firstTickMs = now;
    const pastStartup = (now - this._firstTickMs) >= p.startupGuardMs;

    // A DROP is the single most important pattern cue and bypasses the normal
    // dwell gate (using its own shorter refractory) — a drop should ALWAYS
    // swap, even if a regime change swapped a few seconds earlier.
    const dwellOk = (now - this._lastPatternMs) >= p.patternMinDwellMs;
    const dropDwellOk = (now - this._lastPatternMs) >= p.dropMinDwellMs;
    const wantPattern = pastStartup && (
      (dropEvent && dropDwellOk) ||
      ((regimeChanged || slowChanged) && dwellOk)
    );

    // Min-dwell gate, then optional beat quantisation. Drops are NOT
    // beat-quantised (they should land instantly on the transient).
    if (wantPattern && !this._pendPattern) {
      if (p.quantizeToBeat && s.bpmLocked && !dropEvent) {
        this._pendPattern = true;
        this._pendPatternSinceMs = now;
      } else {
        this._firePattern(now);
      }
    }
    // Resolve a pending (beat-quantised) pattern fire.
    if (this._pendPattern) {
      if (s.beatEdge || (now - this._pendPatternSinceMs) >= p.quantizeMaxWaitMs) {
        this._firePattern(now);
        this._pendPattern = false;
      }
    }

    // Urge: ramps toward 1 the longer since last swap (sat at ~1 after a few tau).
    const sincePat = (now - this._lastPatternMs) / 1000;
    this.switchPatternUrge = Number.isFinite(sincePat)
      ? 1 - Math.exp(-sincePat / p.patternUrgeTau) : 0;

    // ───────────── COLOR ─────────────
    // 1. Note / pitch-class change (rate-limited, only when stable).
    //
    // A stable change of the pitch class away from the LAST-COLORED note is a
    // colour intent. CRITICAL: a note change must not be "consumed" unless it
    // actually produces a colour. The original code advanced `_prevPc` (and
    // `_lastNoteChangeMs`) the moment the note differed, EVEN when the colour
    // was then blocked by `colorMinDwellMs` — so every change that landed
    // inside the colour dwell was silently dropped and the rig recoloured at
    // roughly HALF the real note rate (and felt disconnected from the music).
    // Instead we latch a PENDING note intent and clear it only when the colour
    // fires; `_prevPc` is advanced at fire time, not at detection time.
    if (s.noteStable && s.pitchClass >= 0 && s.pitchClass !== this._prevPc) {
      this._pendNote = true;
      this._pendNotePc = s.pitchClass;
    } else if (s.noteStable && s.pitchClass === this._prevPc) {
      // The live note returned to the last-coloured class before we got to
      // fire — the intent is stale, drop it (no recolour to the same hue).
      this._pendNote = false;
    }
    // The note gate is now the SINGLE colour dwell below (colorMinDwellMs);
    // `noteChangeMinDwellMs` is kept as an extra floor specifically on
    // note-driven recolours so a busy melodic line can be throttled
    // independently of drop/structure recolours.
    const noteDwellOk = (now - this._lastNoteChangeMs) >= p.noteChangeMinDwellMs;
    const noteEvent = this._pendNote && noteDwellOk;

    // 2. Drop event → punch a palette.
    // 3. Structure state change.
    let stateEvent = false;
    if (s.structure !== this._prevState && this._prevState >= 0) stateEvent = true;
    this._prevState = s.structure;

    const wantColor = pastStartup && (noteEvent || dropEvent || stateEvent);
    if (wantColor && (now - this._lastColorMs) >= p.colorMinDwellMs) {
      this.switchColor = true;
      this._lastColorMs = now;
      // The colour fired — commit the note bookkeeping ONLY now, so a change
      // blocked by the dwell stays pending and fires on the next eligible hop.
      if (this._pendNote) {
        this._prevPc = this._pendNotePc;
        this._lastNoteChangeMs = now;
        this._pendNote = false;
      }
    }
    const sinceCol = (now - this._lastColorMs) / 1000;
    this.switchColorUrge = Number.isFinite(sinceCol)
      ? 1 - Math.exp(-sinceCol / p.colorUrgeTau) : 0;

    this._prevDropPulse = s.dropPulse;
    return {
      switchPattern: this.switchPattern,
      switchPatternUrge: this.switchPatternUrge,
      switchColor: this.switchColor,
      switchColorUrge: this.switchColorUrge,
    };
  }

  _firePattern(now) {
    this.switchPattern = true;
    this._lastPatternMs = now;
  }
}

export default SwitchSignals;
