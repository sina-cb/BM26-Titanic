// sweep_all.mjs — parallel driver for the full parameter truth sweep.
//
//   node tools/param_truth/sweep_all.mjs
//   node tools/param_truth/sweep_all.mjs --workers 12 --model titanic
//   node tools/param_truth/sweep_all.mjs --out ~/tmp/param_truth
//
// The sweep is ~800 (pattern, param) pairs × 5 sweep points × a 180-frame
// render on a 981-pixel model. Single-process that is over an hour, which is
// long enough that nobody re-runs it — and a sweep nobody re-runs stops being
// true. Sharding it across cores brings it to minutes, which is the difference
// between a one-off audit and a check the curator can run after every edit.
//
// Each worker is an independent `run_param_truth.mjs --shard i/N` process
// writing its own JSON. This driver merges them, re-tallies, and writes the
// single results file + human report. Still fully OFFLINE — no worker opens a
// socket, so this is safe while the operator's live stack is running.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { tally } from './sweep.js';
import { renderMarkdown } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(__dirname, 'run_param_truth.mjs');
const DEFAULT_OUT = path.join(__dirname, 'param_truth_results');

// Leave headroom: the operator's live stack shares this machine, and a sweep
// that starves it of cores is not an acceptable trade for a few minutes.
const DEFAULT_WORKERS = Math.max(1, Math.min(12, Math.floor(os.cpus().length / 2)));

function parseArgs(argv) {
  const args = {
    model: 'titanic',
    crossModel: 'test_bench',
    workers: DEFAULT_WORKERS,
    out: DEFAULT_OUT,
    extra: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') args.model = argv[++i];
    else if (a === '--cross-model') args.crossModel = argv[++i];
    else if (a === '--no-cross-model') args.crossModel = null;
    else if (a === '--workers') args.workers = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dir' || a === '--top-level') {
      // Forwarded verbatim so a scoped parallel sweep works too.
      args.extra.push(a);
      if (a === '--dir') args.extra.push(argv[++i]);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!Number.isInteger(args.workers) || args.workers < 1) {
    throw new Error(`--workers must be a positive integer, got ${args.workers}`);
  }
  return args;
}

/**
 * Run one shard worker to completion.
 *
 * @param {object} args
 * @param {number} idx
 * @param {string} shardOut — output path stem for this shard.
 * @returns {Promise<void>} rejects loudly if the worker exits non-zero.
 */
function runShard(args, idx, shardOut) {
  const argv = [
    RUNNER,
    '--model', args.model,
    '--shard', `${idx}/${args.workers}`,
    '--out', shardOut,
    '--json-only',
    '--quiet',
    ...args.extra,
  ];
  if (args.crossModel) argv.push('--cross-model', args.crossModel);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`shard ${idx} exited ${code}: ${stderr.trim()}`));
        return;
      }
      process.stdout.write(`  shard ${idx}/${args.workers} done\n`);
      resolve();
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'param_truth_'));
  process.stdout.write(`param_truth: model=${args.model} workers=${args.workers}`
    + `${args.crossModel ? ` cross-model=${args.crossModel}` : ''}\n`);

  const started = Date.now();
  const stems = [];
  const jobs = [];
  for (let i = 0; i < args.workers; i++) {
    const stem = path.join(shardDir, `shard_${i}`);
    stems.push(stem);
    jobs.push(runShard(args, i, stem));
  }
  await Promise.all(jobs);

  // Merge. Every shard shares the same harness settings, so the first shard's
  // header is authoritative; only the pattern list differs.
  let merged = null;
  let crossRechecked = 0;
  let crossAlive = 0;
  for (const stem of stems) {
    const doc = JSON.parse(fs.readFileSync(`${stem}.json`, 'utf8'));
    if (!merged) {
      merged = doc;
    } else {
      merged.patterns.push(...doc.patterns);
    }
    if (doc.crossModel) {
      crossRechecked += doc.crossModel.patternsRechecked;
      crossAlive += doc.crossModel.aliveElsewhere;
    }
  }
  merged.patterns.sort((a, b) => a.pattern.localeCompare(b.pattern));
  merged.patternCount = merged.patterns.length;
  merged.workers = args.workers;
  if (args.crossModel) {
    merged.crossModel = {
      model: args.crossModel,
      patternsRechecked: crossRechecked,
      aliveElsewhere: crossAlive,
    };
  }
  merged.durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));

  const counts = tally(merged);
  merged.counts = counts;

  fs.mkdirSync(path.dirname(`${args.out}.json`), { recursive: true });
  fs.writeFileSync(`${args.out}.json`, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.writeFileSync(`${args.out}.md`, renderMarkdown(merged, counts), 'utf8');
  fs.rmSync(shardDir, { recursive: true, force: true });

  process.stdout.write('\n');
  process.stdout.write(`TRUE ${counts.TRUE} · WEAK ${counts.WEAK} · WRONG ${counts.WRONG} `
    + `· DEAD ${counts.DEAD} · UNKNOWN_CLAIM ${counts.UNKNOWN_CLAIM}\n`);
  process.stdout.write(`  of the DEAD, ${counts.deadButAliveOnCrossModel} are alive on `
    + `${args.crossModel} (model coverage, not a broken control)\n`);
  process.stdout.write(`patterns ok ${counts.patternsOk}, compile errors `
    + `${counts.patternsCompileError}, no params ${counts.patternsNoParams}, `
    + `params ${counts.paramTotal}\n`);
  process.stdout.write(`wrote ${args.out}.json\nwrote ${args.out}.md\n`);
  process.stdout.write(`took ${merged.durationSeconds}s\n`);
}

main().catch((err) => {
  process.stderr.write(`param_truth sweep_all FAILED: ${err.stack || err.message}\n`);
  process.exit(1);
});
