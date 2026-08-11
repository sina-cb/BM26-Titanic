/**
 * bpm_tune_eval.mjs — BPM tracker + smoother tuning / regression eval.
 *
 * Drives the REAL chain (AudioAnalyzer → BpmTracker → optional BpmSmoother LPF)
 * with deterministic test synths at known tempos, and measures:
 *   1. STEADY accuracy across the EDM band (raw tracker vs LPF-smoothed) — proves
 *      the LPF does not shift the steady value.
 *   2. TEMPO-STEP response (settling time for a 124↔140 change) — the lag the
 *      operator feels as BPM "under/overshooting" right after a DJ track swap.
 *   3. (optional, --corpus) real-track stability (per-track BPM movement) so a
 *      faster-unlock tuning can be proven NOT to add jitter on real audio.
 *
 * Tracker tuning candidates are passed as JSON opts to BpmTracker (e.g.
 * `--opts '{"unlockVoteHops":48}'`) so a tuning can be A/B'd before it's baked
 * into the DEFAULTS. The LPF tau is `--tau` (default 250 ms, the shipped value).
 *
 * USAGE (from marsin_engine/):
 *   node tools/bpm_tune_eval.mjs                       # steady + step, default tracker
 *   node tools/bpm_tune_eval.mjs --opts '{"unlockVoteHops":24}'
 *   node tools/bpm_tune_eval.mjs --corpus              # also real-corpus stability
 *
 * Codex P0 — NO FALLBACK: an unknown synth / malformed opts throws. The corpus
 * is opt-in; when `--corpus` is requested, an absent or empty corpus is an
 * error rather than a silently skipped evaluation.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  loadEffectiveAudioAnalysisConfig,
} from '../audio/config/audio_analysis_config.js';
import { BpmTracker } from '../audio/signals/bpm_tracker.js';
import { BpmSmoother } from '../lib/bpm_smoother.js';
import { SYNTHS } from '../audio/synth/test_synths.js';
import { applyMicModel, MIC_TIERS } from '../tests/integration/mic_model.mjs';
import { readWavMono } from '../tests/integration/wav_io.mjs';
import { isMainModule } from './cli_entrypoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..');
const PRODUCTION_AUDIO = loadEffectiveAudioAnalysisConfig({
  engineDir: ENGINE_DIR,
  modelName: 'titanic',
}).audioConfig;
const SR = PRODUCTION_AUDIO.capture.sampleRate;
const HOP = PRODUCTION_AUDIO.hopSize;
const HOP_MS = (HOP / SR) * 1000;

/** Run a synth (optionally a tempo step), return per-hop {t, raw, sm}. */
function runSynth(synthName, bpm1, { bpm2 = null, stepAtSec = 0, durSec = 28, opts = {}, tauMs = 250, lpf = true, tier = 'clean' } = {}) {
  const synth = SYNTHS[synthName];
  if (!synth) throw new Error(`unknown synth "${synthName}" (have: ${Object.keys(SYNTHS).join(', ')})`);
  const tracker = new BpmTracker(opts);
  const sm = new BpmSmoother({ enabled: lpf, tauMs });
  let clockMs = 0, lastMs = 0;
  const rows = [];
  const an = new AudioAnalyzer(buildAudioAnalyzerOptions(PRODUCTION_AUDIO, {
    nowFn: () => clockMs,
    onAnalysis: ({ flux, kick }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
      const tracked = tracker.update(flux, kick, dt);
      const raw = tracked.bpm;
      let s = raw;
      if (lpf) { if (Number.isFinite(raw) && raw > 0) { const v = sm.push(raw, dt * 1000); if (Number.isFinite(v)) s = v; } else sm.reset(); }
      rows.push({ t: clockMs / 1000, raw, sm: s, confidence: tracked.confidence, locked: tracked.locked });
    },
  }));
  const clean = new Int16Array(Math.ceil(durSec * SR));
  for (let n = 0; n < clean.length; n++) {
    const bpm = (bpm2 && (n / SR) >= stepAtSec) ? bpm2 : bpm1;
    const sample = Math.max(-1, Math.min(1, synth.sample(n, SR, { ...synth.defaults, bpm })));
    clean[n] = Math.round(32767 * sample);
  }
  const samples = applyMicModel(clean, SR, { tier, seed: 0x5EED }).samples;
  for (let n = 0; n < samples.length; n += HOP) {
    clockMs += HOP_MS;
    an.pushSamples(samples.subarray(n, Math.min(n + HOP, samples.length)));
  }
  return rows;
}

