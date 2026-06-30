/**
 * detection_sweep.mjs — parameter sweep over the drop detector knobs, scored
 * by the detection_eval harness. Finds the config that maximises drop F1 at
 * low latency without spurious negatives, then prints the ranked table.
 *
 * It sweeps the cartesian product of the grids below (edge mode, the absolute
 * sub floor, the energy-jump ratio, the windowed look-back), evaluates each
 * over ALL scenarios × ALL mic tiers via evalConfig, and ranks by a composite
 * score: F1 first, then fewer false-fires (the HONEST falseFiresPerMin, not the
 * raw negFp count), then lower latency.
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
  // build→drop transition gate: the recall lever (fire the edge from THIN when a
  // riser recently happened). 1.0 ≈ the old BUILD-state-only edge (never fires
  // from THIN); lower opens the gate (more recall, risk of loud-onset false
  // fires below the threshold real drops carry).
  dropBuildGate:     [0.35, 0.5, 0.65, 1.0],
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
  // Composite: F1 dominates; tie-break on fewer false-fires, then lower
  // absolute latency. We penalise on the HONEST falseFiresPerMin (phantom
  // drops per minute of calm/steady audio) rather than the raw negFp count, so
  // the ranking is normalized to how much non-drop audio the false-fires
  // happened over — a config that false-fires once over 60 s of calm music is
  // penalised the same regardless of how many negative clips the set carries.
  // False drops on calm music are the worst failure on a dance floor, so this
  // is weighted heavily (0.10 per false-fire/min).
  const f1 = r.drop.f1 ?? 0;
  const negPenalty = (r.drop.falseFiresPerMin ?? 0) * 0.10;
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

  console.log(`swept ${count} configs over all scenarios × 3 tiers. Top ${top} by composite (F1 − ffPerMin·0.10 − latPenalty):\n`);
  console.log('score  F1    P     gP    R     lat   ff/min negFP  edge      minLvl jump  gate  win');
  for (const row of rows.slice(0, top)) {
    const c = row.cfg, d = row.drop;
    console.log(
      `${fmt(row.score)}  ${fmt(d.f1)}  ${fmt(d.precision)}  ${fmt(d.guardedPrecision)}  ${fmt(d.recall)}  ${fmt(d.meanLatencyMs, 0).padStart(4)}  ${fmt(d.falseFiresPerMin).padStart(5)}  ${String(d.negFp).padStart(4)}   ` +
      `${c.dropEdgeMode.padEnd(9)} ${String(c.dropMinLevel).padEnd(5)}  ${String(c.dropEnergyJump).padEnd(4)}  ${String(c.dropBuildGate).padEnd(4)}  ${c.dropEdgeMode === 'windowed' ? c.dropDeltaWindowMs : '—'}`,
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
