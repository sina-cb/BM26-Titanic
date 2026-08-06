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

// ── _169: `stop` must black the rig out BEFORE the force-kill ────────────
// Report 20260805_160 T1: `stop` force-kills the process tree (Windows
// `taskkill /T /F`), so the engine's SIGTERM handler — the only emitter of the
// shutdown blackout frame — never ran and the rig held its last live frame,
// while the ops docs promise "lights OFF". The fix asks the engine in band
// (POST /shutdown), waits a BOUNDED time for it to exit, and always proceeds
// to the kill; an unconfirmed blackout must be LOUD.
//
// Every test here is in-process with injected deps: no port is bound, no
// process is signalled, the operator's stack is untouched.
const FAKE_PORTS = { marsin_engine_port: 7868 };
const FAKE_LOCK = { pid: 424242, children: { engine: 434343, sim: 454545 } };

async function captureStderr(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    const result = await fn();
    return { result, stderr: chunks.join('') };
  } finally {
    process.stderr.write = original;
  }
}

test('blackout CONFIRMED: engine accepts POST /shutdown and exits → no loud warning', async () => {
  const posted = [];
  let aliveCalls = 0;
  const { result, stderr } = await captureStderr(() => launcher.blackoutEngineBeforeKill(FAKE_LOCK, {
    ports: FAKE_PORTS,
    post: (url, body) => { posted.push([url, body]); return Promise.resolve(200); },
    pidAlive: () => (++aliveCalls < 3),      // exits on the 3rd poll
    sleep: () => Promise.resolve(),
  }));
  assert.deepEqual(result, { confirmed: true, reason: 'engine exited' });
  assert.deepEqual(posted, [['http://127.0.0.1:7868/shutdown', { confirm: true }]],
    'the blackout is requested through the engine\'s own shutdown path, with an explicit confirm');
  assert.equal(stderr, '', 'a confirmed blackout must not cry wolf');
});

test('blackout NOT confirmed when the engine refuses/ignores the request — and it is LOUD', async () => {
  const { result, stderr } = await captureStderr(() => launcher.blackoutEngineBeforeKill(FAKE_LOCK, {
    ports: FAKE_PORTS,
    post: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:7868')),
    pidAlive: () => true,
    sleep: () => Promise.resolve(),
  }));
  assert.deepEqual(result, { confirmed: false, reason: 'request failed' });
  assert.match(stderr, /BLACKOUT NOT CONFIRMED/, 'the operator must be told the rig may still be lit');
  assert.match(stderr, /ECONNREFUSED/, 'the underlying reason is not swallowed');
});

test('the wait is BOUNDED: an engine that never exits fails loudly instead of hanging', async () => {
  let clock = 1_000_000;
  let polls = 0;
  const { result, stderr } = await captureStderr(() => launcher.blackoutEngineBeforeKill(FAKE_LOCK, {
    ports: FAKE_PORTS,
    timeoutMs: 3000,
    post: () => Promise.resolve(200),
    pidAlive: () => { polls++; return true; },
    sleep: (ms) => { clock += ms; return Promise.resolve(); },
    now: () => clock,
  }));
  assert.deepEqual(result, { confirmed: false, reason: 'engine still alive' });
  assert.equal(polls, 16, '1 liveness precheck + 15 polls (3000 ms budget / 200 ms) — the loop terminates on the budget');
  assert.match(stderr, /BLACKOUT NOT CONFIRMED/);
});

test('an already-dead engine is NOT asked — stop must never shut down an engine it does not own', async () => {
  let posts = 0;
  const { result, stderr } = await captureStderr(() => launcher.blackoutEngineBeforeKill(FAKE_LOCK, {
    ports: FAKE_PORTS,
    post: () => { posts++; return Promise.resolve(200); },
    pidAlive: () => false,
    sleep: () => Promise.resolve(),
  }));
  assert.deepEqual(result, { confirmed: false, reason: 'engine already gone' });
  assert.equal(posts, 0,
    'with our engine dead, a POST to :6968 would hit whatever OTHER engine answers that port');
  assert.match(stderr, /already gone/);
  assert.match(stderr, /BLACKOUT NOT CONFIRMED/, 'a rig that lost its engine without a blackout may still be lit');
});

test('no engine child in the lock: nothing is requested, and it is LOUD (every profile runs an engine)', async () => {
  let posts = 0;
  const { result, stderr } = await captureStderr(() => launcher.blackoutEngineBeforeKill(
    { pid: 1, children: { sim: 2 } },
    { ports: FAKE_PORTS, post: () => { posts++; return Promise.resolve(200); }, sleep: () => Promise.resolve() },
  ));
  assert.deepEqual(result, { confirmed: false, reason: 'no engine pid in lock' });
  assert.equal(posts, 0, 'no blackout request without a known engine');
  assert.match(stderr, /BLACKOUT NOT CONFIRMED/);
});

test('ORDER: cmdStop requests the blackout BEFORE it force-kills the tree', () => {
  // The defect was pure ordering, so pin the ordering. Source-level because
  // cmdStop's kill path cannot be exercised without killing a real process.
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const stopIdx = src.indexOf('Stopping launcher pid');
  assert.ok(stopIdx > 0, 'found the live-stack stop path');
  const blackoutIdx = src.indexOf('await blackoutEngineBeforeKill(lock);', stopIdx);
  const killIdx = src.indexOf('forceKillTree(lock.pid)', stopIdx);
  assert.ok(blackoutIdx > 0 && killIdx > 0, 'both steps are present in the live-stack stop path');
  assert.ok(blackoutIdx < killIdx,
    'the blackout request must precede the force-kill — a taskkill /F first is exactly defect T1');
});
