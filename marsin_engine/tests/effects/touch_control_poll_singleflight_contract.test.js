import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIRE = fs.readFileSync(
  path.resolve(HERE, '../../../docs/ui/touch_control_wire.js'),
  'utf8',
);

test('the periodic Live Touch refresh is single-flight', () => {
  assert.match(WIRE, /var refreshInFlight = null/);
  assert.match(WIRE, /if \(refreshInFlight\) return refreshInFlight/);
  assert.match(WIRE, /refreshInFlight = refreshInFlight\.then\(/);
});

test('global effect slot reads are shared without weakening strict ARM verification', () => {
  assert.match(WIRE, /var loadSlotsInFlight = null/);
  assert.match(WIRE, /if \(!loadSlotsInFlight\)/);
  assert.match(WIRE, /loadSlotsInFlight = req\('GET', '\/global-effect-slots'\)/);
  assert.match(WIRE, /return loadSlotsInFlight\.catch\(function \(e\)/);
  assert.match(WIRE, /if \(strict\) throw e/);
});

test('refresh awaits slot reconciliation instead of launching it unowned', () => {
  assert.match(WIRE, /return loadSlots\(false\)\.then\(function \(\)/);
  assert.doesNotMatch(WIRE, /chartDriftCheck\(\);\s*loadSlots\(\);/);
});
