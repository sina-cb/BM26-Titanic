/**
 * bridge_route_readback.test.js — report 20260725_127: the per-output push's
 * third check is a READ of the sACN bridge's active route table, not a trusted
 * notify.
 *
 * Covers, at the seams:
 *   1. the pure expectation builder (every ASSIGNED output, spill universes
 *      included — an output the forced push DISABLES makes no route claim),
 *   2. the pure snapshot assessment (relay / engine-direct / bench-mirror
 *      ownership / missing) and the exact sentences,
 *   3. the bounded confirm poll (success, mismatch after N reads, transport
 *      failure fails IMMEDIATELY — never a "probably fine"),
 *   4. the bridge's snapshot wire shape (lib/bridge_routing.cjs
 *      buildRouteTableSnapshot — the same function sacn_bridge.js answers with),
 *   5. SacnInputSource.queryRoutes (reqId correlation, timeout, disconnect),
 *   6. an INTEGRATION run against a stub bridge on a real WebSocket — the stub
 *      answers getRoutes with the REAL buildRouteTableSnapshot, so the client
 *      and the server are pinned to one wire shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { WebSocketServer } from 'ws';

// sacn_input_source.js guards its browser hooks with `if (window.x)` — the
// object must exist for those guards to evaluate under Node.
globalThis.window = globalThis.window || {};

import {
  buildRouteExpectation,
  normalizeRouteSnapshot,
  assessRouteReadback,
  describeConfirmedRoutes,
  describeRouteMismatch,
  confirmBridgeRoutes,
} from '../src/dmx/led/bridge_route_confirm.js';
import { SacnInputSource } from '../src/dmx/sacn_input_source.js';

const require = createRequire(import.meta.url);
const { buildRouteTableSnapshot } = require('../lib/bridge_routing.cjs');

const IP = '10.1.1.60';

/** A minimal derivePerOutputPlan-shaped plan. */
function plan(extra = {}) {
  return {
    controllerName: 'LeftLeftRopes',
    universeByOutputIndex: { 0: 30, 1: 31 },
    assignments: [
      { outputIndex: 0, portNum: 1, universe: 30, pixelCount: 40 },
      { outputIndex: 1, portNum: 2, universe: 31, pixelCount: 40 },
    ],
    disables: [{ outputIndex: 2, deviceCount: 40, deviceUniverse: 42 }],
    countChanges: [],
    warnings: [],
    collisions: [],
    ...extra,
  };
}

/** A normalized snapshot with only the given relay routes. */
function snapshot({ routes = [], engineOwned = [], mirrorOwned = [] } = {}) {
  return { routes, engineOwned, mirrorOwned, activeScenes: ['titanic'] };
}

// ── 1. buildRouteExpectation ─────────────────────────────────────────────────

test('_362: the expectation carries exactly the ASSIGNED universes', () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  assert.deepEqual(exp.expected, [30, 31]);
  assert.equal('parkedAbsent' in exp, false, 'parking is retired — the key is GONE, not empty');
  assert.equal(exp.ip, IP);
  assert.equal(exp.controllerName, 'LeftLeftRopes');
});

test('_362: an output the push DISABLES makes no route claim', () => {
  // The plan disables output 2 (the board holds it on U42 today). A disabled
  // output receives nothing by construction — it is not asserted either way.
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  assert.equal(exp.expected.includes(42), false);
  const result = assessRouteReadback({
    expectations: [exp],
    snapshot: snapshot({ routes: [
      { universe: 30, ip: IP }, { universe: 31, ip: IP }, { universe: 42, ip: IP },
    ] }),
  });
  assert.equal(result.ok, true);
});

test('_127: a spilling strand claims EVERY universe its walk occupies', () => {
  // 200 px RGBW from U30 ch1: 128 px fill U30 (512/4), 72 px spill into U31.
  const exp = buildRouteExpectation({
    plan: plan({
      assignments: [{ outputIndex: 0, portNum: 1, universe: 30, pixelCount: 200 }],
    }),
    ip: IP, stride: 4,
  });
  assert.deepEqual(exp.expected, [30, 31]);
});

test('_127: the expectation builder refuses what it cannot state', () => {
  assert.throws(() => buildRouteExpectation({ plan: null, ip: IP, stride: 4 }),
    /assignments\[\] is required/);
  assert.throws(() => buildRouteExpectation({ plan: plan(), ip: '', stride: 4 }),
    /controller IP is required/);
  assert.throws(() => buildRouteExpectation({ plan: plan(), ip: IP, stride: 0 }),
    /stride must be a positive integer/);
  assert.throws(() => buildRouteExpectation({
    plan: plan({ assignments: [{ outputIndex: 0, universe: 0, pixelCount: 40 }] }),
    ip: IP, stride: 4,
  }), /no valid universe/);
  // Nothing routed: the empty-expectation refusal stays (a push that cannot
  // state what it expects must refuse BEFORE the write, not tick blindly after).
  assert.throws(() => buildRouteExpectation({
    plan: plan({ assignments: [] }), ip: IP, stride: 4,
  }), /nothing to confirm/);
});

// ── 2. assessment + sentences ────────────────────────────────────────────────

test('_127: all expected pairs present → ok, named per IP', () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  const result = assessRouteReadback({
    expectations: [exp],
    snapshot: snapshot({ routes: [
      { universe: 30, ip: IP }, { universe: 31, ip: IP },
      { universe: 2, ip: '10.1.1.20' },      // someone else's route — irrelevant
    ] }),
  });
  assert.equal(result.ok, true);
  assert.equal(describeConfirmedRoutes(result), `U30,U31→${IP}`);
});

