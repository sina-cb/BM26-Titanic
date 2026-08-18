#!/usr/bin/env node
/**
 * launcher.js — One-command launcher for the BM26 Titanic stack.
 *
 * Coordinates the simulation, marsin_engine, and CaptainPad, in the startup
 * order proven by `.agent/skills/full_stack_smoke.md`: sim → engine →
 * CaptainPad.
 *
 * Usage:
 *   node launcher.js <profile> [options]   Start the stack
 *   node launcher.js status                Show what is running
 *   node launcher.js stop                  Stop a running stack
 *   node launcher.js rebuild-pad           Re-export CaptainPad's static dist
 *
 * Profiles (all include the Audio Companion — the sole audio analyzer, which
 * feeds the engine over OSC; docs/37 — and all serve CaptainPad):
 *   prod      sim + engine + companion + CaptainPad served from its PREBUILT
 *             static export (no Metro/Expo dev server on a show machine). Sim
 *             renders in `2d_pixels` — the 2D Pixel Map only, every per-frame
 *             GPU 3D pass skipped — so the box spends its cycles on the rig.
 *             sACN priority 150.
 *   dev       sim + engine + companion + CaptainPad Expo dev server. Sim in full
 *             analytic mode with 60 spotlights. sACN priority 120.
 *   dev-lite  Like dev, but no fancy lighting (emissive, 0 spotlights).
 *
 * Options:
 *   --scene <name>     Sim scene AND engine model (default: titanic)
 *   --pattern <name>   Engine boot pattern (default: 00_golden_hour_wash)
 *   --sim-profile <id> Override the profile's sim lighting profile
 *   --sacn-priority <n> Override the profile's E1.31 per-packet priority (0-200)
 *   --lan-host <addr>  LAN address Expo Go should fetch the JS bundle from
 *   --with-native-pad  Also run a supervised Expo Go Metro (static profiles only)
 *   --no-kill          Don't kill stale stack listeners on our ports
 *   -f, --force        Force-kill ANY process holding our ports (incl. foreign);
 *                      the `prod` profile force-claims by default.
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
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const yaml = require('./marsin_engine/node_modules/js-yaml');

const portCleanup = require('./tools/port_cleanup.cjs');
const browserSplit = require('./tools/browser_split.cjs');
const processPriority = require('./tools/process_priority.cjs');

const ROOT = __dirname;
const SIM_DIR = path.join(ROOT, 'simulation');
const ENGINE_DIR = path.join(ROOT, 'marsin_engine');
const CAPTAINPAD_DIR = path.join(ROOT, 'CaptainPad');
// PORT OVERRIDE (report 20260725_115 P2-6): BM26_SIM_CONFIG points the whole
// stack — this launcher AND every sim child (start.js, save-server, both sACN
// bridges, via lib/load_ports.cjs) — at an alternate port map, so launcher
// profile behaviour (double-launch, launch-during-shutdown, the TOCTOU lock
// window, IPv4/IPv6 port shadowing) can be exercised on throwaway ports without
// seizing the operator's live :6969-:6972 / UDP 5568. Unset = shipped behavior.
// Fail-loud: readPorts() throws if the pointed-at file is missing/unreadable —
// no fallback to the real config. The child processes inherit this env, so they
// read the same file. Keep it consistent with lib/load_ports.cjs.
const SIM_CONFIG_PATH = process.env.BM26_SIM_CONFIG || path.join(SIM_DIR, 'config.yaml');

// Runtime state lives in ~/tmp per the project temp-file convention.
const LOCK_DIR = path.join(os.homedir(), 'tmp');
// LOCK OVERRIDE (docs/62 W-A3/W-A5): BM26_LAUNCHER_LOCK points the lock file —
// and therefore `stop`'s whole reap path and the sentinel reaper — at a scratch
// lock, so the teardown paths can be exercised on throwaway ports without ever
// touching the live stack's lock. Unset = shipped behavior. Same doctrine as
// BM26_SIM_CONFIG: an explicit seam, never a fallback.
const LOCK_PATH = (typeof process.env.BM26_LAUNCHER_LOCK === 'string'
  && process.env.BM26_LAUNCHER_LOCK.trim() !== '')
  ? path.resolve(process.env.BM26_LAUNCHER_LOCK.trim())
  : path.join(LOCK_DIR, 'bm26_titanic_launcher.lock.json');
const REAPER_SCRIPT = path.join(ROOT, 'tools', 'launcher_reaper.cjs');
const REAPER_LOG = (typeof process.env.BM26_REAPER_LOG === 'string' && process.env.BM26_REAPER_LOG.trim() !== '')
  ? path.resolve(process.env.BM26_REAPER_LOG.trim())
  : path.join(LOCK_DIR, 'bm26_reaper.log');

// An explicit, named test seam: `BM26_<X>` points a runtime-state file at a
// scratch copy so the paths that WRITE it can be exercised without touching the
// operator's live state. Same doctrine as BM26_SIM_CONFIG / BM26_LAUNCHER_LOCK —
// unset is the shipped behavior, and there is no fallback if the override is set
// to something unusable (it fails where it is used, by name).
function seamPath(envName, shippedPath) {
  const raw = process.env[envName];
  return (typeof raw === 'string' && raw.trim() !== '') ? path.resolve(raw.trim()) : shippedPath;
}

// docs/62 W-B2 — the dependency fingerprint of the last Metro start that reached
// readiness. A mismatch means node_modules moved under a Metro cache, which is
// the whole stale-Metro class ("Unable to resolve" for a file that exists).
const METRO_FINGERPRINT_STAMP = seamPath('BM26_METRO_FINGERPRINT_STAMP',
  path.join(LOCK_DIR, 'bm26_metro_fingerprint.json'));
// docs/62 W-C1 — the rebuild-pad serialization lock. Parallel `expo export` runs
// corrupt the metro cache and produce a blank-page bundle that looks exactly
// like a product crash (report `_259`; .agent/ops/captain_pad_debugging.md).
const REBUILD_PAD_LOCK = seamPath('BM26_REBUILD_PAD_LOCK',
  path.join(LOCK_DIR, 'bm26_rebuild_pad.lock.json'));
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

// The command lines we are allowed to kill when they squat on our ports live in
// tools/port_cleanup.cjs — ONE definition for the whole stack (docs/62 W-A4).
// The launcher used to carry a private copy of the list AND of
// listenersOnPort/commandlineOf; two copies drift, and the killer's copy is the
// one the ARM interlock is written against. Everything here calls
// `portCleanup.*` directly — there is deliberately no local alias.

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
//   captainPad  : HOW CaptainPad is served — 'static' serves the PREBUILT
//                 `CaptainPad/dist` export through tools/static_web_server.cjs
//                 (no Metro, no bundler, nothing to recompile mid-show — the
//                 show-machine choice); 'expo' runs the Expo dev server (hot
//                 reload — the dev-machine choice).
//   sacnPriority: E1.31 per-packet priority the engine stamps on every frame
//                 (0-200 per E1.31; a receiver locks to the highest-priority
//                 source). PROD OUTRANKS DEV ON PURPOSE: if a laptop dev stack
//                 and the show server ever address the same universes, the show
//                 server (150) must win over the laptop (120). Passed to the
//                 engine as `--priority <n>`; validated below.
//
// Quick reference:
//   prod      sim + engine + CaptainPad(static) · 2D pixel map only · sACN 150
//   dev       sim + engine + CaptainPad(expo)   · full analytic, 60 spotlights · sACN 120
//   dev-lite  sim + engine + CaptainPad(expo)   · emissive lighting, no spotlights · sACN 120
const PROFILES = {
  prod: {
    description: 'Show stack: sim + engine + audio companion + CaptainPad (prebuilt static build), 2D-pixels sim rendering, sACN priority 150 (timeline runs in-engine)',
    processes: ['sim', 'engine', 'captainpad'],
    companions: ['audio'],
    simParams: { profile: '2d_pixels', spotlights: 0 },
    captainPad: 'static',
    sacnPriority: 150,
  },
  dev: {
    description: 'Full dev stack: sim + engine + audio companion + CaptainPad Expo, full analytic lighting, 60 spotlights, sACN priority 120 (timeline runs in-engine)',
    processes: ['sim', 'engine', 'captainpad'],
    companions: ['audio'],
    simParams: { profile: 'full', spotlights: 60 },
    captainPad: 'expo',
    sacnPriority: 120,
  },
  'dev-lite': {
    description: 'Dev stack without fancy lighting: sim + engine + audio companion + CaptainPad Expo, emissive only, sACN priority 120 (timeline runs in-engine)',
    processes: ['sim', 'engine', 'captainpad'],
    companions: ['audio'],
    simParams: { profile: 'emissive', spotlights: 0 },
    captainPad: 'expo',
    sacnPriority: 120,
  },
};

// Valid sim lighting profile ids — the keys of LIGHTING_PROFILES in
// simulation/src/core/profile_registry.js. Mirrored here (not imported: that
// module is browser ESM) so a typo in a profile config or in `--sim-profile`
// fails LOUDLY at launch instead of reaching getProfileDef(), which warns and
// silently returns 'edit'. Keep in sync when the registry gains a profile.
const SIM_LIGHTING_PROFILES = ['edit', 'pixel_mapping', 'emissive', 'full', '2d_pixels'];

// E1.31 (ANSI E1.31-2018 §6.2.3) per-packet priority is a single octet with a
// valid range of 0-200; 200 is the highest a compliant source may send.
const SACN_PRIORITY_MIN = 0;
const SACN_PRIORITY_MAX = 200;

// How CaptainPad is served. 'static' = prebuilt dist via
// tools/static_web_server.cjs; 'expo' = the Expo dev server.
const CAPTAINPAD_MODES = ['static', 'expo'];
const CAPTAINPAD_DIST_DIR = path.join(CAPTAINPAD_DIR, 'dist');
const STATIC_WEB_SERVER = path.join(ROOT, 'tools', 'static_web_server.cjs');

// ── docs/62 W-B1 · the native (Expo Go) pad ─────────────────────────────
// Expo Go CANNOT load a static export — it needs a Metro serving the native
// manifest + bundles. A show machine still serves the web pad from the prebuilt
// dist (`captainPad: 'static'`), so the native path used to be a hand-run
// background Metro: a straggler by construction, outside every teardown path.
// `--with-native-pad` makes it an ordinary supervised child instead.
//
// It is a FLAG, not a fourth profile (docs/62 D3): it composes with the prod
// defaults (force-claim, sACN 150, 2d_pixels) rather than forking them, and the
// lock records `withNativePad` so `status` knows to probe the extra row.
const NATIVE_PAD_TAG = 'captainpad-native';
const NATIVE_PAD_FLAG = '--with-native-pad';
const NATIVE_PAD_PORT_KEY = 'captainpad_native_port';

// docs/62 W-B2 — what the dependency fingerprint is computed from. npm writes
// `node_modules/.package-lock.json` at the end of every install: it IS the
// installed tree's marker, so a package-lock newer than it means the tree on
// disk does not match the manifest.
const CAPTAINPAD_PACKAGE_LOCK = path.join(CAPTAINPAD_DIR, 'package-lock.json');
const CAPTAINPAD_INSTALLED_MARKER = path.join(CAPTAINPAD_DIR, 'node_modules', '.package-lock.json');

// The directory `rebuild-pad` exports from. Test seam BM26_REBUILD_PAD_DIR: the
// real CaptainPad/dist is the LIVE :6967 surface, so a test must never be one
// broken guard away from rewriting it.
const REBUILD_PAD_DIR = seamPath('BM26_REBUILD_PAD_DIR', CAPTAINPAD_DIR);

// docs/62 W-C2 — the source trees whose newest mtime decides whether the static
// dist is stale. `node_modules` and `dist` are excluded by construction (they
// are not in this list), which keeps the walk cheap.
const CAPTAINPAD_SOURCE_DIRS = ['app', 'components', 'hooks', 'utils'];

// Companions registry — long-running analyzer/UI sidecars that boot AFTER the
// engine and feed it (audio over OSC; timeline over the engine API). Each is a
// supervised startChild like any other stack process, so teardown reaches them
// automatically. The active profile's `companions` array names which ones run.
//   port      — fixed HTTP/WS port (also each server's --port default; see docs/38 §2)
//   script    — path relative to ENGINE_DIR
//   label     — human-facing name in logs / wait messages
//   waitMs    — readiness timeout for waitForHttp
//   healthPath— HTTP path that returns 200 once ready (default '/')
//   extraArgs — optional (opts) => string[] of extra CLI args
// NOTE: the Timeline is no longer a companion process — it runs IN the engine
// (docs/38 §15). Only the audio analyzer remains a supervised sidecar.
const COMPANIONS = {
  audio: {
    port: 6966,
    script: 'audio/companion/companion_server.js',
    label: 'Audio Companion',
    waitMs: 60000,
    healthPath: '/',
    // `--host 0.0.0.0` is EXPLICIT here on purpose. The Companion binds
    // loopback by DEFAULT (its unauthenticated WS surface retunes the live
    // show, so an open bind on every interface is not a safe default), and
    // the show rig needs it reachable from the operator's iPad / laptop on
    // the camp LAN. The production boot path states that intent instead of
    // inheriting it from a permissive default. Behaviour here is unchanged.
    extraArgs: (opts) => ['--model', opts.scene, '--host', '0.0.0.0'],
  },
};

// Sim URL params applied to EVERY profile. The launcher always runs
// marsin_engine, so the sim must listen to it over sACN (sacn_in) instead of
// booting its own in-browser Pixelblaze engine.
const SIM_QUERY_COMMON = { lighting_mode: 'sacn_in' };

// ── Profile config resolution (loud on anything out of contract) ─────────
// These run BEFORE anything is spawned, so a bad profile constant or a bad CLI
// override fails while the previous stack is still up (codex P0 — no fallback,
// no silently-corrected value).

// The E1.31 priority the engine stamps on every frame. Precedence:
// --sacn-priority > profile.sacnPriority. There is no default: a profile that
// forgets the field is a configuration bug, not something to guess around.
function resolveSacnPriority(profileName, profileDef, override) {
  const source = override === null ? `profile '${profileName}'` : '--sacn-priority';
  const value = override === null ? profileDef.sacnPriority : override;
  if (!Number.isInteger(value)) {
    throw new Error(`sACN priority from ${source} is not an integer (got ${JSON.stringify(value)}). `
      + `Every profile must declare sacnPriority (${SACN_PRIORITY_MIN}-${SACN_PRIORITY_MAX}).`);
  }
  if (value < SACN_PRIORITY_MIN || value > SACN_PRIORITY_MAX) {
    throw new Error(`sACN priority ${value} from ${source} is outside the E1.31 valid range `
      + `${SACN_PRIORITY_MIN}-${SACN_PRIORITY_MAX} — refusing to send a non-compliant packet priority.`);
  }
  return value;
}

// The sim lighting profile this run boots with. Precedence:
// --sim-profile > profile.simParams.profile.
function resolveSimProfile(profileName, profileDef, override) {
  const source = override === null ? `profile '${profileName}'` : '--sim-profile';
  const value = override === null ? profileDef.simParams.profile : override;
  if (!SIM_LIGHTING_PROFILES.includes(value)) {
    throw new Error(`Unknown sim lighting profile '${value}' from ${source}. `
      + `Valid: ${SIM_LIGHTING_PROFILES.join(', ')} (simulation/src/core/profile_registry.js).`);
  }
  return value;
}

function resolveCaptainPadMode(profileName, profileDef) {
  const mode = profileDef.captainPad;
  if (!CAPTAINPAD_MODES.includes(mode)) {
    throw new Error(`Profile '${profileName}' declares captainPad: ${JSON.stringify(mode)} — `
      + `must be one of ${CAPTAINPAD_MODES.join(', ')}.`);
  }
  return mode;
}

// docs/62 W-B1 — is the supervised Expo Go Metro allowed on this profile?
//
// ONE Metro per project: two race `node_modules/.cache` and both misbehave
// (.agent/ops/captain_pad_debugging.md). An `expo` profile already runs that one
// Metro on the web port, so `--with-native-pad` there is refused BY NAME rather
// than quietly ignored or quietly doubled up.
//
// Pure verdict, no exit: the caller owns the exit code (usage error → 2).
function resolveNativePadRequest(profileName, captainPadMode, requested) {
  if (requested !== true) return { enabled: false, refusal: null };
  if (captainPadMode === 'static') return { enabled: true, refusal: null };
  return {
    enabled: false,
    refusal: `${NATIVE_PAD_FLAG} is only valid on a profile that serves CaptainPad from the static `
      + `build; profile '${profileName}' serves it with ${captainPadMode === null ? 'no CaptainPad at all'
        : `an Expo dev server (captainPad: '${captainPadMode}')`}. `
      + 'Two Metros race node_modules/.cache and both misbehave — that profile\'s Metro already '
      + 'serves Expo Go. Use a static profile (prod), or drop the flag (docs/62 W-B1).',
  };
}

// ── LAN host for the Expo dev server (iPad / Expo Go) ───────────────────
// Metro bakes a HOST into the native manifest it serves: `launchAsset.url` is
// where Expo Go goes to download the JS bundle. Left to itself Metro answers
// with 127.0.0.1, so an iPad fetches the manifest fine and then tries to
// download the bundle FROM ITSELF and fails. REACT_NATIVE_PACKAGER_HOSTNAME is
// the documented Expo/Metro override, so the launcher detects this machine's
// LAN address at RUNTIME (never a hardcoded IP — this repo is public) and hands
// it to the captainpad child.
//
// Exactly one non-internal IPv4 interface = unambiguous. Zero or several is
// ambiguous and FAILS LOUDLY naming the candidates: picking one by guesswork
// would put the wrong address in front of every iPad in camp. The operator
// disambiguates with `--lan-host <addr>` or BM26_LAN_HOST.
const LAN_HOST_ENV = 'BM26_LAN_HOST';

function lanIpv4Candidates(interfaces) {
  const found = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const addr of addrs || []) {
      // Node >= 18 reports family as the string 'IPv4'; older builds used 4.
      const isV4 = addr.family === 'IPv4' || addr.family === 4;
      // 169.254/16 is IPv4 link-local (APIPA) — an interface that failed to get
      // an address. It is never a reachable camp-LAN host, so it is not a
      // candidate at all rather than an option the operator must rule out.
      if (!isV4 || addr.internal || addr.address.startsWith('169.254.')) continue;
      found.push({ name, address: addr.address });
    }
  }
  return found;
}

function detectLanHost(interfaces, override) {
  if (override) return { host: override, source: 'override' };
  const candidates = lanIpv4Candidates(interfaces);
  if (candidates.length === 1) {
    return { host: candidates[0].address, source: `interface ${candidates[0].name}` };
  }
  const listed = candidates.length === 0
    ? 'none found'
    : candidates.map((c) => `${c.name}=${c.address}`).join(', ');
  throw new Error(
    `Cannot determine this machine's LAN address for the Expo dev server `
    + `(REACT_NATIVE_PACKAGER_HOSTNAME): expected exactly one non-internal IPv4 interface, found `
    + `${candidates.length} (${listed}). Without it Expo Go on the iPad downloads the bundle from `
    + `127.0.0.1 and fails. Name the address explicitly: --lan-host <addr> (or ${LAN_HOST_ENV}=<addr>).`);
}


// ── Logging ─────────────────────────────────────────────────────────────
const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const TAG_COLORS = { sim: '\x1b[36m', engine: '\x1b[35m', audio: '\x1b[34m', timeline: '\x1b[95m', captainpad: '\x1b[33m', 'captainpad-native': '\x1b[93m', rebuild: '\x1b[33m', launcher: '\x1b[32m' };
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
    '         node launcher.js status | stop | rebuild-pad',
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
    '    rebuild-pad        Re-export CaptainPad/dist (the ONE dist-refresh path).',
    '                       Safe while the stack runs — the static server reads from',
    '                       disk, so an iPad reload picks it up with no restart.',
    '',
    '  Options:',
    `    --scene <name>     Sim scene AND engine model (default: ${DEFAULT_SCENE})`,
    `    --pattern <name>   Engine boot pattern (default: ${DEFAULT_PATTERN})`,
    `    --sim-profile <id> Override the profile's sim lighting profile.`,
    `                       Valid: ${SIM_LIGHTING_PROFILES.join(', ')}`,
    '    --sacn-priority <n>  Override the profile\'s E1.31 per-packet priority',
    `                       (${SACN_PRIORITY_MIN}-${SACN_PRIORITY_MAX}; prod ${PROFILES.prod.sacnPriority}, dev ${PROFILES.dev.sacnPriority}).`,
    '    --lan-host <addr>  LAN address Expo Go fetches the JS bundle from',
    `                       (Expo profiles + ${NATIVE_PAD_FLAG}; auto-detected. Env: ${LAN_HOST_ENV}).`,
    `    ${NATIVE_PAD_FLAG.padEnd(18)} Also run a SUPERVISED Expo Go Metro beside the static pad`,
    `                       (:<${NATIVE_PAD_PORT_KEY}>). Static profiles only — an expo`,
    '                       profile already runs the one Metro this project may have.',
    '    --engine-priority <c>  OS priority for the render loop: high|realtime',
    '                       (default: high). realtime is opt-in and usually needs admin.',
    '    --no-kill          Don\'t kill stale stack listeners on our ports',
    '    -f, --force        Force-kill ANY process on our ports (incl. foreign); prod forces by default',
    `    ${portCleanup.FORCE_SACN_KILL_FLAG.padEnd(18)} Kill the sACN bridge even while it holds an ARMED bench`,
    '                       mirror (freezes every mirrored box on its last frame).',
    `                       Same as ${portCleanup.FORCE_SACN_KILL_ENV}=1.`,
    '    --no-launch        Start every server but DON\'T auto-open any browser',
    '                       windows (URLs still printed). Alias: --no-open',
    '    --split            OPT-IN: tile sim + CaptainPad side-by-side in two Chrome',
    '                       windows (falls back to the default browser if Chrome is',
    '                       missing). DEFAULT is off — open in your existing browser.',
    '    --help             Show this help',
    ''
  );
  stream.write(lines.join('\n') + '\n');
}

// ── CLI parsing ─────────────────────────────────────────────────────────
// Everything that is a COMMAND rather than a profile. `rebuild-pad` is docs/62
// W-C1: the ONE way CaptainPad's prod dist is refreshed.
const SUBCOMMANDS = ['status', 'stop', 'setup', 'rebuild-pad'];

function parseArgs(argv) {
  const opts = {
    command: null, scene: DEFAULT_SCENE, pattern: DEFAULT_PATTERN,
    kill: true, open: true, force: false, split: 'auto',
    // Profile overrides. null = "use the profile's value" — deliberately NOT a
    // default value, so resolveSimProfile/resolveSacnPriority can name the
    // source of whatever they end up validating.
    simProfile: null, sacnPriority: null,
    lanHost: process.env[LAN_HOST_ENV] || null,
    // docs/62 W-B1. Refused BY NAME on an expo profile (see resolveNativePadRequest).
    withNativePad: false,
    // OS process priority for the engine (and, at 'high', the sACN bridges).
    // Default 'high' (HIGH_PRIORITY_CLASS) so the render loop never gets
    // starved by Chrome's foreground boost. 'realtime' is opt-in.
    enginePriority: 'high',
  };
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
      case '--sim-profile': opts.simProfile = takeValue(arg, argv[++i]); break;
      case '--lan-host': opts.lanHost = takeValue(arg, argv[++i]); break;
      case '--sacn-priority': {
        const v = takeValue(arg, argv[++i]);
        // Strict parse: parseInt('150abc') would silently accept 150.
        if (!/^\d+$/.test(v)) {
          logError(`--sacn-priority must be an integer ${SACN_PRIORITY_MIN}-${SACN_PRIORITY_MAX} (got '${v}').`);
          process.exit(2);
        }
        opts.sacnPriority = parseInt(v, 10);
        break;
      }
      case '--engine-priority': {
        const v = takeValue(arg, argv[++i]);
        if (processPriority.normalizePriorityRequest(v, { fallback: null }) === null) {
          logError(`--engine-priority must be 'high' or 'realtime' (got '${v}').`);
          process.exit(2);
        }
        opts.enginePriority = v.trim().toLowerCase();
        break;
      }
      case NATIVE_PAD_FLAG: opts.withNativePad = true; break;
      case '--no-kill': opts.kill = false; break;
      case '-f': case '--force': opts.force = true; break;
      // Accepted, not stored: tools/port_cleanup.cjs reads this override
      // straight off process.argv (forceSacnKillRequested), and the launcher
      // requires that module IN-PROCESS — so the flag needs acceptance here,
      // never forwarding. Without this case the `default` arm below exits 2 on
      // it, which is why report 20260815_233 §4 could only offer the env var.
      case portCleanup.FORCE_SACN_KILL_FLAG: break;
      case '--no-open': case '--no-launch': opts.open = false; break;
      case '--split': opts.split = 'on'; break;
      case '--no-split': opts.split = 'off'; break;
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
  if (!SUBCOMMANDS.includes(opts.command) && !PROFILES[opts.command]) {
    logError(`Unknown profile '${opts.command}'. Valid: ${Object.keys(PROFILES).join(', ')}, ${SUBCOMMANDS.join(', ')}`);
    process.exit(2);
  }
  return opts;
}

// ── Port map (strict read from simulation/config.yaml, zero deps) ───────
function readPorts(opts = {}) {
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
  // docs/62 W-B1: the native-pad port is only DEMANDED when the flag asks for
  // that child. It is read opportunistically otherwise so `status` can probe the
  // row a running stack recorded — but a flag with no key fails LOUDLY here,
  // before anything spawns, instead of at bind time with a bare NaN port.
  const nativeMatch = text.match(new RegExp(`^${NATIVE_PAD_PORT_KEY}:\\s*(\\d+)`, 'm'));
  if (nativeMatch) {
    ports[NATIVE_PAD_PORT_KEY] = parseInt(nativeMatch[1], 10);
  } else if (opts.requireNativePad) {
    throw new Error(`${NATIVE_PAD_FLAG} needs '${NATIVE_PAD_PORT_KEY}' in ${SIM_CONFIG_PATH}, and it is `
      + 'missing. Add it to the reserved-ports section (the standard native-Metro slot is 6981) — '
      + 'guessing a port would put a second Metro somewhere nothing else knows about (docs/62 W-B1).');
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
    // Tag the parse failure so the single-instance check can recognize an
    // unparseable lock as an interrupted-write artifact and recover from it,
    // while every other caller still surfaces it loudly (unchanged behavior).
    const corrupt = new Error(`Corrupt lock file ${LOCK_PATH}: ${err.message}. Inspect/delete it and retry.`);
    corrupt.code = 'ELOCKCORRUPT';
    throw corrupt;
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

// docs/62 W-A2 — the REAL pid of a child we cannot read directly.
//
// `child.pid` is exact for every `node` child (they spawn shell-free since
// W-A1), but the one remaining shell-spawned child — `npx expo`, a .cmd shim
// Windows cannot exec without cmd.exe — reports the cmd.exe WRAPPER pid. If the
// wrapper dies and the real server survives, a lock that only knows the wrapper
// skips a live orphan. So once the child is confirmed listening we resolve the
// pid that actually owns its port and record it BESIDE the wrapper (children[]
// stays, for back-compat with `stop`/blackout).
//
// Ambiguity is reported, never guessed: 0 or >1 listeners means we do not know
// which process it is, and the union reap (W-A3) covers the port anyway.
function resolvePortOwner(port, deps = {}) {
  const inspect = deps.listenersOnPort || portCleanup.listenersOnPort;
  const pids = inspect(port).filter((p) => p !== process.pid);
  if (pids.length === 1) return pids[0];
  return null;
}

function recordResolvedChild(tag, port) {
  if (!lockOwned) return null;
  let pid = null;
  try {
    pid = resolvePortOwner(port);
  } catch (err) {
    log('launcher', `  ⚠ could not inspect :${port} to resolve the real ${tag} pid (${err.message}).`);
    return null;
  }
  if (pid === null) {
    log('launcher', `  ⚠ could not resolve a single owner of :${port} for '${tag}' — the lock keeps the `
      + 'spawn pid only; `stop` still reaps this port by sweep (docs/62 W-A3).');
    return null;
  }
  const lock = readLock();
  if (!lock || lock.pid !== process.pid) return null;
  lock.resolvedChildren = { ...(lock.resolvedChildren || {}), [tag]: pid };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
  return pid;
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

// Retire the previous run's sentinel during a `-f` takeover (docs/62 W-A5).
// Its own trigger ("the lock names MY launcher AND that pid is dead") is about
// to stop being true — we delete that lock and write our own — but the window
// between the old launcher dying and our new lock landing is exactly when it
// could fire and sweep the ports we are claiming. The takeover already reaps
// the old stack itself, so the old sentinel has no job left. Identity-checked:
// only a process whose command line is still the reaper is killed.
function killPreviousReaper(lock) {
  const pid = lock && lock.reaperPid;
  if (!Number.isInteger(pid) || !pidAlive(pid)) return false;
  if (!portCleanup.commandlineOf(pid).includes('launcher_reaper.cjs')) return false;
  log('launcher', `Retiring the previous stack's sentinel reaper (pid ${pid}) — this takeover reaps it instead.`);
  forceKillTree(pid);
  return true;
}

// A dead launcher's PID can be recycled onto an unrelated process. Treat the
// lock as a live launcher only if the PID is alive AND its command line is
// actually a launcher.js process — otherwise it's a stale lock (or PID reuse).
function lockLauncherAlive(lock) {
  if (!lock || !pidAlive(lock.pid)) return false;
  return portCleanup.commandlineOf(lock.pid).includes('launcher.js');
}

async function assertSingleInstance(force = false) {
  let lock;
  try {
    lock = readLock();
  } catch (err) {
    if (err.code !== 'ELOCKCORRUPT') throw err; // e.g. EACCES — not ours to swallow
    // Deterministic lifecycle handling of a KNOWN artifact — not a silent
    // fallback. A lock that exists but does not parse as JSON is the signature
    // of a launcher whose writeLock() was interrupted mid-write (a crash or a
    // power cut). A live, healthy launcher always leaves a fully-written, valid
    // JSON lock (writeLock serializes the whole object in a single writeFileSync
    // before returning), so an unparseable lock can NEVER belong to a running
    // instance. Delete it loudly as the interrupted-write artifact it is and
    // continue startup. Field incident: a Windows restart cut writeLock
    // mid-flight, leaving a whitespace-only lock; startup then refused to begin
    // over it and the supervisor crash-looped 409 times (~68 min).
    logError(`Interrupted-write lock ${LOCK_PATH} does not parse as JSON (${err.message}) — deleting it as a crashed/power-cut launcher artifact and continuing startup.`);
    try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
    return;
  }
  if (!lock) return;
  if (lockLauncherAlive(lock)) {
    if (!force) {
      logError(`A stack is already running: profile '${lock.profile}', launcher pid ${lock.pid}, started ${lock.startedAt}.`);
      logError('Stop it first (`node launcher.js stop`, or Ctrl+C in its terminal), or rerun with -f/--force to take it over.');
      process.exit(1);
    }
    // -f: take over — force-kill the running launcher (and its whole child tree)
    // and replace the lock so we can restart fast. Wait until its PID is gone.
    // The tree includes the sim's sACN bridge, so the ARM interlock applies here
    // exactly as it does to a port sweep (docs/62 W-A4): killing an armed mirror
    // freezes every mirrored box on its last frame.
    assertNoArmedBenchMirror('-f takeover of the running stack');
    log('launcher', `-f: taking over the running stack (force-killing launcher pid ${lock.pid} + children)…`);
    try { forceKillTree(lock.pid); } catch (err) { logError(`Could not kill launcher pid ${lock.pid}: ${err.message}`); }
    const deadline = Date.now() + 10000;
    while (pidAlive(lock.pid) && Date.now() < deadline) await sleep(200);
    if (pidAlive(lock.pid)) {
      logError(`Launcher pid ${lock.pid} still alive after force-kill — kill it manually (taskkill /PID ${lock.pid} /T /F) and rerun.`);
      process.exit(1);
    }
    killPreviousReaper(lock);
    log('launcher', `Took over: previous stack (pid ${lock.pid}) is gone.`);
  } else {
    log('launcher', `Removing stale lock from dead launcher pid ${lock.pid} (${LOCK_PATH}).`);
  }
  try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
}

// ── Port inspection / identity-checked cleanup ──────────────────────────
// listenersOnPort / commandlineOf / the signature list all live in
// tools/port_cleanup.cjs (docs/62 W-A4). They are used through `portCleanup.*`
// so the launcher can never inspect or kill with a different definition than
// the ARM-interlocked killer does.

// Tree-kill primitive for processes the launcher OWNS by handle (its own
// children, and a previous launcher during a `-f` takeover). It is NOT the
// path for killing a port HOLDER — that goes through portCleanup.killPid, which
// is ARM-interlocked. See killStaleListeners / sweepStackPorts below.
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

// A TREE kill can take an ARMED sACN bridge with it without ever naming that
// pid — `portCleanup.killPid`'s interlock only sees the pid it is handed, and in
// a `-f` takeover that pid is the previous LAUNCHER, whose tree contains the sim
// and, under it, the bridge. So the tree cases get the same interlock, decided
// off the same marker (docs/62 W-A4; F7, reports _212/_229/_233).
//
// Pure decision, deps-injectable: `{ refuse: boolean, why: string }`.
function benchMirrorTreeGuard(deps = {}) {
  const read = deps.readArmMarker || portCleanup.readArmMarker;
  const alive = deps.pidAlive || portCleanup.pidAlive;
  const cmdOf = deps.commandlineOf || portCleanup.commandlineOf;
  const state = read();
  if (state.state === 'absent') return { refuse: false, why: 'no bench mirror is armed' };
  if (state.state === 'corrupt') {
    return {
      refuse: true,
      why: `the bench-mirror arm marker is UNREADABLE (${state.error}), so it cannot be proven that no `
        + 'mirror is armed. A tree kill would freeze every mirrored box on its last composed frame.',
    };
  }
  const { marker } = state;
  if (!alive(marker.pid)) {
    return { refuse: false, why: `the arm marker names pid ${marker.pid}, which is gone (stale marker)` };
  }
  if (!String(cmdOf(marker.pid)).includes('sacn_bridge.js')) {
    return { refuse: false, why: `the arm marker's pid ${marker.pid} is no longer an sACN bridge (PID reuse)` };
  }
  return {
    refuse: true,
    why: `the sACN bridge (pid ${marker.pid}) has an ARMED BENCH MIRROR ('${marker.scene || '?'}' ← `
      + `'${marker.sourceScene || '?'}', armed ${marker.armedAt || 'at an unrecorded time'}). A tree kill `
      + 'skips its all-zero DISARM blackout, so every mirrored box FREEZES on its last composed frame.',
  };
}

function assertNoArmedBenchMirror(action, deps = {}) {
  const verdict = benchMirrorTreeGuard(deps);
  if (!verdict.refuse) return verdict;
  if (portCleanup.forceSacnKillRequested()) {
    logError(`⚠ OVERRIDE (${portCleanup.FORCE_SACN_KILL_FLAG}): proceeding with ${action} although `
      + `${verdict.why} Power-cycle or re-arm the mirrored boxes afterwards.`);
    return { ...verdict, overridden: true };
  }
  logError(`❌ REFUSING ${action} — ${verdict.why}`);
  logError('DISARM the bench mirror first (the sim\'s 🎛 Controllers header → DISARM), or rerun with '
    + `${portCleanup.FORCE_SACN_KILL_FLAG} if you accept freezing the mirrored boxes.`);
  process.exit(1);
  return verdict; // unreachable in the CLI; keeps the shape honest for tests
}

// Reap the stale stack processes squatting our ports, identity-checked.
//
// EVERY kill here goes through `portCleanup.killPid` (docs/62 W-A4). It used to
// call `forceKillTree` directly, which bypassed the bench-mirror ARM interlock
// (F7, reports _212/_229/_233): a relaunch while a mirror was ARMED would
// `taskkill /T /F` the armed `sacn_bridge.js` with no refusal, freezing every
// mirrored box on its last composed frame — the exact incident F7 exists to
// prevent.
//
// `force` is the PORT-CLAIM force (-f, and `prod` by default). It is deliberately
// NOT forwarded to killPid: claiming a port from a FOREIGN process is a different
// decision from overriding the armed-mirror interlock, whose only override is
// `--force-sacn` / BM26_FORCE_SACN_KILL (killPid reads those itself).
//
// Returns what happened instead of exiting, so the caller owns the policy and
// the whole thing is testable without a live stack.
function killStaleListeners(ports, force = false, deps = {}) {
  const inspect = deps.listenersOnPort || portCleanup.listenersOnPort;
  const cmdOf = deps.commandlineOf || portCleanup.commandlineOf;
  const kill = deps.killPid || portCleanup.killPid;
  const info = deps.log || ((msg) => log('launcher', msg));
  const result = { killed: [], refused: [], foreign: [] };
  for (const port of ports) {
    for (const pid of inspect(port)) {
      if (pid === process.pid) continue;
      const cmdline = cmdOf(pid);
      if (!cmdline) continue; // exited between listing and inspection
      const ours = portCleanup.STACK_PROCESS_SIGNATURES.some((sig) => cmdline.includes(sig));
      if (!ours && !force) {
        result.foreign.push({ port, pid, cmd: cmdline });
        continue;
      }
      const why = ours ? 'stale stack process' : 'FOREIGN process (--force)';
      info(`Killing ${why} on :${port} (pid ${pid}: ${cmdline.slice(0, 90)})`);
      const outcome = kill(pid, { log: (msg) => logError(msg) });
      if (outcome.refused) result.refused.push({ port, pid, why: outcome.why });
      else result.killed.push({ port, pid });
    }
  }
  return result;
}

// The boot-time policy over that reap: a foreign holder aborts the launch
// (unless -f/prod claimed it above), and an ARM-interlock refusal aborts it too
// — loudly, by name, never by silently leaving the port held and failing later
// with an anonymous EADDRINUSE.
function claimStackPorts(ports, force) {
  const outcome = killStaleListeners(ports, force);
  for (const f of outcome.foreign) {
    logError(`Port ${f.port} is held by pid ${f.pid} (${f.cmd.slice(0, 120)}) — not part of this stack; refusing to kill it.`);
  }
  if (outcome.foreign.length > 0) {
    logError('Free the port yourself, or rerun with -f/--force to claim it anyway.');
    process.exit(1);
  }
  for (const r of outcome.refused) {
    logError(`Port ${r.port} is still held by pid ${r.pid} — ${r.why}`);
  }
  if (outcome.refused.length > 0) {
    logError('Refusing to boot over an ARMED bench mirror. DISARM it in the sim, or rerun with '
      + `${portCleanup.FORCE_SACN_KILL_FLAG} if you accept freezing the mirrored boxes.`);
    process.exit(1);
  }
  return outcome;
}

// Bind-probe a single address family. Resolves false if the port is held on
// that address (a squatter), true if we could bind it (or the family isn't
// available on this box — nothing can squat a family that doesn't exist).
function bindProbe(port, host) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false);
      else if (err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT') resolve(true);
      else reject(err);
    });
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

// Report 20260725_115 L4/P2-1: a bare `probe.listen(port)` binds ONLY `::` and
// reports the port FREE while an IPv4-only squatter (a process on 0.0.0.0:P or
// 127.0.0.1:P) still holds it. The sim then co-binds and every IPv4 client —
// 127.0.0.1, localhost, and every LAN client — reaches the IMPOSTOR, while
// waitForTcp (127.0.0.1) happily greenlights it. Check BOTH families the sim
// actually binds and clients actually use (IPv4 0.0.0.0 AND IPv6 ::); the port
// is free only if NEITHER is held. Sequential, so the two probes never conflict
// with each other on a dual-stack box.
async function checkPortFree(port) {
  const v4Free = await bindProbe(port, '0.0.0.0');
  if (!v4Free) return false;
  const v6Free = await bindProbe(port, '::');
  return v6Free;
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

// ── docs/62 W-B2 · the stale-Metro class, killed at the root ─────────────
//
// THE CLASS. A Metro started BEFORE a dependency change keeps serving from a
// cache built against the old tree, so it reports `Unable to resolve module X`
// for files that are demonstrably on disk (live: `TypefaceFontProvider`). It
// costs a debug session every time, because the symptom points at the code and
// the cause is the process's age.
//
// THE FIX. Fingerprint the dependency state before every Metro start and compare
// it with the last Metro start that reached readiness. Changed → pass `--clear`
// and SAY SO. Unchanged → normal start; `--clear` on every boot costs minutes on
// the playa for nothing. And the pathological state — a package-lock NEWER than
// the installed tree, i.e. a manifest nobody installed — is refused outright,
// because no cache policy can make that Metro resolve correctly.

// Pure: the fingerprint is the manifest's CONTENT plus the installed tree's
// IDENTITY (its marker's mtime). Both terms are load-bearing — the same
// package-lock re-installed is a different tree, and a different package-lock is
// a different manifest.
function metroDependencyFingerprint(lockText, installedMtimeMs) {
  return crypto.createHash('sha1')
    .update(String(lockText))
    .update(':')
    .update(String(installedMtimeMs))
    .digest('hex');
}

// npm writes `node_modules/.package-lock.json` at the END of an install, so it
// lands a few hundred ms AFTER `package-lock.json`. That write ordering is not
// guaranteed to the millisecond, so the comparison gets this much slack — it is
// write-ordering slack inside ONE install, not tolerance for a stale tree: the
// state this catches (a pulled/edited manifest nobody installed) is minutes or
// hours apart, never seconds.
const INSTALL_WRITE_ORDER_SLACK_MS = 5000;

function readMetroDependencyState(deps = {}) {
  const readFile = deps.readFileSync || fs.readFileSync;
  const stat = deps.statSync || fs.statSync;
  const lockPath = deps.lockPath || CAPTAINPAD_PACKAGE_LOCK;
  const installedPath = deps.installedPath || CAPTAINPAD_INSTALLED_MARKER;
  const read = (file, what) => {
    try {
      return { text: readFile(file, 'utf8'), mtimeMs: stat(file).mtimeMs };
    } catch (err) {
      throw new Error(`Cannot read ${what} (${file}): ${err.message}. Metro's dependency fingerprint `
        + 'cannot be computed, so a stale cache could not be detected. Run `npm install` (or '
        + '`npm ci --offline`) in CaptainPad/ (docs/62 W-B2).');
    }
  };
  const manifest = read(lockPath, 'the CaptainPad package-lock');
  const installed = read(installedPath, "npm's installed-tree marker");
  return {
    lockPath, installedPath,
    lockMtimeMs: manifest.mtimeMs,
    installedMtimeMs: installed.mtimeMs,
    fingerprint: metroDependencyFingerprint(manifest.text, installed.mtimeMs),
  };
}

// The pure decision. `{ refuse, clear, why }` — never an exit, never a silent
// choice: every branch names what it decided and why.
function metroCacheGuard(state, stamp) {
  if (state.lockMtimeMs - state.installedMtimeMs > INSTALL_WRITE_ORDER_SLACK_MS) {
    return {
      refuse: true,
      clear: false,
      why: `${state.lockPath} is NEWER than the installed tree marker ${state.installedPath} — the `
        + 'dependencies on disk do not match the manifest. A Metro started over that state reports '
        + '`Unable to resolve module` for files that exist, which reads like a code bug and is not '
        + 'one. Run `npm install` (or `npm ci --offline`) in CaptainPad/ first (docs/62 W-B2).',
    };
  }
  if (!stamp || stamp.fingerprint !== state.fingerprint) {
    return {
      refuse: false,
      clear: true,
      why: 'dependencies changed since the last Metro start → cache cleared (stale-Metro guard, '
        + 'docs/62 W-B2)',
    };
  }
  return {
    refuse: false,
    clear: false,
    why: 'dependency fingerprint unchanged since the last Metro start → keeping the Metro cache',
  };
}

function readMetroFingerprintStamp(stampPath = METRO_FINGERPRINT_STAMP) {
  if (!fs.existsSync(stampPath)) return null;
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    return (stamp && typeof stamp.fingerprint === 'string') ? stamp : null;
  } catch (err) {
    // An unreadable stamp cannot PROVE the cache is current, so it is treated as
    // "no stamp" — which means `--clear`, the safe direction — and it says so.
    logError(`Metro fingerprint stamp ${stampPath} is unreadable (${err.message}) — treating the `
      + 'Metro cache as stale and clearing it.');
    return null;
  }
}

// Written only AFTER the Metro passed readiness: a Metro that never came up must
// not certify its own cache.
function writeMetroFingerprintStamp(state, stampPath = METRO_FINGERPRINT_STAMP) {
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  fs.writeFileSync(stampPath, JSON.stringify({
    fingerprint: state.fingerprint,
    lockPath: state.lockPath,
    installedMtimeMs: state.installedMtimeMs,
    writtenAt: new Date().toISOString(),
  }, null, 2));
}

// The environment contract EVERY Metro this launcher starts runs under — the
// expo profiles' web Metro and the `--with-native-pad` child alike. ONE
// definition, because the two used to be a launcher child and a hand-run shell
// command, and only one of them got these right.
//
//   CI                              DELETED, not set (see buildChildEnv). A
//     CI=true parent shell — which some terminals and agent harnesses export —
//     makes Metro treat the run as non-interactive and stop serving reloads:
//     edits stop reaching the device and the operator debugs a frozen bundle.
//     `CI=""` is worse still — Expo crashes with GetEnv.NoBoolean.
//   REACT_NATIVE_PACKAGER_HOSTNAME  the host Metro bakes into the native
//     manifest's launchAsset.url. Unset, Metro answers 127.0.0.1 and Expo Go on
//     the iPad tries to download the bundle FROM ITSELF. Detected at runtime,
//     never hardcoded (public repo), and it must be the plain host STRING.
//   BROWSER=none                    Metro must not open a browser on the show box.
function metroChildEnv(lanHost) {
  return {
    EXPO_NO_TELEMETRY: '1',
    BROWSER: 'none',
    CI: null,
    REACT_NATIVE_PACKAGER_HOSTNAME: lanHost,
  };
}

// Append `--clear` to a Metro's args when — and only when — the guard says the
// cache cannot be trusted. `--clear` on every boot costs minutes on the playa.
function metroArgs(args, guard) {
  return (guard && guard.clear === true) ? [...args, '--clear'] : args;
}

// Called once the Metro has PASSED readiness. Two records, both meaning "the
// Metro that is running now is the one this dependency state deserves":
//   · the fingerprint stamp — so the next boot knows whether to clear;
//   · `metroReadyAt` in the lock — so `rebuild-pad` can tell a warming Metro
//     (an export into whose cache is the corruption it guards against) from a
//     settled one.
function markMetroReady(state) {
  if (lockOwned) {
    const lock = readLock();
    if (lock && lock.pid === process.pid) {
      lock.metroReadyAt = new Date().toISOString();
      fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
    }
  }
  if (!state) return;
  try {
    writeMetroFingerprintStamp(state);
  } catch (err) {
    // Loud, and NOT fatal: a stamp we could not write means the next boot clears
    // the cache it did not have to — the safe direction, and it says so.
    logError(`Could not write the Metro fingerprint stamp ${METRO_FINGERPRINT_STAMP} `
      + `(${err.message}) — the next Metro start will clear its cache unnecessarily.`);
  }
}

// ── docs/62 W-C2 · a stale static dist announces itself ──────────────────
//
// The static profile runs no bundler: whatever is in `dist/` is what the
// operator gets. Sources newer than the export mean the pad on the iPad is not
// the pad in the tree. WARN, never refuse (docs/62 D6) — deliberately launching
// a known-good older build must stay possible offline.
function newestSourceMtime(baseDir, subdirs = CAPTAINPAD_SOURCE_DIRS, deps = {}) {
  const readdir = deps.readdirSync || fs.readdirSync;
  const stat = deps.statSync || fs.statSync;
  let newest = null;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdir(dir, { withFileTypes: true });
    } catch (err) {
      return; // a subdir this checkout does not have is not a staleness signal
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      const mtimeMs = stat(full).mtimeMs;
      if (newest === null || mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs };
    }
  };
  for (const sub of subdirs) walk(path.join(baseDir, sub));
  return newest;
}

// Pure verdict so the threshold and the message are testable without a tree.
function distStalenessVerdict(distMtimeMs, newest) {
  if (newest === null) return { stale: false, why: 'no CaptainPad sources found to compare against' };
  if (distMtimeMs === null) {
    return { stale: false, why: 'no dist to compare (a missing export is a validate() failure, not staleness)' };
  }
  if (newest.mtimeMs <= distMtimeMs) return { stale: false, why: 'the static export is newer than every source' };
  return {
    stale: true,
    why: `${path.relative(CAPTAINPAD_DIR, newest.path)} is NEWER than the static export — the iPad is `
      + 'being served an OLDER build than this tree. Refresh it with `node launcher.js rebuild-pad` '
      + '(no restart needed), or launch anyway if this older build is the one you want (docs/62 W-C2).',
  };
}

// ── Preflight validation — fail loudly before spawning anything ─────────
function validateCaptainPadSecrets(secretsPath) {
  if (!secretsPath || !fs.existsSync(secretsPath)) {
    return ['BM26_SECRETS must point to the private deployment secrets.yaml'];
  }
  try {
    const secrets = yaml.load(fs.readFileSync(secretsPath, 'utf8'));
    const problems = [];
    const values = [];
    for (const key of ['SinaAuth', 'MishaAuth', 'MARITIME_TERM_FOR_SAILIOR_PASS']) {
      if (!secrets || typeof secrets[key] !== 'string' || secrets[key].length < 3) {
        problems.push(`BM26_SECRETS is missing a valid ${key} value`);
      } else {
        values.push(secrets[key]);
      }
    }
    if (values.length === 3 && new Set(values).size !== 3) {
      problems.push('BM26_SECRETS CaptainPad passphrases must be distinct');
    }
    return problems;
  } catch {
    // js-yaml includes source snippets in error.message. A malformed line next
    // to a credential must never echo private values into the launcher log.
    return ['BM26_SECRETS could not be parsed (values redacted)'];
  }
}

// The dependency-tree preconditions for ANY Metro this launcher starts — the
// `expo` profiles' web Metro and the `--with-native-pad` child alike. Extracted
// so the native-pad child cannot inherit the static profile's (correct, for the
// static server) decision to skip CaptainPad's dependency tree entirely.
function captainPadMetroDependencyProblems(captainPadModules = path.join(CAPTAINPAD_DIR, 'node_modules')) {
  if (!fs.existsSync(captainPadModules)) {
    return ['CaptainPad/node_modules missing — run `npm install` in CaptainPad/'];
  }
  // Metro encodes a package's REAL filesystem path into its dev-bundle URL.
  // A worktree junction to another checkout therefore produces a URL such as
  // /../../old-worktree/.../expo-router/entry.bundle; browsers normalize it
  // and Metro answers JSON 404, leaving only the static OFFLINE SSR shell.
  // Require a worktree-local dependency root instead of starting a page that
  // looks healthy to HTTP probes but can never hydrate.
  const expectedModules = path.resolve(captainPadModules).toLowerCase();
  const resolvedModules = path.resolve(fs.realpathSync(captainPadModules)).toLowerCase();
  if (resolvedModules !== expectedModules) {
    return ['CaptainPad/node_modules resolves outside this worktree — remove the '
      + 'junction and run `npm ci --offline` in CaptainPad/'];
  }
  if (!fs.existsSync(path.join(captainPadModules, 'expo-router', 'entry.js'))) {
    return ['CaptainPad expo-router is missing — run `npm ci --offline` in CaptainPad/'];
  }
  return [];
}

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
  // The supervised stack always enables CaptainPad privileged sessions.
  // Validate the external credential source before starting Simulation so a
  // missing private deployment mount cannot waste the boot window and then
  // fail only when the Engine finally starts. Never print credential values.
  if (fs.existsSync(path.join(ENGINE_DIR, 'node_modules'))) {
    problems.push(...validateCaptainPadSecrets(process.env.BM26_SECRETS));
  }
  const captainPadMode = profileDef.processes.includes('captainpad')
    ? resolveCaptainPadMode(opts.command, profileDef) : null;

  // docs/62 W-B1 — the flag is a USAGE decision, so it is settled before any
  // other problem is collected and it exits 2, not 1. It runs here (validate is
  // called BEFORE assertSingleInstance) so a bad flag can never take the running
  // show down first and only then complain.
  const nativePad = resolveNativePadRequest(opts.command, captainPadMode, opts.withNativePad);
  if (nativePad.refusal) {
    logError(nativePad.refusal);
    process.exit(2);
  }

  if (captainPadMode === 'static') {
    // The STATIC path runs no bundler: whatever is in dist/ is what the operator
    // gets. A stale or missing export must fail here, not turn into a blank page
    // (or a 404) on the show machine's control surface. tools/static_web_server
    // needs no node_modules at all — Node built-ins only — so a static profile
    // deliberately does NOT require CaptainPad's dependency tree.
    if (!fs.existsSync(STATIC_WEB_SERVER)) {
      problems.push(`Static web server missing: ${STATIC_WEB_SERVER}`);
    }
    if (!fs.existsSync(path.join(CAPTAINPAD_DIST_DIR, 'index.html'))) {
      problems.push(
        `CaptainPad static export missing (${path.join(CAPTAINPAD_DIST_DIR, 'index.html')}) — ` +
        'build it: node launcher.js rebuild-pad');
    }
  } else if (captainPadMode === 'expo') {
    problems.push(...captainPadMetroDependencyProblems());
  }
  // The native-pad child IS a Metro, so it needs CaptainPad's dependency tree
  // even though the static profile that hosts it does not.
  if (nativePad.enabled) problems.push(...captainPadMetroDependencyProblems());

  // docs/62 W-B2 — the fingerprint guard runs for whichever Metro this boot will
  // start (there is at most one: `--with-native-pad` is refused on expo
  // profiles). Its REFUSAL joins the problem list so it fails here, before
  // assertSingleInstance can take the running stack down.
  const startsMetro = captainPadMode === 'expo' || nativePad.enabled;
  let metroState = null;
  let metroGuard = null;
  if (startsMetro) {
    metroState = readMetroDependencyState();
    metroGuard = metroCacheGuard(metroState, readMetroFingerprintStamp());
    if (metroGuard.refuse) problems.push(metroGuard.why);
  }

  if (problems.length > 0) {
    for (const p of problems) logError(p);
    logError('Run `node launcher.js setup` to install all subsystem dependencies.');
    process.exit(1);
  }

  // docs/62 W-C2 — WARN, never refuse (D6): launching a deliberate older build
  // must stay possible offline. Runs after the problem gate so it can assume the
  // export exists.
  if (captainPadMode === 'static') {
    const distMtimeMs = fs.statSync(path.join(CAPTAINPAD_DIST_DIR, 'index.html')).mtimeMs;
    const verdict = distStalenessVerdict(distMtimeMs, newestSourceMtime(CAPTAINPAD_DIR));
    if (verdict.stale) logError(`⚠ STALE CaptainPad build — ${verdict.why}`);
  }

  return { captainPadMode, nativePad, metroState, metroGuard };
}

// ── The spawn contract (docs/62 W-A1) ───────────────────────────────────
//
// `shell: true` on Windows exists for ONE reason: cmd.exe is the only thing that
// can exec a `.cmd` shim (`npx`, `npm`). It is not free — node then joins the
// args into a single cmd.exe command string with NO quoting, so an absolute path
// under a user dir containing a space shatters into tokens and the child runs
// garbage (it did, on the first prod boot). It also hides the real pid behind a
// cmd.exe wrapper, which is what put wrapper pids in the lock file.
//
// So `node` children spawn shell-FREE: the args array is passed verbatim, there
// is no quoting layer to get wrong, and `child.pid` IS the node process. The
// shell — and the quoting helper below — survive only for the shims.
//
// An unknown command is a contract gap, not something to guess at: it throws.
const DIRECT_EXEC_COMMANDS = new Set(['node']);      // real executables
const SHELL_SHIM_COMMANDS = new Set(['npx', 'npm']); // .cmd shims on Windows

function spawnNeedsShell(command, isWin = IS_WIN) {
  if (!isWin) return false;
  const name = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (DIRECT_EXEC_COMMANDS.has(name)) return false;
  if (SHELL_SHIM_COMMANDS.has(name)) return true;
  throw new Error(`No spawn contract for command '${command}': it is neither a known real executable `
    + `(${[...DIRECT_EXEC_COMMANDS].join(', ')}) nor a known Windows .cmd shim `
    + `(${[...SHELL_SHIM_COMMANDS].join(', ')}). Add it to one of those sets in launcher.js — `
    + 'guessing would either break the spawn or silently reintroduce cmd.exe quoting (docs/62 W-A1).');
}

// Quote args for the ONE remaining cmd.exe path.
//
// Quote anything carrying a cmd.exe metacharacter or whitespace. REFUSE an
// embedded `"` or `%`: cmd.exe has no safe escape for `%` even inside quotes
// (`%VAR%` still expands) and embedded quotes cannot be nested reliably. No stack
// arg legitimately carries either, and a thrown launch beats a silently mangled
// one (codex P0 — fail loudly).
const WINDOWS_SHELL_QUOTE_CLASS = /[\s&()^%!"=,;]/;
const WINDOWS_SHELL_REJECT_CLASS = /["%]/;

function windowsShellQuote(args, isWin = IS_WIN) {
  if (!isWin) return args; // POSIX spawn takes the array verbatim
  return args.map((arg) => {
    const value = String(arg);
    if (WINDOWS_SHELL_REJECT_CLASS.test(value)) {
      throw new Error(`windowsShellQuote: refusing to pass ${JSON.stringify(value)} through cmd.exe — `
        + 'it contains a `"` or `%`, which cmd.exe cannot quote safely (`%VAR%` expands even inside '
        + 'quotes). Spawn this child shell-free, or drop the character (docs/62 W-A1).');
    }
    return WINDOWS_SHELL_QUOTE_CLASS.test(value) ? `"${value}"` : value;
  });
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
// Build a child's environment from ours plus `extraEnv`. A key whose value is
// `null` is DELETED rather than set — the only way to keep an inherited
// variable OUT of a child. Needed because a `CI=true` parent shell freezes
// Metro's reloads (it bit the operator live), so the captainpad child must run
// with CI genuinely absent, not merely overwritten with '' (Expo/Metro treat
// presence, not truthiness, for some of these).
function buildChildEnv(extraEnv) {
  const env = { ...process.env, ...extraEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) delete env[key];
  }
  return env;
}

function startChild(tag, command, args, cwd, extraEnv = {}, onExit = null) {
  log('launcher', `Starting ${tag}: ${command} ${args.join(' ')}`);
  const useShell = spawnNeedsShell(command);
  const spawnArgs = useShell ? windowsShellQuote(args) : args;
  const child = spawn(command, spawnArgs, {
    cwd,
    env: buildChildEnv(extraEnv),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WIN, // own process group so teardown reaches grandchildren
    shell: useShell,
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

// Auto-open this profile's UIs in the operator's browser, in the proven order
// sim → CaptainPad → Companion. Called once, AFTER every relevant process is
// confirmed up (each waited via waitForHttp), so no tab races the engine.
//
// What opens is DERIVED from the profile's `processes` list — a UI is only
// opened if its process is part of the profile. Since _245 EVERY profile runs
// CaptainPad, so every profile opens all three:
//   - prod / dev / dev-lite  → sim → CaptainPad → Companion
// On a show server this is moot: boot_server.ps1 runs the launcher with
// --no-launch and opens the console tabs itself (docs/43).
//
// Split view (best-effort): when enabled, sim + CaptainPad are tiled
// side-by-side as two positioned Chrome windows; the Companion still opens
// normally. If Chrome is missing or placement fails, we fall back to the normal
// per-UI openInBrowser — never crashing the launch over cosmetic placement.
function openProfileUis(opts, profileDef, urls) {
  if (!opts.open) return;
  const has = (name) => profileDef.processes.includes(name);

  // Split view is OPT-IN ONLY (`--split`). By DEFAULT everything opens in your
  // existing browser (tabs in the current window) via openInBrowser — cleaner
  // than popping separate Chrome windows. `--split` tiles sim + CaptainPad in
  // two Chrome windows; anything else (incl. the 'auto' default) does not split.
  const wantSplit = opts.split === 'on';

  let simHandled = false;
  let captainPadHandled = false;
  if (wantSplit && has('sim') && has('captainpad')) {
    const tiled = browserSplit.openSideBySide(urls.sim, urls.captainPad, {
      log: (msg) => log('launcher', `  ↗ ${msg}`),
    });
    if (tiled) {
      log('launcher', `  ↗ Opening Simulation + CaptainPad side-by-side in Chrome`);
      simHandled = true;
      captainPadHandled = true;
    }
    // tiled === false → fall through to default-browser opens below.
  }

  // Strict order: sim → CaptainPad → companions (in profile order).
  if (has('sim') && !simHandled) openInBrowser('Simulation', urls.sim);
  if (has('captainpad') && !captainPadHandled) openInBrowser('CaptainPad', urls.captainPad);
  for (const name of profileDef.companions || []) {
    const c = COMPANIONS[name];
    openInBrowser(c.label, `http://localhost:${c.port}`);
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 8000 }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(new Error(`GET ${url} returned invalid JSON: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Re-asserting the launcher's selected pattern is correct only when the engine
// is in normal Edit operation. A stale performance-preshow snapshot means the
// engine deliberately resumed its crash lock; POST /pattern must stay refused
// so the launcher never tears down a healthy, safely relocked show.
async function initializeEnginePattern(engineUrl, pattern, deps = {}) {
  const get = deps.get || httpGetJson;
  const post = deps.post || httpPostJson;
  const logger = deps.logger || ((message) => log('launcher', message));
  const performanceMode = await get(`${engineUrl}/performance-mode`);
  if (!performanceMode || typeof performanceMode.active !== 'boolean') {
    throw new Error('Engine performance-mode response is malformed: missing boolean active');
  }
  if (performanceMode.active) {
    logger('  ⚠ engine resumed a stale Performance lock — preserving the crash-recovery show; '
      + 'skipping launcher pattern re-assertion until a privileged operator exits Performance.');
    return { patternSet: false, reason: 'performance-lock' };
  }
  await post(`${engineUrl}/pattern`, { pattern });
  logger(`  ✓ engine pattern set to ${pattern}`);
  return { patternSet: true, reason: 'edit-mode' };
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
    // `npm` is a .cmd shim on Windows — the one class of child that still needs
    // a shell, and therefore the quoting helper (docs/62 W-A1).
    const child = spawn('npm', windowsShellQuote(['install']),
      { cwd: dir, stdio: 'inherit', shell: spawnNeedsShell('npm') });
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

// ── `rebuild-pad` — the ONE dist-refresh path (docs/62 W-C1) ─────────────
//
// The static profile serves `CaptainPad/dist` from disk with `Cache-Control:
// no-store` on the HTML (tools/static_web_server.cjs), so a fresh export is
// picked up by the NEXT iPad reload with no restart of anything. The export is
// in-place (docs/62 D5): expo owns the dist layout, and the few-second window
// where a reload could 404 is announced rather than engineered around.
//
// SERIALIZATION IS THE POINT. Two concurrent `expo export` runs corrupt the
// metro cache and emit a blank-page bundle that looks exactly like a product
// crash — it cost a full debug cycle (report `_259`;
// .agent/ops/captain_pad_debugging.md). So this refuses, by name, over another
// rebuild, over any `expo export` running outside the launcher, and over a Metro
// that has not finished warming up.

// What an `expo export` actually looks like in a process list. Two spellings,
// because Windows shows BOTH halves of `npx expo export`: the cmd.exe wrapper
// carries the literal command, and the node process it starts carries expo's
// resolved CLI entrypoint.
//
// These are deliberately TIGHT. A loose `expo` + `export` pair matches any shell
// whose environment block contains `export ` — every Git-Bash wrapper on this
// box — and a rebuild that refuses at random is a rebuild nobody runs.
const EXPO_EXPORT_SIGNATURES = [
  /\bexpo(?:\.cmd)?["']?\s+export\b/i,
  /[\\/]expo[\\/]bin[\\/]cli(?:\.js)?["']?\s+export\b/i,
];

// Every `expo export` on this machine, ours or not. Injectable, because the real
// implementation enumerates all processes and a test must not depend on what the
// box happens to be running.
function runningExpoExports(deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  const selfPid = deps.selfPid === undefined ? process.pid : deps.selfPid;
  let raw = '';
  try {
    if (IS_WIN) {
      raw = exec('powershell', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } else {
      raw = exec('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    }
  } catch (err) {
    throw new Error(`Cannot enumerate processes to check for a concurrent \`expo export\` `
      + `(${err.message}). Refusing to export blind — a parallel export corrupts the metro cache `
      + '(docs/62 W-C1).');
  }
  const found = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)[\s\t]+(.*)$/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    const cmd = m[2].trim();
    if (pid === selfPid || !cmd) continue;
    if (EXPO_EXPORT_SIGNATURES.some((sig) => sig.test(cmd))) found.push({ pid, cmd });
  }
  return found;
}

function readRebuildPadLock(lockPath = REBUILD_PAD_LOCK) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    throw new Error(`Rebuild lock ${lockPath} does not parse (${err.message}). Inspect/delete it and `
      + 'retry — a rebuild must never start over an unreadable serialization lock.');
  }
}

// Whether the RUNNING stack has a Metro, and whether that Metro finished warming.
// An unknown profile is refused rather than assumed Metro-less: an export into a
// warming Metro's cache is the corruption this whole guard exists to prevent.
function stackMetroState(lock) {
  if (!lock) return { hasMetro: false, metroReadyAt: null, unknownProfile: null };
  const profileDef = PROFILES[lock.profile];
  if (!profileDef) return { hasMetro: false, metroReadyAt: null, unknownProfile: lock.profile };
  const hasMetro = lock.withNativePad === true || profileDef.captainPad === 'expo';
  return { hasMetro, metroReadyAt: lock.metroReadyAt || null, unknownProfile: null };
}

// The pure verdict. `{ refuse, why }` — one reason, named, never a silent skip.
function rebuildPadGuard(state) {
  if (state.rebuild) {
    return {
      refuse: true,
      why: `another \`launcher.js rebuild-pad\` is running (pid ${state.rebuild.pid}, started `
        + `${state.rebuild.startedAt}). Parallel \`expo export\` runs corrupt the metro cache and `
        + 'produce a blank-page bundle that looks exactly like a product crash. Wait for it to finish.',
    };
  }
  if (state.exports.length > 0) {
    const named = state.exports.map((e) => `pid ${e.pid}: ${e.cmd.slice(0, 90)}`).join(' · ');
    return {
      refuse: true,
      why: `an \`expo export\` is already running outside this launcher (${named}). One export at a `
        + 'time, machine-wide — a parallel export corrupts the metro cache.',
    };
  }
  if (state.stack.unknownProfile !== null) {
    return {
      refuse: true,
      why: `the running stack's lock names profile '${state.stack.unknownProfile}', which this `
        + 'launcher does not know — so it cannot be proven that no Metro is warming up. Stop the '
        + 'stack (or fix the lock) and retry.',
    };
  }
  if (state.stack.hasMetro && !state.stack.metroReadyAt) {
    return {
      refuse: true,
      why: 'the running stack has a Metro that has not reported readiness yet — exporting into a '
        + "warming Metro's cache is the same corruption. Wait for the launcher's "
        + '`✅ CaptainPad … ready` line and retry.',
    };
  }
  return { refuse: false, why: 'no other export and no Metro warmup is in flight' };
}

function rebuildPadState(deps = {}) {
  const listExports = deps.listExpoExports || runningExpoExports;
  const readStack = deps.readLock || readLock;
  const alive = deps.pidAlive || pidAlive;
  const lockPath = deps.rebuildLockPath || REBUILD_PAD_LOCK;

  let rebuild = readRebuildPadLock(lockPath);
  if (rebuild && !alive(rebuild.pid)) {
    // Deterministic handling of a KNOWN artifact (same doctrine as the launcher's
    // interrupted-write lock), announced rather than swallowed: a crashed export
    // must not block every future rebuild.
    logError(`Reclaiming the rebuild lock ${lockPath} from dead pid ${rebuild.pid} (started `
      + `${rebuild.startedAt}) — that export died without releasing it.`);
    rebuild = null;
  }
  let stackLock = null;
  try {
    stackLock = readStack();
  } catch (err) {
    throw new Error(`Cannot read the launcher lock (${err.message}) — refusing to export without `
      + 'knowing whether a Metro is warming up (docs/62 W-C1).');
  }
  return {
    rebuild,
    stack: stackMetroState(stackLock && lockLauncherAlive(stackLock) ? stackLock : null),
    exports: listExports(),
  };
}

// The default export runner — `CaptainPad`'s own `web:build` command, verbatim.
function runPadExport(padDir, onLine) {
  return new Promise((resolve, reject) => {
    const args = ['expo', 'export', '--platform', 'web', '-c'];
    const useShell = spawnNeedsShell('npx');
    onLine(`npx ${args.join(' ')}   (cwd ${padDir})`);
    const child = spawn('npx', useShell ? windowsShellQuote(args) : args, {
      cwd: padDir,
      // CI is DELETED, not set: `CI=""` crashes Expo with GetEnv.NoBoolean and
      // `CI=1` changes its behavior. The launcher owns this variable for its
      // children, here exactly as for the Metro ones.
      env: buildChildEnv({ CI: null, EXPO_NO_TELEMETRY: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });
    prefixStream('rebuild', child.stdout, process.stdout);
    prefixStream('rebuild', child.stderr, process.stderr);
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

// Never exits — returns `{ ok, code, … }` so the whole path is testable in
// process with a scratch pad dir and an injected exporter. `cmdRebuildPad` owns
// the exit code.
async function rebuildPad(deps = {}) {
  const padDir = deps.padDir || REBUILD_PAD_DIR;
  const distDir = deps.distDir || path.join(padDir, 'dist');
  const lockPath = deps.rebuildLockPath || REBUILD_PAD_LOCK;
  const runExport = deps.runExport || runPadExport;
  const info = deps.log || ((msg) => log('rebuild', msg));
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(path.join(padDir, 'node_modules'))) {
    logError(`CaptainPad/node_modules missing (${path.join(padDir, 'node_modules')}) — `
      + '`expo export` cannot run. Fix it: `npm install` in CaptainPad/, or `node launcher.js setup`.');
    return { ok: false, code: 1, reason: 'no node_modules' };
  }

  const guard = rebuildPadGuard(rebuildPadState({ ...deps, rebuildLockPath: lockPath }));
  if (guard.refuse) {
    logError(`❌ REFUSING to rebuild the CaptainPad dist — ${guard.why}`);
    return { ok: false, code: 1, reason: 'serialized', why: guard.why };
  }

  const startedAtMs = Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    pid: process.pid, startedAt: new Date(startedAtMs).toISOString(), distDir,
  }, null, 2));

  let outcome;
  try {
    info(`Re-exporting the CaptainPad static build in place → ${distDir}`);
    outcome = await runExport(padDir, (line) => info(line));
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
  }

  if (outcome.code !== 0) {
    logError(`\`expo export\` failed (code=${outcome.code}, signal=${outcome.signal}). The dist on `
      + 'disk may be half-written — rerun this command until it exits 0 before reloading the iPad.');
    return { ok: false, code: 1, reason: 'export failed' };
  }

  // Structural success, not a trusted exit code: the export must actually have
  // rewritten the index this run.
  if (!fs.existsSync(indexPath)) {
    logError(`\`expo export\` exited 0 but ${indexPath} does not exist — nothing was built.`);
    return { ok: false, code: 1, reason: 'no index.html' };
  }
  const indexMtimeMs = fs.statSync(indexPath).mtimeMs;
  if (indexMtimeMs < startedAtMs) {
    logError(`\`expo export\` exited 0 but ${indexPath} was not rewritten (its mtime predates this `
      + 'run) — the dist you are serving is NOT the build you just asked for.');
    return { ok: false, code: 1, reason: 'index not rewritten' };
  }

  const bundles = padEntryBundles(distDir);
  info('✅ CaptainPad dist rebuilt.');
  for (const b of bundles) info(`   entry bundle: ${b}`);
  if (bundles.length === 0) {
    logError(`No entry bundle found under ${path.join(distDir, '_expo', 'static', 'js', 'web')} — `
      + 'the export produced an index without a bundle; do NOT reload the iPad onto this build.');
    return { ok: false, code: 1, reason: 'no entry bundle' };
  }
  info('   Rebuilt WHILE SERVING — the static server reads from disk and sends the HTML `no-store`, '
    + 'so nothing needs restarting: reload the iPad now. Verify the bundle hash above changed.');
  return { ok: true, code: 0, bundles, indexMtimeMs };
}

function padEntryBundles(distDir) {
  const webDir = path.join(distDir, '_expo', 'static', 'js', 'web');
  try {
    return fs.readdirSync(webDir).filter((f) => f.endsWith('.js')).sort();
  } catch (err) {
    return [];
  }
}

async function cmdRebuildPad() {
  const result = await rebuildPad();
  process.exit(result.code);
}

// Build the full per-CHILD health-check list. Report 20260725_115 L1/P0: the old
// status probed ONLY sim-http (:6969) and engine (:6968), so `kill -9` on the
// save server or EITHER sACN bridge left `status` printing ✅ over a dark rig.
// We now probe EVERY child start.js owns — save (:6970), sACN-in (:6971),
// sACN-out (:6972) — plus the engine. `expect:'ok'` wants a 2xx/3xx; the two
// bridges are `ws` servers whose plain-GET answer is 426, so `expect:'any'`
// treats ANY HTTP response as alive (a frozen event loop answers neither).
function healthCheckList(ports, profile, opts = {}) {
  const checks = [
    { name: 'sim http', url: `http://127.0.0.1:${ports.http_port}/simulation/`, expect: 'ok' },
    { name: 'save', url: `http://127.0.0.1:${ports.save_port}/list-scenes`, expect: 'ok' },
    { name: 'sacn-in', url: `http://127.0.0.1:${ports.sacn_port}/`, expect: 'any' },
    { name: 'sacn-out', url: `http://127.0.0.1:${ports.sacn_output_port}/`, expect: 'any' },
    { name: 'engine', url: `http://127.0.0.1:${ports.marsin_engine_port}/status`, expect: 'ok' },
  ];
  if (profile && PROFILES[profile] && PROFILES[profile].processes.includes('captainpad')) {
    checks.push({ name: 'captainpad', url: `http://127.0.0.1:${ports.captainpad_web_port}/`, expect: 'ok' });
  }
  // docs/62 W-B1: the extra row exists only when THIS run asked for the native
  // Metro (the lock records `withNativePad`) — probing :6981 unconditionally
  // would report ❌ on every ordinary prod stack, which is how a status display
  // stops being read.
  if (opts.withNativePad === true) {
    const nativePort = ports[NATIVE_PAD_PORT_KEY];
    if (!Number.isInteger(nativePort)) {
      throw new Error(`The lock says this stack runs the native pad, but '${NATIVE_PAD_PORT_KEY}' is `
        + `missing from ${SIM_CONFIG_PATH} — the row cannot be probed (docs/62 W-B1).`);
    }
    checks.push({ name: NATIVE_PAD_TAG, url: `http://127.0.0.1:${nativePort}/`, expect: 'ok' });
  }
  return checks;
}

async function runHealthChecks(checks) {
  const results = [];
  for (const check of checks) {
    const status = await httpStatus(check.url);
    const up = check.expect === 'any'
      ? status !== null
      : (status !== null && status >= 200 && status < 400);
    results.push({ ...check, status, up });
  }
  return results;
}

// FRAME-FLOW verification (report 20260725_115, fix #2 — "never report green on a
// dark rig"). A bridge answering its liveness probe proves the port is alive; it
// does NOT prove sACN frames are actually flowing. The input bridge already
// broadcasts a "N packets/5s from '<source>'" monitor line to WS clients, so we
// briefly connect as one and read it. Two honest caveats, documented here rather
// than hidden: (1) this reuses the sim's own `ws` — if it can't be loaded the
// check degrades to "unavailable" (an optional diagnostic, never a core
// fallback); (2) connecting to the INPUT bridge counts as a sim-client in its
// multi-window census, so while a real sim window is open this on-demand probe
// may momentarily flash the bridge's "2 windows" contention warning. It is used
// ONLY in the operator-initiated `status` command, never in a continuous loop.
function readFrameFlow(port, windowMs = 6000) {
  let WebSocket;
  try {
    WebSocket = require(path.join(SIM_DIR, 'node_modules', 'ws'));
  } catch (err) {
    return Promise.resolve({ available: false, reason: `ws not loadable (${err.code || err.message})` });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => done({ available: true, packets: 0, source: null }), windowMs);
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const m = data && typeof data.msg === 'string' &&
          data.msg.match(/(\d+)\s+packets\/5s\s+from\s+'([^']*)'/);
        if (m) { clearTimeout(timer); done({ available: true, packets: Number(m[1]), source: m[2] }); }
      } catch { /* non-JSON monitor chatter — ignore */ }
    });
    ws.on('error', (err) => { clearTimeout(timer); done({ available: false, reason: err.code || err.message }); });
  });
}

