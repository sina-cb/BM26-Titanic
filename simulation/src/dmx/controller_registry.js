/**
 * controller_registry.js — scene-owned controller mapping registry.
 *
 * The simulation is the source of truth for the physical control
 * hardware topology (docs/33): controllers (IP + stable id) → ports
 * (universe) → chains (which jack each fixture hangs off). The
 * registry lives in the scene's `controllers.yaml`, rides the config
 * tree through save/load, and PROJECTS every fixture's patch fields
 * (`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) plus
 * metadata (`sectionId`, `fixtureId`) — replacing both hand-typed patch
 * fields and the auto-patcher. The projected `controllerId` is the
 * controller's 1-based ORDINAL in the panel list (docs/33 decision 20),
 * not the internal stable id.
 *
 * ALLOCATION MODEL (docs/33 decision 19, operator 2026-06-12): every
 * entry stores its ABSOLUTE address, assigned once at add time from
 * the end of the universe's occupancy map and sticky thereafter.
 * Ports are pure cable topology — chain order never influences
 * addresses, exactly like the physical rig. Holes from removals stay
 * (waste, never reshuffle); the panel's universe bars expose the
 * fragmentation.
 *
 * Shape (mirrors controllers.yaml):
 *   {
 *     nextControllerId: <int>,            // monotonic — ids never reused
 *     nextUniverse: <int>,                // monotonic — universes never reused either
 *     controllers: [
 *       { id, name, ip, ports: [
 *           { port, universe, chain: [
 *               { fixture, at }            // fixture at absolute address
 *               | { gap: <channels>, at }  // absolute channel reservation
 *           ] },
 *       ] },
 *     ],
 *   }
 *
 * Legacy files (packed string entries + per-port startAddress) are
 * converted once by migrateLegacyChains() at exactly their previously
 * derived addresses — upgrading moves nothing.
 *
 * The projection contract (docs/33 "Projection under invalid state"):
 * a fixture whose derived address cannot be proven valid projects to
 * the unpatched state (''/0/0) with a loud violation — patches.yaml can
 * never contain an out-of-range address. Valid fixtures around a
 * violation keep their addresses (loud-but-recoverable). ONE deliberate
 * exception (decision 18): MANUAL pins may carry a conflicting (never
 * out-of-range) address — flagged with a manual_overlap warning, the
 * operator's explicit override always stands.
 */

import { getFootprint, isGlobalEffect } from './auto_patcher.js';
import { getDefinition } from './fixture_definition_registry.js';

// ── Constants ───────────────────────────────────────────────────────────

export const DMX_UNIVERSE_SIZE = 512;   // full budget, channels 1–512 (docs/33 decision 1)
export const EFFECTS_UNIVERSE = 1;      // reserved for global effects (docs/33 decision 2)
export const MAX_UNIVERSE = 63999;      // sACN (E1.31) universe ceiling
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
  const registry = { nextControllerId: 1, nextUniverse: 2, controllers: [] };

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
      // Range problems (e.g. > MAX_UNIVERSE) are OPERATIONAL — the
      // projection flags them loudly and unpatches the port; treating
      // them as corruption would brick the boot off a panel typo
      // (cold review 2026-06-12, same class as the at: 0 fix).
      if (!Number.isInteger(universe) || universe < 1) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          `universe ${universe} must be a positive integer`);
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
          // `at` is the gap's absolute address; absent = legacy packed
          // gap (migrated at boot). Range problems are operational
          // (projection flags them), only a broken TYPE is structural.
          if (entry.at !== undefined && !Number.isInteger(entry.at)) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `gap address ${entry.at} must be an integer`);
          }
        } else if (isPinnedEntry(entry)) {
          // at: 0 is the legitimate "no pin known" state — the panel
          // writes it when config.yaml has no pin for the type yet.
          // It must LOAD (the projection flags it loudly as no_pin /
          // pin_mismatch); treating it as corruption bricked the boot
          // off a normal UI flow (cold review B1, 2026-06-12).
          if (!Number.isInteger(entry.at) || entry.at < 0 || entry.at > DMX_UNIVERSE_SIZE) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `pinned entry '${entry.fixture}' address ${entry.at} must be in ` +
              `1–${DMX_UNIVERSE_SIZE} (or 0 = unpinned)`);
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

  // Universe high-water mark: like controller ids, universes are NEVER
  // reused — deleting a controller must not let its old universes be
  // handed to later gear, silently re-meaning addresses the engine,
  // models and patterns may still reference. Wasting universe numbers
  // is fine; reshuffling the system for a small change is not
  // (operator decision 2026-06-12).
  let maxU = 1; // U1 (effects) never counts as allocatable
  for (const controller of registry.controllers) {
    for (const port of controller.ports) maxU = Math.max(maxU, port.universe);
  }
  const rawNextU = src.nextUniverse;
  registry.nextUniverse = Math.max(
    Number.isInteger(rawNextU) ? rawNextU : 2, maxU + 1, 2);

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

