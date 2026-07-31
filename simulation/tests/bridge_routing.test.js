/**
 * bridge_routing.test.js — unit tests for the sACN bridge's pure route-set
 * computation (lib/bridge_routing.cjs), the 2026-07-24 flicker/freeze fix.
 *
 * The scenarios mirror the operator-visible failure modes:
 *   - a titanic viewer must NOT clobber test_bench's hardware routes,
 *   - the engine's active scene keeps hardware alive with zero browsers,
 *   - engine-owned (universe → host) pairs are suppressed (dual-source flicker),
 *   - engine unreachable ⇒ no engine routes AND no suppression,
 *   - refcount semantics across duplicate / disconnecting clients.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeEffectiveRoutes, engineOwnedPairs, routeKey,
  classifyRouteIp, partitionRoutePairs, PLACEHOLDER_SENTINEL_IP,
  ROUTE_IP_SENTINEL, ROUTE_IP_MISSING, ROUTE_IP_BROADCAST, ROUTE_IP_LOOPBACK,
  computeUniverseSubscriptionDiff, applyUniverseSubscriptions, SACN_UNIVERSE_MAX,
  patchRecordUniverses, readPatchDeclarations, parseSubscribedUniversesField,
} = require('../lib/bridge_routing.cjs');

const SIM_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The real-world route sets from scenes/*/patches.yaml on 2026-07-24.
const TEST_BENCH = [
  { universe: 1, ip: '10.1.1.10' },
  { universe: 2, ip: '10.1.1.10' },
  { universe: 10, ip: '10.1.1.202' },
  { universe: 12, ip: '10.1.1.202' },
];
const TITANIC = []; // titanic declares no controller IPs

function sceneMap(entries) {
  return new Map(entries);
}

const keysOf = (routes) => routes.map(r => routeKey(r.universe, r.ip)).sort();

test('titanic client does not clobber the engine scene\'s hardware routes (the freeze)', () => {
  const { routes } = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['test_bench', TEST_BENCH], ['titanic', TITANIC]]),
    pinnedScene: 'titanic',
    engineScene: 'test_bench',
    clientScenes: ['titanic', 'titanic'],
    engineOwned: new Set(),
  });
  assert.deepEqual(keysOf(routes), keysOf(TEST_BENCH.map(r => ({ ...r }))));
});

test('engine scene alone keeps hardware routed with zero connected clients', () => {
  const { routes, activeScenes } = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['test_bench', TEST_BENCH], ['titanic', TITANIC]]),
    pinnedScene: 'titanic',
    engineScene: 'test_bench',
    clientScenes: [],
    engineOwned: new Set(),
  });
  assert.equal(routes.length, 4);
  assert.deepEqual(activeScenes, ['test_bench', 'titanic']);
});

test('engine-owned pairs are excluded, others kept (the dual-source flicker)', () => {
  const owned = new Set([routeKey(10, '10.1.1.202'), routeKey(12, '10.1.1.202')]);
  const { routes, excluded } = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['test_bench', TEST_BENCH]]),
    pinnedScene: null,
    engineScene: 'test_bench',
    clientScenes: [],
    engineOwned: owned,
  });
  assert.deepEqual(keysOf(routes), [routeKey(1, '10.1.1.10'), routeKey(2, '10.1.1.10')].sort());
  assert.deepEqual(keysOf(excluded), [...owned].sort());
});

test('engine unreachable: no engine-scene routes and no suppression', () => {
  const { routes, excluded } = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['test_bench', TEST_BENCH], ['titanic', TITANIC]]),
    pinnedScene: 'titanic',
    engineScene: null,          // unreachable
    clientScenes: ['titanic'],
    engineOwned: new Set(),     // unreachable ⇒ empty owned set
  });
  assert.deepEqual(routes, []); // only titanic active — zero hardware routes
  assert.deepEqual(excluded, []);
});