async function cmdStatus() {
  const lock = readLock();
  if (!lock) {
    console.log(`No stack is running (no lock file at ${LOCK_PATH}).`);
    process.exit(1);
  }
  const alive = pidAlive(lock.pid);
  console.log(`Launcher: pid ${lock.pid} (${alive ? 'running' : 'DEAD — stale lock'}) · profile '${lock.profile}' · scene '${lock.scene}' · started ${lock.startedAt}`);
  const withNativePad = lock.withNativePad === true;
  const ports = readPorts({ requireNativePad: withNativePad });
  const results = await runHealthChecks(healthCheckList(ports, lock.profile, { withNativePad }));
  let allUp = true;
  for (const r of results) {
    allUp = allUp && r.up;
    const detail = r.up ? '' : (r.status === null ? ' (no response)' : ` (HTTP ${r.status})`);
    console.log(`  ${r.up ? '✅' : '❌'} ${r.name.padEnd(10)} ${r.url}${detail}`);
  }

  // Frame-flow — is the ship actually lit, or do the ports just answer?
  const sacnInUp = results.find((r) => r.name === 'sacn-in')?.up;
  if (sacnInUp) {
    const flow = await readFrameFlow(ports.sacn_port);
    if (!flow.available) {
      console.log(`  ◌ frames     could not read frame-flow (${flow.reason})`);
    } else if (flow.packets > 0) {
      console.log(`  ✅ frames     ~${flow.packets} sACN packets/5s from '${flow.source || 'unknown'}' — the rig is being driven`);
    } else {
      console.log('  ⚠ frames     sACN input bridge is UP but received 0 packets/5s — the rig may be DARK (is the engine sending?)');
    }
  }
  process.exit(alive && allUp ? 0 : 1);
}

