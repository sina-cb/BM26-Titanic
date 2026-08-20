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
const { spawn, spawnSync, execFileSync } = require('node:child_process');
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
// LOCK OVERRIDE (docs/62 W-A3/W-A5). launcher.js resolves its lock path ONCE at
// load, and the W-A reap paths tested below DELETE that file and kill what it
// names. Pointing it at a scratch lock BEFORE the require makes it structurally
// impossible for anything in this file to touch the operator's live lock.
const SCRATCH_LOCK = path.join(os.tmpdir(), `bm26_wa_lock_${process.pid}.json`);
process.env.BM26_LAUNCHER_LOCK = SCRATCH_LOCK;
const sup = require('../start.js');       // module mode — does NOT boot
const launcher = require('../../launcher.js'); // module mode — does NOT run main()
const portCleanup = require('../../tools/port_cleanup.cjs'); // the ARM-interlocked killer

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('launcher credential preflight validates keys without exposing values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26-launcher-auth-'));
  const file = path.join(dir, 'secrets.yaml');
  try {
    fs.writeFileSync(file, [
      'SinaAuth: test-owner',
      'MishaAuth: test-collaborator',
      'MARITIME_TERM_FOR_SAILIOR_PASS: test-bringup',
      '',
    ].join('\n'));
    assert.deepEqual(launcher.validateCaptainPadSecrets(file), []);
    fs.writeFileSync(file, 'SinaAuth: test-owner\n');
    const problems = launcher.validateCaptainPadSecrets(file);
    assert.equal(problems.length, 2);
    assert.ok(problems.every((problem) => !problem.includes('test-owner')));
    fs.writeFileSync(file, 'SinaAuth: private-test-literal\n  malformed: [\n');
    const parseProblems = launcher.validateCaptainPadSecrets(file);
    assert.equal(parseProblems.length, 1);
    assert.ok(!parseProblems[0].includes('private-test-literal'));
    fs.writeFileSync(file, [
      'SinaAuth: duplicate-test-value',
      'MishaAuth: duplicate-test-value',
      'MARITIME_TERM_FOR_SAILIOR_PASS: duplicate-test-value',
      '',
    ].join('\n'));
    const duplicateProblems = launcher.validateCaptainPadSecrets(file);
    assert.equal(duplicateProblems.length, 1);
    assert.ok(duplicateProblems[0].includes('must be distinct'));
    assert.ok(!duplicateProblems[0].includes('duplicate-test-value'));
    assert.equal(launcher.validateCaptainPadSecrets(path.join(dir, 'missing')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArgs accepts --dev-no-auth on development profiles', () => {
  const opts = launcher.parseArgs(['dev', '--dev-no-auth', '--no-launch']);
  assert.equal(opts.command, 'dev');
  assert.equal(opts.devNoAuth, true);
  assert.equal(opts.open, false);
});

test('resolveCaptainPadAuthPreflight: dev+--dev-no-auth produces no secrets problem', () => {
  const verdict = launcher.resolveCaptainPadAuthPreflight({
    profileName: 'dev',
    devNoAuthRequested: true,
    secretsPath: null,
    engineDepsInstalled: true,
  });
  assert.equal(verdict.refusal, null);
  assert.equal(verdict.devNoAuth.enabled, true);
  assert.deepEqual(verdict.secretsProblems, []);
});

test('resolveCaptainPadAuthPreflight: dev without flag preserves missing-secrets failure', () => {
  const verdict = launcher.resolveCaptainPadAuthPreflight({
    profileName: 'dev',
    devNoAuthRequested: false,
    secretsPath: null,
    engineDepsInstalled: true,
  });
  assert.equal(verdict.refusal, null);
  assert.equal(verdict.devNoAuth.enabled, false);
  assert.ok(verdict.secretsProblems.some((p) => p.includes('BM26_SECRETS must point')));
});

test('resolveCaptainPadAuthPreflight: prod+--dev-no-auth refuses', () => {
  const verdict = launcher.resolveCaptainPadAuthPreflight({
    profileName: 'prod',
    devNoAuthRequested: true,
    secretsPath: '/unused/secrets.yaml',
    engineDepsInstalled: true,
  });
  assert.match(verdict.refusal, /--dev-no-auth is only valid on development profiles/);
  assert.equal(verdict.devNoAuth.enabled, false);
  assert.deepEqual(verdict.secretsProblems, []);
});

test('resolveCaptainPadAuthPreflight: dev-lite+--dev-no-auth produces no secrets problem', () => {
  const verdict = launcher.resolveCaptainPadAuthPreflight({
    profileName: 'dev-lite',
    devNoAuthRequested: true,
    secretsPath: null,
    engineDepsInstalled: true,
  });
  assert.equal(verdict.refusal, null);
  assert.equal(verdict.devNoAuth.enabled, true);
  assert.deepEqual(verdict.secretsProblems, []);
});

test('lockHasDevNoAuthBypass: only an explicit true lock field counts', () => {
  assert.equal(launcher.lockHasDevNoAuthBypass({ devNoAuth: true }), true);
  assert.equal(launcher.lockHasDevNoAuthBypass({ devNoAuth: false }), false);
  assert.equal(launcher.lockHasDevNoAuthBypass({}), false);
  assert.equal(launcher.lockHasDevNoAuthBypass(null), false);
  assert.equal(launcher.lockHasDevNoAuthBypass({ profile: 'dev' }), false,
    'legacy locks without devNoAuth must read as auth-bypass false');
});

test('dev-no-auth lock/status wiring records bypass and status warns', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const writeCall = src.slice(src.indexOf('writeLock({'), src.indexOf('startReaper();'));
  assert.match(writeCall, /devNoAuth: devNoAuth\.enabled/,
    'the lock is what status reads after the fact');
  const status = src.slice(src.indexOf('async function cmdStatus'), src.indexOf('// ── `stop` →'));
  assert.match(status, /lockHasDevNoAuthBypass\(lock\)/);
  assert.match(status, /DEVELOPMENT AUTH BYPASS.*--dev-no-auth/);
});

test('validate() uses resolveCaptainPadAuthPreflight as the ONE secrets authority', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const validateFn = src.slice(src.indexOf('function validate(opts, profileDef)'), src.indexOf('// ── The spawn contract'));
  assert.match(validateFn, /resolveCaptainPadAuthPreflight\(/);
  assert.match(validateFn, /problems\.push\(\.\.\.authPreflight\.secretsProblems\)/);
  assert.ok(!validateFn.includes('resolveDevNoAuthRequest(opts.command'),
    'validate must not duplicate dev-no-auth resolution outside the preflight helper');
});

test('--help documents --dev-no-auth as development-only', () => {
  const run = spawnSync(process.execPath, ['launcher.js', '--help'], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /--dev-no-auth/);
  assert.match(run.stdout, /DEVELOPMENT ONLY/i);
  assert.match(run.stdout, /BM26_SECRETS/);
});

test('prod --dev-no-auth exits 2 with a named refusal and starts NOTHING', () => {
  const lockPath = path.join(os.tmpdir(), `bm26_dev_noauth_prod_${process.pid}.lock.json`);
  try { fs.unlinkSync(lockPath); } catch { /* first run */ }
  const run = spawnSync(process.execPath, ['launcher.js', 'prod', '--dev-no-auth', '--no-launch'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, BM26_LAUNCHER_LOCK: lockPath, BM26_SIM_CONFIG: CFG_PATH },
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  assert.equal(run.status, 2, `show profile must refuse the bypass:\n${output}`);
  assert.match(output, /--dev-no-auth is only valid on development profiles/);
  assert.match(output, /profile 'prod'/);
  assert.ok(!fs.existsSync(lockPath),
    'it must refuse BEFORE assertSingleInstance — a usage error may never take a running stack down');
});

test('launcher propagates --dev-no-auth to engine as BM26_CAPTAINPAD_AUTH_REQUIRED=0', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const startEngine = src.slice(src.indexOf('async function startEngine(scene)'), src.indexOf('async function handleEngineExit'));
  assert.match(startEngine, /BM26_CAPTAINPAD_AUTH_REQUIRED: devNoAuth\.enabled \? '0' : '1'/,
    'the launcher is the ONE authority on supervised auth mode');
  assert.match(src, /resolveCaptainPadAuthPreflight\(/,
    'preflight must settle the flag before spawning');
});

test('launcher warns loudly when --dev-no-auth is active', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  assert.match(src, /if \(devNoAuth\.enabled\)/);
  assert.match(src, /DEVELOPMENT AUTH BYPASS.*--dev-no-auth/);
});

test('launcher preserves an engine crash-relocked Performance show instead of posting a blocked pattern', async () => {
  const posts = [];
  const logs = [];
  const result = await launcher.initializeEnginePattern('http://127.0.0.1:7868', 'test_const', {
    get: async (url) => {
      assert.equal(url, 'http://127.0.0.1:7868/performance-mode');
      return { active: true, enteredAt: 'restart' };
    },
    post: async (...args) => { posts.push(args); },
    logger: (message) => logs.push(message),
  });
  assert.deepEqual(result, { patternSet: false, reason: 'performance-lock' });
  assert.deepEqual(posts, [], 'a relocked show must never receive the 409-gated pattern write');
  assert.match(logs.join('\n'), /stale Performance lock/);
});

test('launcher re-asserts the selected pattern only while engine Performance is inactive', async () => {
  const posts = [];
  const result = await launcher.initializeEnginePattern('http://127.0.0.1:7868', 'test_const', {
    get: async () => ({ active: false, enteredAt: null }),
    post: async (...args) => { posts.push(args); },
    logger: () => {},
  });
  assert.deepEqual(result, { patternSet: true, reason: 'edit-mode' });
  assert.deepEqual(posts, [[
    'http://127.0.0.1:7868/pattern',
    { pattern: 'test_const' },
  ]]);
});

test('launcher fails loudly on a malformed performance-mode response', async () => {
  await assert.rejects(
    launcher.initializeEnginePattern('http://127.0.0.1:7868', 'test_const', {
      get: async () => ({ active: 'yes' }),
      logger: () => {},
    }),
    /missing boolean active/,
  );
});

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

// ── _245: show-profile contract (prod vs dev) ────────────────────────────
// These numbers are SHOW CONFIGURATION, not implementation detail: sACN
// priority decides which source a controller obeys, the sim lighting profile
// decides how much GPU a show box burns, and the CaptainPad mode decides
// whether a bundler runs during a show. Pin them.
test('_245: prod is the show profile — 2d_pixels sim, static CaptainPad, sACN 150', () => {
  const prod = launcher.PROFILES.prod;
  assert.equal(launcher.resolveSimProfile('prod', prod, null), '2d_pixels');
  assert.equal(launcher.resolveCaptainPadMode('prod', prod), 'static',
    'a show machine must serve the PREBUILT export — never Metro');
  assert.equal(launcher.resolveSacnPriority('prod', prod, null), 150);
  assert.ok(prod.processes.includes('captainpad'),
    'prod serves CaptainPad so the iPad has a control surface without the laptop');
});

test('_245: dev profiles run Expo and sit BELOW prod on sACN priority', () => {
  for (const name of ['dev', 'dev-lite']) {
    const def = launcher.PROFILES[name];
    assert.equal(launcher.resolveCaptainPadMode(name, def), 'expo', name);
    assert.equal(launcher.resolveSacnPriority(name, def, null), 120, name);
    assert.ok(launcher.resolveSacnPriority(name, def, null)
      < launcher.resolveSacnPriority('prod', launcher.PROFILES.prod, null),
      `${name} must lose to the show server if both address the same universes`);
  }
});

