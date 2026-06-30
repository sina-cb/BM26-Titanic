/**
 * playa_noise_eval.mjs — on-playa NOISE-ROBUSTNESS scoring harness.
 *
 * The existing detection_eval.mjs degrades the SYNTHETIC scenarios through the
 * virtual mic (clean/moderate/heavy) but replays the REAL corpus as clean
 * line-in. Neither path stresses the two signature on-playa failure modes:
 * WIND GUSTS (transient sub-100 Hz rumble that mimics a kick/drop edge) and
 * NEIGHBOR BLEED (a competing 4-on-the-floor from the next camp). The new
 * `playa` mic tier (tests/integration/mic_model.mjs) adds both; this harness
 * runs a detector config across:
 *
 *   1. REAL corpus degraded through the `playa` mic  → falseFiresPerMin
 *      (every fire is a phantom — the dance-floor safety number on playa audio).
 *   2. SYNTHETIC positives degraded through `playa`  → drop precision / recall
 *      (proves a noise-rejection knob does not also kill REAL drops).
 *
 * It is the scoring tool the on-playa hardening (spectral noise-floor
 * subtraction + wind guard) is tuned and validated against. Compares any
 * number of named/ad-hoc configs side by side so a candidate can be measured
 * against the shipped `default`.
 *
 * USAGE (run from marsin_engine/):
 *   node tools/playa_noise_eval.mjs                      # default vs (nothing else) — baseline
 *   node tools/playa_noise_eval.mjs --json '{"bands":{"highGate":0.2,"midGate":0.09}}'
 *   node tools/playa_noise_eval.mjs --tiers heavy,playa  # also run a milder tier
 *   node tools/playa_noise_eval.mjs --seed 0x5EED
 *
 * The --json config may be a bare detector config, or { detector, bands } to
 * also override the analyzer band config (e.g. per-band gates).
 *
 * Codex P0 — NO FALLBACKS: an unknown tier / malformed config / corrupt WAV
 * throws. The real corpus is OPTIONAL (absent in CI) — when absent the REAL
 * section reports unavailable and the synthetic section still runs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildScenarios } from '../tests/integration/detector_scenarios.mjs';
import { applyMicModel, MIC_TIERS } from '../tests/integration/mic_model.mjs';
import { runClip, dropMetrics, f1Score, DEFAULT_BANDS } from '../tests/integration/run_analysis.mjs';
import { readWavMono } from '../tests/integration/wav_io.mjs';

const MIC_SEED = 0x5EED;
const DROP_TOLERANCE_MS = 1200;
const DEFAULT_REAL_CORPUS = path.join(os.homedir(), 'tmp', 'genre_corpus');

// Drop-bearing synthetic scenarios (recall guard). Mirrors detection_eval.
const POSITIVES = new Set([
  'full_arc', 'single_drop_long', 'double_drop', 'breakdown_then_drop',
]);

// Named configs. `default` = shipped DETECTOR_DEFAULTS. Pass --json for ad-hoc.
const CONFIGS = {
  default: {},
};

function fmt(x, d = 2) { return (x === null || x === undefined) ? ' — ' : Number(x).toFixed(d); }
function resolveHome(p) { return (p && p.startsWith('~')) ? path.join(os.homedir(), p.slice(1)) : p; }

function listCorpusWavs(corpusDir) {
  if (!fs.existsSync(corpusDir)) return [];
  const out = [];
  for (const g of fs.readdirSync(corpusDir).filter((d) => fs.statSync(path.join(corpusDir, d)).isDirectory())) {
    const dir = path.join(corpusDir, g);
    for (const f of fs.readdirSync(dir).filter((f2) => f2.endsWith('.wav'))) {
      out.push({ genre: g, file: f, path: path.join(dir, f) });
    }
  }
  return out;
}

/**
 * Real corpus → playa-degraded → phantom-drop count. Each track is a
 * continuous DJ clip with no labeled EDM drops, so every fire is a false
 * positive. Returns falseFiresPerMin + per-genre breakdown.
 */
function evalRealPlaya(detectorConfig, bands, { corpusDir, tier, seed, quiet = true }) {
  const wavs = listCorpusWavs(corpusDir);
  if (!wavs.length) return { available: false, corpusDir };
  const cfg = { enabled: true, ...detectorConfig };
  const origLog = console.log;
  if (quiet) console.log = () => {};
  try {
    let drops = 0, totalMs = 0, tracksWithFire = 0;
    const perGenre = {};
    for (const w of wavs) {
      const { samples, sampleRate } = readWavMono(w.path);
      const deg = applyMicModel(samples, sampleRate, { tier, seed });
      const clip = {
        name: `${w.genre}/${w.file}`, samples: deg.samples, sampleRate, stemsPlan: [],
        labels: { drops: [], build: [], slow: [], regions: [] },
      };
      const rec = runClip(clip, { mode: 'mic-only', detectorConfig: cfg, bands });
      const fired = rec.dropFired.length;
      drops += fired; totalMs += rec.durationMs;
      if (fired > 0) tracksWithFire += 1;
      perGenre[w.genre] = (perGenre[w.genre] || 0) + fired;
    }
    const minutes = totalMs / 60000;
    return {
      available: true, corpusDir, tier,
      falseFiresPerMin: minutes > 0 ? drops / minutes : null,
      drops, minutes, tracks: wavs.length, tracksWithFire, perGenre,
    };
  } finally {
    console.log = origLog;
  }
}

