/**
 * hil_channel_isolation_test.mjs — HIL regression test for the
 * deck-vs-mixer channel isolation (May 2026 channel split).
 *
 * The user's primary ask was: "the mixer channels must not be shown in
 * the deck tab, and vice versa". This test bullet-proofs that contract
 * at the HTTP + WS layer so a future refactor that re-introduces the
 * leak fails CI loudly instead of silently breaking the iPad.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   Engine running with the `test_bench` model. By default we hit the
 *   engine on `127.0.0.1:6968`; override with `ENGINE_PORT=31668` for
 *   the multi-agent slot 6 setup.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1: cd marsin_engine && node engine.js --model test_bench
 *   Terminal 2: cd marsin_engine && node tests/hil/hil_channel_isolation_test.mjs
 *
 * ── What it Checks ────────────────────────────────────────────────────
 *   1. GET /mixer never returns the deck channel id in `channels[]`.
 *   2. GET /deck/channel returns the deck channel id and only the deck.
 *   3. /mixer/channels/<deckId>/* routes return 400 WRONG_ROLE for:
 *        PATCH, DELETE, GET playlist, POST control,
 *        POST playlist (assign), POST playlist/entry,
 *        POST playlist/capture, POST playlist/discard.
 *   4. Adding a mixer overlay does NOT show up under /deck/channel.
 *   5. The WS `mixer` broadcast never lists the deck id; the WS `deck`
 *      broadcast always lists the deck id (and only it).
 *   6. Trigger transition with `targetChannelId === deckId` is rejected
 *      with `cannot-transition-to-base`.
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_PORT = Number(process.env.ENGINE_PORT) || 6968;
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}`;

let failed = 0;
function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, detail) {
  failed++;
  console.error(`  ✗ ${label}`);
  if (detail !== undefined) console.error(`      ${detail}`);
}

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let data = null;
        try { data = buf ? JSON.parse(buf) : null; } catch (_) { data = buf; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log(`hil_channel_isolation_test — engine ${ENGINE_BASE}`);

  // 1. GET /mixer doesn't leak deck.
  const mixerRes = await httpJson('GET', '/mixer');
  if (mixerRes.status !== 200) {
    fail('GET /mixer returned 200', `status=${mixerRes.status}`);
    process.exit(1);
  }
  const deckId = mixerRes.data.baseChannelId;
  if (!deckId) {
    fail('mixer broadcast carries baseChannelId', 'baseChannelId missing');
    process.exit(1);
  }
  const mixerIds = (mixerRes.data.channels || []).map((c) => c.id);
  if (mixerIds.includes(deckId)) {
    fail('GET /mixer excludes deck id', `deckId=${deckId} present in channels=${JSON.stringify(mixerIds)}`);
  } else {
    pass(`GET /mixer excludes deck id (deck=${deckId}, mixer=${mixerIds.length})`);
  }

  // 2. GET /deck/channel returns the deck.
  const deckRes = await httpJson('GET', '/deck/channel');
  if (deckRes.status !== 200) {
    fail('GET /deck/channel returns 200', `status=${deckRes.status}`);
  } else if (!deckRes.data.channel || deckRes.data.channel.id !== deckId) {
    fail('GET /deck/channel returns deck channel', `got=${JSON.stringify(deckRes.data.channel)}`);
  } else {
    pass('GET /deck/channel returns the deck channel');
  }

  // 3. Mixer routes reject deck id with 400 WRONG_ROLE.
  const mixerRouteCases = [
    { method: 'PATCH', path: `/mixer/channels/${deckId}`, body: { fader: 0.5 } },
    { method: 'DELETE', path: `/mixer/channels/${deckId}`, body: null },
    { method: 'GET', path: `/mixer/channels/${deckId}/playlist`, body: null },
    { method: 'POST', path: `/mixer/channels/${deckId}/control`, body: { id: 1, v0: 0.5 } },
    { method: 'POST', path: `/mixer/channels/${deckId}/playlist`, body: { name: 'default' } },
    { method: 'POST', path: `/mixer/channels/${deckId}/playlist/entry`, body: { entryId: 'whatever' } },
    { method: 'POST', path: `/mixer/channels/${deckId}/playlist/capture`, body: null },
    { method: 'POST', path: `/mixer/channels/${deckId}/playlist/discard`, body: null },
  ];
  for (const c of mixerRouteCases) {
    const r = await httpJson(c.method, c.path, c.body);
    if (r.status !== 400 || !r.data || r.data.code !== 'WRONG_ROLE') {
      fail(`${c.method} ${c.path} rejected with 400 WRONG_ROLE`, `status=${r.status} body=${JSON.stringify(r.data)}`);
    } else {
      pass(`${c.method} ${c.path} → 400 WRONG_ROLE`);
    }
  }

  // 4. Add a mixer overlay; deck/channel should not change.
  const addRes = await httpJson('POST', '/mixer/channels', { playlist: 'default', name: 'isolation-probe' });
  let addedId = null;
  if (addRes.status === 200 && addRes.data.channelId) {
    addedId = addRes.data.channelId;
    pass(`added mixer overlay id=${addedId}`);
  } else if (addRes.status === 400 && /Maximum of/.test(addRes.data?.error || '')) {
    pass('mixer at capacity (skipping add probe)');
  } else {
    fail('add mixer overlay succeeded', `status=${addRes.status} body=${JSON.stringify(addRes.data)}`);
  }

  if (addedId) {
    const mixerAfter = await httpJson('GET', '/mixer');
    const idsAfter = (mixerAfter.data.channels || []).map((c) => c.id);
    if (!idsAfter.includes(addedId)) {
      fail('newly-added overlay shows in /mixer', `mixer ids=${JSON.stringify(idsAfter)}`);
    } else if (idsAfter.includes(deckId)) {
      fail('deck still excluded after add', `deck=${deckId} ids=${JSON.stringify(idsAfter)}`);
    } else {
      pass('newly-added overlay is in /mixer, deck still excluded');
    }
    const deckAfter = await httpJson('GET', '/deck/channel');
    if (!deckAfter.data.channel || deckAfter.data.channel.id !== deckId) {
      fail('/deck/channel still points at deck after mixer add', `got=${JSON.stringify(deckAfter.data)}`);
    } else {
      pass('/deck/channel is unaffected by mixer add');
    }
    // Cleanup
    await httpJson('DELETE', `/mixer/channels/${addedId}`);
  }

  // 5. WS isolation.
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let sawDeck = false;
    let sawMixer = false;
    let leak = null;
    ws.on('message', (m) => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'mixer') {
          sawMixer = true;
          const ids = (d.channels || []).map((c) => c.id);
          if (d.baseChannelId && ids.includes(d.baseChannelId)) {
            leak = `mixer ws event leaks deck id ${d.baseChannelId}`;
          }
        } else if (d.type === 'deck') {
          sawDeck = true;
          if (!d.channel || d.channel.id !== deckId) {
            leak = `deck ws event payload mismatch: ${JSON.stringify(d.channel)}`;
          }
        }
      } catch (_) {}
    });
    ws.on('error', (e) => {
      fail('WS connect', e.message);
      resolve();
    });
    setTimeout(() => {
      ws.close();
      if (leak) fail('WS deck/mixer isolation', leak);
      else if (sawMixer && sawDeck) pass('WS broadcast: deck + mixer events arrive, no cross-leak');
      else fail('WS broadcast carries both types', `sawMixer=${sawMixer} sawDeck=${sawDeck}`);
      resolve();
    }, 1500);
  });

  // 6. WS triggerMixerTransition rejects deck id.
  await new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let rejected = false;
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'triggerMixerTransition',
        targetChannelId: deckId,
        durationMs: 100,
      }));
    });
    ws.on('message', (m) => {
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'mixerTransitionRejected' && d.targetChannelId === deckId) {
          rejected = true;
        }
      } catch (_) {}
    });
    setTimeout(() => {
      ws.close();
      if (rejected) pass('WS triggerMixerTransition rejects deck id');
      else fail('WS triggerMixerTransition rejects deck id', 'no rejection event received');
      resolve();
    }, 800);
  });

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll channel-isolation assertions passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