test('engine scene change swaps the route set deterministically', () => {
  const scenes = sceneMap([
    ['test_bench', TEST_BENCH],
    ['other_rig', [{ universe: 3, ip: '10.1.1.30' }]],
  ]);
  const before = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: 'test_bench',
    clientScenes: [], engineOwned: new Set(),
  });
  const after = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: 'other_rig',
    clientScenes: [], engineOwned: new Set(),
  });
  assert.equal(before.routes.length, 4);
  assert.deepEqual(keysOf(after.routes), [routeKey(3, '10.1.1.30')]);
});

test('duplicate clients of one scene are a refcount: set unchanged, single-drop keeps routes', () => {
  const scenes = sceneMap([['test_bench', TEST_BENCH]]);
  const two = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: null,
    clientScenes: ['test_bench', 'test_bench'], engineOwned: new Set(),
  });
  const one = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: null,
    clientScenes: ['test_bench'], engineOwned: new Set(),
  });
  const zero = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: null,
    clientScenes: [], engineOwned: new Set(),
  });
  assert.deepEqual(keysOf(two.routes), keysOf(one.routes));
  assert.equal(one.routes.length, 4);
  assert.deepEqual(zero.routes, []); // last client gone, no pin, no engine
});

test('cross-scene conflict: same universe to different controllers is kept but reported', () => {
  const scenes = sceneMap([
    ['test_bench', [{ universe: 2, ip: '10.1.1.10' }]],
    ['summer_camp_dome', [{ universe: 2, ip: '10.1.1.14' }]],
  ]);
  const { routes, conflicts } = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: 'summer_camp_dome', engineScene: 'test_bench',
    clientScenes: [], engineOwned: new Set(),
  });
  assert.equal(routes.length, 2);
  assert.deepEqual(conflicts, [{ universe: 2, ips: ['10.1.1.10', '10.1.1.14'] }]);
});

test('same pair declared by two scenes dedupes into one route with both scenes credited', () => {
  const scenes = sceneMap([
    ['a', [{ universe: 5, ip: '10.1.1.50' }]],
    ['b', [{ universe: 5, ip: '10.1.1.50' }]],
  ]);
  const { routes, conflicts } = computeEffectiveRoutes({
    sceneRoutes: scenes, pinnedScene: null, engineScene: 'a',
    clientScenes: ['b'], engineOwned: new Set(),
  });
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0].scenes, ['a', 'b']);
  assert.deepEqual(conflicts, []);
});

test('engineOwnedPairs parses the /status outputRouting shape', () => {
  const owned = engineOwnedPairs({
    controllers: [
      { name: 'Titanic-202', host: '10.1.1.202', protocol: 'sACN', alsoFlat: true, universes: [10, 12] },
      { name: 'Art-1', host: '10.1.1.77', protocol: 'artnet', universes: [4] },
    ],
  });
  assert.deepEqual([...owned].sort(), [
    routeKey(10, '10.1.1.202'), routeKey(12, '10.1.1.202'), routeKey(4, '10.1.1.77'),
  ].sort());
});

test('engineOwnedPairs is empty (not throwing) for null / malformed payloads', () => {
  assert.equal(engineOwnedPairs(null).size, 0);
  assert.equal(engineOwnedPairs({}).size, 0);
  assert.equal(engineOwnedPairs({ controllers: [{ host: '', universes: [1] }] }).size, 0);
  assert.equal(engineOwnedPairs({ controllers: [{ host: '10.0.0.1', universes: ['x', 0, -3] }] }).size, 0);
});

// ── Placeholder-sentinel refusal (report 20260725_33 §2) ────────────────────
//
// Titanic gets patched against placeholder controllers long before the wiring is
// known. Those routes must be REFUSED — loudly. The old bridge filtered the
// sentinel inline and in silence, so an operator staring at dark hardware could
// not tell "no controller declared" from "controller declared, route dropped".

