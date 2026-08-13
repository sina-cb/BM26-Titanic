/**
 * note_estimator.js — dominant-frequency → musical note / pitch-class,
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
 *    circular-safe MODE (histogram) over the last `medianN` hops of the raw
 *    pitch class to reject single-hop flips — a plain numeric median is wrong
 *    near the B↔C wrap, see `_medianPc` — then (b) a scalar Kalman on the
 *    *continuous* MIDI
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
  medianN: 15,          // evidence window for raw pitch class (~0.17 s)
  minConsensus: 0.55,   // ambiguous windows hold; a plurality alone cannot change colour
  holdHops: 10,         // sustained evidence to commit a change (~0.12 s after the window)
  nearChangeSemitones: 2, // small moves resemble dom-tracker glides; demand more evidence
  nearHoldHops: 24,     // ~0.28 s confirmation for a 1–2 semitone move
  kfQ: 0.15,            // Kalman process noise on MIDI value (stiffer = steadier colour)
  kfR: 8.0,             // Kalman measurement noise on MIDI value
  stableHops: 18,       // committed pc must hold this long to report stable=true (~0.21 s)
});

/**
 * Legal range for every noteTracking field — the SINGLE SOURCE of truth,
 * shared by this constructor and the operator-facing config validator
 * (audio/config/derived_signals_config.js imports this).
 *
 * The bounds are MUSICAL, not merely type-safe: a value inside them must still
 * produce a working note tracker. Degenerate settings that would disable or
 * freeze the feature from the Companion UI are rejected here rather than
 * silently shipping a dead colour channel:
 *   - medianN < 3 has no majority to speak of; > 51 is a 0.6 s window that can
 *     no longer resolve a chord at any dance tempo.
 *   - minConsensus < 1/3 is not consensus — three-way ties would commit.
 *   - holdHops / nearHoldHops of 0 removes the hysteresis entirely (hue
 *     strobes); the upper caps (200 hops ≈ 2.3 s, 400 hops ≈ 4.6 s) are the
 *     point past which a change would never land inside a musical phrase.
 * `kind` is 'number' | 'integer' | 'boolean'; `exclusiveMin` makes the low
 * bound open.
 */
export const NOTE_ESTIMATOR_RANGES = Object.freeze({
  minPitchHz: Object.freeze({ kind: 'number', min: 20, max: 20000 }),
  maxPitchHz: Object.freeze({ kind: 'number', min: 20, max: 20000 }),
  preferLow: Object.freeze({ kind: 'boolean' }),
  preferLowEnergyFrac: Object.freeze({ kind: 'number', min: 0, max: 1 }),
  energyGate: Object.freeze({ kind: 'number', min: 0, max: 1 }),
  medianN: Object.freeze({ kind: 'integer', min: 3, max: 51 }),
  minConsensus: Object.freeze({ kind: 'number', min: 0.34, max: 1 }),
  holdHops: Object.freeze({ kind: 'integer', min: 1, max: 200 }),
  nearChangeSemitones: Object.freeze({ kind: 'integer', min: 1, max: 6 }),
  nearHoldHops: Object.freeze({ kind: 'integer', min: 1, max: 400 }),
  kfQ: Object.freeze({ kind: 'number', min: 0, max: 10000, exclusiveMin: true }),
  kfR: Object.freeze({ kind: 'number', min: 0, max: 10000, exclusiveMin: true }),
  stableHops: Object.freeze({ kind: 'integer', min: 1, max: 10000 }),
});

/** Human-readable interval text for an error message. */
function rangeText(spec) {
  return `${spec.exclusiveMin ? '(' : '['}${spec.min}, ${spec.max}]`;
}

/**
 * Validate ONE noteTracking field. Throws TypeError on a wrong type and
 * RangeError on an out-of-range value. `label` prefixes the message so the
 * config validator can report `audio.derivedSignals.noteTracking.<field>`.
 */
