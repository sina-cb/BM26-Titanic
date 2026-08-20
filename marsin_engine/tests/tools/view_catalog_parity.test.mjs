// Parity tests for the OFFLINE `inView()` view catalog vs. the ENGINE's
// (report _147).
//
// engine.js builds its `inView()` table from `groupBits` + `viewMasks` AFTER
// appending `deriveAutoViews(pixels, existingMaskNames)` — 58 resolvable names
// on titanic. The three offline tools (`tools/pattern_audio_harness.mjs`,
// `tools/pattern_derived_harness.mjs`, `tools/param_truth/render_context.js`)
// built theirs from `loadModelForGauge()` alone, which never calls
// `deriveAutoViews`, so they held 31 — and `inView("LEFT")` was a COMPILE_FAIL
// offline while it compiled on the rig (report 20260804_146 §4).
//
// The sequence now lives in `lib/view_catalog.js`, which engine.js calls
// itself. These tests are the anti-drift net:
//
//   1. an INDEPENDENT reference transcription of engine.js's documented
//      sequence (deriveAutoViews with the same `existingMaskNames` seed, the
//      same append order, the same word placement) must produce a table
//      byte-equal to `buildViewCatalog()`'s, on every tracked model. If the
//      shared helper ever drifts from what the engine's load sequence means,
//      this fails.
//   2. the AUDIO harness's real known-views list (read out of its loud
//      COMPILE_FAIL) must be exactly the shared table's names, in order.
//   3. the DERIVED harness's must too.
//   4. `tools/param_truth/render_context.js` — the third tool, driven
//      in-process rather than by subprocess — must resolve the same catalog.
//
// Nothing here binds a port or boots the engine: the engine-side table is
// constructed in-process from the same library functions engine.js imports.
//
// Run: cd marsin_engine && node --test tests/tools/view_catalog_parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { deriveAutoViews } from '../../lib/auto_views.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';
import { buildViewCatalog } from '../../lib/view_catalog.js';
import { createRenderContext } from '../../tools/param_truth/render_context.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIO_HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const DERIVED_HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_derived_harness.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_view_catalog_parity_'));

// Every tracked model the offline tools accept.
const MODELS = ['titanic', 'test_bench', 'studio_top_loft'];

const UNKNOWN_VIEW = 'No Such View';

/**
 * The ENGINE's table, transcribed from engine.js's load sequence and
 * DELIBERATELY not routed through lib/view_catalog.js — it is the oracle the
 * shared helper is checked against, so a transcription that merely calls the
 * helper would prove nothing.
 */
function referenceEngineTable(loaded) {
  const { pixels, pixelCount, groupBits, viewMasks } = loaded;
  // engine.js: existingMaskNames = base group names + resolved preset names.
  const existingMaskNames = new Set([
    ...Object.keys(groupBits),
    ...viewMasks.map(vm => vm.name),
  ]);
  const autoViews = deriveAutoViews(pixels, existingMaskNames);
  // Report _148 (operator ruling): a STRUCTURAL auto-view whose membership is
  // byte-identical to an already-authored view's is not registered — the
  // authored name is canonical. Membership is resolved HERE through
  // lib/mask_registry.js's own `members[]`, a different code path from the
  // helper's internal resolver, so agreement is evidence rather than tautology.
  const authoredMembers = buildMaskRegistry({ pixels, pixelCount, groupBits, viewMasks });
  const autoMembers = buildMaskRegistry({
    pixels, pixelCount, groupBits: {}, viewMasks: autoViews.entries,
  });
  const structural = new Set(autoViews.families.structural);
  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const kept = autoViews.entries.filter((entry) => {
    if (!structural.has(entry.name)) return true;
    const mine = autoMembers.get(entry.name).members;
    return !authoredMembers.names().some((n) => sameBytes(mine, authoredMembers.get(n).members));
  });
  const all = [...viewMasks, ...kept];
  // engine.js: base groups are word-0 views; presets/auto-views carry their
  // own bit + word; a bit-free view lands at bit 0 (promotable, not unknown).
  const table = {};
  for (const [group, bit] of Object.entries(groupBits)) table[group] = { bit, word: 0 };
  for (const vm of all) {
    table[vm.name] = { bit: Number.isInteger(vm.bit) ? vm.bit : 0, word: vm.word === 1 ? 1 : 0 };
  }
  return table;
}

