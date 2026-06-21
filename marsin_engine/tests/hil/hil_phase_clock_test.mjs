/**
 * hil_phase_clock_test.mjs — HIL test for the per-channel phase-clock cluster
 * (docs/39 §F-phase): #3 SPEED · #4 TAP-TEMPO · #11 CHASE/phase-offset.
 *
 * Drives the full engine path (HTTP PATCH/POST + WS /ws/viz frames):
 *   1. #3 SPEED divergence: two mixer overlays on the SAME moving pattern,
 *      speed 1× vs 2×. Their per-channel vis buffers must DIVERGE over time
 *      (the 2× channel changes faster). PROVES the per-channel accumulator
 *      runs each channel's clock independently.
 *   2. #11 CHASE: same pattern, phaseOffsetMs {0, 500}. The two buffers are
 *      offset versions of each other (different, but neither static).
 *   3. #4 TAP-TEMPO: POST /mixer/tempo {bpm:60} halves ONLY a followsTempo
 *      channel (a non-follower keeps its rate). serializeMixerState reports
 *      tempoBpm:60.
 *   4. Error paths: bad bpm (NaN / 5 / 500) → 400; bad speed (NaN) → 400;
 *      bad phaseOffsetMs (NaN) → 400.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern 01_cylon_sweep --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node tests/hil/hil_phase_clock_test.mjs
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
  console.log(`hil_phase_clock_test — engine ${ENGINE_BASE} pattern ${MOVING_PATTERN}`);

  const created = [];
  try {
    // ── Add two overlays on the SAME moving pattern ──────────────────
    const aRes = await httpJson('POST', '/mixer/channels', { pattern: MOVING_PATTERN, name: 'phase-A' });
    const bRes = await httpJson('POST', '/mixer/channels', { pattern: MOVING_PATTERN, name: 'phase-B' });
    if (aRes.status !== 200 || !aRes.data.channelId || bRes.status !== 200 || !bRes.data.channelId) {
      fail('added two overlays', `A=${JSON.stringify(aRes.data)} B=${JSON.stringify(bRes.data)}`);
      return;
    }
    const aId = aRes.data.channelId;
    const bId = bRes.data.channelId;
    created.push(aId, bId);
    pass(`added overlays A=${aId} B=${bId} on ${MOVING_PATTERN}`);

    // Ensure both fully on (so the vis buffers are non-trivial) + same start.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { fader: 1, enabled: true, speed: 1, phaseOffsetMs: 0, followsTempo: false });
    await httpJson('PATCH', `/mixer/channels/${bId}`, { fader: 1, enabled: true, speed: 1, phaseOffsetMs: 0, followsTempo: false });

    // ── #3 SPEED: A=1×, B=2× → buffers DIVERGE over time ─────────────
    await httpJson('PATCH', `/mixer/channels/${aId}`, { speed: 1 });
    await httpJson('PATCH', `/mixer/channels/${bId}`, { speed: 2 });
    // Let both clocks run from a common-ish baseline, then sample two frames
    // ~1.2 s apart. Over that window B advances twice as far as A, so B's
    // self-diff (frame2 vs frame1) must EXCEED A's self-diff.
    await sleep(400);
    const f1 = await captureVisFrame();
    await sleep(1200);
    const f2 = await captureVisFrame();
    const aSelf = bufDiff(f1[aId], f2[aId]);
    const bSelf = bufDiff(f1[bId], f2[bId]);
    if (aSelf === 0 && bSelf === 0) {
      fail('#3 speed divergence', `both buffers static (aSelf=${aSelf} bSelf=${bSelf}) — pattern not moving?`);
    } else if (bSelf > aSelf) {
      pass(`#3 SPEED: 2× channel diverges faster than 1× (bSelf=${bSelf} > aSelf=${aSelf})`);
    } else {
      fail('#3 speed divergence', `expected bSelf > aSelf, got bSelf=${bSelf} aSelf=${aSelf}`);
    }

    // Also: A and B (different speeds, same pattern) must differ from EACH
    // OTHER at a given instant once they've drifted apart.
    const crossDiff = bufDiff(f2[aId], f2[bId]);
    if (crossDiff > 0) pass(`#3 SPEED: A vs B buffers differ at an instant (cross=${crossDiff})`);
    else fail('#3 cross divergence', `A and B identical at instant (cross=${crossDiff})`);

    // ── #11 CHASE: same speed, staggered phase offsets ───────────────
    await httpJson('PATCH', `/mixer/channels/${aId}`, { speed: 1, phaseOffsetMs: 0 });
    await httpJson('PATCH', `/mixer/channels/${bId}`, { speed: 1, phaseOffsetMs: 500 });
    await sleep(600);
    const cf = await captureVisFrame();
    const chaseDiff = bufDiff(cf[aId], cf[bId]);
    if (chaseDiff > 0) pass(`#11 CHASE: 0ms vs 500ms offset → staggered buffers (diff=${chaseDiff})`);
    else fail('#11 chase offset', `0ms and 500ms offset produced identical buffers (diff=${chaseDiff})`);

    // ── #4 TAP-TEMPO: 60 BPM halves ONLY a follower ──────────────────
    // A follows tempo, B does not. Set both to speed 1, offset 0.
    await httpJson('PATCH', `/mixer/channels/${aId}`, { speed: 1, phaseOffsetMs: 0, followsTempo: true });
    await httpJson('PATCH', `/mixer/channels/${bId}`, { speed: 1, phaseOffsetMs: 0, followsTempo: false });
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
    // Follower (A, now 0.5×) advances LESS than non-follower (B, still 1×).
    await sleep(400);
    const t1 = await captureVisFrame();
    await sleep(1500);
    const t2 = await captureVisFrame();
    const aFollow = bufDiff(t1[aId], t2[aId]);
    const bFixed = bufDiff(t1[bId], t2[bId]);
    if (bFixed > aFollow) {
      pass(`#4 TAP-TEMPO halves ONLY the follower (follower A=${aFollow} < fixed B=${bFixed})`);
    } else {
      fail('#4 tempo affects followers only', `expected fixed > follower, got A=${aFollow} B=${bFixed}`);
    }
    // Reset tempo to a no-op-ish 120 BPM so we don't leave the rig slowed.
    await httpJson('POST', '/mixer/tempo', { bpm: 120 });

    // ── Error paths ──────────────────────────────────────────────────
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
    const badSpeed = await httpJson('PATCH', `/mixer/channels/${aId}`, { speed: 'oops' });
    if (badSpeed.status === 400) pass('#3 bad speed (non-numeric) → 400');
    else fail('#3 bad speed → 400', `status=${badSpeed.status} body=${JSON.stringify(badSpeed.data)}`);
    const badOff = await httpJson('PATCH', `/mixer/channels/${aId}`, { phaseOffsetMs: 'oops' });
    if (badOff.status === 400) pass('#11 bad phaseOffsetMs (non-numeric) → 400');
    else fail('#11 bad phaseOffsetMs → 400', `status=${badOff.status} body=${JSON.stringify(badOff.data)}`);
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
  console.log('\nAll phase-clock HIL assertions passed.');
  process.exit(0);
}

main();
