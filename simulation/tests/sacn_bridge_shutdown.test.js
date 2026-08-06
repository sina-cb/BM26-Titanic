/**
 * sacn_bridge_shutdown.test.js — the input bridge's Ctrl-C shutdown ordering
 * while DISARMED (catalog 20260805_161 gap G10, rank 7), plus the
 * double-signal no-op.
 *
 * `server/sacn_bridge.js:shutdown()` is invoked from
 * `process.on('SIGINT'/'SIGTERM', ...)`. Both `server/sacn_bridge.js` AND
 * `server/sacn_output_bridge.js` install their OWN signal handlers, so
 * `process.emit('SIGINT')` would fire BOTH bridges' shutdown paths in one
 * shot and conflate their `process.exit` calls. This file instead grabs the
 * INPUT bridge's specific listener off `process.listeners('SIGINT')` (it is
 * required SECOND by the harness, so it is the second listener registered)
 * and invokes it directly — exercising the exact function a real SIGINT
 * would call, isolated from the output bridge's independent handler.
 *
 * `_shuttingDown` is a bridge-global latch with no reset, so a SECOND
 * shutdown test in the SAME process is automatically the "double signal"
 * case — which is also why the armed and mid-blackout scenarios (catalog
 * spec items 2-3) live in their OWN files with their OWN fresh harness.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { sends } = H;

const sigintListeners = process.listeners('SIGINT');
assert.equal(sigintListeners.length, 2,
  'exactly the output-bridge and input-bridge SIGINT handlers should be registered');
const inputShutdown = sigintListeners[1]; // registered SECOND (input bridge required after output)

const originalExit = process.exit;
let exitCalls = [];
process.exit = (code) => { exitCalls.push(code); };

test('G10: disarmed, no blackout in flight → exit(0) SYNCHRONOUSLY, zero frames of any kind sent',
  () => {
    const sendsBefore = sends.length;
    H.captureConsole();
    inputShutdown('SIGINT');
    H.releaseConsole();
    assert.deepEqual(exitCalls, [0], 'a disarmed shutdown exits immediately with code 0');
    assert.equal(sends.length, sendsBefore,
      'nothing was ever armed, so shutdown must not put any frame on the wire');
    assert.ok(H.logs.some((l) => /was not armed/.test(l)),
      'the disarmed fast-exit path must say so');
  });

test('G10: a SECOND signal is a no-op — the latch has already fired', () => {
  const before = exitCalls.length;
  H.captureConsole();
  inputShutdown('SIGTERM'); // a different signal name — the latch does not care which
  H.releaseConsole();
  assert.equal(exitCalls.length, before,
    '_shuttingDown must make every signal after the first a complete no-op');
});

test('G10 teardown: restore process.exit and the real module loader', () => {
  process.exit = originalExit;
  H.restoreModuleLoad();
});
