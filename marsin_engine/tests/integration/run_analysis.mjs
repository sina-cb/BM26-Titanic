/**
 * run_analysis.mjs — the integration harness runner.
 *
 * Instantiates the REAL audio chain exactly as engine.js wires it in its
 * analyzer `onAnalysis` callback (engine.js ~line 1339) and feeds a
 * synthetic labeled clip through it hop-by-hop:
 *
 *   AudioAnalyzer ──(low,mid,high,kick,flux)──▶ SignalPostProcessor
 *        │                                            │ (DEFAULT_CHAINS)
 *        │                                       post + raw → ParamCenter
 *        │                                            │  (*Raw mirrors)
 *        └────────────────────────────────────▶ AudioStructureDetector
 *                                            .tick(now, dt) reads *Raw keys
 *
 * It uses the REAL `lib/param_center.js` ParamCenter (no double) so the
 * `*Raw` mirror write/read path the detector consumes is exercised for
 * real, including registry clamping. The detector is enabled via its
 * `getConfig` hook (the test passes the config; defaults vs. tuned are
 * documented in the test/report).
 *
 * DETERMINISM: production passes `Date.now()` as both the analyzer's
 * `nowFn` and the detector's hop clock `now`. We replace that wall clock
 * with a synthetic monotonic clock advanced by exactly hopSize/sampleRate
 * per hop, shared between the analyzer (`nowFn`) and the detector tick, so
 * runs are byte-for-byte reproducible and independent of machine speed.
 * This matches the detector's own contract (it stamps stems-freshness on
 * whatever clock `tick()` is driven by — see audio_structure_detector.js
 * constructor note).
 *
 * Two modes per clip:
 *   - mic-only  : stems never written (the realistic file-replay case;
 *                 detector's stemsFresh is false → mic-only drop path).
 *   - stems-fed : synthetic fresh stem values matching the labels are
 *                 written to the *Raw stem keys each hop, exercising the
 *                 stems-full drop path (stemsFull gate).
 *
 * No disk audio is written here — the caller (test / CLI) generates the
 * dataset via synth_dataset.mjs. For the round-trip-through-WAV proof we
 * also expose `runClipViaWav` which writes the clip to a temp WAV using
 * wav_io.mjs and reads it back before feeding, mirroring the file-replay
 * decode path.
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import { SignalPostProcessor } from '../../audio/postproc/signal_post_processor.js';
import { AudioStructureDetector } from '../../audio/detector/audio_structure_detector.js';
import { ParamCenter } from '../../lib/param_center.js';

import { writeWavMono, readWavMono } from './wav_io.mjs';

const FFT_SIZE = 1024;   // config.yaml audio.fftSize
const HOP_SIZE = 512;    // config.yaml audio.hopSize
// config.yaml audio.bands / audio.kick (the PRODUCT defaults).
const BANDS = { lowMaxHz: 200, midMaxHz: 4000, attackMs: 8, releaseMs: 180, noiseGate: 0.04 };
const KICK  = { minHz: 50, maxHz: 110, threshold: 1.8, refractoryMs: 140, decayMs: 70 };

const STATE_NAME = { 0: 'THIN', 1: 'BUILD', 2: 'SUSTAIN' };

// Re-export the product-default analyzer params so sweeps can build "tuned"
// variants by spreading over these rather than hardcoding magic numbers.
export const DEFAULT_BANDS = BANDS;
export const DEFAULT_KICK = KICK;

/**
 * Run one clip through the real chain.
 *
 * @param {object} clip — from synth_dataset.buildDataset()
 * @param {object} opts
 * @param {'mic-only'|'stems-fed'} opts.mode
 * @param {object} opts.detectorConfig — merged into getConfig() (must
 *   include `enabled: true` to exercise the detector).
 * @returns {object} per-run record (timeline, drops, stats).
 */