test('_245: sACN priority validation is LOUD and does not coerce', () => {
  assert.throws(() => launcher.resolveSacnPriority('x', { sacnPriority: 201 }, null),
    /outside the E1\.31 valid range/);
  assert.throws(() => launcher.resolveSacnPriority('x', { sacnPriority: -1 }, null), /outside/);
  assert.throws(() => launcher.resolveSacnPriority('x', {}, null), /not an integer/,
    'a profile that forgets sacnPriority is a config bug, not a default');
  // 0 is a VALID E1.31 priority. The engine's own `parseInt(...) || 100` would
  // silently turn it into 100 (config_boot_matrix.test.js D12); the launcher
  // must at least not add a second coercion of its own.
  assert.equal(launcher.resolveSacnPriority('x', { sacnPriority: 0 }, null), 0);
});

test('_245: an unknown sim lighting profile fails loudly instead of silently becoming edit', () => {
  assert.throws(() => launcher.resolveSimProfile('x', launcher.PROFILES.prod, '2dpixels'),
    /Unknown sim lighting profile/);
  for (const id of launcher.SIM_LIGHTING_PROFILES) {
    assert.equal(launcher.resolveSimProfile('x', launcher.PROFILES.prod, id), id);
  }
});

test('_245: the captainpad child runs with CI genuinely ABSENT, not merely falsy', () => {
  const had = process.env.CI;
  process.env.CI = 'true';   // the parent shell that froze Metro's reloads
  try {
    const env = launcher.buildChildEnv({ EXPO_NO_TELEMETRY: '1', CI: null });
    assert.ok(!('CI' in env), 'CI must be DELETED — Metro checks presence, not truthiness');
    assert.equal(env.EXPO_NO_TELEMETRY, '1');
  } finally {
    if (had === undefined) delete process.env.CI; else process.env.CI = had;
  }
});

test('_245: the Expo bundle host is detected, never guessed (Expo Go on the iPad)', () => {
  // Exactly one non-internal IPv4 → unambiguous.
  assert.equal(launcher.detectLanHost(
    { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '10.0.0.7' }] }, null).host, '10.0.0.7');
  // 169.254/16 is APIPA — an interface that failed to get an address.
  assert.throws(() => launcher.detectLanHost(
    { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '169.254.1.2' }] }, null), /found 0/);
  // Ambiguity is refused, not guessed: the wrong host reaches every iPad.
  assert.throws(() => launcher.detectLanHost({
    a: [{ family: 'IPv4', internal: false, address: '10.0.0.1' }],
    b: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }],
  }, null), /found 2/);
  assert.equal(launcher.detectLanHost({}, '10.0.0.9').host, '10.0.0.9', 'override wins');
});

// ── _245 post-landing: the "[object Object]" bundle-host defect ───────────
// Landed defect, hit LIVE on the gen-6 first launch: main() bound
//   const lanHost = detectLanHost(...)          // the {host, source} OBJECT
// and then handed `lanHost` straight to REACT_NATIVE_PACKAGER_HOSTNAME. Node
// stringifies an object env value to "[object Object]", which Metro's
// @react-native/dev-middleware feeds to `new URL()` inside InspectorProxy →
// "TypeError: Invalid URL" → the captainpad child exits → the launcher tears the
// whole stack down at boot. The unit tests above did NOT catch it because they
// only ever exercise detectLanHost's return value; the bug was at the CALL SITE.
// So pin the call site.
test('_245 regression: REACT_NATIVE_PACKAGER_HOSTNAME is a plain host STRING, never the {host,source} object', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');

  // 1. What expression is actually assigned to the env var?
  const assigned = src.match(/REACT_NATIVE_PACKAGER_HOSTNAME:\s*([^,\n]+)/);
  assert.ok(assigned, 'the Expo child still sets REACT_NATIVE_PACKAGER_HOSTNAME');
  const expr = assigned[1].trim();
  // A bare identifier only — an inline detectLanHost(...) call would be the
  // defect verbatim, and an object/array literal can never be a hostname.
  assert.match(expr, /^[A-Za-z_$][\w$]*$/,
    `env value must be a simple identifier holding a string (got: ${expr})`);
  assert.ok(!/detectLanHost/.test(expr),
    'the raw detectLanHost() result is the {host,source} OBJECT — it must be unwrapped first');

  // 2. That identifier must be bound to the .host STRING, not to the object.
  //    Line scan rather than a built regex — the identifier is interpolated, and
  //    a template-literal regex is its own escaping trap.
  const decl = src.split('\n').find((line) => line.trim().startsWith(`const ${expr} =`));
  assert.ok(decl, `found the declaration of '${expr}'`);
  assert.ok(decl.includes('.host'),
    `'${expr}' must be bound to the .host string (got: ${decl.trim()})`);

  // 3. The operator-facing "bundle host" log lines must print that same string,
  //    or the log says "[object Object]" while the env var is fine (or vice
  //    versa) and the next debugger is misled.
  const bundleHostLines = src.match(/bundle host \$\{[^}]+\}/g) || [];
  assert.ok(bundleHostLines.length >= 2,
    'both the startup banner and the ready line report the bundle host');
  for (const line of bundleHostLines) {
    assert.equal(line, `bundle host \${${expr}}`,
      `every 'bundle host' log must interpolate the same host string as the env var (got: ${line})`);
  }
});

test('_245 regression: the detected host stringifies as a hostname, and the raw object does NOT', () => {
  const info = launcher.detectLanHost(
    { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '10.0.0.7' }] }, null);
  // The shape contract every consumer must unwrap.
  assert.deepEqual(Object.keys(info).sort(), ['host', 'source']);
  assert.equal(typeof info.host, 'string');
  // What Metro's `new URL()` needs: a bare IPv4 or hostname, nothing else.
  assert.match(info.host, /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9][A-Za-z0-9.-]*)$/);

  // State the hazard the call site must avoid, concretely: this is exactly the
  // value Node would have put in the child's environment.
  assert.equal(String(info), '[object Object]',
    'passing the object itself yields the env value that killed Metro at boot');

  // And the log line, composed the fixed way, carries the host.
  const logged = `✅ CaptainPad is ready (Expo dev server · bundle host ${info.host}).`;
  assert.match(logged, /bundle host 10\.0\.0\.7\)/);
  assert.ok(!logged.includes('[object Object]'));
});

// ════════════════════════════════════════════════════════════════════════
// _259 · docs/62 W-A — Teardown integrity (stragglers structurally impossible)
//
// Every test below runs on SCRATCH ports (17xxx), a SCRATCH lock
// (BM26_LAUNCHER_LOCK, set before the require at the top of this file) and a
// SCRATCH arm marker, and only ever kills processes it spawned itself. Nothing
// here touches 6966-6972, 5568, 6981 or 7175.
//
// Mutation notes sit next to the assertions they protect: each states the
// reversion that turns it red, in the `_245` addendum style.
// ════════════════════════════════════════════════════════════════════════

const WA_PORTS = {
  stackChild: 17311,     // a stack-signature process holding a port
  foreign: 17312,        // a process we must NEVER kill
  armedBridge: 17313,    // the ARM-interlock refusal case
  reaperChild: 17314,    // the sentinel's victim
  engine: 17868,         // scratch engine port for the blackout probe
};

// ~/tmp per the project temp-file convention; the spawn-contract directory name
// carries the exact hazard from the live incident: a space AND an apostrophe.
const WA_TMP = path.join(os.homedir(), 'tmp', `bm26_wa_${process.pid}`);
const WA_SPACEY = path.join(WA_TMP, "spawn contract 'dir");
const WA_CFG = path.join(WA_TMP, 'ports.yaml');
const WA_MARKER = path.join(WA_TMP, 'arm_marker.json');

fs.mkdirSync(WA_SPACEY, { recursive: true });
fs.writeFileSync(WA_CFG, [
  `http_port: ${WA_PORTS.stackChild}`, 'save_port: 17321', 'sacn_port: 17322',
  'sacn_output_port: 17323', `marsin_engine_port: ${WA_PORTS.engine}`,
  'captainpad_web_port: 17324', 'sacn_udp_port: 17568', '',
].join('\n'));

// A process that holds a port and nothing else. The FILE NAME decides identity:
// `engine.js` matches a stack signature, `squatter.cjs` matches none — which is
// exactly how port_cleanup tells ours from foreign.
const LISTENER_SRC = [
  "const net = require('net');",
  'const srv = net.createServer(() => {});',
  "srv.listen(Number(process.argv[2]), '127.0.0.1', () => process.stdout.write('ready\\n'));",
  'setInterval(() => {}, 1000);',
].join('\n');

function waListener(name) {
  const file = path.join(WA_TMP, name);
  fs.writeFileSync(file, LISTENER_SRC);
  return file;
}

