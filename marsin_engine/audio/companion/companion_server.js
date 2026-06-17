/*
 * companion_server.js — backend for the Audio Companion SIGNAL DESIGNER.
 *
 * ░░ HARD, UNBREAKABLE RULE ░░
 * The Audio Companion runs the engine's REAL audio DSP. It imports
 * AudioAnalyzer, SignalPostProcessor, AudioStructureDetector and the
 * DominantFreqTracker (inside the analyzer) straight from `audio/…` and runs
 * the WHOLE pipeline itself. It must NEVER reimplement, fork, or shadow any
 * audio-processing logic, and it does NOT depend on a running marsin engine
 * for ANALYSIS — it reads audio and analyses it INDEPENDENTLY. (audio/README.md.)
 *
 * ░░ SIGNAL DESIGNER (2026-06-17 contract) ░░
 * The Companion is the SOLE analyzer. The operator DESIGNS signals here: each
 * signal picks a RAW source (an intensity band or a dom frequency) → a chain
 * of type-aware ops → a terminal `osc_out` tap. A signal whose chain contains
 * `osc_out` is an OUTPUT: every analyzer hop the Companion sends that signal's
 * POST value to the ENGINE over UDP OSC (at the config's osc.host:osc.port),
 * the engine writes it into the CPC, and CaptainPad renders it. The design
 * persists to `companion_config.yaml` (loaded on boot, written by Export).
 *
 *   intensity sources: rawLow rawMid rawHigh rawKick rawFlux  (value [0,1])
 *   frequency sources: rawDom1 rawDom2                        (value Hz)
 *
 * Intensity signals run through the engine's SignalPostProcessor (the real
 * DSP, [0,1]). Frequency signals carry Hz and run through the SAME
 * SignalPostProcessor in its 'frequency' OUTPUT MODE — the identical lpf/clamp/
 * slew math, with the final [0,1] output clamp skipped so the Hz value
 * survives (and clamp bounds may be Hz). One source of truth for the DSP, no
 * fork (codex P0). See report 202606/20260617 companion contract.
 *
 * Audio source (chosen live from the GUI, default from config):
 *   - 'test' — a tweakable synthetic generator (sub/mid/high/kick/noise),
 *   - 'mic'  — the default/system input via the engine's AudioCapture,
 *   - 'file' — replay an audio file via the BROWSER (<audio> + worklet PCM tap).
 *
 * Standalone: `node audio/companion/companion_server.js [--port 6966]`.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';
import yaml from 'js-yaml';
import * as osc from 'osc-min';

// ── THE ENGINE'S REAL AUDIO CODE (native — never reimplemented) ───────────
import { AudioAnalyzer } from '../analyzer/audio_analyzer.js';
import {
  SignalPostProcessor, KNOWN_SIGNALS, opCatalog,
  DANCE_OMEGA, danceSpringStep,
} from '../postproc/signal_post_processor.js';
import { AudioStructureDetector } from '../detector/audio_structure_detector.js';
import { DerivedSignals } from '../signals/derived_signals.js';
import { AudioCapture } from '../capture/audio_capture.js';
import { listAudioDevices } from '../capture/audio_devices.js';
import { ParamCenter } from '../../lib/param_center.js';
import { resolveFfmpegPath } from '../../lib/ffmpeg_resolver.js';
import {
  RAW_SOURCES, SIGNAL_TYPES, FREQUENCY_OPS, FREQUENCY_ONLY_OPS,
  loadCompanionConfig, saveCompanionConfig, dumpCompanionConfig, validateSignal,
  COMPANION_CONFIG_PATH,
} from './companion_config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

const SR = 44100, FFT = 1024, HOP = 512;

// Server-side file browser for the File source. Defaults to the datasets dir:
// `--datasets <dir>` / $COMPANION_DATASETS, else the corpus build dir, else $HOME.
const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.aif', '.wma']);
function resolveDatasetsDir() {
  const flagI = process.argv.indexOf('--datasets');
  const flag = flagI > 0 ? process.argv[flagI + 1] : null;
  const candidates = [flag, process.env.COMPANION_DATASETS, path.join(os.homedir(), 'tmp', 'corpus', 'built'), os.homedir()];
  for (const c of candidates) {
    if (!c) continue;
    try { if (fs.statSync(c).isDirectory()) return c; } catch { /* skip */ }
  }
  return os.homedir();
}
const DATASETS_DIR = resolveDatasetsDir();

