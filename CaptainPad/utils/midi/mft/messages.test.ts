import { describe, it, expect } from 'vitest';
import { decodeMidi } from '../midi_message';
import {
  setRingValue,
  setColor,
  setAnimation,
  decodeRelativeDelta,
  decodeBankChange,
} from './messages';

describe('mft builders', () => {
  it('setRingValue → CC on rotary channel (0xB0)', () => {
    expect(setRingValue(5, 64)).toEqual([0xb0, 5, 64]);
    expect(setRingValue(0, 0)).toEqual([0xb0, 0, 0]);
    expect(setRingValue(63, 127)).toEqual([0xb0, 63, 127]);
  });

  it('setColor → CC on switch+colour channel (0xB1)', () => {
    expect(setColor(2, 100)).toEqual([0xb1, 2, 100]);
  });

  it('setAnimation → CC on animation channel (0xB2)', () => {
    expect(setAnimation(9, 47)).toEqual([0xb2, 9, 47]);
  });

  it('throws on out-of-range encoder / value', () => {
    expect(() => setRingValue(64, 0)).toThrow(RangeError);
    expect(() => setRingValue(-1, 0)).toThrow(RangeError);
    expect(() => setColor(0, 128)).toThrow(RangeError);
  });
});

describe('decodeRelativeDelta', () => {
  it('maps all six relative codes to signed steps', () => {
    expect(decodeRelativeDelta(61)).toBe(-3);
    expect(decodeRelativeDelta(62)).toBe(-2);
    expect(decodeRelativeDelta(63)).toBe(-1);
    expect(decodeRelativeDelta(65)).toBe(1);
    expect(decodeRelativeDelta(66)).toBe(2);
    expect(decodeRelativeDelta(67)).toBe(3);
  });

  it('returns null for 64 (no movement) and any other value', () => {
    expect(decodeRelativeDelta(64)).toBeNull();
    expect(decodeRelativeDelta(0)).toBeNull();
    expect(decodeRelativeDelta(127)).toBeNull();
    expect(decodeRelativeDelta(60)).toBeNull();
    expect(decodeRelativeDelta(68)).toBeNull();
  });
});

describe('decodeBankChange', () => {
  it('decodes system-channel CC 0-3 value 127 into a bank index', () => {
    expect(decodeBankChange(decodeMidi([0xb3, 0, 127]))).toBe(0);
    expect(decodeBankChange(decodeMidi([0xb3, 3, 127]))).toBe(3);
  });

  it('returns null off-channel, for value != 127, or for a non-bank CC', () => {
    expect(decodeBankChange(decodeMidi([0xb3, 0, 0]))).toBeNull(); // bank off
    expect(decodeBankChange(decodeMidi([0xb3, 4, 127]))).toBeNull(); // CC 4 is not a bank
    expect(decodeBankChange(decodeMidi([0xb0, 0, 127]))).toBeNull(); // wrong channel
    expect(decodeBankChange(decodeMidi([0xb3, 8, 127]))).toBeNull(); // side button, not bank
  });
});