// ── `stop` → blackout BEFORE the kill (report 20260805_160 T1) ──────────
// `stop` force-kills the launcher's whole process tree; on Windows that is
// `taskkill /T /F` (TerminateProcess), so the engine never ran its SIGTERM
// handler and never sent its shutdown blackout frame (marsin_engine/engine.js
// §8) — every controller held its LAST LIVE FRAME until its own E1.31 timeout,
// while `.agent/ops/show_server_ops.md` and `deploy/README.md` promise
// "lights OFF … before generator work".
//
// So: ask the engine, in band, to run that same shutdown FIRST
// (POST /shutdown → engine's `requestShutdown` hook → the one existing blackout
// path → exit), and wait a bounded time for its process to be gone. Nothing is
// duplicated here and nothing is persisted (POST /global-blackout would write
// globalsState.blackout, which the next boot restores — i.e. a dark start).
//
// The kill ALWAYS follows: stop must always stop. An unconfirmed blackout is
// reported LOUDLY rather than swallowed.
const BLACKOUT_CONFIRM_MS = 3000;
const BLACKOUT_CHILD_TAG = 'engine';   // must match startChild('engine', …)
const BLACKOUT_UNCONFIRMED_MSG =
  'BLACKOUT NOT CONFIRMED — rig may still be lit. Confirm darkness by eye before any electrical work.';