function killTree(pid) {
  try {
    if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch { /* already gone */ }
}

// Spawn a listener and resolve once it says it is listening.
function spawnListener(script, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, String(port)],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    const timer = setTimeout(() => reject(new Error(`${script} never reported ready on :${port}`)), 20000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('ready')) { clearTimeout(timer); resolve(child); }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const waAlive = (pid) => launcher.pidAlive(pid);

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for: ${label}`);
}

// ── W-A1 · the spawn contract ────────────────────────────────────────────

test('W-A1: windowsShellQuote quotes a space+apostrophe path as ONE token, passes plain tokens through byte-identical', () => {
  const spacey = "C:\\Users\\Titanic's End\\workspace\\x.cjs";
  assert.deepEqual(launcher.windowsShellQuote([spacey], true), [`"${spacey}"`],
    'the shattered-path incident: one arg in, one quoted token out');
  // Byte-identical pass-through for ordinary args — quoting everything would
  // break `npx expo start --web` just as badly as quoting nothing.
  assert.deepEqual(launcher.windowsShellQuote(['expo', 'start', '--web', '6967'], true),
    ['expo', 'start', '--web', '6967']);
  // Non-Windows is identity by contract.
  assert.deepEqual(launcher.windowsShellQuote([spacey], false), [spacey]);
});

test('W-A1: every cmd.exe metacharacter is quoted, not just whitespace', () => {
  // MUTATION: drop any character from WINDOWS_SHELL_QUOTE_CLASS in launcher.js
  // and its line below goes red. `&` alone would truncate a command at cmd.exe.
  for (const ch of ['&', '(', ')', '^', '!', '=', ',', ';']) {
    const arg = `a${ch}b`;
    assert.deepEqual(launcher.windowsShellQuote([arg], true), [`"${arg}"`],
      `'${ch}' is a cmd.exe metacharacter — unquoted it changes the command`);
  }
  assert.deepEqual(launcher.windowsShellQuote(['plain'], true), ['plain'],
    'MUTATION GUARD: if the class became /./ this would fail — quoting is selective');
});

test('W-A1: an embedded " or % is REFUSED by name — cmd.exe cannot quote them safely', () => {
  assert.throws(() => launcher.windowsShellQuote(['say "hi"'], true),
    /windowsShellQuote: refusing to pass/);
  assert.throws(() => launcher.windowsShellQuote(['%USERPROFILE%'], true),
    /refusing to pass/,
    '`%VAR%` expands even INSIDE cmd.exe quotes — a silently mangled launch is worse than a thrown one');
  // …and only on the shell path: POSIX takes the array verbatim, nothing to refuse.
  assert.deepEqual(launcher.windowsShellQuote(['%USERPROFILE%'], false), ['%USERPROFILE%']);
});

test('W-A1: the shell is reserved for .cmd shims — node children spawn shell-free', () => {
  assert.equal(launcher.spawnNeedsShell('node', true), false,
    'node.exe is a real executable: no shell, no quoting layer, and child.pid IS node');
  assert.equal(launcher.spawnNeedsShell('npx', true), true, 'npx is a .cmd shim — only cmd.exe can exec it');
  assert.equal(launcher.spawnNeedsShell('npm', true), true);
  assert.equal(launcher.spawnNeedsShell('npx', false), false, 'POSIX never needs a shell');
  assert.throws(() => launcher.spawnNeedsShell('python', true), /No spawn contract for command/,
    'an unlisted command is a contract gap, not something to guess at');
});

test('W-A1: every stack child is spawned with a command the contract covers, and only expo uses the shell', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const calls = [...src.matchAll(/startChild\(\s*(?:'([^']+)'|[A-Za-z_$][\w$]*)\s*,\s*'([^']+)'/g)]
    .map((m) => ({ tag: m[1] || '<dynamic>', command: m[2] }));
  assert.ok(calls.length >= 4, `found the startChild call sites (got ${calls.length})`);
  for (const c of calls) {
    // Throws for anything outside the contract — the assertion IS the contract.
    const shell = launcher.spawnNeedsShell(c.command, true);
    if (c.command === 'node') {
      assert.equal(shell, false, `the '${c.tag}' child must spawn shell-free`);
    } else {
      assert.equal(c.command, 'npx', `only the expo child may need a shell (got '${c.command}' for '${c.tag}')`);
      assert.equal(shell, true);
    }
  }
  assert.ok(calls.some((c) => c.command === 'node'), 'the node children are still spawned as `node`');
  // MUTATION: restoring `shell: IS_WIN` (directly, or by rebinding useShell to
  // it) makes one of these two red.
  assert.ok(/shell: useShell/.test(src),
    'startChild must derive `shell` from the contract, never hardcode it to IS_WIN');
  assert.match(src, /const useShell = spawnNeedsShell\(command\);\s+const spawnArgs = useShell \? windowsShellQuote\(args\) : args;/,
    'the contract decides the shell AND the quoting together — the quoting layer may only exist '
    + 'on the shell path');
});

test('W-A1/W-A2 REAL SPAWN: a space+apostrophe path arrives as ONE argv entry and child.pid is the REAL node pid', async (t) => {
  if (!IS_WIN) return t.skip('the shell/quoting hazard is Windows-only');
  const script = path.join(WA_SPACEY, 'echo_argv.cjs');
  const out = path.join(WA_SPACEY, 'echo_argv.json');
  fs.writeFileSync(script, [
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ argv1: process.argv[1], pid: process.pid }));`,
  ].join('\n'));
  try { fs.unlinkSync(out); } catch { /* first run */ }

  // Through the REAL code path — this is the test that catches a future
  // `shell:true` regression regardless of how clever the quoting gets.
  const child = launcher.startChild('spawn-contract-probe', 'node', [script], WA_SPACEY, {},
    () => true); // claim the exit so the launcher's crash teardown never fires
  const code = await new Promise((res) => child.once('exit', res));
  assert.equal(code, 0, 'the child ran');

  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  // MUTATION: revert startChild to `shell: IS_WIN` WITHOUT quoting → argv1 is
  // truncated at the first space and this goes red.
  assert.equal(report.argv1, script,
    'the space+apostrophe path must reach the child as a single argv entry, byte-identical');
  // MUTATION: revert to `shell: IS_WIN` WITH the whitespace-quoting hot-fix →
  // argv1 survives but child.pid is the cmd.exe WRAPPER and this goes red. That
  // wrapper pid is what used to land in the lock file (W-A2).
  assert.equal(child.pid, report.pid,
    'child.pid must BE the node process — a cmd.exe wrapper pid in the lock skips live orphans');
});

// ── W-A2 · the lock records real PIDs + stackPorts ───────────────────────

test('W-A2: the lock is written with stackPorts and a resolvedChildren map', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const writeIdx = src.indexOf('writeLock({');
  const writeCall = src.slice(writeIdx, src.indexOf('startReaper();', writeIdx));
  assert.match(writeCall, /\bstackPorts,/,
    'stop and the sentinel sweep by port — the lock must carry the ports this run owns');
  assert.match(writeCall, /resolvedChildren: \{\}/);
  // The one shell-spawned child resolves its REAL pid after readiness.
  assert.match(src, /recordResolvedChild\('captainpad', ports\.captainpad_web_port\)/);
  assert.match(src, /recordResolvedChild\('engine', ports\.marsin_engine_port\)/);
});

test('W-A2: resolvePortOwner names the single owner, and REFUSES to guess when it is ambiguous', () => {
  assert.equal(launcher.resolvePortOwner(1234, { listenersOnPort: () => [4242] }), 4242);
  assert.equal(launcher.resolvePortOwner(1234, { listenersOnPort: () => [] }), null,
    'nothing listening → no pid to record (the port sweep still covers it)');
  assert.equal(launcher.resolvePortOwner(1234, { listenersOnPort: () => [1, 2] }), null,
    'two owners is ambiguous — recording either one would put a wrong pid in the lock');
  assert.equal(launcher.resolvePortOwner(1234, { listenersOnPort: () => [process.pid] }), null,
    'our own pid is never a child');
});

test('W-A2/W-A3: reapLockChildren reaps a child recorded ONLY as a resolved pid (the wrapper-death case)', async () => {
  const script = waListener('engine.js');   // matches a stack signature by name
  const child = await spawnListener(script, WA_PORTS.stackChild);
  const lines = [];
  try {
    // The wrapper is gone; the real server survives, recorded only in
    // resolvedChildren. Pre-W-A2 this orphan was skipped entirely.
    const reaped = launcher.reapLockChildren(
      { children: {}, resolvedChildren: { captainpad: child.pid } }, (m) => lines.push(m));
    assert.deepEqual(reaped.map((r) => r.pid), [child.pid]);
    assert.match(lines.join('\n'), /captainpad \(resolved\)/);
    await waitUntil(async () => !waAlive(child.pid), 10000, 'the resolved orphan to die');
  } finally {
    killTree(child.pid);
  }
});

test('W-A3: reapLockChildren never kills a recycled PID that is not one of ours', () => {
  const lines = [];
  // Our own test-runner pid is very much alive and very much not a stack child.
  const reaped = launcher.reapLockChildren(
    { children: { engine: process.pid } }, (m) => lines.push(m));
  assert.deepEqual(reaped, [], 'identity check first: PID reuse must never kill an innocent process');
  assert.equal(lines.length, 0);
});

// ── W-A3 · stop reaps the UNION: lock PIDs ∪ identity-checked port holders ─

test('W-A3: sweepStackPorts kills OUR port holder and leaves a foreign one alone, by name', async () => {
  const ours = await spawnListener(waListener('engine.js'), WA_PORTS.stackChild);
  const foreign = await spawnListener(waListener('squatter.cjs'), WA_PORTS.foreign);
  const lines = [];
  try {
    const outcome = launcher.sweepStackPorts(
      { stackPorts: [WA_PORTS.stackChild, WA_PORTS.foreign] }, (m) => lines.push(String(m)));
    assert.ok(outcome.killed.includes(ours.pid), 'the stack-signature holder is reaped');
    assert.deepEqual(outcome.foreign.map((f) => f.pid), [foreign.pid]);
    assert.match(lines.join('\n'), new RegExp(`:${WA_PORTS.foreign} is held by pid ${foreign.pid}`),
      'a foreign holder is REPORTED, never killed');
    await waitUntil(async () => !waAlive(ours.pid), 10000, 'our port holder to die');
    assert.ok(waAlive(foreign.pid), 'the foreign process survives the sweep');
  } finally {
    killTree(ours.pid);
    killTree(foreign.pid);
  }
});

test('W-A3: a lock with no stackPorts says so LOUDLY instead of re-deriving the port map', () => {
  const lines = [];
  assert.equal(launcher.sweepStackPorts({ children: {} }, (m) => lines.push(String(m))), null);
  assert.match(lines.join('\n'), /no stackPorts/,
    'a pre-W-A2 lock is a known limitation to announce, not a reason to guess at the profile');
});

test('W-A3: survivingStackHolders names OUR survivors and ignores foreign ones', async () => {
  const ours = await spawnListener(waListener('engine.js'), WA_PORTS.stackChild);
  const foreign = await spawnListener(waListener('squatter.cjs'), WA_PORTS.foreign);
  try {
    const survivors = launcher.survivingStackHolders(
      { stackPorts: [WA_PORTS.stackChild, WA_PORTS.foreign] });
    assert.deepEqual(survivors.map((s) => s.pid), [ours.pid],
      'stop fails on OUR leftovers only — a foreign process on our port is not our failure');
  } finally {
    killTree(ours.pid);
    killTree(foreign.pid);
  }
});

test('W-A3 END-TO-END: `launcher.js stop` over a stale lock reaps the union, spares the foreign holder, removes the lock', async () => {
  const orphan = await spawnListener(waListener('engine.js'), WA_PORTS.stackChild);
  const foreign = await spawnListener(waListener('squatter.cjs'), WA_PORTS.foreign);
  const lockPath = path.join(WA_TMP, 'stop_union.lock.json');
  try {
    // lock.pid is the FOREIGN process: alive, but not a launcher → the stale-lock
    // path, deterministically, with no dead-pid-reuse guesswork.
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: foreign.pid, profile: 'prod', scene: 'titanic', startedAt: 'test',
      children: { engine: orphan.pid },
      stackPorts: [WA_PORTS.stackChild, WA_PORTS.foreign],
    }));
    const run = spawnSync(process.execPath, ['launcher.js', 'stop'], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
      env: { ...process.env, BM26_LAUNCHER_LOCK: lockPath, BM26_SIM_CONFIG: WA_CFG },
    });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    assert.equal(run.status, 0, `stop exited cleanly:\n${output}`);
    assert.match(output, /Force-killing orphaned engine/, 'the lock-recorded orphan is reaped');
    assert.match(output, new RegExp(`:${WA_PORTS.foreign} is held by pid ${foreign.pid}`),
      'the foreign holder is named in the output');
    assert.ok(!fs.existsSync(lockPath), 'the stale lock is removed');
    assert.ok(!waAlive(orphan.pid), 'the orphan is gone');
    assert.ok(waAlive(foreign.pid), 'the foreign process survived');
  } finally {
    killTree(orphan.pid);
    killTree(foreign.pid);
    try { fs.unlinkSync(lockPath); } catch { /* gone */ }
  }
});

test('W-A3/W-A4 END-TO-END: `stop` exits NON-ZERO when the ARM interlock leaves one of ours holding a port', async () => {
  // The bridge the interlock protects, by command-line identity, on a scratch
  // port — and a SCRATCH arm marker, never the live one.
  const bridge = await spawnListener(waListener('sacn_bridge.js'), WA_PORTS.armedBridge);
  const foreign = await spawnListener(waListener('squatter.cjs'), WA_PORTS.foreign);
  const lockPath = path.join(WA_TMP, 'stop_armed.lock.json');
  try {
    fs.writeFileSync(WA_MARKER, JSON.stringify({
      pid: bridge.pid, scene: 'test_bench', sourceScene: 'titanic', armedAt: 'test',
    }));
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: foreign.pid, profile: 'prod', scene: 'titanic', startedAt: 'test',
      children: {}, stackPorts: [WA_PORTS.armedBridge],
    }));
    const env = { ...process.env, BM26_LAUNCHER_LOCK: lockPath, BM26_SIM_CONFIG: WA_CFG,
      BM26_BENCH_MIRROR_ARM_MARKER: WA_MARKER };
    delete env.BM26_FORCE_SACN_KILL;
    const run = spawnSync(process.execPath, ['launcher.js', 'stop'], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000, env,
    });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    // MUTATION: route the sweep back through a direct forceKillTree and the
    // bridge dies — this refusal, and the non-zero exit, both go red.
    assert.match(output, /REFUSING to kill pid/, 'the F7 interlock refuses the armed bridge BY NAME');
    assert.match(output, /BENCH MIRROR is ARMED/);
    assert.match(output, /STILL RUNNING/, '`stop` says exactly what it failed to stop');
    assert.equal(run.status, 1, 'a stack process still holding a stack port is a FAILED stop, loudly');
    assert.ok(waAlive(bridge.pid), 'the armed bridge is still alive — that is the whole point');
  } finally {
    killTree(bridge.pid);
    killTree(foreign.pid);
    try { fs.unlinkSync(WA_MARKER); } catch { /* gone */ }
    try { fs.unlinkSync(lockPath); } catch { /* gone */ }
  }
});

