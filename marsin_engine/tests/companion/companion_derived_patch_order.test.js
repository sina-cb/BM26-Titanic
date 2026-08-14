import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WebSocket, WebSocketServer } from 'ws';

import { loadEffectiveAudioAnalysisConfig } from '../../audio/config/audio_analysis_config.js';
import { mergeAudioConfig } from '../../audio/config/audio_config.js';

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

async function startDelayedEngine(port) {
  let config = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'test_bench',
  }).audioConfig;
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
  let config = loadEffectiveAudioAnalysisConfig({
    engineDir: ENGINE_DIR,
    modelName: 'test_bench',
  }).audioConfig;
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

test('same-group derived edits persist serially and coalesce to the latest value', async () => {
  const companionPort = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const fakeEngine = await startDelayedEngine(enginePort);
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
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'ignore', 'pipe'] });
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
    await fakeEngine.close();
  }
});

test('a transport failure keeps the latest derived edit pending and replays it on reconnect', async () => {
  const companionPort = await getFreePort();
  const oscPort = await getFreePort();
  const enginePort = await getFreePort();
  const fakeEngine = await startDisconnectingEngine(enginePort);
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
  ], { cwd: ENGINE_DIR, stdio: ['ignore', 'ignore', 'pipe'] });
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
    await fakeEngine.close();
  }
});
