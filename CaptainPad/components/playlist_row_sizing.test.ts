import { describe, it, expect } from 'vitest';

import { playlistRowSizing, estimatedRowHeight } from './playlist_row_sizing';

describe('playlistRowSizing — normal mode', () => {
  it('regular (deck) normal sizing reflects the docs/63 §4.2 padding trim', () => {
    const s = playlistRowSizing({ compact: false, perfActive: false });
    expect(s).toMatchObject({
      rowPadX: 8, rowPadY: 4, rowGap: 1,
      fontPrimary: 13, fontSub: 9, indexWidth: 20,
      rowMinHeight: 0, centerContent: false,
    });
  });
  // COMPACT VALUES ARE FROZEN — docs/63 §5 pin 8 requires the mixer (which
  // renders with compact: true) to be byte-identical this wave. This is the
  // fence for that pin: if a future edit changes any compact number, this
  // test catches it.
  it('compact (mixer) normal sizing is UNCHANGED — docs/63 §5 pin 8', () => {
    const s = playlistRowSizing({ compact: true, perfActive: false });
    expect(s).toMatchObject({
      rowPadX: 6, rowPadY: 4, rowGap: 1,
      fontPrimary: 13, fontSub: 8, indexWidth: 16,
      rowMinHeight: 0, centerContent: false,
    });
  });
  // docs/63 §4.2's sanctioned padding-only lever for the DECK-B-bound
  // landscape playlist floor: rowPadY 5→4 and rowGap 2→1 in the non-compact
  // (deck) branch ONLY. Pinned by name, separate from the general sizing
  // snapshot above, so a future reader who greps for "§4.2" finds the
  // authorization and the exact tokens it covers in one place. Compact
  // (mixer) values are untouched by this lever — see the pin-8 fence above.
  it('§4.2 padding trim: rowPadY and rowGap are trimmed only in non-compact mode', () => {
    const before = { rowPadY: 5, rowGap: 2 }; // pre-docs/63 values, for the record
    const after = playlistRowSizing({ compact: false, perfActive: false });
    expect(after.rowPadY).toBe(before.rowPadY - 1);
    expect(after.rowGap).toBe(before.rowGap - 1);
    expect(after.rowPadY).toBe(4);
    expect(after.rowGap).toBe(1);
  });
});

describe('playlistRowSizing — docs/69 W3 R1 compact rows (mixer-only, prop-scoped)', () => {
  it('floors the row at the docs/66 44pt minimum, never below', () => {
    for (const compact of [false, true]) {
      const s = playlistRowSizing({ compact, perfActive: false, compactRows: true });
      expect(s.rowMinHeight).toBe(44);
      expect(s.centerContent).toBe(true);
    }
  });

  it('halves rowPadY as the padding-only lever (docs/63 §4.2 precedent), leaving fonts/index/gap untouched', () => {
    const normal = playlistRowSizing({ compact: true, perfActive: false });
    const diet = playlistRowSizing({ compact: true, perfActive: false, compactRows: true });
    expect(diet.rowPadY).toBeLessThan(normal.rowPadY);
    expect(diet.rowPadY).toBe(2);
    expect(diet.fontPrimary).toBe(normal.fontPrimary);
    expect(diet.fontSub).toBe(normal.fontSub);
    expect(diet.indexWidth).toBe(normal.indexWidth);
    expect(diet.rowGap).toBe(normal.rowGap);
    expect(diet.rowPadX).toBe(normal.rowPadX);
  });

  it('is a strict opt-in — omitting the flag reproduces the exact prior (frozen) values', () => {
    // Byte-identical to the docs/63 §5 pin-8 frozen compact values when the
    // new flag is simply absent — proof the deck's mounts (which never pass
    // it) cannot be affected merely because this module changed.
    expect(playlistRowSizing({ compact: true, perfActive: false })).toEqual({
      rowPadX: 6, rowPadY: 4, rowGap: 1,
      fontPrimary: 13, fontSub: 8, indexWidth: 16,
      rowMinHeight: 0, centerContent: false,
    });
  });

  it('wins while perf mode is active so the mixer keeps the same visible density', () => {
    for (const compact of [false, true]) {
      const editDiet = playlistRowSizing({ compact, perfActive: false, compactRows: true });
      const perfPlusDiet = playlistRowSizing({ compact, perfActive: true, compactRows: true });
      expect(perfPlusDiet).toEqual(editDiet);
      expect(perfPlusDiet.rowMinHeight).toBe(44);
    }
  });

  it('the resulting worst-case row (sub-label + control row) is shorter than the un-dieted row and never below the floor', () => {
    for (const compact of [false, true]) {
      const normal = playlistRowSizing({ compact, perfActive: false });
      const diet = playlistRowSizing({ compact, perfActive: false, compactRows: true });
      const normalH = estimatedRowHeight(normal, { compact, hasSubLabel: true, hasControlRow: true });
      const dietH = estimatedRowHeight(diet, { compact, hasSubLabel: true, hasControlRow: true });
      expect(dietH).toBeLessThan(normalH);
      expect(dietH).toBeGreaterThanOrEqual(44);
      // The bare row (no sub-label, no control row — e.g. a locked view)
      // must still hit the floor exactly, never collapse under it.
      const bareH = estimatedRowHeight(diet, { compact, hasSubLabel: false, hasControlRow: false });
      expect(bareH).toBe(44);
    }
  });
});

