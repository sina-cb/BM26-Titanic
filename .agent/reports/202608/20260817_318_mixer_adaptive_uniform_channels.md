# _318 — Mixer adaptive uniform channel widths

**Scope:** CaptainPad Mixer layout only. No engine, Live Touch, service, port,
runtime-state, git, deployment, or physical-rig operation.

## Outcome

Expanded visible Mixer channels now share one computed width. The shipped
320-point card width is the hard minimum; cards grow uniformly when horizontal
space is available. A card is capped at 50% of the usable channel budget, so a
single channel occupies half the row and two channels split the row exactly
after real padding, gaps, group frames, collapsed-group bars, and the COLORS
citizen are reserved. When the equal fit is below 320 points, every card stays
320 points and the horizontal host is enabled from computed overflow.

The sizing result is recomputed from structural counts only. Live mixer
broadcasts that replace channel objects for fader or meter changes do not mint
a new card-track object or defeat `ChannelStrip` memoization. Add/remove,
hide/show, group collapse/expand, COLORS visibility, orientation, and measured
row-width changes all update the shared track.

Per-channel PixelViewBand, playlist, controls, group composition,
Performance/Edit composition, mounted-hidden citizen behavior, master bar, and
COLORS behavior were not otherwise changed.

## Files changed

- `CaptainPad/components/mixer_scroll_layout.ts`
- `CaptainPad/app/(tabs)/mixer.tsx`
- `CaptainPad/components/mixer_scroll_layout.test.ts`
- `CaptainPad/components/mixer/mixer_channel_row_yoga.test.ts`
- `CaptainPad/components/native_gesture_armor.test.ts`
- `.agent/context/now.md`
- this report

## Validation

- Focused Mixer/native gesture suite: **87/87 passed**.
- Full CaptainPad suite before the final memo-only refinement: **2555 passed,
  6 skipped, 0 failed** across 141 files.
- Final full-suite rerun after that refinement: every Mixer test passed; the
  run was red only in concurrent COLORS work (`livePaletteStates` mirror /
  undefined reference and stale Colors wiring guards). **137/141 test files
  passed**. This lane did not touch those overlapping files.
- `npx tsc --noEmit`: **passed cleanly** before concurrent COLORS work changed
  `components/deck/colors_window.tsx`; repeat is currently blocked only by its
  unrelated `WriterGate.reason` diagnostics at lines 151 and 154. Mixer has no
  TypeScript diagnostic.
- `npm run lint`: **0 errors**. The first pass had 9 pre-existing warnings;
  concurrent COLORS edits raise the current total to 12, none in Mixer files.
- `npm run web:build`: **passed**; 29 static routes exported, including
  `/mixer`.
- Real `yoga-layout` coverage executes iPad-landscape and desktop rows at
  1, 2, 3, 4, and 5 channels; dynamic add/remove; custom padding/gaps; a fixed
  COLORS-width citizen; an expanded group with real padding/borders; exact
  equality; the 320-point floor; the 50% cap; and overflow.

## Visual gate

The approved in-app browser opened the existing `:6967/mixer` read-only after
the build. That live page currently reports zero channels, so honest 2-, 3-,
and overflow-case screenshots cannot be captured without either mutating the
operator engine or launching an isolated scratch service. Both actions were
explicitly out of scope. The browser tab was closed and no mutation occurred.

Web and iPad-landscape screenshots for 2, 3, and overflow therefore remain the
only open acceptance evidence. A geometry-only mockup would not be reported as
product acceptance.

## Manual smoke path

1. Open Mixer in iPad landscape with COLORS hidden.
2. Show one channel: it should be centered at half the usable row width.
3. Show two channels: both should have exactly equal width and fill the row
   after the center gap, with no horizontal scroll.
4. Add a third channel: all three should immediately become the same new width.
5. Add channels until equal fit is below 320 points: every card should remain
   exactly 320 points and horizontal scrolling should reach the final card.
6. Remove channels back to two: both survivors should immediately expand to the
   same 50/50 width.
7. Repeat with an expanded group, a collapsed group, and COLORS visible; no card
   may differ in width, clip, or become unreachable.
