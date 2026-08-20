# Deck transition debug audit and permanent comparison gallery

## Outcome

The cold audit found a reproducible P0 discontinuity in the shared Deck
executor, not in the Baby endpoint patterns. The executor maps
`trans_crossfade` to `blend_screen`, then replaces the entire blended buffer
with B once eased progress reaches `0.97`. The replacement applies to every
transition, despite the surrounding comment describing it as a crossfade-only
fix.

That cold-audit result is now repaired. The retained catalog contains 15
transitions, Morse Blink is deleted, every retained script owns the complete
0→1 curve, and both endpoints are exact. The final strict Titanic oracle has
`p0OpenCount: 0`, zero A/B endpoint residual, and a maximum completion excess
of **0.311184 RMS bytes** above B's own next-frame motion baseline.

The permanent offline gallery, generator, mechanics tests, and current
implementation evidence are the durable output. The original fault evidence
below is retained as the before-state record.

## Implemented resolution

1. **One executable catalog.** `lib/transition_modes.js` is the authoritative
   15-mode list used by Deck config, Timeline validation, shuffle, tests, and
   both CaptainPad selectors. Unknown and removed ids are rejected; the
   selector never infers validity from a `trans_*` prefix.
2. **Morse Blink removed.** The script was deleted and its references were
   removed from the engine, Timeline, HIL catalog, CaptainPad, gallery,
   language spec, and param-truth results. A stale-reference test covers all
   of those surfaces.
3. **No forced tail.** The universal `0.97` replacement is gone. The selected
   `trans_*` script renders every in-flight frame; completion atomically
   promotes B's handle and phase state.
4. **True crossfade.** Deck and mixer transition dispatch now compile and use
   `trans_crossfade`. Neither path uses `blend_screen` as a visual substitute.
5. **Fail-loud mechanics.** Bad mode, missing compiled blend, malformed
   duration, missing/freshness-invalid inactive state, and overlapping manual
   swap requests are explicit failures. There is no host-linear, alternate
   crossfade, or instant-load recovery on a failed animated swap.
6. **Deterministic phase policy.** B is seeded at phase zero and parked without
   ticking until selected. Handle and phase clocks promote together. A
   previously active/demoted handle is stale; asynchronous precompile replaces
   it before reuse. Sequential autopilot predicts forward; manual mode refreshes
   the demoted prior pattern; active shuffle does not make an ungrounded guess.
7. **Deterministic overlap policy.** Manual overlap returns typed `EBUSY`;
   autopilot logs and skips that beat; Timeline awaits the current transition
   and then awaits its own. None substitutes a cut.
8. **Hot-loop optimization.** WASM FROM/TO/OUT scratch is capacity-reused, Deck
   compositing writes into the existing Deck buffer, exact endpoints bypass the
   VM, and scratch growth allocates transactionally before releasing the prior
   buffers.

Current evidence anchors:

| Contract | Evidence |
| --- | --- |
| Canonical retained set and bounded shuffle | `lib/transition_modes.js:6-34` |
| Incoming B zero seed | `lib/api_server.js:2843` |
| Autopilot awaits landing | `lib/api_server.js:5801` |
| Timeline serializes current/next swaps | `lib/api_server.js:6345-6351` |
| Manual overlap and catalog enforcement | `lib/pattern_mixer.js:2837-2867` |
| Atomic handle + phase promotion | `lib/pattern_mixer.js:3070-3086` |
| Full selected-script composition, no tail cut | `lib/pattern_mixer.js:3545-3561` |
| Exact endpoints and reusable WASM scratch | `lib/wasm_host.js:254-320` |
| Non-binary full-Titanic oracle | `tests/effects/transitions_pixel_perfect.test.js:46-174` |
| Manual/autopilot/Timeline path contracts | `tests/mixer/deck_transition_path_contract.test.js:10-44` |
| Strict gallery discontinuity gate | `tools/transition_gallery/generate.mjs:391-410,536-545` |

## Canonical deterministic reproduction

- Model: `titanic`, 964 pixels.
- A: `baby_boy` entry `e_baby_boy_keel_breath`, pattern
  `baby/51_boy_keel_breath`, exact saved values, blue.
