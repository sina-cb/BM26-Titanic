// Centralized blend-mode validation (single source of truth).
//
// Before this slice, the PATCH /mixer/channels/:id, PATCH /deck/channel,
// /deck/transition-config, and WS setChannelMode paths each open-coded their
// own mode check (or accepted anything). They could drift apart, and an
// unknown mode was silently handed to the mixer (degraded host-side
// fallback). isValidBlendMode is now the one gate; these tests pin its
// accepted set so the routes can't quietly diverge again.
//
// Run:  node --test tests/blend_mode_validation.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isValidBlendMode, VALID_CHANNEL_BLEND_MODES } from '../../lib/api_server.js';

test('accepts the known steady channel-blend modes', () => {
  for (const mode of VALID_CHANNEL_BLEND_MODES) {
    assert.equal(isValidBlendMode(mode), true, `${mode} should be valid`);
  }
  // Explicit spot-checks so a future edit to the set is caught.
  assert.equal(isValidBlendMode('blend_screen'), true);
  assert.equal(isValidBlendMode('blend_add'), true);
  assert.equal(isValidBlendMode('blend_over'), true);
});

test('accepts only cataloged trans_* scripted transition names', () => {
  assert.equal(isValidBlendMode('trans_crossfade'), true);
  assert.equal(isValidBlendMode('trans_iris_close'), true);
  assert.equal(isValidBlendMode('trans_anything_new'), false);
  assert.equal(isValidBlendMode('trans_morse_blink'), false);
});

test('rejects typos and unknown modes (FAIL LOUD, not silent fallback)', () => {
  assert.equal(isValidBlendMode('blend_scren'), false); // typo
  assert.equal(isValidBlendMode('multiply'), false);
  assert.equal(isValidBlendMode('blend'), false);
  assert.equal(isValidBlendMode('transparent'), false); // not trans_
});

test('rejects non-string / empty input', () => {
  assert.equal(isValidBlendMode(''), false);
  assert.equal(isValidBlendMode(null), false);
  assert.equal(isValidBlendMode(undefined), false);
  assert.equal(isValidBlendMode(42), false);
  assert.equal(isValidBlendMode({}), false);
});
