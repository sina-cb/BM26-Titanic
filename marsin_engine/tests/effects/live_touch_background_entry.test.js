/**
 * docs/70 W2 — PUT /layers/live_touch/pattern grows an optional
 * {pattern, playlist, entryId} form. When the entry is named, the engine
 * must resolve it and apply the entry's `defaults` during staging, at the
 * SAME precedence as a deck stage (code defaults -> entry defaults -> CPC).
 * A raw {pattern} stage must keep behaving exactly as before (pattern code
 * defaults + CPC only).
 *
 * playlist/entryId are all-or-nothing: one without the other, an unknown
 * playlist, an unknown entryId, or an entry marked `_missing` must 400 and
 * MUST NOT leave the channel staged at code defaults (codex P0: no fallback
 * behaviours).
 *
 * GET /layers/live_touch/exports deliberately reports no values (the WASM
 * VM's getExports() only ever returns {id, kind, name} — no get_var cwrap),
 * so both the success and error branches of this route were extended to
 * echo the channel's current `localControls` (via the existing
 * playlistManager.captureDefaults helper) precisely so this proof is
 * possible over HTTP without inventing a second read surface.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'test_bench';
const PATTERN = '00_golden_hour_wash';
const PLAYLIST_NAME = 'ambient';
// Mirrors simulation/scenes/*/playlists/ambient.yaml's blessed entry
// e_ambient_0_00_golden_hour_wash verbatim (id, pattern, defaults) — the
// canonical operator-blessed pilot playlist. Recreated here (rather than
// read off disk) so the test spawns its engine with playlists redirected
// into a throwaway temp dir (MARSIN_PLAYLISTS_DIR) and never touches the
// tracked scene tree.
const ENTRY_ID = 'e_ambient_0_00_golden_hour_wash';
const ENTRY_DEFAULTS = {
  sliderLocalSpeed: 0.38,
  sliderLevel: 0.2,
  sliderGrain: 0.67,
  sliderEmberSwell: 0.95,
  sliderJewelryWhite: 0.64,
  sliderJewelrySpeed: 0.72,
  sliderJewelryFlash: 0.24,
};
// 00_golden_hour_wash.js's own `export var` code defaults — must differ
// from ENTRY_DEFAULTS above for the core proof (test 1) to mean anything.
const CODE_DEFAULTS = {
  sliderLocalSpeed: 0.42,
  sliderLevel: 0.62,
  sliderGrain: 0.36,
};

const h = createEngineHarness({
  scene: SCENE,
  pattern: '13_sparkle',
  prefix: 'live-touch-background-entry',
  portBase: 17530,
  portSpan: 50,
});

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
  const created = await h.api('POST', '/playlists', {
    name: PLAYLIST_NAME,
    entries: [
      { id: ENTRY_ID, pattern: PATTERN, label: 'Golden Hour Wash', defaults: ENTRY_DEFAULTS },
    ],
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
});

after(async () => {
  await h.teardown();
});

test('staging a background entry applies the blessed playlist defaults, not code defaults', async () => {
  const response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    playlist: PLAYLIST_NAME,
    entryId: ENTRY_ID,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.pattern, PATTERN);

  const staged = response.data.localControls;
  for (const [name, value] of Object.entries(ENTRY_DEFAULTS)) {
    assert.equal(staged[name], value, `${name} must be at its blessed entry default`);
  }
  // The core proof: the entry's tuning must have WON over the pattern's own
  // `export var` code defaults for every overlapping slider.
  for (const [name, codeValue] of Object.entries(CODE_DEFAULTS)) {
    assert.notEqual(staged[name], codeValue, `${name} must not have been left at its code default`);
  }
});

test('an unknown playlist 400s and does not leave the channel staged at code defaults', async () => {
  const response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    playlist: 'no_such_playlist_xyz',
    entryId: ENTRY_ID,
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.equal(response.data.code, 'LIVE_TOUCH_PATTERN_INVALID');
  assert.match(response.data.error, /no_such_playlist_xyz/);

  // Rejected before ever touching mixer state: the channel (still holding
  // the previous test's staged pattern) must still show the PRIOR entry
  // defaults, not the pattern's code defaults and not a half-applied
  // anything.
  const staged = response.data.localControls;
  assert.ok(staged, 'a channel was already staged; localControls must be reported');
  assert.equal(staged.sliderLocalSpeed, ENTRY_DEFAULTS.sliderLocalSpeed);
  assert.equal(staged.sliderLevel, ENTRY_DEFAULTS.sliderLevel);
  assert.equal(staged.sliderGrain, ENTRY_DEFAULTS.sliderGrain);
});

test('an unknown entryId 400s', async () => {
  const response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    playlist: PLAYLIST_NAME,
    entryId: 'e_does_not_exist',
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.equal(response.data.code, 'LIVE_TOUCH_PATTERN_INVALID');
  assert.match(response.data.error, /e_does_not_exist/);

  const staged = response.data.localControls;
  assert.equal(staged.sliderLocalSpeed, ENTRY_DEFAULTS.sliderLocalSpeed,
    'channel must remain at its prior staged state, not code defaults');
});

test('playlist without entryId, and entryId without playlist, both 400', async () => {
  let response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    playlist: PLAYLIST_NAME,
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.equal(response.data.code, 'LIVE_TOUCH_PATTERN_INVALID');
  assert.match(response.data.error, /entryId/);

  response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    entryId: ENTRY_ID,
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.equal(response.data.code, 'LIVE_TOUCH_PATTERN_INVALID');
  assert.match(response.data.error, /playlist/);
});

test('an entry marked _missing 400s and never applies its stale defaults', async () => {
  const missingCreated = await h.api('POST', '/playlists', {
    name: 'ambient_with_missing',
    entries: [
      { id: 'e_missing', pattern: 'no_such_pattern_on_disk', label: null, defaults: {} },
    ],
  });
  assert.equal(missingCreated.status, 200, JSON.stringify(missingCreated.data));

  const response = await h.api('PUT', '/layers/live_touch/pattern', {
    pattern: PATTERN,
    playlist: 'ambient_with_missing',
    entryId: 'e_missing',
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.equal(response.data.code, 'LIVE_TOUCH_PATTERN_INVALID');
});

test('bare {pattern} still stages at pattern code defaults (regression guard)', async () => {
  const response = await h.api('PUT', '/layers/live_touch/pattern', { pattern: PATTERN });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.pattern, PATTERN);

  const staged = response.data.localControls;
  for (const [name, value] of Object.entries(CODE_DEFAULTS)) {
    assert.equal(staged[name], value, `${name} must be at its pattern code default`);
  }
});
