// MIDI Fighter Twister send/decode paths — ported from pymft's `src/pymft.py`
// (the `_send_control_change` builders and `_handle_midi_message` decode path).
//
// Pure byte math, matching the house style of utils/midi/midi_message.ts:
// builders return `number[]` 3-byte Control Change messages; decoders take a
// DecodedMidi and return a typed event or null (never guess — fail loudly per
// codex P0). Invalid encoder / bank indices in the BUILDERS throw.
//
// MFT channels are the RAW 0-indexed status-byte nibbles (`status & 0xF`),
// exactly as pymft reads them — decoders compare against those raw channels.

import { DecodedMidi } from '../midi_message';
import {
  EncoderControl,
  Encoders,
  MidiChannels,
  SystemMessages,
  BankCCs,
} from './constants';

const CC_STATUS = 0xb0;

/** Build a Control Change message on the given raw MFT channel. */
function controlChange(channel: number, cc: number, value: number): number[] {
  return [(CC_STATUS | (channel & 0x0f)) & 0xff, cc & 0x7f, value & 0x7f];
}

function assertEncoder(encoder: number): void {
  if (!Number.isInteger(encoder) || encoder < 0 || encoder >= Encoders.DEVICE_KNOB_NUM) {
    throw new RangeError(
      `Invalid encoder index ${encoder}. Valid range is 0-${Encoders.DEVICE_KNOB_NUM - 1}.`,
    );
  }
}

function assertMidiValue(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new RangeError(`Invalid ${label} ${value}. Valid range is 0-127.`);
  }
}

// ── Builders ───────────────────────────────────────────────────────────────

/** Set an encoder's ring/indicator value (0-127) — CC on the rotary channel. */
export function setRingValue(encoder: number, value: number): number[] {
  assertEncoder(encoder);
  assertMidiValue(value, 'ring value');
  return controlChange(MidiChannels.ROTARY_ENCODER, encoder, value);
}

/** Set an encoder's LED colour (colour-wheel value) — CC on the colour channel. */
export function setColor(encoder: number, wheelValue: number): number[] {
  assertEncoder(encoder);
  assertMidiValue(wheelValue, 'colour value');
  return controlChange(MidiChannels.SWITCH_AND_COLOR, encoder, wheelValue);
}

/** Set an encoder's animation — CC on the animation/brightness channel. */
export function setAnimation(encoder: number, animValue: number): number[] {
  assertEncoder(encoder);
  assertMidiValue(animValue, 'animation value');
  return controlChange(MidiChannels.ANIMATIONS_AND_BRIGHTNESS, encoder, animValue);
}

// ── Decoders ───────────────────────────────────────────────────────────────

/**
 * Map a relative-encoder CC value to a signed step:
 *   61 -> -3, 62 -> -2, 63 -> -1, 65 -> +1, 66 -> +2, 67 -> +3.
 * Any other value (including 64 = no movement) returns null.
 */
export function decodeRelativeDelta(value: number): number | null {
  switch (value) {
    case EncoderControl.KNOB_DECREMENT_VERYFAST:
      return -3;
    case EncoderControl.KNOB_DECREMENT_FAST:
      return -2;
    case EncoderControl.KNOB_DECREMENT:
      return -1;
    case EncoderControl.KNOB_INCREMENT:
      return 1;
    case EncoderControl.KNOB_INCREMENT_FAST:
      return 2;
    case EncoderControl.KNOB_INCREMENT_VERYFAST:
      return 3;
    default:
      return null;
  }
}

/**
 * Decode a system-channel bank change (CC 0-3, value 127). Returns the bank
 * index 0..3, or null off-channel / for a non-bank CC / for value != 127.
 */
export function decodeBankChange(ev: DecodedMidi): number | null {
  if (ev.type !== 'cc' || ev.channel !== MidiChannels.SYSTEM) return null;
  if (ev.value !== SystemMessages.BANK_ON) return null;
  const bank = BankCCs.indexOf(ev.cc as (typeof BankCCs)[number]);
  return bank === -1 ? null : bank;
}
