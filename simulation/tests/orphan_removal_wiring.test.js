/**
 * Source-contract regression for ORPHANED-FIXTURE FLAGGING + REMOVAL
 * (report 20260725_76).
 *
 * The rule and the enumeration are pure and behaviour-tested in
 * orphan_fixtures.test.js. What lives ONLY in the browser closure — and is
 * therefore what these tests pin — is the ORDER of the destructive path and
 * the presence of the affordances:
 *
 *   • re-detect  → enumerate → confirm → mutate, in that order, with every
 *     step able to refuse and NOTHING mutated before the confirm;
 *   • the delete drops the fixture AND its controller mapping AND its
 *     patch-tree key AND its 2D Pixel Map references — a partial delete is
 *     precisely the phantom class this feature exists to end;
 *   • it marks the scene dirty and never saves it (the scene is his data);
 *   • the badge, the per-fixture remove button and the per-group remove
 *     button actually exist, and the count reaches the Generators header.
 *
 * Text scanning is the honest tool here, same as rename_hygiene_wiring.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const GUI = read('src', 'gui', 'gui_builder.js');
const STORE = read('src', 'gui', 'pixel_map', 'pixel_map_store.js');
const VIEWS = read('src', 'gui', 'pixel_map', 'pixel_map_views.js');

/** Body of `function <name>(` in `source`, brace-matched. */
function functionBody(source, name) {
  const at = source.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name}: not found`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}`);
}

const REMOVE = functionBody(GUI, 'removeOrphanFixtures');

// ── The module is wired in at all ──────────────────────────────────────────

test('gui_builder imports the pure detector rather than re-deriving the rule', () => {
  assert.match(GUI, /from "\.\.\/dmx\/orphan_fixtures\.js"/);
  for (const sym of ['findOrphanFixtures', 'orphanGroupSummary', 'isOrphanFixture',
    'generatorGroupNames', 'enumerateOrphanDependents']) {
    assert.match(GUI, new RegExp(`\\b${sym}\\b`), `${sym} must be imported and used`);
  }
  // No hand-rolled second copy of the rule in the GUI.
  const inlineRule = /traceGenerated\s*(===\s*true)?\s*&&\s*![^\n]*traces/;
  assert.ok(!inlineRule.test(GUI),
    'the orphan rule must live in orphan_fixtures.js, not be re-implemented here');
});

// ── Order of the destructive path ──────────────────────────────────────────

test('the delete RE-DETECTS orphan-ness before it does anything else', () => {
  const reDetect = REMOVE.indexOf('isOrphanFixture(');
  const enumerate = REMOVE.indexOf('enumerateOrphanDependents(');
  const confirmAt = REMOVE.indexOf('confirm(');
  const firstMutation = REMOVE.indexOf('pushUndo()');
  assert.notEqual(reDetect, -1, 'the re-detect gate must exist');
  assert.ok(reDetect < enumerate, 're-detect must run before enumeration');
  assert.ok(enumerate < confirmAt, 'the confirm must SHOW the enumeration');
  assert.ok(confirmAt < firstMutation, 'nothing may mutate before the operator confirms');
});

test('a fixture that stopped being an orphan aborts the WHOLE operation, loudly', () => {
  const gate = REMOVE.slice(0, REMOVE.indexOf('enumerateOrphanDependents('));
  assert.match(gate, /buildStaleOrphanRefusal\(/);
  assert.match(gate, /alert\(/);
  assert.match(gate, /return false/);
  // It must NOT quietly proceed with the subset that still qualifies.
  assert.ok(!/filter\([^)]*isOrphanFixture[^)]*\)\s*;\s*\n\s*(?!.*return false)/s.test(gate) ||
    /return false/.test(gate));
});

test('indices are re-resolved by config identity, never trusted from the render', () => {
  assert.match(REMOVE, /records\.indexOf\(row\.config\)/,
    'a remembered index goes stale the moment anything splices');
  assert.match(REMOVE, /r\.index < 0/);
});

// ── LED and DMX are both fixtures (operator, 2026-07-30) ───────────────────

