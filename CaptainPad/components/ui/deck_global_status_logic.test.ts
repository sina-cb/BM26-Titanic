import { describe, expect, it } from 'vitest';

import type { DeckGlobalStatusFrame } from '@/hooks/useEngineState';
import { deckGlobalStatusChips, deckGlobalStatusPages } from './deck_global_status_logic';

function frame(patch: Partial<DeckGlobalStatusFrame> = {}): DeckGlobalStatusFrame {
  return {
    patternAutopilot: null,
    colorAutopilot: null,
    deckTransition: null,
    deckOverlays: {
      total: 0,
      enabled: 0,
      autopilotActive: false,
      delay_s: 30,
      shuffle: false,
    },
    activeGlobalEffectCount: 0,
    master: 1,
    blackout: false,
    ...patch,
  };
}

describe('deck global status chips', () => {
  it('paginates the status rail into at most two visible rows', () => {
    const chips = deckGlobalStatusChips(frame({
      colorAutopilot: {
        active: true,
        mode: 'palettes',
        palettes: ['phoenix'],
        delay_s: 5,
        shuffle: false,
      },
      deckTransition: {
        enabled: true,
        mode: 'trans_dissolve',
        durationMs: 1000,
        shuffle: false,
      },
      deckOverlays: {
        total: 2,
        enabled: 2,
        autopilotActive: true,
        delay_s: 30,
        shuffle: true,
      },
      activeGlobalEffectCount: 3,
      master: 0.75,
    }));

    expect(deckGlobalStatusPages(chips).map((page) => page.map((chip) => chip.id)))
      .toEqual([
        ['colors', 'overlays'],
        ['transition', 'effects'],
        ['master'],
      ]);
    expect(deckGlobalStatusPages(chips).every((page) => page.length <= 2)).toBe(true);
    expect(() => deckGlobalStatusPages(chips, 0)).toThrow(/positive integer/);
  });

  it('stays empty when no global Deck behavior is known active', () => {
    expect(deckGlobalStatusChips(frame())).toEqual([]);
  });

  it('shows pattern cadence only while pattern autopilot is active', () => {
    expect(deckGlobalStatusChips(frame({
      patternAutopilot: {
        active: false,
        delay_s: '10',
        shuffle: true,
        groupMode: false,
        groupSize: null,
        groupDwell: null,
        profile: 'random',
        nextSwapAtMs: Date.now() + 10_000,
      },
    }))).toEqual([]);

    expect(deckGlobalStatusChips(frame({
      patternAutopilot: {
        active: true,
        delay_s: '10',
        shuffle: true,
        groupMode: false,
        groupSize: null,
        groupDwell: null,
        profile: 'random',
        nextSwapAtMs: Date.now() + 10_000,
      },
    })).find((chip) => chip.id === 'patterns')?.label).toBe('PATTERNS · 10S\nSHUFFLE');
  });

  it('does not render stopped color automation or disabled overlays', () => {
    expect(deckGlobalStatusChips(frame({
      colorAutopilot: {
        active: false,
        mode: 'palettes',
        palettes: ['phoenix'],
        delay_s: 5,
        shuffle: false,
      },
      deckOverlays: {
        total: 2,
        enabled: 0,
        autopilotActive: false,
        delay_s: 30,
        shuffle: false,
      },
    }))).toEqual([]);
  });

  it('summarizes every meaningful global Deck behavior', () => {
    const ids = deckGlobalStatusChips(frame({
      colorAutopilot: {
        active: true,
        mode: 'palettes',
        palettes: ['phoenix'],
        delay_s: 5,
        shuffle: false,
      },
      deckTransition: {
        enabled: true,
        mode: 'trans_dissolve',
        durationMs: 1000,
        shuffle: false,
      },
      deckOverlays: {
        total: 2,
        enabled: 2,
        autopilotActive: true,
        delay_s: 30,
        shuffle: true,
      },
      activeGlobalEffectCount: 3,
      master: 0.75,
      blackout: true,
    })).map((chip) => chip.id);

    expect(ids).toEqual([
      'blackout',
      'colors',
      'overlays',
      'transition',
      'effects',
      'master',
    ]);
  });
});
