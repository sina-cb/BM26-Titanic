/**
 * orphan_fixtures.js — detection + dependency enumeration for ORPHANED
 * generated fixtures.
 *
 * THE CLASS (report 20260725_51). A fixture written by a generator carries
 * `traceGenerated: true` and lives in the generator's group. When the owning
 * trace is deleted or re-created under a different name, its fixtures can be
 * left behind: they still CLAIM generator origin, but nothing owns them any
 * more. Those ghosts are invisible to every generator workflow (no card, no
 * Regenerate, no ⛓ Chain Order), and until now they were undeletable through
 * the UI — the generated-fixture card has no ✕ Remove, the group card's
 * ✕ Delete only re-homes, and the trace card that would sweep them does not
 * exist. Removing them took manual scene surgery by a coordinator.
 *
 * They are not free. Measured on the operator's scene: 97 of 987 exported
 * model pixels, 12 phantom `unmapped_fixture` parity errors, a permanent
 * 5-cm-overlap toast on every rebuild, and duplicate entries in the
 * Controllers Unmapped tray that invite patching a real controller onto a
 * phantom. Worse, they hold their group NAME hostage: `traceRenameError`
 * refuses to rename a live generator onto a name an orphan already occupies.
 *
 * THE DETECTION RULE, stated once (§`isOrphanFixture`):
 *
 *     orphan  ⇔  the fixture CLAIMS generator origin
 *                AND no live trace owns its group
 *
 * Both halves matter. A hand-placed fixture never claims generator origin, so
 * it is never an orphan no matter how few generators the scene has — that is
 * the false positive this module must not produce (the TE Sign halves are
 * generator OUTPUT but are deliberately stamped `traceGenerated: false`,
 * precisely because no persistent generator survives them). And a generator
 * whose display name drifted from its group name still owns its fixtures:
 * ownership is keyed on `trace.groupName || trace.name`, never on
 * `trace.name` alone.
 *
 * NO GUESSING (codex P0). Only the boolean literal `true` is a claim; any
 * other value — `false`, `undefined`, a string, a missing key — is UNKNOWN
 * provenance and is NOT an orphan. And a scene whose generator list cannot be
 * read is never scanned at all: this module THROWS rather than report every
 * generated fixture in the scene as ownerless.
 *
 * Pure module — no DOM, no THREE, no `window`, no registry internals. The
 * caller passes the live state in (the registry rows come from
 * `describeFixtureMappings`, the pixel counts from the runtime fixtures), so
 * every rule here is unit-testable without a browser.
 */

// ─── Provenance ────────────────────────────────────────────────────────────

/** The fixture says a generator made it. */
export const PROVENANCE_GENERATOR = 'generator';
/** The fixture makes no such claim — hand-placed, or provenance unknown. */
export const PROVENANCE_HAND_PLACED = 'hand_placed';

/**
 * What a fixture CLAIMS about its own origin. Strictly `=== true`: a scene
 * file can carry anything, and upgrading a truthy-ish value into a claim is
 * exactly the guess that would delete a hand-placed fixture.
 */
export function fixtureProvenance(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('[Orphans] fixtureProvenance: config must be a plain object, got ' +
      `${JSON.stringify(config)}`);
  }
  return config.traceGenerated === true ? PROVENANCE_GENERATOR : PROVENANCE_HAND_PLACED;
}

/**
 * The set of group names LIVE generators own.
 *
 * Ownership key is `trace.groupName || trace.name` — the same expression
 * `generateGroupFromTrace` / `sweepGeneratedInstances` / `config.js` use. A
 * trace renamed in the UI keeps owning its fixtures through `groupName`, so
 * keying on `name` alone would report a whole live group as orphaned.
 *
 * THROWS on a non-array `traces`, and on a trace whose owner key cannot be
 * read: an under-counted owner set turns live fixtures into deletion
 * candidates, which is the one mistake this module must never make.
 */
