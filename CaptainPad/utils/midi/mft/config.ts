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
  DeviceConfigDefaults,
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
 * Per-ENCODER rest colour for the connect config (MFT UX v2 layout, bank 1
 * only; banks 2-4 are reserved):
 *   - encoders 0-1 (row 0 globals: speed, hue) → RED at rest
 *   - everything else → BLUE — the MFT's dim "inactive" look. That covers the
 *     unassigned row-0 knobs (2, 3), the 12 local-param knobs at rest (4-15),
 *     and ALL of banks 2-4 (16-63): per Sina, unmapped knobs sit dim blue
 *     (the stock inactive state), never fully dark.
 * The runtime LED projector overrides mapped knobs with explicit colour-wheel
 * writes (sync green, hue tracking, focus identity); colour code 0 (INACTIVE)
 * falls back to this configured inactive colour.
 */
export function encoderRestColor(encoder: number): number {
  if (encoder === 0 || encoder === 1) return ColorValues.RED;
  return ColorValues.BLUE;
}

/**
 * Build the global config commit frame — the `PUSH_CONF` sysex that carries the
 * device-wide settings (system MIDI channel, side-button actions incl.
 * BANKUP/BANKDOWN, super-knob range, default colours, brightness). Mirrors
 * pymft's `Config._send_global`:
 *   [0xF0, mfr0, mfr1, mfr2, PUSH_CONF, addr, val, addr, val, ..., 0xF7]
 * iterating `DeviceConfigDefaults` (pymft's `DeviceSettings._settings`) in
 * order. Byte-for-byte diffable against pymft's default global config.
 */
export function buildGlobalConfigFrame(): number[] {
  const frame = [SYSEX_START, ...MIDI_MFR_ID, SysExCommands.PUSH_CONF];
  for (const [address, value] of DeviceConfigDefaults) {
    frame.push(address, value);
  }
  frame.push(SYSEX_END);
  return frame;
}

/**
 * Build the full connect-time config: all 64 encoders forced into RELATIVE
 * mode with the rig's layout, THEN the global `PUSH_CONF` commit frame.
 * Returns a flat list of sysex frames (every encoder BULK_XFER frame first,
 * encoder 0 leading, then the single global frame last) ready to send once on
 * connect — mirroring pymft's `Config.send_all` (`_send_encoders(force_all)`
 * then `_send_global()`). The global frame is REQUIRED: without it the
 * per-encoder pushes are never committed device-wide and the side-button
 * BANKUP/BANKDOWN wiring (docs/34) is never applied.
 *
 * Field set + addresses follow `Config.initialize_defaults`; the per-encoder
 * values encode this port's deviations (relative encoder type,
 * velocity-sensitive movement — kept DELIBERATELY: its ±1/±2/±3 codes are
 * relative COUNT offsets the host maps linearly, so at speed the firmware just
 * packs multiple detents per message; the whole feel curve is host-side in
 * accel.ts. MOVEMENTTYPE_DIRECT_HIGHRESOLUTION would change tick density per
 * detent in ways unverifiable without hardware in hand — switch CC-hold on
 * the switch channel, blended-bar indicator, detent off, per-encoder rest
 * colours via encoderRestColor).
 */
export function buildConnectConfig(): number[][] {
  const frames: number[][] = [];
  for (let bank = 0; bank < Encoders.DEVICE_BANK_NUM; bank += 1) {
    for (let bankKnob = 0; bankKnob < Encoders.DEVICE_KNOB_PER_BANK; bankKnob += 1) {
      const i = bankKnob + Encoders.DEVICE_KNOB_PER_BANK * bank;
      // Rest colour per encoder (v2 layout). active == inactive so a held
      // switch press doesn't flash a foreign colour — the runtime projector
      // owns every meaningful colour change.
      const rest = encoderRestColor(i);
      const settings: EncoderConfigSettings = {
        detent: SysExValues.FALSE,
        movement_type: EncoderSettings.MOVEMENTTYPE_VELOCITYSENSITIVE,
        switch_action_type: EncoderSettings.SWACTION_CCHOLD,
        // `switch_midi_channel` is the 1-BASED sysex channel field (pymft
        // config.py sets encoder_midi_channel=1 → raw ch0, switch_midi_channel=2
        // → raw ch1). Value 2 puts the push switch on the runtime
        // SWITCH_AND_COLOR channel (raw ch1), where decodeEncoderPush / setColor
        // live — matching docs/34 "switch = CC-hold on ch1". Value 1 (the old
        // bug) would collide the push onto the rotary channel (raw ch0).
        switch_midi_channel: 2,
        switch_midi_number: i,
        switch_midi_type: 0,
        encoder_midi_channel: 1, // 1-based → raw ch0 (rotary/turn channel)
        encoder_midi_number: i,
        encoder_midi_type: EncoderSettings.MIDITYPE_SENDRELENC, // RELATIVE
        active_color: rest,
        inactive_color: rest,
        detent_color: ColorValues.PINK,
        indicator_display_type: EncoderSettings.INDICATORTYPE_BLENDEDBAR,
        is_super_knob: SysExValues.FALSE,
        encoder_shift_midi_channel: 0,
      };
      frames.push(...buildEncoderConfigFrames(i, settings));
    }
  }
  // Commit the whole push with the global PUSH_CONF frame — pymft send_all()
  // order: encoders first, global last.
  frames.push(buildGlobalConfigFrame());
  return frames;
}
