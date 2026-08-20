/**
 * output_config_guard.test.js — the engine has ONE output path, and a config
 * that says otherwise is a BOOT FAILURE.
 *
 * REPLACES tests/io/output_dispatch.test.js and tests/io/artnet_output.test.js.
 * Those exercised `lib/output_dispatch.js` and `lib/artnet_output.js` — the
 * per-controller direct-to-hardware mechanism (sACN unicast + Art-Net, with
 * `alsoFlat` dual-send) — which is REMOVED by operator ruling 2026-08-05. The
 * bridge cannot suspend, gate or account for a stream it never sees, so
 * "exactly one writer per (universe, controller)" was unprovable while that
 * mechanism existed.
 *
 * What must now be true, and is asserted here:
 *   - a config declaring the removed key is refused BY NAME at boot, never
 *     ignored (a silently-ignored routing key is a config that looks like it
 *     reaches hardware and does not — the exact breadcrumb being removed);
 *   - the refusal says where output actually goes, so the reader is not left
 *     guessing;
 *   - the repo's own config.yaml is clean;
 *   - the modules are gone, so nothing can quietly import them back.
 *
 *   node --test tests/io/output_config_guard.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { assertNoDirectHardwareRoutes, FORBIDDEN_KEYS, FORBIDDEN_NESTED }
  from '../../lib/output_config_guard.js';

const ENGINE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a clean config passes', () => {
  assertNoDirectHardwareRoutes({ sacn: { priority: 100, destinations: ['127.0.0.1'] } });
  assertNoDirectHardwareRoutes({});
  assertNoDirectHardwareRoutes(null);          // nothing to check is not a failure
});

test('a config that still declares `controllers:` REFUSES, by name', () => {
  const config = {
    sacn: { destinations: ['127.0.0.1'] },
    controllers: [{ name: 'X', host: '10.9.9.202', protocol: 'sACN', universes: [10, 12] }],
  };
  assert.throws(() => assertNoDirectHardwareRoutes(config, 'config.yaml'), (err) => {
    assert.match(err.message, /config\.yaml still declares 'controllers:'/);
    assert.match(err.message, /bypassing the simulation's sACN bridge/);
    assert.match(err.message, /REMOVED/);
    // The refusal must say where output DOES go, or it just says "no".
    assert.match(err.message, /sacn\.destinations/);
    assert.match(err.message, /single router/);
    return true;
  });
});

test('an EMPTY `controllers:` is refused too — the key is the breadcrumb', () => {
  // The whole point is that nobody rediscovers the mechanism from a leftover
  // key. Presence is the test, not content.
  assert.throws(() => assertNoDirectHardwareRoutes({ controllers: [] }), /'controllers:'/);
  assert.throws(() => assertNoDirectHardwareRoutes({ controllers: null }), /'controllers:'/);
});

test('a stray `alsoFlat:` / `protocol:` is refused — the same breadcrumb, different hat', () => {
  for (const key of FORBIDDEN_NESTED) {
    assert.throws(() => assertNoDirectHardwareRoutes({ [key]: true }),
      new RegExp(`declares '${key}:'`));
    assert.throws(() => assertNoDirectHardwareRoutes({ [key]: true }),
      /no per-controller transport any more/);
  }
});

test('the refusal names the file it was actually reading', () => {
  assert.throws(() => assertNoDirectHardwareRoutes({ controllers: [] }, '/tmp/other.yaml'),
    /\/tmp\/other\.yaml still declares/);
});

test('the repo config.yaml declares no direct-to-hardware route', () => {
  const config = yaml.load(fs.readFileSync(path.join(ENGINE_ROOT, 'config.yaml'), 'utf8'));
  assertNoDirectHardwareRoutes(config, 'config.yaml');
  for (const { key } of FORBIDDEN_KEYS) {
    assert.ok(!(key in config), `config.yaml must not carry '${key}'`);
  }
});

test('the removed mechanism is GONE from the tree, not merely unused', () => {
  for (const file of ['lib/output_dispatch.js', 'lib/artnet_output.js']) {
    assert.equal(fs.existsSync(path.join(ENGINE_ROOT, file)), false,
      `${file} must not exist — a dead module is exactly the breadcrumb that gets copied`);
  }
});

test('engine.js builds its output from the flat sACN sender, with no controller routing', () => {
  const src = fs.readFileSync(path.join(ENGINE_ROOT, 'engine.js'), 'utf8');
  assert.match(src, /import \{ createSacnOutput \} from '\.\/lib\/sacn_output\.js';/);
  assert.doesNotMatch(src, /createOutputDispatch|output_dispatch/,
    'engine.js must not reference the removed dispatch');
  assert.match(src, /assertNoDirectHardwareRoutes\(config,/,
    'the boot guard must run on the parsed config');
});

test('/status still declares outputRouting — permanently empty, never absent', () => {
  // ABSENCE means something different to the sim bridge: "this engine is too old
  // to say what it delivers itself", which makes one-writer unprovable and is a
  // hard refusal there. An explicit empty list is the positive proof.
  const src = fs.readFileSync(path.join(ENGINE_ROOT, 'lib', 'api_server.js'), 'utf8');
  assert.match(src, /outputRouting: \{ controllers: \[\] \},/);
});