export function generatorGroupNames(traces) {
  if (!Array.isArray(traces)) {
    throw new Error('[Orphans] generatorGroupNames: traces must be an array — a scene ' +
      'whose generator list cannot be read must NOT be scanned for orphans, or every ' +
      'generated fixture in it would look ownerless.');
  }
  const names = new Set();
  traces.forEach((trace, i) => {
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
      throw new Error(`[Orphans] generatorGroupNames: traces[${i}] is not an object ` +
        `(${JSON.stringify(trace)}) — refusing to scan with an unreadable generator list.`);
    }
    const owner = (typeof trace.groupName === 'string' && trace.groupName.length > 0)
      ? trace.groupName
      : trace.name;
    if (typeof owner !== 'string' || owner.length === 0) {
      throw new Error(`[Orphans] generatorGroupNames: traces[${i}] has neither a ` +
        'groupName nor a name — its fixtures cannot be told apart from orphans.');
    }
    names.add(owner);
  });
  return names;
}

/**
 * THE RULE. `ownerGroupNames` must come from `generatorGroupNames`.
 *
 * A generator-claiming fixture with NO group at all is an orphan: no trace can
 * own a group that does not exist. That is a determination, not a guess.
 */
export function isOrphanFixture(config, ownerGroupNames) {
  if (!(ownerGroupNames instanceof Set)) {
    throw new Error('[Orphans] isOrphanFixture: ownerGroupNames must be a Set from ' +
      'generatorGroupNames()');
  }
  if (fixtureProvenance(config) !== PROVENANCE_GENERATOR) return false;
  const group = typeof config.group === 'string' ? config.group : '';
  if (group.length === 0) return true;
  return !ownerGroupNames.has(group);
}

/**
 * The record arrays a scene keeps fixtures in. LED fixtures and DMX fixtures
 * ARE BOTH FIXTURES (operator, 2026-07-30) — the rule, the badge and the
 * delete flow are identical for both, so the scan is bus-agnostic and the row
 * simply remembers which array it came out of.
 *
 * Note that the LED-CLASS par fixtures (the TE Sign V3 halves) live in
 * `parLights` and are merely HOMED under the LED Fixtures drawer, so they are
 * already covered by the `dmx` array here; `ledStrands` is the separate strand
 * record list. Groups share ONE namespace across both (group_rename_guard.js),
 * which is why membership below is counted across both.
 */
export function sceneRecordSources(scene) {
  if (!scene || typeof scene !== 'object') {
    throw new Error('[Orphans] scene must be an object');
  }
  const { parLights, ledStrands } = scene;
  if (!Array.isArray(parLights)) {
    throw new Error('[Orphans] scene.parLights must be an array');
  }
  if (ledStrands !== undefined && ledStrands !== null && !Array.isArray(ledStrands)) {
    throw new Error('[Orphans] scene.ledStrands must be an array when present — a record ' +
      'list that cannot be read must not be half-scanned.');
  }
  return [
    { bus: 'dmx', records: parLights },
    { bus: 'led', records: ledStrands || [] },
  ];
}

/** Every fixture record in the scene, both buses — group membership counting. */
export function allSceneRecords(scene) {
  const out = [];
  for (const { records } of sceneRecordSources(scene)) out.push(...records);
  return out;
}

/**
 * Every orphan in the scene, DMX records first then LED strands, each in its
 * own array order.
 *
 * @param {{parLights: Array, ledStrands?: Array, traces: Array}} scene
 * @returns {Array<{index, name, group, config, bus, records}>}
 *   `name` is null when the fixture has no usable name — such a fixture cannot
 *   be enumerated (every dependent store is name-keyed) and the delete path
 *   refuses it rather than deleting blind. `records` is the array the record
 *   lives in, so the delete splices the right one without re-deriving the bus.
 */
export function findOrphanFixtures(scene) {
  const owners = generatorGroupNames(scene && scene.traces);
  const found = [];
  for (const { bus, records } of sceneRecordSources(scene)) {
    records.forEach((config, index) => {
      if (!config || typeof config !== 'object') return;
      if (!isOrphanFixture(config, owners)) return;
      found.push({
        index,
        name: (typeof config.name === 'string' && config.name.length > 0) ? config.name : null,
        group: typeof config.group === 'string' ? config.group : '',
        config,
        bus,
        records,
      });
    });
  }
  return found;
}

/**
 * Per-group roll-up, in group-appearance order — what the group cards and the
 * Generators-section banner render.
 *
 * `allOrphans` distinguishes the two removal affordances: a fully orphaned
 * group can be swept in one click; a MIXED group offers only its orphan
 * members and says so, because the live members belong to somebody.
 *
 * @returns {Array<{group, memberCount, orphanCount, allOrphans, orphans}>}
 */
