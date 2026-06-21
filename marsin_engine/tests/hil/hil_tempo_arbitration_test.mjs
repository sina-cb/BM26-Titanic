/**
 * hil_tempo_arbitration_test.mjs — HIL test for TEMPO ARBITRATION
 * (docs/39 §tempo-arbitration). Proves "OSC auto-drives, tap overrides"
 * against a LIVE engine: the manual TAP, the OSC auto-follow, the
 * manual-override hold window, the /mixer/tempo/sync re-sync route, and the
 * `tempoSource` / `oscTempoBpm` WS fields on the live `mixer` broadcast.
 *
 * OSC is simulated by writing the CPC key `audioBpm` over the documented
 * `POST /param-center {audioBpm}` route — this drives the engine's REAL
 * TempoArbiter through its REAL CPC subscription (the same path an OSC
 * `/marsin/audio/bpm` message takes once it lands in the CPC), so no UDP
 * sender / OSC binding setup is needed.
 *
 * Assertions:
 *   1. TAP: POST /mixer/tempo {bpm:100} → tempoBpm=100 + tempoSource:'manual'
 *      on the live `mixer` WS broadcast (the override hold is armed).
 *   2. OVERRIDE HOLD: with a DIFFERENT live OSC bpm (128) streaming, the tempo
 *      stays at the tapped 100 while inside the hold window (OSC does NOT
 *      reclaim). tempoSource stays 'manual'.
 *   3. SYNC RECLAIM: POST /mixer/tempo/sync drops the override → within a few
 *      render frames the live OSC bpm (128) reclaims: tempoBpm→128,
 *      tempoSource→'osc', oscTempoBpm≈128.
 *   4. STALE HOLD: stop feeding OSC; after the staleness window tempoSource
 *      becomes 'held' and the value holds (no clobber).
 *   5. CLAMP: feed an out-of-range OSC bpm (600) → applied tempoBpm clamps to
 *      400 and oscTempoBpm=400.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_tempo_arbitration_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable / audioBpm not registered)
 *
 * ── State it touches ──────────────────────────────────────────────────
 *   Writes mixer.tempoBpm (persisted to mixer_state.yaml) and the CPC key
 *   audioBpm. Both are runtime residue — restore with
 *   `git checkout -- marsin_engine/states/`. No channels/playlists created.
 *   ONE command lifetime (~30s); self-terminates.
 */

