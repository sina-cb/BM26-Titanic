/**
 * corpus_sweep.mjs — CLI: run the REAL analyzer + signal chains + structure
 * detector over a decoded/labeled corpus, through the virtual playa mic at
 * several SNR tiers, and report:
 *
 *   - DETECTOR ACCURACY on the drop-bearing subset: aggregate drop
 *     precision / recall / mean latency vs the reference labels.
 *   - FALSE-POSITIVE ROBUSTNESS on the zero-drop subset: spurious drops per
 *     minute (real audio that has NO structural drop should fire ~none).
 *   - STRUCTURE agreement: hop-wise THIN/BUILD/SUSTAIN vs reference regions.
 *   - CHAIN FEEL: flicker / pulse-depth / kick attack+decay (signal_metrics)
 *     on the pattern-facing post-chain signals, at the moderate mic tier.
 *
 * It compares two or more SCENARIOS (e.g. product-default vs a tuned
 * candidate) side by side so every tuning decision is backed by a number.
 * Audio streams one clip at a time (the corpus is multi-GB) — never all
 * loaded at once.
 *
 * USAGE
 *   node tests/integration/corpus_sweep.mjs --corpus ~/tmp/corpus/built \
 *     [--tiers clean,moderate,heavy] [--out metrics.json] [--limit N]
 *
 * The scenarios live in tuning_configs.mjs so the candidate constants are
 * reusable and reviewable in one place.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadManifest, loadClip } from './corpus.mjs';
import { runClip, dropMetrics, structureAgreement } from './run_analysis.mjs';
import { applyMicModel } from './mic_model.mjs';
import { signalFeel } from './signal_metrics.mjs';
import { SCENARIOS } from './tuning_configs.mjs';

const HOP_MS = (512 / 44100) * 1000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
function expandHome(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

/** Aggregate accumulator for one scenario. */
function newAgg() {
  return {
    posDrops: { tp: 0, fp: 0, fn: 0, latencies: [] },  // on drop-bearing clips
    negSpuriousDrops: 0, negMinutes: 0,                // on zero-drop clips
    structAgree: { agree: 0, total: 0 },
    feel: {},   // signalKey → array of per-clip feel metrics (moderate tier)
    nClips: 0, nRuns: 0,
  };
}

function pushFeel(agg, key, m) {
  (agg.feel[key] = agg.feel[key] || []).push(m);
}

