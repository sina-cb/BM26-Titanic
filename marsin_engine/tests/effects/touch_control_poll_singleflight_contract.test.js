import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIRE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js'),
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

test('background polling is hidden-aware and serializes effect reconciliation', () => {
  const block = WIRE.match(
    /function runBackgroundRefresh\(\)[\s\S]*?setInterval\(runBackgroundRefresh, POLL_MS\)/,
  );
  assert.ok(block, 'runBackgroundRefresh implementation is missing');
  assert.match(block[0], /if \(document\.hidden\) return Promise\.resolve\(null\)/);
  assert.match(block[0], /return refresh\(\)\.then\(function \(status\)/);
  assert.match(block[0], /if \(status && state\.armed && !armChainBusy\) return reconcileEffects\(\)/);
});

test('transient refresh failures use the calm unavailable state without a raw error toast', () => {
  const block = WIRE.match(/function refresh\(\)[\s\S]*?\n  \}/);
  assert.ok(block, 'refresh implementation is missing');
  assert.match(block[0], /var transientTransport = e && \(e\.code === 'TRANSPORT_TIMEOUT'/);
  assert.match(block[0], /if \(!transientTransport\) \{\s*fail\('refresh', e\)/);
  assert.match(block[0], /background refresh unavailable/);
  assert.match(block[0], /setStatus\(\)/);
});

test('an authoritative refresh success clears only a prior refresh-class error', () => {
  assert.match(WIRE, /function clearRecoveredRefreshError\(\)/);
  assert.match(WIRE, /if \(lastErrorSource !== 'refresh'\) return/);
  assert.match(WIRE, /state\.online = true;\s*clearRecoveredRefreshError\(\)/);
});