// The analyzer field each raw source reads (intensity bands + dom freqs).
const ANALYZER_FIELD = Object.fromEntries(
  Object.entries(RAW_SOURCES).map(([id, s]) => [id, s.analyzer]),
);

// Real engine ParamCenter (in-memory) — the single source of truth the chains'
// Gain ops read and the detector reads/writes.
const paramCenter = new ParamCenter(null);

// ── Designed signals (the operator's output design) ──────────────────────────
// Loaded from companion_config.yaml on boot. Each designed signal owns a real
// SignalPostProcessor instance (the engine's DSP, unforked) holding its chain
// under a borrowed KNOWN_SIGNALS key so process() applies the exact same math.
// Intensity signals use the default [0,1] processor; FREQUENCY signals use a
// 'frequency'-mode processor — same lpf/clamp/slew math, no [0,1] output clamp
// (the Hz value survives) and Hz-valid clamp bounds. Both run through the same
// SignalPostProcessor.process() (codex P0 — one DSP, no fork).
const PROXY_KEY = KNOWN_SIGNALS[0];   // micLow — the chain-runner proxy key
let design = loadCompanionConfig();   // { osc, signals }
const runners = new Map();            // signalId -> SignalPostProcessor

function buildRunners() {
  runners.clear();
  for (const sig of design.signals) {
    // Intensity → default [0,1] processor; frequency → Hz output mode.
    const outputMode = sig.type === 'frequency' ? 'frequency' : 'intensity';
    const spp = new SignalPostProcessor({ paramCenter, outputMode });
    spp.loadChains({ [PROXY_KEY]: sig.chain });
    runners.set(sig.id, spp);
  }
}
buildRunners();

// The terminal osc_out op of a signal (the output tap), or null.
function oscOutOf(sig) {
  const op = sig.chain[sig.chain.length - 1];
  return op && op.type === 'osc_out' && op.enabled !== false ? op : null;
}

// ── OSC OUT (UDP → engine) ──────────────────────────────────────────────────
// A tiny UDP sender wrapping osc-min (an existing dep — offline-safe). Each
// analyzer hop, every OUTPUT signal's POST value is sent as a single float arg
// to its osc_out address at design.osc.host:design.osc.port. Events map to
// 1.0/0.0 scalars (NOT bang) — the engine OscListener requires a scalar arg.
const oscSock = dgram.createSocket('udp4');
oscSock.on('error', (e) => console.warn(`[companion OSC] socket error: ${e && e.message}`));
let oscSent = 0;
function sendOsc(address, value) {
  const v = Number.isFinite(value) ? value : 0;
  const buf = osc.toBuffer({ address, args: [{ type: 'float', value: v }] });
  oscSock.send(buf, design.osc.port, design.osc.host, (err) => {
    if (err) console.warn(`[companion OSC] send ${address} failed: ${err.message}`);
  });
  oscSent++;
}

