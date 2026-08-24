#!/usr/bin/env node
/**
 * hil_push_check.cjs — hardware-in-the-loop check of the REAL narrowed config
 * push + DMX toggle paths (report `_363` §6), against the TWO authorized boards
 * ONLY: `ss_right_right` (.65) and `ss_right_left` (.66).
 *
 * `.61`/`.62` are operator-reserved and STRICTLY off-limits, as is every other
 * board — the frozen `HIL_ALLOWED` allowlist below refuses everything else
 * BEFORE any network I/O. There is NO default target: the boards, their
 * expected controllerIds and their serial ports are all explicit flags, and no
 * flag ever widens targeting.
 *
 * This tool is EXPLICIT OPT-IN. It is never part of any suite: it lives in
 * `tools/` (the default test glob is `tests/*.test.js`) and no npm script
 * references it. Importing it runs NOTHING — every pure helper is exported for
 * `tests/hil_push_check.test.js`, and the run body sits behind
 * `require.main === module`.
 *
 * WHAT IT PROVES (per target, sequential, §6.4):
 *
 *   SNAPSHOT → CONFIG push leg → DMX toggle OFF leg → DMX toggle ON leg →
 *   RESTORE (deep-equal verified)
 *
 * using the SAME client functions the Controllers panel calls — no second
 * implementation of the contract. `marsinled_client.js` is a browser ES module
 * and this file is CommonJS; Node's native `require(esm)` (>= 22.12; this
 * project runs 24.x) bridges the boundary synchronously, exactly as
 * `server/led_gamma_service.cjs` already does. On an older Node the require
 * crashes RIGHT HERE at startup — the correct loud failure (codex P0).
 *
 * WHY SERIAL (§6.3): the firmware carries layered recovery — rejected applies,
 * a staged-config auto-revert, and boot-loop protection that can discard a
 * pending config and fall back to last-known-good or firmware-default strands
 * after repeated crashes. An HTTP read-back taken at the wrong moment can look
 * green before a later crash-revert changes the truth. The serial console shows
 * the reboot happening, whether it happened ONCE, any panic/watchdog, and which
 * strands the board actually initialized. `tools/hil_serial_tail.py` captures
 * it; `classifySerialWindow` (PURE, mock-tested) judges it.
 *
 * CONFIDENTIALITY: nothing here embeds private-firmware content. The crash
 * markers are the public ESP-IDF/ESP-ROM generic ones and the strand heuristics
 * are neutral shapes. Exact expected patterns MAY be supplied at run time via a
 * gitignored local file named by `BM26_HIL_SERIAL_PATTERNS`.
 *
 * Raw serial logs and config snapshots stay in `~/tmp/` (gitignored — boot logs
 * name WiFi SSIDs). Tracked reports carry paths + summarized verdicts only.
 *
 * Invocation (targets + serial mapping REQUIRED):
 *
 *   node tools/hil_push_check.cjs \
 *     --board <.65 IP> --expect-id ss_right_right --serial ss_right_right=COM7 \
 *     --board <.66 IP> --expect-id ss_right_left  --serial ss_right_left=COM8
 *
 * Exit codes: 0 all-PASS · 1 a leg FAILed · 2 usage / allowlist refusal (no I/O
 * happened).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { isDeepStrictEqual } = require('util');

const {
  getStatus,
  getConfig,
  deviceSupportsPerOutput,
  buildForcedConfigBody,
  pushForcedConfig,
  diffForcedConfig,
  swarmEnabledNote,
  buildDmxToggleBody,
  diffDmxToggle,
  pushDmxToggle,
  awaitReboot,
} = require('../src/dmx/led/marsinled_client.js');

// ── The frozen allowlist (§6.2-2) — binding, and the only targeting there is ──

/**
 * controllerId → the ONLY last IP octet that id may be reached at. Frozen: a
 * tool that can be talked into touching a third board is not a safe tool.
 */
const HIL_ALLOWED = Object.freeze({ ss_right_right: 65, ss_right_left: 66 });

/** Octets the operator is testing by hand — never touched by any tooling. */
const OPERATOR_RESERVED_OCTETS = Object.freeze([61, 62]);

const SERIAL_HELPER_PATH = path.join(__dirname, 'hil_serial_tail.py');

/** The three device-write budgets stay the panel's (report `_362` §2.3-5). */
const WRITE_TIMEOUT_MS = 12000;
const REBOOT_TIMEOUT_MS = 45000;

/** How long the attach gate watches a freshly opened port for a reset. */
const SERIAL_ATTACH_SETTLE_MS = 1500;
/** Grace given to the capture helper to flush a leg's lines before we read. */
const SERIAL_FLUSH_MS = 750;
/** How long we wait for the helper to report it is attached. */
const SERIAL_READY_TIMEOUT_MS = 15000;

/**
 * Two ROM banner lines of the SAME boot arrive milliseconds apart; markers
 * closer together than this are one boot, not two.
 */
const BOOT_COALESCE_MS = 2000;

/**
 * Public ESP32 boot-ROM markers — the chip prints these before any application
 * code runs, so they delimit boots regardless of firmware.
 */
const BOOT_MARKERS = Object.freeze([
  { name: 'esp-rom-banner', re: /ESP-ROM:/ },
  { name: 'rom-reset-reason', re: /\brst:0x[0-9a-f]+/i },
  { name: 'ets-banner', re: /^ets\s+[A-Z][a-z]{2}\s+\d/ },
]);

/**
 * ESP-IDF-generic fatal markers. GENERIC ONLY (confidentiality boundary): every
 * one of these is printed by the vendor SDK / boot ROM, not by our firmware.
 */
