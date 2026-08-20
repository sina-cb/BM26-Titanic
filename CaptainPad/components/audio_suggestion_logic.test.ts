/**
 * audio_suggestion_logic.test.ts — the ♪ audio-suggestion badge + prefill rules.
 *
 * Pins the operator adjudication from report 20260806_184:
 *   - the PLAIN "add modulation" flow is untouched — neutral defaults, any
 *     live signal bindable;
 *   - the author's recommendation prefills ONLY on an explicit badge tap;
 *   - an existing saved mapping is never overwritten by a suggestion;
 *   - a parameter with no suggestion behaves exactly as before.
 */
import { describe, it, expect } from 'vitest';
import {
  NEUTRAL_SEED, modulationSeed, shouldPrefill, suggestionBadgeIsActionable,
} from './audio_suggestion_logic';
import type { AudioSuggestion } from '../utils/api';

// The real 13_sparkle StarCount suggestion, as the engine stamps it.
const FLUX: AudioSuggestion = {
  version: 'AUDIO_MODULATION_V1',
  signal: 'micFlux',
  range: [0.12, 0.86],
  curve: 'ease',
  modulationCurve: 'easeOut',
  note: 'build reveals more stars',
};

describe('shouldPrefill', () => {
  it('prefills only on an explicit badge tap for a NEW mapping', () => {
    expect(shouldPrefill(FLUX, 'suggestion', false)).toBe(true);
  });
  it('does NOT prefill the plain add-modulation flow', () => {
    expect(shouldPrefill(FLUX, 'plain', false)).toBe(false);
  });
  it('does NOT prefill over an existing saved mapping', () => {
    expect(shouldPrefill(FLUX, 'suggestion', true)).toBe(false);
  });
  it('does nothing when the parameter declares no suggestion', () => {
    expect(shouldPrefill(null, 'suggestion', false)).toBe(false);
    expect(shouldPrefill(undefined, 'suggestion', false)).toBe(false);
  });
});

describe('modulationSeed', () => {
  it('badge entry seeds source, OVERRIDE mode, range and translated curve', () => {
    expect(modulationSeed(FLUX, 'suggestion', false)).toEqual({
      source: 'micFlux',
      mode: 'override',
      range: [0.12, 0.86],
      // The block declared `ease`; the engine translated it to the modulation
      // engine's `easeOut`. The client must NOT re-derive this.
      curve: 'easeOut',
    });
  });

  it('the plain flow is byte-identical to the pre-feature behaviour', () => {
    const plain = modulationSeed(FLUX, 'plain', false, 'micLow');
    expect(plain).toEqual({ ...NEUTRAL_SEED, range: [0, 0.35] });
    // …and identical to a parameter that has no suggestion at all.
    expect(plain).toEqual(modulationSeed(null, 'plain', false, 'micLow'));
    expect(plain).toEqual(modulationSeed(undefined, 'suggestion', false, 'micLow'));
  });

  it('honours the caller fallback source when micLow is not live', () => {
    expect(modulationSeed(null, 'plain', false, 'low_test').source).toBe('low_test');
  });

  it('never mutates the shared neutral seed', () => {
    const a = modulationSeed(null, 'plain', false);
    a.range[0] = 0.9;
    expect(NEUTRAL_SEED.range[0]).toBe(0);
    expect(modulationSeed(null, 'plain', false).range[0]).toBe(0);
  });

  it('never hands back a suggestion range by reference', () => {
    const seed = modulationSeed(FLUX, 'suggestion', false);
    seed.range[1] = 0.1;
    expect(FLUX.range[1]).toBe(0.86);
  });
});

describe('suggestionBadgeIsActionable', () => {
  it('offers the shortcut on an editable, unmapped param', () => {
    expect(suggestionBadgeIsActionable(FLUX, true, false)).toBe(true);
  });
  it('is inert with no playlist entry to write to', () => {
    expect(suggestionBadgeIsActionable(FLUX, false, false)).toBe(false);
  });
  it('is inert when a mapping already exists (it would compete with it)', () => {
    expect(suggestionBadgeIsActionable(FLUX, true, true)).toBe(false);
  });
  it('is inert with no suggestion', () => {
    expect(suggestionBadgeIsActionable(null, true, false)).toBe(false);
  });
});

// ── _190: the chip was RESTYLED, the contract was not ────────────────
//
// The ♪ badge became `AudioSuggestionChip` inside the shared parameter-row
// header (one line: KNOB · NAME · status · ♪ · ⊞ · value). Nothing about what a
// tap DOES changed, so these assert the tap path end to end against the
// suggestions the live rig actually serves — the row's chip is handed
// `onPress` iff `suggestionBadgeIsActionable`, and that press opens the editor
// with exactly `modulationSeed(..., 'suggestion', ...)`.
describe('the restyled ♪ chip still prefills the right mapping', () => {
  // As stamped onto 120_crossing_beacons' exports by the engine.
  const LIVE: AudioSuggestion[] = [
    { version: 'AUDIO_MODULATION_V1', signal: 'micLow', range: [0.25, 1], curve: 'linear', modulationCurve: 'linear', note: 'whole beacon energy' },
    { version: 'AUDIO_MODULATION_V1', signal: 'micFlux', range: [0.25, 0.85], curve: 'ease', modulationCurve: 'easeOut', note: 'opens the grand X' },
    { version: 'AUDIO_MODULATION_V1', signal: 'micKick', range: [0, 1], curve: 'pow2', modulationCurve: 'easeIn', note: 'dual-fan punch' },
  ];

  it('seeds source, override mode, range and the translated curve for every band', () => {
    for (const s of LIVE) {
      // The chip is tappable exactly when the shortcut is offered…
      expect(suggestionBadgeIsActionable(s, true, false)).toBe(true);
      // …and the tap seeds the editor from the author's declaration.
      expect(modulationSeed(s, 'suggestion', false)).toEqual({
        source: s.signal,
        mode: 'override',
        range: [s.range[0], s.range[1]],
        curve: s.modulationCurve,
      });
    }
  });

  it('an inert chip (mapped / no entry) still cannot seed anything', () => {
    for (const s of LIVE) {
      expect(suggestionBadgeIsActionable(s, true, true)).toBe(false);
      expect(suggestionBadgeIsActionable(s, false, false)).toBe(false);
      // Even if a caller asked, an existing mapping wins.
      expect(modulationSeed(s, 'suggestion', true).mode).toBe('offset');
    }
  });

  it('a parameter with no suggestion has no chip and no changed behaviour', () => {
    expect(suggestionBadgeIsActionable(undefined, true, false)).toBe(false);
    expect(modulationSeed(undefined, 'suggestion', false, 'micLow')).toEqual({
      ...NEUTRAL_SEED, range: [0, 0.35],
    });
  });
});
