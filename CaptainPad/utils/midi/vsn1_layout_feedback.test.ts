import { describe, expect, it } from 'vitest';

import {
  isVsn1LayoutAck,
  projectVsn1Layout,
  vsn1LayoutRgb,
  VSN1_LAYOUT_ACK_CC,
  VSN1_LAYOUT_BEHAVIOR_BASE_CC,
  VSN1_LAYOUT_COLOR_CH,
  VSN1_LAYOUT_COMMIT_CC,
  VSN1_LAYOUT_MAX_MODES,
  VSN1_LAYOUT_MODE_CH,
  VSN1_LAYOUT_MODE_COUNT_BASE_CC,
  VSN1_LAYOUT_NAME_CH,
  VSN1_LAYOUT_NAME_LEN,
} from './vsn1_layout_feedback';

function cc(channel: number, controller: number, value: number): number[] {
  return [0xb0 | channel, controller, value];
}

describe('VSN1 runtime layout feedback', () => {
  it('encodes names, colors, behavior, modes, and an atomic commit', () => {
    const projected = projectVsn1Layout(0, [{
      slot: 1,
      effectId: 'colorWash',
      label: 'Ocean Wash',
      color: [255, 64, 0],
      behavior: 'toggle',
      modeValues: ['tint', 'replace', 'multiply', 'max', 'extra', 'ignored'],
    }]);

    const nameBytes = projected.messages
      .filter((message) => (
        message[0] === (0xb0 | VSN1_LAYOUT_NAME_CH)
        && message[1] < VSN1_LAYOUT_NAME_LEN
      ))
      .map((message) => message[2]);
    expect(String.fromCharCode(...nameBytes)).toBe('Ocean Wash');

    expect(projected.messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 0, 127));
    expect(projected.messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 1, 32));
    expect(projected.messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 2, 0));
    expect(projected.messages).toContainEqual(
      cc(VSN1_LAYOUT_COLOR_CH, VSN1_LAYOUT_BEHAVIOR_BASE_CC, 1),
    );
    expect(projected.messages).toContainEqual(
      cc(VSN1_LAYOUT_MODE_CH, VSN1_LAYOUT_MODE_COUNT_BASE_CC, VSN1_LAYOUT_MAX_MODES),
    );
    expect(projected.messages.at(-1)?.slice(0, 2)).toEqual([
      0xb0 | VSN1_LAYOUT_COLOR_CH,
      VSN1_LAYOUT_COMMIT_CC,
    ]);
  });

  it('uses the key palette for populated colorless slots and grey for empty slots', () => {
    const { messages } = projectVsn1Layout(0, [
      { slot: 1, effectId: 'strobe', label: 'Strobe', color: null, behavior: 'toggle' },
    ]);
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 0, 127));
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 1, 20));
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 2, 20));
    // Slot 2 is empty: RGB 30 becomes MIDI 15.
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 3, 15));
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 4, 15));
    expect(messages).toContainEqual(cc(VSN1_LAYOUT_COLOR_CH, 5, 15));
  });

  it('shares Grid’s exact quantized slot colors with the CaptainPad UI', () => {
    expect(vsn1LayoutRgb(1, [255, 41, 9])).toEqual([254, 42, 10]);
    expect(vsn1LayoutRgb(2, null)).toEqual([254, 140, 0]);
    expect(vsn1LayoutRgb(9, null)).toEqual(vsn1LayoutRgb(1, null));
    expect(vsn1LayoutRgb(1, [255, 0, 0], false)).toEqual([30, 30, 30]);
  });

  it('selects the requested page and changes signature only for layout fields', () => {
    const slots = [
      { slot: 1, effectId: 'wrong-page', label: 'Wrong' },
      { slot: 9, effectId: 'freeze', label: 'Freeze', behavior: 'trigger' },
    ];
    const pageOne = projectVsn1Layout(1, slots);
    const runtimeOnly = projectVsn1Layout(1, slots.map((slot) => ({ ...slot, active: true })));
    const renamed = projectVsn1Layout(1, [
      slots[0],
      { ...slots[1], label: 'Ice' },
    ]);
    const nameBytes = pageOne.messages
      .filter((message) => message[0] === (0xb0 | VSN1_LAYOUT_NAME_CH) && message[1] < 10)
      .map((message) => message[2]);

    expect(String.fromCharCode(...nameBytes)).toBe('Freeze    ');
    expect(runtimeOnly.signature).toBe(pageOne.signature);
    expect(renamed.signature).not.toBe(pageOne.signature);
  });

  it('emits only valid three-byte MIDI channel messages', () => {
    const { messages } = projectVsn1Layout(0, []);
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).toHaveLength(3);
      expect(message.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)).toBe(true);
      expect(message[1]).toBeLessThanOrEqual(127);
      expect(message[2]).toBeLessThanOrEqual(127);
    }
  });

  it('accepts only the matching device layout acknowledgment revision', () => {
    expect(isVsn1LayoutAck(0xb0, VSN1_LAYOUT_ACK_CC, 42, 42)).toBe(true);
    expect(isVsn1LayoutAck(0xb3, VSN1_LAYOUT_ACK_CC, 42, 42)).toBe(true);
    expect(isVsn1LayoutAck(0xb0, VSN1_LAYOUT_ACK_CC, 41, 42)).toBe(false);
    expect(isVsn1LayoutAck(0x90, VSN1_LAYOUT_ACK_CC, 42, 42)).toBe(false);
    expect(isVsn1LayoutAck(0xb0, VSN1_LAYOUT_ACK_CC, 42, null)).toBe(false);
  });
});
