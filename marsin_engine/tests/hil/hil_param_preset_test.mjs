/**
 * hil_param_preset_test.mjs — HIL test for round-2 #9: named per-channel
 * parameter presets.
 *
 * Drives the full engine HTTP path for capture → list → recall → delete plus
 * the fail-loud error paths. The capture/recall is exercised against a LIVE
 * channel so we prove the recalled values actually land back on the channel's
 * serialized localControls (the running pattern's params).
 *
 * Scenario:
 *   1. Ensure at least one overlay channel exists (seed one if the mixer is
 *      empty). Pick a writable local-control export on it (kind 1, not CPC-
 *      owned) to drive.
 *   2. Set that export to a known value A via POST /mixer/channels/:id/control.
 *   3. Capture a preset of the channel's params under a name; assert it shows
 *      up in GET /mixer/param-presets with the channel's pattern as its scope.
 *   4. Change the SAME export to a different value B (so recall has work to do).
 *   5. Recall the preset onto the channel; assert GET /mixer reports the
 *      export back at value A (recall took effect on the channel).
 *   6. Error paths: recall unknown preset → 404; recall onto a missing channel
 *      → 404; capture with a malformed name → 400; recall a preset captured on
 *      one pattern onto a channel running a different pattern → 409.
 *   7. Cleanup in finally: delete the test presets, restore the driven export,
 *      remove any seeded overlay.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   ENGINE_PORT=31268 node tests/hil/hil_param_preset_test.mjs
 *   (or: node tests/hil/hil_param_preset_test.mjs --port 31268)
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : (process.env.ENGINE_PORT ? parseInt(process.env.ENGINE_PORT, 10) : 31268);
const BASE = `http://127.0.0.1:${PORT}`;
const PRESET_NAME = 'hil_pp_test';
const MISMATCH_NAME = 'hil_pp_mismatch';

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
function ok(label) { console.log('  PASS  ' + label); results.push(true); }
function fail(label, detail) {
  console.log('  FAIL  ' + label + (detail ? '  -> ' + detail : ''));
  results.push(false);
}
function check(cond, passLabel, failDetail) {
  if (cond) ok(passLabel); else fail(passLabel, failDetail);
}

const getOverlay = (mixer, id) => (mixer?.channels || []).find(c => c.id === id);
const getExport = (ch, id) => (ch?.exports || []).find(e => e.id === id);

async function main() {
  console.log(`\n== HIL: param presets (engine ${BASE}) ==\n`);

  let baseline;
  try {
    baseline = (await httpJson('GET', '/mixer')).body;
  } catch (e) {
    console.error(`Cannot reach engine at ${BASE}: ${e.message}`);
    console.error(`  Start with: node engine.js --pattern test_const --model test_bench --port ${PORT}`);
    return 1;
  }

  const originalOverlayCount = (baseline.channels || []).length;
  const playlists = (await httpJson('GET', '/playlists')).body || [];
  const pl = Array.isArray(playlists) && playlists.length > 0 ? playlists[0] : 'default';

  const addedChannelIds = [];
  let targetChId = null;
  let drivenExportId = null;
  let drivenOrigV0 = null;

  try {
    // ── Ensure at least one overlay with a writable local-control export ──
    if (originalOverlayCount === 0) {
      const add = await httpJson('POST', '/mixer/channels', {
        playlist: pl, name: 'hil_pp_seed', mode: 'blend_screen', fader: 0.6,
      });
      if (add.status !== 200) { console.error(`seed add failed: ${JSON.stringify(add.body)}`); return 1; }
      addedChannelIds.push(add.body.channelId);
      await sleep(50);
    }
    let mixer = (await httpJson('GET', '/mixer')).body;
    const targetCh = mixer.channels[0];
    targetChId = targetCh.id;
    const targetPattern = targetCh.pattern;

    // A writable slider export: kind 1, not CPC-owned (CPC-owned writes are
    // ignored by the engine so they'd make a poor probe).
    const writable = (targetCh.exports || []).find(e => e.kind === 1 && !e.cpcOwned);
    if (!writable) {
      console.error(`channel '${targetChId}' (pattern '${targetPattern}') has no writable kind-1 export to drive`);
      return 1;
    }
    drivenExportId = writable.id;
    drivenOrigV0 = typeof writable.v0 === 'number' ? writable.v0 : 0;

    const VAL_A = 0.27;
    const VAL_B = 0.73;

    // ── 1. Set export to value A ────────────────────────────────────────
    console.log(`[setup] driving export ${drivenExportId} on channel ${targetChId} (pattern ${targetPattern})`);
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/control`, { id: drivenExportId, v0: VAL_A });
      check(r.status === 200, 'set export to value A -> 200', `status ${r.status}`);
      await sleep(50);
      const m = (await httpJson('GET', '/mixer')).body;
      const e = getExport(getOverlay(m, targetChId), drivenExportId);
      check(Math.abs((e?.v0 ?? -1) - VAL_A) < 1e-6, 'export reads value A before capture', `got ${e?.v0}`);
    }

    // ── 2. Capture preset; appears in list with the channel's pattern ───
    console.log('[capture] POST /mixer/channels/:id/param-presets {name}');
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets`, { name: PRESET_NAME });
      check(r.status === 200, 'capture preset -> 200', `status ${r.status} ${JSON.stringify(r.body)}`);
      check(r.body?.pattern === targetPattern, 'capture echoes pattern scope', `got ${r.body?.pattern}`);
      const list = (await httpJson('GET', '/mixer/param-presets')).body?.paramPresets || [];
      const entry = list.find(p => p.name === PRESET_NAME);
      check(!!entry, 'preset appears in GET /mixer/param-presets', `list=${JSON.stringify(list)}`);
      check(entry?.pattern === targetPattern, 'list entry carries pattern scope', `got ${entry?.pattern}`);
    }

    // ── 3. Change export to value B (so recall has to restore A) ────────
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/control`, { id: drivenExportId, v0: VAL_B });
      check(r.status === 200, 'change export to value B -> 200', `status ${r.status}`);
      await sleep(50);
      const m = (await httpJson('GET', '/mixer')).body;
      const e = getExport(getOverlay(m, targetChId), drivenExportId);
      check(Math.abs((e?.v0 ?? -1) - VAL_B) < 1e-6, 'export reads value B before recall', `got ${e?.v0}`);
    }

    // ── 4. Recall preset; export goes back to A on the live channel ─────
    console.log('[recall] POST /mixer/channels/:id/param-presets/:name/recall');
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets/${PRESET_NAME}/recall`);
      check(r.status === 200, 'recall preset -> 200', `status ${r.status} ${JSON.stringify(r.body)}`);
      await sleep(50);
      const m = (await httpJson('GET', '/mixer')).body;
      const e = getExport(getOverlay(m, targetChId), drivenExportId);
      check(Math.abs((e?.v0 ?? -1) - VAL_A) < 1e-6,
        'recall restored export to captured value A on the live channel', `got ${e?.v0}`);
    }

    // ── 5. Error: recall unknown preset -> 404 ──────────────────────────
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets/does_not_exist/recall`);
      check(r.status === 404, 'recall unknown preset -> 404', `status ${r.status}`);
    }

    // ── 6. Error: recall onto a missing channel -> 404 ──────────────────
    {
      const r = await httpJson('POST', `/mixer/channels/ch_does_not_exist/param-presets/${PRESET_NAME}/recall`);
      check(r.status === 404, 'recall onto missing channel -> 404', `status ${r.status}`);
    }

    // ── 7. Error: capture with a malformed name -> 400 ──────────────────
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets`, { name: 'Bad Name!' });
      check(r.status === 400, 'capture with malformed name -> 400', `status ${r.status}`);
    }
    {
      const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets`, { name: '' });
      check(r.status === 400, 'capture with empty name -> 400', `status ${r.status}`);
    }

    // ── 8. Error: pattern mismatch -> 409 ───────────────────────────────
    // Save a preset, then hand-write its pattern scope to a bogus one is not
    // possible via the API, so instead we capture on this channel then add a
    // SECOND channel running a different pattern and try to recall onto it.
    // If no second pattern is available we capture a preset and recall onto a
    // channel whose pattern we know differs by swapping the target's pattern.
    console.log('[mismatch] recall a preset captured on pattern X onto a channel running pattern Y -> 409');
    {
      // Capture the mismatch preset on the current pattern.
      const cap = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets`, { name: MISMATCH_NAME });
      check(cap.status === 200, 'capture mismatch preset -> 200', `status ${cap.status}`);
      // Find a different pattern to swap the channel onto.
      const patterns = (await httpJson('GET', '/patterns')).body || [];
      const names = (Array.isArray(patterns) ? patterns : (patterns.patterns || []))
        .map(p => (typeof p === 'string' ? p : p.name))
        .filter(Boolean);
      const other = names.find(n => n && n !== targetPattern);
      if (!other) {
        console.log('  SKIP  no second pattern available to force a mismatch');
      } else {
        const swap = await httpJson('PATCH', `/mixer/channels/${targetChId}`, { pattern: other });
        check(swap.status === 200, 'swap channel to a different pattern -> 200', `status ${swap.status}`);
        await sleep(50);
        const r = await httpJson('POST', `/mixer/channels/${targetChId}/param-presets/${MISMATCH_NAME}/recall`);
        check(r.status === 409, 'recall onto mismatched pattern -> 409', `status ${r.status} ${JSON.stringify(r.body)}`);
        check(r.body?.code === 'PARAM_PRESET_PATTERN_MISMATCH', 'mismatch carries PARAM_PRESET_PATTERN_MISMATCH code', `got ${r.body?.code}`);
        // Swap the channel back so cleanup restores cleanly.
        await httpJson('PATCH', `/mixer/channels/${targetChId}`, { pattern: targetPattern });
        await sleep(50);
      }
    }

    // ── 9. Delete removes the preset ────────────────────────────────────
    {
      const r = await httpJson('DELETE', `/mixer/param-presets/${PRESET_NAME}`);
      check(r.status === 200, 'delete preset -> 200', `status ${r.status}`);
      const again = await httpJson('DELETE', `/mixer/param-presets/${PRESET_NAME}`);
      check(again.status === 404, 'delete missing preset -> 404', `status ${again.status}`);
      const list = (await httpJson('GET', '/mixer/param-presets')).body?.paramPresets || [];
      check(!list.find(p => p.name === PRESET_NAME), 'deleted preset gone from list', `list=${JSON.stringify(list)}`);
    }
  } catch (e) {
    console.error('Unexpected error:', e);
    results.push(false);
  } finally {
    // Cleanup: delete test presets, restore driven export, remove seeds.
    try { await httpJson('DELETE', `/mixer/param-presets/${PRESET_NAME}`); } catch (_) {}
    try { await httpJson('DELETE', `/mixer/param-presets/${MISMATCH_NAME}`); } catch (_) {}
    if (targetChId && drivenExportId !== null && drivenOrigV0 !== null) {
      try { await httpJson('POST', `/mixer/channels/${targetChId}/control`, { id: drivenExportId, v0: drivenOrigV0 }); } catch (_) {}
    }
    for (const id of addedChannelIds) {
      try { await httpJson('DELETE', `/mixer/channels/${id}`); } catch (_) {}
    }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n== ${passed}/${total} assertions passed ==\n`);
  return passed === total ? 0 : 1;
}

main().then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
