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
 * Standalone: `node audio/companion/companion_server.js [--port 6970]`.
 */
import http from 'node:http';
import fs from 'node:fs';
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
import { AudioCapture } from '../capture/audio_capture.js';
import { listAudioDevices } from '../capture/audio_devices.js';
import { ParamCenter } from '../../lib/param_center.js';
import { resolveFfmpegPath } from '../../lib/ffmpeg_resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

const SR = 44100, FFT = 1024, HOP = 512;
const MIC_SIGNALS = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
const RAW_OF = { micLow: 'low', micMid: 'mid', micHigh: 'high', micKick: 'kick', micFlux: 'flux' };

// Real engine ParamCenter (in-memory) — the single source of truth the chains'
// Gain ops read and the detector reads/writes. Gains live here (micLowGain…).
const paramCenter = new ParamCenter(null);

// Tweakable test-signal source (the UI edits these in 'test' mode).
const source = {
  subLevel: 0.5, midLevel: 0.3, highLevel: 0.25,
  kickLevel: 0.8, kickHz: 2.0, noiseLevel: 0.02, inputGain: 1.0,
};

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

let clockMs = 0, lastMs = 0;
const analyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04, inputGain: source.inputGain },
  kick: { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 70 },
  nowFn: () => clockMs,
  onAnalysis: (r) => {
    const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
    const signals = {}; const writes = [];
    for (const sig of MIC_SIGNALS) {
      const raw = r[RAW_OF[sig]] ?? 0;
      const post = spp.process(sig, raw, dt);       // REAL per-signal chain
      signals[sig] = { raw, post };
      writes.push({ kind: 'scalar', key: sig, value: post }, { kind: 'scalar', key: `${sig}Raw`, value: raw });
    }
    paramCenter.setMany(writes, 'audio', 'audio:mic');
    detector.tick(clockMs, dt);                      // REAL structure detector
    broadcast({
      type: 'frame', t: clockMs, signals,
      dom: { f1: r.domFreq1, e1: r.domEnergy1, f2: r.domFreq2, e2: r.domEnergy2 },
      struct: {
        state: paramCenter.get('audioStructure'), build: paramCenter.get('audioBuildScore'),
        energy: paramCenter.get('audioEnergyRatio'), pulse: paramCenter.get('audioDropPulse'),
        slow: paramCenter.get('audioSlowZone'),
      },
    });
  },
});

// ── Audio sources ──────────────────────────────────────────────────────────
let mode = 'test';        // 'test' | 'mic' | 'file'
let testTimer = null;
let capture = null;
let ffmpegPath = 'ffmpeg';

let sampleCursor = 0, seed = 0x2f6e2b1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
const frameBuf = new Int16Array(HOP);
let lastInputGain = source.inputGain;
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
function pushFrame(int16) { clockMs += (int16.length / SR) * 1000; analyzer.pushSamples(int16); }

function stopSource() {
  if (testTimer) { clearInterval(testTimer); testTimer = null; }
  if (capture) { try { capture.stop(); } catch { /* ignore */ } capture = null; }
}
function startTest() {
  testTimer = setInterval(() => {
    if (source.inputGain !== lastInputGain) {
      analyzer.reconfigure({ bands: { ...analyzer.bands, inputGain: source.inputGain }, kick: analyzer.kick });
      lastInputGain = source.inputGain;
    }
    genFrame(frameBuf); pushFrame(frameBuf);
  }, Math.round((HOP / SR) * 1000));
}
function startCapture(device) {
  capture = new AudioCapture({
    backend: 'ffmpeg', ffmpegPath, platform: 'auto', device: device || null,
    sampleRate: SR, channels: 1, frameSamples: HOP, loop: true,
    onFrame: (i16) => pushFrame(i16),
    onStatus: (st) => broadcast({ type: 'sourceStatus', mode, status: st }),
  });
  capture.start();
}
function setMode(next, opts = {}) {
  stopSource();
  analyzer.reset(); detector.reset(); lastMs = 0;
  mode = (next === 'mic' || next === 'file') ? next : 'test';
  if (mode === 'test') startTest();
  else if (mode === 'mic') startCapture(opts.device || null);
  else if (mode === 'file') startCapture(`file:${opts.file}`);
  broadcast({ type: 'sourceStatus', mode, status: { enabled: true } });
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
    res.end(JSON.stringify({ signals: MIC_SIGNALS, knownSignals: KNOWN_SIGNALS, ops: opCatalog(), defaults: DEFAULT_CHAINS, source, gains: gainsSnapshot() }));
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
  ws.send(JSON.stringify({ type: 'hello', signals: MIC_SIGNALS, ops: opCatalog(), chains, source, gains: gainsSnapshot(), mode }));
  ws.on('message', (d) => handleMessage(ws, d.toString()));
  ws.on('close', () => clients.delete(ws));
});

const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 6970; })();
resolveFfmpegPath('ffmpeg').then((p) => { ffmpegPath = p || 'ffmpeg'; }).catch(() => { ffmpegPath = 'ffmpeg'; }).finally(() => {
  setMode('test');   // boot in test mode (no device needed)
  server.listen(PORT, () => {
    console.log(`Audio Companion → http://localhost:${PORT}  (standalone: reads audio + runs the engine's real analyzer/chains/detector/dom-freq)`);
  });
});