import http from 'http';
import { WebSocket } from 'ws';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '31268', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const WS_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws/control`;

// Must match the engine constants (lib/tempo_arbiter.js).
const MANUAL_HOLD_MS = 12000;
const OSC_STALENESS_MS = 1500;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failLabel, failDetail) {
  if (cond) ok(passLabel); else fail(failLabel || passLabel, failDetail);
}

// Feed a "live OSC" BPM by writing the CPC key the OSC binding targets.
function feedOscBpm(bpm) { return httpJson('POST', '/param-center', { audioBpm: bpm }); }

// Keep OSC "fresh" by re-feeding the same bpm every ~400ms (well under the
// 1.5s staleness window). Returns a stop() fn.
function startOscFeed(bpm) {
  let stopped = false;
  const loop = async () => {
    while (!stopped) { await feedOscBpm(bpm); await sleep(400); }
  };
  loop();
  return () => { stopped = true; };
}

// Latest `mixer` WS broadcast.
let lastMixer = null;
let ws = null;

function connectWs() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    const t = setTimeout(() => reject(new Error('WS connect timeout')), 4000);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf); } catch { return; }
      if (m && m.type === 'mixer') lastMixer = m;
    });
  });
}

// Poke a broadcast (GET /mixer triggers nothing; we rely on the mutation
// routes + a re-fed osc to drive broadcasts). To force a fresh `mixer`
// broadcast without mutating tempo, re-issue /mixer/tempo/sync is too heavy;
// instead we read the live serialized state straight off GET /mixer which
// carries the same tempoSource/oscTempoBpm fields.
async function readMixerRest() {
  return (await httpJson('GET', '/mixer')).body;
}

async function cleanup() {
  try { if (ws) ws.close(); } catch {}
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => { await cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_tempo_arbitration_test.mjs — OSC auto-drives, tap overrides');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  // Reachability + audioBpm registered.
  let pc;
  try { pc = (await httpJson('GET', '/param-center')).body; }
  catch {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    console.error('  Start: node engine.js --pattern test_const --model test_bench --port ' + ENGINE_PORT);
    process.exit(2);
  }
  if (!pc || !pc.params || !('audioBpm' in pc.params)) {
    console.error('  FATAL: CPC key audioBpm not registered — cannot simulate OSC BPM.');
    process.exit(2);
  }

  try { await connectWs(); }
  catch (e) { console.error('  FATAL: WS connect failed: ' + e.message); process.exit(2); }
  // Let an initial broadcast land.
  await sleep(400);

  // ── TEST 1: TAP → manual ───────────────────────────────────────────
  console.log('\n[TEST 1] POST /mixer/tempo {bpm:100} → tempoBpm=100, tempoSource=manual');
  {
    const r = await httpJson('POST', '/mixer/tempo', { bpm: 100 });
    check(r.status === 200 && r.body && r.body.tempoBpm === 100,
      'POST /mixer/tempo {100} → 200 tempoBpm=100',
      'tap rejected', `status=${r.status} body=${JSON.stringify(r.body).slice(0,160)}`);
    await sleep(300); // let the mixer broadcast arrive
    check(lastMixer && lastMixer.tempoBpm === 100 && lastMixer.tempoSource === 'manual',
      `WS mixer: tempoBpm=100 tempoSource=manual`,
      'WS did not reflect the tap', `mixer=${JSON.stringify(lastMixer && {b: lastMixer.tempoBpm, s: lastMixer.tempoSource})}`);
  }

  // ── TEST 2: OVERRIDE HOLD — live OSC 128 must NOT reclaim ───────────
  console.log('\n[TEST 2] live OSC 128 does NOT overwrite the tapped 100 during the hold');
  const stopFeed = startOscFeed(128);
  {
    await sleep(2000); // OSC streaming, but well inside the 12s hold window
    const m = await readMixerRest();
    check(m && m.tempoBpm === 100,
      `tempoBpm still 100 (~2s into hold, OSC streaming 128)`,
      'OSC reclaimed too early', `tempoBpm=${m && m.tempoBpm}`);
    check(m && m.tempoSource === 'manual',
      `tempoSource still 'manual' inside the hold (oscTempoBpm=${m && m.oscTempoBpm})`,
      `tempoSource not manual`, `source=${m && m.tempoSource}`);
    check(m && m.oscTempoBpm === 128,
      `oscTempoBpm surfaces the live raw OSC value (128) even while held`,
      `oscTempoBpm wrong`, `oscTempoBpm=${m && m.oscTempoBpm}`);
  }

  // ── TEST 3: SYNC → OSC reclaims immediately ─────────────────────────
  console.log('\n[TEST 3] POST /mixer/tempo/sync drops the override → OSC (128) reclaims');
  {
    const r = await httpJson('POST', '/mixer/tempo/sync', {});
    check(r.status === 200, 'POST /mixer/tempo/sync → 200',
      'sync rejected', `status=${r.status} body=${JSON.stringify(r.body).slice(0,160)}`);
    // A few render frames (40fps → ~25ms each) + a re-fed osc.
    await sleep(700);
    const m = await readMixerRest();
    check(m && m.tempoBpm === 128,
      `tempoBpm reclaimed to OSC value 128 after sync`,
      'OSC did not reclaim after sync', `tempoBpm=${m && m.tempoBpm}`);
    check(m && m.tempoSource === 'osc',
      `tempoSource flipped to 'osc' after sync`,
      `tempoSource not osc`, `source=${m && m.tempoSource}`);
  }

  // ── TEST 4: STALE → held ────────────────────────────────────────────
  console.log('\n[TEST 4] stop OSC → after staleness window tempoSource=held, value holds');
  {
    stopFeed();
    await sleep(OSC_STALENESS_MS + 800);
    const m = await readMixerRest();
    check(m && m.tempoSource === 'held',
      `tempoSource='held' once OSC went stale`,
      `tempoSource not held`, `source=${m && m.tempoSource}`);
    check(m && m.tempoBpm === 128,
      `tempoBpm holds at last value (128) — no clobber when OSC idle`,
      `held value drifted`, `tempoBpm=${m && m.tempoBpm}`);
    check(m && m.oscTempoBpm === null,
      `oscTempoBpm=null when OSC stale`,
      `oscTempoBpm not null when stale`, `oscTempoBpm=${m && m.oscTempoBpm}`);
  }

  // ── TEST 5: CLAMP an out-of-window OSC value ────────────────────────
  // NOTE: the CPC `audioBpm` registry range is [0,300], so `/param-center`
  // pre-clamps any feed to <=300 BEFORE the arbiter sees it — we therefore
  // cannot drive a >400 value through this injection path (real OSC hits the
  // same CPC clamp). We exercise the arbiter's clamp on the LOW edge instead:
  // feed 10 (passes the CPC) → the arbiter clamps the APPLIED tempo to the
  // engine's musical floor (20).
  console.log('\n[TEST 5] OSC 10 (below musical floor) clamps applied tempoBpm to 20');
  {
    // No override in flight (synced + then went held); a fresh OSC value
    // reclaims and drives. Feed 10 fresh.
    const stop2 = startOscFeed(10);
    await sleep(700);
    const m = await readMixerRest();
    check(m && m.tempoBpm === 20,
      `tempoBpm clamped to the floor (20) for an OSC bpm of 10`,
      'clamp failed', `tempoBpm=${m && m.tempoBpm}`);
    check(m && m.oscTempoBpm === 20,
      `oscTempoBpm clamped to 20`,
      'oscTempoBpm clamp failed', `oscTempoBpm=${m && m.oscTempoBpm}`);
    stop2();
  }

  await cleanup();

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log('==========================================================');
  console.log(`  ${passed}/${total} assertions passed`);
  console.log('==========================================================');
  process.exit(passed === total ? 0 : 1);
})().catch(async e => {
  console.error('\nFATAL:', e && e.stack ? e.stack : e);
  await cleanup();
  process.exit(2);
});
