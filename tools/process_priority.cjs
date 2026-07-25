'use strict';
/**
 * process_priority.cjs — OS process-priority elevation for the realtime
 * pattern-generation path (marsin_engine + the sACN bridges).
 *
 * WHY: the show box runs the sim + engine alongside Chrome. Windows gives the
 * FOREGROUND window a priority/scheduling boost, so when the operator clicks a
 * Chrome window the engine's 40 fps sACN generation can get starved — observed
 * as freezes. Elevating the engine (and the frame-relaying bridges) above the
 * NORMAL class the browser sits in keeps frame generation scheduled regardless
 * of which window has focus.
 *
 * CONTRACT (codex P0 — no fallbacks, fail loudly):
 *   - We target the highest SAFE class by default: HIGH_PRIORITY_CLASS
 *     (os.setPriority -14). REALTIME_PRIORITY_CLASS (-20) is opt-in only — it
 *     can starve kernel/input/audio workers and normally needs admin.
 *   - We NEVER assume the set succeeded. Every elevate ALWAYS reads the achieved
 *     priority back and logs `[<label>] requested=X achieved=Y`. A realtime
 *     request the OS silently clamps to HIGH (no admin) is therefore visible,
 *     not hidden.
 *   - On failure we do NOT silently retry at a lower class. We LOG LOUDLY and
 *     leave the process where the OS left it — an un-elevated engine must be
 *     obvious in the logs, never a silent degrade.
 *
 * This module is pure Node built-ins (os), so it loads from CommonJS callers
 * (launcher.js, simulation/start.js, the bridges) and from the ESM engine via
 * createRequire.
 */

const os = require('os');

const P = os.constants.priority;

// Named request → the os.setPriority "nice" value + the Windows class name it
// maps to. Only the two SAFE targets are exposed.
const REQUESTS = {
  high: { nice: P.PRIORITY_HIGH, className: 'HIGH' },          // HIGH_PRIORITY_CLASS
  realtime: { nice: P.PRIORITY_HIGHEST, className: 'REALTIME' }, // REALTIME_PRIORITY_CLASS
};

const DEFAULT_REQUEST = 'high';

// Read-back: the os.getPriority "nice" value → human class name. This is the
// exact mapping libuv uses on Windows (GetPriorityClass → nice), so a read-back
// is deterministic and lets us name the class the OS actually granted.
const NICE_TO_CLASS = new Map([
  [-20, 'REALTIME'],
  [-14, 'HIGH'],
  [-7, 'ABOVE_NORMAL'],
  [0, 'NORMAL'],
  [10, 'BELOW_NORMAL'],
  [19, 'IDLE'],
]);

// ── Pure helpers (unit-tested; no OS side effects) ────────────────────────

// A raw request string (CLI value, env var, config value) → a canonical
// request key, or null if it is not one of the SAFE targets. `fallback` is
// returned for an empty/absent value (so "unset" resolves to the default) while
// a NON-empty invalid value still returns null (so the caller can be loud).
function normalizePriorityRequest(raw, { fallback = DEFAULT_REQUEST } = {}) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const key = String(raw).trim().toLowerCase();
  return REQUESTS[key] ? key : null;
}

// Resolve the effective request from an ordered list of sources (highest
// precedence first). Each source is `{ value, origin }`. A non-empty but
// invalid value is reported loudly and skipped (we never crash the show over a
// typo'd priority — the default is itself an elevation, not a silent no-op).
function resolvePriorityRequest(sources, { fallback = DEFAULT_REQUEST, label = 'EnginePriority', logger } = {}) {
  const log = logger || ((m) => console.log(m));
  for (const src of sources) {
    if (!src) continue;
    const { value, origin } = src;
    if (value === undefined || value === null || value === '') continue;
    const norm = normalizePriorityRequest(value, { fallback: null });
    if (norm) return { request: norm, origin: origin || 'unknown' };
    log(`[${label}] ⚠ ignoring invalid priority '${value}' from ${origin || 'unknown'} ` +
      `(valid: ${Object.keys(REQUESTS).join(', ')}).`);
  }
  return { request: fallback, origin: 'default' };
}

