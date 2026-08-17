// playlist_row_sizing — pure sizing tokens for a PlaylistPanel ENTRY ROW.
//
// Why this is its own module: the entry row is the operator's primary live
// touch surface. In PERFORMANCE MODE the structural-lock pass hides the per-row
// control sub-row (reorder chevrons + remove) — an intentional safety measure —
// but that ALSO collapsed each row to a single thin line (operator complaint:
// "pattern rows are too thin to hit during a show"). This module owns the row's
// sizing so the perf-mode height boost is one place, unit-testable without React
// or layout, and can't silently drift from its stated contract.
//
// PERF SIZING WAS CUT 30% on 2026-07-27 (operator, live on the iPad: the boosted
// rows were "too big" — they ate the list, so fewer patterns were reachable
// during a show). Every perf token below is the previous value × 0.7, rounded.
// The row is still comfortably bigger than an edit row and, since 2026-07-27,
// the WHOLE row is the tap target (PlaylistPanel's Pressable), so the smaller
// box is still an easy hit — that fix is what makes this cut safe.
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
  /**
   * docs/69 W3 R1 (operator-authorized 2026-08-16, D5 default ON): "in
   * horizontal layout the pattern list is basically not showing up to
   * select patterns... rethink the layout". W3's media-column relocation is
   * the main fix; R1 is its rider — compact the row's floor to the docs/66
   * 44pt minimum (never below) instead of leaving it content-sized, so more
   * rows fit per card.
   *
   * Scoped by PROP all the way up through `PlaylistPanel` to ONE mount —
   * the MIXER screen's `app/(tabs)/mixer.tsx` — so every deck mount
   * (`DeckOverlayStack.tsx`, `components/deck/split_playlist_panes.tsx`)
   * stays byte-identical: neither passes this, so `playlistRowSizing`
   * never even sees it true for them. Deliberately a SEPARATE flag from
   * `compact` (which DeckOverlayStack also sets, for its own chrome sizing)
   * — reusing `compact` here would have leaked the row diet onto that deck
   * mount too.
   *
   * This explicit mixer tier also wins when `perfActive`: entering a show must
   * not inflate rows and reduce how much of the pattern list is visible.
   */
  compactRows?: boolean;
}

/**
 * Sizing tokens for one playlist entry row.
 *
 * Perf-mode rows are ~20% taller than the normal edit-mode row (which includes
 * the control sub-row), with a guaranteed uniform min height for touch and more
 * inter-row spacing. The boost was ~70% until the operator cut it 30% on
 * 2026-07-27. See estimatedRowHeight() + playlist_row_sizing.test.ts for the
 * pinned ratio.
 */
export function playlistRowSizing(opts: RowSizingOpts): PlaylistRowSizing {
  const compact = !!opts.compact;
  // `compactRows` is the mixer's explicit visible-pattern-count contract and
  // therefore wins in every mode. Deck mounts omit it and retain the larger
  // live-show tier below.
  if (opts.perfActive && !opts.compactRows) {
    // All values = the pre-2026-07-27 perf tokens × 0.7 (see the note at the
    // top of the file). Kept as literals rather than a computed scale so the
    // rendered numbers are greppable and the unit test can pin them.
    return {
      rowPadX: compact ? 7 : 8,        // was 10 / 12
      rowPadY: compact ? 8 : 10,       // was 12 / 14
      rowGap: compact ? 4 : 4,         // was 5 / 6
      // FLOORED AT THE EDIT-MODE VALUE. A straight x0.7 put these BELOW the
      // edit-mode tokens (compact name 16->11 vs edit 13), i.e. the live show
      // would render smaller text than the editing surface — clearly not what
      // "make live 30% smaller" means. The row box still takes the full 30%
      // cut (rowMinHeight below); the glyphs stop at edit size.
      fontPrimary: 13,                 // was 16 / 18 (edit is 13)
      fontSub: compact ? 8 : 9,        // was 11 / 12 (edit is 8 / 9)
      indexWidth: compact ? 16 : 20,   // was 22 / 26 (edit is 16 / 20)
      // ~1.2× the normal edit-mode row height (45 compact / 51 regular → 55 / 62).
      // Was ~1.7× (78 / 88) before the operator's 30% cut.
      rowMinHeight: compact ? 55 : 62,
      centerContent: true,
    };
  }
  if (opts.compactRows) {
    // docs/69 W3 R1: the same "padding-only lever" discipline docs/63 §4.2
    // already established for the deck's non-compact rows (rowPadY 5→4 /
    // rowGap 2→1), applied here as a MIXER-only, prop-gated tier: rowPadY
    // halves again (4→2) and the row gets a REAL floor at the docs/66 44pt
    // minimum instead of staying content-sized (0 = "no floor" in the
    // normal branch below). Font sizes, index width, rowGap, and the
    // reorder/remove control buttons' own dimensions are all UNTOUCHED —
    // this is a padding/floor lever on the OUTER row (the primary ≥44pt tap
    // target per docs/66), not a legibility or per-control tap-target
    // shrink. `centerContent: true` mirrors perf's own pattern: harmless
    // once a row's content meets or exceeds the floor, and keeps thin rows
    // (no sub-label) looking centered rather than pinned to the top of a
    // taller box.
    return {
      rowPadX: compact ? 6 : 8,
      rowPadY: 2,
      rowGap: compact ? 1 : 1,
      fontPrimary: 13,
      fontSub: compact ? 8 : 9,
      indexWidth: compact ? 16 : 20,
      rowMinHeight: 44,
      centerContent: true,
    };
  }
  // Normal (edit-mode) sizing — byte-for-byte the prior inline `sz` values so
  // nothing changes when perf mode is off, EXCEPT the non-compact
  // rowPadY/rowGap, which docs/63 §4.2 authorizes as a padding-only trim
  // (5→4 / 2→1) when the DECK-B-bound landscape playlist falls short of the
  // ≥3-rows-per-pane simplified floor after the bar-hiding lands. The
  // compact (mixer) values are FROZEN — docs/63 §5 pin 8 requires the mixer
  // to render byte-identical this wave UNLESS it also opts into
  // `compactRows` above (docs/69 W3 R1, a later, separately-authorized
  // wave).
  return {
    rowPadX: compact ? 6 : 8,
    rowPadY: compact ? 4 : 4,
    rowGap: compact ? 1 : 1,
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
