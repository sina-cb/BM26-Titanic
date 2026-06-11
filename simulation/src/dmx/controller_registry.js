/**
 * controller_registry.js — scene-owned controller mapping registry.
 *
 * The simulation is the source of truth for the physical control
 * hardware topology (docs/33): controllers (IP + stable id) → ports
 * (universe + startAddress) → chains (daisy-chain fixture order). The
 * registry lives in the scene's `controllers.yaml`, rides the config
 * tree through save/load, and PROJECTS every fixture's patch fields
 * (`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) plus
 * metadata (`sectionId`, `fixtureId`) — replacing both hand-typed patch
 * fields and the auto-patcher.
 *
 * Shape (mirrors controllers.yaml):
 *   {
 *     nextControllerId: <int>,            // monotonic — ids never reused
 *     controllers: [
 *       { id, name, ip, ports: [
 *           { port, universe, startAddress, chain: [
 *               '<fixture name>'           // packed entry
 *               | { gap: <channels> }      // packed spacer
 *               | { fixture, at }          // pinned entry (effects, U1)
 *           ] },
 *       ] },
 *     ],
 *   }
 *
 * The projection contract (docs/33 "Projection under invalid state"):
 * a fixture whose derived address cannot be proven valid projects to
 * the unpatched state (''/0/0) with a loud violation — patches.yaml can
 * never contain an out-of-range or conflicting address. Valid fixtures
 * around a violation keep their addresses (loud-but-recoverable).
 */

import { getFootprint, isGlobalEffect } from './auto_patcher.js';

// ── Constants ───────────────────────────────────────────────────────────

export const DMX_UNIVERSE_SIZE = 512;   // full budget, channels 1–512 (docs/33 decision 1)
export const EFFECTS_UNIVERSE = 1;      // reserved for global effects (docs/33 decision 2)
export const DEFAULT_PORT_COUNT = 4;

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIp(ip) {
  const m = IP_RE.exec(String(ip || ''));
  if (!m) return false;
  return m.slice(1).every(octet => Number(octet) <= 255);
}

// ── Chain entry helpers ─────────────────────────────────────────────────

export function isGapEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.gap === 'number';
}

export function isPinnedEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.fixture === 'string';
}

/** Fixture name of a chain entry, or null for gaps. */
export function entryFixtureName(entry) {
  if (typeof entry === 'string') return entry;
  if (isPinnedEntry(entry)) return entry.fixture;
  return null;
}

// ── Registry creation / schema validation ──────────────────────────────

/**
 * Normalize a parsed controllers.yaml tree (or undefined) into a
 * registry. THROWS on structural invalidity (bad ids, malformed ports,
 * invalid gaps/startAddress, a fixture in two chains): a structurally
 * broken file must hard-stop the boot — continuing would let the next
 * auto-save rewrite controllers.yaml from garbage (codex P0). A missing
 * tree (no mapping yet) is the legitimate empty case. OPERATIONAL
 * problems (overflow, overlap, orphans, bad IPs, pin mismatches) are
 * NOT thrown here — they are violations from computeProjection() so
 * work-in-progress always loads and renders, loudly flagged.
 */