export function runClip(clip, { mode, detectorConfig, chainsOverride = null, bands = BANDS, kick = KICK }) {
  if (mode !== 'mic-only' && mode !== 'stems-fed') {
    throw new Error(`runClip: mode must be 'mic-only' or 'stems-fed' (got ${mode})`);
  }
  const sampleRate = clip.sampleRate;

  // Real ParamCenter, no persistence (null statePath → no disk I/O).
  const paramCenter = new ParamCenter(null);

  // Synthetic monotonic hop clock (ms). Advanced by exactly one hop per
  // analysis; shared between analyzer nowFn and detector tick.
  let clockMs = 0;
  const hopMs = (HOP_SIZE / sampleRate) * 1000;

  const spp = new SignalPostProcessor({ paramCenter });
  // Optional chain override (A/B tuning of DEFAULT_CHAINS without touching
  // product source). loadChains validates + rejects bad blocks loudly.
  if (chainsOverride) spp.loadChains(chainsOverride);

  const broadcasts = [];
  const detector = new AudioStructureDetector({
    paramCenter,
    broadcast: (msg) => broadcasts.push(msg),
    getConfig: () => detectorConfig,
  });

  // Records.
  const timeline = [];       // [{ tMs, state }] — one row per hop
  // Per-signal series (post-chain + raw) — used by signal_metrics.mjs for
  // chain-feel (flicker / variance / pulse / kick-attack) measurement.
  // Additive: the synthetic regression guard does not assert on these.
  const signals = {
    micLow: [], micMid: [], micHigh: [], micKick: [], micFlux: [],
    micLowRaw: [], micMidRaw: [], micHighRaw: [], micKickRaw: [], micFluxRaw: [],
    tMs: [],
  };
  let lastState = null;
  let lastAnalysisAtMs = 0;
  let anyNonFinite = false;
  const finiteKeys = [
    'micLow', 'micMid', 'micHigh', 'micKick', 'micFlux',
    'micLowRaw', 'micFluxRaw',
    'audioStructure', 'audioBuildScore', 'audioEnergyRatio',
    'audioVocalsHot', 'audioDropPulse',
  ];

  // Precompute stem plan lookup for stems-fed mode.
  const stemAt = (tMs) => {
    for (const s of clip.stemsPlan) {
      if (tMs >= s.startMs && tMs < s.endMs) return s;
    }
    const last = clip.stemsPlan[clip.stemsPlan.length - 1];
    return last || { bass: 0, drums: 0, vocals: 0 };
  };

  // Wire the analyzer EXACTLY like engine.js onAnalysis.
  const analyzer = new AudioAnalyzer({
    sampleRate,
    fftSize: FFT_SIZE,
    hopSize: HOP_SIZE,
    bands,
    kick,
    nowFn: () => clockMs,
    onAnalysis: ({ low, mid, high, kick, flux }) => {
      const nowMs = clockMs;
      const dt = lastAnalysisAtMs === 0 ? 0 : Math.max(0, (nowMs - lastAnalysisAtMs) / 1000);
      lastAnalysisAtMs = nowMs;

      const lowPost  = spp.process('micLow',  low,  dt);
      const midPost  = spp.process('micMid',  mid,  dt);
      const highPost = spp.process('micHigh', high, dt);
      const kickPost = spp.process('micKick', kick, dt);
      const fluxPost = spp.process('micFlux', flux, dt);

      signals.tMs.push(nowMs);
      signals.micLow.push(lowPost);   signals.micMid.push(midPost);
      signals.micHigh.push(highPost); signals.micKick.push(kickPost);
      signals.micFlux.push(fluxPost);
      signals.micLowRaw.push(low);    signals.micMidRaw.push(mid);
      signals.micHighRaw.push(high);  signals.micKickRaw.push(kick);
      signals.micFluxRaw.push(flux);

      const writes = [
        { kind: 'scalar', key: 'micLow',     value: lowPost  },
        { kind: 'scalar', key: 'micMid',     value: midPost  },
        { kind: 'scalar', key: 'micHigh',    value: highPost },
        { kind: 'scalar', key: 'micKick',    value: kickPost },
        { kind: 'scalar', key: 'micFlux',    value: fluxPost },
        { kind: 'scalar', key: 'micLowRaw',  value: low      },
        { kind: 'scalar', key: 'micMidRaw',  value: mid      },
        { kind: 'scalar', key: 'micHighRaw', value: high     },
        { kind: 'scalar', key: 'micKickRaw', value: kick     },
        { kind: 'scalar', key: 'micFluxRaw', value: flux     },
      ];

      // stems-fed mode: inject fresh synthetic stem RAW values matching
      // the label track so the detector's stemsFull / stemsThin path runs.
      // These are written as a SEPARATE setMany so the CPC subscriber the
      // detector uses for stems-freshness sees the stem keys change (just
      // like the OSC path would in production).
      if (mode === 'stems-fed') {
        const st = stemAt(nowMs);
        paramCenter.setMany([
          { kind: 'scalar', key: 'stemsBassRaw',   value: st.bass },
          { kind: 'scalar', key: 'stemsDrumsRaw',  value: st.drums },
          { kind: 'scalar', key: 'stemsVocalsRaw', value: st.vocals },
        ], 'osc', 'osc:stems');
      }

      paramCenter.setMany(writes, 'audio', 'audio:mic');

      detector.tick(nowMs, dt);

      // Records.
      const state = paramCenter.get('audioStructure');
      timeline.push({ tMs: nowMs, state });
      lastState = state;

      for (const k of finiteKeys) {
        const v = paramCenter.get(k);
        if (typeof v !== 'number' || !Number.isFinite(v)) anyNonFinite = true;
      }
    },
  });

  // Feed PCM hop-by-hop, advancing the synthetic clock once per hop.
  // We push exactly HOP_SIZE samples at a time and bump the clock so the
  // analyzer emits one analysis per push (after the initial fill).
  const samples = clip.samples;
  for (let i = 0; i < samples.length; i += HOP_SIZE) {
    const end = Math.min(i + HOP_SIZE, samples.length);
    const chunk = samples.subarray(i, end);
    clockMs += hopMs;
    analyzer.pushSamples(chunk);
  }

  // Derive drop events + transitions from the broadcast log + timeline.
  const dropFired = broadcasts
    .filter((m) => m && m.type === 'dropFired')
    .map((m) => ({ ts: m.ts, confidence: m.confidence, buildDurationMs: m.buildDurationMs, stemsFresh: m.stemsFresh }));

  // Structure transitions (state changes over the timeline).
  const transitions = [];
  let prev = null;
  for (const row of timeline) {
    if (prev === null || row.state !== prev) {
      transitions.push({ tMs: row.tMs, from: prev === null ? null : STATE_NAME[prev], to: STATE_NAME[row.state] });
      prev = row.state;
    }
  }

  // Band/flux stats over the run (from raw mirrors — what the detector saw).
  const status = detector.getStatus();

  detector.dispose();

  return {
    name: clip.name,
    mode,
    durationMs: timeline.length ? timeline[timeline.length - 1].tMs : 0,
    hops: timeline.length,
    hopMs,
    timeline,
    signals,
    transitions,
    dropFired,
    reachedSustain: timeline.some((r) => r.state === 2),
    anyNonFinite,
    tickP99Ms: status.tickP99Ms,
    labels: clip.labels,
  };
}