test('the 0.0.0.0 placeholder sentinel is refused, with a reason naming it', () => {
  const verdict = classifyRouteIp(PLACEHOLDER_SENTINEL_IP);
  assert.equal(verdict.admit, false);
  assert.equal(verdict.status, ROUTE_IP_SENTINEL);
  assert.match(verdict.reason, /placeholder sentinel/);
});

test('missing, broadcast and loopback addresses are each refused with their own reason', () => {
  assert.equal(classifyRouteIp('').status, ROUTE_IP_MISSING);
  assert.equal(classifyRouteIp(undefined).status, ROUTE_IP_MISSING);
  assert.equal(classifyRouteIp('   ').status, ROUTE_IP_MISSING);
  assert.equal(classifyRouteIp('255.255.255.255').status, ROUTE_IP_BROADCAST);
  assert.equal(classifyRouteIp('127.0.0.1').status, ROUTE_IP_LOOPBACK);
  assert.equal(classifyRouteIp('127.1.2.3').status, ROUTE_IP_LOOPBACK);
  assert.equal(classifyRouteIp('LOCALHOST').status, ROUTE_IP_LOOPBACK);
  for (const v of [classifyRouteIp(''), classifyRouteIp('255.255.255.255'), classifyRouteIp('127.0.0.1')]) {
    assert.ok(v.reason.length > 0, 'every refusal must carry an explanation to log');
  }
});

test('real controller addresses are still admitted (the refusal set stays tight)', () => {
  for (const ip of ['10.1.1.10', '10.1.1.60', '192.168.4.7', '172.16.5.9', 'marsinled-202.local']) {
    assert.equal(classifyRouteIp(ip).admit, true, `${ip} must still route`);
  }
});

test('partition keeps good routes and reports sentinel refusals with their fixtures', () => {
  const { routes, refusals } = partitionRoutePairs([
    { universe: 2, ip: '10.1.1.10', source: 'Par 1' },
    { universe: 2, ip: '10.1.1.10', source: 'Par 2' },     // de-duplicated
    { universe: 5, ip: '0.0.0.0', source: 'Left Wall 1' },
    { universe: 5, ip: '0.0.0.0', source: 'Left Wall 2' },
    { universe: 0, ip: '10.1.1.99', source: 'TE Sign A' }, // unpatched: not a claim
  ]);
  assert.deepEqual(routes, [{ universe: 2, ip: '10.1.1.10' }]);
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].status, ROUTE_IP_SENTINEL);
  assert.equal(refusals[0].universe, 5);
  // The operator needs to know WHICH fixtures asked for the dead route.
  assert.deepEqual(refusals[0].sources, ['Left Wall 1', 'Left Wall 2']);
});

test('a refused pair never leaks into the effective route set (no sender, no send)', () => {
  const { routes } = partitionRoutePairs([
    { universe: 5, ip: '0.0.0.0' },
    { universe: 6, ip: '' },
    { universe: 7, ip: '127.0.0.1' },
  ]);
  assert.deepEqual(routes, []);
  const effective = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['titanic', routes]]),
    pinnedScene: 'titanic', engineScene: 'titanic', clientScenes: [], engineOwned: new Set(),
  });
  assert.deepEqual(effective.routes, []);
});

test('a placeholder controller does not suppress the REAL routes in the same scene', () => {
  // The bench must keep working while titanic is half-authored against sentinels.
  const { routes, refusals } = partitionRoutePairs([
    { universe: 1, ip: '10.1.1.10', source: 'Haze' },
    { universe: 2, ip: '10.1.1.10', source: 'Par 1' },
    { universe: 10, ip: '10.1.1.60', source: 'LED_0' },
    { universe: 3, ip: '0.0.0.0', source: 'Titanic Bow' },
  ]);
  assert.equal(routes.length, 3);
  assert.equal(refusals.length, 1);
});