export function createControllerRegistry(tree) {
  const src = (tree && typeof tree === 'object') ? tree : {};
  const registry = { nextControllerId: 1, controllers: [] };

  const rawControllers = src.controllers;
  if (rawControllers !== undefined && !Array.isArray(rawControllers)) {
    throw new Error('[Controllers] controllers.yaml: `controllers` must be a list');
  }

  const seenIds = new Set();
  const seenFixtures = new Map(); // name -> 'controller/port' for duplicate reporting

  for (const rawCtl of rawControllers || []) {
    if (!rawCtl || typeof rawCtl !== 'object') {
      throw new Error(`[Controllers] Invalid controller entry: ${JSON.stringify(rawCtl)}`);
    }
    const id = rawCtl.id;
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`[Controllers] Controller '${rawCtl.name || '?'}' has invalid id ${id} — ` +
        'must be a positive integer');
    }
    if (seenIds.has(id)) {
      throw new Error(`[Controllers] Duplicate controller id ${id} in controllers.yaml`);
    }
    seenIds.add(id);

    const controller = {
      id,
      name: typeof rawCtl.name === 'string' ? rawCtl.name : `Controller ${id}`,
      ip: typeof rawCtl.ip === 'string' ? rawCtl.ip : '',
      ports: [],
    };

    if (rawCtl.ports !== undefined && !Array.isArray(rawCtl.ports)) {
      throw new Error(`[Controllers] Controller '${controller.name}': ports must be a list`);
    }
    const seenPortNums = new Set();
    for (const rawPort of rawCtl.ports || []) {
      if (!rawPort || typeof rawPort !== 'object') {
        throw new Error(`[Controllers] Controller '${controller.name}': invalid port entry`);
      }
      const portNum = rawPort.port;
      if (!Number.isInteger(portNum) || portNum < 1) {
        throw new Error(`[Controllers] Controller '${controller.name}': port number ${portNum} ` +
          'must be a positive integer');
      }
      if (seenPortNums.has(portNum)) {
        throw new Error(`[Controllers] Controller '${controller.name}': duplicate port ${portNum}`);
      }
      seenPortNums.add(portNum);

      const universe = rawPort.universe;
      if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          `universe ${universe} must be an integer in 1–63999`);
      }
      const startAddress = rawPort.startAddress === undefined ? 1 : rawPort.startAddress;
      if (!Number.isInteger(startAddress) || startAddress < 1 || startAddress > DMX_UNIVERSE_SIZE) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          `startAddress ${startAddress} must be in 1–${DMX_UNIVERSE_SIZE}`);
      }

      const port = { port: portNum, universe, startAddress, chain: [] };
      if (rawPort.chain !== undefined && !Array.isArray(rawPort.chain)) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          'chain must be a list');
      }
      for (const entry of rawPort.chain || []) {
        if (typeof entry === 'string') {
          if (entry.length === 0) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              'empty fixture name in chain');
          }
        } else if (isGapEntry(entry)) {
          if (!Number.isInteger(entry.gap) || entry.gap < 1) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `gap width ${entry.gap} must be an integer ≥ 1`);
          }
        } else if (isPinnedEntry(entry)) {
          if (!Number.isInteger(entry.at) || entry.at < 1 || entry.at > DMX_UNIVERSE_SIZE) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `pinned entry '${entry.fixture}' address ${entry.at} must be in 1–${DMX_UNIVERSE_SIZE}`);
          }
        } else {
          throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
            `unrecognized chain entry ${JSON.stringify(entry)}`);
        }
        const name = entryFixtureName(entry);
        if (name !== null) {
          const where = `${controller.name} port ${portNum}`;
          if (seenFixtures.has(name)) {
            throw new Error(`[Controllers] Fixture '${name}' appears in two chains ` +
              `(${seenFixtures.get(name)} and ${where}) — a fixture may be mapped at most once`);
          }
          seenFixtures.set(name, where);
        }
        port.chain.push(entry);
      }
      controller.ports.push(port);
    }
    registry.controllers.push(controller);
  }

  const maxId = registry.controllers.reduce((m, c) => Math.max(m, c.id), 0);
  const rawNext = src.nextControllerId;
  registry.nextControllerId = Number.isInteger(rawNext) && rawNext > maxId ? rawNext : maxId + 1;

  return registry;
}

/** True when a mapping exists — the mapper owns ALL patch fields then. */
export function registryIsActive(registry) {
  return !!registry && Array.isArray(registry.controllers) && registry.controllers.length > 0;
}

// ── Queries ─────────────────────────────────────────────────────────────

/** Map of fixture name → { controller, port } across the whole registry. */
export function mappedFixtures(registry) {
  const out = new Map();
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (const entry of port.chain) {
        const name = entryFixtureName(entry);
        if (name !== null) out.set(name, { controller, port });
      }
    }
  }
  return out;
}

/** Sorted unique universes carried by any port (the derived sACN listen list). */
export function derivedUniverses(registry) {
  const set = new Set();
  for (const controller of registry.controllers) {
    for (const port of controller.ports) set.add(port.universe);
  }
  return [...set].sort((a, b) => a - b);
}

/** Lowest universe ≥ 2 not carried by any port (U1 is effects-only). */
export function nextFreeUniverse(registry) {
  const used = new Set(derivedUniverses(registry));
  let u = 2;
  while (used.has(u)) u++;
  return u;
}

// ── Mutations (panel operations) ────────────────────────────────────────

