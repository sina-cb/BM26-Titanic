// Pure MIDI byte (de)coding. No transport, no state — just maps raw 3-byte
// channel messages to/from typed events the mapping layer reasons about.
//
// We only care about the channel-voice messages the APC mini mk2 (and the
// planned MIDI Fighter Twister) emit: Note On, Note Off, Control Change.
// A Note On with velocity 0 is the conventional Note Off and is normalised
// here so the resolver never has to special-case it.

export type DecodedMidi =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; cc: number; value: number }
  | { type: 'other'; status: number; data: number[] };

const STATUS_NOTE_OFF = 0x80;
const STATUS_NOTE_ON = 0x90;
const STATUS_CC = 0xb0;

export function decodeMidi(data: number[]): DecodedMidi {
  if (!Array.isArray(data) || data.length < 3) {
    return { type: 'other', status: data?.[0] ?? -1, data: data ?? [] };
  }
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  const d1 = data[1];
  const d2 = data[2];
  if (status === STATUS_NOTE_ON) {
    // Velocity 0 == Note Off by MIDI convention.
    return d2 > 0
      ? { type: 'noteOn', channel, note: d1, velocity: d2 }
      : { type: 'noteOff', channel, note: d1, velocity: 0 };
  }
  if (status === STATUS_NOTE_OFF) {
    return { type: 'noteOff', channel, note: d1, velocity: d2 };
  }
  if (status === STATUS_CC) {
    return { type: 'cc', channel, cc: d1, value: d2 };
  }
  return { type: 'other', status: data[0], data };
}

/** Build a Note On message (used for both RGB pad colours and single-LED
 *  on/off). `channel` selects the APC's brightness/behaviour for RGB pads
 *  (0x96 == solid 100% lives at channel 6). */
export function noteOn(channel: number, note: number, velocity: number): number[] {
  return [(STATUS_NOTE_ON | (channel & 0x0f)) & 0xff, note & 0x7f, velocity & 0x7f];
}