// ── Runtime universe subscription (report 20260725_58 §7.1, slice S3) ───────
//
// The `sacn` Receiver drops packets for unsubscribed universes with NO event,
// and the bridge used to freeze its subscription at boot. A scene saved
// afterwards could mint a relay route on a universe the receiver would never
// deliver: a route that looks live in every log and carries nothing. These
// tests pin the diff semantics and the add path against a fake Receiver that
// mirrors node_modules/sacn/dist/receiver.js — including the interfaces where
// `addMembership` throws.

/** Mirrors the real Receiver's contract: mutates `universes` in place. */
function fakeReceiver(universes, { throwOn = new Set() } = {}) {
  return {
    universes: [...universes],
    joins: [],
    addUniverse(universe) {
      if (this.universes.includes(universe)) return this;
      if (throwOn.has(universe)) {
        // The package does NOT catch this — addMembership throws straight out
        // and the universe is left OUT of `universes`.
        throw new Error(`addMembership EADDRNOTAVAIL for U${universe}`);
      }
      this.joins.push(universe);
      this.universes.push(universe);
      return this;
    },
  };
}

function collector() {
  const lines = [];
  return { lines, sink: (m) => lines.push(m) };
}

test('subscription diff proposes only the universes the receiver lacks, ascending', () => {
  const { additions, invalid } = computeUniverseSubscriptionDiff({
    subscribed: [1, 2, 20, 21],
    wanted: [
      { universe: 27, source: "scene 'titanic' patch" },
      { universe: 2, source: "scene 'titanic' patch" },   // already subscribed
      { universe: 25, source: 'relay route → 10.1.1.60' },
    ],
  });
  assert.deepEqual(additions.map(a => a.universe), [25, 27]);
  assert.deepEqual(invalid, []);
});

test('the U27 trap: a route past the boot list is caught instead of silently dark', () => {
  // The operator's boot subscription was the persisted "1..24" override; the
  // next controller mapped past U24 is the repeat of his dark-LED day.
  const boot = Array.from({ length: 24 }, (_, i) => i + 1);
  const { additions } = computeUniverseSubscriptionDiff({
    subscribed: boot,
    wanted: [
      { universe: 21, source: 'relay route → 10.1.1.60' },
      { universe: 22, source: 'relay route → 10.1.1.60' },
      { universe: 27, source: 'relay route → 10.1.1.60' },
    ],
  });
  assert.deepEqual(additions.map(a => a.universe), [27]);
});

test('subscription diff merges and de-duplicates the provenance of one universe', () => {
  const { additions } = computeUniverseSubscriptionDiff({
    subscribed: [1],
    wanted: [
      { universe: 30, source: 'relay route → 10.1.1.60' },
      { universe: 30, source: "scene 'titanic' patch" },
      { universe: 30, source: "scene 'titanic' patch" },  // duplicate source
      { universe: 30 },                                    // no provenance
    ],
  });
  assert.equal(additions.length, 1);
  assert.deepEqual(additions[0].sources, ['relay route → 10.1.1.60', "scene 'titanic' patch"]);
});

test('unpatched / non-numeric universes are not subscription claims', () => {
  const { additions, invalid } = computeUniverseSubscriptionDiff({
    subscribed: [1],
    wanted: [{ universe: null }, { universe: 'abc' }, { universe: undefined }, null],
  });
  assert.deepEqual(additions, []);
  assert.deepEqual(invalid, []);
});

test('universes outside the E1.31 range are reported as invalid, never subscribed', () => {
  const { additions, invalid } = computeUniverseSubscriptionDiff({
    subscribed: [1],
    wanted: [
      { universe: 0, source: 'Bogus A' },
      { universe: -3, source: 'Bogus B' },
      { universe: SACN_UNIVERSE_MAX + 1, source: 'Bogus C' },
      { universe: SACN_UNIVERSE_MAX, source: 'Legit edge' },
    ],
  });
  assert.deepEqual(additions.map(a => a.universe), [SACN_UNIVERSE_MAX]);
  assert.deepEqual(invalid.map(i => i.universe), [-3, 0, SACN_UNIVERSE_MAX + 1]);
});

