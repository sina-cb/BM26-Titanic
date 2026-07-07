# Slot 1 — mixer_trans_no_kbd

- **Branch:** dev/claude/mixer_trans_no_kbd
- **Parent branch:** dev/summer_camp_final_push
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/mixer_trans_no_kbd
- **Slot ports:** engine 31168, sim 31169, save 31170, sACN bridge 31171, sACN out 31172, OSC 31100, Metro 31181 (not booted — UI-only change)

## Scope

Operator (Sina) asked to kill the on-screen keyboard for the mixer tab's
per-channel transition-time control. The old UI was a numeric `TextInput`
(seconds, parseFloat) inside `ChannelStrip`'s transitionBar — every edit
popped the numeric keyboard, which is hostile to fingertip operation
mid-show.

Replaced it with a touch-only horizontal `TimerPillBar` of preset
durations, matching the deck's transition-duration picker. Operator now
has a single mental model for "show timing" across deck and mixer.

## Files changed

```
M  CaptainPad/app/(tabs)/mixer.tsx
M  CaptainPad/components/DeckTransitionControls.tsx
A  .agent/02_reports/202605/20260527_1_mixer_trans_no_kbd.md
```

Concrete changes:

- `mixer.tsx`
  - Imported `TimerPillBar` + `TRANSITION_DURATION_PRESETS_MS` from
    `@/components/DeckTransitionControls`.
  - Replaced the string `transTime` state with numeric ms-integer
    `transTimeMs` so the pill bar's `value === preset` equality check
    lights up the active pill. Initial value derived from
    `channel.transitionTime * 1000`. Codex P0: if `transitionTime` is
    missing/non-finite, `ChannelStrip` now throws (no silent 1.0
    fallback).
  - Removed the `TextInput` + trailing "s" label from `transitionBar`.
    The transition-style dropdown is now sized `minWidth: 88` and the
    `TimerPillBar` fills the remaining flex.
  - `onTransition(...)` and `onTransitionSettingsChange(...)` still
    receive `transitionTime` in **seconds** (float) — only the input
    widget changed; the engine wire format and `handleTransition*`
    callbacks are untouched.
- `DeckTransitionControls.tsx`
  - Added a `compact?: boolean` prop to `TimerPillBar` (smaller min
    width / padding / font / gap). Default `false` preserves the deck
    panel's roomier sizing. Mixer passes `compact`.

The one remaining `TextInput` in `mixer.tsx` is the channel-name editor
on line 228 — unrelated to transitions, intentionally left alone per the
brief.

## Tests run

- Unit: none touched.
- Integration / HIL: none.
- Sim smoke: not booted (UI-only change, no engine/sim required).
- CaptainPad:
  - `npx tsc --noEmit` — pre-existing baseline (2 errors in
    `components/Modulation.tsx` for `transitionDuration` on `ViewStyle`,
    unrelated to this branch). **Zero new errors from mixer.tsx or
    DeckTransitionControls.tsx.**
  - `npm run lint` — `0 errors, 13 warnings`, all pre-existing
    (`mixer.tsx:696` exhaustive-deps + `mixer.tsx:880` unused `fader`
    are baseline). No new warnings.
  - `npm run web:build` — skipped; no route, asset, or web-visible
    plumbing changed (component swap inside an existing tab).

Manual smoke path for the operator:

1. Open CaptainPad → MIXER tab.
2. Add or select any non-deck channel.
3. Scroll to the bottom of the strip — the transition bar row.
4. Tap the `[duration ms]` pills (200ms, 500ms, 1s, ... 15s). Active
   pill should fill purple; **no keyboard should appear**.
5. Tap **Transition** — confirm the engine actually crossfades over the
   selected duration (e.g. pick `5s`, watch the next playlist entry
   ease in over five seconds).
6. Reload the tab; the previously-selected pill should still be active
   (pulled from `channel.transitionTime` on mount).

## Known gaps / follow-ups

