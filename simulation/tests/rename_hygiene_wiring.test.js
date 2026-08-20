/**
 * Source-contract regression for RENAME HYGIENE (plan 20260725_44 steps 8-12,
 * operator ruling 2026-07-29).
 *
 * The rename bugs all lived in the wiring of a browser-only closure over THREE
 * + DOM, and every one of them was a missing or misordered line:
 *
 *   • the mapped group rename unmapped everything by ACCIDENT (the regenerate's
 *     casualty set) and reported it as "N deleted fixture(s) unmapped —
 *     channels freed", which is untrue on a rename;
 *   • the name/override/view-bit mutations ran BEFORE the chainSplits gate could
 *     refuse, stranding the old-named group;
 *   • `__globalPatchTree` kept the old-name keys forever;
 *   • individual renames had no duplicate guard, no mapping invalidation, and
 *     `propagateToSelected(index, 'name', v)` stamped one name onto the whole
 *     selection;
 *   • the par-group rename never invalidated the batch cache and never
 *     re-pointed the 2D Pixel Map selectors that name the group.
 *
 * Text scanning is the honest tool: these are wiring facts, not pure logic.
 * The behaviour itself is unit-tested in rename_invalidation.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(HERE, '..', ...p), 'utf8');
const MAIN = read('main.js');
const GUI = read('src', 'gui', 'gui_builder.js');
const REGISTRY = read('src', 'dmx', 'controller_registry.js');
const STORE = read('src', 'gui', 'pixel_map', 'pixel_map_store.js');

/** Body of the `onFinishChange` callback that follows `anchor`, brace-matched. */
function handlerAfter(source, anchor, label) {
  const at = source.indexOf(anchor);
  assert.notEqual(at, -1, `${label}: anchor not found (${anchor})`);
  const open = source.indexOf('{', source.indexOf('onFinishChange', at));
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

// ── Step 8: gate BEFORE mutation ───────────────────────────────────────────

test('the trace rename checks chainSplits BEFORE it mutates anything', () => {
  const body = handlerAfter(GUI, 'const traceNameCtrl =', 'trace rename');
  const splitsGate = body.indexOf('chainSplitsError(trace.chainSplits');
  const firstMutation = body.indexOf('trace.groupName = newName');
  assert.notEqual(splitsGate, -1, 'the splits gate must exist in the rename handler');
  assert.ok(splitsGate < firstMutation,
    'a refused regenerate after a half-applied rename strands the old-named group');
  // And it reverts the edit rather than leaving the input showing a name that
  // was never applied.
  const gateSlice = body.slice(splitsGate, firstMutation);
  assert.match(gateSlice, /trace\.name = committedTraceName/);
  assert.match(gateSlice, /traceNameCtrl\.updateDisplay\(\)/);
});

// ── Step 9: check + invalidate is the DEFAULT, and it is loud ──────────────

test('the trace rename invalidates the old-name mapping BEFORE the regenerate', () => {
  const body = handlerAfter(GUI, 'const traceNameCtrl =', 'trace rename');
  const invalidate = body.indexOf('invalidateMappingForRename(');
  const regenerate = body.indexOf('generateGroupFromTrace(i, true, oldGroupName)');
  assert.notEqual(invalidate, -1);
  assert.notEqual(regenerate, -1);
  assert.ok(invalidate < regenerate,
    'invalidating first is what keeps the regenerate\'s casualty hook quiet — ' +
    'otherwise it fires the misleading "deleted fixture(s) … channels freed" toast');
});

test('the invalidation helper enumerates, prunes, clears and reports — in that order', () => {
  const at = GUI.indexOf('function invalidateMappingForRename');
  assert.notEqual(at, -1);
  const body = GUI.slice(at, at + 4000);
  const order = ['invalidateFixtureMappings(', 'pruneGlobalPatchTreeKeys(',
    'buildInvalidationReport(', 'console.warn(`[Rename] ${line}`)'];
  let cursor = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.notEqual(i, -1, `missing ${needle}`);
    assert.ok(i > cursor, `${needle} is out of order`);
    cursor = i;
  }
});

test('the default rename path NEVER calls the opt-in migrate primitive', () => {
  assert.doesNotMatch(GUI, /renameFixtureInChains/,
    'step 11b (⇄ Migrate addresses to new name) is operator-gated and unbuilt — ' +
    'wiring it into gui_builder would make silent carry-over the default');
  assert.match(REGISTRY, /export function renameFixtureInChains/,
    'the primitive itself must survive for the gated affordance');
});

// ── Step 10: patch-tree phantoms ───────────────────────────────────────────

test('main.js exposes the patch-tree pruning helper and never copies values over', () => {
  assert.match(MAIN, /window\.pruneGlobalPatchTreeKeys = function/);
  assert.match(MAIN, /prunePatchTreeEntries\(window\.__globalPatchTree, names\)/);
  const at = MAIN.indexOf('window.pruneGlobalPatchTreeKeys');
  const body = MAIN.slice(at, at + 400);
  assert.doesNotMatch(body, /__globalPatchTree\[[^\]]*\]\s*=/,
    'copying an old record onto the new name is the silent carry-over the ruling bans');
});

