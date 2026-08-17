import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WebSocket, WebSocketServer } from 'ws';

import { mergeAudioConfig } from '../../audio/config/audio_config.js';
import { isolatedCompanionEnv } from '../helpers/companion_isolation.mjs';
import { loadTrackedAudioAnalysisConfig } from '../helpers/tracked_audio_config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ENGINE_DIR, 'audio', 'companion', 'companion_server.js');
// The truth each fake engine serves. TRACKED config.yaml only: reading the
// EFFECTIVE test_bench config handed the fakes the operator's live tuning
// (fftSize 1024 rather than the shipped 2048, inputGain 8.83 rather than 1), so
// the config these retry tests negotiate over changed with every knob turn.
// See tests/helpers/tracked_audio_config.mjs.
const TRACKED_AUDIO_CONFIG = loadTrackedAudioAnalysisConfig(ENGINE_DIR);

// The retry bounds companion_server.js documents. Mirrored here so a test that
// waits on a retry names the number it is waiting for; a bounds change that
// forgets these makes the wait obviously wrong instead of quietly slow.
const RETRY_MIN_MS = 250;
const RETRY_MAX_ATTEMPTS = 8;

let isolationSeq = 0;

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitUntil(predicate, label, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function waitForMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('message timeout')), timeoutMs);
    const listener = (buffer) => {
      const message = JSON.parse(buffer.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.off('message', listener);
      resolve(message);
    };
    ws.on('message', listener);
  });
}

/**
 * Boot the REAL companion against a fake engine on `enginePort`, isolated the
 * `_173` way: `MARSIN_CONFIG_FILE` points at a scratch config whose configured
 * companion endpoints are black-holed to TEST-NET-1, the source is the
 * synthetic generator, and `--no-mic` refuses to open the operator's
 * microphone. Every port is an OS-assigned free one, so this can never be the
 * live stack's 6966-6972 / 5568 / 10000.
 */
