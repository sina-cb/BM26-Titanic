/**
 * detection_eval.mjs — the detection SCORING / EVAL harness.
 *
 * Scores the AudioStructureDetector's DROP, BUILD, and SLOW-ZONE outputs
 * against KNOWN ground-truth labels on the richer synthetic scenarios
 * (tests/integration/detector_scenarios.mjs), degraded through the virtual
 * playa mic (tests/integration/mic_model.mjs) at each SNR tier. It is the
 * deliverable scoring tool the operator asked for ("scoring of detections").
 *
 * WHAT IT MEASURES (per detector config, aggregated over scenarios × tiers):
 *   DROP  — precision / recall / F1 + mean latency (ms) against labeled drop
 *           instants, plus spurious drops on the negative (no-drop) clips.
 *   BUILD — mean Pearson correlation of the published buildScore against the
 *           true build ramp (rises across the riser, peaks at the drop), plus
 *           the buildScore-peak timing error vs the true drop.
 *   SLOW  — mean audioSlowZone in true-slow regions vs non-slow regions, the
 *           separation margin, and threshold accuracy at 0.5.
 *
 * OUTPUTS:
 *   - a machine-readable JSON score file (--out, default ~/tmp/detection_eval/eval.json)
 *   - a human-readable summary table on stdout
 *   - a per-scenario HTML overlay (detector outputs vs labels) under
 *     ~/tmp/detection_eval/overlays/ (open in a browser to eyeball the traces)
 *
 * USAGE (run from marsin_engine/):
 *   node tools/detection_eval.mjs                       # baseline vs tuned, all tiers
 *   node tools/detection_eval.mjs --config tuned        # one named config only
 *   node tools/detection_eval.mjs --tiers moderate      # one tier
 *   node tools/detection_eval.mjs --out ~/tmp/eval.json --overlays
 *
 * Named configs come from the CONFIGS map below; pass --config <name>[,<name>]
 * to restrict, or supply --json '<{...}>' for an ad-hoc detector config.
 *
 * Codex P0 — NO FALLBACKS: an unknown tier / config name / synth throws.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildScenarios } from '../tests/integration/detector_scenarios.mjs';
import { applyMicModel } from '../tests/integration/mic_model.mjs';
import {
  runClip, dropMetrics, f1Score, buildCorrelation, slowZoneSeparation,
} from '../tests/integration/run_analysis.mjs';
import { TUNED_DETECTOR } from '../tests/integration/tuning_configs.mjs';

const ALL_TIERS = ['clean', 'moderate', 'heavy'];
const MIC_SEED = 0x5EED;
const DROP_TOLERANCE_MS = 1200;

// Drop-bearing vs negative (no-drop) scenarios. Negatives must fire ~0 drops.
const POSITIVES = new Set(['full_arc', 'single_drop_long']);
const NEGATIVES = new Set(['ambient_long', 'techno_steady', 'false_build_long', 'sustain_then_slow']);

// Named detector configs to compare. `enabled` is forced on by the runner.
// baseline = the ORIGINALLY-shipped level edge; default = the current shipped
// DETECTOR_DEFAULTS (windowed); the rest are tuning candidates.
const CONFIGS = {
  baseline: { dropEdgeMode: 'level', eventRefractoryMs: 2000 },
  default:  {},                                  // DETECTOR_DEFAULTS as shipped
  tuned:    { ...TUNED_DETECTOR },               // the candidate (from tuning_configs)
};

function fmt(x, d = 2) { return (x === null || x === undefined) ? ' — ' : Number(x).toFixed(d); }

function resolveHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/**
 * Run one detector config over the whole scenario set × tiers and aggregate.
 * @returns {object} { drop:{precision,recall,f1,meanLatencyMs,tp,fp,fn,negFp,
 *                            guardedPrecision,falseFiresPerMin,negDurationMs},
 *                     build:{meanCorrelation,meanPeakErrMs},
 *                     slow:{meanMargin,meanAccuracy,meanSlow,meanNonSlow},
 *                     perScenario:{...}, perTier:{...} }
 */
export function evalConfig(detectorConfig, { tiers = ALL_TIERS, scenarios = null, quiet = true } = {}) {
  const ds = scenarios || buildScenarios();
  const cfg = { enabled: true, ...detectorConfig };

  // The detector emits operator-facing diagnostic logs on every transition /
  // drop. During a batch scoring run that is pure noise drowning the metrics,
  // so we silence console.log for the duration (restored in finally). This is
  // a TOOL-side display choice; the production logging behavior is untouched.
  const origLog = console.log;
  if (quiet) console.log = () => {};
  try {
    return _evalConfigInner(ds, cfg, tiers);
  } finally {
    console.log = origLog;
  }
}

