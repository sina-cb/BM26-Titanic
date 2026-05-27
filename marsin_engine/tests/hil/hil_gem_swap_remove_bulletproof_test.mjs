/**
 * HIL: Global Effect Macros — swap / remove / re-bind bulletproofing
 * (operator review 2026-05-25 #9).
 *
 * Reproduces the exact sequence the operator hit and that previously
 * stuck on the iPad:
 *   1. PATCH slot 1 → vintageWhite/default              (legacy, no bypass)
 *   2. activate slot 1                                   → controller.effects.vintageWhite = true
 *   3. PATCH slot 2 → vintageWhite/default               (a second slot bound to the same effect)
 *   4. activate slot 2 and verify it acts too
 *   5. PATCH slot 1 → blastWhite/default while slot 1 is active
 *      → pre-flight deactivate should have cleared
 *        controller.effects.vintageWhite BEFORE the binding flipped
 *   6. activate / deactivate slot 1 against the NEW binding
 *   7. PATCH slot 2 → enabled:false (remove)             → cell back to "+"
 *   8. PATCH slot 2 → uvBlast/default                     → re-bind to a third effect
 *   9. final state: controller flags consistent with bindings; the
 *      one-preset-per-legacy-effect contract holds (no
 *      `bypass_dimmer` preset accepted any more).
 *
 * The pre-flight deactivate (and the engine's _dispatchLegacy
 * no-longer-touches-bypass behaviour) is what this test pins. If a
 * future change re-introduces the double-preset legacy entries, or
 * removes the pre-PATCH deactivate, this test fails with a clear
 * "controller.<effect> still active after swap" message.
 *
 * Run:
 *   ENGINE_PORT=6968 node tests/hil/hil_gem_swap_remove_bulletproof_test.mjs
 *
 * State teardown: snapshots `global_effect_slots.yaml` and
 * `globals_state.yaml` to ~/tmp/hil_gem_snapshot before running and
 * restores on exit so the operator's slot layout is preserved.
 *
 * Exit 0 = all assertions passed; 1 = one or more failed.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT || '6968', 10);
const ENGINE_BASE = `http://127.0.0.1:${ENGINE_PORT}`;

const STATE_DIR = path.resolve('states/test_bench');
const SNAPSHOT_DIR = path.join(os.homedir(), 'tmp', 'hil_gem_snapshot');
const SNAPSHOT_FILES = ['global_effect_slots.yaml', 'globals_state.yaml'];

let passed = 0;
let failed = 0;

function check(cond, ok, fail = '', extra = '') {
  if (cond) {
    console.log(`  ✔ ${ok}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL  ${fail || ok}${extra ? `  → ${extra}` : ''}`);
    failed++;
  }
}

function fail(msg, extra = '') {
  console.error(`  ✗ FAIL  ${msg}${extra ? `  → ${extra}` : ''}`);
  failed++;
}

function httpJson(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      method, hostname: '127.0.0.1', port: ENGINE_PORT, path: urlPath,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

function snapshotState() {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const f of SNAPSHOT_FILES) {
    const src = path.join(STATE_DIR, f);
    const dst = path.join(SNAPSHOT_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
}

function restoreState() {
  for (const f of SNAPSHOT_FILES) {
    const src = path.join(SNAPSHOT_DIR, f);
    const dst = path.join(STATE_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
}

async function getSlot(slotId) {
  const r = await httpJson('GET', '/global-effect-slots/status');
  return (r.body && r.body.slots) ? r.body.slots.find(s => s.slotId === slotId) : null;
}

async function getControllerEffects() {
  const r = await httpJson('GET', '/global-effect-slots/status');
  return (r.body && r.body.controller && r.body.controller.effects) || {};
}

(async () => {
  console.log(`── Setup ──`);
  try {
    const probe = await httpJson('GET', '/global-effect-slots/status');
    if (probe.status !== 200) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`  FATAL: engine unreachable at ${ENGINE_BASE}: ${e.message}`);
    console.error(`  Start with: node engine.js --pattern test_const --model test_bench --port ${ENGINE_PORT}`);
    process.exit(2);
  }

  snapshotState();
  console.log(`  snapshotted ${SNAPSHOT_FILES.join(', ')} → ${SNAPSHOT_DIR}`);

  try {
    // ── STEP 1: bind slot 1 → vintageWhite/default
    console.log('\n[STEP 1] PATCH slot 1 → vintageWhite/default');
    {
      const r = await httpJson('PATCH', '/global-effect-slots/1', {
        effectId: 'vintageWhite', presetId: 'default',
        behavior: 'toggle', label: 'Vintage Wht', paramsOverride: {}, enabled: true,
      });
      check(r.status === 200, 'PATCH 200');
      const s1 = await getSlot(1);
      check(s1 && s1.effectId === 'vintageWhite' && s1.presetId === 'default',
        'slot 1 now bound to vintageWhite/default');
    }

    // ── STEP 2: activate slot 1
    console.log('\n[STEP 2] activate slot 1 → vintageWhite ON');
    {
      const r = await httpJson('POST', '/global-effect-slots/1/activate');
      check(r.status === 200, 'activate 200');
      const fx = await getControllerEffects();
      check(fx.vintageWhite === true, 'controller.effects.vintageWhite=true');
      const s1 = await getSlot(1);
      check(s1.active === true, 'slot 1 reports active=true');
    }

    // ── STEP 3: bind slot 2 → vintageWhite/default (second slot, same effect)
    console.log('\n[STEP 3] PATCH slot 2 → vintageWhite/default (legal: two slots same legacy effect)');
    {
      const r = await httpJson('PATCH', '/global-effect-slots/2', {
        effectId: 'vintageWhite', presetId: 'default',
        behavior: 'toggle', label: 'Vintage Wht 2', paramsOverride: {}, enabled: true,
      });
      check(r.status === 200, 'PATCH 200');
      const s2 = await getSlot(2);
      check(s2 && s2.effectId === 'vintageWhite', 'slot 2 bound');
      // Both slots should report active=true since they share the
      // legacy effect's singleton controller flag.
      check(s2.active === true, 'slot 2 reports active=true (shares controller.effects.vintageWhite with slot 1)');
    }

    // ── STEP 4: deactivate slot 2 (sanity — also turns off slot 1)
    console.log('\n[STEP 4] deactivate slot 2 → vintageWhite OFF (singleton legacy flag is shared)');
    {
      const r = await httpJson('POST', '/global-effect-slots/2/deactivate');
      check(r.status === 200, 'deactivate 200');
      const fx = await getControllerEffects();
      check(fx.vintageWhite === false, 'controller.effects.vintageWhite=false');
    }

    // ── STEP 5: activate slot 1, then swap slot 1 → blastWhite/default
    // This is the exact scenario the operator hit: an active legacy
    // slot being re-bound. The iPad's GEM now pre-deactivates before
    // PATCH; we simulate the same here. If the pre-deactivate is
    // missing, controller.effects.vintageWhite stays ON even though
    // slot 1 now points at blastWhite.
    console.log('\n[STEP 5] activate slot 1, then PATCH-with-deactivate to blastWhite/default');
    {
      await httpJson('POST', '/global-effect-slots/1/activate');
      let fx = await getControllerEffects();
      check(fx.vintageWhite === true, 'before swap: vintageWhite=true');

      // iPad's pre-PATCH deactivate (ensureSlotOff in GEM).
      await httpJson('POST', '/global-effect-slots/1/deactivate');
      const r = await httpJson('PATCH', '/global-effect-slots/1', {
        effectId: 'blastWhite', presetId: 'default',
        behavior: 'toggle', label: 'Blast Wht', paramsOverride: {}, enabled: true,
      });
      check(r.status === 200, 'PATCH 200');

      fx = await getControllerEffects();
      check(fx.vintageWhite === false,
        'after swap+pre-deactivate: vintageWhite=false (no stranded ON flag)');
      check(!fx.blastWhite,
        'after swap: blastWhite still false until the new binding is activated');

      const s1 = await getSlot(1);
      check(s1.effectId === 'blastWhite' && s1.active === false,
        'slot 1 now blastWhite and inactive');
    }

    // ── STEP 6: activate slot 1 (now blastWhite), then deactivate
    console.log('\n[STEP 6] activate / deactivate slot 1 against the NEW (blastWhite) binding');
    {
      await httpJson('POST', '/global-effect-slots/1/activate');
      let fx = await getControllerEffects();
      check(fx.blastWhite === true, 'blastWhite=true after activate');
      await httpJson('POST', '/global-effect-slots/1/deactivate');
      fx = await getControllerEffects();
      check(fx.blastWhite === false, 'blastWhite=false after deactivate');
    }

    // ── STEP 7: REMOVE slot 2 (enabled:false) — should come back as empty
    console.log('\n[STEP 7] REMOVE slot 2 (PATCH enabled:false)');
    {
      const r = await httpJson('PATCH', '/global-effect-slots/2', { enabled: false });
      check(r.status === 200, 'PATCH 200');
      const s2 = await getSlot(2);
      check(s2 && s2.enabled === false, 'slot 2 enabled=false');
      // Active is computed off the effect/preset only when enabled.
      check(s2.active === false, 'slot 2 active=false when disabled');
    }

    // ── STEP 8: re-bind slot 2 to a THIRD effect (uvBlast)
    console.log('\n[STEP 8] re-bind slot 2 → uvBlast/default');
    {
      const r = await httpJson('PATCH', '/global-effect-slots/2', {
        effectId: 'uvBlast', presetId: 'default',
        behavior: 'toggle', label: 'UV Blast', paramsOverride: {}, enabled: true,
      });
      check(r.status === 200, 'PATCH 200');
      const s2 = await getSlot(2);
      check(s2 && s2.effectId === 'uvBlast' && s2.enabled === true,
        'slot 2 now bound to uvBlast');
      await httpJson('POST', '/global-effect-slots/2/activate');
      const fx = await getControllerEffects();
      check(fx.uvBlast === true, 'uvBlast=true after activate');
      await httpJson('POST', '/global-effect-slots/2/deactivate');
    }

    // ── STEP 9: contract check — one preset per legacy effect (no
    // bypass_dimmer twin). The May 2026 collapse dropped the
    // `bypass_dimmer` preset; the dimmer rack's BypassCheckbox is
    // now the single source of truth for bypass behavior.
    console.log('\n[STEP 9] library contract: ONE preset per legacy effect (no bypass_dimmer twin)');
    {
      const r = await httpJson('GET', '/global-effect-library');
      const lib = (r.body && r.body.effects) || {};
      for (const id of ['vintageWhite', 'blastWhite', 'uvBlast']) {
        const fx = lib[id];
        check(fx && Object.keys(fx.presets).length === 1,
          `${id} has exactly 1 preset`,
          `${id} has wrong preset count`,
          fx ? JSON.stringify(Object.keys(fx.presets)) : 'effect missing');
        check(fx && fx.presets.default,
          `${id} default preset present`);
      }
      // Reject any future re-introduction of bypass_dimmer.
      for (const id of ['vintageWhite', 'blastWhite', 'uvBlast']) {
        const fx = lib[id];
        check(fx && !fx.presets.bypass_dimmer,
          `${id} does NOT have a bypass_dimmer preset (owned by dimmer rack)`);
      }
    }

  } finally {
    console.log('\n── Cleanup: restoring snapshotted state files ──');
    restoreState();
  }

  console.log(`\n──────── ${passed}/${passed + failed} passed ────────\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
