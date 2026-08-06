/**
 * http_malformed_sweep.test.js — hostile/malformed HTTP input sweep across
 * the unauthenticated REST surface (catalog `.agent/reports/202608/
 * 20260805_162_engine_test_gap_catalog.md` G-5, rank 5) plus the
 * `/save-pattern` + `/pattern` compile-failure honesty checks (G-15, folded
 * in per the catalog).
 *
 * The API is DELIBERATELY unauthenticated on the playa LAN (report `_157`
 * D7) — hostile input is an expected operating condition, not a hardening
 * nice-to-have. Before this file, every HTTP-side test sent well-formed
 * bodies; only `ws_frame_crashproof.test.js` (WebSocket side) proved the
 * engine survives abuse. Nothing exercised the shared `readBody` helper's
 * 413 cap, per-route bad-JSON handling, or the traversal guards
 * (`path.basename` call sites) at the HTTP layer.
 *
 * Uses `createEngineHarness` (`--dest 127.0.0.9`, black-holed) against the
 * `test_bench` scene. All assertions are RESPONSE-SHAPE + PROCESS-ALIVE: the
 * real guarantee under test is that the engine never 5xxs, never drops the
 * connection, and never dies — `/status` after every attack is the load-
 * bearing check.
 *
 * `/timeline/plans` is deliberately NOT in the curated route list: the
 * harness always sets `BM26_DISABLE_TIMELINE=1` (spawn_engine.mjs), and
 * every `/timeline/*` route short-circuits to `503 {error:'timeline
 * disabled'}` BEFORE `readBody` ever runs (api_server.js:6181) — so it can
 * never exercise the bad-JSON/wrong-shape/413 paths under this harness.
 * `/mixer/channels` carries the 413 case instead (same shared `readBody`
 * cap, actually reachable here).
 *
 * CRITICAL FINDING carved out into its own file, not tested here:
 * `GET /pattern-dirs/<invalid-slug>` (e.g. the catalog's own
 * `../..`-via-`..%2F..` example) CRASHES THE WHOLE ENGINE — see
 * `pattern_dirs_crash_pin.test.js` for the isolated repro, root cause, and
 * the reason it cannot safely share this file's harness.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_DIR = path.resolve(__dirname, '..', '..', 'patterns');

const harness = createEngineHarness({
  scene: 'test_bench',
  prefix: 'httpsweep',
  extraArgs: ['--dest', '127.0.0.9'],
});

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
});

after(async () => {
  await harness.teardown();
});

async function assertAlive() {
  const { status, data } = await harness.api('GET', '/status');
  assert.equal(status, 200);
  assert.equal(data.service, 'marsin-engine');
}

/** Raw fetch so we control the exact body bytes (harness.api always JSON.stringifies). */
async function rawPost(method, urlPath, body) {
  const res = await fetch(harness.base() + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json };
}

// A curated set of ~15 mutating endpoints spanning every major subsystem
// (pattern, mixer, deck, playlists, settings, timeline, global effects,
// param-center, OSC config, scene) — each POST/PATCH/PUT and each funneling
// through the shared `readBody` (api_server.js:4878-4901).
const MUTATING_ROUTES = [
  { method: 'PUT', path: '/pattern' },
  { method: 'POST', path: '/save-pattern' },
  { method: 'POST', path: '/mixer/channels' },
  { method: 'POST', path: '/mixer/view' },
  { method: 'PATCH', path: '/mixer' },
  { method: 'PATCH', path: '/deck/channel' },
  { method: 'POST', path: '/deck/playlist' },
  { method: 'POST', path: '/playlists' },
  { method: 'POST', path: '/settings' },
  { method: 'POST', path: '/global-effect-macros/blackout' },
  { method: 'POST', path: '/param-center' },
  { method: 'PATCH', path: '/osc/config' },
  { method: 'POST', path: '/scene' },
  { method: 'POST', path: '/mixer/master/fade' },
];

// Routes confirmed (empirically, at test-write time) to accept a non-object
// body ([] / 42) as a no-op 200 rather than rejecting it — every field they
// read is gated by `data.<field> !== undefined`, which is simply false for
// an array/number, so the handler falls through to its "nothing to do"
// 200 rather than validating the top-level shape. Not a crash and not data
// corruption (PATCH partial-update semantics: "no recognized fields" reads
// as "no-op" under this design), but it is inconsistent with every OTHER
// route in this sweep, which do reject with 4xx — flagged for the reviewer
// as a minor consistency defect, not pinned as a per-route characterization
// since the exact set is an implementation accident, not a documented
// contract.
const ACCEPTS_NONOBJECT_AS_NOOP = new Set([
  'POST /mixer/view', 'PATCH /mixer', 'PATCH /deck/channel', 'POST /param-center',
  // PATCH /osc/config DOES check `typeof data !== 'object'` (api_server.js:8038)
  // — but `typeof [] === 'object'` is true in JS, so only the NUMBER case
  // (42) is rejected; the empty-array case slips through as a same no-op
  // patch. A number-vs-array inconsistency in an "is this an object" guard.
  'PATCH /osc/config',
]);

for (const { method, path: routePath } of MUTATING_ROUTES) {
  test(`${method} ${routePath}: top-level bad JSON -> 400 {error:'Invalid JSON'}, engine stays up`, async () => {
    const { status, json } = await rawPost(method, routePath, '{not json');
    assert.equal(status, 400, `${method} ${routePath} must reject bad JSON with 400, got ${status}`);
    assert.deepEqual(json, { error: 'Invalid JSON' });
    await assertAlive();
  });

  test(`${method} ${routePath}: valid JSON, wrong shape ([] / 42) -> never 5xx, never a drop`, async () => {
    const key = `${method} ${routePath}`;
    for (const body of ['[]', '42']) {
      const { status } = await rawPost(method, routePath, body);
      assert.ok(status < 500, `${method} ${routePath} with body ${body} must never 5xx, got ${status}`);
      if (!ACCEPTS_NONOBJECT_AS_NOOP.has(key)) {
        assert.ok(status >= 400, `${method} ${routePath} with body ${body} expected 4xx, got ${status}`);
      }
      await assertAlive();
    }
  });
}

