/**
 * hil_hue_shift_test.mjs — HIL coverage for the Hue Shifter (docs/39 §F-hue,
 * PER-CHANNEL ONLY since 2026-07 — the GLOBAL post-mixer hue shifter was
 * removed by operator decision: "only the channel hue shifts").
 *
 * Proves end-to-end against a RUNNING engine that:
 *   1. The removed global route FAILS LOUD: POST /global-effect-hue → 410
 *      GLOBAL_HUE_REMOVED (never a no-op success), and GET /globals carries
 *      NO hueShift key (a persisted legacy value is discarded at boot).
 *   2. PATCH /deck/channel {hue} rotates the deck channel's per-channel
 *      vis buffer RGB while W/A/UV stay unchanged — per-channel hue is
 *      PRE-BLEND (it shows up in the channel's own vis buffer, which is
 *      the pre-blend render).
 *   3. validateHue fail-loud at the API boundary: non-finite hue → 400.
 *   4. The deck channel's hue serializes onto GET /deck/channel.
 *
 * Signal: the engine's WS /ws/viz frame carries a base64 RGBWAU buffer
 * per channel id. We read those buffers directly.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1 (slot 2 port = 31268):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_hue_shift_test.mjs
 *
 * ── Exit Code ─ 0 pass · 1 assertion fail · 2 setup error.
 *
 * ── State hygiene ─ snapshots globals_state.yaml + deck_state.yaml +
 * mixer_state.yaml before mutating, restores in a finally block.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

import { assertDisposableEngine } from './hil_guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const VIZ_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws/viz`;

const STATE_DIR = path.resolve(__dirname, '..', '..', 'states', 'test_bench');
const GLOBALS_YAML = path.join(STATE_DIR, 'globals_state.yaml');
const DECK_YAML = path.join(STATE_DIR, 'deck_state.yaml');
const MIXER_YAML = path.join(STATE_DIR, 'mixer_state.yaml');

function httpJson(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, ENGINE_BASE);
    const opts = {
      method, hostname: u.hostname, port: u.port, path: u.pathname,
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

const results = [];
function ok(label) { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, p, f, d) { if (cond) ok(p); else fail(f || p, d); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Open a /ws/viz socket and resolve the next 'vis' frame's decoded buffers.
function nextVisFrame(timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(VIZ_URL);
    const timer = setTimeout(() => { try { ws.close(); } catch {} ; reject(new Error('vis frame timeout')); }, timeoutMs);
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || msg.type !== 'vis' || !msg.vis) return;
      clearTimeout(timer);
      const decoded = {};
      for (const [key, b64] of Object.entries(msg.vis)) {
        decoded[key] = b64 ? Buffer.from(b64, 'base64') : null;
      }
      try { ws.close(); } catch {}
      resolve(decoded);
    });
    ws.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// Mean R/G/B/W/A/U across a 6ch interleaved Uint8 buffer.
function meanRGBWAU(buf) {
  const n = Math.floor(buf.length / 6);
  const s = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    for (let c = 0; c < 6; c++) s[c] += buf[o + c];
  }
  return s.map(v => v / Math.max(1, n));
}

// ─────────────────────────── snapshot / restore ──────────────────────
const snapshot = { globals: null, deck: null, mixer: null, taken: false };
function takeSnapshot() {
  if (fs.existsSync(GLOBALS_YAML)) snapshot.globals = fs.readFileSync(GLOBALS_YAML);
  if (fs.existsSync(DECK_YAML)) snapshot.deck = fs.readFileSync(DECK_YAML);
  if (fs.existsSync(MIXER_YAML)) snapshot.mixer = fs.readFileSync(MIXER_YAML);
  snapshot.taken = true;
}
function restoreSnapshot() {
  if (!snapshot.taken) return;
  const put = (file, buf) => {
    try {
      if (buf !== null) fs.writeFileSync(file, buf);
      else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) { console.warn('  restore failed for', file, e.message); }
  };
  put(GLOBALS_YAML, snapshot.globals);
  put(DECK_YAML, snapshot.deck);
  put(MIXER_YAML, snapshot.mixer);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { restoreSnapshot(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_hue_shift_test.mjs — per-channel Hue Shifter (global REMOVED)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  try { await httpJson('GET', '/status'); }
  catch { console.error('  FATAL: engine unreachable at ' + ENGINE_BASE); process.exit(2); }

  // Refuse to mutate a non-disposable engine BEFORE any write.
  await assertDisposableEngine(ENGINE_BASE);

  takeSnapshot();

  let deckId = null;

  try {
    // ARRANGE: set the deck channel to a known RED-dominant pattern so the
    // hue rotation has something colorful to rotate. test_const renders a
    // constant color we can drive via its exports; if that fails we still
    // proceed (the buffer may be whatever the boot pattern produced).
    const deckGet = await httpJson('GET', '/deck/channel');
    // GET /deck/channel returns { master, blackout, channel: {...} }.
    deckId = deckGet.body && deckGet.body.channel && deckGet.body.channel.id;
    // Reset the per-channel hue baseline.
    if (deckId) await httpJson('PATCH', '/deck/channel', { hue: 0 });
    // Drive a KNOWN saturated color into the deck so the rotation is
    // genuinely exercised (not the no-chroma escape clause). test_const
    // renders hsv(colorPalette1,1,1) → pure RGB, no W/A/U.
    await httpJson('POST', '/param-center', { key: 'colorPalette1', value: { h: 0.0, s: 1, v: 1 } });
    await httpJson('POST', '/mixer/view', { view: 'deck' });
    await sleep(400);

    // ── TEST 1: the removed GLOBAL route fails loud, /globals is clean ──
    console.log('\n[TEST 1] global hue is GONE: 410 route + no /globals hueShift');
    {
      const gone = await httpJson('POST', '/global-effect-hue', { degrees: 120 });
      check(gone.status === 410, 'POST /global-effect-hue → 410 Gone (never a no-op success)',
        'expected 410', `status=${gone.status} body=${JSON.stringify(gone.body)}`);
      check(gone.body && gone.body.code === 'GLOBAL_HUE_REMOVED',
        '410 body carries code GLOBAL_HUE_REMOVED',
        'missing removal code', JSON.stringify(gone.body));

      const g = await httpJson('GET', '/globals');
      check(g.status === 200 && g.body && !('hueShift' in g.body),
        'GET /globals carries NO hueShift key (legacy value discarded at boot)',
        '/globals still carries hueShift', JSON.stringify(g.body && g.body.hueShift));
    }

    // ── TEST 2: validateHue fail-loud on the PER-CHANNEL path ───────────
    console.log('\n[TEST 2] per-channel validateHue fail-loud + normalize');
    if (!deckId) {
      fail('no deck channel id available', 'GET /deck/channel returned no id');
    } else {
      const bad = await httpJson('PATCH', '/deck/channel', { hue: 'not-a-number' });
      check(bad.status === 400, 'PATCH /deck/channel {hue:"not-a-number"} → 400',
        'expected 400', JSON.stringify(bad.body));
      const norm = await httpJson('PATCH', '/deck/channel', { hue: 370 });
      check(norm.status === 200, 'PATCH /deck/channel {hue:370} → 200');
      const dg = await httpJson('GET', '/deck/channel');
      const dgHue = dg.body && dg.body.channel && dg.body.channel.hue;
      check(Math.abs((dgHue ?? -1) - 10) < 1e-6,
        'hue 370 normalized to 10 (serialized on GET /deck/channel)',
        'expected normalized 10', JSON.stringify(dgHue));
      await httpJson('PATCH', '/deck/channel', { hue: 0 });
      await sleep(150);
    }

    // ── TEST 3: PER-CHANNEL hue rotates the deck vis buffer RGB ─────────
    console.log('\n[TEST 3] per-channel deck hue rotates pre-blend RGB, W/A/U unchanged');
    if (!deckId) {
      fail('no deck channel id available', 'GET /deck/channel returned no id');
    } else {
      const before = await nextVisFrame();
      const chBefore = before[deckId] ? meanRGBWAU(before[deckId]) : null;
      check(!!chBefore, `vis frame carries the deck channel buffer (${deckId})`);

      const r = await httpJson('PATCH', '/deck/channel', { hue: 120 });
      check(r.status === 200, 'PATCH /deck/channel {hue:120} → 200');
      await sleep(250);
      const after = await nextVisFrame();
      const chAfter = after[deckId] ? meanRGBWAU(after[deckId]) : null;

      if (chBefore && chAfter) {
        const chroma = chBefore[0] + chBefore[1] + chBefore[2];
        check(chroma > 3, 'deck channel buffer has real chroma to rotate',
          'deck channel buffer is black', `rgb=${chBefore.slice(0,3)}`);
        const rgbChanged =
          Math.abs(chBefore[0] - chAfter[0]) +
          Math.abs(chBefore[1] - chAfter[1]) +
          Math.abs(chBefore[2] - chAfter[2]);
        const wauDelta =
          Math.abs(chBefore[3] - chAfter[3]) +
          Math.abs(chBefore[4] - chAfter[4]) +
          Math.abs(chBefore[5] - chAfter[5]);
        check(rgbChanged > 2,
          'deck channel RGB rotated under per-channel hue (pre-blend vis buffer)',
          'deck channel RGB did not change', `Δrgb=${rgbChanged.toFixed(2)} before=${chBefore} after=${chAfter}`);
        check(wauDelta < 2,
          'deck channel W/A/U unchanged under per-channel hue',
          'W/A/U drifted under per-channel hue', `Δwau=${wauDelta.toFixed(2)}`);
      }

      // Serialization: GET /deck/channel carries the hue.
      const dg = await httpJson('GET', '/deck/channel');
      const dgHue = dg.body && dg.body.channel && dg.body.channel.hue;
      check(Math.abs((dgHue ?? -1) - 120) < 1e-6,
        'GET /deck/channel serializes hue=120',
        'deck hue not serialized', JSON.stringify(dgHue));

      await httpJson('PATCH', '/deck/channel', { hue: 0 });
      await sleep(150);

      // Per-channel validateHue fail-loud.
      const bad = await httpJson('PATCH', '/deck/channel', { hue: Infinity });
      // JSON.stringify(Infinity) === 'null', so the engine sees null → 400.
      check(bad.status === 400, 'PATCH /deck/channel {hue:Infinity→null} → 400',
        'expected 400 on non-finite hue', JSON.stringify(bad.body));
    }

  } finally {
    console.log('\n── Cleanup: resetting hue + restoring state files ──');
    if (deckId) { try { await httpJson('PATCH', '/deck/channel', { hue: 0 }); } catch {} }
    restoreSnapshot();
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n──────── ${passed}/${total} passed ────────`);
  process.exit(passed === total ? 0 : 1);
})().catch(err => {
  console.error('FATAL:', err);
  restoreSnapshot();
  process.exit(2);
});