- B: `baby_girl` entry `e_baby_girl_keel_breath`, pattern
  `baby/66_girl_keel_breath`, exact saved values, pink.
- Clock: synchronized zero-seed endpoint VMs, 40 fps internal audit cadence.
- Sequence: 1 second A, 2 second current Deck transition, 1 second B.
- Media: 20 fps seekable MP4 plus GIF, with identical top, front, and TE-sign
  views on every row.

Run from `marsin_engine/`:

```bash
node tools/transition_gallery/generate.mjs
node tools/transition_gallery/generate.mjs --strict-audit
```

The strict form writes the evidence and exits `2` while any tail replacement
is at least two RMS bytes. It starts no engine, binds no port, and writes
scratch only under `~/tmp/transition_gallery/`.

## Cold-audit KEEP / TUNE / OPTIMIZE / REMOVE board (before repair)

| Transition | Verdict | Evidence |
| --- | --- | --- |
| `trans_crossfade` | **TUNE — P0** | Actual Deck blend is `blend_screen`, not the transition script. At the 0.97 replacement the canonical full rig jumps **21.62 RMS bytes**, max delta 120, all 964 pixels. At scripted progress 1, screen output is still up to 142 bytes away from B. |
| `trans_flash` | **TUNE — P0** | Tail replacement interrupts the scripted white-to-B return: **25.99 RMS**, max 35, all pixels. |
| `trans_color_burst` | **TUNE — P0** | Tail replacement interrupts the burst-to-B return: **12.86 RMS**, max 29, all pixels. |
| `trans_morse_blink` | **REMOVE from shuffle** | Stateful duration inference assumes 40 Hz and silently substitutes a crossfade when its inferred duration is short (`patterns/transitions/trans_morse_blink.js:76-138`). Its canonical largest frame jump is 16.26 RMS. |
| `trans_ripple_in` | **TUNE** | Keep the visual concept; `sliderRingDamping` is WRONG and `sliderRings` is WEAK in `tools/param_truth/param_truth_results.md:162,332`. |
| `trans_wave_sweep` | **TUNE** | Keep the visual concept; `sliderWaveFreq` is WRONG in `tools/param_truth/param_truth_results.md:163,185`. |
| `trans_diagonal_wipe` | **KEEP** | Deterministic, endpoint-shaped, allocation-free. Canonical tail jump 0.45 RMS. |
| `trans_diamond_wipe` | **KEEP** | Deterministic, endpoint-shaped, allocation-free. Tail 0.46 RMS. |
| `trans_dissolve` | **KEEP** | Index-hash dissolve is deterministic; it does not call VM `random()`. Tail 1.07 RMS. |
| `trans_iris` | **KEEP** | Deterministic and spatially truthful. Tail 0.46 RMS. |
| `trans_iris_close` | **KEEP** | Deterministic and spatially truthful. Tail 0.45 RMS. |
| `trans_split_horizontal` | **KEEP** | Deterministic and spatially truthful. Tail 0.47 RMS. |
| `trans_split_vertical` | **KEEP** | Deterministic and spatially truthful. Tail 0.46 RMS. |
| `trans_wipe_down` | **KEEP** | Deterministic and directionally truthful. Tail 0.47 RMS. |
| `trans_wipe_left` | **KEEP** | Deterministic and directionally truthful. Tail 0.45 RMS. |
| `trans_wipe_right` | **KEEP** | Deterministic and directionally truthful. Tail 0.46 RMS. |

No transition is ranked OPTIMIZE. All 16 scripts are allocation-free and small;
the proved faults are selection/state/compositing faults rather than an
instruction-budget overrun.

## Deck transition selection and execution map

1. **Manual saved-entry selection** — `POST /deck/playlist/entry` at
   `lib/api_server.js:13007` calls `loadPlaylistEntryWithTransition` at
   `:13043`. This is the primary animated Deck path.
2. **Deck autopilot** — the picker at `lib/api_server.js:5746` calls the same
   transition loader at `:5761` and awaits its completion at `:5764`.
3. **Timeline and special-event playlist cue** —
   `timelineLoadPlaylistOnDeck` begins at `lib/api_server.js:6211` and normally
   uses the same transition loader at `:6268`; cue transition settings enter
   through `timelineSetDeckTransition` at `:6307`.