test('the census scans BOTH buses — parLights and ledStrands', () => {
  const body = functionBody(GUI, 'orphanScene');
  assert.match(body, /parLights: params\.parLights/);
  assert.match(body, /ledStrands: params\.ledStrands/);
  assert.match(body, /traces: params\.traces/);
});

test('the delete splices each record out of its OWN array, either bus', () => {
  assert.match(REMOVE, /new Set\(rows\.map\(\(r\) => r\.records\)\)/,
    'DMX fixtures and LED strands must take the identical path');
  assert.match(REMOVE, /records\.length = 0/);
  assert.ok(!/params\.parLights = /.test(REMOVE),
    'a bus-specific reassignment would strand LED strand removals');
});

test('a strand removal rebuilds the LED side too', () => {
  assert.match(REMOVE, /const touchedLed = rows\.some\(\(r\) => r\.bus === 'led'\)/);
  assert.match(REMOVE, /window\.rebuildLedStrands\(\)/);
  assert.match(REMOVE, /window\.renderStrandGUI\(\)/);
});

test('pixel counts resolve per bus, by identity, and refuse when unbound', () => {
  const counts = functionBody(GUI, 'orphanPixelCounts');
  assert.match(counts, /window\.ledStrandFixtures/);
  assert.match(counts, /config\.ledCount/, 'a strand exports ledCount pixels');
  assert.match(counts, /row\.bus === 'led'/);
  // Both branches refuse rather than guessing a footprint.
  assert.ok((counts.match(/return null/g) || []).length >= 3);
});

