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
 * REGRESSION GATES (exit code 1, with the failing gate named):
 *   clean     — ≥10/14 steady tempos within 1%, AND each of 124/128/150/174
 *               within 2% (the halving-risk subset: Burning Man runs fast).
 *   moderate  — ≥12/14 steady tempos within 2%.
 *   heavy / adversarial — REPORT ONLY. Those mic tiers are deliberately hostile;
 *               gating them would tune the tracker against noise, not music.
 *
 * Codex P0 — NO FALLBACK: an unknown synth / malformed opts throws. The corpus
 * is opt-in; when `--corpus` is requested, an absent or empty corpus (including
 * a genre directory with no .wav) is an error rather than a silent skip.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import {
  buildAudioAnalyzerOptions,
  buildBpmTrackerOptions,
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
const PRODUCTION_TRACKER_OPTIONS = buildBpmTrackerOptions(PRODUCTION_AUDIO);
// The grid deliberately includes the four tempos the tracker is most likely to
// HALVE (124/128 house-techno, 150 psytrance, 174 DnB) — Burning Man runs fast,
// so a halving there is the worst failure this tool can miss.
const STEADY_BPMS = Object.freeze(
  [60, 70, 75, 80, 90, 100, 110, 120, 124, 128, 140, 150, 160, 174]);
// The halving-risk subset the clean tier gates hard on.
const FAST_GATE_BPMS = Object.freeze([124, 128, 150, 174]);

/**
 * Metrical aliases a wrong lock lands on. Beyond the ×2/÷2 octave, the comb +
 * 4/4 grid also produce 3/2, 2/3, 4/3 and 3/4 relatives (a 4/3 alias — 90 read
 * as 120 — is a MEASURED production failure the octave-only metric scored as
 * "not an octave error" and therefore hid).
 */
const ALIAS_RATIOS = Object.freeze([
  ['x2', 2], ['/2', 0.5],
  ['x3/2', 3 / 2], ['x2/3', 2 / 3],
  ['x4/3', 4 / 3], ['x3/4', 3 / 4],
]);

/** Which metrical alias (if any) `measured` sits on, within 2% of the ratio. */
function classifyAlias(measured, trueBpm) {
  for (const [label, ratio] of ALIAS_RATIOS) {
    const aliasBpm = trueBpm * ratio;
    if (Math.abs(measured - aliasBpm) / aliasBpm <= 0.02) return label;
  }
  return null;
}

/** Run a synth (optionally a tempo step), return per-hop {t, raw, sm}. */
function runSynth(synthName, bpm1, {
  bpm2 = null, stepAtSec = 0, durSec = 28, opts = {}, tauMs = 250,
  lpf = true, tier = 'clean', silenceFromSec = null, silenceToSec = null,
} = {}) {
  const synth = SYNTHS[synthName];
  if (!synth) throw new Error(`unknown synth "${synthName}" (have: ${Object.keys(SYNTHS).join(', ')})`);
  const tracker = new BpmTracker(opts);
  const sm = new BpmSmoother({ enabled: lpf, tauMs });
  let clockMs = 0, lastMs = 0;
  const rows = [];
  const an = new AudioAnalyzer(buildAudioAnalyzerOptions(PRODUCTION_AUDIO, {
    nowFn: () => clockMs,
    onAnalysis: ({ flux, kick, low, mid, high }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
      const tracked = tracker.update(flux, kick, dt, Math.max(low, mid, high));
      // bpmRaw, not bpm: this tool tunes the TEMPO MODEL, so it must read the
      // exact estimate — the published value is rate-limited by the output slew.
      const raw = tracked.bpmRaw;
      let s = raw;
      if (lpf) { if (Number.isFinite(raw) && raw > 0) { const v = sm.push(raw, dt * 1000); if (Number.isFinite(v)) s = v; } else sm.reset(); }
      rows.push({ t: clockMs / 1000, raw, sm: s, confidence: tracked.confidence, locked: tracked.locked });
    },
  }));
  const clean = new Int16Array(Math.ceil(durSec * SR));
  for (let n = 0; n < clean.length; n++) {
    const timeSec = n / SR;
    const bpm = (bpm2 && timeSec >= stepAtSec) ? bpm2 : bpm1;
    const silent = silenceFromSec !== null && silenceToSec !== null &&
      timeSec >= silenceFromSec && timeSec < silenceToSec;
    const sample = silent ? 0 : Math.max(-1, Math.min(1, synth.sample(n, SR, { ...synth.defaults, bpm })));
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
  const sustainSec = 2;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].t < stepT || Math.abs(rows[i].sm - target) > tol) continue;
    const end = rows.findIndex((row, index) => index >= i && row.t >= rows[i].t + sustainSec);
    if (end < 0) break;
    if (rows.slice(i, end + 1).every(row => Math.abs(row.sm - target) <= tol)) {
      return rows[i].t - stepT;
    }
  }
  return null;
}