- The `transTimeMs` state is local to the strip and only syncs from
  `channel.transitionTime` at mount time (matches the prior `transTime`
  behavior). If the operator changes the transition time via API/OSC
  while the strip is mounted, the active pill will lag until remount.
  Out of scope per "don't refactor `ChannelStrip` beyond the swap".
- The `compact` prop on `TimerPillBar` is binary; if more strips want
  intermediate sizing, promote to a size literal (`'sm' | 'md' | 'lg'`).
- The channel-name `TextInput` (mixer.tsx:228) still pops the keyboard.
  Flagged in the brief as out of scope; if the operator wants it gone
  too, that's a separate slice.

## Operator action requested

Ready for review and merge.

---

# Round 2 — vertical wheel (2026-05-27)

Round 1 (above) replaced the keyboard-driven `TextInput` with the
horizontal `TimerPillBar`. That merged. Operator then asked to swap
the mixer transition-time control again — this time to a **vertical
wheel picker**, modeled after the iPhone alarm/clock time spinner.
The deck's `TimerPillBar` stays untouched (operator only asked about
the mixer).

## What changed

- **NEW**: `CaptainPad/components/ui/TimerWheel.tsx` — shared vertical
  wheel picker. API mirrors `TimerPillBar`:
  `{ presets, value, onChange, formatter, label? }`. Plain RN
  `Animated.FlatList`, no reanimated worklets (kept the dep surface
  minimal even though `react-native-reanimated@~4.1.1` is already a
  CaptainPad dep via `parallax-scroll-view.tsx`).
- **EDIT**: `CaptainPad/app/(tabs)/mixer.tsx` — `ChannelStrip` now
  renders `<TimerWheel ... />` instead of `<TimerPillBar ... compact />`.
  The surrounding `transitionBar` row, the `transTimeMs` state, the
  Codex P0 throw on missing `channel.transitionTime`, and the
  `onTransitionSettingsChange(channelId, { transitionTime: ms/1000 })`
  wire format are all unchanged.
- `TRANSITION_DURATION_PRESETS_MS` is still the single source of truth
  for preset values — imported from `@/components/DeckTransitionControls`.

## Sizing / visuals

- **Total height**: 96 px (3 visible rows × 32 px). Sits at the bottom
  of the channel strip, fits inside the existing `transitionBar` row
  without forcing a layout overflow.
- **Center band**: 32 px highlight at vertical center, `C.primary` at
  10% fill + 35% border. Selected preset text → `C.primary`.
- **Opacity gradient** (relative to centered slot):
    centered = 1.0, ±1 row = 0.45, ±2+ rows = 0.18 (clamped).
- **Scale gradient**: 1.0 → 0.92 → 0.85 — gives the soft "wheel"
  perspective without needing a 3D transform.
- **Font**: SpaceGrotesk_700Bold @ 13 px (matches `valueReadout` from
  the strip so it visually reads as the same family).
- Colors from `Colors.light` (`C.primary`, `C.text`, `C.icon`,
  `C.ghostBorder`, `C.surfaceContainerLowest`) — no hex literals.

## Snap math (recorded for posterity)

- `ROW_HEIGHT = 32`, `VISIBLE_ROWS = 3`, `WHEEL_HEIGHT = 96`.
- FlatList `contentContainerStyle.paddingVertical = ROW_HEIGHT` so the
  first and last preset can scroll into the center slot.
- `snapToInterval = ROW_HEIGHT`, `decelerationRate = 'fast'`,
  `getItemLayout` keeps `initialScrollIndex` fast + jitter-free.
- `onMomentumScrollEnd` computes `idx = clamp(round(y / ROW_HEIGHT))`
  and dispatches `onChange(presets[idx])`. Tap-to-select calls
  `scrollToOffset({ animated: true })` + the same dispatch.

## "Value doesn't match a preset" — the call I made

Codex P0 forbids fallback behaviors that silently substitute values.
But the wheel needs *some* visual answer when the engine reports a
value (e.g. 750 ms from a REST PATCH) that isn't in the preset list.
The call:

- The wheel **visually** highlights the nearest preset (so the operator
  sees something coherent in the center band on mount).
