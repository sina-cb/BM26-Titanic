/**
 * port_cleanup.cjs — Offline-safe, zero-dependency port inspection + cleanup.
 *
 * Shared by launcher.js, simulation/start.js's pre-kill, and the marsin_engine
 * boot so NOTHING in the stack shells out to `npx kill-port` (which tries to
 * fetch the package from the network — fatal on the offline playa). Uses only
 * OS tools that are always present: `lsof`/`ps` on POSIX, `netstat`/`taskkill`/
 * PowerShell on Windows.
 *
 * Cleanup is IDENTITY-CHECKED: a process listening on one of our ports is only
 * killed if its command line matches a known stack entrypoint. Anything else is
 * left alone (and reported), so we never kill a process we don't own.
 *
 * It is also ARM-INTERLOCKED (report 20260815_233 F7): the sACN input bridge is
 * refused a kill while it holds an ARMED bench mirror. See the marker block
 * below for why that one process is special.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';

// `netstat -ano` / `lsof` output on a box with a large TCP connection table
// (tens of thousands of TIME_WAIT entries — common on a busy control machine)
// can run to several MB, which blows past execFileSync's default 1 MB maxBuffer
// and throws ENOBUFS — making freeStackPorts fatal and crashing EVERY non-dry-
// run engine boot. Give the port-inspection calls a generous ceiling so a large
// connection table can never turn port cleanup into a boot failure. Offline-safe
// (no network), and the buffer is only held transiently during parsing.
const PORT_SCAN_MAX_BUFFER = 64 * 1024 * 1024;

// Command-line fragments that identify a process as part of this stack.
const STACK_PROCESS_SIGNATURES = [
  'start.js', 'engine.js', 'save-server.js', 'sacn_bridge.js',
  'sacn_output_bridge.js', 'http-server', 'expo', 'metro', 'launcher.js',
];

// ── The BENCH MIRROR arm interlock (report 20260815_233 F7) ────────────────
//
// THE INCIDENT. On 2026-08-15 this module force-killed the UDP :5568 holder —
// which is `sacn_bridge.js` and nothing else — while a bench mirror was ARMED.
// `taskkill /T /F` gives the bridge no chance to run its all-zero DISARM
// blackout, so every mirrored box held its last composed frame: a lit rig that
// looks alive and is not, with the bridge that owned it gone. `_212` filed that
// as a coordination matter; `_229` §4 caught it happening, so it is a code guard
// now.
//
// WHY A FILE. Arming is process memory inside the bridge and its only live
// surface is the sim WebSocket — which a synchronous, zero-dependency,
// offline-safe killer cannot dial. So the bridge writes this marker on ARM and
// removes it on DISARM (see `simulation/server/sacn_bridge.js`), and the schema
// and path live HERE, with the consumer, so there is exactly one definition of
// both. It is NOT a fallback source of truth: it names a PID, and the guard
// believes it only while that PID is alive AND still looks like the bridge.
//
// The marker lives in `~/tmp` (gitignored, deploy-excluded) — never in the
// source tree, and never in `simulation/scenes/**`, which is tracked.
const DEFAULT_ARM_MARKER = path.join(os.homedir(), 'tmp', 'bm26_bench_mirror_armed.json');
const BENCH_MIRROR_ARM_MARKER = (typeof process.env.BM26_BENCH_MIRROR_ARM_MARKER === 'string'
  && process.env.BM26_BENCH_MIRROR_ARM_MARKER.trim() !== '')
  ? path.resolve(process.env.BM26_BENCH_MIRROR_ARM_MARKER.trim())
  : DEFAULT_ARM_MARKER;

/** The process whose kill this interlock protects, by command line. */
const ARM_MARKER_OWNER_SIGNATURE = 'sacn_bridge.js';
/** Operator override: the flag, and the env var for tools that reject flags. */
const FORCE_SACN_KILL_FLAG = '--force-sacn';
const FORCE_SACN_KILL_ENV = 'BM26_FORCE_SACN_KILL';

