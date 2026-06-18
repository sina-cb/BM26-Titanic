#!/usr/bin/env node
/**
 * tools/audio_calibrate — venue mic calibration helper.
 *
 * Standalone diagnostic that listens to the live microphone for a few
 * seconds and prints a suggested `bands.noiseGate` plus the observed
 * min/median/max per band, with a copy-pasteable YAML snippet for
 * `states/<scene>/audio_state.yaml`. It boots NONE of the engine — just
 * `AudioCapture` + `AudioAnalyzer` from `../lib/` — so an operator can
 * point it at a new room and pick a gate/gain without the WS server,
 * OSC listener, sACN output, or the WASM mixer in the way.
 *
 * It is the calibration companion referenced by the Normalizer op in
 * `lib/signal_post_processor.js` — see docs/34 for the full rationale of
 * the two complementary AGC paths (offline calibrate-once via this tool
 * vs. runtime auto-level via the Normalizer chain op).
 *
 * Why a separate tool (not a `--calibrate` flag on engine.js): the
 * engine's audio bootstrap pulls in the whole runtime (CPC, mixer,
 * api_server, OSC). Calibration only needs the capture → analyzer pair.
 * Mirrors the house style of `tools/list_audio_devices.js` (a thin
 * wrapper that exercises one subsystem without the engine).
 *
 * Usage:
 *   node marsin_engine/tools/audio_calibrate.js [--seconds 10]
 *       [--device <ffmpeg-device>] [--mic <ffmpeg-device>]
 *       [--sample-rate 44100] [--fft 1024] [--hop 512]
 *
 * The tool writes NOTHING to disk (Codex P0 — diagnostics print only).
 * Run it in the QUIET room to seed `noiseGate`, then again with the
 * music playing to read the per-band ceiling for picking a gain.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { AudioCapture } from '../capture/audio_capture.js';
import { AudioAnalyzer } from '../analyzer/audio_analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Defaults (mirror config.yaml audio.* seeds) ─────────────────────────────
// Kept in sync with marsin_engine/config.yaml. We do NOT read config.yaml
// here: calibration runs the analyzer with its DOCUMENTED defaults so the
// observed numbers are reproducible across machines regardless of a local
// config drift. If an operator has retuned bands/kick in config, they can
// pass --fft / --hop / --sample-rate, but the band edges intentionally use
// the shipped defaults (the gate suggestion is about the room, not the
// band split).
const DEFAULTS = Object.freeze({
  seconds:    10,
  sampleRate: 44100,
  channels:   1,
  fftSize:    1024,
  hopSize:    512,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0 },
  kick:  { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 120 },
});

// The band keys we summarize. micKick is detector output (not a level
// band), so calibration reports the three energy bands the noiseGate
// actually governs in audio_analyzer.js.
const BAND_KEYS = Object.freeze(['low', 'mid', 'high']);

// ── Pure analysis helper (unit-tested) ──────────────────────────────────────

/**
 * Summarize a list of per-hop band readings into min / median / max /
 * p90 per band, plus a suggested noiseGate.
 *
 * `samples` is an array of `{ low, mid, high }` objects (the RAW
 * post-envelope band values the analyzer emits in [0, 1]). Pure — no IO,
 * no clock, no capture — so it can be exercised in CI/headless where a
 * live mic is unavailable.
 *
 * The noiseGate suggestion is the p90 of the LOUDEST-band-per-hop floor:
 * for each hop we take the max across bands (the band most likely to
 * carry room tone), then take the 90th percentile of those across the
 * whole capture. Rationale: the analyzer's gate is a single per-band
 * floor; setting it at ~p90 of observed energy in a QUIET room rejects
 * ~90% of the ambient HVAC / mic-self-noise floor while leaving headroom
 * for real signal to clear it. The operator runs the tool in a quiet
 * room for this number; running it with music playing instead reports
 * the per-band CEILING (the max column) for picking a gain.
 *
 * @param {Array<{low:number, mid:number, high:number}>} samples
 * @returns {{
 *   hops: number,
 *   perBand: Record<string, {min:number, median:number, max:number, p90:number}>,
 *   suggestedNoiseGate: number,
 * }}
 */
