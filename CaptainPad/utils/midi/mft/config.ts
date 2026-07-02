// MIDI Fighter Twister SysEx configuration push — ported from pymft's
// `src/encoder.py` (`Encoder.send`) and `src/config.py`
// (`Config.initialize_defaults`).
//
// Pure byte math: builders return `number[][]` (arrays of complete sysex
// frames). No transport, no state. The chunking loop mirrors pymft's
// `Encoder.send` EXACTLY so the emitted frames are byte-for-byte diffable
// against the Python library.
//
// KEY DEVIATION from pymft's default config: `buildConnectConfig` forces every
// encoder into RELATIVE mode (MIDITYPE_SENDRELENC) rather than absolute CC.
// See docs/34_captainpad_midi.md § "Why RELATIVE encoders".

import {
  MIDI_MFR_ID,
  PART_SIZE_BYTES,
  SysExCommands,
  EncoderSettingAddress,
  EncoderSettingName,
  Encoders,
  EncoderSettings,
  ColorValues,
  SysExValues,
} from './constants';

const SYSEX_START = 0xf0;
const SYSEX_END = 0xf7;

/**
 * A per-encoder settings map: setting name -> value. Only the keys present are
 * emitted (mirrors pymft skipping `None` settings), and they are emitted in the
 * canonical `EncoderSettingAddress` order, NOT object-insertion order.
 */
export type EncoderConfigSettings = Partial<Record<EncoderSettingName, number>>;

/**
 * Build the BULK_XFER sysex frames that push one encoder's settings to the MFT.
 *
 * Mirrors `Encoder.send`: build a flat [address, value, address, value, ...]
 * list (canonical order, skipping absent settings), then chunk it into parts
 * of at most PART_SIZE_BYTES bytes. Each frame is:
 *   [0xF0, mfr0, mfr1, mfr2, BULK_XFER, 0x00, tag, part, totalParts, size,
 *    ...payload, 0xF7]
 * where tag = encoderIndex + 1 and part is 1-based.
 *
 * Returns [] when the settings map is empty (no frames to send).
 */
export function buildEncoderConfigFrames(
  encoderIndex: number,
  settings: EncoderConfigSettings,
): number[][] {
  if (!Number.isInteger(encoderIndex) || encoderIndex < 0 || encoderIndex >= Encoders.DEVICE_KNOB_NUM) {
    throw new RangeError(
      `Invalid encoder index ${encoderIndex}. Valid range is 0-${Encoders.DEVICE_KNOB_NUM - 1}.`,
    );
  }

  const tag = encoderIndex + 1;

  // Flatten to address/value pairs in the canonical sysex order.
  let configData: number[] = [];
  const names = Object.keys(EncoderSettingAddress) as EncoderSettingName[];
  for (const name of names) {
    const value = settings[name];
    if (value !== undefined) {
      configData.push(EncoderSettingAddress[name], value);
    }
  }

  const frames: number[][] = [];
  if (configData.length === 0) return frames;

  let bytesRemaining = configData.length;
  const totalParts = Math.floor((bytesRemaining + PART_SIZE_BYTES - 1) / PART_SIZE_BYTES);
  for (let part = 1; part <= totalParts; part += 1) {
    const size = bytesRemaining <= PART_SIZE_BYTES ? bytesRemaining : PART_SIZE_BYTES;
    bytesRemaining -= PART_SIZE_BYTES;

    const payload = configData.slice(0, size);
    const frame = [
      SYSEX_START,
      ...MIDI_MFR_ID,
      SysExCommands.BULK_XFER,
      0x00,
      tag,
      part,
      totalParts,
      size,
      ...payload,
      SYSEX_END,
    ];
    configData = configData.slice(size);
    frames.push(frame);
  }

  return frames;
}

/**
 * Per-bank base colours for the connect config. Inactive is always blue; the
 * active colour identifies the bank: bank1 pink, bank2 yellow, bank3 red,
 * bank4 blue.
 */
function bankColors(bank: number): { active: number; inactive: number } {
  const inactive = ColorValues.BLUE;
  switch (bank) {
    case 0:
      return { active: ColorValues.PINK, inactive };
    case 1:
      return { active: ColorValues.YELLOW, inactive };
    case 2:
      return { active: ColorValues.RED, inactive };
    case 3:
      return { active: ColorValues.BLUE, inactive };
    default:
      throw new RangeError(`Invalid bank ${bank}`);
  }
}

/**
 * Build the full connect-time config: all 64 encoders forced into RELATIVE
 * mode with the rig's layout. Returns a flat list of sysex frames (all encoder
 * BULK_XFER frames, encoder 0 first) ready to send once on connect.
 *
 * Field set + addresses follow `Config.initialize_defaults`; the values encode
 * this port's deviations (relative encoder type, velocity-sensitive movement,
 * switch CC-hold on channel 1, blended-bar indicator, detent off, per-bank
 * base colours).
 */
export function buildConnectConfig(): number[][] {
  const frames: number[][] = [];
  for (let bank = 0; bank < Encoders.DEVICE_BANK_NUM; bank += 1) {
    const { active, inactive } = bankColors(bank);
    for (let bankKnob = 0; bankKnob < Encoders.DEVICE_KNOB_PER_BANK; bankKnob += 1) {
      const i = bankKnob + Encoders.DEVICE_KNOB_PER_BANK * bank;
      const settings: EncoderConfigSettings = {
        detent: SysExValues.FALSE,
        movement_type: EncoderSettings.MOVEMENTTYPE_VELOCITYSENSITIVE,
        switch_action_type: EncoderSettings.SWACTION_CCHOLD,
        switch_midi_channel: 1, // switch on channel 1, CC-hold
        switch_midi_number: i,
        switch_midi_type: 0,
        encoder_midi_channel: 1,
        encoder_midi_number: i,
        encoder_midi_type: EncoderSettings.MIDITYPE_SENDRELENC, // RELATIVE
        active_color: active,
        inactive_color: inactive,
        detent_color: ColorValues.PINK,
        indicator_display_type: EncoderSettings.INDICATORTYPE_BLENDEDBAR,
        is_super_knob: SysExValues.FALSE,
        encoder_shift_midi_channel: 0,
      };
      frames.push(...buildEncoderConfigFrames(i, settings));
    }
  }
  return frames;
}