// ── W-A4 · the interlock hole: launcher port-kills go through killPid ────

test('W-A4: killStaleListeners routes EVERY port-holder kill through portCleanup.killPid', () => {
  const seen = [];
  const outcome = launcher.killStaleListeners([WA_PORTS.stackChild], false, {
    listenersOnPort: () => [4242],
    commandlineOf: () => 'node C:\\x\\engine.js --model titanic',
    killPid: (pid, opts) => { seen.push({ pid, opts }); return { pid, killed: true, refused: false, why: null }; },
    log: () => {},
  });
  // MUTATION: restore the direct `forceKillTree(pid)` call and the injected
  // killPid is never invoked — this goes red. That direct call WAS the defect:
  // it bypassed the bench-mirror ARM interlock entirely (docs/62 W-A4).
  assert.equal(seen.length, 1, 'the kill must go through the ARM-interlocked killPid');
  assert.equal(seen[0].pid, 4242);
  assert.deepEqual(outcome.killed, [{ port: WA_PORTS.stackChild, pid: 4242 }]);
});

test('W-A4: the port-claim force (-f / prod) must NOT be forwarded as an ARM-interlock override', () => {
  const seen = [];
  launcher.killStaleListeners([WA_PORTS.stackChild], true, {   // force = true (-f / prod)
    listenersOnPort: () => [4242],
    commandlineOf: () => 'some-foreign-thing.exe',
    killPid: (pid, opts) => { seen.push(opts || {}); return { pid, killed: true, refused: false, why: null }; },
    log: () => {},
  });
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0].force, true,
    'claiming a port from a FOREIGN process is a different decision from freezing an armed bench '
    + 'mirror — the only override for that is --force-sacn / BM26_FORCE_SACN_KILL');
});

test('W-A4: a refusal from killPid is surfaced, and the boot policy aborts on it', () => {
  const outcome = launcher.killStaleListeners([WA_PORTS.armedBridge], false, {
    listenersOnPort: () => [777],
    commandlineOf: () => 'node simulation/server/sacn_bridge.js',
    killPid: (pid) => ({ pid, killed: false, refused: true, why: 'its BENCH MIRROR is ARMED' }),
    log: () => {},
  });
  assert.deepEqual(outcome.killed, []);
  assert.equal(outcome.refused.length, 1);
  assert.match(outcome.refused[0].why, /ARMED/);
  // And the boot policy over it aborts rather than proceeding to a confusing
  // EADDRINUSE later.
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const policy = src.slice(src.indexOf('function claimStackPorts'), src.indexOf('function bindProbe'));
  assert.match(policy, /outcome\.refused\.length > 0[\s\S]{0,400}process\.exit\(1\)/,
    'an ARM-interlock refusal must abort the boot loudly');
});

test('W-A4 ACCEPTANCE: the BOOT sweep refuses an ARMED bridge by name and leaves it running', async () => {
  // The defect, exactly: `killStaleListeners` used to `forceKillTree` a port
  // holder directly, so a relaunch over an ARMED bench mirror would taskkill
  // /T /F the bridge with no refusal and freeze every mirrored box on its last
  // frame. Real portCleanup.killPid here — only the marker PATH is a seam.
  const bridge = await spawnListener(waListener('sacn_bridge.js'), WA_PORTS.armedBridge);
  const refusals = [];
  try {
    fs.writeFileSync(WA_MARKER, JSON.stringify({
      pid: bridge.pid, scene: 'test_bench', sourceScene: 'titanic', armedAt: 'test',
    }));
    const outcome = launcher.killStaleListeners([WA_PORTS.armedBridge], true, {  // -f/prod force
      killPid: (pid, opts) => portCleanup.killPid(pid, {
        ...opts, log: (m) => refusals.push(String(m)), guardDeps: { markerPath: WA_MARKER },
      }),
      log: () => {},
    });
    assert.deepEqual(outcome.killed, [], 'the armed bridge must NOT be killed');
    assert.equal(outcome.refused.length, 1, 'and the refusal must be reported, never a silent skip');
    assert.match(refusals.join('\n'), new RegExp(`REFUSING to kill pid ${bridge.pid}`));
    assert.match(outcome.refused[0].why, /BENCH MIRROR is ARMED/);
    assert.ok(waAlive(bridge.pid), 'the bridge is still alive after the boot sweep');
  } finally {
    killTree(bridge.pid);
    try { fs.unlinkSync(WA_MARKER); } catch { /* gone */ }
  }
});

test('W-A4: launcher.js no longer DEFINES its own port helpers or signature list', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  // The acceptance grep from docs/62 W-A4: zero definitions, import only.
  assert.equal((src.match(/^const STACK_PROCESS_SIGNATURES\b/m) || []).length, 0,
    'two copies of the signature list drift; the killer owns the definition');
  assert.equal((src.match(/^function listenersOnPort\b/m) || []).length, 0);
  assert.equal((src.match(/^function commandlineOf\b/m) || []).length, 0);
  assert.ok(src.includes('portCleanup.STACK_PROCESS_SIGNATURES'), 'it uses the shared list');
  // No launcher path may kill a PORT HOLDER with the un-interlocked tree kill.
  const killSweep = src.slice(src.indexOf('function killStaleListeners'), src.indexOf('function claimStackPorts'));
  assert.ok(!/forceKillTree/.test(killSweep),
    'the port sweep must never call forceKillTree directly — that was the interlock hole');
});

test('W-A4: benchMirrorTreeGuard refuses a TREE kill that would take an armed bridge with it', () => {
  const armed = {
    readArmMarker: () => ({ state: 'armed', marker: { pid: 909, scene: 'test_bench', sourceScene: 'titanic', armedAt: 'now' } }),
    pidAlive: () => true,
    commandlineOf: () => 'node simulation/server/sacn_bridge.js',
  };
  // A `-f` takeover force-kills the previous launcher's whole TREE, and the
  // bridge is a grandchild — killPid's per-pid interlock never sees it.
  assert.equal(launcher.benchMirrorTreeGuard(armed).refuse, true);
  assert.match(launcher.benchMirrorTreeGuard(armed).why, /ARMED BENCH MIRROR/);
  assert.equal(launcher.benchMirrorTreeGuard({ ...armed, pidAlive: () => false }).refuse, false,
    'a marker naming a dead pid is stale, not a reason to block a relaunch');
  assert.equal(launcher.benchMirrorTreeGuard({ ...armed, commandlineOf: () => 'notepad.exe' }).refuse, false,
    'PID reuse: that pid is not a bridge any more');
  assert.equal(launcher.benchMirrorTreeGuard({ readArmMarker: () => ({ state: 'absent' }) }).refuse, false);
  assert.equal(launcher.benchMirrorTreeGuard({
    readArmMarker: () => ({ state: 'corrupt', error: 'not JSON' }),
  }).refuse, true, 'an unreadable marker cannot PROVE nothing is armed');
  // And the takeover actually consults it.
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const takeover = src.slice(src.indexOf('// -f: take over'), src.indexOf('const deadline = Date.now() + 10000'));
  assert.match(takeover, /assertNoArmedBenchMirror/);
});

// ── W-A5 · the sentinel reaper ───────────────────────────────────────────

function spawnReaper(lockPath, launcherPid, logPath) {
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath,
    [path.join(ROOT, 'tools', 'launcher_reaper.cjs'), lockPath, String(launcherPid)], {
      cwd: ROOT, stdio: ['ignore', fd, fd], detached: true,
      env: {
        ...process.env, BM26_LAUNCHER_LOCK: lockPath, BM26_SIM_CONFIG: WA_CFG,
        BM26_BENCH_MIRROR_ARM_MARKER: WA_MARKER, BM26_REAPER_LOG: logPath,
      },
    });
  fs.closeSync(fd);
  child.unref();
  return child;
}

test('W-A5: an abnormally killed launcher is reaped — children dead, ports swept, lock removed, log written', async () => {
  const victim = await spawnListener(waListener('engine.js'), WA_PORTS.reaperChild);
  // A stand-in launcher: the sentinel's trigger is purely "the lock names this
  // pid AND that pid is dead", so a sleeping node is a faithful stand-in.
  const fakeLauncher = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const lockPath = path.join(WA_TMP, 'reaper.lock.json');
  const logPath = path.join(WA_TMP, 'reaper.log');
  let reaper = null;
  try {
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: fakeLauncher.pid, profile: 'prod', scene: 'titanic', startedAt: 'test',
      children: { engine: victim.pid }, stackPorts: [WA_PORTS.reaperChild],
    }));
    reaper = spawnReaper(lockPath, fakeLauncher.pid, logPath);

    // The sentinel must NOT act while the launcher is alive.
    await sleep(6000);
    assert.ok(fs.existsSync(lockPath), 'the lock survives while the launcher lives');
    assert.ok(waAlive(victim.pid), 'the children survive while the launcher lives');

    // The exact incident: the shell/task wrapper is killed WITHOUT /T, so the
    // children are orphaned and nothing supervises them.
    killTree(fakeLauncher.pid);

    await waitUntil(async () => !fs.existsSync(lockPath), 40000, 'the sentinel to remove the lock');
    await waitUntil(async () => !waAlive(victim.pid), 20000, 'the sentinel to reap the orphaned child');
    await waitUntil(async () => !waAlive(reaper.pid), 20000, 'the sentinel to exit after reaping');

    const logText = fs.readFileSync(logPath, 'utf8');
    assert.match(logText, /ABNORMAL LAUNCHER DEATH/, 'the sentinel has no console — the log IS its voice');
    assert.match(logText, /reap complete/);
    assert.match(logText, /BLACKOUT NOT CONFIRMED|Blackout requested/,
      'the blackout is ATTEMPTED first, and an unconfirmed one is loud');
    assert.equal(launcher.survivingStackHolders({ stackPorts: [WA_PORTS.reaperChild] }).length, 0,
      'zero stack-signature processes left on the scratch port');
  } finally {
    killTree(victim.pid);
    killTree(fakeLauncher.pid);
    if (reaper) killTree(reaper.pid);
    try { fs.unlinkSync(lockPath); } catch { /* gone */ }
  }
});

test('W-A5: a CLEAN stop (lock removed) makes the sentinel exit on its own — no reaper left behind', async () => {
  const fakeLauncher = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const lockPath = path.join(WA_TMP, 'reaper_clean.lock.json');
  const logPath = path.join(WA_TMP, 'reaper_clean.log');
  let reaper = null;
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: fakeLauncher.pid, children: {}, stackPorts: [] }));
    reaper = spawnReaper(lockPath, fakeLauncher.pid, logPath);
    await sleep(4000);
    assert.ok(waAlive(reaper.pid), 'the sentinel is watching');
    fs.unlinkSync(lockPath);                       // what a clean teardown does
    await waitUntil(async () => !waAlive(reaper.pid), 20000, 'the sentinel to exit after a clean stop');
    assert.match(fs.readFileSync(logPath, 'utf8'), /stopped cleanly/);
  } finally {
    killTree(fakeLauncher.pid);
    if (reaper) killTree(reaper.pid);
    try { fs.unlinkSync(lockPath); } catch { /* gone */ }
  }
});

