// Regression tests for the DERIVED-signal harness's SOURCE-INJECTION and
// model-resolution parity with the live engine (report _142, mirroring _140).
//
// `tools/pattern_derived_harness.mjs` used to bare-`import` the raw model
// module and drive lib/marsin_wasm_runtime.js, which has NO injection stage.
// Measured consequences on `--model titanic`:
//   • `inView("Name")` → `COMPILE_FAIL: strings cannot be used as a function
//     argument`; `MASK_*` → `Undefined var MASK_STACKS`; `FIX_*` → `Undefined
//     var FIX_PAR`;
//   • the meta pack carried only 4 of the ABI's 7 lanes, so `fixtureType` and
//     `pixelLocalIndex` read 0 for EVERY pixel (a `pixelLocalIndex == 0` probe
//     lit all 964 instead of the true 88) and `viewMaskHi` — where all 17
//     titanic composite views live — was absent entirely.
//
// The harness now resolves the model with `loadModelForGauge()` and compiles
// through `WasmHost.compile()`, so the three passes run in the engine's order
// (inView folding -> MASK_* -> FIX_*) against the engine's own view table and
// the full 7-field meta ABI.
//
// The derived harness's trace JSON stores per-frame TOTAL brightness, not
// per-pixel colour, so these tests probe with patterns that light a target set
// full-red and nothing else: totalBri / 255 is then exactly the member count.
//
// Run: cd marsin_engine && node --test tests/tools/derived_harness_inview_injection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_derived_harness.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_derived_harness_'));
const MODEL = 'titanic';

// Two AUTHORED titanic views that live in the HIGH view word (viewMaskHi) and
// are separate physical instruments. Membership is read from the model loader
// below, so the numbers stay honest if the model is re-authored.
const HULL_VIEW = 'Hull Canvas';
const STACKS_VIEW = 'Stacks';

// A `sliderLevel` export exists only so the harness's required --mod target
// resolves; the probes' output does not depend on it.
const PROBE_HEAD = 'export var sliderLevel = 1;\n';

function probe(test_) {
  return `${PROBE_HEAD}export function render3D(index, x, y, z) {\n  if (${test_}) { rgb(1, 0, 0); } else { rgb(0, 0, 0); }\n}\n`;
}

function writePattern(name, src) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, src);
  return p;
}

