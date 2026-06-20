/**
 * detection_sweep.mjs — parameter sweep over the drop detector knobs, scored
 * by the detection_eval harness. Finds the config that maximises drop F1 at
 * low latency without spurious negatives, then prints the ranked table.
 *
 * It sweeps the cartesian product of the grids below (edge mode, the absolute
 * sub floor, the energy-jump ratio, the windowed look-back), evaluates each
 * over ALL scenarios × ALL mic tiers via evalConfig, and ranks by a composite
 * score: F1 first, then fewer spurious negatives, then lower latency.
 *
 * USAGE (from marsin_engine/):
 *   node tools/detection_sweep.mjs                 # full grid, top 15
 *   node tools/detection_sweep.mjs --top 30
 *   node tools/detection_sweep.mjs --out ~/tmp/detection_eval/sweep.json
 *
 * This is a TUNING tool — its winner is what should land in DETECTOR_DEFAULTS
 * (then re-verified by detection_eval + the regression tests).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evalConfig } from './detection_eval.mjs';

// Sweep grids. Kept deliberately small so a full run is < ~1 min.
const GRID = {
  dropEdgeMode:      ['level', 'windowed'],
  dropMinLevel:      [0.0, 0.03, 0.045, 0.06, 0.08],
  dropEnergyJump:    [1.3, 1.5, 1.8],
  dropDeltaWindowMs: [400, 700],   // only matters for windowed
  eventRefractoryMs: [2000],
};

function* product(grid) {
  const keys = Object.keys(grid);
  const idx = keys.map(() => 0);
  const lens = keys.map((k) => grid[k].length);
  while (true) {
    const cfg = {};
    for (let i = 0; i < keys.length; i++) cfg[keys[i]] = grid[keys[i]][idx[i]];
    yield cfg;
    let j = keys.length - 1;
    while (j >= 0) { idx[j]++; if (idx[j] < lens[j]) break; idx[j] = 0; j--; }
    if (j < 0) break;
  }
}

function score(r) {
  // Composite: F1 dominates; tie-break on fewer spurious-negative drops, then
  // lower absolute latency. (negFp penalised heavily — false drops on calm
  // music are the worst failure on a dance floor.)
  const f1 = r.drop.f1 ?? 0;
  const negPenalty = r.drop.negFp * 0.05;
  const latPenalty = Math.min(0.1, Math.abs(r.drop.meanLatencyMs ?? 600) / 6000);
  return f1 - negPenalty - latPenalty;
}

function fmt(x, d = 2) { return (x === null || x === undefined) ? ' — ' : Number(x).toFixed(d); }

function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const n = process.argv[i + 1];
      if (n === undefined || n.startsWith('--')) args[k] = true; else { args[k] = n; i++; } }
  }
  const top = args.top ? parseInt(args.top, 10) : 15;

  const rows = [];
  let count = 0;
  for (const cfg of product(GRID)) {
    // windowed-only knob: dedupe level-edge rows that differ only in window.
    if (cfg.dropEdgeMode === 'level' && cfg.dropDeltaWindowMs !== GRID.dropDeltaWindowMs[0]) continue;
    const r = evalConfig(cfg, { quiet: true });
    rows.push({ cfg, drop: r.drop, score: score(r) });
    count++;
  }
  rows.sort((a, b) => b.score - a.score);

  console.log(`swept ${count} configs over all scenarios × 3 tiers. Top ${top} by composite (F1 − negFP·0.05 − latPenalty):\n`);
  console.log('score  F1    P     R     lat   negFP  edge      minLvl jump  win');
  for (const row of rows.slice(0, top)) {
    const c = row.cfg, d = row.drop;
    console.log(
      `${fmt(row.score)}  ${fmt(d.f1)}  ${fmt(d.precision)}  ${fmt(d.recall)}  ${fmt(d.meanLatencyMs, 0).padStart(4)}  ${String(d.negFp).padStart(4)}   ` +
      `${c.dropEdgeMode.padEnd(9)} ${String(c.dropMinLevel).padEnd(5)}  ${String(c.dropEnergyJump).padEnd(4)}  ${c.dropEdgeMode === 'windowed' ? c.dropDeltaWindowMs : '—'}`,
    );
  }

  const best = rows[0];
  console.log('\nBEST:', JSON.stringify(best.cfg), '→', JSON.stringify(best.drop));

  const out = args.out
    ? (args.out.startsWith('~') ? path.join(os.homedir(), args.out.slice(1)) : args.out)
    : path.join(os.homedir(), 'tmp', 'detection_eval', 'sweep.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ grid: GRID, ranked: rows }, null, 2));
  console.log(`wrote ${out}`);
}

main();
