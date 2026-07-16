import { describe, it, expect } from 'vitest';
import { decodeMidi, noteOn } from './midi_message';

describe('decodeMidi', () => {
  it('decodes Note On', () => {
    expect(decodeMidi([0x90, 60, 100])).toEqual({ type: 'noteOn', channel: 0, note: 60, velocity: 100 });
  });

  it('treats Note On velocity 0 as Note Off', () => {
    expect(decodeMidi([0x90, 60, 0])).toEqual({ type: 'noteOff', channel: 0, note: 60, velocity: 0 });
  });

  it('decodes Note Off', () => {
    expect(decodeMidi([0x82, 60, 40])).toEqual({ type: 'noteOff', channel: 2, note: 60, velocity: 40 });
  });

  it('decodes Control Change with channel', () => {
    expect(decodeMidi([0xb3, 48, 127])).toEqual({ type: 'cc', channel: 3, cc: 48, value: 127 });
  });

  it('returns other for short/unknown messages', () => {
    expect(decodeMidi([0xf8]).type).toBe('other');
    expect(decodeMidi([]).type).toBe('other');
  });
});

describe('noteOn', () => {
  it('builds a solid-100% red pad message (96 00 05)', () => {
    expect(noteOn(6, 0, 5)).toEqual([0x96, 0, 5]);
  });
  it('masks channel and clamps bytes to 7 bits', () => {
    expect(noteOn(0, 107, 1)).toEqual([0x90, 107, 1]);
  });
});