/**
 * Has the operator explicitly asked for the interlock to be overridden?
 *
 * Two spellings because the callers differ: the env var reaches a tool that
 * takes no options at all, and the flag serves anything whose argv this
 * process can see (`npm run kill-ports -- --force-sacn`, a direct `node`
 * invocation, and `launcher.js`, which requires this module in-process and so
 * accepts the flag by name — report 20260815_234).
 */
function forceSacnKillRequested() {
  return process.env[FORCE_SACN_KILL_ENV] === '1' || process.argv.includes(FORCE_SACN_KILL_FLAG);
}

/** Is this PID alive? EPERM means alive-but-not-ours, which is still alive. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Read the arm marker.
 *
 * @returns {{state:'absent'}|{state:'armed',marker:object}|{state:'corrupt',error:string}}
 */
function readArmMarker(markerPath = BENCH_MIRROR_ARM_MARKER) {
  let raw;
  try {
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { state: 'absent' };
    return { state: 'corrupt', error: `${markerPath} could not be read — ${err.message}` };
  }
  let marker;
  try {
    marker = JSON.parse(raw);
  } catch (err) {
    return { state: 'corrupt', error: `${markerPath} does not parse as JSON — ${err.message}` };
  }
  if (!marker || typeof marker !== 'object' || !Number.isInteger(marker.pid)) {
    return { state: 'corrupt', error: `${markerPath} carries no integer 'pid' — it cannot say which process is armed` };
  }
  return { state: 'armed', marker };
}

/**
 * Is this a `node --test` child? The marker is a LIVE-STACK interlock, and a
 * test process that wrote the production one would overwrite — and then delete
 * — the operator's real armed-mirror claim, silently disarming the guard while
 * the bench is armed. Same doctrine as `bench_mirror_state.cjs`'s
 * `assertWritableTarget`: the test seam is the env var, and the guard makes it
 * un-bypassable rather than optional.
 */
function isTestContext() {
  return typeof process.env.NODE_TEST_CONTEXT === 'string' && process.env.NODE_TEST_CONTEXT !== '';
}

