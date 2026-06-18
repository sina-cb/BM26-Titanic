/**
 * corpus.mjs — load a decoded, labeled audio corpus into the harness clip
 * shape ({ name, sampleRate, samples, stemsPlan, labels }) that
 * run_analysis.runClip consumes.
 *
 * ON-DISK LAYOUT (produced by corpus_build.mjs; audio lives in ~/tmp, never
 * committed):
 *
 *   <corpusDir>/
 *     manifest.json                 # [{ name, source, license, sourceUrl,
 *                                   #    hasStems, durationSec, genre }]
 *     <name>/
 *       mixture.wav                 # mono 44.1k 16-bit
 *       bass.wav drums.wav ...      # (MUSDB only) the 4 stems
 *       labels.json                 # { regions, drops, stemsPlan?, meta }
 *
 * Codex P0: loading throws on a missing manifest entry, missing WAV, or
 * missing labels — a corpus that drifted from its manifest must fail, not
 * silently skip tracks.
 */

import fs from 'node:fs';
import path from 'node:path';

import { readWavMono } from './wav_io.mjs';

/** Read the manifest array for a corpus directory. */
export function loadManifest(corpusDir) {
  const p = path.join(corpusDir, 'manifest.json');
  if (!fs.existsSync(p)) {
    throw new Error(`corpus: no manifest at ${p} — run corpus_build.mjs first`);
  }
  const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(manifest)) throw new Error(`corpus: manifest is not an array (${p})`);
  return manifest;
}

/**
 * Load one corpus entry into a harness clip. Reads the mixture WAV and the
 * labels JSON; if the entry hasStems, the stem WAVs are loaded too (for
 * callers that want real per-stem audio rather than the coarse stemsPlan).
 *
 * @returns {{ name, sampleRate, samples, stemsPlan, labels, source, license, stems? }}
 */
export function loadClip(corpusDir, entry) {
  const dir = path.join(corpusDir, entry.name);
  const mixPath = path.join(dir, 'mixture.wav');
  const labPath = path.join(dir, 'labels.json');
  if (!fs.existsSync(mixPath)) throw new Error(`corpus: missing mixture for '${entry.name}' (${mixPath})`);
  if (!fs.existsSync(labPath)) throw new Error(`corpus: missing labels for '${entry.name}' (${labPath})`);

  const mix = readWavMono(mixPath);
  const labels = JSON.parse(fs.readFileSync(labPath, 'utf8'));
  const clip = {
    name: entry.name,
    sampleRate: mix.sampleRate,
    samples: mix.samples,
    stemsPlan: labels.stemsPlan || [],
    labels: { regions: labels.regions || [], drops: labels.drops || [] },
    source: entry.source,
    license: entry.license,
  };

  if (entry.hasStems) {
    clip.stems = {};
    for (const part of ['bass', 'drums', 'vocals', 'other']) {
      const sp = path.join(dir, `${part}.wav`);
      if (fs.existsSync(sp)) clip.stems[part] = readWavMono(sp);
    }
  }
  return clip;
}

/** Convenience: load every entry. Returns [{ entry, clip }]. */
export function loadCorpus(corpusDir, filter = () => true) {
  const manifest = loadManifest(corpusDir);
  return manifest.filter(filter).map((entry) => ({ entry, clip: loadClip(corpusDir, entry) }));
}
