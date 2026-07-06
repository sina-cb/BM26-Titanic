# Slot 1 — transitions_pixel_perfect

- **Branch:** dev/claude/transitions_pixel_perfect
- **Parent branch:** dev/summer_camp_readiness (97a3267)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/transitions_pixel_perfect
- **Slot ports:** engine 31168, sim 31169/31170/31171/31172, OSC 31100, Metro 31181

## Scope

Verified every `marsin_engine/patterns/transitions/trans_*.js` script
against the live WASM VM, root-caused multiple bugs that the round-1
"add 10 transitions" merge had introduced (or that pre-existed in the
6 originals), and fixed them. Added a unit-test oracle that asserts
pixel-perfect endpoints + finite mid-output for every transition, and
a self-booting HIL test that runs every transition through the real
deck-swap pipeline.

## Root causes found and fixed

Three distinct VM/host quirks were stacking on top of each other and
making the new transition pack look "kinda broken on real fixtures":

1. **Feather smoothstep bleed at endpoints (10 of 16 transitions).**
   The wipes used `smoothstep(progress - feather, progress + feather, c)`
   where `c` is a per-pixel scalar in [0, 1]. At progress=0 the
   smoothstep window `[-feather, +feather]` overlaps the visible `c`
   range, so pixels near the leading edge already half-blend to TO —
   the transition is "already 15% complete" at p=0 (and symmetrically
   incomplete at p=1). Fix: rewrite every feathered wipe to compute
   a per-pixel reveal threshold `pp ∈ [0,1]` and bias `progress` to
   `ep ∈ [-feather, 1+feather]`, then `edge = smoothstep(pp-f, pp+f, ep)`.
   This puts the full window outside the `pp` domain at endpoints, so
   p=0 → edge=0 everywhere → output=FROM exactly, and symmetrically
   at p=1. Files touched: trans_wipe_right, trans_wipe_left,
   trans_wipe_down, trans_iris, trans_iris_close, trans_diagonal_wipe,
   trans_diamond_wipe, trans_split_horizontal, trans_split_vertical,
   trans_wave_sweep.

2. **`random(1)` is VM-wide, not per-pixel (trans_dissolve).** The VM
   advances its PRNG once per `random()` call, but the same value
   reaches every pixel within a single frame because the call site is
   per-pixel in the script but reuses the same generator handle.
   That degenerated trans_dissolve from "per-pixel binary reveal" into
   "uniform global crossfade with random jitter between frames". Fix:
   replace `random(1)` with a deterministic per-pixel hash
   `fract(sin(index*12.9898+78.233)*43758.5453)` — same idiom as
   `13_sparkle.js`. Renamed local var to `th` (not `threshold`) and
   the work var to `raw` after observing that `var threshold` triggers
   a silent VM symbol-table collision that desyncs read vs. write
   sites; documented in the file header.

3. **`export function slider<Name>` / `export function hsvPicker<Name>`
   auto-fire at compile/init with v=0.5 (or h=s=v=0) and overwrite the
   `export var` initializer (trans_color_burst, trans_dissolve, every
   wipe).** This was the silent killer: even though source declared
   `export var grain = 0.08`, by the time render runs grain has been
   overwritten to `0.02 + 0.5*0.4 = 0.22`. Same for `var burstH = 0.08`
   getting clobbered to 0 by `hsvPickerBurst(0,0,0)`, making the
   "amber burst" actually render as pure red. Fix: drop `export` from
   the setter functions on transitions, because the engine's CPC
   binding only wires *channels*, not transitions — the export was
   dead weight that only ever produced the bug. Documented the
   rationale inline in trans_dissolve.js and trans_color_burst.js so
   the next author doesn't reintroduce it. Wipe/iris/split/wave/ripple
   still have `export function slider*` — those don't break the
   pixel-perfect contract (the bias trick adapts to any feather/amp),
   they just run with `feather=0.17` instead of the source's `0.08`,
   which is a cosmetic mismatch we can clean up in a follow-up once
   the engine grows a "transition param" API. Flagged below.

No transitions were deleted. All 16 scripts now compile, run, and
land pixel-perfect at progress=0 and progress=1.

## Files changed

