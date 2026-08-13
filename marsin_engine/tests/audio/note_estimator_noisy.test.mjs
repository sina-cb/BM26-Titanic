// Noisy-corpus tests for the NOTE estimator: how well does the shipped
// note/colour tracker actually do on synthetic music pushed through the
// virtual playa microphone?
//
// WHAT "18 dB SNR" MEANS HERE. `applyMicModel` scales the SIGNAL until the
// BROADBAND post-chain signal-to-noise ratio equals the tier target, then
// reports what it realized. The reported number is therefore tautologically
// equal to the target (18.00 dB every time) — it is a *pre-analyzer input
// spec*, NOT an independent measurement of what the estimator saw. The
// IN-BAND SNR the note estimator works with is different and unmeasured: the
// noise bed is PINK (energy weighted to the lows) while the corpus tones sit
// at MIDI 48-59 (~131-247 Hz), so the SNR inside the analysis band is worse
// than 18 dB near the bass roots and better up top. Read the labels below as
// "the mic model was configured for 18 dB broadband", nothing more.
//
// SEEDS. The checked-in set is 1..12 — deterministic, so a green run here is
// a genuine regression gate rather than a lucky draw. Override with
// BM26_NOTE_SEEDS=1,2,...  to sweep a wider set locally; every aggregate
// assertion below is a FRACTION or a MEAN so a larger set stays meaningful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  buildDerivedSignalsOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { NoteEstimator } from '../../audio/signals/note_estimator.js';
import { SYNTHS } from '../../audio/synth/test_synths.js';
import { applyMicModel } from '../integration/mic_model.mjs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIO_CONFIG = loadEffectiveAudioAnalysisConfig({
  engineDir: ENGINE_DIR,
  modelName: 'titanic',
}).audioConfig;
const NOTE_CONFIG = buildDerivedSignalsOptions(AUDIO_CONFIG).noteTracking;
const SAMPLE_RATE = AUDIO_CONFIG.capture.sampleRate;
const HOP_SIZE = AUDIO_CONFIG.hopSize;
const HOP_MS = HOP_SIZE / SAMPLE_RATE * 1000;
const BPM = 124;
const HOUSE_PCS = [9, 5, 0, 7]; // A, F, C, G from chord_progression

/** Checked-in seed set; BM26_NOTE_SEEDS=1,2,3 overrides it for local sweeps. */
function noteSeeds() {
  const raw = process.env.BM26_NOTE_SEEDS;
  if (!raw) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const seeds = raw.split(',').map((part) => Number(part.trim()));
  if (!seeds.length || seeds.some((seed) => !Number.isInteger(seed))) {
    throw new RangeError(`BM26_NOTE_SEEDS must be a comma-separated integer list (got "${raw}")`);
  }
  return seeds;
}

function renderSamples(durationSec, sampleFn) {
  const samples = new Int16Array(Math.round(durationSec * SAMPLE_RATE));
  for (let n = 0; n < samples.length; n++) {
    const value = Math.max(-1, Math.min(1, sampleFn(n)));
    samples[n] = Math.round(value * 24000);
  }
  return samples;
}

function pitchSample(pc, n) {
  const midi = 48 + pc;
  const hz = 440 * 2 ** ((midi - 69) / 12);
  const t = n / SAMPLE_RATE;
  const attack = Math.min(1, n / Math.round(SAMPLE_RATE * 0.012));
  return attack * (
    0.72 * Math.sin(2 * Math.PI * hz * t)
    + 0.20 * Math.sin(2 * Math.PI * hz * 2 * t)
    + 0.08 * Math.sin(2 * Math.PI * hz * 3 * t)
  );
}