const CRASH_MARKERS = Object.freeze([
  { name: 'guru-meditation', re: /Guru Meditation Error/i },
  { name: 'panic', re: /panic'?ed|\*\*\* PANIC/i },
  { name: 'abort', re: /abort\(\) was called/i },
  { name: 'assert-failed', re: /assert(?:ion)? failed/i },
  { name: 'task-watchdog', re: /Task watchdog got triggered/i },
  { name: 'interrupt-watchdog', re: /Interrupt wdt timeout/i },
  { name: 'brownout', re: /Brownout detector was triggered/i },
  { name: 'heap-corruption', re: /CORRUPT HEAP/i },
  { name: 'backtrace', re: /Backtrace:\s*0x/i },
  { name: 'watchdog-reset-reason', re: /\brst:0x[0-9a-f]+\s*\((?=[^)]*(?:WDT|BROWN|PANIC))/i },
]);

/**
 * Neutral strand-init heuristics: a line that mentions a strand/output slot and
 * a pixel count. Numbers are EXTRACTED, never pattern-matched against firmware
 * wording. `BM26_HIL_SERIAL_PATTERNS` may add exact local patterns at run time.
 */
const STRAND_LINE_RE = /\b(?:strand|output|channel)\b/i;
const STRAND_INDEX_RE = /\b(?:strand|output|channel)\s*#?\s*(\d+)/i;
const STRAND_COUNT_RE = /\b(?:count|len(?:gth)?|px|pixels?|leds?)\b\s*[:=]?\s*(\d+)|\b(\d+)\s*(?:px|pixels?|leds?)\b/i;
const STRAND_TYPE_RE = /\btype\s*[:=]\s*([A-Za-z][A-Za-z0-9_-]*)/i;

// ── Errors ──────────────────────────────────────────────────────────────────

/** Bad invocation, or a target the allowlist refuses: exit 2, nothing ran. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A leg said no. `boardConfined` decides whether the next target still runs. */
class LegError extends Error {
  constructor(message, { boardConfined = true, details = [] } = {}) {
    super(message);
    this.name = 'LegError';
    this.boardConfined = boardConfined;
    this.details = details;
  }
}

function usageText() {
  return [
    'usage: node tools/hil_push_check.cjs \\',
    '         --board <ip> --expect-id <controllerId> --serial <controllerId>=<COMx> \\',
    '         [--board <ip> --expect-id <controllerId> --serial <controllerId>=<COMx>] \\',
    '         [--skip-config] [--skip-toggle] [--no-serial] [--expect-universes a,b]',
    '',
    'There is NO default target. --board and --expect-id are ORDERED PAIRS and every',
    'target needs a --serial mapping (unless --no-serial, which caps the verdict at',
    '"PASS (HTTP-only — not gate evidence)" — diagnostic only, never gate evidence).',
    '',
    `Allowed targets (frozen): ${Object.entries(HIL_ALLOWED)
      .map(([id, octet]) => `${id} → .${octet}`).join(', ')}.`,
    `Everything else is refused, and .${OPERATOR_RESERVED_OCTETS.join('/.')} are `
      + 'operator-reserved — never touched by any tooling.',
    '',
    'List the serial ports the operator can choose from:',
    '  python tools/hil_serial_tail.py --list',
  ].join('\n');
}

// ── PURE: argument parsing + the allowlist gate ──────────────────────────────

/**
 * Parse an argv TAIL (no `node`, no script path). PURE — it never reads
 * `process.argv`, touches the filesystem or opens anything, so the flag gate is
 * fully mock-testable and a flagless invocation costs zero I/O.
 *
 * @param {string[]} argv
 * @returns {{targets: Array<{id: string, ip: string, serialPort: (string|null)}>,
 *   skipConfig: boolean, skipToggle: boolean, noSerial: boolean,
 *   expectUniverses: (number[]|null)}}
 * @throws {UsageError}
 */
function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new UsageError('parseArgs: argv must be an array');
  const boards = [];
  const ids = [];
  const serialByIdPort = new Map();
  let skipConfig = false;
  let skipToggle = false;
  let noSerial = false;
  let expectUniverses = null;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || String(v).startsWith('--')) {
        throw new UsageError(`${flag} needs a value`);
      }
      i += 1;
      return String(v);
    };
    switch (flag) {
      case '--board': boards.push(value()); break;
      case '--expect-id': ids.push(value()); break;
      case '--serial': {
        const pair = value();
        const eq = pair.indexOf('=');
        if (eq < 1 || eq === pair.length - 1) {
          throw new UsageError(`--serial must be <controllerId>=<COMx> (got '${pair}')`);
        }
        const id = pair.slice(0, eq);
        if (serialByIdPort.has(id)) {
          throw new UsageError(`--serial names '${id}' twice — one port per target`);
        }
        serialByIdPort.set(id, pair.slice(eq + 1));
        break;
      }
      case '--skip-config': skipConfig = true; break;
      case '--skip-toggle': skipToggle = true; break;
      case '--no-serial': noSerial = true; break;
      case '--expect-universes': {
        const raw = value();
        const parsed = raw.split(',').map((part) => {
          const n = Number(part.trim());
          if (!Number.isInteger(n) || n < 1) {
            throw new UsageError(`--expect-universes: '${part.trim()}' is not a universe number`);
          }
          return n;
        });
        if (parsed.length === 0) throw new UsageError('--expect-universes needs at least one universe');
        expectUniverses = parsed;
        break;
      }
      case '--help':
      case '-h':
        throw new UsageError('usage requested');
      default:
        throw new UsageError(`unknown argument '${flag}'`);
    }
  }

  // ── The flag gate (§6.2-1): no pair, no run. There is no default target. ──
  if (boards.length === 0 && ids.length === 0) {
    throw new UsageError('no target given — this tool has NO default target; name every board '
      + 'and its expected controllerId explicitly');
  }
  if (boards.length !== ids.length) {
    throw new UsageError(`--board/--expect-id are ORDERED PAIRS — got ${boards.length} board(s) `
      + `and ${ids.length} id(s)`);
  }

  const targets = boards.map((ip, index) => ({ id: ids[index], ip, serialPort: null }));

  if (skipConfig && skipToggle) {
    throw new UsageError('--skip-config together with --skip-toggle leaves nothing to prove');
  }

  if (noSerial) {
    if (serialByIdPort.size > 0) {
      throw new UsageError('--no-serial and --serial contradict each other');
    }
  } else {
    for (const target of targets) {
      const port = serialByIdPort.get(target.id);
      if (!port) {
        throw new UsageError(`no --serial mapping for '${target.id}' — the serial console is the `
          + 'independent evidence channel; pass --serial <id>=<COMx> or --no-serial (diagnostic '
          + 'only). `python tools/hil_serial_tail.py --list` names the ports');
      }
      target.serialPort = port;
    }
    for (const id of serialByIdPort.keys()) {
      if (!targets.some((t) => t.id === id)) {
        throw new UsageError(`--serial names '${id}', which is not one of this run's targets`);
      }
    }
  }

  if (expectUniverses && targets.length > 1) {
    throw new UsageError('--expect-universes states ONE board\'s universes and cannot be applied '
      + 'to several targets — run one target at a time, or drop the flag');
  }

  return { targets, skipConfig, skipToggle, noSerial, expectUniverses };
}

