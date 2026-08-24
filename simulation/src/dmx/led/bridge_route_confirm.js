/**
 * bridge_route_confirm.js — The per-output push's THIRD check, made a real
 * measurement (report 20260725_127).
 *
 * The push's status line used to end on "✓ bridge notified — routes follow":
 * the notify was measured (the WS send resolved), but NOTHING confirmed the
 * bridge actually rebuilt its relay routes from the just-saved patches.yaml.
 * That is the one link in the chain the operator had to take on faith — the
 * device write is read back from the device, the save is a disk write the
 * server answers for, but the routes were a promise.
 *
 * This module closes it with the same read-back discipline the device write
 * uses: AFTER the notify, the bridge's ACTIVE route table is read back over
 * the same WebSocket the notify travelled (`{type:'getRoutes'}` →
 * `{type:'routes', …}`, answered by sacn_bridge.js from its live sender maps),
 * and the third check renders ✓ only when every (universe → controller IP)
 * pair this push must produce is actually present. Same-socket FIFO means a
 * query sent after the notify is
 * answered from the post-recompute table, so the bounded poll here is only
 * grace for a bridge mid-boot, never a "probably fine" fallback: on timeout or
 * mismatch the check FAILS, naming exactly which routes are missing or extra.
 *
 * Route-ownership semantics (memory/sacn-route-ownership, reports 20260724_15
 * and 20260725_102):
 *   - a pair in the bridge's RELAY table         → confirmed (the bridge feeds it);
 *   - a pair in the ENGINE-OWNED exclusions      → confirmed as [engine-direct]
 *     (the engine delivers that universe to that host ITSELF; the bridge
 *     suppressing its relay IS the one-writer rule working);
 *   - a pair the BENCH MIRROR owns               → a one-writer CONFLICT: the
 *     mirror composes different content for that destination, so this push's
 *     patch does NOT reach the controller — a named error, never a ✓.
 *
 * Everything here is pure or takes its I/O by injection (`readRoutes`,
 * `sleep`), so the unit tests cover the expectation builder, the assessment
 * and the exact operator-facing sentences without a bridge or a browser.
 */

import { projectLedStrandSegments } from './led_patch_projection.js';

/** Bounded read-back: 5 reads ≈ 1.6 s worst case — "a few seconds max". */
export const ROUTE_CONFIRM_ATTEMPTS = 5;
export const ROUTE_CONFIRM_DELAY_MS = 400;

/** Canonical key for a (universe → ip) pair — same shape lib/bridge_routing.cjs uses. */
function routePairKey(universe, ip) {
  return `${universe}→${ip}`;
}

/**
 * Compress a pair list into per-IP groups for the ONE-LINE status budget:
 * `[{universe:30,ip:a},{universe:31,ip:a}]` → `['U30,U31→a']`.
 */
function groupPairs(pairs) {
  const byIp = new Map();
  for (const pair of pairs) {
    if (!byIp.has(pair.ip)) byIp.set(pair.ip, new Set());
    byIp.get(pair.ip).add(pair.universe);
  }
  return [...byIp.entries()].map(([ip, universes]) =>
    `U${[...universes].sort((a, b) => a - b).join(',U')}→${ip}`);
}

/**
 * Derive the route claims a per-output push makes on the bridge, from the SAME
 * plan the device was written with (`derivePerOutputPlan` result).
 *
 * `expected` = every universe an enabled output's strand walk OCCUPIES — the
 * spill segments past channel 512 included, via the same single-source walker
 * (`projectLedStrandSegments`) the patches projection uses, so the expectation
 * is byte-identical to what the save projected into patches.yaml. Under force
 * semantics every ASSIGNED output is an output the push enables, so
 * `plan.assignments` is the whole claim list — an output the push DISABLES
 * makes no route claim at all.
 *
 * PURE, throws on a plan it cannot read — a push whose expectation cannot even
 * be stated must refuse before the device write, not render a blind ✓ after.
 *
 * @param {Object} args
 * @param {Object} args.plan   derivePerOutputPlan result.
 * @param {string} args.ip     this controller's device IP (route destination).
 * @param {number} args.stride bytes per pixel (the card's led.stride).
 * @returns {{ip: string, controllerName: string, expected: number[]}}
 */