- The wheel does **NOT** call `onChange` to substitute that value
  back to the engine. The engine keeps its 750 ms until the operator
  flicks/taps a preset, at which point `onChange(preset)` fires
  through the existing `onTransitionSettingsChange` callback and the
  engine sees a real preset value.
- The upstream `ChannelStrip` already throws loudly (round 1
  behavior preserved) when `channel.transitionTime` is missing or
  non-finite, so the only "off-preset" path is the legit-but-rounded
  case above.

I also added a hard throw in `TimerWheel` itself if `presets` is
empty/missing — fail loud at the call site instead of silently
rendering an empty scroll surface.

## Tests run (round 2)

- `npx tsc --noEmit` — same 2 pre-existing errors in
  `components/Modulation.tsx` (`transitionDuration` on `ViewStyle`),
  zero new errors.
- `npm run lint` — 0 errors, 13 warnings — **identical to baseline**.
  No new warnings from `TimerWheel.tsx` or my `mixer.tsx` edits.
- `npm run web:build` — skipped; component swap inside an existing
  tab, no route/asset/yaml plumbing changed.
- Sim / engine — not booted (UI-only change).

## Manual smoke (what the operator should try)

1. CaptainPad → MIXER tab → add or select any non-deck channel.
2. Scroll to the strip's bottom transition row.
3. **Flick** the new vertical wheel up/down — it should snap to a
   preset, center band stays put, faded rows scroll behind it.
4. **Tap** a partially-visible row (above or below center) — it
   should animate to center and become the new selected value.
5. **Tap "Transition"** — engine should crossfade over the newly-
   selected duration. Pick `5s`, watch the next playlist entry
   ease in over five seconds.
6. **No keyboard** should ever pop up while interacting with the
   wheel (the only `TextInput` left in `ChannelStrip` is the
   channel-name editor, intentionally untouched).
7. Reload the tab → the previously-selected preset should still be
   in the center band on first paint
   (`initialScrollIndex = nearestIndex`).

## Judgment calls (round 2)

- **Plain `Animated` over `react-native-reanimated`**: reanimated is
  available, but `Animated.event` with `useNativeDriver: true` is
  enough for opacity/scale interpolation on a 3-row wheel. Avoiding
  a worklet keeps the file readable and Metro's bundle dep graph
  the same as before.
- **96 px tall**: at the top of the operator-specified range
  (96–120 px). I picked the low end so the strip's vertical budget
  stays slack — the strip already has the header, level row, body
  (playlist + params), mute/solo row, and now this row. Going to
  120 would steal ~24 px from the body's flex.
- **Did not touch the deck's `TimerPillBar`**: brief was explicit
  that the deck control stays. `TimerPillBar` is still exported
  from `DeckTransitionControls.tsx` and still consumed there +
  by `AutopilotTimerPills`.
- **`useEffect` with `eslint-disable-next-line` for the
  `selectedIndex` dep**: the effect intentionally reacts only to
  upstream `value`-driven `nearestIndex` changes (not to our own
  internal snap updates that set `selectedIndex` first). Putting
  `selectedIndex` in deps would cause a feedback loop on every
  user flick. Inline-disable + comment is the right call here.

---

# Round 3 — compact single-row (2026-05-27)

Round 2 (above) shipped a 3-row, 96 px tall vertical wheel. Operator
came back with: *"no, I don't want it tall, just show a tiny
indication that it can be scrolled, and only show 1 item to not
waste vertical space in the mixer tab please"*. So the wheel keeps
its scroll/snap mechanism but the visible window shrinks to one row,
plus a subtle "this is scrollable" affordance.

## What changed

- **EDIT only**: `CaptainPad/components/ui/TimerWheel.tsx`. No
  changes to `mixer.tsx` — the external API
  (`{ presets, value, onChange, formatter, label? }`) is unchanged
  so the call site keeps working as-is.
- `VISIBLE_ROWS` dropped from `3` → `1`. `WHEEL_HEIGHT` is now
  `32 px` (one `ROW_HEIGHT`). Matches the mode-dropdown `height: 32`
  in `mixer.tsx`'s `transitionBar`, so the wheel reads as a peer to
  its row-mates instead of a giant block.
