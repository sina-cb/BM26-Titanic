/**
 * Rebuild a deterministic, checksum-pinned subset of the Creative Commons
 * dance-music corpus described by datasets/genre_corpus_manifest.json.
 *
 * Source media is streamed from archive.org through the repository's pinned
 * ffmpeg binary. Only decoded mono WAVs and a local manifest are written, both
 * under the caller's explicit output directory (normally ~/tmp). Audio is
 * never written into the repository.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveFfmpegPath } from '../lib/ffmpeg_resolver.js';
import { isMainModule } from './cli_entrypoint.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_MANIFEST = path.join(__dirname, '..', 'datasets', 'genre_corpus_manifest.json');
const DEFAULT_OUTPUT = path.join(os.homedir(), 'tmp', 'audio_analysis_hardening', 'corpus', 'genre');
const SCOREABLE_GENRES = Object.freeze([
  'deep_house',
  'melodic_house',
  'tech_house',
  'techno',
  'melodic_techno',
  'downtempo',
]);

function parseArgs(argv) {
  const args = { manifest: DEFAULT_SOURCE_MANIFEST, out: DEFAULT_OUTPUT, perGenre: 3, excludes: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--per-genre') args.perGenre = Number(argv[++i]);
    else if (arg === '--exclude') args.excludes.push(argv[++i]);
    else throw new Error(`fetch_genre_corpus: unknown argument ${arg}`);
  }
  if (!args.manifest || !args.out) throw new Error('fetch_genre_corpus: --manifest and --out require values');
  if (!Number.isInteger(args.perGenre) || args.perGenre < 3) {
    throw new Error('fetch_genre_corpus: --per-genre must be an integer >= 3 (train/validation/test)');
  }
  if (args.excludes.some((identifier) => !identifier)) {
    throw new Error('fetch_genre_corpus: --exclude requires an identifier');
  }
  return args;
}

function readSourceManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) throw new Error(`fetch_genre_corpus: missing manifest ${manifestPath}`);
  const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('fetch_genre_corpus: source manifest must be a non-empty array');
  }
  for (const entry of entries) {
    for (const key of ['genre', 'identifier', 'file', 'license', 'licenseUrl', 'sourceUrl', 'trimSec', 'trimStartSec']) {
      if (entry[key] === undefined || entry[key] === null || entry[key] === '') {
        throw new Error(`fetch_genre_corpus: ${entry.identifier || '<unknown>'} missing ${key}`);
      }
    }
  }
  return entries;
}

function archiveDownloadUrl(entry) {
  const encodedFile = entry.file.split('/').map(encodeURIComponent).join('/');
  return `https://archive.org/download/${encodeURIComponent(entry.identifier)}/${encodedFile}`;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * The EXACT serialization of the frozen corpus manifest: 2-space JSON, LF line
 * endings, one trailing newline. Every writer and every checker goes through
 * this one function so the manifest's checksum is a property of the DATA, not
 * of the machine that happened to write it.
 */
