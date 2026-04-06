/**
 * patch_registry.js — Maps fixtures to DMX universe/channel addresses.
 *
 * Parses the `universes:` block from the unified config and builds
 * a lookup table: fixtureId → { universe, addr, footprint }.
 *
 * Validates:
 *   - No overlapping addresses within a universe
 *   - No fixture overflows past channel 512
 *   - All fixture IDs are unique
 */

// Internal state
const _patches = {};       // fixtureId → PatchDef
const _universes = {};     // universeId → { name, fixtures[], output }

/**
 * Initialize the patch registry from the unified config.
 * @param {Object} universesConfig - The `universes` block from scene_config.yaml
 * @param {Object} fixtureRegistry - FixtureDefinitionRegistry (for footprint lookup)
 */
export function initPatchRegistry(universesConfig, fixtureRegistry) {
  Object.keys(_patches).forEach(k => delete _patches[k]);
  Object.keys(_universes).forEach(k => delete _universes[k]);

  if (!universesConfig) return;
  const errors = [];

  for (const [univId, univConfig] of Object.entries(universesConfig)) {
    if (univId.startsWith('_')) continue; // skip metadata keys

    const univNum = parseInt(univId, 10);
    if (isNaN(univNum)) continue;

    _universes[univNum] = {
      name: univConfig.name || `Universe ${univNum}`,
      output: univConfig.output || null,
      fixtures: [],
    };

    const fixtures = univConfig.fixtures || [];
    const occupied = []; // [start, end] ranges for overlap check

    for (const fix of fixtures) {
      if (!fix.id) {
        errors.push(`Universe ${univNum}: fixture missing 'id'`);
        continue;
      }

      if (_patches[fix.id]) {
        errors.push(`Duplicate fixture id '${fix.id}' (first in universe ${_patches[fix.id].universe})`);
        continue;
      }

      // Resolve footprint from fixture type
      let footprint = fix.footprint || 0;
      if (!footprint && fix.type && fixtureRegistry) {
        const def = fixtureRegistry.getDefinition ? fixtureRegistry.getDefinition(fix.type) : null;
        if (def) footprint = def.footprint || 0;
      }
      // Fallback: try layout path channel count
      if (!footprint && fix.layout) {
        const match = fix.layout.match(/channels?_(\d+)/);
        if (match) footprint = parseInt(match[1], 10);
      }

      const addr = fix.addr || 1;
      const endAddr = addr + footprint - 1;

      // Validate bounds
      if (endAddr > 512) {
        errors.push(`Fixture '${fix.id}' overflows universe ${univNum}: addr ${addr} + footprint ${footprint} = ${endAddr} > 512`);
      }

      // Validate overlaps
      for (const [oStart, oEnd, oId] of occupied) {
        if (addr <= oEnd && endAddr >= oStart) {
          errors.push(`Overlap in universe ${univNum}: '${fix.id}' [${addr}-${endAddr}] overlaps '${oId}' [${oStart}-${oEnd}]`);
        }
      }
      occupied.push([addr, endAddr, fix.id]);

      const patchDef = {
        id: fix.id,
        universe: univNum,
        addr: addr,
        footprint: footprint,
        type: fix.type || null,
        layout: fix.layout || null,
        locked: true, // All patched fixtures are locked by default
      };

      _patches[fix.id] = patchDef;
      _universes[univNum].fixtures.push(patchDef);
    }
  }

  if (errors.length > 0) {
    console.warn(`[PatchRegistry] ${errors.length} validation error(s):`);
    errors.forEach(e => console.warn(`  ⚠️ ${e}`));
  }

  const totalPatched = Object.keys(_patches).length;
  const univCount = Object.keys(_universes).length;
  console.log(`[PatchRegistry] ${totalPatched} patch(es) across ${univCount} universe(s)`);
}

/**
 * Get the patch definition for a fixture.
 * @param {string} fixtureId - The fixture's patch ID (e.g. "par_1")
 * @returns {Object|null} PatchDef or null if unpatched
 */
export function getFixturePatch(fixtureId) {
  return _patches[fixtureId] || null;
}

/**
 * Get all patches in a given universe.
 * @param {number} universeId
 * @returns {Object[]} Array of PatchDef
 */
export function getUniversePatches(universeId) {
  return _universes[universeId]?.fixtures || [];
}

/**
 * Get all universe IDs.
 * @returns {number[]}
 */
export function listUniverses() {
  return Object.keys(_universes).map(Number);
}

/**
 * Get universe config.
 * @param {number} universeId
 * @returns {Object|null}
 */
export function getUniverse(universeId) {
  return _universes[universeId] || null;
}

/**
 * Find a free slot in a universe for a given footprint.
 * @param {number} universeId
 * @param {number} footprint
 * @returns {number|null} Start address, or null if no space
 */
export function findFreeSlot(universeId, footprint) {
  const patches = getUniversePatches(universeId);
  const occupied = patches.map(p => [p.addr, p.addr + p.footprint - 1]).sort((a, b) => a[0] - b[0]);

  let searchFrom = 1;
  for (const [start, end] of occupied) {
    if (searchFrom + footprint - 1 < start) {
      return searchFrom;
    }
    searchFrom = end + 1;
  }

  // Check remaining space at end
  if (searchFrom + footprint - 1 <= 512) {
    return searchFrom;
  }
  return null;
}
