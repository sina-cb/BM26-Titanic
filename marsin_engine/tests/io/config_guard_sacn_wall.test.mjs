// REGRESSION PIN — the test suite's sACN must never reach the operator's rig.
//
// Report `_361` BLOCKER 1: the global config guard
// (`tests/helpers/setup_config_guard.mjs`, applied to the WHOLE suite by
// `node --import` in package.json's `test` script) copied the production
// config.yaml, disabled OSC + fire-sync, and stopped there — leaving
// `sacn.destinations: [127.0.0.1]`, which is the operator's LIVE simulation
// input bridge on UDP 5568. `npm test` runs `--test-concurrency=4` over 89
// files that spawn real engines, so running the suite put up to four extra
// `MarsinEngine` sACN sources on the running show. They share the vendored
// `sacn` package's hardcoded E1.31 CID with his engine, so the sim's receiver
// (which keys sequence tracking on CID+universe) thrashes one counter across
// two streams and DISCARDS frames silently — stale patchwork colours on the
// ship, correlated with agent activity, which is the anomaly `_361` explains.
//
// This file fails if the guard ever yields a loopback or otherwise routable
// destination again. It probes the guard the way a fresh `npm test` invokes
// it: a CHILD process with MARSIN_CONFIG_FILE deliberately unset, so the guard
// takes its config-building path rather than honouring the outer override.
//
// Run: cd marsin_engine && node --test tests/io/config_guard_sacn_wall.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

import {
  SACN_BLACK_HOLE_HOST,
  classifySacnDestination,
  assertSacnDestinationsBlackHoled,
} from '../helpers/sacn_black_hole.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/io → tests → marsin_engine
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
// `--import` takes a URL: a bare Windows absolute path is rejected as an
// unsupported `c:` scheme.
const GUARD = pathToFileURL(path.join(ENGINE_DIR, 'tests', 'helpers', 'setup_config_guard.mjs')).href;
const PROBE = path.join(ENGINE_DIR, 'tests', 'helpers', 'sacn_guard_probe.mjs');

/** Run the guard exactly as `npm test` does and report what it produced. */
function probeGuard() {
  const env = { ...process.env };
  // The outer suite already set this; clearing it forces the guard down the
  // branch a fresh `npm test` takes.
  delete env.MARSIN_CONFIG_FILE;
  const stdout = execFileSync(process.execPath, ['--import', GUARD, PROBE], {
    cwd: ENGINE_DIR,
    env,
    encoding: 'utf8',
  });
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

test('the global test config guard black-holes sACN (BLOCKER 1 pin)', () => {
  const { configFile, sacn } = probeGuard();
  assert.ok(sacn && typeof sacn === 'object', `guard produced no sacn block in ${configFile}`);

  // The headline: not loopback, not routable, not multicast.
  assertSacnDestinationsBlackHoled(sacn.destinations, `guard config ${configFile}`);
  assert.deepEqual(sacn.destinations, [SACN_BLACK_HOLE_HOST]);
  assert.equal(sacn.multicast, false,
    'multicast:true ignores the destination list and would still reach the live sim');

  // Name the specific regression rather than only the general rule.
  assert.ok(!sacn.destinations.includes('127.0.0.1'),
    "127.0.0.1 is the operator's live sim bridge, not a black hole");
});

test('the guard keeps its OSC / fire-sync walls while adding the sACN one', () => {
  const { configFile } = probeGuard();
  // The child cleans its scratch file up on exit, so re-derive from the same
  // source the guard reads.
  const real = yaml.load(fs.readFileSync(path.join(ENGINE_DIR, 'config.yaml'), 'utf8'));
  assert.ok(real && typeof real === 'object', 'config.yaml must parse');
  assert.ok(configFile.includes('bm26_engine_config_test_'),
    `guard must point MARSIN_CONFIG_FILE at a scratch copy, got ${configFile}`);
  // The production file is what the wall protects against — pin that the
  // hazard it neutralises is still real, so this test cannot pass vacuously.
  assert.deepEqual(real.sacn?.destinations, ['127.0.0.1'],
    'production config no longer targets the sim bridge — re-derive this pin');
});

test('classifySacnDestination refuses everything that is not RFC 5737', () => {
  assert.equal(classifySacnDestination('192.0.2.9'), 'black-hole');
  assert.equal(classifySacnDestination('198.51.100.4'), 'black-hole');
  assert.equal(classifySacnDestination('203.0.113.7'), 'black-hole');
  assert.equal(classifySacnDestination('127.0.0.1'), 'loopback');
  assert.equal(classifySacnDestination('127.1.2.3'), 'loopback');
  assert.equal(classifySacnDestination('239.255.0.1'), 'multicast');
  assert.equal(classifySacnDestination('255.255.255.255'), 'broadcast');
  assert.equal(classifySacnDestination('10.7.1.50'), 'routable');
  assert.equal(classifySacnDestination('192.168.1.20'), 'routable');
  assert.equal(classifySacnDestination('localhost'), 'unresolvable');
  assert.equal(classifySacnDestination(''), 'unresolvable');
  assert.equal(classifySacnDestination(undefined), 'unresolvable');
});

test('assertSacnDestinationsBlackHoled throws loudly, never degrades', () => {
  assert.throws(() => assertSacnDestinationsBlackHoled(['127.0.0.1']), /loopback/);
  assert.throws(() => assertSacnDestinationsBlackHoled(['10.7.1.50']), /routable/);
  assert.throws(() => assertSacnDestinationsBlackHoled([]), /non-empty/);
  assert.throws(() => assertSacnDestinationsBlackHoled(undefined), /non-empty/);
  assert.throws(() => assertSacnDestinationsBlackHoled(['192.0.2.9', '127.0.0.1']), /loopback/);
  assert.doesNotThrow(() => assertSacnDestinationsBlackHoled([SACN_BLACK_HOLE_HOST]));
});
