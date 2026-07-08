import { describe, it, expect } from 'vitest';

import { deriveKnobOrder, Export } from './knob_order';
import { knobBadgeFor } from './knob_badge';

// Build a badge for the i-th row of a derivation, for terse assertions.
function badgesOf(exps: Export[]) {
  return deriveKnobOrder(exps).rows.map(knobBadgeFor);
}

describe('knobBadgeFor', () => {
  it('knob-mapped row → PHYSICAL knob number (offset past row-0 globals), mapped, not dimmed', () => {
    const b = badgesOf([{ id: 1, name: 'a', kind: 1, v0: 0.5 }])[0];
    // v2 layout: ordered local param 0 lives on encoder 4 = physical knob 5.
    expect(b.knobNumber).toBe(5);
    expect(b.text).toBe('KNOB 5');
    expect(b.mapped).toBe(true);
    expect(b.dimmed).toBe(false);
    expect(b.excludedReason).toBeNull();
  });

  it('knob numbers stay contiguous across several sliders (5, 6, 7, …)', () => {
    const badges = badgesOf([
      { id: 1, name: 'a', kind: 1, v0: 0.1 },
      { id: 2, name: 'b', kind: 1, v0: 0.2 },
      { id: 3, name: 'c', kind: 1, v0: 0.3 },
    ]);
    expect(badges.map((b) => b.knobNumber)).toEqual([5, 6, 7]);
    expect(badges.map((b) => b.text)).toEqual(['KNOB 5', 'KNOB 6', 'KNOB 7']);
  });

  it('matched row → MATCHED · LABEL, dimmed, no knob number, consumes no knob', () => {
    const badges = badgesOf([
      { id: 1, name: 'm', kind: 1, v0: 0.9, cpcOwned: true, cpcLabel: 'SIZE' },
      { id: 2, name: 'a', kind: 1, v0: 0.2 },
    ]);
    expect(badges[0]).toMatchObject({
      knobNumber: null,
      text: 'MATCHED · SIZE',
      mapped: false,
      dimmed: true,
      excludedReason: 'matched',
    });
    // The learnable slider AFTER the matched one is still physical knob 5 —
    // the matched row did not consume a knob number.
    expect(badges[1].knobNumber).toBe(5);
  });

  it('overflow row (beyond the 12 slots) → em-dash marker, dimmed, reason overflow', () => {
    const badges = badgesOf(
      Array.from({ length: 13 }, (_, i) => ({ id: i, name: `p${i}`, kind: 1, v0: 0.5 })),
    );
    expect(badges[11]).toMatchObject({ knobNumber: 16, text: 'KNOB 16', mapped: true });
    expect(badges[12]).toMatchObject({
      knobNumber: null,
      text: '—',
      mapped: false,
      dimmed: true,
      excludedReason: 'overflow',
    });
  });

  it('matched row with no cpcLabel → plain MATCHED', () => {
    const b = badgesOf([{ id: 1, name: 'm', kind: 1, v0: 0.5, cpcOwned: true }])[0];
    expect(b.text).toBe('MATCHED');
    expect(b.excludedReason).toBe('matched');
  });

  it('no-v0 row → em-dash marker, dimmed, no knob number', () => {
    const badges = badgesOf([
      { id: 1, name: 'a', kind: 1, v0: 0.1 },
      { id: 2, name: 'ghost', kind: 1 }, // no v0
      { id: 3, name: 'b', kind: 1, v0: 0.3 },
    ]);
    expect(badges[1]).toMatchObject({
      knobNumber: null,
      text: '—',
      mapped: false,
      dimmed: true,
      excludedReason: 'no-v0',
    });
    // knobs still 5 and 6 for the two learnable rows around the gap.
    expect(badges[0].knobNumber).toBe(5);
    expect(badges[2].knobNumber).toBe(6);
  });
});
