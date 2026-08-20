/**
 * sacn_bridge_shutdown_blackout_race.test.js — Ctrl-C arriving DURING an
 * operator-initiated disarm's blackout (catalog 20260805_161 gap G10, spec
 * item 3). Own file / own fresh harness — see
 * `sacn_bridge_shutdown.test.js`'s header for why.
 *
 * `disarmBenchMirror` nulls `_mirrorArm` SYNCHRONOUSLY before its first
 * `await` (report 20260804_152 D1), so by the time `disarmFrom(ws)` (called
 * but not yet awaited) reaches ITS first await, `_mirrorArm` is already null
 * and `blackoutInFlight()` is already true — exactly the window
 * `shutdown()`'s "signal DURING a blackout" branch exists for
 * (`_mirrorArm === null` but the bridge is NOT simply idle).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, armFrom, disarmFrom, waitFor } = H;

const sigintListeners = process.listeners('SIGINT');
assert.equal(sigintListeners.length, 2);
const inputShutdown = sigintListeners[1];

const originalExit = process.exit;
let exitCalls = [];
process.exit = (code) => { exitCalls.push(code); };

test('G10: a signal mid-blackout waits for the blackout to settle before exiting', async () => {
  const ws = connect();
  let status = null;
  for (let i = 0; i < 30 && !(status && status.armed); i += 1) {
    H.captureConsole();
    status = await armFrom(ws, 'test_bench');
    H.releaseConsole();
    if (!status.armed) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(status.armed, true, status && status.refusal);

  H.captureConsole();
  // Start an OPERATOR disarm but do not await it yet — its synchronous
  // prologue (raising the blackout hold, nulling `_mirrorArm`) has already
  // run by the time this line returns control to us.
  const disarmPromise = disarmFrom(ws);

  // Land the signal squarely inside that window.
  inputShutdown('SIGINT');
  assert.equal(exitCalls.length, 0,
    'a signal that lands mid-blackout must not exit before the blackout settles');
  assert.ok(H.logs.some((l) => /blackout is in flight — waiting/.test(l)),
    'the bridge must say it is waiting, not silently swallow the signal');

  await disarmPromise;
  await waitFor(() => exitCalls.length > 0, 'exit after the blackout settles', 4000);
  H.releaseConsole();
  assert.deepEqual(exitCalls, [0]);
});

test('G10 teardown: restore process.exit and the real module loader', () => {
  process.exit = originalExit;
  H.restoreModuleLoad();
});