export function buildRouteExpectation({ plan, ip, stride }) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.assignments)) {
    throw new Error('[RouteConfirm] buildRouteExpectation: a derivePerOutputPlan result with ' +
      'assignments[] is required');
  }
  const targetIp = typeof ip === 'string' ? ip.trim() : '';
  if (!targetIp) {
    throw new Error('[RouteConfirm] buildRouteExpectation: the controller IP is required — ' +
      'bridge routes are (universe → ip) pairs');
  }
  const strideN = parseInt(stride, 10);
  if (!Number.isInteger(strideN) || strideN < 1) {
    throw new Error(`[RouteConfirm] buildRouteExpectation: stride must be a positive integer ` +
      `(got ${stride})`);
  }

  const expected = new Set();
  const claims = plan.assignments.map((a) => ({ ...a, kind: 'assignment' }));
  for (const claim of claims) {
    if (!Number.isInteger(claim.universe) || claim.universe < 1) {
      throw new Error(`[RouteConfirm] the plan's ${claim.kind} for output index ` +
        `${claim.outputIndex} carries no valid universe (got ${claim.universe})`);
    }
    if (Number.isInteger(claim.pixelCount) && claim.pixelCount > 0) {
      const walk = projectLedStrandSegments(claim.universe, 1, strideN, claim.pixelCount);
      if (walk.overflow) {
        throw new Error(`[RouteConfirm] output index ${claim.outputIndex} spills past the sACN ` +
          'universe ceiling — this plan should have been refused before the push');
      }
      for (const seg of walk.segments) expected.add(seg.universe);
    } else {
      expected.add(claim.universe);
    }
  }

  // The empty-expectation refusal stays: a push that cannot even STATE what it
  // expects must refuse before the device write, not render a blind ✓ after.
  // `no_enabled_output` upstream makes a truly empty push impossible anyway.
  if (expected.size === 0) {
    throw new Error(`[RouteConfirm] the plan for '${plan.controllerName || targetIp}' expects ` +
      'no routes — there is nothing to confirm');
  }
  return {
    ip: targetIp,
    controllerName: plan.controllerName || targetIp,
    expected: [...expected].sort((a, b) => a - b),
  };
}

/**
 * Validate + normalize a bridge `{type:'routes'}` reply. Throws on anything
 * malformed — a reply this code cannot read must never pass as "no routes".
 *
 * @returns {{routes: Array<{universe:number, ip:string}>,
 *            engineOwned: Array<{universe:number, ip:string}>,
 *            mirrorOwned: Array<{universe:number, ip:string}>,
 *            activeScenes: string[]}}
 */
export function normalizeRouteSnapshot(reply) {
  if (!reply || typeof reply !== 'object') {
    throw new Error('the bridge route reply is not an object');
  }
  const out = {};
  for (const field of ['routes', 'engineOwned', 'mirrorOwned']) {
    const raw = reply[field];
    if (!Array.isArray(raw)) {
      throw new Error(`the bridge route reply has no ${field}[] — is the sACN bridge running ` +
        'current code? Restart the launcher.');
    }
    out[field] = raw.map((entry, i) => {
      const universe = parseInt(entry && entry.universe, 10);
      const pairIp = entry && typeof entry.ip === 'string' ? entry.ip : '';
      if (!Number.isInteger(universe) || universe < 1 || pairIp === '') {
        throw new Error(`the bridge route reply's ${field}[${i}] is malformed ` +
          `(universe=${entry && entry.universe}, ip=${entry && entry.ip})`);
      }
      return { universe, ip: pairIp };
    });
  }
  out.activeScenes = Array.isArray(reply.activeScenes) ? reply.activeScenes.map(String) : [];
  return out;
}

/**
 * Measure one route-table snapshot against the push's expectations. Pure.
 *
 * @param {Object} args
 * @param {Array} args.expectations buildRouteExpectation results (≥1).
 * @param {Object} args.snapshot    normalizeRouteSnapshot result.
 * @returns {{ok: boolean,
 *            confirmed: Array<{universe:number, ip:string, via:('relay'|'engine')}>,
 *            missing: Array<{universe:number, ip:string}>,
 *            mirrorConflicts: Array<{universe:number, ip:string}>}}
 */
