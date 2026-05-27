# Slot 3 — deck_density_optimization

- **Branch:** dev/claude/deck_density_optimization
- **Parent branch:** dev/summer_camp_readiness (parent SHA d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/deck_density_optimization
- **Slot ports:** engine 31368, sim 31369, metro 31381 (no servers actually started — change is UI-only, verified via `expo export:embed`)

## Scope

Operator reported that in the Deck tab's horizontal (landscape) layout the
playlist panel only shows two pattern rows because the right column of
the left pane is dominated by the audio-reactivity additions and the
Rig globals strip. They wanted (a) more rows visible at once, and (b)
the existing REFRESH / RECONNECT button moved to the top of the
playlist as a tiny refresh-arrow icon button.

Three small, surgical changes were made to address this without
touching any pattern / engine logic:

1. **PlaylistPanel** — tightened the "non-compact" sizing tokens
   (`rowPadY`, `rowPadX`, `rowGap`, fonts, panel padding) so each
   entry row is roughly 25 % shorter while keeping the full-row
   `<TouchableOpacity flex:1>` tap target intact (well over 44 pt
   total once you include the row's vertical padding + surrounding
   gap). Added an optional `onRefreshConnection` prop that, when
   provided, renders a small `arrow.clockwise` icon button in the
   panel header (top-right).
2. **RigGlobals** — compacted the `'deck'` variant: dropped the 20pt
   `globalStyles.headline` for a single 10pt section label, dropped
   buttons from 50 pt height to 34 pt, removed `ambientShadow`,
   removed the disabled placeholder slot, and tightened all the
   surrounding padding. The `'mixer'` variant is unchanged.
3. **app/(tabs)/index.tsx** — wired `connectToEngine` through as
   `onRefreshConnection`, removed the now-redundant full-width
   REFRESH/RECONNECT button below the playlist, and reduced the
   left-pane padding (24 → 14) to give the playlist + Rig globals
   strip more room.

All colours/fonts come from `Colors.light.*` / `globalStyles.*`. No
new hex codes were introduced.

## Files changed

```
M  CaptainPad/app/(tabs)/index.tsx
M  CaptainPad/components/PlaylistPanel.tsx
M  CaptainPad/components/RigGlobals.tsx
```

## Tests run

- **Unit / HIL:** none — UI-only RN component edits, no engine code
  path touched.
- **`npx tsc --noEmit`:** passes for my changes. Only 7 pre-existing
  errors in `app/(tabs)/osc.tsx` remain (unrelated to this slice —
  they exist on the parent branch tip, confirmed via `git status`
  showing only the three deck files modified).
- **`npm run lint`:** my edits add **zero** new warnings or errors.
  The repo-wide totals (1 error in `audio.tsx`, 18 warnings across
  many files) are all pre-existing. The two warnings reported on the
  files I edited (`PlaylistPanel.tsx:278` "Array<T>" + `RigGlobals.tsx:54`
  "unused 'e'") are both pre-existing and outside my diff hunks.
- **`npx expo export:embed --eager --platform ios --dev false --reset-cache`:**
  succeeded — bundle built and 45 assets copied:

  ```
  iOS Bundled 14424ms node_modules/expo-router/entry.js (1372 modules)
  Writing bundle output to: /var/folders/.../main.jsbundle
  Copying 45 asset files
  Done writing bundle output
  ```

- **Manual smoke (operator validation steps on iPad landscape, 11"):**
  1. Open the **Deck** tab in landscape orientation.
  2. In the **left column**, confirm the playlist panel shows
     **at least 5 pattern rows** simultaneously (previously 2). On a
     populated playlist there should now be a clearly scrollable
     list that fills the column.
  3. In the playlist panel **header (top-right)** confirm a small
     circular refresh-arrow icon button. Tap it — it should trigger
     the engine reconnect (same effect as the old full-width
     "REFRESH / RECONNECT" button). When offline, the OfflineBanner
     above the panel should appear; tapping refresh should clear it
     once the engine is back.
  4. The old full-width REFRESH / RECONNECT pill button **should be
     gone** from below the playlist.
  5. Below the playlist, **RIG GLOBALS** should appear as a compact
     single-line label followed by a tight row of 5 pill buttons
     (`VINTAGE WHT`, `BLAST WHT`, `UV BLAST`, `FOGGER`, `BLACKOUT`)
     at ~34 pt height. The placeholder `---` slot is gone.
  6. Tap any rig globals button — colour should toggle (primary →
     filled). Tap BLACKOUT — should turn red and engage blackout.
  7. Tap any playlist row — the row should highlight in primary
     (active) and the engine should switch patterns.

## Known gaps / follow-ups

- The pre-existing TypeScript errors in `app/(tabs)/osc.tsx` should
  be fixed at some point, but they are outside this slice.
- Density was achieved primarily by shrinking *visual* row chrome,
  not by removing per-row metadata. Operators who want even more
  rows could optionally hide the secondary `pattern · N params`
  subtext line — but that's a stronger UX trade and was not asked
  for, so left alone. The full-row tappable `TouchableOpacity` plus
  ~5 pt vertical padding means each row is still a comfortable
  ~44 pt tap target on a finger-driven iPad even at the new sizes.
- The mixer-tab path (`PlaylistPanel` with `compact={true}`) was not
  changed — only the deck non-compact path was tightened, so the
  per-channel strip layout in the mixer is unaffected.

## Operator action requested

Ready for review and merge.
