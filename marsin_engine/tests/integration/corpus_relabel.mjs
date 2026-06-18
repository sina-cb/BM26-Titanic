/**
 * corpus_relabel.mjs — CLI: re-derive labels for an already-decoded corpus
 * WITHOUT re-decoding, so the (slow, multi-GB) decode is done once and label
 * heuristics can be iterated cheaply. Reads each track's mixture.wav, re-runs
 * the mixture-energy labeler, and rewrites labels.json + the manifest's
 * labeledDrops count. (Stem-gated MUSDB labels are mixture-only here — the
 * stem WAVs were discarded after build; this path is for surfacing more
 * candidate drops / iterating thresholds, not for re-deriving the stem gate.)
 *
 * USAGE
 *   node tests/integration/corpus_relabel.mjs --corpus ~/tmp/corpus/built \
 *     [--jumpRatio 1.5] [--sustainFloorFrac 0.55] [--beforeLowFrac 0.62] [--winMs 1500]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readWavMono } from './wav_io.mjs';
import { labelTrack } from './auto_label.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
function expandHome(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

function main() {
  const args = parseArgs(process.argv.slice(2));
  const corpusDir = expandHome(args.corpus);
  if (!corpusDir) throw new Error('corpus_relabel: --corpus <dir> required');
  const dropOpts = {};
  for (const k of ['jumpRatio', 'sustainFloorFrac', 'beforeLowFrac', 'winMs']) {
    if (args[k] !== undefined) dropOpts[k] = Number(args[k]);
  }
  const manifestPath = path.join(corpusDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let totalDrops = 0, withDrops = 0;
  for (const entry of manifest) {
    const dir = path.join(corpusDir, entry.name);
    const mix = readWavMono(path.join(dir, 'mixture.wav'));
    const { regions, drops, meta } = labelTrack(mix, { drops: dropOpts });
    const labPath = path.join(dir, 'labels.json');
    const prev = JSON.parse(fs.readFileSync(labPath, 'utf8'));
    // Preserve a stem plan if one was derived at build time.
    const next = { regions, drops, meta };
    if (prev.stemsPlan) next.stemsPlan = prev.stemsPlan;
    fs.writeFileSync(labPath, JSON.stringify(next, null, 0));
    entry.labeledDrops = drops.length;
    totalDrops += drops.length;
    if (drops.length > 0) withDrops++;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Relabeled ${manifest.length} tracks: ${withDrops} drop-bearing, ${totalDrops} total drops (opts=${JSON.stringify(dropOpts)})`);
}

main();