export function serializeCorpusManifest(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`.replace(/\r\n/g, '\n');
}

/**
 * The canonical checksum of a corpus manifest — sha256 over the UTF-8 bytes of
 * its serialization with CRLF normalized to LF and any BOM stripped.
 *
 * The normalization is EXPLICIT and load-bearing, not cosmetic: this repo runs
 * with `core.autocrlf=true`, so the same manifest is LF in the git blob and
 * CRLF in a Windows working tree. Hashing raw bytes would make the recorded
 * checksum verify on one checkout and fail on another — a checksum that depends
 * on the checkout is worse than no checksum. Documented in datasets/README.md.
 *
 * @param {string|Buffer} manifestText - serialized manifest bytes or text.
 */
export function corpusManifestSha256(manifestText) {
  const text = Buffer.isBuffer(manifestText) ? manifestText.toString('utf8') : manifestText;
  const canonical = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

function selectCases(entries, perGenre, excludes) {
  const excluded = new Set(excludes);
  for (const identifier of excluded) {
    if (!entries.some((entry) => entry.identifier === identifier)) {
      throw new Error(`fetch_genre_corpus: excluded identifier is not in source manifest: ${identifier}`);
    }
  }
  const selected = [];
  for (const genre of SCOREABLE_GENRES) {
    const candidates = entries
      .filter((entry) => entry.genre === genre && !excluded.has(entry.identifier))
      .slice(0, perGenre);
    if (candidates.length !== perGenre) {
      throw new Error(`fetch_genre_corpus: ${genre} has ${candidates.length}, requires ${perGenre}`);
    }
    selected.push(...candidates.map((entry, index) => ({
      ...entry,
      split: index === 0 ? 'train' : index === 1 ? 'validation' : 'test',
    })));
  }
  return selected;
}

function decodeCase(entry, outputRoot, ffmpegPath) {
  const genreDir = path.join(outputRoot, entry.genre);
  fs.mkdirSync(genreDir, { recursive: true });
  const wavPath = path.join(genreDir, `${entry.identifier}.wav`);
  if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size <= 44) {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', String(entry.trimStartSec),
      '-i', archiveDownloadUrl(entry),
      '-t', String(entry.trimSec),
      '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-y', wavPath,
    ];
    const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
      throw new Error(`fetch_genre_corpus: ffmpeg failed for ${entry.identifier}: ` +
        `${result.error?.message || result.stderr || `exit ${result.status}`}`);
    }
  }
  const stat = fs.statSync(wavPath);
  if (stat.size <= 44) throw new Error(`fetch_genre_corpus: empty WAV ${wavPath}`);
  return {
    ...entry,
    dataset: 'archive_org_cc_dance',
    datasetVersion: 'bm26_manifest_20260620',
    downloadUrl: archiveDownloadUrl(entry),
    processing: 'ffmpeg mono pcm_s16le 44100Hz; trim from manifest',
    wav: path.relative(outputRoot, wavPath).replaceAll('\\', '/'),
    wavBytes: stat.size,
    sha256: sha256(wavPath),
  };
}

export function validateFrozenManifest(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('corpus manifest is empty');
  const seen = new Set();
  for (const entry of entries) {
    for (const key of [
      'dataset', 'datasetVersion', 'genre', 'identifier', 'license', 'licenseUrl',
      'sourceUrl', 'downloadUrl', 'sampleRate', 'split', 'processing', 'wav', 'wavBytes', 'sha256',
    ]) {
      if (entry[key] === undefined || entry[key] === null || entry[key] === '') {
        throw new Error(`corpus manifest entry ${entry.identifier || '<unknown>'} missing ${key}`);
      }
    }
    if (!['train', 'validation', 'test'].includes(entry.split)) {
      throw new Error(`corpus manifest ${entry.identifier} has invalid split ${entry.split}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`corpus manifest ${entry.identifier} has invalid sha256`);
    }
    if (seen.has(entry.wav)) throw new Error(`corpus manifest duplicate wav ${entry.wav}`);
    seen.add(entry.wav);
  }
  for (const genre of SCOREABLE_GENRES) {
    for (const split of ['train', 'validation', 'test']) {
      if (!entries.some((entry) => entry.genre === genre && entry.split === split)) {
        throw new Error(`corpus manifest missing ${genre}/${split}`);
      }
    }
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const source = readSourceManifest(path.resolve(args.manifest));
  const selected = selectCases(source, args.perGenre, args.excludes);
  const outputRoot = path.resolve(args.out);
  fs.mkdirSync(outputRoot, { recursive: true });
  const ffmpegPath = await resolveFfmpegPath();
  const built = [];
  for (const [index, entry] of selected.entries()) {
    console.log(`[${index + 1}/${selected.length}] ${entry.genre}/${entry.identifier}`);
    built.push(decodeCase(entry, outputRoot, ffmpegPath));
  }
  validateFrozenManifest(built);
  const manifestPath = path.join(outputRoot, 'manifest.json');
  // Hash the EXACT bytes we write, at write time — the checksum can never drift
  // from the file it describes.
  const manifestText = serializeCorpusManifest(built);
  fs.writeFileSync(manifestPath, manifestText);
  const localManifestSha256 = corpusManifestSha256(manifestText);
  const provenancePath = path.join(outputRoot, 'provenance.json');
  fs.writeFileSync(provenancePath, `${JSON.stringify({
    sourceManifest: path.resolve(args.manifest),
    localManifest: path.resolve(manifestPath),
    // Reproduce with: corpusManifestSha256(fs.readFileSync(manifestPath))
    localManifestSha256,
    localManifestSerialization: 'sha256 over UTF-8 bytes of 2-space JSON with LF line endings and a trailing newline',
    processedCases: built.length,
    splitPolicy: 'first available per genre=train, second=validation, third=test',
    exclusions: args.excludes.map((identifier) => ({
      identifier,
      reason: 'explicit acquisition exclusion; source media unavailable',
    })),
  }, null, 2)}\n`);
  console.log(`processed ${built.length} cases; wrote ${manifestPath}`);
  console.log(`localManifestSha256 ${localManifestSha256}`);
}

if (isMainModule(import.meta.url)) await main();
