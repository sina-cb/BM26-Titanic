# 20260725_130 — Dimmer Rack: desktop (mouse) horizontal scroll

**Agent:** developer (CaptainPad) · **Branch:** feat/bm_readiness · **Status:** done, not committed (no git ops per brief)
**Follows:** `20260725_122_dimmer_rack_hscroll.md` (+ addendum, portrait 2-row grid)

## What was wrong (operator report 2026-08-03: "scroll doesn't work on computer")

_122 made the fader row a horizontal `ScrollView`, verified on iPad-style
TOUCH viewports. On a desktop browser with a mouse the row was effectively
frozen. Reproduced first on a fresh pre-fix dist (:7167), 1600x900 desktop
viewport, real CDP mouse events, no touch emulation (scratchpad
`dimmer_rack_desktop_repro.cjs`):

| Desktop gesture | Pre-fix result |
|---|---|
| Plain vertical mouse wheel over the row (THE desktop gesture) | dead — `scrollLeft` pinned at 0; browsers drop `deltaY` on a horizontal-only scroller |
| Scrollbar | hidden (`scrollbar-width: none` from `showsHorizontalScrollIndicator={false}`) — zero affordance, nothing to grab |
| Mouse click-drag in the gaps | dead (browsers never mouse-pan scroll containers) |
| Shift+wheel (Chrome axis swap → `deltaX`) | works |
| Trackpad two-finger horizontal pan (`deltaX`) | works |
| Mouse drag ON a knob | correctly captured by the fader, row never scrolls |

So the only working desktop inputs were the two nobody reaches for first,
and there was no visual hint the row scrolls at all. (The _122 "mouse
wheel scrolls" debug probe evidently dispatched horizontal deltas — a
plain `deltaY` wheel does nothing, confirmed above.)

## The fix

Two files:

- **`CaptainPad/utils/wheel_scroll_logic.ts`** (new, pure) —
  `wheelToHorizontalDelta({deltaX, deltaY, deltaMode}, pageSizePx)`:
  vertical-dominant wheel deltas map onto the horizontal axis (pixel 1:1,
  line ×40, page ×row width); horizontal-dominant or empty events return
  `null` meaning "leave it to native handling". Ties go to native.
- **`CaptainPad/app/(tabs)/dimmer_rack.tsx`** —
  - Web-only `useEffect` (gated `Platform.OS === 'web'` + row mounted)
    attaches a non-passive `wheel` listener to the ScrollView's DOM node
    (`getScrollableNode()` — throws loudly if ref/node missing, no silent
    no-scroll fallback). `deltaY`-dominant events → `preventDefault()` +
    `scrollLeft += delta`; `deltaX`-dominant events fall through to the
    browser (trackpad pan / shift+wheel keep native behavior).
  - `showsHorizontalScrollIndicator={Platform.OS === 'web'}` — the native
    scrollbar is the visible, grabbable desktop affordance. Native touch
    keeps the indicator hidden exactly as in _122.
  - `faderDraggingRef` mirrors the existing `faderDragging` state (DOM
    listener would close over stale state); the wheel handler ignores
    events mid-knob-drag, so the mouse gets the same gate the touch path
    has. `onDragStart`/`onDragEnd` now flip ref + state via two stable
    callbacks.
- **`CaptainPad/utils/wheel_scroll_logic.test.ts`** (new) — 8 vitest cases
  covering pixel/line/page modes, sign, dominance, tie, and empty-event
  null.

**Deliberately NOT added:** click-drag panning on the row gaps. The
scrollbar + wheel fully cover desktop, and container-level mouse-drag
capture would sit directly on top of the faders' capture-claimed
PanResponder — gesture-conflict risk for zero remaining need.

## Verification (fresh post-fix dist on :7167, operator's :6967 untouched)

Script: scratchpad `dimmer_rack_desktop_fix_verify.cjs` (puppeteer, one
page at a time, console muted via `evaluateOnNewDocument`). Engine: :6968
(the morning engine had gone down; started `node engine.js --model titanic
--pattern 01_cylon_sweep` — still running for the operator, note below).

### Desktop 1600x900, mouse only

| Check | Result |
|---|---|
| Plain vertical wheel (6×120) | `scrollLeft` 0 → **720** (was 0 pre-fix) |
| Wheel back up (3×-120) | 720 → 360 |
| Trackpad horizontal `deltaX` (native path untouched) | 0 → 480 |
| Scrollbar | `scrollbar-width: auto` (was `none`); overlay gutter 0px → no layout shift |
| Mouse knob drag (down) | value 1.00 → 0.43, `scrollLeft` stayed 0 |
| Vertical wheel fired MID-knob-drag | ignored (`scrollLeft` 0) — the gate works for mouse |
| Wheel after drag release | scrolls again (0 → 360) |

### iPad touch re-verification (_122 checks)

| Check | Landscape 1194x834 | Portrait 834x1194 |
|---|---|---|
| Fader track rows | **1** (tops: 523) | **2** (tops: 576 / 831) |
| Overflow | 2680 vs 952 | 1340 vs 592 (halved) |
| Touch swipe in gap | `scrollLeft` 0 → 379 | 0 → 406 |
| Touch diagonal drag ON knob | 0.43 → 0.83, `scrollLeft` stayed 0 | 0.83 → 0.43, `scrollLeft` stayed 0 |

Screenshots (visually inspected): `.agent_renders/dimmer_rack_desktop_left.png`,
`dimmer_rack_desktop_wheeled.png` (row advanced 720px, later groups
visible), `dimmer_rack_ipad_landscape_{left,swiped}.png`,
`dimmer_rack_ipad_portrait_{left,swiped}.png` (2-row grid intact).

**Engine restore:** knob drags wrote section 3 only; script diffed
`/dimmers` before/after and POSTed originals back — `fullyRestored: true`.

## Quality gates

- `npx tsc --noEmit`: pass (exit 0)
- `npx vitest run`: **939 passed / 6 skipped** = post-_128 baseline 931 + 8
  new wheel-logic tests, zero new failures
- `npx eslint` on the three touched files: clean
- `npm run web:build`: pass (both pre-fix repro dist and post-fix dist)
- `git diff --check -- CaptainPad`: clean

## Environment notes for the operator

- The engine that was on :6968 this morning was found dead before
  verification; a fresh `node engine.js --model titanic --pattern
  01_cylon_sweep` was started (and left running) plus a static dist server
  on :7167. Kill either whenever; engine runtime-state residue in
  `marsin_engine/states/` is the usual expected side effect.
- On Windows/Chrome with classic (non-overlay) scrollbars the row shows a
  persistent horizontal scrollbar on web — that is the intended desktop
  affordance; headless verification measured a 0px gutter (overlay), so no
  layout shift either way.
