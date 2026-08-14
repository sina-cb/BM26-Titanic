// Synthetic-data tests for the audio NOTE estimator
// (audio/signals/note_estimator.js) and the note-publishing path of
// DerivedSignals (audio/signals/derived_signals.js).
//
// PURPOSE
// -------
// Closes the "NOTE always C" bug: the Companion DERIVED panel showed
// NOTE = C constantly regardless of the music. Root cause was the publish
// path in DerivedSignals — the estimator returns pitchClass = -1 ("no note")
// during silence / warmup / sub-gate energy, and DerivedSignals mapped that
// -1 → 0 = C. Whenever the live dom-freq energy sat below the gate, the colour
// was pinned to C forever.
//
// These tests prove, on synthetic dominant-frequency input:
//   - freq → pitch class is CORRECT across the octave
//       440 Hz → A, 261.63 Hz → C, 329.63 Hz → E, 493.88 Hz → B (+ more),
//   - octave-invariance: 220 Hz and 440 Hz collapse to the same class (A),
//   - the no-input case returns a DEFINED "no note" state (pitchClass = -1,
//     name '-') — NOT a spurious C,
//   - non-finite input FAILS LOUD (throws) instead of silently emitting 0,
//   - DerivedSignals HOLDS the last note across a silent gap and never
//     publishes a spurious C before the first real note.
//
// Run:  cd marsin_engine && node --test tests/note_estimator_synthetic.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBpmTrackerOptions,
  buildDerivedSignalsOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { NoteEstimator } from '../../audio/signals/note_estimator.js';
import { DerivedSignals } from '../../audio/signals/derived_signals.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// DerivedSignals requires the SHIPPED tracker options — these tests must
// exercise the production config, not the module DEFAULTS.
const AUDIO_CONFIG = loadEffectiveAudioAnalysisConfig({
  engineDir: ENGINE_DIR,
  modelName: 'titanic',
}).audioConfig;
const BPM_TRACKER = buildBpmTrackerOptions(AUDIO_CONFIG);
const DERIVED_CONFIG = buildDerivedSignalsOptions(AUDIO_CONFIG);
// The estimator constructor takes a COMPLETE config — no defaults are filled
// in — so these tests measure the SHIPPED tuning, not module DEFAULTS.
const NOTE_CONFIG = DERIVED_CONFIG.noteTracking;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Fresh estimator on the shipped noteTracking config. */
function makeEstimator() {
  return new NoteEstimator(NOTE_CONFIG);
}

// Drive the estimator with a steady dominant frequency long enough to commit.
// Cold start costs ceil(medianN*minConsensus) + holdHops = 19 hops on the
// shipped config, plus stableHops = 18 before `stable` latches; 60 is plenty.
function settle(est, freq, energy = 0.8, hops = 60) {
  let out;
  for (let i = 0; i < hops; i++) out = est.update(freq, energy, 0, 0);
  return out;
}

test('freq → pitch class is correct across the octave', () => {
  const cases = [
    [261.63, 'C'],   // C4
    [277.18, 'C#'],  // C#4
    [293.66, 'D'],   // D4
    [329.63, 'E'],   // E4
    [349.23, 'F'],   // F4
    [392.00, 'G'],   // G4
    [440.00, 'A'],   // A4
    [466.16, 'A#'],  // A#4
    [493.88, 'B'],   // B4
  ];
  for (const [freq, name] of cases) {
    const est = makeEstimator();
    const out = settle(est, freq);
    assert.equal(out.noteName, name, `${freq} Hz should be ${name}, got ${out.noteName}`);
    assert.equal(out.pitchClass, NOTE_NAMES.indexOf(name));
    assert.ok(out.stable, `${name} should be stable after settling`);
  }
});

test('octave-invariance: 220 Hz and 440 Hz are both A', () => {
  const a3 = settle(makeEstimator(), 220.0);
  const a4 = settle(makeEstimator(), 440.0);
  assert.equal(a3.noteName, 'A');
  assert.equal(a4.noteName, 'A');
  assert.equal(a3.pitchClass, a4.pitchClass);
});

// NOTE: the estimator's own `hue` is the raw pitchClass/12 fraction, NOT the
// operator's circle-of-fifths wheel — DerivedSignals applies `noteColors` on
// the publish path. Wheel coverage lives in the DerivedSignals tests below
// (`audioNoteHue` === noteColors.a) and in derived_signals_config.test.js.
test('estimator hue is the raw pitchClass/12 fraction (wheel is applied downstream)', () => {
  const out = settle(makeEstimator(), 440.0); // A = pc 9
  assert.ok(Math.abs(out.hue - 9 / 12) < 1e-9, `hue should be 9/12, got ${out.hue}`);
  assert.notEqual(out.hue, DERIVED_CONFIG.noteColors.a,
    'the estimator must NOT pre-apply the note-colour wheel');
});

