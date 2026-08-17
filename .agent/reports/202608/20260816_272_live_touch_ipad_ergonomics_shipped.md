# _272 — Live Touch iPad ergonomics SHIPPED: the panel is thumb-sized at 11 inches

**Role:** Opus lead on the operator pipeline (three Sonnet implementers, my
validation walk). **Contract:** `docs/66_live_touch_ipad_ergonomics.md`
(W0–W5), design `_271`. **Builds on:** `docs/65`/`_268` — nothing that wave
landed was redesigned, and every one of its measured wins is re-measured
below. **Surface:** the sim-served touch panel.

**File scope: one file.** `docs/ui/touch_control.html` (313 808 → ~381 000
bytes). `touch_control_wire.js`, `touch_control_theme.js`,
`touch_control_pixel_views.{js,json}`, `touch_control_group_profiles.js`,
`touch_control_passcode.js` and `touch_control_lifecycle.js` are all
**byte-identical** to a frozen wave-start snapshot — including the `_271`
self-heal artifacts.

---

## 1. What shipped

| W | Slice | Agent |
|---|---|---|
| W0 | Audit harness + embedded 11" baseline | me |
| W1 | Both P1 defects (strip stretch, card crush, groups overflow) | Sonnet A |
| W2 | One-up pane stacking below ~900 px (D2) | Sonnet A |
| W3 | Performance-tier 44 pt (topbar, ON TIME/SPEED, DRAW/INK, scheme, wheel) | Sonnet B |
| W4 | Setup-tier hit overlays, effects, groups, meter affordance | Sonnet C |
| W5 | Validation walk + six correction rounds | me |

All five design defaults (D1–D5) shipped as specified.

## 2. The instrument, and why it is the headline

`docs/66` §1 measured **boxes** (`getBoundingClientRect`) and found 150 of 151
controls under 44 pt. But the contract's own doctrine is **hit region ≠ visual
size** (§2.1), so a box audit cannot grade the fix: the whole remedy is to grow
the *tappable area* while leaving the visual body alone.

So W0 built a different instrument (`~/tmp/live_touch_ipad/harness/audit.cjs`).
It boots the panel **embedded** (real gruvbox tokens through a host iframe,
engine topology injected exactly as the wire does so the pixel-view gate goes
green and the spatial pane really draws), then at **4 viewports × both spatial
modes** ray-casts `document.elementFromPoint` outward from every control's
centre and reports the contiguous area that hit-tests to that control. Padding
and a transparent `::after` overlay count; a box that merely looks bigger does
not. It also scrolls clipped controls into view before measuring, and it does
not grade controls the panel has deliberately made inert in that state.

That last point mattered immediately: the nine **DRAW/INK** buttons are
`pointer-events:none` in XY mode by design (`.side-col.is-inert`, docs/65), so
grading only the default state would have silently exempted a third of the
performance tier. Every number below is stated per mode.

**Three bugs in my own instrument, found and fixed before its numbers were
trusted** — worth recording because each one would have produced a confident
wrong answer:

1. **Scroll residue.** `scrollIntoView` also scrolls `overflow:hidden`
   ancestors, which the restore path ignored — `.groups-toolbar` stayed parked
   at `scrollLeft 218` and every viewport measured afterwards undercounted.
   Caught by the W1/W2 implementer, not by me. `undo()` now restores the whole
   ancestor chain, and the harness **asserts** its own scroll snapshot matches
   before and after, so a leak can never ship silently again.
2. **Nearest-scroller-only clip test.** Once W2 made the page stack and scroll,
   below-the-fold controls were skipped as "off-viewport" — the stacked layout
   scored 179 controls where the two-up one scored 214.
3. **Missing selectors.** The group ON switch is a
   `<span class="fader-sw" data-role="power">`, which the docs/66 §1 selector
   never saw — and §3.7 names it explicitly.

With the instrument corrected, the true wave-start baseline is **240 gated
controls, 30 passing** at 11" — not 151/1.