/**
 * Next universe to allocate — MONOTONIC, never a freed one. The
 * high-water mark only moves forward (createControllerRegistry
 * normalizes it past every in-use universe at load; addPort and
 * noteUniverseUsed bump it live), so removing a controller can never
 * cause a later addition to reclaim its universes and silently
 * re-mean existing addresses. U1 is effects-only and never allocated.
 */
export function nextFreeUniverse(registry) {
  return Math.max(registry.nextUniverse || 2, 2);
}

/** Record a manually-entered universe so allocation never hands it out again. */
export function noteUniverseUsed(registry, universe) {
  if (Number.isInteger(universe) && universe <= MAX_UNIVERSE &&
      universe + 1 > (registry.nextUniverse || 2)) {
    registry.nextUniverse = universe + 1;
  }
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
  const universe = nextFreeUniverse(registry);
  if (universe > MAX_UNIVERSE) {
    throw new Error(`[Controllers] Universe allocation exhausted (next would be ` +
      `${universe} > ${MAX_UNIVERSE})`);
  }
  registry.nextUniverse = universe + 1;
  const port = { port: portNum, universe, startAddress: 1, chain: [] };
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
 * Rename support: updates a fixture's chain reference atomically so a
 * rename can never orphan a mapping (docs/33). NO production caller
 * yet — fixture names are not editable in today's UI. Wire this into
 * the rename path BEFORE adding a rename control, or deletions of this
 * guarantee will be silent.
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

/**
 * One-time conversion of LEGACY packed chains (string entries and gaps
 * without `at`, addressed by chain order from the port's old
 * startAddress) into the allocation model's absolute entries
 * ({fixture, at} / {gap, at}) — at exactly the addresses the old
 * packing derived, so upgrading moves nothing. Idempotent: ports with
 * no legacy entries are untouched beyond dropping the now-meaningless
 * startAddress. An entry whose footprint cannot be proven (missing
 * fixture or definition) STOPS migration for the rest of its chain —
 * addresses after it were always undefined; the projection flags the
 * stragglers loudly (`unallocated`) and the next call retries. Effects
 * strings convert to their config.yaml pin (or at: 0 → loud no_pin),
 * mirroring what the panel would write.
 * Returns the migrated fixture names for the caller to log.
 */
export function migrateLegacyChains(registry, configsByName, pins) {
  const migrated = [];
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      const isEffectsPort = port.universe === EFFECTS_UNIVERSE;
      const hasLegacy = port.chain.some(e =>
        typeof e === 'string' || (isGapEntry(e) && !Number.isInteger(e.at)));
      if (!hasLegacy) {
        delete port.startAddress;
        continue;
      }
      if (isEffectsPort) continue; // packed entries on U1 were invalid then and now

      // ATOMIC per port: resolve EVERY legacy entry first, apply only
      // if all succeed. A partial conversion would poison a later
      // retry — the packing cursor cannot resume past converted
      // entries without misreading operator manual pins (which never
      // advanced the old cursor).
      let cursor = Number.isInteger(port.startAddress) ? port.startAddress : 1;
      const plan = []; // [index, replacementEntry, label]
      let resolvable = true;
      for (let i = 0; i < port.chain.length; i++) {
        const entry = port.chain[i];
        if (isGapEntry(entry)) {
          if (Number.isInteger(entry.at)) continue; // already absolute — no cursor effect then
          plan.push([i, { gap: entry.gap, at: cursor }, `(${entry.gap}-ch gap @${cursor})`]);
          cursor += entry.gap;
          continue;
        }
        if (typeof entry === 'string') {
          const config = configsByName.get(entry);
          const fixtureType = config ? (config.fixtureType || config.type || '') : '';
          if (isGlobalEffect(fixtureType)) {
            // Packed effects were invalid in the old model too — pin
            // them the way the panel would (they held no packed
            // channels, so the cursor is unaffected).
            const pin = pins ? pins[fixtureType] : undefined;
            plan.push([i, { fixture: entry, at: pin ? pin.address : 0 }, entry]);
            continue;
          }
          if (!config || !getDefinition(fixtureType)) {
            // Footprint unknowable — old packing addresses after it
            // were always undefined. Never guess: leave the WHOLE port
            // legacy and retry on the next call.
            resolvable = false;
            break;
          }
          plan.push([i, { fixture: entry, at: cursor }, entry]);
          cursor += getFootprint(config);
          continue;
        }
        // Pinned entries held no packed channels in the old model.
      }
      if (!resolvable) continue;
      for (const [i, replacement, label] of plan) {
        port.chain[i] = replacement;
        migrated.push(label);
      }
      delete port.startAddress;
    }
  }
  return migrated;
}

