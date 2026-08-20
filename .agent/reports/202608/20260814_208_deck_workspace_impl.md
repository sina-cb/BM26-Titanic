# _208 — Deck windowed workspace (slice A of the _196 design): implementation

**Date:** 2026-08-14 · **Agent:** _208 (Opus, implementation) ·
**Branch:** feat/bm_readiness ·
**Contract:** `docs/53_deck_workspace_windows.md` §3 + `.agent/reports/202608/20260814_196_deck_workspace_design.md`
**Scope:** SLICE A only (CaptainPad, no engine). Slices B/C/D untouched.

## What shipped

The Deck tab is a four-window workspace. Every window can be hidden and
restored from one compact bar; a hidden window leaves the layout entirely and
the survivors reflow into its space.

| Window | Contents | Close affordance |
|---|---|---|
| PATTERNS | `DeckHueRow` + `SplitPlaylistPanes` (DECK A/B, split drag, ✕ unbind) | **none** — protected floor |
| PARAMETERS | the DECK MAIN card (EntryLabelEditor, SAVED flash, colour swatch, ◎ ALL, `GlobalParams`, toggle/momentary grid) | hide chip |
| AUTOPILOT | `PatternAutopilotPanel` (incl. nested DECK TX), `ColorAutopilotPanel`, `DeckOverlayStack` | hide chip |
| COLORS | **shell only** — `<ColorsWindow>` placeholder ("COLORS — COMING ONLINE") | hide chip; **closed by default** |

Chrome stayed outside the workspace exactly as specified: `DeckTopBar`,
`CPCControls`, the LIVE OUTPUT header + `PixelStrip`, `PlanLockBanner`,
`PlanLockScrim`, the PANIC/`RigGlobals` bottom bar, and all three modals.
The workspace bar sits inside the plan-lock content wrapper, so the hermetic
scrim freezes the window chrome along with everything else (docs/38 outranks
mid-plan re-arranging). Deck B is still hosted by `SplitPlaylistPanes`, and
its ✕ (`handleCloseSecondary`) is still the one and only engine-authoritative
unbind — minimize never touches the engine.

### Contract compliance

- **Pure layout brain.** `components/deck/deck_workspace_layout.ts` — zero
  react/react-native imports, typed reducer (`close`/`open`/`reset`, same
  reference on a no-op, throws on an unknown action type), total normalizer,
  `openWindows`/`railWindows`/`isOpen`/`canClose`/`wideFlexFor`, plus two
  contract helpers the render layer must ask rather than re-derive:
  `windowDisplay()` (the no-unmount rule) and `narrowScrollOwner()` (the
  PATTERNS-pin / `ColumnsScrollRest` rule). 27 vitest cases.
- **Never unmount.** A closed window renders with `display:'none'` on the same
  View that used to be the column — scroll offsets, `GlobalParams` slider
  state, the entry-label draft and the live WS reconciles all survive, and a
  restored window is instantly current with no refetch.
- **Persistence.** AsyncStorage `deck_workspace_layout_v1`, **closed-set only**
  — never engine state, never the split ratio, never a selection. Hydrate →
  `normalizeLayout(JSON.parse(...))`; a corrupt store `console.error`s and
  falls back to the default *view preference* (sanctioned by §3.2, not an
  engine-state fallback). Every transition writes fire-and-forget; a failed
  write logs and the in-memory layout stays authoritative. If the operator
  toggles a window before the async hydrate lands, their action wins.
- **Renormalized on load.** `{"closed":["patterns","bogus"]}` boots all-open;
  unknown ids dropped, duplicates deduped, surviving order preserved.
  `{"closed":[]}` is legitimate (all four open) — only hopeless input resets.
- **Default = today's Deck.** `DEFAULT_LAYOUT = { closed: ['colors'] }` and the
  weights are still PATTERNS 4 / PARAMETERS 3 / AUTOPILOT 3 (COLORS 3 when
  open), read through `workspace.flexFor(id)`. The window bodies are
  byte-identical to the columns they replaced (same style arrays, same
  `SectionHost`/`sectionHostProps`, every operator-ruling comment preserved).
