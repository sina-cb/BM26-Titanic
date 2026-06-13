/**
 * synthetic_accuracy.mjs — CLI: the RIGOROUS drop-accuracy measurement.
 *
 * The real corpus (MUSDB rock + 30 s FMA excerpts) is drop-sparse and its
 * labels are heuristic, so it is honest only for false-positive robustness
 * and chain feel — NOT for absolute drop precision/recall. For accuracy we
 * fall back to the SYNTHETIC labeled set (known ground truth: clean_drop,
 * double_drop, + negative controls), degraded through the virtual playa mic
 * at each SNR tier, comparing the 'level' vs 'windowed' drop edge.
 *
 * This is what backs the report's detector P/R/latency-vs-priors table and
 * the decision to flip the dropEdgeMode default.
 *
 * USAGE
 *   node tests/integration/synthetic_accuracy.mjs [--out metrics.json]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDataset } from './synth_dataset.mjs';
import { applyMicModel } from './mic_model.mjs';
import { runClip, dropMetrics } from './run_analysis.mjs';
import { TUNED_DETECTOR } from './tuning_configs.mjs';

const TIERS = ['clean', 'moderate', 'heavy'];
const MIC_SEED = 0x5EED;

// The detector edge variants under test (the only differing field is the
// edge mode + its companions; everything else is product default).
// Two arms, both at the shipped 2 s refractory (the flap fix made the
// refractory bump unnecessary), isolating the drop-EDGE choice:
//   level    — the original steady short/long level-ratio edge.
//   windowed — the NEW default rate-of-change edge.
const EDGES = {
  level:    { dropEdgeMode: 'level', eventRefractoryMs: 2000 },
  windowed: { dropEdgeMode: 'windowed', dropDeltaWindowMs: TUNED_DETECTOR.dropDeltaWindowMs, eventRefractoryMs: TUNED_DETECTOR.eventRefractoryMs },
};

function fmt(x, d = 2) { return x === null || x === undefined ? ' — ' : Number(x).toFixed(d); }

function run({ out } = {}) {
  const ds = buildDataset();
  const positives = new Set(['clean_drop', 'double_drop']);   // drop-bearing
  const negatives = new Set(['false_build', 'collapse', 'steady_loud', 'silence']);

  const results = {};
  for (const edgeName of Object.keys(EDGES)) {
    const agg = { tp: 0, fp: 0, fn: 0, lat: [], negFp: 0, perTier: {} };
    for (const tier of TIERS) {
      agg.perTier[tier] = { tp: 0, fp: 0, fn: 0, lat: [], negFp: 0 };
      for (const clip of ds) {
        const deg = applyMicModel(clip.samples, clip.sampleRate, { tier, seed: MIC_SEED });
        const micClip = { ...clip, samples: deg.samples };
        // stems-fed for positives (the high-confidence path); mic-only for
        // negatives (the realistic file-replay degraded case).
        const mode = positives.has(clip.name) ? 'stems-fed' : 'mic-only';
        const rec = runClip(micClip, { mode, detectorConfig: { enabled: true, ...EDGES[edgeName] } });
        if (positives.has(clip.name)) {
          const dm = dropMetrics(rec);
          agg.tp += dm.tp; agg.fp += dm.fp; agg.fn += dm.fn;
          agg.perTier[tier].tp += dm.tp; agg.perTier[tier].fp += dm.fp; agg.perTier[tier].fn += dm.fn;
          for (const l of dm.latencies) { agg.lat.push(l); agg.perTier[tier].lat.push(l); }
        } else if (negatives.has(clip.name)) {
          agg.negFp += rec.dropFired.length;
          agg.perTier[tier].negFp += rec.dropFired.length;
        }
      }
    }
    const precision = (agg.tp + agg.fp) > 0 ? agg.tp / (agg.tp + agg.fp) : null;
    const recall = (agg.tp + agg.fn) > 0 ? agg.tp / (agg.tp + agg.fn) : null;
    const meanLat = agg.lat.length ? agg.lat.reduce((a, b) => a + b, 0) / agg.lat.length : null;
    results[edgeName] = { precision, recall, meanLatencyMs: meanLat, tp: agg.tp, fp: agg.fp, fn: agg.fn, negFalsePositives: agg.negFp, perTier: agg.perTier };
  }

  // Report.
  console.log('Synthetic drop accuracy (positives stems-fed, negatives mic-only), 3 SNR tiers:\n');
  console.log('edge'.padEnd(10), 'P     R     latMs  negFP  (tp/fp/fn over all tiers)');
  for (const [name, r] of Object.entries(results)) {
    console.log(name.padEnd(10), fmt(r.precision), fmt(r.recall), fmt(r.meanLatencyMs, 0).padStart(5), String(r.negFalsePositives).padStart(5), `   (${r.tp}/${r.fp}/${r.fn})`);
  }
  console.log('\nPer-tier negative-control false positives (must be ~0):');
  for (const [name, r] of Object.entries(results)) {
    const row = TIERS.map((t) => `${t}=${r.perTier[t].negFp}`).join('  ');
    console.log('  ', name.padEnd(10), row);
  }
  console.log('\nPer-tier positives (tp/fp/fn):');
  for (const [name, r] of Object.entries(results)) {
    const row = TIERS.map((t) => { const p = r.perTier[t]; return `${t}=${p.tp}/${p.fp}/${p.fn}`; }).join('  ');
    console.log('  ', name.padEnd(10), row);
  }

  if (out) {
    const outPath = out.startsWith('~') ? path.join(os.homedir(), out.slice(1)) : out;
    fs.writeFileSync(outPath, JSON.stringify({ tiers: TIERS, micSeed: MIC_SEED, results }, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
  return results;
}

const args = {};
for (let i = 2; i < process.argv.length; i++) { if (process.argv[i].startsWith('--')) args[process.argv[i].slice(2)] = process.argv[i + 1]; }
run({ out: args.out });
