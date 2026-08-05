// Regression tests for the offline audio harness's SOURCE-INJECTION parity
// with the live engine (report _140).
//
// `tools/pattern_audio_harness.mjs` used to drive lib/marsin_wasm_runtime.js
// directly and apply ONLY injectFixtureConstants(), against the RAW model
// module (every pixel's vMask still 0). So a pattern that used the documented
// targeting layer — `inView("Authored View Name")` (docs/MARSIN_ENGINE_PATTERNS
// §7.3) — died with `COMPILE_FAIL: Line N: strings cannot be used as a function
// argument`, and everything built on the harness inherited it (--gate,
// tools/gallery/gen_variations.mjs, the offline clip path).
//
// The harness now compiles through WasmHost.compile() on a model resolved by
// loadModelForGauge(), so all three injection passes run in the engine's order
// (inView folding -> MASK_* -> FIX_*) against the engine's own view table.
//
// These tests pin the four things that must not silently regress:
//   1. an inView() pattern COMPILES and renders the view's real pixel set,
//   2. two disjoint views stay disjoint (the fold reads the right word/bit),
//   3. an unknown view name is a LOUD compile failure naming the view
//      (codex P0 — never a silent constant-false test),
//   4. the Tier-A AUTO-views (`LEFT`, `Strands`, …) resolve here too — they
//      come from `deriveAutoViews`, which `loadModelForGauge()` does not call,
//      so the harness gets them from the shared lib/view_catalog.js the engine
//      itself uses (report _147). Before that they were a COMPILE_FAIL offline
//      and a valid view on the rig — for names the docs actively recommend.
//
// Run: cd marsin_engine && node --test tests/tools/harness_inview_injection.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ENGINE_DIR, 'tools', 'pattern_audio_harness.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bm26_harness_inview_'));

// Two AUTHORED titanic views that live in the HIGH view word (viewMaskHi) and
// are separate physical instruments: 'Hull Canvas' (the four hull walls) and
// 'Stacks' (the four smokestacks). Membership is asserted against the model
// loader below, so the numbers stay honest if the model is re-authored.
const HULL_VIEW = 'Hull Canvas';
const STACKS_VIEW = 'Stacks';

const INVIEW_PATTERN = `
export function render3D(index, x, y, z) {
  if (inView("${HULL_VIEW}")) {
    rgb(1, 0, 0);
  } else if (inView("${STACKS_VIEW}")) {
    rgb(0, 1, 0);
  } else {
    rgb(0, 0, 0);
  }
}
`;

const UNKNOWN_VIEW_PATTERN = `
export function render3D(index, x, y, z) {
  if (inView("No Such View")) { rgb(1, 1, 1); } else { rgb(0, 0, 0); }
}
`;

function writePattern(name, src) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, src);
  return p;
}

// Short gate window (--gate-frames) keeps the subprocess fast; the injection
// behaviour under test happens entirely at compile time.
function runHarness(args) {
  const r = spawnSync('node', [HARNESS, ...args], { cwd: ENGINE_DIR, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/** Expected member count of a named view, straight from the engine's loader. */
async function viewMemberCount(modelName, viewName) {
  const { loadModelForGauge } = await import('../../lib/model_loader.js');
  const loaded = await loadModelForGauge(modelName);
  const vm = loaded.viewMasks.find((v) => v.name === viewName);
  assert.ok(vm, `model ${modelName} has no view named "${viewName}"`);
  const lane = vm.word === 1 ? 'viewMaskHi' : 'viewMask';
  return loaded.metaArray.filter((m) => (m[lane] & vm.bit) !== 0).length;
}

test('an inView() pattern compiles in the harness and renders the view pixel sets', async () => {
  const p = writePattern('inview_probe.js', INVIEW_PATTERN);
  const capture = path.join(TMP, 'inview_probe.json');
  const r = runHarness(['--pattern', p, '--model', 'titanic', '--synth', 'silence',
    '--frames', '4', '--gate-frames', '4', '--out', capture]);
  assert.match(r.out, /COMPILE_OK/, `inView() must compile offline; got:\n${r.out}`);
  assert.equal(r.code, 0);

  const hullCount = await viewMemberCount('titanic', HULL_VIEW);
  const stacksCount = await viewMemberCount('titanic', STACKS_VIEW);
  assert.ok(hullCount > 0 && stacksCount > 0, 'both views must have members');

  const frame = JSON.parse(fs.readFileSync(capture, 'utf8')).frames[0];
  const hullPixels = new Set();
  const stackPixels = new Set();
  let mixed = 0;
  frame.forEach(([red, green, blue], i) => {
    if (red > 200 && green < 8 && blue < 8) hullPixels.add(i);
    else if (green > 200 && red < 8 && blue < 8) stackPixels.add(i);
    else if (red >= 8 || green >= 8 || blue >= 8) mixed += 1;
  });
  assert.equal(hullPixels.size, hullCount, `${HULL_VIEW} must light exactly its members`);
  assert.equal(stackPixels.size, stacksCount, `${STACKS_VIEW} must light exactly its members`);
  assert.equal(mixed, 0, 'no pixel may render a colour neither branch emits');
  // Disjoint instruments: the two folds must not resolve to the same bit.
  const overlap = [...hullPixels].filter((i) => stackPixels.has(i));
  assert.equal(overlap.length, 0, 'the two views are disjoint instruments');
});

test('an inView() pattern still runs the --gate verdict', () => {
  const p = writePattern('inview_probe.js', INVIEW_PATTERN);
  const r = runHarness(['--pattern', p, '--model', 'titanic', '--synth', 'silence',
    '--frames', '4', '--gate-frames', '4', '--gate', '--out', path.join(TMP, 'gate.json')]);
  assert.match(r.out, /GATE_PASS/, `a lit inView pattern must pass the gate; got:\n${r.out}`);
  assert.equal(r.code, 0);
});

// ── Tier-A auto-views (report _147) ────────────────────────────────────────
// `LEFT` (a whole-ship half, membership by pixelIndices) and `Strands` (a
// typed view over the LED strands) are DERIVED — they exist only after
// deriveAutoViews runs, and they carry bit:0 until inView() promotes one on
// demand. Expected counts are read from the shared catalog at runtime so the
// numbers stay honest if titanic is re-authored.
const AUTO_VIEWS = ['LEFT', 'Strands'];

/** Member count of a bit-free auto-view, from the shared catalog's entry. */
async function autoViewMemberCount(modelName, viewName) {
  const { loadModelForGauge } = await import('../../lib/model_loader.js');
  const { buildViewCatalog } = await import('../../lib/view_catalog.js');
  const loaded = await loadModelForGauge(modelName);
  buildViewCatalog(loaded);
  const vm = loaded.viewMasks.find((v) => v.name === viewName);
  assert.ok(vm, `model ${modelName} has no view named "${viewName}"`);
  assert.equal(vm._autoView, true, `"${viewName}" must be a derived (Tier-A) auto-view`);
  if (Array.isArray(vm.pixelIndices)) return vm.pixelIndices.length;
  const groups = new Set(vm.groups);
  return loaded.pixels.filter((p) => p && groups.has(p.group)).length;
}

for (const viewName of AUTO_VIEWS) {
  test(`the derived auto-view "${viewName}" resolves offline and lights its members`, async () => {
    const expected = await autoViewMemberCount('titanic', viewName);
    assert.ok(expected > 0, `"${viewName}" must have members`);

    const p = writePattern('auto_view_probe.js', `
export function render3D(index, x, y, z) {
  if (inView("${viewName}")) { rgb(1, 0, 0); } else { rgb(0, 0, 0); }
}
`);
    const capture = path.join(TMP, 'auto_view_probe.json');
    const r = runHarness(['--pattern', p, '--model', 'titanic', '--synth', 'silence',
      '--frames', '4', '--gate-frames', '4', '--out', capture]);
    assert.match(r.out, /COMPILE_OK/,
      `inView("${viewName}") must compile offline — the auto-views are part of the ` +
      `engine's catalog; got:\n${r.out}`);
    assert.equal(r.code, 0);

    const frame = JSON.parse(fs.readFileSync(capture, 'utf8')).frames[0];
    const lit = frame.filter(([red, green, blue]) => red > 200 && green < 8 && blue < 8).length;
    const anyLight = frame.filter(([red, green, blue]) => red >= 8 || green >= 8 || blue >= 8).length;
    assert.equal(lit, expected, `inView("${viewName}") must light exactly its ${expected} members`);
    assert.equal(anyLight, expected, 'no pixel outside the view may light');
  });
}

test('an UNKNOWN inView() name is a loud COMPILE_FAIL naming the view', () => {
  const p = writePattern('inview_unknown.js', UNKNOWN_VIEW_PATTERN);
  const r = runHarness(['--pattern', p, '--model', 'titanic', '--synth', 'silence',
    '--frames', '4', '--gate-frames', '4', '--out', path.join(TMP, 'unknown.json')]);
  assert.match(r.out, /COMPILE_FAIL: Pattern references unknown view\(s\) via inView\(\): No Such View/,
    `an unknown view must fail loudly and name itself; got:\n${r.out}`);
  assert.match(r.out, /Known views for this model:/, 'the error must list the known views');
  // The known-view list must be the FULL catalog, auto-views included — a
  // truncated list is how the offline/engine parity gap hid for so long.
  for (const viewName of AUTO_VIEWS) {
    assert.ok(r.out.includes(viewName),
      `the known-views list must name the derived view "${viewName}"; got:\n${r.out}`);
  }
  assert.equal(r.code, 2, 'unknown view must be a non-zero (2) exit, never a silent render');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });
