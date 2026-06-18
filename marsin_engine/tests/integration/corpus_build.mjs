/**
 * corpus_build.mjs — CLI: decode a raw audio corpus (MUSDB18 `.stem.mp4`
 * with stems + FMA Electronic `.mp3`) into the harness corpus layout
 * (mixture WAV + reference labels + manifest) under a target dir in ~/tmp.
 *
 * Reusable + reproducible: re-running rebuilds the corpus deterministically
 * from the same raw inputs. Audio stays in ~/tmp (gitignored) — only the
 * tooling is committed. See the replication skill
 * (.agent/01_skills/06_audio_corpus_tuning.md) for the full workflow.
 *
 * USAGE
 *   node tests/integration/corpus_build.mjs \
 *     --musdb ~/tmp/corpus/musdb_raw/test \
 *     --fma   ~/tmp/corpus/fma_raw \
 *     --fma-meta ~/tmp/corpus/fma_selected.json \
 *     --out   ~/tmp/corpus/built \
 *     [--limit-musdb N] [--limit-fma N]
 *
 * Codex P0: every decode / label failure throws — a corpus that half-built
 * is a build failure, not a smaller corpus.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodeToMonoWav, decodeStemMp4, MUSDB_STREAMS } from './audio_decode.mjs';
import { readWavMono, writeWavMono } from './wav_io.mjs';
import { labelTrack, labelFromStems } from './auto_label.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  }
  return out;
}

function expandHome(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

/** Slugify a track title/filename to a safe dir name. */
function slug(s) {
  return s.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 48);
}

/** List files under dir matching a predicate (non-recursive for musdb test/, recursive for fma). */
function listFiles(dir, ext, recursive) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (recursive) walk(full); }
      else if (e.name.toLowerCase().endsWith(ext)) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function buildMusdb(rawDir, outDir, limit) {
  const files = listFiles(rawDir, '.stem.mp4', false);
  const picked = limit ? files.slice(0, limit) : files;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musdbstem_'));
  const entries = [];
  try {
    for (const f of picked) {
      const base = path.basename(f, '.stem.mp4');
      const name = 'musdb_' + slug(base);
      const dir = path.join(outDir, name);
      fs.mkdirSync(dir, { recursive: true });
      // Decode all 5 streams to temp, label from stems, persist only mixture.
      const wavs = decodeStemMp4(f, tmp, name);
      const stems = {
        mixture: readWavMono(wavs.mixture),
        bass: readWavMono(wavs.bass),
        drums: readWavMono(wavs.drums),
        vocals: readWavMono(wavs.vocals),
      };
      const { regions, drops, stemsPlan, meta } = labelFromStems(stems);
      writeWavMono(path.join(dir, 'mixture.wav'), stems.mixture.samples, stems.mixture.sampleRate);
      fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ regions, drops, stemsPlan, meta }, null, 0));
      for (const w of Object.values(wavs)) fs.unlinkSync(w);
      const durationSec = stems.mixture.samples.length / stems.mixture.sampleRate;
      entries.push({
        name, source: 'MUSDB18', sourceUrl: 'https://zenodo.org/records/1117372',
        license: 'CC BY-NC-SA 4.0 (research/non-commercial)', genre: 'mixed (singer-songwriter/rock/pop)',
        title: base, hasStems: false, stemsLabeled: true, durationSec,
        labeledDrops: drops.length,
      });
      console.log(`  musdb ✓ ${name}  dur=${durationSec.toFixed(0)}s drops=${drops.length}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return entries;
}

function buildFma(rawDir, metaPath, outDir, limit) {
  const meta = JSON.parse(fs.readFileSync(expandHome(metaPath), 'utf8'));
  const byId = new Map(meta.map((m) => [m.id, m]));
  const files = listFiles(rawDir, '.mp3', true);
  const picked = limit ? files.slice(0, limit) : files;
  const entries = [];
  for (const f of picked) {
    const id = Number(path.basename(f, '.mp3'));
    const m = byId.get(id) || { title: String(id), license: 'unknown', durationSec: 0 };
    const name = 'fma_' + id + '_' + slug(m.title || String(id));
    const dir = path.join(outDir, name);
    fs.mkdirSync(dir, { recursive: true });
    decodeToMonoWav(f, path.join(dir, 'mixture.wav'), { streamIndex: 0 });
    const mix = readWavMono(path.join(dir, 'mixture.wav'));
    const { regions, drops, meta: lmeta } = labelTrack(mix);
    fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ regions, drops, meta: lmeta }, null, 0));
    const durationSec = mix.samples.length / mix.sampleRate;
    entries.push({
      name, source: 'FMA small', sourceUrl: 'https://github.com/mdeff/fma',
      license: m.license, genre: 'Electronic', fmaTrackId: id, title: m.title,
      hasStems: false, stemsLabeled: false, durationSec, labeledDrops: drops.length,
    });
    console.log(`  fma   ✓ ${name}  dur=${durationSec.toFixed(0)}s drops=${drops.length}`);
  }
  return entries;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = expandHome(args.out);
  if (!outDir) throw new Error('corpus_build: --out <dir> required');
  fs.mkdirSync(outDir, { recursive: true });

  let manifest = [];
  if (args.musdb) {
    console.log('Building MUSDB tracks…');
    manifest = manifest.concat(buildMusdb(expandHome(args.musdb), outDir, args['limit-musdb'] ? Number(args['limit-musdb']) : 0));
  }
  if (args.fma) {
    console.log('Building FMA tracks…');
    manifest = manifest.concat(buildFma(expandHome(args.fma), args['fma-meta'], outDir, args['limit-fma'] ? Number(args['limit-fma']) : 0));
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const withDrops = manifest.filter((m) => m.labeledDrops > 0).length;
  console.log(`\nCorpus built: ${manifest.length} tracks (${withDrops} with ≥1 labeled drop) → ${outDir}/manifest.json`);
}

main();
