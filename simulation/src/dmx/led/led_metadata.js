// LED strand metadata — group keying + section/fixture id auto-assignment.
//
// This is the LED mirror of the DMX metadata pass in
// controller_registry.js::projectOntoConfigs (sectionId per group, fixtureId
// monotonic). It is a PURE module (no DOM, no I/O) so the numbering rules are
// unit-testable in isolation.
//
// Two invariants the caller (main.js window.projectLedStrandPatches) enforces
// by CALL ORDER, and this module preserves by construction:
//   1. DMX-first: projectControllerMappings (DMX numbering) always runs before
//      projectLedStrandPatches (this pass) at every call site, so the DMX
//      section/fixture ids are FINAL here. This module floors its counters at
//      the max over the DMX ∪ LED union, so every LED id it mints is strictly
//      greater than every id already in use — mutual exclusion.
//      projectOntoConfigs floors on that SAME union (it takes params.ledStrands
//      for exactly this reason), so neither pass can mint an id the other owns.
//      Note the guarantee is EXCLUSION, not global ordering: a one-time DMX
//      collision repair there (report 20260725_34) can lift a DMX id above an
//      existing LED id. Nothing may assume "all LED ids > all DMX ids".
//   2. Namespace isolation: the LED group→section map is separate from DMX's,
//      so a DMX group and an LED group that happen to share a name still get
//      different section ids.
//
// Like DMX, nothing here is persisted as a counter — the "counter" is the max
// over already-assigned ids, re-derived each pass. Stickiness of existing
// positive ids is what keeps the result stable across reloads.

/**
 * Effective group key for an LED strand — the SINGLE source of truth used by
 * both the exporter (pixel.group / view bits) and this metadata pass (section
 * numbering), so the two can never disagree.
 *
 * Rule: `strand.group || strand.name`. An ungrouped strand remains its own
 * group of one, which keeps every existing scene's exported model bit-for-bit
 * identical (no migration).
 *
 * Fail loud (codex P0): a strand with neither a non-empty `group` nor a
 * non-empty `name` has no stable key — throw rather than invent a fallback.
 *
 * @param {Object} strand - an LED strand config
 * @returns {string} the effective group key
 */
export function groupKeyForStrand(strand) {
  if (!strand || typeof strand !== 'object') {
    throw new Error('[led_metadata] groupKeyForStrand: strand must be an object');
  }
  const group = typeof strand.group === 'string' ? strand.group.trim() : '';
  if (group.length > 0) return group;
  const name = typeof strand.name === 'string' ? strand.name.trim() : '';
  if (name.length > 0) return name;
  throw new Error(
    '[led_metadata] groupKeyForStrand: strand has neither a non-empty `group` ' +
    'nor a non-empty `name` — no stable group key (codex P0: fail loud, no ' +
    'fallback id)');
}

/**
 * Assign sectionId / fixtureId to LED strands, mirroring the DMX rules and
 * continuing the SHARED id space after the DMX max.
 *
 *  - sectionId: one section per effective group (groupKeyForStrand). Existing
 *    positive ids are kept (sticky, never renumbered); each new group gets the
 *    next free id above the DMX floor.
 *  - fixtureId: existing positive ids kept; each strand without one gets the
 *    next free monotonic id above the DMX floor.
 *
 * controllerId is NOT assigned here — it is the owning controller's panel
 * ordinal, derived at projection/export time (led_patch_projection /
 * computeLedProjection), exactly as the plan specifies.
 *
 * Strands are mutated in place. Walk order is the `strands` array order, which
 * is the scene YAML order — deterministic.
 *
 * @param {Array<Object>} strands - params.ledStrands (mutated in place)
 * @param {Array<Object>} dmxConfigs - all DMX fixture configs already numbered
 *   this pass (gatherAllConfigs output); the section/fixture floors come from
 *   their max ids.
 * @returns {{ assigned: Array, maxSectionId: number, maxFixtureId: number }}
 */
export function assignLedStrandMetadata(strands, dmxConfigs) {
  const strandList = Array.isArray(strands) ? strands : [];
  const dmxList = Array.isArray(dmxConfigs) ? dmxConfigs : [];

  // 1. Floors = max existing id across BOTH namespaces (DMX ∪ LED). Because
  //    DMX ids are final by call-order, flooring at the DMX max makes every
  //    minted LED id strictly greater than every DMX id (mutual exclusion).
  //    A gap in the DMX ids is respected — the floor is the MAX, not a count.
  let sectionFloor = 0;
  let fixtureFloor = 0;
  for (const config of dmxList) {
    if (!config) continue;
    if (config.sectionId > 0) sectionFloor = Math.max(sectionFloor, config.sectionId);
    if (config.fixtureId > 0) fixtureFloor = Math.max(fixtureFloor, config.fixtureId);
  }
  for (const strand of strandList) {
    if (!strand) continue;
    if (strand.sectionId > 0) sectionFloor = Math.max(sectionFloor, strand.sectionId);
    if (strand.fixtureId > 0) fixtureFloor = Math.max(fixtureFloor, strand.fixtureId);
  }

  // 2. Seed the LED group→section map from strands already carrying a positive
  //    sectionId (sticky — mirror of projectOntoConfigs:1667-1669). A group's
  //    existing id is never renumbered, so re-runs are idempotent.
  const ledGroupToSectionId = new Map();
  for (const strand of strandList) {
    if (!strand) continue;
    const key = groupKeyForStrand(strand);
    if (strand.sectionId > 0 && !ledGroupToSectionId.has(key)) {
      ledGroupToSectionId.set(key, strand.sectionId);
    }
  }

  // 3. Walk strands in array order: assign one section id per group and a
  //    monotonic fixture id where missing.
  const assigned = [];
  for (const strand of strandList) {
    if (!strand) continue;
    const key = groupKeyForStrand(strand);
    if (!(strand.sectionId > 0)) {
      if (!ledGroupToSectionId.has(key)) {
        sectionFloor += 1;
        ledGroupToSectionId.set(key, sectionFloor);
      }
      strand.sectionId = ledGroupToSectionId.get(key);
    }
    if (!(strand.fixtureId > 0)) {
      fixtureFloor += 1;
      strand.fixtureId = fixtureFloor;
    }
    assigned.push({
      name: strand.name,
      group: key,
      sectionId: strand.sectionId,
      fixtureId: strand.fixtureId,
    });
  }

  return { assigned, maxSectionId: sectionFloor, maxFixtureId: fixtureFloor };
}