export function validateNoteEstimatorField(field, value, label = 'noteTracking') {
  const spec = NOTE_ESTIMATOR_RANGES[field];
  if (!spec) throw new TypeError(`${label} has unknown field "${field}"`);
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`${label}.${field} must be a boolean`);
    }
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label}.${field} must be a finite number`);
  }
  if (spec.kind === 'integer' && !Number.isInteger(value)) {
    throw new RangeError(`${label}.${field} must be an integer in ${rangeText(spec)}`);
  }
  const belowMin = spec.exclusiveMin ? value <= spec.min : value < spec.min;
  if (belowMin || value > spec.max) {
    throw new RangeError(`${label}.${field} must be in ${rangeText(spec)}`);
  }
}

/**
 * Cross-field invariants. Exported so the operator-facing validator enforces
 * exactly the same ones the estimator relies on.
 *   - minPitchHz < maxPitchHz: an empty or inverted pitch band accepts nothing.
 *   - nearHoldHops >= holdHops: `nearHoldHops` is the EXTRA evidence demanded
 *     of a small (≤ nearChangeSemitones) move, which is the ambiguous case.
 *     Making it cheaper than a far move inverts the whole design.
 */
export function requireNoteEstimatorOrdering(values, label = 'noteTracking') {
  if (values.minPitchHz >= values.maxPitchHz) {
    throw new RangeError(`${label} requires minPitchHz < maxPitchHz`);
  }
  if (values.nearHoldHops < values.holdHops) {
    throw new RangeError(`${label} requires nearHoldHops >= holdHops`);
  }
}

/**
 * Validate a COMPLETE noteTracking configuration: every key of
 * NOTE_ESTIMATOR_DEFAULTS present, no unknown keys, every value in range, and
 * the cross-field ordering satisfied. No defaults are filled in (codex P0 — a
 * missing key is a caller bug, not something to paper over).
 */
export function validateNoteEstimatorConfig(config, label = 'noteTracking') {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError(`${label} requires a complete config object`);
  }
  for (const field of Object.keys(config)) {
    if (!(field in NOTE_ESTIMATOR_DEFAULTS)) {
      throw new TypeError(`${label} has unknown field "${field}"`);
    }
  }
  for (const field of Object.keys(NOTE_ESTIMATOR_DEFAULTS)) {
    if (!(field in config)) {
      throw new TypeError(`${label} requires "${field}"`);
    }
    validateNoteEstimatorField(field, config[field], label);
  }
  requireNoteEstimatorOrdering(config, label);
  return config;
}

function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

export class NoteEstimator {
  /**
   * @param {object} config COMPLETE noteTracking config — every key of
   *   NOTE_ESTIMATOR_DEFAULTS, in range. There is NO default and NO
   *   spread-over-defaults: the old `{...DEFAULTS, ...opts}` form let a caller
   *   that forgot the shipped config.yaml values run a *different* estimator
   *   than production while every test still passed (the same failure mode the
   *   DerivedSignals bpmTracker contract exists to prevent). Build it with
   *   buildDerivedSignalsOptions(audioConfig).noteTracking.
   */
  constructor(config) {
    validateNoteEstimatorConfig(config, 'NoteEstimator config');
    this.p = { ...config };
    this._medBuf = new Int32Array(this.p.medianN);
    // Pitch-class histogram for _medianPc(). Allocated ONCE here — the hot path
    // must not allocate (86 hops/s).
    this._pcCounts = new Int32Array(12);
    this.reset();
  }

  reset() {
    this._medBuf.fill(-1);
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
    if (medPc < 0) {
      // An ambiguous window is weak contrary evidence, not a new note. Decay
      // the pending change rather than handing a noisy plurality the colour.
      this._candHeld = Math.max(0, this._candHeld - 1);
    } else if (medPc === this._committedPc) {
      // Strong evidence for the currently displayed note cancels a pending
      // change immediately. This is the hysteresis that prevents hue flicker.
      this._candPc = medPc;
      this._candHeld = 0;
    } else if (medPc === this._candPc) {
      this._candHeld++;
    } else {
      this._candPc = medPc; this._candHeld = 1;
    }
    // The window trails the live dominant-frequency track. Requiring the
    // current raw class to agree prevents committing a stale intermediate
    // semitone after the analyzer has already reached the destination note.
    const pcDelta = this._committedPc < 0
      ? 12
      : Math.min(
        Math.abs(this._candPc - this._committedPc),
        12 - Math.abs(this._candPc - this._committedPc),
      );
    const requiredHold = pcDelta <= p.nearChangeSemitones ? p.nearHoldHops : p.holdHops;
    if (this._candHeld >= requiredHold && rawPc === this._candPc
        && this._candPc !== this._committedPc) {
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
   *
   * CONSENSUS IS SCORED OVER THE FULL WINDOW (`medianN`), not over how much of
   * it has been filled. Dividing by `_medFilled` made a one-sample window score
   * consensus 1.0, so a fresh estimator committed a note off a SINGLE noisy hop
   * (measured: first commit at hop 10 = 116 ms, from one sample of evidence).
   * With `medianN` as the denominator the window must actually hold
   * ceil(medianN * minConsensus) agreeing hops before anything can be
   * committed — warmup is now genuinely evidence-gated (first commit at hop 19
   * = 221 ms for the shipped config). Once the ring is full the two
   * denominators are identical, so steady-state behaviour is unchanged.
   *
   * `_medBuf` slots 0.._medFilled-1 are always written with a valid 0..11
   * pitch class before this runs, so there is no "empty window" case to guard.
   */
  _medianPc() {
    const counts = this._pcCounts;
    counts.fill(0);
    for (let i = 0; i < this._medFilled; i++) counts[this._medBuf[i]]++;
    let best = 0;
    for (let pc = 1; pc < 12; pc++) {
      if (counts[pc] > counts[best]) best = pc;
    }
    // Tie-break toward the current colour, then the pending candidate. This
    // avoids the old implicit C bias when two pitch classes had equal votes.
    if (this._committedPc >= 0 && counts[this._committedPc] === counts[best]) {
      best = this._committedPc;
    } else if (this._candPc >= 0 && counts[this._candPc] === counts[best]) {
      best = this._candPc;
    }
    return counts[best] / this.p.medianN >= this.p.minConsensus ? best : -1;
  }
}

export default NoteEstimator;