// `deps` exists so the decision logic, the bounded wait and the loud message are
// testable in-process without a live stack (no ports bound, no process signalled).
async function blackoutEngineBeforeKill(lock, deps = {}) {
  const post = deps.post || httpPostJson;
  const isAlive = deps.pidAlive || pidAlive;
  const nap = deps.sleep || sleep;
  const clock = deps.now || Date.now;
  const budgetMs = deps.timeoutMs === undefined ? BLACKOUT_CONFIRM_MS : deps.timeoutMs;

  const enginePid = (lock.children || {})[BLACKOUT_CHILD_TAG];
  if (!enginePid) {
    // Every profile runs an engine, so a lock without one is an anomaly, not a
    // configuration we quietly accept.
    logError(`No '${BLACKOUT_CHILD_TAG}' child recorded in the lock — nothing to ask for a blackout. ${BLACKOUT_UNCONFIRMED_MSG}`);
    return { confirmed: false, reason: 'no engine pid in lock' };
  }

  if (!isAlive(enginePid)) {
    // Nothing to ask, and nothing may ask on its behalf: POSTing to :6968 with
    // our own engine already dead would shut down whatever OTHER engine happens
    // to answer that port. State the consequence instead.
    logError(`Engine (pid ${enginePid}) is already gone — no blackout can be sent now. If it died without one, ${BLACKOUT_UNCONFIRMED_MSG}`);
    return { confirmed: false, reason: 'engine already gone' };
  }

  let ports;
  try {
    ports = deps.ports || readPorts();
  } catch (err) {
    // Loud degradation, never silent: without the port map we cannot reach the
    // engine — but we must still complete the kill below.
    logError(`Cannot read the port map (${err.message}) — cannot request the blackout. ${BLACKOUT_UNCONFIRMED_MSG}`);
    return { confirmed: false, reason: 'port map unreadable' };
  }

  const url = `http://127.0.0.1:${ports.marsin_engine_port}/shutdown`;
  const outcome = await post(url, { confirm: true }).then(
    (status) => ({ status }), (err) => ({ error: err.message }));
  if (outcome.error) {
    logError(`Engine refused/ignored the blackout request (POST ${url}: ${outcome.error}). ${BLACKOUT_UNCONFIRMED_MSG}`);
    return { confirmed: false, reason: 'request failed' };
  }

  console.log(`Blackout requested (POST ${url}) — waiting up to ${budgetMs / 1000}s for the engine to go dark and exit…`);
  const deadline = clock() + budgetMs;
  while (clock() < deadline) {
    if (!isAlive(enginePid)) {
      console.log('✅ Engine sent its blackout frame and exited — the rig is dark.');
      return { confirmed: true, reason: 'engine exited' };
    }
    await nap(200);
  }
  logError(`Engine (pid ${enginePid}) was still alive ${budgetMs / 1000}s after accepting the blackout request. ${BLACKOUT_UNCONFIRMED_MSG}`);
  return { confirmed: false, reason: 'engine still alive' };
}