export function summarizeBandSamples(samples) {
  if (!Array.isArray(samples)) {
    throw new TypeError('summarizeBandSamples: samples must be an array');
  }
  if (samples.length === 0) {
    throw new Error('summarizeBandSamples: no samples captured — was the mic silent / disconnected?');
  }

  const perBand = {};
  for (const band of BAND_KEYS) {
    const values = samples.map((s) => {
      const v = s[band];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new TypeError(`summarizeBandSamples: band "${band}" had a non-finite value (${v})`);
      }
      return v;
    });
    perBand[band] = {
      min:    _min(values),
      median: _percentile(values, 0.5),
      max:    _max(values),
      p90:    _percentile(values, 0.9),
    };
  }

  // Per-hop "loudest band" floor → p90 across the capture.
  const loudestPerHop = samples.map((s) => Math.max(s.low, s.mid, s.high));
  // Clamp into [0, 1) so the suggested gate is always a legal noiseGate
  // (audio_analyzer.js requires noiseGate in [0, 1)). A p90 of a [0,1]
  // signal can't exceed 1, but defend the boundary so a degenerate
  // all-ones capture still yields a usable (sub-1) suggestion.
  const rawGate = _percentile(loudestPerHop, 0.9);
  const suggestedNoiseGate = rawGate >= 1 ? 0.99 : (rawGate < 0 ? 0 : rawGate);

  return { hops: samples.length, perBand, suggestedNoiseGate };
}

function _min(values) {
  let m = values[0];
  for (const v of values) if (v < m) m = v;
  return m;
}

function _max(values) {
  let m = values[0];
  for (const v of values) if (v > m) m = v;
  return m;
}

/**
 * Linear-interpolated percentile over a copy of `values`. `q` in [0, 1].
 * Type-7 (the default in R / NumPy) so results match operator intuition.
 */
function _percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ── CLI arg parsing ──────────────────────────────────────────────────────────

/**
 * Parse argv into a calibration config. Pure (takes an explicit argv
 * slice) so it's testable and doesn't read process.argv implicitly.
 * Throws on a malformed flag (Codex P0 — no silent default-on-typo).
 */