// ── 413 cap ────────────────────────────────────────────────────────────
// (via /mixer/channels — /timeline/plans is disabled under this harness,
// see file header)

test('POST /mixer/channels: a body over 1 MB is rejected with 413, engine stays up', async () => {
  const oversized = 'a'.repeat(1024 * 1024 + 1);
  const { status, json } = await rawPost('POST', '/mixer/channels', oversized);
  assert.equal(status, 413);
  assert.deepEqual(json, { error: 'Request body too large (max 1 MB)' });
  await assertAlive();
});

// ── Traversal set ──────────────────────────────────────────────────────

test('POST /pattern {pattern:"../models/titanic"}: basename strips to "titanic" -> 404, no path outside patterns/', async () => {
  const { status, data } = await harness.api('PUT', '/pattern', { pattern: '../models/titanic' });
  assert.ok(status === 404 || status === 400, `expected 404/400, got ${status}`);
  const errStr = JSON.stringify(data);
  assert.doesNotMatch(errStr, /models[\\/]titanic\.js/, 'error must not name a path outside patterns/');
});

test('GET /pattern-code?name=../../secret.yaml: 404, body is exactly "Not Found" (never file contents)', async () => {
  const res = await fetch(harness.base() + '/pattern-code?name=../../secret.yaml');
  const text = await res.text();
  assert.equal(res.status, 404);
  assert.equal(text, 'Not Found');
  assert.doesNotMatch(text, /sacn:/);
});

// GET /pattern-dirs/..%2F.. is intentionally NOT exercised here — see
// pattern_dirs_crash_pin.test.js. It crashes the whole engine
// (ERR_HTTP_HEADERS_SENT, api_server.js:4911-4920), so it cannot share this
// file's harness without taking down every test that runs after it.

test('unknown route: GET /definitely-not-a-route -> 404', async () => {
  const res = await fetch(harness.base() + '/definitely-not-a-route');
  assert.equal(res.status, 404);
  await assertAlive();
});

test('N-5 subdir-slug pin: POST /pattern {pattern:"test/breathing"} resolves via basename to "breathing" -> 404', async () => {
  // Catalog N-5: direct pattern-set routes apply path.basename, which
  // MANGLES legal subdir slugs — playlist-driven loads accept `dir/name`
  // correctly (VALID_PATTERN regex), but this direct route does not. Pinned
  // WITH the N-5 reference: if the fix wave changes this routing, this test
  // is the tripwire that the semantic changed on purpose. Verified at
  // test-write time: patterns/breathing.js does NOT exist (only
  // patterns/test/breathing.js), so this 404s today rather than silently
  // loading the wrong root-level pattern.
  assert.equal(fs.existsSync(path.join(PATTERNS_DIR, 'breathing.js')), false,
    'sanity: no root-level breathing.js exists to be silently loaded instead');
  assert.equal(fs.existsSync(path.join(PATTERNS_DIR, 'test', 'breathing.js')), true,
    'sanity: patterns/test/breathing.js exists');
  const { status } = await harness.api('PUT', '/pattern', { pattern: 'test/breathing' });
  assert.equal(status, 404, 'basename("test/breathing") -> "breathing", which has no root-level file (N-5)');
  await assertAlive();
});

// ── G-15: /save-pattern + /pattern compile-failure honesty ────────────────

test('POST /save-pattern with code that fails to compile: 400, carries the VM error, file NOT created', async () => {
  const tmpName = 'zz_gap162_tmp_compile_fail';
  const tmpPath = path.join(PATTERNS_DIR, `${tmpName}.js`);
  try {
    const { status, data } = await harness.api('POST', '/save-pattern', {
      name: tmpName, code: 'this is not a pattern (',
    });
    assert.equal(status, 400);
    assert.ok(data && typeof data.error === 'string' && data.error.length > 0,
      'response carries the VM compile error text');
    assert.equal(fs.existsSync(tmpPath), false,
      'compile gate precedes write (api_server.js:5030-5036) — the bad file must never land');
  } finally {
    // Residue rule: writes inside the repo patterns dir are unavoidable for
    // this test; always clean up the zz_gap162_ prefix in teardown even on
    // an unexpected pass/fail path.
    try { fs.unlinkSync(tmpPath); } catch { /* never created — expected */ }
  }
});

test('POST /save-pattern with valid code: 200, file exists, then cleaned up', async () => {
  const tmpName = 'zz_gap162_tmp_valid';
  const tmpPath = path.join(PATTERNS_DIR, `${tmpName}.js`);
  try {
    const { status, data } = await harness.api('POST', '/save-pattern', {
      name: tmpName,
      code: 'export function render(index, time) { return [0, 0, 0]; }',
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { status: 'ok' });
    assert.equal(fs.existsSync(tmpPath), true);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
  }
});

test('PUT /pattern with a nonexistent pattern: 404, deck survives (activePattern unchanged)', async () => {
  const before404 = await harness.api('GET', '/status');
  const activeBefore = before404.data.activePattern;
  const { status } = await harness.api('PUT', '/pattern', { pattern: 'nonexistent_xyz_gap162' });
  assert.equal(status, 404);
  const after404 = await harness.api('GET', '/status');
  assert.equal(after404.data.activePattern, activeBefore, 'the deck channel must survive a 404 pattern load');
  await assertAlive();
});
