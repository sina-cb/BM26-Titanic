# _217 — IMPL: COLORS schemes + engine crossfade + fullscreen + perf overlay

**Date:** 2026-08-14 · **Agent:** _217 (Opus, implementer) ·
**Branch:** feat/bm_audio_tuning (shared tree — no git ops).
**Contract:** `docs/55_colors_schemes_and_perf_overlay.md` (the `_216` design),
all 11 work items. **Rationale:** `.agent/reports/202608/20260814_216_colors_schemes_perf_overlay_design.md`.

The operator's five intents, all landed:

1. Live Touch scheme generators (MASTER / HUE / COMPLEMENT / CONTRAST) in the
   Deck COLORS window — ported verbatim from `docs/ui/touch_control.html`.
2. + 3. The crossfade DRIVES THE RIG and the scheme's five colours feed it:
   one mechanism — a 2-entry TURNS ring on the engine's colour-autopilot
   daemon, with `delay_s: 0` for the continuous triangle.
4. PATTERNS goes truly fullscreen in narrow mode when it is the only window.
5. Performance mode hides PARAMETERS + AUTOPILOT and restores them on exit.

---

## What landed, per contract item

| # | Item | Files | State |
|---|---|---|---|
| 1 | `lerpHue` + colour-aware `lerpParams` | `marsin_engine/lib/color_autopilot.js` | DONE (one AS BUILT refinement, below) |
| 2 | `delay_s: 0` (validate + `_scheduleNext`) | `color_autopilot.js` | DONE |
| 3 | Full-HSV pair channels (validate + resolver) | `color_autopilot.js`, `lib/api_server.js` | DONE |
| 4 | Seed on REST activation | `api_server.js` | DONE |
| 5 | Logic module: schemes, `rotationKind`, pair widening, `crossfadeAutopilotPatch`, `blendFromBroadcast`, preview-math removal | `components/deck/colors_window_logic.ts` | DONE (+ `schemeTapOutcome`, below) |
| 6 | SCHEMES row + latch / re-theme / restage | `components/deck/colors_window.tsx` | DONE |
| 7 | CROSSFADE card rewrite | `colors_window.tsx` | DONE |
| 8 | Types + ColorAutopilotPanel widening | `utils/api.ts`, `utils/timelineApi.ts`, `components/deck/ColorAutopilotPanel.tsx` | DONE |
| 9 | Perf overlay (pure fns + hook + bar) | `deck_workspace_layout.ts`, `deck_workspace.tsx`, `app/(tabs)/index.tsx` | DONE |
| 10 | Narrow fullscreen | `deck_workspace_layout.ts`, `index.tsx` | DONE |
| 11 | docs/53 §8 AS BUILT supersession | `docs/53_deck_workspace_windows.md` | DONE |

### Engine (items 1–4)

`lerpHue(a, b, t)` is exported from `color_autopilot.js` and used by
`lerpParams` for the `h` channel of colour-shaped `{h,s,v}` sub-objects only.
`validate` now accepts `delay_s >= 0` and each of `c1`/`c2` as EITHER a hue
number OR a full `{h,s,v}` — via a new exported `validatePaletteChannel(value,
label)` that `api_server.js`'s resolver reuses, so the daemon's front door and
the timeline/look resolver cannot disagree about what a legal pair is.

`_scheduleNext`'s `Number(st.delay_s) > 0 ? … : DEFAULT_DELAY_S` is gone. That
line was the codex violation the design named: it would have turned the
operator's explicit CONT into a silent 30 s hold. The default now covers only
the truly-absent / unparseable case (a legacy config with no `delay_s` at
all), which is pinned by its own test so the fallback cannot creep back.

`setColorAutopilot` seeds `_currentParams` from the live CPC on activation —
the four lines the timeline path already runs, deliberately WITHOUT
`triggerNext()`, so the manual REST toggle keeps its wait-then-cycle cadence.

### Client (items 5–8)

The `_211` preview transport is RETIRED. There is no `setInterval`, no
`requestAnimationFrame` and no `phase` state left in `colors_window.tsx`; the
card is `CROSSFADE · DRIVES THE RIG` and its wash strip, PAR strip, wheel
handles and BLEND readout all derive from the broadcast `colorPalette1/2`.
`triangle` / `advancePhase` / `seekPhase` / `blendAt` are deleted (with their
tests); `mixHsv` stays for the scrubber-track gradient.

