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
// SEEDS. The checked-in gate uses a predetermined 24-seed holdout: the first
// 24 primes above 100. Those seeds were fixed before their outputs were
// measured; thresholds are aggregate/quantile policy, never floors chosen from
// the worst explored run. This makes a green run regression evidence rather
// than a lucky draw or an overfit per-seed allowlist.
//
// ░░ HERMETIC BY CONSTRUCTION — DO NOT REINTRODUCE THE SCENE OVERLAY ░░
// This file used to build its analyzer from
// `loadEffectiveAudioAnalysisConfig({modelName:'titanic'})`, which merges
// `states/titanic/audio_state.yaml` OVER config.yaml. That is exactly right for
// the SHOW and exactly wrong for a GATE: `bands.inputGain` is a knob the
// operator turns live, and the whole holdout moves with it. Measured on one box
// on 2026-08-14, same code, same 24 seeds, only the effective gain differing:
//
//   gain 1     (tracked config.yaml, no overlay) → 93.43% settled, 18/24 clean
//   gain 1.48  (states/titanic at HEAD)          → 94.07% settled, 18/24 clean
//   gain 9.1   (operator's live working tree)    → 98.27% settled, 22/24 clean
//
// A gate a gain knob can lift five points is not a gate — a real tracker
// regression would hide behind a louder mic — and the figures published in
// docs/AUDIO_SIGNALS.md and config.yaml would be unreproducible on any other
// machine. So the corpus is scored against the TRACKED config.yaml audio block
// ONLY. Those published figures are locked to this file's policy by
// tests/audio/note_evidence_docs_parity.test.mjs.

import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  buildDerivedSignalsOptions,
  validateAudioAnalysisConfig,
} from '../../audio/config/audio_analysis_config.js';
import { mergeAudioConfig } from '../../audio/config/audio_config.js';
import { NoteEstimator } from '../../audio/signals/note_estimator.js';
import { SYNTHS } from '../../audio/synth/test_synths.js';
import { applyMicModel } from '../integration/mic_model.mjs';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_CONFIG = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8'));
const AUDIO_CONFIG = validateAudioAnalysisConfig(mergeAudioConfig(ROOT_CONFIG.audio));
const NOTE_CONFIG = buildDerivedSignalsOptions(AUDIO_CONFIG).noteTracking;
const SAMPLE_RATE = AUDIO_CONFIG.capture.sampleRate;
const HOP_SIZE = AUDIO_CONFIG.hopSize;
const HOP_MS = HOP_SIZE / SAMPLE_RATE * 1000;
const BPM = 124;
const HOUSE_PCS = [9, 5, 0, 7]; // A, F, C, G from chord_progression
const HOLDOUT_SEEDS = Object.freeze([
  101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157,
  163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227,
]);
const HEAVY_EVIDENCE_SEEDS = Object.freeze([1, 2, 3, 4]);
const HOLDOUT_POLICY = Object.freeze({
  meanSteadyAccuracyPct: 90,
  p10SteadyAccuracyPct: 85,
  meanFullChordAccuracyPct: 45,
  p10FullChordAccuracyPct: 40,
  meanTransitionRecallPct: 97,
  p10TransitionRecallPct: 86.6,
  cleanSequenceFraction: 0.75,
  meanSpuriousTransitions: 0.25,
  p90SpuriousTransitions: 1,
  p90LatencyP95Ms: 950,
});

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

function analyzeNoisy(samples, seed, tier) {
  const degraded = applyMicModel(samples, SAMPLE_RATE, { tier, seed });
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

/**
 * Count observed pitch classes that cannot be matched to the expected
 * progression. A substitution and an insertion each expose one wrong hue;
 * deleting a missed expected root exposes no extra hue. Minimizing edit cost
 * prevents a wrong substitution from being hidden by an unrelated miss.
 */
function countSpuriousObserved(expected, observed) {
  const rows = expected.length + 1;
  const cols = observed.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols));
  dp[0][0] = { edits: 0, spurious: 0 };
  for (let i = 1; i < rows; i++) dp[i][0] = { edits: i, spurious: 0 };
  for (let j = 1; j < cols; j++) dp[0][j] = { edits: j, spurious: j };
  const better = (a, b) => (a.edits < b.edits ||
    (a.edits === b.edits && a.spurious < b.spurious)) ? a : b;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (expected[i - 1] === observed[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        continue;
      }
      const substitution = {
        edits: dp[i - 1][j - 1].edits + 1,
        spurious: dp[i - 1][j - 1].spurious + 1,
      };
      const deletion = {
        edits: dp[i - 1][j].edits + 1,
        spurious: dp[i - 1][j].spurious,
      };
      const insertion = {
        edits: dp[i][j - 1].edits + 1,
        spurious: dp[i][j - 1].spurious + 1,
      };
      dp[i][j] = better(better(substitution, deletion), insertion);
    }
  }
  return dp[expected.length][observed.length].spurious;
}