export function orphanGroupSummary(scene) {
  const orphans = findOrphanFixtures(scene);
  const byGroup = new Map();
  for (const row of orphans) {
    if (!byGroup.has(row.group)) byGroup.set(row.group, []);
    byGroup.get(row.group).push(row);
  }
  // Group membership spans BOTH buses — par groups, LED-class par groups and
  // LED strand groups share one namespace (group_rename_guard.js), so a group
  // is only "all orphans" when nothing of either kind survives in it.
  const memberCounts = new Map();
  for (const config of allSceneRecords(scene)) {
    if (!config || typeof config !== 'object') continue;
    const g = typeof config.group === 'string' ? config.group : '';
    memberCounts.set(g, (memberCounts.get(g) || 0) + 1);
  }
  const out = [];
  for (const [group, rows] of byGroup) {
    const memberCount = memberCounts.get(group) || rows.length;
    out.push({
      group,
      memberCount,
      orphanCount: rows.length,
      allOrphans: rows.length === memberCount,
      orphans: rows,
    });
  }
  return out;
}

/** Total orphan count — the number the Generators section header shows. */
export function orphanCount(scene) {
  return findOrphanFixtures(scene).length;
}

// ─── Dependency enumeration ────────────────────────────────────────────────
// A destructive scene operation enumerates its dependents LOUDLY before it
// acts (report 20260725_47). Nothing here mutates: this is the read that the
// confirm dialog is built from, and if it cannot be completed the delete is
// refused rather than performed blind.

/**
 * `{name: '<fixture>'}` selectors in a 2D Pixel Map views container, plus the
 * per-view `offsets` / `placements` entries keyed by the fixture's name (the
 * `fixKey` defaults to the fixture name — pixel_map_layout.js).
 *
 * @returns {{selectors: Array<{view, panel, where, index, lastInSelect: boolean}>,
 *   offsets: string[], placements: string[]}}
 */
export function pixelMapReferences(container, fixtureName) {
  const refs = { selectors: [], offsets: [], placements: [] };
  if (!container || !Array.isArray(container.views)) return refs;
  if (typeof fixtureName !== 'string' || fixtureName.length === 0) {
    throw new Error('[Orphans] pixelMapReferences needs a non-empty fixtureName');
  }
  for (const view of container.views) {
    for (const panel of view.panels || []) {
      for (const where of ['select', 'exclude']) {
        const list = panel[where];
        if (!Array.isArray(list)) continue;
        list.forEach((sel, index) => {
          if (!sel || sel.name !== fixtureName) return;
          refs.selectors.push({
            view: view.id,
            panel: panel.id,
            where,
            index,
            // A panel's `select` may never become empty (validatePanelDef), so
            // this flag is what makes the delete refuse instead of corrupting
            // the views tree.
            lastInSelect: where === 'select' && list.length === 1,
          });
        });
      }
    }
    if (view.offsets && Object.prototype.hasOwnProperty.call(view.offsets, fixtureName)) {
      refs.offsets.push(view.id);
    }
    if (view.placements && Object.prototype.hasOwnProperty.call(view.placements, fixtureName)) {
      refs.placements.push(view.id);
    }
  }
  return refs;
}

/**
 * `{group: '<group>'}` selectors — enumerated (never rewritten) when a delete
 * would empty the group, because those panels go zero-match afterwards and the
 * operator should hear it BEFORE, not from an empty pane later.
 */
export function groupSelectorReferences(container, groupName) {
  const rows = [];
  if (!container || !Array.isArray(container.views)) return rows;
  for (const view of container.views) {
    for (const panel of view.panels || []) {
      for (const where of ['select', 'exclude']) {
        const list = panel[where];
        if (!Array.isArray(list)) continue;
        list.forEach((sel, index) => {
          if (!sel || sel.group !== groupName) return;
          rows.push({ view: view.id, panel: panel.id, where, index });
        });
      }
    }
  }
  return rows;
}

/** True when this live config still carries a real DMX patch. */
function patchIsLive(config) {
  return !!(
    (config.controllerIp && String(config.controllerIp).length > 0) ||
    (Number(config.dmxUniverse) > 0) ||
    (Number(config.dmxAddress) > 0)
  );
}