const mean = (rows, from, to, key) => { const f = rows.filter((r) => r.t >= from && r.t < to); return f.reduce((s, r) => s + r[key], 0) / Math.max(1, f.length); };
function settleAfter(rows, stepT, target, tolFrac = 0.02) {
  const tol = tolFrac * target;
  for (const r of rows) if (r.t >= stepT && Math.abs(r.sm - target) <= tol) return r.t - stepT;
  return null;
}

function firstLock(rows, target) {
  const hit = rows.find((row) => row.locked && Math.abs(row.sm - target) / target <= 0.02);
  return hit ? hit.t : null;
}

function evalSteady(opts, tauMs, tier) {
  const results = [];
  console.log(`\n── STEADY accuracy (${tier}, full_track, mean of last 8 s) — raw vs LPF ──`);
  console.log('  bpm  raw     err     LPF     err   lock');
  for (const bpm of [90, 110, 124, 128, 140, 150, 174]) {
    const rows = runSynth('full_track', bpm, { durSec: 28, opts, tauMs, tier });
    const raw = mean(rows, 20, 28, 'raw'), lp = mean(rows, 20, 28, 'sm');
    const errorFraction = Math.abs(lp - bpm) / bpm;
    const lockTimeS = firstLock(rows, bpm);
    const tail = rows.filter((row) => row.t >= 20);
    const calibrationBrier = tail.reduce((sum, row) =>
      sum + (row.confidence - (Math.abs(row.sm - bpm) / bpm <= 0.02 ? 1 : 0)) ** 2, 0) / Math.max(1, tail.length);
    const octaveError = Math.abs(lp - bpm * 2) / (bpm * 2) <= 0.02 || Math.abs(lp - bpm / 2) / (bpm / 2) <= 0.02;
    const er = (x) => `${(((x - bpm) / bpm) * 100).toFixed(1)}%`.padStart(6);
    console.log(`  ${String(bpm).padStart(3)}  ${raw.toFixed(1).padStart(5)}  ${er(raw)}  ${lp.toFixed(1).padStart(5)}  ${er(lp)}  ${lockTimeS === null ? '—' : `${lockTimeS.toFixed(1)}s`}`);
    results.push({ bpm, raw, smoothed: lp, errorFraction, within1Pct: errorFraction <= 0.01,
      within2Pct: errorFraction <= 0.02, octaveError, lockTimeS, calibrationBrier });
  }
  return results;
}

function evalStep(opts, tauMs, tier) {
  const results = [];
  console.log(`\n── TEMPO-STEP response (${tier}, settling to ±2%, LPF on) ──`);
  for (const [a, b] of [[124, 140], [140, 124]]) {
    const rows = runSynth('full_track', a, { bpm2: b, stepAtSec: 15, durSec: 32, opts, tauMs, tier });
    const sSm = settleAfter(rows, 15, b);
    console.log(`  ${a}→${b}: settles +${sSm ? sSm.toFixed(1) : '—'}s   (steady ${mean(rows, 25, 32, 'sm').toFixed(1)})`);
    results.push({ fromBpm: a, toBpm: b, reacquisitionTimeS: sSm, steadyBpm: mean(rows, 25, 32, 'sm') });
  }
  return results;
}

