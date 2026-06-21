/**
 * hil_tap_tempo_test.mjs — HIL test for the per-channel phase-clock TAP-TEMPO
 * core (docs/39 §F-phase #4).
 *
 * The per-channel SPEED (#3) and CHASE/phaseOffsetMs (#11) features were
 * REMOVED in the channels-optimization campaign; only tap-tempo + the
 * followsTempo opt-in remain. This drives the full engine path
 * (HTTP PATCH/POST + WS /ws/viz frames):
 *   1. #4 TAP-TEMPO: POST /mixer/tempo {bpm:60} → multiplier 0.5 and
 *      serializeMixerState reports tempoBpm:60.
 *   2. followsTempo gating: 60 BPM halves ONLY a followsTempo channel — a
 *      follower's per-channel vis buffer advances LESS than a non-follower's
 *      over the same window (the non-follower stays at 1×).
 *   3. Error path: bad bpm (string / below 20 / above 400 / null) → 400.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern 01_cylon_sweep --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node tests/hil/hil_tap_tempo_test.mjs
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';
import WebSocket from 'ws';

const ENGINE_PORT = Number(process.env.ENGINE_PORT) || 31268;
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws/viz`;
const MOVING_PATTERN = '01_cylon_sweep';

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
      method, hostname: url.hostname, port: url.port,
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Collect ONE vis frame (the per-channel base64 buffer map) from /ws/viz.
function captureVisFrame(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error('vis frame timeout')); }
    }, timeoutMs);
    ws.on('message', (m) => {
      if (done) return;
      try {
        const d = JSON.parse(m.toString());
        if (d.type === 'vis' && d.vis) {
          done = true;
          clearTimeout(timer);
          ws.close();
          resolve(d.vis);
        }
      } catch (_) {}
    });
    ws.on('error', (e) => {
      if (done) return;
      done = true; clearTimeout(timer); reject(e);
    });
  });
}

// L1 distance between two base64 buffers (0 if identical / one missing).
function bufDiff(a, b) {
  if (!a || !b) return 0;
  const ba = Buffer.from(a, 'base64');
  const bb = Buffer.from(b, 'base64');
  const n = Math.min(ba.length, bb.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs(ba[i] - bb[i]);
  return d;
}

async function main() {
  console.log(`hil_tap_tempo_test — engine ${ENGINE_BASE} pattern ${MOVING_PATTERN}`);

  const created = [];
  try {
    // ── Add two overlays on the SAME moving pattern ──────────────────
    const aRes = await httpJson('POST', '/mixer/channels', { pattern: MOVING_PATTERN, name: 'tempo-A' });
    const bRes = await httpJson('POST', '/mixer/channels', { pattern: MOVING_PATTERN, name: 'tempo-B' });
    if (aRes.status !== 200 || !aRes.data.channelId || bRes.status !== 200 || !bRes.data.channelId) {
      fail('added two overlays', `A=${JSON.stringify(aRes.data)} B=${JSON.stringify(bRes.data)}`);
      return;
    }
    const aId = aRes.data.channelId;
    const bId = bRes.data.channelId;
    created.push(aId, bId);
    pass(`added overlays A=${aId} B=${bId} on ${MOVING_PATTERN}`);

    // A follows tempo, B does not. Both fully on.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { fader: 1, enabled: true, followsTempo: true });
    await httpJson('PATCH', `/mixer/channels/${bId}`, { fader: 1, enabled: true, followsTempo: false });

    // ── #4 TAP-TEMPO: 60 BPM → multiplier 0.5 ─────────────────────────
    const tempoRes = await httpJson('POST', '/mixer/tempo', { bpm: 60 });
    if (tempoRes.status === 200 && Math.abs(tempoRes.data.tempoMultiplier - 0.5) < 1e-6) {
      pass(`#4 POST /mixer/tempo {bpm:60} → multiplier 0.5 (tempoBpm=${tempoRes.data.tempoBpm})`);
    } else {
      fail('#4 tempo set', `status=${tempoRes.status} body=${JSON.stringify(tempoRes.data)}`);
    }
    // serializeMixerState reports tempoBpm.
    const mixerState = await httpJson('GET', '/mixer');
    if (mixerState.data && mixerState.data.tempoBpm === 60) {
      pass('#4 serializeMixerState reports tempoBpm:60');
    } else {
      fail('#4 mixer state tempoBpm', `got ${JSON.stringify(mixerState.data && mixerState.data.tempoBpm)}`);
    }

    // ── followsTempo gating: follower advances LESS than non-follower ──
    await sleep(400);
    const t1 = await captureVisFrame();
    await sleep(1500);
    const t2 = await captureVisFrame();
    const aFollow = bufDiff(t1[aId], t2[aId]); // 0.5×
    const bFixed = bufDiff(t1[bId], t2[bId]);  // 1×
    if (aFollow === 0 && bFixed === 0) {
      fail('#4 follow gating', `both buffers static (aFollow=${aFollow} bFixed=${bFixed}) — pattern not moving?`);
    } else if (bFixed > aFollow) {
      pass(`#4 TAP-TEMPO halves ONLY the follower (follower A=${aFollow} < fixed B=${bFixed})`);
    } else {
      fail('#4 tempo affects followers only', `expected fixed > follower, got A=${aFollow} B=${bFixed}`);
    }
    // Reset tempo to a no-op-ish 120 BPM so we don't leave the rig slowed.
    await httpJson('POST', '/mixer/tempo', { bpm: 120 });

    // ── Error paths: bad bpm → 400 ────────────────────────────────────
    const badBpms = [
      { bpm: 'fast', label: 'string bpm' },
      { bpm: 5, label: 'bpm below 20' },
      { bpm: 500, label: 'bpm above 400' },
      { bpm: null, label: 'null bpm' },
    ];
    for (const c of badBpms) {
      const r = await httpJson('POST', '/mixer/tempo', { bpm: c.bpm });
      if (r.status === 400) pass(`#4 bad bpm (${c.label}) → 400`);
      else fail(`#4 bad bpm (${c.label}) → 400`, `status=${r.status} body=${JSON.stringify(r.data)}`);
    }
  } catch (e) {
    fail('test threw', e && e.message);
  } finally {
    // Cleanup: remove the probe overlays + reset tempo.
    for (const id of created) {
      try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {}
    }
    try { await httpJson('POST', '/mixer/tempo', { bpm: 120 }); } catch (_) {}
  }

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll tap-tempo HIL assertions passed.');
  process.exit(0);
}

main();