4. **Transition selection** — fixed mode uses the saved config; shuffle uses
   unseeded `Math.random()` at `lib/api_server.js:2697-2712`, so a show cannot
   replay a prior transition sequence from state alone.
5. **Compile and shadow setup** — the incoming pattern is compiled at
   `lib/api_server.js:2816-2822`, registered as `__deck_swap__` at `:2837`,
   seeded with exact entry defaults at `:2868-2887`, then handed to
   `triggerDeckPatternSwap` at `:2893`.
6. **Fader and handle promotion** — `triggerDeckPatternSwap` starts at
   `lib/pattern_mixer.js:2822`; `updateDeckSwapTransition` advances a
   smoothstep fader at `:3022-3030` and promotes the incoming handle at
   `:3041-3059`.
7. **Actual Deck compositing** — inactive B is rendered over A at
   `lib/pattern_mixer.js:3518-3555`. The unconditional full-buffer replacement
   is `TAIL_REPLACE_THRESHOLD = 0.97` at `:3545-3547`.
8. **Playlist assignment bypass** — `POST /deck/playlist` at
   `lib/api_server.js:12872` calls the instant loader at `:12909`; changing
   playlists hard-cuts to the first entry even when Deck transitions are on.
9. **Legacy/direct pattern bypass** — `POST /pattern` and `/set-pattern` start
   at `lib/api_server.js:7193` and replace the live handle in place at
   `:7247-7257`. They never enter the transition loader.
10. **Layer departure force-completion** — layer changes call
    `finishDeckSwapNow` at `lib/api_server.js:11261` and `:11423`; that method
    forces completion at `lib/pattern_mixer.js:2985-2995`.
11. **Mixer transition path** — overlay transitions use
    `triggerMixerTransition` at `lib/pattern_mixer.js:2565`. It shares the
    transition scripts but is not the Deck double-buffer path.

## Proven fault details

### P0-1: screen “crossfade” plus early full-rig cut

`triggerDeckPatternSwap` special-cases `trans_crossfade` so its actual mode is
the steady `blend_screen` (`lib/pattern_mixer.js:2865-2879`). Screen compositing
does not converge to B: at progress 1 it is
`1 - (1 - A) * (1 - B)`, so A remains visible. The attempted tail fix then
hard-replaces the whole 964-pixel buffer at eased progress 0.972 in the first
40 fps frame above the 0.97 threshold. Visual QA shows the rig shift from a
bright purple A+B screen composite to materially darker pink in one frame.

### P0-2: the crossfade-only workaround affects every script

The branch at `lib/pattern_mixer.js:3545-3547` does not check the inactive
mode. Flash and Color Burst therefore jump before their own return curves reach
B. Both canonical discontinuities affect every pixel. The ten deterministic
spatial transitions are much closer to B at that point, but they still bypass
their final authored three percent.

### P0-3: path-dependent incoming phase

Fresh incoming handles begin at zero during a manual or shuffled selection
(`lib/api_server.js:2816-2844`). Only active sequential autopilot precompiles
the predicted next pattern (`:3012-3049`); manual and shuffled paths explicitly
skip this. A warmed inactive handle advances alongside A at
`lib/pattern_mixer.js:3223-3233`.

The paired Baby Keel patterns have byte-identical intensity topology when
phase-aligned (0.00 RMS at one second). Comparing A at one second with a freshly
compiled B at zero yields **8.65 RMS intensity bytes across 964 pixels**. Thus
the same A→B request can preserve motion phase on sequential autopilot and reset
the incoming motion on manual/shuffled paths.

### P0-4: non-fail-loud degradation paths

- Unknown `trans_*` names pass prefix-only validation at
  `lib/api_server.js:13163`, then a missing blend silently becomes crossfade at
  `lib/pattern_mixer.js:2871-2875`.
- A rejected Deck swap silently becomes an instant load at
  `lib/api_server.js:2971-2984`.
- A missing blend handle silently becomes host-side linear interpolation at
  `lib/pattern_mixer.js:3556-3563`.
- An overlapping timeline cue hard-loads immediately at
  `lib/api_server.js:6251-6268`.

These are explicit warnings in logs, but visually they substitute behavior
instead of failing the request. They violate the task's no-fallback contract.