/** Run the harness on a probe; return { code, out, litPixels } (null if no render). */
function runProbe(name, src) {
  const p = writePattern(name, src);
  const outPath = path.join(TMP, name.replace(/\.js$/, '.json'));
  const r = spawnSync('node', [HARNESS, '--pattern', p, '--model', MODEL, '--synth', 'silence',
    '--frames', '2', '--mod', 'micLow:sliderLevel', '--out', outPath],
    { cwd: ENGINE_DIR, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  let litPixels = null;
  if (fs.existsSync(outPath)) {
    const trace = JSON.parse(fs.readFileSync(outPath, 'utf8')).trace;
    const bri = trace.map((row) => row.totalBri);
    // Every probe is static, so all frames must agree — a moving total would
    // mean the probe is not measuring set membership.
    assert.ok(bri.every((b) => b === bri[0]), `probe ${name} must render a constant total; got ${bri}`);
    assert.equal(bri[0] % 255, 0, `probe ${name} must light whole pixels at full red; got ${bri[0]}`);
    litPixels = bri[0] / 255;
  }
  return { code: r.status, out, litPixels };
}

let loaded;
test.before(async () => { loaded = await loadModelForGauge(MODEL); });

/** Member count of a named view, straight from the engine's loader. */
function viewMemberCount(viewName) {
  const vm = loaded.viewMasks.find((v) => v.name === viewName);
  assert.ok(vm, `model ${MODEL} has no view named "${viewName}"`);
  const lane = vm.word === 1 ? 'viewMaskHi' : 'viewMask';
  return loaded.metaArray.filter((m) => (m[lane] & vm.bit) !== 0).length;
}

test('inView() compiles in the derived harness and lights exactly the view members', () => {
  const hullCount = viewMemberCount(HULL_VIEW);
  const stacksCount = viewMemberCount(STACKS_VIEW);
  assert.ok(hullCount > 0 && stacksCount > 0, 'both views must have members');

  const hull = runProbe('probe_hull.js', probe(`inView("${HULL_VIEW}")`));
  assert.match(hull.out, /COMPILE_OK/, `inView() must compile offline; got:\n${hull.out}`);
  assert.equal(hull.code, 0);
  assert.equal(hull.litPixels, hullCount, `${HULL_VIEW} must light exactly its members`);

  const stacks = runProbe('probe_stacks.js', probe(`inView("${STACKS_VIEW}")`));
  assert.equal(stacks.code, 0);
  assert.equal(stacks.litPixels, stacksCount, `${STACKS_VIEW} must light exactly its members`);

  // Disjoint instruments: the union must be the exact sum, i.e. the two folds
  // resolved to different bits (and both out of the HIGH word).
  const both = runProbe('probe_both.js',
    probe(`inView("${HULL_VIEW}") || inView("${STACKS_VIEW}")`));
  assert.equal(both.code, 0);
  assert.equal(both.litPixels, hullCount + stacksCount,
    'the two views are disjoint instruments — the union must be their sum');
});

test('MASK_* and FIX_* constants resolve, and the 7-lane meta ABI reads true', () => {
  // MASK_* injection (pass 2) on a word-1 view.
  const stacksCount = viewMemberCount(STACKS_VIEW);
  const mask = runProbe('probe_mask.js', probe('viewMaskHi & MASK_STACKS'));
  assert.match(mask.out, /COMPILE_OK/, `MASK_* must compile offline; got:\n${mask.out}`);
  assert.equal(mask.litPixels, stacksCount, 'MASK_STACKS must select the Stacks members');

  // FIX_* injection (pass 3) + the fixtureTypeId meta lane, which the old
  // 4-lane pack omitted entirely.
  const parId = loaded.fixtureConstants.FIX_PAR;
  assert.ok(parId, 'titanic must expose a FIX_PAR fixture-type constant');
  const parCount = loaded.metaArray.filter((m) => m.fixtureTypeId === parId).length;
  assert.ok(parCount > 0 && parCount < loaded.pixels.length, 'FIX_PAR must be a proper subset');
  const fix = runProbe('probe_fixtype.js', probe('fixtureType == FIX_PAR'));
  assert.match(fix.out, /COMPILE_OK/, `FIX_* must compile offline; got:\n${fix.out}`);
  assert.equal(fix.litPixels, parCount, 'the fixtureType builtin must read the packed lane');

  // pixelLocalIndex lane — one pixel per fixture has local index 0. Before the
  // fix the lane was never packed, so EVERY pixel matched.
  const firstPixels = loaded.metaArray.filter((m) => m.pixelLocalIndex === 0).length;
  assert.ok(firstPixels > 0 && firstPixels < loaded.pixels.length,
    'pixelLocalIndex==0 must be a proper subset (it was all pixels before the fix)');
  const local = runProbe('probe_local_index.js', probe('pixelLocalIndex == 0'));
  assert.equal(local.litPixels, firstPixels, 'the pixelLocalIndex builtin must read the packed lane');
});

test('an UNKNOWN inView() name is a loud COMPILE_FAIL naming the view', () => {
  const r = runProbe('probe_unknown_view.js', probe('inView("No Such View")'));
  assert.match(r.out, /COMPILE_FAIL: Pattern references unknown view\(s\) via inView\(\): No Such View/,
    `an unknown view must fail loudly and name itself; got:\n${r.out}`);
  assert.match(r.out, /Known views for this model:/, 'the error must list the known views');
  assert.equal(r.code, 2, 'unknown view must be a non-zero (2) exit, never a silent render');
});

test('a model that exists but does not resolve is a loud MODEL_FAIL', () => {
  const p = writePattern('probe_plain.js', probe('1'));
  // titanic.effects.js is a real file next to the models, but exports effects,
  // not pixels[] — the loader must reject it rather than half-load it.
  const r = spawnSync('node', [HARNESS, '--pattern', p, '--model', 'titanic.effects',
    '--synth', 'silence', '--frames', '2', '--mod', 'micLow:sliderLevel',
    '--out', path.join(TMP, 'unused.json')], { cwd: ENGINE_DIR, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.match(out, /MODEL_FAIL: titanic\.effects failed to load:/,
    `a non-resolving model must be a named MODEL_FAIL; got:\n${out}`);
  assert.equal(r.status, 2);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });
