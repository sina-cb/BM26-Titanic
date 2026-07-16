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

/** The relative-encoder "no movement" CC value. In the MFT's binary-offset
 *  relative encoding the value is centred on 64: value − 64 is the signed
 *  detent count for this message, so 64 means zero movement. */
const RELATIVE_CENTER = 64;

/**
 * Decode a relative-encoder CC value to a SIGNED count over the FULL range —
 * never dropping a valid fast twist.
 *
 * THE TRUE FIRMWARE MODEL (verified against DJTT firmware encoders.c + a live
 * MIDI capture, 2026-07): the MFT (MOVEMENTTYPE_VELOCITYSENSITIVE + SENDRELENC,
 * see mft/config.ts) sends, per message,
 *
 *     value = 64 + ticks × mult
 *
 * where `mult` is the firmware's own velocity multiplier ramping 1 → 17 with
 * turn speed (encoders.c:744-777). The count is binary-offset around 64. The
 * host then maps it linearly (resolver.relativeStep) and applies a modest
 * per-tick velocity gain (accel.ts) — the operator-confirmed feel. Observed
 * hand ceiling in the live capture: exactly ±17 (value 81 / 47); decode the
 * whole 0..127 field anyway (defensive), with a SAFETY-only stray-code cap
 * downstream in resolver.ts `relativeStep` (RELATIVE_COUNT_CEILING = 48, far
 * above the real ±17 so it never fires in normal use).
 *
 * WHY THIS IS THE FAST-MISS FIX. The old switch mapped ONLY 61-67 (±1..±3) and
 * returned null for everything else. On a fast twist the firmware multiplier
 * pushes the value far outside that band (the capture shows 47..81 during a
 * spin — the overwhelming majority OUTSIDE 61-67), so nearly ALL fast motion
 * hit the null path and was silently DROPPED — the operator's "fast is missed"
 * bug. A valid CC value now NEVER silently returns null: only 64 (genuine
 * no-movement) does.
 *
 * Fail-loud (codex P0) is reserved for genuinely malformed MIDI: a non-integer
 * or an out-of-range value (outside 0..127 — not a legal 7-bit CC data byte)
 * THROWS rather than being papered over. Callers only ever pass a decoded CC
 * data byte, so this throw fires only on a real protocol violation.
 */
export function decodeRelativeDelta(value: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    throw new RangeError(
      `Invalid relative-encoder CC value ${value}. Valid range is 0-127.`,
    );
  }
  if (value === RELATIVE_CENTER) return null; // no movement
  return value - RELATIVE_CENTER;
}

/** The classic six-code relative band (61-67 minus the 64 centre) — the values
 *  the MFT emits at SLOW/MODERATE speeds (counts ±1..±3).
 *
 *  This is a CLASSIFIER, not a decoder: the manager's MIDI-learn footgun guard
 *  needs "does this CC value LOOK like a relative-encoder turn?" to refuse
 *  learning an endless encoder as an absolute control. It used to piggyback on
 *  `decodeRelativeDelta(v) !== null`, which was true exactly for this band —
 *  but now that the decoder honestly covers the whole 0..127 field, that test
 *  would be true for EVERY value and would misclassify any absolute fader
 *  position as a relative turn (over-rejecting learn). Keep the guard's
 *  original narrow semantics here instead. */
export function isClassicRelativeCode(value: number): boolean {
  return value >= 61 && value <= 67 && value !== RELATIVE_CENTER;
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