/** Write the arm marker atomically. Called by the bridge on a successful ARM. */
function writeArmMarker(marker, markerPath = BENCH_MIRROR_ARM_MARKER) {
  if (!marker || !Number.isInteger(marker.pid)) {
    throw new Error('the bench-mirror arm marker must carry an integer pid');
  }
  if (isTestContext() && path.resolve(markerPath) === path.resolve(DEFAULT_ARM_MARKER)) {
    throw new Error(`refusing to write '${markerPath}': this process is a \`node --test\` child ` +
      '(NODE_TEST_CONTEXT is set) and that is the LIVE stack\'s arm interlock. A test that wrote ' +
      'it would overwrite — and then delete — the operator\'s real armed-mirror claim, leaving a ' +
      'live armed bench unprotected against a port sweep. Inject BM26_BENCH_MIRROR_ARM_MARKER.');
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const tmp = `${markerPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  fs.renameSync(tmp, markerPath);
  return markerPath;
}

/** Remove the arm marker. Returns true if one was there. Called on DISARM. */
function clearArmMarker(markerPath = BENCH_MIRROR_ARM_MARKER) {
  if (isTestContext() && path.resolve(markerPath) === path.resolve(DEFAULT_ARM_MARKER)
      && fs.existsSync(markerPath)) {
    throw new Error(`refusing to delete '${markerPath}': this process is a \`node --test\` child ` +
      'and that file is the LIVE stack\'s arm interlock — deleting it would leave a live armed ' +
      'bench unprotected against a port sweep. Inject BM26_BENCH_MIRROR_ARM_MARKER.');
  }
  try {
    fs.unlinkSync(markerPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Must this PID be left alone because it is a bridge holding an ARMED mirror?
 *
 * @param {number} pid
 * @param {object} [deps] test seams — the real filesystem/OS otherwise
 * @returns {null|{why:string, marker:object|null}} null = kill it, object = refuse
 */
function benchMirrorArmGuard(pid, deps = {}) {
  const read = deps.readMarker || readArmMarker;
  const alive = deps.isAlive || pidAlive;
  const cmdOf = deps.commandline || commandlineOf;
  const markerPath = deps.markerPath || BENCH_MIRROR_ARM_MARKER;

  const state = read(markerPath);
  if (state.state === 'absent') return null;

  const remedy = 'DISARM the bench mirror first (the sim\'s 🎛 Controllers header → DISARM), so ' +
    'the bridge blacks its destinations out before it goes. If you are certain this marker is ' +
    `stale, override with ${FORCE_SACN_KILL_ENV}=1 (or ${FORCE_SACN_KILL_FLAG} on a tool that ` +
    'forwards its argv) and kill it deliberately.';
  const stakes = 'A force-kill skips the mirror\'s all-zero blackout, so every mirrored box ' +
    'FREEZES on its last composed frame — a lit rig that looks alive and is not (reports _212, ' +
    '_229 §4).';

  if (state.state === 'corrupt') {
    // We cannot tell WHICH pid is armed, so the interlock covers every process
    // that looks like the bridge. Loud and specific — never a silent skip.
    if (!String(cmdOf(pid)).includes(ARM_MARKER_OWNER_SIGNATURE)) return null;
    return {
      marker: null,
      why: `the bench-mirror arm marker is UNREADABLE (${state.error}), so it cannot be proven ` +
        `that pid ${pid} — which is an sACN bridge — has no armed mirror. ${stakes} ${remedy} ` +
        `Deleting ${markerPath} is also a valid answer once you have checked the sim.`,
    };
  }

  const { marker } = state;
  if (marker.pid !== pid) return null;         // a different process entirely
  if (!alive(marker.pid)) return null;         // stale marker: the armed bridge is gone
  const cmd = String(cmdOf(pid));
  if (!cmd.includes(ARM_MARKER_OWNER_SIGNATURE)) return null;  // PID reuse, not the bridge

  const what = `'${marker.scene || '?'}' ← '${marker.sourceScene || '?'}'`;
  return {
    marker,
    why: `pid ${pid} is the sACN bridge and its BENCH MIRROR is ARMED (${what}, armed ` +
      `${marker.armedAt || 'at an unrecorded time'}; marker ${markerPath}). While armed it is ` +
      `the ONLY writer to the rig. ${stakes} ${remedy}`,
  };
}

/**
 * PIDs listening on a TCP port (or bound to a UDP port). POSIX uses lsof,
 * Windows uses netstat. Returns [] when nothing matches.
 * @param {number} port
 * @param {object} [opts]
 * @param {boolean} [opts.udp=false] inspect UDP instead of listening TCP
 * @returns {number[]}
 */
function listenersOnPort(port, opts = {}) {
  const udp = opts.udp === true;
  if (IS_WIN) {
    const out = execFileSync('netstat', ['-ano', '-p', udp ? 'udp' : 'tcp'], {
      encoding: 'utf8', maxBuffer: PORT_SCAN_MAX_BUFFER,
    });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      // TCP: "TCP <local> <remote> LISTENING <pid>"; UDP: "UDP <local> *:* <pid>"
      if (cols[0] !== (udp ? 'UDP' : 'TCP')) continue;
      if (!udp && cols[3] !== 'LISTENING') continue;
      if (cols[1] && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[cols.length - 1]));
    }
    return [...pids];
  }
  const sel = udp ? `-iUDP:${port}` : `-iTCP:${port}`;
  const args = udp ? ['-t', '-nP', sel] : ['-t', '-nP', sel, '-sTCP:LISTEN'];
  try {
    const out = execFileSync('lsof', args, { encoding: 'utf8', maxBuffer: PORT_SCAN_MAX_BUFFER });
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
  } catch (err) {
    if (err.status === 1) return []; // lsof exits 1 when nothing matches
    if (err.code === 'ENOENT') {
      throw new Error('lsof not found — install it or free the stack ports manually.');
    }
    throw err;
  }
}