The TURNS draft is `Hsv[]`, slot swatches render the true staged HSV, and
`litPairIndex` compares all three channels — without that a HUE ring (five
entries at ONE hue) would highlight turn 1 forever.

### Workspace (items 9–10)

`effectiveOpenWindows` / `effectiveRailWindows` / `patternsFillsNarrow` are
pure functions in `deck_workspace_layout.ts`; `useDeckWorkspace()` subscribes
`usePerformanceMode().active` RAW and answers `open` / `isOpen` / `flexFor`
from the effective set. `layoutReducer`, `normalizeLayout`,
`DECK_WORKSPACE_LAYOUT_KEY` and `narrowScrollOwner` are untouched — the
overlay has no action to dispatch, by construction.

---

## AS BUILT — deviations and additions

1. **`isColourShaped` is RANGE-CHECKED, not just shape-checked.** The contract
   says "when BOTH sub-objects are colour-shaped (numeric `h`, `s`, `v`)". A
   pure shape check breaks on values that are not on the unit wheel: the
   existing crossfade suite's fixtures use `h` values of 0 / 100 / 240, and
   `lerpHue(0, 100, t)` collapses the modular delta to zero — the fade would
   silently stop moving. So a colour leaf additionally requires every channel
   finite in `[0,1]`. This is a correctness precondition for modular
   arithmetic, not a fallback: every engine palette path emits channels in
   `[0,1]`, so real colours always take the short arc, and it is exactly what
   keeps the contract's "existing lerp tests unchanged" true. Pinned by
   `lerpParams leaves NON-colour objects byte-identical to the linear behavior`.

2. **`schemeTapOutcome(kind, schemeTitle)` added to the logic module.** Not in
   the contract's item-5 list, but §2.6's interaction table is a rule and this
   repo's habit is that a rule stated in a doc is a pure function with a test,
   not a condition buried in a handler. Six tests cover the table row by row,
   including "nothing anywhere auto-pauses".

3. **`manualWriteGate`'s refusal sentence is now kind-agnostic**:
   `"A colour rotation is driving the colours — pause it to edit."` The old
   copy named PALETTE TURNS specifically, which is a lie while a crossfade or
   a library palette-set is the thing driving. The `/pause it to edit/`
   contract the existing tests assert is unchanged.

4. **`ColorAutopilotPanel` renders CONTINUOUS as a sentence plus a live pill
   row**, rather than a pill bar with nothing selected. The contract asked for
   "CONTINUOUS instead of a blank pill"; a bare label would have left no way
   back to a hold from that panel, so the hold pills stay one tap away
   underneath. The panel's inline-chip hue read is also fixed — it multiplied
   `inline.c1` by 360 directly, which renders `NaN°` for the object channel
   form and hands `DualSwatch` an object where it expects a hue.

