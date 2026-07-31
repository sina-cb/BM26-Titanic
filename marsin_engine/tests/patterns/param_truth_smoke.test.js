// param_truth_smoke.test.js — CI smoke for the parameter truth harness.
//
// The FULL sweep (tools/param_truth/run_param_truth.mjs, ~150 patterns) takes
// tens of minutes and is run on demand, not in CI. This file runs the same
// harness over a tiny fixed subset so that the machinery itself — discovery,
// offline compile, control seeding, measurement, classification — stays green,
// and so a change that breaks the harness is caught here instead of at the next
// manual sweep.
//
// It asserts the harness's PROPERTIES, not a frozen verdict census: pattern
// files belong to the curator lineage and are edited routinely, so pinning
// "01_cylon_sweep has exactly N TRUE params" would make this test fail on
// someone else's legitimate work. What is pinned is what the harness must
// always be able to do.
//
// Full sweep (not run here):
//   node tools/param_truth/run_param_truth.mjs --cross-model test_bench

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { discoverPatterns } from '../../tools/param_truth/pattern_discovery.js';
import { createRenderContext, PATTERNS_DIR } from '../../tools/param_truth/render_context.js';
import { buildAxisBins, correlate, hueDistance } from '../../tools/param_truth/metrics.js';
import { claimOf, tokenise, monotonicity, FAMILY } from '../../tools/param_truth/claims.js';
import { sweepPattern, tally, VERDICT } from '../../tools/param_truth/sweep.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deliberately varied but CHEAP. `27_swipe` carries only six sliders and is
// swept whole (that is what proves every declared slider gets a verdict); the
// other two are narrowed to the controls that exercise a different claim family
// — emitters and a speed/white pair.
//
// The narrowing is not cosmetic. The node test runner executes files in
// parallel, and an earlier full-sweep version of this file was CPU-heavy enough
// to tip a timing-sensitive timeline test into failing roughly half the time.
// A CI smoke that destabilises the rest of the suite is worse than no smoke.
const FULL_SWEEP_PATTERN = '27_swipe';
const NARROW = {
  '01_cylon_sweep': ['sliderLocalSpeed', 'sliderLevel'],
  '13_sparkle': ['sliderAmberGlint', 'sliderDensity'],
};
const SUBSET = [FULL_SWEEP_PATTERN, ...Object.keys(NARROW)];

// test_bench is the fixture-rich bench model — smaller and faster than
// titanic, and it carries the sectionId/fixtureType variety the emitter code
// paths are gated on, so the smoke exercises those branches.
const MODEL = 'test_bench';

test('pattern discovery reads the tree, not a hardcoded list', () => {
  const ids = discoverPatterns(PATTERNS_DIR);
  assert.ok(ids.length >= 100,
    `only ${ids.length} patterns discovered — discovery is not walking the tree`);
  // Subdirectories must be included: patterns are being reorganised into
  // themed folders, and a sweep that only sees the top level would silently
  // stop covering everything that moved.
  assert.ok(ids.some(id => id.includes('/')),
    'no subdirectory patterns discovered — the walk is not recursing');
  for (const id of SUBSET) {
    assert.ok(ids.includes(id), `smoke subset pattern '${id}' not discovered`);
  }
  // Ids are extension-free relative paths, which is the results-file key.
  assert.ok(ids.every(id => !id.endsWith('.js')), 'ids must not carry the .js extension');
});

test('name → claim mapping covers the families the sweep depends on', () => {
  assert.deepEqual(tokenise('sliderWhiteKick'), ['white', 'kick']);
  assert.deepEqual(tokenise('sliderUvGlint'), ['uv', 'glint']);

  assert.equal(claimOf('sliderLocalSpeed').family, FAMILY.SPEED);
  assert.equal(claimOf('sliderDirection').family, FAMILY.DIRECTION);
  assert.equal(claimOf('sliderLevel').family, FAMILY.BRIGHTNESS);
  assert.equal(claimOf('sliderBlackoutDepth').family, FAMILY.DARKNESS);
  assert.equal(claimOf('sliderRadius').family, FAMILY.SPATIAL);
  assert.equal(claimOf('sliderUvIntensity').family, FAMILY.UV);
  // Emitter claims outrank the generic amount claim: `whiteKick` promises
  // white, not merely "some amount of kick".
  assert.equal(claimOf('sliderWhiteKick').family, FAMILY.WHITE);
  // A name the table does not recognise is never guessed at.
  assert.equal(claimOf('sliderZorbleFactor').family, FAMILY.UNKNOWN_CLAIM);
});

test('monotonicity tolerates slack but rejects a real reversal', () => {
  assert.deepEqual(monotonicity([0, 1, 2, 3]), { monotonic: true, direction: 1 });
  assert.deepEqual(monotonicity([3, 2, 1, 0]), { monotonic: true, direction: -1 });
  assert.equal(monotonicity([0, 1, 0.2, 3]).monotonic, false);
  assert.equal(monotonicity([1, 1, 1]).direction, 0);
});

test('correlation returns 0 rather than a fabricated value on a flat series', () => {
  assert.equal(correlate([1, 1, 1, 1], [1, 2, 3, 4]), 0);
  assert.ok(correlate([1, 2, 3, 4], [4, 3, 2, 1]) < -0.99);
  assert.ok(correlate([1, 2, 3, 4], [1, 2, 3, 4]) > 0.99);
});

test('hue distance is circular', () => {
  assert.ok(Math.abs(hueDistance(0.02, 0.98) - 0.04) < 1e-9);
  assert.ok(Math.abs(hueDistance(0.0, 0.5) - 0.5) < 1e-9);
});

test('the harness sweeps a subset offline and classifies every declared slider',
  { timeout: 300000 }, async () => {
    const ctx = await createRenderContext(MODEL);
    const axisBins = buildAxisBins(ctx.coords);
    const results = [];
    try {
      for (const id of SUBSET) {
        const only = NARROW[id] ? new Set(NARROW[id]) : null;
        results.push(sweepPattern(ctx, axisBins, id, only));
      }
    } finally {
      ctx.close();
    }

    for (const res of results) {
      assert.equal(res.status, 'OK',
        `${res.pattern}: expected OK, got ${res.status} ${res.error || ''}`);
      assert.ok(res.sliderCount > 0, `${res.pattern}: no sliders discovered`);
      const expected = NARROW[res.pattern] ? NARROW[res.pattern].length : res.sliderCount;
      assert.equal(Object.keys(res.params).length, expected,
        `${res.pattern}: expected ${expected} verdicts, got `
        + `${Object.keys(res.params).length} — a requested slider produced none`);

      // Renders must be reproducible — the noise floor the classifier
      // subtracts is measured from two identical-input renders, so a
      // nondeterministic VM would silently corrupt every verdict.
      assert.equal(res.baseline.deterministic, true,
        `${res.pattern}: two identical-input renders differed — verdicts are `
        + 'not trustworthy while rendering is nondeterministic');

      for (const [name, row] of Object.entries(res.params)) {
        assert.ok(Object.values(VERDICT).includes(row.verdict),
          `${res.pattern}.${name}: unknown verdict ${row.verdict}`);
        assert.ok(Number.isFinite(row.effectScore),
          `${res.pattern}.${name}: effectScore is not a number`);
        assert.ok(typeof row.reason === 'string' && row.reason.length > 0,
          `${res.pattern}.${name}: every verdict must carry a reason`);
        assert.ok(['code_default', 'vm_slider_seed'].includes(row.defaultSource),
          `${res.pattern}.${name}: unrecognised defaultSource ${row.defaultSource}`);
      }
    }

    const doc = { patterns: results, model: MODEL };
    const counts = tally(doc);
    assert.equal(counts.patternsOk, SUBSET.length);
    assert.ok(counts.paramTotal >= 10,
      `only ${counts.paramTotal} params measured — the smoke is too thin to be useful`);
    // A sweep in which nothing at all verified would mean the measurement
    // layer is broken, not that every pattern is.
    assert.ok(counts.TRUE > 0, 'no parameter verified as TRUE — measurement layer is dead');

    // Known-dead fixture, checked inside the SAME render context rather than a
    // second one — spinning up another WASM host costs real memory, and this
    // file runs in parallel with the rest of the suite.
    //
    // 13_sparkle computes `a = glint * amberGlint * warm` and then overwrites it
    // with the `a = clamp01(w)` white/amber lane match, so sliderAmberGlint
    // cannot reach the output. This is a REAL pattern bug, reported to the
    // curator lineage; the assertion is here because byte-identical detection is
    // the harness's sharpest self-check and must not regress.
    //
    // If the curator fixes 13_sparkle this assertion is EXPECTED to fail —
    // retarget the fixture rather than loosening the check.
    const sparkle = results.find(r => r.pattern === '13_sparkle');
    const dead = sparkle.params.sliderAmberGlint;
    assert.ok(dead, '13_sparkle: sliderAmberGlint not found');
    assert.equal(dead.verdict, VERDICT.DEAD,
      `expected DEAD for a control whose write is overwritten, got ${dead.verdict} `
      + `(${dead.reason}) — if 13_sparkle was fixed, retarget this fixture`);
    assert.equal(dead.reason, 'byte_identical_across_full_range');
  });

test('the harness never touches the show ports', () => {
  // The sweep must be runnable while the operator's live stack is up. This is
  // a source-level guard: no module under tools/param_truth may import a
  // transport. It is cheap and it is the failure that would hurt most.
  const dir = path.join(__dirname, '../../tools/param_truth');
  const forbidden = /\bfrom\s+['"](ws|sacn|dgram|net|http|express|e131)['"]/;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal(forbidden.test(src), false,
      `${f} imports a network transport — the sweep must stay offline`);
  }
});