test('the group rename does NOT reproject before its regenerate (phantom resurrection)', () => {
  // Found live by trace_rename_verify.cjs: projectControllerMappings re-mints a
  // __globalPatchTree entry for EVERY live config, so reprojecting while the
  // OLD-named fixtures are still in params.parLights resurrects the phantoms
  // that were just pruned. The regenerate reprojects after the sweep instead.
  const body = handlerAfter(GUI, 'const traceNameCtrl =', 'trace rename');
  assert.match(body, /reproject:\s*false/,
    'the group rename must defer the projection to the regenerate');
  const helper = GUI.slice(GUI.indexOf('function invalidateMappingForRename'));
  assert.match(helper.slice(0, 4000),
    /if \(reproject && window\.__controllerRegistry && window\.projectControllerMappings\)/);
});

// ── Step 11: individual renames ────────────────────────────────────────────

test('renaming a GENERATED fixture is refused loudly, pointing at the real controls', () => {
  assert.match(GUI, /function refuseGeneratedFixtureRename\(/);
  const at = GUI.indexOf('function refuseGeneratedFixtureRename');
  const body = GUI.slice(at, at + 1400);
  assert.match(body, /rename the GROUP/i, 'the refusal must name the group-rename path');
  assert.match(body, /Chain Order/, 'and the chain-splits path');
  // Wired to the generated-fixture card, and only for generated fixtures.
  const handler = handlerAfter(GUI, 'const genNameCtrl =', 'generated fixture rename');
  assert.match(handler, /if \(config\.traceGenerated\)/);
  assert.match(handler, /alert\(refuseGeneratedFixtureRename\(/);
  assert.match(handler, /config\.name = committedGenName/, 'and reverts the edit');
});

test("'name' can never be propagated across a multi-select", () => {
  assert.doesNotMatch(GUI, /propagateToSelected\([^)]*['"]name['"]/,
    'this stamped ONE name onto every selected fixture');
  const at = GUI.indexOf('function propagateToSelected');
  const body = GUI.slice(at, at + 800);
  assert.match(body, /property === 'name'/);
  assert.match(body, /throw new Error/, 'a silent skip would hide the caller bug');
});

test('every hand-placed / DMX / strand rename goes through renameSingleFixture', () => {
  assert.match(GUI, /function renameSingleFixture\(/);
  for (const [ctrl, label] of [
    ['parNameCtrl', 'hand-placed par'],
    ['dmxNameCtrl', 'DMX scene fixture'],
    ['strandNameCtrl', 'LED strand'],
    ['genNameCtrl', 'non-generated fixture on a generator card'],
  ]) {
    const body = handlerAfter(GUI, `const ${ctrl} =`, label);
    assert.match(body, /renameSingleFixture\(/, `${label} must use the shared policy`);
  }
});

test('renameSingleFixture refuses duplicates and invalidates the old mapping', () => {
  const at = GUI.indexOf('function renameSingleFixture');
  const body = GUI.slice(at, at + 1600);
  assert.match(body, /duplicateNameError\(/);
  assert.match(body, /alert\(dupErr\)/);
  assert.match(body, /config\.name = oldName/, 'a refused rename reverts');
  assert.match(body, /return false/);
  assert.match(body, /invalidateMappingForRename\(/);
  // Duplicate detection must consider LED strands too — they share the name space.
  assert.match(body, /params\.ledStrands/);
});

test('a renamed strand re-runs the LED projection after the DMX one', () => {
  const at = GUI.indexOf('function invalidateMappingForRename');
  const body = GUI.slice(at, at + 4000);
  const dmx = body.indexOf('window.projectControllerMappings(');
  const led = body.indexOf('window.projectLedStrandPatches()');
  assert.ok(dmx !== -1 && led !== -1);
  assert.ok(dmx < led, 'LED ids continue above the DMX max — order is load-bearing');
});

// ── Step 12: par-group rename parity ───────────────────────────────────────

test('the par-group rename invalidates the batch cache, like the LED one', () => {
  const at = GUI.indexOf("prompt('Rename group:'");
  assert.notEqual(at, -1);
  const body = GUI.slice(at, at + 2600);
  assert.match(body, /invalidateMarsinBatchCache\('par_group_rename'\)/,
    'batch entries cache entry.group and view isolation reads it (animate.js)');
  assert.match(body, /migratePixelMapGroupSelectors\(groupName, nn\)/);
});

test('the LED-group rename re-points 2D Pixel Map selectors too', () => {
  const at = GUI.indexOf("prompt('Rename LED group:'");
  assert.notEqual(at, -1);
  const body = GUI.slice(at, at + 2200);
  assert.match(body, /migratePixelMapGroupSelectors\(groupName, nn\)/);
  assert.match(body, /invalidateMarsinBatchCache\('led_group_rename'\)/);
});

test('the pixel-map migration never forces a save of its own', () => {
  const at = STORE.indexOf('export function renameGroupInPixelMapViews');
  assert.notEqual(at, -1);
  const body = STORE.slice(at, STORE.indexOf('export function commitViews'));
  assert.match(body, /renameGroupInViews\(/);
  assert.doesNotMatch(body, /commitViews\(\)/,
    'a probe harness with auto-save stubbed must stay a no-write');
  assert.doesNotMatch(body, /debounceAutoSave/);
});

// ── The wording the operator sees ──────────────────────────────────────────

test('no rename path can reach the misleading "channels freed" toast', () => {
  // That string belongs to controller_map_editor's DELETION hook. The rename
  // pre-invalidates, so the hook finds nothing left and stays silent — and
  // gui_builder must never print the phrase itself. (Comment lines quoting the
  // old wording as history are fine; emitted strings are not.)
  const code = GUI.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /channels freed/);
  assert.doesNotMatch(code, /deleted fixture\(s\) unmapped/);
});
