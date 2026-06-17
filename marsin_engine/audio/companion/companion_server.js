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
  RAW_SOURCES, SIGNAL_TYPES, FREQUENCY_OPS, FREQUENCY_ONLY_OPS, VIEW_TYPES,
  loadCompanionConfig, saveCompanionConfig, dumpCompanionConfig, validateSignal, validateView,
  parseCaptureDevice, captureDeviceString, COMPANION_CONFIG_PATH,
  resolveOscOut, oscOutTapOf, outputCpcKeyOf,
} from './companion_config.js';
import { EngineConfigLink, resolveEngineEndpoint } from './engine_config_link.js';
import { emitDerivedBpm } from './bpm_emit.js';

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

// The terminal osc_out op of a signal (the output tap), or null. Disabled taps
// do not emit. The cpcKey/address are DERIVED from the tap's `name` at the
// send site via resolveOscOut (single-name rehaul) — the op no longer carries
// an editable address.
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

// ── SIGNAL MANIFEST → engine (auto-route new signals to CaptainPad) ──────────
// Every OUTPUT signal (one whose chain ends in an osc_out tap) is advertised to
// the engine so the engine can register its CPC key and CaptainPad shows it
// automatically — and, on REMOVE, deregister it + purge modulators (engine-side).
// We POST the full current manifest on boot and on every add/remove/chain-change/
// export. Fire-and-forget + graceful: analysis NEVER blocks on this, and an
// unreachable engine (or a not-yet-built 404 endpoint) only warns ONCE rather
// than crashing — the parallel engine agent builds the receiving endpoint.
const MANIFEST_PATH = '/audio/signals/manifest';
const MANIFEST_TIMEOUT_MS = 2000;
let _manifestWarned = false;   // warn-once so a down engine doesn't spam the log
// Set true whenever a manifest POST fails (engine down / timeout) so a lost
// add/REMOVE is re-sent once the engine is reachable again. Without this, a
// signal removed while the engine was unreachable would leave a dangling
// dynamic CPC key + its modulation mapping live on the engine forever (the key
// freezes at its last value and keeps driving the modulated param). Reconciled
// on engine-link (re)connect + a slow periodic retry.
let _manifestDirty = false;

// The osc_out tap of a signal (terminal op), or null. Reused for the manifest.
function oscOutTap(sig) {
  const last = sig.chain[sig.chain.length - 1];
  return last && last.type === 'osc_out' ? last : null;
}

// Build the manifest: one entry per OUTPUT signal that maps to a DYNAMIC key.
// cpcKey falls back to the signal id when the operator hasn't named the tap yet
// (so the engine always gets a stable key); address falls back to the curated
// /marsin/audio/<key>.
//
// The engine's POST /audio/signals/manifest is for DYNAMIC keys only — a cpcKey
// that collides with a BUILT-IN curated key (micLow, micDomFreq1, audioBpm, …)
// is REFUSED with 400 (it must not shadow a curated key; api_server.js manifest
// route). The default design ships signals on exactly those built-in keys, and
// BPM rides its own always-on emit (bpm_emit.js) — none of those belong in the
// manifest. So we EXCLUDE any signal whose cpcKey is already a registered CPC
// param. The companion's paramCenter is a fresh baseline (no dynamic keys), so
// `isRegisteredKey` is true iff the key is a built-in — the exact engine gate,
// no fork.
function buildManifest() {
  const signals = [];
  for (const sig of design.signals) {
    const tap = oscOutTap(sig);
    if (!tap) continue;   // not an OUTPUT — nothing to route to the engine
    // cpcKey + address are DERIVED from the operator-facing `name` (single-name
    // rehaul). A curated name keeps its canonical engine-bound key/address; any
    // other name slug-derives. The name is also the CaptainPad-visible label.
    const { cpcKey, address } = resolveOscOut(tap.params.name);
    if (paramCenter.isRegisteredKey(cpcKey)) continue;   // built-in → engine already has it
    signals.push({ cpcKey, address, label: tap.params.name, type: sig.type });
  }
  return { signals };
}

// POST the current manifest to the engine. Fire-and-forget: never awaited by the
// analysis path; a failure warns ONCE and is otherwise swallowed (graceful).
async function pushManifest() {
  if (!engineEndpoint) return;   // pure standalone — no engine to notify
  const url = `http://${engineEndpoint.host}:${engineEndpoint.port}${MANIFEST_PATH}`;
  const body = JSON.stringify(buildManifest());
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      _manifestDirty = true;   // re-send once the engine recovers
      if (!_manifestWarned) {
        _manifestWarned = true;
        console.warn(`[companion manifest] POST ${MANIFEST_PATH} → ${res.status} (engine endpoint not ready yet?); will retry on reconnect`);
      }
      return;
    }
    _manifestWarned = false;   // recovered — allow a fresh warn if it drops again
    _manifestDirty = false;    // engine now holds the current manifest
  } catch (e) {
    _manifestDirty = true;     // re-send once the engine recovers
    if (!_manifestWarned) {
      _manifestWarned = true;
      console.warn(`[companion manifest] POST ${MANIFEST_PATH} failed: ${e && e.message} (engine unreachable; analysis unaffected; will retry on reconnect)`);
    }
  } finally {
    clearTimeout(t);
  }
}

// Periodic reconciliation: if a manifest POST was lost (engine was down at the
// time — including a REMOVAL, which would otherwise strand a dynamic key +
// modulation on the engine), re-send it as soon as the engine link is back up.
// Slow tick — adds/removes are rare and the reconnect re-push (below) covers
// the common engine-restart case; this catches a transient POST failure that
// didn't drop the WS link.
const MANIFEST_RETRY_MS = 5000;
setInterval(() => {
  if (_manifestDirty && engineLink && engineLink.connected) pushManifest();
}, MANIFEST_RETRY_MS).unref?.();

// ── BUILT-IN BPM OUTPUT (always-on) ──────────────────────────────────────────
// BPM is a DERIVED signal (DerivedSignals/BpmTracker), not a raw-source designed
// signal, so it's emitted as a first-class Companion output rather than via the
// operator's osc_out chains. The curated CPC contract maps it to the engine
// address `/marsin/audio/bpm` → CPC key `audioBpm` (2026-06-17 contract). It
// drives the engine's bpmSpeedSync, so it's a core cue — always sent, never
// operator-gated. The guard + address live in bpm_emit.js (one source of
// truth, unit-testable): only a FINITE, SANE tempo is sent; a 0 / non-finite /
// absurd BPM is dropped so the engine fails SAFE (no stale fallback) rather
// than syncing SPEED to a wrong tempo.

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

// ── Engine config link (single source of truth for SHARED audio TUNING) ──────
// The engine config is authoritative for input gain / source smoothing /
// capture device. `engineLink` (created at boot when an engine endpoint
// resolves) SUBSCRIBES to the engine's `audioConfig` broadcasts and WRITES
// the Companion's own UI changes back via PATCH /audio/config — so a change
// anywhere (CaptainPad, the engine, or this UI) reflects everywhere.
//
// Analysis stays INDEPENDENT (audio/README.md): this is an OPTIONAL enhancer
// that degrades gracefully when the engine is down. Null until boot resolves
// an endpoint AND the link is constructed.
let engineLink = null;

/**
 * Apply the engine's SHARED audio TUNING to the Companion's live analyzer.
 * Called on the engine link's seed + every `audioConfig` broadcast (the echo
 * of any PATCH, from CaptainPad, the engine, or this UI's write-through).
 *
 * Only the SHARED subset is consumed here — bands.inputGain, bands.source-
 * SmoothHz, capture.device. The Companion-ONLY signal DESIGN (signals /
 * chains / osc_out in companion_config.yaml) is untouched (task scope).
 *
 * Idempotent + loop-safe: applyInputGain/applySmooth only reconfigure the
 * analyzer + echo to UI clients; they never write back to the engine, so an
 * incoming config frame can't ping-pong. Values that didn't change are
 * skipped so we don't thrash the capture stream on an unrelated PATCH.
 */