### Test blind spots

The existing endpoint oracle uses almost exclusively 0/255-friendly endpoint
bytes (`tests/effects/transitions_pixel_perfect.test.js:55-73`). Real Baby
buffers show a one-byte quantization residual at scripted progress 1 for 15
scripts; the actual Deck screen blend is up to 142 bytes from B.

Its “at least one quarter sample differs from both endpoints” guard is also
vacuous: `off25` and `off75` use `!equals(FROM) || !equals(TO)` at
`tests/effects/transitions_pixel_perfect.test.js:163-167`, which is true for an
endpoint-sized output whenever FROM and TO differ. Existing tests therefore
passed 59/59 while the canonical full-rig executor reproduced the P0 jump.

## Negative findings

- No RGBWAU fixture-lane permutation was found. All 16 scripts apply the same
  expression to W and A with their respective inputs.
- No stale Deck buffer was found in the normal render loop; Deck, mixer, live,
  and channel buffers are cleared before composition.
- No palette race was reproduced with the canonical endpoints. These Baby
  patterns are intentionally hard-coded RGB, so CPC palette slew is not part of
  the canonical A/B proof.
- No per-pixel allocation or transition-script instruction-budget fault was
  found.

## Durable artifacts

- Generator: `marsin_engine/tools/transition_gallery/generate.mjs`
- Procedure: `marsin_engine/tools/transition_gallery/README.md`
- Gallery: `docs/pattern_gallery/transitions/index.html`
- Machine-readable measurements: `docs/pattern_gallery/transitions/manifest.json`
- Media: 15 seekable MP4s and 15 GIFs
- Contract tests: `marsin_engine/tests/patterns/transition_gallery_tool.test.mjs`
- Shared renderer export and combined index support:
  `marsin_engine/tools/playlist_gallery/generate.mjs`

The generated master index links the transition gallery and preserves the
fresh Baby Tease, Boy, and Girl galleries at counts **20/30/30**. No Baby
playlist, pattern, special-event file, manifest, GIF, or MP4 was edited by the
transition generator.

## Files changed

Mechanics and catalogs:

- `marsin_engine/lib/api_server.js`
- `marsin_engine/lib/pattern_mixer.js`
- `marsin_engine/lib/wasm_host.js`
- `marsin_engine/lib/transition_modes.js` (new)
- `marsin_engine/lib/timeline/show_plan.js`
- `marsin_engine/patterns/transitions/trans_morse_blink.js` (deleted)
- `CaptainPad/components/DeckTransitionControls.tsx`
- `CaptainPad/utils/timelineApi.ts`

Offline tools, docs, and generated gallery:

- `marsin_engine/tools/transition_gallery/generate.mjs`
- `marsin_engine/tools/transition_gallery/README.md`
- `marsin_engine/tools/playlist_gallery/generate.mjs`
- `marsin_engine/tools/param_truth/param_truth_results.json`
- `docs/MARSIN_PB_LANG_SPEC.md`
- `docs/pattern_gallery/index.html`
- `docs/pattern_gallery/transitions/index.html`
- `docs/pattern_gallery/transitions/manifest.json`
- `docs/pattern_gallery/transitions/gifs/001_trans_color_burst.gif` through
  `015_trans_wipe_right.gif` (the manifest names all 15 exact files)
- `docs/pattern_gallery/transitions/videos/001_trans_color_burst.mp4` through
  `015_trans_wipe_right.mp4` (the manifest names all 15 exact files)

Tests and dossier:

- `marsin_engine/tests/effects/transition_modes.test.js`
- `marsin_engine/tests/effects/transitions_pixel_perfect.test.js`
- `marsin_engine/tests/hil/hil_transition_pixel_perfect_test.mjs`
- `marsin_engine/tests/mixer/blend_mode_validation.test.js`
- `marsin_engine/tests/mixer/deck_swap_cancel_notify.test.js`
- `marsin_engine/tests/mixer/deck_swap_param.test.js`
- `marsin_engine/tests/mixer/deck_transition_path_contract.test.js` (new)
- `marsin_engine/tests/patterns/transition_gallery_tool.test.mjs`
- `.agent/reports/202608/20260815_245_deck_transition_debug_audit.md`