function evalCorpus(opts) {
  const dir = path.join(os.homedir(), 'tmp', 'genre_corpus');
  if (!fs.existsSync(dir)) {
    throw new Error(`bpm_tune_eval: requested corpus is absent: ${dir}`);
  }
  console.log('\n── CORPUS stability (mean / movement-sd over the locked tail) ──');
  const genres = fs.readdirSync(dir).filter((g) => fs.statSync(path.join(dir, g)).isDirectory());
  let sdSum = 0, n = 0;
  for (const g of genres) {
    const f = fs.readdirSync(path.join(dir, g)).find((x) => x.endsWith('.wav'));
    if (!f) continue;
    const { samples, sampleRate } = readWavMono(path.join(dir, g, f));
    if (sampleRate !== SR) {
      throw new Error(`bpm_tune_eval: WAV sample rate ${sampleRate} does not match production ${SR}`);
    }
    const tracker = new BpmTracker(opts);
    let clockMs = 0, lastMs = 0; const bpms = [];
    const an = new AudioAnalyzer(buildAudioAnalyzerOptions(PRODUCTION_AUDIO, {
      nowFn: () => clockMs,
      onAnalysis: ({ flux, kick }) => { const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs; bpms.push({ t: clockMs / 1000, bpm: tracker.update(flux, kick, dt).bpm }); },
    }));
    for (let i = 0; i < samples.length; i += HOP) { clockMs += HOP_MS; an.pushSamples(samples.subarray(i, Math.min(i + HOP, samples.length))); }
    const tail = bpms.filter((b) => b.t >= 12);
    const m = tail.reduce((s, b) => s + b.bpm, 0) / Math.max(1, tail.length);
    const sd = Math.sqrt(tail.reduce((s, b) => s + (b.bpm - m) ** 2, 0) / Math.max(1, tail.length));
    sdSum += sd; n++;
    console.log(`  ${g.padEnd(16)} ${m.toFixed(1).padStart(6)} / sd ${sd.toFixed(2)}`);
  }
  if (n === 0) throw new Error(`bpm_tune_eval: zero WAV cases processed under ${dir}`);
  console.log(`  AVG movement sd = ${(sdSum / n).toFixed(2)}  (lower = more stable)`);
  return n;
}

function main() {
  const args = { tiers: ['clean', 'moderate', 'heavy', 'adversarial'] };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--corpus') args.corpus = true;
    else if (a === '--opts') args.opts = JSON.parse(process.argv[++i]);
    else if (a === '--tau') args.tau = Number(process.argv[++i]);
    else if (a === '--tiers') args.tiers = process.argv[++i].split(',');
    else if (a === '--out') args.out = process.argv[++i];
    else throw new Error(`bpm_tune_eval: unknown argument ${a}`);
  }
  for (const tier of args.tiers) if (!MIC_TIERS[tier]) throw new Error(`bpm_tune_eval: unknown tier ${tier}`);
  const opts = args.opts || {};
  const tauMs = Number.isFinite(args.tau) ? args.tau : 250;
  console.log(`BPM tune eval — tracker opts=${JSON.stringify(opts)} · LPF tau=${tauMs}ms`);
  const results = {};
  let processedCases = 0;
  for (const tier of args.tiers) {
    const steady = evalSteady(opts, tauMs, tier);
    const steps = evalStep(opts, tauMs, tier);
    processedCases += steady.length + steps.length;
    results[tier] = { steady, steps };
  }
  if (args.corpus) processedCases += evalCorpus(opts);
  if (processedCases === 0) throw new Error('bpm_tune_eval: zero cases processed');
  const steadyAll = Object.values(results).flatMap(({ steady }) => steady);
  const summary = {
    within1Pct: steadyAll.filter(({ within1Pct }) => within1Pct).length / steadyAll.length,
    within2Pct: steadyAll.filter(({ within2Pct }) => within2Pct).length / steadyAll.length,
    octaveErrorRate: steadyAll.filter(({ octaveError }) => octaveError).length / steadyAll.length,
    meanLockTimeS: steadyAll.filter(({ lockTimeS }) => lockTimeS !== null)
      .reduce((sum, row, _, arr) => sum + row.lockTimeS / arr.length, 0),
    meanCalibrationBrier: steadyAll.reduce((sum, row) => sum + row.calibrationBrier / steadyAll.length, 0),
  };
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify({ processedCases, opts, tauMs, summary, results }, null, 2)}\n`);
  }
  console.log(`\naccuracy ±1%=${(summary.within1Pct * 100).toFixed(1)}% ±2%=${(summary.within2Pct * 100).toFixed(1)}% ` +
    `octave errors=${(summary.octaveErrorRate * 100).toFixed(1)}% mean lock=${summary.meanLockTimeS.toFixed(1)}s`);
  console.log(`\nprocessed ${processedCases} cases`);
}

if (isMainModule(import.meta.url)) main();
