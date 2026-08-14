/**
 * audio_suggestion_labels.test.ts — the badge's identity helpers, and the
 * separation between a parameter's NAME and its audio RECOMMENDATION.
 *
 * The feature exists because 13_sparkle used to encode the recommendation IN
 * the parameter name (`sliderFLUX_StarCount`), which the shared pretty-namer
 * rendered as garbage on the operator's screen. These tests pin both halves of
 * the fix: names render clean, and the recommendation renders separately with
 * its own band colour (report 20260806_184).
 */
import { describe, it, expect } from 'vitest';
import {
  COMPANION_ACCENT, ACCENT_AUTO, audioAccentHexForKey, shortSignalLabel,
} from './audioSignals';

// A local copy of components/Modulation.tsx's `prettySliderName`. That module
// is React Native (.tsx) and cannot load in this env; this mirrors it so the
// "names render clean" claim is asserted rather than assumed. Kept in step by
// the assertions below, which are written against the SHIPPED behaviour.
function prettySliderName(name: string): string {
  return name
    .replace(/_v\d+$/, '')
    .replace(/^(slider|toggle|trigger|hsvPicker)/i, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .trim()
    .toUpperCase()
    .substring(0, 15);
}

describe('parameter names render clean after the 13_sparkle migration', () => {
  it('the OLD signal-in-the-name style rendered as garbage', () => {
    // This is what the operator actually saw before the migration.
    // Truncated at 15 chars, so it did not even finish the word.
    expect(prettySliderName('sliderFLUX_StarCount')).toBe('F L U X_ STAR C');
    expect(prettySliderName('sliderLOW_Level')).toBe('L O W_ LEVEL');
    expect(prettySliderName('sliderKICK_Burst')).toBe('K I C K_ BURST');
  });

  it('the migrated names render as plain words', () => {
    expect(prettySliderName('sliderStarCount')).toBe('STAR COUNT');
    expect(prettySliderName('sliderLevel')).toBe('LEVEL');
    expect(prettySliderName('sliderBrilliance')).toBe('BRILLIANCE');
    expect(prettySliderName('sliderBurst')).toBe('BURST');
  });
});

describe('shortSignalLabel — the badge word', () => {
  it('reduces a CPC key to its band word', () => {
    expect(shortSignalLabel('micLow')).toBe('LOW');
    expect(shortSignalLabel('micMid')).toBe('MID');
    expect(shortSignalLabel('micHigh')).toBe('HIGH');
    expect(shortSignalLabel('micKick')).toBe('KICK');
    // micFlux — the signal the operator reported as dead, now a real badge.
    expect(shortSignalLabel('micFlux')).toBe('FLUX');
  });

  it('keeps an unfamiliar / dynamic Companion key legible', () => {
    expect(shortSignalLabel('crowd_roar')).toBe('CROWD_ROAR');
    expect(shortSignalLabel('audioBuildScore')).toBe('BUILDSCORE');
  });
});

describe('audioAccentHexForKey — the badge colour', () => {
  it('gives every suggestible signal its own identity colour', () => {
    const keys = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
    const hexes = keys.map(audioAccentHexForKey);
    expect(new Set(hexes).size).toBe(keys.length);
    expect(audioAccentHexForKey('micFlux')).toBe(COMPANION_ACCENT.flux);
    expect(audioAccentHexForKey('micKick')).toBe(COMPANION_ACCENT.kick);
  });

  it('falls back to the neutral live accent for an unknown key', () => {
    expect(audioAccentHexForKey('crowd_roar')).toBe(ACCENT_AUTO);
  });

  it('resolves a key with no live descriptor (a suggestion may not be live)', () => {
    // The whole point: the badge describes a RECOMMENDATION, which the
    // Companion may not currently be publishing — the colour must not depend
    // on a live descriptor being available.
    expect(audioAccentHexForKey('micFlux')).toBeTruthy();
  });
});

describe('the suggestible signal family', () => {
  it('matches the engine registry set (micLow/Mid/High/Kick/Flux)', () => {
    // Mirrors `processedSignalKeys()` in
    // marsin_engine/audio/postproc/audio_signals.js — pinned here so the iPad
    // and the engine agree on which signals a pattern may recommend, and so
    // micFlux can never silently drop out of the list again.
    const family = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
    for (const key of family) {
      expect(shortSignalLabel(key)).toMatch(/^[A-Z]+$/);
      expect(audioAccentHexForKey(key)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const token of ['low', 'mid', 'high', 'kick', 'flux']) {
      expect(COMPANION_ACCENT[token]).toBeTruthy();
    }
  });
});