describe('playlistRowSizing — performance mode boosts the row', () => {
  it('perf rows are taller, wider-spaced, centered', () => {
    for (const compact of [false, true]) {
      const norm = playlistRowSizing({ compact, perfActive: false });
      const perf = playlistRowSizing({ compact, perfActive: true });
      // fontPrimary is no longer strictly bigger after the 2026-07-27 30% cut
      // (perf == edit at 13pt on both tabs); it must never be SMALLER than
      // edit — that floor is the whole point of the clamp in the source.
      expect(perf.fontPrimary).toBeGreaterThanOrEqual(norm.fontPrimary);
      expect(perf.rowPadY).toBeGreaterThan(norm.rowPadY);
      expect(perf.rowGap).toBeGreaterThan(norm.rowGap);
      expect(perf.rowMinHeight).toBeGreaterThan(0);
      expect(perf.centerContent).toBe(true);
    }
  });

  // Pin the operator's 2026-07-27 "30% smaller" ruling so a future tweak can't
  // silently re-inflate the live rows.
  it('perf tokens are the pre-cut values scaled ~0.7', () => {
    expect(playlistRowSizing({ compact: false, perfActive: true })).toMatchObject({
      rowPadX: 8, rowPadY: 10, rowGap: 4,
      fontPrimary: 13, fontSub: 9, indexWidth: 20, rowMinHeight: 62,
    });
    expect(playlistRowSizing({ compact: true, perfActive: true })).toMatchObject({
      rowPadX: 7, rowPadY: 8, rowGap: 4,
      fontPrimary: 13, fontSub: 8, indexWidth: 16, rowMinHeight: 55,
    });
  });
});

describe('estimatedRowHeight — perf rows stay taller than the normal row', () => {
  // The normal baseline is the EDIT-mode row (index + name + control sub-row).
  // The perf row hides the control sub-row but is floored by rowMinHeight. The
  // margin was >=1.7x until the operator's 2026-07-27 30% cut; it must still be
  // a clearly bigger touch target than an edit row.
  for (const compact of [false, true]) {
    it(`${compact ? 'mixer (compact)' : 'deck (regular)'} perf height >= 1.2x normal`, () => {
      const normH = estimatedRowHeight(
        playlistRowSizing({ compact, perfActive: false }),
        { compact, hasSubLabel: false, hasControlRow: true },
      );
      const perfH = estimatedRowHeight(
        playlistRowSizing({ compact, perfActive: true }),
        { compact, hasSubLabel: false, hasControlRow: false },
      );
      expect(perfH / normH).toBeGreaterThanOrEqual(1.2);
    });
  }

  it('perf row height is floored (never collapses below the min target)', () => {
    // Even a bare single-line name (no sub-label, no controls) hits the floor —
    // this is exactly the regression case the perf lock created.
    const perf = playlistRowSizing({ compact: false, perfActive: true });
    const h = estimatedRowHeight(perf, { compact: false, hasSubLabel: false, hasControlRow: false });
    expect(h).toBe(perf.rowMinHeight);
  });

  it('a perf row with a sub-label is still at least the min height', () => {
    const perf = playlistRowSizing({ compact: true, perfActive: true });
    const h = estimatedRowHeight(perf, { compact: true, hasSubLabel: true, hasControlRow: false });
    expect(h).toBeGreaterThanOrEqual(perf.rowMinHeight);
  });
});
