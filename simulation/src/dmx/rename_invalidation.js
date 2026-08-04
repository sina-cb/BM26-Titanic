/**
 * rename_invalidation.js — the LOUD half of the rename policy.
 *
 * OPERATOR RULING (2026-07-29, plan report 20260725_44 §3): renaming a
 * fixture or a generator group **checks the mapping and invalidates it,
 * loudly**. Every patch / address / metadata entry tied to the OLD names is
 * enumerated and reported one line per fixture (what was freed: controller,
 * IP, port, universe, address); the renamed fixtures come out honestly
 * UNMAPPED. Nothing carries over silently, and no old-name phantom survives
 * anywhere — not in the registry chains, not in `window.__globalPatchTree`.
 *
 * What the ruling does NOT invalidate is *display* state: the group master
 * override, the group's view-mask bit and a fixture's per-fixture view masks
 * (`viewMask` word 0 + `viewMaskHi` word 1) are view membership, not mapping,
 * so they follow the rename (each with its own log line, so the operator sees
 * the distinction). BOTH words travel — new custom views are allocated into
 * word 1 first, so carrying only `viewMask` would silently empty the views an
 * operator most recently created.
 *
 * This module is pure — no DOM, no THREE, no `window`. The registry side of
 * the work lives in `controller_registry.js`
 * (`describeFixtureMappings` / `invalidateFixtureMappings`); this module owns
 * the patch-tree pruning, the view-mask carry and the exact wording of the
 * report, so both are unit-testable without a browser.
 */

// Patch-tree fields that are MAPPING (invalidated by a rename) vs DISPLAY
// (carried across it). `sectionId`/`fixtureId` are engine-model identity
// minted by the projection from the mapping, so they are mapping too.
export const MAPPING_PATCH_FIELDS = [
  'controllerIp', 'dmxUniverse', 'dmxAddress', 'controllerId', 'sectionId', 'fixtureId',
];
export const DISPLAY_PATCH_FIELDS = ['viewMask', 'viewMaskHi'];

/**
 * The generated fixture names a group of `count` lights carries — the
 * `"<group> N"` contract every sticky-by-name store keys on.
 * THROWS on a bad count: guessing a roster would under-report the
 * invalidation, which is worse than not running at all (codex P0).
 */
export function generatedFixtureNames(groupName, count) {
  if (typeof groupName !== 'string' || groupName.length === 0) {
    throw new Error('generatedFixtureNames: groupName must be a non-empty string');
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`generatedFixtureNames: count must be an integer >= 0, got ${String(count)}`);
  }
  const names = [];
  for (let n = 1; n <= count; n++) names.push(`${groupName} ${n}`);
  return names;
}

/**
 * The old→new name pairs a group rename implies, positionally: chain number
 * N under the old group becomes chain number N under the new one. Used ONLY
 * to carry display state; addresses never travel these pairs.
 */
export function renamePairs(oldGroupName, newGroupName, count) {
  const from = generatedFixtureNames(oldGroupName, count);
  const to = generatedFixtureNames(newGroupName, count);
  return from.map((f, i) => ({ from: f, to: to[i] }));
}

/**
 * PRUNE the old-name keys out of the name-keyed patch tree. Old-name patch
 * entries linger forever today (report `_44` §3.2) and reappear as phantoms
 * the moment a fixture is created with that name again.
 *
 * Values are NOT copied to the new names — that would be the silent
 * carry-over the ruling bans. Returns one row per pruned key so the caller
 * prints what vanished.
 *
 * @returns {Array<{name: string, controllerIp: string, dmxUniverse: number,
 *   dmxAddress: number, controllerId: number, sectionId: number, fixtureId: number,
 *   viewMask: number, viewMaskHi: number, wasMapped: boolean}>}
 */
export function prunePatchTreeEntries(patchTree, names) {
  const pruned = [];
  if (!patchTree || typeof patchTree !== 'object') return pruned;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(patchTree, name)) continue;
    const rec = patchTree[name] || {};
    pruned.push({
      name,
      controllerIp: rec.controllerIp || '',
      dmxUniverse: rec.dmxUniverse || 0,
      dmxAddress: rec.dmxAddress || 0,
      controllerId: rec.controllerId || 0,
      sectionId: rec.sectionId || 0,
      fixtureId: rec.fixtureId || 0,
      viewMask: rec.viewMask || 0,
      viewMaskHi: rec.viewMaskHi || 0,
      wasMapped: !!(rec.controllerIp || rec.dmxUniverse || rec.dmxAddress),
    });
    delete patchTree[name];
  }
  return pruned;
}

/**
 * Carry per-fixture view masks across a rename — BOTH words. View membership
 * is display state, not mapping (ruling), so it follows the name the way the
 * group master override and the group view bit already do.
 *
 * Reads the OLD masks from `oldMasks` (a name → `{viewMask, viewMaskHi}`
 * lookup the caller snapshots BEFORE the patch tree is pruned) and stamps
 * them onto the new configs. Both words are required in the entry — word 1 is
 * where the view allocator puts NEW custom views, so a word-0-only carry
 * would drop exactly the memberships an operator just made.
 *
 * Returns one row per entry that actually carried a non-zero word.
 *
 * @param {Map<string, {viewMask: number, viewMaskHi: number}>|object} oldMasks
 * @param {Map<string, object>} configsByName live configs, keyed by their NEW names
 * @param {Array<{from: string, to: string}>} pairs
 */
