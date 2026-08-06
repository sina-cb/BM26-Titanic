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
 *   2. FLICKER — an engine that ALSO unicast a universe straight to its
 *      controller left the bridge relaying the engine's own loopback frames to
 *      that same box: two interleaved sACN sources on one universe (independent
 *      sequence numbers, equal priority) — the firmware counts seqErrors and
 *      the lights flicker. That engine-side mechanism is now REMOVED and
 *      refused at boot (marsin_engine/lib/output_config_guard.js): all sACN to
 *      hardware flows through this bridge, which is the single router. The
 *      subtraction below therefore has nothing to subtract in this rig — it
 *      stays because "the engine declares no direct routes" must be PROVEN from
 *      /status on every poll, not assumed.
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

// ── Route-IP admission (report 20260725_33 §2, "fail-loud placeholder rules") ──
//
// Titanic can be patched and audited in-sim long before the physical wiring is
// known, so controllers may carry the PLACEHOLDER SENTINEL `0.0.0.0`. The relay
// must then REFUSE to build that route — with ONE NAMED WARNING. Never a silent
// skip (the operator cannot tell "no hardware declared" from "hardware declared
// but dropped"), and never an attempted send (a sender aimed at 0.0.0.0 is a
// per-frame error storm at best).
//
// Before this existed the bridge filtered the sentinel inline and SILENTLY —
// the refusal was invisible in the logs and in the monitor panel. Classification
// is pure so the reasons are unit-testable and the caller owns the logging.

const ROUTE_IP_OK = 'ok';
const ROUTE_IP_SENTINEL = 'sentinel';
const ROUTE_IP_MISSING = 'missing';
const ROUTE_IP_BROADCAST = 'broadcast';
const ROUTE_IP_LOOPBACK = 'loopback';

/** The placeholder convention: a controller whose real IP is not yet known. */
const PLACEHOLDER_SENTINEL_IP = '0.0.0.0';

/**
 * Decide whether a declared controller IP may become a relay route.
 *
 * Deliberately TIGHT: only the cases below are refused, everything else is
 * admitted exactly as before (a real IPv4 address or a resolvable hostname).
 * Guessing at "looks malformed" would risk silently dropping a working route,
 * which is the very failure mode this function exists to end.
 *
 * @param {*} ip the `controllerIp` a scene's patches.yaml declares
 * @returns {{status:string, admit:boolean, reason:string}}
 */
function classifyRouteIp(ip) {
  const raw = typeof ip === 'string' ? ip.trim() : '';
  if (raw === '') {
    return {
      status: ROUTE_IP_MISSING,
      admit: false,
      reason: 'no controller IP declared — the fixture is patched to a universe but to nothing',
    };
  }
  if (raw === PLACEHOLDER_SENTINEL_IP) {
    return {
      status: ROUTE_IP_SENTINEL,
      admit: false,
      reason: `placeholder sentinel ${PLACEHOLDER_SENTINEL_IP} — real IP not authored yet ` +
        '(sim audit unaffected; no hardware can be reached)',
    };
  }
  if (raw === '255.255.255.255') {
    return {
      status: ROUTE_IP_BROADCAST,
      admit: false,
      reason: 'broadcast address — refusing to flood the LAN with unicast sACN',
    };
  }
  if (raw === '127.0.0.1' || raw.startsWith('127.') || raw.toLowerCase() === 'localhost') {
    return {
      status: ROUTE_IP_LOOPBACK,
      admit: false,
      reason: 'loopback — the sim IS this host; relaying would echo frames back into the bridge',
    };
  }
  return { status: ROUTE_IP_OK, admit: true, reason: '' };
}

/**
 * Split a scene's declared (universe, ip) pairs into admissible relay routes and
 * named refusals, de-duplicating both.
 *
 * @param {Array<{universe:number, ip:*, source?:string}>} pairs raw declarations
 * @returns {{routes:Array<{universe:number,ip:string}>,
 *            refusals:Array<{universe:number, ip:string, status:string,
 *                            reason:string, sources:string[]}>}}
 */
