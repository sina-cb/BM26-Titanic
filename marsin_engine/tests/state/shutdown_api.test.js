// End-to-end: spawn a REAL engine and prove `POST /shutdown` runs the engine's
// own graceful shutdown — the one that sends the blackout frame — instead of
// leaving the rig frozen on its last live frame.
//
// Why this exists (report 20260805_160 T1, fixed in _169): `launcher.js stop`
// force-kills the process tree; on Windows that is `taskkill /T /F`
// (TerminateProcess), so the engine's SIGTERM handler never ran and the
// shutdown blackout at engine.js §8 was never sent — while
// `.agent/ops/show_server_ops.md` and `deploy/README.md` promise
// "lights OFF … before generator work". `POST /shutdown` is the in-band reach
// into that same handler; the launcher calls it before the kill.
//
// ISOLATION (non-negotiable — the operator's live stack must not be touched):
//   • the API port is an OS-ASSIGNED free port (bind :0, read it, release it),
//     never the show ports 6966-6972;
//   • `--dest 127.0.0.9` black-holes sACN, so the blackout frame this test
//     provokes cannot reach the live sim bridge on 127.0.0.1:5568;
//   • MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirect every state write into
//     throwaway temp dirs.
//
// Run:  node --test tests/state/shutdown_api.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

// Quarantined non-BM scene (the same one scene_reload_api/performance_mode
// use) — its model patches no universe config.yaml routes to real hardware.
const SCENE = 'summer_camp_dome';
const SHOW_PORTS = new Set([5568, 6966, 6967, 6968, 6969, 6970, 6971, 6972]);

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

let h = null;
let out = '';
let exitInfo = null; // { code, signal } once the engine exits

before(async () => {
  const port = await freePort();
  assert.ok(!SHOW_PORTS.has(port), `OS handed out a show port (${port}) — aborting`);
  h = createEngineHarness({
    scene: SCENE,
    pattern: '13_sparkle',
    prefix: 'marsin-shutdown',
    portBase: port,
    portSpan: 1,          // ⇒ exactly the OS-assigned port
    extraArgs: ['--dest', '127.0.0.9'],
  });
  const proc = h.spawnEngine();
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', d => { out += d.toString(); });
  proc.on('exit', (code, signal) => { exitInfo = { code, signal }; });
  await h.waitForReady();
});

after(async () => { if (h) await h.teardown(); });

test('REFUSES an unconfirmed shutdown, loudly, and keeps running', async () => {
  const res = await h.api('POST', '/shutdown', {});
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'CONFIRM_REQUIRED');
  assert.equal(exitInfo, null, 'a refused shutdown must not stop the show');
  const status = await h.api('GET', '/status');
  assert.equal(status.status, 200, 'the engine is still serving after the refusal');
});

test('a confirmed shutdown runs the blackout path and exits cleanly', async () => {
  const res = await h.api('POST', '/shutdown', { confirm: true });
  assert.equal(res.status, 200);
  assert.equal(res.data.shuttingDown, true);
  assert.equal(res.data.blackout, true);

  const t0 = Date.now();
  while (exitInfo === null && Date.now() - t0 < 15000) {
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(exitInfo, 'the engine exited on its own — no kill was needed');
  assert.equal(exitInfo.code, 0, 'clean exit, not a crash and not a scene-switch 75');
  // The engine prints these around the blackout: "Stopping..." enters
  // shutdown(), "Shutdown complete" is printed from finish(), which only runs
  // after sacnOut.sendFrame(blackBuffers) settles. Both present ⇒ the blackout
  // path executed, which is exactly what the force-kill used to skip.
  assert.match(out, /Stopping\.\.\./, 'entered the graceful shutdown');
  assert.match(out, /Shutdown complete/, 'reached the post-blackout completion');
});