- **Narrow mode verbatim.** PATTERNS keeps its `flexBasis` pin (incl. the
  400/500pt floors and the 38.5%-of-window height); PARAMETERS, AUTOPILOT and
  now COLORS stack inside the single `ColumnsScrollRest` ScrollView, hidden
  ones simply not laid out. No same-axis nested ScrollViews were introduced.
- **React/perf.** Module-scoped, memoized chip + bar components; stable
  zero-dependency `openWindow`/`closeWindow` callbacks (a `layoutRef` mirror
  keeps the dispatcher dependency-free); memoized open/rail derivations; no
  component-type or key changes on a toggle → no remounts; no pointer-move
  layout state; layout ops issue zero REST/WS traffic.
- **Touch/a11y.** 28pt chips + 8pt hitSlop = 44pt targets;
  `accessibilityRole="button"`, `Hide the <NAME> window` / `Show the <NAME>
  window`, `accessibilityState={{ expanded }}` on both the chips and the
  window tracks; the PATTERNS chip is a labelled static View with no handler.
  Theme tokens only (`usePalette`), no new hex literals.

## Deviations (2)

1. **Window chrome merged into the rail — no per-window header row.** The
   design offered two ways to add a minimize control at zero height (§3.3);
   both fail in this tree: a header row costs ~28pt per window (parity gone),
   and an overlaid chevron lands on live controls (◎ ALL / SAVED / colour
   swatch in PARAMETERS, PLAY/PAUSE + countdown in AUTOPILOT), which also
   violates "chrome never over interactive controls". So `DeckWorkspaceBar` is
   ONE row listing every window: open ones as hide chips (canonical order),
   then a `HIDDEN` divider, then the restore rail — closed windows in **close
   order**, as the design specifies for the rail. `DeckWindow` is therefore
   the track itself (visibility + flex + a11y), with no header. Net delta vs
   today's Deck: that single slim row (~36pt) — the same row the design
   already accepted for the default layout, since COLORS ships closed and the
   rail would have been on screen regardless. Recorded in docs/53 §3.3 as an
   "AS BUILT" note.
2. **COLORS ships as a shell** (per this assignment, not the design): the
   window, its track, its chip and its default-closed state are real; the body
   is an honest placeholder that renders no colour control and points at the
   working surfaces (globals-row COLORS, AUTOPILOT COLORS). No client-side
   stand-in, no faked wheel (P0).

## Files

New (all under `CaptainPad/components/deck/`):
- `deck_workspace_layout.ts` — the pure layout brain (contract + rules).
- `deck_workspace_layout.test.ts` — 27 vitest cases.
- `deck_workspace.tsx` — `useDeckWorkspace()` (state + hydrate/persist) and
  `<DeckWorkspaceBar>`.
- `deck_window.tsx` — `<DeckWindow>`, one track.
- `colors_window.tsx` — `<ColorsWindow>`, the slice-B mount point.

Modified:
- `CaptainPad/app/(tabs)/index.tsx` — three imports, `const workspace =
  useDeckWorkspace()`, `<DeckWorkspaceBar>` under the LIVE OUTPUT header, the
  three column `<View>`s → `<DeckWindow>` (styles passed through verbatim,
  weights via `workspace.flexFor`), and the new COLORS track after AUTOPILOT
  inside `ColumnsScrollRest`. Nothing else moved; every ruling comment intact.
- `docs/53_deck_workspace_windows.md` — the AS BUILT note in §3.3.

Untouched by design: `_layout.tsx`, anything `special_events*` (_206),
`split_playlist_panes.tsx`, `GlobalParams`, the autopilot panels — re-hosting
changed none of their behaviour.

## Tests + results

- `npx vitest run components/deck/deck_workspace_layout.test.ts` → **27/27
  pass**. Coverage: default all-open-but-COLORS; minimize PARAMETERS; minimize
  AUTOPILOT; restore order deterministic (rail = close order, tracks =
  canonical order); protected PATTERNS unremovable (same-ref close, purge on
  hydrate, open in all 8 reachable layouts); single window fills; no empty
  tracks across every reachable subset; invalid/duplicate/hand-edited
  persisted ids rejected or normalized (21-entry junk fuzz table, never
  throws, never returns the frozen constant); JSON round trip;
  no-unmount display contract; narrow-mode scroll ownership; frozen default;
  key pinned at `deck_workspace_layout_v1`.
