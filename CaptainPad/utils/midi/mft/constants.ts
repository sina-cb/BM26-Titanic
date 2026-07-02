// MIDI Fighter Twister (MFT) protocol constants — a straight transliteration
// of pymft's `src/constants.py` (https://github.com/sina-cb/pymft). Names are
// kept identical to pymft so the two libraries stay diffable side-by-side.
//
// Pure data only — no transport, no state. Everything is an `as const` object
// (NOT a TS `enum`) to match the house style of utils/midi/*.ts.
//
// The MFT is a 4x4 grid of endless RGB-ring encoders with 4 virtual banks
// (64 encoder slots total), 6 side buttons, per-encoder push switches, and
// full 2-way LED feedback. Message routing is by MIDI channel (see
// MidiChannels); the channel numbers below are the RAW 0-indexed values that
// appear in the status byte (`channel = status & 0xF`), exactly as pymft's
// `_handle_midi_message` reads them.

// ── General constants ──────────────────────────────────────────────────────
export const DEVICE_NAME = 'Midi Fighter Twister';

/** Maximum size of a single SysEx bulk-transfer part, in bytes. */
export const PART_SIZE_BYTES = 24;

// ── DJTT SysEx manufacturer id ─────────────────────────────────────────────
export const MIDI_MFR_ID_0 = 0x00;
export const MIDI_MFR_ID_1 = 0x01;
export const MIDI_MFR_ID_2 = 0x79;

/** DJTT manufacturer id as a 3-byte tuple, for splicing into sysex frames. */
export const MIDI_MFR_ID = [MIDI_MFR_ID_0, MIDI_MFR_ID_1, MIDI_MFR_ID_2] as const;

// ── MIDI channels (raw 0-indexed status-byte nibbles) ──────────────────────
export const MidiChannels = {
  ROTARY_ENCODER: 0, // knob twists
  SWITCH_AND_COLOR: 1, // encoder push switch + LED colour
  ANIMATIONS_AND_BRIGHTNESS: 2, // encoder animations + brightness
  SYSTEM: 3, // bank changes + side-button actions
  SHIFT: 4, // shift encoder messages
  SWITCH_ANIMATION: 5, // switch animation messages
  SEQUENCER: 7, // sequencer messages
} as const;

// ── Relative-encoder delta codes (rotary channel CC values) ────────────────
// The MFT in relative mode sends these fixed CC values per detent tick; the
// sign + magnitude encode direction and speed. 64 would be "no movement".
export const EncoderControl = {
  KNOB_DECREMENT_VERYFAST: 61, // CCW very fast  (-3)
  KNOB_DECREMENT_FAST: 62, // CCW fast          (-2)
  KNOB_DECREMENT: 63, // CCW normal              (-1)
  KNOB_INCREMENT: 65, // CW normal               (+1)
  KNOB_INCREMENT_FAST: 66, // CW fast            (+2)
  KNOB_INCREMENT_VERYFAST: 67, // CW very fast   (+3)
} as const;

// ── System messages (bank changes + side buttons, on the SYSTEM channel) ───
export const SystemMessages = {
  BANK_OFF: 0, // value to turn a bank off
  BANK_ON: 127, // value to turn a bank on

  // Bank-select CC numbers.
  BANK1: 0,
  BANK2: 1,
  BANK3: 2,
  BANK4: 3,

  // Side-button CC numbers — six per bank (3 left, 3 right).
  BANK1_LEFT1: 8,
  BANK1_LEFT2: 9,
  BANK1_LEFT3: 10,
  BANK1_RIGHT1: 11,
  BANK1_RIGHT2: 12,
  BANK1_RIGHT3: 13,

  BANK2_LEFT1: 14,
  BANK2_LEFT2: 15,
  BANK2_LEFT3: 16,
  BANK2_RIGHT1: 17,
  BANK2_RIGHT2: 18,
  BANK2_RIGHT3: 19,

  BANK3_LEFT1: 20,
  BANK3_LEFT2: 21,
  BANK3_LEFT3: 22,
  BANK3_RIGHT1: 23,
  BANK3_RIGHT2: 24,
  BANK3_RIGHT3: 25,

  BANK4_LEFT1: 26,
  BANK4_LEFT2: 27,
  BANK4_LEFT3: 28,
  BANK4_RIGHT1: 29,
  BANK4_RIGHT2: 30,
  BANK4_RIGHT3: 31,
} as const;

