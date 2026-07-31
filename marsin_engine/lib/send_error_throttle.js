/**
 * send_error_throttle.js — per-destination rate limiter for DMX-over-IP
 * transmit errors (sACN + Art-Net).
 *
 * WHY (report 20260725_16, note 1): the engine sends at 40 fps × N
 * universes. When a controller goes unreachable, EVERY failed datagram was
 * logged, so a single downed box (`EHOSTUNREACH 10.1.1.202:5568`) produced
 * ~80 lines/second — a 4-hour titanic-ext session log hit **88 MB**, which
 * on playa is a disk-fill risk with no one around to rotate it.
 *
 * This is THROTTLING, NOT HIDING (codex P0 — fail loudly). The failure state
 * stays visible at all times:
 *
 *   1. the FIRST error for a destination logs immediately, in full;
 *   2. a change of error class for that destination logs immediately too
 *      (EHOSTUNREACH → ENETUNREACH is new information);
 *   3. while the same failure persists, one SUMMARY line per destination per
 *      `intervalMs` reports how long it has been down, the current error and
 *      how many errors were suppressed — so a tail of the log always shows
 *      the box is still broken;
 *   4. the first success after a failure streak logs a RECOVERY line with the
 *      outage duration and total error count.
 *
 * Nothing is ever silently dropped: every suppressed error is counted and
 * that count appears in the next summary or recovery line.
 *
 * Pure/injectable (`logger`, `now`) so the behaviour is unit-testable without
 * real sockets or real time.
 */

/** Default gap between "still failing" summary lines, per destination. */
export const SEND_ERROR_SUMMARY_INTERVAL_MS = 30000;

/**
 * Create a per-destination send-error throttle.
 *
 * @param {Object} opts
 * @param {string} opts.prefix       - log tag, e.g. '[sACN Out]'
 * @param {number} [opts.intervalMs] - summary cadence per destination
 * @param {Object} [opts.logger]     - console-like ({ log, error })
 * @param {Function} [opts.now]      - clock, ms
 * @returns {SendErrorThrottle}
 */
export function createSendErrorThrottle({
  prefix,
  intervalMs = SEND_ERROR_SUMMARY_INTERVAL_MS,
  logger = console,
  now = Date.now,
} = {}) {
  if (!prefix) {
    throw new Error('[send_error_throttle] prefix is required');
  }
  // key → { message, firstAt, lastLoggedAt, suppressed, total }
  const failing = new Map();

  const seconds = (ms) => Math.max(0, Math.round(ms / 1000));

  /**
   * Record one failed send for `key` (a destination label such as
   * `U10 → 10.1.1.202`). Logs immediately, as a periodic summary, or not at
   * all (counted for the next summary).
   *
   * @param {string} key
   * @param {string} message - err.message
   * @returns {'logged'|'changed'|'summary'|'suppressed'} what it did
   */
  function noteError(key, message) {
    const t = now();
    let entry = failing.get(key);
    if (!entry) {
      entry = { message: null, firstAt: t, lastLoggedAt: 0, suppressed: 0, total: 0 };
      failing.set(key, entry);
    }
    entry.total++;

    if (entry.message !== message) {
      const first = entry.message === null;
      const was = first ? '' : ` (was: ${entry.message})`;
      if (first) entry.firstAt = t;
      entry.message = message;
      entry.lastLoggedAt = t;
      entry.suppressed = 0;
      logger.error(`${prefix} Send error ${key}: ${message}${was} — further identical ` +
        `errors throttled to one line per ${seconds(intervalMs)}s`);
      return first ? 'logged' : 'changed';
    }

    if (t - entry.lastLoggedAt >= intervalMs) {
      logger.error(`${prefix} Send to ${key} failing for ${seconds(t - entry.firstAt)}s: ` +
        `${message} (${entry.suppressed} errors suppressed since the last line, ` +
        `${entry.total} total)`);
      entry.lastLoggedAt = t;
      entry.suppressed = 0;
      return 'summary';
    }

    entry.suppressed++;
    return 'suppressed';
  }

  /**
   * Record a successful send for `key`. Logs a recovery line (and forgets the
   * destination) only if it was previously failing; a no-op otherwise.
   *
   * @param {string} key
   * @returns {boolean} true when a recovery line was emitted
   */
  function noteSuccess(key) {
    const entry = failing.get(key);
    if (!entry) return false;
    const t = now();
    failing.delete(key);
    logger.log(`${prefix} Send to ${key} RECOVERED after ${seconds(t - entry.firstAt)}s ` +
      `(${entry.total} errors, ${entry.suppressed} suppressed since the last line)`);
    return true;
  }

  /**
   * Are any destinations currently in a failing streak? Lets callers skip the
   * `noteSuccess` map lookup on the all-healthy hot path.
   * @returns {boolean}
   */
  function hasFailures() {
    return failing.size > 0;
  }

  /** Forget all destination state (used on sender stop). */
  function reset() {
    failing.clear();
  }

  return { noteError, noteSuccess, hasFailures, reset };
}
