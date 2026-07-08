import { describe, it, expect } from 'vitest';

import { deriveKnobOrder, Export, KnobRow, LOCAL_PARAM_KNOB_COUNT, LOCAL_PARAM_KNOB_OFFSET } from './knob_order';

// Terse builder for a kind-1 slider export with a numeric v0.
function slider(id: number, name: string, v0 = 0.5): Export {
  return { id, name, kind: 1, v0 };
}

describe('deriveKnobOrder', () => {
  it('maps every learnable kind-1 slider by order (knob i → knobMapped[i])', () => {
    const exps: Export[] = [slider(1, 'a', 0.1), slider(2, 'b', 0.2), slider(3, 'c', 0.3)];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped.map((e) => e.name)).toEqual(['a', 'b', 'c']);
    // 0-based knobIndex aligns with the knobMapped array index.
    expect(rows.map((r) => r.knobIndex)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.excludedReason === undefined)).toBe(true);
  });

  it('ignores non-slider kinds entirely (not in rows, not in knobMapped)', () => {
    const exps: Export[] = [
      slider(1, 'slider', 0.4),
      { id: 2, name: 'toggle', kind: 2, v0: 1 },
      { id: 3, name: 'trigger', kind: 3 },
      { id: 4, name: 'hsv', kind: 6, v0: 0.5, v1: 0.5, v2: 0.5 },
    ];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped.map((e) => e.name)).toEqual(['slider']);
    expect(rows.map((r) => r.export.name)).toEqual(['slider']); // ONLY kind-1 rows
  });

  it('THE off-by-k case: a cpcOwned slider BEFORE a learnable one is excluded, indices still align', () => {
    // This is the live bug #1 reproduction: a matched export preceding a
    // learnable one must NOT consume a knob slot, or knob 1 would drive the
    // wrong on-screen slider.
    const exps: Export[] = [
      { ...slider(1, 'matchedFirst', 0.9), cpcOwned: true, cpcLabel: 'CPC A' },
      slider(2, 'learnA', 0.2),
      slider(3, 'learnB', 0.3),
    ];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    // knobMapped EXCLUDES the matched one; learnable ones keep contiguous knobs.
    expect(knobMapped.map((e) => e.name)).toEqual(['learnA', 'learnB']);
    // rows carry EVERY kind-1 export in render order, matched one annotated.
    const byName = (n: string) => rows.find((r) => r.export.name === n) as KnobRow;
    expect(byName('matchedFirst').knobIndex).toBeNull();
    expect(byName('matchedFirst').excludedReason).toBe('matched');
    // Knob 0 drives learnA (the FIRST learnable), knob 1 drives learnB — the
    // matched export did not shift them.
    expect(byName('learnA').knobIndex).toBe(0);
    expect(byName('learnB').knobIndex).toBe(1);
    // The knob-mapped subset of rows (in order) equals knobMapped.
    expect(rows.filter((r) => r.knobIndex !== null).map((r) => r.export.name))
      .toEqual(knobMapped.map((e) => e.name));
  });

  it('excludes a slider with no numeric v0 (no-v0), does not fabricate, keeps indices aligned', () => {
    const exps: Export[] = [
      slider(1, 'learnA', 0.1),
      { id: 2, name: 'noV0', kind: 1 }, // v0 absent
      slider(3, 'learnB', 0.3),
    ];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped.map((e) => e.name)).toEqual(['learnA', 'learnB']);
    const noV0 = rows.find((r) => r.export.name === 'noV0') as KnobRow;
    expect(noV0.knobIndex).toBeNull();
    expect(noV0.excludedReason).toBe('no-v0');
    expect(rows.find((r) => r.export.name === 'learnB')!.knobIndex).toBe(1);
  });

  it('treats a NaN / non-finite v0 as no-v0 (guard is numeric-finite, not typeof)', () => {
    const exps: Export[] = [{ id: 1, name: 'nan', kind: 1, v0: NaN }, slider(2, 'ok', 0.2)];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped.map((e) => e.name)).toEqual(['ok']);
    expect(rows.find((r) => r.export.name === 'nan')!.excludedReason).toBe('no-v0');
    expect(rows.find((r) => r.export.name === 'ok')!.knobIndex).toBe(0);
  });

  it('prefers the "matched" reason over "no-v0" for a cpcOwned slider missing v0', () => {
    const exps: Export[] = [{ id: 1, name: 'm', kind: 1, cpcOwned: true }];
    const { rows } = deriveKnobOrder(exps);
    expect(rows[0].knobIndex).toBeNull();
    expect(rows[0].excludedReason).toBe('matched');
  });

  it('handles undefined / null / empty exports as an empty derivation', () => {
    for (const input of [undefined, null, [] as Export[]]) {
      const { knobMapped, rows } = deriveKnobOrder(input);
      expect(knobMapped).toEqual([]);
      expect(rows).toEqual([]);
    }
  });

  it('v2 layout facts: 12 local knob slots, offset 4 past the row-0 globals', () => {
    expect(LOCAL_PARAM_KNOB_COUNT).toBe(12);
    expect(LOCAL_PARAM_KNOB_OFFSET).toBe(4);
  });

  it('caps knobMapped at the 12 physical slots; extra sliders are excluded as overflow', () => {
    const exps: Export[] = Array.from({ length: 15 }, (_, i) => slider(i + 1, `p${i}`, 0.5));
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped).toHaveLength(12);
    expect(rows).toHaveLength(15);
    // The first 12 get contiguous knob indices 0..11.
    expect(rows.slice(0, 12).map((r) => r.knobIndex)).toEqual([...Array(12).keys()]);
    // Sliders 13-15 ran out of hardware: visible, knob-less, reason 'overflow'.
    for (const r of rows.slice(12)) {
      expect(r.knobIndex).toBeNull();
      expect(r.excludedReason).toBe('overflow');
    }
  });

  it('excluded rows never consume one of the 12 slots (matched before the cap)', () => {
    const exps: Export[] = [
      { ...slider(0, 'matched', 0.5), cpcOwned: true },
      ...Array.from({ length: 12 }, (_, i) => slider(i + 1, `p${i}`, 0.5)),
    ];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped).toHaveLength(12); // all 12 learnables mapped — matched consumed no slot
    expect(rows[0].excludedReason).toBe('matched');
    expect(rows[12].knobIndex).toBe(11);
  });

  it('mixed realistic case: matched, learn, no-v0, matched, learn → knobs 0,1 only', () => {
    const exps: Export[] = [
      { ...slider(10, 'brightnessCPC', 0.8), cpcOwned: true, cpcLabel: 'BRIGHT' },
      slider(11, 'speed', 0.5),
      { id: 12, name: 'ghost', kind: 1 }, // no v0
      { ...slider(13, 'hueCPC', 0.2), cpcOwned: true },
      slider(14, 'wobble', 0.6),
    ];
    const { knobMapped, rows } = deriveKnobOrder(exps);
    expect(knobMapped.map((e) => e.name)).toEqual(['speed', 'wobble']);
    expect(rows.map((r) => [r.export.name, r.knobIndex, r.excludedReason ?? null])).toEqual([
      ['brightnessCPC', null, 'matched'],
      ['speed', 0, null],
      ['ghost', null, 'no-v0'],
      ['hueCPC', null, 'matched'],
      ['wobble', 1, null],
    ]);
  });
});