function analyzeNoisy(samples, seed) {
  const degraded = applyMicModel(samples, SAMPLE_RATE, { tier: 'moderate', seed });
  const estimator = new NoteEstimator(NOTE_CONFIG);
  const rows = [];
  let hop = 0;
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(AUDIO_CONFIG, {
    nowFn: () => hop * HOP_MS,
    onAnalysis: (analysis) => {
      const note = estimator.update(
        analysis.domFreq1,
        analysis.domEnergy1,
        analysis.domFreq2,
        analysis.domEnergy2,
      );
      rows.push({ tMs: hop * HOP_MS, pc: note.pitchClass, stable: note.stable });
      hop++;
    },
  }));
  for (let i = 0; i < degraded.samples.length; i += HOP_SIZE) {
    analyzer.pushSamples(degraded.samples.subarray(i, i + HOP_SIZE));
  }
  // `meta.measuredSnrDb` is the realized BROADBAND pre-analyzer SNR. The mic
  // model solves for it, so it always equals the tier target — see the header.
  return { rows, broadbandSnrDb: degraded.meta.measuredSnrDb };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

// The settle window excluded from `steadyAccuracyPct`. It is 57% of a 968 ms
// chord, which is why this file ALSO reports full-chord accuracy: quoting only
// the windowed number would hide the commit latency the window exists to skip.
const SETTLE_MS = 550;

function scoreHouseProgression(seed) {
  const beatsPerChord = 2;
  const chordMs = (60 / BPM) * beatsPerChord * 1000;
  const leadChords = 4;
  const scoredChords = 16;
  const durationSec = chordMs * (leadChords + scoredChords) / 1000;
  const samples = renderSamples(durationSec, (n) => SYNTHS.chord_progression.sample(
    n,
    SAMPLE_RATE,
    { bpm: BPM, chordBeats: beatsPerChord, level: 0.85 },
  ));
  const { rows, broadbandSnrDb } = analyzeNoisy(samples, seed);
  const leadMs = leadChords * chordMs;
  const latencies = [];
  let correctHops = 0;
  let scoredHops = 0;
  let fullCorrectHops = 0;
  let fullHops = 0;
  let detectedTransitions = 0;
  const observed = [];
  let previousPc = null;

  for (const row of rows) {
    if (row.tMs < leadMs || row.pc < 0) continue;
    if (previousPc !== null && row.pc !== previousPc) observed.push(row.pc);
    previousPc = row.pc;
  }

  for (let index = 0; index < scoredChords; index++) {
    const startMs = leadMs + index * chordMs;
    const endMs = startMs + chordMs;
    const targetPc = HOUSE_PCS[(leadChords + index) % HOUSE_PCS.length];
    const segment = rows.filter((row) => row.tMs >= startMs && row.tMs < endMs);
    const scoredStartMs = startMs + SETTLE_MS;
    for (const row of segment) {
      // FULL chord: every hop counts, including the ones still showing the
      // previous chord while the estimator confirms the change.
      fullHops++;
      if (row.pc === targetPc) fullCorrectHops++;
      if (row.tMs < scoredStartMs) continue;
      scoredHops++;
      if (row.pc === targetPc) correctHops++;
    }
    if (index === 0) continue;
    const hit = segment.find((row) => row.pc === targetPc);
    if (hit) {
      detectedTransitions++;
      latencies.push(hit.tMs - startMs);
    }
  }

  const expectedObserved = [];
  // The lead-in ends on G and the scored progression begins on A, so the
  // transition into scored chord zero is itself an expected joined change.
  for (let index = 0; index < scoredChords; index++) {
    expectedObserved.push(HOUSE_PCS[(leadChords + index) % HOUSE_PCS.length]);
  }
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  return {
    seed,
    broadbandSnrDb,
    steadyAccuracyPct: 100 * correctHops / scoredHops,
    fullChordAccuracyPct: 100 * fullCorrectHops / fullHops,
    transitionRecallPct: 100 * detectedTransitions / (scoredChords - 1),
    transitionSequenceCorrect: observed.length === expectedObserved.length
      && observed.every((pc, index) => pc === expectedObserved[index]),
    // Committed pitch-class changes BEYOND the 16 the progression actually
    // plays: each one is a visible spurious hue flip.
    spuriousTransitions: Math.max(0, observed.length - expectedObserved.length),
    latencyP50Ms: percentile(sortedLatencies, 0.5),
    latencyP95Ms: percentile(sortedLatencies, 0.95),
  };
}