// Tweakable test-signal source (the UI edits these in 'test' mode).
const source = {
  subLevel: 0.5, midLevel: 0.3, highLevel: 0.25,
  kickLevel: 0.8, kickHz: 2.0, noiseLevel: 0.02,
};
// Global software preamp (the analyzer's bands.inputGain) — applies to EVERY
// source (test/mic/file). This is the "microphone gain" the operator tunes.
let inputGain = 1.0;
// Source-stage smoothing (gentle one-pole LP on the PCM before the FFT).
let sourceSmoothHz = 12000;
// Realtime/smoothness diagnostic.
const diag = { lastWall: 0, startWall: 0, frames: 0, samples: 0, deltas: [] };
function recordFrame(n) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (diag.lastWall) { diag.deltas.push(now - diag.lastWall); if (diag.deltas.length > 4000) diag.deltas.shift(); }
  else diag.startWall = now;
  diag.lastWall = now; diag.frames++; diag.samples += n;
}
const adiag = { last: 0, deltas: [], prevLow: null, steps: [] };
function recordAnalysis(micLow) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (adiag.last) { adiag.deltas.push(now - adiag.last); if (adiag.deltas.length > 8000) adiag.deltas.shift(); }
  adiag.last = now;
  if (adiag.prevLow !== null && Number.isFinite(micLow)) {
    adiag.steps.push(Math.abs(micLow - adiag.prevLow)); if (adiag.steps.length > 8000) adiag.steps.shift();
  }
  if (Number.isFinite(micLow)) adiag.prevLow = micLow;
}
function diagReport() {
  const d = diag.deltas.slice().sort((a, b) => a - b);
  const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : 0);
  const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const std = Math.sqrt(d.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (d.length || 1));
  const expected = (HOP / SR) * 1000;
  const elapsed = Math.max(0.001, (diag.lastWall - diag.startWall) / 1000);
  const ad = adiag.deltas.slice().sort((a, b) => a - b);
  const aq = (p) => (ad.length ? ad[Math.min(ad.length - 1, Math.floor(ad.length * p))] : 0);
  const aMean = ad.reduce((a, b) => a + b, 0) / (ad.length || 1);
  const aStd = Math.sqrt(ad.reduce((a, b) => a + (b - aMean) * (b - aMean), 0) / (ad.length || 1));
  const st = adiag.steps.slice().sort((a, b) => a - b);
  const stepP95 = st.length ? st[Math.min(st.length - 1, Math.floor(st.length * 0.95))] : 0;
  return {
    type: 'diag', mode, frames: diag.frames, elapsedSec: +elapsed.toFixed(1), expectedFrameMs: +expected.toFixed(2),
    interArrivalMs: { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +(d[d.length - 1] || 0).toFixed(2), jitterStd: +std.toFixed(2) },
    gapsOver2x: d.filter((x) => x > expected * 2).length,
    analyzerHopMs: { median: +aq(0.5).toFixed(2), p95: +aq(0.95).toFixed(2), jitterStd: +aStd.toFixed(2) },
    analyzerGapsOver2x: ad.filter((x) => x > expected * 2).length,
    micLowStepP95: +stepP95.toFixed(4),
    jitter: (typeof capture !== 'undefined' && capture && capture.jitterStats) ? capture.jitterStats() : null,
    effectiveFps: +(diag.frames / elapsed).toFixed(1),
    realtimeRatio: +((diag.samples / SR) / elapsed).toFixed(3),
    oscSentTotal: oscSent,
  };
}

function applyInputGain(v) {
  inputGain = Math.max(0, Math.min(64, +v));
  analyzer.reconfigure({ bands: { ...analyzer.bands, inputGain }, kick: analyzer.kick });
  specAnalyzer.reconfigure({ bands: { ...specAnalyzer.bands, inputGain }, kick: specAnalyzer.kick });
}
function applySmooth(v) {
  sourceSmoothHz = Math.max(0, Math.min(22050, +v));
  analyzer.reconfigure({ bands: { ...analyzer.bands, sourceSmoothHz }, kick: analyzer.kick });
  specAnalyzer.reconfigure({ bands: { ...specAnalyzer.bands, sourceSmoothHz }, kick: specAnalyzer.kick });
}

// "Dom freq DANCE" — a ghostly follower of each dom freq + cluster width.
// The spring math lives in the postproc module (DANCE_OMEGA / danceSpringStep)
// so this legacy visualizer and the `danceMaker` op call the EXACT same code
// (one source of truth, no fork — codex P0; docs/37 §2.2). `springStep` is a
// thin local alias kept so the visualizer reads naturally.
const dance = { f1: 0, vf1: 0, w1: 0, vw1: 0, f2: 0, vf2: 0, w2: 0, vw2: 0 };
const springStep = (x, v, target, dt) => danceSpringStep(x, v, target, dt, DANCE_OMEGA);

// Calibration: record → measure → recommend gain → replay.
const CAL_TARGET = 0.7;
const CAL_MAX_MS = 5000;
const cal = { recording: false, replaying: false, chunks: [], startClock: 0, peakBand: 0, replayTimer: null };

// ── DSP wiring (real engine objects) ──────────────────────────────────────
const clients = new Set();
function broadcast(obj) { const m = JSON.stringify(obj); for (const c of clients) if (c.readyState === 1) c.send(m); }

const detector = new AudioStructureDetector({
  paramCenter,
  broadcast: (msg) => { if (msg && msg.type === 'dropFired') broadcast({ type: 'dropFired', ts: msg.ts, confidence: msg.confidence }); },
  getConfig: () => ({ enabled: true }),
});
const derived = new DerivedSignals({ paramCenter });

let clockMs = 0, lastMs = 0;

/**
 * Run every designed signal's chain for this analyzer hop. Returns a
 * { signalId: { raw, post } } map for the live trace + writes each OUTPUT
 * signal's POST value over OSC to the engine. BOTH intensity and frequency
 * signals run the real SignalPostProcessor — frequency runners are in Hz
 * output mode, so lpf/clamp/slew actually shape the Hz before the osc_out tap.
 */