function _evalConfigInner(ds, cfg, tiers) {

  const agg = {
    tp: 0, fp: 0, fn: 0, lat: [], negFp: 0, negDurationMs: 0,
    buildCors: [], buildPeakErrs: [],
    slowMargins: [], slowAccs: [], slowMeans: [], nonSlowMeans: [],
  };
  const perTier = {};
  const perScenario = {};

  for (const tier of tiers) {
    perTier[tier] = { tp: 0, fp: 0, fn: 0, negFp: 0, negDurationMs: 0, buildCors: [], slowMargins: [] };
    for (const clip of ds) {
      const deg = applyMicModel(clip.samples, clip.sampleRate, { tier, seed: MIC_SEED });
      const micClip = { ...clip, samples: deg.samples };
      // Positives use the high-confidence stems-fed path (a real drop has full
      // stems); negatives use the realistic mic-only path.
      const mode = POSITIVES.has(clip.name) ? 'stems-fed' : 'mic-only';
      const rec = runClip(micClip, { mode, detectorConfig: cfg });

      const sKey = `${clip.name}@${tier}`;
      const entry = { tier, scenario: clip.name, mode };

      // DROP scoring.
      if (POSITIVES.has(clip.name)) {
        const dm = dropMetrics(rec, DROP_TOLERANCE_MS);
        agg.tp += dm.tp; agg.fp += dm.fp; agg.fn += dm.fn;
        perTier[tier].tp += dm.tp; perTier[tier].fp += dm.fp; perTier[tier].fn += dm.fn;
        for (const l of dm.latencies) agg.lat.push(l);
        entry.drop = { tp: dm.tp, fp: dm.fp, fn: dm.fn, meanLatencyMs: dm.meanLatencyMs };
      } else {
        const spurious = rec.dropFired.length;
        agg.negFp += spurious; perTier[tier].negFp += spurious;
        // Accumulate the duration of non-drop audio so falseFiresPerMin has a
        // real denominator (phantom drops per MINUTE of calm/steady music, not
        // a per-clip count that hides how much audio it took to false-fire).
        agg.negDurationMs += rec.durationMs;
        perTier[tier].negDurationMs += rec.durationMs;
        entry.drop = { negFp: spurious, negDurationMs: rec.durationMs };
      }

      // BUILD correlation (only on clips with labeled build ramps).
      const bc = buildCorrelation(rec);
      if (bc && bc.meanCorrelation !== null) {
        agg.buildCors.push(bc.meanCorrelation);
        perTier[tier].buildCors.push(bc.meanCorrelation);
        for (const r of bc.ramps) if (r.peakErrMs !== null) agg.buildPeakErrs.push(r.peakErrMs);
        entry.build = { meanCorrelation: bc.meanCorrelation, ramps: bc.ramps };
      }

      // SLOW-ZONE separation (clips that carry slow labels).
      const sz = slowZoneSeparation(rec);
      if (sz && sz.margin !== null) {
        agg.slowMargins.push(sz.margin); perTier[tier].slowMargins.push(sz.margin);
        if (sz.accuracy !== null) agg.slowAccs.push(sz.accuracy);
        if (sz.slowMean !== null) agg.slowMeans.push(sz.slowMean);
        if (sz.nonSlowMean !== null) agg.nonSlowMeans.push(sz.nonSlowMean);
        entry.slow = sz;
      }

      perScenario[sKey] = entry;
    }
  }

  const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const precision = (agg.tp + agg.fp) > 0 ? agg.tp / (agg.tp + agg.fp) : null;
  const recall = (agg.tp + agg.fn) > 0 ? agg.tp / (agg.tp + agg.fn) : null;
  // HONEST metrics (additive — the original precision/recall/f1 above are
  // UNCHANGED). The positive-only precision can read 1.00 while the detector
  // still false-fires on calm/steady NEGATIVE clips, because those phantom
  // drops (negFp) are excluded above. Fold them in here so a tuning pass
  // cannot hide false-fires on the dance floor:
  //   guardedPrecision = tp / (tp + fp + negFp)  — every spurious drop, on a
  //     positive OR a negative clip, counts against precision.
  //   falseFiresPerMin = negFp / minutes-of-non-drop-audio — the headline
  //     dance-floor safety number (a phantom drop on calm music is the worst
  //     failure), normalized so it is comparable across scenario-set sizes.
  const guardedDenom = agg.tp + agg.fp + agg.negFp;
  const guardedPrecision = guardedDenom > 0 ? agg.tp / guardedDenom : null;
  const negMinutes = agg.negDurationMs / 60000;
  const falseFiresPerMin = negMinutes > 0 ? agg.negFp / negMinutes : null;
  return {
    drop: {
      precision, recall, f1: f1Score(precision, recall),
      meanLatencyMs: mean(agg.lat), tp: agg.tp, fp: agg.fp, fn: agg.fn, negFp: agg.negFp,
      guardedPrecision, falseFiresPerMin, negDurationMs: agg.negDurationMs,
    },
    build: { meanCorrelation: mean(agg.buildCors), meanPeakErrMs: mean(agg.buildPeakErrs) },
    slow: { meanMargin: mean(agg.slowMargins), meanAccuracy: mean(agg.slowAccs),
      meanSlow: mean(agg.slowMeans), meanNonSlow: mean(agg.nonSlowMeans) },
    perTier, perScenario,
  };
}

