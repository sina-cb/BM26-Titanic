# Slot 4 — sidebar_scroll

- **Branch:** dev/claude/sidebar_scroll
- **Parent branch:** dev/summer_camp_readiness (parent SHA d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/sidebar_scroll
- **Slot ports:** none used (CaptainPad-only static edit; no servers booted)

## Scope

Operator asked for the iPad CaptainPad sidebar (the vertical tab list in
`CustomSideBar` inside `CaptainPad/app/(tabs)/_layout.tsx`) to be scrollable
so all tab entries are reachable when the device height cannot fit every
tab at once. The brand mark block (house icon + "6969" + "CAPTAIN PAD")
must stay pinned at the top while only the tab list scrolls.

## Approach

- Replaced the `<View style={{ flex: 1, width: '100%', paddingHorizontal: 16 }}>`
  that wrapped the `state.routes.map(...)` tab buttons with a
  `<ScrollView>`. The ScrollView itself owns the `flex: 1, width: '100%'`,
  while horizontal padding plus a small top/bottom padding moved into
  `contentContainerStyle` so that the first and last items stay reachable
  (the last tab's `marginBottom: 16` plus the contentContainer's
  `paddingBottom: 32` give a comfortable 48 px tail; the existing tab
  `paddingVertical: 16` plus the contentContainer's `paddingTop: 4`
  preserves the original visual breathing room under the brand mark).
- `showsVerticalScrollIndicator={false}` per spec.
- Added `ScrollView` to the existing `react-native` import.
- Brand mark block was already a separate `<View>` sibling above the
  list, so it remains pinned at the top and does NOT scroll with the tabs.

## Files changed

```
M	CaptainPad/app/(tabs)/_layout.tsx
```

`git diff dev/summer_camp_readiness..HEAD` is a localized 4-line semantic
change (View -> ScrollView with two prop additions) plus a small batch of
incidental trailing-whitespace cleanups inside the unchanged tab button
JSX (`<IconSymbol />` and `<Text>` lines lost trailing spaces).

## Tests run

- **TypeScript:** `npx tsc --noEmit` -> no errors in
  `app/(tabs)/_layout.tsx`. Tree-wide there are 7 pre-existing errors
  (all in `app/(tabs)/osc.tsx`, see `OscPillState` shape mismatch and a
  `'stale'` literal comparison) that exist unchanged on parent SHA
  `d0ab8d1` and are out of scope for this slice.
- **Lint:** `npm run lint` -> no new errors / warnings in
  `app/(tabs)/_layout.tsx`. The two warnings still reported there
  (`'Colors' is defined but never used` line 7, and `'colorScheme' is
  assigned a value but never used` line 85) are pre-existing on parent.
  Tree-wide totals (1 error, 17 warnings) are unchanged vs. parent.
- **Bundle:** `npx expo export:embed --eager --platform ios --dev false
  --reset-cache` -> succeeded. Bundled 1372 modules in ~10.8s. Output
  written to `/var/folders/.../main.jsbundle` plus 45 asset files. No
  syntax/runtime errors emitted during bundling.
- **Sim smoke / HIL:** N/A (CaptainPad-only UI tweak; engine + sim not
  involved).

## Operator validation steps

To confirm the change works in the iPad app:

1. Boot CaptainPad in the iPad simulator or on device
   (e.g. `cd CaptainPad && npx expo start`, then press `i`).
2. The 8 tabs (Mixer, Deck, Studio, Audio, OSC, Monitor, Dimmer Rack,
   Config) appear in the left sidebar.
3. With the sidebar visible, **swipe up inside the tab list area** (the
   vertical region below the "6969 CAPTAIN PAD" header). The tabs should
   scroll up smoothly, revealing any tab that was clipped below the
   viewport (most visible on shorter device heights or when the iPad is
   in landscape with a software keyboard).
4. Confirm the header block ("house" icon, "6969" number, "CAPTAIN PAD"
   label) **stays pinned at the top** and does NOT move during the swipe.
5. Confirm there is no visible scroll indicator (we explicitly disabled
   it for a clean look).
6. Tap each tab in turn to confirm navigation still works (`mixer`,
   `index`, `studio`, `audio`, `osc`, `monitor`, `dimmer_rack`, `config`).

On a tall display (12.9" iPad in portrait) all 8 tabs already fit, so no
scrolling will be needed and the layout should look identical to before
the change. The scroll behavior kicks in automatically only when the
content exceeds the available height.

## Known gaps / follow-ups

- The bundle export warns about `FORCE_COLOR` overriding `NO_COLOR` —
  unrelated to this slice; environment noise from Expo's bundler workers.
- Pre-existing tsc + lint problems in `app/(tabs)/osc.tsx` were observed
  but not addressed (out of scope, would belong to a different slice).
- No animated scroll-to-active-tab behavior added. If a tab is currently
  selected but scrolled off-screen (e.g. after rotating), the user has to
  scroll the sidebar manually to see it highlighted. If desired, a
  follow-up could use `scrollViewRef.current?.scrollTo({ y: index *
  itemHeight, animated: true })` driven by `state.index` changes.
- Did not add fade gradients at the top/bottom of the scroll viewport;
  the sidebar background is a translucent white that already softens the
  edge visually.

## Operator action requested

Ready for review and merge.