/**
 * The last octet of a dotted-quad IPv4 literal. THROWS on anything else — a
 * hostname or an `ip:port` would slip past the allowlist's octet check.
 * @param {string} ip
 * @returns {number}
 */
function lastOctet(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) {
    throw new UsageError(`--board '${ip}' must be a dotted-quad IPv4 address (this tool speaks `
      + 'device HTTP :80 and nothing else — never a sim/engine port)');
  }
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      throw new UsageError(`--board '${ip}' must be a dotted-quad IPv4 address`);
    }
    const n = Number(part);
    if (n < 0 || n > 255) throw new UsageError(`--board '${ip}' has an octet out of range`);
    return n;
  });
  return octets[3];
}

/**
 * The allowlist gate (§6.2-2). PURE, and called BEFORE any network I/O: every
 * `--expect-id` must be a key of `HIL_ALLOWED` AND its `--board` last octet must
 * equal the mapped octet.
 * @param {{id: string, ip: string}} target
 * @throws {UsageError}
 */
function assertTargetAllowed(target) {
  const reserved = `.${OPERATOR_RESERVED_OCTETS.join('/.')} are operator-reserved (the operator `
    + 'is testing them by hand) and are never touched by any tooling';
  const allowed = Object.entries(HIL_ALLOWED)
    .map(([id, octet]) => `${id} (.${octet})`).join(', ');
  if (!Object.prototype.hasOwnProperty.call(HIL_ALLOWED, target.id)) {
    throw new UsageError(`REFUSED: '${target.id}' is not an authorized HIL target. Allowed: `
      + `${allowed}. ${reserved}.`);
  }
  const want = HIL_ALLOWED[target.id];
  const got = lastOctet(target.ip);
  if (got !== want) {
    throw new UsageError(`REFUSED: '${target.id}' is authorized at .${want} only, but --board `
      + `names .${got}. ${reserved}.`);
  }
}

/** Run the allowlist gate over every target; the first refusal aborts the run. */
function assertTargetsAllowed(targets) {
  for (const target of targets) assertTargetAllowed(target);
  return targets;
}

// ── PURE: plan + restore body derived from the board's OWN pre-snapshot ──────

/**
 * Build the config leg's plan from the target's own `GET /api/config` snapshot
 * (§6.4-2). The HIL runner deliberately does NOT read the sim's scene: it
 * re-asserts the board's CURRENT mapping, so the leg proves transport, reboot,
 * verify and serial health without changing what the board drives.
 *
 * Shape-compatible with `derivePerOutputPlan`'s result — the same object
 * `buildForcedConfigBody` takes from the panel.
 *
 * @param {Object} snapshot - GET /api/config document.
 * @param {string} controllerId - the target id; becomes `plan.controllerName`.
 * @returns {{controllerName: string, universeByOutputIndex: Object<number,number>,
 *   assignments: Array<{outputIndex: number, universe: number, pixelCount: number}>,
 *   disables: Array, countChanges: Array, warnings: string[],
 *   sharedUniverses: Array, collisions: Array}}
 */
function buildPlanFromSnapshot(snapshot, controllerId) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.strands)) {
    throw new Error('[HIL] buildPlanFromSnapshot: snapshot must be a GET /api/config document '
      + 'with a strands[] array');
  }
  if (typeof controllerId !== 'string' || controllerId === '') {
    throw new Error('[HIL] buildPlanFromSnapshot: controllerId is required');
  }
  const universeByOutputIndex = {};
  const assignments = [];
  snapshot.strands.forEach((strand, outputIndex) => {
    if (!strand || strand.enabled !== true) return;
    if (!Number.isInteger(strand.dmxUniverse)) {
      // The firmware's all-or-none rule says this cannot happen on a healthy
      // board; if it does, planning around it would DARKEN that output.
      throw new Error(`[HIL] output ${outputIndex} is enabled but carries no integer `
        + `dmxUniverse (got ${JSON.stringify(strand.dmxUniverse)}) — refusing to plan a push `
        + 'that would darken it; push this board from the sim once first');
    }
    if (!Number.isInteger(strand.count) || strand.count < 1) {
      throw new Error(`[HIL] output ${outputIndex} is enabled but its count is `
        + `${JSON.stringify(strand.count)} — refusing to plan against it`);
    }
    universeByOutputIndex[outputIndex] = strand.dmxUniverse;
    assignments.push({ outputIndex, universe: strand.dmxUniverse, pixelCount: strand.count });
  });
  if (assignments.length === 0) {
    throw new Error('[HIL] the board reports no enabled per-output strand — there is nothing to '
      + 're-assert; push it from the sim once first');
  }
  return {
    controllerName: controllerId,
    universeByOutputIndex,
    assignments,
    disables: [],
    countChanges: [],
    warnings: [],
    sharedUniverses: [],
    collisions: [],
  };
}