// ── The reap path: lock-recorded PIDs ∪ identity-checked port holders ────
//
// docs/62 W-A3. Reaping only what the lock remembers is not enough: a child
// whose recorded pid died while its real server survived (the cmd.exe-wrapper
// class), or a grandchild the lock never knew, stays alive holding a stack port
// and the next boot collides with it. So `stop` — and the sentinel reaper, which
// runs THIS SAME code — reap the UNION.
//
// The port half goes through `portCleanup.freeStackPorts`, which is
// identity-checked (only our signatures) and ARM-interlocked by construction:
// anything foreign is REPORTED, never killed, and an armed bench mirror is
// refused by name.

// Kill the children the lock recorded, identity-checked against PID reuse.
function reapLockChildren(lock, logger = console.log) {
  const reaped = [];
  const recorded = new Map();
  for (const [tag, pid] of Object.entries(lock.children || {})) recorded.set(pid, tag);
  // W-A2: the port-resolved pids sit beside the spawn pids; a shell-wrapped
  // child is only truly reaped when the process behind the wrapper is.
  for (const [tag, pid] of Object.entries(lock.resolvedChildren || {})) {
    if (!recorded.has(pid)) recorded.set(pid, `${tag} (resolved)`);
  }
  for (const [pid, tag] of recorded) {
    // Only kill a recorded child if it's still alive AND its command line
    // looks like ours — guards against PID reuse killing an innocent process.
    if (!pidAlive(pid)) continue;
    // Read the command line ONCE: on Windows each read is a PowerShell/CIM
    // round-trip, and the old `.some(sig => commandlineOf(pid)…)` shape paid for
    // one per signature.
    const cmd = portCleanup.commandlineOf(pid);
    if (!portCleanup.STACK_PROCESS_SIGNATURES.some((sig) => cmd.includes(sig))) continue;
    logger(`Force-killing orphaned ${tag} (pid ${pid}).`);
    forceKillTree(pid);
    reaped.push({ tag, pid });
  }
  return reaped;
}

