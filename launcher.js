#!/usr/bin/env node
/**
 * launcher.js — One-command launcher for the BM26 Titanic stack.
 *
 * Coordinates the simulation, marsin_engine, and (in dev profiles) the
 * CaptainPad Expo dev server, in the startup order proven by
 * `.agent/01_skills/05_full_stack_smoke.md`: sim → engine → CaptainPad.
 *
 * Usage:
 *   node launcher.js <profile> [options]
 *
 * Profiles:
 *   prod      sim + engine. Sim in its lightest rendering mode
 *             (pixel_mapping, 0 spotlights) — no fancy lighting.
 *   dev       sim + engine + CaptainPad Expo dev server. Sim in full
 *             analytic mode with 60 spotlights.
 *   dev-lite  Like dev, but no fancy lighting (emissive, 0 spotlights).
 *
 * Options:
 *   --scene <name>     Sim scene AND engine model (default: titanic)
 *   --pattern <name>   Engine boot pattern (default: 00_golden_hour_wash)
 *   --no-kill          Don't kill stale listeners on the stack's ports
 *   --help             Show usage
 *
 * Every child's output is prefixed ([sim] / [engine] / [captainpad]).
 * If any child dies, the whole stack is torn down and the launcher
 * exits non-zero — no silent restarts, no fallbacks.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const ROOT = __dirname;
const SIM_DIR = path.join(ROOT, 'simulation');
const ENGINE_DIR = path.join(ROOT, 'marsin_engine');
const CAPTAINPAD_DIR = path.join(ROOT, 'CaptainPad');
const SIM_CONFIG_PATH = path.join(SIM_DIR, 'config.yaml');

const DEFAULT_SCENE = 'titanic';
const DEFAULT_PATTERN = '00_golden_hour_wash';
const IS_WIN = process.platform === 'win32';

// ── Profiles ────────────────────────────────────────────────────────────
// `simQuery` maps onto the sim's URL params: `profile` selects the
// lighting profile (simulation/src/core/profile_registry.js) and
// `spotlights` sizes the analytic SpotLight pool (src/core/light_pool.js).
const PROFILES = {
  prod: {
    description: 'Show stack: sim + engine, lightest sim rendering (no fancy lighting)',
    processes: ['sim', 'engine'],
    simQuery: { profile: 'pixel_mapping', spotlights: 0 },
  },
  dev: {
    description: 'Full dev stack: sim + engine + CaptainPad Expo, full analytic lighting, 60 spotlights',
    processes: ['sim', 'engine', 'captainpad'],
    simQuery: { profile: 'full', spotlights: 60 },
  },
  'dev-lite': {
    description: 'Dev stack without fancy lighting: sim + engine + CaptainPad Expo, emissive only',
    processes: ['sim', 'engine', 'captainpad'],
    simQuery: { profile: 'emissive', spotlights: 0 },
  },
};

const TAG_COLORS = { sim: '\x1b[36m', engine: '\x1b[35m', captainpad: '\x1b[33m', launcher: '\x1b[32m' };
const RESET = '\x1b[0m';

function log(tag, line) {
  const color = TAG_COLORS[tag] || '';
  process.stdout.write(`${color}[${tag}]${RESET} ${line}\n`);
}

function usage() {
  const lines = ['', '  Usage: node launcher.js <profile> [options]', '', '  Profiles:'];
  for (const [name, def] of Object.entries(PROFILES)) {
    lines.push(`    ${name.padEnd(10)} ${def.description}`);
  }
  lines.push(
    '',
    '  Options:',
    `    --scene <name>     Sim scene AND engine model (default: ${DEFAULT_SCENE})`,
    `    --pattern <name>   Engine boot pattern (default: ${DEFAULT_PATTERN})`,
    '    --no-kill          Don\'t kill stale listeners on the stack\'s ports',
    '    --help             Show this help',
    ''
  );
  console.log(lines.join('\n'));
}

// ── CLI parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { profile: null, scene: DEFAULT_SCENE, pattern: DEFAULT_PATTERN, kill: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--scene':   opts.scene = argv[++i]; break;
      case '--pattern': opts.pattern = argv[++i]; break;
      case '--no-kill': opts.kill = false; break;
      case '--help': case '-h': usage(); process.exit(0); break;
      default:
        if (arg.startsWith('-')) {
          console.error(`  ❌ Unknown option: ${arg}`);
          usage();
          process.exit(1);
        }
        if (opts.profile !== null) {
          console.error(`  ❌ Unexpected extra argument: ${arg}`);
          usage();
          process.exit(1);
        }
        opts.profile = arg;
    }
  }
  if (!opts.profile) {
    console.error('  ❌ No profile specified.');
    usage();
    process.exit(1);
  }
  if (!PROFILES[opts.profile]) {
    console.error(`  ❌ Unknown profile '${opts.profile}'. Valid: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }
  if (!opts.scene) {
    console.error('  ❌ --scene requires a value.');
    process.exit(1);
  }
  if (!opts.pattern) {
    console.error('  ❌ --pattern requires a value.');
    process.exit(1);
  }
  return opts;
}

// ── Port map (strict read from simulation/config.yaml, zero deps) ───────
function readPorts() {
  const text = fs.readFileSync(SIM_CONFIG_PATH, 'utf8');
  const keys = [
    'http_port', 'save_port', 'sacn_port', 'sacn_output_port',
    'marsin_engine_port', 'captainpad_web_port',
  ];
  const ports = {};
  for (const key of keys) {
    const m = text.match(new RegExp(`^${key}:\\s*(\\d+)`, 'm'));
    if (!m) throw new Error(`Missing '${key}' in ${SIM_CONFIG_PATH}`);
    ports[key] = parseInt(m[1], 10);
  }
  return ports;
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
  }
  if (!fs.existsSync(path.join(ENGINE_DIR, 'node_modules'))) {
    problems.push('marsin_engine/node_modules missing — run `npm install` in marsin_engine/');
  }
  if (profileDef.processes.includes('captainpad') &&
      !fs.existsSync(path.join(CAPTAINPAD_DIR, 'node_modules'))) {
    problems.push('CaptainPad/node_modules missing — run `npm install` in CaptainPad/');
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ❌ ${p}`);
    process.exit(1);
  }
}

// ── Port cleanup + free check ───────────────────────────────────────────
function listenersOnPort(port) {
  // POSIX only; the win32 path uses `npx kill-port` like the rest of the repo.
  try {
    const out = execFileSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
  } catch (err) {
    if (err.status === 1) return []; // lsof exits 1 when nothing matches
    throw err;
  }
}

function killStaleListeners(ports) {
  if (IS_WIN) {
    log('launcher', `Killing stale listeners via kill-port: ${ports.join(', ')}`);
    try {
      execFileSync('npx', ['-y', 'kill-port', ...ports.map(String)], { stdio: 'ignore', shell: true });
    } catch (err) {
      // kill-port exits non-zero when a port had no listener; real failures
      // surface in the free-port check below.
    }
    return;
  }
  for (const port of ports) {
    for (const pid of listenersOnPort(port)) {
      if (pid === process.pid) continue;
      log('launcher', `Killing stale listener on :${port} (pid ${pid})`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        console.error(`  ❌ Failed to kill pid ${pid} on :${port}: ${err.message}`);
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
  // Stale listeners get SIGTERM above; give them a beat to release the socket.
  const deadline = Date.now() + 5000;
  for (const port of ports) {
    let free = await checkPortFree(port);
    while (!free && Date.now() < deadline) {
      await sleep(250);
      free = await checkPortFree(port);
    }
    if (!free) {
      console.error(`  ❌ Port ${port} is still in use. Free it or rerun without --no-kill.`);
      process.exit(1);
    }
  }
}

// ── Child process management ────────────────────────────────────────────
const children = new Map(); // tag → ChildProcess
let shuttingDown = false;

function prefixStream(tag, stream) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) log(tag, line);
  });
  stream.on('end', () => {
    if (buffer) log(tag, buffer);
  });
}

function startChild(tag, command, args, cwd, extraEnv = {}) {
  log('launcher', `Starting ${tag}: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN, // own process group so teardown reaches grandchildren
    shell: IS_WIN,
  });
  prefixStream(tag, child.stdout);
  prefixStream(tag, child.stderr);
  child.on('exit', (code, signal) => {
    children.delete(tag);
    if (shuttingDown) return;
    console.error(`  ❌ ${tag} exited unexpectedly (code=${code}, signal=${signal}). Tearing down.`);
    teardown(1);
  });
  children.set(tag, child);
  return child;
}

function killChild(tag, child) {
  log('launcher', `Stopping ${tag} (pid ${child.pid})`);
  try {
    if (IS_WIN) {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch (err) {
    // Process group may already be gone.
  }
}

function teardown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [tag, child] of children) killChild(tag, child);
  // Give children a moment to run their own cleanup handlers.
  setTimeout(() => process.exit(exitCode), 1500);
}

process.on('SIGINT', () => {
  log('launcher', 'SIGINT — shutting down the stack.');
  teardown(0);
});
process.on('SIGTERM', () => {
  log('launcher', 'SIGTERM — shutting down the stack.');
  teardown(0);
});

// ── Readiness probes ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForHttp(tag, url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error(`Aborted while waiting for ${tag}`);
    const status = await httpStatus(url);
    if (status !== null && status >= 200 && status < 400) {
      log('launcher', `✅ ${tag} ready: ${url} → ${status}`);
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${tag} not ready after ${timeoutMs / 1000}s: ${url}`);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const profileDef = PROFILES[opts.profile];
  const ports = readPorts();

  validate(opts, profileDef);

  const simQuery = new URLSearchParams({
    scene: opts.scene,
    profile: profileDef.simQuery.profile,
    spotlights: String(profileDef.simQuery.spotlights),
  });
  const simUrl = `http://localhost:${ports.http_port}/simulation/?${simQuery.toString()}`;

  log('launcher', `Profile '${opts.profile}' — ${profileDef.description}`);
  log('launcher', `Scene/model: ${opts.scene} · boot pattern: ${opts.pattern}`);

  const stackPorts = [ports.http_port, ports.save_port, ports.sacn_port, ports.sacn_output_port,
    ports.marsin_engine_port];
  if (profileDef.processes.includes('captainpad')) stackPorts.push(ports.captainpad_web_port);

  if (opts.kill) killStaleListeners(stackPorts);
  await assertPortsFree(stackPorts);

  // 1. Simulation servers (HTTP, save, sACN in/out).
  startChild('sim', 'node', ['start.js', '--scene', opts.scene], SIM_DIR);
  await waitForHttp('sim', `http://127.0.0.1:${ports.http_port}/simulation/`, 90000);

  // 2. Engine — model must match the sim scene (05_full_stack_smoke.md).
  startChild('engine', 'node',
    ['engine.js', '--model', opts.scene, '--pattern', opts.pattern], ENGINE_DIR);
  await waitForHttp('engine', `http://127.0.0.1:${ports.marsin_engine_port}/status`, 120000);

  // 3. CaptainPad Expo dev server (dev profiles only).
  if (profileDef.processes.includes('captainpad')) {
    startChild('captainpad', 'npx',
      ['expo', 'start', '--web', '--port', String(ports.captainpad_web_port)],
      CAPTAINPAD_DIR,
      { EXPO_NO_TELEMETRY: '1', CI: '1', BROWSER: 'none' });
    await waitForHttp('captainpad', `http://127.0.0.1:${ports.captainpad_web_port}/`, 300000);
  }

  log('launcher', '────────────────────────────────────────────────────────');
  log('launcher', `🚀 Stack is up (profile: ${opts.profile})`);
  log('launcher', `   Simulation:  ${simUrl}`);
  log('launcher', `   Engine API:  http://localhost:${ports.marsin_engine_port}/status`);
  if (profileDef.processes.includes('captainpad')) {
    log('launcher', `   CaptainPad:  http://localhost:${ports.captainpad_web_port}/`);
  }
  log('launcher', '   Ctrl+C stops everything.');
  log('launcher', '────────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error(`  ❌ ${err.message}`);
  teardown(1);
});