/**
 * `--expect-universes` (§6.2-5): assert the snapshot's ENABLED universes before
 * any write. PURE.
 */
function assertExpectedUniverses(plan, expectUniverses) {
  if (!expectUniverses) return;
  const got = plan.assignments.map((a) => a.universe).sort((x, y) => x - y);
  const want = [...expectUniverses].sort((x, y) => x - y);
  if (!isDeepStrictEqual(got, want)) {
    throw new Error(`[HIL] --expect-universes ${want.join(',')} ≠ the board's enabled universes `
      + `${got.join(',')} — refusing to write`);
  }
}

/**
 * The RESTORE body (§6.4-4): exactly the keys the run touched — `{strands, dmx}`
 * straight off the pre-snapshot. PURE.
 *
 * `deviceName` is deliberately NOT restored: the repair only ever fires when the
 * STORED name was invalid, and the firmware rejects every write carrying an
 * invalid name — so putting it back is impossible by construction. The repaired
 * name stays and is REPORTED instead (§6.4-4's "stays repaired and is
 * REPORTED").
 *
 * @param {Object} snapshot - the pre-run GET /api/config document.
 * @returns {{strands: Array<Object>, dmx: Object}}
 */
function buildRestoreBody(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.strands)) {
    throw new Error('[HIL] buildRestoreBody: snapshot must be a GET /api/config document with a '
      + 'strands[] array');
  }
  const dmx = snapshot.dmx;
  if (!dmx || typeof dmx !== 'object' || Array.isArray(dmx)) {
    throw new Error('[HIL] buildRestoreBody: the snapshot carries no dmx object — refusing to '
      + 'invent one');
  }
  return {
    strands: snapshot.strands.map((strand) => ({ ...strand })),
    dmx: { ...dmx },
  };
}

// ── PURE: the serial-window classifier (§6.3) ───────────────────────────────

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`[HIL] classifySerialWindow: window bound ${JSON.stringify(value)} must be a `
    + 'Date or an epoch-ms number');
}

/**
 * Split one capture line `"<ISO-timestamp> <text>"` into its parts. A line the
 * helper did not stamp is reported (never silently dropped) — see
 * `malformedLines` below.
 */
function splitCaptureLine(line) {
  const text = String(line);
  const space = text.indexOf(' ');
  if (space > 0) {
    const ms = Date.parse(text.slice(0, space));
    if (Number.isFinite(ms)) return { ms, text: text.slice(space + 1) };
  }
  return { ms: null, text };
}

function matchFirst(markers, text) {
  for (const marker of markers) {
    if (marker.re.test(text)) return marker.name;
  }
  return null;
}

/**
 * Judge one leg's slice of a serial capture. PURE — hand it the captured lines
 * and the window, get back the facts. No file, no port, no clock.
 *
 * Boots are delimited by the PUBLIC ESP32 boot-ROM banners; several banner lines
 * of one boot arrive together, so markers within `BOOT_COALESCE_MS` count once.
 * Crash markers are the ESP-IDF-generic fatal ones. Strand-init lines are read
 * with neutral heuristics (a line naming a strand/output slot and a pixel
 * count); `options.extraCrashPatterns` / `options.extraStrandPatterns` accept the
 * exact local patterns from `BM26_HIL_SERIAL_PATTERNS`.
 *
 * @param {string[]} lines - `"<ISO> <text>"` capture lines (the whole log is fine).
 * @param {number|Date} from - window start (inclusive).
 * @param {number|Date} to - window end (inclusive).
 * @param {{expectStrands?: {outputs: number, pixelCount: number},
 *          extraCrashPatterns?: RegExp[], extraStrandPatterns?: RegExp[]}} [options]
 * @returns {{windowLines: number, malformedLines: number, boots: number,
 *   bootLines: Array<{ms: number, text: string, marker: string}>,
 *   crashes: Array<{ms: (number|null), text: string, marker: string}>,
 *   strandInits: Array<{index: (number|null), count: (number|null),
 *     type: (string|null), text: string}>,
 *   strandCheck: (null|{ok: boolean, notes: string[], observedCounts: number[],
 *     defaultStrandSuspect: boolean})}}
 */
