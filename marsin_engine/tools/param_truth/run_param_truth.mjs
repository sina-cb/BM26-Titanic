// run_param_truth.mjs — single-process CLI for the parameter truth harness.
//
// For the FULL sweep use the parallel driver instead — it shards this script
// across cores and merges the result:
//
//   node tools/param_truth/sweep_all.mjs
//
// This entry is for targeted runs and is what each shard worker executes:
//
//   node tools/param_truth/run_param_truth.mjs --pattern 01_cylon_sweep
//   node tools/param_truth/run_param_truth.mjs --dir summer_camp --model summer_camp_logsville
//   node tools/param_truth/run_param_truth.mjs --top-level --cross-model test_bench
//
// OFFLINE ONLY. It opens no socket and binds no port, so it is safe to run
// while the operator's live stack holds :6966-:6972 and 5568.

import fs from 'fs';
import path from 'path';

import { runSweep, tally, reconcileAcrossModel } from './sweep.js';
import { discoverPatterns } from './pattern_discovery.js';
import { PATTERNS_DIR } from './render_context.js';
import { renderMarkdown } from './report.js';

const DEFAULT_OUT = path.join(PATTERNS_DIR, '..', 'tools', 'param_truth', 'param_truth_results');

function parseArgs(argv) {
  const args = {
    model: 'titanic',
    crossModel: null,
    patterns: null,
    out: DEFAULT_OUT,
    quiet: false,
    jsonOnly: false,
    shard: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') args.model = argv[++i];
    else if (a === '--cross-model') args.crossModel = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--json-only') args.jsonOnly = true;
    else if (a === '--shard') {
      const [idx, total] = argv[++i].split('/').map(Number);
      if (!Number.isInteger(idx) || !Number.isInteger(total) || total < 1 || idx >= total) {
        throw new Error(`--shard expects i/N with 0 <= i < N, got '${argv[i]}'`);
      }
      args.shard = { idx, total };
    } else if (a === '--pattern') {
      args.patterns = args.patterns || [];
      args.patterns.push(argv[++i]);
    } else if (a === '--dir') {
      const prefix = `${argv[++i]}/`;
      args.patterns = discoverPatterns(PATTERNS_DIR).filter(p => p.startsWith(prefix));
    } else if (a === '--top-level') {
      args.patterns = discoverPatterns(PATTERNS_DIR).filter(p => !p.includes('/'));
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : (m) => process.stdout.write(`${m}\n`);

  let ids = args.patterns || discoverPatterns(PATTERNS_DIR);
  if (args.shard) {
    // Round-robin, not contiguous blocks: pattern cost varies wildly with
    // slider count, and interleaving keeps the shards roughly balanced.
    ids = ids.filter((_, i) => i % args.shard.total === args.shard.idx);
  }

  log(`param_truth: model=${args.model} patterns=${ids.length}`
    + (args.shard ? ` shard=${args.shard.idx}/${args.shard.total}` : ''));
  const started = Date.now();
  const doc = await runSweep({
    model: args.model,
    patterns: ids,
    onProgress: args.quiet ? null : (m) => process.stdout.write(`  ${m}\n`),
  });

  if (args.crossModel) {
    log(`cross-model recheck of DEAD params on ${args.crossModel}`);
    await reconcileAcrossModel(doc, args.crossModel,
      args.quiet ? null : (m) => process.stdout.write(`  ${m}\n`));
  }
  doc.durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

  const counts = tally(doc);
  doc.counts = counts;

  const jsonPath = `${args.out}.json`;
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  log(`wrote ${jsonPath}`);

  if (!args.jsonOnly) {
    const mdPath = `${args.out}.md`;
    fs.writeFileSync(mdPath, renderMarkdown(doc, counts), 'utf8');
    log(`wrote ${mdPath}`);
  }

  log('');
  log(`TRUE ${counts.TRUE} · WEAK ${counts.WEAK} · WRONG ${counts.WRONG} · `
    + `DEAD ${counts.DEAD} · UNKNOWN_CLAIM ${counts.UNKNOWN_CLAIM}`);
  log(`patterns ok ${counts.patternsOk}, compile errors ${counts.patternsCompileError}, `
    + `no params ${counts.patternsNoParams}`);
  log(`took ${doc.durationSeconds}s`);
}

main().catch((err) => {
  process.stderr.write(`param_truth FAILED: ${err.stack || err.message}\n`);
  process.exit(1);
});