test('apply subscribes the missing universes on the receiver and logs each once', () => {
  const receiver = fakeReceiver([1, 2]);
  const log = collector();
  const err = collector();
  const wanted = [
    { universe: 2, source: "scene 'titanic' patch" },
    { universe: 27, source: "scene 'titanic' patch" },
  ];
  const first = applyUniverseSubscriptions({
    receiver, wanted, reason: "client scene 'titanic'", onLog: log.sink, onError: err.sink,
  });
  assert.deepEqual(first.added, [27]);
  assert.deepEqual(receiver.joins, [27]);
  assert.equal(err.lines.length, 0);
  assert.equal(log.lines.length, 1);
  assert.match(log.lines[0], /runtime-subscribed U27/);
  assert.match(log.lines[0], /titanic/);          // provenance + reason are in the line

  // A second recompute must be a silent no-op — "log each subscription ONCE".
  const second = applyUniverseSubscriptions({
    receiver, wanted, reason: 'engine poll', onLog: log.sink, onError: err.sink,
  });
  assert.deepEqual(second.added, []);
  assert.equal(log.lines.length, 1);
  assert.deepEqual(receiver.universes, [1, 2, 27]);
});

test('a throwing addMembership isolates that universe: loud, non-fatal, others still join', () => {
  const receiver = fakeReceiver([1], { throwOn: new Set([30]) });
  const log = collector();
  const err = collector();
  const res = applyUniverseSubscriptions({
    receiver,
    wanted: [
      { universe: 30, source: 'relay route → 10.1.1.60' },
      { universe: 31, source: 'relay route → 10.1.1.61' },
    ],
    reason: 'boot',
    onLog: log.sink,
    onError: err.sink,
  });
  assert.deepEqual(res.added, [31]);              // the failure did not abort the loop
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].universe, 30);
  assert.equal(err.lines.length, 1);
  assert.match(err.lines[0], /U30/);
  assert.match(err.lines[0], /MULTICAST/);        // says exactly what was lost
  // Boot parity: the universe is still ACCEPTED, so unicast sources (the
  // engine loopback, the sim's prio-150 writer) keep being delivered.
  assert.ok(receiver.universes.includes(30));
  assert.ok(receiver.universes.includes(31));
});

test('an out-of-range claim is shouted about and no universe is added for it', () => {
  const receiver = fakeReceiver([1]);
  const log = collector();
  const err = collector();
  const res = applyUniverseSubscriptions({
    receiver,
    wanted: [{ universe: 70000, source: 'Broken Fixture' }],
    reason: 'boot',
    onLog: log.sink,
    onError: err.sink,
  });
  assert.deepEqual(res.added, []);
  assert.deepEqual(receiver.universes, [1]);
  assert.equal(err.lines.length, 1);
  assert.match(err.lines[0], /70000/);
  assert.match(err.lines[0], /Broken Fixture/);
});

// ── LED strand spill + the no-restart chain (report 20260725_87) ────────────
//
// The operator's ask: "map a new universe → save → LEDs work, ZERO restarts."
// Three things have to hold for that sentence to be true, and each gets pinned
// here:
//   1. a patches.yaml record's FULL universe span (an LED strand spills past
//      channel 512 into `segments[]`) feeds both the relay routes and the
//      subscription diff — reading only `dmxUniverse` left the spill dark;
//   2. the declarations come from a FRESH parse each time, so the union covers
//      a universe that appeared in the file only after the bridge booted;
//   3. the `📡 Subscribed Universes` field is parsed identically on the server
//      (this module) and in the browser gate (src/dmx/subscribed_universes.js),
//      because the bridge now re-reads it at runtime and the two must agree on
//      what the operator typed.