/**
 * Synthetic positives → playa-degraded → drop precision/recall. Proves a
 * noise-rejection knob keeps catching REAL drops.
 */
function evalSyntheticPlaya(detectorConfig, bands, { tier, seed, quiet = true }) {
  const cfg = { enabled: true, ...detectorConfig };
  const origLog = console.log;
  if (quiet) console.log = () => {};
  try {
    let tp = 0, fp = 0, fn = 0; const lat = [];
    for (const clip of buildScenarios()) {
      if (!POSITIVES.has(clip.name)) continue;
      const deg = applyMicModel(clip.samples, clip.sampleRate, { tier, seed });
      const rec = runClip({ ...clip, samples: deg.samples }, { mode: 'stems-fed', detectorConfig: cfg, bands });
      const dm = dropMetrics(rec, DROP_TOLERANCE_MS);
      tp += dm.tp; fp += dm.fp; fn += dm.fn;
      for (const l of dm.latencies) lat.push(l);
    }
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : null;
    const meanLat = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
    return { precision, recall, f1: f1Score(precision, recall), tp, fp, fn, meanLatencyMs: meanLat };
  } finally {
    console.log = origLog;
  }
}

function printResult(name, tier, syn, real) {
  console.log(`\n── ${name} @ ${tier} ─────────────────────────────────`);
  console.log(`  SYNTH drops  P=${fmt(syn.precision)} R=${fmt(syn.recall)} F1=${fmt(syn.f1)} ` +
    `lat=${fmt(syn.meanLatencyMs, 0)}ms (tp/fp/fn=${syn.tp}/${syn.fp}/${syn.fn})`);
  if (real.available) {
    const worst = Object.entries(real.perGenre).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    console.log(`  REAL  falseFiresPerMin=${fmt(real.falseFiresPerMin)} ` +
      `(${real.drops} phantom drops over ${fmt(real.minutes, 1)} min, ${real.tracksWithFire}/${real.tracks} tracks)`);
    if (worst.length) console.log(`        worst genres: ${worst.slice(0, 4).map(([g, v]) => `${g}=${v}`).join('  ')}`);
  } else {
    console.log(`  REAL  corpus absent (${real.corpusDir})`);
  }
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2); const next = process.argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; } else { args[key] = next; i++; }
    }
  }
  const tiers = args.tiers ? String(args.tiers).split(',') : ['playa'];
  for (const t of tiers) if (!MIC_TIERS[t]) throw new Error(`unknown tier "${t}" (have: ${Object.keys(MIC_TIERS).join(', ')})`);
  const seed = args.seed ? Number(args.seed) : MIC_SEED;
  if (!Number.isFinite(seed)) throw new Error(`--seed must be a number, got "${args.seed}"`);
  const corpusDir = args['real-corpus'] ? resolveHome(String(args['real-corpus'])) : DEFAULT_REAL_CORPUS;

  // A config entry is { detector, bands }. --json may supply either a bare
  // detector config (legacy) or the full { detector, bands } shape; a bare
  // object with no detector/bands keys is treated as a detector config.
  const normalize = (raw) => {
    if (raw && (raw.detector !== undefined || raw.bands !== undefined)) {
      return { detector: raw.detector || {}, bands: { ...DEFAULT_BANDS, ...(raw.bands || {}) } };
    }
    return { detector: raw || {}, bands: DEFAULT_BANDS };
  };
  let configs;
  if (args.json) configs = { default: normalize({}), candidate: normalize(JSON.parse(args.json)) };
  else if (args.config) {
    const names = String(args.config).split(',');
    for (const c of names) if (!CONFIGS[c]) throw new Error(`unknown config "${c}"`);
    configs = Object.fromEntries(names.map((n) => [n, normalize(CONFIGS[n])]));
  } else configs = { default: normalize({}) };

  for (const tier of tiers) {
    for (const [name, cfg] of Object.entries(configs)) {
      const syn = evalSyntheticPlaya(cfg.detector, cfg.bands, { tier, seed });
      const real = evalRealPlaya(cfg.detector, cfg.bands, { corpusDir, tier, seed });
      printResult(name, tier, syn, real);
    }
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