function partitionRoutePairs(pairs) {
  const admitted = new Map();
  const refused = new Map();
  for (const pair of pairs || []) {
    const universe = parseInt(pair.universe, 10);
    if (!Number.isInteger(universe) || universe < 1) continue; // unpatched: not a route claim
    const verdict = classifyRouteIp(pair.ip);
    const ip = typeof pair.ip === 'string' ? pair.ip.trim() : '';
    const key = routeKey(universe, ip);
    if (verdict.admit) {
      if (!admitted.has(key)) admitted.set(key, { universe, ip });
      continue;
    }
    if (!refused.has(key)) {
      refused.set(key, {
        universe,
        ip,
        status: verdict.status,
        reason: verdict.reason,
        sources: [],
      });
    }
    if (pair.source && !refused.get(key).sources.includes(pair.source)) {
      refused.get(key).sources.push(pair.source);
    }
  }
  const byPair = (a, b) => (a.universe - b.universe) || a.ip.localeCompare(b.ip);
  return {
    routes: [...admitted.values()].sort(byPair),
    refusals: [...refused.values()].sort(byPair),
  };
}

// ── patches.yaml → route/subscription claims ────────────────────────────────
//
// A patches.yaml record is NOT always one universe. LED strand records (written
// by save-server.js from led_patch_projection's walk) carry `segments[]` — one
// run per universe the strand occupies as it spills past channel 512 — plus
// `endUniverse`/`endChannel`. A 200 px RGBW strand starting on U30 occupies U30
// AND U31; the controller needs BOTH relayed, and the receiver must accept both.
//
// The bridge used to read ONLY `dmxUniverse` (the START), so every spill
// universe was invisible to the relay and to the subscription diff: the pixels
// past channel 512 went dark with a "Route created" line in the log and a green
// monitor. That is the same silent-dark shape report 20260725_60 closed for
// post-boot universes, one field deeper.

/** A strand's walk is contiguous, but refuse to invent an unbounded range. */
const MAX_INTERPOLATED_STRAND_SPAN = 64;

/**
 * Every universe ONE patches.yaml record occupies.
 *
 * `segments[]` is authoritative when present (it is the exact walk). Records
 * written before the segments field existed — or hand-edited — may carry only
 * `dmxUniverse` (+ `endUniverse`); the interior is then interpolated, because a
 * strand's placement is contiguous by construction, and the caller is told via
 * `anomalies` so nothing is derived in silence.
 *
 * @param {Object} patch one entry of the `patches` map
 * @returns {{universes:number[], anomaly:(string|null)}}
 *   `universes` ascending; empty for an UNPATCHED record (`dmxUniverse: 0`) —
 *   which is a legitimate zero, not an error.
 */
function patchRecordUniverses(patch) {
  const out = new Set();
  const add = (v) => {
    const u = parseInt(v, 10);
    if (Number.isInteger(u) && u >= 1) out.add(u);
  };
  if (!patch || typeof patch !== 'object') return { universes: [], anomaly: null };

  const start = parseInt(patch.dmxUniverse, 10);
  add(start);

  const segments = Array.isArray(patch.segments) ? patch.segments : [];
  if (segments.length > 0) {
    for (const seg of segments) {
      if (seg) add(seg.universe);
    }
    return { universes: [...out].sort((a, b) => a - b), anomaly: null };
  }

  const end = parseInt(patch.endUniverse, 10);
  let anomaly = null;
  if (Number.isInteger(start) && start >= 1 && Number.isInteger(end) && end > start) {
    const span = end - start;
    add(end);
    if (span <= MAX_INTERPOLATED_STRAND_SPAN) {
      for (let u = start; u <= end; u += 1) add(u);
      if (span > 1) {
        anomaly = `spans U${start}–U${end} but carries no segments[] — the interior universes ` +
          'were interpolated from the contiguous walk. Re-save the scene to regenerate segments.';
      }
    } else {
      anomaly = `claims U${start}–U${end} (${span + 1} universes) with no segments[] — refusing ` +
        'to interpolate a span that large; only the two endpoints are subscribed/relayed. ' +
        'Re-save the scene to regenerate segments, or fix endUniverse.';
    }
  }
  return { universes: [...out].sort((a, b) => a - b), anomaly };
}