function firstLock(rows, target) {
  const hit = rows.find((row) => row.locked && Math.abs(row.sm - target) / target <= 0.02);
  return hit ? hit.t : null;
}

function evalSteady(opts, tauMs, tier) {
  const results = [];
  console.log(`\n── STEADY accuracy (${tier}, full_track, mean of last 8 s) — raw vs LPF ──`);
  console.log('  bpm  raw     err     LPF     err   lock   alias');
  for (const bpm of STEADY_BPMS) {
    const rows = runSynth('full_track', bpm, { durSec: 28, opts, tauMs, tier });
    const raw = mean(rows, 20, 28, 'raw'), lp = mean(rows, 20, 28, 'sm');
    const errorFraction = Math.abs(lp - bpm) / bpm;
    const lockTimeS = firstLock(rows, bpm);
    const tail = rows.filter((row) => row.t >= 20);
    const calibrationBrier = tail.reduce((sum, row) =>
      sum + (row.confidence - (Math.abs(row.sm - bpm) / bpm <= 0.02 ? 1 : 0)) ** 2, 0) / Math.max(1, tail.length);
    const alias = classifyAlias(lp, bpm);
    const er = (x) => `${(((x - bpm) / bpm) * 100).toFixed(1)}%`.padStart(6);
    console.log(`  ${String(bpm).padStart(3)}  ${raw.toFixed(1).padStart(5)}  ${er(raw)}  ${lp.toFixed(1).padStart(5)}  ${er(lp)}  ${(lockTimeS === null ? '—' : `${lockTimeS.toFixed(1)}s`).padStart(5)}  ${alias || ''}`);
    results.push({ bpm, raw, smoothed: lp, errorFraction, within1Pct: errorFraction <= 0.01,
      within2Pct: errorFraction <= 0.02, alias, aliasError: alias !== null,
      octaveError: alias === 'x2' || alias === '/2', lockTimeS, calibrationBrier });
  }
  return results;
}

/**
 * Subgroup regression gates. A tuning that passes the aggregate accuracy number
 * while HALVING a fast tempo is a regression, so the fast four are gated
 * individually. Heavy/adversarial are report-only: the mic model there is meant
 * to be hostile, and gating it would freeze the tuning against noise, not music.
 * Returns the list of failed gates (empty = pass).
 */
