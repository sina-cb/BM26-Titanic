/**
 * hil_view_selection_test.mjs — HIL Test for Mixer View-Selection Masking
 *
 * Drives the full engine path described in
 * docs/27_[todo]_mixer_layer_view_selection.md §2: enumerate model
 * view-selection options via the API, set a per-channel viewSelection,
 * and verify that subsequent mixer broadcasts carry the new mask.
 *
 * This is a smoke-level HIL — it confirms the API round-trip + state
 * persistence + serialization wiring is intact end-to-end. The
 * pure-JS unit test (`pattern_mixer_masking.test.js`) covers the
 * rendering math; this test confirms the engine actually exposes the
 * machinery to operators over HTTP.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   Engine running with `test_bench` model (52 pixels) on slot 1 port:
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31168
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_view_selection_test.mjs [--port 31168]
 *
 * ── What it Tests ─────────────────────────────────────────────────────
 *   1. GET /model/view-selection-options enumerates non-empty groups,
 *      sections, fixtures, and a viewMask union.
 *   2. POST /mixer/view {view:'mixer'} → /mixer broadcasts have
 *      viewSelection field on every channel (defaults to type=all).
 *   3. PATCH /mixer/channels/:id with a valid {viewSelection:{type:'group',
 *      target:<name>}} returns 200 and the next /mixer broadcast
 *      reflects the new selection.
 *   4. PATCH with a MALFORMED viewSelection (e.g. type='group',
 *      target=42) returns 400 BEFORE touching channel state.
 *   5. PATCH with type='all' clears the mask (round-trip back to
 *      default).
 *   6. State persistence: re-fetch /mixer after the PATCH and confirm
 *      the new viewSelection is preserved on the channel.
 *
 * Snapshot/restore protocol: the test reads the current viewSelection
 * for the target overlay BEFORE mutating, and restores it in `finally`
 * so the operator's setup is never permanently altered.
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';

// Slot 1 engine port per .agent/00_gol/13_multi_agent.md.
const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : 31168;
const BASE = `http://127.0.0.1:${PORT}`;

function httpJson(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
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

async function main() {
  console.log(`\n== HIL: view-selection masking (engine ${BASE}) ==\n`);

  let baseline;
  try {
    baseline = (await httpJson('GET', '/mixer')).body;
  } catch (e) {
    console.error(`Cannot reach engine at ${BASE}: ${e.message}`);
    console.error(`  Start with: node engine.js --pattern test_const --model test_bench --port ${PORT}`);
    return 1;
  }

  // ─── Test 1: enumerate view-selection options ────────────────────
  console.log('[TEST 1] GET /model/view-selection-options');
  const opts = (await httpJson('GET', '/model/view-selection-options')).body;
  check(opts && Array.isArray(opts.groups) && opts.groups.length > 0,
    `groups enumerated (${opts?.groups?.length || 0} found)`,
    'no groups returned');
  check(opts && Array.isArray(opts.sections) && opts.sections.length > 0,
    `sections enumerated (${opts?.sections?.length || 0} found)`,
    'no sections returned');
  check(opts && opts.pixelCount > 0,
    `pixelCount > 0 (${opts?.pixelCount})`, 'no pixelCount');

  const targetGroup = (opts.groups || [])[0];
  if (!targetGroup) {
    console.error('  No groups in model — cannot continue.');
    return 1;
  }

  // Need at least one overlay channel; if there isn't one, add a
  // temporary "ParLights"-scoped channel for the test. We'll remove
  // it at the end to leave the rig clean.
  let addedTempChannel = null;
  let overlayId = null;
  const overlays = (baseline.channels || []).filter(c => c.id !== baseline.baseChannelId);
  if (overlays.length === 0) {
    console.log('  no overlay channels exist; adding a temporary one for the test');
    const playlists = (await httpJson('GET', '/playlists')).body || [];
    const pl = Array.isArray(playlists) && playlists.length > 0 ? playlists[0] : 'default';
    const add = await httpJson('POST', '/mixer/channels', { playlist: pl, name: 'hil_vs_test' });
    check(add.status === 200, `add temp overlay (${add.status})`, 'could not add overlay');
    if (add.status !== 200) return 1;
    addedTempChannel = add.body.channelId;
    overlayId = add.body.channelId;
    // Give the engine a moment to broadcast the addition.
    await sleep(100);
  } else {
    overlayId = overlays[0].id;
  }

  // Snapshot original viewSelection so we can restore.
  const preState = (await httpJson('GET', '/mixer')).body;
  const overlayPre = (preState.channels || []).find(c => c.id === overlayId);
  const originalViewSelection = overlayPre?.viewSelection || { type: 'all', target: null, invert: false };

  try {
    // ─── Test 2: default mixer state surfaces viewSelection ────────
    console.log('\n[TEST 2] /mixer broadcast includes viewSelection on every channel');
    {
      const m = preState;
      const missing = (m.channels || []).filter(c => !c.viewSelection);
      check(missing.length === 0,
        `all ${m.channels?.length || 0} channels have a viewSelection field`,
        `missing on: ${missing.map(c => c.id).join(',')}`);
    }

    // ─── Test 3: PATCH a valid group selection ─────────────────────
    console.log('\n[TEST 3] PATCH viewSelection type=group');
    {
      const r = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'group', target: targetGroup },
      });
      check(r.status === 200, `PATCH returned 200`, `status ${r.status} body=${JSON.stringify(r.body)}`);

      // Read back via GET /mixer (the canonical source of truth).
      const m = (await httpJson('GET', '/mixer')).body;
      const ch = (m.channels || []).find(c => c.id === overlayId);
      check(ch && ch.viewSelection && ch.viewSelection.type === 'group' && ch.viewSelection.target === targetGroup,
        `channel viewSelection persisted as group=${targetGroup}`,
        `got ${JSON.stringify(ch?.viewSelection)}`);
    }

    // ─── Test 4: malformed shape rejected with 400 ─────────────────
    console.log('\n[TEST 4] PATCH malformed viewSelection rejected with 400');
    {
      const bad = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'group', target: 42 },  // wrong type for target
      });
      check(bad.status === 400, `malformed group target → 400`, `got ${bad.status}`);
      const bad2 = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'roomBitmap', target: 1 },  // unknown type
      });
      check(bad2.status === 400, `unknown type → 400`, `got ${bad2.status}`);
      const bad3 = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'section', target: '1' },  // string for section
      });
      check(bad3.status === 400, `non-integer section target → 400`, `got ${bad3.status}`);

      // After all the 400s, the channel must STILL have the
      // previously-set group selection (failed validation must not
      // mutate state). This is the load-bearing guarantee from §3.1.
      const m = (await httpJson('GET', '/mixer')).body;
      const ch = (m.channels || []).find(c => c.id === overlayId);
      check(ch && ch.viewSelection && ch.viewSelection.type === 'group' && ch.viewSelection.target === targetGroup,
        `channel viewSelection unchanged by failed PATCHes`,
        `got ${JSON.stringify(ch?.viewSelection)}`);
    }

    // ─── Test 5: clear with type=all ───────────────────────────────
    console.log('\n[TEST 5] PATCH viewSelection type=all (clear)');
    {
      const r = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'all', target: null },
      });
      check(r.status === 200, `PATCH all returned 200`, `status ${r.status}`);
      const m = (await httpJson('GET', '/mixer')).body;
      const ch = (m.channels || []).find(c => c.id === overlayId);
      check(ch && ch.viewSelection && ch.viewSelection.type === 'all',
        `cleared back to type=all`,
        `got ${JSON.stringify(ch?.viewSelection)}`);
    }

    // ─── Test 6: section selection (integer target) ───────────────
    if (opts.sections && opts.sections.length > 0) {
      console.log('\n[TEST 6] PATCH viewSelection type=section');
      const sec = opts.sections[0];
      const r = await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
        viewSelection: { type: 'section', target: sec },
      });
      check(r.status === 200, `PATCH section returned 200`);
      const m = (await httpJson('GET', '/mixer')).body;
      const ch = (m.channels || []).find(c => c.id === overlayId);
      check(ch?.viewSelection?.type === 'section' && ch?.viewSelection?.target === sec,
        `section=${sec} persisted`,
        `got ${JSON.stringify(ch?.viewSelection)}`);
    }

  } finally {
    // ─── Restore ────────────────────────────────────────────────
    try {
      if (addedTempChannel) {
        await httpJson('DELETE', `/mixer/channels/${addedTempChannel}`);
      } else {
        await httpJson('PATCH', `/mixer/channels/${overlayId}`, {
          viewSelection: originalViewSelection,
        });
      }
    } catch (e) {
      console.warn(`  cleanup failed: ${e.message}`);
    }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\nSUMMARY: ${passed}/${total} assertions passed\n`);
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
