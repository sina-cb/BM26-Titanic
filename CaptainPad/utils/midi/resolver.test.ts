import { describe, it, expect } from 'vitest';
import { validateProfile } from './profile';
import { resolveEvent, profileClaims } from './resolver';
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

describe('profileClaims (learn-conflict rejection, 1.1)', () => {
  it('names the control a mapped CC / note resolves to', () => {
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 48 })).toBe('fader_1'); // speed
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 56 })).toBe('master');
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 3 })).toBe('pads');
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 107 })).toBe('blackout');
  });

  it('returns null for an unmapped control (free to learn)', () => {
    expect(profileClaims(profile, { type: 'cc', channel: 0, number: 51 })).toBeNull();
    expect(profileClaims(profile, { type: 'note', channel: 0, number: 40 })).toBeNull();
  });

  it('respects the active context', () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        deck: [{ id: 'd_fader', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } }],
        mixer: [{ id: 'm_other', match: { type: 'cc', channel: 0, cc: 55 }, action: { kind: 'master' } }],
      },
    });
    // Mixer context doesn't map CC 54 → free there, but claimed on deck.
    expect(profileClaims(p, { type: 'cc', channel: 0, number: 54 }, 'deck')).toBe('d_fader');
    expect(profileClaims(p, { type: 'cc', channel: 0, number: 54 }, 'mixer')).toBeNull();
  });
});

describe('MFT relative encoders + side buttons (driver #2)', () => {
  // Bank-1 knob 0 = relative CC 0 on ch0 (turn) + CC 0 on ch1 (push); a bank-2
  // relative CC on ch0; the four side-button actions on ch3. Default steps
  // [0.005, 0.02, 0.06] for the three detent speeds.
  const p = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0, configureOnConnect: true },
    controls: [
      { id: 'knob0_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0 } },
      { id: 'knob0_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
      { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 5, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed', steps: [0.01, 0.05, 0.1] } },
      { id: 'f_prev', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'prev' } },
      { id: 'f_next', match: { type: 'cc', channel: 3, cc: 12 }, action: { kind: 'focusStep', dir: 'next' } },
      { id: 'f_deck', match: { type: 'cc', channel: 3, cc: 13 }, action: { kind: 'focusStep', dir: 'deck' } },
    ],
  });

  it('decodes a normal CW tick (code 65 = +1) to +steps[0], continuous', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 65]));
    expect(r).toEqual({ controlId: 'knob0_turn', continuous: true, resolved: { kind: 'focusedParamDelta', index: 0, delta: 0.005 } });
  });

  it('decodes a fast CCW tick (code 62 = -2) to -steps[1]', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 62]));
    expect(r?.resolved).toEqual({ kind: 'focusedParamDelta', index: 0, delta: -0.02 });
  });

  it('decodes a very-fast CW tick (code 67 = +3) to +steps[2]', () => {
    const r = resolveEvent(p, decodeMidi([0xb0, 0, 67]));
    expect(r?.resolved).toEqual({ kind: 'focusedParamDelta', index: 0, delta: 0.06 });
  });

  it('a non-relative CC value (not 61-67) on a relative control resolves to null (loud silence)', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 0, 64]))).toBeNull(); // 64 = no movement
    expect(resolveEvent(p, decodeMidi([0xb0, 0, 100]))).toBeNull();
  });

  it('paramCenterRelative uses its own steps + carries the key', () => {
    expect(resolveEvent(p, decodeMidi([0xb0, 5, 66]))?.resolved) // +2 → steps[1]=0.05
      .toEqual({ kind: 'paramCenterDelta', key: 'speed', delta: 0.05 });
  });

  it('encoder push (ch1) resolves focusedParamReset on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb1, 0, 127]))?.resolved).toEqual({ kind: 'focusedParamReset', index: 0 });
    expect(resolveEvent(p, decodeMidi([0xb1, 0, 0]))).toBeNull(); // release
  });

  it('side buttons resolve focusStep on press, null on release', () => {
    expect(resolveEvent(p, decodeMidi([0xb3, 11, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'prev' });
    expect(resolveEvent(p, decodeMidi([0xb3, 12, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'next' });
    expect(resolveEvent(p, decodeMidi([0xb3, 13, 127]))?.resolved).toEqual({ kind: 'focusStep', dir: 'deck' });
    // CC 10 (side left-3) is intentionally UNMAPPED — tap-tempo is not wired.
    expect(resolveEvent(p, decodeMidi([0xb3, 10, 127]))).toBeNull();
    expect(resolveEvent(p, decodeMidi([0xb3, 11, 0]))).toBeNull(); // release
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
