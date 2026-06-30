/**
 * hil_snapshot_morph_test.mjs — HIL test for round-2 #1
 * SNAPSHOT CROSSFADE / MORPH (docs/39 §10.8).
 *
 * Recall a saved look by RAMPING current→target over durationMs (vs the
 * instant cut /recall does). Engine path: POST /mixer/snapshots/:name/recall-fade
 * { durationMs }.
 *
 * Scenario:
 *   1. Build a known "target" look (set master + channel fader), capture it.
 *   2. Move the live mix AWAY from the target (different master + fader).
 *   3. POST recall-fade {durationMs}; assert 200 + an active morph in the body.
 *   4. Mid-fade: master + the channel fader are ramping MONOTONICALLY toward
 *      the target (strictly between start and target, moving the right way).
 *   5. After durationMs: the mix CONVERGED to the target — and EQUALS an
 *      instant recall of the SAME snapshot EXACTLY (master + per-channel
 *      faders match within tight tolerance).
 *   6. Error paths: unknown name → 404; durationMs<=0 → 400; non-finite → 400;
 *      missing durationMs → 400.
 *   7. Cleanup in finally: delete the test snapshot, restore master + overlays.
 *
 * ── Prerequisites ─────────────────────────────────────────────────────
 *   node engine.js --pattern test_const --model test_bench --port 31268
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   node tests/hil/hil_snapshot_morph_test.mjs [--port 31268]
 *
 * Exit code: 0 = all assertions passed; 1 = one or more failed.
 */

import http from 'http';

const portIdx = process.argv.indexOf('--port');
const PORT = portIdx !== -1 && process.argv[portIdx + 1]
  ? parseInt(process.argv[portIdx + 1], 10)
  : 31268;
const BASE = `http://127.0.0.1:${PORT}`;
const SNAP_NAME = 'hil_morph_target';

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
function check(cond, passLabel, failDetail) {
  if (cond) ok(passLabel); else fail(passLabel, failDetail);
}

async function getMixer() { return (await httpJson('GET', '/mixer')).body; }