/**
 * Enumerate everything that depends on the named orphans. READ-ONLY.
 *
 * THROWS whenever a dependent store cannot be read. That is the contract the
 * delete path relies on: "could not enumerate" must become a refusal, never a
 * blind splice (codex P0 — no fallbacks).
 *
 * @param {Array<{index, name, group, config, bus}>} rows from `findOrphanFixtures`
 * @param {object} sources
 * @param {Array}  sources.allRecords    every fixture record in the scene, BOTH
 *   buses (group membership — groups share one namespace across DMX and LED)
 * @param {object} sources.patchTree     name-keyed `window.__globalPatchTree`
 * @param {Array}  sources.chainRows     rows from `describeFixtureMappings`
 * @param {object|null} sources.pixelMapViews  views container (null ⇒ none loaded)
 * @param {Map<string, number>} sources.pixelCounts  name → exported pixel count,
 *   from the bound runtime fixtures. This is the engine-model dependency: the
 *   exporter emits every fixture that has pixels, mapped or not, so a live
 *   pixel count IS presence in the model that was last exported.
 * @returns {{rows: Array, totals: object, blockers: string[]}}
 */
export function enumerateOrphanDependents(rows, sources) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('[Orphans] enumerateOrphanDependents: needs a non-empty row list');
  }
  if (!sources || typeof sources !== 'object') {
    throw new Error('[Orphans] enumerateOrphanDependents: sources must be an object');
  }
  const { allRecords, patchTree, chainRows, pixelMapViews, pixelCounts } = sources;
  if (!Array.isArray(allRecords)) {
    throw new Error('[Orphans] enumerateOrphanDependents: sources.allRecords must be an array ' +
      'of every fixture record in the scene (both buses) — group membership cannot be ' +
      'enumerated, so the delete must be refused.');
  }
  if (!patchTree || typeof patchTree !== 'object') {
    throw new Error('[Orphans] enumerateOrphanDependents: sources.patchTree must be the ' +
      'name-keyed patch tree — without it a deleted fixture would leave a patch phantom.');
  }
  if (!Array.isArray(chainRows)) {
    throw new Error('[Orphans] enumerateOrphanDependents: sources.chainRows must be an array ' +
      'from describeFixtureMappings() — controller mappings cannot be enumerated.');
  }
  if (!(pixelCounts instanceof Map)) {
    throw new Error('[Orphans] enumerateOrphanDependents: sources.pixelCounts must be a Map of ' +
      'fixture name → exported pixel count. The runtime fixtures are not bound yet (a rebuild ' +
      'is in flight), so this fixture\'s engine-model footprint cannot be enumerated.');
  }

  const groupMembers = new Map();
  for (const config of allRecords) {
    if (!config || typeof config !== 'object') continue;
    const g = typeof config.group === 'string' ? config.group : '';
    groupMembers.set(g, (groupMembers.get(g) || 0) + 1);
  }
  const doomedByGroup = new Map();
  for (const row of rows) {
    doomedByGroup.set(row.group, (doomedByGroup.get(row.group) || 0) + 1);
  }

  const blockers = [];
  const out = [];
  for (const row of rows) {
    if (!row.name) {
      blockers.push(`fixture at index ${row.index} in group "${row.group}" has NO name — ` +
        'every dependent store (patch tree, controller chains, 2D pixel map) is name-keyed, ' +
        'so its dependents cannot be enumerated.');
      continue;
    }
    const config = row.config;
    const treeEntry = Object.prototype.hasOwnProperty.call(patchTree, row.name)
      ? patchTree[row.name]
      : null;
    const chains = chainRows.filter((r) => r && r.fixture === row.name);
    const pixelMap = pixelMapReferences(pixelMapViews, row.name);
    for (const sel of pixelMap.selectors) {
      if (!sel.lastInSelect) continue;
      blockers.push(`"${row.name}" is the ONLY selector of 2D Pixel Map panel ` +
        `'${sel.panel}' in view '${sel.view}' — removing it would leave that panel with an ` +
        'empty `select`, which the views schema rejects. Re-point or delete that panel first.');
    }
    const pixels = pixelCounts.has(row.name) ? pixelCounts.get(row.name) : null;
    if (pixels === null) {
      blockers.push(`"${row.name}" has no bound runtime fixture, so its exported pixel ` +
        'footprint cannot be read — the engine-model dependency is unknown and the delete is ' +
        'refused rather than guessed.');
    }
    const memberCount = groupMembers.get(row.group) || 0;
    out.push({
      index: row.index,
      name: row.name,
      group: row.group,
      // LED and DMX fixtures are both fixtures — the bus is REPORTED, never a
      // branch in the rule or in what gets removed.
      bus: row.bus || 'dmx',
      fixtureType: config.fixtureType || config.type ||
        (row.bus === 'led' ? 'LED strand' : 'unknown'),
      patch: {
        live: patchIsLive(config),
        controllerIp: config.controllerIp || '',
        dmxUniverse: Number(config.dmxUniverse) || 0,
        dmxAddress: Number(config.dmxAddress) || 0,
        controllerId: Number(config.controllerId) || 0,
        sectionId: Number(config.sectionId) || 0,
        fixtureId: Number(config.fixtureId) || 0,
        viewMask: Number(config.viewMask) || 0,
      },
      patchTreeEntry: treeEntry
        ? {
          controllerIp: treeEntry.controllerIp || '',
          dmxUniverse: Number(treeEntry.dmxUniverse) || 0,
          dmxAddress: Number(treeEntry.dmxAddress) || 0,
          sectionId: Number(treeEntry.sectionId) || 0,
          fixtureId: Number(treeEntry.fixtureId) || 0,
          viewMask: Number(treeEntry.viewMask) || 0,
        }
        : null,
      chains,
      pixelMap,
      group_: {
        name: row.group,
        memberCount,
        removedFromGroup: doomedByGroup.get(row.group) || 0,
        emptiesGroup: memberCount > 0 && (doomedByGroup.get(row.group) || 0) >= memberCount,
      },
      engineModel: { pixels, present: typeof pixels === 'number' && pixels > 0 },
    });
  }

  // Group selectors that go zero-match because a group disappears entirely.
  const emptiedGroups = [];
  for (const [group, doomed] of doomedByGroup) {
    const memberCount = groupMembers.get(group) || 0;
    if (memberCount > 0 && doomed >= memberCount) {
      emptiedGroups.push({
        group,
        memberCount,
        selectors: groupSelectorReferences(pixelMapViews, group),
      });
    }
  }

  const totals = {
    fixtures: out.length,
    mapped: out.filter((r) => r.chains.length > 0).length,
    livePatches: out.filter((r) => r.patch.live).length,
    zeroedPatches: out.filter((r) => !r.patch.live).length,
    patchTreeEntries: out.filter((r) => r.patchTreeEntry !== null).length,
    pixelMapRefs: out.reduce((n, r) => n + r.pixelMap.selectors.length +
      r.pixelMap.offsets.length + r.pixelMap.placements.length, 0),
    modelPixels: out.reduce((n, r) => n + (r.engineModel.pixels || 0), 0),
    emptiedGroups,
  };
  return { rows: out, totals, blockers };
}