// ── Projection (allocation model) ───────────────────────────────────────

/**
 * Compute the full projection of a registry onto a set of fixture
 * configs (allocation model, docs/33 decision 19).
 *
 * @param {Object} registry
 * @param {Map<string, Object>} configsByName - fixture name → config
 * @param {Object} pins - config.yaml global_effects table:
 *                        { <fixtureType>: { universe, address } }
 * @returns {{
 *   fields: Map<string, {controllerIp, dmxUniverse, dmxAddress, controllerId}>,
 *   violations: Array<{code, message, controllerId, port}>,
 *   portLayouts: Map<string, Array<{entry, name, address, footprint, valid}>>,
 *   universeEnds: Map<number, number>,
 *   universeMaps: Map<number, Array<{start, end, name, item, controllerId, portNum, effect}>>,
 * }}
 *
 * Every MAPPED fixture gets a `fields` entry — its stored absolute
 * address when provably sendable, unpatched (''/0/0) otherwise. The
 * `fields` controllerId is the owning controller's PANEL ORDINAL
 * (1-based array position, decision 20); everywhere else in this
 * result (violations, portLayouts keys, universeMaps claims) the
 * stable internal id is used.
 * `portLayouts` (key `<controllerId>:<portNum>`) carries per-entry
 * validity for the panel UI; `universeMaps` is the full per-universe
 * occupancy (sorted, valid claims only) for the universe bars and the
 * allocator; `universeEnds` is its running end per universe.
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

  // ── Projected controllerId: the PANEL ORDINAL, not the stable id ─────
  // The operator matches fixture cards / patches.yaml / the engine model
  // against the Controller Mapping panel BY EYE, so the projected
  // controllerId is the controller's 1-based position in the panel list
  // (registry.controllers array order) — docs/33 decision 20 (operator
  // 2026-06-12). Deleting or reordering controllers renumbers projected
  // ids on the next projection; that is the intent. The stable internal
  // `controller.id` (monotonic, never reused) still keys portLayouts,
  // violations, universeMaps claims, and panel collapse state.
  const ordinalOf = new Map(registry.controllers.map((controller, i) => [controller, i + 1]));

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

  // ── Per-entry projection (allocation model, docs/33 decision 19) ────
  // Every fixture entry carries its ABSOLUTE address ({fixture, at});
  // gaps carry {gap, at}. Nothing is derived from chain order — ports
  // are pure cable topology, exactly like the physical rig (addresses
  // live on the fixtures, the daisy chain only carries signal). The
  // projection validates each entry, builds the FULL per-universe
  // occupancy map (rendered as the universe bar on every port), and
  // flags overlaps as WARNINGS — every address is explicit operator
  // state, so a conflict paints red and stands, it is never silently
  // unpatched. Hard unpatches that remain: outside 1–512, U1 rules,
  // missing definition, orphan, bad/duplicate IP, contested universe,
  // and unmigrated legacy entries.
  const occupancy = new Map();  // universe → claims for the map + overlap sweep
  const pinnedOccupancy = [];   // valid effects pins (gang-fire-aware check)

  const claim = (universe, start, end, name, item, controller, port, effect) => {
    if (!occupancy.has(universe)) occupancy.set(universe, []);
    occupancy.get(universe).push({
      start, end, name, item,
      controllerId: controller.id, controllerName: controller.name, portNum: port.port,
      effect: !!effect,
    });
  };

  for (const { controller, port } of allPortsSorted) {
    const layoutKey = `${controller.id}:${port.port}`;
    const layout = [];
    portLayouts.set(layoutKey, layout);

    const universeOutOfRange = port.universe > MAX_UNIVERSE;
    if (universeOutOfRange) {
      addViolation('universe_range', `${controller.name} port ${port.port}: universe ` +
        `${port.universe} is outside 1–${MAX_UNIVERSE} (the sACN limit) — its fixtures ` +
        'project unpatched; fix the universe number', controller, port);
    }
    const portDead = badControllers.has(controller) || contestedPorts.has(port) ||
      universeOutOfRange;
    const isEffectsPort = port.universe === EFFECTS_UNIVERSE;

    for (const entry of port.chain) {
      const name = entryFixtureName(entry);

      // ── Gaps: absolute channel reservations ({gap, at}) for real
      // hardware not modeled in the sim ─────────────────────────────
      if (isGapEntry(entry)) {
        if (isEffectsPort) {
          addViolation('non_effect_on_u1', `${controller.name} port ${port.port}: a ` +
            `${entry.gap}-ch gap on universe ${EFFECTS_UNIVERSE} (effects-only, pinned ` +
            'addresses) reserves nothing', controller, port);
          layout.push({ entry, name: null, address: entry.at || 0, footprint: entry.gap, valid: false });
          continue;
        }
        if (!Number.isInteger(entry.at)) {
          addViolation('unallocated', `${controller.name} port ${port.port}: a ${entry.gap}-ch ` +
            'gap has no allocated address (legacy packed entry) — boot migration assigns one; ' +
            'if this persists, remove and re-add the gap', controller, port);
          layout.push({ entry, name: null, address: 0, footprint: entry.gap, valid: false });
          continue;
        }
        const gapEnd = entry.at + entry.gap - 1;
        if (entry.at < 1 || gapEnd > DMX_UNIVERSE_SIZE) {
          addViolation('pin_overflow', `${controller.name} port ${port.port}: gap @${entry.at} ` +
            `spans ch ${entry.at}–${gapEnd} — outside 1–${DMX_UNIVERSE_SIZE}; it reserves nothing`,
          controller, port);
          layout.push({ entry, name: null, address: entry.at, footprint: entry.gap, valid: false });
          continue;
        }
        const gapItem = { entry, name: null, address: entry.at, footprint: entry.gap, valid: !portDead };
        layout.push(gapItem);
        if (!portDead) claim(port.universe, entry.at, gapEnd, null, gapItem, controller, port);
        continue;
      }

      // ── Legacy packed (string) entries: the old model derived their
      // addresses from chain order; migrateLegacyChains() converts
      // them at boot. One surviving here means migration could not
      // prove its footprint (missing fixture/definition) or the file
      // was hand-edited mid-session. Loud + unpatched, never guessed.
      if (typeof entry === 'string') {
        addViolation('unallocated', `'${entry}' on ${controller.name} port ${port.port} has no ` +
          'allocated address (legacy packed entry) — migration runs at boot; if this persists ' +
          'the fixture or its definition is missing: fix it or re-add via the panel',
        controller, port);
        layout.push({ entry, name, address: 0, footprint: 0, valid: false });
        unpatch(name);
        continue;
      }

      // ── Pinned entries ({fixture, at}) ────────────────────────────
      const config = configsByName.get(name);
      if (!config) {
        addViolation('orphan', `'${name}' on ${controller.name} port ${port.port} does not ` +
          'resolve to a fixture — drop the entry or fix the name', controller, port);
        layout.push({ entry, name, address: entry.at || 0, footprint: 0, valid: false });
        continue;
      }

      const footprint = getFootprint(config);
      const fixtureType = config.fixtureType || config.type || '';
      const isEffect = isGlobalEffect(fixtureType);

      // Effects: the address is ALWAYS the config.yaml pin on the
      // effects universe — the entry records the physical cabling
      // (operator decision 2026-06-11). Identical pin addresses
      // gang-fire by design; the dedicated check below flags only
      // genuine config errors.
      if (isEffect) {
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
        // Only a controller-level IP problem invalidates an effects
        // pin — its universe is independent of the port's.
        if (badControllers.has(controller)) {
          layout.push({ entry, name, address: pin.address, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        const pinItem = {
          entry, name, address: pin.address, footprint, valid: true,
          pinned: true, pinUniverse: pin.universe,
        };
        layout.push(pinItem);
        fields.set(name, {
          controllerIp: controller.ip,
          dmxUniverse: pin.universe,
          dmxAddress: pin.address,
          controllerId: ordinalOf.get(controller),
        });
        pinnedOccupancy.push({
          controller, port, name, item: pinItem,
          universe: pin.universe, start: pin.address, end: pin.address + footprint - 1,
        });
        claim(pin.universe, pin.address, pin.address + footprint - 1, name, pinItem,
          controller, port, true);
        continue;
      }

      // Normal fixtures.
      if (isEffectsPort) {
        addViolation('non_effect_on_u1', `'${name}' is not a global effect but is mapped on ` +
          `universe ${EFFECTS_UNIVERSE} (effects-only) — it projects unpatched`, controller, port);
        layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      // The footprint must be REAL to know what the address occupies —
      // the no-guess rule (the silent 10-channel fallback scrambled a
      // real mapping once, 2026-06-12).
      if (!getDefinition(fixtureType)) {
        addViolation('no_definition', `'${name}' (${fixtureType || 'unknown type'}) has no ` +
          'registered fixture definition — footprint unknown, it projects unpatched. If this ' +
          'appears at boot, the definition registry was not initialized before projection.',
        controller, port);
        layout.push({ entry, name, address: entry.at, footprint: 0, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      if (!Number.isInteger(entry.at) || entry.at < 1 ||
          entry.at + footprint - 1 > DMX_UNIVERSE_SIZE) {
        addViolation('pin_overflow', `'${name}' @${entry.at} spans ` +
          `ch ${entry.at}–${entry.at + footprint - 1} — outside 1–${DMX_UNIVERSE_SIZE}; ` +
          'it projects unpatched', controller, port);
        layout.push({ entry, name, address: entry.at, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      // An address on a contested universe / dead controller is
      // unsendable — unlike a CONFLICT, this is a hard unpatch.
      if (portDead) {
        layout.push({ entry, name, address: entry.at, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      const item = {
        entry, name, address: entry.at, footprint, valid: true,
        pinned: true, manual: true, pinUniverse: port.universe,
      };
      layout.push(item);
      fields.set(name, {
        controllerIp: controller.ip,
        dmxUniverse: port.universe,
        dmxAddress: entry.at,
        controllerId: ordinalOf.get(controller),
      });
      claim(port.universe, entry.at, entry.at + footprint - 1, name, item, controller, port);
    }
  }

  // ── Effects-universe pin occupancy ────────────────────────────────────
  // IDENTICAL start addresses are ALLOWED by design: one address
  // gang-fires several effects at once (operator decision 2026-06-12,
  // "same address to start multiple foggers at the same time, always").
  // What IS flagged: a pin whose footprint runs past the universe end
  // (pin_overflow) and pins at DIFFERENT addresses whose footprints
  // collide (pin_overlap) — both are config.yaml global_effects errors.
  // Deterministic loser: the higher address (sorted, ties by name).
  pinnedOccupancy.sort((a, b) =>
    a.universe - b.universe || a.start - b.start || a.name.localeCompare(b.name));
  for (let i = 0; i < pinnedOccupancy.length; i++) {
    const p = pinnedOccupancy[i];
    if (p.end > DMX_UNIVERSE_SIZE) {
      addViolation('pin_overflow', `'${p.name}' pin U${p.universe}:${p.start} spans ` +
        `ch ${p.start}–${p.end}, past ${DMX_UNIVERSE_SIZE} — fix config.yaml global_effects; ` +
        'it projects unpatched', p.controller, p.port);
      p.item.valid = false;
      unpatch(p.name);
      continue;
    }
    for (let j = i - 1; j >= 0; j--) {
      const q = pinnedOccupancy[j];
      if (q.universe !== p.universe) break; // sorted: earlier universes only
      if (!q.item.valid || q.start === p.start) continue; // shared trigger address = gang-fire
      if (p.start <= q.end) {
        addViolation('pin_overlap', `U${p.universe}: '${p.name}' pin @${p.start} lands inside ` +
          `'${q.name}' (ch ${q.start}–${q.end}) — fix config.yaml global_effects; ` +
          `'${p.name}' projects unpatched`, p.controller, p.port);
        p.item.valid = false;
        unpatch(p.name);
        break;
      }
    }
  }

  // ── Full universe maps + overlap sweep (WARN, never unpatch) ─────────
  // The complete occupancy of every universe across ALL controllers —
  // the operator's "universe map": rendered as the bar on every port,
  // the allocator's source of truth (universeEnds = one past the last
  // claim), and the overlap detector. Addresses are explicit, so an
  // overlap marks BOTH claims conflicted (red) and raises a violation,
  // but everything keeps projecting — the operator resolves it
  // (operator decision 2026-06-12). Effects claims are exempt here
  // (gang-fire); they have their own check above.
  const universeMaps = new Map();
  const universeEnds = new Map();
  for (const [universe, claims] of occupancy) {
    const live = claims.filter(c => c.item.valid);
    live.sort((a, b) => a.start - b.start || (a.name || '').localeCompare(b.name || ''));
    universeMaps.set(universe, live);
    let end = 0;
    let runEnd = 0;
    let runClaim = null;
    for (const c of live) {
      end = Math.max(end, Math.min(c.end, DMX_UNIVERSE_SIZE));
      if (c.effect) continue;
      if (runClaim && c.start <= runEnd) {
        c.item.conflict = true;
        runClaim.item.conflict = true;
        const what = c.name ? `'${c.name}'` : `a ${c.end - c.start + 1}-ch gap`;
        const other = runClaim.name ? `'${runClaim.name}'` : `a gap`;
        addViolation('overlap', `U${universe}: ${what} (ch ${c.start}–${c.end}, ` +
          `${c.controllerName} P${c.portNum}) overlaps ${other} (ch ${runClaim.start}–` +
          `${runClaim.end}, ${runClaim.controllerName} P${runClaim.portNum}) — BOTH KEPT; ` +
          'fix one address', { id: c.controllerId }, { port: c.portNum });
      }
      if (c.end > runEnd) {
        runEnd = c.end;
        runClaim = c;
      }
    }
    if (end > 0) universeEnds.set(universe, end);
  }

  return { fields, violations: [...violations.values()], portLayouts, universeEnds, universeMaps };
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
 *  - controllerId: derived (mapped → controller's panel ordinal,
 *    1-based array position per docs/33 decision 20, unmapped → 0).
 *
 * Returns { violations, drift, migrated } — `drift` lists fixtures
 * whose stored fields differed from the projection; `migrated` lists
 * legacy packed entries converted to absolute addresses this pass
 * (both logged loudly by callers).
 */
export function projectOntoConfigs(registry, configs, pins) {
  if (!registryIsActive(registry)) return { violations: [], drift: [], migrated: [] };

  const configsByName = new Map();
  for (const config of configs) {
    if (config && typeof config.name === 'string' && config.name.length > 0) {
      configsByName.set(config.name, config);
    }
  }

  // Legacy packed chains convert (once, at their previously derived
  // addresses) before projecting — see migrateLegacyChains. The change
  // persists with the next normal save; until then every boot
  // re-migrates deterministically.
  const migrated = migrateLegacyChains(registry, configsByName, pins);

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

  return { violations, drift, migrated };
}
