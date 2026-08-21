// midi_status_chip_label.test.ts — pins the header chip's compact copy so a
// silent regression to "🎹 APC" (or any controller-specific label) is caught
// by the suite instead of by an operator on the playa. The chip labels a
// JOINT state across APC mini mk2 + MIDI Fighter Twister + Intech VSN1: any
// single-controller label misleads the operator when THAT controller is
// unplugged but the others are still live.

import { describe, expect, it } from 'vitest';
import { midiChipLabel } from './midi_chip_label';

describe('midiChipLabel — controller-neutral header chip copy', () => {
  it("labels every non-connected state as the plain '🎹 MIDI' (colour carries the state)", () => {
    for (const kind of ['unavailable', 'disconnected', 'error'] as const) {
      expect(midiChipLabel(kind, 0, 0)).toBe('🎹 MIDI');
      expect(midiChipLabel(kind, 0, 3)).toBe('🎹 MIDI');
    }
  });

  it("labels a single-controller connected setup as the plain '🎹 MIDI' (no ratio noise)", () => {
    // One profile in use — nothing to ration; ratio '1/1' would be visual
    // clutter without carrying information.
    expect(midiChipLabel('connected', 1, 1)).toBe('🎹 MIDI');
    // Sanity: even at 0/1 the copy stays plain (colour goes disconnected).
    expect(midiChipLabel('connected', 0, 1)).toBe('🎹 MIDI');
  });

  it('shows the connected-count ratio when 2+ controllers are configured', () => {
    // Titanic runs three profiles (APC + MFT + VSN1). A glance at '2/3' tells
    // the operator which fraction of their surfaces are live without opening
    // the MIDI tab.
    expect(midiChipLabel('connected', 2, 3)).toBe('🎹 MIDI 2/3');
    expect(midiChipLabel('connected', 3, 3)).toBe('🎹 MIDI 3/3');
    expect(midiChipLabel('connected', 1, 3)).toBe('🎹 MIDI 1/3');
    expect(midiChipLabel('connected', 1, 2)).toBe('🎹 MIDI 1/2');
  });

  it('does NOT show a ratio in non-connected states even with 2+ configured (the count is meaningless there)', () => {
    // A red chip already says "something is wrong"; a "0/3" ratio next to it
    // would be noise. The chip's tap-through carries the specifics.
    expect(midiChipLabel('error', 0, 3)).toBe('🎹 MIDI');
    expect(midiChipLabel('disconnected', 0, 3)).toBe('🎹 MIDI');
    expect(midiChipLabel('unavailable', 0, 3)).toBe('🎹 MIDI');
  });
});
