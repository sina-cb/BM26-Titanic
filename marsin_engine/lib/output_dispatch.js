/**
 * output_dispatch.js — per-controller output routing for MarsinEngine.
 *
 * The engine renders one DMX buffer per universe; each universe must reach
 * its controller over that controller's chosen transport — sACN/E1.31 or
 * Art-Net (operator decision 2026-06-19: transport tops out here, no DDP /
 * WLED-native). This module composes the two transport senders
 * (sacn_output.js, artnet_output.js) behind ONE interface identical to a
 * single sACN sender (start / stop / sendFrame / addUniverse / frameCount)
 * so engine.js stays unchanged at the call site.
 *
 * ROUTING. A controller is declared as { host, protocol, universes:[…] }.
 * Each declared universe is routed to its controller's transport. Universes
 * with NO controller declaration keep the legacy behavior: sACN to the flat
 * `sacn.destinations` list (the long-standing engine contract — explicit
 * documented default, not an error-hiding fallback). This lets Art-Net be
 * adopted controller-by-controller without forcing every rig to enumerate
 * its sACN controllers.
 *
 * FAIL LOUD (codex P0). A DECLARED controller with an unset or unrecognized
 * protocol THROWS — never a silent drop. A declared controller with no host
 * THROWS. Two controllers claiming the same universe THROWS (ambiguous
 * routing). Nothing here invents a default for declared-but-broken state.
 */

import { createSacnOutput } from './sacn_output.js';
import { createArtnetOutput, ARTNET_PORT } from './artnet_output.js';

export const PROTOCOL_SACN = 'sACN';
export const PROTOCOL_ARTNET = 'artnet';
const VALID_PROTOCOLS = [PROTOCOL_SACN, PROTOCOL_ARTNET];

/**
 * Validate + normalize the per-controller routing declarations.
 * @param {Array<Object>} controllers - [{ host, protocol, universes:[…] }]
 * @returns {{ byUniverse: Map<number,{host,protocol}>, controllers: Array }}
 */
export function normalizeControllerRouting(controllers) {
  const byUniverse = new Map();
  const normalized = [];
  if (controllers === undefined || controllers === null) {
    return { byUniverse, controllers: normalized };
  }
  if (!Array.isArray(controllers)) {
    throw new Error('[Output] config `controllers` must be a list');
  }
  for (const raw of controllers) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`[Output] invalid controller routing entry: ${JSON.stringify(raw)}`);
    }
    const name = typeof raw.name === 'string' ? raw.name : (raw.host || '?');
    const protocol = raw.protocol;
    if (protocol === undefined || protocol === null) {
      throw new Error(`[Output] controller '${name}' has no protocol — must be one of ` +
        `${VALID_PROTOCOLS.join(', ')} (codex P0: no silent default for a declared controller)`);
    }
    if (!VALID_PROTOCOLS.includes(protocol)) {
      throw new Error(`[Output] controller '${name}' has invalid protocol '${protocol}' — ` +
        `must be one of ${VALID_PROTOCOLS.join(', ')}`);
    }
    const host = typeof raw.host === 'string' ? raw.host.trim() : '';
    if (host.length === 0) {
      throw new Error(`[Output] controller '${name}' (${protocol}) has no host — cannot route`);
    }
    const universes = Array.isArray(raw.universes) ? raw.universes : [];
    const normUniverses = [];
    for (const u of universes) {
      const uid = parseInt(u, 10);
      if (!Number.isInteger(uid) || uid < 1) {
        throw new Error(`[Output] controller '${name}': universe ${u} must be a positive integer`);
      }
      if (byUniverse.has(uid)) {
        const other = byUniverse.get(uid);
        throw new Error(`[Output] universe ${uid} is claimed by two controllers ` +
          `('${other.name}' and '${name}') — routing is ambiguous`);
      }
      byUniverse.set(uid, { host, protocol, name });
      normUniverses.push(uid);
    }
    normalized.push({ name, host, protocol, universes: normUniverses });
  }
  return { byUniverse, controllers: normalized };
}

/**
 * Build the composite output sender.
 *
 * @param {Object} opts
 * @param {number[]} opts.universes        - all universe IDs the engine sends
 * @param {Array<Object>} [opts.controllers] - per-controller routing decls
 * @param {string[]} [opts.destinations]   - flat sACN destinations (legacy/default)
 * @param {number} [opts.priority=100]
 * @param {string} [opts.sourceName='MarsinEngine']
 * @param {number} [opts.artnetPort=6454]
 * @returns {OutputDispatch}
 */