// The settle window excluded from `steadyAccuracyPct`. It is 57% of a 968 ms
// chord, which is why this file ALSO reports full-chord accuracy: quoting only
// the windowed number would hide the commit latency the window exists to skip.
const SETTLE_MS = 550;

function scoreHouseProgression(seed, tier = 'moderate') {
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
  const { rows, broadbandSnrDb } = analyzeNoisy(samples, seed, tier);
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
      // FULL chord interval: every hop counts for ROOT accuracy, including
      // the ones still showing the previous root while the estimator confirms
      // the change. This metric does not claim chord-quality detection.
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
    // Every committed observed pitch that sequence alignment cannot match is a
    // visible false hue, even when a different expected transition was missed.
    spuriousTransitions: countSpuriousObserved(expectedObserved, observed),
    latencyP50Ms: percentile(sortedLatencies, 0.5),
    latencyP95Ms: percentile(sortedLatencies, 0.95),
  };
}

test('spurious-transition accounting cannot cancel a false hue with a missed root', () => {
  const expected = [9, 5, 0, 7, 9, 5, 0, 7];
  assert.equal(countSpuriousObserved(expected, [9, 5, 0, 7, 9, 5, 11, 7]), 1,
    'substituting B for C is one visible false hue');
  assert.equal(countSpuriousObserved(expected, [9, 5, 0, 7, 9, 5, 7]), 0,
    'a missed expected root alone is not an extra emitted hue');
  assert.equal(countSpuriousObserved(expected, [9, 5, 0, 7, 9, 5, 11, 0, 7]), 1,
    'an inserted B is one visible false hue');
});

