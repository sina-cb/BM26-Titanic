#!/usr/bin/env node
/**
 * launcher_reaper.cjs — the launcher's sentinel (docs/62 W-A5).
 *
 * WHY THIS EXISTS. On Windows, killing the launcher's shell/task wrapper —
 * closing the terminal, `taskkill /F` without `/T`, a console that dies with its
 * host — leaves every stack child running with nobody supervising them: the
 * engine's exit-75 scene-switch restart is gone, `stop`'s blackout has no engine
 * pid it trusts, and crash teardown is gone. It happened on 2026-08-15 and
 * orphaned all four children. Node has no job-object API and a native addon
 * would violate the offline/no-runtime-install rule, so the guarantee comes from
 * a detached watcher instead.
 *
 * WHAT IT DOES. Spawned by the launcher right after `writeLock()`, detached and
 * unref'd (it must OUTLIVE the launcher), it polls every 2 s:
 *
 *   · lock file gone            → the launcher stopped cleanly   → exit 0
 *   · lock.pid !== our launcher → another launcher took over     → exit 0
 *     (the new launcher spawned its own sentinel)
 *   · our launcher's pid is DEAD while the lock still names it
 *                               → ABNORMAL death → run the stop reap path
 *
 * REAP, NOT ADOPT (decision D1, taken). A launcher-less stack is already broken;
 * leaving it up "because it still looks lit" is precisely the silent-fallback
 * behavior the codex bans. The stack comes down loudly — with the blackout
 * attempted FIRST — and the operator restarts one command.
 *
 * ONE REAP IMPLEMENTATION. The teardown itself is `launcher.js`'s exported
 * `reapStaleStack` (blackout → lock-children reap → identity-checked,
 * ARM-interlocked port sweep → lock removal). This file is the trigger, not a
 * second copy of the policy.
 *
 * NO CONSOLE. The sentinel is detached, so the launcher points its stdout and
 * stderr at ~/tmp/bm26_reaper.log; the timestamped lines below go to the same
 * file, and every line `reapStaleStack` prints lands there too.
 *
 * Usage (the launcher does this for you):
 *   node tools/launcher_reaper.cjs <lock-path> <launcher-pid>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const POLL_MS = 2000;
// A normal teardown removes the lock from `process.on('exit')`, i.e. after the
// pid is already unusable-ish but before it disappears. Requiring two
// consecutive dead observations, with the lock STILL present, keeps that race
// from ever being read as an abnormal death.
const DEAD_CONFIRMATIONS = 2;

const LOCK_PATH = process.argv[2];
const LAUNCHER_PID = Number(process.argv[3]);
// BM26_REAPER_LOG is the launcher's (and the tests') way to name the log; the
// launcher points the sentinel's stdio at the same file, so lines printed by the
// shared reap code land beside the timestamped ones below.
const LOG_PATH = (typeof process.env.BM26_REAPER_LOG === 'string' && process.env.BM26_REAPER_LOG.trim() !== '')
  ? path.resolve(process.env.BM26_REAPER_LOG.trim())
  : path.join(os.homedir(), 'tmp', 'bm26_reaper.log');

function logLine(message) {
  const line = `[${new Date().toISOString()}] [reaper ${process.pid}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    // The log is the only voice this process has; if even that fails there is
    // nowhere left to complain to. Do not let it stop the reap.
  }
}

if (!LOCK_PATH || !Number.isInteger(LAUNCHER_PID) || LAUNCHER_PID <= 0) {
  logLine(`refusing to start: usage is 'node tools/launcher_reaper.cjs <lock-path> <launcher-pid>' `
    + `(got ${JSON.stringify(process.argv.slice(2))}).`);
  process.exit(2);
}

// Requiring launcher.js in module mode does NOT run main() (it guards on
// require.main), and gives us the single shared reap implementation.
const launcher = require(path.join(__dirname, '..', 'launcher.js'));

if (path.resolve(launcher.LOCK_PATH) !== path.resolve(LOCK_PATH)) {
  // launcher.js resolves the lock path once, at load, from BM26_LAUNCHER_LOCK.
  // If our argv disagrees with it, `reapStaleStack` would delete a DIFFERENT
  // lock than the one we are watching. Refuse rather than reap the wrong stack.
  logLine(`refusing to start: launcher.js resolves its lock to ${launcher.LOCK_PATH} but this `
    + `sentinel was pointed at ${LOCK_PATH}. The reap would remove the wrong lock. `
    + 'Pass BM26_LAUNCHER_LOCK to the sentinel the same way the launcher got it.');
  process.exit(2);
}

function readLockOrNull() {
  try {
    return launcher.readLock();
  } catch (err) {
    return { unreadable: err.message };
  }
}

let deadObservations = 0;

async function tick() {
  if (!fs.existsSync(LOCK_PATH)) {
    logLine(`lock ${LOCK_PATH} is gone — the launcher stopped cleanly. Exiting.`);
    process.exit(0);
  }
  const lock = readLockOrNull();
  if (lock && lock.unreadable) {
    // Never reap on an unverified identity: we cannot confirm this lock is the
    // one naming our launcher.
    logLine(`lock ${LOCK_PATH} is unreadable (${lock.unreadable}) — cannot confirm ownership; `
      + 'not reaping. Will retry.');
    return;
  }
  if (!lock) return;                       // vanished between the two reads
  if (lock.pid !== LAUNCHER_PID) {
    logLine(`lock now names launcher pid ${lock.pid}, not ${LAUNCHER_PID} — a takeover happened and `
      + 'that launcher has its own sentinel. Exiting.');
    process.exit(0);
  }
  if (launcher.pidAlive(LAUNCHER_PID)) {
    deadObservations = 0;
    return;
  }
  deadObservations += 1;
  if (deadObservations < DEAD_CONFIRMATIONS) {
    logLine(`launcher pid ${LAUNCHER_PID} looks dead while the lock still names it `
      + `(observation ${deadObservations}/${DEAD_CONFIRMATIONS}) — confirming before reaping.`);
    return;
  }

  logLine(`ABNORMAL LAUNCHER DEATH: pid ${LAUNCHER_PID} is gone and ${LOCK_PATH} still names it. `
    + 'Running the stop reap path (blackout → lock children → port sweep → lock removal).');
  clearInterval(timer);
  try {
    const summary = await launcher.reapStaleStack(lock, { log: (m) => logLine(String(m)) });
    const reaped = summary.reaped.map((r) => `${r.tag}=${r.pid}`).join(', ') || 'none';
    const swept = summary.sweep === null
      ? 'no stackPorts in the lock'
      : `killed ${summary.sweep.killed.length}, foreign ${summary.sweep.foreign.length}, `
        + `refused ${summary.sweep.refused.length}`;
    logLine(`reap complete — blackout ${summary.blackout.confirmed ? 'CONFIRMED' : `NOT confirmed (${summary.blackout.reason})`}; `
      + `children reaped: ${reaped}; port sweep: ${swept}. Exiting.`);
    process.exit(0);
  } catch (err) {
    logLine(`REAP FAILED: ${err && (err.stack || err.message)}. The stack may still be running — `
      + 'stop it by hand.');
    process.exit(1);
  }
}

logLine(`watching launcher pid ${LAUNCHER_PID} via ${LOCK_PATH} (poll ${POLL_MS} ms).`);
const timer = setInterval(() => {
  tick().catch((err) => {
    logLine(`tick failed: ${err && (err.stack || err.message)}`);
  });
}, POLL_MS);
