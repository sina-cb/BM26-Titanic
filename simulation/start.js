#!/usr/bin/env node
/**
 * start.js — Reads ports from simulation/config.yaml and launches, then
 * SUPERVISES, the four sim-stack servers: the static HTTP server, the save
 * server, and the sACN input + output bridges.
 *
 * SUPERVISION (report 20260725_115 L1/P0 — "start.js is blind to the death of
 * every server it owns, and every health surface reports GREEN"):
 *   - Every child's death (crash / `kill -9`) is DETECTED and the child is
 *     restarted with a bounded budget (MAX_RESTARTS in RESTART_WINDOW_MS). A
 *     restart is a one-second blink, not a blackout.
 *   - A child that FREEZES (alive but unresponsive — the other dark-ship mode,
 *     cf. the engine wedged 296 s on /timeline/overview, report _113 J1) is
 *     caught by a WATCHDOG that health-probes every child; FREEZE_FAILURES
 *     consecutive probe misses on a live process ⇒ kill it ⇒ the restart path
 *     brings it back. A frozen server is treated exactly like a dead one.
 *   - A child that keeps dying past its restart budget is NOT hidden by an
 *     endless restart loop (that would be a fallback — codex P0). The
 *     supervisor ESCALATES: it logs loudly and exits non-zero, so the launcher's
 *     crash path (teardown) fires and the show-server supervisor relaunches.
 *
 * The liveness probe is an ordinary HTTP GET: the http/save servers answer 2xx;
 * the two sACN bridges are `ws` servers that answer a plain GET with 426 Upgrade
 * Required — ANY HTTP status proves the event loop is alive (a frozen loop can
 * neither answer 426 nor accept the upgrade), and a bare GET fires no WS
 * `connection` event, so it never pollutes the input bridge's sim-client census.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const { loadSimPorts } = require('./lib/load_ports.cjs');
const processPriority = require('../tools/process_priority.cjs');

// OS priority for the frame-relaying sACN bridges. Default HIGH so a bridge is
// never starved by Chrome's foreground boost (same symptom as a starved
// engine). The launcher passes BM26_BRIDGE_PRIORITY; a bare `node start.js`
// still defaults to 'high'. See tools/process_priority.cjs.
const BRIDGE_PRIORITY = processPriority.normalizePriorityRequest(
  process.env.BM26_BRIDGE_PRIORITY, { fallback: 'high' }) || 'high';

const IS_WIN = process.platform === 'win32';

// loadSimPorts honors BM26_SIM_CONFIG (report _115 P2-6) so a test can run this
// whole constellation on throwaway ports without touching the live config.
const ports = loadSimPorts();
const HTTP_PORT = ports.http_port;
const SAVE_PORT = ports.save_port;
const SACN_PORT = ports.sacn_port;
const SACN_OUTPUT_PORT = ports.sacn_output_port;

// ── Scene selection via --scene <name> ──────────────────────────────────
const sceneIdx = process.argv.indexOf('--scene');
const sceneName = sceneIdx !== -1 && process.argv[sceneIdx + 1] ? process.argv[sceneIdx + 1] : 'titanic';
const sceneConfigPath = path.join(__dirname, 'scenes', sceneName, 'scene_config.yaml');

// ── Supervision policy ──────────────────────────────────────────────────
const MAX_RESTARTS = 5;              // per child, within the rolling window…
const RESTART_WINDOW_MS = 60000;     // …a child that dies more than this is a
                                     // persistent failure → escalate loudly.
const RESTART_BACKOFF_MS = 1000;     // brief pause before a restart (avoid a
                                     // tight crash-loop that pins a core).
const WATCHDOG_INTERVAL_MS = 10000;  // health-probe cadence
const HEALTH_TIMEOUT_MS = 4000;      // a probe slower than this counts as a miss
const FREEZE_FAILURES = 3;           // consecutive misses on a LIVE process ⇒
                                     // frozen ⇒ kill + restart.
// Absorb console-signal races before declaring a crash: on Windows a console
// Ctrl+C reaches every child at once and start.js can be the last to hear it.
const CRASH_VERDICT_DELAY_MS = IS_WIN ? 2000 : 300;

console.log(`[start] HTTP: ${HTTP_PORT}  Save: ${SAVE_PORT}  sACN Bridge: ${SACN_PORT}  sACN Output: ${SACN_OUTPUT_PORT}`);
console.log(`[start] Scene: ${sceneName}`);
console.log(`[start] Config: ${sceneConfigPath}`);
if (process.env.BM26_SIM_CONFIG) {
  console.log(`[start] BM26_SIM_CONFIG override active: ${process.env.BM26_SIM_CONFIG}`);
}
const sceneUrl = `http://localhost:${HTTP_PORT}/simulation/?scene=${sceneName}`;
console.log(`[start] Open: ${sceneUrl}`);

// ── Child specs — one entry per supervised server ───────────────────────
// spawn()   : (re)creates the ChildProcess. No shell for the bridges so
//             child.pid is the real node process os.setPriority can elevate.
// healthUrl : the liveness probe target (see the file header for the 426 note).
// bridge    : true ⇒ re-elevate OS priority after (re)start.
const SPECS = [
  {
    tag: 'http',
    label: 'HTTP server',
    spawn: () => spawn('npx', ['http-server', '../', '-p', String(HTTP_PORT), '-c-1', '--cors'], {
      stdio: 'inherit', cwd: __dirname, shell: IS_WIN,
    }),
    healthUrl: `http://127.0.0.1:${HTTP_PORT}/simulation/`,
    bridge: false,
  },
  {
    tag: 'save',
    label: 'Save server',
    spawn: () => spawn('node', ['server/save-server.js'], { stdio: 'inherit', cwd: __dirname }),
    healthUrl: `http://127.0.0.1:${SAVE_PORT}/list-scenes`,
    bridge: false,
  },
  {
    tag: 'sacn-in',
    label: 'sACN input bridge',
    spawn: () => {
      const args = ['server/sacn_bridge.js'];
      if (sceneName) args.push('--scene', sceneName);
      return spawn('node', args, { stdio: 'inherit', cwd: __dirname });
    },
    healthUrl: `http://127.0.0.1:${SACN_PORT}/`,
    bridge: true,
  },
  {
    tag: 'sacn-out',
    label: 'sACN output bridge',
    spawn: () => spawn('node', ['server/sacn_output_bridge.js'], { stdio: 'inherit', cwd: __dirname }),
    healthUrl: `http://127.0.0.1:${SACN_OUTPUT_PORT}/`,
    bridge: true,
  },
];

// Per-child runtime state, keyed by tag.
const state = new Map();
for (const spec of SPECS) {
  state.set(spec.tag, { spec, child: null, restarts: [], healthFails: 0, restartTimer: null });
}

let shuttingDown = false;

// Process exit goes through this indirection so tests can observe an escalation
// or a clean shutdown without the test runner itself being torn down.
let exitFn = (code) => process.exit(code);

let killTree = function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (IS_WIN) {
      // shell:true (http) means child.pid is the cmd wrapper — kill the tree.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch (err) {
    // Already gone.
  }
};

function elevateIfBridge(spec, child) {
  if (!spec.bridge || !child || !child.pid) return;
  processPriority.elevatePid(child.pid, BRIDGE_PRIORITY,
    { label: 'BridgePriority', logger: (m) => console.log(`[start] ${m}`) });
}

// Start (or restart) one child and wire its lifecycle handlers.
function startOne(spec) {
  const st = state.get(spec.tag);
  const child = spec.spawn();
  st.child = child;
  st.healthFails = 0;
  console.log(`[start] ${spec.label} (${spec.tag}) started (pid ${child.pid}).`);
  elevateIfBridge(spec, child);

  child.on('error', (err) => {
    if (shuttingDown) return;
    console.error(`[start] ❌ ${spec.label} failed to spawn: ${err.message}`);
    onChildGone(spec, null, null);
  });

  child.on('exit', (code, signal) => {
    if (st.child === child) st.child = null;
    if (shuttingDown) return;
    // A console Ctrl+C can kill the child before our own signal handler runs —
    // give the signal a moment to arrive before calling this a crash.
    setTimeout(() => {
      if (shuttingDown) return;
      onChildGone(spec, code, signal);
    }, CRASH_VERDICT_DELAY_MS);
  });
}

// A child died unexpectedly (crash, kill -9, or watchdog-killed freeze). Restart
// within budget; escalate loudly past it.
function onChildGone(spec, code, signal) {
  if (shuttingDown) return;
  const st = state.get(spec.tag);
  const now = Date.now();
  st.restarts = st.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
  st.restarts.push(now);
  const desc = signal ? `signal=${signal}` : `code=${code}`;

  if (st.restarts.length > MAX_RESTARTS) {
    console.error(
      `[start] ❌ ${spec.label} (${spec.tag}) died ${st.restarts.length} times in ` +
      `${RESTART_WINDOW_MS / 1000}s (${desc}) — that is a persistent failure, not a blip. ` +
      `NOT restart-looping over it (codex P0: no fallbacks). Escalating: the whole sim ` +
      `stack will exit so the launcher tears down and the supervisor relaunches.`);
    escalate();
    return;
  }

  console.error(
    `[start] ⚠ ${spec.label} (${spec.tag}) exited unexpectedly (${desc}); ` +
    `restart ${st.restarts.length}/${MAX_RESTARTS} in ${RESTART_BACKOFF_MS}ms.`);
  if (st.restartTimer) clearTimeout(st.restartTimer); // never pile pending restarts
  st.restartTimer = setTimeout(() => {
    if (shuttingDown) return;
    startOne(spec);
  }, RESTART_BACKOFF_MS);
}

// Tear the whole sim stack down and exit non-zero (loud failure). The launcher
// supervises THIS process, so our exit fires its crash path.
function escalate() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (watchdogTimer) clearInterval(watchdogTimer);
  for (const st of state.values()) {
    if (st.restartTimer) clearTimeout(st.restartTimer);
    killTree(st.child);
  }
  // Give taskkill/SIGKILL a beat to land, then exit hard.
  setTimeout(() => exitFn(1), 500);
}

// ── Liveness probe ──────────────────────────────────────────────────────
// Resolves true if the server produced ANY HTTP response (2xx…5xx, incl. the
// bridges' 426) — proof the event loop is alive. Resolves false on connection
// refusal or timeout — dead or frozen.
let probeAlive = function probeAlive(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: HEALTH_TIMEOUT_MS }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); resolve(false); });
    req.on('error', () => resolve(false));
  });
};

// ── Watchdog — catches the FROZEN (alive-but-unresponsive) failure mode ──
let watchdogTimer = null;
async function watchdogTick() {
  if (shuttingDown) return;
  for (const spec of SPECS) {
    const st = state.get(spec.tag);
    // Skip a child that isn't currently up (it's mid-restart; the exit/backoff
    // path owns it). Only probe a process we believe is running.
    if (!st.child) { st.healthFails = 0; continue; }
    const probedChild = st.child;
    const alive = await probeAlive(spec.healthUrl);
    if (shuttingDown) return;
    // The child may have been replaced while we awaited — don't judge the new one.
    if (st.child !== probedChild) continue;
    if (alive) {
      if (st.healthFails > 0) {
        console.log(`[start] ✓ ${spec.label} (${spec.tag}) responsive again.`);
      }
      st.healthFails = 0;
      continue;
    }
    st.healthFails++;
    console.error(
      `[start] ⚠ ${spec.label} (${spec.tag}) health probe missed ` +
      `(${st.healthFails}/${FREEZE_FAILURES}) — ${spec.healthUrl}`);
    if (st.healthFails >= FREEZE_FAILURES) {
      console.error(
        `[start] 🧊 ${spec.label} (${spec.tag}) is FROZEN (alive but unresponsive after ` +
        `${FREEZE_FAILURES} probes) — killing it so it restarts. A dark, wedged server ` +
        `is a dark ship; treating it as a crash.`);
      st.healthFails = 0;
      killTree(probedChild); // exit handler → onChildGone → restart (bounded)
    }
  }
}

// ── Shutdown ────────────────────────────────────────────────────────────
function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (watchdogTimer) clearInterval(watchdogTimer);
  for (const st of state.values()) {
    if (st.restartTimer) clearTimeout(st.restartTimer);
    killTree(st.child);
  }
  setTimeout(() => exitFn(0), 300);
}

// ── Boot ────────────────────────────────────────────────────────────────
function boot() {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  for (const spec of SPECS) startOne(spec);
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);
  console.log(
    `[start] 🛡 Supervisor active — watching ${SPECS.length} servers ` +
    `(probe every ${WATCHDOG_INTERVAL_MS / 1000}s; up to ${MAX_RESTARTS} restarts / ` +
    `${RESTART_WINDOW_MS / 1000}s per server, then loud escalation).`);
}

// Run as a CLI only when invoked directly; importing gives tests the pure
// supervision internals without spawning anything (report _115 P2-6).
if (require.main === module) {
  boot();
}

module.exports = {
  SPECS, state, probeAlive, watchdogTick, onChildGone, startOne,
  isShuttingDown: () => shuttingDown,
  _setShuttingDown: (v) => { shuttingDown = v; },
  _setExitFn: (fn) => { exitFn = fn; },
  _setProbeFn: (fn) => { probeAlive = fn; },
  _setKillFn: (fn) => { killTree = fn; },
  constants: { MAX_RESTARTS, RESTART_WINDOW_MS, RESTART_BACKOFF_MS, FREEZE_FAILURES, WATCHDOG_INTERVAL_MS, HEALTH_TIMEOUT_MS },
};
