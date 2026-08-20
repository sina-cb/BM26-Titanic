/**
 * sacn_bridge_shutdown_armed.test.js — Ctrl-C while the BENCH MIRROR is
 * ARMED (catalog 20260805_161 gap G10, spec item 2). Own file / own fresh
 * harness: `server/sacn_bridge.js`'s shutdown latch (`_shuttingDown`) never
 * resets, so this scenario cannot share a process with
 * `sacn_bridge_shutdown.test.js`'s disarmed case.
 *
 * See that file's header for why the INPUT bridge's specific SIGINT listener
 * is invoked directly rather than via `process.emit`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, armFrom, sends, senders, isZeroPayload, LIVE_DESTS, waitFor } = H;

const sigintListeners = process.listeners('SIGINT');
assert.equal(sigintListeners.length, 2);
const inputShutdown = sigintListeners[1];

const originalExit = process.exit;
let exitCalls = [];
process.exit = (code) => { exitCalls.push(code); };

test('G10 setup: get the mirror armed (engine poll may need a retry or two)', async () => {
  const ws = connect();
  let status = null;
  for (let i = 0; i < 30 && !(status && status.armed); i += 1) {
    H.captureConsole();
    status = await armFrom(ws, 'test_bench');
    H.releaseConsole();
    if (!status.armed) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(status.armed, true, status && status.refusal);
});

test('G10: armed shutdown blacks out every owned pair (exactly 3 zero frames each), THEN exit(0)',
  async () => {
    sends.length = 0;
    H.captureConsole();
    inputShutdown('SIGINT');
    // Must NOT exit synchronously — the blackout is awaited.
    assert.equal(exitCalls.length, 0,
      'an armed shutdown must black out before exiting, never exit first');
    await waitFor(() => exitCalls.length > 0, 'the armed shutdown to complete', 4000);
    H.releaseConsole();

    assert.deepEqual(exitCalls, [0]);
    for (const d of LIVE_DESTS) {
      const zero = sends.filter((s) => s.ip === d.ip && s.universe === d.universe
        && isZeroPayload(s.payload));
      assert.equal(zero.length, 3, `U${d.universe} → ${d.ip} must receive exactly 3 all-zero frames`);
    }
    assert.ok(H.logs.some((l) => /BENCH MIRROR is ARMED — blacking out/.test(l)));
  });

test('_171 (was G10): after an armed shutdown a DMX frame still reaches NO controller',
  async () => {
    // G10 used to prove the output-bridge GATE was RELEASED on shutdown, by
    // showing that a probe frame then created a sender. Both halves of that are
    // obsolete: there is no gate, and there is no sender to create — the output
    // bridge holds no sACN sender at all (report 20260805_171). The property
    // worth keeping is the one that always mattered underneath: a shutdown must
    // not leave anything able to write. Now it cannot, by construction, and the
    // probe proves the stronger statement.
    const ws = H.outputWss.connect();
    const beforeSenders = senders.length;
    const frame = Buffer.alloc(519);
    frame.writeUInt16LE(9001, 0);
    const parts = '10.9.9.240'.split('.').map(Number);
    parts.forEach((b, i) => frame.writeUInt8(b, 2 + i));
    frame.writeUInt8(100, 6);
    H.captureConsole();
    ws.emit('message', frame);
    await H.settle(4);
    H.releaseConsole();
    assert.equal(senders.length, beforeSenders,
      'a DMX frame must create NO sender — the browser is not the router, and the output ' +
      'bridge cannot forward even if something sends it a frame');
  });

test('G10 teardown: restore process.exit and the real module loader', () => {
  process.exit = originalExit;
  H.restoreModuleLoad();
});
