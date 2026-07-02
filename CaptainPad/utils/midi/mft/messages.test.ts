import { describe, it, expect } from 'vitest';
import { decodeMidi } from '../midi_message';
import {
  setRingValue,
  setColor,
  setAnimation,
  selectBank,
  decodeRelativeDelta,
  decodeEncoderTurn,
  decodeEncoderPush,
  decodeSideButton,
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

  it('selectBank → CC on system channel (0xB3) value 127', () => {
    expect(selectBank(0)).toEqual([0xb3, 0, 127]);
    expect(selectBank(3)).toEqual([0xb3, 3, 127]);
  });

  it('throws on out-of-range encoder / bank / value', () => {
    expect(() => setRingValue(64, 0)).toThrow(RangeError);
    expect(() => setRingValue(-1, 0)).toThrow(RangeError);
    expect(() => setColor(0, 128)).toThrow(RangeError);
    expect(() => selectBank(4)).toThrow(RangeError);
    expect(() => selectBank(-1)).toThrow(RangeError);
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

describe('decodeEncoderTurn', () => {
  it('decodes a rotary-channel CC into {encoder, delta}', () => {
    expect(decodeEncoderTurn(decodeMidi([0xb0, 7, 65]))).toEqual({ encoder: 7, delta: 1 });
    expect(decodeEncoderTurn(decodeMidi([0xb0, 15, 61]))).toEqual({ encoder: 15, delta: -3 });
  });

  it('returns null off-channel, for non-CC, or for a non-relative value', () => {
    expect(decodeEncoderTurn(decodeMidi([0xb1, 7, 65]))).toBeNull(); // colour channel
    expect(decodeEncoderTurn(decodeMidi([0x90, 7, 65]))).toBeNull(); // note
    expect(decodeEncoderTurn(decodeMidi([0xb0, 7, 64]))).toBeNull(); // no movement
  });
});

describe('decodeEncoderPush', () => {
  it('decodes a colour-channel CC into {encoder, pressed}', () => {
    expect(decodeEncoderPush(decodeMidi([0xb1, 3, 127]))).toEqual({ encoder: 3, pressed: true });
    expect(decodeEncoderPush(decodeMidi([0xb1, 3, 0]))).toEqual({ encoder: 3, pressed: false });
  });

  it('returns null off the switch+colour channel or for non-CC', () => {
    expect(decodeEncoderPush(decodeMidi([0xb0, 3, 127]))).toBeNull(); // rotary
    expect(decodeEncoderPush(decodeMidi([0x90, 3, 127]))).toBeNull(); // note
  });
});

describe('decodeSideButton', () => {
  it('decodes system-channel CC 8-31 into {bank, side, index}', () => {
    expect(decodeSideButton(decodeMidi([0xb3, 8, 127]))).toEqual({ bank: 0, side: 'left', index: 0 });
    expect(decodeSideButton(decodeMidi([0xb3, 11, 127]))).toEqual({ bank: 0, side: 'right', index: 0 });
    expect(decodeSideButton(decodeMidi([0xb3, 31, 127]))).toEqual({ bank: 3, side: 'right', index: 2 });
  });

  it('returns null off-channel or outside the side-button CC range', () => {
    expect(decodeSideButton(decodeMidi([0xb3, 0, 127]))).toBeNull(); // bank CC, not a side button
    expect(decodeSideButton(decodeMidi([0xb3, 7, 127]))).toBeNull(); // below range
    expect(decodeSideButton(decodeMidi([0xb3, 32, 127]))).toBeNull(); // above range
    expect(decodeSideButton(decodeMidi([0xb0, 8, 127]))).toBeNull(); // wrong channel
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