## Final verification

```text
node --check lib/api_server.js
node --check lib/pattern_mixer.js
node --check lib/wasm_host.js
node --check lib/transition_modes.js
node --check tools/transition_gallery/generate.mjs
node engine.js --list
# PASS

npm run check:dry-run
# PASS; test_const compiled and rendered offline

node --test tests/effects/transition_modes.test.js \
  tests/effects/transitions_pixel_perfect.test.js \
  tests/patterns/transition_gallery_tool.test.mjs \
  tests/mixer/deck_swap_param.test.js \
  tests/mixer/deck_swap_cancel_notify.test.js \
  tests/mixer/deck_transition_path_contract.test.js \
  tests/mixer/blend_mode_validation.test.js \
  tests/mixer/channel_ops_state.test.js \
  tests/mixer/fader_lock.test.js \
  tests/timeline/timeline_show_plan.test.js \
  tests/timeline/timeline_service.test.js \
  tests/timeline/timeline_deck_release_default_cue.test.js
# 221 passed, 0 failed

# Post-final focused rerun of transition/catalog/gallery/mixer contracts:
# 54 passed, 0 failed

npm run typecheck  # CaptainPad
# PASS

npx eslint components/DeckTransitionControls.tsx utils/timelineApi.ts
# PASS

node tools/transition_gallery/generate.mjs --strict-audit
# PASS; 15 rows, p0OpenCount 0, combined index rebuilt
```

Visual QA sampled start, midpoint, landing, and B-hold frames from Crossfade,
Flash, and Ripple In MP4s. All three Titanic views remain aligned; Crossfade
progresses blue→mixed→pink without the former purple-screen tail collapse;
Flash returns from white continuously; Ripple lands on pink without a terminal
pop.

An attempted repository-wide `npm test` was stopped rather than counted: that
suite crosses into subprocess/service HIL-style coverage and opened temporary
test listeners (including OSC port 10000) despite redirected temporary state
and the documentation-only sACN destination. No test-owned listener remained
after termination, and no pre-existing service was stopped. All acceptance
evidence above comes from the focused, process-free test set and dry run.

## Historical pre-repair verification

```text
node --check tools/transition_gallery/generate.mjs
node --check tools/playlist_gallery/generate.mjs

node --import ./tests/helpers/setup_config_guard.mjs --test \
  tests/patterns/transition_gallery_tool.test.mjs \
  tests/patterns/playlist_gallery_tool.test.mjs \
  tests/effects/transitions_pixel_perfect.test.js

31 tests passed, 0 failed.
```

Visual QA extracted a 16-frame contact sheet from the crossfade MP4 and
adjacent frames at 2.75 and 2.85 seconds. The three Titanic views remain
aligned, A→purple screen composite→pink B is legible, and the tail brightness
drop is visible in the adjacent frames.

## Cold-audit repair list (all resolved above)

1. Route `trans_crossfade` through a true endpoint-convergent blend
   (`trans_crossfade` or `blend_over`) and delete the screen-tail workaround.
2. Restrict or remove the 0.97 replacement for every scripted transition; add
   a 964-pixel arbitrary-byte, adjacent-frame Deck compositor oracle.
3. Make manual, sequential, and shuffle incoming-phase policy explicit and
   deterministic.
4. Remove `trans_morse_blink` from shuffle until duration is provided as a real
   transition builtin and safety failure is surfaced.
5. Validate transition file existence before accepting configuration; remove
   crossfade/instant/host-linear visual fallbacks.
6. Decide whether playlist assignment and direct `/pattern` should animate or
   remain explicitly named hard-cut operations.

## Remaining risks / follow-up

- Live/HIL transition playback was intentionally not run. The task prohibited
  touching live runtime state and service ports; production evidence is the
  real WASM 964-pixel offline oracle plus state-machine unit coverage.
- `trans_ripple_in` and `trans_wave_sweep` remain **TUNE** for previously
  measured weak/wrong artistic slider response. Their transition mechanics and
  endpoint continuity pass; this is parameter-design debt, not an open visual
  discontinuity.
- Direct `/pattern` replacement and an explicitly disabled Deck transition are
  deliberate instant operations outside the animated transition path.