// ─── Operator-facing text ──────────────────────────────────────────────────

/** One line per fixture, itemising what goes with it. */
export function formatDependentLines(enumeration) {
  const lines = [];
  for (const r of enumeration.rows) {
    lines.push(`  • "${r.name}" (${r.bus.toUpperCase()} · ${r.fixtureType}, group "${r.group}")`);
    if (r.chains.length > 0) {
      for (const c of r.chains) {
        lines.push(`      🔌 controller mapping: ${c.controllerName || '(unnamed)'} ` +
          `(${c.controllerIp || 'no IP'}) · Port ${c.port} · U${c.universe} · addr ${c.address}` +
          ' — will be UNMAPPED and its channels freed');
      }
    } else {
      lines.push('      🔌 controller mapping: none');
    }
    lines.push(r.patch.live
      ? `      📡 patch: LIVE U${r.patch.dmxUniverse}:${r.patch.dmxAddress}` +
        `@${r.patch.controllerIp || '—'} (sectionId ${r.patch.sectionId}, ` +
        `fixtureId ${r.patch.fixtureId}) — dropped`
      : `      📡 patch: zeroed (sectionId ${r.patch.sectionId}, ` +
        `fixtureId ${r.patch.fixtureId}) — record dropped`);
    lines.push(r.patchTreeEntry
      ? '      🗑 patch-tree entry: present — pruned (no phantom left behind)'
      : '      🗑 patch-tree entry: none');
    const pm = r.pixelMap;
    if (pm.selectors.length + pm.offsets.length + pm.placements.length === 0) {
      lines.push('      🗺 2D Pixel Map: no references');
    } else {
      for (const s of pm.selectors) {
        lines.push(`      🗺 2D Pixel Map selector: view '${s.view}' · panel '${s.panel}' · ` +
          `${s.where}[${s.index}] — removed`);
      }
      for (const v of pm.offsets) {
        lines.push(`      🗺 2D Pixel Map move offset in view '${v}' — removed`);
      }
      for (const v of pm.placements) {
        lines.push(`      🗺 2D Pixel Map placement in view '${v}' — removed`);
      }
    }
    lines.push(`      👥 group "${r.group_.name}": ${r.group_.removedFromGroup} of ` +
      `${r.group_.memberCount} member(s) removed` +
      (r.group_.emptiesGroup ? ' — the group DISAPPEARS' : ''));
    lines.push(`      🧩 engine model: ${r.engineModel.pixels} pixel(s) — still in the ` +
      'EXPORTED model until you re-export it');
  }
  for (const g of enumeration.totals.emptiedGroups) {
    lines.push(`  ⚠ group "${g.group}" disappears (all ${g.memberCount} member(s) removed).`);
    for (const s of g.selectors) {
      lines.push(`      🗺 2D Pixel Map selector view '${s.view}' · panel '${s.panel}' · ` +
        `${s.where}[${s.index}] names that group and will go ZERO-MATCH — left alone ` +
        '(operator intent, not ours to rewrite)');
    }
  }
  return lines;
}