/** Structured view of the bank-select CCs (CC 0-3). */
export const BankCCs = [
  SystemMessages.BANK1,
  SystemMessages.BANK2,
  SystemMessages.BANK3,
  SystemMessages.BANK4,
] as const;

/**
 * Structured view of the side-button CCs (CC 8-31): six buttons per bank
 * (left 1-3, right 1-3) laid out contiguously. Derived arithmetically so the
 * layout is obvious: `firstCc = 8 + bank * 6`.
 */
export const SIDE_BUTTON_CC_MIN = 8;
export const SIDE_BUTTON_CC_MAX = 31;
export const SIDE_BUTTONS_PER_BANK = 6;

export type SideButtonSide = 'left' | 'right';

export interface SideButtonDef {
  cc: number;
  bank: number; // 0..3
  side: SideButtonSide;
  index: number; // 0..2 within the side column
}

/** All 24 side buttons (4 banks x 6), keyed by CC. */
export const SideButtons: readonly SideButtonDef[] = Array.from(
  { length: 4 * SIDE_BUTTONS_PER_BANK },
  (_unused, offset) => {
    const bank = Math.floor(offset / SIDE_BUTTONS_PER_BANK);
    const within = offset % SIDE_BUTTONS_PER_BANK; // 0..5
    const side: SideButtonSide = within < 3 ? 'left' : 'right';
    const index = within % 3; // 0..2
    return { cc: SIDE_BUTTON_CC_MIN + offset, bank, side, index };
  },
);

// ── Colour wheel values (LED colours, on the SWITCH_AND_COLOR channel) ──────
export const ColorValues = {
  INACTIVE: 0, // typically blue / off
  ACTIVE: 127, // typically red / full

  BLUE: 1,
  GREEN: 50,
  YELLOW: 64,
  RED: 80,
  PINK: 100,
} as const;

// ── Detent colour values ───────────────────────────────────────────────────
export const DetentColorValues = {
  RED: 0,
  PINK: 63,
  BLUE: 127,
} as const;

// ── Animation values (on the ANIMATIONS_AND_BRIGHTNESS channel) ─────────────
export const AnimationValues = {
  NONE: 0,

  // RGB strobe animations
  RGB_TOGGLE_8_BEATS: 1,
  RGB_TOGGLE_4_BEATS: 2,
  RGB_TOGGLE_2_BEATS: 3,
  RGB_TOGGLE_1_BEAT: 4,
  RGB_TOGGLE_HALF_BEAT: 5,
  RGB_TOGGLE_QUARTER_BEAT: 6,
  RGB_TOGGLE_EIGHTH_BEAT: 7,
  RGB_TOGGLE_SIXTEENTH_BEAT: 8,

  // RGB pulse animations
  RGB_PULSE_8_BEATS: 10,
  RGB_PULSE_4_BEATS: 11,
  RGB_PULSE_2_BEATS: 12,
  RGB_PULSE_1_BEAT: 13,
  RGB_PULSE_HALF_BEAT: 14,
  RGB_PULSE_QUARTER_BEAT: 15,
  RGB_PULSE_EIGHTH_BEAT: 16,

  // RGB brightness values
  RGB_BRIGHTNESS_OFF: 17,
  RGB_BRIGHTNESS_MID: 32,
  RGB_BRIGHTNESS_MAX: 47,

  // Indicator strobe animations
  INDICATOR_TOGGLE_8_BEATS: 49,
  INDICATOR_TOGGLE_4_BEATS: 50,
  INDICATOR_TOGGLE_2_BEATS: 51,
  INDICATOR_TOGGLE_1_BEAT: 52,
  INDICATOR_TOGGLE_HALF_BEAT: 53,
  INDICATOR_TOGGLE_QUARTER_BEAT: 54,
  INDICATOR_TOGGLE_EIGHTH_BEAT: 55,
  INDICATOR_TOGGLE_SIXTEENTH_BEAT: 56,

  // Indicator pulse animations
  INDICATOR_PULSE_8_BEATS: 57,
  INDICATOR_PULSE_4_BEATS: 58,
  INDICATOR_PULSE_2_BEATS: 59,
  INDICATOR_PULSE_1_BEAT: 60,
  INDICATOR_PULSE_HALF_BEAT: 61,
  INDICATOR_PULSE_QUARTER_BEAT: 62,
  INDICATOR_PULSE_EIGHTH_BEAT: 63,
  INDICATOR_PULSE_SIXTEENTH_BEAT: 64,

  // Indicator brightness values
  INDICATOR_BRIGHTNESS_OFF: 65,
  INDICATOR_BRIGHTNESS_25: 72,
  INDICATOR_BRIGHTNESS_MID: 80,
  INDICATOR_BRIGHTNESS_MAX: 95,

  // Rainbow cycle
  RAINBOW_CYCLE: 127,
} as const;

