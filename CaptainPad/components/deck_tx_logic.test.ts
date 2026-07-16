/**
 * Pinned logic tests for the DECK TX transition-STYLE picker derivations.
 *
 * Reproduces the operator bug (Sina, 2026-07-07): "the deck TX is not
 * allowing me to change the blending mode …" — the picker's disabled state
 * was derived as `shuffle || !enabled` (DeckTransitionControls.tsx), gating
 * blend-mode changes on the SHUFFLE STYLE toggle. Against the buggy
 * derivation, the "settable while shuffle is ON" case below fails; the fix
 * makes the picker's availability depend ONLY on the DECK TX master toggle.
 */
import { describe, expect, it } from 'vitest';

import { buildTransitionModePatch, isTransitionStylePickerDisabled } from './deck_tx_logic';

describe('isTransitionStylePickerDisabled', () => {
  it('keeps the picker settable while SHUFFLE STYLE is ON (the reported bug)', () => {
    // DECK TX on + shuffle on: the operator must still be able to pick a
    // blend mode. The buggy `shuffle || !enabled` derivation returns true
    // here — this is the repro assertion.
    expect(isTransitionStylePickerDisabled({ enabled: true, shuffle: true })).toBe(false);
  });

  it('keeps the picker settable with shuffle OFF (unchanged happy path)', () => {
    expect(isTransitionStylePickerDisabled({ enabled: true, shuffle: false })).toBe(false);
  });

  it('disables the picker only when DECK TX itself is OFF', () => {
    // With transitions disabled entirely, swaps are instant loads — the mode
    // is moot, so the grey-out is intentional (matches the CROSSFADE TIME
    // row's OFF treatment). Shuffle state must not matter.
    expect(isTransitionStylePickerDisabled({ enabled: false, shuffle: false })).toBe(true);
    expect(isTransitionStylePickerDisabled({ enabled: false, shuffle: true })).toBe(true);
  });
});

describe('buildTransitionModePatch', () => {
  it('posts just the mode when shuffle is already off', () => {
    expect(buildTransitionModePatch('trans_dissolve', false)).toEqual({ mode: 'trans_dissolve' });
  });

  it('switches shuffle off in the SAME patch when picking a mode during shuffle', () => {
    // While shuffle is on the engine ignores the configured mode (it rolls a
    // random trans_* per swap — pickRandomTransitionMode in api_server.js).
    // An explicit operator pick must therefore drop shuffle atomically, so
    // the picked mode actually takes effect on the NEXT transition no matter
    // how it is initiated (autopilot cycle, manual next, timeline cue).
    expect(buildTransitionModePatch('trans_iris', true)).toEqual({
      mode: 'trans_iris',
      shuffle: false,
    });
  });
});
