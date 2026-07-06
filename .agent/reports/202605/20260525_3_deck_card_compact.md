# Slot 3 — deck_card_compact

- **Branch:** dev/claude/deck_card_compact
- **Parent branch:** dev/summer_camp_readiness (SHA 97a3267)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/deck_card_compact
- **Slot ports:** engine 31368, sim 31369/31370/31371/31372, OSC 31300, Metro 31381 (none booted — UI-only change)

## Scope

Operator asked to "move the AUTOPILOT and DECK TRANSITIONS titles into
the cards" and to compact those two cards "specifically vertically, right
now it's wasting a lot of space vertically".

Both cards previously rendered their title as a free-standing
`SpaceGrotesk_700Bold / 12pt / secondary` label *above* the card, with a
generous 8px gap, plus generous internal padding (12) and gap (12), plus
a generous bottom margin (16 / 32). On a typical iPad-landscape deck pane
that wasted ~40–60px of vertical real estate per card before the operator
even touched anything.

This slice:

1. Removed the free-standing "AUTOPILOT TRANSITIONS" header above the
   autopilot card and hoisted a compact `labelCaps`-style header
   (`SpaceGrotesk_700Bold / 10pt / 1.2 tracking / secondary / uppercase`)
   *inside* the card, on the same row as PLAY/PAUSE — no dedicated
   header row, zero extra vertical height.
2. Same treatment for "DECK TRANSITIONS" — header now lives on the same
   row as ON/OFF + the style picker (shortened to "DECK TX" so it fits
   on the row without crowding the picker dropdown).
3. Reduced card vertical padding from 12 to `paddingTop 6 / paddingBottom 8`
   in both cards.
4. Reduced inter-row `gap` from 12 to 6.
5. Reduced TimerPillBar internal label `marginBottom` from 6 to 3
   (this affects only the DURATION label inside DECK TRANSITIONS).
6. Reduced AUTOPILOT card `marginBottom` from 16 to 12 and DECK
   TRANSITIONS card `marginBottom` from 32 to 16.
7. Kept all tappable controls (PLAY/PAUSE, SHUFFLE, ON/OFF, style picker
   dropdown, every pill) at ≥ 28–36pt visual height with the original
   12–14pt internal touch padding plus the system tap target. The
   shuffle row in DECK TRANSITIONS uses RN `hitSlop` to add 8pt
   on every side so its effective hit area is still operator-friendly
   even though its visual height is the smallest of the bunch.

## Measured height comparison (iPad landscape, inline-style math)

### AUTOPILOT card

| | Before | After | Delta |
|---|---|---|---|
| External header (12pt + 8mb) | 20px | 0 | -20 |
| Card paddingV | 24 | 14 | -10 |
| Row1 (PLAY+SHUFFLE) | 32 | 32 (now also carries header) | 0 |
| gap to row2 | 12 | 6 | -6 |
| Row2 (timer pills) | 32 | 32 | 0 |
| Card marginBottom | 16 | 12 | -4 |
| **Total** | **136px** | **96px** | **-40px (~29%)** |

### DECK TRANSITIONS card

| | Before | After | Delta |
|---|---|---|---|
| External header (12pt + 8mb) | 20px | 0 | -20 |
| Card paddingV | 24 | 14 | -10 |
| 2× inter-row gap | 24 | 12 | -12 |
| Row1 (ON/OFF + picker) | 36 | 32 (now also carries header + smaller paddingV) | -4 |
| Row2 (DURATION label + pills, label marginBottom 6→3) | 49 | 46 | -3 |
| Row3 (shuffle) | 24 | 26 (visual height parity; hitSlop adds tap area) | +2 |
| Card marginBottom | 32 | 16 | -16 |
| **Total** | **209px** | **146px** | **-63px (~30%)** |

Combined savings on the deck right pane: **~103px** of vertical real
estate reclaimed, with no controls removed, no functionality lost, and
no new design tokens introduced.

## Files changed

```
M  CaptainPad/app/(tabs)/index.tsx
M  CaptainPad/components/DeckTransitionControls.tsx
```

## Tests run

- **tsc (CaptainPad):** `./node_modules/.bin/tsc --noEmit` → 7 pre-existing
  errors, all in `app/(tabs)/osc.tsx`, all present on
  `dev/summer_camp_readiness` parent tip (SHA 97a3267). Zero new errors
  from this slice.
- **lint:** `npm run lint` → 17 problems (1 error, 16 warnings). Identical
  count and file list to parent tip. Zero new warnings.
- **expo bundle:** `npx expo export:embed --eager --platform ios --dev false --reset-cache`
  → "Done writing bundle output" (1373 modules, 9.4s cold / 3.6s warm).
  Bundle builds clean.
- **No server boot needed** — pure UI compaction. No engine / sim / Metro
  ports were used.

## Known gaps / follow-ups

- The shuffle row in DECK TRANSITIONS is now visually ~26pt tall (icon
  14pt + label 11pt + paddingV 6). I added `hitSlop` of 8pt on every
  side to keep the effective tap target ≥ 42pt. Operator should verify
  on real iPad that this still feels comfortable.
- The "DECK TRANSITIONS" header was shortened to "DECK TX" so it would
  fit on the same row as ON/OFF + the style-picker dropdown without
  pushing the dropdown off-screen on narrow right-pane widths. If the
  operator prefers the full word, the trade is one extra row of
  vertical space and the picker getting narrower.
- Did not introduce a shared `labelCaps` style export. The recipe
  (SpaceGrotesk_700Bold / 10pt / 1.2 tracking / secondary / uppercase)
  is duplicated inline at two sites — same as how `DeckTopBar.tsx`
  defines its own local copy. If the design system grows further, a
  central `globalStyles.labelCaps` would let us de-dupe.

## Operator action requested

Ready for review and merge. Please load the deck tab on a real iPad
landscape and confirm:

1. The AUTOPILOT label is clearly visible on the same row as PLAY/PAUSE.
2. The "DECK TX" abbreviation reads correctly to you (vs. "DECK
   TRANSITIONS" on its own line — happy to revert if you'd rather keep
   the full word).
3. The shuffle-style toggle in the DECK TRANSITIONS card still feels
   tappable (it uses hitSlop to compensate for the tight visual layout).
4. The cards feel meaningfully shorter (~30% per card, ~103px total
   reclaimed across both cards).
