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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeEffectiveRoutes, engineOwnedPairs, routeKey } =
  require('../lib/bridge_routing.cjs');

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
