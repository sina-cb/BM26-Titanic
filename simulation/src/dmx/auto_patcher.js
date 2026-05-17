/**
 * auto_patcher.js — Centralized DMX auto-patching and patch management.
 *
 * Handles automatic address assignment for DMX fixtures, with awareness of
 * global effect fixtures (foggers, hazers, horns, fire) to prevent address
 * collisions. Extracted from gui_builder.js for maintainability.
 *
 * Usage:
 *   import { autoPatchAll, clearAllPatches, getOccupancyMap } from './auto_patcher.js';
 */

import { getDefinition } from '../dmx/fixture_definition_registry.js';

// ── Constants ───────────────────────────────────────────────────────────

const DMX_UNIVERSE_SIZE = 512;
const DMX_RESERVED_CHANNELS = [511, 512]; // Reserved in every universe for global effects (fog, fire, ...)
const DMX_USABLE_SIZE = 510;              // Last usable channel (512 - reserved)

// Fixture types that are global effects (not pixel-mapped lighting fixtures)
const GLOBAL_EFFECT_TYPES = ['TEFogMachine', 'ChauvetHaze4D'];
const GLOBAL_EFFECT_PATTERNS = ['Fog', 'Horn', 'Fire', 'Haze'];

/**
 * Check if a fixture type is a global effect (fogger, horn, fire, etc.)
 * @param {string} fixtureType
 * @returns {boolean}
 */
export function isGlobalEffect(fixtureType) {
  if (!fixtureType) return false;
  if (GLOBAL_EFFECT_TYPES.includes(fixtureType)) return true;
  return GLOBAL_EFFECT_PATTERNS.some(p => fixtureType.includes(p));
}

/**
 * Get the channel footprint for a fixture config.
 * @param {Object} config - fixture config object
 * @returns {number} footprint in channels
 */
export function getFootprint(config) {
  const fType = config.fixtureType || config.type || 'UkingPar';
  const fDef = getDefinition(fType);
  if (fDef) return fDef.footprint || fDef.channelMode || 10;
  // Fallback for known types
  if (fType === 'TEFogMachine') return 1;
  if (fType === 'ChauvetHaze4D') return 2;
  return 10;
}

/**
 * Gather a unique set of all fixture configs from the active GUI params and runtime simulation state.
 * @param {Object} params - The active GUI parameters object
 * @returns {Array} Array of unique fixture config objects
 */
export function gatherAllConfigs(params) {
  const configSet = new Set();
  
  if (params && params.parLights) {
    params.parLights.forEach(c => configSet.add(c));
  }
  if (typeof window !== 'undefined' && window.dmxSceneFixtures) {
    window.dmxSceneFixtures.forEach(f => {
      if (f && f.config) configSet.add(f.config);
    });
  }
  if (params && params.dmxFixtures) {
    params.dmxFixtures.forEach(c => configSet.add(c));
  }

  return Array.from(configSet);
}

/**
 * Build an occupancy map from a list of fixture configs.
 * Returns a Map<universe, Set<address>> of all occupied channels.
 *
 * @param {Array} fixtureList - array of fixture config objects
 * @param {Object} [options]
 * @param {boolean} [options.includeUnpatched=false] - include fixtures with no patch
 * @returns {Map<number, Set<number>>}
 */
export function getOccupancyMap(fixtureList, options = {}) {
  const occupied = new Map(); // universe -> Set of occupied channels

  if (!fixtureList) return occupied;

  for (const config of fixtureList) {
    const u = config.dmxUniverse;
    const addr = config.dmxAddress;
    if (!u || u < 1 || !addr || addr < 1) {
      if (!options.includeUnpatched) continue;
    }
    if (!u || !addr) continue;

    const fp = getFootprint(config);
    if (!occupied.has(u)) occupied.set(u, new Set());
    const uSet = occupied.get(u);
    for (let ch = addr; ch < addr + fp && ch <= DMX_UNIVERSE_SIZE; ch++) {
      uSet.add(ch);
    }
  }

  return occupied;
}

