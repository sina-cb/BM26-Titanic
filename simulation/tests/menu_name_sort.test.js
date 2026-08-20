/**
 * menu_name_sort.test.js — every left-menu list renders SORTED BY NAME, and
 * sorting is DISPLAY ONLY.
 *
 * Operator order (2026-07-30): "please in the menu for the instances and
 * generator lists for dmx and LED too — sort by name." Six lists are covered:
 *
 *   1. Light Instances → group folders            (params.parLights buckets)
 *   2. Light Instances → fixtures inside a group
 *   3. 📐 Group Generator → generator cards        (params.traces)
 *   4. DMX Instances → fixture cards               (params.dmxFixtures)
 *   5. LED Fixtures → ✨ Generators buttons        (LED_GENERATORS catalog)
 *   6. LED Fixtures → strand groups + strands      (params.ledStrands)
 *
 * The load-bearing guarantee is the SECOND half of the order: the scene arrays
 * behind those lists must not move. Chain order, patch derivation and YAML
 * serialization all read array position, so an in-place sort would silently
 * rewire the rig. Every list therefore renders through a NON-MUTATING view
 * built by the ONE shared comparator (src/core/natural_sort.js) — not a second
 * bespoke comparator, and not a per-item localeCompare (the per-keystroke perf
 * bug report 20260725_50 fixed).
 *
 * The list construction itself lives inside a browser-only closure over THREE +
 * DOM, so it is pinned two ways: the ordering helpers are exercised directly on
 * synthetic scene data (behaviour), and the gui_builder call sites are scanned
 * (wiring) — the same split led_fixtures_menu_wiring.test.js uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { sortNamesNatural, sortByNameNatural } from '../src/core/natural_sort.js';
import { LED_GENERATORS } from '../src/fixtures/led_generator_catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
/** Source with comments stripped — these assertions are about CODE, not prose. */
const code = (...p) => read(...p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const GUI = code('src', 'gui', 'gui_builder.js');

const UNGROUPED = 'Ungrouped';

// ── A synthetic scene, deliberately in a hostile order ────────────────────
// Groups out of alphabetical order; members out of chain order; "Bar 2" vs
// "Bar 10" in three different lists so the numeric trap is proved everywhere.

function makeScene() {
  return {
    parLights: [
      { name: 'Right Front Wall 10', group: 'Right Front Wall' },
      { name: 'Left Auditorium 2', group: 'Left Auditorium' },
      { name: 'Right Front Wall 2', group: 'Right Front Wall' },
      { name: 'Bar 10', group: 'Bar' },
      { name: 'Left Auditorium 10', group: 'Left Auditorium' },
      { name: 'Bar 2', group: 'Bar' },
      { name: 'Right Front Wall 1', group: 'Right Front Wall' },
    ],
    traces: [
      { name: 'Right SmokeStacks', shape: 'line' },
      { name: 'Bar 10', shape: 'circle' },
      { name: 'Left Back Wall', shape: 'corner' },
      { name: 'Bar 2', shape: 'line' },
    ],
    dmxFixtures: [
      { name: 'Fogger 10' },
      { name: 'Aud Wash 2' },
      { name: 'Fogger 2' },
    ],
    ledStrands: [
      { name: 'Stack Strip 10', group: 'Stacks' },
      { name: 'Loose 1', group: '' },
      { name: 'Bow Strip 2', group: 'Bow' },
      { name: 'Stack Strip 2', group: 'Stacks' },
      { name: 'Bow Strip 10', group: 'Bow' },
    ],
  };
}

/** Snapshot of array identity + element order, for the no-reorder assertions. */
const shot = (arr) => arr.map((x) => x.name);

// The par bucketing in renderParGUI, verbatim in shape: appearance-ordered
// `groupOrder`, a display copy sorted by name, and a sorted VIEW of members.
function buildParDisplay(scene) {
  const groupOrder = [];
  const groupMap = new Map();
  scene.parLights.forEach((config, index) => {
    const g = config.group || 'Default';
    if (!groupMap.has(g)) { groupMap.set(g, []); groupOrder.push(g); }
    const bucket = groupMap.get(g);
    bucket.push({ config, index, ordinal: bucket.length });
  });
  const displayGroupOrder = sortNamesNatural(groupOrder);
  return displayGroupOrder.map((groupName) => ({
    group: groupName,
    items: sortByNameNatural(groupMap.get(groupName) || [], (it) => it.config.name),
  }));
}

// The strand bucketing in renderStrandGUI: named groups sorted, Ungrouped last.
function buildStrandDisplay(scene) {
  const groupOrder = [];
  const groupMap = new Map();
  scene.ledStrands.forEach((strand, index) => {
    const key = (strand.group || '').trim() || UNGROUPED;
    if (!groupMap.has(key)) { groupMap.set(key, []); groupOrder.push(key); }
    groupMap.get(key).push({ strand, index });
  });
  const namedGroups = groupOrder.filter((g) => g !== UNGROUPED);
  const displayNamedGroups = sortNamesNatural(namedGroups);
  const orderedGroups = [...displayNamedGroups];
  if (groupMap.has(UNGROUPED)) orderedGroups.push(UNGROUPED);
  return orderedGroups.map((groupName) => ({
    group: groupName,
    items: sortByNameNatural(
      groupMap.get(groupName) || [],
      (it) => it.strand.name || `Strand ${it.index + 1}`,
    ),
  }));
}

// ── 1 + 2: Light Instances (groups, then fixtures inside a group) ─────────

test('Light Instances group folders come out sorted by group name', () => {
  const built = buildParDisplay(makeScene());
  assert.deepEqual(built.map((g) => g.group),
    ['Bar', 'Left Auditorium', 'Right Front Wall']);
});

test('fixtures inside a group sort naturally — "Bar 2" before "Bar 10"', () => {
  const built = buildParDisplay(makeScene());
  const byGroup = new Map(built.map((g) => [g.group, g.items.map((it) => it.config.name)]));
  assert.deepEqual(byGroup.get('Bar'), ['Bar 2', 'Bar 10']);
  assert.deepEqual(byGroup.get('Right Front Wall'),
    ['Right Front Wall 1', 'Right Front Wall 2', 'Right Front Wall 10']);
  assert.deepEqual(byGroup.get('Left Auditorium'),
    ['Left Auditorium 2', 'Left Auditorium 10']);
});

test('each displayed fixture keeps its REAL params.parLights index', () => {
  const scene = makeScene();
  const built = buildParDisplay(scene);
  for (const { items } of built) {
    for (const { config, index } of items) {
      assert.equal(scene.parLights[index], config,
        'the display row must point back at its own slot in params.parLights');
    }
  }
});

test('`ordinal` is the SOURCE position in the group, not the display position', () => {
  // The generated-fixture default name (`Fixture <n>`) is stamped from this,
  // so it must not change just because the list is displayed sorted.
  const built = buildParDisplay(makeScene());
  const bar = built.find((g) => g.group === 'Bar');
  assert.deepEqual(bar.items.map((it) => it.config.name), ['Bar 2', 'Bar 10']);
  assert.deepEqual(bar.items.map((it) => it.ordinal), [1, 0]);
});

test('sorting the par list does NOT reorder params.parLights', () => {
  const scene = makeScene();
  const before = shot(scene.parLights);
  const ref = scene.parLights;
  buildParDisplay(scene);
  assert.equal(scene.parLights, ref, 'array identity must survive');
  assert.deepEqual(shot(scene.parLights), before, 'element order must survive');
});

// ── 3: 📐 Group Generator ─────────────────────────────────────────────────

test('Group Generator cards come out sorted by generator name', () => {
  const scene = makeScene();
  const display = sortByNameNatural(
    scene.traces.map((trace, i) => ({ trace, i })),
    (entry) => entry.trace.name || `Trace ${entry.i + 1}`,
  );
  assert.deepEqual(display.map((e) => e.trace.name),
    ['Bar 2', 'Bar 10', 'Left Back Wall', 'Right SmokeStacks']);
  // …carrying the REAL params.traces index, which every selection hook
  // (traceGuiFolders[i] / clickTraceFolder(i) / flyToTrace(i)) is keyed on.
  assert.deepEqual(display.map((e) => e.i), [3, 1, 2, 0]);
  for (const { trace, i } of display) assert.equal(scene.traces[i], trace);
});

test('sorting the generator list does NOT reorder params.traces', () => {
  const scene = makeScene();
  const before = shot(scene.traces);
  const ref = scene.traces;
  sortByNameNatural(scene.traces.map((trace, i) => ({ trace, i })), (e) => e.trace.name);
  assert.equal(scene.traces, ref);
  assert.deepEqual(shot(scene.traces), before);
});

// ── 4: DMX Instances ──────────────────────────────────────────────────────

test('DMX Instances cards come out sorted, with their real indices', () => {
  const scene = makeScene();
  const display = sortByNameNatural(
    scene.dmxFixtures.map((config, index) => ({ config, index })),
    (entry) => entry.config.name || `DMX ${entry.index + 1}`,
  );
  assert.deepEqual(display.map((e) => e.config.name), ['Aud Wash 2', 'Fogger 2', 'Fogger 10']);
  assert.deepEqual(display.map((e) => e.index), [1, 2, 0]);
  assert.deepEqual(shot(scene.dmxFixtures), ['Fogger 10', 'Aud Wash 2', 'Fogger 2']);
});

// ── 5: LED ✨ Generators catalog ──────────────────────────────────────────

test('the LED generator catalog is sorted for display without being mutated', () => {
  const before = LED_GENERATORS.map((e) => e.id);
  const display = sortByNameNatural(LED_GENERATORS, (entry) => entry.label);
  assert.notEqual(display, LED_GENERATORS, 'must be a copy — the catalog is frozen');
  assert.deepEqual(sortNamesNatural(display.map((e) => e.label)), display.map((e) => e.label));
  assert.deepEqual(LED_GENERATORS.map((e) => e.id), before);
});

// ── 6: LED Fixtures — strand groups and strands ───────────────────────────

test('LED strand groups sort by name with Ungrouped pinned LAST', () => {
  const built = buildStrandDisplay(makeScene());
  // 'Ungrouped' is a display bucket, not a group — it does not sort into the U's.
  assert.deepEqual(built.map((g) => g.group), ['Bow', 'Stacks', UNGROUPED]);
});

test('strands inside an LED group sort naturally', () => {
  const built = buildStrandDisplay(makeScene());
  const byGroup = new Map(built.map((g) => [g.group, g.items.map((it) => it.strand.name)]));
  assert.deepEqual(byGroup.get('Bow'), ['Bow Strip 2', 'Bow Strip 10']);
  assert.deepEqual(byGroup.get('Stacks'), ['Stack Strip 2', 'Stack Strip 10']);
});

test('sorting the LED lists does NOT reorder params.ledStrands', () => {
  const scene = makeScene();
  const before = shot(scene.ledStrands);
  const ref = scene.ledStrands;
  const built = buildStrandDisplay(scene);
  assert.equal(scene.ledStrands, ref);
  assert.deepEqual(shot(scene.ledStrands), before);
  for (const { items } of built) {
    for (const { strand, index } of items) assert.equal(scene.ledStrands[index], strand);
  }
});

// ── Wiring: gui_builder routes all six lists through the shared helpers ───

test('gui_builder imports the ONE shared comparator, not a second one', () => {
  assert.match(GUI,
    /import \{ sortNamesNatural, sortByNameNatural \} from "\.\.\/core\/natural_sort\.js"/);
  assert.doesNotMatch(GUI, /localeCompare\(/,
    'gui_builder must not roll a per-item localeCompare (report 20260725_50)');
  assert.doesNotMatch(GUI, /new Intl\.Collator/,
    'gui_builder must not build its own collator');
});

test('no scene array is ever sorted in place', () => {
  for (const arr of ['parLights', 'traces', 'ledStrands', 'dmxFixtures']) {
    assert.doesNotMatch(GUI, new RegExp(`params\\.${arr}\\.sort\\(`),
      `params.${arr} must never be sorted in place — display order only`);
  }
  assert.doesNotMatch(GUI, /groupMap\.get\([^)]*\)\.sort\(/,
    'group buckets are views onto scene order — sort a copy, never the bucket');
  assert.doesNotMatch(GUI, /LED_GENERATORS\.sort\(/);
});

test('every one of the six lists renders from a sorted view', () => {
  const sites = [
    [/const displayGroupOrder = sortNamesNatural\(groupOrder\);/,
      'Light Instances group folders'],
    [/displayGroupOrder\.forEach\(\(groupName\) => \{/,
      'Light Instances renders the sorted group order'],
    [/const items = sortByNameNatural\(groupMap\.get\(groupName\) \|\| \[\], \(it\) => it\.config\.name\);/,
      'fixtures inside a par group'],
    [/const displayTraces = sortByNameNatural\(/, '📐 Group Generator cards'],
    [/displayTraces\.forEach\(\(\{ trace, i \}\) => \{/,
      'Group Generator renders the sorted view, keeping the real index'],
    [/const displayDmx = sortByNameNatural\(/, 'DMX Instances cards'],
    [/sortByNameNatural\(LED_GENERATORS, \(entry\) => entry\.label\)\.forEach\(/,
      'LED ✨ Generators buttons'],
    [/const displayNamedGroups = sortNamesNatural\(namedGroups\);/,
      'LED strand group folders'],
    [/it\.strand\.name \|\| `Strand \$\{it\.index \+ 1\}`/, 'strands inside an LED group'],
  ];
  for (const [re, label] of sites) {
    assert.match(GUI, re, `${label}: not wired to the shared sort`);
  }
});

test('the "move to group" pickers list groups sorted too', () => {
  // Same rule, one surface deeper — the picker options are pure display.
  assert.match(GUI, /displayGroupOrder\.forEach\(\(g\) => \{/);
  assert.match(GUI, /displayNamedGroups\.forEach\(\(g\) => \{/);
});

test('the group-DELETE reassignment still reads the un-sorted groupOrder', () => {
  // Sorting must not change which group orphaned fixtures fall back to — that
  // is data, not display. Pinning it keeps a future tidy-up honest.
  assert.match(GUI, /groupOrder\.find\(g => g !== groupName\) \|\| 'Default'/);
});
