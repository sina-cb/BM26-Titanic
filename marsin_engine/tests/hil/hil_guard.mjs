/**
 * hil_guard.mjs — shared pre-flight guard for HIL tests (incident 2026-07-14).
 *
 * HIL tests connect to whatever engine already answers on their port (default
 * 6968) and MUTATE its state — they create playlists, add/patch/delete mixer
 * channels, write deck overlays + slots, save snapshots, etc. They do NOT spawn
 * an isolated engine (or, for the self-booting ones, they can silently fall
 * back onto a pre-existing engine if their slot port is already bound), so they
 * cannot redirect writes via MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR the way the
 * spawned-engine unit tests do. Run against a REAL engine (a live scene such as
 * `studiodj` on :6968) those writes leak straight into the tracked states/ +
 * simulation/scenes/ trees — which is exactly what happened once (a spurious
 * `hil_autocycle_test` playlist landed in simulation/scenes/studiodj/playlists/).
 *
 * `assertDisposableEngine(engineBase)` refuses to let a test proceed unless the
 * target engine is the disposable `test_bench` model (the README prerequisite).
 * No fallback (codex P0): a wrong or unreachable target FAILS LOUDLY at exit 2
 * BEFORE the test performs its first mutation, instead of quietly writing junk
 * into a real scene.
 *
 * Call it AFTER the test's engine-reachability/boot check and BEFORE the first
 * mutation, passing the SAME base URL the test mutates:
 *
 *   import { assertDisposableEngine } from './hil_guard.mjs';
 *   ...
 *   await assertDisposableEngine(ENGINE_BASE);   // or BASE, whatever the test uses
 */

import http from 'http';

// ── Inert under the unit test runner ────────────────────────────────────────
// HIL harnesses talk to (and MUTATE) a LIVE engine; they must NEVER execute
// inside `node --test`, which would hang on or corrupt a real engine. Node sets
// NODE_TEST_CONTEXT for every file it loads under --test, and nearly every
// harness imports this guard — so tripping here at import time turns a stray
// recursive/glob sweep into a clean no-op (exit 0, zero tests) instead of a
// hang. HIL is run via `npm run test:hil` (→ tests/hil/run_hil.mjs), never the
// default suite. (The default suite's glob already excludes `_test.mjs`; this
// is the belt-and-suspenders second line of defence.)
if (process.env.NODE_TEST_CONTEXT) {
  console.log('HIL harness — run via `npm run test:hil` (skipped under node --test)');
  process.exit(0);
}

// Dependency-free GET <engineBase>/status → { status, body }. Node builtins only.
function _getStatus(engineBase) {
  return new Promise((resolve, reject) => {
    const url = new URL('/status', engineBase);
    const req = http.request(
      { method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Refuse to run a state-mutating HIL test unless the target engine is the
 * disposable `test_bench` model. Prints a loud FATAL and process.exit(2) on a
 * wrong model or an unreachable engine — never returns falsy / never silently
 * passes (codex P0: fail loudly, no fallback).
 *
 * @param {string} engineBase - the base URL the test mutates, e.g.
 *   `http://127.0.0.1:6968`. Must be the SAME base the test POSTs/PATCHes to.
 */
export async function assertDisposableEngine(engineBase) {
  let res;
  try {
    res = await _getStatus(engineBase);
  } catch (e) {
    console.error(`  FATAL: HIL guard could not reach an engine at ${engineBase}/status.`);
    console.error(`  ${e && e.message ? e.message : e}`);
    console.error('  HIL tests MUTATE engine state and must target a disposable test_bench engine.');
    console.error('  Start one: node engine.js --pattern test_const --model test_bench --port <port>');
    process.exit(2);
  }
  const model = res && res.body && res.body.activeModel;
  if (model !== 'test_bench') {
    console.error('  FATAL: refusing to run — target engine is NOT the disposable test model.');
    console.error(`  /status activeModel = ${JSON.stringify(model)}; HIL tests only run against 'test_bench'.`);
    console.error('  These tests MUTATE engine state (playlists, mixer channels, deck overlays/slots,');
    console.error('  snapshots …); against a real scene those writes leak straight into the tracked');
    console.error('  states/ + simulation/scenes/ trees. No fallback — start a dedicated engine:');
    console.error(`    node engine.js --pattern test_const --model test_bench   (target ${engineBase})`);
    process.exit(2);
  }
  console.log(`  guard: target engine model = '${model}' (disposable test_bench) OK`);
}
