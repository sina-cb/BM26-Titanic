import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wire = fs.readFileSync(
  path.resolve(here, '../../../CaptainPad/live_touch/touch_control_wire.js'),
  'utf8',
);
const html = fs.readFileSync(
  path.resolve(here, '../../../CaptainPad/live_touch/touch_control.html'),
  'utf8',
);

test('wire request failures separate calm operator copy from diagnostics', () => {
  const block = wire.match(/function requestFailure[\s\S]*?function requestTimeoutFailure/);
  assert.ok(block, 'request failure formatter is missing');
  assert.match(block[0], /error\.operatorMessage/);
  assert.match(block[0], /error\.diagnostic = diagnostic/);
  assert.doesNotMatch(block[0], /bodyText.*slice/,
    'response bodies must not be copied into production diagnostics');

  const timeout = wire.match(/function requestTimeoutFailure[\s\S]*?\n  \}/);
  assert.ok(timeout, 'request timeout formatter is missing');
  assert.match(timeout[0], /Connection to the lighting engine is slow/);
  assert.match(timeout[0], /error\.code = 'TRANSPORT_TIMEOUT'/);
});

test('production error toast rejects raw response-shaped messages', () => {
  const block = wire.match(/function operatorSafeErrorMessage[\s\S]*?function fail/);
  assert.ok(block, 'operator-safe error formatter is missing');
  assert.match(block[0], /message\.length > 240/);
  assert.match(block[0], /\(\?:GET\|POST\|PUT\|PATCH\|DELETE\)/);
  assert.match(wire, /state\.lastErrorDetail = err && err\.operatorDetail/);
});

test('disarm reports one calm aggregate after all safety steps run', () => {
  const step = wire.match(/function handbackStep[\s\S]*?function abortArm/);
  assert.ok(step, 'handback step implementation is missing');
  assert.doesNotMatch(step[0], /fail\('disarm\//);

  const cleanup = wire.match(/function cleanupLiveState[\s\S]*?function cleanupThenReleaseArmLease/);
  assert.ok(cleanup, 'cleanup implementation is missing');
  assert.match(cleanup[0], /cleanupError\.operatorMessage/);
  assert.match(cleanup[0], /cleanupError\.code = 'DISARM_INCOMPLETE'/);
});

test('preset transport and status notices use bounded operator copy', () => {
  const preset = html.match(/function presetsReq[\s\S]*?\/\* Read-only:/);
  assert.ok(preset, 'preset request transport is missing');
  assert.match(preset[0], /The preset store is temporarily unavailable/);
  assert.match(preset[0], /Connection to the preset store is slow/);
  assert.doesNotMatch(preset[0], /new Error\(method \+ ' ' \+ path/);

  const panelStatus = html.match(
    /document\.addEventListener\('panelstatus'[\s\S]*?\n    \}\);/,
  );
  assert.ok(panelStatus, 'panel status listener is missing');
  assert.match(panelStatus[0], /Number\(detail\.ttlMs\) > 0/);
});
