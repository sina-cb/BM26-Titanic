/**
 * hil_blackout_estop_test.mjs — HIL coverage for the unified GEM
 * blackout / e-stop contract (May 2026, slot 2 globals_unification).
 *
 * What it asserts end-to-end against a running engine:
 *   1. Activating a slot effect (Ocean Wash) lights up the rig — the
 *      controller status reports the wash enabled.
 *   2. POSTing /global-effect-macros/blackout {enabled:true} engages
 *      the e-stop: pixel-level blackout is set, every active macro is
 *      cleared (wash disabled), and globalsState.blackout is true on
 *      a follow-up GET /globals.
 *   3. POSTing the same endpoint with {enabled:false} releases
 *      blackout. The rig comes back DARK (no surprise wash resuming).
 *   4. The legacy rig-globals now-as-slots (vintageWhite/blastWhite/
 *      uvBlast/fogger) toggle through the slot dispatcher too —
 *      sanity-check one of them so the API contract is exercised end
 *      to end.
 *
 * ── How to Run ────────────────────────────────────────────────────────
 *   Terminal 1 (this slot's port = 31268):
 *     cd marsin_engine
 *     node engine.js --pattern test_const --model test_bench --port 31268
 *
 *   Terminal 2:
 *     cd marsin_engine
 *     ENGINE_PORT=31268 node tests/hil/hil_blackout_estop_test.mjs
 *
 * ── Exit Code ─────────────────────────────────────────────────────────
 *   0 = all assertions passed
 *   1 = one or more assertions failed
 *   2 = setup error (engine unreachable)
 *
 * ── State hygiene ─────────────────────────────────────────────────────
 * Snapshots globals_state.yaml + global_effect_slots.yaml before any
 * mutation, restores them in a finally block. The HIL spec is strict:
 * "after your tests, `git status` inside the worktree should show only
 * your intended diff" (.agent/00_gol/13_multi_agent.md §6.5).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;

const STATE_DIR = path.resolve(__dirname, '..', '..', 'states', 'test_bench');
const GLOBALS_YAML = path.join(STATE_DIR, 'globals_state.yaml');
const SLOTS_YAML   = path.join(STATE_DIR, 'global_effect_slots.yaml');

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
function ok(label)            { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail)  { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, p, f, d) { if (cond) ok(p); else fail(f || p, d); }
function sleep(ms)            { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────── snapshot / restore ──────────────────────
const snapshot = {
  globals: null,
  slots: null,
  taken: false,
};
function takeSnapshot() {
  if (fs.existsSync(GLOBALS_YAML)) snapshot.globals = fs.readFileSync(GLOBALS_YAML);
  if (fs.existsSync(SLOTS_YAML))   snapshot.slots   = fs.readFileSync(SLOTS_YAML);
  snapshot.taken = true;
}
function restoreSnapshot() {
  if (!snapshot.taken) return;
  try {
    if (snapshot.globals !== null) fs.writeFileSync(GLOBALS_YAML, snapshot.globals);
    else if (fs.existsSync(GLOBALS_YAML)) fs.unlinkSync(GLOBALS_YAML);
    if (snapshot.slots !== null) fs.writeFileSync(SLOTS_YAML, snapshot.slots);
    else if (fs.existsSync(SLOTS_YAML)) fs.unlinkSync(SLOTS_YAML);
  } catch (e) {
    console.warn('  restore failed:', e.message);
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    console.error(`\nReceived ${sig}; restoring state files...`);
    restoreSnapshot();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

(async function main() {
  console.log('==========================================================');
  console.log('hil_blackout_estop_test.mjs — unified GEM blackout / e-stop');
  console.log(`  engine: ${ENGINE_BASE}`);
  console.log('==========================================================');

  // Sanity: engine reachable?
  try {
    await httpJson('GET', '/status');
  } catch (e) {
    console.error('  FATAL: engine unreachable at ' + ENGINE_BASE);
    process.exit(2);
  }

  takeSnapshot();

  try {
    // Arrange: the trimmed (operator-facing) global_effect_slots.yaml
    // ships only 6 slots and slot 3 may or may not be Ocean Wash
    // depending on what the operator last saved. Bind it explicitly
    // before TEST 1 so this test pins behaviour, not config. The
    // snapshot/restore around this block puts everything back.
    console.log('\n[ARRANGE] bind slot 3 → colorWash/ocean_blue');
    {
      const r = await httpJson('PATCH', '/global-effect-slots/3', {
        effectId: 'colorWash', presetId: 'ocean_blue',
        behavior: 'toggle', label: 'Ocean Wash', paramsOverride: {}, enabled: true,
      });
      check(r.status === 200, 'arrange: bind slot 3 → 200',
        'arrange failed', JSON.stringify(r.body).slice(0, 200));
    }

    // ── TEST 1: activate Ocean Wash (slot 3) and verify it lights up
    console.log('\n[TEST 1] activate slot 3 (Ocean Wash)');
    {
      const r = await httpJson('POST', '/global-effect-slots/3/activate');
      check(r.status === 200, 'POST /global-effect-slots/3/activate → 200',
        'activate failed', JSON.stringify(r.body).slice(0, 200));
      const status = await httpJson('GET', '/global-effect-slots/status');
      const slot3 = status.body.slots.find(s => s.slotId === 3);
      check(slot3 && slot3.active === true, 'slot 3 reports active=true after activate',
        'slot 3 not active', JSON.stringify(slot3));
      check(status.body.controller && status.body.controller.colorWash
            && status.body.controller.colorWash.enabled === true,
        'controller.colorWash.enabled true after activate');
    }

    // ── TEST 2: POST /global-effect-macros/blackout {enabled:true}
    //    engages e-stop and clears active macros.
    console.log('\n[TEST 2] engage blackout e-stop clears active macros');
    {
      const r = await httpJson('POST', '/global-effect-macros/blackout', { enabled: true });
      check(r.status === 200, 'POST /global-effect-macros/blackout → 200',
        'blackout POST failed', JSON.stringify(r.body).slice(0, 200));
      check(r.body && r.body.blackout === true, 'response.blackout === true');

      const globals = await httpJson('GET', '/globals');
      check(globals.body && globals.body.blackout === true,
        '/globals reports blackout=true after engage');

      const status = await httpJson('GET', '/global-effect-slots/status');
      const slot3 = status.body.slots.find(s => s.slotId === 3);
      check(slot3 && slot3.active === false,
        'slot 3 reports active=false after blackout (panic-stop cleared the wash)',
        'slot 3 still active after blackout',
        JSON.stringify(slot3));
      check(status.body.controller && status.body.controller.colorWash
            && status.body.controller.colorWash.enabled === false,
        'controller.colorWash.enabled false after blackout');
    }

    // ── TEST 3: release blackout returns rig to DARK (no surprise resume)
    console.log('\n[TEST 3] release blackout leaves macros dark');
    {
      const r = await httpJson('POST', '/global-effect-macros/blackout', { enabled: false });
      check(r.status === 200 && r.body && r.body.blackout === false,
        'POST /global-effect-macros/blackout {false} → 200, blackout=false');
      const globals = await httpJson('GET', '/globals');
      check(globals.body && globals.body.blackout === false,
        '/globals reports blackout=false after release');
      const status = await httpJson('GET', '/global-effect-slots/status');
      const slot3 = status.body.slots.find(s => s.slotId === 3);
      check(slot3 && slot3.active === false,
        'slot 3 still inactive after release (no auto-resume)',
        'slot 3 unexpectedly resumed after blackout release');
    }

    // ── TEST 4: legacy effects routed through slot dispatcher
    console.log('\n[TEST 4] legacy effect slot (slot 7 = Vintage Wht) toggles via dispatcher');
    {
      // May 2026: the operator-visible slot count was capped at 6 and
      // the legacy migrated effects (vintageWhite/blastWhite/uvBlast/
      // fogger) are no longer bound by default — they're available in
      // the engine library and an operator binds them via the swap
      // sheet. To keep this regression test honest we ARRANGE the
      // binding ourselves: PATCH slot 1 to vintageWhite, run the
      // toggle assertion, then leave the slot as-is (the cleanup
      // restores the original YAML so the next test boot starts
      // clean).
      let before = await httpJson('GET', '/global-effect-slots/status');
      let vintage = before.body.slots.find(s => s.effectId === 'vintageWhite');
      if (!vintage) {
        const targetSlot = before.body.slots[0]?.slotId ?? 1;
        const patch = await httpJson('PATCH', `/global-effect-slots/${targetSlot}`, {
          effectId: 'vintageWhite', presetId: 'default',
          behavior: 'toggle', label: 'Vintage Wht', paramsOverride: {}, enabled: true,
        });
        check(patch.status === 200, `arrange: bind vintageWhite to slot ${targetSlot} → 200`);
        before = await httpJson('GET', '/global-effect-slots/status');
        vintage = before.body.slots.find(s => s.effectId === 'vintageWhite');
      }
      if (!vintage) {
        fail('no vintageWhite slot in config after PATCH', 'slot manager refused legacy effect bind');
      } else {
        const r1 = await httpJson('POST', `/global-effect-slots/${vintage.slotId}/activate`);
        check(r1.status === 200, `activate slot ${vintage.slotId} (vintageWhite) → 200`);
        const after = await httpJson('GET', '/global-effect-slots/status');
        const vAfter = after.body.slots.find(s => s.slotId === vintage.slotId);
        check(vAfter && vAfter.active === true,
          'vintageWhite slot active=true after activate',
          'vintageWhite still inactive', JSON.stringify(vAfter));

        // Roll back: e-stop clears it.
        await httpJson('POST', '/global-effect-macros/blackout', { enabled: true });
        await sleep(50);
        await httpJson('POST', '/global-effect-macros/blackout', { enabled: false });
        const final = await httpJson('GET', '/global-effect-slots/status');
        const vFinal = final.body.slots.find(s => s.slotId === vintage.slotId);
        check(vFinal && vFinal.active === false,
          'vintageWhite slot inactive after blackout cycle');
      }
    }

    // ── TEST 5: panic-stop endpoint still works (regression guard)
    console.log('\n[TEST 5] /global-effect-macros/panic-stop still functional');
    {
      await httpJson('POST', '/global-effect-slots/3/activate');
      await sleep(20);
      const r = await httpJson('POST', '/global-effect-macros/panic-stop');
      check(r.status === 200, 'POST /global-effect-macros/panic-stop → 200');
      const status = await httpJson('GET', '/global-effect-slots/status');
      const slot3 = status.body.slots.find(s => s.slotId === 3);
      check(slot3 && slot3.active === false,
        'slot 3 inactive after panic-stop');
    }

  } finally {
    // Always restore state files even on test failure.
    console.log('\n── Cleanup: restoring state files ──');
    restoreSnapshot();
  }

  const passed = results.filter(Boolean).length;
  const total  = results.length;
  console.log(`\n──────── ${passed}/${total} passed ────────`);
  process.exit(passed === total ? 0 : 1);
})().catch(err => {
  console.error('FATAL:', err);
  restoreSnapshot();
  process.exit(2);
});