/**
 * Turn a parsed patches.yaml tree into the bridge's two derived views:
 * the declared (universe → controllerIp) relay pairs, and every universe the
 * scene occupies at all (a fixture with no controller IP still has to REACH THE
 * BROWSERS, so the receiver must accept its universe).
 *
 * @param {Object} patchesTree the `yaml.load()` result of a patches.yaml
 * @returns {{declared: Array<{universe:number, ip:*, source:string}>,
 *            universes: number[],
 *            anomalies: Array<{source:string, message:string}>}}
 */
function readPatchDeclarations(patchesTree) {
  const declared = [];
  const universes = new Set();
  const anomalies = [];
  const records = (patchesTree && patchesTree.patches && typeof patchesTree.patches === 'object')
    ? patchesTree.patches : null;
  if (!records) return { declared, universes: [], anomalies };

  for (const [fixtureName, patch] of Object.entries(records)) {
    const { universes: occupied, anomaly } = patchRecordUniverses(patch);
    if (anomaly) anomalies.push({ source: fixtureName, message: anomaly });
    for (const universe of occupied) {
      declared.push({ universe, ip: patch.controllerIp, source: fixtureName });
      universes.add(universe);
    }
  }
  return { declared, universes: [...universes].sort((a, b) => a - b), anomalies };
}

// ── The `📡 Subscribed Universes` field (scenes/common.yaml colorWave) ───────
//
// The bridge reads this field as its BOOT accept-list. Report 20260725_86 made
// the save path keep it in step with the mapping; this parser is the one the
// bridge uses at boot AND on every runtime recompute, so "what the field means"
// has exactly one implementation server-side. The browser-side twin lives in
// src/dmx/subscribed_universes.js (ESM, it also drives the dialog) and is pinned
// against this one by a parity test.
//
// It has NO range syntax: `1-24` parses to U1 and U1 only. That arithmetic is
// preserved verbatim — but every token whose parse differs from what a human
// reading it would expect is REPORTED, so a hand-typed range surfaces as a loud
// finding instead of 23 dark universes.

/**
 * @param {*} value the raw field text
 * @returns {{universes:number[], malformed:Array<{token:string, reason:string}>}}
 */
function parseSubscribedUniversesField(value) {
  const seen = new Set();
  const malformed = [];
  const raw = String(value === undefined || value === null ? '' : value);
  for (const token of raw.split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) {
      malformed.push({ token: trimmed, reason: 'not a number — the bridge drops it entirely' });
      continue;
    }
    if (String(parsed) !== trimmed) {
      malformed.push({
        token: trimmed,
        reason: `the bridge reads this as U${parsed} only (it has no range syntax)`,
      });
    }
    if (parsed >= SACN_UNIVERSE_MIN) seen.add(parsed);
  }
  return { universes: [...seen].sort((a, b) => a - b), malformed };
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

// ── Receiver universe subscription (report 20260725_58 §7.1) ────────────────
//
// The `sacn` package's Receiver filters INBOUND packets against its own
// `universes` array and drops non-members with NO event (node_modules/sacn/
// dist/receiver.js:22). The bridge used to build that array ONCE at boot and
// never touch it again, while `recomputeRoutes` happily minted relay senders
// for any universe a scene's patches.yaml declared. A universe patched after
// boot therefore produced a route that LOOKED live in every log and carried
// nothing — the operator's dark-LED day, one save away from repeating as soon
// as a controller lands past the boot list (`nextUniverse` is already 27).
//
// The fix is to re-diff the subscription on every recompute. The diff is pure
// so the semantics are unit-testable; `applyUniverseSubscriptions` owns the
// (tiny) imperative half and takes the receiver + loggers by injection so a
// fake Receiver can exercise the add path, including the interfaces where
// `addMembership` throws.

