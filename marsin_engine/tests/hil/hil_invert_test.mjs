/**
 * hil_invert_test.mjs — HIL coverage for per-channel color INVERT
 * (docs/39 §F-invert).
 *
 * Proves end-to-end against a RUNNING engine that:
 *   1. PATCH /deck/channel {invert:true} flips the deck channel's per-channel
 *      vis-buffer R,G,B bytes to 255-v (within rounding) while the W/A/UV
 *      bytes stay UNCHANGED — per-channel invert is PRE-BLEND, so it shows up
 *      in the channel's own (pre-blend) vis buffer.
 *   2. invert=false is a no-op: clearing it restores the non-inverted
 *      baseline RGB.
 *   3. The PATCH boundary coerces truthy/falsy via !! (no 400 — invert is a
 *      pure boolean like soloSafe), and a truthy non-bool still flips.
 *   4. The invert flag serializes onto GET /deck/channel + GET /mixer
 *      (round-trip via the live serialized export).
 *
 * Signal: the engine's WS /ws/viz frame carries a base64 RGBWAU buffer per
 * channel id (the pre-blend render). We read the deck channel's buffer.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1 (slot 2 port = 31268):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_invert_test.mjs
 *
 * ── Exit Code ─ 0 pass · 1 assertion fail · 2 setup error.
 *
 * ── State hygiene ─ snapshots deck_state.yaml + mixer_state.yaml before
 * mutating, restores in a finally block.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;
const VIZ_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws/viz`;

const STATE_DIR = path.resolve(__dirname, '..', '..', 'states', 'test_bench');
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
const snapshot = { deck: null, mixer: null, taken: false };
function takeSnapshot() {
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
  put(DECK_YAML, snapshot.deck);
  put(MIXER_YAML, snapshot.mixer);
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { restoreSnapshot(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_invert_test.mjs — per-channel color INVERT (docs/39 §F-invert)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  try { await httpJson('GET', '/status'); }
  catch { console.error('  FATAL: engine unreachable at ' + ENGINE_BASE); process.exit(2); }

  takeSnapshot();

  let deckId = null;

  try {
    // ARRANGE: known saturated, asymmetric color so 255-v is unambiguous and
    // the W/A/U bytes (which test_const leaves at 0) stay provably untouched.
    const deckGet = await httpJson('GET', '/deck/channel');
    deckId = deckGet.body && deckGet.body.channel && deckGet.body.channel.id;
    await httpJson('PATCH', '/deck/channel', { hue: 0, invert: false });
    // test_const renders hsv(colorPalette1,1,1). A non-primary hue gives a
    // pixel where R,G,B all differ — so the per-byte 255-v flip is distinct.
    await httpJson('POST', '/param-center', { key: 'colorPalette1', value: { h: 0.08, s: 1, v: 1 } });
    await httpJson('POST', '/mixer/view', { view: 'deck' });
    await sleep(400);

    if (!deckId) {
      fail('no deck channel id available', 'GET /deck/channel returned no id');
    } else {
      // ── TEST 1: invert flips RGB to 255-v, W/A/U unchanged ──────────────
      console.log('\n[TEST 1] invert flips deck channel RGB to 255-v, W/A/U unchanged');
      const before = await nextVisFrame();
      const chBefore = before[deckId] ? meanRGBWAU(before[deckId]) : null;
      check(!!chBefore, `vis frame carries the deck channel buffer (${deckId})`);

      const r = await httpJson('PATCH', '/deck/channel', { invert: true });
      check(r.status === 200, 'PATCH /deck/channel {invert:true} → 200');
      await sleep(250);
      const after = await nextVisFrame();
      const chAfter = after[deckId] ? meanRGBWAU(after[deckId]) : null;

      if (chBefore && chAfter) {
        const chroma = chBefore[0] + chBefore[1] + chBefore[2];
        check(chroma > 3, 'deck channel buffer has real chroma to invert',
          'deck channel buffer is black', `rgb=${chBefore.slice(0, 3)}`);
        // Each mean RGB channel should land near 255 - before (mean of 255-v
        // == 255 - mean(v)). Tolerance covers per-pixel rounding/AA.
        const rErr = Math.abs(chAfter[0] - (255 - chBefore[0]));
        const gErr = Math.abs(chAfter[1] - (255 - chBefore[1]));
        const bErr = Math.abs(chAfter[2] - (255 - chBefore[2]));
        check(rErr < 3 && gErr < 3 && bErr < 3,
          'deck channel RGB == 255 - baseline (per-byte invert, pre-blend buffer)',
          'inverted RGB does not match 255-baseline',
          `err r=${rErr.toFixed(2)} g=${gErr.toFixed(2)} b=${bErr.toFixed(2)} before=${chBefore.slice(0,3)} after=${chAfter.slice(0,3)}`);
        const wauDelta =
          Math.abs(chBefore[3] - chAfter[3]) +
          Math.abs(chBefore[4] - chAfter[4]) +
          Math.abs(chBefore[5] - chAfter[5]);
        check(wauDelta < 2,
          'deck channel W/A/U unchanged under invert (mission-critical whites safe)',
          'W/A/U drifted under invert', `Δwau=${wauDelta.toFixed(2)}`);
      }

      // Serialization: GET /deck/channel + GET /mixer carry invert=true.
      const dg = await httpJson('GET', '/deck/channel');
      const dgInv = dg.body && dg.body.channel && dg.body.channel.invert;
      check(dgInv === true, 'GET /deck/channel serializes invert=true',
        'deck invert not serialized', JSON.stringify(dgInv));

      // ── TEST 2: invert=false is a no-op (restores baseline) ─────────────
      console.log('\n[TEST 2] clearing invert restores the non-inverted baseline');
      await httpJson('PATCH', '/deck/channel', { invert: false });
      await sleep(250);
      const restored = await nextVisFrame();
      const chRestored = restored[deckId] ? meanRGBWAU(restored[deckId]) : null;
      if (chBefore && chRestored) {
        const d =
          Math.abs(chBefore[0] - chRestored[0]) +
          Math.abs(chBefore[1] - chRestored[1]) +
          Math.abs(chBefore[2] - chRestored[2]);
        check(d < 3,
          'invert=false restores baseline RGB (no-op when off)',
          'baseline not restored after invert=false', `Δrgb=${d.toFixed(2)}`);
      }

      // ── TEST 3: PATCH boolean coercion (truthy/falsy, no 400) ───────────
      console.log('\n[TEST 3] PATCH coerces truthy/falsy invert via !! (no 400)');
      const truthy = await httpJson('PATCH', '/deck/channel', { invert: 1 });
      check(truthy.status === 200, 'PATCH {invert:1} → 200 (coerced truthy)');
      const tg = await httpJson('GET', '/deck/channel');
      check(tg.body && tg.body.channel && tg.body.channel.invert === true,
        'truthy non-bool invert coerces to true', 'expected invert=true',
        JSON.stringify(tg.body && tg.body.channel && tg.body.channel.invert));
      const falsy = await httpJson('PATCH', '/deck/channel', { invert: 0 });
      check(falsy.status === 200, 'PATCH {invert:0} → 200 (coerced falsy)');
      const fg = await httpJson('GET', '/deck/channel');
      check(fg.body && fg.body.channel && fg.body.channel.invert === false,
        'falsy invert coerces to false', 'expected invert=false',
        JSON.stringify(fg.body && fg.body.channel && fg.body.channel.invert));
    }

  } finally {
    console.log('\n── Cleanup: resetting invert + restoring state files ──');
    if (deckId) { try { await httpJson('PATCH', '/deck/channel', { invert: false, hue: 0 }); } catch {} }
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
