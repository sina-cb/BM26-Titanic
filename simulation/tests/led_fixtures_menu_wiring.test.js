/**
 * Source-contract regression for the LED Fixtures menu mapping UX
 * (report 20260725_52).
 *
 * These are wiring facts inside a browser-only closure over THREE + DOM, so text
 * scanning is the honest tool — the logic itself is unit-tested in
 * group_rename_guard.test.js and led_output_port_slots.test.js.
 *
 * What must stay true:
 *   • BOTH group renames (par + LED strand) and BOTH group seeds use the ONE
 *     scene-wide guard — no control may go back to policing its own list;
 *   • the par-group rename is undoable (it had no pushUndo at all);
 *   • both renames print the itemised report, including the engine-model
 *     staleness line nothing else surfaces;
 *   • the `+port` button keeps calling `addPort` (the LED slot rule lives in the
 *     registry, so the shared Controllers-pane header stays untouched).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const GUI = read('src', 'gui', 'gui_builder.js');
const REGISTRY = read('src', 'dmx', 'controller_registry.js');
const EDITOR = read('src', 'gui', 'controller_map_editor.js');

/** The brace-matched body of the `onclick = () => {…}` CONTAINING `anchor`. */
function onclickAfter(source, anchor, label) {
  const at = source.indexOf(anchor);
  assert.notEqual(at, -1, `${label}: anchor not found (${anchor})`);
  // The anchor sits INSIDE the handler, so walk backwards to its `onclick`.
  const handler = source.lastIndexOf('onclick', at);
  assert.notEqual(handler, -1, `${label}: no onclick encloses the anchor`);
  const open = source.indexOf('{', handler);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${label}`);
}

const PAR_RENAME = () => onclickAfter(GUI, "prompt('Rename group:'", 'par group rename');
const LED_RENAME = () => onclickAfter(GUI, "prompt('Rename LED group:'", 'LED group rename');

// ── One namespace, one guard ───────────────────────────────────────────────

test('gui_builder imports the scene-wide group guard', () => {
  assert.match(GUI, /import \{[\s\S]*?collectSceneGroupNames[\s\S]*?groupRenameError[\s\S]*?buildGroupRenameReport[\s\S]*?\} from "\.\.\/dmx\/group_rename_guard\.js"/);
});

test('the par-group rename checks the WHOLE scene, not just groupOrder', () => {
  const body = PAR_RENAME();
  assert.match(body, /groupRenameError\(/);
  assert.match(body, /collectSceneGroupNames\(params\)/);
  // The old local-only checks must be gone, or a par group could still be
  // renamed straight onto a live LED strand group.
  assert.doesNotMatch(body, /groupOrder\.includes\(nn\)/,
    'the par-only collision check must not survive alongside the scene-wide one');
});

test('the LED-strand guard delegates to the same scene-wide function', () => {
  const at = GUI.indexOf('function _ledGroupNameClash');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, GUI.indexOf('\n    }', at));
  assert.match(body, /groupRenameError\(/);
  assert.match(body, /collectSceneGroupNames\(params\)/);
  assert.doesNotMatch(body, /params\.ledStrands \|\| \[\]\)\.map/,
    'the strand-only namespace must be gone, not shadowed');
});

test('every strand-side name entry still funnels through _ledGroupNameClash', () => {
  // ➕ Add Group, ✏ Rename, and "＋ New group…" on a strand's Move dropdown.
  const uses = GUI.match(/_ledGroupNameClash\(/g) || [];
  assert.ok(uses.length >= 4,
    `expected the guard declaration + at least 3 call sites, saw ${uses.length}`);
});

test('the DMX ➕ Add Group seed is guarded too (it had no guard at all)', () => {
  const at = GUI.indexOf('addGroup: () => {');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, GUI.indexOf('debounceAutoSave();', at));
  assert.match(body, /groupRenameError\(/);
  assert.match(body, /collectSceneGroupNames\(params\)/);
  assert.ok(body.indexOf('groupRenameError(') < body.indexOf('pushUndo()'),
    'the guard must refuse BEFORE the undo push, or a refused seed leaves a snapshot');
});

// ── The par rename is undoable ─────────────────────────────────────────────

test('the par-group rename pushes undo before it mutates', () => {
  const body = PAR_RENAME();
  const undo = body.indexOf('pushUndo()');
  const firstMutation = body.indexOf('c.group = nn');
  assert.notEqual(undo, -1, 'a mistyped group rename must be recoverable');
  assert.ok(undo < firstMutation, 'pushUndo must precede the first mutation');
});

test('the par-group rename refuses before it pushes undo', () => {
  const body = PAR_RENAME();
  assert.ok(body.indexOf('if (clash)') < body.indexOf('pushUndo()'),
    'a refused rename must not leave an undo snapshot behind');
});

// ── Loud, and honest about what it did NOT do ──────────────────────────────

for (const [label, get] of [['par', PAR_RENAME], ['LED strand', LED_RENAME]]) {
  test(`the ${label} group rename prints the itemised report`, () => {
    const body = get();
    assert.match(body, /buildGroupRenameReport\(\{/);
    assert.match(body, /memberCount: movedCount/);
    assert.match(body, /console\.warn/);
  });

  test(`the ${label} group rename counts the members it actually moved`, () => {
    const body = get();
    assert.match(body, /movedCount \+= 1/,
      'the report must count real moves, not the folder title');
  });

  test(`the ${label} group rename tells the operator to re-export the model`, () => {
    assert.match(get(), /RE-EXPORT the engine model/);
  });

  test(`the ${label} group rename still carries the display state it always did`, () => {
    const body = get();
    assert.match(body, /viewRegistryRenameGroup/, 'view-mask bit');
    assert.match(body, /migratePixelMapGroupSelectors/, '2D Pixel Map selectors');
    assert.match(body, /invalidateMarsinBatchCache/, 'batch cache');
  });
}

test('the par rename carries groupOverrides, the LED rename ledGroupOverrides', () => {
  assert.match(PAR_RENAME(), /params\.groupOverrides\[nn\] = params\.groupOverrides\[groupName\]/);
  assert.match(LED_RENAME(), /params\.ledGroupOverrides\[nn\] = params\.ledGroupOverrides\[groupName\]/);
});

test('neither group rename touches fixture names or addresses', () => {
  // Group membership is not a mapping key — a group rename that renamed
  // fixtures would silently invalidate every address they carry.
  for (const body of [PAR_RENAME(), LED_RENAME()]) {
    assert.doesNotMatch(body, /\.dmxAddress\s*=/);
    assert.doesNotMatch(body, /\.dmxUniverse\s*=/);
    assert.doesNotMatch(body, /invalidateFixtureMappings/);
    assert.doesNotMatch(body, /\bc\.name\s*=/);
    assert.doesNotMatch(body, /\bs\.name\s*=/);
  }
});

// ── LED output slots live in the registry, not in the shared pane header ───

test('the LED output-slot rule lives in controller_registry, not the pane', () => {
  assert.match(REGISTRY, /export function nextLedOutputPortNumber/);
  assert.match(REGISTRY, /export const LED_MAX_OUTPUTS = 16;/);
  const at = REGISTRY.indexOf('export function addPort');
  const body = REGISTRY.slice(at, REGISTRY.indexOf('\n}', at));
  assert.match(body, /isLedController\(controller\)\s*\n?\s*\? nextLedOutputPortNumber/,
    'addPort must branch on controller type');
});

test('the +port button is untouched — it still just calls addPort', () => {
  // The Controllers-pane header is another agent\'s territory; the behaviour
  // change is entirely inside the registry so the two never collide.
  const at = EDITOR.indexOf("addPortBtn.textContent = '+port'");
  assert.notEqual(at, -1, 'the +port button must still exist for both controller types');
  const body = EDITOR.slice(at, at + 400);
  assert.match(body, /addPort\(registry\(\), controller\)/);
});

test('a re-added LED output is inserted in port order, not appended', () => {
  const at = REGISTRY.indexOf('export function addPort');
  const body = REGISTRY.slice(at, REGISTRY.indexOf('\n}', at));
  assert.match(body, /findIndex\(\(p\) => p && p\.port > portNum\)/);
  assert.match(body, /splice\(at, 0, port\)/);
});