test('_127: an engine-owned pair is confirmed as [engine-direct] — one writer, by design', () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  const result = assessRouteReadback({
    expectations: [exp],
    snapshot: snapshot({
      routes: [{ universe: 30, ip: IP }],
      engineOwned: [{ universe: 31, ip: IP }],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(describeConfirmedRoutes(result), `U30→${IP}, U31→${IP} [engine-direct]`);
});

test('_127: a missing expected route fails, naming exactly the missing pair', () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  const result = assessRouteReadback({
    expectations: [exp],
    snapshot: snapshot({ routes: [{ universe: 30, ip: IP }] }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [{ universe: 31, ip: IP }]);
  const text = describeRouteMismatch(result, snapshot({ routes: [{ universe: 30, ip: IP }] }), 5);
  assert.match(text, new RegExp(`missing U31→${IP}`));
  assert.match(text, /bridge relays 1 route\(s\) after 5 read\(s\)/);
  assert.match(text, /check the sACN bridge log/);
});

test('_127: a bench-mirror-owned pair is a one-writer CONFLICT, never a ✓', () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  const result = assessRouteReadback({
    expectations: [exp],
    snapshot: snapshot({
      routes: [{ universe: 31, ip: IP }],
      mirrorOwned: [{ universe: 30, ip: IP }],
    }),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.mirrorConflicts, [{ universe: 30, ip: IP }]);
  assert.match(describeRouteMismatch(result, snapshot(), 1),
    new RegExp(`U30→${IP} owned by the bench mirror \\(another writer\\)`));
});

test('_362: describeConfirmedRoutes refuses to render a green tick over nothing', () => {
  assert.throws(() => describeConfirmedRoutes({ confirmed: [] }), /nothing was confirmed/);
});

// ── 3. the bounded confirm poll ──────────────────────────────────────────────

test('_127: confirmBridgeRoutes resolves on the first matching read', async () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  let reads = 0;
  const result = await confirmBridgeRoutes({
    expectations: [exp],
    readRoutes: async () => { reads += 1; return snapshot({ routes: [
      { universe: 30, ip: IP }, { universe: 31, ip: IP }] }); },
  });
  assert.deepEqual(result, { ok: true, detail: `U30,U31→${IP}` });
  assert.equal(reads, 1, 'the same-socket FIFO makes the first read authoritative');
});

test('_127: a persistent mismatch fails after the bounded reads, with the routes named', async () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  let reads = 0;
  const sleeps = [];
  const result = await confirmBridgeRoutes({
    expectations: [exp],
    attempts: 3,
    delayMs: 50,
    sleep: async (ms) => { sleeps.push(ms); },
    readRoutes: async () => { reads += 1; return snapshot({ routes: [{ universe: 30, ip: IP }] }); },
  });
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [50, 50], 'bounded: attempts-1 sleeps, never an open loop');
  assert.equal(result.ok, false);
  assert.match(result.reason, new RegExp(`missing U31→${IP}`));
  assert.match(result.reason, /after 3 read\(s\)/);
});

test('_127: a route that APPEARS on a later read still confirms (boot-gate grace)', async () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  let reads = 0;
  const result = await confirmBridgeRoutes({
    expectations: [exp],
    attempts: 3,
    sleep: async () => {},
    readRoutes: async () => {
      reads += 1;
      return reads < 2 ? snapshot()
        : snapshot({ routes: [{ universe: 30, ip: IP }, { universe: 31, ip: IP }] });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
});

test('_127: a broken transport fails IMMEDIATELY — no retry stacking, no soft pass', async () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  let reads = 0;
  const result = await confirmBridgeRoutes({
    expectations: [exp],
    attempts: 5,
    sleep: async () => { throw new Error('must not sleep on a dead transport'); },
    readRoutes: async () => { reads += 1; throw new Error('sACN bridge WebSocket not connected'); },
  });
  assert.equal(reads, 1);
  assert.equal(result.ok, false);
  assert.match(result.reason,
    /route table read-back failed: sACN bridge WebSocket not connected/);
});

test('_127: a malformed bridge reply is a loud failure, never "no routes"', async () => {
  const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
  const noField = await confirmBridgeRoutes({
    expectations: [exp],
    readRoutes: async () => ({ type: 'routes' }),   // old bridge: no routes[]
  });
  assert.equal(noField.ok, false);
  assert.match(noField.reason, /has no routes\[\]/);
  assert.match(noField.reason, /Restart the launcher/);

  const badEntry = await confirmBridgeRoutes({
    expectations: [exp],
    readRoutes: async () => snapshot({ routes: [{ universe: 'x', ip: IP }] }),
  });
  assert.equal(badEntry.ok, false);
  assert.match(badEntry.reason, /routes\[0\] is malformed/);
});

test('_127: confirming NOTHING is misuse and throws — an empty claim can only skip upstream', async () => {
  await assert.rejects(
    () => confirmBridgeRoutes({ expectations: [], readRoutes: async () => snapshot() }),
    /at least one route expectation is required/);
});

// ── 4. the bridge's wire shape (the very builder sacn_bridge.js answers with) ─

/** Sender-entry maps shaped like the bridge's _routeEntries/_mirrorEntries. */
function entryMap(pairs) {
  const m = new Map();
  for (const p of pairs) m.set(`${p.universe}→${p.ip}`, { ...p, sender: {} });
  return m;
}

test('_127: buildRouteTableSnapshot reports live senders, sorted, with the reqId echoed', () => {
  const reply = buildRouteTableSnapshot({
    reqId: 'routes-7',
    routeEntries: entryMap([{ universe: 31, ip: IP }, { universe: 30, ip: IP }]),
    mirrorEntries: entryMap([{ universe: 2, ip: '10.1.1.20' }]),
    excluded: [{ universe: 5, ip: '10.1.1.9', scenes: ['test_bench'] }],
    activeScenes: ['titanic', 'test_bench'],
  });
  assert.equal(reply.type, 'routes');
  assert.equal(reply.reqId, 'routes-7');
  assert.deepEqual(reply.routes, [{ universe: 30, ip: IP }, { universe: 31, ip: IP }]);
  assert.deepEqual(reply.engineOwned, [{ universe: 5, ip: '10.1.1.9' }]);
  assert.deepEqual(reply.mirrorOwned, [{ universe: 2, ip: '10.1.1.20' }]);
  assert.deepEqual(reply.activeScenes, ['titanic', 'test_bench']);
  // The wire shape parses through the client-side normalizer — one contract.
  const normalized = normalizeRouteSnapshot(reply);
  assert.deepEqual(normalized.routes, reply.routes);
});

test('_127: an empty bridge reports empty lists — a readable zero, not a missing field', () => {
  const reply = buildRouteTableSnapshot({
    reqId: undefined, routeEntries: new Map(), mirrorEntries: new Map(),
    excluded: [], activeScenes: [],
  });
  assert.equal(reply.reqId, null);
  assert.deepEqual(reply.routes, []);
  const normalized = normalizeRouteSnapshot(reply);
  assert.deepEqual(normalized, { routes: [], engineOwned: [], mirrorOwned: [], activeScenes: [] });
});

// ── 5. SacnInputSource.queryRoutes (no sockets — the fake-ws seam) ───────────

function fakeWsSource() {
  const sent = [];
  const source = new SacnInputSource('ws://fake');
  source._ws = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)) };
  return { source, sent };
}