/** E1.31 universe range: 1–63999 (64000+ are reserved). */
const SACN_UNIVERSE_MIN = 1;
const SACN_UNIVERSE_MAX = 63999;

/**
 * Diff what the receiver currently accepts against everything the bridge must
 * be able to RECEIVE (the effective relay routes plus every active scene's
 * patched universes — a universe with no controller IP still has to reach the
 * browsers).
 *
 * @param {Object} args
 * @param {Iterable<number>} args.subscribed universes the receiver accepts now
 *        (pass `receiver.universes` — the package mutates that array in place).
 * @param {Array<{universe:*, source?:string}>} args.wanted desired universes
 *        with provenance for the log line; duplicates expected.
 * @returns {{additions: Array<{universe:number, sources:string[]}>,
 *            invalid:   Array<{universe:*, sources:string[]}>}}
 *   `additions` = not yet subscribed, ascending, each with the de-duplicated
 *   sources that asked for it. `invalid` = claims outside the E1.31 range,
 *   returned rather than dropped so the caller can shout (a fixture patched to
 *   universe 70000 is an authoring bug that must not vanish).
 */
function computeUniverseSubscriptionDiff({ subscribed, wanted }) {
  const have = new Set();
  for (const u of subscribed || []) {
    const uid = parseInt(u, 10);
    if (Number.isInteger(uid)) have.add(uid);
  }

  const addSources = new Map();   // universe → string[]
  const badSources = new Map();   // universe → string[]
  for (const w of wanted || []) {
    if (!w) continue;
    const uid = parseInt(w.universe, 10);
    if (!Number.isInteger(uid)) continue; // unpatched / absent: not a claim
    const bucket = (uid < SACN_UNIVERSE_MIN || uid > SACN_UNIVERSE_MAX) ? badSources
      : (have.has(uid) ? null : addSources);
    if (!bucket) continue;
    if (!bucket.has(uid)) bucket.set(uid, []);
    const src = w.source ? String(w.source) : '';
    if (src && !bucket.get(uid).includes(src)) bucket.get(uid).push(src);
  }

  const toList = (m) => [...m.entries()]
    .map(([universe, sources]) => ({ universe, sources }))
    .sort((a, b) => a.universe - b.universe);
  return { additions: toList(addSources), invalid: toList(badSources) };
}

/**
 * Apply a subscription diff to a live `sacn` Receiver.
 *
 * Per-universe error isolation, NOT a fallback: `socket.addMembership` throws
 * on some interfaces (no multicast route, iface down), and one bad universe
 * must not abort the rest of the subscription. Every failure is logged loudly
 * with its consequence spelled out. On failure the universe is still admitted
 * into the receiver's accept list — that is exactly what a BOOT-time universe
 * with a failing join does (the package catches the constructor-time throw and
 * leaves the universe in `universes`), and it keeps UNICAST sources (the
 * engine's loopback frames, the sim's own prio-150 writer) working. What is
 * lost is multicast reception on that universe, and the log says so.
 *
 * @param {Object} args
 * @param {{universes:number[], addUniverse:Function}} args.receiver
 * @param {Array<{universe:*, source?:string}>} args.wanted
 * @param {string} args.reason  what triggered the recompute, for the log line.
 * @param {(msg:string)=>void} args.onLog    successful subscriptions.
 * @param {(msg:string)=>void} args.onError  failures + invalid claims.
 * @returns {{added:number[], failed:Array<{universe:number, message:string}>,
 *            invalid:Array<{universe:number, sources:string[]}>}}
 */