export function createOutputDispatch({
  universes,
  controllers,
  destinations = ['127.0.0.1'],
  priority = 100,
  sourceName = 'MarsinEngine',
  artnetPort = ARTNET_PORT,
} = {}) {
  const allUniverses = (universes || []).map(u => parseInt(u, 10));
  const { byUniverse, controllers: routes } = normalizeControllerRouting(controllers);

  // Partition universes by transport. A universe with no declaration is
  // routed to the flat sACN destinations (legacy default). Declared
  // universes route to their controller's host over the chosen transport.
  const sacnDefaultUniverses = []; // → flat destinations
  // host → universe[] for each Art-Net and per-controller-sACN target.
  const artnetByHost = new Map();
  const sacnUnicastByHost = new Map();

  for (const uid of allUniverses) {
    const decl = byUniverse.get(uid);
    if (!decl) {
      sacnDefaultUniverses.push(uid);
      continue;
    }
    const bucket = decl.protocol === PROTOCOL_ARTNET ? artnetByHost : sacnUnicastByHost;
    if (!bucket.has(decl.host)) bucket.set(decl.host, []);
    bucket.get(decl.host).push(uid);
  }

  const senders = []; // { send: fn(buffers), start, stop, universes:Set }

  // Default flat-destinations sACN sender (covers every undeclared universe).
  if (sacnDefaultUniverses.length > 0) {
    const out = createSacnOutput({
      universes: sacnDefaultUniverses, priority, sourceName, destinations,
    });
    senders.push({ out, universes: new Set(sacnDefaultUniverses) });
  }
  // Per-controller sACN unicast senders.
  for (const [host, uids] of sacnUnicastByHost) {
    const out = createSacnOutput({
      universes: uids, priority, sourceName, destinations: [host],
    });
    senders.push({ out, universes: new Set(uids) });
  }
  // Per-controller Art-Net senders.
  for (const [host, uids] of artnetByHost) {
    const out = createArtnetOutput({ universes: uids, destinations: [host], port: artnetPort });
    senders.push({ out, universes: new Set(uids) });
  }

  let _frameCount = 0;

  /** Route each universe's buffer to whichever sender owns it. */
  async function sendFrame(buffers) {
    const promises = [];
    for (const s of senders) {
      const slice = {};
      let any = false;
      for (const [uidStr, data] of Object.entries(buffers)) {
        if (s.universes.has(parseInt(uidStr, 10))) {
          slice[uidStr] = data;
          any = true;
        }
      }
      if (any) promises.push(s.out.sendFrame(slice));
    }
    await Promise.all(promises);
    _frameCount++;
  }

  function addUniverse(uid) {
    const id = parseInt(uid, 10);
    const decl = byUniverse.get(id);
    // A newly-appearing universe with no declaration joins the default sACN
    // sender (creating it if the rig had none). Declared universes are
    // already owned by their sender at construction.
    if (decl) {
      for (const s of senders) {
        if (s.universes.has(id)) return;
      }
      return; // declared but its sender was pruned (no universes) — nothing to do
    }
    for (const s of senders) {
      if (s.universes.has(id)) return;
    }
    const out = createSacnOutput({ universes: [id], priority, sourceName, destinations });
    out.start();
    senders.push({ out, universes: new Set([id]) });
  }

  function start() {
    _frameCount = 0;
    for (const s of senders) s.out.start();
    const sacnCount = sacnDefaultUniverses.length +
      [...sacnUnicastByHost.values()].reduce((n, u) => n + u.length, 0);
    const artnetCount = [...artnetByHost.values()].reduce((n, u) => n + u.length, 0);
    console.log(`[Output] Dispatch started — ${sacnCount} sACN + ${artnetCount} Art-Net universe(s) ` +
      `across ${senders.length} sender(s)`);
  }

  function stop() {
    for (const s of senders) {
      try { s.out.stop(); } catch (_) { /* ignore */ }
    }
  }

  return {
    start, stop, sendFrame, addUniverse,
    get frameCount() { return _frameCount; },
    // Exposed for tests/introspection.
    _routing: { byUniverse, routes, senderCount: senders.length },
  };
}