async function bootCompanion(enginePort) {
  const companionPort = await getFreePort();
  const oscPort = await getFreePort();
  const isolation = isolatedCompanionEnv(`derived_patch_order_${isolationSeq++}`);
  const state = { stderr: '' };
  const proc = spawn('node', [
    SERVER,
    '--port', String(companionPort),
    '--host', '127.0.0.1',
    '--model', 'test_bench',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], { cwd: ENGINE_DIR, env: isolation.env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (chunk) => { state.stderr += chunk.toString(); });
  const companion = {
    proc,
    companionPort,
    get stderr() { return state.stderr; },
    close() {
      proc.kill('SIGKILL');
      isolation.cleanup();
    },
  };
  try {
    await waitUntil(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${companionPort}/catalog`)).ok;
      } catch {
        return false;
      }
    }, 'Companion boot');
  } catch (error) {
    companion.close();
    throw new Error(`${error.message}\n${state.stderr}`);
  }
  assert.equal(proc.exitCode, null, state.stderr);
  return companion;
}

/** Open the companion's operator WS and return it with its `hello` frame. */
async function openCompanionWs(companionPort) {
  const ws = new WebSocket(`ws://127.0.0.1:${companionPort}/ws`);
  const helloPromise = waitForMessage(ws, (message) => message.type === 'hello');
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, hello: await helloPromise };
}

function sendDerivedEdit(ws, silenceConfirmMs) {
  ws.send(JSON.stringify({
    type: 'setDerivedConfig',
    group: 'trackChange',
    patch: { silenceConfirmMs },
  }));
}

async function startDelayedEngine(port) {
  let config = TRACKED_AUDIO_CONFIG;
  const requests = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let releaseFirst;
  const firstReceived = new Promise((resolve) => { releaseFirst = resolve; });
  const wss = new WebSocketServer({ noServer: true });
  const broadcastConfig = () => {
    const body = JSON.stringify({ type: 'audioConfig', config });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(body);
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/audio/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }
    if (req.url === '/audio/config' && req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const partial = JSON.parse(Buffer.concat(chunks).toString());
      const value = partial.derivedSignals.trackChange.silenceConfirmMs;
      requests.push(value);
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      if (requests.length === 1) {
        releaseFirst();
        await new Promise((resolve) => setTimeout(resolve, 300));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      config = mergeAudioConfig(config, partial);
      activeRequests--;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      broadcastConfig();
      return;
    }
    if (req.url === '/audio/signals/manifest' && req.method === 'POST') {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/control') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'audioConfig', config }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    firstReceived,
    requests,
    get config() { return config; },
    get maxActiveRequests() { return maxActiveRequests; },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function startDisconnectingEngine(port) {
  let config = TRACKED_AUDIO_CONFIG;
  const requests = [];
  let outage = false;
  let firstFailedResolve;
  let recoveryTimer = null;
  const firstFailed = new Promise((resolve) => { firstFailedResolve = resolve; });
  const wss = new WebSocketServer({ noServer: true });
  const broadcastConfig = () => {
    const body = JSON.stringify({ type: 'audioConfig', config });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(body);
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/audio/config' && req.method === 'GET') {
      if (outage) {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }
    if (req.url === '/audio/config' && req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const partial = JSON.parse(Buffer.concat(chunks).toString());
      const value = partial.derivedSignals.trackChange.silenceConfirmMs;
      requests.push(value);
      if (requests.length === 1) {
        outage = true;
        for (const client of wss.clients) client.terminate();
        req.socket.destroy();
        firstFailedResolve();
        recoveryTimer = setTimeout(() => { outage = false; }, 750);
        return;
      }
      config = mergeAudioConfig(config, partial);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      broadcastConfig();
      return;
    }
    if (req.url === '/audio/signals/manifest' && req.method === 'POST') {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/control' || outage) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'audioConfig', config }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    firstFailed,
    requests,
    get config() { return config; },
    async close() {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

/**
 * An engine whose FIRST n PATCHes die on the wire while `/ws/control` stays UP
 * the whole time.
 *
 * This is the case the queue used to lose: the socket is destroyed mid-request
 * so the companion's `fetch` rejects with NO HTTP status (a transport failure,
 * not a verdict), and because the WS link never drops there is no reconnect
 * event to replay the parked snapshot on. `controlConnections` is asserted to
 * stay at 1 in the tests so a passing run cannot secretly be the old
 * reconnect-replay path doing the work.
 */
async function startTransportFailEngine(port, { failFirst = 1, patchDelayMs = 10 } = {}) {
  let config = TRACKED_AUDIO_CONFIG;
  const requests = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let controlConnections = 0;
  let failures = 0;
  let releaseFirstFailure;
  const firstFailed = new Promise((resolve) => { releaseFirstFailure = resolve; });
  const wss = new WebSocketServer({ noServer: true });
  const broadcastConfig = () => {
    const body = JSON.stringify({ type: 'audioConfig', config });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(body);
    }
  };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/audio/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }
    if (req.url === '/audio/config' && req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const partial = JSON.parse(Buffer.concat(chunks).toString());
      const value = partial.derivedSignals.trackChange.silenceConfirmMs;
      requests.push(value);
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      if (failures < failFirst) {
        failures++;
        activeRequests--;
        req.socket.destroy();   // no status ever reaches the client
        releaseFirstFailure();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, patchDelayMs));
      config = mergeAudioConfig(config, partial);
      activeRequests--;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      broadcastConfig();
      return;
    }
    if (req.url === '/audio/signals/manifest' && req.method === 'POST') {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/control') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    controlConnections++;
    ws.send(JSON.stringify({ type: 'audioConfig', config }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    firstFailed,
    requests,
    get config() { return config; },
    get maxActiveRequests() { return maxActiveRequests; },
    get controlConnections() { return controlConnections; },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

/**
 * An engine that ANSWERS every derived PATCH with a definitive 400 and never
 * persists it. `GET /audio/config` keeps serving the untouched truth so the
 * companion has something valid to snap back to.
 */
async function startRefusingEngine(port) {
  const config = TRACKED_AUDIO_CONFIG;
  const requests = [];
  let controlConnections = 0;
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/audio/config' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(config));
      return;
    }
    if (req.url === '/audio/config' && req.method === 'PATCH') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const partial = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(partial.derivedSignals.trackChange.silenceConfirmMs);
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'silenceConfirmMs refused by the fake engine' }));
      return;
    }
    if (req.url === '/audio/signals/manifest' && req.method === 'POST') {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/control') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    controlConnections++;
    ws.send(JSON.stringify({ type: 'audioConfig', config }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    requests,
    get controlConnections() { return controlConnections; },
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

test('same-group derived edits persist serially and coalesce to the latest value', async () => {
  const companionPort = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const fakeEngine = await startDelayedEngine(enginePort);
  // Same isolation `bootCompanion` uses — this test predates it and was still
  // spawning on the operator's live scene overlay (report `_220`).
  const isolation = isolatedCompanionEnv(`derived_patch_order_${isolationSeq++}`);
  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port', String(companionPort),
    '--host', '127.0.0.1',
    '--model', 'test_bench',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], { cwd: ENGINE_DIR, env: isolation.env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let ws;
  try {
    await waitUntil(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${companionPort}/catalog`)).ok;
      } catch {
        return false;
      }
    }, 'Companion boot');
    assert.equal(proc.exitCode, null, stderr);
    ws = new WebSocket(`ws://127.0.0.1:${companionPort}/ws`);
    const helloPromise = waitForMessage(ws, (message) => message.type === 'hello');
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const hello = await helloPromise;
    if (!hello.engineLink.connected) {
      await waitForMessage(ws, (message) => message.type === 'engineLink' && message.connected);
    }

    const original = hello.derivedConfig.trackChange.silenceConfirmMs;
    const first = original + 100;
    const middle = original + 200;
    const last = original + 300;
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { silenceConfirmMs: first },
    }));
    await fakeEngine.firstReceived;
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { silenceConfirmMs: middle },
    }));
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { silenceConfirmMs: last },
    }));

    await waitUntil(
      () => fakeEngine.config.derivedSignals.trackChange.silenceConfirmMs === last,
      'latest derived edit persistence',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(fakeEngine.requests, [first, last], 'middle queued edit is coalesced');
    assert.equal(fakeEngine.maxActiveRequests, 1, 'same-group PATCHes never overlap');
  } finally {
    if (ws) ws.close();
    proc.kill('SIGKILL');
    isolation.cleanup();
    await fakeEngine.close();
  }
});

test('a transport failure keeps the latest derived edit pending and replays it on reconnect', async () => {
  const companionPort = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const fakeEngine = await startDisconnectingEngine(enginePort);
  // Same isolation `bootCompanion` uses — this test predates it and was still
  // spawning on the operator's live scene overlay (report `_220`).
  const isolation = isolatedCompanionEnv(`derived_patch_order_${isolationSeq++}`);
  let stderr = '';
  const proc = spawn('node', [
    SERVER,
    '--port', String(companionPort),
    '--host', '127.0.0.1',
    '--model', 'test_bench',
    '--source', 'test',
    '--no-mic',
    '--osc-port', String(oscPort),
    '--engine-port', String(enginePort),
  ], { cwd: ENGINE_DIR, env: isolation.env, stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let ws;
  try {
    await waitUntil(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${companionPort}/catalog`)).ok;
      } catch {
        return false;
      }
    }, 'Companion boot');
    assert.equal(proc.exitCode, null, stderr);
    ws = new WebSocket(`ws://127.0.0.1:${companionPort}/ws`);
    const helloPromise = waitForMessage(ws, (message) => message.type === 'hello');
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const hello = await helloPromise;
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${companionPort}/signal_snapshot`);
      return response.ok && (await response.json()).engineLink.connected;
    }, 'initial engine link');

    const desired = hello.derivedConfig.trackChange.silenceConfirmMs + 125;
    const disconnected = waitForMessage(
      ws,
      (message) => message.type === 'engineLink' && message.connected === false,
    );
    ws.send(JSON.stringify({
      type: 'setDerivedConfig',
      group: 'trackChange',
      patch: { silenceConfirmMs: desired },
    }));
    await fakeEngine.firstFailed;
    await disconnected;

    await waitUntil(
      () => fakeEngine.config.derivedSignals.trackChange.silenceConfirmMs === desired,
      'pending edit replay after reconnect',
    );
    assert.deepEqual(
      fakeEngine.requests,
      [desired, desired],
      'the failed snapshot is replayed exactly once after reconnect',
    );
  } finally {
    if (ws) ws.close();
    proc.kill('SIGKILL');
    isolation.cleanup();
    await fakeEngine.close();
  }
});

// ── RETRY WITHOUT A RECONNECT ───────────────────────────────────────────────
// Before this, a PATCH that died on the wire kept the desired snapshot parked
// in `pendingDerivedEdits` but cleared `queue.pending` — so the ONLY thing that
// could ever push it again was `onStatus(connected)`. If the WS link never
// dropped (engine busy respawning ffmpeg, mid audio re-init, HTTP timeout under
// load) that event never came, and the operator's edit sat unsaved forever
// while the UI showed it applied. These tests hold `/ws/control` open
// throughout and assert `controlConnections === 1`, so a reconnect cannot be
// what makes them pass.

test('a transport failure retries on the live link with no reconnect and the value lands', async () => {
  const enginePort = await getFreePort();
  const fakeEngine = await startTransportFailEngine(enginePort);
  const companion = await bootCompanion(enginePort);
  let ws;
  try {
    const opened = await openCompanionWs(companion.companionPort);
    ws = opened.ws;
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${companion.companionPort}/signal_snapshot`);
      return response.ok && (await response.json()).engineLink.connected;
    }, 'initial engine link');

    const desired = opened.hello.derivedConfig.trackChange.silenceConfirmMs + 130;
    const retryArmed = waitForMessage(ws, (message) => message.type === 'engineLink'
      && typeof message.error === 'string'
      && message.error.includes(`retry 1/${RETRY_MAX_ATTEMPTS}`));
    sendDerivedEdit(ws, desired);
    await fakeEngine.firstFailed;
    // The companion must classify this as retryable and SAY so — a transport
    // failure carries no HTTP status, so it is never a verdict on the value.
    await retryArmed;

    await waitUntil(
      () => fakeEngine.config.derivedSignals.trackChange.silenceConfirmMs === desired,
      'transport-failed edit retried on the live link',
    );
    // Settle past one more backoff window; nothing else may be sent.
    await new Promise((resolve) => setTimeout(resolve, RETRY_MIN_MS * 3));

    const snapshot = await (await fetch(
      `http://127.0.0.1:${companion.companionPort}/signal_snapshot`,
    )).json();
    assert.equal(snapshot.engineLink.connected, true, 'the WS link must have stayed up');
    assert.equal(fakeEngine.controlConnections, 1,
      'exactly one /ws/control connection — no reconnect replayed this edit');
    assert.deepEqual(fakeEngine.requests, [desired, desired],
      'the failed snapshot is retried exactly once, and the retry stops on success');
    assert.equal(fakeEngine.maxActiveRequests, 1, 'retries never overlap a live request');
  } finally {
    if (ws) ws.close();
    companion.close();
    await fakeEngine.close();
  }
});

test('an edit made during a retry backoff supersedes it and lands last', async () => {
  const enginePort = await getFreePort();
  // Slow the surviving PATCHes so a newer edit can arrive while one is in
  // flight — the coalescing path and the backoff path both get exercised.
  const fakeEngine = await startTransportFailEngine(enginePort, { patchDelayMs: 150 });
  const companion = await bootCompanion(enginePort);
  let ws;
  try {
    const opened = await openCompanionWs(companion.companionPort);
    ws = opened.ws;
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${companion.companionPort}/signal_snapshot`);
      return response.ok && (await response.json()).engineLink.connected;
    }, 'initial engine link');

    const original = opened.hello.derivedConfig.trackChange.silenceConfirmMs;
    const first = original + 100;
    const middle = original + 200;
    const last = original + 300;
    const retryArmed = waitForMessage(ws, (message) => message.type === 'engineLink'
      && typeof message.error === 'string'
      && message.error.includes(`retry 1/${RETRY_MAX_ATTEMPTS}`));
    sendDerivedEdit(ws, first);
    await fakeEngine.firstFailed;
    await retryArmed;
    sendDerivedEdit(ws, middle);
    sendDerivedEdit(ws, last);

    await waitUntil(
      () => fakeEngine.config.derivedSignals.trackChange.silenceConfirmMs === last,
      'newest edit persisted',
    );
    // Long enough for the cancelled `first` backoff to have fired if it had
    // survived — proving a superseded snapshot cannot land after the newest.
    await new Promise((resolve) => setTimeout(resolve, RETRY_MIN_MS * 4));

    assert.equal(fakeEngine.config.derivedSignals.trackChange.silenceConfirmMs, last,
      'the engine still holds the newest value');
    assert.equal(fakeEngine.requests.at(-1), last, 'the newest value is the last one written');
    assert.equal(fakeEngine.requests.lastIndexOf(first), 0,
      `the superseded snapshot ${first} was never re-sent: ${JSON.stringify(fakeEngine.requests)}`);
    assert.equal(fakeEngine.maxActiveRequests, 1, 'same-group PATCHes never overlap');
    assert.equal(fakeEngine.controlConnections, 1, 'no reconnect was involved');
  } finally {
    if (ws) ws.close();
    companion.close();
    await fakeEngine.close();
  }
});

test('a definitive 4xx reverts the group and is never retried', async () => {
  const enginePort = await getFreePort();
  const fakeEngine = await startRefusingEngine(enginePort);
  const companion = await bootCompanion(enginePort);
  let ws;
  try {
    const opened = await openCompanionWs(companion.companionPort);
    ws = opened.ws;
    await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${companion.companionPort}/signal_snapshot`);
      return response.ok && (await response.json()).engineLink.connected;
    }, 'initial engine link');

    const original = opened.hello.derivedConfig.trackChange.silenceConfirmMs;
    const refused = original + 175;
    const reverted = waitForMessage(ws, (message) => message.type === 'derivedConfig'
      && message.config.trackChange.silenceConfirmMs === original);
    const flashed = waitForMessage(ws, (message) => message.type === 'flash'
      && message.error === true
      && typeof message.text === 'string'
      && message.text.includes('rejected by engine'));
    sendDerivedEdit(ws, refused);

    const flash = await flashed;
    await reverted;
    assert.ok(flash.text.includes('silenceConfirmMs'),
      `the flash must name the reverted key: ${flash.text}`);
    // Two full backoff windows (250 + 500 ms) plus slack. A definitive verdict
    // must produce EXACTLY ONE request — a retry here would re-push a value the
    // engine already refused.
    await new Promise((resolve) => setTimeout(resolve, RETRY_MIN_MS * 6));
    assert.deepEqual(fakeEngine.requests, [refused],
      'a definitive 4xx is never retried');

    // A FRESH client must be handed the reverted value too — the revert has to
    // reach the live modules, not just the broadcast that announced it.
    const rejoined = await openCompanionWs(companion.companionPort);
    rejoined.ws.close();
    assert.equal(rejoined.hello.derivedConfig.trackChange.silenceConfirmMs, original,
      'the companion snapped its live config back to the engine truth');

    const snapshot = await (await fetch(
      `http://127.0.0.1:${companion.companionPort}/signal_snapshot`,
    )).json();
    assert.equal(snapshot.engineLink.connected, true, 'the link stayed up throughout');
    assert.equal(fakeEngine.controlConnections, 1, 'no reconnect was involved');
  } finally {
    if (ws) ws.close();
    companion.close();
    await fakeEngine.close();
  }
});