test('a plain DMX fixture record occupies exactly its dmxUniverse', () => {
  const { universes, anomaly } = patchRecordUniverses({
    controllerIp: '10.1.1.16', dmxUniverse: 15, dmxAddress: 1,
  });
  assert.deepEqual(universes, [15]);
  assert.equal(anomaly, null);
});

test('an UNPATCHED record claims nothing (dmxUniverse 0 is a legitimate zero)', () => {
  assert.deepEqual(patchRecordUniverses({ controllerIp: '', dmxUniverse: 0 }).universes, []);
  assert.deepEqual(patchRecordUniverses(null).universes, []);
  assert.deepEqual(patchRecordUniverses({ dmxUniverse: 'nope' }).universes, []);
});

test('an LED strand occupies EVERY segment universe, not just the start (the spill)', () => {
  // A 200 px RGBW strand at U30 ch1: U30 ch1-512 (128 px), U31 ch1-288 (72 px).
  const { universes, anomaly } = patchRecordUniverses({
    controllerIp: '10.1.1.60', dmxUniverse: 30, dmxAddress: 1, pixelCount: 200,
    endUniverse: 31, endChannel: 288,
    segments: [
      { universe: 30, startChannel: 1, endChannel: 512, pixelCount: 128 },
      { universe: 31, startChannel: 1, endChannel: 288, pixelCount: 72 },
    ],
  });
  assert.deepEqual(universes, [30, 31]);
  assert.equal(anomaly, null, 'segments[] is authoritative — nothing is derived');
});

test('segments[] beats a stale endUniverse and covers a three-universe run', () => {
  const { universes } = patchRecordUniverses({
    dmxUniverse: 30, endUniverse: 30,   // stale/wrong endpoint
    segments: [{ universe: 30 }, { universe: 31 }, { universe: 32 }],
  });
  assert.deepEqual(universes, [30, 31, 32]);
});

test('a record with endUniverse but no segments interpolates the interior AND says so', () => {
  const { universes, anomaly } = patchRecordUniverses({
    dmxUniverse: 6, endUniverse: 9, segments: [],
  });
  assert.deepEqual(universes, [6, 7, 8, 9], 'a strand walk is contiguous by construction');
  assert.match(anomaly, /no segments/);
  assert.match(anomaly, /Re-save/);
});

test('an absurd endUniverse span is refused rather than interpolated — loudly', () => {
  const { universes, anomaly } = patchRecordUniverses({ dmxUniverse: 6, endUniverse: 6000 });
  assert.deepEqual(universes, [6, 6000], 'only the two explicit endpoints');
  assert.match(anomaly, /refusing/i);
});

test('readPatchDeclarations relays the spill universe to the SAME controller', () => {
  const { declared, universes, anomalies } = readPatchDeclarations({
    patches: {
      'Right Front Wall 1': { controllerIp: '10.1.1.16', dmxUniverse: 15 },
      'TE Sign V3 A': { controllerIp: '', dmxUniverse: 0 },        // unpatched
      Left_Front_Left: {
        controllerIp: '10.1.1.60', dmxUniverse: 30,
        segments: [{ universe: 30 }, { universe: 31 }],
      },
    },
  });
  assert.deepEqual(universes, [15, 30, 31]);
  assert.deepEqual(anomalies, []);
  const { routes, refusals } = partitionRoutePairs(declared);
  assert.deepEqual(routes.map((r) => routeKey(r.universe, r.ip)),
    ['15→10.1.1.16', '30→10.1.1.60', '31→10.1.1.60']);
  assert.deepEqual(refusals, [], 'an unpatched record is not a refusal, it is no claim at all');
});

test('the spill universe reaches the RECEIVER too — end to end through the diff', () => {
  // The exact failure this closes: boot subscribed 1..30 (the strand start was
  // all the old reader saw), the strand spills into U31, and every log line
  // looked healthy while pixels 129+ went dark.
  const receiver = fakeReceiver([1, 2, 30]);
  const log = collector();
  const err = collector();
  const { declared, universes } = readPatchDeclarations({
    patches: {
      Left_Front_Left: {
        controllerIp: '10.1.1.60', dmxUniverse: 30,
        segments: [{ universe: 30 }, { universe: 31 }],
      },
    },
  });
  const { routes } = computeEffectiveRoutes({
    sceneRoutes: sceneMap([['titanic', partitionRoutePairs(declared).routes]]),
    pinnedScene: 'titanic',
    engineScene: null,
    clientScenes: ['titanic'],
    engineOwned: new Set(),
  });
  const wanted = [
    ...routes.map((r) => ({ universe: r.universe, source: `relay route -> ${r.ip}` })),
    ...universes.map((u) => ({ universe: u, source: "scene 'titanic' patch" })),
  ];
  const res = applyUniverseSubscriptions({
    receiver, wanted, reason: "client scene 'titanic'", onLog: log.sink, onError: err.sink,
  });
  assert.deepEqual(res.added, [31]);
  assert.equal(err.lines.length, 0);
  assert.match(log.lines[0], /runtime-subscribed U31/);
});

test('a universe that appears in patches.yaml only AFTER boot lands in the union', () => {
  // Freshness has no cache to defeat: readPatchDeclarations is a pure function
  // of the tree handed to it, and the bridge re-reads the file inside
  // readSceneRoutePairs on every recompute (pinned by the wiring test below).
  const beforeSave = { patches: { 'Wall 1': { controllerIp: '10.1.1.16', dmxUniverse: 15 } } };
  const afterSave = {
    patches: {
      'Wall 1': { controllerIp: '10.1.1.16', dmxUniverse: 15 },
      'Small SmokeStack 1': { controllerIp: '10.1.1.21', dmxUniverse: 27 },
    },
  };
  assert.deepEqual(readPatchDeclarations(beforeSave).universes, [15]);

  const receiver = fakeReceiver(readPatchDeclarations(beforeSave).universes);
  const log = collector();
  const err = collector();
  const res = applyUniverseSubscriptions({
    receiver,
    wanted: readPatchDeclarations(afterSave).universes
      .map((u) => ({ universe: u, source: "scene 'titanic' patch" })),
    reason: "client scene 'titanic'",
    onLog: log.sink,
    onError: err.sink,
  });
  assert.deepEqual(res.added, [27], 'the just-saved universe is subscribed without a restart');
  assert.match(log.lines[0], /runtime-subscribed U27/);
});

test('an empty / shapeless patches tree yields no claims and no crash', () => {
  for (const tree of [null, undefined, {}, { patches: null }, { patches: {} }]) {
    const read = readPatchDeclarations(tree);
    assert.deepEqual(read.universes, []);
    assert.deepEqual(read.declared, []);
    assert.deepEqual(read.anomalies, []);
  }
});

// ── The Subscribed Universes field parser ──────────────────────────────────

test('the field parser is bridge-exact: comma tokens, deduped, ascending', () => {
  const { universes, malformed } = parseSubscribedUniversesField(' 3, 1 ,2, 3 ');
  assert.deepEqual(universes, [1, 2, 3]);
  assert.deepEqual(malformed, []);
});

test('the field parser reproduces the 1-24 range trap and REPORTS it', () => {
  const { universes, malformed } = parseSubscribedUniversesField('1-24, 27');
  assert.deepEqual(universes, [1, 27], 'the bridge has no range syntax — this is the trap');
  assert.equal(malformed.length, 1);
  assert.equal(malformed[0].token, '1-24');
  assert.match(malformed[0].reason, /U1 only/);
});

test('the field parser drops non-numbers and sub-1 tokens, and says which', () => {
  const { universes, malformed } = parseSubscribedUniversesField('abc, 0, -3, 5');
  assert.deepEqual(universes, [5]);
  assert.deepEqual(malformed.map((m) => m.token), ['abc']);
});

