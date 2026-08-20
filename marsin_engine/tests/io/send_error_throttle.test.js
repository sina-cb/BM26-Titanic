/**
 * send_error_throttle.test.js — proof that DMX transmit-error logging is
 * THROTTLED, never silenced.
 *
 * Regression source: report 20260725_16 note 1 — an unreachable controller
 * (`EHOSTUNREACH 10.1.1.202:5568`) made the engine log every failed send at
 * 40 fps × 2 universes, producing an 88 MB session log in 4 hours on
 * titanic-ext. On playa that fills the disk.
 *
 * The contract pinned here: first error logs immediately, a burst collapses
 * to periodic summaries carrying the suppressed count, a change of error
 * class logs immediately, recovery logs once, and destinations are throttled
 * INDEPENDENTLY of each other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSendErrorThrottle,
  SEND_ERROR_SUMMARY_INTERVAL_MS,
} from '../../lib/send_error_throttle.js';

/** Fake clock + logger so the behaviour is pinned without real time/sockets. */
function harness(intervalMs = 30000) {
  let t = 1_000_000;
  const errors = [];
  const logs = [];
  const throttle = createSendErrorThrottle({
    prefix: '[sACN Out]',
    intervalMs,
    now: () => t,
    logger: {
      error: (line) => errors.push(line),
      log: (line) => logs.push(line),
    },
  });
  return {
    throttle,
    errors,
    logs,
    advance: (ms) => { t += ms; },
  };
}

const EHOST = 'send EHOSTUNREACH 10.1.1.202:5568';

test('throttle — prefix is mandatory (no silently-untagged logger)', () => {
  assert.throws(() => createSendErrorThrottle({}), /prefix is required/);
});

test('throttle — the first error for a destination logs immediately, in full', () => {
  const h = harness();
  assert.equal(h.throttle.noteError('U10 → 10.1.1.202', EHOST), 'logged');
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /\[sACN Out\] Send error U10 → 10\.1\.1\.202/);
  assert.match(h.errors[0], /EHOSTUNREACH/);
  assert.equal(h.throttle.hasFailures(), true);
});

test('throttle — a 40 fps burst collapses to ONE line plus periodic summaries', () => {
  const h = harness(30000);
  const key = 'U10 → 10.1.1.202';

  // 4 minutes of a downed controller at 40 fps: 9 600 failed sends.
  // Unthrottled that is 9 600 log lines (the 88 MB bug).
  const frameMs = 25;
  for (let i = 0; i <= 9600; i++) {
    h.throttle.noteError(key, EHOST);
    h.advance(frameMs);
  }

  // 1 immediate line + one summary per 30 s window over 240 s = 8 summaries.
  assert.equal(h.errors.length, 9, `expected 9 lines, got ${h.errors.length}`);
  assert.match(h.errors[0], /Send error/);
  for (const line of h.errors.slice(1)) {
    assert.match(line, /Send to U10 → 10\.1\.1\.202 failing for \d+s/);
    assert.match(line, /EHOSTUNREACH/);
  }
  // The failure is never hidden: every summary states how long it has been
  // down and how many errors it swallowed.
  assert.match(h.errors[1], /failing for 30s/);
  assert.match(h.errors[8], /failing for 240s/);
  assert.match(h.errors[1], /1199 errors suppressed/);
  assert.match(h.errors[8], /9\d{3} total/);
});

test('throttle — suppressed counts sum to every error that was swallowed', () => {
  const h = harness(1000);
  const key = 'U12 → 10.1.1.202';
  let logged = 0;
  let suppressed = 0;
  for (let i = 0; i < 500; i++) {
    const action = h.throttle.noteError(key, EHOST);
    if (action === 'suppressed') suppressed++; else logged++;
    h.advance(10);
  }
  assert.equal(logged + suppressed, 500);
  // 5 000 ms at a 1 000 ms cadence: 1 immediate + 4 summaries.
  assert.equal(logged, 5);
  assert.equal(h.errors.length, 5);
});

test('throttle — a NEW error class logs immediately, naming the previous one', () => {
  const h = harness();
  const key = 'U10 → 10.1.1.202';
  h.throttle.noteError(key, EHOST);
  h.advance(100);
  h.throttle.noteError(key, EHOST); // suppressed
  h.advance(100);
  assert.equal(h.throttle.noteError(key, 'send ENETUNREACH 10.1.1.202:5568'), 'changed');
  assert.equal(h.errors.length, 2);
  assert.match(h.errors[1], /ENETUNREACH/);
  assert.match(h.errors[1], /was: send EHOSTUNREACH/);
});

test('throttle — recovery logs exactly one line and resets the state', () => {
  const h = harness(30000);
  const key = 'U10 → 10.1.1.202';
  h.throttle.noteError(key, EHOST);
  for (let i = 0; i < 400; i++) { h.advance(25); h.throttle.noteError(key, EHOST); }

  h.advance(25);
  assert.equal(h.throttle.noteSuccess(key), true);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /\[sACN Out\] Send to U10 → 10\.1\.1\.202 RECOVERED after 10s/);
  assert.match(h.logs[0], /401 errors/);
  assert.equal(h.throttle.hasFailures(), false);

  // Success on a healthy destination is a no-op — no recovery spam.
  assert.equal(h.throttle.noteSuccess(key), false);
  assert.equal(h.logs.length, 1);

  // And after recovery the NEXT failure logs immediately again (the throttle
  // must not stay in a suppressing state across an outage boundary).
  assert.equal(h.throttle.noteError(key, EHOST), 'logged');
  assert.equal(h.errors.length, 2);
});

test('throttle — destinations are rate-limited independently', () => {
  const h = harness(30000);
  h.throttle.noteError('U10 → 10.1.1.202', EHOST);
  h.throttle.noteError('U12 → 10.1.1.202', EHOST);
  h.throttle.noteError('U10 → 10.1.1.203', 'send EHOSTUNREACH 10.1.1.203:5568');
  assert.equal(h.errors.length, 3, 'each destination gets its own first-error line');

  // Recovering one destination leaves the others still marked failing.
  h.advance(50);
  h.throttle.noteSuccess('U10 → 10.1.1.202');
  assert.equal(h.throttle.hasFailures(), true);
  h.throttle.noteSuccess('U12 → 10.1.1.202');
  h.throttle.noteSuccess('U10 → 10.1.1.203');
  assert.equal(h.throttle.hasFailures(), false);
});

test('throttle — reset() forgets everything (sender stop)', () => {
  const h = harness();
  h.throttle.noteError('U10 → 10.1.1.202', EHOST);
  assert.equal(h.throttle.hasFailures(), true);
  h.throttle.reset();
  assert.equal(h.throttle.hasFailures(), false);
  assert.equal(h.logs.length, 0, 'reset is silent — not a recovery');
});

test('throttle — default summary interval is a sane 30 s', () => {
  assert.equal(SEND_ERROR_SUMMARY_INTERVAL_MS, 30000);
});