// Sweep this run's ports of anything of ours the lock lost track of.
// Returns null when the lock predates W-A2 and carries no stackPorts — loudly,
// because the alternative (re-deriving profile logic here) is exactly the kind
// of guess that leaves a second definition to drift.
function sweepStackPorts(lock, logger = console.log) {
  const ports = Array.isArray(lock.stackPorts) ? lock.stackPorts : null;
  if (!ports || ports.length === 0) {
    logger('⚠ This lock carries no stackPorts (written by a pre-W-A2 launcher) — reaping the '
      + 'lock-recorded children only. Any orphan that lost its lock entry must be found by hand: '
      + 'node tools/port_cleanup.cjs, or `npm run kill-ports` in simulation/.');
    return null;
  }
  const outcome = portCleanup.freeStackPorts(ports, { log: logger });
  for (const f of outcome.foreign) {
    logger(`  · :${f.port} is held by pid ${f.pid} (${f.cmd.slice(0, 100)}) — FOREIGN, left alone.`);
  }
  for (const r of outcome.refused) {
    logger(`  · :${r.port} pid ${r.pid} was REFUSED — ${r.why}`);
  }
  return outcome;
}

// Which of our own signatures still hold a stack port after the sweep? Any hit
// is a failed stop, reported by name (foreign holders are not our failure).
function survivingStackHolders(lock) {
  const ports = Array.isArray(lock.stackPorts) ? lock.stackPorts : [];
  const survivors = [];
  for (const port of ports) {
    for (const pid of portCleanup.listenersOnPort(port)) {
      if (pid === process.pid) continue;
      const cmd = portCleanup.commandlineOf(pid);
      if (!cmd) continue;
      if (portCleanup.STACK_PROCESS_SIGNATURES.some((sig) => cmd.includes(sig))) {
        survivors.push({ port, pid, cmd });
      }
    }
  }
  return survivors;
}