/**
 * Build a reservation map of global effect fixtures.
 * These addresses are reserved and must not be used by auto-patching.
 *
 * @param {Array} fixtureList - array of ALL fixture configs (including global effects)
 * @returns {Map<number, Set<number>>} universe -> Set of reserved channels
 */
export function getGlobalEffectReservations(fixtureList) {
  const reserved = new Map();

  if (!fixtureList) return reserved;

  for (const config of fixtureList) {
    const fType = config.fixtureType || config.type || '';
    if (!isGlobalEffect(fType)) continue;

    const u = config.dmxUniverse;
    const addr = config.dmxAddress;
    if (!u || u < 1 || !addr || addr < 1) continue;

    const fp = getFootprint(config);
    if (!reserved.has(u)) reserved.set(u, new Set());
    const uSet = reserved.get(u);
    for (let ch = addr; ch < addr + fp && ch <= DMX_UNIVERSE_SIZE; ch++) {
      uSet.add(ch);
    }
  }

  return reserved;
}

/**
 * Find the next free DMX address slot that doesn't conflict with
 * existing patches OR global effect reservations.
 *
 * @param {number} footprint - number of channels needed
 * @param {Map<number, Set<number>>} occupied - current occupancy map
 * @param {Map<number, Set<number>>} reserved - global effect reservations
 * @param {number} startUniverse - universe to start searching from
 * @param {number} startAddress - address to start searching from
 * @returns {{ universe: number, address: number }}
 */
function findFreeSlot(footprint, occupied, reserved, startUniverse, startAddress) {
  let universe = startUniverse;
  let address = startAddress;

  while (true) {
    // Check if the fixture footprint fits within the usable range (1-510)
    if (address + footprint - 1 > DMX_USABLE_SIZE) {
      universe++;
      address = 1;
      continue;
    }

    // Check for conflicts with existing patches and reserved channels (511-512)
    let conflict = false;
    const uOccupied = occupied.get(universe);
    const uReserved = reserved.get(universe);

    for (let ch = address; ch < address + footprint; ch++) {
      if (DMX_RESERVED_CHANNELS.includes(ch) ||
          (uOccupied && uOccupied.has(ch)) ||
          (uReserved && uReserved.has(ch))) {
        conflict = true;
        address = ch + 1;
        break;
      }
    }

    if (!conflict) {
      return { universe, address };
    }
  }
}

/**
 * Auto-patch all unpatched fixtures, respecting existing patches and
 * global effect reservations.
 *
 * @param {Array} fixtureList - array of fixture config objects (mutated in place)
 * @returns {{ patchedCount: number, maxUniverse: number }}
 */
