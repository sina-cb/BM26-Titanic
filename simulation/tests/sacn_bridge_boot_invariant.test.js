/**
 * sacn_bridge_boot_invariant.test.js — the input bridge's use of the
 * `lib/sacn_receiver_boot.cjs` classification/invariant LIB (catalog
 * 20260805_161 gap G14): `receiver.on('error', ...)`'s fatal/non-fatal fork
 * and the boot-gate `listening` handler's subscription-race invariant.
 *
 * `sacn_receiver_boot.test.js` already proves the LIB exhaustively (including
 * two live-socket repros); this file proves the BRIDGE's wiring of it — that
 * a non-fatal classification warns and keeps routing, and a fatal one (or a
 * second boot-invariant violation) actually calls `process.exit`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, request } = H;
const receiver = H.receiver;
const observer = connect();

function stubExit() {
  const original = process.exit;
  const calls = [];
  process.exit = (code) => calls.push(code);
  return { calls, restore: () => { process.exit = original; } };
}

test('G14: a non-fatal (addMembership) receiver error warns once and never exits', () => {
  const exit = stubExit();
  H.captureConsole();
  receiver.emit('error', { syscall: 'addMembership', code: 'EINVAL', message: 'addMembership EINVAL' });
  H.releaseConsole();
  exit.restore();

  assert.equal(exit.calls.length, 0, 'a multicast-join failure must not be fatal');
  assert.ok(H.logs.some((l) => /Multicast JOIN FAILED/.test(l)),
    'the non-fatal classification must still be reported loudly');
});

test('G14: routing still works after a non-fatal receiver error', async () => {
  const reply = await request(observer, { type: 'getRoutes' }, 'g14-routes', 'routes');
  assert.ok(reply.routes.length > 0);
  const { universe, ip } = reply.routes[0];
  const before = H.sends.length;
  H.captureConsole();
  // `payloadAsBuffer` (the raw 512-byte wire slice), never the `sacn` package's
  // PERCENT `payload` getter — the bridge's receive unit since report 20260805_170.
  const slice = Buffer.alloc(512); slice[0] = 5;
  receiver.emit('packet',
    { universe, priority: 100, sourceName: 'g14-after-warn', payloadAsBuffer: slice });
  H.releaseConsole();
  assert.ok(H.sends.slice(before).some((s) => s.universe === universe && s.ip === ip),
    'a non-fatal error must not silently stop the relay');
});

test('G14: a fatal (socket-level) receiver error calls process.exit(1)', () => {
  const exit = stubExit();
  H.captureConsole();
  receiver.emit('error', { code: 'EACCES', syscall: 'bind', message: 'bind EACCES' });
  H.releaseConsole();
  exit.restore();

  assert.deepEqual(exit.calls, [1], 'a socket-level failure must be fatal — refuse to run half-alive');
});

test('G14: a boot-invariant violation on a REPLAYED "listening" event also exits(1), naming the universe',
  () => {
    // Poison the (fake) receiver's universe list the way a subscription RACE
    // would: an entry present at 'listening' time that boot never asked for.
    receiver.universes.push(918273);
    const exit = stubExit();
    H.captureConsole();
    receiver.socket.emit('listening');
    H.releaseConsole();
    exit.restore();

    assert.deepEqual(exit.calls, [1]);
    assert.ok(H.logs.some((l) => /RACE/.test(l) && l.includes('918273')),
      'the invariant violation must name the offending universe, not just fail silently');
  });

test('G14 teardown: restore the real module loader', () => {
  H.restoreModuleLoad();
});