function checkGates(results) {
  const failures = [];
  const clean = results.clean;
  if (clean) {
    const n = clean.steady.length;
    const within1 = clean.steady.filter(({ within1Pct }) => within1Pct).length;
    if (within1 < 10) failures.push(`clean steady ±1%: ${within1}/${n} (need ≥10/${n})`);
    for (const bpm of FAST_GATE_BPMS) {
      const row = clean.steady.find((r) => r.bpm === bpm);
      if (!row) { failures.push(`clean steady is missing the gated tempo ${bpm}`); continue; }
      if (!row.within2Pct) {
        failures.push(`clean ${bpm} BPM read ${row.smoothed.toFixed(1)} ` +
          `(${(row.errorFraction * 100).toFixed(1)}% off${row.alias ? `, alias ${row.alias}` : ''}; need ≤2%)`);
      }
    }
  }
  const moderate = results.moderate;
  if (moderate) {
    const n = moderate.steady.length;
    const within2 = moderate.steady.filter(({ within2Pct }) => within2Pct).length;
    if (within2 < 12) failures.push(`moderate steady ±2%: ${within2}/${n} (need ≥12/${n})`);
  }
  return failures;
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

function evalSilence(opts, tauMs, tier) {
  const rows = runSynth('full_track', 124, {
    bpm2: 140,
    stepAtSec: 18,
    durSec: 30,
    silenceFromSec: 15,
    silenceToSec: 18,
    opts,
    tauMs,
    tier,
  });
  const reset = rows.find(row => row.t >= 15 && row.t < 18 && row.raw === 0 && !row.locked);
  const reacquisitionTimeS = settleAfter(rows, 18, 140);
  const result = {
    resetTimeS: reset ? reset.t - 15 : null,
    resetConfidence: reset ? reset.confidence : null,
    reacquisitionTimeS,
  };
  console.log(`  silence reset=${result.resetTimeS === null ? '—' : `${result.resetTimeS.toFixed(1)}s`} ` +
    `confidence=${result.resetConfidence === null ? '—' : result.resetConfidence.toFixed(3)} ` +
    `reacquire=${reacquisitionTimeS === null ? '—' : `${reacquisitionTimeS.toFixed(1)}s`}`);
  return result;
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
    if (!f) {
      throw new Error(`bpm_tune_eval: corpus genre directory has no .wav: ${path.join(dir, g)}`);
    }
    const { samples, sampleRate } = readWavMono(path.join(dir, g, f));
    if (sampleRate !== SR) {
      throw new Error(`bpm_tune_eval: WAV sample rate ${sampleRate} does not match production ${SR}`);
    }
    const tracker = new BpmTracker(opts);
    let clockMs = 0, lastMs = 0; const bpms = [];
    const an = new AudioAnalyzer(buildAudioAnalyzerOptions(PRODUCTION_AUDIO, {
      nowFn: () => clockMs,
      onAnalysis: ({ flux, kick, low, mid, high }) => {
        const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000;
        lastMs = clockMs;
        const activity = Math.max(low, mid, high);
        bpms.push({ t: clockMs / 1000, bpm: tracker.update(flux, kick, dt, activity).bpmRaw });
      },
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
  const opts = { ...PRODUCTION_TRACKER_OPTIONS, ...(args.opts || {}) };
  const tauMs = Number.isFinite(args.tau) ? args.tau : 250;
  console.log(`BPM tune eval — tracker opts=${JSON.stringify(opts)} · LPF tau=${tauMs}ms`);
  const results = {};
  let processedCases = 0;
  for (const tier of args.tiers) {
    const steady = evalSteady(opts, tauMs, tier);
    const steps = evalStep(opts, tauMs, tier);
    // The silence-reset case only measures anything when the feature is ON. With
    // the shipped `silenceResetEnabled:false` it would score a guaranteed
    // all-null row and still inflate processedCases — SKIP it, loudly.
    let silence = null;
    if (opts.silenceResetEnabled) {
      silence = evalSilence(opts, tauMs, tier);
      processedCases += 1;
    } else {
      console.log(`  silence reset SKIPPED (${tier}): silenceResetEnabled is false`);
    }
    processedCases += steady.length + steps.length;
    results[tier] = { steady, steps, silence };
  }
  if (args.corpus) processedCases += evalCorpus(opts);
  if (processedCases === 0) throw new Error('bpm_tune_eval: zero cases processed');
  const steadyAll = Object.values(results).flatMap(({ steady }) => steady);
  const gateFailures = checkGates(results);
  const summary = {
    within1Pct: steadyAll.filter(({ within1Pct }) => within1Pct).length / steadyAll.length,
    within2Pct: steadyAll.filter(({ within2Pct }) => within2Pct).length / steadyAll.length,
    octaveErrorRate: steadyAll.filter(({ octaveError }) => octaveError).length / steadyAll.length,
    aliasErrorRate: steadyAll.filter(({ aliasError }) => aliasError).length / steadyAll.length,
    gateFailures,
    meanLockTimeS: steadyAll.filter(({ lockTimeS }) => lockTimeS !== null)
      .reduce((sum, row, _, arr) => sum + row.lockTimeS / arr.length, 0),
    meanCalibrationBrier: steadyAll.reduce((sum, row) => sum + row.calibrationBrier / steadyAll.length, 0),
  };
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify({ processedCases, opts, tauMs, summary, results }, null, 2)}\n`);
  }
  console.log(`\naccuracy ±1%=${(summary.within1Pct * 100).toFixed(1)}% ±2%=${(summary.within2Pct * 100).toFixed(1)}% ` +
    `octave errors=${(summary.octaveErrorRate * 100).toFixed(1)}% metric aliases=${(summary.aliasErrorRate * 100).toFixed(1)}% ` +
    `mean lock=${summary.meanLockTimeS.toFixed(1)}s`);
  console.log(`\nprocessed ${processedCases} cases`);
  // Heavy/adversarial are report-only by design; only clean+moderate gate.
  if (gateFailures.length > 0) {
    console.log('\nGATE FAILED:');
    for (const failure of gateFailures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('\nGATES PASSED (clean ±1% ≥10/14 + fast four ±2%; moderate ±2% ≥12/14)');
  }
}

if (isMainModule(import.meta.url)) main();