// ── HTML overlay (detector outputs vs labels) ─────────────────────────────

function overlayHtml(rec, clipName) {
  const ds = rec.detectorSeries;
  const W = 1000, H = 260, padL = 50, padR = 10, padT = 24, padB = 28;
  const t0 = ds.tMs[0] || 0;
  const t1 = ds.tMs[ds.tMs.length - 1] || 1;
  const xOf = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const yOf = (v) => padT + (1 - Math.max(0, Math.min(1, v))) * (H - padT - padB);
  const poly = (series) => ds.tMs.map((t, i) => `${xOf(t).toFixed(1)},${yOf(series[i]).toFixed(1)}`).join(' ');
  // Region bands.
  const bands = [];
  for (const r of (rec.labels.regions || [])) {
    const color = r.label === 'SUSTAIN' ? '#3a2a10' : r.label === 'BUILD' ? '#1a2e1a' : '#101422';
    bands.push(`<rect x="${xOf(r.startMs).toFixed(1)}" y="${padT}" width="${(xOf(r.endMs) - xOf(r.startMs)).toFixed(1)}" height="${H - padT - padB}" fill="${color}"/>`);
  }
  // Slow zones (hatched overlay).
  const slow = (rec.labels.slow || []).map((r) =>
    `<rect x="${xOf(r.startMs).toFixed(1)}" y="${padT}" width="${(xOf(r.endMs) - xOf(r.startMs)).toFixed(1)}" height="${H - padT - padB}" fill="#2244aa" opacity="0.18"/>`).join('');
  // True drop markers.
  const drops = (rec.labels.drops || []).map((d) =>
    `<line x1="${xOf(d.ts).toFixed(1)}" y1="${padT}" x2="${xOf(d.ts).toFixed(1)}" y2="${H - padB}" stroke="#ff4060" stroke-width="2"/>`).join('');
  // Detected drops.
  const fired = rec.dropFired.map((d) =>
    `<line x1="${xOf(d.ts).toFixed(1)}" y1="${padT}" x2="${xOf(d.ts).toFixed(1)}" y2="${H - padB}" stroke="#40ff80" stroke-width="2" stroke-dasharray="4 3"/>`).join('');
  return `<div style="font-family:system-ui;background:#06060a;color:#cdd;padding:10px;border-radius:8px;margin-bottom:14px;">
  <div style="font-size:13px;margin-bottom:6px;">${clipName} — <span style="color:#4cf">build</span> · <span style="color:#fc4">slowZone</span> · <span style="color:#9af">energyRatio</span> · <span style="color:#ff4060">true drop</span> · <span style="color:#40ff80">fired</span> · <span style="color:#48a">slow region</span></div>
  <svg width="${W}" height="${H}" style="max-width:100%;background:#0a0a12;border-radius:6px;">
    ${bands.join('')}${slow}
    <polyline points="${poly(ds.buildScore)}" fill="none" stroke="#4cf" stroke-width="1.6"/>
    <polyline points="${poly(ds.slowZone)}" fill="none" stroke="#fc4" stroke-width="1.6"/>
    <polyline points="${poly(ds.energyRatio)}" fill="none" stroke="#9af" stroke-width="1" opacity="0.7"/>
    ${drops}${fired}
    <text x="6" y="${padT + 6}" fill="#566" font-size="10">1.0</text>
    <text x="6" y="${H - padB}" fill="#566" font-size="10">0.0</text>
  </svg>
</div>`;
}

