/**
 * hil_playlist_hotswap_test.mjs — HIL test for the hot-swap mixer slice.
 *
 * Exercises, against a LIVE engine, the behaviors added on
 * dev/engine_hotswap_mixer:
 *
 *   A. Codex P0 fail-loud validation surfaces as HTTP 4xx, not silent
 *      coercion:
 *        A1. PATCH /deck/channel  { mode: 'not_a_blend' }            → 400
 *        A2. POST  /deck/transition-config { durationMs: 'abc' }     → 400
 *        A3. POST  /deck/transition-config { mode: 'blend_screen' }  → 400
 *            (a steady blend is NOT a valid transition mode)
 *
 *   B. Render-health is VISIBLE on /status:
 *        B1. GET /status exposes renderHealth { ok, blendErrors }
 *        B2. with all blends precompiled at boot, renderHealth.ok === true
 *
 *   C. Hot-swap playlist endpoint:
 *        C1. POST /deck/playlist/swap { name } loads a DIFFERENT playlist
 *            and lands on its first usable entry (pattern changes).
 *        C2. POST /deck/playlist/swap { name, entryId } lands on the
 *            specified entry.
 *        C3. POST /deck/playlist/swap with a missing playlist → 404.
 *        C4. POST /mixer/.../playlist/swap mirrors it on a mixer overlay.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   Engine running with test_bench model. This test defaults to port
 *   31068 (slot 0). Override with $ENGINE_BASE / $WS_URL.
 *
 *   node engine.js --pattern test_const --model test_bench --port 31068
 *
 * ── State hygiene ─────────────────────────────────────────────────────
 *   Snapshots states/test_bench/*.yaml AND the scene playlists dir before
 *   the run and restores them in a finally block, so a successful run
 *   leaves NO tracked diff. The HIL playlists it creates are deleted.
 *
 * ── Exit code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed and state restored
 *   1 = an assertion failed or the engine was unreachable
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENGINE_BASE = process.env.ENGINE_BASE || 'http://127.0.0.1:31068';
const SETTLE_MS = 250;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(ENGINE_ROOT, 'states', 'test_bench');
const STATE_FILES = ['deck_state.yaml', 'mixer_state.yaml', 'globals_state.yaml'];
const PLAYLISTS_DIR = path.resolve(
  ENGINE_ROOT, '..', 'simulation', 'scenes', 'test_bench', 'playlists',
);

// ── HTTP helper that EXPOSES the status code (we assert on 400/404) ────
function httpReq(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(p, ENGINE_BASE);
    const opts = {
      method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── assertion bus ─────────────────────────────────────────────────────
const results = [];
function ok(label) { console.log('  PASS  ' + label); results.push(true); }
function fail(label, detail) { console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : '')); results.push(false); }
function check(cond, label, detail) { if (cond) ok(label); else fail(label, detail); }

// ── state snapshot / restore ──────────────────────────────────────────
const snapshot = { state: {}, playlists: null };

function snapshotState() {
  for (const f of STATE_FILES) {
    const fp = path.join(STATE_DIR, f);
    snapshot.state[f] = fs.existsSync(fp) ? fs.readFileSync(fp) : null;
  }
  // Snapshot the full set of playlist filenames so we can delete any that
  // the test added, and restore any it overwrote.
  if (fs.existsSync(PLAYLISTS_DIR)) {
    snapshot.playlists = {};
    for (const f of fs.readdirSync(PLAYLISTS_DIR)) {
      if (f.endsWith('.yaml')) snapshot.playlists[f] = fs.readFileSync(path.join(PLAYLISTS_DIR, f));
    }
  }
}

function restoreState() {
  for (const f of STATE_FILES) {
    const fp = path.join(STATE_DIR, f);
    if (snapshot.state[f] === null) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } else if (snapshot.state[f] !== undefined) {
      fs.writeFileSync(fp, snapshot.state[f]);
    }
  }
  if (snapshot.playlists) {
    // Delete any playlist file not present in the snapshot (test-created).
    for (const f of fs.readdirSync(PLAYLISTS_DIR)) {
      if (f.endsWith('.yaml') && !(f in snapshot.playlists)) {
        fs.unlinkSync(path.join(PLAYLISTS_DIR, f));
      }
    }
    // Restore the original bytes of any that existed before.
    for (const [f, bytes] of Object.entries(snapshot.playlists)) {
      fs.writeFileSync(path.join(PLAYLISTS_DIR, f), bytes);
    }
  }
}

// ── main ──────────────────────────────────────────────────────────────
(async () => {
  console.log('==========================================================');
  console.log('hil_playlist_hotswap_test.mjs');
  console.log('Engine: ' + ENGINE_BASE);
  console.log('==========================================================');

  // Confirm the engine is up first.
  let status;
  try {
    status = await httpReq('GET', '/status');
  } catch (e) {
    console.error('Engine not reachable at ' + ENGINE_BASE + ': ' + e.message);
    process.exit(1);
  }
  if (status.status !== 200) {
    console.error('GET /status did not return 200 (got ' + status.status + ')');
    process.exit(1);
  }

  snapshotState();
  let savedTxCfg = null;

  try {
    savedTxCfg = (await httpReq('GET', '/deck/transition-config')).body;

    // ── B. Render-health visibility ───────────────────────────────────
    console.log('\n── B. Render-health on /status ──');
    const rh = status.body.renderHealth;
    check(rh && typeof rh.ok === 'boolean', 'B1 /status exposes renderHealth.ok',
      JSON.stringify(rh));
    check(Array.isArray(rh && rh.blendErrors), 'B1 renderHealth.blendErrors is an array');
    check(rh && rh.ok === true, 'B2 renderHealth.ok === true (all blends precompiled)',
      JSON.stringify(rh && rh.blendErrors));

    // ── A. Fail-loud validation ───────────────────────────────────────
    console.log('\n── A. Fail-loud 4xx validation ──');
    const a1 = await httpReq('PATCH', '/deck/channel', { mode: 'not_a_blend' });
    check(a1.status === 400, 'A1 PATCH /deck/channel bad mode -> 400',
      'got ' + a1.status);

    const a2 = await httpReq('POST', '/deck/transition-config', { durationMs: 'abc' });
    check(a2.status === 400, 'A2 transition-config durationMs=NaN -> 400',
      'got ' + a2.status + ' ' + JSON.stringify(a2.body));

    const a3 = await httpReq('POST', '/deck/transition-config', { mode: 'blend_screen' });
    check(a3.status === 400, 'A3 transition-config steady-blend mode -> 400',
      'got ' + a3.status);

    // Sanity: a VALID transition-config still works (so we didn't break it).
    const a4 = await httpReq('POST', '/deck/transition-config', {
      enabled: false, mode: 'trans_crossfade', durationMs: 500, shuffle: false,
    });
    check(a4.status === 200, 'A4 valid transition-config -> 200', 'got ' + a4.status);

    // ── C. Hot-swap playlist endpoint ─────────────────────────────────
    console.log('\n── C. /deck/playlist/swap ──');

    // Two distinct HIL playlists with known, different first patterns.
    const PL_A = 'hil_hotswap_a';
    const PL_B = 'hil_hotswap_b';
    await httpReq('POST', '/playlists', {
      name: PL_A,
      entries: [
        { id: 'a_const', pattern: 'test_const', label: 'A0', defaults: {} },
        { id: 'a_dual', pattern: 'test_dualband', label: 'A1', defaults: {} },
      ],
    });
    await httpReq('POST', '/playlists', {
      name: PL_B,
      entries: [
        { id: 'b_dual', pattern: 'test_dualband', label: 'B0', defaults: {} },
        { id: 'b_const', pattern: 'test_const', label: 'B1', defaults: {} },
      ],
    });
    await sleep(SETTLE_MS);

    // Land the deck on PL_A first (transitions disabled → instant).
    await httpReq('POST', '/deck/playlist', { name: PL_A });
    await sleep(SETTLE_MS);
    const onA = await httpReq('GET', '/deck/playlist');
    check(onA.body && onA.body.name === PL_A, 'C0 deck loaded PL_A baseline',
      JSON.stringify(onA.body));

    // C1: swap to PL_B (no entryId) → first usable entry (test_dualband).
    const c1 = await httpReq('POST', '/deck/playlist/swap', { name: PL_B });
    await sleep(SETTLE_MS);
    check(c1.status === 200, 'C1 swap to PL_B -> 200', 'got ' + c1.status);
    const afterB = await httpReq('GET', '/deck/playlist');
    check(afterB.body && afterB.body.name === PL_B,
      'C1 deck playlist is now PL_B', JSON.stringify(afterB.body));
    check(afterB.body && afterB.body.activeEntryId === 'b_dual',
      'C1 landed on first usable entry b_dual', JSON.stringify(afterB.body));

    // C2: swap back to PL_A pinned to a SPECIFIC entry (a_dual, index 1).
    const c2 = await httpReq('POST', '/deck/playlist/swap', { name: PL_A, entryId: 'a_dual' });
    await sleep(SETTLE_MS);
    check(c2.status === 200, 'C2 swap to PL_A entry a_dual -> 200', 'got ' + c2.status);
    const afterA2 = await httpReq('GET', '/deck/playlist');
    check(afterA2.body && afterA2.body.name === PL_A && afterA2.body.activeEntryId === 'a_dual',
      'C2 landed on PL_A / a_dual', JSON.stringify(afterA2.body));

    // C3: swap to a non-existent playlist → 404.
    const c3 = await httpReq('POST', '/deck/playlist/swap', { name: 'no_such_playlist_xyz' });
    check(c3.status === 404, 'C3 swap to missing playlist -> 404', 'got ' + c3.status);

    // C3b: swap with no name → 400.
    const c3b = await httpReq('POST', '/deck/playlist/swap', {});
    check(c3b.status === 400, 'C3b swap with no name -> 400', 'got ' + c3b.status);

    // ── C4. Mixer-overlay swap mirror ─────────────────────────────────
    console.log('\n── C4. /mixer/channels/:id/playlist/swap ──');
    const addCh = await httpReq('POST', '/mixer/channels', {
      name: 'HilOverlay', pattern: 'test_const',
    });
    let overlayId = null;
    if (addCh.status === 200 && addCh.body) {
      overlayId = addCh.body.channelId || addCh.body.id;
    }
    if (!overlayId) {
      // Fall back to reading the mixer list.
      const mx = await httpReq('GET', '/mixer');
      const chans = (mx.body && (mx.body.channels || mx.body.mixerChannels)) || [];
      const last = chans[chans.length - 1];
      overlayId = last && last.id;
    }
    if (overlayId) {
      const c4 = await httpReq('POST', `/mixer/channels/${overlayId}/playlist/swap`, {
        name: PL_B, entryId: 'b_const',
      });
      await sleep(SETTLE_MS);
      check(c4.status === 200, 'C4 mixer overlay swap -> 200',
        'got ' + c4.status + ' ' + JSON.stringify(c4.body));
      check(c4.body && c4.body.pattern === 'test_const',
        'C4 overlay landed on b_const (test_const)', JSON.stringify(c4.body));
      // Cleanup the overlay we added.
      await httpReq('DELETE', `/mixer/channels/${overlayId}`);
    } else {
      fail('C4 could not create a mixer overlay to test the swap mirror');
    }

    // Tidy: drop deck back to default so restore is clean, delete HIL pls.
    await httpReq('POST', '/deck/playlist', { name: 'default' });
    await httpReq('DELETE', `/playlists/${PL_A}`);
    await httpReq('DELETE', `/playlists/${PL_B}`);
  } catch (e) {
    fail('unexpected exception', e.message);
    console.error(e);
  } finally {
    // Restore transition config via API (best effort), then hard-restore
    // the on-disk state + playlist snapshots so there is NO tracked diff.
    try {
      if (savedTxCfg) {
        await httpReq('POST', '/deck/transition-config', {
          enabled: !!savedTxCfg.enabled,
          mode: savedTxCfg.mode || 'trans_crossfade',
          durationMs: savedTxCfg.durationMs || 1000,
          shuffle: !!savedTxCfg.shuffle,
        });
      }
    } catch (_) {}
    await sleep(SETTLE_MS);
    restoreState();
    console.log('\n── state + playlists restored from snapshot ──');
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n==========================================================`);
  console.log(`Result: ${passed}/${total} assertions passed`);
  console.log(`==========================================================`);
  process.exit(passed === total && total > 0 ? 0 : 1);
})();
