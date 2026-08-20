/**
 * master_bar_seat_yoga.test.ts — the Yoga-EXECUTED regression net for the
 * portrait master bar seat (docs/69 §1, §2, D2).
 *
 * `yoga-layout` 3.x is the WASM build of the SAME C++ layout algorithm this
 * app's React Native vendors (`node_modules/react-native/ReactCommon/yoga`).
 * Web screenshots cannot execute Yoga — react-native-web resolves the exact
 * same flattened style object through real CSS flexbox longhands, which
 * silently disagrees with native Yoga on this composition (docs/69 §1.1) —
 * so a web render is explicitly BANNED as proof for this item. This test
 * builds the shipped portrait chain out of real `Node.create()` calls, runs
 * the real `calculateLayout()`, and reads back the real computed height. It
 * is the net that both `_273`'s original bug and `_275`'s inert "fix" would
 * have failed, had it existed then (docs/69 §1.2).
 *
 * `yoga-layout` loads asynchronously (`loadYoga()` from the `yoga-layout/load`
 * subpath resolves a promise around the Emscripten WASM init) — this is
 * awaited once in `beforeAll`, never wrapped in try/catch: a load failure
 * must crash the suite loudly (P0 "no fallback behaviors"), not be swallowed.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadYoga } from 'yoga-layout/load';
import type { Node as YogaNode, Yoga as YogaModule } from 'yoga-layout/load';

import { MASTER_BAR_SEAT_LANDSCAPE, MASTER_BAR_SEAT_PORTRAIT } from './mixer_workspace_bar_logic';

// ── The two HISTORICAL portrait seat compositions (docs/69 §1.1's own
//    executed-proof table + the task's exact wording) — declared locally,
//    NEVER imported, because they must keep existing exactly as shipped in
//    the past even if `mixer_workspace_bar_logic.ts` changes shape again. ──
const PRE_275_SEAT = { flex: 1, minWidth: 0 };
const SHIPPED_275_SEAT = { flex: 1, minWidth: 0, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' as const };

// ── Content-size fixtures, matching docs/69 §2 item 3's chain description:
//    master canvas column ~30pt tall content; the seat's one child (the chip
//    row) 36pt tall content. ──
const CANVAS_COLUMN_CONTENT_HEIGHT = 30;
const CHIP_ROW_CONTENT_HEIGHT = 36;

let Yoga: YogaModule;

beforeAll(async () => {
  Yoga = await loadYoga();
});

/**
 * Applies an RN `ViewStyle`-shaped seat object to a Yoga node via the exact
 * Yoga calls RN's own Yoga binding would issue for each key — spelled out
 * one key at a time (not a generic loop) so the RN→Yoga mapping is legible
 * and auditable at the call site, per docs/69 D1/D2's "select, don't fight"
 * framing.
 */
function applySeatStyle(node: YogaNode, style: Record<string, unknown>): void {
  // RN `flex: N` → Yoga `setFlex(N)`. This sets the SHORTHAND `flex` style
  // field only — a field distinct from `flexGrow`/`flexShrink`/`flexBasis`,
  // exactly the distinction docs/69 §1.1 traces through `processFlexBasis()`.
  if ('flex' in style) node.setFlex(style.flex as number);
  // RN `flexGrow: N` → Yoga `setFlexGrow(N)` (independent longhand).
  if ('flexGrow' in style) node.setFlexGrow(style.flexGrow as number);
  // RN `flexShrink: N` → Yoga `setFlexShrink(N)` (independent longhand).
  if ('flexShrink' in style) node.setFlexShrink(style.flexShrink as number);
  // RN `flexBasis: 'auto' | N` → Yoga `setFlexBasis(...)` — the patched
  // setter (`wrapAssembly.ts`) accepts the literal string `'auto'` directly,
  // same as RN's own binding.
  if ('flexBasis' in style) node.setFlexBasis(style.flexBasis as number | 'auto');
  // RN `minWidth: N` → Yoga `setMinWidth(N)`. Never touches the main-axis
  // (height, in the portrait column) — included only for parity with the
  // real style object; it plays no part in the height computations below.
  if ('minWidth' in style) node.setMinWidth(style.minWidth as number);
}

/**
 * Builds the shipped PORTRAIT chain exactly as docs/69 §2 item 3 describes
 * it — a definite-height screen column, an auto-height `masterRow` column
 * (`alignItems:'stretch'`, i.e. `masterRowPortrait`) holding the content
 * canvas column and the seat — applies `seatStyle` to the seat, runs the
 * real layout, and returns the seat's computed height. Frees the whole tree
 * afterward (Yoga nodes are WASM-heap allocated, not GC'd).
 */