function classifySerialWindow(lines, from, to, options = {}) {
  if (!Array.isArray(lines)) {
    throw new Error('[HIL] classifySerialWindow: lines must be an array of capture lines');
  }
  const fromMs = toMs(from);
  const toMsBound = toMs(to);
  if (toMsBound < fromMs) {
    throw new Error('[HIL] classifySerialWindow: the window ends before it starts');
  }
  const crashMarkers = [
    ...CRASH_MARKERS,
    ...(options.extraCrashPatterns || []).map((re, i) => ({ name: `local-crash-${i + 1}`, re })),
  ];
  const strandExtra = options.extraStrandPatterns || [];

  const bootLines = [];
  const crashes = [];
  const strandInits = [];
  let windowLines = 0;
  let malformedLines = 0;
  let lastCountedBootMs = null;
  let boots = 0;

  for (const raw of lines) {
    const { ms, text } = splitCaptureLine(raw);
    if (ms === null) {
      // An unstamped line breaks the helper's contract. It is NOT dropped: it is
      // still scanned for crash markers (a crash must never hide behind a
      // formatting slip) but it cannot be placed in time, so it delimits no boot.
      malformedLines += 1;
      const crashMarker = matchFirst(crashMarkers, text);
      if (crashMarker) crashes.push({ ms: null, text, marker: crashMarker });
      continue;
    }
    if (ms < fromMs || ms > toMsBound) continue;
    windowLines += 1;

    const bootMarker = matchFirst(BOOT_MARKERS, text);
    if (bootMarker) {
      if (lastCountedBootMs === null || ms - lastCountedBootMs >= BOOT_COALESCE_MS) {
        boots += 1;
        lastCountedBootMs = ms;
        bootLines.push({ ms, text, marker: bootMarker });
      }
    }
    const crashMarker = matchFirst(crashMarkers, text);
    if (crashMarker) crashes.push({ ms, text, marker: crashMarker });

    const looksLikeStrand = STRAND_LINE_RE.test(text) || strandExtra.some((re) => re.test(text));
    if (looksLikeStrand) {
      const indexMatch = text.match(STRAND_INDEX_RE);
      const countMatch = text.match(STRAND_COUNT_RE);
      const typeMatch = text.match(STRAND_TYPE_RE);
      const count = countMatch ? Number(countMatch[1] ?? countMatch[2]) : null;
      if (count !== null) {
        strandInits.push({
          index: indexMatch ? Number(indexMatch[1]) : null,
          count,
          type: typeMatch ? typeMatch[1] : null,
          text,
        });
      }
    }
  }

  let strandCheck = null;
  if (options.expectStrands) {
    const { outputs, pixelCount } = options.expectStrands;
    const observedCounts = strandInits.map((s) => s.count);
    const notes = [];
    const matching = observedCounts.filter((c) => c === pixelCount);
    const offCounts = observedCounts.filter((c) => c !== pixelCount);
    if (strandInits.length === 0) {
      notes.push('no strand-init line was recognized in the boot window — the strand check is '
        + 'inconclusive (set BM26_HIL_SERIAL_PATTERNS to teach it the exact lines)');
    }
    if (matching.length !== outputs) {
      notes.push(`boot initialized ${matching.length} strand(s) of ${pixelCount} px, expected `
        + `${outputs}`);
    }
    if (offCounts.length > 0) {
      notes.push(`boot also reported strand length(s) ${offCounts.join(', ')} — a firmware-default `
        + 'strand set looks like this');
    }
    strandCheck = {
      ok: strandInits.length > 0 && matching.length === outputs && offCounts.length === 0,
      notes,
      observedCounts,
      defaultStrandSuspect: offCounts.length > 0,
    };
  }

  return { windowLines, malformedLines, boots, bootLines, crashes, strandInits, strandCheck };
}

// ── PURE: the report table (§6.5) ───────────────────────────────────────────

const LEG_WIDTH = 10;
const DETAIL_WIDTH = 44;

/**
 * Render the run's result table. PURE.
 *
 * @param {{targets: Array<{id: string, octet: (number|null), snapshotPath: (string|null),
 *   serialPath: (string|null), serialPort: (string|null),
 *   rows: Array<{leg: string, detail: string, status: string, note?: string,
 *     details?: string[]}>}>, noSerial?: boolean}} report
 * @returns {string}
 */
function renderTable(report) {
  if (!report || !Array.isArray(report.targets)) {
    throw new Error('[HIL] renderTable: report.targets must be an array');
  }
  const out = [`HIL PUSH CHECK — ${report.targets.length} target(s)`];
  let pass = 0;
  let judged = 0;
  let failed = false;
  for (const target of report.targets) {
    const octet = target.octet === null || target.octet === undefined ? '?' : target.octet;
    out.push(`── ${target.id} (.${octet})   snapshot: ${target.snapshotPath || '(none)'}`);
    if (target.serialPath) {
      out.push(`${' '.repeat(26)}serial:   ${target.serialPath}`
        + `${target.serialPort ? ` (${target.serialPort})` : ''}`);
    } else {
      out.push(`${' '.repeat(26)}serial:   (not captured)`);
    }
    for (const entry of target.rows || []) {
      if (entry.status === 'PASS') pass += 1;
      if (entry.status === 'PASS' || entry.status === 'FAIL') judged += 1;
      if (entry.status === 'FAIL') failed = true;
      out.push(`  ${entry.leg.padEnd(LEG_WIDTH)} ${entry.detail.padEnd(DETAIL_WIDTH)} `
        + `${entry.status}${entry.note ? `  (${entry.note})` : ''}`);
      for (const detail of entry.details || []) out.push(`${' '.repeat(6)}↳ ${detail}`);
    }
  }
  if (failed) {
    out.push(`VERDICT: FAIL (${pass}/${judged})`);
    for (const target of report.targets) {
      out.push(`   snapshot ${target.id}: ${target.snapshotPath || '(none written)'}`);
    }
  } else if (report.noSerial) {
    out.push(`VERDICT: PASS (HTTP-only — not gate evidence) (${pass}/${judged})`);
  } else {
    out.push(`VERDICT: PASS (${pass}/${judged})`);
  }
  return out.join('\n');
}