test('W-A5: a takeover retires the old sentinel instead of letting it sweep the new stack', async () => {
  const fakeLauncher = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const lockPath = path.join(WA_TMP, 'reaper_takeover.lock.json');
  const logPath = path.join(WA_TMP, 'reaper_takeover.log');
  let reaper = null;
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: fakeLauncher.pid, children: {}, stackPorts: [] }));
    reaper = spawnReaper(lockPath, fakeLauncher.pid, logPath);
    await sleep(4000);
    // A new launcher took the lock over.
    fs.writeFileSync(lockPath, JSON.stringify({ pid: fakeLauncher.pid + 100000, children: {}, stackPorts: [] }));
    await waitUntil(async () => !waAlive(reaper.pid), 20000, 'the sentinel to stand down after a takeover');
    assert.match(fs.readFileSync(logPath, 'utf8'), /takeover happened/,
      'the incoming launcher spawns its own sentinel — two would race the same ports');
  } finally {
    killTree(fakeLauncher.pid);
    if (reaper) killTree(reaper.pid);
    try { fs.unlinkSync(lockPath); } catch { /* gone */ }
  }
});

test('W-A5: the sentinel refuses to start when its lock path disagrees with the launcher it loads', () => {
  const logPath = path.join(WA_TMP, 'reaper_mismatch.log');
  const run = spawnSync(process.execPath,
    [path.join(ROOT, 'tools', 'launcher_reaper.cjs'), path.join(WA_TMP, 'not_the_lock.json'), '4242'], {
      cwd: ROOT, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, BM26_LAUNCHER_LOCK: path.join(WA_TMP, 'other.json'), BM26_SIM_CONFIG: WA_CFG,
        BM26_REAPER_LOG: logPath },
    });
  assert.equal(run.status, 2, 'reaping the wrong stack is worse than not reaping — it refuses');
  assert.match(fs.readFileSync(logPath, 'utf8'), /refusing to start/);
});

test('W-A5: the launcher starts the sentinel right after it writes the lock', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const writeIdx = src.indexOf('writeLock({');
  const reaperIdx = src.indexOf('startReaper()', writeIdx);
  const firstChildIdx = src.indexOf("startChild('sim'", writeIdx);
  assert.ok(writeIdx > 0 && reaperIdx > writeIdx, 'the sentinel needs a lock to watch');
  assert.ok(reaperIdx < firstChildIdx,
    'the sentinel must exist BEFORE the first child does, or a death in between orphans it');
  // It must outlive us: detached, unref'd, and never in `children`.
  const fn = src.slice(src.indexOf('function startReaper'), src.indexOf('async function cmdStop'));
  assert.match(fn, /detached: true/);
  assert.match(fn, /\.unref\(\)/);
  assert.ok(!/children\.set/.test(fn), 'a sentinel in `children` would be torn down with the stack it must outlive');
});

// ════════════════════════════════════════════════════════════════════════
// _262 · docs/62 W-B (the supervised Expo Go Metro + the stale-Metro guard)
//        and W-C (rebuild-pad + auto-rebuild on stale/missing static export)
//
// Same rules as the W-A block above: SCRATCH ports (174xx — deliberately clear
// of W-A's 173xx and of the 78xx map the sibling suites use), a SCRATCH lock, a
// SCRATCH pad directory, and only ever processes this file spawned itself.
// Nothing here touches 6966-6972, 5568, 6981 or 7175, and — critically — no test
// here ever runs `expo export` into the real `CaptainPad/dist`, which is the
// LIVE :6967 surface: `rebuildPad` takes an injected exporter and a scratch
// padDir, and the CLI case is pointed at a scratch dir by BM26_REBUILD_PAD_DIR.
//
// Mutation notes sit next to the assertions they protect.
// ════════════════════════════════════════════════════════════════════════

const WB_TMP = path.join(os.homedir(), 'tmp', `bm26_wb_${process.pid}`);
fs.mkdirSync(WB_TMP, { recursive: true });

