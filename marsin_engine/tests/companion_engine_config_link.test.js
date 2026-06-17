// Tests for the Audio Companion's LIVE two-way link to the engine's
// SHARED audio TUNING config (audio/companion/engine_config_link.js).
//
// The link makes the engine config the single source of truth for the
// Companion's analyzer gain / smoothing / device:
//   1. resolveEngineEndpoint precedence (companion.engine → server.port → default).
//   2. On connect it SEEDS via GET /audio/config and applies the config.
//   3. It applies every `audioConfig` WS broadcast (the echo of any PATCH).
//   4. write-through `patch()` issues the right PATCH and resolves with the
//      engine's post-PATCH config.
//   5. write-through REJECTS LOUDLY on a 400 (codex P0 — never silent-wrong).
//   6. It reconnects in the background when the engine drops (graceful).
//
// Uses a tiny FAKE engine (http + ws on /ws/control) so the test is
// hermetic — no real engine, no ffmpeg.
//
// Run:  cd marsin_engine && node --test tests/companion_engine_config_link.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { WebSocketServer } from 'ws';

import { EngineConfigLink, resolveEngineEndpoint } from '../audio/companion/engine_config_link.js';

// ── A minimal fake engine: GET/PATCH /audio/config + /ws/control broadcast ──
function makeFakeEngine(initialConfig) {
  let config = JSON.parse(JSON.stringify(initialConfig));
  const patches = [];
  const wsClients = new Set();

  const server = http.createServer((req, res) => {
    if (req.url === '/audio/config' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(config));
    }
    if (req.url === '/audio/config' && req.method === 'PATCH') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let partial;
        try { partial = JSON.parse(body); } catch { partial = {}; }
        patches.push(partial);
        // Reject an out-of-range gain like the real validateLivePatch would.
        const g = partial && partial.bands && partial.bands.inputGain;
        if (g !== undefined && (g < 0 || g > 64)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `"bands.inputGain" must be in [0, 64]; got ${g}` }));
        }
        // Merge + echo back + broadcast (single source of truth contract).
        if (partial.bands) config.bands = { ...config.bands, ...partial.bands };
        if (partial.capture) config.capture = { ...config.capture, ...partial.capture };
        if (partial.enabled !== undefined) config.enabled = partial.enabled;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        broadcast({ type: 'audioConfig', config });
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server, path: '/ws/control' });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    // Replay current config on connect (mirrors api_server's replay).
    ws.send(JSON.stringify({ type: 'audioConfig', config }));
    ws.on('close', () => wsClients.delete(ws));
  });

  function broadcast(obj) {
    const m = JSON.stringify(obj);
    for (const c of wsClients) if (c.readyState === 1) c.send(m);
  }

  return {
    server, wss, patches,
    getConfig: () => config,
    broadcastConfig: () => broadcast({ type: 'audioConfig', config }),
    setConfig: (next) => { config = next; },
    listen: () => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    close: () => new Promise((res) => { for (const c of wsClients) try { c.close(); } catch {} wss.close(() => server.close(() => res())); }),
  };
}

function waitFor(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) { clearInterval(iv); resolve(); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); reject(new Error('waitFor timeout')); }
    }, 10);
  });
}

const BASE_CONFIG = {
  enabled: true,
  bands: { lowMaxHz: 200, midMaxHz: 4000, attackMs: 6, releaseMs: 180, noiseGate: 0.04, inputGain: 1.0, sourceSmoothHz: 12000 },
  kick: { minHz: 50, maxHz: 110, threshold: 2.4, refractoryMs: 220, decayMs: 70 },
  capture: { device: null, sampleRate: 44100, channels: 1 },
};

// ── 1) endpoint resolution ──────────────────────────────────────────────────

test('resolveEngineEndpoint: companion.engine overrides everything', () => {
  const ep = resolveEngineEndpoint({ companion: { engine: { host: '10.0.0.5', port: 7000 } }, server: { port: 6968 } });
  assert.deepEqual(ep, { host: '10.0.0.5', port: 7000 });
});

test('resolveEngineEndpoint: falls back to server.port on loopback', () => {
  const ep = resolveEngineEndpoint({ server: { port: 6968 } });
  assert.deepEqual(ep, { host: '127.0.0.1', port: 6968 });
});

