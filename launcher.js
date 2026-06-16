#!/usr/bin/env node
/**
 * launcher.js — One-command launcher for the BM26 Titanic stack.
 *
 * Coordinates the simulation, marsin_engine, and (in dev profiles) the
 * CaptainPad Expo dev server, in the startup order proven by
 * `.agent/01_skills/05_full_stack_smoke.md`: sim → engine → CaptainPad.
 *
 * Usage:
 *   node launcher.js <profile> [options]   Start the stack
 *   node launcher.js status                Show what is running
 *   node launcher.js stop                  Stop a running stack
 *
 * Profiles:
 *   prod      sim + engine. Sim in its lightest rendering mode
 *             (edit profile, 0 spotlights) — minimal resources, no fancy lighting.
 *   dev       sim + engine + CaptainPad Expo dev server. Sim in full
 *             analytic mode with 60 spotlights.
 *   dev-lite  Like dev, but no fancy lighting (emissive, 0 spotlights).
 *
 * Options:
 *   --scene <name>     Sim scene AND engine model (default: titanic)
 *   --pattern <name>   Engine boot pattern (default: 00_golden_hour_wash)
 *   --no-kill          Don't kill stale stack listeners on our ports
 *   --help             Show usage
 *
 * Behavior contract:
 *   - Single instance: a lock file (~/tmp/bm26_titanic_launcher.lock.json)
 *     records the launcher + child PIDs. A second launch refuses to start
 *     while the first is alive.
 *   - Port cleanup only ever kills processes it can identify as part of
 *     this stack; anything else on our ports is reported and aborts launch.
 *   - Teardown (Ctrl+C, child crash, probe timeout, launcher crash) waits
 *     for each child to exit, escalates to a force-kill after a grace
 *     period, and confirms — no zombies, no silent restarts, no fallbacks.
 *
 * Exit codes: 0 clean stop · 1 runtime failure · 2 usage error.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const portCleanup = require('./tools/port_cleanup.cjs');

const ROOT = __dirname;
const SIM_DIR = path.join(ROOT, 'simulation');
const ENGINE_DIR = path.join(ROOT, 'marsin_engine');
const CAPTAINPAD_DIR = path.join(ROOT, 'CaptainPad');
const SIM_CONFIG_PATH = path.join(SIM_DIR, 'config.yaml');

// Runtime state lives in ~/tmp per the project temp-file convention.
const LOCK_DIR = path.join(os.homedir(), 'tmp');
const LOCK_PATH = path.join(LOCK_DIR, 'bm26_titanic_launcher.lock.json');
// The supervised engine writes the requested scene here, then exits 75, when
// the operator switches scene in the sim — we own the (tracked) restart.
const SCENE_SWITCH_FILE = path.join(LOCK_DIR, 'bm26_engine_scene_switch.json');
const ENGINE_RESTART_EXIT_CODE = 75;

const DEFAULT_SCENE = 'titanic';
const DEFAULT_PATTERN = '00_golden_hour_wash';
const IS_WIN = process.platform === 'win32';

const STOP_GRACE_MS = 8000;       // SIGTERM → SIGKILL escalation per child
// Absorb console-signal races before declaring a crash. On Windows the
// console delivers Ctrl+C to every process at once and the launcher can be
// the last to hear about it, so the window is much wider there.
const CRASH_VERDICT_DELAY_MS = IS_WIN ? 2000 : 300;

// Command lines we are allowed to kill when they squat on our ports.
const STACK_PROCESS_SIGNATURES = [
  'start.js', 'engine.js', 'save-server.js', 'sacn_bridge.js',
  'sacn_output_bridge.js', 'http-server', 'expo', 'metro', 'launcher.js',
];

// ── Profiles (the launcher config — edit here) ───────────────────────────
// Each profile defines, at a glance, what `node launcher.js <name>` does:
//   description : one-line summary (shown in `--help` and at startup)
//   processes   : which services come up — 'sim', 'engine', 'captainpad'
//   simParams   : the exact sim URL query params this profile applies. These
//                 are the settings the sim boots with AND the settings of the
//                 URL the launcher auto-opens in your browser — one source of
//                 truth, so the opened tab always matches the profile.
//                   profile=<pixel_mapping|emissive|full|edit>  lighting profile
//                                       (simulation/src/core/profile_registry.js)
//                   spotlights=<N>      analytic SpotLight pool size
//                                       (simulation/src/core/light_pool.js)
//                 Add any other sim query param here (e.g. renderer) and it
//                 flows straight through to the opened browser URL.
//
// Quick reference:
//   prod      sim + engine               · lightest render, no fancy lighting
//   dev       sim + engine + CaptainPad   · full analytic lighting, 60 spotlights
//   dev-lite  sim + engine + CaptainPad   · emissive lighting, no spotlights
const PROFILES = {
  prod: {
    description: 'Show stack: sim + engine, lightest sim rendering (no fancy lighting)',
    processes: ['sim', 'engine'],
    simParams: { profile: 'edit', spotlights: 0 },
  },
  dev: {
    description: 'Full dev stack: sim + engine + CaptainPad Expo, full analytic lighting, 60 spotlights',
    processes: ['sim', 'engine', 'captainpad'],
    simParams: { profile: 'full', spotlights: 60 },
  },
  'dev-lite': {
    description: 'Dev stack without fancy lighting: sim + engine + CaptainPad Expo, emissive only',
    processes: ['sim', 'engine', 'captainpad'],
    simParams: { profile: 'emissive', spotlights: 0 },
  },
};

// Sim URL params applied to EVERY profile. The launcher always runs
// marsin_engine, so the sim must listen to it over sACN (sacn_in) instead of
// booting its own in-browser Pixelblaze engine.
const SIM_QUERY_COMMON = { lighting_mode: 'sacn_in' };


// ── Logging ─────────────────────────────────────────────────────────────
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const TAG_COLORS = { sim: '\x1b[36m', engine: '\x1b[35m', captainpad: '\x1b[33m', launcher: '\x1b[32m' };
const RESET = '\x1b[0m';

function log(tag, line, stream = process.stdout) {
  const prefix = USE_COLOR ? `${TAG_COLORS[tag] || ''}[${tag}]${RESET}` : `[${tag}]`;
  stream.write(`${prefix} ${line}\n`);
}

function logError(line) {
  process.stderr.write(`  ❌ ${line}\n`);
}

function usage(stream = process.stdout) {
  const lines = [
    '',
    '  Usage: node launcher.js <profile> [options]',
    '         node launcher.js status | stop',
    '',
    '  Profiles:',
  ];
  for (const [name, def] of Object.entries(PROFILES)) {
    lines.push(`    ${name.padEnd(10)} ${def.description}`);
  }
  lines.push(
    '',
    '  Commands:',
    '    setup              Install dependencies in simulation/, marsin_engine/, CaptainPad/',
    '    status             Show whether a stack is running and probe its endpoints',
    '    stop               Stop the running stack (uses the launcher lock file)',
    '',
    '  Options:',
    `    --scene <name>     Sim scene AND engine model (default: ${DEFAULT_SCENE})`,
    `    --pattern <name>   Engine boot pattern (default: ${DEFAULT_PATTERN})`,
    '    --no-kill          Don\'t kill stale stack listeners on our ports',
    '    --no-open          Don\'t auto-open the sim/CaptainPad in a browser',
    '    --help             Show this help',
    ''
  );
  stream.write(lines.join('\n') + '\n');
}

// ── CLI parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { command: null, scene: DEFAULT_SCENE, pattern: DEFAULT_PATTERN, kill: true, open: true };
  const takeValue = (flag, value) => {
    if (value === undefined || value.startsWith('-')) {
      logError(`${flag} requires a value (got ${value === undefined ? 'nothing' : `'${value}'`}).`);
      process.exit(2);
    }
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--scene':   opts.scene = takeValue(arg, argv[++i]); break;
      case '--pattern': opts.pattern = takeValue(arg, argv[++i]); break;
      case '--no-kill': opts.kill = false; break;
      case '--no-open': opts.open = false; break;
      case '--help': case '-h': usage(); process.exit(0); break;
      default:
        if (arg.startsWith('-')) {
          logError(`Unknown option: ${arg}`);
          usage(process.stderr);
          process.exit(2);
        }
        if (opts.command !== null) {
          logError(`Unexpected extra argument: ${arg}`);
          usage(process.stderr);
          process.exit(2);
        }
        opts.command = arg;
    }
  }
  if (!opts.command) {
    logError('No profile or command specified.');
    usage(process.stderr);
    process.exit(2);
  }
  if (opts.command !== 'status' && opts.command !== 'stop' && opts.command !== 'setup' && !PROFILES[opts.command]) {
    logError(`Unknown profile '${opts.command}'. Valid: ${Object.keys(PROFILES).join(', ')}, status, stop, setup`);
    process.exit(2);
  }
  return opts;
}

// ── Port map (strict read from simulation/config.yaml, zero deps) ───────
function readPorts() {
  const text = fs.readFileSync(SIM_CONFIG_PATH, 'utf8');
  const keys = [
    'http_port', 'save_port', 'sacn_port', 'sacn_output_port',
    'marsin_engine_port', 'captainpad_web_port', 'sacn_udp_port',
  ];
  const ports = {};
  for (const key of keys) {
    const m = text.match(new RegExp(`^${key}:\\s*(\\d+)`, 'm'));
    if (!m) throw new Error(`Missing '${key}' in ${SIM_CONFIG_PATH}`);
    ports[key] = parseInt(m[1], 10);
  }
  return ports;
}

// ── Lock file (single-instance guard + status/stop bookkeeping) ─────────
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readLock() {
  if (!fs.existsSync(LOCK_PATH)) return null;
  const text = fs.readFileSync(LOCK_PATH, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Corrupt lock file ${LOCK_PATH}: ${err.message}. Inspect/delete it and retry.`);
  }
}

let lockOwned = false;

function writeLock(data) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify(data, null, 2));
  lockOwned = true;
}

function updateLockChildren() {
  if (!lockOwned) return;
  const lock = readLock();
  if (!lock || lock.pid !== process.pid) return;
  lock.children = {};
  for (const [tag, child] of children) lock.children[tag] = child.pid;
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
}

function removeLock() {
  if (!lockOwned) return;
  try {
    const lock = readLock();
    if (lock && lock.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch (err) {
    // Lock already gone or unreadable — nothing left to release.
  }
  lockOwned = false;
}

// A dead launcher's PID can be recycled onto an unrelated process. Treat the
// lock as a live launcher only if the PID is alive AND its command line is
// actually a launcher.js process — otherwise it's a stale lock (or PID reuse).
function lockLauncherAlive(lock) {
  if (!lock || !pidAlive(lock.pid)) return false;
  return commandlineOf(lock.pid).includes('launcher.js');
}

function assertSingleInstance() {
  const lock = readLock();
  if (!lock) return;
  if (lockLauncherAlive(lock)) {
    logError(`A stack is already running: profile '${lock.profile}', launcher pid ${lock.pid}, started ${lock.startedAt}.`);
    logError('Stop it first (`node launcher.js stop`, or Ctrl+C in its terminal).');
    process.exit(1);
  }
  log('launcher', `Removing stale lock from dead launcher pid ${lock.pid} (${LOCK_PATH}).`);
  fs.unlinkSync(LOCK_PATH);
}

// ── Port inspection / identity-checked cleanup ──────────────────────────
function listenersOnPort(port) {
  if (IS_WIN) {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const cols = line.trim().split(/\s+/);
      // TCP <local> <remote> LISTENING <pid>
      if (cols[0] === 'TCP' && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
        pids.add(Number(cols[4]));
      }
    }
    return [...pids];
  }
  try {
    const out = execFileSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
  } catch (err) {
    if (err.status === 1) return []; // lsof exits 1 when nothing matches
    if (err.code === 'ENOENT') {
      throw new Error('lsof not found — install it, or free the stack ports yourself and rerun with --no-kill.');
    }
    throw err;
  }
}

function commandlineOf(pid) {
  try {
    if (IS_WIN) {
      const out = execFileSync('powershell', [
        '-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ], { encoding: 'utf8' });
      return out.trim();
    }
    return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch (err) {
    return ''; // process already gone
  }
}

function forceKillTree(pid) {
  try {
    if (IS_WIN) {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (err) {
    // Already dead.
  }
}

function killStaleListeners(ports) {
  for (const port of ports) {
    for (const pid of listenersOnPort(port)) {
      if (pid === process.pid) continue;
      const cmdline = commandlineOf(pid);
      if (!cmdline) continue; // exited between listing and inspection
      const ours = STACK_PROCESS_SIGNATURES.some((sig) => cmdline.includes(sig));
      if (!ours) {
        logError(`Port ${port} is held by pid ${pid} (${cmdline.slice(0, 120)}) — not part of this stack; refusing to kill it.`);
        logError('Free the port yourself, then rerun.');
        process.exit(1);
      }
      log('launcher', `Killing stale stack process on :${port} (pid ${pid}: ${cmdline.slice(0, 90)})`);
      try {
        if (IS_WIN) forceKillTree(pid);
        else process.kill(pid, 'SIGTERM');
      } catch (err) {
        logError(`Failed to kill pid ${pid} on :${port}: ${err.message}`);
      }
    }
  }
}

function checkPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(false);
      else reject(err);
    });
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

async function assertPortsFree(ports) {
  // Stale listeners get SIGTERM above; give each port a beat to be released.
  for (const port of ports) {
    const deadline = Date.now() + 5000;
    let free = await checkPortFree(port);
    while (!free && Date.now() < deadline) {
      await sleep(250);
      free = await checkPortFree(port);
    }
    if (!free) {
      logError(`Port ${port} is still in use. Free it or rerun without --no-kill.`);
      process.exit(1);
    }
  }
}

// The sim's sACN Receiver binds UDP :5568 (the E1.31 port). The TCP cleanup
// above can't see UDP, so check it explicitly before starting the sim: kill a
// stale stack receiver, but FAIL LOUD on a foreign holder (QLC+, a console,
// Resolume, …) — it would silently swallow all sACN and leave the rig dark.
// The sim's sACN Receiver binds UDP :5568 (the E1.31 port). The TCP cleanup
// can't see UDP, so check it explicitly before starting the sim. With killing
// enabled (the default, no --no-kill) we CLAIM the port — killing whatever
// holds it, foreign processes included (e.g. UnrealEditor, QLC+, a console),
// because anything squatting :5568 silently swallows all sACN and darks the
// rig. With --no-kill we never touch a foreign process and fail loud instead.
async function assertSacnUdpAvailable(udpPort, kill) {
  const holders = () => {
    try {
      return portCleanup.listenersOnPort(udpPort, { udp: true }).filter((p) => p !== process.pid);
    } catch (err) {
      return null; // lsof/netstat unavailable — can't inspect
    }
  };

  let pids = holders();
  if (pids === null) {
    log('launcher', `Could not inspect UDP :${udpPort} — continuing.`);
    return;
  }
  if (pids.length === 0) return;

  if (!kill) {
    for (const pid of pids) {
      logError(`sACN UDP :${udpPort} is held by pid ${pid} (${portCleanup.commandlineOf(pid).slice(0, 100)}).`);
    }
    logError('It would swallow all sACN and dark the rig. Rerun without --no-kill to claim the port, or free it yourself.');
    process.exit(1);
  }

  for (const pid of pids) {
    const cmd = portCleanup.commandlineOf(pid);
    const ours = portCleanup.STACK_PROCESS_SIGNATURES.some((sig) => cmd.includes(sig));
    log('launcher', `Claiming sACN UDP :${udpPort} — killing ${ours ? 'stale stack' : 'foreign'} process pid ${pid} (${cmd.slice(0, 80)})`);
    portCleanup.killPid(pid);
  }

  // Wait for the OS to release the port before the sim's receiver binds it.
  const deadline = Date.now() + 5000;
  let remaining = holders();
  while (remaining && remaining.length > 0 && Date.now() < deadline) {
    await sleep(250);
    remaining = holders();
  }
  if (remaining && remaining.length > 0) {
    logError(`sACN UDP :${udpPort} is still held (pid ${remaining[0]}) after the kill — the sim may not receive sACN.`);
  }
}

// ── Preflight validation — fail loudly before spawning anything ─────────
function validate(opts, profileDef) {
  const problems = [];
  const sceneConfig = path.join(SIM_DIR, 'scenes', opts.scene, 'scene_config.yaml');
  if (!fs.existsSync(sceneConfig)) {
    problems.push(`Scene '${opts.scene}' not found: ${sceneConfig}`);
  }
  const modelFile = path.join(ENGINE_DIR, 'models', `${opts.scene}.js`);
  if (!fs.existsSync(modelFile)) {
    problems.push(`Engine model '${opts.scene}' not found: ${modelFile}`);
  }
  const patternFile = path.join(ENGINE_DIR, 'patterns', `${opts.pattern}.js`);
  if (!fs.existsSync(patternFile)) {
    problems.push(`Engine pattern '${opts.pattern}' not found: ${patternFile}`);
  }
  if (!fs.existsSync(path.join(SIM_DIR, 'node_modules'))) {
    problems.push('simulation/node_modules missing — run `npm install` in simulation/');
  } else if (!fs.existsSync(path.join(SIM_DIR, 'node_modules', '.bin', 'http-server')) &&
             !fs.existsSync(path.join(SIM_DIR, 'node_modules', '.bin', 'http-server.cmd'))) {
    // start.js serves the sim via `npx http-server`. Assert it's installed
    // locally so npx resolves it offline — otherwise npx would try to fetch it
    // from the network (no internet on the playa) and the sim HTTP probe would
    // hang for 90s before the launcher gave up. Fail fast and clearly instead.
    problems.push('simulation http-server missing — run `npm install` in simulation/ (needed offline)');
  }
  if (!fs.existsSync(path.join(ENGINE_DIR, 'node_modules'))) {
    problems.push('marsin_engine/node_modules missing — run `npm install` in marsin_engine/');
  }
  if (profileDef.processes.includes('captainpad') &&
      !fs.existsSync(path.join(CAPTAINPAD_DIR, 'node_modules'))) {
    problems.push('CaptainPad/node_modules missing — run `npm install` in CaptainPad/');
  }
  if (problems.length > 0) {
    for (const p of problems) logError(p);
    logError('Run `node launcher.js setup` to install all subsystem dependencies.');
    process.exit(1);
  }
}

// ── Child process management ────────────────────────────────────────────
const children = new Map(); // tag → ChildProcess
let shuttingDown = false;
let signalInitiated = false;

function prefixStream(tag, stream, out) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) log(tag, line, out);
  });
  stream.on('end', () => {
    if (buffer) log(tag, buffer, out);
  });
}

// `onExit(code, signal)` may return (or resolve to) true to claim an exit as
// handled — the launcher then does NOT tear the stack down. Used for the
// engine's intentional scene-switch restart (exit 75).
function startChild(tag, command, args, cwd, extraEnv = {}, onExit = null) {
  log('launcher', `Starting ${tag}: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN, // own process group so teardown reaches grandchildren
    shell: IS_WIN,
  });
  prefixStream(tag, child.stdout, process.stdout);
  prefixStream(tag, child.stderr, process.stderr);
  child.on('error', (err) => {
    children.delete(tag);
    if (shuttingDown) return;
    logError(`${tag} failed to start: ${err.message}. Tearing down.`);
    teardown(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(tag);
    if (shuttingDown) return;
    // On a console Ctrl+C the children can die before our own SIGINT handler
    // runs — give the signal a moment to arrive before calling it a crash.
    setTimeout(async () => {
      if (shuttingDown) return;
      if (onExit) {
        try {
          if (await onExit(code, signal)) return; // claimed (e.g. scene switch)
        } catch (err) {
          logError(`${tag} exit handler failed: ${err.message}`);
        }
      }
      logError(`${tag} exited unexpectedly (code=${code}, signal=${signal}). Tearing down.`);
      teardown(1);
    }, CRASH_VERDICT_DELAY_MS);
  });
  children.set(tag, child);
  updateLockChildren();
  return child;
}

// ── Browser auto-open (best-effort, never fatal, not a stack child) ─────
function browserOpenCommand(url) {
  if (process.platform === 'darwin') return { cmd: 'open', args: [url] };
  // Windows: do NOT use `cmd /c start` — cmd treats `&` as a command separator
  // even inside a quoted URL, truncating the query string (?a=1&b=2 opens only
  // ?a=1). rundll32's URL handler takes the URL as a single argv with no shell
  // parsing, so the whole query string survives.
  if (IS_WIN) return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
  return { cmd: 'xdg-open', args: [url] };
}

function openInBrowser(label, url) {
  // Headless Linux (no X/Wayland session) has no browser to open into —
  // print the URL instead of spawning a doomed xdg-open.
  if (!IS_WIN && process.platform !== 'darwin' &&
      !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    log('launcher', `  ↗ ${label} ready — no display detected, open it manually: ${url}`);
    return;
  }
  const { cmd, args } = browserOpenCommand(url);
  try {
    // Detached + unref'd and deliberately NOT tracked in `children`: this is
    // the operator's browser, not part of the stack, so teardown must never
    // close it.
    const opener = spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false });
    opener.on('error', (err) => {
      log('launcher', `  ↗ ${label}: could not auto-open (${err.message}) — open ${url} manually`);
    });
    opener.unref();
    log('launcher', `  ↗ Opening ${label} in your browser: ${url}`);
  } catch (err) {
    log('launcher', `  ↗ ${label}: could not auto-open (${err.message}) — open ${url} manually`);
  }
}

function stopChild(tag, child) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (how) => {
      if (settled) return;
      settled = true;
      log('launcher', `${tag} stopped (${how}).`);
      resolve();
    };
    child.once('exit', (code, signal) => finish(`code=${code}, signal=${signal}`));

    if (IS_WIN) {
      // On an interactive Ctrl+C the console already delivered the signal to
      // every child — let them run their own cleanup before forcing.
      if (!signalInitiated) forceKillTree(child.pid);
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (err) {
        finish('already gone');
        return;
      }
    }

    setTimeout(() => {
      if (settled) return;
      log('launcher', `${tag} did not exit within ${STOP_GRACE_MS / 1000}s — force killing.`);
      if (IS_WIN) forceKillTree(child.pid);
      else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (err) {
          // Group already gone.
        }
      }
      setTimeout(() => finish('force-killed'), 500);
    }, STOP_GRACE_MS);
  });
}

async function teardown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  const running = [...children.entries()];
  if (running.length > 0) {
    log('launcher', `Stopping ${running.length} process(es)…`);
    await Promise.all(running.map(([tag, child]) => stopChild(tag, child)));
  }
  removeLock();
  process.exit(exitCode);
}

// Last-resort safety net: if the launcher dies any other way, force-kill
// whatever is still recorded as ours so nothing is orphaned.
process.on('exit', () => {
  for (const [, child] of children) {
    if (IS_WIN) forceKillTree(child.pid);
    else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (err) {
        // Group already gone.
      }
    }
  }
  removeLock();
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    signalInitiated = true;
    log('launcher', `${signal} — shutting down the stack.`);
    teardown(0);
  });
}

process.on('uncaughtException', (err) => {
  logError(`Launcher crashed: ${err.stack || err.message}`);
  teardown(1);
});
process.on('unhandledRejection', (err) => {
  logError(`Launcher crashed (unhandled rejection): ${err && (err.stack || err.message)}`);
  teardown(1);
});

// ── Readiness probes ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.statusCode);
      else reject(new Error(`POST ${url} → HTTP ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 4000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
  });
}

function tcpOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 2000 });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

async function waitFor(tag, probe, target, timeoutMs) {
  const start = Date.now();
  let lastHeartbeat = 0;
  while (Date.now() - start < timeoutMs) {
    if (shuttingDown) throw new Error(`Aborted while waiting for ${tag}`);
    if (await probe()) {
      log('launcher', `  ✓ ${tag} responding (${target})`);
      return;
    }
    const elapsed = Date.now() - start;
    if (elapsed - lastHeartbeat >= 5000) {
      lastHeartbeat = elapsed;
      log('launcher', `… waiting for ${tag} (${Math.round(elapsed / 1000)}s / ${timeoutMs / 1000}s) — ${target}`);
    }
    await sleep(1000);
  }
  throw new Error(
    `${tag} not ready after ${timeoutMs / 1000}s (${target}). ` +
    `Check the [${tag.split(' ')[0]}] log lines above — the stack will be torn down.`
  );
}

function waitForHttp(tag, url, timeoutMs) {
  return waitFor(tag, async () => {
    const status = await httpStatus(url);
    return status !== null && status >= 200 && status < 400;
  }, url, timeoutMs);
}

function waitForTcp(tag, port, timeoutMs) {
  return waitFor(tag, () => tcpOpen(port), `tcp://127.0.0.1:${port}`, timeoutMs);
}

// ── status / stop subcommands ───────────────────────────────────────────
// ── setup subcommand: one-time dependency install for every subsystem ────
// (Runs `npm install` — a deliberate, online setup step, NOT a runtime/playa
// action. There is no root package.json; deps live per-subsystem.)
function npmInstall(dir) {
  return new Promise((resolve, reject) => {
    log('launcher', `Installing dependencies in ${path.relative(ROOT, dir) || '.'}/ …`);
    const child = spawn('npm', ['install'], { cwd: dir, stdio: 'inherit', shell: IS_WIN });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm install failed in ${dir} (exit ${code}).`));
    });
  });
}

async function cmdSetup() {
  for (const dir of [SIM_DIR, ENGINE_DIR, CAPTAINPAD_DIR]) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      logError(`No package.json in ${dir} — wrong checkout?`);
      process.exit(1);
    }
    try {
      await npmInstall(dir);
    } catch (err) {
      logError(err.message);
      process.exit(1);
    }
  }
  log('launcher', '✅ Setup complete — dependencies installed in all three subsystems.');
  log('launcher', '   Now run: node launcher.js dev   (or prod / dev-lite)');
}

async function cmdStatus() {
  const lock = readLock();
  if (!lock) {
    console.log(`No stack is running (no lock file at ${LOCK_PATH}).`);
    process.exit(1);
  }
  const alive = pidAlive(lock.pid);
  console.log(`Launcher: pid ${lock.pid} (${alive ? 'running' : 'DEAD — stale lock'}) · profile '${lock.profile}' · scene '${lock.scene}' · started ${lock.startedAt}`);
  const ports = readPorts();
  const checks = [
    ['sim', `http://127.0.0.1:${ports.http_port}/simulation/`],
    ['engine', `http://127.0.0.1:${ports.marsin_engine_port}/status`],
  ];
  if (PROFILES[lock.profile] && PROFILES[lock.profile].processes.includes('captainpad')) {
    checks.push(['captainpad', `http://127.0.0.1:${ports.captainpad_web_port}/`]);
  }
  let allUp = true;
  for (const [name, url] of checks) {
    const status = await httpStatus(url);
    const up = status !== null && status >= 200 && status < 400;
    allUp = allUp && up;
    console.log(`  ${up ? '✅' : '❌'} ${name.padEnd(10)} ${url}${up ? '' : ' (no response)'}`);
  }
  process.exit(alive && allUp ? 0 : 1);
}

async function cmdStop() {
  const lock = readLock();
  if (!lock) {
    console.log(`No stack is running (no lock file at ${LOCK_PATH}).`);
    process.exit(1);
  }
  if (!lockLauncherAlive(lock)) {
    console.log(`Launcher pid ${lock.pid} is not a live launcher — cleaning up stale lock.`);
    for (const [tag, pid] of Object.entries(lock.children || {})) {
      // Only kill a recorded child if it's still alive AND its command line
      // looks like ours — guards against PID reuse killing an innocent process.
      if (pidAlive(pid) && STACK_PROCESS_SIGNATURES.some((sig) => commandlineOf(pid).includes(sig))) {
        console.log(`Force-killing orphaned ${tag} (pid ${pid}).`);
        forceKillTree(pid);
      }
    }
    fs.unlinkSync(LOCK_PATH);
    return;
  }
  console.log(`Stopping launcher pid ${lock.pid} (profile '${lock.profile}')…`);
  if (IS_WIN) forceKillTree(lock.pid);
  else process.kill(lock.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS + 7000;
  while (Date.now() < deadline) {
    if (!pidAlive(lock.pid) && !fs.existsSync(LOCK_PATH)) {
      console.log('Stack stopped.');
      return;
    }
    await sleep(500);
  }
  logError(`Launcher pid ${lock.pid} did not stop within ${(STOP_GRACE_MS + 7000) / 1000}s. Inspect it manually.`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'setup') return cmdSetup();
  if (opts.command === 'status') return cmdStatus();
  if (opts.command === 'stop') return cmdStop();

  const profileDef = PROFILES[opts.command];
  const ports = readPorts();

  assertSingleInstance();
  validate(opts, profileDef);

  // Build the sim URL straight from the profile config + the common params,
  // so the auto-opened browser tab always carries this profile's settings.
  const simQuery = new URLSearchParams({ scene: opts.scene, ...SIM_QUERY_COMMON });
  for (const [key, value] of Object.entries(profileDef.simParams)) {
    simQuery.set(key, String(value));
  }
  const simUrl = `http://localhost:${ports.http_port}/simulation/?${simQuery.toString()}`;

  log('launcher', `Profile '${opts.command}' — ${profileDef.description}`);
  log('launcher', `Scene/model: ${opts.scene} · boot pattern: ${opts.pattern}`);

  const stackPorts = [ports.http_port, ports.save_port, ports.sacn_port, ports.sacn_output_port,
    ports.marsin_engine_port];
  if (profileDef.processes.includes('captainpad')) stackPorts.push(ports.captainpad_web_port);

  if (opts.kill) killStaleListeners(stackPorts);
  await assertPortsFree(stackPorts);

  writeLock({
    pid: process.pid,
    profile: opts.command,
    scene: opts.scene,
    pattern: opts.pattern,
    startedAt: new Date().toISOString(),
    children: {},
  });

  const captainPadUrl = `http://localhost:${ports.captainpad_web_port}/`;

  // 1. Simulation servers (HTTP, save, sACN in/out).
  await assertSacnUdpAvailable(ports.sacn_udp_port, opts.kill);
  startChild('sim', 'node', ['start.js', '--scene', opts.scene], SIM_DIR);
  await waitForHttp('sim http', `http://127.0.0.1:${ports.http_port}/simulation/`, 90000);
  await waitForTcp('sim save server', ports.save_port, 30000);
  await waitForTcp('sim sACN in bridge', ports.sacn_port, 30000);
  await waitForTcp('sim sACN out bridge', ports.sacn_output_port, 30000);
  log('launcher', '✅ Simulation is ready.');

  // 2. Engine — model must match the sim scene (05_full_stack_smoke.md).
  // The engine runs supervised: when the operator switches scene in the sim,
  // it hands the new scene back via SCENE_SWITCH_FILE and exits 75; we restart
  // it (tracked) on the new model instead of treating that as a crash. So a
  // scene switch never tears the stack down or orphans a detached engine.
  const engineUrl = `http://127.0.0.1:${ports.marsin_engine_port}`;

  async function startEngine(scene) {
    startChild('engine', 'node',
      ['engine.js', '--model', scene, '--pattern', opts.pattern], ENGINE_DIR,
      { BM26_SUPERVISED: '1', BM26_SCENE_SWITCH_FILE: SCENE_SWITCH_FILE },
      handleEngineExit);
    await waitForHttp('engine api', `${engineUrl}/status`, 120000);
    // The engine restores persisted deck state at boot, which overrides the
    // --pattern CLI flag; re-assert it so a launch/restart is deterministic.
    await httpPostJson(`${engineUrl}/pattern`, { pattern: opts.pattern });
    log('launcher', `  ✓ engine pattern set to ${opts.pattern}`);
  }

  async function handleEngineExit(code) {
    if (code !== ENGINE_RESTART_EXIT_CODE) return false; // real crash → teardown
    let scene = opts.scene;
    try {
      const data = JSON.parse(fs.readFileSync(SCENE_SWITCH_FILE, 'utf8'));
      if (data && data.scene) scene = data.scene;
      fs.unlinkSync(SCENE_SWITCH_FILE);
    } catch (err) {
      logError(`Engine asked to restart but the scene handoff was unreadable (${err.message}); reusing '${scene}'.`);
    }
    log('launcher', `🔁 Engine scene switch → '${scene}'; restarting engine (tracked).`);
    opts.scene = scene;
    try {
      const lock = readLock();
      if (lock && lock.pid === process.pid) {
        lock.scene = scene;
        fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
      }
    } catch (err) {
      // Lock update is best-effort; the running stack is the source of truth.
    }
    await startEngine(scene);
    log('launcher', `✅ Engine restarted on scene '${scene}'.`);
    return true; // claimed — keep the rest of the stack up
  }

  await startEngine(opts.scene);
  log('launcher', '✅ Engine is ready.');

  // Open the sim only now that the engine is up: the sim's boot probes
  // :6968/status and falls back from sacn_in to the in-browser Pixelblaze
  // engine if it loads while the engine is still down.
  if (opts.open) openInBrowser('Simulation', simUrl);

  // 3. CaptainPad Expo dev server (dev profiles only).
  if (profileDef.processes.includes('captainpad')) {
    startChild('captainpad', 'npx',
      ['expo', 'start', '--web', '--port', String(ports.captainpad_web_port)],
      CAPTAINPAD_DIR,
      { EXPO_NO_TELEMETRY: '1', CI: '1', BROWSER: 'none' });
    await waitForHttp('captainpad web', captainPadUrl, 300000);
    log('launcher', '✅ CaptainPad is ready.');
    if (opts.open) openInBrowser('CaptainPad', captainPadUrl);
  }

  log('launcher', '────────────────────────────────────────────────────────');
  log('launcher', `🚀 Stack is up (profile: ${opts.command})`);
  log('launcher', '');
  log('launcher', opts.open ? '   Opened in your browser (URLs below if you need them):'
    : '   Open in your browser:');
  log('launcher', `     Simulation:  ${simUrl}`);
  if (profileDef.processes.includes('captainpad')) {
    log('launcher', `     CaptainPad:  ${captainPadUrl}`);
  }
  log('launcher', '');
  log('launcher', `   Engine API:    http://localhost:${ports.marsin_engine_port}/status`);
  log('launcher', '   Ctrl+C stops everything (`node launcher.js stop` works too).');
  log('launcher', '────────────────────────────────────────────────────────');
}

main().catch((err) => {
  if (!shuttingDown) {
    logError(err.message);
    teardown(1);
  }
});
