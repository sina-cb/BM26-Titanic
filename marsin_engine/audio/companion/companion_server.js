/*
 * companion_server.js — backend for the Audio Companion app.
 *
 * ░░ HARD, UNBREAKABLE RULE ░░
 * The Audio Companion runs the engine's REAL audio DSP. It imports
 * AudioAnalyzer, SignalPostProcessor, AudioStructureDetector and the
 * DominantFreqTracker (inside the analyzer) straight from `audio/…` and runs
 * the WHOLE pipeline itself. It must NEVER reimplement, fork, or shadow any
 * audio-processing logic, and it does NOT depend on a running marsin engine —
 * it reads audio and analyses it INDEPENDENTLY. Whatever the engine computes,
 * the Companion computes, because it is the same code. (See audio/README.md.)
 *
 * Audio source (chosen live from the GUI):
 *   - 'test' — a tweakable synthetic generator (sub/mid/high/kick/noise),
 *   - 'mic'  — the default system input (line/mic) via the engine's AudioCapture,
 *   - 'file' — replay an audio file via AudioCapture (file: device).
 * Whatever the source, samples flow through the SAME analyzer → per-signal
 * chains → structure detector, and the Companion streams every signal to the
 * browser: bands (raw+post), the dom-freq pair (freq+energy), and the
 * structure outputs (state / build / energy / drop-pulse / slow-zone), plus a
 * sparse dropFired event.
 *
 * Standalone: `node audio/companion/companion_server.js [--port 6973]`.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';
import yaml from 'js-yaml';

// ── THE ENGINE'S REAL AUDIO CODE (native — never reimplemented) ───────────
import { AudioAnalyzer } from '../analyzer/audio_analyzer.js';
import {
  SignalPostProcessor, KNOWN_SIGNALS, DEFAULT_CHAINS, opCatalog, validateChain,
} from '../postproc/signal_post_processor.js';
import { AudioStructureDetector } from '../detector/audio_structure_detector.js';
import { DerivedSignals } from '../signals/derived_signals.js';
import { AudioCapture } from '../capture/audio_capture.js';
import { listAudioDevices } from '../capture/audio_devices.js';
import { ParamCenter } from '../../lib/param_center.js';
import { resolveFfmpegPath } from '../../lib/ffmpeg_resolver.js';

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
const MIC_SIGNALS = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
const RAW_OF = { micLow: 'low', micMid: 'mid', micHigh: 'high', micKick: 'kick', micFlux: 'flux' };

// Real engine ParamCenter (in-memory) — the single source of truth the chains'
// Gain ops read and the detector reads/writes. Gains live here (micLowGain…).
const paramCenter = new ParamCenter(null);

// Tweakable test-signal source (the UI edits these in 'test' mode).
const source = {
  subLevel: 0.5, midLevel: 0.3, highLevel: 0.25,
  kickLevel: 0.8, kickHz: 2.0, noiseLevel: 0.02,
};
// Global software preamp (the analyzer's bands.inputGain) — applies to EVERY
// source (test/mic/file). This is the "microphone gain" the operator tunes.
let inputGain = 1.0;
// Source-stage smoothing (gentle one-pole LP on the PCM before the FFT) — a
// small default removes mic noise; 0 = off. Part of the INPUT post-proc.
let sourceSmoothHz = 12000;
// Realtime/smoothness diagnostic: measures how evenly the capture delivers
// audio frames (the "discretized packets" symptom = bursty arrival / gaps) and
// whether analysis keeps up with realtime. Reset on source switch.
const diag = { lastWall: 0, startWall: 0, frames: 0, samples: 0, deltas: [] };
function recordFrame(n) {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (diag.lastWall) { diag.deltas.push(now - diag.lastWall); if (diag.deltas.length > 4000) diag.deltas.shift(); }
  else diag.startWall = now;
  diag.lastWall = now; diag.frames++; diag.samples += n;
}
function diagReport() {
  const d = diag.deltas.slice().sort((a, b) => a - b);
  const q = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : 0);
  const mean = d.reduce((a, b) => a + b, 0) / (d.length || 1);
  const std = Math.sqrt(d.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (d.length || 1));
  const expected = (HOP / SR) * 1000;
  const elapsed = Math.max(0.001, (diag.lastWall - diag.startWall) / 1000);
  return {
    type: 'diag', mode, frames: diag.frames, elapsedSec: +elapsed.toFixed(1), expectedFrameMs: +expected.toFixed(2),
    interArrivalMs: { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +(d[d.length - 1] || 0).toFixed(2), jitterStd: +std.toFixed(2) },
    gapsOver2x: d.filter((x) => x > expected * 2).length,
    effectiveFps: +(diag.frames / elapsed).toFixed(1),
    realtimeRatio: +((diag.samples / SR) / elapsed).toFixed(3),   // ~1.0 = realtime; <1 = falling behind
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
// When the dom jumps (50→90 Hz) the dance GLIDES there smoothly via a
// critically-damped spring (position+velocity), designed for fluid visual
// generation. Width glides too. Spatial: it's a frequency the visuals can
// chase smoothly instead of snapping.
const DANCE_OMEGA = 7;   // rad/s — ~0.4 s ghostly settle, no overshoot
const dance = { f1: 0, vf1: 0, w1: 0, vw1: 0, f2: 0, vf2: 0, w2: 0, vw2: 0 };
function springStep(x, v, target, dt) {
  const k = DANCE_OMEGA * DANCE_OMEGA, c = 2 * DANCE_OMEGA;   // critically damped
  v += (k * (target - x) - c * v) * dt;
  x += v * dt;
  return [x, v];
}

// Calibration: record a section of the live input, measure its peak meter
// level, recommend a gain to reach a healthy target, then REPLAY the recorded
// section through the analyzer so the operator can confirm before/after.
const CAL_TARGET = 0.7;          // target peak band level
const CAL_MAX_MS = 5000;         // record length
const cal = { recording: false, replaying: false, chunks: [], startClock: 0, peakBand: 0, replayTimer: null };

// Candidate chains the UI designs (start from the engine defaults).
const chains = JSON.parse(JSON.stringify(DEFAULT_CHAINS));

// ── DSP wiring (real engine objects) ──────────────────────────────────────
const clients = new Set();
function broadcast(obj) { const m = JSON.stringify(obj); for (const c of clients) if (c.readyState === 1) c.send(m); }

const spp = new SignalPostProcessor({ paramCenter });
spp.loadChains(chains);
const detector = new AudioStructureDetector({
  paramCenter,
  broadcast: (msg) => { if (msg && msg.type === 'dropFired') broadcast({ type: 'dropFired', ts: msg.ts, confidence: msg.confidence }); },
  getConfig: () => ({ enabled: true }),   // Kalman drop is the default edge
});
const derived = new DerivedSignals({ paramCenter });   // BPM/party/note/switch cues

let clockMs = 0, lastMs = 0;
const analyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },   // EDM corpus-tuned (clean pulse)
  nowFn: () => clockMs,
  onAnalysis: (r) => {
    const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
    if (cal.recording) cal.peakBand = Math.max(cal.peakBand, r.low ?? 0, r.mid ?? 0, r.high ?? 0);
    const signals = {}; const writes = [];
    for (const sig of MIC_SIGNALS) {
      const raw = r[RAW_OF[sig]] ?? 0;
      const post = spp.process(sig, raw, dt);       // REAL per-signal chain
      signals[sig] = { raw, post };
      writes.push({ kind: 'scalar', key: sig, value: post }, { kind: 'scalar', key: `${sig}Raw`, value: raw });
    }
    paramCenter.setMany(writes, 'audio', 'audio:mic');
    detector.tick(clockMs, dt);                      // REAL structure detector
    derived.tick(clockMs, dt);                       // BPM / party / note / switch cues
    // Dom-freq dance: spring-glide toward the current dom freq + cluster width.
    const sdt = dt > 0 ? dt : HOP / SR;
    const w1t = Math.max(0, (r.domHi1 || 0) - (r.domLo1 || 0)), w2t = Math.max(0, (r.domHi2 || 0) - (r.domLo2 || 0));
    [dance.f1, dance.vf1] = springStep(dance.f1, dance.vf1, r.domFreq1 || 0, sdt);
    [dance.w1, dance.vw1] = springStep(dance.w1, dance.vw1, w1t, sdt);
    [dance.f2, dance.vf2] = springStep(dance.f2, dance.vf2, r.domFreq2 || 0, sdt);
    [dance.w2, dance.vw2] = springStep(dance.w2, dance.vw2, w2t, sdt);
    // Store the latest frame; a steady timer coalesces the broadcast to ~45 Hz
    // (mirrors the engine's LIVE_BUCKET_MIN_INTERVAL_MS). Mic capture delivers
    // analysis frames in BURSTS, so broadcasting every one made the UI jerky —
    // exactly the latency/jitter CaptainPad avoids by coalescing.
    latestFrame = {
      type: 'frame', t: clockMs, signals,
      dom: {
        f1: r.domFreq1, e1: r.domEnergy1, lo1: r.domLo1, hi1: r.domHi1,
        f2: r.domFreq2, e2: r.domEnergy2, lo2: r.domLo2, hi2: r.domHi2,
        danceF1: dance.f1, danceW1: dance.w1, danceF2: dance.f2, danceW2: dance.w2,
      },
      struct: {
        state: paramCenter.get('audioStructure'), build: paramCenter.get('audioBuildScore'),
        energy: paramCenter.get('audioEnergyRatio'), pulse: paramCenter.get('audioDropPulse'),
        slow: paramCenter.get('audioSlowZone'),
      },
      spectrum: Array.from(specAnalyzer.getSpectrum(SPECTRUM_BINS)),   // hi-res freq visualizer
      wave: downWave(lastPcm),                                     // audio signal (oscilloscope)
      derived: {
        bpm: paramCenter.get('audioBpm'), beat: paramCenter.get('audioBeat'),
        party: paramCenter.get('audioParty'), note: paramCenter.get('audioNote'),
        hue: paramCenter.get('audioNoteHue'),
        sp: paramCenter.get('audioSwitchPattern'), sc: paramCenter.get('audioSwitchColor'),
      },
    };
    frameDirty = true;
  },
});

// Coalesced broadcast: emit the freshest frame at a steady ~45 Hz, decoupled
// from the bursty analysis cadence (the engine/CaptainPad smoothing pattern).
// Higher-resolution FFT used ONLY for the spectrum visualizer — 4096-pt
// (~10.7 Hz/bin vs the main analyzer's 43 Hz) for finer, less-stair-stepped
// frequency granularity. Kept SEPARATE so the main analyzer stays 1024-pt and
// the bands/kick/dom/BPM remain low-latency + as-tuned. Same hop (fed the same
// frames); its onAnalysis is a no-op — we only read getSpectrum().
const specAnalyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: 4096, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  nowFn: () => clockMs, onAnalysis: () => {},
});

let latestFrame = null, frameDirty = false;
const BROADCAST_MS = 16;   // ~60 Hz, matches the UI render cadence → no stepping
setInterval(() => { if (frameDirty && latestFrame) { broadcast(latestFrame); frameDirty = false; } }, BROADCAST_MS);

// ── Audio sources ──────────────────────────────────────────────────────────
let mode = 'test';        // 'test' | 'mic' | 'file'
let testTimer = null;
let capture = null;
let ffmpegPath = 'ffmpeg';

let sampleCursor = 0, seed = 0x2f6e2b1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const frameBuf = new Int16Array(HOP);

// Spectrum + waveform visualizer data (full freq band + audio signal).
const SPECTRUM_BINS = 192, WAVE_POINTS = 128;   // finer freq granularity (hi-res specAnalyzer)
let lastPcm = new Int16Array(HOP);
const waveBuf = new Float32Array(WAVE_POINTS);
function downWave(int16) {
  // Average each segment (not decimate) → anti-aliased, smooth scope line.
  const len = int16.length, seg = len / WAVE_POINTS;
  for (let i = 0; i < WAVE_POINTS; i++) {
    const s = Math.floor(i * seg), e = Math.max(s + 1, Math.min(len, Math.floor((i + 1) * seg)));
    let sum = 0; for (let j = s; j < e; j++) sum += int16[j];
    const v = (sum / (e - s) / 32768) * inputGain;   // gain scales the scope too
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
  if (cal.replaying) return;                     // ignore live input while replaying
  if (cal.recording) {
    cal.chunks.push(int16.slice());              // copy — the capture buffer is reused
    if (clockMs - cal.startClock >= CAL_MAX_MS) { finishCalibration(); return; }
  }
  lastPcm = int16; recordFrame(int16.length);
  clockMs += (int16.length / SR) * 1000;
  specAnalyzer.pushSamples(int16);   // fill the hi-res spectrum first …
  analyzer.pushSamples(int16);       // … then the main analyzer (its onAnalysis reads getSpectrum)
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
}
function startTest() {
  testTimer = setInterval(() => { genFrame(frameBuf); pushFrame(frameBuf); }, Math.round((HOP / SR) * 1000));
}
function startCapture(device) {
  // AudioCapture can throw SYNCHRONOUSLY before ffmpeg spawns — e.g. on
  // Windows with no pinned device (`device_not_configured`). Catch it so the
  // server never dies; surface the error and push the device list so the UI
  // can prompt for a pick (like the engine's --choose_mic).
  try {
    capture = new AudioCapture({
      backend: 'ffmpeg', ffmpegPath, platform: 'auto', device: device || null,
      sampleRate: SR, channels: 1, frameSamples: HOP, loop: true,
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
  analyzer.reset(); specAnalyzer.reset(); detector.reset(); lastMs = 0;
  diag.lastWall = 0; diag.startWall = 0; diag.frames = 0; diag.samples = 0; diag.deltas.length = 0;
  mode = (next === 'mic' || next === 'file') ? next : 'test';
  if (mode === 'test') { startTest(); broadcast({ type: 'sourceStatus', mode, status: { enabled: true } }); }
  else if (mode === 'mic') startCapture(opts.device || null);
  else if (mode === 'file') startCapture(`file:${opts.file}`);
}

// ── chain edit + export ─────────────────────────────────────────────────────
function applyChain(signal, chain) {
  const v = validateChain(signal, chain, { paramCenter });
  if (!v.ok) return { ok: false, error: v.error };
  chains[signal] = v.normalized; spp.loadChains({ [signal]: v.normalized });
  return { ok: true, chain: v.normalized };
}
const exportYaml = () => yaml.dump({ chains }, { lineWidth: 100 });
const gainsSnapshot = () => Object.fromEntries(MIC_SIGNALS.map(s => [`${s}Gain`, paramCenter.get(`${s}Gain`)]));

function handleMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'setSource' && m.source) Object.assign(source, m.source);
  else if (m.type === 'setGain' && /Gain$/.test(m.key || '')) paramCenter.set(m.key, +m.value);
  else if (m.type === 'setInputGain') { applyInputGain(m.value); broadcast({ type: 'inputGain', value: inputGain }); }
  else if (m.type === 'setSmooth') { applySmooth(m.value); broadcast({ type: 'smooth', value: sourceSmoothHz }); }
  else if (m.type === 'calibrate') startCalibration();
  else if (m.type === 'diag') ws.send(JSON.stringify(diagReport()));
  else if (m.type === 'setMode') setMode(m.mode, { file: m.file, device: m.device });
  else if (m.type === 'setChain') ws.send(JSON.stringify({ type: 'chainResult', signal: m.signal, ...applyChain(m.signal, m.chain) }));
  else if (m.type === 'export') ws.send(JSON.stringify({ type: 'export', yaml: exportYaml() }));
  else if (m.type === 'reset') {
    const def = JSON.parse(JSON.stringify(DEFAULT_CHAINS[m.signal] || []));
    applyChain(m.signal, def);
    ws.send(JSON.stringify({ type: 'chainResult', signal: m.signal, ok: true, chain: def }));
  } else if (m.type === 'listDevices') {
    listAudioDevices({ ffmpegPath }).then(d => ws.send(JSON.stringify({ type: 'devices', ...d })))
      .catch(e => ws.send(JSON.stringify({ type: 'devices', devices: [], error: String(e && e.message) })));
  }
}

// ── HTTP (serve the UI) + WS ────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/catalog') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ signals: MIC_SIGNALS, knownSignals: KNOWN_SIGNALS, ops: opCatalog(), defaults: DEFAULT_CHAINS, source, gains: gainsSnapshot(), inputGain, sourceSmoothHz }));
    return;
  }
  if (p === '/browse') {  // server-side directory listing (folders + audio files)
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
  ws.send(JSON.stringify({ type: 'hello', signals: MIC_SIGNALS, ops: opCatalog(), chains, source, gains: gainsSnapshot(), inputGain, sourceSmoothHz, mode, datasetsDir: DATASETS_DIR }));
  ws.on('message', (d) => {
    try { handleMessage(ws, d.toString()); }
    catch (e) { broadcast({ type: 'sourceStatus', mode, status: { enabled: false, error: String(e && e.message) } }); }
  });
  ws.on('close', () => clients.delete(ws));
});

const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 6973; })();
resolveFfmpegPath('ffmpeg').then((p) => { ffmpegPath = p || 'ffmpeg'; }).catch(() => { ffmpegPath = 'ffmpeg'; }).finally(() => {
  setMode('test');   // boot in test mode (no device needed)
  server.listen(PORT, () => {
    console.log(`Audio Companion → http://localhost:${PORT}  (standalone: reads audio + runs the engine's real analyzer/chains/detector/dom-freq)`);
  });
});
