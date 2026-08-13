/**
 * genre_eval.mjs — evaluate the party-mode GENRE classifier against a REAL,
 * genre-labelled audio corpus.
 *
 * For each WAV in `<corpus>/<genre>/<id>.wav` it runs the file through the
 * EXACT engine audio chain that produces `audioGenre`:
 *
 *   AudioAnalyzer ─(low,mid,high,kick,flux,dom*,onset*,sub)─▶ ParamCenter (*Raw)
 *        │                                                         │
 *        └▶ SignalPostProcessor (DEFAULT_CHAINS) ─ post mirrors ───┤
 *                                                                  │
 *   AudioStructureDetector.tick(now,dt) ─ audio* keys ────────────▶│
 *   DerivedSignals.tick(now,dt) ─ audioGenre / audioParty / ... ──▶│
 *
 * The committed `audioGenre` index over the clip (last value, plus a
 * majority vote over the post-warmup tail) is compared to the folder label.
 * It prints a CONFUSION MATRIX, per-genre accuracy, and overall accuracy.
 *
 * Real audio lives in ~/tmp (never committed); this tool reads it from
 * --corpus (default ~/tmp/genre_corpus). It is a TOOL, not a test — run it
 * after building the corpus with ~/tmp/corpus_fetch/build_corpus.mjs.
 *
 * Usage:
 *   node tools/genre_eval.mjs [--corpus <dir>] [--no-force-party] [--json]
 *
 * --force-party (default ON): the corpus tracks are short trims, so we feed
 *   the GenreClassifier party=true unconditionally rather than waiting for the
 *   loudness gate to latch — this isolates GENRE accuracy from PARTY-gate
 *   timing. Pass --no-force-party to also require the real party gate to fire.
 *
 * Codex P0 — NO FALLBACK: a missing corpus dir, an empty genre folder, or an
 * unknown genre label throws loudly; it does not silently skip.
 *
 * `runWav` and `evalCorpus` are exported so a unit test can drive the harness
 * on a deterministic synthetic WAV (no real-audio dependency in CI).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  buildBpmTrackerOptions,
  buildDerivedSignalsOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../audio/config/audio_analysis_config.js';
import { buildRawMirrorWrites } from '../audio/companion/audio_pipeline.js';
import { SignalPostProcessor } from '../audio/postproc/signal_post_processor.js';
import { AudioStructureDetector } from '../audio/detector/audio_structure_detector.js';
import { DerivedSignals } from '../audio/signals/derived_signals.js';
import { GENRE_NAMES } from '../audio/signals/genre_classifier.js';
import { ParamCenter } from '../lib/param_center.js';
import { readWavMono } from '../tests/integration/wav_io.mjs';
import { isMainModule } from './cli_entrypoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..');
const PRODUCTION_AUDIO = loadEffectiveAudioAnalysisConfig({
  engineDir: ENGINE_DIR,
  modelName: 'titanic',
}).audioConfig;
const HOP_SIZE = PRODUCTION_AUDIO.hopSize;
// Genre is meaningful only after the classifier's warmup (~5 s) + a few
// seconds of window fill. Vote over the steady tail, ignoring the lead-in.
const VOTE_START_MS = 12000;

// Default fftSize MUST match the deployed product (config.yaml audio.fftSize =
// 2048, the same value run_analysis.mjs pins). It was previously 1024 — a stale
// pre-FFT-bump value — so the no-flag run scored the classifier at a resolution
// the engine never uses and reported a fictitiously LOW accuracy (the profiles
// are anchored to measured fft-2048 centroids). Tune/report at the deployed
// fftSize; pass --fft to override for analysis.
const PRODUCT_FFT_SIZE = PRODUCTION_AUDIO.fftSize;

function parseArgs(argv) {
  const a = { corpus: path.join(os.homedir(), 'tmp', 'genre_corpus'), manifest: null, split: null, forceParty: true, json: false, fftSize: PRODUCT_FFT_SIZE };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--corpus') a.corpus = argv[++i];
    else if (t === '--manifest') a.manifest = argv[++i];
    else if (t === '--split') a.split = argv[++i];
    else if (t === '--no-force-party') a.forceParty = false;
    else if (t === '--force-party') a.forceParty = true;
    else if (t === '--fft') a.fftSize = parseInt(argv[++i], 10);
    else if (t === '--json') a.json = true;
    else throw new Error(`genre_eval: unknown arg '${t}'`);
  }
  if (a.split && !['train', 'validation', 'test'].includes(a.split)) {
    throw new Error(`genre_eval: --split must be train, validation, or test (got ${a.split})`);
  }
  return a;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function corpusCases(args) {
  if (!args.manifest) {
    if (!fs.existsSync(args.corpus)) {
      throw new Error(`genre_eval: corpus dir not found: ${args.corpus}`);
    }
    const genres = fs.readdirSync(args.corpus).filter((d) => fs.statSync(path.join(args.corpus, d)).isDirectory());
    return genres.flatMap((genre) => fs.readdirSync(path.join(args.corpus, genre))
      .filter((file) => file.endsWith('.wav'))
      .map((file) => ({ genre, file, path: path.join(args.corpus, genre, file) })));
  }
  if (!fs.existsSync(args.manifest)) throw new Error(`genre_eval: manifest not found: ${args.manifest}`);
  const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('genre_eval: manifest is empty');
  const selected = args.split ? manifest.filter((entry) => entry.split === args.split) : manifest;
  if (selected.length === 0) throw new Error(`genre_eval: manifest has zero ${args.split || 'selected'} cases`);
  return selected.map((entry) => {
    const wavPath = path.join(args.corpus, entry.wav);
    if (!fs.existsSync(wavPath)) throw new Error(`genre_eval: manifest WAV missing: ${wavPath}`);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256) || sha256(wavPath) !== entry.sha256) {
      throw new Error(`genre_eval: checksum mismatch: ${entry.wav}`);
    }
    return { genre: entry.genre, file: path.basename(entry.wav), path: wavPath, split: entry.split };
  });
}

/** The party-genre labels we evaluate (folder names). 0=ambient is excluded. */
function genreIndex(name) {
  const idx = GENRE_NAMES.indexOf(name);
  return idx; // -1 if not a canonical genre (e.g. house/psytrance extras)
}