async function main() {
  console.log(`\n== HIL: snapshot_morph (engine ${BASE}) ==\n`);

  let baseline;
  try {
    baseline = await getMixer();
  } catch (e) {
    console.error(`Cannot reach engine at ${BASE}: ${e.message}`);
    console.error(`  Start with: node engine.js --pattern test_const --model test_bench --port ${PORT}`);
    return 1;
  }

  const originalOverlayCount = (baseline.channels || []).length;
  const originalMaster = baseline.master;
  const playlists = (await httpJson('GET', '/playlists')).body || [];
  const pl = Array.isArray(playlists) && playlists.length > 0 ? playlists[0] : 'default';
  const addedChannelIds = [];

  try {
    // ── Ensure at least one overlay to ramp ─────────────────────────────
    if (originalOverlayCount === 0) {
      const add = await httpJson('POST', '/mixer/channels', {
        playlist: pl, name: 'hil_morph_seed', mode: 'blend_screen', fader: 0.5,
      });
      if (add.status !== 200) { console.error(`seed add failed: ${JSON.stringify(add.body)}`); return 1; }
      addedChannelIds.push(add.body.channelId);
      await sleep(50);
    }

    // ── 1. Build a known TARGET look + capture ───────────────────────────
    console.log('[setup] build + capture target look (master 0.9, ch fader 0.8)');
    let mixer = await getMixer();
    const chId = mixer.channels[0].id;
    const TARGET_MASTER = 0.9;
    const TARGET_FADER = 0.8;
    await httpJson('PATCH', '/mixer', { master: TARGET_MASTER });
    await httpJson('PATCH', `/mixer/channels/${chId}`, { fader: TARGET_FADER, enabled: true });
    await sleep(50);
    const cap = await httpJson('POST', '/mixer/snapshots', { name: SNAP_NAME });
    check(cap.status === 200, 'capture target snapshot → 200', `status ${cap.status} ${JSON.stringify(cap.body)}`);

    // ── 2. Move the live mix AWAY from the target ────────────────────────
    console.log('[setup] move live mix away (master 0.1, ch fader 0.1)');
    const START_MASTER = 0.1;
    const START_FADER = 0.1;
    await httpJson('PATCH', '/mixer', { master: START_MASTER });
    await httpJson('PATCH', `/mixer/channels/${chId}`, { fader: START_FADER });
    await sleep(50);

    // ── 3. recall-fade kickoff ───────────────────────────────────────────
    console.log('\n[morph] POST recall-fade { durationMs: 1500 }');
    const DUR = 1500;
    const kick = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall-fade`, { durationMs: DUR });
    check(kick.status === 200, 'recall-fade → 200', `status ${kick.status} ${JSON.stringify(kick.body)}`);
    check(kick.body?.morph?.active === true, 'response reports an active morph', JSON.stringify(kick.body?.morph));

    // ── 4. Mid-fade: master + fader ramping monotonically toward target ──
    await sleep(450);
    const mid = await getMixer();
    const midCh = (mid.channels || []).find(c => c.id === chId) || mid.channels[0];
    check(mid.master > START_MASTER + 0.02 && mid.master < TARGET_MASTER - 0.02,
      `mid-fade master ramping up toward target (got ${mid.master})`);
    check(midCh && midCh.fader > START_FADER + 0.02 && midCh.fader < TARGET_FADER - 0.02,
      `mid-fade channel fader ramping up toward target (got ${midCh?.fader})`);

    // Second mid sample to confirm MONOTONIC progress (still rising).
    await sleep(400);
    const mid2 = await getMixer();
    const mid2Ch = (mid2.channels || []).find(c => c.id === chId) || mid2.channels[0];
    check(mid2.master >= mid.master - 1e-6, `master monotonic up (${mid.master} → ${mid2.master})`);
    check(mid2Ch && mid2Ch.fader >= midCh.fader - 1e-6,
      `fader monotonic up (${midCh.fader} → ${mid2Ch.fader})`);

    // ── 5. After durationMs: converged to target ─────────────────────────
    await sleep(900); // total > DUR + finalizer margin
    const settled = await getMixer();
    const settledCh = (settled.channels || []).find(c => c.id === chId) || settled.channels[0];
    check(Math.abs(settled.master - TARGET_MASTER) < 0.01,
      `morph converged: master ≈ target ${TARGET_MASTER} (got ${settled.master})`);
    check(settledCh && Math.abs(settledCh.fader - TARGET_FADER) < 0.01,
      `morph converged: ch fader ≈ target ${TARGET_FADER} (got ${settledCh?.fader})`);

    // ── 5b. EQUALS an instant recall of the SAME snapshot EXACTLY ─────────
    console.log('\n[morph] settled mix EQUALS an instant recall of the target');
    // Capture the morph-settled mix, then instant-recall the same snapshot and
    // compare master + per-channel faders. They must match.
    const morphSettled = {
      master: settled.master,
      faders: (settled.channels || []).map(c => ({ id: c.id, fader: c.fader })),
    };
    const rec = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall`);
    check(rec.status === 200, 'instant recall of same snapshot → 200', `status ${rec.status}`);
    await sleep(100);
    const instant = await getMixer();
    check(Math.abs(instant.master - morphSettled.master) < 0.01,
      `master matches: morph ${morphSettled.master} == instant ${instant.master}`);
    // Match overlay count + each fader (instant recall rebuilds overlays in
    // the same order the morph landed on, since both apply the same look).
    check((instant.channels || []).length === morphSettled.faders.length,
      `overlay count matches (${morphSettled.faders.length})`,
      `morph ${morphSettled.faders.length} vs instant ${(instant.channels || []).length}`);
    let allFadersMatch = true;
    for (let i = 0; i < (instant.channels || []).length; i++) {
      const a = morphSettled.faders[i];
      const b = instant.channels[i];
      if (!a || !b || Math.abs(a.fader - b.fader) > 0.01) { allFadersMatch = false; break; }
    }
    check(allFadersMatch, 'every channel fader matches instant recall (lands exactly on target look)');

    // ── 6. Error paths ───────────────────────────────────────────────────
    console.log('\n[morph] error paths');
    const e404 = await httpJson('POST', '/mixer/snapshots/does_not_exist/recall-fade', { durationMs: 1000 });
    check(e404.status === 404, 'recall-fade unknown snapshot → 404', `status ${e404.status}`);
    const eZero = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall-fade`, { durationMs: 0 });
    check(eZero.status === 400, 'recall-fade durationMs=0 → 400', `status ${eZero.status}`);
    const eNeg = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall-fade`, { durationMs: -5 });
    check(eNeg.status === 400, 'recall-fade durationMs=-5 → 400', `status ${eNeg.status}`);
    const eNaN = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall-fade`, { durationMs: 'oops' });
    check(eNaN.status === 400, 'recall-fade durationMs="oops" → 400', `status ${eNaN.status}`);
    const eMissing = await httpJson('POST', `/mixer/snapshots/${SNAP_NAME}/recall-fade`, {});
    check(eMissing.status === 400, 'recall-fade missing durationMs → 400', `status ${eMissing.status}`);

  } finally {
    try {
      await httpJson('DELETE', `/mixer/snapshots/${SNAP_NAME}`);
      if (typeof originalMaster === 'number') {
        await httpJson('PATCH', '/mixer', { master: originalMaster });
      }
      const current = await getMixer();
      const overlays = current.channels || [];
      for (let i = overlays.length - 1; i >= originalOverlayCount; i--) {
        await httpJson('DELETE', `/mixer/channels/${overlays[i].id}`);
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