function wbDir(name) {
  const dir = path.join(WB_TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── W-B1 · `--with-native-pad`: a supervised Metro on a static profile ────

test('W-B1: the native-pad flag is allowed on static profiles and REFUSED BY NAME on expo ones', () => {
  assert.deepEqual(launcher.resolveNativePadRequest('prod', 'static', true),
    { enabled: true, refusal: null }, 'prod serves the web pad from dist — the Metro is the missing native half');
  assert.deepEqual(launcher.resolveNativePadRequest('prod', 'static', false),
    { enabled: false, refusal: null }, 'not requested is not enabled');

  // MUTATION: relax resolveNativePadRequest to allow any mode and both of these
  // go red. ONE Metro per project — two race node_modules/.cache.
  for (const name of ['dev', 'dev-lite']) {
    const verdict = launcher.resolveNativePadRequest(name, 'expo', true);
    assert.equal(verdict.enabled, false, `${name} must not gain a second Metro`);
    assert.match(verdict.refusal, /--with-native-pad is only valid/);
    assert.ok(verdict.refusal.includes(`profile '${name}'`), 'the refusal names the profile');
    assert.match(verdict.refusal, /Two Metros race node_modules\/\.cache/);
  }
  // A profile that serves no CaptainPad at all is refused too, and says so.
  assert.match(launcher.resolveNativePadRequest('x', null, true).refusal, /no CaptainPad at all/);
});

test('W-B1: the flag DEMANDS its port key — and only when the flag is present', () => {
  // The SHIPPED map carries the standard native-Metro slot. Read the file
  // directly — this suite runs under a BM26_SIM_CONFIG scratch override, and the
  // point of this assertion is what simulation/config.yaml itself declares.
  const shipped = fs.readFileSync(path.join(SIM_DIR, 'config.yaml'), 'utf8');
  assert.match(shipped, new RegExp(`^${launcher.NATIVE_PAD_PORT_KEY}: 6981`, 'm'),
    'simulation/config.yaml pins :6981 as THE native-Metro slot (BM26 port-topology memory)');

  // A port map without the key: fine without the flag, LOUD with it.
  const cfg = path.join(WB_TMP, 'no_native_key.yaml');
  fs.writeFileSync(cfg, Object.entries(CFG_PORTS).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
  const had = process.env.BM26_SIM_CONFIG;
  const run = (args) => spawnSync(process.execPath, ['-e',
    `process.env.BM26_SIM_CONFIG=${JSON.stringify(cfg)};`
    + `const l=require(${JSON.stringify(path.join(ROOT, 'launcher.js'))});`
    + `try { const p = l.readPorts(${args}); console.log('OK ' + JSON.stringify(p)); }`
    + 'catch (e) { console.log("THREW " + e.message); }'], { encoding: 'utf8', timeout: 60000 });
  assert.match(run('{}').stdout, /^OK /, 'a map without the key is valid until the flag asks for it');
  const demanded = run('{ requireNativePad: true }').stdout;
  // MUTATION: make the key unconditionally required (or unconditionally
  // optional) and one of these two goes red.
  assert.match(demanded, /^THREW /);
  assert.match(demanded, /--with-native-pad needs 'captainpad_native_port'/);
  assert.match(demanded, /6981/, 'the failure names the standard slot instead of guessing one');
  assert.equal(process.env.BM26_SIM_CONFIG, had, 'the suite-wide config override is untouched');
});

test('W-B1: `status` grows the native row only for a stack that asked for it', () => {
  const ports = { ...CFG_PORTS, [launcher.NATIVE_PAD_PORT_KEY]: 17451 };
  const plain = launcher.healthCheckList(ports, 'prod').map((c) => c.name);
  assert.ok(!plain.includes(launcher.NATIVE_PAD_TAG),
    'an ordinary prod stack must not show a permanent ❌ for a Metro it never started');

  const withPad = launcher.healthCheckList(ports, 'prod', { withNativePad: true });
  const row = withPad.find((c) => c.name === launcher.NATIVE_PAD_TAG);
  assert.ok(row, 'the lock said this run has a native Metro — status must probe it');
  assert.equal(row.url, 'http://127.0.0.1:17451/');
  assert.equal(row.expect, 'ok');
  // A lock that claims the native pad while the port key is gone is an anomaly,
  // not something to render as a healthy stack.
  assert.throws(() => launcher.healthCheckList(CFG_PORTS, 'prod', { withNativePad: true }),
    /captainpad_native_port' is missing/);
});

test('W-B1: `status` reads withNativePad off the LOCK, and the boot records it there', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const writeCall = src.slice(src.indexOf('writeLock({'), src.indexOf('startReaper();'));
  assert.match(writeCall, /withNativePad: nativePad\.enabled/,
    'the lock is the only thing `status` and the sentinel can read after the fact');
  const status = src.slice(src.indexOf('async function cmdStatus'), src.indexOf('// ── `stop` →'));
  assert.match(status, /lock\.withNativePad === true/);
  assert.match(status, /readPorts\(\{ requireNativePad: withNativePad \}\)/);
});

test('W-B1: the native child is an ORDINARY supervised child — port, lock, teardown, readiness', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const block = src.slice(src.indexOf('if (nativePad.enabled) {', src.indexOf('// 3b.')),
    src.indexOf('// All relevant processes are confirmed up'));
  // It is a Metro: npx (the one shell-shim child class), `expo start`, NO --web.
  assert.match(block, /startChild\(NATIVE_PAD_TAG, 'npx',/);
  assert.match(block, /'expo', 'start', '--go', '--port', String\(nativePadPort\)/);
  assert.ok(!/'--web'/.test(block), "the native Metro serves Expo Go's manifest + bundles, not a web build");
  // Readiness, then the resolved pid — `npx` is the shell-wrapped child whose
  // child.pid is the cmd.exe wrapper (W-A2).
  assert.match(block, /waitForHttp\('captainpad native'/);
  assert.match(block, /recordResolvedChild\(NATIVE_PAD_TAG, nativePadPort\)/);
  // MUTATION: drop the stackPorts push and `stop`/the sentinel stop sweeping
  // :6981 — an orphaned Metro then survives every teardown, which is the exact
  // straggler this slice exists to remove.
  assert.match(src, /if \(nativePad\.enabled\) stackPorts\.push\(nativePadPort\);/);
  // It is NOT its own teardown path: startChild puts it in `children`, so the
  // ordinary teardown/reap reaches it with everything else.
  assert.ok(!/stopChild\(NATIVE_PAD_TAG/.test(src));
});

test('W-B1: the native pad makes LAN-host detection required, exactly as an expo profile does', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  assert.match(src, /const lanHostInfo = \(captainPadMode === 'expo' \|\| nativePad\.enabled\)/,
    'without it Metro bakes 127.0.0.1 into every native manifest the iPad fetches');
  // And the operator gets the URL Expo Go actually needs.
  assert.match(src, /exp:\/\/\$\{lanHost\}:\$\{nativePadPort\}/);
});

test('W-B1 CLI: `dev --with-native-pad` exits 2 with a named refusal and starts NOTHING', () => {
  const lockPath = path.join(WB_TMP, 'native_refusal.lock.json');
  try { fs.unlinkSync(lockPath); } catch { /* first run */ }
  const run = spawnSync(process.execPath, ['launcher.js', 'dev', launcher.NATIVE_PAD_FLAG, '--no-launch'], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, BM26_LAUNCHER_LOCK: lockPath, BM26_SIM_CONFIG: WA_CFG },
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  assert.equal(run.status, 2, `a bad flag is a USAGE error, not a runtime one:\n${output}`);
  assert.match(output, /--with-native-pad is only valid/);
  assert.match(output, /profile 'dev'/);
  assert.ok(!fs.existsSync(lockPath),
    'it must refuse BEFORE assertSingleInstance — a usage error may never take a running stack down');
});

test('W-B1 REAL SPAWN: the native Metro env contract — CI genuinely absent, bundle host a plain string', async (t) => {
  // The env contract is the half that has bitten live twice (a CI=true shell
  // freezing Metro; the {host,source} object reaching Metro as "[object
  // Object]"), so prove it through a REAL spawn of the REAL builder — no port
  // bound, no Metro started, no node_modules/.cache touched.
  const dir = wbDir('native_env');
  const probe = path.join(dir, 'env_probe.cjs');
  const out = path.join(dir, 'env_probe.json');
  fs.writeFileSync(probe, [
    "const fs = require('fs');",
    `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({`,
    "  hasCI: 'CI' in process.env, ci: process.env.CI === undefined ? null : process.env.CI,",
    '  host: process.env.REACT_NATIVE_PACKAGER_HOSTNAME,',
    '  browser: process.env.BROWSER, telemetry: process.env.EXPO_NO_TELEMETRY,',
    '}));',
  ].join('\n'));
  try { fs.unlinkSync(out); } catch { /* first run */ }

  const had = process.env.CI;
  process.env.CI = 'true';   // the parent shell that froze Metro's reloads, live
  try {
    const lanHost = launcher.detectLanHost(
      { 'Wi-Fi': [{ family: 'IPv4', internal: false, address: '10.0.0.7' }] }, null).host;
    const child = launcher.startChild(`${launcher.NATIVE_PAD_TAG}-env-probe`, 'node', [probe], dir,
      launcher.metroChildEnv(lanHost), () => true);
    const code = await new Promise((res) => child.once('exit', res));
    assert.equal(code, 0, 'the probe ran');
    const env = JSON.parse(fs.readFileSync(out, 'utf8'));
    // MUTATION: change `CI: null` to `CI: ''` (or drop it) in metroChildEnv →
    // red. Metro checks PRESENCE, and `CI=""` crashes Expo outright.
    assert.equal(env.hasCI, false, 'CI must be DELETED from the child, not overwritten');
    // MUTATION: pass the {host,source} object instead of .host → "[object Object]",
    // which Metro's dev-middleware feeds to new URL() and dies at boot.
    assert.equal(env.host, '10.0.0.7');
    assert.ok(!String(env.host).includes('[object'));
    assert.equal(env.browser, 'none', 'a show box must not have Metro open a browser');
    assert.equal(env.telemetry, '1');
  } finally {
    if (had === undefined) delete process.env.CI; else process.env.CI = had;
  }
});

test('W-B1: BOTH Metros run under the SAME env contract — one definition, not two', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  // Call sites only — the `function metroChildEnv(lanHost)` definition matches
  // the same shape, so it is excluded explicitly.
  const uses = (src.match(/(?<!function )metroChildEnv\(lanHost\)/g) || []).length;
  assert.equal(uses, 2, 'the expo-profile Metro and the native-pad Metro, both through the builder');
  // MUTATION: inline either env object again and this goes red — the hand-run
  // :6981 Metro drifting from the launcher's contract is exactly what W-B1 ends.
  assert.equal((src.match(/REACT_NATIVE_PACKAGER_HOSTNAME:/g) || []).length, 1,
    'exactly ONE place sets the bundle host');
  assert.equal((src.match(/^\s+CI: null,$/gm) || []).length, 1);
});

// ── W-B2 · the dependency-fingerprint guard kills the stale-Metro class ───

test('W-B2: the fingerprint depends on BOTH the manifest and the installed tree', () => {
  const f = launcher.metroDependencyFingerprint;
  const base = f('{"lockfileVersion":3}', 1000);
  assert.equal(f('{"lockfileVersion":3}', 1000), base, 'same inputs → same fingerprint');
  // MUTATION: drop the mtime term from metroDependencyFingerprint → red. A
  // re-install of the SAME package-lock is a different tree on disk, and a Metro
  // cache built against the old one still misses the new files.
  assert.notEqual(f('{"lockfileVersion":3}', 2000), base,
    'the same manifest re-installed is a different installed tree');
  // MUTATION: drop the lock-text term → red.
  assert.notEqual(f('{"lockfileVersion":3,"x":1}', 1000), base, 'a different manifest is a different state');
  // Concatenation must not be ambiguous ("ab"+"1" vs "a"+"b1").
  assert.notEqual(f('ab', 1), f('a', 'b1'));
});

test('W-B2: no stamp / a changed fingerprint clears the cache; an unchanged one does NOT', () => {
  const state = { fingerprint: 'aaa', lockMtimeMs: 1000, installedMtimeMs: 2000, lockPath: 'L', installedPath: 'I' };
  const noStamp = launcher.metroCacheGuard(state, null);
  assert.deepEqual([noStamp.refuse, noStamp.clear], [false, true]);
  assert.match(noStamp.why, /stale-Metro guard/);

  const changed = launcher.metroCacheGuard(state, { fingerprint: 'bbb' });
  assert.equal(changed.clear, true);
  assert.match(changed.why, /dependencies changed since the last Metro start/);

  // MUTATION: make the guard clear unconditionally → this goes red. `--clear` on
  // every boot costs minutes on the playa for nothing.
  const same = launcher.metroCacheGuard(state, { fingerprint: 'aaa' });
  assert.deepEqual([same.refuse, same.clear], [false, false]);
  assert.match(same.why, /unchanged/);
});

test('W-B2: a package-lock NEWER than the installed tree REFUSES the Metro, naming the fix', () => {
  const mk = (lockMtimeMs, installedMtimeMs) => launcher.metroCacheGuard(
    { fingerprint: 'aaa', lockMtimeMs, installedMtimeMs, lockPath: 'CaptainPad/package-lock.json', installedPath: 'CaptainPad/node_modules/.package-lock.json' },
    { fingerprint: 'aaa' });
  // MUTATION: delete the refusal branch and this goes red — that state produces
  // phantom `Unable to resolve` errors for files that exist (the live
  // TypefaceFontProvider incident) and no cache policy can fix it.
  const refused = mk(10_000_000, 1_000_000);
  assert.equal(refused.refuse, true);
  assert.equal(refused.clear, false, 'a refusal must not also pretend to have a cache plan');
  assert.match(refused.why, /is NEWER than the installed tree marker/);
  assert.match(refused.why, /npm install/);

  // npm writes the installed marker LAST, a few hundred ms after the manifest —
  // that ordering slack must not read as a stale tree.
  assert.equal(mk(1_000_400, 1_000_000).refuse, false, 'one npm install writes both within a second');
  assert.ok(launcher.INSTALL_WRITE_ORDER_SLACK_MS >= 1000 && launcher.INSTALL_WRITE_ORDER_SLACK_MS <= 60000,
    'the slack is write ordering, not tolerance for a stale tree');
  assert.equal(mk(1_000_000 + launcher.INSTALL_WRITE_ORDER_SLACK_MS + 1, 1_000_000).refuse, true);
});

test('W-B2: the dependency state is read from disk, and an uninstalled tree fails BY NAME', () => {
  const dir = wbDir('depstate');
  const lockFile = path.join(dir, 'package-lock.json');
  const marker = path.join(dir, '.package-lock.json');
  fs.writeFileSync(lockFile, '{"lockfileVersion":3}');
  assert.throws(() => launcher.readMetroDependencyState({ lockPath: lockFile, installedPath: marker }),
    /npm's installed-tree marker/,
    'a node_modules with no npm marker cannot be fingerprinted — say so, never guess');
  fs.writeFileSync(marker, '{}');
  const state = launcher.readMetroDependencyState({ lockPath: lockFile, installedPath: marker });
  assert.equal(state.fingerprint,
    launcher.metroDependencyFingerprint('{"lockfileVersion":3}', fs.statSync(marker).mtimeMs));
  assert.throws(() => launcher.readMetroDependencyState({ lockPath: path.join(dir, 'nope.json'), installedPath: marker }),
    /the CaptainPad package-lock/);
});

test('W-B2: `--clear` is appended ONLY on the guard\'s say-so, and only ever to a Metro', () => {
  const args = ['expo', 'start', '--port', '6981'];
  assert.deepEqual(launcher.metroArgs(args, { clear: true }), [...args, '--clear']);
  // MUTATION: make metroArgs always append and this goes red.
  assert.deepEqual(launcher.metroArgs(args, { clear: false }), args);
  assert.deepEqual(launcher.metroArgs(args, null), args, 'no guard (no Metro this boot) → untouched args');

  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  // BOTH Metro call sites go through it — the dev profile's and the native pad's.
  assert.equal((src.match(/metroArgs\(\[/g) || []).length, 2);
  // The stamp is written only AFTER readiness: a Metro that never came up must
  // not certify its own cache.
  const expoBlock = src.slice(src.indexOf("} else if (captainPadMode === 'expo') {"), src.indexOf('// 3b.'));
  assert.ok(expoBlock.indexOf("waitForHttp('captainpad web'") < expoBlock.indexOf('markMetroReady(metroState)'));
  const nativeBlock = src.slice(src.indexOf('// 3b.'), src.indexOf('// All relevant processes are confirmed up'));
  assert.ok(nativeBlock.indexOf("waitForHttp('captainpad native'") < nativeBlock.indexOf('markMetroReady(metroState)'));
});

test('W-B1: `--with-native-pad` forces Expo Go mode (`--go`) on the native Metro only', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  // expo-dev-client in CaptainPad's dependencies flips `expo start`'s default
  // to Development Build mode, which Expo Go cannot load — the native pad
  // child must pin `--go` or the iPad times out on a healthy Metro.
  const nativeBlock = src.slice(src.indexOf('// 3b.'), src.indexOf('// All relevant processes are confirmed up'));
  assert.match(nativeBlock, /metroArgs\(\['expo', 'start', '--go', '--port'/,
    'the native-pad Metro must ask for Expo Go mode explicitly');
  // The dev profile's WEB Metro serves a browser, not Expo Go — it must NOT
  // inherit the flag. MUTATION: add --go to the web call site and this goes red.
  const expoBlock = src.slice(src.indexOf("} else if (captainPadMode === 'expo') {"), src.indexOf('// 3b.'));
  assert.ok(!expoBlock.includes("'--go'"), 'the web Metro must not request Expo Go mode');
});

test('W-B2: the guard refusal reaches PREFLIGHT — before the running stack can be claimed', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const fn = src.slice(src.indexOf('function validate(opts, profileDef)'), src.indexOf('// ── The spawn contract'));
  assert.match(fn, /metroGuard = metroCacheGuard\(metroState, readMetroFingerprintStamp\(\)\)/);
  assert.match(fn, /if \(metroGuard\.refuse\) problems\.push\(metroGuard\.why\)/);
  // validate() runs BEFORE assertSingleInstance (report _115 L6/P1-5) — pin it,
  // because that ordering is what stops a refusal from first killing the show.
  const main = src.slice(src.indexOf('async function main()'));
  assert.ok(main.indexOf('validate(opts, profileDef)') < main.indexOf('await assertSingleInstance'));
  // A Metro child also needs CaptainPad's dependency tree, which a STATIC
  // profile otherwise (correctly) does not require.
  assert.match(fn, /if \(nativePad\.enabled\) problems\.push\(\.\.\.captainPadMetroDependencyProblems\(\)\)/);
});

// ── W-C1 · rebuild-pad: the ONE dist-refresh path, serialized ─────────────

test('W-C1: `rebuild-pad` is a real subcommand, routed before any profile handling', () => {
  assert.ok(launcher.SUBCOMMANDS.includes('rebuild-pad'));
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  assert.match(src, /if \(opts\.command === 'rebuild-pad'\) return cmdRebuildPad\(\);/);
  // It is the expo `web:build` command, verbatim, with CI deleted.
  const runner = src.slice(src.indexOf('function runPadExport'), src.indexOf('async function rebuildPad'));
  assert.match(runner, /'expo', 'export', '--platform', 'web', '-c'/);
  assert.match(runner, /CI: null/);
  // And the launcher tells operators to use it instead of a hand-run build.
  assert.match(src, /run `node launcher\.js rebuild-pad` manually/);
});

test('W-C1: the serialization guard refuses each hazard BY NAME, and passes when clear', () => {
  const clear = { rebuild: null, exports: [], stack: { hasMetro: false, metroReadyAt: null, unknownProfile: null } };
  assert.equal(launcher.rebuildPadGuard(clear).refuse, false);

  // MUTATION: drop any one of these branches and its assertion goes red.
  const another = launcher.rebuildPadGuard({ ...clear, rebuild: { pid: 4242, startedAt: 'then' } });
  assert.equal(another.refuse, true);
  assert.match(another.why, /another `launcher\.js rebuild-pad` is running \(pid 4242/);
  assert.match(another.why, /corrupt the metro cache/);

  const foreign = launcher.rebuildPadGuard({ ...clear, exports: [{ pid: 77, cmd: 'npx expo export --platform web' }] });
  assert.equal(foreign.refuse, true);
  assert.match(foreign.why, /already running outside this launcher \(pid 77/);
  assert.match(foreign.why, /One export at a time, machine-wide/);

  const warming = launcher.rebuildPadGuard({ ...clear, stack: { hasMetro: true, metroReadyAt: null, unknownProfile: null } });
  assert.equal(warming.refuse, true);
  assert.match(warming.why, /has not reported readiness yet/);
  // …and a Metro that DID finish warming is not a reason to refuse.
  assert.equal(launcher.rebuildPadGuard({
    ...clear, stack: { hasMetro: true, metroReadyAt: 'now', unknownProfile: null },
  }).refuse, false);

  const unknown = launcher.rebuildPadGuard({ ...clear, stack: { hasMetro: false, metroReadyAt: null, unknownProfile: 'zzz' } });
  assert.equal(unknown.refuse, true, 'an unknown profile cannot PROVE no Metro is warming');
  assert.match(unknown.why, /names profile 'zzz'/);
});

test('W-C1: which running stacks count as having a Metro', () => {
  assert.deepEqual(launcher.stackMetroState(null),
    { hasMetro: false, metroReadyAt: null, unknownProfile: null }, 'no stack, no Metro');
  assert.equal(launcher.stackMetroState({ profile: 'prod' }).hasMetro, false,
    'prod serves the prebuilt dist — no bundler runs');
  assert.equal(launcher.stackMetroState({ profile: 'dev' }).hasMetro, true);
  assert.equal(launcher.stackMetroState({ profile: 'dev-lite' }).hasMetro, true);
  // MUTATION: drop the withNativePad term and this goes red — the whole point of
  // W-B1 is that :6981 is a launcher-owned Metro now.
  assert.equal(launcher.stackMetroState({ profile: 'prod', withNativePad: true }).hasMetro, true);
  assert.equal(launcher.stackMetroState({ profile: 'prod', metroReadyAt: 'T' }).metroReadyAt, 'T');
  assert.equal(launcher.stackMetroState({ profile: 'nope' }).unknownProfile, 'nope');
});

test('W-C1: the `expo export` process scan is TIGHT — no shell wrapper reads as an export', () => {
  const scan = (lines) => launcher.runningExpoExports({
    execFileSync: () => lines.join('\n'), selfPid: -1,
  }).map((f) => f.pid);
  assert.deepEqual(scan(['1234\tcmd.exe /c npx expo export --platform web -c']), [1234],
    "Windows shows the wrapper carrying the literal `expo export`");
  assert.deepEqual(scan(['555\tnode C:\\x\\node_modules\\expo\\bin\\cli export --platform web -c']), [555],
    "…and the node process carrying expo's resolved CLI entrypoint");
  assert.deepEqual(scan(['556 node /x/node_modules/expo/bin/cli export --platform web']), [556]);
  // MUTATION: loosen the signatures to `expo` + `export` anywhere and BOTH of
  // these go red — every Git-Bash wrapper on this box exports environment
  // variables, and a rebuild that refuses at random is a rebuild nobody runs.
  assert.deepEqual(scan(["36380\tbash.exe -c export TEMP='x' && cd expo && ls"]), []);
  assert.deepEqual(scan(['777\tnode /x/node_modules/expo/bin/cli start --port 6981']), [],
    'a running Metro is not a running export');
  assert.deepEqual(launcher.runningExpoExports({
    execFileSync: () => `${process.pid}\tnpx expo export --platform web`,
  }), [], 'we never count ourselves');
  // Enumeration failure is refused, never treated as "nothing is running".
  assert.throws(() => launcher.runningExpoExports({
    execFileSync: () => { throw new Error('no powershell'); },
  }), /Refusing to export blind/);
});

test('W-C1: a rebuild lock left by a DEAD export is reclaimed loudly, not treated as a live rebuild', async () => {
  const lockPath = path.join(WB_TMP, 'reclaim.lock.json');
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999, startedAt: 'then' }));
  const { result, stderr } = await captureStderr(async () => launcher.rebuildPadState({
    rebuildLockPath: lockPath, listExpoExports: () => [], readLock: () => null,
  }));
  assert.equal(result.rebuild, null, 'a crashed export must not block every future rebuild');
  assert.match(stderr, /Reclaiming the rebuild lock/);
  assert.match(stderr, /dead pid 999999/);
  // A live one, though, is exactly what serialization is for.
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: 'now' }));
  const live = launcher.rebuildPadState({ rebuildLockPath: lockPath, listExpoExports: () => [], readLock: () => null });
  assert.equal(live.rebuild.pid, process.pid);
  // An unreadable serialization lock is never "probably fine".
  fs.writeFileSync(lockPath, 'not json');
  assert.throws(() => launcher.rebuildPadState({ rebuildLockPath: lockPath, listExpoExports: () => [], readLock: () => null }),
    /does not parse/);
  fs.unlinkSync(lockPath);
});

// A scratch CaptainPad: enough of one for rebuildPad's preflight, and NEVER the
// real tree — CaptainPad/dist is the live :6967 surface.
function scratchPad(name) {
  const dir = wbDir(name);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  return { dir, dist: path.join(dir, 'dist'), lock: path.join(dir, 'rebuild.lock.json') };
}

function fakeExport(pad, opts = {}) {
  return async () => {
    if (opts.delayMs) await sleep(opts.delayMs);
    if (opts.code !== undefined && opts.code !== 0) return { code: opts.code, signal: null };
    fs.mkdirSync(path.join(pad.dist, '_expo', 'static', 'js', 'web'), { recursive: true });
    if (!opts.noIndex) fs.writeFileSync(path.join(pad.dist, 'index.html'), '<html></html>');
    if (!opts.noBundle) {
      fs.writeFileSync(path.join(pad.dist, '_expo', 'static', 'js', 'web', `entry-${opts.hash || 'abc123'}.js`), '//');
    }
    return { code: 0, signal: null };
  };
}

const rebuildDeps = (pad, extra = {}) => ({
  padDir: pad.dir, distDir: pad.dist, rebuildLockPath: pad.lock,
  listExpoExports: () => [], readLock: () => null, log: () => {}, ...extra,
});

test('W-C1: a successful rebuild is proven STRUCTURALLY — index rewritten, bundle named, lock released', async () => {
  const pad = scratchPad('rebuild_ok');
  const lines = [];
  const result = await launcher.rebuildPad(rebuildDeps(pad, {
    runExport: fakeExport(pad, { hash: 'deadbeef' }), log: (m) => lines.push(String(m)),
  }));
  assert.deepEqual([result.ok, result.code], [true, 0]);
  assert.deepEqual(result.bundles, ['entry-deadbeef.js']);
  const text = lines.join('\n');
  assert.match(text, /entry bundle: entry-deadbeef\.js/, 'the operator verifies the hash changed on the iPad');
  // D5: in place, while serving, no restart of anything.
  assert.match(text, /Rebuilt WHILE SERVING/);
  assert.match(text, /reload the iPad now/);
  assert.ok(!fs.existsSync(pad.lock), 'the serialization lock is released on success');
});

test('W-C1: every failure mode is a LOUD non-zero, never a half-built dist reported as fine', async () => {
  // No dependency tree at all.
  const bare = { dir: wbDir('rebuild_bare'), dist: path.join(WB_TMP, 'rebuild_bare', 'dist'), lock: path.join(WB_TMP, 'bare.lock.json') };
  let out = await captureStderr(() => launcher.rebuildPad(rebuildDeps(bare, { runExport: () => { throw new Error('must not run'); } })));
  assert.equal(out.result.code, 1);
  assert.match(out.stderr, /node_modules missing/);

  // A failing export.
  const failing = scratchPad('rebuild_fail');
  out = await captureStderr(() => launcher.rebuildPad(rebuildDeps(failing, { runExport: fakeExport(failing, { code: 1 }) })));
  assert.equal(out.result.code, 1);
  assert.match(out.stderr, /expo export` failed/);
  assert.ok(!fs.existsSync(failing.lock), 'the lock is released even when the export fails');

  // Exit 0 with nothing built, and exit 0 with a stale index — both refused.
  const empty = scratchPad('rebuild_empty');
  out = await captureStderr(() => launcher.rebuildPad(rebuildDeps(empty, { runExport: fakeExport(empty, { noIndex: true }) })));
  assert.equal(out.result.code, 1);
  assert.match(out.stderr, /does not exist — nothing was built/);

  const stale = scratchPad('rebuild_stale');
  fs.mkdirSync(stale.dist, { recursive: true });
  fs.writeFileSync(path.join(stale.dist, 'index.html'), 'old');
  const longAgo = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(stale.dist, 'index.html'), longAgo, longAgo);
  // MUTATION: trust the exit code alone (drop the mtime assertion) → red. An
  // export that exits 0 without rewriting the index leaves the iPad on the OLD
  // build while the command says success.
  out = await captureStderr(() => launcher.rebuildPad(rebuildDeps(stale, { runExport: async () => ({ code: 0, signal: null }) })));
  assert.equal(out.result.code, 1);
  assert.match(out.stderr, /was not rewritten/);

  // An index with no entry bundle is a blank page on the iPad, not a success.
  const noBundle = scratchPad('rebuild_nobundle');
  out = await captureStderr(() => launcher.rebuildPad(rebuildDeps(noBundle, { runExport: fakeExport(noBundle, { noBundle: true }) })));
  assert.equal(out.result.code, 1);
  assert.match(out.stderr, /No entry bundle found/);
});

test('W-C1 SERIALIZATION: two concurrent rebuilds — exactly ONE exports, the other refuses by name', async () => {
  const pad = scratchPad('rebuild_race');
  let exports = 0;
  const slow = async () => {
    exports += 1;
    await sleep(1500);
    fs.mkdirSync(path.join(pad.dist, '_expo', 'static', 'js', 'web'), { recursive: true });
    fs.writeFileSync(path.join(pad.dist, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(pad.dist, '_expo', 'static', 'js', 'web', 'entry-race.js'), '//');
    return { code: 0, signal: null };
  };
  const first = launcher.rebuildPad(rebuildDeps(pad, { runExport: slow }));
  await sleep(400); // the first has taken the lock and is inside the export
  const second = await captureStderr(() => launcher.rebuildPad(rebuildDeps(pad, {
    runExport: () => { throw new Error('the second export must never start'); },
  })));
  const firstResult = await first;

  // MUTATION: remove the lock write in rebuildPad (or the guard's rebuild branch)
  // and `exports` becomes 2 — which is the metro-cache corruption that produced a
  // blank-page bundle and cost a full debug cycle (report `_259`).
  assert.equal(exports, 1, 'exactly one export ran, machine-wide');
  assert.equal(firstResult.ok, true);
  assert.equal(second.result.code, 1);
  assert.equal(second.result.reason, 'serialized');
  assert.match(second.stderr, /REFUSING to rebuild the CaptainPad dist/);
  assert.match(second.stderr, new RegExp(`another \`launcher.js rebuild-pad\` is running \\(pid ${process.pid}`));
  assert.ok(!fs.existsSync(pad.lock), 'and the lock is released when the winner finishes');
});