export function addController(registry, { name, ip }) {
  const controller = {
    id: registry.nextControllerId,
    name: String(name || `Controller ${registry.nextControllerId}`),
    ip: String(ip || ''),
    ports: [],
  };
  registry.nextControllerId += 1;
  registry.controllers.push(controller);
  for (let i = 0; i < DEFAULT_PORT_COUNT; i++) addPort(registry, controller);
  return controller;
}

export function addPort(registry, controller) {
  const portNum = controller.ports.reduce((m, p) => Math.max(m, p.port), 0) + 1;
  const port = { port: portNum, universe: nextFreeUniverse(registry), startAddress: 1, chain: [] };
  controller.ports.push(port);
  return port;
}

/** Remove a controller; returns the fixture names that became unmapped. */
export function removeController(registry, controller) {
  const freed = [];
  for (const port of controller.ports) {
    for (const entry of port.chain) {
      const name = entryFixtureName(entry);
      if (name !== null) freed.push(name);
    }
  }
  const i = registry.controllers.indexOf(controller);
  if (i >= 0) registry.controllers.splice(i, 1);
  return freed;
}

/** Remove a port; returns the fixture names that became unmapped. */
export function removePort(registry, controller, port) {
  const freed = [];
  for (const entry of port.chain) {
    const name = entryFixtureName(entry);
    if (name !== null) freed.push(name);
  }
  const i = controller.ports.indexOf(port);
  if (i >= 0) controller.ports.splice(i, 1);
  return freed;
}

/**
 * Append fixtures to a port's chain, in the given order. Names already
 * mapped anywhere are REJECTED, never silently skipped or moved
 * (docs/33 Flow A). Returns { added, rejected: [{name, where}] }.
 */
export function appendFixtures(registry, port, names) {
  const mapped = mappedFixtures(registry);
  const added = [];
  const rejected = [];
  for (const name of names) {
    const hit = mapped.get(name);
    if (hit) {
      rejected.push({ name, where: `${hit.controller.name} · Port ${hit.port.port}` });
      continue;
    }
    port.chain.push(name);
    mapped.set(name, { controller: null, port });
    added.push(name);
  }
  return { added, rejected };
}

/** Remove one fixture (by name) from whatever chain holds it. */
export function unmapFixture(registry, name) {
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      const i = port.chain.findIndex(e => entryFixtureName(e) === name);
      if (i >= 0) {
        port.chain.splice(i, 1);
        return true;
      }
    }
  }
  return false;
}

/** Reorder a chain entry within its port. */
export function moveChainEntry(port, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const [entry] = port.chain.splice(fromIndex, 1);
  port.chain.splice(toIndex, 0, entry);
}

/**
 * Rename hook: a live fixture rename must update its chain reference
 * atomically — a rename can never orphan a mapping (docs/33).
 */
export function renameFixtureInChains(registry, oldName, newName) {
  if (!registryIsActive(registry) || oldName === newName) return false;
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (let i = 0; i < port.chain.length; i++) {
        const entry = port.chain[i];
        if (typeof entry === 'string' && entry === oldName) {
          port.chain[i] = newName;
          return true;
        }
        if (isPinnedEntry(entry) && entry.fixture === oldName) {
          entry.fixture = newName;
          return true;
        }
      }
    }
  }
  return false;
}

// ── Packing + projection ────────────────────────────────────────────────

/**
 * Compute the full projection of a registry onto a set of fixture
 * configs.
 *
 * @param {Object} registry
 * @param {Map<string, Object>} configsByName - fixture name → config
 * @param {Object} pins - config.yaml global_effects table:
 *                        { <fixtureType>: { universe, address } }
 * @returns {{
 *   fields: Map<string, {controllerIp, dmxUniverse, dmxAddress, controllerId}>,
 *   violations: Array<{code, message, controllerId, port}>,
 *   portLayouts: Map<string, Array<{entry, name, address, footprint, valid}>>,
 * }}
 *
 * Every MAPPED fixture gets a `fields` entry — derived when provably
 * valid, unpatched (''/0/0) otherwise. `portLayouts` (key
 * `<controllerId>:<portNum>`) carries per-entry computed addresses and
 * validity for the panel UI, including gaps.
 */