export function parseArgs(argv) {
  const cfg = {
    seconds:    DEFAULTS.seconds,
    sampleRate: DEFAULTS.sampleRate,
    fftSize:    DEFAULTS.fftSize,
    hopSize:    DEFAULTS.hopSize,
    device:     null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${arg} requires a value`);
      i++;
      return v;
    };
    if (arg === '--seconds') {
      cfg.seconds = _requirePositiveNumber(arg, next());
    } else if (arg === '--device' || arg === '--mic') {
      cfg.device = next();
    } else if (arg === '--sample-rate') {
      cfg.sampleRate = _requirePositiveInt(arg, next());
    } else if (arg === '--fft') {
      cfg.fftSize = _requirePositiveInt(arg, next());
    } else if (arg === '--hop') {
      cfg.hopSize = _requirePositiveInt(arg, next());
    } else if (arg === '--help' || arg === '-h') {
      cfg.help = true;
    } else {
      throw new Error(`unknown flag "${arg}" (see --help)`);
    }
  }
  return cfg;
}

function _requirePositiveNumber(flag, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`flag ${flag} requires a positive number, got "${raw}"`);
  }
  return v;
}

function _requirePositiveInt(flag, raw) {
  const v = Number(raw);
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`flag ${flag} requires a positive integer, got "${raw}"`);
  }
  return v;
}

// ── Output formatting ────────────────────────────────────────────────────────

function fmt(v) {
  return v.toFixed(4);
}

function printSummary(summary, cfg) {
  const { perBand, hops, suggestedNoiseGate } = summary;
  console.log('');
  console.log(`  Captured ${hops} hops over ~${cfg.seconds}s.`);
  console.log('');
  console.log('  Per-band observed (RAW post-envelope, [0,1]):');
  console.log('    band   min      median   max      p90');
  for (const band of BAND_KEYS) {
    const b = perBand[band];
    console.log(
      `    ${band.padEnd(5)}  ${fmt(b.min)}   ${fmt(b.median)}   ${fmt(b.max)}   ${fmt(b.p90)}`,
    );
  }
  console.log('');
  console.log(`  Suggested bands.noiseGate (p90 of quiet-room band floor): ${fmt(suggestedNoiseGate)}`);
  console.log('    → Run this in the QUIET room to seed the gate.');
  console.log('    → Run again WITH music to read the per-band ceiling (max column) for a gain.');
  console.log('');
  console.log('  Copy-pasteable into states/<scene>/audio_state.yaml:');
  console.log('');
  console.log('    bands:');
  console.log(`      noiseGate: ${fmt(suggestedNoiseGate)}`);
  console.log('');
}

// ── Live capture orchestration ───────────────────────────────────────────────

/**
 * Boot a capture→analyzer pair, collect band readings for `seconds`,
 * then resolve the raw sample array. Rejects loudly on a capture error
 * (no mic, ffmpeg missing) — this is a diagnostic, it must fail clearly
 * rather than print a misleading all-zero summary (Codex P0).
 */
async function collectSamples(cfg) {
  const samples = [];
  let captureError = null;

  const analyzer = new AudioAnalyzer({
    sampleRate: cfg.sampleRate,
    fftSize:    cfg.fftSize,
    hopSize:    cfg.hopSize,
    bands:      DEFAULTS.bands,
    kick:       DEFAULTS.kick,
    onAnalysis: ({ low, mid, high }) => {
      samples.push({ low, mid, high });
    },
  });

  const capture = new AudioCapture({
    backend:      'ffmpeg',
    device:       cfg.device || undefined,
    sampleRate:   cfg.sampleRate,
    channels:     DEFAULTS.channels,
    frameSamples: cfg.hopSize,
    onFrame:      (int16) => analyzer.pushSamples(int16),
    onStatus:     (status) => {
      if (status.phase === 'running' && !captureError) {
        console.log(`  🎙  capturing from ${status.device} (${status.sampleRate} Hz)…`);
      }
      if (status.phase === 'error' || status.errorCode) {
        captureError = status.error || status.errorCode;
      }
    },
  });

  console.log(`  Listening for ${cfg.seconds}s — make the room representative…`);
  capture.start();

  await new Promise((resolve) => setTimeout(resolve, cfg.seconds * 1000));
  await capture.stop();

  if (samples.length === 0) {
    const why = captureError
      ? `capture error: ${captureError}`
      : 'no audio frames arrived (mic silent or disconnected?)';
    throw new Error(`calibration captured 0 hops — ${why}`);
  }
  return samples;
}

function printHelp() {
  console.log(`audio_calibrate — venue mic calibration helper

Usage:
  node marsin_engine/tools/audio_calibrate.js [options]

Options:
  --seconds <n>       Listen duration in seconds (default ${DEFAULTS.seconds}).
  --device <dev>      ffmpeg capture device (alias: --mic). Default: OS mic.
  --sample-rate <n>   Capture sample rate (default ${DEFAULTS.sampleRate}).
  --fft <n>           FFT size, power of two (default ${DEFAULTS.fftSize}).
  --hop <n>           Hop size in samples (default ${DEFAULTS.hopSize}).
  -h, --help          Show this help.

Run in the QUIET room to seed bands.noiseGate; run again with music to
read the per-band ceiling for picking a gain. Prints only — writes no files.`);
}

async function main() {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`audio_calibrate: ${err.message}`);
    process.exit(1);
  }
  if (cfg.help) {
    printHelp();
    return;
  }
  if ((cfg.fftSize & (cfg.fftSize - 1)) !== 0) {
    console.error(`audio_calibrate: --fft must be a power of two, got ${cfg.fftSize}`);
    process.exit(1);
  }

  try {
    const samples = await collectSamples(cfg);
    const summary = summarizeBandSamples(samples);
    printSummary(summary, cfg);
  } catch (err) {
    console.error(`audio_calibrate: ${err.message}`);
    process.exit(1);
  }
}

// Only run main when invoked directly (so importing the pure helpers in
// a unit test doesn't kick off a live capture).
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