test('W-C1 CLI: `launcher.js rebuild-pad` refuses a serialized run and exports NOTHING', () => {
  // BM26_REBUILD_PAD_DIR keeps this pointed at a scratch pad: the real
  // CaptainPad/dist is the LIVE :6967 surface and must never be one broken guard
  // away from being rewritten by a test.
  const pad = scratchPad('rebuild_cli');
  fs.writeFileSync(pad.lock, JSON.stringify({ pid: process.pid, startedAt: 'now' }));
  const run = spawnSync(process.execPath, ['launcher.js', 'rebuild-pad'], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000,
    env: {
      ...process.env,
      BM26_REBUILD_PAD_DIR: pad.dir,
      BM26_REBUILD_PAD_LOCK: pad.lock,
      BM26_LAUNCHER_LOCK: path.join(WB_TMP, 'no_such_stack.lock.json'),
      BM26_SIM_CONFIG: WA_CFG,
    },
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  assert.equal(run.status, 1, `a refused rebuild is a failure, loudly:\n${output}`);
  assert.match(output, /REFUSING to rebuild the CaptainPad dist/);
  assert.ok(!fs.existsSync(pad.dist), 'no export ran — the refusal happens BEFORE anything is spawned');
  fs.unlinkSync(pad.lock);
});

// ── W-C2 · stale/missing static dist auto-rebuilds before startup ─────────

function freshnessPad(name, opts = {}) {
  const pad = scratchPad(name);
  fs.mkdirSync(path.join(pad.dir, 'app'), { recursive: true });
  const sourcePath = path.join(pad.dir, 'app', 'x.tsx');
  if (opts.withSource !== false) {
    fs.writeFileSync(sourcePath, 'export {}');
    if (opts.sourceMtimeMs !== undefined) {
      const d = new Date(opts.sourceMtimeMs);
      fs.utimesSync(sourcePath, d, d);
    }
  }
  if (opts.withDist !== false) {
    fs.mkdirSync(pad.dist, { recursive: true });
    fs.writeFileSync(path.join(pad.dist, 'index.html'), '<html></html>');
    if (opts.distMtimeMs !== undefined) {
      const d = new Date(opts.distMtimeMs);
      fs.utimesSync(path.join(pad.dist, 'index.html'), d, d);
    }
  }
  return { ...pad, sourcePath };
}

function ensureDeps(pad, extra = {}) {
  return {
    padDir: pad.dir,
    distDir: pad.dist,
    rebuildLockPath: pad.lock,
    listExpoExports: () => [],
    readLock: () => null,
    log: () => {},
    ...extra,
  };
}

test('W-C2: the newest source mtime is found across the CaptainPad source trees', () => {
  const dir = wbDir('staleness');
  for (const sub of ['app', 'components/nested', 'hooks']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'app', 'a.tsx'), '');
  fs.writeFileSync(path.join(dir, 'components', 'nested', 'deep.tsx'), '');
  fs.writeFileSync(path.join(dir, 'hooks', 'h.ts'), '');
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(dir, 'app', 'a.tsx'), old, old);
  fs.utimesSync(path.join(dir, 'hooks', 'h.ts'), old, old);

  const newest = launcher.newestSourceMtime(dir);
  assert.ok(newest.path.endsWith('deep.tsx'), 'the walk recurses — a nested edit is still an edit');
  // `utils` does not exist in this scratch tree: a missing subdir is not a
  // staleness signal, and must not throw.
  assert.ok(launcher.CAPTAINPAD_SOURCE_DIRS.includes('utils'));
  assert.equal(launcher.newestSourceMtime(dir, ['does_not_exist']), null);
  // node_modules/dist are excluded BY CONSTRUCTION (they are not in the list) —
  // pin it, or an export would forever mark itself stale.
  assert.ok(!launcher.CAPTAINPAD_SOURCE_DIRS.includes('node_modules'));
  assert.ok(!launcher.CAPTAINPAD_SOURCE_DIRS.includes('dist'));
});

