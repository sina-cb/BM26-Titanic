/**
 * sacn_bridge_client_lifecycle.test.js — the input bridge's WS client
 * lifecycle glue (catalog 20260805_161 gap G3, rank 2):
 * `server/sacn_bridge.js:1043-1182` — `setScene` tagging through the REAL
 * socket handler, the disconnect recompute, the multi-window census
 * broadcast, and the `getRoutes` reply-failure path.
 *
 * `bridge_routing.test.js` covers the pure union math; `multi_client_warning
 * .test.js` covers the BROWSER banner; the arm suite covers the ARM/DISARM
 * dispatch. NONE of them drive the socket handler itself — this file does,
 * against the REAL bridges via the H-A harness.
 *
 * All tests share ONE bridge process (the harness loads it once), so every
 * test that connects a client DROPS it before finishing — `clientCount` and
 * `clientScenes` are bridge-global and would otherwise leak into later tests
 * (a lesson learned the hard way while writing this file: the census test
 * originally saw stale counts >2 from earlier tests' un-dropped clients).
 *
 * Same-socket FIFO ordering (`setScene` then `getRoutes` answered
 * post-recompute) is already asserted end-to-end in
 * `bridge_route_readback.test.js` ("integration — notify then read-back") —
 * not respecced here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeHarness } from './helpers/bridge_harness.mjs';

const H = createBridgeHarness();
const { connect, request } = H;

let _n = 0;
async function routesOf(ws) {
  _n += 1;
  return request(ws, { type: 'getRoutes' }, `g3-${_n}`, 'routes');
}

test('G3: setScene tags a client — its scene joins the active-scenes union and its pairs relay',
  async () => {
    const ws = connect('test_bench'); // connect() sends the real setScene on open
    const reply = await routesOf(ws);
    assert.ok(reply.activeScenes.includes('test_bench'));
    assert.ok(reply.routes.length > 0);
    H.captureConsole();
    ws.drop();
    await H.settle(4);
    H.releaseConsole();
  });

test('G3: re-tagging a client swaps its scene\'s contribution — old leaves, new joins', async () => {
  const ws = connect('studio_top_loft');
  const before = await routesOf(ws);
  assert.ok(before.activeScenes.includes('studio_top_loft'));
  assert.ok(!before.activeScenes.includes('studiodj'), 'studiodj must not be contributed yet');

  H.captureConsole();
  ws.emit('message', JSON.stringify({ type: 'setScene', scene: 'studiodj' }));
  await H.settle(4);
  H.releaseConsole();

  const after = await routesOf(ws);
  assert.ok(after.activeScenes.includes('studiodj'), 'the NEW tag must join the union');
  assert.ok(!after.activeScenes.includes('studio_top_loft'),
    'the OLD tag must leave once nothing else claims it (this socket was its only claimant)');

  H.captureConsole();
  ws.drop();
  await H.settle(4);
  H.releaseConsole();
});

test('G3: a second client triggers the {count:2} census + ONE contention warning; disconnect clears it',
  async () => {
    const a = connect('titanic');
    const beforeWarn = H.logs.filter((l) => /contention risk/.test(l)).length;
    H.captureConsole();
    const b = connect('titanic');
    await H.settle(4);
    H.releaseConsole();

    const countsA = a.json('clients').map((m) => m.count);
    const countsB = b.json('clients').map((m) => m.count);
    assert.ok(countsA.includes(2), 'the FIRST client must also see the new count');
    assert.ok(countsB.includes(2), 'the connecting client must see its own count too');
    assert.equal(H.logs.filter((l) => /contention risk/.test(l)).length, beforeWarn + 1,
      'exactly one contention warning on the 1→2 transition');

    const beforeCleared = H.logs.filter((l) => /contention cleared/.test(l)).length;
    H.captureConsole();
    b.drop();
    await H.settle(4);
    H.releaseConsole();
    assert.ok(a.json('clients').some((m) => m.count === 1), 'the survivor sees the count drop back');
    assert.equal(H.logs.filter((l) => /contention cleared/.test(l)).length, beforeCleared + 1,
      'exactly one "cleared" line on the 2→1 transition');

    H.captureConsole();
    a.drop();
    await H.settle(4);
    H.releaseConsole();
  });

test('G3: a scene-tagged client disconnecting triggers a recompute — its routes leave', async () => {
  const ws = connect('summer_camp_logsville');
  const observer = connect('titanic');
  const before = await routesOf(observer);
  assert.ok(before.activeScenes.includes('summer_camp_logsville'));

  H.captureConsole();
  ws.drop();
  await H.settle(6);
  H.releaseConsole();

  const after = await routesOf(observer);
  assert.ok(!after.activeScenes.includes('summer_camp_logsville'),
    'the disconnecting client was the only claimant of that scene');

  H.captureConsole();
  observer.drop();
  await H.settle(4);
  H.releaseConsole();
});

test('G3: robustness — non-JSON, a reqId-less getRoutes, and an unknown type never break the socket',
  async () => {
    const ws = connect('titanic');
    H.captureConsole();
    ws.emit('message', 'not json at all {{{');
    ws.emit('message', JSON.stringify({ type: 'getRoutes' })); // no reqId
    ws.emit('message', JSON.stringify({ type: 'totallyMadeUpType', foo: 'bar' }));
    await H.settle(4);
    H.releaseConsole();

    // The socket must still answer a well-formed request afterward.
    const reply = await routesOf(ws);
    assert.ok(Array.isArray(reply.routes));

    H.captureConsole();
    ws.drop();
    await H.settle(4);
    H.releaseConsole();
  });

test('G3: a getRoutes reply that fails to send is warned, and the server keeps serving other clients',
  async () => {
    const bad = connect('titanic');
    const good = connect('titanic');
    const realSend = bad.send.bind(bad);
    bad.send = () => { throw new Error('simulated send failure'); };

    H.captureConsole();
    bad.emit('message', JSON.stringify({ type: 'getRoutes', reqId: 'will-fail' }));
    await H.settle(4);
    H.releaseConsole();
    bad.send = realSend;

    assert.ok(H.logs.some((l) => /getRoutes reply failed/.test(l)));
    // The other client's own request must still succeed.
    const reply = await routesOf(good);
    assert.ok(Array.isArray(reply.routes));

    H.captureConsole();
    bad.drop();
    good.drop();
    await H.settle(4);
    H.releaseConsole();
  });

test('G3 teardown: restore the real module loader', () => {
  H.restoreModuleLoad();
});