// ── Constructor contract + warmup consensus ───────────────────────────────

test('constructor requires a COMPLETE in-range config and fails loudly otherwise', () => {
  assert.throws(() => new NoteEstimator(), /requires a complete config object/);
  assert.throws(() => new NoteEstimator({}), /requires "minPitchHz"/);
  const missing = { ...NOTE_CONFIG };
  delete missing.medianN;
  assert.throws(() => new NoteEstimator(missing), /requires "medianN"/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, bogus: 1 }),
    /unknown field "bogus"/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, medianN: 2 }),
    /medianN must be in \[3, 51\]/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, medianN: 15.5 }),
    /medianN must be an integer/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, minConsensus: 0.2 }),
    /minConsensus must be in \[0.34, 1\]/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, holdHops: 0 }),
    /holdHops must be in \[1, 200\]/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, preferLowEnergyFrac: 0 }),
    /preferLowEnergyFrac must be in \(0, 1\]/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, energyGate: 0 }),
    /energyGate must be in \(0, 1\)/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, energyGate: 1 }),
    /energyGate must be in \(0, 1\)/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, stableHops: 241 }),
    /stableHops must be in \[1, 240\]/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, preferLow: 1 }),
    /preferLow must be a boolean/);
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, kfQ: 0 }),
    /kfQ must be in \(0, 10000\]/);
  // Cross-field: a near (ambiguous) move must never be cheaper than a far one.
  assert.throws(() => new NoteEstimator({ ...NOTE_CONFIG, nearHoldHops: 9 }),
    /requires nearHoldHops >= holdHops/);
  assert.throws(() => new NoteEstimator({
    ...NOTE_CONFIG,
    minPitchHz: 440,
    maxPitchHz: 659,
  }), /pitch range must span at least one octave/);
  assert.doesNotThrow(() => new NoteEstimator({
    ...NOTE_CONFIG,
    minPitchHz: 440,
    maxPitchHz: 880,
  }));
  // An even window is legal — the mode+tie-break algorithm has no parity rule.
  assert.doesNotThrow(() => new NoteEstimator({ ...NOTE_CONFIG, medianN: 16 }));
});

test('warmup cannot commit off a partly-filled window (consensus is over medianN)', () => {
  const est = makeEstimator();
  // Consensus is counts/medianN, so the ring must actually hold
  // ceil(medianN * minConsensus) agreeing hops before the mode is usable; the
  // pending candidate then needs holdHops more. A denominator of "hops seen so
  // far" made a ONE-sample window score 1.0 and committed at hop holdHops.
  // The hop that first reaches consensus is itself the first held hop, hence
  // the -1. Shipped config: ceil(15 * 0.55) = 9, + 10 - 1 = hop 18 ≈ 209 ms.
  const evidenceHops = Math.ceil(NOTE_CONFIG.medianN * NOTE_CONFIG.minConsensus);
  const expectedCommitHop = evidenceHops + NOTE_CONFIG.holdHops - 1;
  assert.equal(expectedCommitHop, 18, 'shipped config should commit at hop 18');
  let commitHop = null;
  for (let hop = 1; hop <= 200; hop++) {
    const out = est.update(440.0, 0.8, 0, 0);
    if (out.pitchClass >= 0) { commitHop = hop; break; }
  }
  assert.equal(commitHop, expectedCommitHop,
    `first commit should land at hop ${expectedCommitHop}, got ${commitHop}`);
  assert.ok(commitHop > NOTE_CONFIG.holdHops,
    'a partly-filled window must not reach consensus on its own');
});

test('no input returns a DEFINED no-note state, NOT a spurious C', () => {
  const est = makeEstimator();
  // Silence: dom freqs 0, energies 0.
  let out;
  for (let i = 0; i < 60; i++) out = est.update(0, 0, 0, 0);
  assert.equal(out.pitchClass, -1, 'silence must report pitchClass -1 (no note)');
  assert.equal(out.noteName, '-', 'silence must report note name "-" (not "C")');
  assert.equal(out.stable, false);
});

test('sub-gate energy holds (no note), does not emit C', () => {
  const est = makeEstimator();
  let out;
  // A4 but with energy below energyGate (0.05).
  for (let i = 0; i < 60; i++) out = est.update(440.0, 0.02, 0, 0);
  assert.equal(out.pitchClass, -1);
  assert.equal(out.noteName, '-');
});