function applyUniverseSubscriptions({ receiver, wanted, reason, onLog, onError }) {
  const { additions, invalid } = computeUniverseSubscriptionDiff({
    subscribed: receiver.universes,
    wanted,
  });

  for (const bad of invalid) {
    onError(`⚠ Refusing to subscribe to universe ${bad.universe} — outside the E1.31 range ` +
      `(${SACN_UNIVERSE_MIN}–${SACN_UNIVERSE_MAX}). Claimed by: ${bad.sources.join('; ') || 'unknown'}. ` +
      'Fix the patch — nothing will ever be received on it.');
  }

  const added = [];
  const failed = [];
  for (const add of additions) {
    const provenance = add.sources.length ? ` (${add.sources.join('; ')})` : '';
    try {
      receiver.addUniverse(add.universe);
      added.push(add.universe);
      onLog(`runtime-subscribed U${add.universe}${provenance} — ${reason}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failed.push({ universe: add.universe, message });
      if (!receiver.universes.includes(add.universe)) receiver.universes.push(add.universe);
      onError(`⚠ Multicast join FAILED for U${add.universe}${provenance}: ${message}. ` +
        'The universe is now accepted for UNICAST frames (same as a boot-time universe whose ' +
        'join failed), but MULTICAST sources on it will NOT be received on this interface.');
    }
  }
  return { added, failed, invalid };
}

// ── Route-table introspection (report 20260725_127) ─────────────────────────
//
// The per-output push's third check reads the bridge's ACTIVE route table back
// instead of trusting its own `setScene` notify. The bridge answers a
// `{type:'getRoutes'}` WS message with this snapshot, built from its LIVE
// sender maps — not from what a recompute intended, but from what exists. Pure
// so the wire shape is pinned by unit tests; the bridge passes its maps in.

/**
 * @param {Object} args
 * @param {*}    args.reqId        echoed verbatim so the client can correlate.
 * @param {Map}  args.routeEntries the bridge's live relay senders
 *                                 (routeKey → {universe, ip, sender…}).
 * @param {Map}  args.mirrorEntries live bench-mirror senders (same entry shape).
 * @param {Array<{universe:number, ip:string}>} args.excluded engine-owned pairs
 *        the bridge deliberately does NOT relay (last recompute's exclusions).
 * @param {Iterable<string>} args.activeScenes last recompute's active scenes.
 * @returns {{type:'routes', reqId:*, routes:Array, engineOwned:Array,
 *            mirrorOwned:Array, activeScenes:string[]}}
 */
function buildRouteTableSnapshot({ reqId, routeEntries, mirrorEntries, excluded, activeScenes }) {
  const byPair = (a, b) => (a.universe - b.universe) || a.ip.localeCompare(b.ip);
  const toPair = (e) => ({ universe: e.universe, ip: e.ip });
  return {
    type: 'routes',
    reqId: reqId === undefined ? null : reqId,
    routes: [...routeEntries.values()].map(toPair).sort(byPair),
    engineOwned: [...(excluded || [])].map(toPair).sort(byPair),
    mirrorOwned: [...mirrorEntries.values()].map(toPair).sort(byPair),
    activeScenes: [...(activeScenes || [])].map(String),
  };
}

module.exports = {
  buildRouteTableSnapshot,
  computeEffectiveRoutes,
  computeUniverseSubscriptionDiff,
  applyUniverseSubscriptions,
  engineOwnedPairs,
  routeKey,
  classifyRouteIp,
  partitionRoutePairs,
  patchRecordUniverses,
  readPatchDeclarations,
  parseSubscribedUniversesField,
  MAX_INTERPOLATED_STRAND_SPAN,
  PLACEHOLDER_SENTINEL_IP,
  ROUTE_IP_OK,
  ROUTE_IP_SENTINEL,
  ROUTE_IP_MISSING,
  ROUTE_IP_BROADCAST,
  ROUTE_IP_LOOPBACK,
  SACN_UNIVERSE_MIN,
  SACN_UNIVERSE_MAX,
};
