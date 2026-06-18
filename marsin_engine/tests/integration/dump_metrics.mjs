/**
 * dump_metrics.mjs — regenerate the machine-readable validation metrics
 * artifact (`validation_metrics.json`, < 50 KB text — committed) from the
 * synthetic dataset. NOT a test; a reproducible report-input generator.
 *
 * Run:  cd marsin_engine && node tests/integration/dump_metrics.mjs
 * Writes: tests/integration/validation_metrics.json
 *
 * The JSON is the source of the headline tables in
 * .agent/02_reports/202606/20260613_4_audio_analysis_validation.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDataset } from './synth_dataset.mjs';
import { runClip, dropMetrics, structureAgreement } from './run_analysis.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIGS = {
  default: { enabled: true },
  tuned:   { enabled: true, eventRefractoryMs: 4000 },
};
const MODES = ['mic-only', 'stems-fed'];
const DROP_TOLERANCE_MS = 1200;

function round(x, n = 3) {
  if (x === null || x === undefined) return null;
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

const dataset = buildDataset();
const out = {
  generatedAt: new Date().toISOString(),
  note: 'Synthetic ground-truth validation. NOT real-world EDM accuracy. See report.',
  dropToleranceMs: DROP_TOLERANCE_MS,
  perfBudgetMsPerHop: 0.5,
  configs: CONFIGS,
  realWorldEngineeringPriors: {
    source: '.agent/02_reports/202605/20260526_2_drop_mood_detection_research.md §key-findings 2',
    note: 'engineering priors, NOT measured here; unmet target for a real Phase-3 corpus',
    precision: [0.65, 0.75],
    recall: [0.55, 0.70],
    latencyMs: [150, 500],
  },
  results: [],
};

for (const [cfgName, cfg] of Object.entries(CONFIGS)) {
  for (const mode of MODES) {
    for (const clip of dataset) {
      const rec = runClip(clip, { mode, detectorConfig: cfg });
      const dm = dropMetrics(rec, DROP_TOLERANCE_MS);
      const sa = structureAgreement(rec);
      out.results.push({
        config: cfgName,
        mode,
        clip: clip.name,
        labeledDrops: dm.labeledDrops,
        detectedDrops: dm.detectedDrops,
        tp: dm.tp, fp: dm.fp, fn: dm.fn,
        precision: round(dm.precision, 3),
        recall: round(dm.recall, 3),
        meanLatencyMs: round(dm.meanLatencyMs, 1),
        latenciesMs: dm.latencies.map((l) => round(l, 1)),
        structureAgreement: round(sa.fraction, 3),
        reachedSustain: rec.reachedSustain,
        anyNonFinite: rec.anyNonFinite,
        tickP99Ms: round(rec.tickP99Ms, 4),
        firedAtSec: rec.dropFired.map((d) => round(d.ts / 1000, 2)),
      });
    }
  }
}

const outPath = path.join(__dirname, 'validation_metrics.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB, ${out.results.length} rows)`);