test('all 12 isolated notes are recognized through deterministic 18 dB SNR noise', () => {
  const noiseSeeds = [1, 2, 3];
  let correctHops = 0;
  let scoredHops = 0;
  let finalCorrect = 0;
  const cases = [];
  for (const seed of noiseSeeds) {
    for (let pc = 0; pc < 12; pc++) {
      const samples = renderSamples(2.5, (n) => pitchSample(pc, n));
      const { rows, broadbandSnrDb } = analyzeNoisy(samples, seed);
      const scored = rows.filter((row) => row.tMs >= 1200);
      const correct = scored.filter((row) => row.pc === pc).length;
      correctHops += correct;
      scoredHops += scored.length;
      const final = rows.at(-1);
      if (final && final.pc === pc && final.stable) finalCorrect++;
      cases.push({ seed, pc, broadbandSnrDb, accuracyPct: 100 * correct / scored.length });
    }
  }
  const accuracyPct = 100 * correctHops / scoredHops;
  // 36 CASES, 3 INDEPENDENT NOISE DRAWS. All 12 clips are the same length, so
  // for a given seed the mic model's PRNG stream produces the identical noise
  // bed for every pitch class — the 12 pitch classes are 12 different SIGNALS
  // through ONE noise realization, not 12 independent trials. Only the 3 seeds
  // are independent draws. Treat the case count as coverage of the pitch-class
  // axis, never as a sample size for a statistical claim about noise.
  console.log('[note-noise] isolated', JSON.stringify({
    cases: cases.length,
    pitchClasses: 12,
    independentNoiseDraws: noiseSeeds.length,
    finalCorrect,
    accuracyPct: Number(accuracyPct.toFixed(2)),
    // Broadband PRE-ANALYZER target the mic model solved for, not a measured
    // in-band SNR at the estimator's input. See the file header.
    broadbandSnrDb: Number(cases[0].broadbandSnrDb.toFixed(2)),
  }));
  assert.equal(finalCorrect, cases.length, 'every noisy isolated note must finish correct + stable');
  assert.ok(accuracyPct >= 98, `noisy isolated accuracy ${accuracyPct.toFixed(2)}% < 98%`);
});

