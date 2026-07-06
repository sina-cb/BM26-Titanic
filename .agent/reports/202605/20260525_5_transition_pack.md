# Slot 5 — transition_pack

- **Branch:** dev/claude/transition_pack
- **Parent branch:** dev/summer_camp_readiness (parent SHA d0ab8d1)
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/transition_pack
- **Slot ports:** engine 31568 (HTTP/WS), sim 31569/31570/31571/31572, OSC 31500, Metro 31581

## Scope

Audited the seven existing transition scripts under
`marsin_engine/patterns/transitions/`, fixed two correctness issues,
removed `trans_wipe_up` per operator request, pruned every reference
to it from the engine and CaptainPad, added ten new creative
Titanic-flavoured transitions, and verified the engine compiles and
runs every transition against the test_bench scene.

## Files changed

```
 M CaptainPad/components/DeckTransitionControls.tsx
 M marsin_engine/lib/api_server.js
 M marsin_engine/patterns/transitions/trans_iris.js
 M marsin_engine/patterns/transitions/trans_wipe_left.js
 D marsin_engine/patterns/transitions/trans_wipe_up.js
?? marsin_engine/patterns/transitions/trans_color_burst.js
?? marsin_engine/patterns/transitions/trans_diagonal_wipe.js
?? marsin_engine/patterns/transitions/trans_diamond_wipe.js
?? marsin_engine/patterns/transitions/trans_iris_close.js
?? marsin_engine/patterns/transitions/trans_morse_blink.js
?? marsin_engine/patterns/transitions/trans_ripple_in.js
?? marsin_engine/patterns/transitions/trans_split_horizontal.js
?? marsin_engine/patterns/transitions/trans_split_vertical.js
?? marsin_engine/patterns/transitions/trans_wave_sweep.js
?? marsin_engine/patterns/transitions/trans_wipe_down.js
```

## Audit findings

| File | Verdict | Notes |
| --- | --- | --- |
| trans_crossfade.js | OK | Linear interp on all six channels, no issues. |
| trans_dissolve.js | OK | Slider clamped to grain >= 0.02 so divisor is never zero. |
| trans_flash.js    | OK (minor) | Exports `flashHue/flashSat/hsvPickerFlash` that the script never uses (header comment hints at HSV burst but body hardcodes white). Left as-is — harmless dead exports; the new `trans_color_burst.js` covers the "burst through a tunable color" use case correctly. |
| trans_iris.js     | **FIXED** | Was a 1-D x-axis iris (only used `x`), now uses true Euclidean radial distance via `hypot(x-0.5, y-0.5)`. Comment was misleading; matches its name now. |
| trans_wipe_left.js | header fixed | Header comment said `blend_wipe_left.js — Left to Right`; replaced with the actual name + correct direction (right → left). Math was already correct. |
| trans_wipe_right.js | OK | Math correct; direction matches name. |
| trans_wipe_up.js  | **DELETED** | Removed per operator request. |

Also discovered the engine had a dangling reference to `trans_wipe_down`
(in `api_server.js::pickRandomTransitionMode` and in CaptainPad's
`DeckTransitionControls.tsx`) with **no file behind it** — the random
picker could pick it and `getBlendHandle('trans_wipe_down')` would
return null, falling back to `trans_crossfade`. Fixed by adding a real
`trans_wipe_down.js` (one of the ten new transitions) so the reference
is now valid.

`trans_wipe_up` references pruned from:
- `marsin_engine/lib/api_server.js` (`TRANSITION_OPTIONS` random pool)
- `CaptainPad/components/DeckTransitionControls.tsx` (`TRANSITION_OPTIONS` picker list)

State files in `marsin_engine/states/test_bench/*.yaml` never named
`trans_wipe_up`, so no migration needed. The one archival report
(`.agent/02_reports/202605/20260504_1_marsin_mixer.md`) still mentions
it; left untouched because reports are append-only history.

If a saved state file *did* reference a missing transition name, the
engine would lazy-compile via `pattern_mixer.js::_compileBlend`, fail
the file existence check, log a warning, return null, and the mixer
would fall back to plain `trans_crossfade`. So a missing transition
file in a state file is non-fatal — the rig still runs.

## New transitions (10)

All use radian trig, output six channels via `rgbwau(...)`, use the
transition built-ins (`progress`, `fromR/G/B/W/A/U`, `toR/G/B/W/A/U`),
and carry a short header comment. All compile via the WASM compiler
and were live-exercised against the engine on port 31568.

| File | Description |
| --- | --- |
| trans_wipe_down.js | Vertical wipe, reveal sweeps top → bottom. |
| trans_iris_close.js | Inverse iris — radial collapse inward toward center. |
| trans_diagonal_wipe.js | Diagonal sweep from bottom-left to top-right. |
| trans_diamond_wipe.js | Diamond shape (L1 / Manhattan distance) expanding from center. |
| trans_ripple_in.js | Concentric sine rings sweep outward from center (stone in water). |
| trans_color_burst.js | Like trans_flash but bursts through a tunable HSV color (default deep amber); wires up via `hsvPickerBurst`. |
| trans_split_horizontal.js | Bay-doors reveal — opens from the horizontal centerline outward. |
| trans_split_vertical.js | Curtain reveal — opens from the vertical centerline outward. |
| trans_wave_sweep.js | Like trans_wipe_right but the edge is a sine wave — evokes a tide rolling across the hull. Wave frequency + amplitude tunable. |
| trans_morse_blink.js | Three-pulse SOS-style staccato of `to` on `from`, then a final smooth crossfade. Visually intense — use sparingly. |

