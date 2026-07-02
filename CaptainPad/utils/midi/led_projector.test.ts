import { describe, it, expect } from 'vitest';
import { validateProfile } from './profile';
import { projectLeds, MidiProjectionState, LedState } from './led_projector';

const profile = validateProfile({
  device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 3] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } },
  ],
});

function state(over: Partial<MidiProjectionState> = {}): MidiProjectionState {
  return {
    blackout: false,
    activePattern: null,
    getGlobalEffectState: () => false,
    resolvePatternForBank: () => null,
    layerExists: () => false,
    getFocusedLayer: () => -1,
    isFocusLocked: () => false,
    getGlobalEffectSlotActive: () => false,
    globalEffectSlotCount: 0,
    getLayerPlaylistLength: () => 0,
    getLayerActiveEntryIndex: () => -1,
    getWindowCursor: () => 0,
    windowSize: 6,
    getColorPaletteHue: () => null,
    ...over,
  };
}

describe('projectLeds', () => {
  it('lights the blackout button when blackout is on (single LED, channel 0)', () => {
    const { messages } = projectLeds(profile, state({ blackout: true }), {});
    expect(messages).toContainEqual([0x90, 107, 1]); // on
  });

  it('darkens the blackout button when blackout is off', () => {
    const { messages } = projectLeds(profile, state({ blackout: false }), {});
    expect(messages).toContainEqual([0x90, 107, 0]); // off
  });

  it('lights the active pattern pad green (channel 6) and others dim', () => {
    const s = state({
      activePattern: 'p2',
      resolvePatternForBank: (_b, i) => `p${i}`,
    });
    const { messages } = projectLeds(profile, s, {});
    expect(messages).toContainEqual([0x96, 2, 21]); // pad 2 active green, solid 100%
    expect(messages).toContainEqual([0x96, 0, 1]);  // pad 0 idle
  });

  it('keeps a pad with no pattern dark (velocity 0)', () => {
    const s = state({ activePattern: 'whatever', resolvePatternForBank: () => null });
    const { messages } = projectLeds(profile, s, {});
    expect(messages).toContainEqual([0x96, 0, 0]); // unlit — no pattern behind it
  });

  it('diffs: an unchanged projection sends nothing', () => {
    const s = state({ blackout: true });
    const first = projectLeds(profile, s, {});
    const second = projectLeds(profile, s, first.next);
    expect(second.messages).toEqual([]);
  });

  it('diffs: only the changed LED is re-sent', () => {
    const off = projectLeds(profile, state({ blackout: false }), {});
    const on = projectLeds(profile, state({ blackout: true }), off.next);
    expect(on.messages).toEqual([[0x90, 107, 1]]);
  });

  it('focusChannel track button lights only the focused layer', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0 } },
          { id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'focusChannel', layer: 1 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const s = state({ layerExists: (l) => l <= 1, getFocusedLayer: () => 1 });
    const { messages } = projectLeds(p, s, {}, 'mixer');
    expect(messages).toContainEqual([0x90, 100, 0]); // layer 0 exists but not focused → off
    expect(messages).toContainEqual([0x90, 101, 1]); // layer 1 focused → lit
  });

  it('focusChannel track button BLINKS (flash velocity) while the focus is pickup-locked', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0, flash: 2 } },
        ],
      },
    });
    // Focused + locked → blink velocity 2.
    const locked = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => true }), {}, 'mixer');
    expect(locked.messages).toContainEqual([0x90, 100, 2]);
    // Focused + unlocked → solid on (velocity 1).
    const solid = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => false }), {}, 'mixer');
    expect(solid.messages).toContainEqual([0x90, 100, 1]);
  });

  it('focusChannel flash falls back to `on` when the profile omits a flash velocity', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 't1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'focusChannel', layer: 0 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const locked = projectLeds(p, state({ layerExists: (l) => l === 0, getFocusedLayer: () => 0, isFocusLocked: () => true }), {}, 'mixer');
    expect(locked.messages).toContainEqual([0x90, 100, 1]); // no flash → on
  });

  it('colour-pair pads show c1 on even columns and c2 on odd (Stage 2)', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'c1col', match: { type: 'column', channel: 0, column: 4, fromRow: 0, toRow: 0 }, action: { kind: 'colorPalettePair', bank: 0 } },
          { id: 'c2col', match: { type: 'column', channel: 0, column: 5, fromRow: 0, toRow: 0 }, action: { kind: 'colorPalettePair', bank: 0 } },
        ],
      },
    });
    const s = state({ getColorPaletteHue: (i) => (i === 0 ? { c1: 0.0, c2: 0.33 } : null) });
    const { messages } = projectLeds(p, s, {}, 'mixer');
    expect(messages).toContainEqual([0x96, 4, 5]);  // col4 (even) → c1 hue 0.0 → red
    expect(messages).toContainEqual([0x96, 5, 21]); // col5 (odd)  → c2 hue 0.33 → green
  });
});

describe('projectLeds — MFT rings (driver #2, best-effort)', () => {
  const mft = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
      { id: 'k1', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'focusedParamKnob', index: 1 } },
    ],
  });

  it('emits a ring-value CC (ch0) from the focused export value 0..127', () => {
    const s = state({
      getFocusedExportValue: (i) => (i === 0 ? 1.0 : i === 1 ? 0.5 : null),
      getFocusedIdentityColor: () => 1, // blue (deck)
    });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb0, 0, 127]); // knob 0 ring full
    expect(messages).toContainEqual([0xb0, 1, 64]);  // knob 1 ring ~half (round(0.5*127))
  });

  it('emits the focused identity colour on a knob with a param behind it', () => {
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 0.25 : null), getFocusedIdentityColor: () => 50 });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb1, 0, 50]); // colour CC on ch1 (SWITCH_AND_COLOR)
  });

  it('darks a knob with no param behind it (ring 0 + inactive colour)', () => {
    const s = state({ getFocusedExportValue: () => null, getFocusedIdentityColor: () => 1 });
    const { messages } = projectLeds(mft, s, {});
    expect(messages).toContainEqual([0xb0, 0, 0]);  // ring off
    expect(messages).toContainEqual([0xb1, 0, 0]);  // inactive colour (ColorValues.INACTIVE)
  });

  it('diffs rings — an unchanged value re-sends nothing', () => {
    const s = state({ getFocusedExportValue: (i) => (i === 0 ? 0.5 : null), getFocusedIdentityColor: () => 1 });
    const first = projectLeds(mft, s, {});
    const second = projectLeds(mft, s, first.next);
    expect(second.messages).toHaveLength(0);
  });

  it('is inert on a projection state without the MFT getters (APC-only path)', () => {
    const { messages } = projectLeds(mft, state(), {});
    // No getFocusedExportValue → ringMessages yields nothing; no led specs either.
    expect(messages).toHaveLength(0);
  });
});