function measurePortraitSeatHeight(seatStyle: Record<string, unknown>): number {
  const screen = Yoga.Node.create();
  screen.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  screen.setWidth(400);
  screen.setHeight(600);

  // `masterRowPortrait`: flexDirection column, alignItems stretch, auto
  // (content-sized) height — no `setHeight` call at all.
  const masterRow = Yoga.Node.create();
  masterRow.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
  masterRow.setAlignItems(Yoga.ALIGN_STRETCH);

  // `masterCanvasColumn`: content-sized, ~30pt tall content.
  const canvasColumn = Yoga.Node.create();
  canvasColumn.setHeight(CANVAS_COLUMN_CONTENT_HEIGHT);

  // The seat under test.
  const seat = Yoga.Node.create();
  applySeatStyle(seat, seatStyle);

  // The seat's one child: the chip row, 36pt tall content.
  const chipRow = Yoga.Node.create();
  chipRow.setHeight(CHIP_ROW_CONTENT_HEIGHT);
  seat.insertChild(chipRow, 0);

  masterRow.insertChild(canvasColumn, 0);
  masterRow.insertChild(seat, 1);
  screen.insertChild(masterRow, 0);

  screen.calculateLayout(400, 600, Yoga.DIRECTION_LTR);
  const seatHeight = seat.getComputedHeight();

  screen.freeRecursive();
  return seatHeight;
}

/**
 * Builds the LANDSCAPE chain — `masterRow` as a ROW with a definite width
 * (`masterRow`, unmodified by this fix) holding a content-sized canvas
 * column and the seat — applies `seatStyle` to the seat, and returns the
 * seat's computed WIDTH (landscape's main axis). Proves the fix does not
 * touch landscape: the seat must still claim the row's remaining width.
 */
function measureLandscapeSeatWidth(seatStyle: Record<string, unknown>): number {
  const masterRow = Yoga.Node.create();
  masterRow.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  masterRow.setAlignItems(Yoga.ALIGN_CENTER); // matches `masterRow`'s alignItems:'center'
  masterRow.setWidth(400);

  const canvasColumn = Yoga.Node.create();
  canvasColumn.setWidth(150); // content-sized canvas column, arbitrary definite fixture
  canvasColumn.setHeight(CANVAS_COLUMN_CONTENT_HEIGHT);

  const seat = Yoga.Node.create();
  applySeatStyle(seat, seatStyle);

  const chipRow = Yoga.Node.create();
  chipRow.setHeight(CHIP_ROW_CONTENT_HEIGHT);
  seat.insertChild(chipRow, 0);

  masterRow.insertChild(canvasColumn, 0);
  masterRow.insertChild(seat, 1);

  masterRow.calculateLayout(400, undefined, Yoga.DIRECTION_LTR);
  const seatWidth = seat.getComputedWidth();

  masterRow.freeRecursive();
  return seatWidth;
}

describe('master bar seat — portrait chain, Yoga-executed (docs/69 §1, §2)', () => {
  it('the two HISTORICAL compositions both collapse the seat to 0pt — documenting the defect class', () => {
    expect(measurePortraitSeatHeight(PRE_275_SEAT)).toBe(0);
    expect(measurePortraitSeatHeight(SHIPPED_275_SEAT)).toBe(0);
  });

  it('the SHIPPED fix (the real exported MASTER_BAR_SEAT_PORTRAIT) sizes the seat to its content height (36)', () => {
    expect(measurePortraitSeatHeight(MASTER_BAR_SEAT_PORTRAIT)).toBe(CHIP_ROW_CONTENT_HEIGHT);
  });

  it('MASTER_BAR_SEAT_PORTRAIT carries none of the four flex-family keys — the trap is structurally unreachable', () => {
    expect('flex' in MASTER_BAR_SEAT_PORTRAIT).toBe(false);
    expect('flexGrow' in MASTER_BAR_SEAT_PORTRAIT).toBe(false);
    expect('flexShrink' in MASTER_BAR_SEAT_PORTRAIT).toBe(false);
    expect('flexBasis' in MASTER_BAR_SEAT_PORTRAIT).toBe(false);
  });
});

describe('master bar seat — landscape chain, Yoga-executed (docs/69 §2 item 3, "landscape is unchanged")', () => {
  it('MASTER_BAR_SEAT_LANDSCAPE still claims the row remainder beside the content-sized canvas column', () => {
    // masterRow width 400 - canvasColumn width 150 = 250 pt remaining for a
    // flex:1 grower.
    expect(measureLandscapeSeatWidth(MASTER_BAR_SEAT_LANDSCAPE)).toBe(250);
  });
});