```
M marsin_engine/patterns/transitions/trans_color_burst.js
M marsin_engine/patterns/transitions/trans_diagonal_wipe.js
M marsin_engine/patterns/transitions/trans_diamond_wipe.js
M marsin_engine/patterns/transitions/trans_dissolve.js
M marsin_engine/patterns/transitions/trans_iris.js
M marsin_engine/patterns/transitions/trans_iris_close.js
M marsin_engine/patterns/transitions/trans_split_horizontal.js
M marsin_engine/patterns/transitions/trans_split_vertical.js
M marsin_engine/patterns/transitions/trans_wave_sweep.js
M marsin_engine/patterns/transitions/trans_wipe_down.js
M marsin_engine/patterns/transitions/trans_wipe_left.js
M marsin_engine/patterns/transitions/trans_wipe_right.js
A marsin_engine/tests/transitions_pixel_perfect.test.js
A marsin_engine/tests/hil/hil_transition_pixel_perfect_test.mjs
A .agent/02_reports/202605/20260525_1_transitions_pixel_perfect.md
```

Not modified: trans_flash (already hardcodes white, no edits needed),
trans_crossfade (already correct, pixel-perfect by construction),
trans_morse_blink (already correct), trans_ripple_in (already correct).

## Tests run

### Per-transition results (after fixes)

| Transition           | Unit test  | HIL pipeline | Notes |
|----------------------|------------|--------------|-------|
| trans_crossfade      | PASS       | PASS         | already correct, no change |
| trans_flash          | PASS       | PASS         | already correct, no change |
| trans_dissolve       | PASS       | PASS         | per-pixel hash + grain default + setter de-export |
| trans_color_burst    | PASS       | PASS         | hsvPickerBurst de-exported (was clobbering burst color to red) |
| trans_morse_blink    | PASS       | PASS         | already correct |
| trans_ripple_in      | PASS       | PASS         | already correct |
| trans_iris           | PASS       | PASS         | bias-progress fix |
| trans_iris_close     | PASS       | PASS         | bias-progress fix |
| trans_diamond_wipe   | PASS       | PASS         | bias-progress fix |
| trans_diagonal_wipe  | PASS       | PASS         | bias-progress fix |
| trans_split_h        | PASS       | PASS         | bias-progress fix |
| trans_split_v        | PASS       | PASS         | bias-progress fix |
| trans_wave_sweep     | PASS       | PASS         | bias-progress fix |
| trans_wipe_left      | PASS       | PASS         | bias-progress fix |
| trans_wipe_right     | PASS       | PASS         | bias-progress fix |
| trans_wipe_down      | PASS       | PASS         | bias-progress fix |

### Test suites

- **Unit:** `marsin_engine/tests/transitions_pixel_perfect.test.js` —
  17/17 pass. For every transition, asserts at progress=0 the WASM
  output equals FROM exactly (no feather bleed), at progress=1 it
  equals TO exactly, at progress=0.5 every byte is finite and in
  [0,255], and at least one of {p=0.25, p=0.5, p=0.75} differs from
  both endpoints (the transition is actually transitioning).
- **HIL (this slice):** `marsin_engine/tests/hil/hil_transition_pixel_perfect_test.mjs` —
  16/16 pass, total wall time 47.1s (budget was 60s). Self-boots an
  engine on port 31168, runs every transition through `triggerDeckPatternSwap`
  between test_const → test_dualband, captures master vis frames via
  WS, asserts every frame is a valid 52-pixel 6-channel buffer with
  no NaN, asserts deckSwapStarted/Complete events fire within the
  expected window, asserts pre-swap = A signature and post-swap = B
  signature.
- **Existing HIL (regression check):**
  - `hil_transition_visual_test.mjs`: 9/9 pass (was 8/9 before the
    dissolve fix — the existing test's "expect ≥70% binary" assertion
    was previously passing only by accident because the broken
    `random()` made the whole buffer move together; with the new
    per-pixel hash + de-exported sliderGrain the dissolve actually
    delivers 91% binary).
  - `hil_transition_smoothness_test.mjs`: 13/13 pass.
  - `hil_transition_type_test.mjs`: 17/17 pass.
- **Engine dry-run:** `npm run check:rainbow` → "Pattern loads and
  compiles OK", RGBWAU 6-channel output verified.
