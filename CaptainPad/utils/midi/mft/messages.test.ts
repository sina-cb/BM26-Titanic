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
  it('maps the original six named codes (binary-offset value − 64)', () => {
    // Parity with the old partial map — these must not regress.
    expect(decodeRelativeDelta(61)).toBe(-3);
    expect(decodeRelativeDelta(62)).toBe(-2);
    expect(decodeRelativeDelta(63)).toBe(-1);
    expect(decodeRelativeDelta(65)).toBe(1);
    expect(decodeRelativeDelta(66)).toBe(2);
    expect(decodeRelativeDelta(67)).toBe(3);
  });

  it('decodes the FULL fast-twist range (the dropped-fast-move fix)', () => {
    // The velocity-sensitive firmware emits LARGER offset codes on a fast twist;
    // the old switch returned null for these and DROPPED the movement. Now every
    // valid CC value decodes to its signed count `value − 64`.
    expect(decodeRelativeDelta(70)).toBe(6);
    expect(decodeRelativeDelta(55)).toBe(-9);
    expect(decodeRelativeDelta(127)).toBe(63); // hardest CW
    expect(decodeRelativeDelta(1)).toBe(-63); // hardest CCW
    expect(decodeRelativeDelta(0)).toBe(-64); // extreme edge is still a valid move
    expect(decodeRelativeDelta(68)).toBe(4);
    expect(decodeRelativeDelta(60)).toBe(-4);
  });

  it('returns null ONLY for 64 (genuine no-movement)', () => {
    expect(decodeRelativeDelta(64)).toBeNull();
  });

  it('throws on malformed MIDI (non-CC-byte), never silently drops', () => {
    // Fail-loud (codex P0): a value outside a legal 7-bit data byte is a real
    // protocol violation, not a movement to swallow.
    expect(() => decodeRelativeDelta(128)).toThrow(RangeError);
    expect(() => decodeRelativeDelta(-1)).toThrow(RangeError);
    expect(() => decodeRelativeDelta(1.5)).toThrow(RangeError);
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