function meanField(arr, f) {
  const v = arr.map((x) => x[f]).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Run one scenario over the whole corpus across the given tiers. */
function runScenario(corpusDir, manifest, scenario, tiers, micSeed, modeChoice, maxSamples) {
  const agg = newAgg();
  for (const entry of manifest) {
    const clip = loadClip(corpusDir, entry);
    // Optional truncation: feel + false-positive-rate stats converge well
    // before a full 3-minute track; truncating keeps the sweep fast on
    // full-length MUSDB without changing the conclusions.
    if (maxSamples && clip.samples.length > maxSamples) {
      clip.samples = clip.samples.subarray(0, maxSamples);
      // Keep only labels/regions within the truncated window.
      clip.labels = {
        drops: clip.labels.drops.filter((d) => d.ts < (maxSamples / clip.sampleRate) * 1000),
        regions: clip.labels.regions.filter((r) => r.startMs < (maxSamples / clip.sampleRate) * 1000),
      };
    }
    agg.nClips++;
    const hasDrops = clip.labels.drops.length > 0;
    const durMin = (clip.samples.length / clip.sampleRate) / 60;
    const allModes = entry.stemsLabeled ? ['mic-only', 'stems-fed'] : ['mic-only'];
    const modes = modeChoice === 'mic-only' ? ['mic-only'] : allModes;

    for (const tier of tiers) {
      const deg = applyMicModel(clip.samples, clip.sampleRate, { tier, seed: micSeed });
      const micClip = { ...clip, samples: deg.samples };
      for (const mode of modes) {
        const rec = runClip(micClip, {
          mode,
          detectorConfig: { enabled: true, ...scenario.detectorConfig },
          chainsOverride: scenario.chainsOverride || null,
          bands: scenario.bands, kick: scenario.kick,
        });
        agg.nRuns++;

        if (hasDrops) {
          const dm = dropMetrics(rec);
          agg.posDrops.tp += dm.tp; agg.posDrops.fp += dm.fp; agg.posDrops.fn += dm.fn;
          for (const l of dm.latencies) agg.posDrops.latencies.push(l);
        } else {
          agg.negSpuriousDrops += rec.dropFired.length;
          agg.negMinutes += durMin;
        }
        const sa = structureAgreement(rec);
        agg.structAgree.agree += sa.agree; agg.structAgree.total += sa.total;

        // Chain feel only at the moderate tier, mic-only (the representative
        // playa case), to keep the feel sample clean and comparable.
        if (tier === 'moderate' && mode === 'mic-only') {
          pushFeel(agg, 'micLow',  signalFeel(rec.signals.micLow,  HOP_MS));
          pushFeel(agg, 'micMid',  signalFeel(rec.signals.micMid,  HOP_MS));
          pushFeel(agg, 'micHigh', signalFeel(rec.signals.micHigh, HOP_MS));
          pushFeel(agg, 'micFlux', signalFeel(rec.signals.micFlux, HOP_MS));
          pushFeel(agg, 'micKick', signalFeel(rec.signals.micKick, HOP_MS, { transient: true, peakMin: 0.12 }));
        }
      }
    }
  }
  return summarize(agg);
}

function summarize(agg) {
  const p = agg.posDrops;
  const precision = (p.tp + p.fp) > 0 ? p.tp / (p.tp + p.fp) : null;
  const recall = (p.tp + p.fn) > 0 ? p.tp / (p.tp + p.fn) : null;
  const meanLatency = p.latencies.length ? p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length : null;
  const feelSummary = {};
  for (const [k, arr] of Object.entries(agg.feel)) {
    feelSummary[k] = {
      flickerHz: meanField(arr, 'flickerHz'),
      meanAbsDelta: meanField(arr, 'meanAbsDelta'),
      pulseDepth: meanField(arr, 'pulseDepth'),
      attackMs: meanField(arr, 'attackMs'),
      decayMs: meanField(arr, 'decayMs'),
    };
  }
  return {
    drops: { tp: p.tp, fp: p.fp, fn: p.fn, precision, recall, meanLatencyMs: meanLatency },
    falsePositives: {
      spurious: agg.negSpuriousDrops,
      minutes: agg.negMinutes,
      perMinute: agg.negMinutes > 0 ? agg.negSpuriousDrops / agg.negMinutes : null,
    },
    structureAgreement: agg.structAgree.total > 0 ? agg.structAgree.agree / agg.structAgree.total : null,
    feel: feelSummary,
    nClips: agg.nClips, nRuns: agg.nRuns,
  };
}

function fmt(x, d = 3) { return x === null || x === undefined ? '  —  ' : Number(x).toFixed(d); }

function printComparison(results) {
  const names = Object.keys(results);
  console.log('\n================ DETECTOR ================');
  console.log('scenario'.padEnd(16), 'P     R     latMs  FP/min  structAgree  (drops tp/fp/fn)');
  for (const n of names) {
    const r = results[n];
    console.log(
      n.padEnd(16),
      fmt(r.drops.precision, 2), fmt(r.drops.recall, 2),
      fmt(r.drops.meanLatencyMs, 0).padStart(5),
      fmt(r.falsePositives.perMinute, 2).padStart(6),
      fmt(r.structureAgreement, 3).padStart(11),
      `   (${r.drops.tp}/${r.drops.fp}/${r.drops.fn})`,
    );
  }
  console.log('\n================ CHAIN FEEL (moderate tier, mic-only) ================');
  for (const n of names) {
    console.log(`-- ${n} --`);
    const feel = results[n].feel;
    for (const k of ['micLow', 'micMid', 'micHigh', 'micFlux', 'micKick']) {
      const f = feel[k]; if (!f) continue;
      const extra = k === 'micKick' ? `attack=${fmt(f.attackMs, 0)}ms decay=${fmt(f.decayMs, 0)}ms` : '';
      console.log('  ', k.padEnd(8), 'flicker=' + fmt(f.flickerHz, 1) + 'Hz', 'pulse=' + fmt(f.pulseDepth, 3), 'jerk=' + fmt(f.meanAbsDelta, 4), extra);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusDir = expandHome(args.corpus);
  if (!corpusDir) throw new Error('corpus_sweep: --corpus <dir> required');
  const tiers = (args.tiers ? String(args.tiers) : 'clean,moderate,heavy').split(',');
  const micSeed = args.seed ? Number(args.seed) : 0xBEEF;
  let manifest = loadManifest(corpusDir);
  if (args.limit) manifest = manifest.slice(0, Number(args.limit));
  const only = args.scenarios ? String(args.scenarios).split(',') : Object.keys(SCENARIOS);

  const withDrops = manifest.filter((m) => m.labeledDrops > 0).length;
  console.log(`Corpus: ${manifest.length} clips (${withDrops} drop-bearing), tiers=[${tiers}], seed=0x${micSeed.toString(16)}`);

  const results = {};
  for (const name of only) {
    if (!SCENARIOS[name]) throw new Error(`corpus_sweep: unknown scenario '${name}' (have: ${Object.keys(SCENARIOS).join(', ')})`);
    process.stdout.write(`running scenario '${name}' …`);
    const t0 = Date.now();
    const maxSamples = args.maxSeconds ? Math.round(Number(args.maxSeconds) * 44100) : 0;
    results[name] = runScenario(corpusDir, manifest, SCENARIOS[name], tiers, micSeed, args.modes ? String(args.modes) : null, maxSamples);
    console.log(` ${((Date.now() - t0) / 1000).toFixed(1)}s (${results[name].nRuns} runs)`);
  }

  printComparison(results);

  if (args.out) {
    const outPath = expandHome(args.out);
    fs.writeFileSync(outPath, JSON.stringify({ corpusDir, tiers, micSeed, manifestSize: manifest.length, withDrops, results }, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
}

main();
