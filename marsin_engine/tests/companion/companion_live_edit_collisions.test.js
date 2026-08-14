// Live-edit COLLISION tests for the Audio Companion signal designer.
//
// The loader (validateCompanionConfig) refuses a design in which two OUTPUT
// signals resolve to the same cpcKey, or send to the same OSC address — either
// one silently clobbers the other at the engine. Those checks used to run at
// LOAD time only: the live WS mutation handlers (addSignal / setChain /
// setOscAddress) skipped them, so an operator could build over the wire a
// design the loader would have rejected — one that hijacks a curated,
// mission-critical key (micLow drives the exterior) and then fails to reload on
// the next boot. companion_server.js now runs one SHARED collision gate
// (outputCollisionError) on every mutation; this file proves it.
//
// Boots the REAL companion server, isolated: --no-mic (no capture device is
// ever opened) + --source test + loopback OSC/engine ports.
//
// Run:  cd marsin_engine
//       node --import ./tests/helpers/setup_config_guard.mjs --test \
//            tests/companion/companion_live_edit_collisions.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.join(__dirname, '..', '..');
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

async function waitForServer(port, timeoutMs = 8000) {
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

/**
 * Boot an ISOLATED companion (no mic, loopback targets) and run `fn(ws)`.
 *
 * EVERY port is ephemeral, the OSC + engine targets included. Hardcoding the
 * documented bench ports (31601/31668) turned this into a shared-resource test
 * — two spawned companions aimed at the same targets — which is why the whole
 * companion suite had to run at `--test-concurrency=1`.
 */
async function withCompanion(fn) {
  const port = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port', String(port),
    '--host', '127.0.0.1',
    '--model', 'test_bench',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForServer(port);
    assert.equal(proc.exitCode, null, `spawned companion remains alive: ${stderr}`);
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const hello = await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (buf) => {
        const m = JSON.parse(buf.toString());
        if (m.type === 'hello') resolve(m);
      });
    });
    // One request → one typed reply, so each assertion reads its own result.
    const request = (message, replyType) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${replyType} within 5s`)), 5000);
      const onMessage = (buf) => {
        const m = JSON.parse(buf.toString());
        if (m.type !== replyType) return;
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(m);
      };
      ws.on('message', onMessage);
      ws.send(JSON.stringify(message));
    });
    await fn({ ws, hello, request, port });
    ws.close();
  } finally {
    proc.kill('SIGKILL');
  }
}

/** The terminal osc_out tap of a designed signal. */
const tapOf = (sig) => sig.chain[sig.chain.length - 1];

test('renaming a signal osc_out name onto an existing curated key is REJECTED', async () => {
  await withCompanion(async ({ hello, request }) => {
    // The shipped design already publishes every curated output, so `micLow`
    // (the exterior's low band) is taken by the built-in `low` signal.
    const curatedOwner = hello.signals.find((s) => tapOf(s).params.name === 'micLow');
    assert.ok(curatedOwner, 'the boot design publishes micLow');

    // A fresh dynamic signal, born with its own uid-suffixed name.
    const added = await request({ type: 'addSignal', source: 'rawLow' }, 'addResult');
    assert.equal(added.ok, true, added.error);
    const victim = added.signal;
    assert.notEqual(tapOf(victim).params.name, 'micLow');

    // Rename its tap onto the curated key → the engine would see micLow written
    // by two producers. Must be refused, and the error must name the collision.
    const chain = victim.chain.map((op, i) => (i === victim.chain.length - 1
      ? { ...op, params: { ...op.params, name: 'micLow' } }
      : op));
    const res = await request({ type: 'setChain', id: victim.id, chain }, 'chainResult');
    assert.equal(res.ok, false, 'rename onto a curated key must be rejected');
    assert.match(res.error, /micLow/);
    assert.match(res.error, /already published by signal/);
    assert.match(res.error, new RegExp(curatedOwner.id));
  });
});

test('the design survives a rejected rename with one producer per curated key', async () => {
  await withCompanion(async ({ request, port }) => {
    const added = await request({ type: 'addSignal', source: 'rawLow' }, 'addResult');
    assert.equal(added.ok, true, added.error);
    const victim = added.signal;
    const chain = victim.chain.map((op, i) => (i === victim.chain.length - 1
      ? { ...op, params: { ...op.params, name: 'micLow' } }
      : op));
    const res = await request({ type: 'setChain', id: victim.id, chain }, 'chainResult');
    assert.equal(res.ok, false);

    const catalog = await (await fetch(`http://127.0.0.1:${port}/catalog`)).json();
    const names = catalog.signals.map((s) => tapOf(s).params.name);
    assert.equal(names.filter((n) => n === 'micLow').length, 1, 'micLow still has exactly one producer');
    const stillVictim = catalog.signals.find((s) => s.id === victim.id);
    assert.equal(tapOf(stillVictim).params.name, tapOf(victim).params.name, 'the rejected edit was not partially applied');
    // No curated output was orphaned by the attempt.
    assert.deepEqual(catalog.missingCuratedOutputs, []);
  });
});

test('renaming an OSC address onto another output address is REJECTED', async () => {
  await withCompanion(async ({ request, port }) => {
    const a = await request({ type: 'addSignal', source: 'rawMid' }, 'addResult');
    const b = await request({ type: 'addSignal', source: 'rawMid' }, 'addResult');
    assert.equal(a.ok, true, a.error);
    assert.equal(b.ok, true, b.error);
    const bAddress = `/marsin/audio/${tapOf(b.signal).params.name}`;

    const res = await request({ type: 'setOscAddress', id: a.signal.id, address: bAddress }, 'oscAddressResult');
    assert.equal(res.ok, false, 'two outputs must not share a wire address');
    assert.match(res.error, /address/i);

    const accounting = await (await fetch(`http://127.0.0.1:${port}/osc_accounting`)).json();
    const hits = accounting.outputs.filter((o) => o.address === bAddress);
    assert.equal(hits.length, 1, 'the contested address still has exactly one owner');
  });
});