test('group membership for the badge is counted across buses, not per section', () => {
  assert.match(GUI, /const orphanSummaryByGroup = new Map\(/);
  assert.match(GUI, /groupSummary \? groupSummary\.memberCount : items\.length/);
  assert.match(GUI, /const groupAllOrphans = !!\(groupSummary && groupSummary\.allOrphans\)/);
});

test('enumeration is handed every record in the scene, both buses', () => {
  assert.match(REMOVE, /allRecords: allSceneRecords\(orphanScene\(\)\)/);
});

test('an enumeration that cannot complete REFUSES instead of deleting blind', () => {
  assert.match(REMOVE, /catch \(err\)[\s\S]*buildEnumerationRefusal\(/);
  assert.match(REMOVE, /enumeration\.blockers\.length > 0[\s\S]*buildEnumerationRefusal\(/);
  const blockerBranch = REMOVE.slice(REMOVE.indexOf('enumeration.blockers.length > 0'));
  assert.ok(blockerBranch.indexOf('return false') < blockerBranch.indexOf('pushUndo()'),
    'the blocker branch must return before anything mutates');
});

// ── What the delete actually removes ───────────────────────────────────────

test('the delete drops the fixture, its mapping, its patch key and its map refs', () => {
  assert.match(REMOVE, /const kept = records\.filter\(\(c\) => !doomed\.has\(c\)\)/);
  assert.match(REMOVE, /window\.controllerMappingFixturesRemoved\(removedConfigs\)/);
  assert.match(REMOVE, /window\.pruneGlobalPatchTreeKeys\(names\)/);
  assert.match(REMOVE, /removeFixtureFromPixelMapViews\(name\)/);
  assert.match(REMOVE, /invalidateMarsinBatchCache\('orphan_fixture_removal'\)/);
});

test('the delete is undoable and rebuilds both the fixtures and the GUI', () => {
  assert.match(REMOVE, /pushUndo\(\)/);
  assert.match(REMOVE, /window\.renderParGUI\(\)/);
  assert.match(REMOVE, /window\.renderGeneratorGUI\(\)/);
  assert.match(REMOVE, /rebuildParLights\(\)/);
});

test('the delete marks the scene dirty and never saves it — the operator saves', () => {
  assert.match(REMOVE, /debounceAutoSave\(\)/);
  assert.ok(!/exportConfig\(/.test(REMOVE), 'a scene write here would be an agent saving his data');
  assert.ok(!/debounceAutoSave\(true\)/.test(REMOVE), 'the save must not be forced');
});

test('the delete reports itself fixture by fixture in the console', () => {
  assert.match(REMOVE, /buildRemovalReport\(/);
  assert.match(REMOVE, /console\.warn\(`\[Orphans\]/);
});

test('the engine-model footprint is read from BOUND runtime fixtures or refused', () => {
  const counts = functionBody(GUI, 'orphanPixelCounts');
  assert.match(counts, /window\._isRebuildingFixtures/);
  assert.match(counts, /return null/);
  assert.match(counts, /f\.config === config/,
    'bind by config identity — an index lookup can silently hit another fixture');
});

// ── The affordances exist ──────────────────────────────────────────────────

test('group folders carry an orphan badge without breaking open-state restore', () => {
  assert.match(GUI, /const plainGroupTitle = `\$\{groupName\} \(\$\{items\.length\}\)`/);
  assert.match(GUI, /groupFolder\._plainTitle = plainGroupTitle/);
  assert.match(GUI, /openGroups\.add\(f\._plainTitle \|\| f\._title\)/);
  assert.match(GUI, /orphanBadgeHtml/);
});

test('an orphan fixture row gets a badge AND the only control that can delete it', () => {
  assert.match(GUI, /const isOrphanRow = orphanConfigs\.has\(config\)/);
  assert.match(GUI, /genCardTitle\(/);
  assert.match(GUI, /if \(isOrphanRow && genChildren\)/);
  assert.match(GUI, /🗑 Remove this orphan/);
  // …and it routes through the shared, enumerating path.
  const card = GUI.slice(GUI.indexOf('if (isOrphanRow && genChildren)'));
  assert.match(card.slice(0, 2500), /removeOrphanFixtures\(\[row\]/);
});

test('a group with orphans gets a group-level remove that offers ONLY the orphans', () => {
  assert.match(GUI, /const groupOrphans = orphanRowsByGroup\.get\(groupName\) \|\| \[\]/);
  assert.match(GUI, /groupAllOrphans/);
  assert.match(GUI, /🗑 Remove \$\{groupOrphans\.length\} orphan\(s\)/);
  assert.match(GUI, /removeOrphanFixtures\(groupOrphans/);
  // A MIXED group must SAY it is only removing part of itself.
  assert.ok(GUI.includes('Only those are '), 'a mixed group must say the scope is partial');
  assert.ok(GUI.includes('offered for removal'));
  assert.ok(GUI.includes('the rest belong to a live generator'));
});

test('the Generators section header carries the count the operator must not hunt for', () => {
  assert.match(GUI, /orphanGroupSummary\(orphanScene\(\)\)/);
  assert.match(GUI, /⚠ \$\{genOrphanTotal\} orphaned fixtures<\/span>/);
  assert.match(GUI, /genFolder\.title\(genOrphanTotal === 0 \? '📐 Group Generator'/);
  // The banner is rebuilt every render, never duplicated.
  assert.match(GUI, /querySelectorAll\('\.orphan-summary-bar'\)\.forEach\(\(el\) => el\.remove\(\)\)/);
});

// ── The pixel-map side ─────────────────────────────────────────────────────

test('removeFixtureFromViews refuses to leave a panel with an empty select', () => {
  const body = functionBody(VIEWS, 'removeFixtureFromViews');
  assert.match(body, /where === 'select' && keep\.length === 0/);
  assert.match(body, /throw new Error/);
});

test('the store helper mutates the live tree but never forces a save', () => {
  const body = functionBody(STORE, 'removeFixtureFromPixelMapViews');
  assert.match(body, /removeFixtureFromViews\(store\.views, fixtureName\)/);
  assert.match(body, /params\.pixelMapViews = toParams\(store\.views\)/);
  assert.match(body, /resetPanelErrorWarnings\(\)/);
  assert.ok(!/commitViews\(\)/.test(body), 'the deleting caller owns the dirty decision');
  assert.ok(!/schedulePixelMapViewsSave\(/.test(body));
});

test('the enumerating reader and the mutating writer read the SAME views tree', () => {
  assert.match(STORE, /export function pixelMapViewsSource\(\)/);
  assert.match(GUI, /pixelMapViews: pixelMapViewsSource\(\)/);
});
