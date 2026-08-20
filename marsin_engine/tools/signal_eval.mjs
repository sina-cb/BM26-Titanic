/** Production-config pattern-signal evaluation across deterministic mic tiers. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEffectiveAudioAnalysisConfig } from '../audio/config/audio_analysis_config.js';
import { buildScenarios } from '../tests/integration/detector_scenarios.mjs';
import { applyMicModel, MIC_TIERS } from '../tests/integration/mic_model.mjs';
import { runClip } from '../tests/integration/run_analysis.mjs';
import { distributionMetrics, signalFeel } from '../tests/integration/signal_metrics.mjs';
import { isMainModule } from './cli_entrypoint.mjs';

const DEFAULT_TIERS = Object.freeze(['clean', 'moderate', 'heavy', 'adversarial']);
const SIGNALS = Object.freeze(['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux']);
const SEED = 0x5EED;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTION_AUDIO = loadEffectiveAudioAnalysisConfig({
  engineDir: path.resolve(__dirname, '..'),
  modelName: 'titanic',
}).audioConfig;
const HOP_MS = PRODUCTION_AUDIO.hopSize / PRODUCTION_AUDIO.capture.sampleRate * 1000;

function parseArgs(argv) {
  const args = {
    tiers: DEFAULT_TIERS,
    out: path.join(os.homedir(), 'tmp', 'audio_analysis_hardening', 'signal_eval.json'),
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tiers') args.tiers = argv[++i].split(',');
    else if (arg === '--out') args.out = argv[++i];
    else throw new Error(`signal_eval: unknown argument ${arg}`);
  }
  for (const tier of args.tiers) {
    if (!MIC_TIERS[tier]) throw new Error(`signal_eval: unknown tier ${tier}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const scenarios = buildScenarios();
  if (scenarios.length === 0) throw new Error('signal_eval: zero scenarios');
  const results = {};
  let processedCases = 0;
  const realLog = console.log;
  console.log = () => {};
  try {
    for (const tier of args.tiers) {
      const aggregate = Object.fromEntries(SIGNALS.map((signal) => [signal, []]));
      for (const clip of scenarios) {
        const degraded = applyMicModel(clip.samples, clip.sampleRate, { tier, seed: SEED });
        const record = runClip({ ...clip, samples: degraded.samples }, { mode: 'mic-only' });
        for (const signal of SIGNALS) aggregate[signal].push(...record.signals[signal]);
        processedCases++;
      }
      results[tier] = {};
      for (const signal of SIGNALS) {
        results[tier][signal] = {
          distribution: distributionMetrics(aggregate[signal]),
          feel: signalFeel(aggregate[signal], HOP_MS, {
            transient: signal === 'micKick',
            peakMin: 0.12,
          }),
        };
      }
    }
  } finally {
    console.log = realLog;
  }
  if (processedCases === 0) throw new Error('signal_eval: zero cases processed');
  const output = { processedCases, tiers: args.tiers, seed: SEED, results };
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`processed ${processedCases} cases; wrote ${args.out}`);
  for (const tier of args.tiers) {
    const low = results[tier].micLow.distribution;
    const kick = results[tier].micKick.distribution;
    console.log(`${tier}: low p5/p50/p95=${low.p5.toFixed(3)}/${low.p50.toFixed(3)}/${low.p95.toFixed(3)} ` +
      `kick range=${kick.usefulRange.toFixed(3)} zero=${kick.zeroFraction.toFixed(3)} nonfinite=${kick.nonFinite}`);
  }
}

if (isMainModule(import.meta.url)) main();
