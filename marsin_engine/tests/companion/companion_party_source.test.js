/*
 * companion_party_source.test.js — the PARTY SIGNAL SOURCE selector, end to end
 * against a REAL spawned companion.
 *
 * The operator picks WHICH detector is published as `audioPartyStrong` on the
 * companion's PARTY tab (CaptainPad only exposes the same switch), so this pins
 * the wire contract both surfaces depend on:
 *
 *   1. `hello` seeds the selector (`partySource` + the legal `partySources`).
 *   2. The 10 Hz `partyState` carries the live source AND BOTH verdicts, so the
 *      operator can see what the other detector would be saying before switching.
 *   3. `setPartySource` PERSISTS into config.yaml's `party:` block first and only
 *      then switches — and answers with a typed `partySource` ack.
 *   4. A bogus source changes NOTHING and says so (no fallback, no silent snap).
 *
 * The spawned companion is fully isolated (black-holed engine + OSC, scratch
 * config, scratch state root) — see tests/helpers/companion_isolation.mjs. The
 * persist under test therefore writes the SCRATCH config, never the tracked one.
 *
 * Run:  cd marsin_engine && node --test tests/companion/companion_party_source.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEngineLinkDown, isolatedCompanionEnv } from '../helpers/companion_isolation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ENGINE_DIR, 'audio', 'companion', 'companion_server.js');

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForServer(port, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/catalog`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`companion server did not come up on :${port}`);
}

/** Resolve with the first message of `type` that also satisfies `match`. */
function waitFor(ws, type, match = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for a "${type}" message`)),
      timeoutMs,
    );
    const onMessage = (buf) => {
      const message = JSON.parse(buf.toString());
      if (message.type !== type || !match(message)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(message);
    };
    ws.on('message', onMessage);
  });
}

test('the PARTY signal source is selected, persisted and broadcast', async () => {
  const port = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const isolation = isolatedCompanionEnv('party_source');
  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port', String(port),
    '--model', 'test_bench',
    '--host', '127.0.0.1',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], {
    cwd: ENGINE_DIR,
    env: isolation.env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForServer(port);
    assert.equal(proc.exitCode, null, `spawned companion remains alive: ${stderr}`);
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const helloPromise = waitFor(ws, 'hello');
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const hello = await helloPromise;
    assertEngineLinkDown(hello, assert.ok);

    // 1. HELLO seeds the selector, so a reloaded tab paints the right choice.
    assert.equal(hello.partySource, 'qualified',
      'the tracked config.yaml must ship the gated detector as the source');
    assert.deepEqual(hello.partySources, ['qualified', 'simple']);

    // 2. The 10 Hz meter snapshot carries the source AND both live verdicts.
    const state = await waitFor(ws, 'partyState');
    assert.equal(state.source, 'qualified');
    assert.deepEqual(state.sources, ['qualified', 'simple']);
    assert.equal(typeof state.qualifiedParty, 'boolean', 'the gated verdict must always travel');
    assert.ok(state.simpleParty === null || typeof state.simpleParty === 'boolean',
      `simpleParty must be a verdict or an honest null, got ${JSON.stringify(state.simpleParty)}`);
    assert.ok(Number.isFinite(state.simpleLoudness), 'the simple detector loudness must travel');
    assert.ok(Number.isFinite(state.simpleOnThresh) && Number.isFinite(state.simpleOffThresh),
      'the simple detector thresholds must travel so the UI can explain its verdict');
    assert.equal(state.qualifiedParty, state.party,
      'qualifiedParty is the gated latch under an unambiguous name');

    // 3. SELECT SIMPLE — persisted into config.yaml, then acked, then live.
    ws.send(JSON.stringify({ type: 'setPartySource', source: 'simple' }));
    const ack = await waitFor(ws, 'partySource');
    assert.equal(ack.source, 'simple');
    assert.equal(ack.persisted, true, `the source write was refused: ${ack.error}`);
    assert.match(fs.readFileSync(isolation.configPath, 'utf8'), /^ +source: simple$/m,
      'the choice must live in config.yaml, not only in the running process');
    const simpleState = await waitFor(ws, 'partyState', (m) => m.source === 'simple');
    assert.equal(simpleState.source, 'simple');
    assert.equal(typeof simpleState.qualifiedParty, 'boolean',
      'both detectors keep running — the gated verdict stays visible while SIMPLE publishes');

    // 4. A bogus source changes NOTHING and says so.
    ws.send(JSON.stringify({ type: 'setPartySource', source: 'sophisticated' }));
    const rejected = await waitFor(ws, 'partySource');
    assert.equal(rejected.persisted, false);
    assert.match(rejected.error, /must be one of qualified\/simple/);
    assert.equal(rejected.source, 'simple', 'a rejected write must report what is STILL selected');
    assert.match(fs.readFileSync(isolation.configPath, 'utf8'), /^ +source: simple$/m,
      'a rejected source must not touch config.yaml');

    ws.close();
  } finally {
    proc.kill('SIGKILL');
    isolation.cleanup();
  }
});
