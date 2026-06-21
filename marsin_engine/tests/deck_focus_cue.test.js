// Unit tests for cue-to-deck (docs/39 §F-cue): the deck-focus preview field
// + the validation contract POST /deck/focus relies on.
// Run:  node --test tests/deck_focus_cue.test.js
//
// Pure-additive guards. They construct PatternMixer directly with a stub
// wasmHost — no engine boot, no WASM, no disk. The route handler in
// api_server.js (POST /deck/focus) is exercised end-to-end by the HIL test
// (tests/hil/hil_deck_focus_cue_test.mjs); these unit tests pin the engine-
// side primitives that handler is built on:
//
//   - mixer.deckFocusChannelId defaults to null (no cue → canonical deck).
//   - getMixerChannel(id) resolves a real overlay (route → set field),
//     returns null for the deck id (route → 400), and undefined for an
//     unknown id (route → 404).
//   - setting / clearing the field is a plain transient assignment.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../lib/pattern_mixer.js';

const wasmHostStub = { destroy() {} };

function makeMixer() {
  const mixer = new PatternMixer({ wasmHost: wasmHostStub, pixelCount: 8, maxChannels: 4 });
  mixer.setDeckChannel({ id: 'ch_deck', name: 'Deck', pattern: 'p_deck' });
  mixer.addMixerChannel({ id: 'ch_overlay_1', name: 'L1', pattern: 'p1' });
  mixer.addMixerChannel({ id: 'ch_overlay_2', name: 'L2', pattern: 'p2' });
  return mixer;
}

test('deckFocusChannelId defaults to null (no cue armed)', () => {
  const mixer = makeMixer();
  assert.equal(mixer.deckFocusChannelId, null);
});

test('cue: setting deckFocusChannelId to a valid overlay id sticks', () => {
  const mixer = makeMixer();
  // The route validates with getMixerChannel before assigning.
  const overlay = mixer.getMixerChannel('ch_overlay_1');
  assert.ok(overlay, 'overlay must resolve');
  mixer.deckFocusChannelId = overlay.id;
  assert.equal(mixer.deckFocusChannelId, 'ch_overlay_1');
});

test('clear: setting deckFocusChannelId to null restores the canonical deck view', () => {
  const mixer = makeMixer();
  mixer.deckFocusChannelId = 'ch_overlay_1';
  mixer.deckFocusChannelId = null;
  assert.equal(mixer.deckFocusChannelId, null);
});

test('validation: getMixerChannel rejects the deck channel id (route → 400)', () => {
  const mixer = makeMixer();
  // The deck cannot be cued onto itself; getMixerChannel returns null for it.
  assert.equal(mixer.getMixerChannel('ch_deck'), null);
});

test('validation: getMixerChannel returns undefined for an unknown id (route → 404)', () => {
  const mixer = makeMixer();
  assert.equal(mixer.getMixerChannel('ch_nope'), undefined);
});

test('validation: getMixerChannel resolves every real overlay (route → set field)', () => {
  const mixer = makeMixer();
  for (const id of ['ch_overlay_1', 'ch_overlay_2']) {
    const ov = mixer.getMixerChannel(id);
    assert.ok(ov, `overlay ${id} must resolve`);
    assert.equal(ov.id, id);
  }
});