// ── I/O: snapshots, serial capture, the run ─────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fileStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** ~/tmp/led_controller_configs_backup/hil_<id>_<stamp>.json — returns the path. */
function writeSnapshot(controllerId, snapshot, stamp) {
  const dir = path.join(os.homedir(), 'tmp', 'led_controller_configs_backup');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `hil_${controllerId}_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  return file;
}

/** ~/tmp/hil_serial/<controllerId>_<stamp>.log — the capture helper's target. */
function serialLogPath(controllerId, stamp) {
  const dir = path.join(os.homedir(), 'tmp', 'hil_serial');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${controllerId}_${stamp}.log`);
}

function readCaptureLines(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter((line) => line !== '');
}

/**
 * Load the OPTIONAL exact serial patterns from the gitignored local file named
 * by `BM26_HIL_SERIAL_PATTERNS` (confidentiality boundary — BM26 source embeds
 * nothing beyond the generic markers). Format: JSON
 * `{"crash": ["regex", …], "strand": ["regex", …]}`. A named-but-missing file
 * is a loud failure, never a silent skip.
 */
function loadLocalSerialPatterns(envValue) {
  if (!envValue) return { extraCrashPatterns: [], extraStrandPatterns: [] };
  const raw = fs.readFileSync(envValue, 'utf8');
  const parsed = JSON.parse(raw);
  const toRegExps = (list, key) => (list || []).map((pattern) => {
    if (typeof pattern !== 'string') {
      throw new Error(`[HIL] BM26_HIL_SERIAL_PATTERNS: ${key}[] must hold regex strings`);
    }
    return new RegExp(pattern, 'i');
  });
  return {
    extraCrashPatterns: toRegExps(parsed.crash, 'crash'),
    extraStrandPatterns: toRegExps(parsed.strand, 'strand'),
  };
}

/**
 * Start `hil_serial_tail.py` on one port and wait until it reports it is
 * attached. The helper deasserts DTR/RTS BEFORE opening (§6.2-6) so the open
 * does not reset the chip.
 */
async function startSerialCapture(target, logPath) {
  const child = spawn('python', [SERIAL_HELPER_PATH, '--port', target.serialPort, '--out', logPath],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let exited = false;
  child.on('exit', () => { exited = true; });

  const deadline = Date.now() + SERIAL_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (stdout.includes('HIL_SERIAL_READY')) return child;
    if (exited) {
      throw new LegError(`serial helper for ${target.id} on ${target.serialPort} exited before it `
        + `attached: ${stderr.trim() || '(no output)'}`, { boardConfined: false });
    }
    await delay(100);
  }
  child.kill();
  throw new LegError(`serial helper for ${target.id} did not attach to ${target.serialPort} within `
    + `${SERIAL_READY_TIMEOUT_MS} ms`, { boardConfined: false });
}

/** D2 (report `_362`): an unknown write outcome is a hard failure, not a shrug. */
function classifyWriteReply(reply, where) {
  const outcome = reply && reply.outcome;
  if (outcome !== 'applied' && outcome !== 'needs-reboot') {
    throw new LegError(`${where}: the device answered an unknown outcome `
      + `${JSON.stringify(outcome)} — refusing to guess what it did`,
    { details: [JSON.stringify(reply)] });
  }
  return { rebooted: reply.reboot === true };
}

/**
 * Post one body through the given transport, honour a lost reply, wait out the
 * reboot when one is expected. Returns `{expectedBoots, responseLost, elapsedMs}`.
 */
async function writeAndSettle(transport, ip, body, where) {
  const started = Date.now();
  let responseLost = false;
  let expectedBoots = 0;
  try {
    const reply = await transport(ip, body, { writeTimeoutMs: WRITE_TIMEOUT_MS });
    const { rebooted } = classifyWriteReply(reply, where);
    expectedBoots = rebooted ? 1 : 0;
  } catch (err) {
    if (err instanceof LegError) throw err;
    if (err.writeResponseLost !== true) {
      throw new LegError(`${where}: the device refused the write — ${err.message}`);
    }
    // AMBIGUOUS: the firmware persists and reboots before flushing the reply.
    responseLost = true;
    expectedBoots = 1;
  }
  if (expectedBoots === 1) {
    await awaitReboot(ip, { timeoutMs: REBOOT_TIMEOUT_MS });
  }
  return { expectedBoots, responseLost, elapsedMs: Date.now() - started };
}

/**
 * Judge one leg's serial window across ALL targets' ports: the target's own port
 * must show exactly the expected number of boots, every OTHER port must show
 * zero (the COM-mapping cross-check), and no port may show a crash marker.
 */
function judgeSerial(state, target, windowFrom, windowTo, expectedBoots, expectStrands) {
  if (state.noSerial) return { notes: [], failures: [] };
  const notes = [];
  const failures = [];
  for (const other of state.targets) {
    if (!other.serialLogPath) continue;
    const lines = readCaptureLines(other.serialLogPath);
    const options = { ...state.localPatterns };
    if (other === target && expectStrands) options.expectStrands = expectStrands;
    const found = classifySerialWindow(lines, windowFrom, windowTo, options);
    const want = other === target ? expectedBoots : 0;
    if (found.boots !== want) {
      failures.push(`serial ${other.id} (${other.serialPort}): ${found.boots} boot(s) in the `
        + `window, expected ${want}`
        + (other !== target ? ' — a boot on the WRONG port suggests the --serial mapping is '
          + 'swapped' : '')
        + (found.boots > want ? ' — more boots than asked for is a crash loop' : ''));
    }
    for (const crash of found.crashes) {
      failures.push(`serial ${other.id}: ${crash.marker} @ `
        + `${crash.ms === null ? 'unstamped' : new Date(crash.ms).toISOString()} — ${crash.text}`);
    }
    if (other === target) notes.push(`boots=${found.boots}`);
    if (other === target && found.strandCheck) {
      if (found.strandCheck.ok) {
        notes.push(`strands on serial: ${expectStrands.outputs}×${expectStrands.pixelCount} ✓`);
      } else {
        for (const note of found.strandCheck.notes) {
          if (found.strandCheck.defaultStrandSuspect) failures.push(`serial ${other.id}: ${note}`);
          else notes.push(`serial ${other.id}: ${note}`);
        }
      }
    }
  }
  return { notes, failures };
}