// The whole stale-lock teardown, in one place, so `stop` and the sentinel reaper
// can never drift apart: blackout → lock-children reap → port sweep → lock
// removal. Returns a summary; callers own the exit code.
async function reapStaleStack(lock, deps = {}) {
  const logger = deps.log || console.log;
  const blackout = deps.blackout || blackoutEngineBeforeKill;
  const blackoutResult = await blackout(lock);
  const reaped = reapLockChildren(lock, logger);
  const sweep = sweepStackPorts(lock, logger);
  try {
    fs.unlinkSync(LOCK_PATH);
    logger(`Removed the lock file (${LOCK_PATH}).`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { blackout: blackoutResult, reaped, sweep };
}

// ── The sentinel reaper (docs/62 W-A5) ──────────────────────────────────
// Detached, unref'd, and deliberately NOT in `children` — it must outlive us.
// It watches this launcher's pid and, if we die abnormally while the lock still
// names us, runs `reapStaleStack` above. A clean stop removes the lock, which is
// the sentinel's signal to exit silently.
function startReaper() {
  if (!fs.existsSync(REAPER_SCRIPT)) {
    logError(`Sentinel reaper missing (${REAPER_SCRIPT}) — an abnormal launcher death would orphan `
      + 'this stack. Restore tools/launcher_reaper.cjs (docs/62 W-A5).');
    return null;
  }
  let logFd;
  try {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    logFd = fs.openSync(REAPER_LOG, 'a');
  } catch (err) {
    logError(`Could not open the reaper log ${REAPER_LOG} (${err.message}) — not starting the sentinel.`);
    return null;
  }
  try {
    const sentinel = spawn(process.execPath, [REAPER_SCRIPT, LOCK_PATH, String(process.pid)], {
      cwd: ROOT,
      env: buildChildEnv({ BM26_REAPER_LOG: REAPER_LOG }),
      stdio: ['ignore', logFd, logFd],
      detached: true,
      shell: false,
    });
    sentinel.unref();
    // Record it so a `-f` takeover can retire the OLD sentinel explicitly (see
    // killPreviousReaper): a sentinel that fired mid-takeover would sweep the
    // very ports the incoming stack is claiming.
    const lock = readLock();
    if (lock && lock.pid === process.pid) {
      lock.reaperPid = sentinel.pid;
      fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2));
    }
    log('launcher', `Sentinel reaper watching pid ${process.pid} (pid ${sentinel.pid}; log ${REAPER_LOG}).`);
    return sentinel;
  } finally {
    fs.closeSync(logFd);
  }
}