/**
 * Run one WAV through the real chain. Returns { perHopGenre:[{tMs,genre,conf}],
 * tailVoteGenre, lastGenre, partyEverOn }.
 *
 * forceParty: when true we override the party gate FED TO the genre classifier
 * to 1 (the rest of DerivedSignals runs as-is). We do this by sub-classing the
 * chain at the DerivedSignals level via a paramCenter probe AFTER tick — but
 * the cleanest hook is to drive the analyzer chain and then read audioGenre.
 * To force party we patch the PartyMode threshold so the gate latches on any
 * real music (onThresh→0), which is faithful: loud party music WOULD latch.
 */
export function runWav(samples, sampleRate, { forceParty, fftSize }) {
  if (sampleRate !== PRODUCTION_AUDIO.capture.sampleRate) {
    throw new Error(`genre_eval: WAV sample rate ${sampleRate} does not match production ` +
      `${PRODUCTION_AUDIO.capture.sampleRate}; decode/resample the corpus first`);
  }
  const paramCenter = new ParamCenter(null);
  const spp = new SignalPostProcessor({ paramCenter });
  const broadcasts = [];
  // Silence the structure detector's per-transition console chatter so the eval
  // report is clean. We restore console after the run (fail-loud errors on the
  // analyzer still surface via thrown exceptions, not console).
  const realLog = console.log, realWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  const detector = new AudioStructureDetector({
    paramCenter, broadcast: (m) => broadcasts.push(m), getConfig: () => ({ enabled: true }),
  });
  const derived = new DerivedSignals({
    paramCenter,
    bpmTracker: buildBpmTrackerOptions(PRODUCTION_AUDIO),
    derivedSignals: buildDerivedSignalsOptions(PRODUCTION_AUDIO),
  });

  // Force party: drop the PartyMode on/off thresholds + warmup so the gate
  // latches immediately on real music. This is faithful (a loud dance track
  // clears the real gate; we just remove the latency so short trims qualify).
  if (forceParty) {
    const pm = derived._party;
    pm.p = { ...pm.p, onThresh: 0.0001, offThresh: 0.0, warmupMs: 0, holdMs: 0 };
  }

  let clockMs = 0;
  const hopMs = (HOP_SIZE / sampleRate) * 1000;
  let lastAtMs = 0;
  const perHop = [];
  let partyEverOn = false;

  const analyzerConfig = { ...PRODUCTION_AUDIO, fftSize };
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(analyzerConfig, {
    nowFn: () => clockMs,
    onAnalysis: ({ low, mid, high, kick, flux, domFreq1, domEnergy1, domFreq2, domEnergy2,
                  onsetLow, onsetMid, onsetHigh, micSub,
                  tonalStability, chromaFlux, chromaTilt }) => {
      const nowMs = clockMs;
      const dt = lastAtMs === 0 ? 0 : Math.max(0, (nowMs - lastAtMs) / 1000);
      lastAtMs = nowMs;
      const lowPost  = spp.process('micLow',  low,  dt);
      const midPost  = spp.process('micMid',  mid,  dt);
      const highPost = spp.process('micHigh', high, dt);
      const kickPost = spp.process('micKick', kick, dt);
      const fluxPost = spp.process('micFlux', flux, dt);
      paramCenter.setMany([
        { kind: 'scalar', key: 'micLow', value: lowPost }, { kind: 'scalar', key: 'micMid', value: midPost },
        { kind: 'scalar', key: 'micHigh', value: highPost }, { kind: 'scalar', key: 'micKick', value: kickPost },
        { kind: 'scalar', key: 'micFlux', value: fluxPost },
        ...buildRawMirrorWrites({
          low,
          mid,
          high,
          kick,
          flux,
          domFreq1,
          domEnergy1,
          domFreq2,
          domEnergy2,
          onsetLow,
          onsetMid,
          onsetHigh,
          micSub,
          tonalStability,
          chromaFlux,
          chromaTilt,
        }),
      ], 'audio', 'audio:mic');
      detector.tick(nowMs, dt);
      derived.tick(nowMs, dt);
      // Snapshot the classifier's internal normalized feature vector (built on
      // the periodic re-score). Used for per-genre feature-centroid reporting so
      // the sibling can re-tune the PROFILES against MEASURED real-audio values.
      const fv = derived._genre._feat;
      perHop.push({ tMs: nowMs, genre: paramCenter.get('audioGenre'), conf: paramCenter.get('audioGenreConf'),
        feat: Array.from(fv) });
      if (paramCenter.get('audioParty') >= 0.5) partyEverOn = true;
    },
  }));

  for (let i = 0; i < samples.length; i += HOP_SIZE) {
    const chunk = samples.subarray(i, Math.min(i + HOP_SIZE, samples.length));
    clockMs += hopMs;
    analyzer.pushSamples(chunk);
  }
  detector.dispose();
  console.log = realLog; console.warn = realWarn;

  // Tail majority vote (post warmup) — the published genre over the steady part.
  const tail = perHop.filter((h) => h.tMs >= VOTE_START_MS);
  const votes = new Map();
  for (const h of tail) votes.set(h.genre, (votes.get(h.genre) || 0) + 1);
  let tailVote = 0, tailVoteN = -1;
  for (const [g, n] of votes) if (n > tailVoteN) { tailVoteN = n; tailVote = g; }
  const last = perHop.length ? perHop[perHop.length - 1].genre : 0;
  const meanConf = tail.length ? tail.reduce((s, h) => s + h.conf, 0) / tail.length : 0;
  // Mean feature vector over the steady tail (the measured centroid for this track).
  const NF = perHop.length ? perHop[0].feat.length : 8;
  const meanFeat = new Array(NF).fill(0);
  for (const h of tail) for (let k = 0; k < NF; k++) meanFeat[k] += h.feat[k];
  if (tail.length) for (let k = 0; k < NF; k++) meanFeat[k] /= tail.length;
  return { perHop, tailVoteGenre: tailVote, lastGenre: last, partyEverOn, meanConf, meanFeat, durMs: clockMs };
}

