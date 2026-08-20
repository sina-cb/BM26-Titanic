# _282 — PALETTE TURNS: the COLORS window's render cost, measured and cut

**Date:** 2026-08-16
**Branch:** `feat/bm_readiness`
**Scope:** `CaptainPad/components/deck/colors_window.tsx`,
`CaptainPad/components/deck/hue_wheel.tsx`,
`CaptainPad/components/deck/colors_window_wiring.test.ts` (new `_279` guard block).
**Engine restart:** **NOT required** — client-side rendering only. Nothing
engine-side changed, and nothing about what gets posted or when.
**CaptainPad rebuild:** **REQUIRED** (rebuild-pad).

---

## The operator's report

> "the color wheel is amazing! magic! in the palette turn mode, there's a bit
> of lag in the UI elements when showing the turning window on the UI — please
> fix"

A performance defect, not a logic bug: PALETTE TURNS behaves correctly, it just
costs too much while it is on screen.

---

## The mechanism, measured

While a colour autopilot is tweening, `lib/color_autopilot.js` rewrites
`colorPalette1/2` every 40 ms (`TWEEN_FRAME_MS`). `ColorsWindow` subscribes to
both through `useSharedParamValues`, **and** mirrors them into its own `h1`/`h2`
state so the dial follows the rig. So the whole ~2000-line window re-runs at the
broadcast rate. With `holdS === 0` (CONT, the default) that never stops.

That much is by design. What was not affordable is that the window did
**operator-speed work at broadcast speed**. Per render, with nothing memoized:

- `generateScheme(id, baseHue)` ran **nine times inside the JSX**, rebuilding
  nine five-colour rings — 45 swatch views — for a row that only changes when
  the operator moves the base hue.
- `HueWheel` — 90 stroked ring arcs, 24 knurls, a `<G>` per handle — re-reconciled
  every frame, because `hues`/`labels` were fresh arrays and `onArm`/`onDragEnd`
  were fresh closures. In TURNS its handles come from the STAGED draft, which a
  broadcast never moves: it had no reason to redraw at all.
- `parColours` (15 mixes) and `rampStops` (12 mixes) recomputed every frame even
  though both live inside the `isTwo` branch and are **not mounted** while
  PALETTE TURNS is the visible card.
- every saved-palette chip redrew its generated SVG icon; every Live Touch chip
  rebuilt a five-colour comparison array *inside its own map callback*.
- `orbitWindowSlots` and the rail's segments were unmemoized.

The hidden multiplier, and the reason a naive memo pass would have achieved
nothing: **`setSlot` closed over `h1`/`h2`**. Those change every frame, so
`setSlot` got a new identity every frame, and with it `loadIntoArmed`,
`loadPair` and `loadPreset` — which are props of the very chips being memoized.

### What the numbers actually said (and corrected)

Two independent rigs measured this; they agree. The instructive result is a
**correction to the brief's hypothesis**: the fix was expected to reduce the
NUMBER of re-renders. It does not, and cannot from inside this window.

React commit counts are ~**58/s whether the COLORS window is open or closed**.
The window is `display:'none'` when closed (`_208`) and never unmounts, so its
subscription keeps running; and above it, `ControlDeckScreen` re-renders wholesale
on deck state. **COLORS is a subtree caught in a deck-wide re-render, not the
cause of it.** What the OPEN window uniquely costs is layout: **261 layout
passes per 10 s open vs 13 closed** — roughly one per broadcast.

So the lever available here is not *how often* React re-renders, but *how much
each of those re-renders costs*. That is what this change cuts.

---

## The fix

Pure render-work reduction. No logic, no contract behaviour, no engine traffic
changed — every docs/61 pin (FOLLOW NOTE yield, TURNS/crossfade persistence,
STOP everywhere, `schemeTapOutcome`) and every `_264` orbit semantic is
untouched, and the file still contains no timer beyond its two sanctioned
one-shots.

- **`schemeFaces` memo** on `baseHue` — the nine generators run on operator
  action now, not per frame.
- **`pairHues` / `turnHues` memoized separately**, labels hoisted to module
  constants: in TURNS the dial's props hold identity across every engine frame.
- **`React.memo` on `HueWheel`.** Safe with its internal `stateRef` discipline:
  a bail-out means no mirrored prop changed, so the ref cannot go stale; any
  prop that does change fails the shallow compare and refreshes it.
- **Stable `onWheelArm` / `onWheelDragEnd`**, the latter reading hues from a ref
  at release time (fresher than a render-time closure).
- **`setSlot` reads `liveRef` instead of closing over `h1`/`h2`** — this is what
  makes every memo below it actually bail.
- **`React.memo` on `SlotButton`, `SchemeButton`, and two new extracted chips
  `SwatchChip` / `PresetChip`**, each taking its own id/index back so the call
  sites can pass stable handlers (`setArmedTurn`, `onSchemeTap`, `loadPreset`)
  instead of fresh arrows.
- **`litWindow` memoized**; **`turnPins`** built once per render instead of once
  per chip.