// ── Encoder settings enums ─────────────────────────────────────────────────
export const EncoderSettings = {
  // Control type (reserved / future use)
  CONTROLTYPE_ENCODER: 0x00,
  CONTROLTYPE_SWITCH: 0x01,
  CONTROLTYPE_SHIFT: 0x02,

  // Movement type
  MOVEMENTTYPE_DIRECT_HIGHRESOLUTION: 0x00,
  MOVEMENTTYPE_RESPONSIVE: 0x01,
  MOVEMENTTYPE_VELOCITYSENSITIVE: 0x02,

  // Switch action type
  SWACTION_CCHOLD: 0x00,
  SWACTION_CCTOGGLE: 0x01,
  SWACTION_NOTEHOLD: 0x02,
  SWACTION_NOTETOGGLE: 0x03,
  SWACTION_ENCRESETVALUE: 0x04,
  SWACTION_ENCFINEADJUST: 0x05,
  SWACTION_SHIFTHOLD: 0x06,
  SWACTION_SHIFTTOGGLE: 0x07,

  // MIDI message type
  MIDITYPE_SENDNOTE: 0x00,
  MIDITYPE_SENDCC: 0x01,
  MIDITYPE_SENDRELENC: 0x02, // relative CC — the mode this port forces on
  MIDITYPE_SENDNOTEOFF: 0x03,
  MIDITYPE_SENDSWITCHVELCONTROL: 0x03, // not currently used
  MIDITYPE_SENDRELENCMOUSEEMUDRAG: 0x04, // not currently used
  MIDITYPE_SENDRELENCMOUSEEMUSCROLL: 0x05, // not currently used

  // Indicator display type
  INDICATORTYPE_DOT: 0x00,
  INDICATORTYPE_BAR: 0x01,
  INDICATORTYPE_BLENDEDBAR: 0x02,
  INDICATORTYPE_BLENDEDDOT: 0x03,
} as const;

// ── SysEx commands ─────────────────────────────────────────────────────────
export const SysExCommands = {
  PUSH_CONF: 0x01, // push global config to the MFT
  PULL_CONF: 0x02, // pull config from the MFT
  SYSTEM: 0x03, // system-related sysex
  BULK_XFER: 0x04, // bulk transfer of per-encoder settings
} as const;

// ── SysEx boolean values ───────────────────────────────────────────────────
export const SysExValues = {
  FALSE: 0x00,
  TRUE: 0x01,
} as const;

// ── Global side-switch actions ─────────────────────────────────────────────
export const GlobalSideSwitchAction = {
  CCHOLD: 0x00,
  CCTOGGLE: 0x01,
  NOTEHOLD: 0x02,
  NOTETOGGLE: 0x03,
  SHIFTPAGE1: 0x04,
  SHIFTPAGE2: 0x05,
  BANKUP: 0x06,
  BANKDOWN: 0x07,
  BANK1: 0x08,
  BANK2: 0x09,
  BANK3: 0x0a,
  BANK4: 0x0b,
  CYCLE_BANK: 0x0c,
} as const;

// ── Encoder counts ─────────────────────────────────────────────────────────
export const Encoders = {
  DEVICE_KNOB_PER_BANK: 16,
  DEVICE_KNOB_NUM: 64,
  DEVICE_BANK_NUM: 4,
} as const;

// ── Per-encoder sysex setting addresses ────────────────────────────────────
// Address of each encoder setting inside a BULK_XFER frame's address/value
// pair list. Insertion order MATTERS: `buildEncoderConfigFrames` iterates this
// object in order, exactly like pymft's `Encoder._SETTING_ADDRESSES`.
export const EncoderSettingAddress = {
  detent: 10,
  movement_type: 11,
  switch_action_type: 12,
  switch_midi_channel: 13,
  switch_midi_number: 14,
  switch_midi_type: 15,
  encoder_midi_channel: 16,
  encoder_midi_number: 17,
  encoder_midi_type: 18,
  active_color: 19,
  inactive_color: 20,
  detent_color: 21,
  indicator_display_type: 22,
  is_super_knob: 23,
  encoder_shift_midi_channel: 24,
} as const;

/** Names of the per-encoder settings, in the canonical sysex order. */
export type EncoderSettingName = keyof typeof EncoderSettingAddress;
