// VSN1 pad-mapping uniqueness — the regression guard the Hi-Hat/Blizzard hunt
// asked for: NO two pads may share a NOTE or a SLOT. A shared note would make
// one physical press dispatch two controls; a shared slot would make two pads
// drive the same global-effect slot (the mapping half of the crosstalk).
//
// Binds to the SHIPPED midi_profiles/vsn1.yaml (parsed like the metro
// yaml-transformer), so it catches a real edit to the profile, not a fixture.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile } from './profile';

const rawVsn1 = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/vsn1.yaml'), 'utf8'));

/** The primary matched note of a note-type control (single note or range lo). */
function primaryNote(control: { match: { type?: string; notes?: number[] } }): number | null {
  const m = control.match;
  if (m.type !== 'note' || !Array.isArray(m.notes) || m.notes.length === 0) return null;
  return m.notes[0];
}

describe('vsn1.yaml — pad mapping is collision-free', () => {
  const profile = validateProfile(rawVsn1, 'vsn1.yaml');

  it('the 8 slot-key pads map to 8 UNIQUE notes and 8 UNIQUE slots (1..8)', () => {
    const keyControls = profile.controls.filter(
      (c) => (c.action as { kind?: string }).kind === 'globalEffectSlot',
    );
    expect(keyControls).toHaveLength(8);

    const notes = keyControls.map((c) => primaryNote(c));
    const slots = keyControls.map((c) => (c.action as { slot: number }).slot);

    // No null notes, all distinct.
    expect(notes.every((n) => typeof n === 'number')).toBe(true);
    expect(new Set(notes).size).toBe(8);
    // Slots are exactly the page-0 set 1..8, each once (no two pads share a slot).
    expect([...slots].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(slots).size).toBe(8);
  });

  it('NO two note-type controls share the same note (keys / jog / small buttons are disjoint)', () => {
    // Every press-emitting control (keys 32..39, jog press 40, small buttons
    // 41..44) must own a distinct note so one press can never dispatch two
    // actions. A duplicate note here is the "one pad also triggers another" bug.
    const noteControls = profile.controls
      .map((c) => ({ id: c.id, note: primaryNote(c) }))
      .filter((x): x is { id: string; note: number } => x.note !== null);

    const seen = new Map<number, string>();
    const dupes: string[] = [];
    for (const { id, note } of noteControls) {
      const prior = seen.get(note);
      if (prior) dupes.push(`note ${note}: '${prior}' and '${id}'`);
      else seen.set(note, id);
    }
    expect(dupes).toEqual([]);
    // Sanity: the documented set is keys(8) + jog(1) + small buttons(4) = 13.
    expect(seen.size).toBe(13);
  });

  it('slot-key notes are contiguous 32..39 (the documented 4×2 key grid)', () => {
    const keyControls = profile.controls.filter(
      (c) => (c.action as { kind?: string }).kind === 'globalEffectSlot',
    );
    // Pair each key's note with its slot and assert note = 31 + slot (key k → note
    // 32+k → slot k+1), i.e. the mapping the manager's page-aware derivation
    // (handleVsn1SlotKey) relies on. A drift here is exactly the kind of
    // note↔slot skew that produces cross-pad activation.
    for (const c of keyControls) {
      const note = primaryNote(c)!;
      const slot = (c.action as { slot: number }).slot;
      expect(note).toBe(31 + slot);
    }
  });
});
