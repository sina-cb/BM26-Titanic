/**
 * trace_group_rename.js — pure helpers for renaming a DMX trace generator's
 * group without orphaning its previously generated instances.
 *
 * Background: a trace ("Group Generator" card) generates par fixtures stamped
 * `group = trace.groupName`, `traceGenerated = true`. Renaming the trace used to
 * set `trace.groupName = trace.name` and then regenerate, but the regeneration
 * sweep only removed fixtures matching the NEW name — the OLD-named set was
 * orphaned forever (duplicate fixtures at identical coordinates, wasted view
 * bits). See report 20260724_37.
 *
 * These helpers make the rename safe and are the single source of truth for the
 * sweep, override carry, and fail-loud collision guard — no DOM / THREE, so they
 * are unit-tested directly (mirrors the LED-group rename plumbing, report _28).
 */

// Buckets a trace group can never be renamed to (they belong to other systems).
const RESERVED_GROUP_NAMES = new Set(['Ungrouped']);

/**
 * Validate a proposed new trace-group name. Returns an error string to show the
 * operator (fail loud, codex P0) or `null` when the rename is allowed. A merge
 * into an existing group would fuse two groups' overrides + view bits, so it is
 * rejected rather than silently absorbed.
 *
 * @param {string} newName   proposed name (already trimmed by the caller)
 * @param {object} opts
 * @param {Array}  opts.traces      params.traces
 * @param {Array}  opts.parLights   params.parLights
 * @param {number} opts.traceIndex  index of the trace being renamed
 * @param {string} opts.oldGroupName the trace's current group name
 * @returns {string|null}
 */
export function traceRenameError(newName, { traces, parLights, traceIndex, oldGroupName }) {
  if (!newName) return 'Group name cannot be empty.';
  if (newName === oldGroupName) return null;
  if (RESERVED_GROUP_NAMES.has(newName)) {
    return `"${newName}" is a reserved group name.`;
  }
  // Collision with any OTHER trace's group name.
  for (let i = 0; i < (traces || []).length; i++) {
    if (i === traceIndex) continue;
    const g = traces[i] && (traces[i].groupName || traces[i].name);
    if (g && g === newName) {
      return `A generator group named "${newName}" already exists.`;
    }
  }
  // Collision with any existing par group that is not this trace's own set.
  for (const light of parLights || []) {
    if (light.group && light.group === newName && light.group !== oldGroupName) {
      return `A group named "${newName}" already exists.`;
    }
  }
  return null;
}

/**
 * Split par fixtures into the survivors + the generated casualties for a
 * (re)generation, sweeping BOTH the current group name and any prior name.
 * Passing `previousGroupName` on a rename is what removes the old-named set so a
 * rename never orphans it. Non-generated fixtures in either group are preserved.
 *
 * @param {Array}  parLights
 * @param {string} groupName          the target (new) group name
 * @param {string|null} previousGroupName the prior name on a rename, else null
 * @returns {{ kept: Array, removed: Array }}
 */
export function sweepGeneratedInstances(parLights, groupName, previousGroupName = null) {
  const sweep = new Set([groupName]);
  if (previousGroupName && previousGroupName !== groupName) sweep.add(previousGroupName);
  const kept = [];
  const removed = [];
  for (const light of parLights || []) {
    if (sweep.has(light.group) && light.traceGenerated) removed.push(light);
    else kept.push(light);
  }
  return { kept, removed };
}

/**
 * Carry a group's master override (enabled / brightness / locked) across a
 * rename, keyed by group name. Mutates the map in place. No-op when there is no
 * override under the old name or when the name is unchanged.
 *
 * @param {object} groupOverrides params.groupOverrides
 * @param {string} oldName
 * @param {string} newName
 */
export function carryTraceGroupOverride(groupOverrides, oldName, newName) {
  if (!groupOverrides || oldName === newName) return;
  if (groupOverrides[oldName]) {
    groupOverrides[newName] = groupOverrides[oldName];
    delete groupOverrides[oldName];
  }
}
