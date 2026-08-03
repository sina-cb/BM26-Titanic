/**
 * save_server_hardening.test.js — Wave 1 W1-4 (report 20260725_119).
 *
 * End-to-end regressions for the save-server's hostile-input surface, run
 * against the REAL server process bound to a random high port and pointed at a
 * throwaway temp root — never the operator's :6970, never the real scenes/.
 * These flip red-team findings 20260725_109 P1-1 (a malformed /controllers/probe
 * killed the whole process) and _115 L5 (a failed write still answered 200
 * SAVED) into green proofs, and confirm the process SURVIVES every hostile body.
 *
 * The env hooks SIM_SAVE_SERVER_PORT / SIM_SAVE_SERVER_ROOT are test-only and
 * default to production behavior when unset (see save-server.js).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAVE_SERVER = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'server', 'save-server.js');

let child = null;
let port = 0;
let tmpRoot = '';
let childExited = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

/** HTTP request helper that tolerates a mid-upload reset (the oversized case). */
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body));
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method,
      // A fresh socket per request: the oversized-body test destroys its
      // connection, and a pooled socket must never bleed that reset into a later
      // request.
      agent: false,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => done(resolve, { status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (err) => done(reject, err));
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  port = await freePort();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saveserver_hardening_'));
  // Seed the honest-write-failure trap: a plain FILE where a scene DIRECTORY is
  // expected, so /save?scene=faildir cannot create scenes/faildir and the write
  // fails for real (deterministic, cross-platform) — no chmod games.
  fs.mkdirSync(path.join(tmpRoot, 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'scenes', 'faildir'), 'not a directory');

  child = spawn(process.execPath, [SAVE_SERVER], {
    env: { ...process.env, SIM_SAVE_SERVER_PORT: String(port), SIM_SAVE_SERVER_ROOT: tmpRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('exit', (code, signal) => { childExited = { code, signal }; });
  child.stderr.on('data', () => { /* swallowed; failures show up as request errors */ });

  await new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('save-server did not report listening in 10 s')), 10_000);
    child.stdout.on('data', (d) => { buf += d.toString(); if (/listening on/.test(buf)) { clearTimeout(to); resolve(); } });
  });
});

after(() => {
  if (child && childExited === null) child.kill('SIGKILL');
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('a negative timeoutMs is a 400, not a process kill (P1-1)', async () => {
  const r = await request('POST', '/controllers/probe',
    { targets: [{ id: 1, ip: '192.0.2.1', type: 'DMX' }], timeoutMs: -1 });
  assert.equal(r.status, 400);
  assert.match(r.body, /timeoutMs/);
  assert.equal(childExited, null, 'the server process must still be alive');
});

test('the server is still fully functional after the P1-1 attack', async () => {
  const r = await request('POST', '/controllers/probe',
    { targets: [{ id: 2, ip: '192.0.2.2', type: 'DMX' }], timeoutMs: 300 });
  assert.equal(r.status, 200);
  assert.equal(childExited, null);
});

test('a "null" body is a 400, not a TypeError → process kill', async () => {
  const r = await request('POST', '/controllers/probe', 'null');
  assert.equal(r.status, 400);
  assert.equal(childExited, null);
});

test('a garbage (non-JSON) body is rejected, not fatal', async () => {
  const r = await request('POST', '/controllers/probe', '{not valid json');
  assert.equal(r.status, 400);
  assert.match(r.body, /invalid JSON/);
  assert.equal(childExited, null);
});

test('a non-array targets is a 400', async () => {
  const r = await request('POST', '/controllers/probe', { targets: 'everything' });
  assert.equal(r.status, 400);
  assert.match(r.body, /targets/);
});

test('an oversized body is rejected loudly (413 or connection reset), not buffered', async () => {
  try {
    const r = await request('POST', '/controllers/probe',
      JSON.stringify({ targets: [], pad: 'x'.repeat(2 * 1024 * 1024) }));
    assert.equal(r.status, 413);
  } catch (e) {
    // The server destroys the connection mid-upload — a valid "rejected" signal.
    assert.equal(e.code, 'ECONNRESET');
  }
  assert.equal(childExited, null, 'the server survives an oversized body');
});

test('a save whose disk write fails answers a NAMED 500, never a false 200 SAVED (L5 save-honesty)', async () => {
  const r = await request('POST', '/save?scene=faildir', 'someKey: 1\n');
  assert.notEqual(r.status, 200, 'a failed write must never report success');
  assert.equal(r.status, 500);
  assert.match(r.body, /^Error: /, 'the failure must be named, not a bare "Error"');
  assert.doesNotMatch(r.body, /Saved/);
  assert.equal(childExited, null);
});

test('the server survives the whole barrage', async () => {
  const r = await request('POST', '/controllers/probe', { targets: [] });
  assert.equal(r.status, 200);
  assert.equal(childExited, null);
});