- The `centerBand` highlight `<View>` is **removed**. With only one
  visible row, there's nothing to highlight against — the row IS
  the center. The selected preset still paints in `C.primary`
  (via `rowTextCenter` style) so it reads as the active value.
- `listContent.paddingVertical` dropped from `ROW_HEIGHT` → `0`. With
  a 1-row window the first preset already sits in the visible slot
  at `scrollY = 0`; the last preset at `scrollY = (N-1)*ROW_HEIGHT`.
  Adding padding would have broken the snap math.
- **Scroll affordance** — two thin ticks (`8 px × 1.5 px`,
  `opacity 0.35`, color `C.icon`, `borderRadius` for soft caps),
  centered horizontally, positioned `top: 3` / `bottom: 3` inside
  the wheel frame. `pointerEvents="none"` so they never steal a
  flick gesture.

## Affordance — which variant and why

Brief listed three options: tiny chevrons (`chevron.up`/`chevron.down`
SF Symbols), thin tick marks, or "whichever". I went with **tick
marks** for two reasons:

1. **No icon mapping churn**: the project's `IconSymbol` wrapper
   doesn't currently map `chevron.up` / `chevron.down`. Adding two
   entries to `icon-symbol.tsx` for a 1.5 px decoration is more
   surface than the affordance is worth.
2. **Pixel-exact, platform-uniform**: two `<View>` rectangles render
   identically on iOS, Android, and web. SF Symbol chevrons would
   render via Material Icons on Android/web (different baseline,
   different stroke weight), making the affordance subtly different
   per platform.

The ticks read as "this control has more above and below" without
shouting. They're small enough to disappear at a glance but visible
enough on close inspection that the operator knows to flick.

## Sizing recap

- **Wheel height**: `32 px` (was 96).
- **Row height**: `32 px` (unchanged).
- **Tick**: `8 × 1.5 px`, opacity `0.35`, inset `3 px` from edges.
- **Font**: SpaceGrotesk_700Bold @ 13 px (unchanged).
- **Selected color**: `C.primary` (unchanged).

## What I did NOT change

- Snap / scroll / `onMomentumScrollEnd` / tap-to-select logic.
- `Animated.event` opacity+scale interpolation on the row — kept
  cheap and native-driven; mid-flick a row sliding through the
  viewport still gets a soft fade-in/fade-out as it passes,
  which is the only mechanism left now that the off-row neighbors
  aren't visible.
- The Codex P0 throw on empty `presets`.
- The "value not in preset list → visual nudge only, no silent
  `onChange`" behavior.
- The mixer call site (`mixer.tsx` line ~456 `<TimerWheel ... />`).
  Operator-confirmed brief: external API stays.
- The deck's `TimerPillBar`.

## Tests run (round 3)

- `npx tsc --noEmit` — same 2 pre-existing errors in
  `components/Modulation.tsx` (`transitionDuration` on `ViewStyle`),
  zero new errors from this branch.
- `npm run lint` — `0 errors, 13 warnings` — **identical to
  baseline**, no new warnings from `TimerWheel.tsx`.
- Sim / engine — not booted (UI-only change).
- Web build — skipped; no route/asset/yaml plumbing changed.

## Manual smoke (what the operator should try)

1. CaptainPad → MIXER tab → add or select any non-deck channel.
2. The transition row now shows: `[Transition button]` `[MODE ▾]`
   `[single-row wheel with tiny ticks top+bottom]` — all the same
   height, no vertical block stealing strip space.
3. **Flick** the wheel up/down — the visible value rolls to the
   next/previous preset and snaps.
4. **Tap** the wheel — feedback flicker (since the only visible row
   IS the selected one, the tap-to-select handler still fires; it's
   a no-op if the value didn't change).
5. **Tap "Transition"** — engine still crossfades over the selected
   duration.
6. Tiny top/bottom tick marks should be visible but not loud —
   if they shout for attention, drop their opacity from 0.35.
