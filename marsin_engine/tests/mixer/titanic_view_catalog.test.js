// titanic_view_catalog.test.js — the operator's mixer view catalog, pinned.
//
// Report 20260804_145 fixed the titanic catalog by operator ruling. The
// numbers below are the CONTRACT the operator selects against on the iPad
// and pattern authors compile against; a silent drift in either the model
// or the derivation would change what a channel lights on playa. So they
// are asserted here against the REAL titanic model + the REAL sidecar,
// through the same modules the engine uses at load (no engine process, no
// port, no socket).
//
//   LEFT / RIGHT   482 + 482 = 964, disjoint, EXHAUSTIVE — whole-ship
//                  halves from world X, not strand type.
//   Strands 320 / TE Signs 148 — the fixture-type views, disjoint.
//   Seven semantic composites: Hull Canvas 360 · Silhouette 320 ·
//   Jewelry 96 · Organs 40 · Identity 148 · Stacks 24 · Auditoriums 16.
//   The retired names (PORT/STARBOARD, FORE/AFT, BAND_*, `<base>_BOTH`,
//   @RAW, every Left */Right * composite) resolve to NOTHING.
//
// Report 20260804_148 retired two more by operator ruling: the derived
// structural views WALLS and AUDITORIUM were byte-identical to the authored
// composites Hull Canvas and Auditoriums, so the authored names are canonical
// and the derived duplicates are gone. The catalog is 58 names. The
// dedup lives in lib/view_catalog.js `appendAutoViews`, which is why this file
// assembles the catalog through the SHARED path — the one the engine and the
// three offline tools both use — rather than calling deriveAutoViews raw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadModelForGauge } from '../../lib/model_loader.js';
import { appendAutoViews } from '../../lib/view_catalog.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';
import { injectInViewIntrinsic, createBitFreeViewPromoter } from '../../lib/in_view_intrinsic.js';

const PIXELS = 964;
const HALF = 482;
// 24 base groups + 7 authored composites + 27 derived auto-views.
const CATALOG_NAMES = 58;

async function titanicCatalog() {
  const model = await loadModelForGauge('titanic');
  // The authored presets, captured BEFORE the append mutates model.viewMasks.
  const presets = model.viewMasks.map((v) => ({ ...v }));
  const auto = appendAutoViews(model.pixels, model.viewMasks, model.groupBits);
  const registry = buildMaskRegistry({
    pixels: model.pixels,
    pixelCount: model.pixelCount,
    groupBits: model.groupBits,
    viewMasks: model.viewMasks,
  });
  const count = (name) => {
    const entry = registry.get(name);
    if (!entry) return null;
    let n = 0;
    for (const v of entry.members) n += v;
    return n;
  };
  return { model, presets, auto, registry, count };
}

test('titanic: LEFT/RIGHT are exhaustive, disjoint 482/482 whole-ship halves', async () => {
  const { model, registry, count } = await titanicCatalog();
  assert.equal(model.pixelCount, PIXELS);
  assert.equal(count('LEFT'), HALF);
  assert.equal(count('RIGHT'), HALF);
  const left = registry.get('LEFT').members;
  const right = registry.get('RIGHT').members;
  for (let i = 0; i < PIXELS; i++) {
    assert.equal(left[i] + right[i], 1, `pixel ${i} must be in exactly one half`);
    // The half is the pixel's world-x sign — physical truth, cross-checked
    // below against the group name.
    assert.equal(model.pixels[i].x < 0 ? left[i] : right[i], 1,
      `pixel ${i} half disagrees with world x=${model.pixels[i].x}`);
  }
});

test('titanic: no base group and no controller straddles the centreline', async () => {
  const { model, registry } = await titanicCatalog();
  const left = registry.get('LEFT').members;
  const groupSides = new Map();
  const ctrlSides = new Map();
  for (let i = 0; i < PIXELS; i++) {
    const side = left[i] ? 'L' : 'R';
    for (const [map, key] of [[groupSides, model.pixels[i].group], [ctrlSides, model.pixels[i].cId]]) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(side);
    }
  }
  for (const [g, s] of groupSides) assert.equal(s.size, 1, `group '${g}' straddles the centreline`);
  for (const [c, s] of ctrlSides) assert.equal(s.size, 1, `controller ${c} straddles the centreline`);
});

