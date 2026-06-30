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
 * is OPTIONAL (real audio in ~/tmp); absent → the corpus section is skipped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AudioAnalyzer } from '../audio/analyzer/audio_analyzer.js';
import { BpmTracker } from '../audio/signals/bpm_tracker.js';
import { BpmSmoother } from '../lib/bpm_smoother.js';
import { SYNTHS } from '../audio/synth/test_synths.js';
import { readWavMono } from '../tests/integration/wav_io.mjs';

const SR = 44100, HOP = 512, FFT = 2048;
const BANDS = { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 };
const KICK = { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 70 };
const SUB = { minHz: 30, maxHz: 60 };
const HOP_MS = (HOP / SR) * 1000;

/** Run a synth (optionally a tempo step), return per-hop {t, raw, sm}. */
function runSynth(synthName, bpm1, { bpm2 = null, stepAtSec = 0, durSec = 28, opts = {}, tauMs = 250, lpf = true } = {}) {
  const synth = SYNTHS[synthName];
  if (!synth) throw new Error(`unknown synth "${synthName}" (have: ${Object.keys(SYNTHS).join(', ')})`);
  const tracker = new BpmTracker(opts);
  const sm = new BpmSmoother({ enabled: lpf, tauMs });
  let clockMs = 0, lastMs = 0;
  const rows = [];
  const an = new AudioAnalyzer({
    sampleRate: SR, fftSize: FFT, hopSize: HOP, bands: BANDS, kick: KICK, sub: SUB, nowFn: () => clockMs,
    onAnalysis: ({ flux, kick }) => {
      const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
      const raw = tracker.update(flux, kick, dt).bpm;
      let s = raw;
      if (lpf) { if (Number.isFinite(raw) && raw > 0) { const v = sm.push(raw, dt * 1000); if (Number.isFinite(v)) s = v; } else sm.reset(); }
      rows.push({ t: clockMs / 1000, raw, sm: s });
    },
  });
  const buf = new Float32Array(HOP);
  for (let n = 0; n < durSec * SR; n += HOP) {
    const bpm = (bpm2 && (n / SR) >= stepAtSec) ? bpm2 : bpm1;
    for (let i = 0; i < HOP; i++) buf[i] = Math.max(-1, Math.min(1, synth.sample(n + i, SR, { ...synth.defaults, bpm })));
    clockMs += HOP_MS;
    an.pushSamples(buf);
  }
  return rows;
}

const mean = (rows, from, to, key) => { const f = rows.filter((r) => r.t >= from && r.t < to); return f.reduce((s, r) => s + r[key], 0) / Math.max(1, f.length); };
function settleAfter(rows, stepT, target, tolFrac = 0.02) {
  const tol = tolFrac * target;
  for (const r of rows) if (r.t >= stepT && Math.abs(r.sm - target) <= tol) return r.t - stepT;
  return null;
}

function evalSteady(opts, tauMs) {
  console.log('\n── STEADY accuracy (full_track, mean of last 8 s) — raw vs LPF ──');
  console.log('  bpm  raw     err     LPF     err');
  for (const bpm of [90, 110, 124, 128, 140, 150, 174]) {
    const rows = runSynth('full_track', bpm, { durSec: 28, opts, tauMs });
    const raw = mean(rows, 20, 28, 'raw'), lp = mean(rows, 20, 28, 'sm');
    const er = (x) => `${(((x - bpm) / bpm) * 100).toFixed(1)}%`.padStart(6);
    console.log(`  ${String(bpm).padStart(3)}  ${raw.toFixed(1).padStart(5)}  ${er(raw)}  ${lp.toFixed(1).padStart(5)}  ${er(lp)}`);
  }
}

function evalStep(opts, tauMs) {
  console.log('\n── TEMPO-STEP response (settling to ±2%, LPF on) ──');
  for (const [a, b] of [[124, 140], [140, 124]]) {
    const rows = runSynth('full_track', a, { bpm2: b, stepAtSec: 15, durSec: 32, opts, tauMs });
    const sSm = settleAfter(rows, 15, b);
    console.log(`  ${a}→${b}: settles +${sSm ? sSm.toFixed(1) : '—'}s   (steady ${mean(rows, 25, 32, 'sm').toFixed(1)})`);
  }
}

function evalCorpus(opts) {
  const dir = path.join(os.homedir(), 'tmp', 'genre_corpus');
  if (!fs.existsSync(dir)) { console.log('\n── CORPUS stability: corpus absent, skipped ──'); return; }
  console.log('\n── CORPUS stability (mean / movement-sd over the locked tail) ──');
  const genres = fs.readdirSync(dir).filter((g) => fs.statSync(path.join(dir, g)).isDirectory());
  let sdSum = 0, n = 0;
  for (const g of genres) {
    const f = fs.readdirSync(path.join(dir, g)).find((x) => x.endsWith('.wav'));
    if (!f) continue;
    const { samples, sampleRate } = readWavMono(path.join(dir, g, f));
    const tracker = new BpmTracker(opts);
    let clockMs = 0, lastMs = 0; const bpms = [];
    const an = new AudioAnalyzer({ sampleRate, fftSize: FFT, hopSize: HOP, bands: BANDS, kick: KICK, sub: SUB, nowFn: () => clockMs,
      onAnalysis: ({ flux, kick }) => { const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs; bpms.push({ t: clockMs / 1000, bpm: tracker.update(flux, kick, dt).bpm }); } });
    for (let i = 0; i < samples.length; i += HOP) { clockMs += HOP_MS; an.pushSamples(samples.subarray(i, Math.min(i + HOP, samples.length))); }
    const tail = bpms.filter((b) => b.t >= 12);
    const m = tail.reduce((s, b) => s + b.bpm, 0) / Math.max(1, tail.length);
    const sd = Math.sqrt(tail.reduce((s, b) => s + (b.bpm - m) ** 2, 0) / Math.max(1, tail.length));
    sdSum += sd; n++;
    console.log(`  ${g.padEnd(16)} ${m.toFixed(1).padStart(6)} / sd ${sd.toFixed(2)}`);
  }
  console.log(`  AVG movement sd = ${(sdSum / Math.max(1, n)).toFixed(2)}  (lower = more stable)`);
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--corpus') args.corpus = true;
    else if (a === '--opts') args.opts = JSON.parse(process.argv[++i]);
    else if (a === '--tau') args.tau = Number(process.argv[++i]);
  }
  const opts = args.opts || {};
  const tauMs = Number.isFinite(args.tau) ? args.tau : 250;
  console.log(`BPM tune eval — tracker opts=${JSON.stringify(opts)} · LPF tau=${tauMs}ms`);
  evalSteady(opts, tauMs);
  evalStep(opts, tauMs);
  if (args.corpus) evalCorpus(opts);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
