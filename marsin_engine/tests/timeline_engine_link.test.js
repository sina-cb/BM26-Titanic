// Tests for the Timeline Companion's link to the marsin ENGINE
// (companions/timeline/engine_link.js).
//
// The link:
//   1. subscribes to the engine's /ws/signals (liveParams) + /ws/params
//      (sharedParams) and reads the mood key off params[moodKey].value →
//      party = value >= partyThreshold ? 1 : 0;
//   2. issues HTTP action calls (POST /deck/playlist {name}, …) and REJECTS
//      LOUDLY on a non-2xx (codex P0 — never a silent skip);
//   3. surfaces the phase-2.5 message when the mixer autopilot route 404s.
//
// Uses a tiny FAKE engine (http + ws on /ws/signals) so the test is
// hermetic — no real engine.
//
// Run:  cd marsin_engine && node --test tests/timeline_engine_link.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { WebSocketServer } from 'ws';

import { EngineLink } from '../companions/timeline/engine_link.js';

// ── A minimal fake engine ─────────────────────────────────────────────────────
function makeFakeEngine() {
  const posts = [];        // { url, body }
  let mixerAutopilot404 = true;
  const wsClients = new Set();

  const server = http.createServer((req, res) => {
    const url = req.url;
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed;
        try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { raw: body }; }
        posts.push({ url, body: parsed });
        if (/^\/deck\/playlist$/.test(url)) {
          // A playlist named 'missing' simulates a not-found → 404.
          if (parsed && parsed.name === 'missing') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'playlist not found' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        if (/^\/mixer\/channels\/[^/]+\/autopilot$/.test(url)) {
          if (mixerAutopilot404) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'not found' }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  const wss = new WebSocketServer({ server, path: '/ws/signals' });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
  });

  function sendLiveParams(params) {
    const m = JSON.stringify({ type: 'liveParams', params });
    for (const c of wsClients) if (c.readyState === 1) c.send(m);
  }

  return {
    server, wss, posts,
    sendLiveParams,
    hasClients: () => wsClients.size > 0,
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

// ── 1) mood subscribe + threshold ────────────────────────────────────────────

test('liveParams frames drive mood: 0.8 → party 1, 0.2 → party 0 (threshold 0.5)', async () => {
  const fake = makeFakeEngine();
  const port = await fake.listen();
  const moods = [];
  const link = new EngineLink({
    host: '127.0.0.1', port, moodKey: 'audioParty', partyThreshold: 0.5,
    onMood: (m) => moods.push(m),
  });
  link.start();
  await waitFor(() => link.connected);
  await waitFor(() => fake.hasClients());

  fake.sendLiveParams({ audioParty: { value: 0.8 }, micLow: { value: 0.1 } });
  await waitFor(() => link.mood().party === 1);
  assert.equal(link.mood().value, 0.8);

  fake.sendLiveParams({ audioParty: { value: 0.2 } });
  await waitFor(() => link.mood().party === 0);
  assert.equal(link.mood().value, 0.2);

  assert.ok(moods.length >= 2, 'onMood fired for each frame');

  link.stop();
  await fake.close();
});

test('mood() defaults to calm (party 0, value 0) before any frame', async () => {
  const fake = makeFakeEngine();
  const port = await fake.listen();
  const link = new EngineLink({ host: '127.0.0.1', port, moodKey: 'audioParty', partyThreshold: 0.5 });
  link.start();
  await waitFor(() => link.connected);
  assert.deepEqual(link.mood(), { party: 0, value: 0 });
  link.stop();
  await fake.close();
});

// ── 2) HTTP action: success + loud failure ───────────────────────────────────

test('loadDeckPlaylist issues POST /deck/playlist {name}; 404 throws loud', async () => {
  const fake = makeFakeEngine();
  const port = await fake.listen();
  const link = new EngineLink({ host: '127.0.0.1', port, moodKey: 'audioParty', partyThreshold: 0.5 });
  link.start();

  await link.loadDeckPlaylist('default');
  const rec = fake.posts.at(-1);
  assert.equal(rec.url, '/deck/playlist');
  assert.deepEqual(rec.body, { name: 'default' });

  await assert.rejects(() => link.loadDeckPlaylist('missing'), /playlist not found|404/);

  link.stop();
  await fake.close();
});

// ── 3) mixer autopilot 404 → explicit phase-2.5 message ──────────────────────

test('setMixerAutopilot against a 404 throws the phase-2.5 message', async () => {
  const fake = makeFakeEngine();
  const port = await fake.listen();
  const link = new EngineLink({ host: '127.0.0.1', port, moodKey: 'audioParty', partyThreshold: 0.5 });
  link.start();

  await assert.rejects(
    () => link.setMixerAutopilot('ch_rooms', { active: true, delay_s: 30, shuffle: false }),
    /mixer autopilot route not available yet \(engine phase 2\.5\)/,
  );

  link.stop();
  await fake.close();
});