export function carryViewMasks(oldMasks, configsByName, pairs) {
  const get = (k) => (oldMasks instanceof Map ? oldMasks.get(k) : (oldMasks || {})[k]);
  const carried = [];
  for (const { from, to } of pairs) {
    const entry = get(from);
    if (!entry) continue;
    const viewMask = entry.viewMask || 0;
    const viewMaskHi = entry.viewMaskHi || 0;
    if (!viewMask && !viewMaskHi) continue;
    const config = configsByName.get(to);
    if (!config) continue;
    config.viewMask = viewMask;
    config.viewMaskHi = viewMaskHi;
    carried.push({ from, to, viewMask, viewMaskHi });
  }
  return carried;
}

/**
 * Duplicate-name guard. Duplicate fixture names collapse to ONE record in
 * the derived patches.yaml (save-server.js:210) and a doubly-mapped pair
 * hard-fails the next scene load, so a duplicate must be refused at the
 * input, not repaired later.
 *
 * @param {string} newName
 * @param {Iterable<string>} takenNames every other fixture/strand name in the scene
 * @returns {string|null} operator-facing error, or null when the name is free
 */
export function duplicateNameError(newName, takenNames) {
  const trimmed = String(newName == null ? '' : newName).trim();
  if (trimmed.length === 0) return 'Fixture name cannot be empty.';
  for (const taken of takenNames) {
    if (taken === trimmed) {
      return `A fixture named "${trimmed}" already exists.\n\n` +
        'Duplicate names collapse to a single patch record and break the next scene ' +
        'load — pick a unique name.';
    }
  }
  return null;
}

/** One human line per freed chain entry. */
export function formatMappingLine(row) {
  const where = row.controllerName || '(unnamed controller)';
  const ip = row.controllerIp || 'no IP';
  return `  ✂ "${row.fixture}" — mapping INVALIDATED: was ${where} (${ip}) · Port ` +
    `${row.port} · U${row.universe} · addr ${row.address} → now UNMAPPED`;
}

/** One human line per pruned patch-tree phantom. */
export function formatPatchLine(row) {
  const detail = row.wasMapped
    ? `U${row.dmxUniverse}:${row.dmxAddress} @${row.controllerIp || '—'}, ` +
      `ctrlId ${row.controllerId}, sectionId ${row.sectionId}, fixtureId ${row.fixtureId}`
    : 'unpatched record';
  return `  🗑 patch-tree entry pruned: "${row.name}" (${detail}) — no phantom left behind`;
}

/**
 * Build the fixture-by-fixture invalidation report the operator sees.
 *
 * @param {object} args
 * @param {string} args.oldLabel  the old fixture/group name
 * @param {string} args.newLabel  the new fixture/group name
 * @param {string} [args.scope]   'group' | 'fixture' (wording only)
 * @param {Array}  args.chainRows rows from `invalidateFixtureMappings`
 * @param {Array}  args.patchRows rows from `prunePatchTreeEntries`
 * @param {Array}  [args.carriedViewMasks] rows from `carryViewMasks`
 * @param {Array}  [args.carriedDisplayNotes] extra display-state lines (strings)
 * @returns {{lines: string[], summary: string, invalidatedCount: number,
 *   prunedCount: number}}
 */
export function buildInvalidationReport({
  oldLabel, newLabel, scope = 'fixture', chainRows = [], patchRows = [],
  carriedViewMasks = [], carriedDisplayNotes = [],
}) {
  const lines = [];
  const invalidatedCount = chainRows.length;
  const prunedCount = patchRows.length;
  const what = scope === 'group' ? 'Generator group' : 'Fixture';

  if (invalidatedCount > 0) {
    lines.push(`${what} rename "${oldLabel}" → "${newLabel}": CHECK + INVALIDATE ` +
      `(operator ruling 2026-07-29). ${invalidatedCount} fixture(s) lose their mapping ` +
      'and come out UNMAPPED — nothing was carried to the new name.');
  } else {
    lines.push(`${what} rename "${oldLabel}" → "${newLabel}": checked the mapping — ` +
      'nothing was mapped under the old name(s), so there was no mapping to invalidate.');
  }
  for (const row of chainRows) lines.push(formatMappingLine(row));
  for (const row of patchRows) lines.push(formatPatchLine(row));
  for (const row of carriedViewMasks) {
    // Both words are named so the operator can tell WHICH views moved; a
    // word-1-only membership used to print "viewMask 0x0" and read as a no-op.
    lines.push(`  👁 view membership carried: "${row.from}" → "${row.to}" ` +
      `(viewMask 0x${(row.viewMask || 0).toString(16)}, ` +
      `viewMaskHi 0x${(row.viewMaskHi || 0).toString(16)}) — display state, not mapping`);
  }
  for (const note of carriedDisplayNotes) lines.push(`  👁 ${note}`);
  if (invalidatedCount > 0) {
    lines.push(`  ↳ Re-map these ${invalidatedCount} fixture(s) deliberately in the ` +
      'Controllers panel. Addresses were NOT migrated to the new names (the opt-in ' +
      '"⇄ Migrate addresses to new name" affordance is operator-gated and not built).');
  }

  let summary;
  if (invalidatedCount > 0) {
    summary = `Rename invalidated the mapping of ${invalidatedCount} fixture(s) — they are ` +
      'now UNMAPPED; re-map deliberately in the Controllers panel';
  } else if (prunedCount > 0) {
    summary = `Renamed "${oldLabel}" → "${newLabel}" — nothing was mapped; ` +
      `${prunedCount} stale patch entr(ies) pruned`;
  } else {
    summary = `Renamed "${oldLabel}" → "${newLabel}" — nothing was mapped under the old name`;
  }

  return { lines, summary, invalidatedCount, prunedCount };
}
