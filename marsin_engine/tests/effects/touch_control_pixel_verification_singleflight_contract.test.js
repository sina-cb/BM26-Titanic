import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const WIRE = fs.readFileSync(path.join(ROOT, 'docs', 'ui', 'touch_control_wire.js'), 'utf8');

test('Live Touch ARM joins the real pixel-verification promise', () => {
  const match = WIRE.match(/function chartDriftCheck\(\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'chartDriftCheck must exist');
  const block = match[0];

  assert.match(block, /if \(chartDriftVerified\) return Promise\.resolve\(true\)/);
  assert.match(block, /if \(chartDriftInFlight\) return chartDriftInFlight/);
  assert.match(block, /chartDriftInFlight = Promise\.all\(/);
  assert.match(block, /chartDriftVerified = true/);
  assert.match(block, /chartDriftInFlight = null/);
  assert.doesNotMatch(block, /chartDriftChecked = true/,
    'verification must never claim success before topology hashing finishes');
});