// Operator danceMaker outputs captured this hop — the CANONICAL dance producer
// (docs/37 §2.2: the dance is now produced by the `danceMaker` op). A frequency
// signal whose chain carries a danceMaker op feeds its spring-smoothed POST Hz
// into the dom-dance visualizer, keyed by which dom source it reads. Null when
// no operator danceMaker signal exists — then the legacy default spring drives
// the orbs (so the view never goes dark).
const danceFromOp = { dom1: null, dom2: null };
const hasDanceMaker = (sig) => sig.chain.some(o => o.type === 'danceMaker' && o.enabled !== false);
function processDesignedSignals(r, dt) {
  const out = {};
  danceFromOp.dom1 = null; danceFromOp.dom2 = null;
  for (const sig of design.signals) {
    const raw = r[ANALYZER_FIELD[sig.source]] ?? 0;
    const spp = runners.get(sig.id);
    // Every designed signal owns a runner (buildRunners builds one per signal,
    // intensity or frequency). The `?? raw` is defensive only.
    const post = spp ? spp.process(PROXY_KEY, raw, dt) : raw;
    out[sig.id] = { raw, post };
    // A frequency signal carrying a danceMaker op IS the dance for its dom lane.
    if (sig.type === 'frequency' && hasDanceMaker(sig)) {
      if (sig.source === 'rawDom1') danceFromOp.dom1 = post;
      else if (sig.source === 'rawDom2') danceFromOp.dom2 = post;
    }
    const tap = oscOutOf(sig);
    if (tap) sendOsc(tap.params.address, post);
  }
  return out;
}

const analyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  nowFn: () => clockMs,
  onConditioned: (cond) => pushScope(cond),
  onAnalysis: (r) => {
    const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
    recordAnalysis(r.low ?? 0);
    if (cal.recording) cal.peakBand = Math.max(cal.peakBand, r.low ?? 0, r.mid ?? 0, r.high ?? 0);
    const signals = processDesignedSignals(r, dt);   // designed chains + OSC out
    detector.tick(clockMs, dt);
    derived.tick(clockMs, dt);
    // Dom-freq dance: spring-glide toward the current dom freq + cluster width.
    // The `danceMaker` OP is the canonical dance producer (docs/37 §2.2): when
    // an operator frequency signal carries one, its spring-smoothed POST Hz IS
    // the orb's center frequency for that lane. Absent an operator danceMaker
    // signal, the legacy default spring drives the orb (the view never blanks).
    // The window width still tracks the dom cluster width via the default spring
    // (the op smooths center Hz only, matching the doc's freqWindow center).
    const sdt = dt > 0 ? dt : HOP / SR;
    const w1t = Math.max(0, (r.domHi1 || 0) - (r.domLo1 || 0)), w2t = Math.max(0, (r.domHi2 || 0) - (r.domLo2 || 0));
    [dance.f1, dance.vf1] = springStep(dance.f1, dance.vf1, r.domFreq1 || 0, sdt);
    [dance.w1, dance.vw1] = springStep(dance.w1, dance.vw1, w1t, sdt);
    [dance.f2, dance.vf2] = springStep(dance.f2, dance.vf2, r.domFreq2 || 0, sdt);
    [dance.w2, dance.vw2] = springStep(dance.w2, dance.vw2, w2t, sdt);
    const danceF1 = danceFromOp.dom1 != null ? danceFromOp.dom1 : dance.f1;
    const danceF2 = danceFromOp.dom2 != null ? danceFromOp.dom2 : dance.f2;
    pendingFrames.push({
      type: 'frame', t: clockMs, signals,
      dom: {
        f1: r.domFreq1, e1: r.domEnergy1, lo1: r.domLo1, hi1: r.domHi1,
        f2: r.domFreq2, e2: r.domEnergy2, lo2: r.domLo2, hi2: r.domHi2,
        danceF1, danceW1: dance.w1, danceF2, danceW2: dance.w2,
        danceFromOp1: danceFromOp.dom1 != null, danceFromOp2: danceFromOp.dom2 != null,
      },
      struct: {
        state: paramCenter.get('audioStructure'), build: paramCenter.get('audioBuildScore'),
        energy: paramCenter.get('audioEnergyRatio'), pulse: paramCenter.get('audioDropPulse'),
        slow: paramCenter.get('audioSlowZone'),
      },
      spectrum: Array.from(specAnalyzer.getSpectrum(SPECTRUM_BINS)),
      wave: downWave(),
      derived: {
        bpm: paramCenter.get('audioBpm'), beat: paramCenter.get('audioBeat'),
        party: paramCenter.get('audioParty'), note: paramCenter.get('audioNote'),
        hue: paramCenter.get('audioNoteHue'),
        sp: paramCenter.get('audioSwitchPattern'), sc: paramCenter.get('audioSwitchColor'),
      },
    });
  },
});