export function autoPatchAll(fixtureList) {
  if (!fixtureList || fixtureList.length === 0) return { patchedCount: 0, maxUniverse: 1 };

  // Build occupancy from already-patched fixtures
  const occupied = getOccupancyMap(fixtureList);

  let patchedCount = 0;

  // 1. Patch Global Effects (Foggers, Horns, Fire) into Universe 1
  // The user explicitly requested hardcoded addresses for these via config.yaml.
  const globalEffectsConfig = (window.serverConfig && window.serverConfig.global_effects) || {};

  for (const config of fixtureList) {
    const fType = config.fixtureType || config.type || '';
    if (!isGlobalEffect(fType)) continue; // Not a global effect

    // Skip already-patched global effects (user may have set manually)
    if (config.dmxUniverse > 0 && config.dmxAddress > 0) {
      // Just register in occupancy so lighting fixtures avoid these addresses
      if (!occupied.has(config.dmxUniverse)) occupied.set(config.dmxUniverse, new Set());
      const uSet = occupied.get(config.dmxUniverse);
      const fp = getFootprint(config);
      for (let ch = config.dmxAddress; ch < config.dmxAddress + fp; ch++) uSet.add(ch);
      continue;
    }

    // Auto-assign from config.yaml defaults if unpatched
    const effectConfig = globalEffectsConfig[fType];
    if (effectConfig && effectConfig.universe !== undefined && effectConfig.address !== undefined) {
      config.dmxUniverse = effectConfig.universe;
      config.dmxAddress = effectConfig.address;
      patchedCount++;
    }

    if (config.dmxUniverse > 0) {
      if (!occupied.has(config.dmxUniverse)) occupied.set(config.dmxUniverse, new Set());
      const uSet = occupied.get(config.dmxUniverse);
      const fp = getFootprint(config);
      for (let ch = config.dmxAddress; ch < config.dmxAddress + fp; ch++) {
        uSet.add(ch);
      }
    }
  }

  // 2. Patch Lighting Fixtures starting at Universe 2
  let lightUniverse = 2;
  let lightAddress = 1;
  let maxUniverse = lightUniverse;

  // We re-build the reservation map now that global effects are patched
  const reserved = getGlobalEffectReservations(fixtureList);

  // ── Auto-assign metadata per unique group / controller ───────────────
  const groupToSectionId = {};
  let nextSectionId = 1;
  const ipToControllerId = {};
  let nextControllerId = 1;
  let nextFixtureId = 1;

  function assignMetadata(config) {
    // sectionId — per group
    const group = config.group || '';
    if (group && (!config.sectionId || config.sectionId <= 0)) {
      if (groupToSectionId[group] === undefined) groupToSectionId[group] = nextSectionId++;
      config.sectionId = groupToSectionId[group];
    }
    // controllerId — per unique controllerIp
    const ip = config.controllerIp || '';
    if (ip && (!config.controllerId || config.controllerId <= 0)) {
      if (ipToControllerId[ip] === undefined) ipToControllerId[ip] = nextControllerId++;
      config.controllerId = ipToControllerId[ip];
    }
    // fixtureId — sequential per fixture
    if (!config.fixtureId || config.fixtureId <= 0) {
      config.fixtureId = nextFixtureId++;
    }
  }

  for (const config of fixtureList) {
    if (config.dmxUniverse > 0 && config.dmxAddress > 0) {
      // Already patched — still assign metadata if missing
      assignMetadata(config);
      continue;
    }
    
    const fType = config.fixtureType || config.type || '';
    if (isGlobalEffect(fType)) continue; // Already handled above

    const fp = getFootprint(config);
    const slot = findFreeSlot(fp, occupied, reserved, lightUniverse, lightAddress);

    config.dmxUniverse = slot.universe;
    config.dmxAddress = slot.address;
    assignMetadata(config);

    if (!occupied.has(slot.universe)) occupied.set(slot.universe, new Set());
    const uSet = occupied.get(slot.universe);
    for (let ch = slot.address; ch < slot.address + fp; ch++) uSet.add(ch);

    lightAddress = slot.address + fp;
    lightUniverse = slot.universe;
    maxUniverse = Math.max(maxUniverse, lightUniverse);
    patchedCount++;
  }

  console.log(`[AutoPatcher] Assigned ${patchedCount} fixture(s), ${Object.keys(groupToSectionId).length} section(s):`, groupToSectionId);
  // Signal animate loop that patches are now active
  if (typeof window !== 'undefined' && window.setPatchesActive) window.setPatchesActive(patchedCount > 0);
  return { patchedCount, maxUniverse, groupToSectionId };
}

/**
 * Clear only metadata fields (sectionId, controllerId, fixtureId, viewMask)
 * without touching DMX patches (universe, address, controllerIp).
 *
 * @param {Array} fixtureList - array of fixture config objects (mutated in place)
 * @returns {number} number of fixtures cleared
 */
export function clearMetadata(fixtureList) {
  if (!fixtureList || fixtureList.length === 0) return 0;
  let cleared = 0;
  for (const config of fixtureList) {
    if (!config) continue;
    if (config.sectionId || config.controllerId || config.fixtureId || config.viewMask) cleared++;
    config.sectionId = 0;
    config.controllerId = 0;
    config.fixtureId = 0;
    config.viewMask = 0;
  }
  console.log(`[AutoPatcher] Cleared metadata on ${cleared} fixture(s)`);
  return cleared;
}

