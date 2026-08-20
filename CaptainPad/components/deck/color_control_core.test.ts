import { describe, expect, it } from 'vitest';

import {
  SCHEME_IDS as CORE_SCHEME_IDS,
  crossfadeAutopilotPatch as coreCrossfadeAutopilotPatch,
  followNoteAutopilotPatch as coreFollowNoteAutopilotPatch,
  generateScheme as coreGenerateScheme,
  orbitPairs as coreOrbitPairs,
  orbitStep as coreOrbitStep,
  reduceColorControlState as coreReduceColorControlState,
  turnsAutopilotPatch as coreTurnsAutopilotPatch,
} from '../../shared/color_control_core.js';
import {
  SCHEME_IDS,
  crossfadeAutopilotPatch,
  followNoteAutopilotPatch,
  generateScheme,
  orbitPairs,
  orbitStep,
  reduceColorControlState,
  turnsAutopilotPatch,
} from './colors_window_logic';

describe('platform-neutral color control core', () => {
  it('keeps all nine scheme generators byte-identical through the Deck adapter', () => {
    expect([...CORE_SCHEME_IDS]).toEqual([...SCHEME_IDS]);
    for (const baseHue of [0, 0.17, 0.72, 0.99]) {
      for (const scheme of CORE_SCHEME_IDS) {
        expect(coreGenerateScheme(scheme, baseHue)).toEqual(generateScheme(scheme, baseHue));
      }
    }
  });

  it('builds identical crossfade, turns, and follow-note wires', () => {
    const ring = coreGenerateScheme('golden', 0.31);
    expect(coreCrossfadeAutopilotPatch(0.1, 0.6, 2, 0.8))
      .toEqual(crossfadeAutopilotPatch(0.1, 0.6, 2, 0.8));
    expect(coreTurnsAutopilotPatch(ring, 5, 1.5, [1, 3]))
      .toEqual(turnsAutopilotPatch(ring, 5, 1.5, [1, 3]));
    const follow = {
      schemes: ['complement', 'triadic', 'golden'] as const,
      methodHoldS: 60,
      methodFadeS: 3,
      noteFadeMs: 400,
      sel: [1, 4] as const,
    };
    expect(coreFollowNoteAutopilotPatch(follow)).toEqual(followNoteAutopilotPatch(follow));
  });

  it('docs/75 §4: the Deck adapter posts the SAME stepped orbit as the core, at every distance', () => {
    const ring = coreGenerateScheme('split', 0.44);
    for (let a = 0; a < 5; a++) {
      for (let b = 0; b < 5; b++) {
        if (a === b) continue;
        expect(orbitPairs(ring, [a, b])).toEqual(coreOrbitPairs(ring, [a, b]));
      }
    }
    // The table docs/75 §9 D1 pins: n = 5 adjacent (d 1, 4) steps by 2,
    // spaced (d 2, 3) stays at step 1; the crossfade's 2-slot ring never
    // steps.
    expect([1, 2, 3, 4].map((d) => orbitStep(d, 5))).toEqual([2, 1, 1, 2]);
    expect([1, 2, 3, 4].map((d) => coreOrbitStep(d, 5))).toEqual([2, 1, 1, 2]);
    expect(orbitStep(1, 2)).toBe(1);
    expect(coreOrbitStep(1, 2)).toBe(1);
  });

  it('reconciles mode-scoped GET/WS state and clears stale runtime note facts', () => {
    const previous = {
      active: true,
      mode: 'followNote' as const,
      palettes: [],
      currentScheme: 'triadic',
      notePc: 4,
      noteHue: 0.25,
      nextMethodAtMs: 9000,
      followNote: { schemes: ['triadic'] },
    };
    const payload = {
      active: true,
      mode: 'palettes',
      palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }],
      delay_s: 2,
      transitionMs: 800,
      shuffle: false,
      nextSwapAtMs: 12000,
    };
    const core = coreReduceColorControlState(previous, payload);
    const deck = reduceColorControlState(previous, payload);
    expect(deck).toEqual(core);
    expect(core).toMatchObject({
      active: true,
      mode: 'palettes',
      delay_s: 2,
      transitionMs: 800,
      nextSwapAtMs: 12000,
    });
    expect(core).not.toHaveProperty('currentScheme');
    expect(core).not.toHaveProperty('notePc');

    payload.palettes[0].c1 = 0.9;
    expect((core.palettes[0] as { c1: number }).c1).toBe(0.1);
  });

  it('rejects malformed reducer mode instead of preserving ambiguous state', () => {
    expect(() => coreReduceColorControlState(
      { active: false, mode: 'palettes', palettes: [] },
      { mode: 'followBeat' },
    )).toThrow(/mode must be palettes or followNote/);
  });
});