// Higher-resolution FFT used ONLY for the spectrum visualizer.
const specAnalyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: 4096, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  nowFn: () => clockMs, onAnalysis: () => {},
});

let pendingFrames = [];
const BROADCAST_MS = 16;
setInterval(() => {
  if (pendingFrames.length > 0) {
    if (pendingFrames.length === 1) broadcast(pendingFrames[0]);
    else broadcast({ type: 'frames', frames: pendingFrames });
    pendingFrames = [];
  }
}, BROADCAST_MS);

// ── Audio sources ──────────────────────────────────────────────────────────
let mode = 'test';        // 'test' | 'mic' | 'file'
let testTimer = null;
let capture = null;
let ffmpegPath = 'ffmpeg';

// File mode is BROWSER-SOURCED (see ui/companion_app.js filePlayer).
let browserSource = false;
let currentFile = '';
let browserResid = new Int16Array(0);
function feedBrowserPcm(int16) {
  if (!browserSource) return;
  let buf = int16;
  if (browserResid.length) {
    buf = new Int16Array(browserResid.length + int16.length);
    buf.set(browserResid, 0); buf.set(int16, browserResid.length);
  }
  let off = 0;
  while (buf.length - off >= HOP) {
    pushFrame(buf.subarray(off, off + HOP));
    off += HOP;
  }
  browserResid = off < buf.length ? buf.slice(off) : new Int16Array(0);
}

let sampleCursor = 0, seed = 0x2f6e2b1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const frameBuf = new Int16Array(HOP);