function row(target, leg, detail, status, note, details) {
  target.rows.push({ leg, detail, status, note, details });
}

/** SNAPSHOT + the CONFIG / TOGGLE / RESTORE legs for one target (§6.4). */
async function runTarget(state, target) {
  // ── PREFLIGHT: identity, capability, serial attach ────────────────────────
  const status = await getStatus(target.ip);
  if (status.controllerId !== target.id) {
    throw new LegError(`identity preflight: ${target.ip} answers controllerId `
      + `'${status.controllerId}', not the expected '${target.id}' — aborting the WHOLE run, `
      + 'zero writes', { boardConfined: false });
  }
  if (!deviceSupportsPerOutput(status)) {
    throw new LegError(`capability preflight: ${target.id} does not report per-output DMX support`,
      { boardConfined: false });
  }
  if (!state.noSerial) {
    const attachFrom = target.serialAttachedAt;
    const found = classifySerialWindow(readCaptureLines(target.serialLogPath), attachFrom,
      Date.now(), state.localPatterns);
    if (found.boots > 0 || found.crashes.length > 0) {
      throw new LegError(`serial attach gate: opening ${target.serialPort} produced `
        + `${found.boots} boot marker(s) and ${found.crashes.length} crash marker(s) — the open `
        + 'reset the chip; aborting before any write', { boardConfined: false });
    }
  }
  row(target, 'PREFLIGHT', 'allowlist+identity+capability+serial-attach', 'PASS');

  // ── SNAPSHOT: the manual recovery path, printed FIRST ─────────────────────
  const snapshot = await getConfig(target.ip);
  target.snapshot = snapshot;
  target.snapshotPath = writeSnapshot(target.id, { status, config: snapshot }, state.stamp);
  console.log(`   snapshot ${target.id} → ${target.snapshotPath}`);
  row(target, 'SNAPSHOT', 'full config saved', 'PASS');

  const plan = buildPlanFromSnapshot(snapshot, target.id);
  assertExpectedUniverses(plan, state.expectUniverses);
  const expectStrands = {
    outputs: plan.assignments.length,
    pixelCount: plan.assignments[0].pixelCount,
  };

  // ── CONFIG PUSH leg ───────────────────────────────────────────────────────
  if (state.skipConfig) {
    row(target, 'CONFIG', 'forced write+reboot', 'SKIP', '--skip-config');
    row(target, 'CONFIG', 'read-back verify', 'SKIP', '--skip-config');
  } else {
    const body = buildForcedConfigBody({ snapshot, plan, ip: target.ip });
    if (body.deviceName !== undefined) {
      target.nameRepair = `deviceName was REPAIRED to '${body.deviceName}' (the stored name was `
        + 'invalid and the firmware rejects every write carrying it) — it stays repaired';
    }
    const from = Date.now();
    target.wroteSomething = true;
    const settle = await writeAndSettle(pushForcedConfig, target.ip, body, 'CONFIG push');
    const verifyConfig = await getConfig(target.ip);
    const verifyStatus = await getStatus(target.ip);
    await delay(SERIAL_FLUSH_MS);
    const serial = judgeSerial(state, target, from, Date.now(), settle.expectedBoots, expectStrands);
    row(target, 'CONFIG', 'forced write+reboot', serial.failures.length ? 'FAIL' : 'PASS',
      `${(settle.elapsedMs / 1000).toFixed(1)} s, responseLost=${settle.responseLost}, `
      + `${serial.notes.join(', ')}`, serial.failures);
    const mismatches = diffForcedConfig(verifyConfig, verifyStatus, body,
      { controllerId: target.id });
    const note = swarmEnabledNote(verifyConfig);
    row(target, 'CONFIG', 'read-back verify', mismatches.length ? 'FAIL' : 'PASS',
      `${mismatches.length} mismatch(es)${note ? ` · ${note}` : ''}`, mismatches);
    if (mismatches.length || serial.failures.length) {
      throw new LegError('CONFIG leg failed — skipping the remaining mutating legs, restoring');
    }
  }

  // ── DMX TOGGLE legs — the genuine both-direction state change ─────────────
  if (state.skipToggle) {
    row(target, 'TOGGLE', 'DMX off → verify', 'SKIP', '--skip-toggle');
    row(target, 'TOGGLE', 'DMX on  → verify', 'SKIP', '--skip-toggle');
  } else {
    for (const enabled of [false, true]) {
      const toggleSnapshot = await getConfig(target.ip);
      const body = buildDmxToggleBody({
        snapshot: toggleSnapshot, enabled, controllerName: target.id, ip: target.ip,
      });
      const from = Date.now();
      target.wroteSomething = true;
      const settle = await writeAndSettle(pushDmxToggle, target.ip, body,
        `TOGGLE DMX ${enabled ? 'on' : 'off'}`);
      const verifyConfig = await getConfig(target.ip);
      const verifyStatus = await getStatus(target.ip);
      await delay(SERIAL_FLUSH_MS);
      const serial = judgeSerial(state, target, from, Date.now(), settle.expectedBoots, null);
      const mismatches = diffDmxToggle(verifyConfig, verifyStatus, enabled,
        { controllerId: target.id });
      const failures = [...serial.failures, ...mismatches];
      row(target, 'TOGGLE', `DMX ${enabled ? 'on ' : 'off'} → verify`,
        failures.length ? 'FAIL' : 'PASS',
        `${serial.notes.join(', ')}, sacn ${enabled ? 'on' : 'off'}`, failures);
      if (failures.length) {
        throw new LegError(`TOGGLE ${enabled ? 'on' : 'off'} leg failed — restoring`);
      }
    }
  }
}