/** Names listed by a harness's loud unknown-view COMPILE_FAIL. */
function knownViewsFromHarness(harness, extraArgs) {
  const patternPath = path.join(TMP, 'unknown_view_probe.js');
  fs.writeFileSync(patternPath, 'export var sliderLevel = 1;\n' +
    'export function render3D(index, x, y, z) {\n' +
    `  if (inView("${UNKNOWN_VIEW}")) { rgb(1, 0, 0); } else { rgb(0, 0, 0); }\n}\n`);
  const r = spawnSync('node', [harness, '--pattern', patternPath, '--model', 'titanic',
    '--synth', 'silence', '--frames', '2', '--out', path.join(TMP, 'unused.json'),
    ...extraArgs], { cwd: ENGINE_DIR, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 2, `an unknown view must exit 2; got ${r.status}:\n${out}`);
  const m = out.match(/Known views for this model: (.*)$/m);
  assert.ok(m, `the COMPILE_FAIL must list the known views; got:\n${out}`);
  return m[1].trim().split(', ');
}

for (const modelName of MODELS) {
  test(`the shared view catalog matches the engine's construction on ${modelName}`, async () => {
    // Two independent loads — the reference must never see the helper's
    // mutation of `viewMasks`.
    const forReference = await loadModelForGauge(modelName);
    const forShared = await loadModelForGauge(modelName);

    const reference = referenceEngineTable(forReference);
    const { viewTable } = buildViewCatalog(forShared);

    assert.deepEqual(Object.keys(viewTable), Object.keys(reference),
      `${modelName}: the offline catalog's names (and their order) must match the engine's`);
    assert.deepEqual(viewTable, reference,
      `${modelName}: every name must resolve to the same { bit, word } as the engine's table`);
  });
}

test('titanic carries its full derived catalog, not just the bit-backed views', async () => {
  const loaded = await loadModelForGauge('titanic');
  const bitBacked = Object.keys(loaded.groupBits).length + loaded.viewMasks.length;
  const { viewTable } = buildViewCatalog(loaded);
  const names = Object.keys(viewTable);
  assert.ok(names.length > bitBacked,
    `the catalog must exceed the ${bitBacked} bit-backed names — the derived auto-views ` +
    `are the whole point (got ${names.length})`);
  // The names the docs steer pattern authors at (docs/MARSIN_ENGINE_PATTERNS
  // §7.3.2). Every one of these was an offline COMPILE_FAIL before _147.
  for (const name of ['LEFT', 'RIGHT', 'FRONT', 'BACK', 'Strands', 'TE Signs', '@BAR']) {
    assert.ok(name in viewTable, `titanic's catalog must carry the derived view "${name}"`);
    assert.equal(viewTable[name].bit, 0, `"${name}" is Tier-A — bit-free until promoted`);
  }
});

test('the structural duplicates WALLS / AUDITORIUM are retired on titanic', async () => {
  const loaded = await loadModelForGauge('titanic');
  const { viewTable, autoViews } = buildViewCatalog(loaded);

  // 58 = 24 base groups + 7 authored composites + 27 auto-views.
  assert.equal(Object.keys(viewTable).length, 58,
    "titanic's catalog is 58 names after the _148 structural dedup");
  for (const gone of ['WALLS', 'AUDITORIUM']) {
    assert.ok(!(gone in viewTable), `"${gone}" duplicates an authored view and must be gone`);
    assert.ok(!loaded.viewMasks.some((vm) => vm.name === gone),
      `"${gone}" must not be registered as a selectable mask either`);
  }
  // The survivors are the authored names, at the same pixel counts.
  for (const name of ['Hull Canvas', 'Auditoriums']) {
    assert.ok(name in viewTable, `the authored "${name}" is canonical and must remain`);
  }
  // The drop is reported, never silent — and it names its twin.
  assert.deepEqual(autoViews.deduped.map((d) => [d.name, d.twin, d.pixels]),
    [['WALLS', 'Hull Canvas', 360], ['AUDITORIUM', 'Auditoriums', 16]]);
  for (const twin of ['Hull Canvas', 'Auditoriums']) {
    assert.ok(autoViews.warnings.some((w) => w.includes(`'${twin}'`)),
      `the dedup of "${twin}"'s duplicate must surface in warnings`);
  }
  // Fixture-capability targeting is NOT deduped, even though @BAR covers the
  // same 360 pixels as Hull Canvas — operator ruling, report _148.
  assert.ok('@BAR' in viewTable, '@BAR stays as fixture-capability targeting');
});

test('scenes without an authored twin keep their structural views', async () => {
  // test_bench and studio_top_loft carry no structural band token at all, so
  // the dedup must be a no-op there — it may never shrink a catalog that has
  // no duplicate to retire.
  for (const modelName of ['test_bench', 'studio_top_loft']) {
    const forReference = await loadModelForGauge(modelName);
    const existing = new Set([
      ...Object.keys(forReference.groupBits),
      ...forReference.viewMasks.map((vm) => vm.name),
    ]);
    const underived = deriveAutoViews(forReference.pixels, existing);

    const loaded = await loadModelForGauge(modelName);
    const { autoViews } = buildViewCatalog(loaded);
    assert.deepEqual(autoViews.entries.map((e) => e.name), underived.entries.map((e) => e.name),
      `${modelName}: no auto-view may be dropped without a byte-identical authored twin`);
    assert.deepEqual(autoViews.deduped, [], `${modelName}: nothing to dedup`);
  }
});

test("the AUDIO harness's known-view list is exactly the shared catalog", async () => {
  const loaded = await loadModelForGauge('titanic');
  const { viewTable } = buildViewCatalog(loaded);
  const known = knownViewsFromHarness(AUDIO_HARNESS, ['--gate-frames', '2']);
  assert.deepEqual(known, Object.keys(viewTable),
    'the harness must resolve against the engine-parity catalog, whole and in order');
});

test("the DERIVED harness's known-view list is exactly the shared catalog", async () => {
  const loaded = await loadModelForGauge('titanic');
  const { viewTable } = buildViewCatalog(loaded);
  const known = knownViewsFromHarness(DERIVED_HARNESS, ['--mod', 'micLow:sliderLevel']);
  assert.deepEqual(known, Object.keys(viewTable),
    'the harness must resolve against the engine-parity catalog, whole and in order');
});

test('param_truth render_context resolves the same catalog', async () => {
  const loaded = await loadModelForGauge('titanic');
  const { viewTable } = buildViewCatalog(loaded);
  const ctx = await createRenderContext('titanic');
  try {
    // A derived name compiles…
    const ok = ctx.inspect('export function render3D(index, x, y, z) {\n' +
      '  if (inView("LEFT")) { rgb(1, 0, 0); } else { rgb(0, 0, 0); }\n}\n');
    assert.equal(ok.ok, true, `inView("LEFT") must compile in the param_truth context: ${ok.error}`);

    // …and an unknown one fails loudly, listing the same whole catalog.
    const bad = ctx.inspect('export function render3D(index, x, y, z) {\n' +
      `  if (inView("${UNKNOWN_VIEW}")) { rgb(1, 0, 0); } else { rgb(0, 0, 0); }\n}\n`);
    assert.equal(bad.ok, false, 'an unknown view must never compile');
    const m = bad.error.match(/Known views for this model: (.*)$/m);
    assert.ok(m, `the error must list the known views; got: ${bad.error}`);
    assert.deepEqual(m[1].trim().split(', '), Object.keys(viewTable),
      'param_truth must resolve against the engine-parity catalog, whole and in order');
  } finally {
    ctx.close();
  }
});

test('assembling the catalog twice for one model is a loud failure', async () => {
  const loaded = await loadModelForGauge('titanic');
  buildViewCatalog(loaded);
  assert.throws(() => buildViewCatalog(loaded), /assembled twice/,
    'a double append would register every auto-view twice — it must never be tolerated');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });
