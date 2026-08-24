/**
 * all_models_load_lint.test.js — every model loads and its patch table is
 * sane (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-3, rank 4).
 *
 * Before this file, only `titanic` had model-load coverage
 * (`model_loader_word_aware.test.js`, `titanic_view_catalog.test.js`) — NOT
 * `test_bench`, the model every smoke/HIL run boots against, nor the other 7.
 * A bad edit to any non-titanic model (bit collision, patch off the end of a
 * universe, missing channels map) used to surface only at engine boot on the
 * bench. This suite loads every model through `lib/model_loader.js`'s
 * `loadModelForGauge` — the same group/preset bit-assignment logic
 * `engine.js`'s own (non-exported) `loadModel` runs, reused here specifically
 * so it is testable outside the full engine boot (see that file's header) —
 * and lints every patch.
 *
 * `dev_test_bench` used to be a named broken characterization because its
 * zero-pixel model carried stale group-bit sidecar entries. The sidecar is
 * now repaired, so it participates in the same load and patch-table lint as
 * every other model; keeping a special expected-failure would hide a repair.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { isLedEntry } from '../../../simulation/src/dmx/led_wire.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '..', '..', 'models');

function listModelNames() {
  return fs.readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.effects.js') && !f.endsWith('.viewmasks.js') && !f.endsWith('.original'))
    .map((f) => f.replace(/\.js$/, ''))
    .sort();
}

async function loadSpecialEffects(modelName) {
  const p = path.join(MODELS_DIR, `${modelName}.effects.js`);
  if (!fs.existsSync(p)) return [];
  const mod = await import(`file://${p}`);
  return mod.specialEffects || [];
}

// Mirrors engine.js's registerUniverse loop (:1368-1388): pixels first, then
// special-effect fixtures — effect-only universes (foggers/hazers with no
// patched pixel) must still be forced into the boot-time universe set.
function collectExpectedUniverses(pixels, specialEffects) {
  const ids = [];
  const seen = new Set();
  const register = (patch) => {
    if (patch && patch.universe && !seen.has(patch.universe)) {
      seen.add(patch.universe);
      ids.push(patch.universe);
    }
  };
  for (const px of pixels) if (px && px.patch) register(px.patch);
  for (const fx of specialEffects) if (fx && fx.patch) register(fx.patch);
  return ids;
}

test('every model file under models/ is discovered (sanity on the enumeration filter)', () => {
  const names = listModelNames();
  assert.ok(names.includes('titanic'));
  assert.ok(names.includes('test_bench'));
  assert.equal(names.includes('summer_camp_dome.js.original' .replace(/\.js$/, '')), false);
  // 9 active model source files at catalog time (G-3's own count).
  assert.equal(names.length, 10, `expected 10 model files, got ${names.length}: ${names.join(', ')}`);
});

// ── dev_test_bench repair pin ────────────────────────────────────────────

test('dev_test_bench: repaired sidecar loads the zero-pixel development model', async () => {
  const model = await loadModelForGauge('dev_test_bench');
  assert.equal(model.pixelCount, 0);
  assert.deepEqual(model.pixels, []);
});

// ── Every model: loads + patch-table lint ─────────────────────────────────

const LINTED_MODELS = listModelNames();

// Overlap counts snapshotted at survey time (2026-08-05): zero collisions in
// every model today. Overlaps are operator-legal (ruling 2026-07-31) but must
// be REPORTED — a nonzero count here is not necessarily a bug, but it is a
// CHANGE that deserves a look, so this pin makes a new one impossible to miss.
const EXPECTED_OVERLAP_COUNTS = {
  dev_test_bench: 0,
  led202: 0,
  studio: 0,
  studio_top_loft: 0,
  studiodj: 0,
  summer_camp_dome: 0,
  summer_camp_logsville: 0,
  test_bench: 0,
  titanic: 0,
  titanic_interior: 0,
};

// Mirrors sacn_mapper.js's numeric-`channels` polyfill (:284-299) closely
// enough to resolve which absolute channels a non-LED entry claims — used
// only for the overlap-detection lint below, not for byte values (that's
// G-2's job, tests/io/sacn_mapper_pack.test.js).
function resolveChannels(px) {
  let ch = px.channels;
  if (typeof ch !== 'number') return ch;
  const isPar = px.type === 'par' || px.fixtureType === 'UkingPar' || px.fixtureType === 'VintageLed';
  const fp = px.patch && px.patch.footprint;
  if (isPar && fp >= 10) return { r: 3, g: 4, b: 5, w: 6, a: 7, u: 8 };
  if (fp === 6) return { r: 1, g: 2, b: 3, w: 4, a: 5, u: 6 };
  const out = { r: 1, g: 2, b: 3 };
  if (typeof px.channels === 'number' && px.channels >= 4) out.w = 4;
  return out;
}

for (const modelName of LINTED_MODELS) {
  test(`${modelName}: loads through loadModelForGauge without throwing`, async () => {
    const model = await loadModelForGauge(modelName);
    assert.ok(model, `loadModelForGauge('${modelName}') must return a model`);
    assert.equal(model.pixelCount, model.pixels.length,
      `${modelName}: pixelCount must match pixels.length`);
  });

  test(`${modelName}: every patched pixel's (universe, addr[, footprint]) is in range`, async () => {
    const model = await loadModelForGauge(modelName);
    const bad = [];
    for (const px of model.pixels) {
      if (!px || !px.patch) continue;
      const p = px.patch;
      if (!Number.isInteger(p.universe) || p.universe < 1 || p.universe > 63999) {
        bad.push(`pixel ${px.i} (${px.name || '?'}): universe ${p.universe} out of range`);
      }
      if (!Number.isInteger(p.addr) || p.addr < 1 || p.addr > 512) {
        bad.push(`pixel ${px.i} (${px.name || '?'}): addr ${p.addr} out of range`);
      }
      // LED strands legitimately wrap universes (computeLedProjection lays
      // them out as sequential per-pixel patches) — exempt exactly the
      // entries isLedEntry() matches, mirroring led_dmx_parity's rule.
      if (p.footprint !== undefined && !isLedEntry(px)) {
        if (p.addr + p.footprint - 1 > 512) {
          bad.push(`pixel ${px.i} (${px.name || '?'}): addr ${p.addr} + footprint ${p.footprint} - 1 exceeds 512`);
        }
      }
    }
    assert.deepEqual(bad, [], `${modelName} has out-of-range patches:\n${bad.join('\n')}`);
  });

  test(`${modelName}: boot-time universeIds match the pixel+specialEffects union`, async () => {
    const model = await loadModelForGauge(modelName);
    const specialEffects = await loadSpecialEffects(modelName);
    const expected = collectExpectedUniverses(model.pixels, specialEffects);
    // Recompute independently (Set-based, order-agnostic) to confirm the
    // ordered collector above and a plain union agree.
    const asSet = new Set(expected);
    const bruteForce = new Set();
    for (const px of model.pixels) if (px && px.patch && px.patch.universe) bruteForce.add(px.patch.universe);
    for (const fx of specialEffects) if (fx && fx.patch && fx.patch.universe) bruteForce.add(fx.patch.universe);
    assert.deepEqual(asSet, bruteForce,
      `${modelName}: ordered union and brute-force union must agree`);
  });

  test(`${modelName}: cross-fixture (universe,channel) overlap count is pinned`, async () => {
    const model = await loadModelForGauge(modelName);
    const map = new Map(); // 'universe:channel' -> Set(addr)
    for (const px of model.pixels) {
      if (!px || !px.patch || !px.channels) continue;
      if (isLedEntry(px)) continue; // strand composite bytes aren't per-addr "claims" the same way
      const ch = resolveChannels(px);
      if (!ch) continue;
      for (const letter of ['r', 'g', 'b', 'w', 'a', 'u']) {
        if (ch[letter] === undefined) continue;
        const absCh = px.patch.addr + ch[letter] - 1;
        const key = `${px.patch.universe}:${absCh}`;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(px.patch.addr);
      }
    }
    let overlaps = 0;
    const pairs = [];
    for (const [key, addrs] of map) {
      if (addrs.size > 1) { overlaps++; pairs.push(`${key} <- addrs [${[...addrs].join(',')}]`); }
    }
    const expected = EXPECTED_OVERLAP_COUNTS[modelName];
    assert.equal(typeof expected, 'number', `${modelName}: no pinned overlap expectation — add one`);
    assert.equal(overlaps, expected,
      `${modelName}: overlap count changed from the pinned ${expected} to ${overlaps} ` +
      `(legal per operator ruling 2026-07-31, but new — pairs:\n${pairs.join('\n')})`);
  });
}

// Fold-in: the word-aware group/preset bit-space checks
// (model_loader_word_aware.test.js) already run titanic; this suite's
// `loadModelForGauge` call for every OTHER model above exercises the exact
// same reserveExplicitBits/assignGroupBits path for any model that declares
// presets/groups, so a word-0/word-1 collision on ANY model — not just
// titanic — throws during the "loads without throwing" test above.
