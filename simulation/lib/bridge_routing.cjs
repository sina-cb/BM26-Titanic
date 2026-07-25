/**
 * bridge_routing.cjs — Pure route-set computation for the sACN bridge's
 * hardware relay (sacn_bridge.js).
 *
 * WHY (2026-07-24 flicker/freeze root cause, report 20260724_15):
 *
 *   1. FREEZE — the bridge used to keep ONE global route table keyed to
 *      whichever browser most recently sent `setScene` (last-writer-wins).
 *      Every titanic viewer (0 declared controller IPs) silently DISCONNECTED
 *      the test_bench hardware relay; every test_bench viewer re-enabled it.
 *      The bench lights froze/resumed with plain browser activity.
 *
 *   2. FLICKER — when the engine declares a controller itself
 *      (marsin_engine/config.yaml `controllers:` + `alsoFlat: true`), the
 *      bridge ALSO relayed the engine's own loopback frames back to that
 *      controller: two interleaved sACN sources on one universe (independent
 *      sequence numbers, equal priority) — the firmware counts seqErrors and
 *      the lights flicker.
 *
 * The relay route set is now a PURE FUNCTION of:
 *   - the CLI-pinned scene (`--scene`, deploy-time intent — may be null),
 *   - the ENGINE's active scene (polled from GET /status: hardware follows
 *     the data generator, not browser windows),
 *   - every connected client's tagged scene (union — a viewer can only ADD
 *     its own scene's routes, never clobber another's),
 *   MINUS every (universe → host) pair the engine delivers directly
 *   (its declared controllers, from /status `outputRouting`).
 *
 * Dependency-free and side-effect-free so it is unit-testable
 * (tests/bridge_routing.test.js). The bridge owns all I/O: reading
 * patches.yaml, polling the engine, creating/closing senders, logging.
 */
'use strict';

/** Canonical key for a relay pair. */
function routeKey(universe, ip) {
  return `${universe}→${ip}`; // "U→ip"
}

/**
 * Compute the effective relay route set.
 *
 * @param {Object} args
 * @param {Map<string, Array<{universe:number, ip:string}>>} args.sceneRoutes
 *        scene name → declared (universe, ip) pairs from that scene's
 *        patches.yaml. Scenes absent from this map contribute nothing (the
 *        caller logs missing files loudly).
 * @param {string|null} args.pinnedScene  CLI `--scene` pin, or null.
 * @param {string|null} args.engineScene  engine activeScene, or null when the
 *        engine is unreachable / not identifying (caller logs the transition).
 * @param {Iterable<string>} args.clientScenes one entry PER CONNECTED CLIENT
 *        (duplicates expected and harmless — this is the refcount).
 * @param {Set<string>} args.engineOwned  routeKey() pairs the engine delivers
 *        directly (empty set when the engine is unreachable: no dual writer
 *        can exist then, so nothing needs suppressing).
 * @returns {{
 *   routes:   Array<{universe:number, ip:string, scenes:string[]}>,
 *   excluded: Array<{universe:number, ip:string, scenes:string[]}>,
 *   conflicts: Array<{universe:number, ips:string[]}>,
 *   activeScenes: string[],
 * }}
 *   `routes` = pairs the bridge must relay; `excluded` = pairs suppressed
 *   because the engine owns them; `conflicts` = universes that two active
 *   scenes route to DIFFERENT controllers (all still relayed — each scene's
 *   declaration is explicit intent — but the caller must warn loudly).
 */
function computeEffectiveRoutes({ sceneRoutes, pinnedScene, engineScene, clientScenes, engineOwned }) {
  const activeScenes = new Set();
  if (pinnedScene) activeScenes.add(pinnedScene);
  if (engineScene) activeScenes.add(engineScene);
  for (const s of clientScenes || []) {
    if (s) activeScenes.add(s);
  }

  const byKey = new Map(); // key → { universe, ip, scenes:Set }
  for (const scene of activeScenes) {
    const pairs = sceneRoutes.get(scene) || [];
    for (const { universe, ip } of pairs) {
      const key = routeKey(universe, ip);
      if (!byKey.has(key)) byKey.set(key, { universe, ip, scenes: new Set() });
      byKey.get(key).scenes.add(scene);
    }
  }

  const routes = [];
  const excluded = [];
  const ipsByUniverse = new Map();
  for (const [key, r] of byKey) {
    const entry = { universe: r.universe, ip: r.ip, scenes: [...r.scenes].sort() };
    if (engineOwned && engineOwned.has(key)) {
      excluded.push(entry);
      continue;
    }
    routes.push(entry);
    if (!ipsByUniverse.has(r.universe)) ipsByUniverse.set(r.universe, []);
    ipsByUniverse.get(r.universe).push(r.ip);
  }

  const conflicts = [];
  for (const [universe, ips] of ipsByUniverse) {
    if (ips.length > 1) conflicts.push({ universe, ips: [...ips].sort() });
  }

  const byPair = (a, b) => (a.universe - b.universe) || a.ip.localeCompare(b.ip);
  routes.sort(byPair);
  excluded.sort(byPair);
  conflicts.sort((a, b) => a.universe - b.universe);
  return { routes, excluded, conflicts, activeScenes: [...activeScenes].sort() };
}

/**
 * Build the engine-owned route-pair set from a GET /status `outputRouting`
 * payload. Tolerates null (engine without dispatch / older engine): returns
 * an empty set — the caller logs that suppression is unavailable.
 *
 * The exclusion applies regardless of the controller's protocol: a universe
 * the engine delivers over Art-Net must not ALSO arrive at the same host as
 * a bridge sACN relay.
 */
function engineOwnedPairs(outputRouting) {
  const owned = new Set();
  if (!outputRouting || !Array.isArray(outputRouting.controllers)) return owned;
  for (const c of outputRouting.controllers) {
    if (!c || typeof c.host !== 'string' || c.host.length === 0) continue;
    if (!Array.isArray(c.universes)) continue;
    for (const u of c.universes) {
      const uid = parseInt(u, 10);
      if (Number.isInteger(uid) && uid >= 1) owned.add(routeKey(uid, c.host));
    }
  }
  return owned;
}

module.exports = { computeEffectiveRoutes, engineOwnedPairs, routeKey };