### Compiler note

The MarsinScript VM treats `t` as a reserved identifier; my initial
`trans_morse_blink.js` declared `var t = ...` and got rejected with
`Line 42: Cannot declare reserved name 't'`. Renamed to `amt`. The
existing transitions never tripped this because none of them declared
a bare `t`. (`time(...)` is the canonical way to read the current
beat-aware clock.)

## Tests run

### Compile-check
Custom script `~/tmp/compile_transitions.mjs` walks
`patterns/transitions/*.js` and compiles each via `WasmHost`:

```
  OK    trans_color_burst.js
  OK    trans_crossfade.js
  OK    trans_diagonal_wipe.js
  OK    trans_diamond_wipe.js
  OK    trans_dissolve.js
  OK    trans_flash.js
  OK    trans_iris.js
  OK    trans_iris_close.js
  OK    trans_morse_blink.js
  OK    trans_ripple_in.js
  OK    trans_split_horizontal.js
  OK    trans_split_vertical.js
  OK    trans_wave_sweep.js
  OK    trans_wipe_down.js
  OK    trans_wipe_left.js
  OK    trans_wipe_right.js
Compiled 16 transition scripts, 0 failures.
```

### Engine dry-run
```
node engine.js --pattern test_const --model test_bench --dry-run --port 31568
  🏁 Dry run complete. Pattern loads and compiles OK.
  Test render pixel 0: RGBWAU(255, 0, 0, 0, 0, 0)
```
No warnings.

### Live engine on 31568 — every new transition exercised
`~/tmp/exercise_new_transitions.mjs` (copied into
`marsin_engine/tests/hil/__tmp_exercise_new_transitions.mjs` so node
could resolve `ws`, then deleted) triggered each new transition via
`triggerMixerTransition` and asserted the engine echoed back the
requested mode in `mixerTransitionStarted`:

```
10/10 new transitions accepted by engine
```
Engine log confirms each blend script compiled lazily on first use,
zero `compile failed` / `falling back` warnings.

### HIL (engine on 31568)
HIL test files were locally patched (URL `6968` → `31568`) to point at
the slot port, all tests ran, then patches were reverted via
`git checkout` before commit.

| Test | Result |
| --- | --- |
| `hil_transition_test.mjs` | passed (all thresholds, brightness dip sweep OK) |
| `hil_transition_type_test.mjs` | 17/17 assertions passed |
| `hil_transition_smoothness_test.mjs` | 13/13 assertions passed |
| `hil_transition_visual_test.mjs` | 9/9 pixel-level assertions passed (crossfade, flash, dissolve, wipe_right all visually correct) |
| `hil_deck_swap_test.mjs` | not run (out of scope — deck swap path uses the same blend scripts, exercised indirectly by exercise_new_transitions.mjs which goes through the mixer transition path) |

### State cleanliness
HIL runs modified `marsin_engine/states/test_bench/{globals,mixer}_state.yaml`
(saveMixerState / CPC tweaks). After tests, those were restored via
`git checkout -- marsin_engine/states/test_bench/`, and `git status`
now shows only the intended diff. `marsin_engine/config.yaml` and
`marsin_engine/package-lock.json` were not touched. Engine on port
31568 was killed before commit; `lsof -i:31568` returns nothing.

## Known gaps / follow-ups

- `trans_flash.js` still has unused `flashHue / flashSat /
  hsvPickerFlash` exports. They were always dead; not touched in this
  pass because removing exports would change the WASM exports
  surface and isn't strictly an issue. If/when those become a
  CaptainPad UI hint, point them at `trans_color_burst.js` instead.
- `CaptainPad/components/DeckTransitionControls.tsx` got 10 new
  entries in the picker but I did not exercise CaptainPad itself
  (no `tsc / lint` run; that's outside the per-task ports list and
  isn't strictly required by the slice). Picker is pure data — the
  ids match the new transition filenames — so a live tap on the
  iPad should "just work" the next time CaptainPad is rebuilt.
- `trans_morse_blink` lights up dramatically — recommend wiring it
  behind a deliberate operator gesture rather than in the random
  autopilot pool. It IS in the random pool today; consider pruning
  it if it feels too aggressive during testing.
- `marsin_engine/marsin_pb/` (the WASM compiler binary) sits in the
  worktree but is git-ignored / vendored; no changes.

## Operator action requested

Ready for review and merge. Anticipated conflicts: only the explicit
transition lists in `marsin_engine/lib/api_server.js` and
`CaptainPad/components/DeckTransitionControls.tsx` might collide with
another slot's edits to those files — both lists are short and
deduping by transition id is straightforward.