// os.getPriority nice value → class name (unknown values named explicitly).
function classForNice(nice) {
  return NICE_TO_CLASS.has(nice) ? NICE_TO_CLASS.get(nice) : `nice(${nice})`;
}

// The canonical read-back log line. This exact format is the contract the
// launcher log-scan and the unit tests depend on: `[<label>] requested=X achieved=Y`.
function priorityLine(label, requestedClass, achievedClass) {
  return `[${label}] requested=${requestedClass} achieved=${achievedClass}`;
}

// Given the requested class name and the achieved nice value, decide the
// achieved class + whether we got what we asked for.
function interpret(requestedClass, achievedNice) {
  const achieved = classForNice(achievedNice);
  return { achieved, ok: achieved === requestedClass };
}

// ── OS-touching elevation ─────────────────────────────────────────────────

// Core: set `pid`'s priority to the named request, ALWAYS read back, log the
// contract line, and narrate any shortfall loudly. Returns
// `{ requested, achieved, ok, error? }`. Never throws — a failure to elevate
// must not take the process down; it must be loud.
function _elevate(pid, requestName, { label, logger }) {
  const log = logger || ((m) => console.log(m));
  const req = REQUESTS[requestName];
  if (!req) {
    log(`[${label}] ❌ unknown priority request '${requestName}' — process left at OS default.`);
    return { requested: String(requestName), achieved: null, ok: false, error: 'unknown-request' };
  }
  const requestedClass = req.className;

  try {
    // pid 0 = the current process.
    os.setPriority(pid, req.nice);
  } catch (err) {
    // No silent lower-class retry. Read back whatever the OS has and report it.
    let achievedClass = 'UNKNOWN';
    try { achievedClass = classForNice(os.getPriority(pid)); } catch (_) { /* pid gone */ }
    log(`[${label}] ❌ setPriority(${requestedClass}) FAILED for pid ${pid}: ${err.message}. ` +
      `Process is NOT elevated (running at ${achievedClass}). ` +
      `On Windows this usually means insufficient privilege; on POSIX a negative nice needs root.`);
    log(priorityLine(label, requestedClass, achievedClass));
    return { requested: requestedClass, achieved: achievedClass, ok: false, error: err.message };
  }

  // ALWAYS read back — never assume the set landed at the requested class.
  let achievedNice;
  try {
    achievedNice = os.getPriority(pid);
  } catch (err) {
    log(`[${label}] ⚠ could not read back priority for pid ${pid}: ${err.message}`);
    log(priorityLine(label, requestedClass, 'UNKNOWN'));
    return { requested: requestedClass, achieved: 'UNKNOWN', ok: false, error: err.message };
  }

  const { achieved, ok } = interpret(requestedClass, achievedNice);
  log(priorityLine(label, requestedClass, achieved));
  if (!ok) {
    const why = requestedClass === 'REALTIME'
      ? 'REALTIME_PRIORITY_CLASS usually needs admin — HIGH is active and is the safe target'
      : 'the OS clamped the class';
    log(`[${label}] ⚠ requested ${requestedClass} but the OS granted ${achieved} (${why}).`);
  }
  return { requested: requestedClass, achieved, ok };
}

// Elevate THIS process (the reliable, authoritative path — runs inside the real
// node process, so it always targets the right pid).
function elevateSelf(requestName, opts = {}) {
  return _elevate(0, requestName, { label: opts.label || 'EnginePriority', logger: opts.logger });
}

// Elevate another process by pid (the parent/"belt" path — e.g. the launcher
// elevating the engine). Reliable only when `pid` is the REAL target process.
// On Windows a shell-wrapped spawn's `child.pid` is the cmd.exe wrapper, so the
// caller must resolve the real pid first — the robust handle is the listening
// socket the child bound (e.g. the engine's API port owner), NOT parent-walking
// (Windows ParentProcessId is unreliable once the wrapper is in play).
function elevatePid(pid, requestName, opts = {}) {
  return _elevate(pid, requestName, { label: opts.label || 'EnginePriority', logger: opts.logger });
}

module.exports = {
  REQUESTS,
  DEFAULT_REQUEST,
  normalizePriorityRequest,
  resolvePriorityRequest,
  classForNice,
  priorityLine,
  interpret,
  elevateSelf,
  elevatePid,
};