function applyEngineSharedTuning(config) {
  if (!config || typeof config !== 'object') return;
  const bands = config.bands && typeof config.bands === 'object' ? config.bands : null;
  if (bands) {
    if (Number.isFinite(bands.inputGain) && bands.inputGain !== inputGain) {
      applyInputGain(bands.inputGain);
      broadcast({ type: 'inputGain', value: inputGain });
    }
    if (Number.isFinite(bands.sourceSmoothHz) && bands.sourceSmoothHz !== sourceSmoothHz) {
      applySmooth(bands.sourceSmoothHz);
      broadcast({ type: 'smooth', value: sourceSmoothHz });
    }
  }
  const cap = config.capture && typeof config.capture === 'object' ? config.capture : null;
  if (cap && cap.device !== undefined) applyEngineCaptureDevice(cap.device);
}

/**
 * Map the engine's `capture.device` → the Companion's SOURCE MODE (two-way
 * source sync, 2026-06-17 contract §"Source-mode sync"). CaptainPad/engine
 * switch source by PATCHing capture.device:
 *   - 'test'          → the synthetic generator   → setMode('test')
 *   - 'file:<path>'   → file replay of <path>      → setMode('file', { file })
 *   - <device-id>/''  → live mic on that device    → setMode('mic', { device })
 *     ('' / null = the default input).
 *
 * Only switch when the EFFECTIVE mode/device actually CHANGED — an unchanged
 * config echo (the engine rebroadcasts every PATCH, including our own write-
 * through) must NOT restart the source, or every echo would churn the capture
 * stream. We compare against the current { mode, configDevice, currentFile }.
 * The selection is also broadcast so the UI's source bar reflects it.
 */
function applyEngineCaptureDevice(device) {
  const target = parseCaptureDevice(device);
  if (target.mode === 'test') {
    if (mode !== 'test') { setMode('test'); broadcast({ type: 'sourceStatus', mode, status: { enabled: true } }); }
  } else if (target.mode === 'file') {
    if (mode !== 'file' || currentFile !== target.file) {
      setMode('file', { file: target.file });
    }
  } else { // mic
    const changed = mode !== 'mic' || configDevice !== target.device;
    configDevice = target.device;
    if (changed) setMode('mic', { device: configDevice });
    broadcast({ type: 'engineDevice', device: configDevice });
  }
}

/**
 * WRITE THROUGH a SHARED tuning change to the engine (single source of
 * truth), then apply locally. The engine persists + rebroadcasts, and
 * applyEngineSharedTuning reconciles on the echo. We ALSO apply locally
 * right away (optimistic) so:
 *   - the Companion stays responsive even though the PATCH is async, and
 *   - graceful degradation: if the engine is down/unreachable the local
 *     apply is the ONLY apply and analysis keeps going on the new value.
 *
 * `localApply` is a closure that applies + echoes the value to UI clients.
 * `partial` is the PATCH /audio/config body for the same change. Codex P0:
 * a failed write-through is surfaced LOUDLY (a flash to the UI), never a
 * silent swallow — the operator must know the engine didn't persist it.
 */
function writeThroughShared(localApply, partial) {
  // Optimistic local apply first — keeps the analyzer + UI snappy and is
  // the fallback path when the engine link is absent or down.
  localApply();
  if (!engineLink || !engineLink.connected) {
    // No engine to be the source of truth right now. We DID apply locally
    // (analysis never blocks), but tell the operator it's local-only so a
    // "silent-wrong" divergence can't hide (codex: fail loud on misuse).
    broadcast({ type: 'engineLink', connected: false, note: 'engine offline — tuning applied locally only' });
    return;
  }
  engineLink.patch(partial).catch((e) => {
    broadcast({ type: 'engineLink', connected: !!(engineLink && engineLink.connected), error: `PATCH failed: ${e && e.message}` });
  });
}