/** RESTORE (§6.4-4) — mandatory, and its verify is part of PASS. */
async function runRestore(state, target, snapshot) {
  const body = buildRestoreBody(snapshot);
  const from = Date.now();
  const settle = await writeAndSettle(pushForcedConfig, target.ip, body, 'RESTORE');
  const after = await getConfig(target.ip);
  const afterStatus = await getStatus(target.ip);
  await delay(SERIAL_FLUSH_MS);
  const serial = judgeSerial(state, target, from, Date.now(), settle.expectedBoots, null);
  row(target, 'RESTORE', 'original config', serial.failures.length ? 'FAIL' : 'PASS',
    serial.notes.join(', '), serial.failures);

  const failures = [];
  if (!isDeepStrictEqual(after.strands, snapshot.strands)) {
    failures.push('restored strands are NOT deep-equal to the pre-run snapshot');
  }
  if (!isDeepStrictEqual(after.dmx, snapshot.dmx)) {
    failures.push('restored dmx block is NOT deep-equal to the pre-run snapshot');
  }
  if (afterStatus.controllerId !== target.id) {
    failures.push(`controllerId '${afterStatus.controllerId}' ≠ '${target.id}' after restore`);
  }
  row(target, 'RESTORE', 'read-back verify', failures.length ? 'FAIL' : 'PASS',
    `deep-equal; crash markers: ${serial.failures.length}`, failures);
  if (failures.length || serial.failures.length) throw new LegError('RESTORE verify failed');
}

let mainInvoked = false;

/** Test hook: proves that merely importing this module runs nothing. */
function mainWasInvoked() {
  return mainInvoked;
}

async function main(argvTail) {
  mainInvoked = true;
  let parsed;
  try {
    parsed = parseArgs(argvTail);
    assertTargetsAllowed(parsed.targets);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`hil_push_check: ${err.message}\n`);
    console.error(usageText());
    return 2;
  }

  const stamp = fileStamp();
  const state = {
    stamp,
    noSerial: parsed.noSerial,
    skipConfig: parsed.skipConfig,
    skipToggle: parsed.skipToggle,
    expectUniverses: parsed.expectUniverses,
    localPatterns: loadLocalSerialPatterns(process.env.BM26_HIL_SERIAL_PATTERNS),
    targets: parsed.targets.map((t) => ({
      id: t.id,
      ip: t.ip,
      octet: lastOctet(t.ip),
      serialPort: t.serialPort,
      serialLogPath: null,
      serialAttachedAt: null,
      snapshot: null,
      snapshotPath: null,
      nameRepair: null,
      wroteSomething: false,
      rows: [],
    })),
  };

  const children = [];
  let exitCode = 0;
  try {
    if (!state.noSerial) {
      for (const target of state.targets) {
        target.serialLogPath = serialLogPath(target.id, stamp);
        target.serialAttachedAt = Date.now();
        children.push(await startSerialCapture(target, target.serialLogPath));
        console.log(`   serial ${target.id} → ${target.serialLogPath} (${target.serialPort})`);
      }
      await delay(SERIAL_ATTACH_SETTLE_MS);
    }

    for (const target of state.targets) {
      let globalAbort = false;
      try {
        await runTarget(state, target);
      } catch (err) {
        exitCode = 1;
        // An allowlist/preflight/serial-attach failure aborts EVERYTHING; a leg
        // failure is board-confined and the next target still runs (§6.4-5).
        globalAbort = !(err instanceof LegError) || err.boardConfined === false;
        row(target, 'ABORT', globalAbort ? 'run aborted (global)' : 'leg failed (board-confined)',
          'FAIL', null, [err.message, ...(err.details || [])]);
      }
      // RESTORE is mandatory once anything was WRITTEN — and only then: a
      // preflight/snapshot/plan failure wrote nothing, so it needs no undo.
      if (target.wroteSomething) {
        try {
          await runRestore(state, target, target.snapshot);
        } catch (err) {
          exitCode = 1;
          if (!target.rows.some((r) => r.leg === 'RESTORE' && r.status === 'FAIL')) {
            row(target, 'RESTORE', 'original config', 'FAIL', err.message, err.details || []);
          }
        }
      } else {
        row(target, 'RESTORE', 'nothing was written — no restore needed', 'SKIP');
      }
      if (target.nameRepair) console.log(`   ⚠ ${target.id}: ${target.nameRepair}`);
      if (globalAbort) break;
    }
  } finally {
    for (const child of children) child.kill();
  }

  const table = renderTable({ targets: state.targets, noSerial: state.noSerial });
  console.log(table);
  if (table.includes('VERDICT: FAIL')) exitCode = 1;
  return exitCode;
}

module.exports = {
  HIL_ALLOWED,
  OPERATOR_RESERVED_OCTETS,
  BOOT_MARKERS,
  CRASH_MARKERS,
  BOOT_COALESCE_MS,
  UsageError,
  LegError,
  usageText,
  parseArgs,
  lastOctet,
  assertTargetAllowed,
  assertTargetsAllowed,
  buildPlanFromSnapshot,
  assertExpectedUniverses,
  buildRestoreBody,
  classifySerialWindow,
  renderTable,
  mainWasInvoked,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(`hil_push_check: ${err && err.stack ? err.stack : err}`);
    process.exitCode = 1;
  });
}
