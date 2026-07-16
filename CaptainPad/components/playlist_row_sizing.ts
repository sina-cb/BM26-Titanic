// playlist_row_sizing — pure sizing tokens for a PlaylistPanel ENTRY ROW.
//
// Why this is its own module: the entry row is the operator's primary live
// touch surface. In PERFORMANCE MODE the structural-lock pass hides the per-row
// control sub-row (reorder chevrons + remove) — an intentional safety measure —
// but that ALSO collapsed each row to a single thin line (operator complaint:
// "pattern rows are too thin to hit during a show"). This module owns the row's
// sizing so the perf-mode height boost is one place, unit-testable without React
// or layout, and can't silently drift from the "~70% taller" contract.
//
// Normal (edit-mode) rows keep their exact pre-existing sizing — this ONLY
// changes the perf-mode path. The chrome tokens (header buttons, panel padding)
// stay in PlaylistPanel's own `sz` object and are deliberately NOT touched here,
// so the perf boost affects rows and rows only.

export interface PlaylistRowSizing {
  /** Horizontal padding inside the row. */
  rowPadX: number;
  /** Vertical padding inside the row (top + bottom each). */
  rowPadY: number;
  /** Gap between adjacent rows (marginBottom) — bumped in perf so fat fingers
   *  can't bridge two rows mid-show. */
  rowGap: number;
  /** Primary (pattern-name) font size. */
  fontPrimary: number;
  /** Sub-label / index / pad-chip font size. */
  fontSub: number;
  /** Fixed width of the NN index badge column. */
  indexWidth: number;
  /** Hard floor on the row height. 0 = no floor (row is content-sized, the
   *  normal-mode behaviour). In perf mode this guarantees a large uniform tap
   *  target regardless of whether a row has a sub-label. */
  rowMinHeight: number;
  /** Whether the row content should be vertically centered inside rowMinHeight.
   *  True only in perf mode, where the floor exceeds the content height. */
  centerContent: boolean;
}

// ── Layout model constants (mirror the row JSX in PlaylistPanel.tsx) ────────
// The name Text sets lineHeight = fontPrimary + NAME_LINE_EXTRA; the edit-mode
// control sub-row (line 2) is CONTROL_ROW_GAP above a control cluster of height
// CONTROL_ROW_HEIGHT (= btnH - 4). estimatedRowHeight() below reconstructs the
// row box height from these so the "~70% taller" relationship is a tested
// invariant, not a guessed magic number.
const NAME_LINE_EXTRA = 4;
const CONTROL_ROW_GAP = 2;
const CONTROL_ROW_HEIGHT = { compact: 18, regular: 22 } as const;

export interface RowSizingOpts {
  compact?: boolean;
  /** usePerformanceMode().active — the live-show structural lock. */
  perfActive?: boolean;
}

/**
 * Sizing tokens for one playlist entry row.
 *
 * Perf-mode rows are ~70% taller than the normal edit-mode row (which includes
 * the control sub-row), with a larger legible name, a guaranteed uniform min
 * height for touch, and more inter-row spacing. See estimatedRowHeight() +
 * playlist_row_sizing.test.ts for the pinned ratio.
 */
export function playlistRowSizing(opts: RowSizingOpts): PlaylistRowSizing {
  const compact = !!opts.compact;
  if (opts.perfActive) {
    return {
      rowPadX: compact ? 10 : 12,
      rowPadY: compact ? 12 : 14,
      rowGap: compact ? 5 : 6,
      fontPrimary: compact ? 16 : 18,
      fontSub: compact ? 11 : 12,
      indexWidth: compact ? 22 : 26,
      // ~1.7× the normal edit-mode row height (45 compact / 51 regular → 78 / 88).
      rowMinHeight: compact ? 78 : 88,
      centerContent: true,
    };
  }
  // Normal (edit-mode) sizing — byte-for-byte the prior inline `sz` values so
  // nothing changes when perf mode is off.
  return {
    rowPadX: compact ? 6 : 8,
    rowPadY: compact ? 4 : 5,
    rowGap: compact ? 1 : 2,
    fontPrimary: 13,
    fontSub: compact ? 8 : 9,
    indexWidth: compact ? 16 : 20,
    rowMinHeight: 0,
    centerContent: false,
  };
}

/**
 * Reconstruct the rendered row box height for a given sizing, modelling the row
 * JSX layout. `hasSubLabel` adds the second name line; `hasControlRow` adds the
 * edit-mode control sub-row (hidden in perf mode). The result is floored by
 * rowMinHeight, exactly as the row's `minHeight` style does.
 *
 * Used by the unit test to pin the "~70% taller in perf mode" contract, and
 * available to callers that need a height estimate.
 */
export function estimatedRowHeight(
  sizing: PlaylistRowSizing,
  opts: { compact?: boolean; hasSubLabel?: boolean; hasControlRow?: boolean },
): number {
  const compact = !!opts.compact;
  const nameLine = sizing.fontPrimary + NAME_LINE_EXTRA;
  const subLine = opts.hasSubLabel ? sizing.fontSub + NAME_LINE_EXTRA + 1 /* marginTop */ : 0;
  const controlRow = opts.hasControlRow
    ? CONTROL_ROW_GAP + CONTROL_ROW_HEIGHT[compact ? 'compact' : 'regular']
    : 0;
  const content = sizing.rowPadY * 2 + nameLine + subLine + controlRow;
  return Math.max(content, sizing.rowMinHeight);
}