const SPECTRUM_BINS = 256, WAVE_POINTS = 256;
let lastPcm = new Int16Array(HOP);
const SCOPE_SAMPLES = 4096;
const scope = new Float32Array(SCOPE_SAMPLES);
function pushScope(cond) {
  const n = cond.length;
  if (n >= SCOPE_SAMPLES) {
    for (let i = 0; i < SCOPE_SAMPLES; i++) scope[i] = cond[n - SCOPE_SAMPLES + i];
    return;
  }
  scope.copyWithin(0, n);
  const base = SCOPE_SAMPLES - n;
  for (let i = 0; i < n; i++) scope[base + i] = cond[i];
}
const waveBuf = new Float32Array(WAVE_POINTS);
function downWave() {
  const len = SCOPE_SAMPLES, seg = len / WAVE_POINTS;
  for (let i = 0; i < WAVE_POINTS; i++) {
    const s = Math.floor(i * seg), e = Math.max(s + 1, Math.min(len, Math.floor((i + 1) * seg)));
    let sum = 0; for (let j = s; j < e; j++) sum += scope[j];
    const v = sum / (e - s);
    waveBuf[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return Array.from(waveBuf);
}

function genFrame(buf) {
  for (let i = 0; i < buf.length; i++) {
    const t = (sampleCursor + i) / SR;
    let s = Math.sin(2 * Math.PI * 55 * t) * source.subLevel
          + Math.sin(2 * Math.PI * 1000 * t) * source.midLevel
          + Math.sin(2 * Math.PI * 9000 * t) * source.highLevel
          + rnd() * source.noiseLevel;
    if (source.kickHz > 0) {
      const period = SR / source.kickHz, phase = (sampleCursor + i) % period;
      if (phase < period * 0.12) s += Math.sin(2 * Math.PI * 80 * t) * source.kickLevel * Math.exp(-phase / (period * 0.03));
    }
    buf[i] = Math.max(-1, Math.min(1, s)) * 32767;
  }
  sampleCursor += buf.length;
}
function pushFrame(int16) {
  if (cal.replaying) return;
  if (cal.recording) {
    cal.chunks.push(int16.slice());
    if (clockMs - cal.startClock >= CAL_MAX_MS) { finishCalibration(); return; }
  }
  lastPcm = int16; recordFrame(int16.length);
  clockMs += (int16.length / SR) * 1000;
  specAnalyzer.pushSamples(int16);
  analyzer.pushSamples(int16);
}

// ── calibration: record → measure → recommend gain → replay ─────────────────
function startCalibration() {
  cal.recording = true; cal.replaying = false; cal.chunks = []; cal.peakBand = 0; cal.startClock = clockMs;
  broadcast({ type: 'calStatus', phase: 'recording', durationMs: CAL_MAX_MS });
}
function finishCalibration() {
  cal.recording = false;
  const peak = cal.peakBand;
  const rec = peak > 1e-3 ? inputGain * (CAL_TARGET / peak) : inputGain;
  broadcast({
    type: 'calResult', peak: +peak.toFixed(3), currentGain: +inputGain.toFixed(2),
    recommendedGain: +Math.max(0.1, Math.min(64, rec)).toFixed(2),
    seconds: +(cal.chunks.length * HOP / SR).toFixed(1),
    verdict: peak < 0.4 ? 'low — raise gain' : peak > 0.95 ? 'hot — lower gain' : 'healthy',
  });
  startReplay();
}
function startReplay() {
  if (!cal.chunks.length) return;
  cal.replaying = true; analyzer.reset(); detector.reset(); lastMs = 0;
  let i = 0;
  broadcast({ type: 'calStatus', phase: 'replaying' });
  cal.replayTimer = setInterval(() => {
    if (i >= cal.chunks.length) {
      clearInterval(cal.replayTimer); cal.replayTimer = null; cal.replaying = false;
      analyzer.reset(); detector.reset(); lastMs = 0;
      broadcast({ type: 'calStatus', phase: 'done' });
      return;
    }
    const chunk = cal.chunks[i++];
    lastPcm = chunk;
    clockMs += (chunk.length / SR) * 1000;
    specAnalyzer.pushSamples(chunk); analyzer.pushSamples(chunk);
  }, Math.round((HOP / SR) * 1000));
}

function stopSource() {
  if (testTimer) { clearInterval(testTimer); testTimer = null; }
  if (capture) { try { capture.stop(); } catch { /* ignore */ } capture = null; }
  if (cal.replayTimer) { clearInterval(cal.replayTimer); cal.replayTimer = null; }
  cal.recording = false; cal.replaying = false;
  browserSource = false; browserResid = new Int16Array(0);
}
function startTest() {
  testTimer = setInterval(() => { genFrame(frameBuf); pushFrame(frameBuf); }, Math.round((HOP / SR) * 1000));
}
function startCapture(device) {
  try {
    capture = new AudioCapture({
      backend: 'ffmpeg', ffmpegPath, platform: 'auto', device: device || null,
      sampleRate: SR, channels: 1, frameSamples: HOP, loop: true,
      captureBufferMs: 50,
      jitterBufferHops: 4,
      onFrame: (i16) => pushFrame(i16),
      onStatus: (st) => broadcast({ type: 'sourceStatus', mode, status: st }),
    });
    capture.start();
    broadcast({ type: 'sourceStatus', mode, status: { enabled: true } });
  } catch (e) {
    capture = null;
    broadcast({ type: 'sourceStatus', mode, status: { enabled: false, error: String(e && e.message), needsDevice: e && e.code === 'device_not_configured' } });
    listAudioDevices({ ffmpegPath }).then(d => broadcast({ type: 'devices', ...d })).catch(() => { /* ignore */ });
  }
}
function setMode(next, opts = {}) {
  stopSource();
  pendingFrames = [];
  analyzer.reset(); specAnalyzer.reset(); detector.reset(); lastMs = 0;
  scope.fill(0);
  diag.lastWall = 0; diag.startWall = 0; diag.frames = 0; diag.samples = 0; diag.deltas.length = 0;
  adiag.last = 0; adiag.prevLow = null; adiag.deltas.length = 0; adiag.steps.length = 0;
  mode = (next === 'mic' || next === 'file') ? next : 'test';
  if (mode === 'test') { startTest(); broadcast({ type: 'sourceStatus', mode, status: { enabled: true } }); }
  else if (mode === 'mic') startCapture(opts.device != null ? opts.device : configDevice);
  else if (mode === 'file') {
    if (!opts.file) { broadcast({ type: 'sourceStatus', mode, status: { enabled: false, error: 'no file selected' } }); return; }
    currentFile = opts.file;
    browserSource = true;
    broadcast({ type: 'sourceStatus', mode, status: { enabled: true, browser: true, file: currentFile } });
  }
}

// ── signal management + chain edit + export ─────────────────────────────────
function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 7)}`; }

// Add a signal from a raw source. The signal starts as source → osc_out tap
// (an OUTPUT). Returns { ok, signal } or { ok:false, error }.
function addSignal(sourceId) {
  const src = RAW_SOURCES[sourceId];
  if (!src) return { ok: false, error: `unknown raw source "${sourceId}"` };
  const id = uid(sourceId.replace(/^raw/, '').toLowerCase());
  const label = src.label;
  const address = src.type === 'frequency' ? '/marsin/dom/custom' : '/marsin/audio/custom';
  const sig = {
    id, label, source: sourceId, type: src.type, output: true,
    chain: [{ id: `${id}_out`, type: 'osc_out', enabled: true, params: { address } }],
  };
  const v = validateSignal(sig);
  if (!v.ok) return { ok: false, error: v.error };
  design.signals.push(v.normalized);
  buildRunners();
  return { ok: true, signal: v.normalized };
}

function removeSignal(id) {
  const i = design.signals.findIndex(s => s.id === id);
  if (i === -1) return { ok: false, error: `unknown signal "${id}"` };
  design.signals.splice(i, 1);
  buildRunners();
  return { ok: true };
}

function setSignalChain(id, chain) {
  const sig = design.signals.find(s => s.id === id);
  if (!sig) return { ok: false, error: `unknown signal "${id}"` };
  const candidate = { ...sig, chain };
  const v = validateSignal(candidate);
  if (!v.ok) return { ok: false, error: v.error };
  sig.chain = v.normalized.chain;
  sig.output = v.normalized.output;
  buildRunners();
  return { ok: true, signal: v.normalized };
}

const exportYaml = () => dumpCompanionConfig(design);
function exportToDisk() {
  saveCompanionConfig(design, COMPANION_CONFIG_PATH);
  return { ok: true, path: COMPANION_CONFIG_PATH };
}

// Catalog the UI needs: ops (with per-type filtering data), raw sources, the
// designed signal list, and the engine OSC target.
function catalog() {
  return {
    ops: opCatalog(),
    frequencyOps: FREQUENCY_OPS,
    frequencyOnlyOps: FREQUENCY_ONLY_OPS,
    rawSources: RAW_SOURCES,
    signalTypes: SIGNAL_TYPES,
    signals: design.signals,
    osc: design.osc,
    source, gains: {}, inputGain, sourceSmoothHz,
  };
}

function handleMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'setSource' && m.source) Object.assign(source, m.source);
  else if (m.type === 'setInputGain') { applyInputGain(m.value); broadcast({ type: 'inputGain', value: inputGain }); }
  else if (m.type === 'setSmooth') { applySmooth(m.value); broadcast({ type: 'smooth', value: sourceSmoothHz }); }
  else if (m.type === 'calibrate') startCalibration();
  else if (m.type === 'diag') ws.send(JSON.stringify(diagReport()));
  else if (m.type === 'setMode') setMode(m.mode, { file: m.file, device: m.device });
  else if (m.type === 'addSignal') {
    const res = addSignal(m.source);
    if (res.ok) broadcast({ type: 'signals', signals: design.signals });
    ws.send(JSON.stringify({ type: 'addResult', ...res }));
  } else if (m.type === 'removeSignal') {
    const res = removeSignal(m.id);
    if (res.ok) broadcast({ type: 'signals', signals: design.signals });
    ws.send(JSON.stringify({ type: 'removeResult', id: m.id, ...res }));
  } else if (m.type === 'setChain') {
    const res = setSignalChain(m.id, m.chain);
    ws.send(JSON.stringify({ type: 'chainResult', id: m.id, ...res }));
  } else if (m.type === 'export') {
    ws.send(JSON.stringify({ type: 'export', yaml: exportYaml() }));
  } else if (m.type === 'exportSave') {
    try { const res = exportToDisk(); ws.send(JSON.stringify({ type: 'exportSaved', ...res })); }
    catch (e) { ws.send(JSON.stringify({ type: 'exportSaved', ok: false, error: String(e && e.message) })); }
  } else if (m.type === 'listDevices') {
    listAudioDevices({ ffmpegPath }).then(d => ws.send(JSON.stringify({ type: 'devices', ...d })))
      .catch(e => ws.send(JSON.stringify({ type: 'devices', devices: [], error: String(e && e.message) })));
  }
}

// ── HTTP (serve the UI) + WS ────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const MIME_AUDIO = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff', '.wma': 'audio/x-ms-wma',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/catalog') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(catalog()));
    return;
  }
  if (p === '/file') {
    const fp = new URL(req.url, 'http://x').searchParams.get('path') || '';
    if (!fp || !AUDIO_EXT.has(path.extname(fp).toLowerCase())) { res.writeHead(400); res.end('bad file'); return; }
    fs.stat(fp, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      const total = st.size;
      const type = MIME_AUDIO[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (Number.isNaN(start) || start < 0) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
        if (start > end) { res.writeHead(416, { 'content-range': `bytes */${total}` }); res.end(); return; }
        res.writeHead(206, {
          'content-type': type, 'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1,
        });
        fs.createReadStream(fp, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': total });
        fs.createReadStream(fp).pipe(res);
      }
    });
    return;
  }
  if (p === '/browse') {
    const dir = new URL(req.url, 'http://x').searchParams.get('dir') || DATASETS_DIR;
    fs.readdir(dir, { withFileTypes: true }, (err, ents) => {
      res.writeHead(err ? 400 : 200, { 'content-type': 'application/json' });
      if (err) { res.end(JSON.stringify({ error: String(err.message), dir })); return; }
      const entries = [];
      for (const e of ents) {
        const isDir = e.isDirectory();
        if (!isDir && !AUDIO_EXT.has(path.extname(e.name).toLowerCase())) continue;
        if (e.name.startsWith('.')) continue;
        entries.push({ name: e.name, path: path.join(dir, e.name), isDir });
      }
      entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
      res.end(JSON.stringify({ dir, parent: path.dirname(dir), entries }));
    });
    return;
  }
  const file = path.join(UI_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(UI_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'hello',
    ops: opCatalog(), frequencyOps: FREQUENCY_OPS, frequencyOnlyOps: FREQUENCY_ONLY_OPS,
    rawSources: RAW_SOURCES, signalTypes: SIGNAL_TYPES,
    signals: design.signals, osc: design.osc,
    source, inputGain, sourceSmoothHz, mode, datasetsDir: DATASETS_DIR,
    device: configDevice,
  }));
  ws.on('message', (d, isBinary) => {
    if (isBinary) {
      try {
        const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
        const n = buf.length >> 1;
        const i16 = new Int16Array(n);
        for (let i = 0; i < n; i++) i16[i] = buf.readInt16LE(i * 2);
        feedBrowserPcm(i16);
      } catch (e) { /* drop a malformed PCM frame; never crash the source */ }
      return;
    }
    try { handleMessage(ws, d.toString()); }
    catch (e) { broadcast({ type: 'sourceStatus', mode, status: { enabled: false, error: String(e && e.message) } }); }
  });
  ws.on('close', () => clients.delete(ws));
});

// ── Boot ─────────────────────────────────────────────────────────────────────
// The companion's audio source + device come from config.yaml's `companion`
// block when present (the unified device the engine/CaptainPad also set), so
// the engine-supervised companion honors the same device. Standalone falls
// back to the test source. The OSC TARGET likewise comes from config (engine
// osc host/port) so we never hardcode where outputs go.
let configDevice = null;
function applyEngineConfig() {
  const cfgPath = path.join(__dirname, '..', '..', 'config.yaml');
  let cfg;
  try { cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8')); }
  catch { return 'test'; }   // standalone (no engine config) → boot in test
  const comp = cfg && cfg.companion;
  if (comp && comp.osc && typeof comp.osc.host === 'string' && Number.isInteger(comp.osc.port)) {
    design.osc = { host: comp.osc.host, port: comp.osc.port };
  } else if (cfg && cfg.osc && Number.isInteger(cfg.osc.port)) {
    // Fall back to the engine's own OSC port; loopback host (the companion and
    // engine run on the same Pi). osc.host in config is the engine BIND addr
    // (0.0.0.0) — not a send target — so we send to loopback.
    design.osc = { host: '127.0.0.1', port: cfg.osc.port };
  }
  if (comp && comp.device !== undefined) configDevice = comp.device;
  if (comp && (comp.source === 'mic' || comp.source === 'test' || comp.source === 'file')) return comp.source;
  return 'test';
}

const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 6966; })();
resolveFfmpegPath('ffmpeg').then((p) => { ffmpegPath = p || 'ffmpeg'; }).catch(() => { ffmpegPath = 'ffmpeg'; }).finally(() => {
  const bootMode = applyEngineConfig();
  // Mic boot can fail with no device (e.g. headless); test is always safe and
  // the operator can switch sources live. Honor config but never crash boot.
  setMode(bootMode === 'mic' ? 'mic' : 'test', { device: configDevice });
  server.listen(PORT, () => {
    console.log(`Audio Companion (signal designer) → http://localhost:${PORT}  → OSC ${design.osc.host}:${design.osc.port}`);
  });
});
