import { describe, expect, it } from 'vitest';
import {
  cueColorThemeMode,
  defaultCueColorTheme,
  fixedTwoToneTheme,
  normalizeCueColorAutopilot,
  twoToneBehavior,
} from './cue_color_theme_logic';

describe('cue color themes', () => {
  it('authors the three Deck color modes', () => {
    const twoTone = defaultCueColorTheme('twoTone');
    expect(cueColorThemeMode(twoTone)).toBe('twoTone');
    expect(twoTone.mode).toBe('palettes');
    if (twoTone.mode === 'followNote') throw new Error('expected palette mode');
    expect(twoTone.palettes).toHaveLength(2);

    const fiveTone = defaultCueColorTheme('fiveTone');
    expect(cueColorThemeMode(fiveTone)).toBe('fiveTone');
    if (fiveTone.mode === 'followNote') throw new Error('expected palette mode');
    expect(fiveTone.palettes).toHaveLength(5);

    const followNote = defaultCueColorTheme('followNote');
    expect(cueColorThemeMode(followNote)).toBe('followNote');
    expect(followNote.mode).toBe('followNote');
    if (followNote.mode !== 'followNote') throw new Error('expected Follow Note mode');
    expect(followNote.followNote.schemes.length).toBeGreaterThan(1);
    expect(followNote.followNote.sel).toEqual([0, 1]);
  });

  it('preserves continuous crossfade instead of replacing delay_s 0', () => {
    const normalized = normalizeCueColorAutopilot({
      active: true,
      mode: 'palettes',
      palettes: [{ c1: 0.08, c2: 0.58 }, { c1: 0.58, c2: 0.08 }],
      delay_s: 0,
      shuffle: false,
      transitionMs: 800,
    });
    if (normalized.mode === 'followNote') throw new Error('expected palette mode');
    expect(normalized.delay_s).toBe(0);
    expect(normalized.transitionMs).toBe(800);
  });

  it('authors a fixed two-tone pair as one apply-once palette', () => {
    const fixed = fixedTwoToneTheme(0.08, 0.58, 500);
    expect(cueColorThemeMode(fixed)).toBe('twoTone');
    expect(twoToneBehavior(fixed)).toBe('fixed');
    expect(fixed).toMatchObject({
      active: true,
      mode: 'palettes',
      behavior: 'fixed',
      palettes: [{ c1: 0.08, c2: 0.58 }],
      delay_s: 0,
      shuffle: false,
      transitionMs: 500,
    });
  });

  it('copies a live Follow Note deck config without runtime facts', () => {
    const normalized = normalizeCueColorAutopilot({
      active: true,
      mode: 'followNote',
      palettes: [],
      delay_s: 30,
      shuffle: false,
      currentScheme: 'triadic',
      notePc: 4,
      followNote: {
        schemes: ['analogous', 'triadic'],
        methodHoldS: 8,
        methodFadeS: 1,
        noteFadeMs: 150,
        sel: [1, 4],
        shuffle: true,
      },
    });
    expect(normalized).toEqual({
      active: true,
      mode: 'followNote',
      followNote: {
        schemes: ['analogous', 'triadic'],
        methodHoldS: 8,
        methodFadeS: 1,
        noteFadeMs: 150,
        sel: [1, 4],
        shuffle: true,
      },
    });
  });

  it('refuses a continuous hard-cut spin loop', () => {
    expect(() => normalizeCueColorAutopilot({
      active: true,
      palettes: ['aurora'],
      delay_s: 0,
      shuffle: false,
      transitionMs: 0,
    })).toThrow(/Continuous color themes require a fade/);
  });
});
