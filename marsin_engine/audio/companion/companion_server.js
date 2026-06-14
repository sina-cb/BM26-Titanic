/*
 * companion_server.js — backend for the Audio Companion app.
 *
 * ░░ HARD, UNBREAKABLE RULE ░░
 * The Audio Companion runs the engine's REAL audio DSP — it imports
 * `AudioAnalyzer` and `SignalPostProcessor` (+ the op catalog / chain
 * validator) straight from `audio/…` and processes signals THROUGH THEM.
 * It must NEVER reimplement, fork, or shadow any audio-processing logic.
 * One source of truth: whatever the engine does, the Companion does, because
 * it is the engine's code. A chain that previews here is byte-for-byte what
 * the engine will run. (See audio/README.md + engine.js.)
 *
 * What this process does:
 *   1. generates a tweakable test signal (sub/mid/high/kick/noise) → PCM,
 *   2. runs the REAL AudioAnalyzer on it → low/mid/high/kick/flux (raw),
 *   3. runs the REAL SignalPostProcessor per signal with the candidate
 *      chains the UI is editing → post,
 *   4. streams {raw, post} traces to the browser UI over WebSocket,
 *   5. validates chain edits with the engine's validateChain, and
 *   6. exports the chains as YAML — the config artifact the engine loads.
 *
 * Standalone: `node audio/companion/companion_server.js [--port 6970]`.
 * No deps beyond what marsin-engine already vendors (ws, js-yaml).
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

const SR = 44100, FFT = 1024, HOP = 512;
const MIC_SIGNALS = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];

// Sandbox gain source for the chains' Gain ops (paramKey → value). This is
// NOT audio DSP — it's the gain knob values the UI controls; the actual gain
// MATH is the engine's Gain op inside SignalPostProcessor.
const gains = Object.create(null);
for (const k of ['micLowGain', 'micMidGain', 'micHighGain', 'micKickGain', 'micFluxGain']) gains[k] = 1.0;
const paramCenter = { get: (k) => (k in gains ? gains[k] : 1.0) };

// Tweakable test-signal source (the UI edits these).
const source = {
  subLevel: 0.5, midLevel: 0.3, highLevel: 0.25,
  kickLevel: 0.8, kickHz: 2.0,           // kick hits per second
  noiseLevel: 0.02, inputGain: 1.0,
};

// Candidate chains the UI is designing (start from the engine defaults).
const chains = JSON.parse(JSON.stringify(DEFAULT_CHAINS));

// ── DSP wiring (real engine objects) ──────────────────────────────────────
const spp = new SignalPostProcessor({ paramCenter });
spp.loadChains(chains);

let latestRaw = { low: 0, mid: 0, high: 0, kick: 0, flux: 0 };
let clockMs = 0, lastMs = 0;
let seed = 0x2f6e2b1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };

const analyzer = new AudioAnalyzer({
  sampleRate: SR, fftSize: FFT, hopSize: HOP,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04, inputGain: source.inputGain },
  kick: { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 70 },
  nowFn: () => clockMs,
  onAnalysis: (r) => { latestRaw = r; },
});

let sampleCursor = 0;
function genFrame(buf) {
  for (let i = 0; i < buf.length; i++) {
    const t = (sampleCursor + i) / SR;
    let s = Math.sin(2 * Math.PI * 55 * t) * source.subLevel
          + Math.sin(2 * Math.PI * 1000 * t) * source.midLevel
          + Math.sin(2 * Math.PI * 9000 * t) * source.highLevel
          + rnd() * source.noiseLevel;
    // periodic kick burst (decaying 80 Hz)
    if (source.kickHz > 0) {
      const period = SR / source.kickHz;
      const phase = (sampleCursor + i) % period;
      if (phase < period * 0.12) {
        const env = Math.exp(-phase / (period * 0.03));
        s += Math.sin(2 * Math.PI * 80 * t) * source.kickLevel * env;
      }
    }
    buf[i] = Math.max(-1, Math.min(1, s)) * 32767;
  }
  sampleCursor += buf.length;
}

const frameBuf = new Int16Array(HOP);
const clients = new Set();

let lastInputGain = source.inputGain;
function tick() {
  clockMs += (HOP / SR) * 1000;
  // keep the analyzer's inputGain live with the source knob (only on change)
  if (source.inputGain !== lastInputGain) {
    analyzer.reconfigure({ bands: { ...analyzer.bands, inputGain: source.inputGain }, kick: analyzer.kick });
    lastInputGain = source.inputGain;
  }
  genFrame(frameBuf);
  analyzer.pushSamples(frameBuf);          // REAL analyzer → latestRaw
  const dt = lastMs === 0 ? 0 : (clockMs - lastMs) / 1000; lastMs = clockMs;
  const rawByKey = { micLow: latestRaw.low, micMid: latestRaw.mid, micHigh: latestRaw.high, micKick: latestRaw.kick, micFlux: latestRaw.flux };
  const out = { type: 'frame', t: clockMs, signals: {} };
  for (const sig of MIC_SIGNALS) {
    const raw = rawByKey[sig] ?? 0;
    const post = spp.process(sig, raw, dt);  // REAL chain
    out.signals[sig] = { raw, post };
  }
  const msg = JSON.stringify(out);
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}
setInterval(tick, Math.round((HOP / SR) * 1000));   // ~realtime hop cadence

// ── chain edit + export ───────────────────────────────────────────────────
function applyChain(signal, chain) {
  const v = validateChain(signal, chain, { paramCenter });   // engine validator
  if (!v.ok) return { ok: false, error: v.error };
  chains[signal] = v.normalized;
  spp.loadChains({ [signal]: v.normalized });                // engine loader
  return { ok: true, chain: v.normalized };
}

function exportYaml() {
  // The engine loads this under `chains:` in audio_state.yaml / a scene.
  return yaml.dump({ chains }, { lineWidth: 100 });
}

function handleMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'setSource' && m.source) { Object.assign(source, m.source); }
  else if (m.type === 'setGain' && m.key in gains) { gains[m.key] = +m.value; }
  else if (m.type === 'setChain') {
    const r = applyChain(m.signal, m.chain);
    ws.send(JSON.stringify({ type: 'chainResult', signal: m.signal, ...r }));
  } else if (m.type === 'export') {
    ws.send(JSON.stringify({ type: 'export', yaml: exportYaml() }));
  } else if (m.type === 'reset') {
    const def = JSON.parse(JSON.stringify(DEFAULT_CHAINS[m.signal] || []));
    applyChain(m.signal, def);
    ws.send(JSON.stringify({ type: 'chainResult', signal: m.signal, ok: true, chain: def }));
  }
}

// ── HTTP (serve the UI) + WS ────────────────────────────────────────────────
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/catalog') {  // the engine's op catalog + signal list, for the UI
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ signals: MIC_SIGNALS, knownSignals: KNOWN_SIGNALS, ops: opCatalog(), defaults: DEFAULT_CHAINS, source, gains }));
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
  ws.send(JSON.stringify({ type: 'hello', signals: MIC_SIGNALS, ops: opCatalog(), chains, source, gains }));
  ws.on('message', (d) => handleMessage(ws, d.toString()));
  ws.on('close', () => clients.delete(ws));
});

const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 6970; })();
server.listen(PORT, () => {
  console.log(`Audio Companion → http://localhost:${PORT}  (running the engine's real AudioAnalyzer + SignalPostProcessor)`);
});
