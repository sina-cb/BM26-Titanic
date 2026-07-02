import { describe, it, expect } from 'vitest';
import {
  DEVICE_NAME,
  PART_SIZE_BYTES,
  MIDI_MFR_ID,
  MidiChannels,
  EncoderControl,
  SystemMessages,
  BankCCs,
  SideButtons,
  SIDE_BUTTON_CC_MIN,
  SIDE_BUTTON_CC_MAX,
  ColorValues,
  AnimationValues,
  EncoderSettings,
  SysExCommands,
  Encoders,
  EncoderSettingAddress,
} from './constants';

describe('mft constants', () => {
  it('has the device name and DJTT manufacturer id', () => {
    expect(DEVICE_NAME).toBe('Midi Fighter Twister');
    expect(MIDI_MFR_ID).toEqual([0x00, 0x01, 0x79]);
    expect(PART_SIZE_BYTES).toBe(24);
  });

  it('maps the MFT channels', () => {
    expect(MidiChannels.ROTARY_ENCODER).toBe(0);
    expect(MidiChannels.SWITCH_AND_COLOR).toBe(1);
    expect(MidiChannels.ANIMATIONS_AND_BRIGHTNESS).toBe(2);
    expect(MidiChannels.SYSTEM).toBe(3);
    expect(MidiChannels.SHIFT).toBe(4);
    expect(MidiChannels.SWITCH_ANIMATION).toBe(5);
    expect(MidiChannels.SEQUENCER).toBe(7);
  });

  it('defines the relative delta codes', () => {
    expect(EncoderControl.KNOB_DECREMENT_VERYFAST).toBe(61);
    expect(EncoderControl.KNOB_DECREMENT_FAST).toBe(62);
    expect(EncoderControl.KNOB_DECREMENT).toBe(63);
    expect(EncoderControl.KNOB_INCREMENT).toBe(65);
    expect(EncoderControl.KNOB_INCREMENT_FAST).toBe(66);
    expect(EncoderControl.KNOB_INCREMENT_VERYFAST).toBe(67);
  });

  it('exposes the bank CCs 0-3', () => {
    expect(BankCCs).toEqual([0, 1, 2, 3]);
    expect(SystemMessages.BANK_ON).toBe(127);
    expect(SystemMessages.BANK_OFF).toBe(0);
  });

  it('lays out 24 side buttons (6 per bank, 3 left + 3 right) over CC 8-31', () => {
    expect(SideButtons).toHaveLength(24);
    expect(SIDE_BUTTON_CC_MIN).toBe(8);
    expect(SIDE_BUTTON_CC_MAX).toBe(31);
    // First bank, left column 1.
    expect(SideButtons[0]).toEqual({ cc: 8, bank: 0, side: 'left', index: 0 });
    // First bank, right column 1 (4th button of bank 0).
    expect(SideButtons[3]).toEqual({ cc: 11, bank: 0, side: 'right', index: 0 });
    // Last button: bank 3, right column 3.
    expect(SideButtons[23]).toEqual({ cc: 31, bank: 3, side: 'right', index: 2 });
    // CCs are contiguous 8..31.
    expect(SideButtons.map((b) => b.cc)).toEqual(
      Array.from({ length: 24 }, (_u, i) => 8 + i),
    );
    // Named constants agree with the derived table.
    expect(SystemMessages.BANK2_LEFT1).toBe(14);
    expect(SystemMessages.BANK4_RIGHT3).toBe(31);
  });

  it('defines the colour-wheel values', () => {
    expect(ColorValues.INACTIVE).toBe(0);
    expect(ColorValues.BLUE).toBe(1);
    expect(ColorValues.GREEN).toBe(50);
    expect(ColorValues.YELLOW).toBe(64);
    expect(ColorValues.RED).toBe(80);
    expect(ColorValues.PINK).toBe(100);
    expect(ColorValues.ACTIVE).toBe(127);
  });

  it('defines animation families incl. rainbow cycle', () => {
    expect(AnimationValues.NONE).toBe(0);
    expect(AnimationValues.RGB_TOGGLE_8_BEATS).toBe(1);
    expect(AnimationValues.RGB_PULSE_8_BEATS).toBe(10);
    expect(AnimationValues.RGB_BRIGHTNESS_MAX).toBe(47);
    expect(AnimationValues.INDICATOR_BRIGHTNESS_MAX).toBe(95);
    expect(AnimationValues.RAINBOW_CYCLE).toBe(127);
  });

  it('defines the encoder-settings enums', () => {
    expect(EncoderSettings.MOVEMENTTYPE_VELOCITYSENSITIVE).toBe(0x02);
    expect(EncoderSettings.SWACTION_CCHOLD).toBe(0x00);
    expect(EncoderSettings.MIDITYPE_SENDCC).toBe(0x01);
    expect(EncoderSettings.MIDITYPE_SENDRELENC).toBe(0x02);
    expect(EncoderSettings.INDICATORTYPE_BLENDEDBAR).toBe(0x02);
  });

  it('defines the SysEx commands', () => {
    expect(SysExCommands.PUSH_CONF).toBe(1);
    expect(SysExCommands.PULL_CONF).toBe(2);
    expect(SysExCommands.SYSTEM).toBe(3);
    expect(SysExCommands.BULK_XFER).toBe(4);
  });

  it('has the encoder counts', () => {
    expect(Encoders.DEVICE_KNOB_PER_BANK).toBe(16);
    expect(Encoders.DEVICE_KNOB_NUM).toBe(64);
    expect(Encoders.DEVICE_BANK_NUM).toBe(4);
  });

  it('maps the per-encoder sysex setting addresses in canonical order', () => {
    expect(EncoderSettingAddress.detent).toBe(10);
    expect(EncoderSettingAddress.encoder_shift_midi_channel).toBe(24);
    // Order 10..24 contiguous, matching pymft's _SETTING_ADDRESSES.
    expect(Object.values(EncoderSettingAddress)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });
});