/**
 * Clear all DMX patches from fixture configs.
 * Iterates the actual params.parLights array directly.
 * Respects locked fixtures (via trace group locked flag).
 * Includes global effect fixtures (foggers, hazers, horns, fire).
 *
 * @param {Array} fixtureList - array of fixture config objects (mutated in place)
 * @param {Object} [options]
 * @param {boolean} [options.includeGlobalEffects=true] - also clear global effect patches
 * @param {Array} [options.traces] - trace definitions (to check locked groups)
 * @returns {number} number of fixtures cleared
 */
export function clearAllPatches(fixtureList, options = {}) {
  const includeGlobal = options.includeGlobalEffects !== false;
  let cleared = 0;

  if (!fixtureList || fixtureList.length === 0) return cleared;

  // Build a set of locked group names from traces
  const lockedGroups = new Set();
  const traces = options.traces || [];
  for (const t of traces) {
    if (t.locked) lockedGroups.add(t.groupName || t.name);
  }

  for (let i = 0; i < fixtureList.length; i++) {
    const config = fixtureList[i];
    if (!config) continue;

    const fType = config.fixtureType || config.type || '';
    const isLocked = config.group && lockedGroups.has(config.group);

    if (isLocked) continue;
    if (isGlobalEffect(fType) && !includeGlobal) continue;

    if (config.dmxUniverse > 0 || config.dmxAddress > 0) cleared++;

    // Force-zero all patch fields
    config.controllerIp = '';
    config.dmxUniverse = 0;
    config.dmxAddress = 0;
    config.controllerId = 0;
    config.sectionId = 0;
    config.fixtureId = 0;
    config.viewMask = 0;
  }

  // Clear router read buffers to prevent stale data persistence
  if (cleared > 0 && typeof window !== 'undefined' && window.dmxRouter) {
    try {
      for (let u = 1; u <= 4; u++) {
        const buf = window.dmxRouter.getFullFrame(u);
        if (buf) buf.fill(0);
      }
    } catch (e) {
      console.warn('[AutoPatcher] Buffer clear failed:', e);
    }
  }

  console.log(`[AutoPatcher] Cleared ${cleared} patch(es), zeroed ${fixtureList.length} fixture(s)`);
  // Signal animate loop that patches are now cleared
  if (typeof window !== 'undefined' && window.setPatchesActive) window.setPatchesActive(false);
  return cleared;
}

/**
 * Validate that no pixel/lighting fixture overlaps with global effect addresses.
 * Global effects (foggers, horns, fire) are excluded from validation — they are
 * allowed to occupy their own reserved channels. Only non-effect fixtures are checked.
 * Returns an array of collision descriptions (empty = no collisions).
 *
 * @param {Array} fixtureList
 * @returns {Array<string>}
 */
export function validatePatches(fixtureList) {
  const collisions = [];
  if (!fixtureList) return collisions;

  const reserved = getGlobalEffectReservations(fixtureList);

  for (const config of fixtureList) {
    const fType = config.fixtureType || config.type || '';
    if (isGlobalEffect(fType)) continue;

    const u = config.dmxUniverse;
    const addr = config.dmxAddress;
    if (!u || !addr) continue;

    const fp = getFootprint(config);
    const uReserved = reserved.get(u);
    if (!uReserved) continue;

    for (let ch = addr; ch < addr + fp && ch <= DMX_UNIVERSE_SIZE; ch++) {
      if (uReserved.has(ch)) {
        collisions.push(`${config.name || fType} (U${u}:${addr}+${fp}) overlaps global effect at ch${ch}`);
        break; // one collision per fixture is enough
      }
    }
  }

  return collisions;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function countReserved(reserved) {
  let total = 0;
  for (const [, set] of reserved) total += set.size;
  return total;
}