- **`parColours` / `rampStops` derive only when the TWO COLOUR card is showing.**
  Not a shortcut: the same values for the same picture, computed when that
  picture exists.

`WindowRail` is deliberately NOT memoized — it is the thing that must move.

---

## Before → after

Same probe, same scratch engine, same 10 s × 3 rounds, back-to-back on a quiet
machine. `A` = COLORS window open on the PALETTE TURNS card with the rotation
live; `B` = same rotation, window closed.

| metric (10 s window) | BEFORE | AFTER | change |
|---|---|---|---|
| **A · main-thread scripting** | **3857 ms** | **2433 ms** | **−37 %** |
| A · main thread busy on script | 38.6 % | 24.3 % | −14.3 pts |
| A · layout | 103.6 ms | 94.2 ms | −9 % |
| A · recalc style | 29.6 ms | 26.7 ms | −10 % |
| A · React commits | 588.7 | 575.3 | unchanged (as predicted) |
| **B · main-thread scripting** | **3652 ms** | **2444 ms** | **−33 %** |
| B · layout | 5.0 ms | 4.1 ms | — |

Read it as: **the same number of re-renders now costs about a third less.**
Roughly 1.4 seconds of main-thread scripting per 10 seconds of live TURNS is
given back to the UI thread — which is the budget touch handling, scrolling and
the rail's own animation were competing for. The closed-window case improves by
the same mechanism, so the win is not paid for only when the window is visible.

The earlier interleaved run (taken while another agent's browser loaded the
machine) showed the same shape at higher absolute values — 4912 ms A / 4532 ms B
before — which is why the comparison above was re-taken with the machine quiet.

### Corroboration

**Three independent rigs** measured this window (two sub-agent harnesses and
the probe used above), and all three agree on the mechanism:

- React commits ~**56–58/s**, statistically identical open vs closed
  (559.4 ± 11.3 open vs 561.0 ± 11.9 closed on the n=5 rig).
- The open window's reproducible marginal cost is **layout**: **+241.6 ± 3.7
  forced layouts and +92.6 ms per 10 s** — about one layout per tween frame —
  at 1–4 % standard deviation.
- On the **A-vs-B axis** (open vs closed) scripting shows *no* reliable delta:
  run-to-run sd there is 220–350 ms, larger than the difference. That is a
  different comparison from the **before-vs-after axis** reported above, where
  the delta is ~1424 ms and the min/max ranges do not overlap
  (before 3672–4105, after 2233–2821).

That distinction matters: closing the window was never going to fix this, and
the fix had to make each render cheaper rather than rarer.

---

## What is NOT verified here

- **Native.** The operator feels this on an iPad; these numbers are headless
  Chrome on the web build, a proxy. The fix was chosen to be platform-neutral —
  it removes React reconciliation work, which on native additionally removes
  shadow-tree diffing across the bridge — but the iPad improvement is
  **inferred, not measured**. No native profiler was runnable here.
- **The remaining ~58 commits/s** is deck-wide and untouched. Cutting it means
  either isolating the palette subscription into leaf components or gating the
  `h1`/`h2` broadcast mirror on `visible`. Both are real changes to how the dial
  follows the rig (the `visible` gate risks one stale frame on reopen), so
  neither belongs in a performance pass landing the night before a readiness
  push. Filed as follow-up.

---

## Gates

- **vitest 106 files / 2323 pass / 6 skipped / 0 fail** (final run; the
  baseline moved 2281 → 2291 → 2296 → 2323 under other agents tonight, so the
  count is a moving target and **0 fail** is the bar — met). Includes **9 new
  `_279` guards** in `colors_window_wiring.test.ts` — 37 tests in that file,
  all green.
- **tsc**: clean for every file this change touches.
- **eslint**: 0 errors on both touched source files.
- **security scan**: zero findings in the touched files.
- **expo export**: clean, twice (before and after builds).
- **Rig hygiene**: scratch engine on loopback:17945, sACN → TEST-NET-1, OSC /
  audio / fire-sync / vsn1 / timeline all off, state dirs redirected, auth flag
  explicit. The live stack on :6966-:6972 / :6981 / sACN 5568 was never bound,
  killed, or contacted — the probe asserts its resolved API base and refuses to
  run against :6968. Scratch servers torn down.

**Foreign in-flight work, excluded from the claims above:**
`CaptainPad/components/PlaylistPanel.tsx` carries a tsc error
(`LIBRARY_SWITCH_ONLY_HINT` used but defined nowhere) from the perf-mode
agent's concurrent edit. Not mine, left untouched.

---

## Guard block

Because vitest cannot render this file, the fix is pinned the way the rest of
this window is pinned — source-text guards. Nine of them, each naming a specific
way this regressed once: no `generateScheme` in JSX; stable dial handlers and
arrays; `setSlot` not closing over the live hues; the four list children
memoized; id/index-back props instead of fresh closures; the TWO COLOUR strips
gated; the badge list built once; and `HueWheel` memoized.