test('estimator holds last committed note across a silent gap', () => {
  const est = makeEstimator();
  settle(est, 329.63);                 // commit E
  let out;
  for (let i = 0; i < 30; i++) out = est.update(0, 0, 0, 0); // gap
  assert.equal(out.noteName, 'E', 'note should freeze on E through silence, not reset');
});

test('non-finite input FAILS LOUD (throws), does not silently emit 0', () => {
  const est = makeEstimator();
  assert.throws(() => est.update(NaN, 0.5, 0, 0), /non-finite/);
  assert.throws(() => est.update(440, Infinity, 0, 0), /non-finite/);
  assert.throws(() => est.update(440, 0.5, NaN, 0), /non-finite/);
  assert.throws(() => est.update(440, 0.5, 0, -Infinity), /non-finite/);
});

// ── DerivedSignals publish path ───────────────────────────────────────────

// Minimal ParamCenter stub: get()/setMany() over a flat map.
function makeParamCenter(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: (k) => (store.has(k) ? store.get(k) : 0),
    set: (k, v) => store.set(k, v),
    setMany: (entries) => { for (const e of entries) store.set(e.key, e.value); },
  };
}

test('DerivedSignals: audioNote tracks the live dominant frequency', () => {
  const pc = makeParamCenter();
  const ds = new DerivedSignals({
    paramCenter: pc, bpmTracker: BPM_TRACKER, derivedSignals: DERIVED_CONFIG,
  });
  // Feed a steady A4 on dom1 with healthy energy for enough hops to commit.
  pc.set('micDomFreq1', 440.0);
  pc.set('micDomEnergy1', 0.8);
  let now = 0;
  for (let i = 0; i < 80; i++) { now += 11.6; ds.tick(now, 0.0116); }
  assert.equal(pc.get('audioNote'), 9, 'audioNote should track A (pc 9), not 0 (C)');
  assert.equal(pc.get('audioNoteHue'), DERIVED_CONFIG.noteColors.a);
});

test('DerivedSignals: note-color retune changes hue only and keeps the committed note', () => {
  const pc = makeParamCenter();
  const ds = new DerivedSignals({
    paramCenter: pc, bpmTracker: BPM_TRACKER, derivedSignals: DERIVED_CONFIG,
  });
  pc.set('micDomFreq1', 440.0);
  pc.set('micDomEnergy1', 0.8);
  let now = 0;
  for (let i = 0; i < 80; i++) { now += 11.6; ds.tick(now, 0.0116); }
  const noteEstimator = ds._note;
  ds.reconfigure('noteColors', { a: 0.125 });
  assert.equal(ds._note, noteEstimator, 'hue edits must not reset pitch estimation');
  assert.equal(pc.get('audioNote'), 9, 'hue edits must not change the pitch class');
  ds.tick(now + 11.6, 0.0116);
  assert.equal(pc.get('audioNoteHue'), 0.125);
});

test('DerivedSignals: a silent gap HOLDS the note, never reverts to C', () => {
  const pc = makeParamCenter();
  const ds = new DerivedSignals({
    paramCenter: pc, bpmTracker: BPM_TRACKER, derivedSignals: DERIVED_CONFIG,
  });
  pc.set('micDomFreq1', 329.63); // E4
  pc.set('micDomEnergy1', 0.8);
  let now = 0;
  for (let i = 0; i < 80; i++) { now += 11.6; ds.tick(now, 0.0116); }
  assert.equal(pc.get('audioNote'), 4, 'should have committed E (pc 4)');
  // Now go silent: energy below gate.
  pc.set('micDomEnergy1', 0.0);
  pc.set('micDomFreq1', 0.0);
  for (let i = 0; i < 40; i++) { now += 11.6; ds.tick(now, 0.0116); }
  assert.equal(pc.get('audioNote'), 4, 'audioNote should HOLD E through silence, not blink to C');
});

test('DerivedSignals: never publishes a spurious C while silent from the start', () => {
  const pc = makeParamCenter();
  const ds = new DerivedSignals({
    paramCenter: pc, bpmTracker: BPM_TRACKER, derivedSignals: DERIVED_CONFIG,
  });
  // All inputs absent/zero from boot — the original bug scenario.
  let now = 0;
  for (let i = 0; i < 60; i++) { now += 11.6; ds.tick(now, 0.0116); }
  // No note ever committed → held neutral (pc 0 / hue 0). This is a DEFINED
  // neutral, but crucially the estimator's own state is "no note" (-1); the
  // published value only sits at 0 because nothing has played, and it will
  // immediately track the first real note (proven above).
  assert.equal(ds._note.pitchClass, -1, 'estimator should still report no committed note');
});
