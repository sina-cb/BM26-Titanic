// End-to-end: spawn a REAL engine and prove the deliberate same-scene model
// reload (`POST /scene/reload`, report `_33` §5 step 4) behaves — the refusals
// leave the engine untouched, and the accepted reload restarts through the ONE
// sanctioned path (graceful shutdown → supervisor handoff → exit 75).
//
// ISOLATION (non-negotiable — the operator's live stack must not be touched):
//   • the API port is an OS-ASSIGNED free port (bind :0, read it, release it),
//     never the show ports 6966-6972;
//   • `--dest 127.0.0.9` black-holes sACN, so no frame can reach the live sim
//     bridge on 127.0.0.1:5568. That is the WHOLE output path now: the engine's
//     per-controller direct-to-hardware routing is removed and refused at boot
//     (lib/output_config_guard.js), so `--dest` can no longer be bypassed;
//   • MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirect every state write into
//     throwaway temp dirs (tracked states/ tree is snapshot-compared below).
//
// The engine runs SUPERVISED (BM26_SUPERVISED=1 + BM26_SCENE_SWITCH_FILE), the
// mode the show uses: the engine hands the restart to its launcher and exits
// 75 instead of self-spawning. That is also what keeps this test orphan-free —
// there is no launcher here, so nothing respawns and no stray engine is left
// holding a port. The standalone (unsupervised) branch self-respawns detached;
// that is pre-existing POST /scene behaviour, unchanged by this endpoint, and
// is covered at the decision level in scene_reload_decision.test.js.
//
// Run:  node --test tests/state/scene_reload_api.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, '..', '..');
// Quarantined non-BM scene (same one performance_mode.test.js uses). Its model
// patches universes 2-6 + 20 — none of them the U10/U12 pair config.yaml routes
// to the LED controller — so nothing here can address real hardware.
const SCENE = 'summer_camp_dome';

// Show ports that must never be bound by a test engine (bm26-port-topology).
const SHOW_PORTS = new Set([5568, 6966, 6967, 6968, 6969, 6970, 6971, 6972]);

// Captured at module load — before any engine is spawned. Used by the
// tracked-tree guard at the bottom.
const TEST_START_MS = Date.now();

/** Ask the OS for a free port: bind :0, read the assignment, release it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

const handoffFile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-reload-handoff-')),
  'scene_switch.json',
);

let h = null;
let port = null;
let exitInfo = null; // { code, signal } once the engine exits

before(async () => {
  port = await freePort();
  assert.ok(!SHOW_PORTS.has(port), `OS handed out a show port (${port}) — aborting`);
  h = createEngineHarness({
    scene: SCENE,
    pattern: '13_sparkle',
    prefix: 'marsin-scene-reload',
    // portSpan 1 ⇒ the harness uses exactly the OS-assigned port.
    portBase: port,
    portSpan: 1,
    extraArgs: ['--dest', '127.0.0.9'],
    extraEnv: {
      BM26_SUPERVISED: '1',
      BM26_SCENE_SWITCH_FILE: handoffFile,
    },
  });
  const proc = h.spawnEngine();
  proc.on('exit', (code, signal) => { exitInfo = { code, signal }; });
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
  // Nothing may still be listening on the test port: a leaked engine would
  // keep rendering and sending. Fail loudly rather than leave an orphan.
  const stillUp = await fetch(`http://127.0.0.1:${port}/status`)
    .then(() => true).catch(() => false);
  assert.equal(stillUp, false, `an engine is STILL listening on ${port} — orphan leaked`);
});

// ── Refusals: the engine must survive every one of them ──────────────────

test('POST /scene with the ACTIVE scene stays a no-op and points at /scene/reload', async () => {
  const r = await h.api('POST', '/scene', { scene: SCENE });
  assert.equal(r.status, 200);
  assert.equal(r.data.restarting, false);
  assert.equal(r.data.activeModel, SCENE);
  assert.match(r.data.hint, /\/scene\/reload/);
  assert.equal(typeof r.data.modelStale, 'boolean');
});

test('reload REFUSES a scene that is not the active one (409) and keeps running', async () => {
  const r = await h.api('POST', '/scene/reload', { scene: 'test_bench' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'SCENE_MISMATCH');
  assert.equal(r.data.activeModel, SCENE);

  const status = await h.api('GET', '/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.activeModel, SCENE);
  assert.equal(exitInfo, null, 'a refused reload must not restart the engine');
});

test('reload REFUSES a body with no scene (400) and keeps running', async () => {
  const r = await h.api('POST', '/scene/reload', {});
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'SCENE_REQUIRED');
  assert.equal(exitInfo, null);
});

test('reload REFUSES a traversal name (400) and keeps running', async () => {
  const r = await h.api('POST', '/scene/reload', { scene: '../evil' });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'INVALID_SCENE');
  assert.equal(exitInfo, null);
});

test('reload is LOCKED in performance mode (409) — a show is never restarted', async () => {
  const enter = await h.api('POST', '/performance-mode', { active: true });
  assert.equal(enter.status, 200);

  const r = await h.api('POST', '/scene/reload', { scene: SCENE });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'PERFORMANCE_MODE');
  assert.equal(exitInfo, null, 'performance mode must block the restart outright');

  const status = await h.api('GET', '/status');
  assert.equal(status.data.activeModel, SCENE);

  const exit = await h.api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  assert.equal(exit.status, 200);
});

// ── The accepted reload (LAST — it takes the engine down) ─────────────────

test('reload of the ACTIVE scene restarts via the exit-75 supervisor handoff', async () => {
  const r = await h.api('POST', '/scene/reload', { scene: SCENE });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'ok');
  assert.equal(r.data.restarting, true);
  assert.equal(r.data.scene, SCENE);
  assert.equal(r.data.activeModel, SCENE);
  assert.equal(r.data.supervised, true);
  assert.equal(r.data.mode, 'supervised-handoff');
  assert.equal(typeof r.data.modelStale, 'boolean');

  // The engine acks first, then shuts down gracefully and exits 75
  // (EX_TEMPFAIL = INTENTIONAL restart, not a crash).
  const t0 = Date.now();
  while (!exitInfo && Date.now() - t0 < 20000) {
    await new Promise(res => setTimeout(res, 200));
  }
  assert.ok(exitInfo, 'engine never exited after an accepted reload');
  assert.equal(exitInfo.code, 75, `expected exit 75, got ${JSON.stringify(exitInfo)}`);

  // …and it handed the SAME scene to its supervisor — the launcher relaunches
  // this exact model. No second engine, no scene substitution.
  assert.ok(fs.existsSync(handoffFile), 'no scene handoff file written');
  assert.deepEqual(JSON.parse(fs.readFileSync(handoffFile, 'utf8')), { scene: SCENE });
});

test('the spawned engine never wrote into the tracked states/ tree', () => {
  // MARSIN_STATE_DIR redirects every state write into a temp dir; prove it by
  // showing no file in the tracked scene dir was modified since this module
  // loaded (i.e. since before the engine was spawned).
  const tracked = path.join(engineDir, 'states', SCENE);
  if (!fs.existsSync(tracked)) return; // nothing to protect
  for (const f of fs.readdirSync(tracked, { recursive: true })) {
    const p = path.join(tracked, String(f));
    if (!fs.statSync(p).isFile()) continue;
    assert.ok(
      fs.statSync(p).mtimeMs < TEST_START_MS,
      `spawned engine wrote into the tracked tree: ${p}`,
    );
  }
});
