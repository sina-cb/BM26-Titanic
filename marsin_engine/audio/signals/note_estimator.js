/**
 * note_estimator_ref.js — dominant-frequency → musical note / pitch-class,
 * for driving COLOR. Stable enough that hue doesn't strobe.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 * Maps the AudioAnalyzer dominant-frequency outputs (domFreq1/domFreq2 +
 * their energies) to a MIDI note number, a pitch class (0..11, C..B), and a
 * note name. The pitch class is the natural hue index for a "play the notes
 * as colour" mapping (12 pitch classes → 12 hues around the wheel).
 *
 * Outputs:
 *   - midi        : continuous MIDI note number (float) of the chosen partial
 *   - pitchClass  : 0..11 integer (0=C)
 *   - noteName    : 'C','C#',...'B'
 *   - hue         : 0..1 = pitchClass/12 (convenience for color modules)
 *   - cents       : signed cents off the nearest semitone (tuning display)
 *   - stable      : boolean — true when the smoothed note has held
 *
 * ── Algorithm ─────────────────────────────────────────────────────────────
 * 1. PARTIAL CHOICE. dom1 is usually the sub/bass fundamental; dom2 the
 *    second partial. We pick the partial with the strongest energy that is
 *    above MIN_PITCH_HZ — sub-bass below ~50 Hz is felt, not seen as a
 *    "note", and its octave is ambiguous; choosing the more clearly-pitched
 *    partial gives a more musical colour. Fold the chosen frequency up by
 *    octaves into a reference octave so the pitch class is octave-invariant.
 * 2. FREQ → MIDI.  midi = 69 + 12*log2(f/440).
 * 3. SMOOTHING. dom freqs already pass through a Kalman in the analyzer, but
 *    the pitch-class can still flip on transient peaks. We add (a) a short
 *    MEDIAN over the last MEDIAN_N hops of the raw pitch class to reject
 *    single-hop flips, then (b) a scalar Kalman on the *continuous* MIDI
 *    value (circular-aware via unwrapping to the running estimate) so the
 *    colour glides rather than steps. A pitch-class change is only committed
 *    when the median agrees for HOLD_HOPS consecutive hops (hysteresis), so
 *    the visible note (and thus hue) is rock-steady on a held chord.
 * 4. SILENCE GATE. If the chosen partial's energy is below ENERGY_GATE the
 *    note is held (frozen), not reset — colour shouldn't blink to C on every
 *    gap between notes.
 *
 * Pure Math. One small ring buffer (MEDIAN_N) — pre-sized, no per-hop alloc.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const NOTE_ESTIMATOR_DEFAULTS = Object.freeze({
  // Source the COLOUR note from the BASS ROOT: in EDM the sub/bass fundamental
  // is the harmonic anchor and is far steadier than the wandering upper
  // partials (hats/synth stabs jump pitch class every hop). We bias toward the
  // LOWER in-range partial and fold octaves so a 90 Hz root and its 540 Hz
  // harmonic share one pitch class.
  minPitchHz: 40,       // include sub-bass roots (E1≈41 Hz up)
  maxPitchHz: 1200,
  preferLow: true,      // pick the lower strong partial (the root), not the loudest harmonic
  preferLowEnergyFrac: 0.5, // a lower partial wins if it has ≥ this fraction of the louder's energy
  energyGate: 0.05,     // below this energy → hold the last note
  medianN: 15,          // median window for raw pitch class (~0.17 s; reject flips)
  holdHops: 26,         // consecutive-agreement hops to commit a pc change (~0.3 s)
  kfQ: 0.15,            // Kalman process noise on MIDI value (stiffer = steadier colour)
  kfR: 8.0,             // Kalman measurement noise on MIDI value
  stableHops: 26,       // pc must hold this long to report stable=true (~0.3 s)
});

function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

export class NoteEstimator {
  constructor(opts = {}) {
    this.p = { ...NOTE_ESTIMATOR_DEFAULTS, ...opts };
    this._medBuf = new Float32Array(this.p.medianN);
    this._medScratch = new Float32Array(this.p.medianN);
    this.reset();
  }

  reset() {
    this._medBuf.fill(NaN);
    this._medHead = 0;
    this._medFilled = 0;
    this._kfX = 0; this._kfP = 1e6; this._kfStarted = false;
    this._candPc = -1; this._candHeld = 0;
    this._committedPc = -1; this._committedHeld = 0;

    this.midi = 0;
    this.pitchClass = -1;
    this.noteName = '-';
    this.hue = 0;
    this.cents = 0;
    this.stable = false;
  }

  /**
   * @param {number} f1 domFreq1 Hz
   * @param {number} e1 domEnergy1 [0,1]
   * @param {number} f2 domFreq2 Hz
   * @param {number} e2 domEnergy2 [0,1]
   * @returns {{midi,pitchClass,noteName,hue,cents,stable}}
   */
  update(f1, e1, f2, e2) {
    const p = this.p;

    // Fail loud on non-finite input: NaN/Inf in a frequency or energy would
    // silently poison the median ring + Kalman for the rest of the session
    // (NaN compares false everywhere → committedPc frozen forever, which is
    // exactly the "stuck note" failure we are guarding against). The caller
    // (DerivedSignals) already finite-guards its CPC reads, so reaching here
    // with a non-finite value is a real upstream contract violation — surface
    // it, don't swallow it.
    if (!Number.isFinite(f1) || !Number.isFinite(e1) ||
        !Number.isFinite(f2) || !Number.isFinite(e2)) {
      throw new TypeError(
        `NoteEstimator.update: non-finite input (f1=${f1}, e1=${e1}, f2=${f2}, e2=${e2})`);
    }

    // 1. Choose the partial. Default: strongest in range. With preferLow we
    //    pick the LOWER in-range partial (the bass root) whenever it carries a
    //    reasonable fraction of the louder partial's energy — the root is the
    //    musically meaningful colour anchor and is far steadier than upper
    //    harmonics.
    let f = 0, e = 0;
    const ok1 = f1 >= p.minPitchHz && f1 <= p.maxPitchHz;
    const ok2 = f2 >= p.minPitchHz && f2 <= p.maxPitchHz;
    if (p.preferLow && ok1 && ok2) {
      const lowF = f1 <= f2 ? f1 : f2, lowE = f1 <= f2 ? e1 : e2;
      const hiF = f1 <= f2 ? f2 : f1, hiE = f1 <= f2 ? e2 : e1;
      if (lowE >= p.preferLowEnergyFrac * hiE) { f = lowF; e = lowE; }
      else { f = hiF; e = hiE; }
    } else if (ok1 && (!ok2 || e1 >= e2)) { f = f1; e = e1; }
    else if (ok2) { f = f2; e = e2; }

    // Silence / out-of-range → hold previous note (freeze colour).
    if (f <= 0 || e < p.energyGate) {
      return this._output();
    }

    // 2. Freq → continuous MIDI.
    const rawMidi = freqToMidi(f);
    const rawPc = ((Math.round(rawMidi) % 12) + 12) % 12;

    // 3a. Median filter the raw pitch class (reject single-hop flips).
    this._medBuf[this._medHead] = rawPc;
    this._medHead = (this._medHead + 1) % p.medianN;
    if (this._medFilled < p.medianN) this._medFilled++;
    const medPc = this._medianPc();

    // 3b. Kalman on the continuous MIDI value (unwrap toward estimate).
    if (!this._kfStarted) {
      this._kfX = rawMidi; this._kfP = p.kfR; this._kfStarted = true;
    } else {
      const Pp = this._kfP + p.kfQ;
      const y = rawMidi - this._kfX;
      const S = Pp + p.kfR;
      const K = Pp / S;
      this._kfX += K * y;
      this._kfP = (1 - K) * Pp;
    }
    this.midi = this._kfX;

    // 3c. Commit a pitch-class change only after HOLD_HOPS of median agreement.
    if (medPc === this._candPc) {
      this._candHeld++;
    } else {
      this._candPc = medPc; this._candHeld = 1;
    }
    if (this._candHeld >= p.holdHops && this._candPc !== this._committedPc) {
      this._committedPc = this._candPc;
      this._committedHeld = 0;
    }
    this._committedHeld++;
    this.stable = this._committedHeld >= p.stableHops;

    return this._output();
  }

  /** @private build output from committed pitch class + kalman midi. */
  _output() {
    const pc = this._committedPc;
    this.pitchClass = pc;
    this.noteName = pc >= 0 ? NOTE_NAMES[pc] : '-';
    this.hue = pc >= 0 ? pc / 12 : 0;
    // cents: how far the smoothed MIDI sits off its nearest semitone.
    const nearest = Math.round(this.midi);
    this.cents = (this.midi - nearest) * 100;
    return {
      midi: this.midi, pitchClass: this.pitchClass, noteName: this.noteName,
      hue: this.hue, cents: this.cents, stable: this.stable,
    };
  }

  /**
   * @private MODE of the pitch-class ring — the most frequent class. Pitch
   * classes are CIRCULAR (0..11, where 11 and 0 are adjacent), so a plain
   * numeric median is wrong near the B↔C wrap (median of {11,0,11,0,11} = 11,
   * but {0,11,0,11,0} = 0 — it flips on count parity, and a real cluster
   * straddling the wrap collapses to ~F). A histogram mode is circular-safe
   * and is exactly "the dominant note" we want.
   */
  _medianPc() {
    if (this._medFilled === 0) return this._committedPc;
    const counts = this._pcCounts || (this._pcCounts = new Int32Array(12));
    counts.fill(0);
    let any = false;
    for (let i = 0; i < this._medFilled; i++) {
      const v = this._medBuf[i];
      if (!Number.isNaN(v)) { const pc = ((v % 12) + 12) % 12 | 0; counts[pc]++; any = true; }
    }
    if (!any) return this._committedPc;
    let best = 0;
    for (let pc = 1; pc < 12; pc++) if (counts[pc] > counts[best]) best = pc;
    return best;
  }
}

export default NoteEstimator;
