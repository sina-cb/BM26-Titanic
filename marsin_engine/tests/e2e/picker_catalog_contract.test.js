/**
 * picker_catalog_contract.test.js — the picker-catalog HTTP contract CaptainPad
 * renders from (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-10). Consumer file: `CaptainPad/components/view_selection_picker_logic.ts`
 * (`NamedView` at :25, `ViewSelectionValue` at :34, `ViewPickerSection` at
 * :161, `ViewPickerModel` at :167) — the next CaptainPad change to that file
 * should re-check this test.
 *
 * `GET /patterns`, `/pattern-dirs`, `/playlists` (partially, playlist_api),
 * `/model/view-selection-options` are the catalogs CaptainPad's pickers
 * render; nothing pinned `/model/view-selection-options`'s shape before this
 * file, and CaptainPad's own vitest suite
 * (`view_selection_picker_logic.test.ts`) tests its logic against FIXTURES,
 * never against the live engine.
 *
 * CORRECTION vs the catalog's spec text: it asked to "assert at least one
 * word-1 view is present and carries whatever word/bit discriminator the
 * interface reads." There IS no word/bit discriminator, by design: Tier-A
 * named-view selection (`viewSelection: {type:'viewMask', target:'<name>'}`)
 * resolves entirely BY NAME on the engine side (`lib/pattern_mixer.js`
 * `compileViewSelectionMask`) — the client never needs to know which
 * internal word (viewMask vs viewMaskHi) or bit backs a name. Confirmed by
 * reading `lib/mask_registry.js`'s `MaskEntry` typedef (`id`, `name`, `kind`,
 * `members`, `bit` — no `word`) and the API handler
 * (`api_server.js:6514-6523`, `{name, kind, bit, memberCount}`) — neither
 * carries a word. `NamedView` in `view_selection_picker_logic.ts` mirrors
 * this exactly (no word field). This test instead confirms the closest real
 * claim: a titanic preset KNOWN to be word-1 internally
 * (`models/titanic.viewmasks.js:37`, `'Hull Canvas'`, `word: 1`) still
 * surfaces under `namedViews` by name, proving the two-word system's public
 * contract is genuinely word-transparent, not merely untested.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const harness = createEngineHarness({
  scene: 'test_bench',
  prefix: 'pickercatalog',
  extraArgs: ['--dest', '127.0.0.9'],
});

before(async () => {
  harness.spawnEngine();
  await harness.waitForReady();
});

after(async () => {
  await harness.teardown();
});

test('GET /patterns: non-empty array of slug strings, includes 13_sparkle', async () => {
  const { status, data } = await harness.api('GET', '/patterns');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  assert.ok(data.length > 0);
  for (const name of data) assert.match(name, /^[A-Za-z0-9_/-]+$/);
  assert.ok(data.includes('13_sparkle'));
});

test('GET /pattern-dirs: array starting with "default"', async () => {
  const { status, data } = await harness.api('GET', '/pattern-dirs');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data));
  assert.equal(data[0], 'default');
});

test('GET /model/view-selection-options: field presence + JS type for every field NamedView dereferences', async () => {
  const { status, data } = await harness.api('GET', '/model/view-selection-options');
  assert.equal(status, 200);

  // Top-level shape (api_server.js:6524-6540).
  assert.ok(Array.isArray(data.groups));
  assert.ok(Array.isArray(data.sections));
  assert.ok(Array.isArray(data.fixtures));
  assert.equal(typeof data.viewMaskUnion, 'number');
  assert.ok(Array.isArray(data.viewMasks));
  assert.ok(Array.isArray(data.namedViews));
  assert.equal(typeof data.groupBits, 'object');
  assert.equal(typeof data.maskConstants, 'object');
  assert.equal(typeof data.pixelCount, 'number');
  assert.ok(data.namedViews.length > 0, 'test_bench must declare at least one named view');

  // NamedView interface (view_selection_picker_logic.ts:25-30): every field
  // `isValidNamedView` (:100-110) and the classifier (:117-126) dereference.
  for (const v of data.namedViews) {
    assert.equal(typeof v.name, 'string', `namedViews entry missing string .name: ${JSON.stringify(v)}`);
    assert.ok(v.name.length > 0);
    assert.equal(typeof v.kind, 'string', `namedViews entry missing string .kind: ${JSON.stringify(v)}`);
    assert.ok(['group', 'composite', 'pixelSet'].includes(v.kind),
      `unexpected kind '${v.kind}' — view_selection_picker_logic.ts classifyNamedView only checks .kind === 'group'|'composite'`);
    assert.ok(Number.isFinite(v.bit), `namedViews entry .bit must be finite: ${JSON.stringify(v)}`);
    assert.ok(Number.isFinite(v.memberCount), `namedViews entry .memberCount must be finite: ${JSON.stringify(v)}`);
  }

  // viewMasks (back-compat bit-backed subset) — the fields
  // api_server.js:6500-6504 always emits.
  for (const vm of data.viewMasks) {
    assert.equal(typeof vm.name, 'string');
    assert.ok(Number.isInteger(vm.bit));
    assert.equal(typeof vm.inUse, 'boolean');
  }
});

test('titanic: at least one word-1 view ("Hull Canvas") surfaces under namedViews by name (word-transparent contract)', async () => {
  const titanicHarness = createEngineHarness({
    scene: 'titanic',
    prefix: 'pickercatalogtitanic',
    extraArgs: ['--dest', '127.0.0.9'],
  });
  titanicHarness.spawnEngine();
  try {
    await titanicHarness.waitForReady(45000); // titanic is a much larger model — generous timeout
    const { status, data } = await titanicHarness.api('GET', '/model/view-selection-options');
    assert.equal(status, 200);
    const names = data.namedViews.map((v) => v.name);
    assert.ok(names.includes('Hull Canvas'),
      `expected the word-1 preset 'Hull Canvas' (models/titanic.viewmasks.js:37) in namedViews, got [${names.slice(0, 20).join(', ')}, ...]`);
    // No word field anywhere on the entry — the whole point of the
    // name-based resolution path (see file header correction).
    const hullCanvas = data.namedViews.find((v) => v.name === 'Hull Canvas');
    assert.equal('word' in hullCanvas, false);
  } finally {
    await titanicHarness.teardown();
  }
});
