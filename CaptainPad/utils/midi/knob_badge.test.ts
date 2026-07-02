import { describe, it, expect } from 'vitest';

import { deriveKnobOrder, Export } from './knob_order';
import { knobBadgeFor } from './knob_badge';

// Build a badge for the i-th row of a derivation, for terse assertions.
function badgesOf(exps: Export[]) {
  return deriveKnobOrder(exps).rows.map(knobBadgeFor);
}

describe('knobBadgeFor', () => {
  it('knob-mapped row → 1-based KNOB N badge, mapped, not dimmed', () => {
    const b = badgesOf([{ id: 1, name: 'a', kind: 1, v0: 0.5 }])[0];
    expect(b.knobNumber).toBe(1); // 0-based knobIndex 0 → physical knob 1
    expect(b.text).toBe('KNOB 1');
    expect(b.mapped).toBe(true);
    expect(b.dimmed).toBe(false);
    expect(b.excludedReason).toBeNull();
  });

  it('knob numbers stay 1-based and contiguous across several sliders', () => {
    const badges = badgesOf([
      { id: 1, name: 'a', kind: 1, v0: 0.1 },
      { id: 2, name: 'b', kind: 1, v0: 0.2 },
      { id: 3, name: 'c', kind: 1, v0: 0.3 },
    ]);
    expect(badges.map((b) => b.knobNumber)).toEqual([1, 2, 3]);
    expect(badges.map((b) => b.text)).toEqual(['KNOB 1', 'KNOB 2', 'KNOB 3']);
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
    // The learnable slider AFTER the matched one is still physical knob 1 —
    // the matched row did not consume a knob number.
    expect(badges[1].knobNumber).toBe(1);
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
    // knobs still 1 and 2 for the two learnable rows around the gap.
    expect(badges[0].knobNumber).toBe(1);
    expect(badges[2].knobNumber).toBe(2);
  });
});