test('resolveEngineEndpoint: default 127.0.0.1:6968 when nothing configured', () => {
  assert.deepEqual(resolveEngineEndpoint({}), { host: '127.0.0.1', port: 6968 });
  assert.deepEqual(resolveEngineEndpoint(null), { host: '127.0.0.1', port: 6968 });
});

test('resolveEngineEndpoint: companion.engine.host with a bad port falls through to server.port', () => {
  const ep = resolveEngineEndpoint({ companion: { engine: { host: '10.0.0.5', port: 0 } }, server: { port: 6968 } });
  assert.deepEqual(ep, { host: '127.0.0.1', port: 6968 });
});

// ── 2/3) subscribe: seed + broadcast apply ──────────────────────────────────

test('on connect the link seeds + applies config, and applies later broadcasts', async () => {
  const fake = makeFakeEngine(BASE_CONFIG);
  const port = await fake.listen();
  const applied = [];
  const link = new EngineConfigLink({
    host: '127.0.0.1', port,
    onConfig: (cfg) => applied.push(cfg),
  });
  link.start();
  // The WS replay frame and/or the GET seed both deliver the initial config.
  await waitFor(() => applied.some(c => c.bands.inputGain === 1.0));

  // Now the operator changes gain elsewhere (CaptainPad) → engine broadcasts.
  fake.setConfig({ ...BASE_CONFIG, bands: { ...BASE_CONFIG.bands, inputGain: 4.0 } });
  fake.broadcastConfig();
  await waitFor(() => applied.some(c => c.bands.inputGain === 4.0));

  link.stop();
  await fake.close();
});

// ── 4) write-through PATCH ──────────────────────────────────────────────────

test('patch() issues PATCH /audio/config and resolves with the engine config; echo applies', async () => {
  const fake = makeFakeEngine(BASE_CONFIG);
  const port = await fake.listen();
  const applied = [];
  const link = new EngineConfigLink({
    host: '127.0.0.1', port,
    onConfig: (cfg) => applied.push(cfg),
  });
  link.start();
  await waitFor(() => link.connected);

  const result = await link.patch({ bands: { inputGain: 2.5 } });
  assert.equal(result.bands.inputGain, 2.5, 'PATCH echoes the merged config');
  assert.deepEqual(fake.patches.at(-1), { bands: { inputGain: 2.5 } }, 'engine saw the exact PATCH body');
  // The engine broadcasts the echo → onConfig applies it (single source of truth).
  await waitFor(() => applied.some(c => c.bands.inputGain === 2.5));

  link.stop();
  await fake.close();
});

// ── 5) loud failure on validation reject ────────────────────────────────────

test('patch() REJECTS loudly on a 400 (no silent swallow)', async () => {
  const fake = makeFakeEngine(BASE_CONFIG);
  const port = await fake.listen();
  const link = new EngineConfigLink({ host: '127.0.0.1', port, onConfig: () => {} });
  link.start();
  await waitFor(() => link.connected);

  await assert.rejects(
    () => link.patch({ bands: { inputGain: 999 } }),
    /must be in \[0, 64\]/,
  );

  link.stop();
  await fake.close();
});

// ── 6) graceful degradation: down when the engine is absent, then connects ──

test('link stays down (no throw) when the engine is unreachable, then connects when it comes up', async () => {
  // Pick a port that is NOT listening yet.
  const fake = makeFakeEngine(BASE_CONFIG);
  const probe = http.createServer();
  const port = await new Promise((res) => probe.listen(0, '127.0.0.1', () => res(probe.address().port)));
  await new Promise((res) => probe.close(res));   // free the port; nothing listens now

  const applied = [];
  const link = new EngineConfigLink({
    host: '127.0.0.1', port,
    onConfig: (cfg) => applied.push(cfg),
  });
  link.start();
  // Give the first connect attempt time to fail. The Companion would be
  // analyzing fine through all of this; the link must NOT throw.
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(link.connected, false, 'link is down while the engine is absent');

  // Bring the engine up on the same port; the background reconnect should land.
  await new Promise((res) => fake.server.listen(port, '127.0.0.1', res));
  await waitFor(() => link.connected, 4000);
  await waitFor(() => applied.length > 0, 2000);

  link.stop();
  await fake.close();
});