test('titanic: each half carries walls, ropes, rails, stacks, auditorium pars and ONE sign', async () => {
  const { model, registry } = await titanicCatalog();
  for (const half of ['LEFT', 'RIGHT']) {
    const m = registry.get(half).members;
    const byGroup = new Map();
    for (let i = 0; i < PIXELS; i++) {
      if (!m[i]) continue;
      const g = model.pixels[i].group;
      byGroup.set(g, (byGroup.get(g) || 0) + 1);
    }
    const sum = (re) => [...byGroup].filter(([g]) => re.test(g)).reduce((a, [, n]) => a + n, 0);
    assert.equal(sum(/Wall$/), 180, `${half} wall bars`);
    assert.equal(sum(/_(Left|Right)$/), 160, `${half} rope strands`);
    assert.equal(sum(/Rails$/), 48, `${half} Vintage rails`);
    assert.equal(sum(/SmokeStacks?$/), 12, `${half} stacks`);
    assert.equal(sum(/Auditorium$/), 8, `${half} auditorium pars`);
    assert.equal(sum(/^TE Sign/), 74, `${half} TE sign`);
    assert.equal(180 + 160 + 48 + 12 + 8 + 74, HALF);
  }
});

test('titanic: FRONT/BACK resolve; the retired spatial names do not', async () => {
  const { registry, count } = await titanicCatalog();
  assert.equal(count('FRONT'), 388);
  assert.equal(count('BACK'), 388);
  for (const gone of ['FORE', 'AFT', 'PORT', 'STARBOARD', 'BAND_LOW', 'BAND_MID', 'BAND_HIGH', '@RAW']) {
    assert.equal(registry.get(gone), null, `'${gone}' must be gone from the catalog`);
  }
  assert.deepEqual(registry.names().filter((n) => /_BOTH$/.test(n)), []);
});

test('titanic: Strands = 320 and TE Signs = 148, disjoint', async () => {
  const { registry, count } = await titanicCatalog();
  assert.equal(count('Strands'), 320);
  assert.equal(count('TE Signs'), 148);
  const s = registry.get('Strands').members;
  const t = registry.get('TE Signs').members;
  for (let i = 0; i < PIXELS; i++) assert.equal(s[i] && t[i], 0, `pixel ${i} in both type views`);
  assert.equal(count('@BAR'), 360);
  assert.equal(count('@PAR'), 40);
  assert.equal(count('@VINTAGE'), 96);
});

test('titanic: exactly seven semantic composites, at their exact counts', async () => {
  const { presets, count } = await titanicCatalog();
  assert.deepEqual(presets.map((v) => v.name),
    ['Hull Canvas', 'Silhouette', 'Jewelry', 'Organs', 'Identity', 'Stacks', 'Auditoriums']);
  for (const [name, want] of [['Hull Canvas', 360], ['Silhouette', 320], ['Jewelry', 96],
    ['Organs', 40], ['Identity', 148], ['Stacks', 24], ['Auditoriums', 16]]) {
    assert.equal(count(name), want, name);
  }
  // The five instruments still partition the ship exactly.
  assert.equal(360 + 320 + 96 + 40 + 148, PIXELS);
  // Every composite lives in the high word, leaving word 0 to base groups.
  assert.ok(presets.every((v) => v.word === 1));
});

test('titanic: every removed composite resolves to NOTHING', async () => {
  const { registry } = await titanicCatalog();
  for (const gone of ['Left Hull', 'Right Hull', 'Left Silhouette', 'Right Silhouette',
    'Left Jewelry', 'Right Jewelry', 'Left Organs', 'Right Organs', 'Left Stacks',
    'Right Stacks', 'Left Identity', 'Right Identity']) {
    assert.equal(registry.get(gone), null, `'${gone}' must be gone`);
  }
});

