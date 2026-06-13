import { describe, it, expect } from 'vitest';
import { validateProfile } from './profile';
import { resolveEvent } from './resolver';
import { decodeMidi } from './midi_message';

const profile = validateProfile({
  device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
    { id: 'master', match: { type: 'cc', channel: 0, cc: 56 }, action: { kind: 'master' } },
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' } },
  ],
});

describe('resolveEvent', () => {
  it('scales a CC paramCenter into its range and marks it continuous', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 48, 127]));
    expect(r).toEqual({ controlId: 'fader_1', continuous: true, resolved: { kind: 'paramCenter', key: 'speed', value: 1 } });
  });

  it('scales a mid CC value', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 48, 64]));
    expect(r?.resolved).toEqual({ kind: 'paramCenter', key: 'speed', value: 64 / 127 });
  });

  it('maps the master fader to 0..1', () => {
    const r = resolveEvent(profile, decodeMidi([0xb0, 56, 127]));
    expect(r?.resolved).toEqual({ kind: 'master', value: 1 });
  });

  it('resolves a pad to a patternBank index from the note offset', () => {
    const r = resolveEvent(profile, decodeMidi([0x90, 3, 127]));
    expect(r).toEqual({ controlId: 'pads', continuous: false, resolved: { kind: 'patternBank', bank: 0, index: 3 } });
  });

  it('resolves a button to a blackout toggle', () => {
    const r = resolveEvent(profile, decodeMidi([0x90, 107, 127]));
    expect(r?.resolved).toEqual({ kind: 'blackoutToggle' });
  });

  it('ignores Note Off (no momentary actions in v1)', () => {
    expect(resolveEvent(profile, decodeMidi([0x80, 107, 0]))).toBeNull();
    expect(resolveEvent(profile, decodeMidi([0x90, 3, 0]))).toBeNull();
  });

  it('returns null for unmapped messages', () => {
    expect(resolveEvent(profile, decodeMidi([0xb0, 99, 10]))).toBeNull();
    expect(resolveEvent(profile, decodeMidi([0x90, 40, 127]))).toBeNull();
  });
});

describe('column matches (Stage 2)', () => {
  const p = validateProfile({
    device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
    contexts: {
      mixer: [
        { id: 'win', match: { type: 'column', channel: 0, column: 2, fromRow: 1, toRow: 6 }, action: { kind: 'playlistWindowSelect', layer: 2 } },
        { id: 'pal', match: { type: 'column', channel: 0, column: 5, fromRow: 0, toRow: 7 }, action: { kind: 'colorPalettePair', bank: 1 } },
      ],
    },
  });

  it('resolves a column pad to its window slot (row - fromRow)', () => {
    // column 2, row 3 → note = 3*8 + 2 = 26; slot = 3 - 1 = 2
    expect(resolveEvent(p, decodeMidi([0x90, 26, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 2, slot: 2 });
  });

  it('colorPalettePair palette index = bank*8 + row', () => {
    // column 5, row 4 → note = 4*8 + 5 = 37; bank 1 → palette = 8 + 4 = 12
    expect(resolveEvent(p, decodeMidi([0x90, 37, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'colorPalettePair', palette: 12 });
  });

  it('ignores pads outside the column row range', () => {
    // column 2, row 0 (note 2) is below fromRow 1
    expect(resolveEvent(p, decodeMidi([0x90, 2, 127]), 'mixer')).toBeNull();
  });

  it('reverse: true flips the index so the TOP pad is slot 0', () => {
    const rp = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'win', match: { type: 'column', channel: 0, column: 0, fromRow: 1, toRow: 6, reverse: true }, action: { kind: 'playlistWindowSelect', layer: 0 } },
        ],
      },
    });
    // Top window pad = row 6 (note 48) → slot 0; bottom = row 1 (note 8) → slot 5.
    expect(resolveEvent(rp, decodeMidi([0x90, 48, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 0, slot: 0 });
    expect(resolveEvent(rp, decodeMidi([0x90, 8, 127]), 'mixer')?.resolved)
      .toEqual({ kind: 'playlistWindowSelect', layer: 0, slot: 5 });
  });
});