## 3. Measured before → after (embedded, both 11" viewports, SPATIAL mode)

| | landscape 1194×834 | portrait 834×1194 |
|---|---|---|
| **44 pt PASS / gated** | **30 → 84** / 240 | **30 → 134** / 245 |
| ARM | 206×**32 → 44** | 206×**32 → 44** |
| TAP | 56×**24** → 48×**44** | same |
| pattern select | **71 → 161** ×44 | 240 → **244**×44 |
| scheme actions | ×**36 → 44** | ×**36 → 44** |
| colour wheel | **153 → 243** | **124 → 312** |
| XY pad w / clip | 414/93 → 420/**47** | 230/113 → **618/0** |
| meter strip / dead space | 54 / 8 (held) | **420 → 54** / **374 → 8** |
| meter card / label gap | 116 / +24 (held) | **75 → 110** / **−3 → +24** |
| palette slot row | 85×46 → 86×46 | **48 → 126**×46 |
| FOLLOW NOTE | 538×32 → 540×32 | **354 → 742**×32 |
| topbar | 54 → 64 (D1) | 94 → 120 |

12.9-inch, where `_268` did all its validation: **39 → 105** passing at both
orientations, pad clip **0** both, wheel 248 → **301** / 320 held, portrait
pattern select 438 → **442**, strip 54, slot rows 46. Nothing regressed.

## 4. The two P1 defects, with their mechanisms

Both reproduced embedded at wave start, and both turned out to be one-line
causes that the 12.9-inch validation could never have seen:

- **Portrait strip ballooned to 420 px** (child `.meter-bars` stayed 46) because
  `@media (max-width: 900px) { .panel { min-height: 420px } }` — written for the
  four `.prow` row panels — also caught `#meterStrip`, which wears `.panel`
  only for its dock plumbing. Now content-sized: **54 px, 8 px dead**.
  The nine cards got a 110 px floor and the strip scrolls instead of crushing
  (D4); the label run-on measured **−3 px** of ink overlap and is now **+24**.
- **Groups pane clipped mid-column with no affordance** because `.fader-bank`
  carried `overflow-x: auto` **and** `touch-action: none` — a finger could never
  pan it. The drag children already declare their own `touch-action: none`, so
  the bank became `pan-x` without touching a single gesture (proven both ways:
  a bank drag scrolls, a fader drag still sets a value and does not scroll).
  Plus the D5 fade and a live "N more ▸" count.

## 5. Gate results

- **Transport grep gate — PASS 4/4.** `touch_control_theme.js` byte-identical
  (md5 `0418472d…`), first-paint embed gate identical, wire touchpoints
  identical, occurrence counts unchanged.
- **docs/65 pinned wins — all intact**, re-measured at all four viewports (§3).
- **State walk — 12/12.** Six operator states per orientation (default XY,
  SPATIAL, help open, strip docked, groups scrolled, colour panel docked): the
  docs/61 FOLLOW NOTE bar is present, full-width, ≥32 px with a live
  `.nf-state`, never inside a hidden or collapsed ancestor, and ARM + the
  status pill are on screen in every one.
- **Persistence — 4/4 per viewport, run by me** rather than taken on trust: no
  store → strip open, rail `[PRESETS]`; docked strip survives a reload with the
  `AUDIO` tab; a corrupt store falls open **loudly** (`[layout] could not
  read:`) with the rail intact; the `MIN_OPEN` floor still refuses to dock the
  last open panel.
- **Tests.** Panel suites **93/94**. Broader sim sweep **2039 / 2047**, running
  the 123 of 141 suites that do not bind ports (the other 18 would have
  collided with the operator's live stack — deliberately not run). All 7 reds
  are the known foreign scene/bench set from `_268`/`_271`; they live in
  `bench_mirror_state`, `bench_section_sync` and `touch_control_pixel_views`,
  and `touch_control_pixel_views.js` is byte-identical to wave start, so none
  of them can be ours.
- **No new browser-feature floor.** `container-type` / `cqw` / `cqh` appear only
  inside a comment explaining why that approach was rejected. `:has()` is one
  real usage (Safari 15.4+; failure mode is a halved groups panel, cosmetic) —
  accepted and recorded. `ResizeObserver` / `MutationObserver` are long-standing
  APIs. `::after` went 8 → 34: the hit-overlay doctrine, working as designed.

## 6. Six corrections the walk sent back

Four were found by measuring or looking at what an implementer had already
reported as done — which is the argument for the walk being separate from the
build.

1. **W1's "N more ▸" chip covered two LOCK buttons.** `pointer-events:none`, so
   it could not steal a tap — it just hid two controls. Same defect class as the
   `_268` dock-chevron overlap, same remedy: a reserved row, not an overlay.
2. **W1's wheel repair introduced CSS container queries** — a Safari-16 floor
   absent from the baseline whose failure mode is an invalid `width` and a
   silently collapsed colour wheel. Removed; the implementer measured and
   disproved two pure-CSS formulations first, then used a `ResizeObserver`.
3. **W3's BPM stepper produced overlapping hit regions** — portrait `−` ended at
   x 673 and `+` began at x 672, so a tap on the boundary did the *opposite* of
   what the operator meant, and it cost the pinned pattern-select width. Fixed
   by reordering to the conventional `− 120 BPM +`, which separates the two
   opposite-consequence buttons with the readout and consumes no extra width.
4. **W4 pushed the landscape pattern select back to 72 px** — essentially the
   71 px crush docs/66 flagged as a defect. Now **161 px**, donated by the
   decorative brand block.
5. **`.fader-lock` went off-fold at 1194×834** inside a container the operator
   cannot scroll (`.fader-bank` is `overflow-y: hidden`), i.e. a per-group lock
   vanished from the screen. Wave-start had it visible in landscape and
   **invisible in portrait**; W3's topbar growth and prow rebalance flipped
   that. Root cause was `.fader-strip` missing `min-height: 0`, defeating grid
   stretch — the same class the file's own `.prow` comments document. Now
   **visible at both 11" viewports**, which is better than wave start. My
   ruling, recorded because it was a judgement call: **visibility beats the
   floor** — a visible 37 pt lock beats an invisible 44 pt one.
6. **My own misdiagnosis, and the one that matters most.** I reported the
   12.9" strip at **80 px** as a W4 regression of the docs/65 ≤56 pin. The
   implementer could not reproduce it in 13 attempts and added a defensive
   `max-height: 56px`. I root-caused it instead: the strip grows because
   `#meterState` — **"waiting for audio…"** — joins the flex column when the
   feed goes quiet. That is the panel reporting a dead audio feed, it is
   pre-existing and correct, and my audit had simply sampled that state once.
   The clamp then *clipped the caption out of view* (content wants 78 px,
   `.panel` has `overflow: hidden`) — turning a diagnostic into a silent
   omission, which is the fallback-shaped failure the codex forbids. The clamp
   came out and the caption became an overlay, so the strip holds ≤56 px in
   **both** audio states with the message legible. The harness now records
   `meterStripState { isLive, contentH, maxHeight, captionFits }` next to the
   height so the two states can never be conflated again.

## 7. Accepted residuals (arithmetic, not excuses)

Every one of these is a **height** problem at **1194×834**, and they share a
single cause: landscape keeps two panel rows (D2 chose one-up for portrait
only), so 834 px of height carries two full panel stacks.

- **Groups per-column stack — 72 of 96 controls.** A column is 64 px wide in a
  bank ~240 px tall, holding a tag, five stem boxes, a fader track, ON, a route
  select and LOCK. Four gated controls at 44 pt is 176 px *before* the fader
  track. §3.7's three named items shipped — **ON is a true 44 pt at all 24
  columns**, LOCK's hit region grew to 37 and it is back on screen, and the
  MASTER fader has 45 pt of hit width. The rest cannot fit without removing
  controls, which this contract does not scope.
- **Effects — 50 of 66.** `.fx-cell` measures **43.75 px** tall at this
  viewport and clips at both ends with its own `overflow:hidden`, so
  `.aud-mode` (LVL) tops out at **43 px — one pixel under the floor**, and the
  native `<select>` pickers cannot grow inside it. Portrait, where one-up
  stacking gives the cell room, goes **16/66 → 64/66**. The implementer tested
  and rejected §3.4's "two columns at 11" portrait" suggestion with arithmetic:
  four columns give 104 px per cell there, two would give ~49 px.
- **INK column 38 pt and XY pad clipped 47 px**, both at 1194×834 only.
  Rebalancing the landscape `.prow` ratio past **1.37** collapses `.fx-cell`
  and drops effects from 16/66 to 8/66 passing, so 1.36 is the ceiling. All
  three other viewports reach **clip 0**.

## 8. Open decision for the operator (one line, not a blocker)

**Should landscape 11" also go one-up?** Every residual above is the landscape
height budget, and D2 deliberately kept landscape two-up. Portrait, which took
the one-up treatment, went from 30 to **134** passing controls and reaches clip
0, a 312 px wheel and a 618 px pad; landscape reached 84 and still clips the
pad 47 px. The same breakpoint applied to a short landscape viewport (with the
page scrolling, as portrait now does) would very likely clear the effects
cliff, the INK column and the pad in one move — at the cost of scrolling to
reach the second row of panels during a show. That is an ergonomics trade only
the operator can make, so it is recorded here rather than taken.

Also worth a line: `docs/66` §4 predicted the 11" viewports should join every
future wave's acceptance matrix. This wave is the evidence — **every defect it
found was invisible at 12.9 inches.**

## 9. Ledger

- **Live services never bound, killed, restarted or mutated.** 6966–6972 /
  6981 / 5568 verified still serving at the end. All capture on scratch serves
  **17301–17339**, all closed. No engine started (topology injected from the
  real model file). The sim serves `docs/ui` straight to the operator's iPad,
  so every implementer iterated on a scratch copy and landed with an atomic
  rename — the live page was never a partial file.
- **One correction to that claim, stated because "untouched" was too strong.**
  The wire resolves the engine as `location.hostname:6968`, and the harness
  serves on `127.0.0.1`, so **every harness page load connected to the
  operator's running engine** — read-only: it subscribed to `/ws/signals` and
  opened `/ws/control`, where it sent exactly one `touchControlHello`. That
  handler only tags the socket and logs `[touchPaint] owner '…' registered on
  /ws/control`; it claims no ownership and mutates no state, and the deadman
  only starts on `touchControlArmed`, which no run ever sent (the panel was
  DISARMED throughout). **Net effect on the operator: a number of those log
  lines, and nothing else.** A future harness on this surface should either
  point the wire at a dead host or accept and declare the same contact.
- **Harness note for the next wave:** the strip's audio state cannot be
  *sampled*, only *forced*. The live engine re-asserts `is-live` within
  ~200 ms, so a harness that waits and reads will get false-live readings on
  this box — which is precisely how the phantom in §6.6 was born. Force the
  class off and measure in the same frame, or block the signals socket.
- **Accepted, unchanged from `_268`:** opening the ⓘ help transiently re-clips
  the landscape pad (now 108 px at 11"; portrait 27 px). Opt-in, transient, and
  the fix is already proven on this surface — overlay the help paragraph the
  way the VIEW toolbar does, which costs zero flow height.
- **Scratch:** `~/tmp/live_touch_ipad/` — `baseline/` (frozen wave-start copy
  of every `docs/ui` file), `harness/` (`audit.cjs`, `states.cjs`,
  `persistence.cjs`, `report.cjs`, `serve.cjs`, `host.html`), `out/` (every
  measurement run + the screenshot matrix), `w1/`, `w3/`, `w4/`.
- **Tracked writes:** `docs/ui/touch_control.html`, this report, the tracker
  landing block, one dossier row. No git operations.