/**
 * Round-trip a clip through a real WAV file (write with wav_io, read it
 * back, feed the decoded Int16 to runClip's analyzer path). Proves the
 * file-replay decode path the production `file:` capture source uses,
 * minus ffmpeg. Returns the same record shape as runClip.
 */
export function runClipViaWav(clip, opts) {
  const dir = opts.tmpDir || path.join(os.homedir(), 'tmp', 'audio_validation');
  fs.mkdirSync(dir, { recursive: true });
  const wavPath = path.join(dir, `${clip.name}.wav`);
  writeWavMono(wavPath, clip.samples, clip.sampleRate);
  const decoded = readWavMono(wavPath);
  // Feed the DECODED samples (proves the round-trip is lossless for the
  // analyzer's purposes).
  const reClip = { ...clip, samples: decoded.samples, sampleRate: decoded.sampleRate };
  const rec = runClip(reClip, opts);
  rec.viaWav = true;
  rec.wavPath = wavPath;
  return rec;
}

// ── Metrics ──────────────────────────────────────────────────────────────

/**
 * Drop precision / recall / latency for one run against its labels.
 * A detected drop MATCHES a labeled drop if it lands within
 * `toleranceMs` of the labeled time. Latency = detected − labeled (ms,
 * signed; the detector fires AFTER the labeled downbeat by design).
 */
export function dropMetrics(rec, toleranceMs = 1200) {
  const labeled = rec.labels.drops.map((d) => d.ts);
  const detected = rec.dropFired.map((d) => d.ts).sort((a, b) => a - b);

  const matchedLabels = new Set();
  const matchedDetections = new Set();
  const latencies = [];

  // Greedy nearest-match within tolerance.
  for (let di = 0; di < detected.length; di++) {
    let best = -1, bestDist = Infinity;
    for (let li = 0; li < labeled.length; li++) {
      if (matchedLabels.has(li)) continue;
      const dist = Math.abs(detected[di] - labeled[li]);
      if (dist <= toleranceMs && dist < bestDist) { best = li; bestDist = dist; }
    }
    if (best >= 0) {
      matchedLabels.add(best);
      matchedDetections.add(di);
      latencies.push(detected[di] - labeled[best]);
    }
  }

  const tp = matchedDetections.size;
  const fp = detected.length - tp;
  const fn = labeled.length - matchedLabels.size;
  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1; // no detections, no labels → 1
  const recall = (tp + fn) > 0 ? tp / (tp + fn) : 1;    // no labels → recall 1 by convention
  const meanLatencyMs = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  return {
    labeledDrops: labeled.length,
    detectedDrops: detected.length,
    tp, fp, fn,
    precision, recall,
    latencies,
    meanLatencyMs,
  };
}

/**
 * Structure-class agreement: fraction of hops whose published structure
 * class matches the labeled region for that hop's timestamp.
 */
export function structureAgreement(rec) {
  const regionAt = (tMs) => {
    for (const r of rec.labels.regions) {
      if (tMs >= r.startMs && tMs < r.endMs) return r.label;
    }
    return rec.labels.regions.length ? rec.labels.regions[rec.labels.regions.length - 1].label : null;
  };
  let agree = 0, total = 0;
  for (const row of rec.timeline) {
    const want = regionAt(row.tMs);
    if (want === null) continue;
    total++;
    if (STATE_NAME[row.state] === want) agree++;
  }
  return { agree, total, fraction: total > 0 ? agree / total : 0 };
}
