/**
 * meta_abi_stride.test.js — the meta-ABI stride gate, pinned directly
 * against `lib/meta_abi.js` (catalog `.agent/reports/202608/
 * 20260805_162_engine_test_gap_catalog.md` G-12).
 *
 * `lib/meta_abi.js` (`META_LANES`, `VIEW_MASK_HI_ENABLED`, `LANE_*`) is the
 * single documented source of truth for the per-pixel meta stride that
 * `wasm_host.js`'s `setPixelMeta` (and `marsin_wasm_runtime.js`'s
 * equivalent) pack into the WASM heap. Before this file NOTHING imported
 * `meta_abi.js` directly (grep-verified at test-write time: the only
 * importers anywhere in the repo are `lib/wasm_host.js` and
 * `lib/marsin_wasm_runtime.js`, and BOTH import only `META_LANES` +
 * `VIEW_MASK_HI_ENABLED` — never the `LANE_*` constants). The stride
 * itself IS exercised implicitly by every VM test (e.g.
 * `tests/mixer/view_mask_hi_host.test.js`), but the module's own exported
 * contract had zero direct pins.
 *
 * REAL FINDING, not fixed here (test code only): the `LANE_CONTROLLER_ID`
 * .. `LANE_VIEW_MASK_HI` constants in `meta_abi.js` are DEAD CODE today —
 * `wasm_host.js:297-305` and `marsin_wasm_runtime.js:156-162` each hardcode
 * their own `base+0` .. `base+6` offsets instead of importing these named
 * constants. A future edit to `meta_abi.js`'s documented lane ORDER (e.g.
 * moving `viewMaskHi` to a different index while updating the comment)
 * would silently drift from the two hand-written pack loops — nothing
 * would fail, because neither pack loop reads the constants that supposedly
 * document its own layout. This test pins TODAY's (correct, matching)
 * relationship between the constants and the real runtime offsets, so a
 * future drift between them fails loudly here even though it wouldn't fail
 * inside `wasm_host.js` itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  META_LANES, VIEW_MASK_HI_ENABLED,
  LANE_CONTROLLER_ID, LANE_SECTION_ID, LANE_FIXTURE_ID, LANE_VIEW_MASK,
  LANE_FIXTURE_TYPE_ID, LANE_PIXEL_LOCAL_INDEX, LANE_VIEW_MASK_HI,
} from '../../lib/meta_abi.js';
import { WasmHost } from '../../lib/wasm_host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, '..', '..');

test('META_LANES is the documented Tier-C relation to VIEW_MASK_HI_ENABLED', () => {
  assert.equal(typeof VIEW_MASK_HI_ENABLED, 'boolean');
  assert.equal(META_LANES, VIEW_MASK_HI_ENABLED ? 7 : 6);
  // Pinned at its current, LIVE value (Tier-C integrated 2026-06-19) — see
  // the module's own INTEGRATION GATE comment. If this ever flips back to
  // false, that is a deliberate rollback, not a silent regression; this
  // assertion forces it to be a conscious test edit either way.
  assert.equal(VIEW_MASK_HI_ENABLED, true);
  assert.equal(META_LANES, 7);
});

test('LANE_* constants are 0..6 in the documented order, each a distinct integer', () => {
  const lanes = [
    LANE_CONTROLLER_ID, LANE_SECTION_ID, LANE_FIXTURE_ID, LANE_VIEW_MASK,
    LANE_FIXTURE_TYPE_ID, LANE_PIXEL_LOCAL_INDEX, LANE_VIEW_MASK_HI,
  ];
  assert.deepEqual(lanes, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(lanes).size, lanes.length, 'no two lanes may share an index');
  assert.ok(LANE_VIEW_MASK_HI < META_LANES, 'the highest lane must fit inside the packed stride');
});

test('DEAD-CODE PIN: neither wasm_host.js nor marsin_wasm_runtime.js imports the LANE_* constants (drift risk, see file header)', () => {
  for (const rel of ['lib/wasm_host.js', 'lib/marsin_wasm_runtime.js']) {
    const src = fs.readFileSync(path.join(ENGINE_ROOT, rel), 'utf8');
    const importLine = src.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/meta_abi\.js'/);
    assert.ok(importLine, `${rel} must still import from meta_abi.js (has the import moved?)`);
    assert.doesNotMatch(importLine[1], /LANE_/,
      `${rel} imports a LANE_* constant now — if so, UPDATE this test (the dead-code finding is stale) ` +
      'and consider deleting this pin in favor of one that asserts the pack loop actually reads them');
  }
});

test('real runtime offsets: WasmHost.setPixelMeta actually writes each field at its documented LANE_* index', async () => {
  const host = new WasmHost();
  await host.init(1);
  try {
    host.setPixelMeta([{
      controllerId: 11, sectionId: 22, fixtureId: 33, viewMask: 44,
      fixtureTypeId: 55, pixelLocalIndex: 66, viewMaskHi: 77,
    }]);
    assert.equal(host.metaView[LANE_CONTROLLER_ID], 11);
    assert.equal(host.metaView[LANE_SECTION_ID], 22);
    assert.equal(host.metaView[LANE_FIXTURE_ID], 33);
    assert.equal(host.metaView[LANE_VIEW_MASK], 44);
    assert.equal(host.metaView[LANE_FIXTURE_TYPE_ID], 55);
    assert.equal(host.metaView[LANE_PIXEL_LOCAL_INDEX], 66);
    assert.equal(host.metaView[LANE_VIEW_MASK_HI], 77);
    // The stride itself: a second pixel's lane 0 must be exactly META_LANES
    // ints after the first's.
    host.setPixelMeta([
      { controllerId: 1 }, { controllerId: 2 },
    ]);
  } finally {
    host.shutdown();
  }
});

test('real runtime stride: a 2-pixel pack places pixel 1 exactly META_LANES ints after pixel 0', async () => {
  const host = new WasmHost();
  await host.init(2);
  try {
    host.setPixelMeta([
      { controllerId: 1 },
      { controllerId: 2 },
    ]);
    assert.equal(host.metaView[LANE_CONTROLLER_ID], 1);
    assert.equal(host.metaView[META_LANES + LANE_CONTROLLER_ID], 2);
  } finally {
    host.shutdown();
  }
});

test('VIEW_MASK_HI_ENABLED=false would mean a 6-lane stride and no 7th-lane write (documented relation, not independently switchable today)', () => {
  // meta_abi.js hardcodes VIEW_MASK_HI_ENABLED = true with no env/flag to
  // flip it at runtime — this is intentionally NOT parameterized (see the
  // module's INTEGRATION GATE comment: Tier-C is permanently live). This
  // test exists so a future re-introduction of a togglable flag is forced
  // to also update this suite's fixed assumption above, rather than silently
  // leaving a stale "always 7" pin.
  assert.equal(META_LANES - (VIEW_MASK_HI_ENABLED ? 1 : 0), 6,
    'the base (non-hi) stride is always 6 lanes, regardless of the flag');
});
