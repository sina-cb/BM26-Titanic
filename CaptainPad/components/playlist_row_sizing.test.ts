import { describe, it, expect } from 'vitest';

import { playlistRowSizing, estimatedRowHeight } from './playlist_row_sizing';

describe('playlistRowSizing — normal mode is unchanged', () => {
  it('regular (deck) normal sizing matches the pre-existing sz values', () => {
    const s = playlistRowSizing({ compact: false, perfActive: false });
    expect(s).toMatchObject({
      rowPadX: 8, rowPadY: 5, rowGap: 2,
      fontPrimary: 13, fontSub: 9, indexWidth: 20,
      rowMinHeight: 0, centerContent: false,
    });
  });
  it('compact (mixer) normal sizing matches the pre-existing sz values', () => {
    const s = playlistRowSizing({ compact: true, perfActive: false });
    expect(s).toMatchObject({
      rowPadX: 6, rowPadY: 4, rowGap: 1,
      fontPrimary: 13, fontSub: 8, indexWidth: 16,
      rowMinHeight: 0, centerContent: false,
    });
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