function writeOverlays(outDir, detectorConfig, configName) {
  const ds = buildScenarios();
  const cfg = { enabled: true, ...detectorConfig };
  const dir = path.join(outDir, 'overlays');
  fs.mkdirSync(dir, { recursive: true });
  const origLog = console.log;
  console.log = () => {};
  try {
  let body = `<h1 style="font-family:system-ui;color:#cdd;">detection_eval overlays — config: ${configName} (moderate tier)</h1>`;
  for (const clip of ds) {
    const deg = applyMicModel(clip.samples, clip.sampleRate, { tier: 'moderate', seed: MIC_SEED });
    const micClip = { ...clip, samples: deg.samples };
    const mode = POSITIVES.has(clip.name) ? 'stems-fed' : 'mic-only';
    const rec = runClip(micClip, { mode, detectorConfig: cfg });
    body += overlayHtml(rec, `${clip.name} (${mode})`);
  }
    const outPath = path.join(dir, `${configName}.html`);
    fs.writeFileSync(outPath, `<!doctype html><html><body style="background:#06060a;">${body}</body></html>`);
    return outPath;
  } finally {
    console.log = origLog;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function printSummary(name, r) {
  console.log(`\n── ${name} ───────────────────────────────────────────`);
  console.log(`  DROP   P=${fmt(r.drop.precision)} R=${fmt(r.drop.recall)} F1=${fmt(r.drop.f1)} ` +
    `lat=${fmt(r.drop.meanLatencyMs, 0)}ms  (tp/fp/fn=${r.drop.tp}/${r.drop.fp}/${r.drop.fn})  negFP=${r.drop.negFp}`);
  // HONEST metrics — these COUNT the phantom drops the positive-only P hides.
  console.log(`  HONEST guardedP=${fmt(r.drop.guardedPrecision)} ` +
    `falseFiresPerMin=${fmt(r.drop.falseFiresPerMin)} ` +
    `(negFP=${r.drop.negFp} over ${fmt(r.drop.negDurationMs / 60000, 2)} min calm audio)`);
  console.log(`  BUILD  corr=${fmt(r.build.meanCorrelation)}  peakErr=${fmt(r.build.meanPeakErrMs, 0)}ms`);
  console.log(`  SLOW   margin=${fmt(r.slow.meanMargin)} acc=${fmt(r.slow.meanAccuracy)} ` +
    `(slow=${fmt(r.slow.meanSlow)} vs nonSlow=${fmt(r.slow.meanNonSlow)})`);
}

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = process.argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }

  const tiers = args.tiers ? String(args.tiers).split(',') : ALL_TIERS;
  for (const t of tiers) if (!ALL_TIERS.includes(t)) throw new Error(`unknown tier "${t}" (have: ${ALL_TIERS.join(', ')})`);

  let configNames;
  let adhoc = null;
  if (args.json) {
    adhoc = JSON.parse(args.json);
    configNames = ['adhoc'];
  } else if (args.config) {
    configNames = String(args.config).split(',');
    for (const c of configNames) if (!CONFIGS[c]) throw new Error(`unknown config "${c}" (have: ${Object.keys(CONFIGS).join(', ')})`);
  } else {
    configNames = ['baseline', 'default', 'tuned'];
  }

  const outDir = resolveHome(args.out ? path.dirname(args.out) : path.join(os.homedir(), 'tmp', 'detection_eval'));
  fs.mkdirSync(outDir, { recursive: true });

  const results = {};
  for (const name of configNames) {
    const detCfg = adhoc || CONFIGS[name];
    const r = evalConfig(detCfg, { tiers });
    results[name] = { detectorConfig: detCfg, ...r };
    printSummary(name, r);
    if (args.overlays) {
      const ov = writeOverlays(outDir, detCfg, name);
      console.log(`  overlay: ${ov}`);
    }
  }

  const outPath = resolveHome(args.out) || path.join(outDir, 'eval.json');
  fs.writeFileSync(outPath, JSON.stringify({ tiers, micSeed: MIC_SEED, dropToleranceMs: DROP_TOLERANCE_MS, results }, null, 2));
  console.log(`\nwrote ${outPath}`);
}

// Run only when invoked as a CLI (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
