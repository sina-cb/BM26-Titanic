import { describe, it, expect } from 'vitest';
import { validateProfile } from './profile';
import { resolveEvent } from './resolver';
import { projectLeds, MidiProjectionState } from './led_projector';
import { decodeMidi } from './midi_message';

// Same physical controls, different actions per tab context.
const profile = validateProfile({
  device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  contexts: {
    deck: [
      { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
      { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    ],
    mixer: [
      { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'micLowGain', range: [0, 1] } },
      { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 45, idle: 1, channel: 6 } },
    ],
  },
});

describe('per-tab contexts', () => {
  it('builds both contexts and defaults controls to deck', () => {
    expect(Object.keys(profile.contexts).sort()).toEqual(['deck', 'mixer']);
    expect(profile.controls).toBe(profile.contexts.deck);
  });

  it('resolves the same CC to different params per context', () => {
    const ev = decodeMidi([0xb0, 48, 127]);
    expect(resolveEvent(profile, ev, 'deck')?.resolved).toEqual({ kind: 'paramCenter', key: 'speed', value: 1 });
    expect(resolveEvent(profile, ev, 'mixer')?.resolved).toEqual({ kind: 'paramCenter', key: 'micLowGain', value: 1 });
  });

  it('falls back to the default (deck) when no/unknown context is given', () => {
    const ev = decodeMidi([0xb0, 48, 64]);
    expect(resolveEvent(profile, ev)?.resolved).toEqual({ kind: 'paramCenter', key: 'speed', value: 64 / 127 });
    expect(resolveEvent(profile, ev, 'nope')?.resolved).toEqual({ kind: 'paramCenter', key: 'speed', value: 64 / 127 });
  });

  it('projects different LED colours per context for the active pad', () => {
    const s: MidiProjectionState = {
      blackout: false,
      activePattern: 'p0',
      getGlobalEffectState: () => false,
      resolvePatternForBank: (_b, i) => `p${i}`,
      layerExists: () => false,
      getLayerSolo: () => false,
      getFocusedLayer: () => -1,
      getGlobalEffectSlotActive: () => false,
      globalEffectSlotCount: 0,
      getLayerPlaylistLength: () => 0,
      getLayerActiveEntryIndex: () => -1,
      getWindowCursor: () => 0,
      windowSize: 6,
      getColorPaletteHue: () => null,
    };
    const deck = projectLeds(profile, s, {}, 'deck');
    const mixer = projectLeds(profile, s, {}, 'mixer');
    expect(deck.messages).toContainEqual([0x96, 0, 21]);  // deck active = green
    expect(mixer.messages).toContainEqual([0x96, 0, 45]); // mixer active = blue
  });
});