async function cmdStop() {
  const lock = readLock();
  if (!lock) {
    console.log(`No stack is running (no lock file at ${LOCK_PATH}).`);
    process.exit(1);
  }
  if (!lockLauncherAlive(lock)) {
    console.log(`Launcher pid ${lock.pid} is not a live launcher — cleaning up stale lock.`);
    // The launcher is gone but an orphaned engine can still be driving the rig.
    await reapStaleStack(lock);
    finishStop(lock);
    return;
  }
  console.log(`Stopping launcher pid ${lock.pid} (profile '${lock.profile}')…`);
  // Lights OFF first — the force-kill below can never do it (see above).
  await blackoutEngineBeforeKill(lock);
  if (IS_WIN) forceKillTree(lock.pid);
  else process.kill(lock.pid, 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS + 7000;
  while (Date.now() < deadline) {
    // A force-killed launcher (Windows taskkill /T /F) never runs its own
    // teardown, so it can't remove its lock — once its PID is gone, WE remove
    // the lock + reap any orphaned children instead of waiting forever.
    if (!pidAlive(lock.pid)) {
      reapLockChildren(lock);
      sweepStackPorts(lock);
      try { fs.unlinkSync(LOCK_PATH); } catch { /* already gone */ }
      console.log('Stack stopped.');
      finishStop(lock);
      return;
    }
    await sleep(500);
  }
  logError(`Launcher pid ${lock.pid} did not stop within ${(STOP_GRACE_MS + 7000) / 1000}s. Force it: taskkill /PID ${lock.pid} /T /F (Windows), then delete ${LOCK_PATH}.`);
  process.exit(1);
}

// `stop` must actually stop: if one of OUR signatures still holds a stack port
// after the reap, say which and exit non-zero (docs/62 W-A3). No fallback, no
// "probably fine".
function finishStop(lock) {
  const survivors = survivingStackHolders(lock);
  if (survivors.length === 0) return;
  for (const s of survivors) {
    logError(`STILL RUNNING: pid ${s.pid} holds :${s.port} (${s.cmd.slice(0, 110)}).`);
  }
  logError('`stop` did not fully stop the stack. Kill the pids above by hand '
    + '(taskkill /PID <pid> /T /F on Windows) — an armed bench mirror is refused on purpose and '
    + `needs a DISARM in the sim, or ${portCleanup.FORCE_SACN_KILL_FLAG}.`);
  process.exit(1);
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  // The launcher owns the CI variable for the WHOLE session, not just per
  // child spawn (buildChildEnv already deletes it there): a `CI` inherited
  // from the invoking shell — agent harnesses export CI=true, and CI=""
  // crashes Expo with GetEnv.NoBoolean — must never reach any code path.
  // Deleting it here makes the documented `env -u CI` prefix unnecessary on
  // every command (operator order 2026-08-16: "skip CI on prod launches").
  // Announced, not silent: this is a show launcher, never a CI job.
  if ('CI' in process.env) {
    console.log(`[launcher] CI env var inherited from the shell (CI=${JSON.stringify(process.env.CI)}) — removed for this session; Expo requires it genuinely absent.`);
    delete process.env.CI;
  }
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'setup') return cmdSetup();
  if (opts.command === 'status') return cmdStatus();
  if (opts.command === 'stop') return cmdStop();
  if (opts.command === 'rebuild-pad') return cmdRebuildPad();

  const profileDef = PROFILES[opts.command];

  // Report 20260725_115 L6/P1-5: VALIDATE BEFORE assertSingleInstance. The
  // single-instance check, with -f (and `prod` force-claims by default),
  // force-KILLS the running stack. Validation must run first so a scene/pattern
  // typo fails loudly WITHOUT first taking the live show down and then exiting.
  // validate() is a pure existence check (no ports, no side effects), so it is
  // always safe to run before we touch anything.
  // It also settles the CaptainPad serving mode, the `--with-native-pad` verdict
  // (docs/62 W-B1) and the Metro dependency-fingerprint guard (W-B2) — every one
  // of them must fail BEFORE the running stack can be force-claimed.
  const { captainPadMode, nativePad, metroState, metroGuard } = validate(opts, profileDef);

  // The native-pad port is DEMANDED only when the flag is present (W-B1).
  const ports = readPorts({ requireNativePad: nativePad.enabled });

  // Resolve + validate every profile knob BEFORE the single-instance check,
  // which (with -f, and prod force-claims by default) KILLS the running stack:
  // a bad --sacn-priority must fail while the show is still lit, exactly like a
  // bad --scene does. These throw; main()'s catch prints and exits.
  const simProfile = resolveSimProfile(opts.command, profileDef, opts.simProfile);
  const sacnPriority = resolveSacnPriority(opts.command, profileDef, opts.sacnPriority);
  // Detected here (not at spawn time) for the same reason: no half-started stack
  // if this machine's LAN address is ambiguous. Only Expo needs it.
  // detectLanHost returns {host, source} — keep BOTH, but everything downstream
  // (env var, log lines) needs the plain host STRING. Passing the object into
  // REACT_NATIVE_PACKAGER_HOSTNAME stringifies to "[object Object]" and kills
  // Metro's dev-middleware with "TypeError: Invalid URL" at boot (hit live,
  // gen-6 first launch).
  // `--with-native-pad` makes it REQUIRED on a static profile too: that Metro
  // exists precisely to serve Expo Go on the iPad, and an ambiguous host would
  // bake 127.0.0.1 into every native manifest it hands out.
  const lanHostInfo = (captainPadMode === 'expo' || nativePad.enabled)
    ? detectLanHost(os.networkInterfaces(), opts.lanHost) : null;
  const lanHost = lanHostInfo ? lanHostInfo.host : null;

  await assertSingleInstance(opts.force);

  // Build the sim URL straight from the profile config + the common params,
  // so the auto-opened browser tab always carries this profile's settings.
  const simQuery = new URLSearchParams({ scene: opts.scene, ...SIM_QUERY_COMMON });
  for (const [key, value] of Object.entries(profileDef.simParams)) {
    simQuery.set(key, String(value));
  }
  simQuery.set('profile', simProfile); // honors --sim-profile over the profile default
  const simUrl = `http://localhost:${ports.http_port}/simulation/?${simQuery.toString()}`;
  // Companions for this profile (audio analyzer + timeline), from the registry.
  // Ports are fixed at each server's default; see docs/38 §2 and docs/37 §9.
  const activeCompanions = (profileDef.companions || []).map((name) => COMPANIONS[name]);

  log('launcher', `Profile '${opts.command}' — ${profileDef.description}`);
  log('launcher', `Scene/model: ${opts.scene} · boot pattern: ${opts.pattern}`);
  log('launcher', `Sim lighting profile: ${simProfile} · sACN priority: ${sacnPriority} (E1.31 ${SACN_PRIORITY_MIN}-${SACN_PRIORITY_MAX})`);
  if (captainPadMode) {
    log('launcher', `CaptainPad: ${captainPadMode === 'static'
      ? `static build (${CAPTAINPAD_DIST_DIR})`
      : `Expo dev server, bundle host ${lanHost}`}`);
  }
  const nativePadPort = nativePad.enabled ? ports[NATIVE_PAD_PORT_KEY] : null;
  if (nativePad.enabled) {
    log('launcher', `CaptainPad native (Expo Go): supervised Metro on :${nativePadPort}, `
      + `bundle host ${lanHost}`);
  }
  // docs/62 W-B2 — announced BEFORE the Metro starts, so the operator reads the
  // reason on the same screen as the (slower) cleared-cache start.
  if (metroGuard) log('launcher', `Metro cache: ${metroGuard.why}`);

  const stackPorts = [ports.http_port, ports.save_port, ports.sacn_port, ports.sacn_output_port,
    ports.marsin_engine_port];
  if (profileDef.processes.includes('captainpad')) stackPorts.push(ports.captainpad_web_port);
  if (nativePad.enabled) stackPorts.push(nativePadPort);
  for (const c of activeCompanions) stackPorts.push(c.port);

  // `prod` is the show stack — it force-claims its ports by default (a stuck
  // foreign process must never block the rig coming up). Any profile + `-f`.
  const force = opts.force || opts.command === 'prod';
  if (force && opts.command === 'prod' && !opts.force) {
    log('launcher', 'prod profile: force-claiming stack ports (kills any process holding them).');
  }
  if (opts.kill) claimStackPorts(stackPorts, force);
  await assertPortsFree(stackPorts);

  writeLock({
    pid: process.pid,
    profile: opts.command,
    scene: opts.scene,
    pattern: opts.pattern,
    startedAt: new Date().toISOString(),
    // docs/62 W-A2: the lock carries the ports this run owns, so `stop` and the
    // sentinel reaper can sweep by port without re-deriving profile logic.
    stackPorts,
    // docs/62 W-B1: `status` probes the extra native-pad row only when the run
    // that wrote this lock actually asked for that child.
    withNativePad: nativePad.enabled,
    children: {},
    resolvedChildren: {},
  });

  // docs/62 W-A5: the sentinel outlives us on purpose — if this launcher dies
  // abnormally (a killed shell task, a power-cut console), it runs the same
  // stop reap path so nothing is orphaned.
  startReaper();

  const captainPadUrl = `http://localhost:${ports.captainpad_web_port}/`;

  // 1. Simulation servers (HTTP, save, sACN in/out).
  await assertSacnUdpAvailable(ports.sacn_udp_port, opts.kill);
  // The sACN bridges relay every frame — a starved bridge is the same symptom as
  // a starved engine. They default to HIGH (lightweight relays); REALTIME is
  // reserved for the engine, so the bridges track the engine request only up to
  // HIGH. BM26_BRIDGE_PRIORITY flows sim → start.js → both bridge children
  // (inherited env); start.js and each bridge use it. See tools/process_priority.cjs.
  const bridgePriority = opts.enginePriority === 'realtime' ? 'high' : opts.enginePriority;
  startChild('sim', 'node', ['start.js', '--scene', opts.scene], SIM_DIR,
    { BM26_BRIDGE_PRIORITY: bridgePriority });
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
    // BM26_ENGINE_PRIORITY makes the launcher the authority on the engine's OS
    // priority (the engine self-elevates off this env first). See
    // tools/process_priority.cjs.
    // `--priority` is the E1.31 PER-PACKET priority stamped on every sACN frame
    // (not an OS priority — that is BM26_ENGINE_PRIORITY below). Passed
    // explicitly on every launch so the show stack's precedence over a dev
    // laptop is a property of the PROFILE, never of whatever config.yaml the
    // machine happens to carry.
    startChild('engine', 'node',
      ['engine.js', '--model', scene, '--pattern', opts.pattern,
        '--priority', String(sacnPriority)], ENGINE_DIR,
      {
        BM26_SUPERVISED: '1', BM26_SCENE_SWITCH_FILE: SCENE_SWITCH_FILE,
        BM26_ENGINE_PRIORITY: opts.enginePriority,
        // The supervised show stack always requires the external CaptainPad
        // credential source. Direct engine/test runs remain explicit
        // auth-disabled environments unless their harness opts in.
        BM26_CAPTAINPAD_AUTH_REQUIRED: '1',
      },
      handleEngineExit);
    await waitForHttp('engine api', `${engineUrl}/status`, 120000);
    // Belt (parent-side) elevation, now that the engine is confirmed up. We
    // resolve the engine's REAL pid via the API port it just bound — robust on
    // Windows where `engineChild.pid` is the shell wrapper, not node (the
    // listening socket is owned by the actual engine process). The engine's OWN
    // self-elevation (logged [EnginePriority]) is the guarantee; this reinforces
    // it and gives a parent-side read-back. Never fatal.
    // W-A2: the engine spawns shell-free now, so `child.pid` in the lock is
    // already the real node pid — record the port-resolved pid beside it so a
    // cross-check (lock engine pid == owner of the engine port) is possible from
    // outside, and so `stop` reaps the right process even if that ever changes.
    recordResolvedChild('engine', ports.marsin_engine_port);
    try {
      const enginePids = portCleanup.listenersOnPort(ports.marsin_engine_port).filter((p) => p !== process.pid);
      if (enginePids.length === 0) {
        log('launcher', `[EnginePriority] ⚠ could not resolve the engine pid on :${ports.marsin_engine_port} ` +
          `for parent-side elevation — relying on the engine's own self-elevation (its [EnginePriority] line is authoritative).`);
      } else {
        for (const pid of enginePids) {
          processPriority.elevatePid(pid, opts.enginePriority,
            { label: 'EnginePriority', logger: (m) => log('launcher', m) });
        }
      }
    } catch (err) {
      log('launcher', `[EnginePriority] ⚠ parent-side elevation probe failed (${err.message}) — ` +
        `relying on the engine's own self-elevation.`);
    }
    // The engine restores persisted deck state at boot, which overrides the
    // --pattern CLI flag. Re-assert the selected pattern only after confirming
    // that crash recovery did not resume the global Performance lock.
    await initializeEnginePattern(engineUrl, opts.pattern);
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

  // 2b. Companions — started after the engine and in profile order. The audio
  // analyzer's OSC output (host/port from config.companion.osc) lands in the
  // engine CPC; the timeline companion drives the engine over its API. Each is
  // supervised like the other stack children, so teardown reaches them; UDP/API
  // sends are fire-and-forget, so they tolerate the engine restarting under them.
  for (const [name, c] of (profileDef.companions || []).map((n) => [n, COMPANIONS[n]])) {
    const args = ['--port', String(c.port), ...(c.extraArgs ? c.extraArgs(opts) : [])];
    startChild(name, 'node', [c.script, ...args], ENGINE_DIR);
    await waitForHttp(c.label, `http://localhost:${c.port}${c.healthPath}`, c.waitMs);
    log('launcher', `✅ ${c.label} is ready.`);
  }

  // 3. CaptainPad — every profile serves it; HOW depends on profileDef.captainPad.
  if (captainPadMode === 'static') {
    // Show machines serve the PREBUILT export: no Metro, no bundler, nothing
    // that can decide to recompile during a show. Node built-ins only, so it
    // also works offline with no npx resolution (codex P0: no runtime installs).
    startChild('captainpad', 'node',
      [STATIC_WEB_SERVER, '--root', CAPTAINPAD_DIST_DIR,
        '--port', String(ports.captainpad_web_port), '--host', '0.0.0.0'],
      ROOT);
    await waitForHttp('captainpad web', captainPadUrl, 30000);
    log('launcher', '✅ CaptainPad is ready (static build).');
  } else if (captainPadMode === 'expo') {
    startChild('captainpad', 'npx',
      metroArgs(['expo', 'start', '--web', '--port', String(ports.captainpad_web_port)], metroGuard),
      CAPTAINPAD_DIR, metroChildEnv(lanHost));
    await waitForHttp('captainpad web', captainPadUrl, 300000);
    // W-A2: `npx expo` is the ONE child that still needs cmd.exe, so its
    // `child.pid` is the wrapper. Resolve the pid that actually owns the port
    // and record it beside the wrapper, or a wrapper-only death leaves a live
    // Metro the lock-based reap skips.
    const metroPid = recordResolvedChild('captainpad', ports.captainpad_web_port);
    if (metroPid !== null) log('launcher', `  ✓ CaptainPad Metro real pid ${metroPid} recorded in the lock.`);
    markMetroReady(metroState);
    log('launcher', `✅ CaptainPad is ready (Expo dev server · bundle host ${lanHost}).`);
  }

  // 3b. The native (Expo Go) pad — docs/62 W-B1. A SUPERVISED Metro beside the
  // static web pad, so the iPad's native path is an ordinary launcher child with
  // a health row, a lock entry and a teardown, instead of a hand-run background
  // shell command that survives every stop.
  if (nativePad.enabled) {
    const nativeUrl = `http://127.0.0.1:${nativePadPort}/`;
    startChild(NATIVE_PAD_TAG, 'npx',
      // No `--web`: this Metro's job is the Expo Go manifest + native bundles.
      // Identical env contract to the expo-profile Metro, by construction.
      // `--go` is REQUIRED: CaptainPad depends on expo-dev-client, which flips
      // `expo start`'s default to Development Build mode — a mode no build of
      // ours exists for. Without it this child serves dev-client manifests and
      // Expo Go times out on the deep link.
      metroArgs(['expo', 'start', '--go', '--port', String(nativePadPort)], metroGuard),
      CAPTAINPAD_DIR, metroChildEnv(lanHost));
    await waitForHttp('captainpad native', nativeUrl, 300000);
    const nativePid = recordResolvedChild(NATIVE_PAD_TAG, nativePadPort);
    if (nativePid !== null) log('launcher', `  ✓ CaptainPad native Metro real pid ${nativePid} recorded in the lock.`);
    markMetroReady(metroState);
    log('launcher', `✅ CaptainPad native Metro is ready (Expo Go · bundle host ${lanHost}).`);
  }

  // All relevant processes are confirmed up — now auto-open this profile's UIs
  // in the proven order sim → CaptainPad → companions (see openProfileUis).
  openProfileUis(opts, profileDef, {
    sim: simUrl,
    captainPad: captainPadUrl,
  });

  log('launcher', '────────────────────────────────────────────────────────');
  log('launcher', `🚀 Stack is up (profile: ${opts.command})`);
  log('launcher', '');
  log('launcher', opts.open ? '   Opened in your browser (URLs below if you need them):'
    : '   Open in your browser:');
  log('launcher', `     Simulation:  ${simUrl}`);
  if (profileDef.processes.includes('captainpad')) {
    log('launcher', `     CaptainPad:  ${captainPadUrl}`);
  }
  if (nativePad.enabled) {
    // What the operator types into Expo Go (or scans — .agent/skills/expo_go_qr.md).
    log('launcher', `     Expo Go:     exp://${lanHost}:${nativePadPort}`);
  }
  for (const c of activeCompanions) {
    log('launcher', `     ${c.label.padEnd(11)} http://localhost:${c.port}`);
  }
  log('launcher', '');
  log('launcher', `   Engine API:    http://localhost:${ports.marsin_engine_port}/status`);
  log('launcher', '   Ctrl+C stops everything (`node launcher.js stop` works too).');
  log('launcher', '────────────────────────────────────────────────────────');
}

// Run as a CLI only when invoked directly. Guarding main() behind require.main
// lets tests import the pure helpers (report _115 P2-6 testability goal) without
// launching the stack.
if (require.main === module) {
  main().catch((err) => {
    if (!shuttingDown) {
      logError(err.message);
      teardown(1);
    }
  });
}

module.exports = {
  bindProbe, checkPortFree, readPorts,
  healthCheckList, runHealthChecks, readFrameFlow,
  validateCaptainPadSecrets,
  PROFILES, COMPANIONS, SIM_QUERY_COMMON,
  SIM_LIGHTING_PROFILES, CAPTAINPAD_MODES,
  SACN_PRIORITY_MIN, SACN_PRIORITY_MAX,
  resolveSacnPriority, resolveSimProfile, resolveCaptainPadMode,
  buildChildEnv, lanIpv4Candidates, detectLanHost,
  httpGetJson, initializeEnginePattern,
  blackoutEngineBeforeKill, BLACKOUT_CONFIRM_MS, BLACKOUT_UNCONFIRMED_MSG,
  // ── docs/62 W-A: spawn contract, union reap, sentinel reaper ──
  LOCK_PATH, REAPER_LOG,
  spawnNeedsShell, windowsShellQuote, startChild,
  resolvePortOwner,
  killStaleListeners, benchMirrorTreeGuard,
  reapLockChildren, sweepStackPorts, survivingStackHolders, reapStaleStack,
  readLock, pidAlive,
  // ── docs/62 W-B: the supervised native pad + the stale-Metro guard ──
  NATIVE_PAD_TAG, NATIVE_PAD_FLAG, NATIVE_PAD_PORT_KEY,
  resolveNativePadRequest, captainPadMetroDependencyProblems,
  metroDependencyFingerprint, readMetroDependencyState, metroCacheGuard, metroArgs, metroChildEnv,
  METRO_FINGERPRINT_STAMP, INSTALL_WRITE_ORDER_SLACK_MS,
  // ── docs/62 W-C: rebuild-pad + the stale-dist warning ──
  SUBCOMMANDS, REBUILD_PAD_LOCK,
  runningExpoExports, stackMetroState, rebuildPadGuard, rebuildPadState, rebuildPad,
  newestSourceMtime, distStalenessVerdict, CAPTAINPAD_SOURCE_DIRS,
};
