// view_selection_restore_sanitize.test.js — a DELETED VIEW must never kill the boot.
//
// The confirmed failure (views-bulletproofing sweep, report 20260725_141):
// an operator deletes or renames a view in the sim, re-exports the model, and
// restarts the engine. The saved deck_state.yaml still carries
// `viewSelection: { type: 'viewMask', target: '<old name>' }`.
// `buildChannelFromSaved` handed that selection to `setDeckChannel`, whose
// eager mask compile THROWS on the unknown name — and the deck's pattern
// fallback (restoreDeckWithFallback) rebuilt with the SAME stale selection,
// failed identically, and escalated to `_deckRestoreFatal`: the engine
// REFUSED TO BOOT ("refusing to boot a dark deck") over a renamed view.
//
// The fix: `sanitizeRestoredViewSelection` pre-compiles the saved selection
// against the live model at restore time and degrades a stale one — LOUDLY —
// to the full-rig selection, so the channel (and the boot) survives.
//
// Also pinned here: the word-aware bit-only branch of buildMaskRegistry (a
// word-1 bit-only preset must read vMaskHi, never alias the word-0 group
// sharing its bit value).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';
import { restoreDeckWithFallback, sanitizeRestoredViewSelection } from '../../lib/api_server.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';

// A 4-pixel model whose CURRENT views no longer include 'Old View'.
function makeMixer() {
  const pixels = [
    { i: 0, group: 'Wall', sId: 1, fId: 1, vMask: 1, vMaskHi: 0 },
    { i: 1, group: 'Wall', sId: 1, fId: 2, vMask: 1, vMaskHi: 0 },
    { i: 2, group: 'Floor', sId: 2, fId: 3, vMask: 2, vMaskHi: 0 },
    { i: 3, group: 'Floor', sId: 2, fId: 4, vMask: 2, vMaskHi: 0 },
  ];
  const wasmHost = { compile: () => ({ ok: true, handle: {} }) };
  return new PatternMixer({
    wasmHost, pixelCount: 4, pixels,
    groupBits: { Wall: 1, Floor: 2 },
    viewMasks: [{ name: 'Current View', bit: 4, word: 0, groups: ['Wall'] }],
  });
}

const STALE = { type: 'viewMask', target: 'Old View', invert: false };

function deckConfig(viewSelection) {
  return {
    id: 'deck', name: 'Deck', pattern: 'p', handle: {},
    mode: 'blend_normal', fader: 1, enabled: true, viewSelection,
  };
}

test('premise: setDeckChannel still THROWS on a stale view name (live-API contract intact)', () => {
  const mixer = makeMixer();
  assert.throws(() => mixer.setDeckChannel(deckConfig(STALE)),
    /Unknown viewMask name 'Old View'/);
});

test('sanitize: a selection that resolves passes through VERBATIM', () => {
  const mixer = makeMixer();
  const good = { type: 'viewMask', target: 'Current View', invert: true };
  assert.equal(sanitizeRestoredViewSelection(mixer, good, 'deck', 'deck'), good);
  const group = { type: 'group', target: 'Floor', invert: false };
  assert.equal(sanitizeRestoredViewSelection(mixer, group, 'mixer', 'ch_1'), group);
});

test('sanitize: null/absent restores to the documented full-rig default', () => {
  const mixer = makeMixer();
  assert.deepEqual(sanitizeRestoredViewSelection(mixer, null, 'deck', 'deck'),
    { type: 'all', target: null, invert: false });
});

test('sanitize: a STALE view name degrades LOUDLY to the full rig — never a throw', () => {
  const mixer = makeMixer();
  const errors = [];
  const realError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let out;
  try {
    out = sanitizeRestoredViewSelection(mixer, STALE, 'deck', 'deck');
  } finally {
    console.error = realError;
  }
  assert.deepEqual(out, { type: 'all', target: null, invert: false });
  assert.equal(errors.length, 1, 'exactly one loud degrade line');
  assert.match(errors[0], /Old View/, 'names the stale view');
  assert.match(errors[0], /FULL RIG/, 'says what it degraded to');
  assert.match(errors[0], /Re-pick the view in CaptainPad/, 'names the remedy');
});

test('END-TO-END: the deck BOOTS through restoreDeckWithFallback despite a deleted view', () => {
  const mixer = makeMixer();
  const saved = { id: 'deck', name: 'Deck', pattern: 'good', viewSelection: STALE };
  const realError = console.error;
  console.error = () => {};
  let result;
  try {
    // build() mirrors buildChannelFromSaved POST-FIX: selection sanitized
    // before it reaches setDeckChannel.
    result = restoreDeckWithFallback(saved, 'default_pattern', (pattern) =>
      mixer.setDeckChannel(deckConfig(
        sanitizeRestoredViewSelection(mixer, saved.viewSelection, 'deck', saved.id))));
  } finally {
    console.error = realError;
  }
  assert.ok(result.channel, 'deck channel restored');
  assert.equal(result.degraded, null,
    'the PATTERN restored cleanly — only the view selection degraded');
  assert.deepEqual(result.channel.viewSelection,
    { type: 'all', target: null, invert: false });
  assert.equal(result.channel.compiledPixelMask, null, 'type all compiles to the full-rig fast path');
});

test('END-TO-END control: pre-fix wiring (unsanitized) escalates to the fatal boot refusal', () => {
  const mixer = makeMixer();
  const saved = { id: 'deck', name: 'Deck', pattern: 'good', viewSelection: STALE };
  const realError = console.error;
  console.error = () => {};
  try {
    assert.throws(
      () => restoreDeckWithFallback(saved, 'default_pattern',
        (pattern) => mixer.setDeckChannel(deckConfig(saved.viewSelection))),
      (e) => e._deckRestoreFatal === true && /refusing to boot a dark deck/.test(e.message),
      'this is the bug the sanitizer exists for — if this stops throwing, the ' +
      'compile-eagerly contract changed and the sanitizer should be revisited');
  } finally {
    console.error = realError;
  }
});

// ── buildMaskRegistry: bit-only presets resolve in their OWN word ───────────

test('a word-1 bit-only preset reads vMaskHi — never the word-0 group sharing its bit value', () => {
  const pixels = [
    { i: 0, group: 'Wall', vMask: 1, vMaskHi: 0 },   // word-0 group bit 1
    { i: 1, group: 'Wall', vMask: 1, vMaskHi: 1 },   // ALSO carries word-1 bit 1
    { i: 2, group: 'Floor', vMask: 2, vMaskHi: 1 },  // word-1 bit 1 only
    { i: 3, group: 'Floor', vMask: 2, vMaskHi: 0 },
  ];
  const reg = buildMaskRegistry({
    pixels, pixelCount: 4, groupBits: { Wall: 1, Floor: 2 },
    viewMasks: [
      { name: 'Hi Bit Only', bit: 1, word: 1 },   // members must be pixels 1,2
      { name: 'Lo Bit Only', bit: 1 },            // legacy word-0: pixels 0,1
    ],
  });
  assert.deepEqual(Array.from(reg.get('Hi Bit Only').members), [0, 1, 1, 0],
    'word-1 membership from vMaskHi — pixel 0 (word-0 bit 1) must NOT leak in');
  assert.deepEqual(Array.from(reg.get('Lo Bit Only').members), [1, 1, 0, 0],
    'word-0 membership unchanged');
});