/**
 * WRITE THROUGH the Companion's CURRENT source to the engine as
 * `capture.device` (2026-06-17 contract §"Source-mode sync" step 2). Called
 * after an operator-initiated source switch so choosing test/mic/file (and the
 * mic device) IN the Companion reflects in CaptainPad/engine. Graceful: if the
 * engine link is down we skip the PATCH (the local switch already happened —
 * analysis never blocks) and tell the operator it's local-only so a divergence
 * can't hide silently (codex: fail loud, no silent fallback). NEVER called from
 * the engine-echo path (applyEngineCaptureDevice), so the echo can't ping-pong.
 */
function writeThroughCaptureDevice() {
  if (!engineLink || !engineLink.connected) {
    broadcast({ type: 'engineLink', connected: false, note: 'engine offline — source applied locally only' });
    return;
  }
  const device = captureDeviceString({ mode, file: currentFile, device: configDevice });
  engineLink.patch({ capture: { device } }).catch((e) => {
    broadcast({ type: 'engineLink', connected: !!(engineLink && engineLink.connected), error: `source PATCH failed: ${e && e.message}` });
  });
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

// Mirror the analyzer hop's RAW outputs into the ParamCenter under the engine's
// canonical raw-mirror keys (audio/postproc/audio_signals.js §"Raw mirrors").
// The AudioStructureDetector AND DerivedSignals (BpmTracker / NoteEstimator /
// PartyMode) OBSERVE these CPC keys each hop — they read them back from the
// ParamCenter, they are NOT handed the analyzer result directly. The Companion
// is the SOLE analyzer, so it must publish these mirrors itself or the detector
// + derived signals run on all-zeros (no onsets → audioBpm stays 0 forever →
// the DERIVED panel BPM reads "--" and nothing is emitted over OSC). One source
// of truth: the key↔analyzer-field mapping is the same RAW_SOURCES.analyzer map
// the designed signals read (ANALYZER_FIELD), no fork.
function publishRawMirrors(r) {
  paramCenter.setMany([
    { kind: 'scalar', key: 'micLowRaw',     value: r.low ?? 0 },
    { kind: 'scalar', key: 'micMidRaw',     value: r.mid ?? 0 },
    { kind: 'scalar', key: 'micHighRaw',    value: r.high ?? 0 },
    { kind: 'scalar', key: 'micKickRaw',    value: r.kick ?? 0 },
    { kind: 'scalar', key: 'micFluxRaw',    value: r.flux ?? 0 },
    { kind: 'scalar', key: 'micDomFreq1',   value: r.domFreq1 ?? 0 },
    { kind: 'scalar', key: 'micDomEnergy1', value: r.domEnergy1 ?? 0 },
    { kind: 'scalar', key: 'micDomFreq2',   value: r.domFreq2 ?? 0 },
    { kind: 'scalar', key: 'micDomEnergy2', value: r.domEnergy2 ?? 0 },
  ], 'companion');
}
function processDesignedSignals(r, dt) {
  const out = {};
  danceFromOp.dom1 = null; danceFromOp.dom2 = null;
  for (const sig of design.signals) {
    const raw = r[ANALYZER_FIELD[sig.source]] ?? 0;
    const spp = runners.get(sig.id);
    // Every designed signal owns a runner (buildRunners builds one per signal,
    // intensity or frequency). The `?? raw` is defensive only.
    const post = spp ? spp.process(PROXY_KEY, raw, dt) : raw;
    // Dom split (2026-06-17): a dom lane's freq and energy are now SEPARATE
    // signals, each emitting ONLY its own post-processed osc_out value. The freq
    // signal emits its shaped Hz; the energy signal (source rawDom1/2Energy) is an
    // ordinary intensity signal that runs its own chain on r.domEnergy1/2 and
    // emits its own post value. No more auto-paired energy emit on the freq tap.
    out[sig.id] = { raw, post };
    // A frequency signal carrying a danceMaker op IS the dance for its dom lane.
    if (sig.type === 'frequency' && hasDanceMaker(sig)) {
      if (sig.source === 'rawDom1') danceFromOp.dom1 = post;
      else if (sig.source === 'rawDom2') danceFromOp.dom2 = post;
    }
    const tap = oscOutOf(sig);
    if (tap) {
      // Each signal emits ONLY its own osc_out value to its derived address.
      sendOsc(resolveOscOut(tap.params.name).address, post);
    }
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
    // Publish the raw-mirror CPC keys BEFORE the observers tick — the detector
    // + derived signals read them back from the ParamCenter (not from `r`).
    publishRawMirrors(r);
    detector.tick(clockMs, dt);
    derived.tick(clockMs, dt);
    // BPM is a DERIVED signal (not an operator-designed osc_out tap), so the
    // Companion emits it as a built-in, always-on output right after the
    // derived-signals tick produces audioBpm → engine /marsin/audio/bpm.
    emitDerivedBpm(paramCenter, sendOsc);
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

// Add a signal from a raw source. A new signal is IMMEDIATELY an OUTPUT: it is
// born with a terminal `osc_out` tap already attached. Single-name rehaul: the
// tap carries ONE `name` (the operator-facing identifier that derives the
// cpcKey + /marsin/audio/<slug> address AND is the display label); the operator
// renames it via the name field. The default name is source-derived + a short
// uid so two signals from the same source never collide. The moment a signal is
// added it shows up in CaptainPad (pushManifest notifies the engine). Returns
// { ok, signal } | { ok:false, error }.
function addSignal(sourceId) {
  const src = RAW_SOURCES[sourceId];
  if (!src) return { ok: false, error: `unknown raw source "${sourceId}"` };
  const slug = sourceId.replace(/^raw/, '').toLowerCase();
  const id = uid(slug);
  const name = `${slug}_${Math.random().toString(36).slice(2, 6)}`;
  const sig = {
    id, label: name, source: sourceId, type: src.type, output: true,
    chain: [{ id: `${id}_out`, type: 'osc_out', enabled: true, params: { name } }],
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
  // Prune the removed signal from every view's signal list so no view holds a
  // dangling reference (which would otherwise make the config fail to export).
  // A view left with no signals is kept (empty) — the operator can re-populate
  // or remove it; we never silently delete the operator's view.
  for (const v of design.views) {
    v.signals = v.signals.filter(sid => sid !== id);
  }
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

// ── custom VIEWS (mix/share signals; viz types) ──────────────────────────────
// A view = { id, label, type, signals:[signalId...] } — a VISUALIZER instance
// that mixes a chosen subset of signals (contract §"Companion custom VIEWS").
// Views live in design.views, persist in companion_config.yaml, and travel in
// Export. validateView (the shared validator) enforces the type + that every
// referenced signal exists and matches the type's accepted signal type.
function signalTypeMap() {
  return new Map(design.signals.map(s => [s.id, s.type]));
}

function addView(label, type, signalIds) {
  const id = uid('view');
  const candidate = { id, label, type, signals: Array.isArray(signalIds) ? signalIds : [] };
  const v = validateView(candidate, signalTypeMap());
  if (!v.ok) return { ok: false, error: v.error };
  design.views.push(v.normalized);
  return { ok: true, view: v.normalized };
}

function removeView(id) {
  const i = design.views.findIndex(v => v.id === id);
  if (i === -1) return { ok: false, error: `unknown view "${id}"` };
  design.views.splice(i, 1);
  return { ok: true };
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
    viewTypes: VIEW_TYPES,
    signals: design.signals,
    views: design.views,
    osc: design.osc,
    source, gains: {}, inputGain, sourceSmoothHz,
  };
}

function handleMessage(ws, raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.type === 'setSource' && m.source) Object.assign(source, m.source);
  else if (m.type === 'setInputGain') {
    // SHARED tuning → write through to the engine (single source of truth),
    // then apply + echo locally. The engine echo reconciles via applyEngine-
    // SharedTuning; if the engine is down we still applied locally.
    const v = m.value;
    writeThroughShared(
      () => { applyInputGain(v); broadcast({ type: 'inputGain', value: inputGain }); },
      { bands: { inputGain: Math.max(0, Math.min(64, +v)) } },
    );
  }
  else if (m.type === 'setSmooth') {
    const v = m.value;
    writeThroughShared(
      () => { applySmooth(v); broadcast({ type: 'smooth', value: sourceSmoothHz }); },
      { bands: { sourceSmoothHz: Math.max(0, Math.min(22050, +v)) } },
    );
  }
  else if (m.type === 'calibrate') startCalibration();
  else if (m.type === 'diag') ws.send(JSON.stringify(diagReport()));
  else if (m.type === 'setMode') {
    // SOURCE is now fully two-way (2026-06-17 contract §"Source-mode sync"):
    // the operator's switch here runs LOCALLY right away (capture switches
    // without waiting on the engine — analysis never blocks) AND writes through
    // to the engine as `capture.device` so the choice reflects in CaptainPad/
    // engine. test → 'test'; file → 'file:<path>'; mic → the device id.
    if (m.device !== undefined) configDevice = m.device;   // remember the mic device
    setMode(m.mode, { file: m.file, device: m.device });
    writeThroughCaptureDevice();
  }
  else if (m.type === 'addSignal') {
    const res = addSignal(m.source);
    if (res.ok) { broadcast({ type: 'signals', signals: design.signals }); pushManifest(); }
    ws.send(JSON.stringify({ type: 'addResult', ...res }));
  } else if (m.type === 'removeSignal') {
    const res = removeSignal(m.id);
    // Removing a signal can prune it from views, so re-broadcast views too.
    if (res.ok) { broadcast({ type: 'signals', signals: design.signals }); broadcast({ type: 'views', views: design.views }); pushManifest(); }
    ws.send(JSON.stringify({ type: 'removeResult', id: m.id, ...res }));
  } else if (m.type === 'addView') {
    const res = addView(m.label, m.viewType, m.signals);
    if (res.ok) broadcast({ type: 'views', views: design.views });
    ws.send(JSON.stringify({ type: 'addViewResult', ...res }));
  } else if (m.type === 'removeView') {
    const res = removeView(m.id);
    if (res.ok) broadcast({ type: 'views', views: design.views });
    ws.send(JSON.stringify({ type: 'removeViewResult', id: m.id, ...res }));
  } else if (m.type === 'setChain') {
    const res = setSignalChain(m.id, m.chain);
    if (res.ok) pushManifest();   // cpcKey / address / output may have changed
    ws.send(JSON.stringify({ type: 'chainResult', id: m.id, ...res }));
  } else if (m.type === 'export') {
    ws.send(JSON.stringify({ type: 'export', yaml: exportYaml() }));
  } else if (m.type === 'exportSave') {
    try { const res = exportToDisk(); pushManifest(); ws.send(JSON.stringify({ type: 'exportSaved', ...res })); }
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
    rawSources: RAW_SOURCES, signalTypes: SIGNAL_TYPES, viewTypes: VIEW_TYPES,
    signals: design.signals, views: design.views, osc: design.osc,
    source, inputGain, sourceSmoothHz, mode, datasetsDir: DATASETS_DIR,
    device: configDevice,
    // Engine SHARED-tuning link state so the UI can show whether gain /
    // smooth / device are mirrored to the engine (single source of truth)
    // or running local-only (engine offline → graceful degradation).
    engineLink: { connected: !!(engineLink && engineLink.connected) },
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
// The companion's audio source comes from config.yaml's `companion.source`;
// its mic device is the engine's selection — `audio.capture.device` (the
// unified device the engine/CaptainPad persist), with `companion.device` as an
// explicit override. So the engine-supervised companion boots on the same mic
// the operator chose, even with engine audio disabled (Companion = sole
// analyzer). Standalone (no config) falls back to the test source. The OSC
// TARGET likewise comes from config (engine osc host/port) so we never
// hardcode where outputs go.
let configDevice = null;
// Engine API endpoint for the SHARED-tuning live sync (resolved from
// config.yaml at boot). Null only if config.yaml can't be read (pure
// standalone) — then there's no engine to sync against and the Companion
// runs fully local. The link itself reconnects in the background if the
// endpoint is set but the engine isn't up yet.
let engineEndpoint = null;
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
  // MIC selection: the engine/CaptainPad persist the operator's chosen input
  // as `audio.capture.device` (the unified device, via PATCH /audio/config),
  // so THAT is the engine's microphone selection — pass it to the Companion on
  // boot. An explicit `companion.device` override still wins if set (non-null).
  // This static read is the ONLY way to learn the device when the engine runs
  // as audio.enabled:false (Companion = sole analyzer): then GET /audio/config
  // returns 503 and the runtime seed delivers nothing, so we'd otherwise boot
  // with no mic. (When engine audio IS live, the seed/echo reconciles on top.)
  const engineCaptureDevice = cfg && cfg.audio && cfg.audio.capture
    ? cfg.audio.capture.device : undefined;
  if (comp && comp.device !== undefined && comp.device !== null) configDevice = comp.device;
  else if (engineCaptureDevice !== undefined) configDevice = engineCaptureDevice;
  // Resolve the engine API endpoint we live-sync the SHARED audio TUNING
  // against (single source of truth). Loopback default — engine + Companion
  // share the Pi (same rationale as the OSC target above).
  engineEndpoint = resolveEngineEndpoint(cfg);
  if (comp && (comp.source === 'mic' || comp.source === 'test' || comp.source === 'file')) return comp.source;
  return 'test';
}

/**
 * Construct + start the engine config link if an endpoint resolved. The link
 * SUBSCRIBES to the engine's `audioConfig` broadcasts (seeding the analyzer's
 * gain/smooth/device on connect) and is the write-through target for this
 * UI's shared-tuning changes. Optional: if the engine is never reachable the
 * Companion keeps analyzing on its local values and the link retries forever.
 */
function startEngineLink() {
  if (!engineEndpoint) return;
  engineLink = new EngineConfigLink({
    host: engineEndpoint.host,
    port: engineEndpoint.port,
    onConfig: (config) => applyEngineSharedTuning(config),
    onStatus: (connected, info) => {
      broadcast({ type: 'engineLink', connected, ...(info || {}) });
      if (connected) {
        console.log(`  🔗 engine config link UP → ${engineLink.wsUrl} (shared audio tuning synced)`);
        // Self-heal: re-advertise the OUTPUT manifest on every (re)connect so a
        // signal added/removed/renamed while the engine was down is reconciled
        // — otherwise a removal would leave a dangling dynamic key + its
        // modulation mapping driving a frozen value on the engine forever.
        pushManifest();
      } else {
        console.log(`  🔌 engine config link DOWN → ${engineLink.wsUrl} (analyzing on local tuning; reconnecting…)`);
      }
    },
  });
  engineLink.start();
}

const PORT = (() => { const i = process.argv.indexOf('--port'); return i > 0 ? parseInt(process.argv[i + 1], 10) : 6966; })();
resolveFfmpegPath('ffmpeg').then((p) => { ffmpegPath = p || 'ffmpeg'; }).catch(() => { ffmpegPath = 'ffmpeg'; }).finally(() => {
  const bootMode = applyEngineConfig();
  // Mic boot can fail with no device (e.g. headless); test is always safe and
  // the operator can switch sources live. Honor config but never crash boot.
  setMode(bootMode === 'mic' ? 'mic' : 'test', { device: configDevice });
  // Bring up the engine SHARED-tuning link AFTER the analyzer exists (the
  // onConfig callback drives applyInputGain/applySmooth on it). Reconnects
  // in the background; analysis never blocks on it.
  startEngineLink();
  server.listen(PORT, () => {
    console.log(`Audio Companion (signal designer) → http://localhost:${PORT}  → OSC ${design.osc.host}:${design.osc.port}`);
    if (engineEndpoint) {
      console.log(`     ↔ engine tuning sync: ${engineEndpoint.host}:${engineEndpoint.port} (single source of truth; degrades gracefully)`);
    }
    // Advertise the loaded design's OUTPUT signals to the engine so CaptainPad
    // shows them on boot. Fire-and-forget — warns once if the engine is down.
    pushManifest();
  });
});