test('W-C2: the stale-dist verdict names the newer source and never offers a launch-anyway escape hatch', () => {
  const fresh = launcher.distStalenessVerdict(2000, { path: 'CaptainPad/app/x.tsx', mtimeMs: 1000 });
  assert.equal(fresh.stale, false);
  const stale = launcher.distStalenessVerdict(1000, { path: path.join(ROOT, 'CaptainPad', 'app', 'x.tsx'), mtimeMs: 2000 });
  assert.equal(stale.stale, true);
  assert.match(stale.why, /is NEWER than the static export/);
  assert.match(stale.why, /docs\/62 W-C2/);
  assert.ok(!/launch anyway/i.test(stale.why));
  assert.equal(launcher.distStalenessVerdict(1000, null).stale, false);
});

test('W-C2: readCaptainPadStaticFreshness reports fresh, stale, and missing states', () => {
  const now = Date.now();
  const freshPad = freshnessPad('fresh_read', { distMtimeMs: now, sourceMtimeMs: now - 1000 });
  const fresh = launcher.readCaptainPadStaticFreshness(ensureDeps(freshPad));
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.missing, false);
  assert.equal(fresh.stale, false);

  const stalePad = freshnessPad('stale_read', { distMtimeMs: now - 5000, sourceMtimeMs: now });
  const stale = launcher.readCaptainPadStaticFreshness(ensureDeps(stalePad));
  assert.equal(stale.fresh, false);
  assert.equal(stale.stale, true);

  const missingPad = freshnessPad('missing_read', { withDist: false });
  const missing = launcher.readCaptainPadStaticFreshness(ensureDeps(missingPad));
  assert.equal(missing.fresh, false);
  assert.equal(missing.missing, true);
});

test('W-C2: a fresh static export is a no-op — rebuild is never invoked', async () => {
  const pad = freshnessPad('ensure_fresh', {
    distMtimeMs: Date.now(),
    sourceMtimeMs: Date.now() - 1000,
  });
  let rebuilds = 0;
  const result = await launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
    rebuild: async () => { rebuilds += 1; return { ok: true, code: 0 }; },
  }));
  assert.deepEqual([result.ok, result.rebuilt, rebuilds], [true, false, 0]);
});

test('W-C2: a stale static export triggers rebuild + recheck, then startup may continue', async () => {
  const pad = freshnessPad('ensure_stale_ok', {
    distMtimeMs: Date.now() - 5000,
    sourceMtimeMs: Date.now(),
  });
  let rebuilds = 0;
  const lines = [];
  const result = await launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
    log: (m) => lines.push(String(m)),
    rebuild: async (deps) => {
      rebuilds += 1;
      return launcher.rebuildPad({
        ...deps,
        runExport: fakeExport(pad, { hash: 'fresh123' }),
      });
    },
  }));
  assert.deepEqual([result.ok, result.rebuilt, rebuilds], [true, true, 1]);
  assert.match(lines.join('\n'), /Rebuilding the static export automatically/);
  assert.match(lines.join('\n'), /fresh — continuing startup/);
  assert.equal(launcher.readCaptainPadStaticFreshness(ensureDeps(pad)).fresh, true);
});

test('W-C2: a missing static export triggers rebuild before startup', async () => {
  const pad = freshnessPad('ensure_missing_ok', { withDist: false });
  let rebuilds = 0;
  const lines = [];
  const result = await launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
    log: (m) => lines.push(String(m)),
    rebuild: async (deps) => {
      rebuilds += 1;
      return launcher.rebuildPad({
        ...deps,
        runExport: fakeExport(pad, { hash: 'frommissing' }),
      });
    },
  }));
  assert.deepEqual([result.ok, result.rebuilt, rebuilds], [true, true, 1]);
  assert.match(lines.join('\n'), /export missing — rebuilding automatically/);
});

test('W-C2: rebuild failure aborts startup loudly — no services, no prompt', async () => {
  const pad = freshnessPad('ensure_fail', {
    distMtimeMs: Date.now() - 5000,
    sourceMtimeMs: Date.now(),
  });
  let exitCode = null;
  const { stderr } = await captureStderr(async () => launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
    exit: (code) => { exitCode = code; },
    rebuild: async () => ({ ok: false, code: 1, reason: 'export failed' }),
  })));
  assert.equal(exitCode, 1);
  assert.match(stderr, /rebuild failed — aborting startup/);
  assert.ok(!/launch anyway/i.test(stderr));
});

test('W-C2: still-stale output after rebuild aborts startup', async () => {
  const pad = freshnessPad('ensure_still_stale', {
    distMtimeMs: Date.now() - 5000,
    sourceMtimeMs: Date.now(),
  });
  let exitCode = null;
  const { stderr } = await captureStderr(async () => launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
    exit: (code) => { exitCode = code; },
    rebuild: async () => {
      // "Succeeded" without rewriting dist — freshness stays stale.
      return { ok: true, code: 0 };
    },
  })));
  assert.equal(exitCode, 1);
  assert.match(stderr, /still STALE after rebuild/);
});

test('W-C2: expo profiles and stacks without CaptainPad skip auto-rebuild entirely', async () => {
  let rebuilds = 0;
  const bump = async () => { rebuilds += 1; return { ok: true, code: 0 }; };
  assert.deepEqual(await launcher.ensureCaptainPadStaticExport('expo', { rebuild: bump }),
    { ok: true, rebuilt: false, skipped: true });
  assert.deepEqual(await launcher.ensureCaptainPadStaticExport(null, { rebuild: bump }),
    { ok: true, rebuilt: false, skipped: true });
  assert.equal(rebuilds, 0);
});

test('W-C2: non-interactive shells behave the same — no prompt path exists', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  assert.ok(!/readline|launch anyway|prompt\(/i.test(src),
    'staleness self-heals automatically — there must be no interactive prompt');

  const pad = freshnessPad('ensure_ci', {
    distMtimeMs: Date.now() - 5000,
    sourceMtimeMs: Date.now(),
  });
  const had = process.env.CI;
  process.env.CI = 'true';
  try {
    const result = await launcher.ensureCaptainPadStaticExport('static', ensureDeps(pad, {
      rebuild: async (deps) => launcher.rebuildPad({
        ...deps,
        runExport: fakeExport(pad, { hash: 'ciok' }),
      }),
    }));
    assert.equal(result.ok, true);
  } finally {
    if (had === undefined) delete process.env.CI; else process.env.CI = had;
  }
});

test('W-C2 WIRING: ensure runs after validate and BEFORE assertSingleInstance / any child spawn', () => {
  const src = fs.readFileSync(path.join(ROOT, 'launcher.js'), 'utf8');
  const main = src.slice(src.indexOf('async function main()'));
  const validateIdx = main.indexOf('validate(opts, profileDef)');
  const ensureIdx = main.indexOf('ensureCaptainPadStaticExport(captainPadMode)');
  const singleIdx = main.indexOf('await assertSingleInstance');
  const simIdx = main.indexOf("startChild('sim'");
  // MUTATION: move ensure after assertSingleInstance, or drop it entirely, and
  // one of these ordering assertions goes red — services must not start stale.
  assert.ok(validateIdx >= 0 && ensureIdx > validateIdx,
    'freshness self-heal runs only after preflight passes');
  assert.ok(ensureIdx < singleIdx,
    'rebuild must finish before the running stack can be force-claimed');
  assert.ok(ensureIdx < simIdx,
    'rebuild must finish before the first supervised child spawns');
  const validateFn = src.slice(src.indexOf('function validate(opts, profileDef)'), src.indexOf('// ── The spawn contract'));
  assert.ok(!/distStalenessVerdict/.test(validateFn),
    'validate() must not warn-and-continue on staleness — ensure owns that');
});
