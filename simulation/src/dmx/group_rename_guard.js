/**
 * group_rename_guard.js — ONE duplicate-group-name guard for the whole scene,
 * plus the loud wording a group rename owes the operator.
 *
 * WHY THIS EXISTS (report 20260725_52). Group names are a scene-wide namespace,
 * but until now every rename control policed only its OWN list:
 *
 *   • the par-group rename (`renderParGUI`) checked `groupOrder` — par groups only;
 *   • the LED-strand rename (`_ledGroupNameClash`) checked strand groups only;
 *   • neither checked the other, and neither checked `params.traces[*].groupName`.
 *
 * That is a real hole, not a theoretical one: par groups and strand groups render
 * into the SAME "LED Fixture Instances" list, and — more importantly — they share
 * three name-keyed stores. Renaming a par group onto a strand group's name (or the
 * reverse) fuses:
 *
 *   1. the view registry's group bit (`viewRegistryRenameGroup` → views.yaml
 *      `groupBits`), so two distinct groups collapse onto one MASK_* bit;
 *   2. the 2D Pixel Map `{group: …}` selectors, which then address both groups;
 *   3. the exported engine model, where every pixel carries `group: '<name>'`.
 *
 * Pure module (no DOM / THREE / window), so the guard is unit-tested directly and
 * both call sites share ONE definition of "this name is taken".
 *
 * Fail loud (codex P0): every entry point throws on a malformed scene bag rather
 * than guessing an empty namespace — under-reporting a collision is exactly the
 * silent merge this module exists to prevent.
 */

// Display bucket for strands carrying no group. Never a real group name, so it
// can never be renamed to or from.
export const RESERVED_GROUP_NAMES = Object.freeze(['Ungrouped']);

/**
 * Every group name in use anywhere in the scene:
 *   • `parLights[*].group`   — DMX + LED-class fixture groups
 *   • `ledStrands[*].group`  — LED strand groups (blank ⇒ the Ungrouped bucket,
 *                              which is display-only and deliberately excluded)
 *   • `traces[*].groupName`  — generator groups (config.js re-stamps
 *                              `traceGenerated` on a group-name match, so a
 *                              collision here silently converts a hand-placed
 *                              group into a generated one on the next load)
 *
 * @param {{parLights?: Array, ledStrands?: Array, traces?: Array}} scene
 * @returns {Set<string>} trimmed, non-empty names
 */
export function collectSceneGroupNames(scene) {
  if (!scene || typeof scene !== 'object') {
    throw new Error('[group_rename_guard] collectSceneGroupNames: scene bag must be an object');
  }
  const names = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) names.add(trimmed);
  };
  for (const light of scene.parLights || []) add(light && light.group);
  for (const strand of scene.ledStrands || []) add(strand && strand.group);
  for (const trace of scene.traces || []) add(trace && trace.groupName);
  return names;
}

/**
 * Validate a proposed group name against the WHOLE scene namespace.
 *
 * @param {string} newName        the proposed name (trimmed here, not by the caller)
 * @param {object} opts
 * @param {string|null} opts.currentName  the group being renamed (exempt from the
 *                                        collision check); null when seeding a NEW group
 * @param {Set<string>|Array<string>} opts.takenNames  from `collectSceneGroupNames`
 * @returns {string|null} an operator-facing error, or null when the name is free
 */
export function groupRenameError(newName, { currentName = null, takenNames } = {}) {
  if (!(takenNames instanceof Set) && !Array.isArray(takenNames)) {
    throw new Error('[group_rename_guard] groupRenameError: takenNames must be a Set or Array');
  }
  const trimmed = String(newName == null ? '' : newName).trim();
  if (trimmed.length === 0) return 'Group name cannot be empty.';
  if (RESERVED_GROUP_NAMES.includes(trimmed)) {
    return `"${trimmed}" is a reserved group name (the bucket for fixtures with no group).`;
  }
  if (currentName !== null && trimmed === String(currentName).trim()) return null;
  const taken = takenNames instanceof Set ? takenNames : new Set(takenNames);
  if (taken.has(trimmed)) {
    return `A group named "${trimmed}" already exists.\n\n` +
      'Group names are scene-wide: DMX groups, LED groups and generator groups share ' +
      'ONE namespace (the view-mask bit, the 2D Pixel Map selectors and the exported ' +
      'engine model are all keyed by group name). Merging two groups would fuse their ' +
      'view bit and their pixel-map selectors — pick a unique name.';
  }
  return null;
}

/**
 * The loud line a group rename owes the operator about the ENGINE MODEL.
 *
 * Every exported pixel carries `group: '<name>'` (pixelblaze_model_exporter.js)
 * and the viewmasks sidecar is validated against that exact group set — the engine
 * REFUSES a model whose groups drift from its sidecar. A rename therefore leaves
 * the engine's currently-loaded model naming a group that no longer exists, and
 * nothing about that is visible today: the sim's stale-model banner only fires on
 * a PIXEL COUNT change, which a rename does not cause.
 *
 * Display state (group master override, view bit, pixel-map selectors) follows the
 * name — that is handled at the call site and is deliberately NOT what this warns
 * about.
 *
 * @param {string} oldName
 * @param {string} newName
 * @param {number} memberCount  fixtures/strands carrying the group
 * @returns {string}
 */
export function formatModelStalenessWarning(oldName, newName, memberCount) {
  if (!Number.isInteger(memberCount) || memberCount < 0) {
    throw new Error('[group_rename_guard] formatModelStalenessWarning: ' +
      `memberCount must be an integer >= 0, got ${String(memberCount)}`);
  }
  return `  ⚠ ENGINE MODEL now STALE: ${memberCount} member(s) moved from group ` +
    `"${oldName}" to "${newName}", but the exported model + viewmasks sidecar still ` +
    `name "${oldName}". Re-export the model (Save) and reload it in the engine — ` +
    'until then, any pattern or view keyed on the group name will not match. The ' +
    'sim\'s stale-model banner does NOT catch this (it only watches the pixel count).';
}

/**
 * The header line for a group rename: what moved, and what is display state.
 *
 * @param {object} args
 * @param {string} args.oldName
 * @param {string} args.newName
 * @param {number} args.memberCount
 * @param {string} args.kind  'Par' | 'LED strand' (wording only)
 * @returns {string[]} lines, most-important first
 */
export function buildGroupRenameReport({ oldName, newName, memberCount, kind }) {
  if (typeof kind !== 'string' || kind.trim().length === 0) {
    throw new Error('[group_rename_guard] buildGroupRenameReport: kind must be a non-empty string');
  }
  return [
    `[Rename] ${kind} group "${oldName}" → "${newName}": ${memberCount} member(s) moved.`,
    '  👁 CARRIED (display state): group master (⏻ On / Brightness / 🔒 Lock), the ' +
      'group view-mask bit, and every 2D Pixel Map selector naming the group.',
    '  ✔ UNTOUCHED (mapping): fixture/strand NAMES and their DMX / sACN addresses — ' +
      'group membership is not a mapping key, so nothing was unmapped by this rename.',
    formatModelStalenessWarning(oldName, newName, memberCount),
  ];
}