test('an empty / absent field is no claim at all', () => {
  for (const v of ['', '   ', ',,', null, undefined]) {
    assert.deepEqual(parseSubscribedUniversesField(v).universes, []);
  }
});

test('server and browser field parsers agree token-for-token', async () => {
  // The bridge re-reads this field at runtime while the save-time gate widens
  // it in the browser. If the two parsers ever diverged, the gate would report
  // a set the bridge does not actually subscribe to — the original silent-dark
  // shape, one level up.
  const browser = await import('../src/dmx/subscribed_universes.js');
  const cases = [
    '1, 2, 3', '1-24', '1-24, 27', '', '  ', '0, 1, 63999, 64000', 'abc, 5',
    '3.5, 7', '07, 7', '  12x , 13 ', '2,2,2', '-1, 4',
  ];
  for (const input of cases) {
    const mine = parseSubscribedUniversesField(input);
    const theirs = browser.parseSubscribedUniverses(input);
    assert.deepEqual(mine.universes, theirs.universes, `universes differ for '${input}'`);
    assert.deepEqual(mine.malformed, theirs.malformed, `malformed differs for '${input}'`);
  }
});

// ── Wiring: the bridge really re-reads, on every recompute ──────────────────

test('the bridge re-reads patches.yaml INSIDE readSceneRoutePairs (no cache)', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'server/sacn_bridge.js'), 'utf8');
  const fn = src.slice(src.indexOf('function readSceneRoutePairs'),
    src.indexOf('function recomputeRoutes'));
  assert.match(fn, /fs\.readFileSync\(patchesYamlPath/,
    'the file must be read per call — a hoisted read is a stale route table');
  assert.match(fn, /readPatchDeclarations\(pConf\)/,
    'declarations must come from the shared reader, so LED spill universes are included');
  assert.match(src, /for \(const s of candidateScenes\) \{[\s\S]{0,200}readSceneRoutePairs\(s\)/,
    'recomputeRoutes must call it for every active scene on every recompute');
});

test('recomputeRoutes re-reads the 📡 field and adds it to the wanted set', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'server/sacn_bridge.js'), 'utf8');
  const fn = src.slice(src.indexOf('function recomputeRoutes'),
    src.indexOf('// ── Engine poll'));
  const fieldAt = fn.indexOf('readSubscribedUniversesField()');
  const applyAt = fn.indexOf('applyUniverseSubscriptions({');
  assert.ok(fieldAt > 0, 'the field must be re-read on every recompute, not only at boot');
  assert.ok(applyAt > fieldAt, 'it must join the wanted set BEFORE the subscription is applied');
  assert.match(fn, /Subscribed Universes field/, 'the log provenance must name the field');
  // And the boot path must use the same parser — one meaning for the field.
  assert.match(src, /parseSubscribedUniversesField\(univOverride\)/,
    'boot and runtime must parse the field with the same function');
});

test('the setScene message a save sends triggers a full recompute', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'server/sacn_bridge.js'), 'utf8');
  assert.match(src, /data\.type === 'setScene'[\s\S]{0,900}recomputeRoutes\(`client scene/,
    'PatchManager.notifySacnBridge sends setScene after every save — it must recompute');
});

test('the save notifies the bridge only AFTER the save server has answered', () => {
  const src = fs.readFileSync(path.join(SIM_ROOT, 'src/gui/gui_builder.js'), 'utf8');
  const fetchAt = src.indexOf('await fetch(saveHttpUrl(`/save${sceneParam}`)');
  const okAt = src.indexOf('if (!res.ok) throw new Error(`save server responded');
  const notifyAt = src.indexOf('await window.PatchManager.notifySacnBridgeLoud()');
  assert.ok(fetchAt > 0 && okAt > fetchAt && notifyAt > okAt,
    'notify must follow the AWAITED, verified save — otherwise the bridge re-reads a stale file');
});
