import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { corpusManifestSha256, serializeCorpusManifest, validateFrozenManifest } from '../../tools/fetch_genre_corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const datasetsDir = path.join(__dirname, '..', '..', 'datasets');
const manifestPath = path.join(datasetsDir, 'audio_hardening_manifest.json');
const corpusManifestPath = path.join(datasetsDir, 'audio_hardening_corpus_manifest.json');

test('tracked audio-hardening manifest freezes complete balanced splits and checksums', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.processedCases, 18);
  assert.match(manifest.localManifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(manifest.caseChecksums).length, manifest.processedCases);
  for (const checksum of Object.values(manifest.caseChecksums)) assert.match(checksum, /^[0-9a-f]{64}$/);
  for (const split of ['train', 'validation', 'test']) {
    assert.equal(manifest.splits[split].length, 6, `${split} has one case per scored genre`);
  }
  const ids = Object.values(manifest.splits).flat();
  assert.equal(new Set(ids).size, manifest.processedCases, 'no case leaks across splits');
  assert.deepEqual(new Set(ids), new Set(Object.keys(manifest.caseChecksums)));
  assert.ok(Array.isArray(manifest.exclusions) && manifest.exclusions.length > 0);
});

// localManifestSha256 hashes the BUILT corpus manifest — the one that sits
// beside the (never-committed) audio in ~/tmp. Before this test that made it
// unverifiable from the repo, and a reviewer reasonably mis-read it as a
// checksum of `sourceManifest` (datasets/genre_corpus_manifest.json) — where it
// matches neither the working-tree nor the git-blob bytes. A byte-exact copy of
// the built manifest is now tracked, so the checksum is verified here, offline,
// with no audio and no network.
test('localManifestSha256 verifies against the tracked frozen corpus manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const corpusBytes = fs.readFileSync(corpusManifestPath);
  assert.equal(
    corpusManifestSha256(corpusBytes),
    manifest.localManifestSha256,
    'tracked corpus manifest does not hash to the recorded localManifestSha256',
  );
  // The checksum must NOT be a checksum of the source manifest — that confusion
  // is exactly what this field is now documented against.
  assert.equal(manifest.trackedLocalManifestCopy, 'datasets/audio_hardening_corpus_manifest.json');
  assert.notEqual(
    corpusManifestSha256(fs.readFileSync(path.join(datasetsDir, path.basename(manifest.sourceManifest)))),
    manifest.localManifestSha256,
  );
});

// The checksum must not depend on the checkout. This repo runs core.autocrlf,
// so the same tracked manifest is LF in git and CRLF in a Windows working tree;
// the recorded digest has to survive both.
test('the corpus-manifest checksum is line-ending independent and re-serializes byte-identically', () => {
  const text = fs.readFileSync(corpusManifestPath, 'utf8');
  const lf = text.replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(corpusManifestSha256(crlf), corpusManifestSha256(lf), 'CRLF checkout must hash identically');
  assert.equal(corpusManifestSha256(`﻿${lf}`), corpusManifestSha256(lf), 'a BOM must not change the digest');
  // Round-trip: re-serializing the parsed entries reproduces the exact bytes,
  // so a rebuild on any platform lands on the same digest.
  const entries = JSON.parse(lf);
  assert.equal(serializeCorpusManifest(entries), lf, 'serializeCorpusManifest is not byte-stable');
});

// The tracked copy is the real frozen manifest, not a decorative one: it passes
// the builder's own validator and agrees with the summary it is summarized by.
test('the tracked frozen corpus manifest agrees with the summary manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = JSON.parse(fs.readFileSync(corpusManifestPath, 'utf8'));
  assert.equal(validateFrozenManifest(entries), true);
  assert.equal(entries.length, manifest.processedCases);
  assert.equal(entries.reduce((sum, e) => sum + e.wavBytes, 0), manifest.totalDecodedBytes);
  for (const entry of entries) {
    assert.equal(manifest.caseChecksums[entry.identifier], entry.sha256, `${entry.identifier} checksum`);
    assert.ok(manifest.splits[entry.split].includes(entry.identifier), `${entry.identifier} split`);
  }
});