test('_127: queryRoutes correlates by reqId — a stray reply resolves nothing', async () => {
  const { source, sent } = fakeWsSource();
  const pending = source.queryRoutes(1000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'getRoutes');
  const reqId = sent[0].reqId;

  // A reply for someone else's query must be ignored.
  source._handleTextMessage(JSON.stringify({ type: 'routes', reqId: 'not-mine', routes: [] }));
  // The matching reply resolves with the payload verbatim.
  source._handleTextMessage(JSON.stringify({
    type: 'routes', reqId, routes: [{ universe: 30, ip: IP }],
    engineOwned: [], mirrorOwned: [], activeScenes: [],
  }));
  const reply = await pending;
  assert.deepEqual(reply.routes, [{ universe: 30, ip: IP }]);
  assert.equal(source._routeWaiters.size, 0, 'the waiter is cleaned up');
});

test('_127: queryRoutes times out loudly when the bridge never answers', async () => {
  const { source } = fakeWsSource();
  await assert.rejects(() => source.queryRoutes(25),
    /did not answer the route-table query within 25 ms/);
  assert.equal(source._routeWaiters.size, 0);
});

test('_127: queryRoutes rejects immediately when the socket is down', async () => {
  const source = new SacnInputSource('ws://fake');
  await assert.rejects(() => source.queryRoutes(1000),
    /sACN bridge WebSocket not connected — the route table cannot be read/);
});

test('_127: a socket teardown rejects the in-flight query — fail fast, not timeout', async () => {
  const { source } = fakeWsSource();
  const pending = source.queryRoutes(60000);
  source._ws.close = () => {};
  source._cleanup();
  await assert.rejects(() => pending,
    /WebSocket closed before the route-table reply arrived/);
});

// ── 6. INTEGRATION: stub bridge over a real WebSocket ────────────────────────
// The stub implements the bridge's message contract — `setScene` mutates its
// table (standing in for recomputeRoutes), `getRoutes` answers via the REAL
// buildRouteTableSnapshot — so this exercises queryRoutes → confirmBridgeRoutes
// end-to-end across an actual socket, including the same-socket FIFO the push
// relies on: the getRoutes sent right after setScene sees the new table.

async function waitFor(cond, what, ms = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('_127: integration — notify then read-back over a real socket confirms the routes', async () => {
  const table = { routeEntries: new Map(), mirrorEntries: new Map(), excluded: [], scenes: [] };
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
      const data = JSON.parse(msg.toString());
      if (data.type === 'setScene') {
        // Stand-in for recomputeRoutes: the saved scene routes U30+U31 → .60.
        table.scenes = [data.scene];
        table.routeEntries = new Map([
          [`30→${IP}`, { universe: 30, ip: IP }],
          [`31→${IP}`, { universe: 31, ip: IP }],
        ]);
      } else if (data.type === 'getRoutes') {
        ws.send(JSON.stringify(buildRouteTableSnapshot({
          reqId: data.reqId,
          routeEntries: table.routeEntries,
          mirrorEntries: table.mirrorEntries,
          excluded: table.excluded,
          activeScenes: table.scenes,
        })));
      }
    });
  });
  await new Promise((resolve) => wss.on('listening', resolve));
  const port = wss.address().port;

  const source = new SacnInputSource(`ws://127.0.0.1:${port}`);
  source.enable();
  try {
    await waitFor(() => source.connected, 'the stub bridge connection');

    // BEFORE the notify: the table is empty, and the check says so — loudly.
    const exp = buildRouteExpectation({ plan: plan(), ip: IP, stride: 4 });
    const before = await confirmBridgeRoutes({
      expectations: [exp], attempts: 1,
      readRoutes: () => source.queryRoutes(),
    });
    assert.equal(before.ok, false);
    assert.match(before.reason, new RegExp(`missing U30,U31→${IP}`));

    // The notify (setScene) and the read-back on the SAME socket: FIFO means
    // the very next query answers from the recomputed table.
    source._ws.send(JSON.stringify({ type: 'setScene', scene: 'titanic' }));
    const after = await confirmBridgeRoutes({
      expectations: [exp],
      readRoutes: () => source.queryRoutes(),
    });
    assert.deepEqual(after, { ok: true, detail: `U30,U31→${IP}` });
    assert.deepEqual((await source.queryRoutes()).activeScenes, ['titanic']);
  } finally {
    source.disable();
    await new Promise((resolve) => wss.close(resolve));
  }
});
