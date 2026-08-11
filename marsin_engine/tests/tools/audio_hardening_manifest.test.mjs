import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(__dirname, '..', '..', 'datasets', 'audio_hardening_manifest.json');

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