export function computeProjection(registry, configsByName, pins) {
  const fields = new Map();
  const violations = new Map(); // key → violation (dedup)
  const portLayouts = new Map();

  const addViolation = (code, message, controller, port) => {
    const key = `${code}|${controller ? controller.id : ''}|${port ? port.port : ''}|${message}`;
    if (!violations.has(key)) {
      violations.set(key, {
        code,
        message,
        controllerId: controller ? controller.id : 0,
        port: port ? port.port : 0,
      });
    }
  };

  const unpatch = (name) => {
    fields.set(name, { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  };

  // ── Controller-level checks: IP format + uniqueness ──────────────────
  const badControllers = new Set();
  const ipOwners = new Map();
  for (const controller of registry.controllers) {
    if (!isValidIp(controller.ip)) {
      addViolation('bad_ip', `Controller '${controller.name}' has a malformed or missing IP ` +
        `('${controller.ip}') — its fixtures project unpatched`, controller, null);
      badControllers.add(controller);
      continue;
    }
    if (ipOwners.has(controller.ip)) {
      const other = ipOwners.get(controller.ip);
      addViolation('dup_ip', `Controllers '${other.name}' and '${controller.name}' share IP ` +
        `${controller.ip} — '${controller.name}' projects unpatched`, controller, null);
      badControllers.add(controller);
      continue;
    }
    ipOwners.set(controller.ip, controller);
  }

  // ── Universe ownership: one universe never spans two controllers ─────
  // Deterministic loser: the controller with the HIGHER id projects
  // unpatched on the contested universe (docs/33 projection table).
  const universeOwner = new Map(); // universe → controller
  const contestedPorts = new Set();
  const allPortsSorted = [];
  for (const controller of [...registry.controllers].sort((a, b) => a.id - b.id)) {
    for (const port of controller.ports) allPortsSorted.push({ controller, port });
  }
  for (const { controller, port } of allPortsSorted) {
    const owner = universeOwner.get(port.universe);
    if (owner === undefined) {
      universeOwner.set(port.universe, controller);
    } else if (owner !== controller) {
      addViolation('dup_universe', `Universe ${port.universe} is carried by both ` +
        `'${owner.name}' and '${controller.name}' — a universe belongs to exactly one ` +
        `controller; '${controller.name}' port ${port.port} projects unpatched`,
      controller, port);
      contestedPorts.add(port);
    }
  }

  // ── Per-port packing ──────────────────────────────────────────────────
  // Spans are registered per universe so same-universe sibling ports can
  // be overlap-checked AFTER both are packed. Lower port number wins;
  // the higher port's whole chain projects unpatched (docs/33).
  const universeSpans = new Map(); // universe → [{controller, port, start, end}]

  for (const { controller, port } of allPortsSorted) {
    const layoutKey = `${controller.id}:${port.port}`;
    const layout = [];
    portLayouts.set(layoutKey, layout);

    const portDead = badControllers.has(controller) || contestedPorts.has(port);
    const isEffectsPort = port.universe === EFFECTS_UNIVERSE;
    let cursor = port.startAddress;
    let chainBroken = false; // overflow/orphan poisons everything after it
    let spanStart = null;
    let spanEnd = null;

    for (const entry of port.chain) {
      const name = entryFixtureName(entry);

      // Gaps consume channels but project nothing.
      if (isGapEntry(entry)) {
        layout.push({ entry, name: null, address: cursor, footprint: entry.gap, valid: !chainBroken });
        cursor += entry.gap;
        continue;
      }

      const config = configsByName.get(name);
      if (!config) {
        addViolation('orphan', `'${name}' on ${controller.name} port ${port.port} does not ` +
          'resolve to a fixture — drop the entry or fix the name; entries after it project ' +
          'unpatched', controller, port);
        layout.push({ entry, name, address: cursor, footprint: 0, valid: false });
        chainBroken = true; // addresses after an orphan are uncertain
        continue;
      }

      const footprint = getFootprint(config);
      const fixtureType = config.fixtureType || config.type || '';
      const isEffect = isGlobalEffect(fixtureType);

      // ── Pinned entries (global effects) — valid on ANY port ─────────
      // A fogger is physically cabled to some controller port, but its
      // address is always its config.yaml pin on the effects universe
      // ("auto patch the foggers", operator decision 2026-06-11). The
      // entry records the physical attachment; the projection ignores
      // the port's universe and emits U<pin.universe>:<pin.address>.
      if (isPinnedEntry(entry)) {
        if (!isEffect) {
          addViolation('pin_not_effect', `'${name}' is pinned but is not a global effect — ` +
            'only effects (fog/haze/horn/fire) carry pinned addresses; it projects unpatched',
          controller, port);
          layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        const pin = pins ? pins[fixtureType] : undefined;
        if (!pin || !Number.isInteger(pin.address)) {
          addViolation('no_pin', `'${name}' (${fixtureType}) has no pin in config.yaml ` +
            'global_effects — it projects unpatched', controller, port);
          layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        if (entry.at !== pin.address) {
          addViolation('pin_mismatch', `'${name}' (${fixtureType}) must be pinned at ` +
            `U${pin.universe}:${pin.address} (config.yaml global_effects), found @${entry.at} — ` +
            'it projects unpatched', controller, port);
          layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        if (portDead) {
          layout.push({ entry, name, address: pin.address, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        layout.push({
          entry, name, address: pin.address, footprint, valid: true,
          pinned: true, pinUniverse: pin.universe,
        });
        fields.set(name, {
          controllerIp: controller.ip,
          dmxUniverse: pin.universe,
          dmxAddress: pin.address,
          controllerId: controller.id,
        });
        continue;
      }

      // ── Universe-1 rules for packed (string) entries ─────────────────
      if (isEffectsPort) {
        if (!isEffect) {
          addViolation('non_effect_on_u1', `'${name}' is not a global effect but is mapped on ` +
            `universe ${EFFECTS_UNIVERSE} (effects-only) — it projects unpatched`,
          controller, port);
        } else {
          addViolation('pin_mismatch', `'${name}' (${fixtureType}) is a global effect and must ` +
            'be a pinned entry ({fixture, at}), found a packed entry — it projects unpatched',
          controller, port);
        }
        layout.push({ entry, name, address: 0, footprint, valid: false });
        unpatch(name);
        continue;
      }

      // ── Normal (packed) port ────────────────────────────────────────
      if (isEffect) {
        addViolation('effect_off_u1', `'${name}' is a global effect and must be a pinned ` +
          `entry (auto-applied when added via the panel) — it projects unpatched`,
        controller, port);
        layout.push({ entry, name, address: 0, footprint, valid: false });
        unpatch(name);
        continue;
      }

      const address = cursor;
      const overflows = address + footprint - 1 > DMX_UNIVERSE_SIZE;
      if (overflows && !chainBroken) {
        addViolation('overflow', `${controller.name} port ${port.port} (U${port.universe}) ` +
          `overflows at '${name}' (ch ${address}+${footprint} > ${DMX_UNIVERSE_SIZE}) — it and ` +
          'every entry after it project unpatched', controller, port);
        chainBroken = true;
      }

      const valid = !portDead && !chainBroken;
      layout.push({ entry, name, address, footprint, valid });
      cursor = address + footprint;

      if (valid) {
        if (spanStart === null) spanStart = address;
        spanEnd = address + footprint - 1;
        fields.set(name, {
          controllerIp: controller.ip,
          dmxUniverse: port.universe,
          dmxAddress: address,
          controllerId: controller.id,
        });
      } else {
        unpatch(name);
      }
    }

    if (!isEffectsPort && spanStart !== null) {
      if (!universeSpans.has(port.universe)) universeSpans.set(port.universe, []);
      universeSpans.get(port.universe).push({ controller, port, start: spanStart, end: spanEnd });
    }
  }

  // ── Same-universe sibling overlap: higher port number loses ──────────
  for (const [universe, spans] of universeSpans) {
    spans.sort((a, b) => a.port.port - b.port.port);
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const a = spans[i];
        const b = spans[j];
        if (b.start <= a.end && a.start <= b.end) {
          addViolation('overlap', `U${universe}: ${b.controller.name} port ${b.port.port} ` +
            `(ch ${b.start}–${b.end}) overlaps port ${a.port.port} (ch ${a.start}–${a.end}) — ` +
            `port ${b.port.port}'s chain projects unpatched`, b.controller, b.port);
          // Unpatch the entire losing chain and mark its layout invalid.
          const layout = portLayouts.get(`${b.controller.id}:${b.port.port}`);
          for (const item of layout) {
            item.valid = false;
            if (item.name !== null) unpatch(item.name);
          }
        }
      }
    }
  }

  // ── Running end-of-universe map ───────────────────────────────────────
  // Built once per projection pass (the projection already visits every
  // entry) so address suggestions are O(1) lookups instead of a fresh
  // scan per UI change. Highest occupied channel per universe across
  // ALL controllers, counting only entries that actually hold their
  // channels: valid packed fixtures + gaps on the port's universe, and
  // valid pinned effects on their pin universe.
  const universeEnds = new Map();
  const bumpEnd = (universe, end) => {
    if (end > (universeEnds.get(universe) || 0)) universeEnds.set(universe, end);
  };
  for (const { controller, port } of allPortsSorted) {
    const layout = portLayouts.get(`${controller.id}:${port.port}`);
    for (const item of layout) {
      if (!item.valid || item.footprint <= 0) continue;
      const universe = item.pinned ? (item.pinUniverse || EFFECTS_UNIVERSE) : port.universe;
      bumpEnd(universe, Math.min(item.address + item.footprint - 1, DMX_UNIVERSE_SIZE));
    }
  }

  return { fields, violations: [...violations.values()], portLayouts, universeEnds };
}

/**
 * Sum of channels a port's packed chain occupies (gaps included, pinned
 * effects excluded — they live on the effects universe, not the port's).
 * Used to test whether a suggested startAddress still fits.
 */
export function portPackedWidth(port, configsByName) {
  let width = 0;
  for (const entry of port.chain) {
    if (isGapEntry(entry)) {
      width += entry.gap;
    } else if (!isPinnedEntry(entry)) {
      const config = configsByName.get(entryFixtureName(entry));
      if (config) width += getFootprint(config);
    }
  }
  return width;
}

/**
 * Project a registry onto live fixture configs (mutated in place) and
 * assign metadata. Only acts when the registry is active (≥1
 * controller) — with no mapping, stored patches.yaml fields stand.
 *
 * Metadata assignment (absorbed from the retired auto-patcher):
 *  - sectionId: per group, existing positive ids kept, new groups get
 *    the next free id;
 *  - fixtureId: existing positive ids kept, missing ones get the next
 *    free monotonic id;
 *  - controllerId: derived (mapped → controller id, unmapped → 0).
 *
 * Returns { violations, drift } — `drift` lists fixtures whose stored
 * fields differed from the projection (logged loudly by callers).
 */
export function projectOntoConfigs(registry, configs, pins) {
  if (!registryIsActive(registry)) return { violations: [], drift: [] };

  const configsByName = new Map();
  for (const config of configs) {
    if (config && typeof config.name === 'string' && config.name.length > 0) {
      configsByName.set(config.name, config);
    }
  }

  const { fields, violations } = computeProjection(registry, configsByName, pins);
  const drift = [];

  for (const [name, config] of configsByName) {
    const projected = fields.get(name) ||
      { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 };
    const before = {
      controllerIp: config.controllerIp || '',
      dmxUniverse: config.dmxUniverse || 0,
      dmxAddress: config.dmxAddress || 0,
      controllerId: config.controllerId || 0,
    };
    if (before.controllerIp !== projected.controllerIp ||
        before.dmxUniverse !== projected.dmxUniverse ||
        before.dmxAddress !== projected.dmxAddress ||
        before.controllerId !== projected.controllerId) {
      drift.push({ name, before, after: projected });
    }
    config.controllerIp = projected.controllerIp;
    config.dmxUniverse = projected.dmxUniverse;
    config.dmxAddress = projected.dmxAddress;
    config.controllerId = projected.controllerId;
  }

  // ── Metadata: sectionId per group, fixtureId monotonic ───────────────
  const groupToSectionId = new Map();
  let maxSectionId = 0;
  let maxFixtureId = 0;
  for (const config of configsByName.values()) {
    if (config.group && config.sectionId > 0 && !groupToSectionId.has(config.group)) {
      groupToSectionId.set(config.group, config.sectionId);
    }
    if (config.sectionId > 0) maxSectionId = Math.max(maxSectionId, config.sectionId);
    if (config.fixtureId > 0) maxFixtureId = Math.max(maxFixtureId, config.fixtureId);
  }
  for (const config of configsByName.values()) {
    if (config.group && (!config.sectionId || config.sectionId <= 0)) {
      if (!groupToSectionId.has(config.group)) {
        maxSectionId += 1;
        groupToSectionId.set(config.group, maxSectionId);
      }
      config.sectionId = groupToSectionId.get(config.group);
    }
    if (!config.fixtureId || config.fixtureId <= 0) {
      maxFixtureId += 1;
      config.fixtureId = maxFixtureId;
    }
  }

  return { violations, drift };
}