- **Full suite:** `npx vitest run` → **1210 passed, 6 skipped, 9 failed**. All
  9 failures are in `CaptainPad/utils/special_events_api.test.ts`, an
  **untracked, mid-flight file from agent _206** (`fireSpecialEventEffect is
  not a function` — the implementation is still being written). Zero failures
  in any file I touched; the deck/workspace suites are green.
- `npx tsc --noEmit` → clean.
- `npx eslint` on all five new files + `index.tsx` → clean.
- `npm run web:build` → **Exported: dist** (includes _206's `/special_events`
  route — shared tree, expected).
- Behaviour items on the design's list that need the running stack (no remount
  on minimize/restore, playlist scroll survival, Deck B stays bound, plan-lock
  and deck-swap behaviour, no new WS/API traffic) are left to the validator —
  this agent never serves; the coordinator owns ports 6966–6972.

## The COLORS mount point (for the follow-up agent)

Everything below already exists and compiles; slice B is a body swap.

- **File:** `CaptainPad/components/deck/colors_window.tsx`. Keep the module
  path and the `ColorsWindow` export name — the deck screen imports exactly
  that. Replace the placeholder body with the hue ring + preset chips + slots.
- **Current interface:** `export interface ColorsWindowProps { disabled?:
  boolean }` — today wired as `disabled={isConnected === false || planGate}`.
- **Mount site:** `CaptainPad/app/(tabs)/index.tsx`, the `WINDOW 4 — COLORS`
  block (search `<DeckWindow id="colors"`), the last child of
  `<ColumnsScrollRest>`. The body already sits inside the same
  `<SectionHost dataSet={{layouthost:"section"}} {...sectionHostProps}>` the
  PARAMETERS/AUTOPILOT columns use, so the window scrolls in wide mode and is
  content-sized in the narrow stack. **Note for the wheel:** in wide mode that
  SectionHost is a ScrollView — verify the wheel's PanResponder against it
  (`onMoveShouldSetPanResponder` claiming the gesture) before shipping.
- **Props slice B will need to add at that one call site** (both already exist
  in the deck screen, no new state and no new fetch): `colorAutopilot` (the
  `DeckColorAutopilotConfig` state) for the §4.4 single-writer read-only gate,
  and `onColorAutopilotChange={handleColorAutopilotChange}` for the explicit
  "ROTATION IS DRIVING — TAP TO PAUSE" post. Palette read/write stay
  self-contained inside the component (`useSharedParamValues` +
  `updateParamCenter`, `getCachedColorPalettes`).
- **No layout work needed:** the window id `'colors'`, its chip, its
  default-closed state and its wide weight (3) are already in
  `deck_workspace_layout.ts`. If the operator later wants COLORS open by
  default, that is a one-line change to `DEFAULT_LAYOUT` (docs/53 §9 decision
  1) — and it becomes a visible 4/3/3/3 default row.

## Screenshot matrix for the validator

Fresh dist on :7167 only (never the coordinator's stack). Compare #1 against a
pre-change capture of the same commit's parent.

| # | State | Widths |
|---|---|---|
| 1 | Default layout — PATTERNS/PARAMETERS/AUTOPILOT open, COLORS on the HIDDEN rail; the only delta vs today must be the one chip row | iPad landscape + narrow portrait |
| 2 | PARAMETERS hidden — two-window reflow, no empty track, chip moved to HIDDEN | wide |
| 3 | Only PATTERNS open (PARAMETERS + AUTOPILOT hidden) — single window fills | wide + narrow |
| 4 | COLORS restored — shell card visible as the 4th track (wide) / last in the stack (narrow) | wide + narrow |
| 5 | Restore rail with 2+ chips | wide + narrow |
| 6 | Plan lock engaged — scrim blankets the bar and every window | wide |
| 7 | Hand-seeded `deck_workspace_layout_v1 = '{"closed":["patterns","bogus"]}'` → boots all-open, store renormalized | wide |

Plus the no-remount proof (not a screenshot): scroll the PARAMETERS column and
edit a slider, hide it, restore it — same scroll offset and value, and no
`/deck/...` traffic in the network log during the toggle.
