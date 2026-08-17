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
import { fileURLToPath } from 'node:url';

import { AudioAnalyzer } from '../../audio/analyzer/audio_analyzer.js';
import { buildAudioAnalyzerOptions } from '../../audio/config/audio_analysis_config.js';
import { buildRawMirrorWrites } from '../../audio/companion/audio_pipeline.js';
import { SignalPostProcessor } from '../../audio/postproc/signal_post_processor.js';
import { AudioStructureDetector } from '../../audio/detector/audio_structure_detector.js';
import { ParamCenter } from '../../lib/param_center.js';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

import { writeWavMono, readWavMono } from './wav_io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
// HERMETIC: tracked config.yaml only, never the scene-state overlay. This
// harness IS the detector gate (audio_analysis_validation, detection_metrics),
// and the overlay's live mic gain took both labelled drop clips to ZERO
// detected drops. See tests/helpers/tracked_audio_config.mjs.
const PRODUCTION_AUDIO = loadTrackedAudioAnalysisConfig(ENGINE_DIR);
const FFT_SIZE = PRODUCTION_AUDIO.fftSize;
const HOP_SIZE = PRODUCTION_AUDIO.hopSize;
const BANDS = PRODUCTION_AUDIO.bands;
const KICK = PRODUCTION_AUDIO.kick;

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
  if (sampleRate !== PRODUCTION_AUDIO.capture.sampleRate) {
    throw new Error(`runClip: sampleRate ${sampleRate} does not match production ` +
      `${PRODUCTION_AUDIO.capture.sampleRate}; decode/resample the corpus first`);
  }

  // Real ParamCenter, no persistence (null statePath → no disk I/O).
  const paramCenter = new ParamCenter(null);
  if (mode === 'stems-fed') {
    // Stem signals are Companion-manifest keys, not built-in CPC entries.
    // Reproduce the production manifest registration before feeding them;
    // otherwise setMany() correctly ignores the unknown keys and a test
    // labelled "stems-fed" silently exercises the mic-only path.
    for (const key of ['stemsBassRaw', 'stemsDrumsRaw', 'stemsVocalsRaw']) {
      paramCenter.registerDynamicLiveParam({
        key,
        label: key,
        oscAddress: `/test/${key}`,
        range: [0, 1],
      });
    }
  }

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
  // Detector OUTPUT series, one row per hop — used by the scoring/eval harness
  // (tools/detection_eval.mjs) for buildScore-vs-ramp correlation and
  // slow-zone separation. Additive: the synthetic regression guard does not
  // assert on these.
  const detectorSeries = {
    tMs: [], buildScore: [], energyRatio: [], slowZone: [], dropPulse: [], structure: [],
  };
  let lastState = null;
  let lastAnalysisAtMs = 0;
  let anyNonFinite = false;
  const finiteKeys = [
    'micLow', 'micMid', 'micHigh', 'micKick', 'micFlux',
    'micLowRaw', 'micFluxRaw',
    'audioStructure', 'audioBuildScore', 'audioEnergyRatio',
    'audioDropPulse',
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
  const analyzerConfig = {
    ...PRODUCTION_AUDIO,
    bands,
    kick,
  };
  const analyzer = new AudioAnalyzer(buildAudioAnalyzerOptions(analyzerConfig, {
    nowFn: () => clockMs,
    onAnalysis: (analysis) => {
      const { low, mid, high, kick, flux } = analysis;
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
        ...buildRawMirrorWrites(analysis),
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

      // Detector output series (post-tick CPC values for this hop).
      detectorSeries.tMs.push(nowMs);
      detectorSeries.buildScore.push(paramCenter.get('audioBuildScore'));
      detectorSeries.energyRatio.push(paramCenter.get('audioEnergyRatio'));
      detectorSeries.slowZone.push(paramCenter.get('audioSlowZone'));
      detectorSeries.dropPulse.push(paramCenter.get('audioDropPulse'));
      detectorSeries.structure.push(state);

      for (const k of finiteKeys) {
        const v = paramCenter.get(k);
        if (typeof v !== 'number' || !Number.isFinite(v)) anyNonFinite = true;
      }
    },
  }));

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
    detectorSeries,
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
 * F1 from a dropMetrics result (or any {precision, recall}).
 * Harmonic mean of precision & recall; 0 when both are 0.
 */
export function f1Score(precision, recall) {
  if (precision === null || recall === null) return null;
  const denom = precision + recall;
  return denom > 0 ? (2 * precision * recall) / denom : 0;
}

/** Pearson correlation between two equal-length numeric series. */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/**
 * BUILD-score correlation: for each labeled build ramp [start, end], correlate
 * the detector's published buildScore against a reference ramp that rises
 * linearly from 0 at `start` to 1 at `peakAtMs` (the drop). A well-behaved
 * build score tracks the riser and peaks at the drop, so a high correlation
 * means the BUILD signal is musically meaningful. Also reports whether the
 * buildScore's own peak within the ramp lands near `peakAtMs`.
 *
 * @returns {object|null} { meanCorrelation, ramps:[{correlation, peakErrMs}] }
 *   or null when the clip has no labeled build ramps.
 */
export function buildCorrelation(rec) {
  const builds = (rec.labels.build || []);
  if (!builds.length) return null;
  const ds = rec.detectorSeries;
  const ramps = [];
  for (const b of builds) {
    const xs = [], ref = [];
    let peakAtScore = -Infinity, peakAtMs = null;
    for (let i = 0; i < ds.tMs.length; i++) {
      const t = ds.tMs[i];
      if (t < b.startMs || t > b.peakAtMs) continue;
      xs.push(ds.buildScore[i]);
      const u = (t - b.startMs) / Math.max(1, b.peakAtMs - b.startMs);
      ref.push(u);
      if (ds.buildScore[i] > peakAtScore) { peakAtScore = ds.buildScore[i]; peakAtMs = t; }
    }
    const correlation = pearson(xs, ref);
    const peakErrMs = peakAtMs === null ? null : (peakAtMs - b.peakAtMs);
    ramps.push({ correlation, peakErrMs, startMs: b.startMs, peakAtMs: b.peakAtMs });
  }
  const cors = ramps.map((r) => r.correlation).filter((c) => c !== null);
  const meanCorrelation = cors.length ? cors.reduce((a, b) => a + b, 0) / cors.length : null;
  return { meanCorrelation, ramps };
}

/**
 * SLOW-ZONE separation: compares the detector's published audioSlowZone in
 * the labeled true-slow regions vs the non-slow regions. A good slow-zone
 * signal is HIGH in calm/ambient passages and LOW in drops/sustains/busy
 * bodies. Reports the two means, their margin, and a simple threshold
 * accuracy at 0.5 (hops classified slow when slowZone>0.5).
 *
 * Settling guard: the EMA needs ~SLOW_ZONE_TAU to converge, so we skip the
 * first `settleMs` of each region before measuring (a region boundary is a
 * transition, not steady state).
 *
 * @returns {object|null}
 */
export function slowZoneSeparation(rec, { threshold = 0.5, settleMs = 1500 } = {}) {
  const slowRegions = (rec.labels.slow || []);
  const ds = rec.detectorSeries;
  if (!ds.tMs.length) return null;
  const inSlow = (t) => slowRegions.some((r) => t >= r.startMs + settleMs && t < r.endMs);
  // A hop is "non-slow steady" if it's inside a non-slow region by settleMs.
  // We approximate non-slow regions as the complement: a hop that is NOT in
  // any slow region (and is past the global settle) is non-slow.
  const lastSlowEnd = slowRegions.length ? Math.max(...slowRegions.map((r) => r.endMs)) : 0;
  void lastSlowEnd;
  const inNonSlow = (t) => t > settleMs && !slowRegions.some((r) => t >= r.startMs && t < r.endMs + settleMs);
  const slowVals = [], nonSlowVals = [];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < ds.tMs.length; i++) {
    const t = ds.tMs[i], v = ds.slowZone[i];
    if (inSlow(t)) {
      slowVals.push(v);
      if (v > threshold) tp++; else fn++;
    } else if (inNonSlow(t)) {
      nonSlowVals.push(v);
      if (v > threshold) fp++; else tn++;
    }
  }
  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const slowMean = mean(slowVals), nonSlowMean = mean(nonSlowVals);
  const margin = (slowMean !== null && nonSlowMean !== null) ? slowMean - nonSlowMean : null;
  const total = tp + fp + tn + fn;
  const accuracy = total > 0 ? (tp + tn) / total : null;
  return { slowMean, nonSlowMean, margin, accuracy, tp, fp, tn, fn,
    slowHops: slowVals.length, nonSlowHops: nonSlowVals.length };
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