export function assessRouteReadback({ expectations, snapshot }) {
  if (!Array.isArray(expectations) || expectations.length === 0) {
    throw new Error('[RouteConfirm] assessRouteReadback: at least one expectation is required');
  }
  const relay = new Set(snapshot.routes.map((r) => routePairKey(r.universe, r.ip)));
  const engine = new Set(snapshot.engineOwned.map((r) => routePairKey(r.universe, r.ip)));
  const mirror = new Set(snapshot.mirrorOwned.map((r) => routePairKey(r.universe, r.ip)));

  const confirmed = [];
  const missing = [];
  const mirrorConflicts = [];
  for (const exp of expectations) {
    for (const universe of exp.expected) {
      const key = routePairKey(universe, exp.ip);
      if (mirror.has(key)) {
        // Another writer composes this destination — the push's patch content
        // is NOT what the controller receives. One-writer conflict, not a ✓.
        mirrorConflicts.push({ universe, ip: exp.ip });
      } else if (relay.has(key)) {
        confirmed.push({ universe, ip: exp.ip, via: 'relay' });
      } else if (engine.has(key)) {
        confirmed.push({ universe, ip: exp.ip, via: 'engine' });
      } else {
        missing.push({ universe, ip: exp.ip });
      }
    }
  }
  return {
    ok: missing.length === 0 && mirrorConflicts.length === 0,
    confirmed,
    missing,
    mirrorConflicts,
  };
}

/**
 * The ✓ line's parenthetical: `U30,U31→10.1.1.60`, engine-delivered pairs
 * tagged `[engine-direct]`. One line — the operator's UI budget.
 */
export function describeConfirmedRoutes(assessment) {
  const parts = groupPairs(assessment.confirmed.filter((c) => c.via === 'relay'));
  for (const group of groupPairs(assessment.confirmed.filter((c) => c.via === 'engine'))) {
    parts.push(`${group} [engine-direct]`);
  }
  if (parts.length === 0) {
    throw new Error('[RouteConfirm] describeConfirmedRoutes: nothing was confirmed — an ' +
      'expectation always names at least one routed universe, so this is a bug, not a ✓');
  }
  return parts.join(', ');
}

/**
 * The ✋ line: exactly which expected routes are missing, and which pairs
 * another writer owns.
 */
export function describeRouteMismatch(assessment, snapshot, reads) {
  const parts = [];
  if (assessment.missing.length > 0) {
    parts.push(`missing ${groupPairs(assessment.missing).join(', ')}`);
  }
  if (assessment.mirrorConflicts.length > 0) {
    parts.push(`${groupPairs(assessment.mirrorConflicts).join(', ')} owned by the bench mirror ` +
      '(another writer)');
  }
  return `${parts.join('; ')} — bridge relays ${snapshot.routes.length} route(s) after ` +
    `${reads} read(s); check the sACN bridge log`;
}

/**
 * Read the bridge's active route table back until it shows the expected
 * routes, bounded. Never throws for a measurement outcome — resolves
 * `{ok:true, detail}` or `{ok:false, reason}` so the caller renders exactly
 * one of the two; only misuse (no expectations, no reader) throws.
 *
 * A FAILING read (WS down, query timeout, malformed reply) fails the check
 * IMMEDIATELY — retrying a broken transport would just stack 2 s timeouts,
 * and "could not read" must never soften into "probably fine".
 *
 * @param {Object} args
 * @param {Array}    args.expectations buildRouteExpectation results (≥1).
 * @param {Function} args.readRoutes   () => Promise<bridge routes reply>.
 * @param {number}   [args.attempts]
 * @param {number}   [args.delayMs]
 * @param {Function} [args.sleep]      injectable for tests.
 * @returns {Promise<{ok:true, detail:string}|{ok:false, reason:string}>}
 */
export async function confirmBridgeRoutes({
  expectations,
  readRoutes,
  attempts = ROUTE_CONFIRM_ATTEMPTS,
  delayMs = ROUTE_CONFIRM_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!Array.isArray(expectations) || expectations.length === 0) {
    throw new Error('[RouteConfirm] confirmBridgeRoutes: at least one route expectation is ' +
      'required — confirming nothing would be an unmeasured ✓');
  }
  if (typeof readRoutes !== 'function') {
    throw new Error('[RouteConfirm] confirmBridgeRoutes: readRoutes() is required');
  }

  let lastAssessment = null;
  let lastSnapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(delayMs);
    let snapshot;
    try {
      snapshot = normalizeRouteSnapshot(await readRoutes());
    } catch (err) {
      return { ok: false, reason: `route table read-back failed: ${err.message}` };
    }
    const assessment = assessRouteReadback({ expectations, snapshot });
    if (assessment.ok) {
      return { ok: true, detail: describeConfirmedRoutes(assessment) };
    }
    lastAssessment = assessment;
    lastSnapshot = snapshot;
  }
  return { ok: false, reason: describeRouteMismatch(lastAssessment, lastSnapshot, attempts) };
}