test('titanic: inView() folds every catalog name and fails loudly on a removed one', async () => {
  const { model } = await titanicCatalog();
  const all = model.viewMasks; // authored presets + the appended auto-views
  const table = {};
  for (const [g, bit] of Object.entries(model.groupBits)) table[g] = { bit, word: 0 };
  for (const v of all) table[v.name] = { bit: v.bit, word: v.word === 1 ? 1 : 0 };
  assert.equal(Object.keys(table).length, CATALOG_NAMES);
  const promote = createBitFreeViewPromoter(
    { pixels: model.pixels, viewMasks: all, groupBits: model.groupBits }, { metaDirty: false });

  for (const name of ['LEFT', 'RIGHT', 'FRONT', 'BACK', 'Strands', 'TE Signs',
    'Hull Canvas', 'Silhouette', 'Jewelry', 'Organs', 'Identity', 'Stacks', 'Auditoriums']) {
    const out = injectInViewIntrinsic(`if (inView("${name}")) rgb(1,1,1);`, table, promote);
    assert.match(out, /\(\(viewMask(Hi)? & \d+\) != 0\)/, `inView("${name}") must fold to a bit test`);
  }
  for (const gone of ['PORT', 'STARBOARD', 'FORE', 'AFT', 'BAND_LOW', '@RAW',
    'Left Hull', 'Right Stacks', 'Front Wall_BOTH', 'WALLS', 'AUDITORIUM']) {
    assert.throws(() => injectInViewIntrinsic(`if (inView("${gone}")) rgb(1,1,1);`, table, promote),
      new RegExp(`unknown view\\(s\\) via inView\\(\\): ${gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `inView("${gone}") must be a loud compile error naming the view`);
  }
});

test('titanic: WALLS and AUDITORIUM are retired duplicates, not selectable views', async () => {
  const { auto, registry, count } = await titanicCatalog();
  // Gone from the mixer/CaptainPad picker (the MaskRegistry is what
  // /model/view-selection-options enumerates) …
  for (const gone of ['WALLS', 'AUDITORIUM']) {
    assert.equal(registry.get(gone), null, `'${gone}' must not be selectable`);
  }
  // … and the authored names that replace them still resolve, unchanged.
  assert.equal(count('Hull Canvas'), 360);
  assert.equal(count('Auditoriums'), 16);
  // The drop is reported with its twin, never silent (codex P0).
  assert.deepEqual(auto.deduped.map((d) => [d.name, d.twin, d.pixels]),
    [['WALLS', 'Hull Canvas', 360], ['AUDITORIUM', 'Auditoriums', 16]]);
  assert.equal(auto.families.structural.length, 0, 'both structural bands were duplicates');
  // The whole catalog is 58 names.
  assert.equal(registry.names().length, CATALOG_NAMES);
  // Fixture-capability targeting is untouched: @BAR covers the same 360 px as
  // Hull Canvas and STAYS (operator ruling, report _148).
  assert.equal(count('@BAR'), 360);
});

test('titanic: no group/view bit collision in either word, sidecar in sync with the model', async () => {
  const { model, presets, auto } = await titanicCatalog();
  const perWord = [new Map(), new Map()];
  for (const [g, bit] of Object.entries(model.groupBits)) {
    assert.ok(!perWord[0].has(bit), `word-0 bit 0x${bit.toString(16)} reused by '${g}'`);
    perWord[0].set(bit, g);
  }
  for (const v of presets) {
    const w = v.word === 1 ? 1 : 0;
    assert.ok(!perWord[w].has(v.bit), `word-${w} bit 0x${v.bit.toString(16)} reused by '${v.name}'`);
    perWord[w].set(v.bit, v.name);
  }
  const modelGroups = new Set(model.pixels.map((p) => p.group));
  assert.deepEqual(Object.keys(model.groupBits).filter((g) => !modelGroups.has(g)), [],
    'no stale groupBits key');
  assert.deepEqual([...modelGroups].filter((g) => model.groupBits[g] === undefined), [],
    'no model group missing from groupBits');
  assert.ok(auto.entries.every((e) => e.bit === 0), 'auto-views cost no in-VM bit');
});
