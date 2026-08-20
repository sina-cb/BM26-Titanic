import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFrozenManifest } from '../../tools/fetch_genre_corpus.mjs';

function entry(genre, split, suffix) {
  return {
    dataset: 'archive_org_cc_dance', datasetVersion: 'v1', genre,
    identifier: `${genre}_${suffix}`, license: 'CC-BY', licenseUrl: 'https://example.test/license',
    sourceUrl: 'https://example.test/source', downloadUrl: 'https://example.test/audio',
    sampleRate: 44100, split, processing: 'test', wav: `${genre}/${suffix}.wav`,
    wavBytes: 100, sha256: 'a'.repeat(64),
  };
}

const GENRES = ['deep_house', 'melodic_house', 'tech_house', 'techno', 'melodic_techno', 'downtempo'];

test('frozen manifest requires a train/validation/test case for every scored genre', () => {
  const manifest = GENRES.flatMap((genre) => [
    entry(genre, 'train', 'a'), entry(genre, 'validation', 'b'), entry(genre, 'test', 'c'),
  ]);
  assert.equal(validateFrozenManifest(manifest), true);
  assert.throws(() => validateFrozenManifest(manifest.slice(1)), /missing deep_house\/train/);
});

test('frozen manifest rejects absent provenance, bad checksums, and duplicate paths', () => {
  const manifest = GENRES.flatMap((genre) => [
    entry(genre, 'train', 'a'), entry(genre, 'validation', 'b'), entry(genre, 'test', 'c'),
  ]);
  assert.throws(() => validateFrozenManifest([{ ...manifest[0], license: '' }]), /missing license/);
  assert.throws(() => validateFrozenManifest([{ ...manifest[0], sha256: 'bad' }]), /invalid sha256/);
  const duplicate = manifest.map((item) => ({ ...item }));
  duplicate[1].wav = duplicate[0].wav;
  assert.throws(() => validateFrozenManifest(duplicate), /duplicate wav/);
});