5. **The `--dest` black hole in `color_window_engine_api.test.js` moved from a
   loopback address to TEST-NET-1** before running it, because loopback is not
   isolation (the sim's sACN receiver binds every interface). Report `_219`
   swept the same change across the rest of the engine tests concurrently; the
   two agree.

6. **Screenshot "before" frames are not literal pre-change captures.** The
   dist is built from the post-change tree and reverting to rebuild an old one
   would be a git operation. Instead each row carries its own CONTRAST frame
   from the same build — e.g. S5a (two windows open → the pin still holds) next
   to S5b (PATTERNS alone → it fills), which proves both that the fix engages
   and that it is strictly conditional. Stated so nobody reads the pairs as
   before/after of two builds.

---

## Suites

**CaptainPad** `npx vitest run` — **1372 pass / 6 skip / 0 fail** (72 files).
Baseline was 1328 / 6 / 0. **Failing list: EMPTY, before and after.** +44 tests
(`colors_window_logic.test.ts` 62 → 94, `deck_workspace_layout.test.ts` 29 →
41). `npx tsc --noEmit` clean. `eslint` on all ten touched files: clean (the
pre-existing `Array<T>` / unused-`Platform` warnings in `utils/api.ts` are
untouched and not mine).

**Engine** `npm test` — failing list:

- `dev_test_bench: loads through loadModelForGauge without throwing` ×1
- `dev_test_bench: repaired sidecar loads the zero-pixel development model`
- `dev_test_bench: every patched pixel's (universe, addr[, footprint]) is in range`
- `dev_test_bench: boot-time universeIds match the pixel+specialEffects union`
- `dev_test_bench: cross-fixture (universe,channel) overlap count is pinned`
- `split baby galleries expose the outcome-blind tease and manual answers`
- `party_dancers contains only the baseline with complete DOM wiring`

The five `dev_test_bench` groupBits-drift failures and the baby-gallery ENOENT
are the known pre-existing set. `party_dancers` is a pattern-tuning numeric
drift (`0.7625` vs an expected `0.75`) in the operator's concurrent
audio-tuning work on this branch — this wave touched zero pattern files, and
the test fails identically in isolation.

**Two intermittents observed once each and NOT reproducible** (both passed in
isolation and in the final run): `C1 · hold expiry lands on AMBIENT …`
(`tests/e2e/timeline_zoom_e2e.test.js`) and `performance mode gates
special-event ARM on a FRESH operator passcode`. Both are timing-sensitive
under `--test-concurrency=4`; flagged, not chased.

Colour suites specifically: `color_autopilot.test.js` + `color_window_engine_api.test.js`
= **56 pass / 0 fail** (was 29 + 8 = 37). New coverage: the D1 reference table,
the long-way-round property sweep, colour-vs-non-colour `lerpParams`, full-HSV
validate + deep-copy + per-channel throws, `delay_s: 0` accepted/refused, the
fake-clock proof that CONT re-arms with ZERO hold, a real-timer back-to-back
CONT cycle, the absent-`delay_s` legacy fallback, runtime-YAML round trip of a
CONT full-HSV ring, and over HTTP: full-HSV round trip, CONT round trip,
zero+zero refusal, real `s`/`v` painted onto the CPC, REST activation fading
instead of snapping, and an inactive POST not seeding.

---

## Screenshots — `~/tmp/fix_217/`

24 PNGs, every one visually inspected. Captured against a FRESH
`npm run web:build` dist served on **:7167** (never the operator's :6967),
console muted via `evaluateOnNewDocument` before boot, one tab, iPad 11"
landscape 1194×834 and portrait 834×1194. Engine reads and the full transcript
are in `engine_reads.txt`; capture scripts are `shoot.cjs`, `shoot2.cjs`,
`live_rig_proof.cjs`.

Rows S1 / S3 / S4 / S5 / S6 ran against an **ISOLATED engine on :7842**
(scratch `MARSIN_STATE_DIR` / `MARSIN_CONFIG_FILE` under `~/tmp`, sACN
black-holed on TEST-NET-1) — they exercise CONT and full-HSV rings, which the
operator's long-running engine cannot accept because it is running the code
from before this wave. Row S2 additionally ran against the OPERATOR'S engine.

| Row | Files | Proof |
|---|---|---|
| S1 | `S1a_wide_schemes_row_idle`, `S1b_wide_contrast_latched`, `S1c_wide_hue_brightness_ramp`, `S1d_narrow_schemes_row` | CONTRAST tap → `/param-center` A/B = 211° / 283° (72° apart, scheme[0..1]); latch wears the accentWash on-state + its sentence |
| S2 | `S2a_wide_crossfade_card_stopped`, `S2b_wide_crossfade_running_cont`, `S2c_wide_crossfade_stopped_frozen`, **`S2d_wide_crossfade_card_running_full`** | `/color-autopilot` = `active:true, delay_s:0, transitionMs:1500`, 2-pair ring; `/param-center` 1.3 s apart shows moving hues; after STOP two reads 1.2 s apart are bit-identical (frozen). S2d is the whole card: RUNNING, FADE + HOLD(CONT) pills, BLEND POSITION `56% B` derived from the broadcast |
| S2 (live) | **`S2e_LIVE_RIG_crossfade_running`** | see "the actual rig" below |
| S3 | `S3a_wide_turns_hue_ring_staged`, **`S3b_wide_turns_running_full_hsv`** | `/color-autopilot` = 5 chained FULL-HSV pairs, `v` ramp `1 / .78 / .58 / .40 / .25` on the wire; the T1–T5 slot swatches show the brightness ramp on the glass |
| S4 | `S4a_wide_scheme_restage_narrated`, `S4b`, `S4c`, **`S4d_wide_refusal_message_line`** | RESTAGE: `active` stayed `true`, `delay_s` stayed 30, palettes changed — one tap, no pause. S4d shows the refusal sentence in error ink on the message line |
| S5 | **`S5a_narrow_two_windows_pin_holds`**, **`S5b_narrow_patterns_fullscreen`**, `S5c_narrow_pin_restored_on_reopen` | S5a: a second window open → the fixed pin still ends mid-screen with COLORS scrolling below. S5b: PATTERNS alone → fills to the safety bar. S5c: reopen one → the pin is back |
| S6 | `S6a_wide_edit_mode_all_chips`, **`S6b_wide_performance_chips_suppressed`**, `S6c_wide_back_to_edit_restored`, `S6d`–`S6f` narrow | In show mode: both windows gone, both chips gone, `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN` on the bar, COLORS chip and window live. `deck_workspace_layout_v1` = `{"closed":[]}` BEFORE, DURING and AFTER — byte-identical across the round trip (and `{"closed":["colors"]}` in the narrow pass, likewise unchanged) |

### The actual rig

`S2e_LIVE_RIG_crossfade_running.png` — the crossfade driven from the :7167
dist against the operator's engine, colours moving on the ship. The card shows
FADE 1.5 s / HOLD 1 s / `0° ⇄ 47°` over the live "Baby Girl · Rose Glow"
playlist.

```
POST (via the UI)  {active:true, palettes:[{c1:0,c2:0.13},{c1:0.13,c2:0}],
                    delay_s:1, transitionMs:1500}
/param-center @0.7 s   c1.h = 0.4312 → 0.1713 → 0.0000 → 0.0000 → 0.0536 → 0.1135
STOP                   c1.h = 0.130000, and 0.130000 again 1.5 s later (frozen)
```

HOLD 1 s (not CONT) because the operator's engine predates this wave's
`delay_s: 0` support; CONT and full-HSV rings are proved on the isolated
engine instead. **This is the one part of the wave that needs an engine
restart to reach the live rig — the operator's call, flagged below.**

### Rig-state restoration

```
BEFORE  colorPalette1 {"h":0,"s":1,"v":1}   colorPalette2 {"h":0.13,"s":1,"v":1}
        colorAutopilot active:false, 5-pair ring (0.7311/0.5332/0.0816/0.2667/0.1301),
                       delay_s 5, transitionMs 1250
AFTER   colorPalette1 {"h":0,"s":1,"v":1}   colorPalette2 {"h":0.13,"s":1,"v":1}
        colorAutopilot IDENTICAL (verified field by field)
        PALETTE RESTORED EXACTLY  = true
        AUTOPILOT CONFIG RESTORED = true
```

The rotation I started was stopped and the daemon left inactive, exactly as
found. The deck header's FADE pill was momentarily changed by a mis-scoped
click in the first attempt — it is `_selectedFadeSeconds`, a module-level
in-memory variable in `MasterFadeGroup.tsx` that is neither persisted nor sent
to the engine, so it lived only inside the throwaway puppeteer tab; the
operator's own tab was never touched. Verified: that first attempt's RUN was
REFUSED by the old engine (CONT), so it wrote nothing at all —
`/deck/color-autopilot` and `/param-center` were byte-identical afterwards.

### Hygiene

No test wrote `simulation/scenes/**` or `marsin_engine/states/**`: the
isolated engine ran with scratch `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` /
`MARSIN_CONFIG_FILE` under `~/tmp/fix_217`. Ports 6966–6972 and sACN 5568 were
never bound, restarted or swept; the only writes to :6968 were the two
deliberate, restored ones above plus read-only GETs. No mic, no npm install,
no git operations. `marsin_engine/config.color_autopilot_runtime.yaml` is
gitignored. `states/**` and `simulation/scenes/**` diffs in `git status` are
the operator's live engine autosaving and his concurrent branch work —
reported, not reverted.

---

## Open for the operator

1. **The engine needs a restart for the new half of this wave to reach the
   live rig.** CONT (`delay_s: 0`) and full-HSV scheme rings are rejected by
   the currently-running engine, which predates these changes. Everything the
   old engine already accepts — the SCHEMES row, A/B writes, hue-only
   crossfades with a hold — works against it today.
2. **HUE at night** (docs/55 §8.1): the darkest HUE turn runs `v = 0.25`,
   shipped as designed because that is the Live Touch algorithm. Say the word
   and the floor rises.
3. **Crossfade HOLD default** is CONT, per §8.2.
4. **Perf caption wording** is `PERFORMANCE — PARAMS & AUTOPILOT HIDDEN`, per §8.3.
5. **`party_dancers` is red on this branch** from a pattern-tuning numeric
   drift (`0.7625` vs `0.75`) that predates this wave — worth a look before
   the merge gate.
