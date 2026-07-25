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
 * DUAL-SEND (opt-in). A controller may set `alsoFlat: true` (default false).
 * Normally a universe claimed by a controller stops reaching the flat
 * `sacn.destinations`, so the sim bridge (127.0.0.1) would go dark for that
 * universe. With `alsoFlat: true` the controller's universes are streamed to
 * the controller's transport AND continue to the flat destinations, keeping
 * the sim in parity with the hardware. This is an explicit per-controller
 * opt-in, never automatic.
 *
 * FAIL LOUD (codex P0). A DECLARED controller with an unset or unrecognized
 * protocol THROWS — never a silent drop. A declared controller with no host
 * THROWS. Two controllers claiming the same universe THROWS (ambiguous
 * routing). A non-boolean `alsoFlat` THROWS. Nothing here invents a default
 * for declared-but-broken state.
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
    // alsoFlat (opt-in dual-send): when true, this controller's universes are
    // ALSO streamed to the flat `sacn.destinations` (sim parity). Default
    // false. Only its mistype is rejected — other unknown keys stay ignored
    // to preserve existing configs (codex P0: fail loud on the typed field).
    const alsoFlatRaw = raw.alsoFlat;
    if (alsoFlatRaw !== undefined && typeof alsoFlatRaw !== 'boolean') {
      throw new Error(`[Output] controller '${name}': alsoFlat must be a boolean ` +
        `(got ${JSON.stringify(alsoFlatRaw)})`);
    }
    const alsoFlat = alsoFlatRaw === true;
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
      byUniverse.set(uid, { host, protocol, name, alsoFlat });
      normUniverses.push(uid);
    }
    normalized.push({ name, host, protocol, alsoFlat, universes: normUniverses });
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
  // A declared universe whose controller set `alsoFlat: true` ALSO joins the
  // flat destinations (dual-send parity) — it is owned by two senders.
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
    if (decl.alsoFlat) {
      sacnDefaultUniverses.push(uid); // dual-send: also to flat destinations
    }
    const bucket = decl.protocol === PROTOCOL_ARTNET ? artnetByHost : sacnUnicastByHost;
    if (!bucket.has(decl.host)) bucket.set(decl.host, []);
    bucket.get(decl.host).push(uid);
  }

  // Each sender is tagged with the transport that owns it so a universe that
  // appears AFTER boot (hot-reload / re-patch) can be routed to the right
  // sender — or a new one created — instead of being dropped. `host === null`
  // marks the single flat-destinations sACN default sender; per-controller
  // senders match on host + protocol.
  const senders = []; // { out, universes:Set, host, protocol }
  let _started = false;

  // Default flat-destinations sACN sender (covers every undeclared universe).
  if (sacnDefaultUniverses.length > 0) {
    const out = createSacnOutput({
      universes: sacnDefaultUniverses, priority, sourceName, destinations,
    });
    senders.push({ out, universes: new Set(sacnDefaultUniverses), host: null, protocol: PROTOCOL_SACN });
  }
  // Per-controller sACN unicast senders.
  for (const [host, uids] of sacnUnicastByHost) {
    const out = createSacnOutput({
      universes: uids, priority, sourceName, destinations: [host],
    });
    senders.push({ out, universes: new Set(uids), host, protocol: PROTOCOL_SACN });
  }
  // Per-controller Art-Net senders.
  for (const [host, uids] of artnetByHost) {
    const out = createArtnetOutput({ universes: uids, destinations: [host], port: artnetPort });
    senders.push({ out, universes: new Set(uids), host, protocol: PROTOCOL_ARTNET });
  }

  // Find the sender for a given transport target. Flat default = host null.
  function findSender(host, protocol) {
    return senders.find(s => s.host === host && s.protocol === protocol);
  }

  // Get (creating if absent) the flat-destinations sACN default sender.
  function ensureFlatSender() {
    let flat = findSender(null, PROTOCOL_SACN);
    if (flat) return flat;
    const out = createSacnOutput({ universes: [], priority, sourceName, destinations });
    if (_started) out.start();
    flat = { out, universes: new Set(), host: null, protocol: PROTOCOL_SACN };
    senders.push(flat);
    return flat;
  }

  // Get (creating if absent) the sender for a declared controller's transport.
  // This is what makes a controller declared in config.yaml but not patched at
  // boot come alive when its universe is patched later — no restart needed.
  function ensureControllerSender(host, protocol) {
    let sender = findSender(host, protocol);
    if (sender) return sender;
    const out = protocol === PROTOCOL_ARTNET
      ? createArtnetOutput({ universes: [], destinations: [host], port: artnetPort })
      : createSacnOutput({ universes: [], priority, sourceName, destinations: [host] });
    if (_started) out.start();
    sender = { out, universes: new Set(), host, protocol };
    senders.push(sender);
    return sender;
  }

  // Route universe `id` to `sender` (idempotent). `isFlat` keeps the
  // introspection array (`_routing.flatUniverses`) in step with the flat sender.
  function routeInto(sender, id, isFlat) {
    if (sender.universes.has(id)) return;
    sender.out.addUniverse(id);
    sender.universes.add(id);
    if (isFlat && !sacnDefaultUniverses.includes(id)) sacnDefaultUniverses.push(id);
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

  // Add a universe to the output at runtime (hot-reload / re-patch). The
  // universe may be brand-new to this dispatch — including one whose controller
  // was declared in config.yaml but had NO universe patched at boot, so its
  // sender was never built. Such a universe MUST still reach its controller
  // without an engine restart (codex P0: no dark hardware after a live patch).
  function addUniverse(uid) {
    const id = parseInt(uid, 10);
    const decl = byUniverse.get(id);
    if (!decl) {
      // Undeclared → flat-destinations sACN default (legacy contract).
      routeInto(ensureFlatSender(), id, true);
      return;
    }
    // Declared → its controller's transport. Reuse the controller's existing
    // sender when it already had a boot-time universe; otherwise create it now
    // (the declared-but-unpatched-at-boot case — the playa re-patch fix).
    routeInto(ensureControllerSender(decl.host, decl.protocol), id, false);
    // alsoFlat dual-send: the universe ALSO joins the flat destinations so the
    // sim bridge stays in parity with the hardware.
    if (decl.alsoFlat) routeInto(ensureFlatSender(), id, true);
  }

  function start() {
    _started = true;
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
    // Exposed for tests/introspection. `flatUniverses` is every universe the
    // flat-destinations sACN sender carries — undeclared universes plus any
    // declared universe whose controller opted into `alsoFlat` (dual-send).
    // Getters, not snapshots: `addUniverse` can add senders and grow the flat
    // set at runtime, and introspection must reflect the live state.
    _routing: {
      byUniverse, routes,
      get senderCount() { return senders.length; },
      get flatUniverses() { return [...sacnDefaultUniverses]; },
    },
  };
}