function main() {
  const args = parseArgs(process.argv);
  const cases = corpusCases(args);
  const genres = [...new Set(cases.map(({ genre }) => genre))];
  if (!genres.length) throw new Error(`genre_eval: no genre cases under ${args.corpus}`);

  // Only score folders that are canonical classifier genres (1..6). Extra
  // folders (house/psytrance/dnb) are decoded + reported as OUT-OF-VOCAB but
  // not scored against the 7-way matrix (the classifier can't emit them).
  const scoredGenres = genres.filter((g) => genreIndex(g) >= 1);
  const oovGenres = genres.filter((g) => genreIndex(g) < 1);
  if (!scoredGenres.length) {
    throw new Error(`genre_eval: zero scoreable genre folders under ${args.corpus}`);
  }

  const labels = scoredGenres.map(genreIndex).sort((a, b) => a - b);
  const labelNames = labels.map((i) => GENRE_NAMES[i]);
  // confusion[trueIdx][predIdx] over the FULL GENRE_NAMES space (incl. ambient).
  const allIdx = GENRE_NAMES.map((_, i) => i);
  const confusion = {};
  for (const t of labels) { confusion[t] = {}; for (const p of allIdx) confusion[t][p] = 0; }

  const rows = [];
  let total = 0, correct = 0;
  const perGenre = {};

  for (const genre of scoredGenres) {
    const wavs = cases.filter((item) => item.genre === genre);
    if (!wavs.length) throw new Error(`genre_eval: genre '${genre}' has no selected WAVs`);
    const tIdx = genreIndex(genre);
    perGenre[genre] = { n: 0, correct: 0 };
    for (const w of wavs) {
      const { samples, sampleRate } = readWavMono(w.path);
      const r = runWav(samples, sampleRate, { forceParty: args.forceParty, fftSize: args.fftSize });
      const pred = r.tailVoteGenre;
      confusion[tIdx][pred]++;
      const ok = pred === tIdx;
      total++; if (ok) correct++;
      perGenre[genre].n++; if (ok) perGenre[genre].correct++;
      rows.push({ genre, file: w.file, split: w.split || null, predIdx: pred, pred: GENRE_NAMES[pred], correct: ok,
        conf: +r.meanConf.toFixed(3), partyEverOn: r.partyEverOn, durSec: +(r.durMs / 1000).toFixed(1),
        meanFeat: r.meanFeat.map((v) => +v.toFixed(3)) });
    }
  }
  if (total === 0) throw new Error('genre_eval: zero WAV cases processed');

  const classMetrics = {};
  for (const t of labels) {
    const tp = confusion[t][t];
    const fn = allIdx.reduce((sum, p) => sum + confusion[t][p], 0) - tp;
    const fp = labels.reduce((sum, truth) => sum + confusion[truth][t], 0) - tp;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    classMetrics[GENRE_NAMES[t]] = {
      precision,
      recall,
      f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0,
    };
  }
  const macroF1 = Object.values(classMetrics).reduce((sum, metric) => sum + metric.f1, 0) / labels.length;
  const brier = rows.reduce((sum, row) => sum + (row.conf - (row.correct ? 1 : 0)) ** 2, 0) / total;
  const abstention = [0.25, 0.5, 0.75].map((threshold) => {
    const accepted = rows.filter((row) => row.conf >= threshold);
    return {
      threshold,
      accepted: accepted.length,
      coverage: accepted.length / total,
      accuracy: accepted.length ? accepted.filter((row) => row.correct).length / accepted.length : null,
    };
  });

  // Measured per-genre feature centroids (mean of per-track tail centroids) —
  // the empirical target the sibling should re-tune PROFILES toward.
  const FEAT_LABELS = ['bpm', 'kickReg', 'kickDens', 'lowMid', 'sparkle', 'sparkleVar', 'melodic', 'flux',
    'bassW', 'midW', 'tilt', 'fluxVar', 'tonalStab', 'chromaFlux', 'chromaTilt'];
  const centroids = {};
  for (const genre of scoredGenres) {
    const grp = rows.filter((r) => r.genre === genre);
    const NF = grp.length ? grp[0].meanFeat.length : 8;
    const c = new Array(NF).fill(0);
    for (const r of grp) for (let k = 0; k < NF; k++) c[k] += r.meanFeat[k];
    if (grp.length) for (let k = 0; k < NF; k++) c[k] = +(c[k] / grp.length).toFixed(3);
    centroids[genre] = c;
  }

  // ── Report ──────────────────────────────────────────────────────────────
  if (args.json) {
    console.log(JSON.stringify({ corpus: args.corpus, manifest: args.manifest, split: args.split, fftSize: args.fftSize, forceParty: args.forceParty,
      processedCases: total,
      overall: { total, correct, accuracy: correct / total, macroF1, brier },
      classMetrics, abstention,
      perGenre, confusion, labelNames, oovGenres, centroids, featLabels: FEAT_LABELS, rows }, null, 2));
    return;
  }

  console.log(`\n=== GENRE CLASSIFIER EVAL ===`);
  console.log(`corpus: ${args.corpus}`);
  if (args.manifest) console.log(`manifest: ${args.manifest}   split: ${args.split || 'all'}`);
  console.log(`fftSize: ${args.fftSize}   forceParty: ${args.forceParty}   voteFromMs: ${VOTE_START_MS}`);
  if (oovGenres.length) console.log(`out-of-vocab folders (decoded, not scored — classifier can't emit): ${oovGenres.join(', ')}`);

  // Per-track table.
  console.log(`\nPer-track predictions:`);
  console.log(`  ${'true'.padEnd(15)} ${'pred'.padEnd(15)} conf  party  dur   file`);
  for (const r of rows) {
    const mark = r.correct ? 'OK ' : 'XX ';
    console.log(`  ${mark}${r.genre.padEnd(13)} ${r.pred.padEnd(15)} ${String(r.conf).padEnd(5)} ${r.partyEverOn ? 'Y' : 'n'}     ${String(r.durSec).padEnd(5)} ${r.file.slice(0, 40)}`);
  }

  // Confusion matrix (rows = true label, cols = predicted across all genres seen).
  const predCols = new Set();
  for (const t of labels) for (const p of allIdx) if (confusion[t][p] > 0) predCols.add(p);
  // Always include the diagonal columns.
  for (const t of labels) predCols.add(t);
  const cols = [...predCols].sort((a, b) => a - b);
  console.log(`\nConfusion matrix (rows = TRUE, cols = PREDICTED):`);
  const colHdr = cols.map((c) => GENRE_NAMES[c].slice(0, 8).padStart(9)).join('');
  console.log(`  ${'TRUE\\PRED'.padEnd(15)}${colHdr}`);
  for (const t of labels) {
    const cells = cols.map((c) => String(confusion[t][c]).padStart(9)).join('');
    console.log(`  ${GENRE_NAMES[t].padEnd(15)}${cells}`);
  }

  // Per-genre accuracy.
  console.log(`\nPer-genre accuracy:`);
  for (const genre of scoredGenres) {
    const g = perGenre[genre];
    const acc = g.n ? (g.correct / g.n) : 0;
    console.log(`  ${genre.padEnd(15)} ${g.correct}/${g.n}  = ${(acc * 100).toFixed(0)}%`);
  }
  console.log(`\nOVERALL: ${correct}/${total} = ${(correct / total * 100).toFixed(1)}%`);
  console.log(`MACRO F1: ${macroF1.toFixed(3)}   confidence Brier: ${brier.toFixed(3)}`);
  console.log(`processed ${total} cases`);

  // Measured feature centroids per genre — what the REAL analyzer reads. The
  // sibling re-tunes PROFILES toward these (and reweights features that overlap).
  console.log(`\nMeasured per-genre feature centroids (mean over tracks, tail window):`);
  console.log(`  ${'genre'.padEnd(15)}${FEAT_LABELS.map((l) => l.slice(0, 7).padStart(9)).join('')}`);
  for (const genre of scoredGenres) {
    console.log(`  ${genre.padEnd(15)}${centroids[genre].map((v) => v.toFixed(3).padStart(9)).join('')}`);
  }
}

export { GENRE_NAMES };

// Run as a CLI only when invoked directly (not when imported by a test).
if (isMainModule(import.meta.url)) {
  main();
}