// MEASURED DISTRIBUTION — 32 seeds (checked-in 1-12 plus 13-32 swept locally),
// `moderate` tier, shipped config.yaml noteTracking. This is the evidence the
// thresholds below are set from; re-measure before moving any of them.
//
//                        seeds 1-12        seeds 13-32       all 32
//   steady accuracy %    88.9 min / 93.7   90.6 min / 93.9   88.9 min / 93.8
//   full-chord accuracy  46.7 min / 51.9   44.2 min / 50.3   44.2 min / 50.9
//   transition recall %  93.3 min / 99.4   100  min / 100    93.3 min / 99.8
//   clean sequence       10 / 12           19 / 20           29 / 32 (90.6%)
//   spurious flips/run   max 1 (seed 6)    max 1 (seed 25)   2 runs of 1
//   p95 latency ms       856 worst         884 worst         884 worst
//
// The three imperfect seeds are: 6 and 25 (one spurious extra flip each) and
// 11 (one chord change never committed). Per-seed PERFECTION IS NOT A PROPERTY
// OF THIS DETECTOR at 18 dB — the previous version of this test asserted
// recall === 100 and a perfect ordered sequence on every seed, which only
// passed because the checked-in set happened to be 1-5. Every threshold here
// is therefore a floor with margin over the worst observed run, plus aggregate
// floors expressed as fractions/means so a BM26_NOTE_SEEDS sweep stays
// meaningful. A regression that makes the tail worse WILL trip these.
//
// FULL-CHORD accuracy is reported and asserted alongside the settled-window
// number precisely because it is the unflattering one: ~50% is close to the
// ceiling that commit latency imposes (a p50 of ~450 ms into a 968 ms chord
// caps the achievable full-chord score near 53%), so a big drop here means the
// detector got slower, which the windowed number would happily hide.
test('joined noisy house chords track the progression within the measured envelope', () => {
  const runs = noteSeeds().map(scoreHouseProgression);
  const mean = (pick) => runs.reduce((sum, run) => sum + pick(run), 0) / runs.length;
  const meanSteady = mean((run) => run.steadyAccuracyPct);
  const meanFullChord = mean((run) => run.fullChordAccuracyPct);
  const meanRecall = mean((run) => run.transitionRecallPct);
  const meanSpurious = mean((run) => run.spuriousTransitions);
  const cleanSequences = runs.filter((run) => run.transitionSequenceCorrect).length;
  const cleanSequenceFrac = cleanSequences / runs.length;
  const worstP95 = Math.max(...runs.map((run) => run.latencyP95Ms));
  console.log('[note-noise] joined-house', JSON.stringify({
    seeds: runs.map((run) => run.seed),
    meanSteadyAccuracyPct: Number(meanSteady.toFixed(2)),
    meanFullChordAccuracyPct: Number(meanFullChord.toFixed(2)),
    meanTransitionRecallPct: Number(meanRecall.toFixed(2)),
    cleanSequences: `${cleanSequences}/${runs.length}`,
    meanSpuriousTransitions: Number(meanSpurious.toFixed(3)),
    worstP95LatencyMs: Number(worstP95.toFixed(1)),
    runs,
  }));

  // ── Per-run floors (worst observed over 32 seeds in parentheses) ─────────
  for (const run of runs) {
    assert.ok(run.steadyAccuracyPct >= 85,                       // worst 88.87
      `seed ${run.seed} steady accuracy ${run.steadyAccuracyPct.toFixed(2)}% < 85%`);
    assert.ok(run.fullChordAccuracyPct >= 40,                    // worst 44.19
      `seed ${run.seed} full-chord accuracy ${run.fullChordAccuracyPct.toFixed(2)}% < 40%`);
    // 15 scored transitions per run → one miss costs 6.67 points. Worst
    // observed was one miss (93.33%); this floor allows two.
    assert.ok(run.transitionRecallPct >= 86.6,
      `seed ${run.seed} transition recall ${run.transitionRecallPct.toFixed(2)}% < 86.6%`);
    // HARD CAP on visible hue glitches: at most one spurious committed flip in
    // a 19 s clip. Worst observed = 1, on 2 of 32 seeds.
    assert.ok(run.spuriousTransitions <= 1,
      `seed ${run.seed} emitted ${run.spuriousTransitions} spurious transitions (cap 1)`);
    assert.ok(run.latencyP95Ms <= 950,                           // worst 883.5
      `seed ${run.seed} p95 transition latency ${run.latencyP95Ms.toFixed(1)} ms > 950 ms`);
  }

  // ── Aggregate floors (fractions/means: valid for any seed set) ───────────
  assert.ok(cleanSequenceFrac >= 0.75,                           // 10/12, 29/32
    `only ${cleanSequences}/${runs.length} seeds produced a perfectly ordered `
    + 'committed transition sequence (floor 75%)');
  assert.ok(meanSteady >= 90,                                    // 93.65 / 93.90
    `mean steady accuracy ${meanSteady.toFixed(2)}% < 90%`);
  assert.ok(meanFullChord >= 45,                                 // 51.90 / 50.31
    `mean full-chord accuracy ${meanFullChord.toFixed(2)}% < 45%`);
  assert.ok(meanRecall >= 97,                                    // 99.44 / 100
    `mean transition recall ${meanRecall.toFixed(2)}% < 97%`);
  assert.ok(meanSpurious <= 0.25,                                // 0.083 / 0.050
    `mean spurious transitions ${meanSpurious.toFixed(3)} > 0.25 per run`);
});
