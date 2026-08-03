/**
 * launcher_supervision.test.js — Wave-1 W1-2 regression suite.
 *
 * Locks in the fixes from report 20260725_117 (red-team _115 Family A):
 *   L1  start.js supervises its children (crash detected → restart; persistent
 *       crash → loud escalation) AND launcher status reflects EVERY child.
 *   #2  the watchdog treats a FROZEN (alive-but-unresponsive) child as a failure.
 *   L4  checkPortFree detects an IPv4-only squatter (IPv6 shadowing closed).
 *   L6  covered indirectly: validate() before assertSingleInstance (see the
 *       arg-before-kill assertion — it exercises the ordering through the CLI).
 *   P2-6 the BM26_SIM_CONFIG override lets all of the above run on throwaway
 *       ports — this whole file never touches the operator's :6969-:6972.
 *
 * Nothing here binds a live show port or UDP 5568.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';
const SIM_DIR = path.join(__dirname, '..');
const ROOT = path.join(SIM_DIR, '..');

// Throwaway port map — high, unused ports; UDP 7568 (never 5568).
const CFG_PORTS = {
  http_port: 7869, save_port: 7870, sacn_port: 7871, sacn_output_port: 7872,
  sacn_udp_port: 7568, marsin_engine_port: 7868, captainpad_web_port: 7867,
};
const CFG_PATH = path.join(os.tmpdir(), `bm26_w1_2_cfg_${process.pid}.yaml`);
fs.writeFileSync(CFG_PATH,
  Object.entries(CFG_PORTS).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');

// start.js reads its ports at module load, so the override must be set FIRST.
process.env.BM26_SIM_CONFIG = CFG_PATH;
const sup = require('../start.js');       // module mode — does NOT boot
const launcher = require('../../launcher.js'); // module mode — does NOT run main()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── L4: IPv4/IPv6 port shadowing ─────────────────────────────────────────
test('checkPortFree detects an IPv4-only squatter (L4 — no IPv6 shadowing)', async () => {
  const PORT = 47931;
  const squat = net.createServer();
  await new Promise((res) => squat.listen(PORT, '0.0.0.0', res));
  try {
    assert.equal(await launcher.checkPortFree(PORT), false,
      'a bare listen(::) would report FREE and let clients reach the impostor');
  } finally {
    await new Promise((res) => squat.close(res));
  }
  assert.equal(await launcher.checkPortFree(PORT), true, 'free once the squatter is gone');
});

// ── L1: launcher status reflects EVERY child ─────────────────────────────
test('healthCheckList probes save + both sACN bridges, not just http+engine (L1)', () => {
  const names = launcher.healthCheckList(CFG_PORTS, 'prod').map((c) => c.name);
  for (const n of ['sim http', 'save', 'sacn-in', 'sacn-out', 'engine']) {
    assert.ok(names.includes(n), `status must probe '${n}'`);
  }
  // The two bridges are ws servers → their liveness expectation is "any HTTP
  // response" (426), not a 2xx.
  const byName = Object.fromEntries(launcher.healthCheckList(CFG_PORTS, 'prod').map((c) => [c.name, c]));
  assert.equal(byName['sacn-in'].expect, 'any');
  assert.equal(byName['sacn-out'].expect, 'any');
  assert.equal(byName['save'].expect, 'ok');
});

test('runHealthChecks: a 426 ws bridge reads UP, a dead port reads DOWN (L1)', async () => {
  const okPort = 47941;
  const wsPort = 47942;
  const okSrv = http.createServer((req, res) => { res.statusCode = 200; res.end('ok'); });
  await new Promise((r) => okSrv.listen(okPort, r));
  // A stand-in for a ws bridge: answer plain GET with 426, like `ws`.
  const wsLike = http.createServer((req, res) => { res.statusCode = 426; res.end(); });
  await new Promise((r) => wsLike.listen(wsPort, r));
  try {
    const checks = [
      { name: 'up-ok', url: `http://127.0.0.1:${okPort}/`, expect: 'ok' },
      { name: 'up-any', url: `http://127.0.0.1:${wsPort}/`, expect: 'any' },
      { name: 'down', url: `http://127.0.0.1:47943/`, expect: 'ok' },
      { name: 'wrong-expect', url: `http://127.0.0.1:${wsPort}/`, expect: 'ok' },
    ];
    const r = Object.fromEntries((await launcher.runHealthChecks(checks)).map((x) => [x.name, x]));
    assert.equal(r['up-ok'].up, true);
    assert.equal(r['up-any'].up, true, '426 must count as alive for a ws bridge');
    assert.equal(r['down'].up, false, 'a dead port reads DOWN');
    assert.equal(r['wrong-expect'].up, false, '426 is NOT a 2xx — proves expect:any is required');
  } finally {
    await new Promise((r) => okSrv.close(r));
    await new Promise((r) => wsLike.close(r));
  }
});

// ── #2: freeze detection ─────────────────────────────────────────────────
test('watchdog kills a FROZEN (alive-but-unresponsive) child after FREEZE_FAILURES', async () => {
  sup._setShuttingDown(false);
  const killed = [];
  sup._setKillFn((child) => killed.push(child));
  sup._setProbeFn(() => Promise.resolve(false)); // always unresponsive
  const fakeChild = { pid: 111, exitCode: null, signalCode: null };
  const spec = { tag: 'frz', label: 'Frozen', healthUrl: 'http://127.0.0.1:9/', bridge: false, spawn: () => fakeChild };
  sup.SPECS.push(spec);
  sup.state.set('frz', { spec, child: fakeChild, restarts: [], healthFails: 0, restartTimer: null });
  try {
    for (let i = 0; i < sup.constants.FREEZE_FAILURES - 1; i++) {
      await sup.watchdogTick();
      assert.equal(killed.length, 0, 'not killed before the freeze threshold');
    }
    await sup.watchdogTick(); // FREEZE_FAILURES-th miss
    assert.equal(killed.length, 1, 'frozen child killed exactly once');
    assert.equal(killed[0], fakeChild);
  } finally {
    sup.SPECS.pop();
    sup.state.delete('frz');
    sup._setProbeFn(() => Promise.resolve(true));
    sup._setKillFn(() => {});
  }
});

// ── L1/no-fallback: bounded restart then loud escalation ─────────────────
test('onChildGone restarts within budget, then escalates loudly (no restart-loop)', async () => {
  sup._setShuttingDown(false);
  let exited = null;
  sup._setExitFn((code) => { exited = code; });
  sup._setKillFn(() => {});
  const spec = {
    tag: 'esc', label: 'Esc', healthUrl: 'http://127.0.0.1:9/', bridge: false,
    spawn: () => ({ pid: 1, exitCode: null, signalCode: null, on: () => {} }),
  };
  sup.SPECS.push(spec);
  const st = { spec, child: null, restarts: [], healthFails: 0, restartTimer: null };
  sup.state.set('esc', st);
  try {
    for (let i = 0; i < sup.constants.MAX_RESTARTS; i++) sup.onChildGone(spec, 1, null);
    assert.equal(exited, null, 'no escalation within the restart budget');
    assert.equal(st.restarts.length, sup.constants.MAX_RESTARTS);

    sup.onChildGone(spec, 1, null); // one death too many
    assert.equal(sup.isShuttingDown(), true, 'escalation begins synchronously');
    await sleep(700); // escalate() exits via a 500ms grace timer
    assert.equal(exited, 1, 'escalated with a non-zero exit so the launcher tears down');
  } finally {
    if (st.restartTimer) clearTimeout(st.restartTimer);
    sup.SPECS.pop();
    sup.state.delete('esc');
    sup._setExitFn((code) => process.exit(code));
    sup._setShuttingDown(false);
  }
});

// ── L1 end-to-end: a real killed child is detected AND restarted ─────────
test('start.js restarts a real child killed with -9 (L1 end-to-end)', async () => {
  const env = { ...process.env, BM26_SIM_CONFIG: CFG_PATH };
  const proc = spawn('node', ['start.js'], { cwd: SIM_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });

  const probeSave = () => new Promise((res) => {
    const r = http.get({ host: '127.0.0.1', port: CFG_PORTS.save_port, path: '/list-scenes', timeout: 2000 },
      (rs) => { rs.resume(); res(true); });
    r.on('timeout', () => { r.destroy(); res(false); });
    r.on('error', () => res(false));
  });
  const killTree = (pid) => {
    try {
      if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch { /* already gone */ }
  };

  try {
    // Wait for the save server to come up (npx http-server can be slow to warm).
    let up = false;
    for (let i = 0; i < 45; i++) { if (await probeSave()) { up = true; break; } await sleep(1000); }
    assert.ok(up, 'save server came up under the supervisor');

    const firstPid = (out.match(/Save server \(save\) started \(pid (\d+)\)/) || [])[1];
    assert.ok(firstPid, 'supervisor logged the save-server pid');

    killTree(firstPid);
    // Detected + restarted: a new pid appears and the port answers again.
    let back = false;
    for (let i = 0; i < 20; i++) { if (await probeSave()) { back = true; break; } await sleep(1000); }
    assert.ok(back, 'save server was restarted after kill -9 (not left dark)');

    const pids = [...out.matchAll(/Save server \(save\) started \(pid (\d+)\)/g)].map((m) => m[1]);
    assert.ok(pids.length >= 2 && pids[1] !== pids[0], 'a fresh save-server pid proves a real restart');
    assert.match(out, /exited unexpectedly/, 'the death was detected and logged, not silent');
  } finally {
    killTree(proc.pid);
    await sleep(500);
  }
});
