// Unit tests for the MIDI discovery server's pure helpers + capture write.
//
// serve.cjs is CommonJS (the tool dir has no package.json, so it inherits
// marsin_engine's "type": "module" — hence the .cjs extension and createRequire
// here). We test filename sanitize, timestamp, the payload-validating capture
// write, port-arg parsing, and prove the HTTP server accepts a /capture POST on
// an EPHEMERAL port (bind 0) — never 6979, per the task.
//
// Run:  cd marsin_engine && node --test tools/midi_discovery/serve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serve = require('./serve.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'midi_disc_'));
}

// ── safeDeviceName ────────────────────────────────────────────────────────────
test('safeDeviceName slugifies names', () => {
  assert.equal(serve.safeDeviceName('Intech Grid MIDI device'), 'intech_grid_midi_device');
  assert.equal(serve.safeDeviceName('APC mini mk2'), 'apc_mini_mk2');
  assert.equal(serve.safeDeviceName('FoH: MIDI Mix'), 'foh_midi_mix');
});

test('safeDeviceName strips path/traversal and edge chars', () => {
  assert.equal(serve.safeDeviceName('../../etc/passwd'), 'etc_passwd');
  assert.equal(serve.safeDeviceName('...'), 'unknown_device');
  assert.equal(serve.safeDeviceName(''), 'unknown_device');
  assert.equal(serve.safeDeviceName(null), 'unknown_device');
  assert.equal(serve.safeDeviceName('  leading  '), 'leading');
  // no slashes, dots, or spaces survive
  const out = serve.safeDeviceName('a/b\\c d.e');
  assert.ok(!/[\\/.\s]/.test(out), out);
});

test('safeDeviceName caps length at 64', () => {
  const out = serve.safeDeviceName('x'.repeat(200));
  assert.equal(out.length, 64);
});

// ── timestampStamp ────────────────────────────────────────────────────────────
test('timestampStamp formats UTC yyyymmdd_hhmmss', () => {
  const d = new Date(Date.UTC(2026, 6, 8, 9, 5, 3)); // 2026-07-08 09:05:03Z
  assert.equal(serve.timestampStamp(d), '20260708_090503');
});

test('captureFilename composes slug + stamp + .json', () => {
  const d = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(
    serve.captureFilename('Intech Grid MIDI device', d),
    'intech_grid_midi_device_20260102_030405.json',
  );
});

// ── writeCapture ──────────────────────────────────────────────────────────────
test('writeCapture writes pretty JSON and returns path', () => {
  const dir = tmpDir();
  const d = new Date(Date.UTC(2026, 6, 8, 12, 0, 0));
  const payload = {
    tool: 'midi_discovery',
    version: 1,
    device: { name: 'Intech Grid', ports: [] },
    labels: [],
    rawLog: [],
    summary: [],
  };
  const abs = serve.writeCapture(dir, payload, d);
  assert.equal(path.basename(abs), 'intech_grid_20260708_120000.json');
  const text = fs.readFileSync(abs, 'utf8');
  assert.ok(text.includes('\n  "tool": "midi_discovery"'), 'pretty-printed');
  assert.deepEqual(JSON.parse(text), payload);
});

test('writeCapture creates captures dir if missing', () => {
  const dir = path.join(tmpDir(), 'nested', 'captures');
  assert.ok(!fs.existsSync(dir));
  const payload = { tool: 'midi_discovery', device: { name: 'x' } };
  const abs = serve.writeCapture(dir, payload, new Date());
  assert.ok(fs.existsSync(abs));
});

test('writeCapture rejects non-object and wrong tool (fail loud)', () => {
  const dir = tmpDir();
  assert.throws(() => serve.writeCapture(dir, null, new Date()), /must be a JSON object/);
  assert.throws(() => serve.writeCapture(dir, [1, 2], new Date()), /must be a JSON object/);
  assert.throws(
    () => serve.writeCapture(dir, { tool: 'nope' }, new Date()),
    /unexpected tool field/,
  );
});

test('writeCapture falls back to "device" slug when name missing', () => {
  const dir = tmpDir();
  const abs = serve.writeCapture(dir, { tool: 'midi_discovery' }, new Date(Date.UTC(2026, 0, 1)));
  assert.match(path.basename(abs), /^device_\d{8}_\d{6}\.json$/);
});

// ── parsePortArg ──────────────────────────────────────────────────────────────
test('parsePortArg defaults and parses', () => {
  assert.equal(serve.parsePortArg(['node', 's']), serve.DEFAULT_PORT);
  assert.equal(serve.parsePortArg(['node', 's', '--port', '7000']), 7000);
});

test('parsePortArg fails loud on garbage', () => {
  assert.throws(() => serve.parsePortArg(['node', 's', '--port', 'abc']), /invalid --port/);
  assert.throws(() => serve.parsePortArg(['node', 's', '--port', '99999']), /invalid --port/);
});

test('default port is outside the dev stack (6967-6972)', () => {
  assert.equal(serve.DEFAULT_PORT, 6979);
  assert.ok(!serve.STACK_PORTS.has(serve.DEFAULT_PORT));
});

// ── HTTP server, ephemeral port ──────────────────────────────────────────────
test('POST /capture on ephemeral port writes a file', async () => {
  const server = serve.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  assert.notEqual(port, 6979); // never bind the real tool port in tests

  const payload = {
    tool: 'midi_discovery',
    version: 1,
    device: { name: 'Ephemeral Test Device', ports: [] },
    labels: [],
    rawLog: [],
    summary: [],
  };

  const body = await new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/capture',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });

  await new Promise((resolve) => server.close(resolve));

  assert.equal(body.status, 200);
  const parsed = JSON.parse(body.text);
  assert.equal(parsed.ok, true);
  assert.match(parsed.filename, /^ephemeral_test_device_\d{8}_\d{6}\.json$/);
  assert.ok(fs.existsSync(parsed.path), 'capture file exists on disk');
  // Clean up the real capture this test wrote into the tool's captures/ dir.
  fs.rmSync(parsed.path);
});

test('POST /capture rejects bad JSON with 400', async () => {
  const server = serve.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/capture' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
      },
    );
    req.on('error', reject);
    req.end('{not json');
  });

  await new Promise((resolve) => server.close(resolve));
  assert.equal(body.status, 400);
  assert.match(JSON.parse(body.text).error, /invalid JSON/);
});