/** Full command line of a PID ('' if the process is already gone). */
function commandlineOf(pid) {
  try {
    if (IS_WIN) {
      const out = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, maxBuffer: 10 * 1024 * 1024 });
      return out.trim();
    }
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (err) {
    return '';
  }
}

/**
 * Kill a PID — unless the bench-mirror arm interlock forbids it.
 *
 * The refusal is LOUD and returned, never silent: callers that ignore the
 * return value simply do not kill, and the port they wanted stays held, which
 * is the safe direction. It does not throw, because every caller in the stack
 * invokes this from inside a port sweep and an exception there would turn a
 * protected bench into a failed launch.
 *
 * @param {number} pid
 * @param {object} [opts]
 * @param {boolean} [opts.force] bypass the interlock (the operator's explicit ask)
 * @param {object} [opts.guardDeps] test seams for `benchMirrorArmGuard`
 * @param {(msg:string)=>void} [opts.log] where the refusal goes (default console.error)
 * @returns {{pid:number, killed:boolean, refused:boolean, why:string|null}}
 */
function killPid(pid, opts = {}) {
  const guard = benchMirrorArmGuard(pid, opts.guardDeps || {});
  if (guard !== null && opts.force !== true && !forceSacnKillRequested()) {
    const log = opts.log || ((m) => console.error(m));
    log(`❌ REFUSING to kill pid ${pid} — ${guard.why}`);
    return { pid, killed: false, refused: true, why: guard.why };
  }
  if (guard !== null) {
    const log = opts.log || ((m) => console.error(m));
    log(`⚠ OVERRIDE: killing pid ${pid} although ${guard.why} — the mirrored boxes will FREEZE ` +
      'on their last composed frame, not go dark. Power-cycle or re-arm them.');
  }
  try {
    if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch (err) {
    // Already gone.
  }
  return { pid, killed: true, refused: false, why: null };
}

/**
 * Free a set of ports of OUR stale stack processes (identity-checked). Foreign
 * processes are never killed; their ports are returned so the caller can decide
 * (we let the subsequent bind fail loud with EADDRINUSE rather than touching
 * something we don't own).
 *
 * A process protected by the BENCH MIRROR arm interlock is neither killed nor
 * treated as foreign: it is reported in `refused`, loudly, so the caller can
 * say why the port is still held. Never a silent skip.
 *
 * @param {number[]} ports
 * @param {object} [opts]
 * @param {boolean} [opts.udp=false]
 * @param {(msg:string)=>void} [opts.log]
 * @returns {{ killed:number[], foreign:Array<{port:number,pid:number,cmd:string}>,
 *             refused:Array<{port:number,pid:number,why:string}> }}
 */
function freeStackPorts(ports, opts = {}) {
  const udp = opts.udp === true;
  const log = opts.log || (() => {});
  const killed = [];
  const foreign = [];
  const refused = [];
  for (const port of ports) {
    for (const pid of listenersOnPort(port, { udp })) {
      if (pid === process.pid) continue;
      const cmd = commandlineOf(pid);
      if (!cmd) continue; // exited between listing and inspection
      if (STACK_PROCESS_SIGNATURES.some((sig) => cmd.includes(sig))) {
        log(`Freeing ${udp ? 'UDP' : 'TCP'} :${port} — killing stale stack process pid ${pid}`);
        const outcome = killPid(pid, { log: (m) => log(m) });
        if (outcome.refused) refused.push({ port, pid, why: outcome.why });
        else killed.push(pid);
      } else {
        foreign.push({ port, pid, cmd });
      }
    }
  }
  return { killed, foreign, refused };
}

module.exports = {
  STACK_PROCESS_SIGNATURES,
  listenersOnPort,
  commandlineOf,
  pidAlive,
  killPid,
  freeStackPorts,
  // ── The bench-mirror arm interlock (report 20260815_233 F7) ──
  BENCH_MIRROR_ARM_MARKER,
  FORCE_SACN_KILL_FLAG,
  FORCE_SACN_KILL_ENV,
  forceSacnKillRequested,
  readArmMarker,
  writeArmMarker,
  clearArmMarker,
  benchMirrorArmGuard,
};
