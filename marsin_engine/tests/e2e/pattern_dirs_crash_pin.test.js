/**
 * pattern_dirs_crash_pin.test.js — regression guard for the CRITICAL
 * one-request engine kill found by `_164` and FIXED by `_167`.
 *
 * HISTORY (why this file exists). `GET /pattern-dirs/<invalid-slug>` used to
 * kill the WHOLE engine process. `lib/api_server.js` committed the response
 * headers BEFORE evaluating the body:
 *
 *   res.writeHead(200, { 'Content-Type': 'application/json' });        // (A)
 *   res.end(JSON.stringify(listPatternsInDir(patternsDir, dir)));      // (B)
 *   } catch (e) { res.writeHead(400); res.end(...); }                  // (C)
 *
 * `listPatternsInDir` REFUSES (throws) any slug failing `VALID_PATTERN_DIR`
 * (`/^[a-z0-9][a-z0-9_-]{0,63}$/`) — a traversal probe, an uppercase name,
 * a name with a dot or a space. That throw fired at (B), i.e. AFTER (A) had
 * already sent headers, so (C)'s second `writeHead` raised Node's
 * `ERR_HTTP_HEADERS_SENT` from inside the catch handler where nothing could
 * catch it. It reached `engine.js`'s `process.on('uncaughtException')`
 * (engine.js §uncaughtException), which logs ENGINE FATAL and
 * `process.exit(1)`. One unauthenticated GET from any device on the playa
 * LAN, or one stray curl, and the ship goes dark. `_164` reproduced it 7/7.
 *
 * THE FIX (`_167`, production change in `lib/api_server.js`), two halves:
 *   1. The route computes the body BEFORE committing headers, so a refused
 *      slug throws while the response is still uncommitted and answers a
 *      loud, NAMED 400 (P0: refuse the input, never a silent default).
 *   2. `sendJsonError()` — the shared error responder — checks
 *      `res.headersSent` and refuses to `writeHead` twice under ANY
 *      circumstance, logging the real fault on stderr instead. No global
 *      `uncaughtException` swallow was added; that would be a P0 fallback.
 *
 * WHAT THIS FILE ASSERTS NOW: every hostile/malformed slug yields a loud 4xx
 * with a named reason, the happy path still works, and — the whole point —
 * the engine process is STILL ALIVE afterwards. It keeps its own isolated
 * spawn/teardown (inherited from the pinning era) so that if this fix ever
 * regresses, the resulting process death is contained to this one file
 * instead of cascading false failures across the rest of the suite.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';
import { sendJsonError } from '../../lib/api_server.js';

const harness = createEngineHarness({
  scene: 'test_bench',
  prefix: 'patterndirscrash',
  // TEST-NET-1 (RFC 5737) black hole — loopback is not one.
  extraArgs: ['--dest', '192.0.2.9'],
});

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
});

after(async () => {
  await harness.teardown();
});

// Every one of these fails VALID_PATTERN_DIR (or decodeURIComponent) and so
// must be REFUSED with a named 4xx — and must never take the engine down.
// `..%2F..` is the traversal probe from `_164`; the `%2F` keeps it from being
// collapsed as a dot-segment by WHATWG URL normalisation before it is sent.
const HOSTILE_SLUGS = [
  { slug: '..%2F..', why: 'path traversal probe (decodes to ../..)' },
  { slug: '%2e%2e%2f%2e%2e', why: 'fully percent-encoded traversal' },
  { slug: 'Default', why: 'uppercase — the accidental client-typo case' },
  { slug: 'has%20space', why: 'space in the slug' },
  { slug: 'dot.dir', why: 'dot in the slug' },
  { slug: '_leading', why: 'leading underscore (must start alnum)' },
  { slug: '-leading', why: 'leading dash (must start alnum)' },
  { slug: 'a'.repeat(65), why: 'over the 64-char length cap' },
  { slug: '%ZZ', why: 'malformed percent-escape (decodeURIComponent throws)' },
  { slug: '%00', why: 'encoded NUL byte' },
];

for (const { slug, why } of HOSTILE_SLUGS) {
  test(`GET /pattern-dirs/${slug} → loud 4xx, engine survives (${why})`, async () => {
    const res = await fetch(`${harness.base()}/pattern-dirs/${slug}`);
    assert.equal(res.status, 400, `expected a loud 400 refusal for ${slug}`);

    const text = await res.text();
    const body = JSON.parse(text);
    // A NAMED refusal, not an empty/silent one: the message must say what
    // was rejected, so an operator reading the log knows why.
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0, 'refusal must carry a named reason');
    assert.ok(
      /Invalid pattern directory|URI malformed/.test(body.error),
      `unexpected refusal message for ${slug}: ${body.error}`,
    );

    // THE POINT OF THIS FILE: the process is still serving.
    assert.equal(harness.proc.exitCode, null, 'engine process must still be alive');
    const alive = await fetch(harness.base() + '/status');
    assert.equal(alive.status, 200);
  });
}

test('the happy paths still work after every hostile probe', async () => {
  const dirs = await fetch(harness.base() + '/pattern-dirs');
  assert.equal(dirs.status, 200);
  const dirList = await dirs.json();
  assert.ok(Array.isArray(dirList), '/pattern-dirs must return an array');
  assert.ok(dirList.includes('default'), 'synthetic root dir `default` must be listed');

  const inDir = await fetch(harness.base() + '/pattern-dirs/default');
  assert.equal(inDir.status, 200);
  assert.equal(inDir.headers.get('content-type'), 'application/json');
  const patterns = await inDir.json();
  assert.ok(Array.isArray(patterns), '/pattern-dirs/default must return an array');
  assert.ok(patterns.length > 0, 'the root pattern dir is not empty in this repo');
});

test('engine is still alive at the end of the whole sweep', async () => {
  assert.equal(harness.proc.exitCode, null);
  const res = await fetch(harness.base() + '/status');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.service, 'marsin-engine');
});

// ── unit: the second half of the fix, exercised directly ──────────────────
// The `headersSent` branch is the guard that makes ANY route incapable of
// turning a handled error into a process kill. Drive it against a fake
// response so the branch is covered without having to synthesise a real
// post-header throw in a live route.

test('sendJsonError writes a normal error response when headers are not sent', () => {
  const calls = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) { calls.push(['writeHead', status, headers]); this.headersSent = true; },
    end(body) { calls.push(['end', body]); this.writableEnded = true; },
  };
  sendJsonError(res, 400, { error: 'nope' });
  assert.deepEqual(calls, [
    ['writeHead', 400, undefined],
    ['end', JSON.stringify({ error: 'nope' })],
  ]);
});

test('sendJsonError passes explicit headers through to writeHead', () => {
  const calls = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) { calls.push(['writeHead', status, headers]); this.headersSent = true; },
    end(body) { calls.push(['end', body]); this.writableEnded = true; },
  };
  sendJsonError(res, 409, { error: 'busy' }, { 'Content-Type': 'application/json' });
  assert.deepEqual(calls[0], ['writeHead', 409, { 'Content-Type': 'application/json' }]);
});

test('sendJsonError NEVER calls writeHead twice once headers are sent', () => {
  const calls = [];
  const res = {
    headersSent: true,       // a route already committed its response
    writableEnded: false,
    writeHead() { throw new Error('ERR_HTTP_HEADERS_SENT — this is the process killer'); },
    end() { calls.push('end'); this.writableEnded = true; },
  };
  // Must not throw: throwing here is exactly what killed the engine.
  sendJsonError(res, 400, { error: 'too late' });
  assert.deepEqual(calls, ['end'], 'must close the socket, not re-send headers');
});

test('sendJsonError does not double-end an already-finished response', () => {
  let ends = 0;
  const res = {
    headersSent: true,
    writableEnded: true,
    writeHead() { throw new Error('must not be called'); },
    end() { ends++; },
  };
  sendJsonError(res, 500, { error: 'done already' });
  assert.equal(ends, 0);
});