test('all 12 isolated notes are recognized through deterministic 18 dB SNR noise', () => {
  const noiseSeeds = [1, 2, 3];
  let correctHops = 0;
  let scoredHops = 0;
  let finalCorrect = 0;
  const cases = [];
  for (const seed of noiseSeeds) {
    for (let pc = 0; pc < 12; pc++) {
      const samples = renderSamples(2.5, (n) => pitchSample(pc, n));
      const { rows, broadbandSnrDb } = analyzeNoisy(samples, seed, 'moderate');
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

// HOLDOUT POLICY. No seed has its own floor. Means protect overall usefulness;
// p10 catches a degrading lower tail without requiring perfection from every
// stochastic realization; p90 caps visible glitches and latency. The policy
// was fixed before the HOLDOUT_SEEDS outputs were inspected.
//
// FULL-CHORD accuracy is reported and asserted alongside the settled-window
// number precisely because it is the unflattering one: ~50% is close to the
// ceiling that commit latency imposes (a p50 of ~450 ms into a 968 ms chord
// caps the achievable full-chord score near 53%), so a big drop here means the
// detector got slower, which the windowed number would happily hide.
test('joined noisy house chord roots track the progression within the measured envelope', () => {
  const runs = HOLDOUT_SEEDS.map((seed) => scoreHouseProgression(seed));
  const mean = (pick) => runs.reduce((sum, run) => sum + pick(run), 0) / runs.length;
  const meanSteady = mean((run) => run.steadyAccuracyPct);
  const meanFullChord = mean((run) => run.fullChordAccuracyPct);
  const meanRecall = mean((run) => run.transitionRecallPct);
  const meanSpurious = mean((run) => run.spuriousTransitions);
  const cleanSequences = runs.filter((run) => run.transitionSequenceCorrect).length;
  const cleanSequenceFrac = cleanSequences / runs.length;
  const worstP95 = Math.max(...runs.map((run) => run.latencyP95Ms));
  const sortedSteady = runs.map((run) => run.steadyAccuracyPct).sort((a, b) => a - b);
  const sortedFullChord = runs.map((run) => run.fullChordAccuracyPct).sort((a, b) => a - b);
  const sortedRecall = runs.map((run) => run.transitionRecallPct).sort((a, b) => a - b);
  const sortedSpurious = runs.map((run) => run.spuriousTransitions).sort((a, b) => a - b);
  const sortedP95Latency = runs.map((run) => run.latencyP95Ms).sort((a, b) => a - b);
  const p10Steady = percentile(sortedSteady, 0.1);
  const p10FullChord = percentile(sortedFullChord, 0.1);
  const p10Recall = percentile(sortedRecall, 0.1);
  const p90Spurious = percentile(sortedSpurious, 0.9);
  const p90Latency = percentile(sortedP95Latency, 0.9);
  console.log('[note-noise] joined-house-roots', JSON.stringify({
    policy: 'predetermined-prime-holdout-v1',
    seeds: runs.map((run) => run.seed),
    meanSteadyAccuracyPct: Number(meanSteady.toFixed(2)),
    meanFullChordAccuracyPct: Number(meanFullChord.toFixed(2)),
    meanTransitionRecallPct: Number(meanRecall.toFixed(2)),
    cleanSequences: `${cleanSequences}/${runs.length}`,
    meanSpuriousTransitions: Number(meanSpurious.toFixed(3)),
    p10SteadyAccuracyPct: Number(p10Steady.toFixed(2)),
    p10FullChordAccuracyPct: Number(p10FullChord.toFixed(2)),
    p10TransitionRecallPct: Number(p10Recall.toFixed(2)),
    p90SpuriousTransitions: p90Spurious,
    p90LatencyP95Ms: Number(p90Latency.toFixed(1)),
    worstP95LatencyMs: Number(worstP95.toFixed(1)),
    runs,
  }));

  assert.ok(cleanSequenceFrac >= HOLDOUT_POLICY.cleanSequenceFraction,
    `only ${cleanSequences}/${runs.length} seeds produced a perfectly ordered `
    + `committed transition sequence (floor ${HOLDOUT_POLICY.cleanSequenceFraction * 100}%)`);
  assert.ok(meanSteady >= HOLDOUT_POLICY.meanSteadyAccuracyPct,
    `mean steady accuracy ${meanSteady.toFixed(2)}% < ${HOLDOUT_POLICY.meanSteadyAccuracyPct}%`);
  assert.ok(p10Steady >= HOLDOUT_POLICY.p10SteadyAccuracyPct,
    `p10 steady accuracy ${p10Steady.toFixed(2)}% < ${HOLDOUT_POLICY.p10SteadyAccuracyPct}%`);
  assert.ok(meanFullChord >= HOLDOUT_POLICY.meanFullChordAccuracyPct,
    `mean full-chord accuracy ${meanFullChord.toFixed(2)}% < ${HOLDOUT_POLICY.meanFullChordAccuracyPct}%`);
  assert.ok(p10FullChord >= HOLDOUT_POLICY.p10FullChordAccuracyPct,
    `p10 full-chord accuracy ${p10FullChord.toFixed(2)}% < ${HOLDOUT_POLICY.p10FullChordAccuracyPct}%`);
  assert.ok(meanRecall >= HOLDOUT_POLICY.meanTransitionRecallPct,
    `mean transition recall ${meanRecall.toFixed(2)}% < ${HOLDOUT_POLICY.meanTransitionRecallPct}%`);
  assert.ok(p10Recall >= HOLDOUT_POLICY.p10TransitionRecallPct,
    `p10 transition recall ${p10Recall.toFixed(2)}% < ${HOLDOUT_POLICY.p10TransitionRecallPct}%`);
  assert.ok(meanSpurious <= HOLDOUT_POLICY.meanSpuriousTransitions,
    `mean spurious transitions ${meanSpurious.toFixed(3)} > ${HOLDOUT_POLICY.meanSpuriousTransitions} per run`);
  assert.ok(p90Spurious <= HOLDOUT_POLICY.p90SpuriousTransitions,
    `p90 spurious transitions ${p90Spurious} > ${HOLDOUT_POLICY.p90SpuriousTransitions}`);
  assert.ok(p90Latency <= HOLDOUT_POLICY.p90LatencyP95Ms,
    `p90 run-level p95 latency ${p90Latency.toFixed(1)} ms > ${HOLDOUT_POLICY.p90LatencyP95Ms} ms`);
});

test('heavy-tier note evidence is reproducible and explicitly report-only', () => {
  const runs = HEAVY_EVIDENCE_SEEDS.map((seed) => scoreHouseProgression(seed, 'heavy'));
  const mean = (field) => runs.reduce((sum, run) => sum + run[field], 0) / runs.length;
  const evidence = {
    tier: 'heavy',
    seeds: [...HEAVY_EVIDENCE_SEEDS],
    meanSteadyAccuracyPct: Number(mean('steadyAccuracyPct').toFixed(2)),
    meanFullChordAccuracyPct: Number(mean('fullChordAccuracyPct').toFixed(2)),
    meanTransitionRecallPct: Number(mean('transitionRecallPct').toFixed(2)),
    meanSpuriousTransitions: Number(mean('spuriousTransitions').toFixed(3)),
    runs,
  };
  console.log('[note-noise] joined-house-roots-heavy-report-only', JSON.stringify(evidence));
  for (const run of runs) {
    for (const field of [
      'steadyAccuracyPct', 'fullChordAccuracyPct', 'transitionRecallPct',
    ]) {
      assert.ok(Number.isFinite(run[field]) && run[field] >= 0 && run[field] <= 100,
        `seed ${run.seed} ${field} must be a finite percentage`);
    }
    assert.ok(Number.isInteger(run.spuriousTransitions) && run.spuriousTransitions >= 0);
  }
});
