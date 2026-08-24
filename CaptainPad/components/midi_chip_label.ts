// midi_chip_label — pure logic behind the header MIDI chip's compact copy.
//
// Kept in its own .ts file (no React, no RN) so vitest can pin the label
// contract without touching the TSX renderer. The chip labels a JOINT state
// across CaptainPad's three profiles (APC mini mk2 + MIDI Fighter Twister +
// Intech VSN1) — any controller-specific label misleads the operator when
// THAT controller is unplugged but the others are still live.

export type MidiChipKind = 'unavailable' | 'disconnected' | 'connected' | 'error';

/**
 * Compact chip label for the header. Colour carries the state (green /
 * grey / red); the string carries at most a live/total ratio when 2+
 * controllers are configured.
 *
 * @param kind            resolved chip kind (see `midiChipState`)
 * @param connectedCount  number of controllers currently 'connected'
 * @param totalCount      number of configured profiles (statuses.length)
 */
export function midiChipLabel(
  kind: MidiChipKind,
  connectedCount: number,
  totalCount: number,
): string {
  // Two-plus configured surfaces + at least one connected is the only case
  // that benefits from a ratio: a single controller reads '1/1' as noise, and
  // any non-connected state already carries "something is wrong / off" via
  // colour + accessibility label, so an "0/3" next to a red chip would just
  // be visual clutter.
  if (kind === 'connected' && totalCount > 1) {
    return `🎹 MIDI ${connectedCount}/${totalCount}`;
  }
  return '🎹 MIDI';
}