/**
 * The confirm-dialog body. Enumeration FIRST, action second — the operator
 * sees exactly what goes before he is asked anything.
 */
export function buildOrphanDeleteConfirm({ scopeLabel, enumeration }) {
  const t = enumeration.totals;
  const head = `⚠ Remove ${t.fixtures} ORPHANED fixture(s) — ${scopeLabel}\n\n` +
    'These fixtures claim a generator made them, but no generator owns them any more.\n' +
    'They are removed from the scene IN MEMORY. Nothing is written to disk until YOU save.\n\n' +
    'What goes with them:\n';
  const summary = `\nTotals: ${t.fixtures} fixture(s) · ${t.mapped} mapped to a controller · ` +
    `${t.livePatches} live patch(es), ${t.zeroedPatches} zeroed · ` +
    `${t.patchTreeEntries} patch-tree entr(ies) · ${t.pixelMapRefs} 2D Pixel Map reference(s) · ` +
    `${t.modelPixels} exported model pixel(s).\n\n` +
    'After this: RE-EXPORT the engine model (the exported model still carries those pixels), ' +
    'and SAVE the scene when you are happy.\n\nRemove them?';
  return head + formatDependentLines(enumeration).join('\n') + summary;
}

/**
 * The refusal shown when enumeration could not be completed. A delete that
 * cannot list its dependents does not happen.
 */
export function buildEnumerationRefusal(scopeLabel, blockers) {
  return `✋ Refusing to remove the orphaned fixture(s) — ${scopeLabel}\n\n` +
    'Their dependents could not be fully enumerated, and a destructive scene operation ' +
    'never proceeds blind:\n\n' +
    blockers.map((b) => `  • ${b}`).join('\n\n') +
    '\n\nNothing was changed.';
}

/**
 * The refusal shown when the scene moved under the dialog — a fixture that was
 * an orphan when the dialog opened is owned by a live generator now (e.g. the
 * operator created or renamed a generator in another window).
 */
export function buildStaleOrphanRefusal(names) {
  return '✋ Nothing was removed — the scene changed while the dialog was open.\n\n' +
    `${names.length} fixture(s) are NO LONGER orphaned (a live generator owns them now):\n` +
    names.map((n) => `  • ${n}`).join('\n') +
    '\n\nRe-open the panel and check the badges again.';
}

/** Console report for a completed removal — one block, loud, itemised. */
export function buildRemovalReport({ scopeLabel, enumeration }) {
  const t = enumeration.totals;
  const lines = [`Removed ${t.fixtures} ORPHANED fixture(s) — ${scopeLabel}. ` +
    'They claimed generator origin with no live generator owning them.'];
  lines.push(...formatDependentLines(enumeration));
  lines.push(`  ↳ ${t.modelPixels} pixel(s) leave the scene: RE-EXPORT the engine model, ` +
    'then SAVE the scene. Nothing has been written to disk by this removal.');
  return lines;
}