- **Full unit suite:** 249/250 pass (the 1 failing test,
  `playlist_api.test.js::Two entries of same pattern keep independent
  defaults across restart` is pre-existing on `dev/summer_camp_readiness`
  before my changes — verified by stashing my edits and re-running.
  The failure is about the sparkle pattern's CPC export shape, which
  this slice doesn't touch).

### State cleanliness

`git status` shows only intended diff. The HIL test snapshots
`marsin_engine/states/test_bench/{deck,mixer,globals}_state.yaml`
before booting its self-managed engine and restores them in a
`process.on('exit', restoreState)` handler. The existing
`hil_transition_visual_test.mjs` was also run as a regression check,
which DID modify the test_bench state files (it deletes/recreates
overlays); those files were restored via `git checkout -- ` before
committing. node_modules in the worktree was installed via `npm
install` for the HIL test to load `ws`; it's gitignored.

## Known gaps / follow-ups

1. **Most slider exports on transitions auto-fire with v=0.5 and
   thereby ignore the source `var feather = 0.08` initializer.** I
   only de-exported `sliderGrain` (trans_dissolve) and `hsvPickerBurst`
   (trans_color_burst), because those two had visually catastrophic
   side effects (uniform crossfade and pure-red burst). The other
   wipe/iris/split/wave/ripple transitions still `export function
   sliderFeather`, which means their runtime `feather` is 0.17 instead
   of the source 0.08, and `trans_wave_sweep` runs with `waveFreq=5,
   waveAmp=0.2` instead of `3, 0.15`. The pixel-perfect contract is
   unaffected (my bias-progress trick adapts to whatever feather
   actually is), but the look is slightly softer / wavier than the
   docstring suggests. Operator follow-up: decide whether to (a) drop
   `export` from those slider setters too and update the docstrings,
   or (b) extend the engine with a real "transition params" API so
   CPC can wire them.
2. **trans_flash exports `flashHue` / `flashSat` and an
   `hsvPickerFlash` setter but the render() body hardcodes
   white(1,1,1).** Same `export` auto-fire happens but it doesn't
   matter because the values are never read. Worth cleaning up
   eventually so the export surface matches what the transition
   actually uses.
3. **No real-rig verification.** I tested in the WASM host and through
   the in-process engine pipeline on test_bench (52 pixels). The
   operator's primary ask was "we need to test them in HIL and make
   sure they are pixel perfect" — done at the pixel buffer level.
   Whether they LOOK right on actual fixtures (DMX/sACN order, color
   mixing, RGBWAU diode crosstalk on the real par fixtures) is still
   open and would benefit from a 5-minute eyeball test on the dome.
4. **`trans_morse_blink` at progress=0.5 lands at full-TO** (the
   third SOS pulse is centered at p=0.5 with halfWidth=0.05, so
   pulse=1.0 → output=TO). That's per spec — the unit test
   accommodates this via the "either start OR mid OR end must differ
   from both endpoints" clause. Flag for the operator: this means a
   1.5 s morse_blink shows a hard-cut to TO at the 0.75 s mark
   and stays there. If a longer "fade after the bursts" is wanted,
   tweak the 0.70 boundary and the post-burst smoothstep.

## Operator action requested

Ready for review and merge.

## Anticipated merge conflicts with other slices

Touches only `marsin_engine/patterns/transitions/*.js` and adds two
new test files. Should be conflict-free against:
- slot 5 (fader_lock) — that slice edits `lib/pattern_mixer.js` and
  `lib/pattern_channel.js`; no overlap with `patterns/transitions/`.
- slot 6 (channel_isolation, already merged) — same, no overlap.
- any other slot touching engine.js, api_server.js, or playlist
  manager — no overlap.

If a parallel slot ALSO modifies any `patterns/transitions/trans_*.js`
file, it would conflict line-by-line; check before merging. None of
the announced slot scopes do so.

## Merge-readiness statement

All transition scripts pass the pixel-perfect oracle in both unit
test and live engine HIL. All pre-existing HIL transition tests
(visual / smoothness / type) pass. No regressions in unrelated unit
tests beyond the one pre-existing playlist_api failure. State files
are clean. Branch is ready for `git merge --no-ff dev/claude/transitions_pixel_perfect`.
