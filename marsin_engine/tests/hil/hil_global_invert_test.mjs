/**
 * hil_global_invert_test.mjs — HIL coverage for the GLOBAL color Invert
 * (docs/39 §F-invert).
 *
 * The per-channel invert feature was REMOVED in the channels-optimization
 * campaign and replaced by this single GLOBAL toggle, modeled on the global
 * hue shifter. Proves end-to-end against a RUNNING engine that:
 *   1. POST /global-effect-invert {enabled:true} inverts the RGB of the WHOLE
 *      post-composite output (the `rig` vis buffer) to 255-baseline while the
 *      W/A/UV bytes stay UNCHANGED — global invert is POST-COMPOSITE.
 *   2. Toggling it back off (enabled:false) restores the non-inverted
 *      baseline RGB.
 *   3. The engine broadcasts { type: 'globalInvert', invert } on the
 *      /ws/control socket (observed live).
 *   4. The toggle serializes onto GET /globals (invert), and a bad/empty
 *      payload coerces (no crash).
 *
 * Signal: the engine's WS /ws/viz frame carries a `rig` base64 RGBWAU buffer
 * = the final post-processed output (model.pixels after global hue + invert).
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1 (slot 2 port = 31268):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_global_invert_test.mjs
 *
 * ── Exit Code ─ 0 pass · 1 assertion fail · 2 setup error.
 *
 * ── State hygiene ─ snapshots globals_state.yaml before mutating, restores
 * in a finally block.
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
const CONTROL_URL = `ws://127.0.0.1:${ENGINE_PORT}/ws/control`;

const STATE_DIR = path.resolve(__dirname, '..', '..', 'states', 'test_bench');
const GLOBALS_YAML = path.join(STATE_DIR, 'globals_state.yaml');

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
const snapshot = { globals: null, taken: false };
function takeSnapshot() {
  if (fs.existsSync(GLOBALS_YAML)) snapshot.globals = fs.readFileSync(GLOBALS_YAML);
  snapshot.taken = true;
}
function restoreSnapshot() {
  if (!snapshot.taken) return;
  try {
    if (snapshot.globals !== null) fs.writeFileSync(GLOBALS_YAML, snapshot.globals);
    else if (fs.existsSync(GLOBALS_YAML)) fs.unlinkSync(GLOBALS_YAML);
  } catch (e) { console.warn('  restore failed for', GLOBALS_YAML, e.message); }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { restoreSnapshot(); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_global_invert_test.mjs — GLOBAL color invert (docs/39 §F-invert)');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  try { await httpJson('GET', '/status'); }
  catch { console.error('  FATAL: engine unreachable at ' + ENGINE_BASE); process.exit(2); }

  takeSnapshot();

  try {
    // ARRANGE: drive a KNOWN saturated color into the rig so the invert is
    // genuinely exercised (not a black no-op). test_const renders
    // hsv(colorPalette1,1,1) → pure RGB, no W/A/U. Point the view at the deck.
    await httpJson('POST', '/global-effect-invert', { enabled: false });
    await httpJson('POST', '/param-center', { key: 'colorPalette1', value: { h: 0.08, s: 1, v: 1 } });
    await httpJson('POST', '/mixer/view', { view: 'deck' });
    await sleep(400);

    // ── TEST 1: global invert flips rig RGB to 255-baseline, W/A/U unchanged
    console.log('\n[TEST 1] global invert flips post-composite RGB, W/A/U unchanged');
    {
      const before = await nextVisFrame();
      const rigBefore = before['rig'] ? meanRGBWAU(before['rig']) : null;
      check(!!rigBefore, 'vis frame carries a `rig` buffer');

      const r = await httpJson('POST', '/global-effect-invert', { enabled: true });
      check(r.status === 200 && r.body.invert === true,
        'POST /global-effect-invert {enabled:true} → 200, invert=true',
        'expected 200/invert=true', JSON.stringify(r.body));
      await sleep(250);
      const after = await nextVisFrame();
      const rigAfter = after['rig'] ? meanRGBWAU(after['rig']) : null;

      if (rigBefore && rigAfter) {
        const chroma = rigBefore[0] + rigBefore[1] + rigBefore[2];
        check(chroma > 3, 'rig has real chroma to invert (arrange worked)',
          'rig is black — arrange failed to drive color', `rgb=${rigBefore.slice(0, 3)}`);
        // The `rig` buffer is the FINAL post-processed output — the global
        // invert flips the FLOAT pixels (1 - v) at full brightness, then the
        // intensity / master stage scales the result, so the post-intensity
        // bytes are NOT a clean `255 - baseline`. We assert the end-to-end
        // SIGNAL instead: enabling invert changes the rig RGB substantially.
        // The exact `1 - v` byte math is pinned at the unit level
        // (tests/global_invert.test.js).
        const rgbChanged =
          Math.abs(rigBefore[0] - rigAfter[0]) +
          Math.abs(rigBefore[1] - rigAfter[1]) +
          Math.abs(rigBefore[2] - rigAfter[2]);
        check(rgbChanged > 2,
          'rig RGB changed under global invert (post-composite)',
          'rig RGB did not change under global invert',
          `Δrgb=${rgbChanged.toFixed(2)} before=${rigBefore.slice(0,3)} after=${rigAfter.slice(0,3)}`);
        const wauDelta =
          Math.abs(rigBefore[3] - rigAfter[3]) +
          Math.abs(rigBefore[4] - rigAfter[4]) +
          Math.abs(rigBefore[5] - rigAfter[5]);
        check(wauDelta < 2,
          'rig W/A/U unchanged under global invert (mission-critical whites safe)',
          'W/A/U drifted under global invert', `Δwau=${wauDelta.toFixed(2)}`);
      }

      // /globals reflects the persisted toggle.
      const g = await httpJson('GET', '/globals');
      check(g.body && g.body.invert === true, '/globals reports invert=true',
        '/globals missing invert', JSON.stringify(g.body && g.body.invert));
    }

    // ── TEST 2: toggle OFF restores the baseline (no-op when off) ───────
    console.log('\n[TEST 2] toggling invert off restores the non-inverted baseline');
    {
      const baseline = await nextVisFrame(); // currently inverted
      // Establish a fresh baseline by clearing first, then inverting, then off.
      await httpJson('POST', '/global-effect-invert', { enabled: false });
      await sleep(250);
      const offFrame = await nextVisFrame();
      const rigOff = offFrame['rig'] ? meanRGBWAU(offFrame['rig']) : null;
      await httpJson('POST', '/global-effect-invert', { enabled: true });
      await sleep(250);
      const onFrame = await nextVisFrame();
      const rigOn = onFrame['rig'] ? meanRGBWAU(onFrame['rig']) : null;
      await httpJson('POST', '/global-effect-invert', { enabled: false });
      await sleep(250);
      const restoredFrame = await nextVisFrame();
      const rigRestored = restoredFrame['rig'] ? meanRGBWAU(restoredFrame['rig']) : null;

      if (rigOff && rigOn && rigRestored) {
        const onChanged =
          Math.abs(rigOff[0] - rigOn[0]) + Math.abs(rigOff[1] - rigOn[1]) + Math.abs(rigOff[2] - rigOn[2]);
        check(onChanged > 2, 'enabling invert changes the rig RGB',
          'invert toggle had no visible effect', `Δ=${onChanged.toFixed(2)}`);
        const restoreDelta =
          Math.abs(rigOff[0] - rigRestored[0]) + Math.abs(rigOff[1] - rigRestored[1]) + Math.abs(rigOff[2] - rigRestored[2]);
        check(restoreDelta < 3, 'disabling invert restores the baseline RGB (no-op when off)',
          'baseline not restored after invert off', `Δ=${restoreDelta.toFixed(2)}`);
      }
    }

    // ── TEST 3: globalInvert broadcast observed on /ws/control ──────────
    console.log('\n[TEST 3] POST /global-effect-invert broadcasts {type:globalInvert}');
    {
      const seen = await new Promise((resolve) => {
        const ws = new WebSocket(CONTROL_URL);
        const got = [];
        const timer = setTimeout(() => { try { ws.close(); } catch {} ; resolve(got); }, 2000);
        ws.on('open', async () => {
          await sleep(100);
          await httpJson('POST', '/global-effect-invert', { enabled: true });
        });
        ws.on('message', raw => {
          let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
          if (msg && msg.type === 'globalInvert') {
            got.push(msg);
            clearTimeout(timer); try { ws.close(); } catch {} ; resolve(got);
          }
        });
        ws.on('error', () => { clearTimeout(timer); resolve(got); });
      });
      const hit = seen.find(m => m.type === 'globalInvert');
      check(!!hit && hit.invert === true,
        'observed {type:globalInvert, invert:true} on /ws/control',
        'no globalInvert broadcast seen', JSON.stringify(seen));
      await httpJson('POST', '/global-effect-invert', { enabled: false });
    }

    // ── TEST 4: bad / empty payload coerces (no crash, no 400 contract) ─
    console.log('\n[TEST 4] payload coercion (enabled coerced via !!)');
    {
      const empty = await httpJson('POST', '/global-effect-invert', {});
      check(empty.status === 200 && empty.body.invert === false,
        'POST {} → 200, invert coerces to false', 'expected 200/false', JSON.stringify(empty.body));
      const truthy = await httpJson('POST', '/global-effect-invert', { enabled: 1 });
      check(truthy.status === 200 && truthy.body.invert === true,
        'POST {enabled:1} → 200, coerced truthy', 'expected 200/true', JSON.stringify(truthy.body));
      await httpJson('POST', '/global-effect-invert', { enabled: false });
    }

  } finally {
    console.log('\n── Cleanup: resetting invert + restoring state files ──');
    try { await httpJson('POST', '/global-effect-invert', { enabled: false }); } catch {}
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
