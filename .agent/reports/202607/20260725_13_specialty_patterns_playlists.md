# 20260725_13 — Specialty patterns: WHITE ONLY family, UV spike, 7 themed DRAFT playlists

**Author:** Implementation agent (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-27
**Workstream:** `bm26_show_readiness.md` R2/R3 (§ "Specialty & themed playlists")
**Builds on:** `20260725_12` (playlist format + DRAFT trio) — reused, not re-invented
**Deploy:** `DEPLOY OK: titanic-ext is running test_bench from e805ef01.` (verified live, §6)

## TL;DR

1. **Five pure-white patterns shipped** (`60`–`64`) — wash / breathe / shimmer /
   chase / dim-warm-temple. They are white by *construction*, not by
   convention: no palette exports (so the global palette autopilot physically
   cannot bind), neutral RGB (hue-invariant, so the per-channel hue stage
   cannot tint), and an explicit W lane (so the dedicated white emitter is
   controlled, not host-synthesised).
2. **UV inventory: the rig has NO true UV.** The `u` lane is a **violet/purple
   emitter** — the UKing par's manual calls DMX ch 7 "Purple", the Shehds bar's
   pixel order ends in "Violet". Only pars + bars have it at all (§2).
3. **UV spike built anyway and it works** — `65_uv_only` drives the violet lane
   and nothing else, verified byte-exact on both models. It sits in `uv_test`
   and **no other playlist**, pinned by a test.
4. **Nine playlists × 2 scenes** written in _12's exact format: `white_only`,
   `uv_test`, and the seven themed DRAFT lists.
5. **Theme colour cannot come from playlist `defaults`** — `colorPalette1/2`
   are CPC-shared exports and `applyEntryDefaults` deliberately skips shared
   exports. Theme colour must be set by the LOOK's `palette:` in the show plan.
   Per-theme palette recommendations in §5.2.
6. **A latent harness bug was found and fixed.** `pattern_audio_harness.mjs`
   never packed `fixtureTypeId` and never injected the `FIX_*` constants — so
   **every `fixtureType`-branching pattern failed to compile offline**
   (`27_swipe` → `COMPILE_FAIL: Undefined var FIX_PAR`). Fixed; the offline
   harness now sees the same meta the live engine does (§4).
7. **Suite: 2202 / 2195 pass / 7 fail** — exactly the _12 baseline (2155/2148/7)
   plus this wave's 47 new tests, all green. `marsin_engine/states/` md5-identical
   before and after (§6).

---

## 1. Patterns authored

All in `marsin_engine/patterns/`, all registered in `patterns/manifest.json`.
Numbering starts at 60 to leave a clean gap after the existing `58`.

| File | Pattern name | Concept | Local params (MFT order) |
|---|---|---|---|
| `60_white_wash.js` | White Wash | Pure-white ambient wash; `evenness` collapses it to a **flat even work light** | localSpeed, direction, level, kick, radius, evenness, whiteLevel, whiteKick, warmth |
| `61_white_breathe.js` | White Breathe | Slow whole-rig inhale/exhale with a travelling roll | localSpeed, direction, level, kick, radius, depth, whiteLevel, whiteKick, warmth |
| `62_white_shimmer.js` | White Shimmer | Champagne/frost sparkle over a dim bed; the family's true-black member | localSpeed, direction, level, kick, radius, density, sharpness, whiteLevel, whiteKick, warmth |
| `63_white_chase.js` | White Chase | Hard white bars sweeping on a **rotating** axis, with tails | localSpeed, direction, level, kick, radius, tailLength, count, whiteLevel, whiteKick, warmth |
| `64_temple_warm_white.js` | Temple Warm White | Dim candle-warm slow drift, hard `ceiling` cap, shallow audio response | localSpeed, direction, level, kick, radius, ceiling, warmth, whiteLevel, whiteKick |
| `65_uv_only.js` | UV Only **(SPIKE)** | Violet undertow × bloom on the `u` lane only | localSpeed, direction, level, kick, radius, sharpness, uvFloor, rgbViolet |

Project rules honoured on all six: `sliderLocalSpeed` is the **first** local
param, `sliderDirection` is the **second**, ≤ 12 locals (MFT bank-1 budget),
identity sliders storing `v` directly, guarded direction (never a 0 sign),
autonomous heading variation on a soft-clipped sine at a **distinct**
incommensurate cadence per pattern (45.6 s / 61 s / 37 s / 29 s / 112 s / 52 s),
and phase accumulators wrapped at 1000 turns (never at 1.0).

### 1.1 How "pure white" is actually guaranteed

Three things could tint a white pattern. All three are closed:

| Threat | Why it is closed |
|---|---|
| The **global palette / palette autopilot** writes `colorPalette1/2` into any pattern that declares them | These patterns **declare neither**. `ParamCenter` only writes into exports present in the channel's `controlMap`, so there is nothing to bind. A test asserts no `colorPalette*` export and no `cp1/cp2` var. |
| The **per-channel hue stage** (`pattern_mixer.applyHueShift6chU8`) rotates RGB hue | Neutral RGB is desaturated — there is no hue to rotate. White survives hue at any setting. (It also never touches W/A/U.) |
| **W is left to the mapper** — `sacn_mapper` host-synths `W = min(R,G,B)` for DMX fixtures when the pattern emits no explicit W | Every member calls `rgbwau(...)` with a computed `w`. This matters: without it the sim still *looks* white while the dedicated white emitter stays dark on hardware. Pinned by a test. |

### 1.2 `whiteLevel` is a CROSSFADE, not an addition

`whiteLevel` moves the white between the RGB lanes and the dedicated W emitter
(`rgbShare = 1 − 0.72·whiteLevel`) rather than stacking both at full. Two
reasons: total output stays roughly constant across the knob, and the RGB-only
TE Sign panels keep a real share at every setting instead of going dark.

**Tuning note for R2 (real, on-rig consequence):** at `whiteLevel = 1.0` the
sign sits at **28 %** of the pars' output, because it has no W emitter to
receive the other 72 %. For any look where the sign must match the pars, pull
`whiteLevel` down to **0.35–0.45**. Shipped defaults are 0.60–0.70.
`whiteKick` is the one term allowed to stack on top — it is the blinder bite
and it is supposed to slam.

### 1.3 Model independence (why these run on titanic)

The family uses **no `sectionId` and no `FIX_*` branching**. That is deliberate:
on the **titanic model every pixel has `sId = 0`**, so the `sectionId == 2`
vintage-blinder idiom used by `00_golden_hour_wash` and friends is **dead on the
real rig** and only fires on test_bench. Instead, amber (`a`) is emitted
unconditionally and `sacn_mapper` drops it on fixtures whose channel map has no
`a`. Same for `u`. Result: one code path, correct on `test_bench`, `titanic`,
`studiodj`, `summer_camp_*` and the raw-LED-only `led202`.

> **Follow-up worth filing:** `sId = 0` everywhere on titanic means every
> existing `sectionId`-branching pattern silently loses its per-section
> behaviour on the show rig. Not in this wave's zone, but it is a real gap.

---

## 2. UV inventory — the finding

**Question asked:** which fixtures actually have UV emitters, and can patterns
drive them?

**Answer: there is no true UV (blacklight) emitter anywhere in the inventory.
The `u` lane is a violet/purple emitter, present on two fixture types only.**

| Fixture type | Channel map | `u` lane | What the manufacturer calls it | Count (test_bench / titanic) |
|---|---|---|---|---|
| `UkingPar` | `rgbwau` | **yes** | DMX ch 7 = **"Purple"** — `simulation/dmx/fixtures/uking_rgbwau_par_light/channels_10.yaml` | 4 / 41 |
| `ShehdsBar` | `rgbwau` | **yes** | 6th sub-channel per pixel; `pixel_order: [Red, Green, Blue, White, Amber, Violet]` — `shehds_18_18w_led_bar/channels_119.yaml` | 36 / 450 |
| `VintageLed` | `rgbw` | no | RGBW only, no amber, no violet | 12 / 96 |
| `TeSignV3A40` / `TeSignV3B34` | `rgb` | no | pure RGB pixel fixture (`te_sign_v3/model_a_120.yaml`) | 74 / 74 |
| raw LED strands | `rgbw` (test_bench) / none (titanic) | no | Ango-4 pixel controller | 80 / 320 |

**UV-capable share of the show rig (titanic): 491 of 981 pixels (50 %).**

**Is it drivable from a pattern? YES — no engine change needed.** The path is
already complete end to end:
`rgbwau(r,g,b,w,a,u)` → `renderAll6ch` lane 5 → `engine.js:815 px.u` →
`sacn_mapper` `if (ch.u !== undefined && entry.u !== undefined) buf[addr + ch.u − 1] = u·255`.
A fixture without a `u` in its channel map simply never receives the write —
which is the correct behaviour, not a fallback.

**So the spike is a GO, with one honest caveat the operator must see in
person:** because only pars and bars have the emitter, a genuinely UV-only look
lights **half the rig and leaves the sign, the vintage heads and the strands
completely dark**. `65_uv_only` ships exactly that way (`rgbViolet = 0`) so the
first look is the truthful one; raising `rgbViolet` fills a deep-violet RGB
approximation on the fixtures that have no violet emitter.

**Measured, both models, at shipped defaults** (raw 6-channel probe, 120 frames):

```
UkingPar   [rgbwau]  R 0  G 0  B 0  W 0  A 0   U mean 127.2  peak 211
ShehdsBar  [rgbwau]  R 0  G 0  B 0  W 0  A 0   U mean  81.0  peak 209
VintageLed [rgbw]    R 0  G 0  B 0  W 0  A 0   U mean  71.6  peak 190   <- lane written, channel absent, mapper drops it
TeSignV3A  [rgb]     R 0  G 0  B 0  W 0  A 0   U mean 133.6  peak 209   <- same
```

(The VM writes lane 5 for every pixel; only the two RGBWAU types have a DMX
channel to receive it.)

**Spike outcome: built, verified, and quarantined.** `65_uv_only` is in
`uv_test` and nothing else. A test enumerates every playlist YAML in both
scenes and fails if the pattern appears anywhere else. Operator decides go/no-go
after seeing it on the fixtures.

---

## 3. Playlists — rosters (ALL DRAFT)

Written to **both** scenes, byte-identical, in `20260725_12`'s exact format
(`schemaVersion: 1`, `e_<playlist>_<i>_<pattern>` ids, `defaults` /
`modulations` / `midiMappings` / `label` / `notes` on every entry):
`simulation/scenes/{test_bench,titanic}/playlists/`.

### 3.1 The once-only rule — confirmed scope

_12's generator enforced "all 57 top-level patterns placed **exactly once**"
**across the `ambient` / `party_high` / `party_low` trio only**. That invariant
lived in _12's one-shot script; **no test in the suite encodes it**, and the
themed lists are additive. Confirmed: **a pattern may appear in several themed
playlists**, and several do (`52_silk_ribbons` in tutu + first_class;
`63_white_chase` in white_only + white_wednesday + iceberg + burn_night;
`09_cyclone` in tutu + burn_night). Duplicates **within one** playlist are a
hard error in the generator and in the test.

**The trio was NOT touched.** The six new patterns are deliberately outside it —
white is a specialty program and UV is an unapproved spike. If R2 wants
`60`/`61` in `ambient`, that is a one-line addition, but it will break the trio's
once-only property unless _12's generator is re-run.

### 3.2 Specialty

| Playlist | N | Members |
|---|---|---|
| **`white_only`** | 5 | `60_white_wash`, `61_white_breathe`, `62_white_shimmer`, `63_white_chase`, `64_temple_warm_white` |
| **`uv_test`** | 1 | `65_uv_only` — **EXPERIMENTAL, in no program** |

### 3.3 Themed (DRAFT — Sina re-curates)

| Playlist | N | Members |
|---|---|---|
| **`tutu_tuesday`** (pink/magenta) | 12 | `09_cyclone`, `15_silk_prism_ribbons`, `17_rolling_color_dunes`, `23_prismatic_strange_attractors`, `24_chromatic_murmuration`, `26_dom_dancers_chevron`, `34_moire_interference`, `38_prism_helix`, `42_phyllotaxis_spiral`, `51_confetti_cyclone`, `52_silk_ribbons`, `57_ink_diffuse` |
| **`white_wednesday`** (full brightness) | 5 | the `white_only` five, **with real full-brightness defaults** (§5.1) |
| **`iceberg_ahead`** (icy cyan/blue/white, slow) | 11 | `02_phase_cathedral`, `08_ocean_liner`, `14_lunar_current`, `16_ghost_tide_uv`, `18_deep_space_lattice`, `32_caustic_shimmer`, `39_tide_riser`, `47_quasicrystal_dunes`, `58_lighthouse_solo`, `62_white_shimmer`, `63_white_chase` |
| **`first_class_1912`** (warm gold, candlelight, elegant slow) | 10 | `00_golden_hour_wash`, `07_shimmer`, `12_breathing`, `13_sparkle`, `19_swaying_lattice_ballet`, `20_parametric_sway_field`, `26_dom_dancers_chevron`, `43_golden_hour_pulse`, `52_silk_ribbons`, `64_temple_warm_white` |
| **`deep_sea`** (deep blue/green, bioluminescent) | 12 | `08_ocean_liner`, `11_bioluminescence`, `16_ghost_tide_uv`, `21_pelagic_manta_rays`, `22_abyssal_sway_garden`, `32_caustic_shimmer`, `39_tide_riser`, `41_reaction_diffusion`, `44_biolume_swell`, `45_manta_drift`, `46_abyssal_fronds`, `57_ink_diffuse` |
| **`burn_night`** (fire, ember/orange/red, high energy) | 15 | `01_cylon_sweep`, `03_dual_axis_crush`, `04_beat_folded_helix`, `09_cyclone`, `25_heartbeat`, `28_spectrum_bloom`, `29_kick_shockwave`, `30_bass_comet`, `31_strobe_lattice`, `36_orbital_pulse`, `48_heartbeat_drive`, `49_cylon_crush`, `51_confetti_cyclone`, `54_murmuration_storm`, `63_white_chase` |
| **`temple_white`** (dim warm white, slow) | 3 | `64_temple_warm_white`, `61_white_breathe`, `60_white_wash` — **with real dim/warm/slow defaults** (§5.1) |

Generator (scratch, `~/tmp/gen_specialty_playlists.mjs`) fails loudly on a
missing pattern file, a pattern absent from `manifest.json`, an invalid
playlist name, or an intra-playlist duplicate.

---

## 4. The harness bug this wave caught

`tools/pattern_audio_harness.mjs` — the offline gate every pattern is validated
against — was passing only **four** meta lanes to the VM
(`controllerId / sectionId / fixtureId / viewMask`) and performing **no `FIX_*`
constant injection**. The live engine packs **seven** lanes (adding
`fixtureTypeId`, `pixelLocalIndex`, `viewMaskHi`) and injects the FIX table in
`wasm_host.compile()`.

Consequence: **any pattern branching on `fixtureType` could not be validated
offline at all.** It did not render differently — it failed to compile:

```
$ node tools/pattern_audio_harness.mjs --pattern patterns/27_swipe.js ...
COMPILE_FAIL: Line 177: Undefined var FIX_PAR
```

`27_swipe` is a shipped show pattern. Anyone iterating it on the harness would
have concluded the pattern was broken. Fixed at
`tools/pattern_audio_harness.mjs:118-141`: the meta map now mirrors
`lib/model_loader.js` exactly (using the same canonical
`fixtureTypeId()` registry), and the source goes through
`injectFixtureConstants(src, buildFixtureTypeIds(px))` before compile, with a
loud `COMPILE_FAIL` on an unknown / not-present-on-this-model `FIX_*`.
`MASK_*` injection is deliberately **not** mirrored — a `MASK_*` pattern still
fails loudly rather than silently resolving to something different from the rig.

`27_swipe` now returns `COMPILE_OK` and renders (`LIT_BY_SECTION pars=2 bars=18`).

---

## 5. Theme defaults — what can and cannot be set where

### 5.1 What playlist `defaults` CAN set: local sliders

`PlaylistManager.applyEntryDefaults` maps `defaults` keys to pattern export
names and writes them into the channel — but it **skips any CPC-shared export**
(`playlist_manager.js:429`). Local `slider*` params are fair game.

Shipped with real defaults (these patterns were authored **and measured** in
this wave, and the operator's intent for them is explicit):

| Playlist | Pattern | Defaults |
|---|---|---|
| `white_wednesday` | all five | `sliderLevel: 1.0`, `sliderWhiteLevel: 0.55` (so the sign keeps up), low `sliderWarmth`; `64` also `sliderCeiling: 1.0` |
| `temple_white` | `64` | `sliderLocalSpeed 0.18`, `sliderLevel 0.50`, `sliderCeiling 0.32`, `sliderWarmth 0.92`, `sliderWhiteLevel 0.70`, `sliderWhiteKick 0.03` |
| `temple_white` | `61` | `sliderLocalSpeed 0.15`, `sliderLevel 0.34`, `sliderDepth 0.30`, `sliderWarmth 0.90`, `sliderWhiteKick 0.02` |
| `temple_white` | `60` | `sliderLocalSpeed 0.14`, `sliderLevel 0.30`, `sliderEvenness 0.70`, `sliderWarmth 0.90`, `sliderWhiteKick 0.0` |

Everything drawn from the existing 57 ships `defaults: {}`, exactly like _12 —
**R2's tuning pass owns those**, and shipping guesses would fight it. What R2
should reach for per theme:

| Theme | Recommended `defaults` on its members |
|---|---|
| `iceberg_ahead` | `sliderLocalSpeed` **0.20–0.30** (slow menace), `sliderLevel` 0.6–0.8, `sliderWhiteLevel` high where present |
| `first_class_1912` | `sliderLocalSpeed` **0.20–0.30**, `sliderWarmth` high, `sliderWhiteKick` **low** (elegant, no blinder) |
| `deep_sea` | `sliderLocalSpeed` **0.25–0.40**, `sliderUvLevel` up on `16`/`44`/`11`, `sliderKick` low |
| `burn_night` | `sliderLocalSpeed` **0.65–0.85**, `sliderKick`/`sliderWhiteKick` **high** (blinder-forward) |
| `tutu_tuesday` | `sliderLocalSpeed` 0.45–0.60 (flowing, not pounding) |

### 5.2 What playlist `defaults` CANNOT set: the theme's COLOUR

**`colorPalette1` / `colorPalette2` are CPC-shared exports**, so
`applyEntryDefaults` skips them by design (`isSharedExport` guard). A
`defaults: { colorPalette1: {h,s,v} }` entry would be **silently ignored**.
Theme colour must therefore come from the **look's `palette:`** in
`simulation/scenes/*/timeline/playa_default.yaml`, the same mechanism _12 used
for its three looks (`deep_sea` / `bass_drop` / `ultraviolet`).

Recommended palette per theme, from the house list in `config.yaml`
(`colorPalettes:`), hues as `c1 → c2`:

| Theme | Palette | Hues | Fit |
|---|---|---|---|
| `tutu_tuesday` | `lavender_dream` | 0.75 → 0.95 | violet → pink-magenta. Closest existing. **A dedicated `tutu_pink` (`c1: 0.88, c2: 0.96`) would nail it** |
| `white_wednesday` | *(any — irrelevant)* | — | the white family ignores cp1/cp2 entirely |
| `iceberg_ahead` | `electric_ice` | 0.50 → 0.76 | cyan → blue-violet. Exact fit |
| `first_class_1912` | `phoenix` | 0.00 → 0.13 | red → amber-gold. Usable but **redder than candlelight**; a `candlelight` (`c1: 0.08, c2: 0.12`) would be better |
| `deep_sea` | `deep_sea` | 0.62 → 0.48 | blue → cyan-green. Exact fit |
| `burn_night` | `phoenix` | 0.00 → 0.13 | ember red → gold. Exact fit |
| `temple_white` | *(any — irrelevant)* | — | white family ignores cp1/cp2 |

Two palettes are worth adding to `config.yaml → colorPalettes:` (**not done —
that list is operator-owned house config**):

```yaml
  - id: tutu_pink
    name: Tutu Pink
    c1: 0.88
    c2: 0.96
  - id: candlelight
    name: Candlelight
    c1: 0.08
    c2: 0.12
```

**Wiring the themes into looks is R3's job** and is not done here — these
playlists exist so R3 has real content to point looks at.

---

## 6. Test + deploy evidence

### Engine suite

```
ℹ tests 2202   ℹ pass 2195   ℹ fail 7   ℹ skipped 0
```

_12 baseline was `2155 / 2148 / 7`. This wave adds **47 tests, all passing**
(2155 + 47 = 2202, 2148 + 47 = 2195). **The same 7 known environmental
failures**, none in touched code, not chased:
5 × `tests/audio/audio_capture.test.js` (no mic pinned on this box),
`osc_listener` EADDRINUSE→EACCES (Windows),
`effects_v2_mode_page_layout` Node worker deserialize flake.

### New test file — `tests/patterns/specialty_white_uv.test.js` (47 tests)

Runs on **both** show models, via `WasmHost` with real coords, real 7-lane meta
and real `FIX_*` injection:

- **Registration** — every new pattern has a file and a `manifest.json` entry.
- **Untintable** — no `colorPalette1/2` export, no `cp1/cp2` var, on all six.
- **MFT order** — `sliderLocalSpeed` first, `sliderDirection` second, ≤ 12 locals.
- **Explicit 6-channel** — calls `rgbwau()`, never bare `rgb()`/`hsv()`.
- **Neutral white** (per pattern × model) — `R ≥ G ≥ B` on every pixel of every
  frame; RGB spread ≤ 0.70 (the warmth knob's own extreme); **blue never
  collapses below 0.25 × red** (the line between a warm *white* and an *amber*);
  the W lane is driven (peak > 0); the violet lane is **exactly 0**.
- **Silence-safe** — no all-black frame, no non-finite output.
- **UV isolation** — at defaults `65_uv_only` writes R=G=B=W=A **= 0** on every
  pixel of every frame on both models, with U peaking ≥ 128; with
  `sliderRgbViolet = 1` the RGB fill appears and is blue-dominant with **green
  still exactly 0**.
- **Playlists** — all 9 exist in both scenes, byte-identical across scenes,
  every entry references a manifest pattern, no intra-list duplicates, correct
  `defaults`/`modulations`/`midiMappings` shape; `white_only` holds exactly the
  five; `uv_test` holds exactly the one; **the UV spike appears in no other
  playlist in either scene**.

### Offline harness (the four production bars)

`tools/pattern_audio_harness.mjs`, `--synth full_track`, 400 frames,
`micLow→sliderLevel 0.30..1.00`, `micKick→sliderKick pow2`:

| Pattern | PRIMARY corr | peakMaxChan | silence |
|---|---|---|---|
| `60_white_wash` | **0.58** REACTIVE | 255 | ANIMATING |
| `61_white_breathe` | **0.57** REACTIVE | 255 | ANIMATING |
| `62_white_shimmer` | **0.53** REACTIVE | 255 | ANIMATING |
| `63_white_chase` | **0.45** REACTIVE | 255 | ANIMATING |
| `64_temple_warm_white` | **0.69** REACTIVE | 193 (by design — see below) | ANIMATING (over 30 s) |
| `65_uv_only` | 0.30 | 128 (folded) | ANIMATING |

Library baselines on the same run for calibration: `01_cylon_sweep` 0.45,
`12_breathing` 0.37, `13_sparkle` 0.68. The new family sits at or above the
existing corpus.

**Two bars deliberately not met, and why:**
- **`hueSpread ≥ 0.10`** — reads ~0.00–0.05 across the family. It measures
  two-colour spread; a white pattern is hue-free by definition. Documented in
  every header.
- **`peakMaxChan ≥ 200`** — `64_temple_warm_white` peaks at 193 at its shipped
  defaults because `ceiling = 0.45` exists precisely to keep it dim. It clears
  the bar at `ceiling = 1.0` (which is what `white_wednesday` sets).
  `65_uv_only` reads 128 only because the harness *folds* U into RGB at
  `0.1·R + 0.5·B`; the **raw U lane peaks at 209–211** (§2).

Three tuning findings worth recording, each measured not guessed:
- `60`: stacking full RGB **and** full W saturated the rig and dropped PRIMARY
  corr to 0.39. The crossfade (§1.2) took it to 0.58.
- `63`: with a 0.035 floor the sweep's own swing swamped the audio term
  (corr 0.27). A **uniform, level-coupled base** of 0.17 — the
  `00_golden_hour_wash` trick — took it to 0.45.
- `61`: at `depth 0.60` the breath envelope competed with `level` (corr 0.21).
  `depth 0.42` + a wider `levGain` took it to 0.57.

### Raw 6-channel verification (`~/tmp/white_probe.mjs`)

The harness folds W/A/U into RGB for the clip, which hides exactly what this
family is about. A raw probe renders on the real models and reports per-fixture
channel means/peaks + RGB spread. `60_white_wash` on titanic, 80 frames:

```
UkingPar   [rgbwau]  mean R 49.5 G 47.5 B 44.9  W 92.6  A 11.4  U 0.0   maxRGBspread 8
ShehdsBar  [rgbwau]  mean R 45.7 G 43.9 B 41.5  W 85.6  A 10.5  U 0.0   maxRGBspread 8
VintageLed [rgbw]    mean R 52.0 G 50.0 B 47.3  W 97.5  A 12.0  U 0.0   maxRGBspread 8
TeSignV3A  [rgb]     mean R 37.6 G 36.1 B 34.2  W 70.6  A  8.6  U 0.0   maxRGBspread 4
```

Neutral RGB, W driven hard, violet at zero, on every fixture family.

### Engine load check (no residue)

All six dry-run clean in the real engine:
`node engine.js --pattern <name> --model test_bench --dry-run` →
`✅ Pattern compiled via MarsinCompiler (bytecode)`, exit 0, ×6.

`marsin_engine/states/` **md5-identical** before and after (a) the full suite
and (b) all six engine dry-runs — verified by `diff` of a 38-file md5 manifest.
The 7 modified + 4 untracked state files in `git status` are **pre-existing**
from earlier waves on this branch, unchanged by this one.

### Gallery (operator review)

All six published to the offline pattern gallery as 10-second real-time clips
(`tools/gallery/widgets/`, gitignored):

```bash
cd marsin_engine && node tools/gallery/gallery_launcher.mjs   # :6965, prints the Tailscale URL
# → /w/60_white_wash /w/61_white_breathe /w/62_white_shimmer
#   /w/63_white_chase /w/64_temple_warm_white /w/65_uv_only
```

### Deploy

```
DEPLOY OK: titanic-ext is running test_bench from e805ef01.
```

Live verification on the show machine after deploy:

```
GET http://10.x.x.151:6968/patterns
  → 60_white_wash, 61_white_breathe, 62_white_shimmer,
    63_white_chase, 64_temple_warm_white, 65_uv_only

GET http://10.x.x.151:6968/playlists
  → [ambient, burn_night, deep_sea, default, first_class_1912, iceberg_ahead,
     party_high, party_low, slow, temple_white, tutu_tuesday, uv_test,
     white_only, white_wednesday]

GET http://10.x.x.151:6968/playlists/white_only  → 5 entries, loads clean
```

---

## 7. What the operator has to decide

1. **UV go/no-go** (`bm26_show_readiness.md` §Open 10). Load `uv_test` on the
   real pars and bars. Know before you look: **it is violet, not blacklight**,
   and **half the rig (sign, vintage heads, strands) will be dark**. If you want
   the whole rig involved, raise `sliderRgbViolet`.
2. **Themed playlist membership** (§Open 9) — every roster here is DRAFT.
3. **The two palettes** in §5.2 (`tutu_pink`, `candlelight`) — add to
   `config.yaml` or accept the existing near-fits.
4. **Should `60`/`61` also join `ambient`?** They are strong ambient patterns.
   Doing so breaks the trio's once-only property; your call.
5. **`whiteLevel` vs the TE sign** (§1.2) — decide whether white looks should
   favour the dedicated white emitter (brighter pars) or sign parity.

## 8. Follow-ups (not built)

1. **`sectionId` is 0 for every pixel on titanic** — every `sectionId`-branching
   pattern in the corpus loses its per-section behaviour on the show rig. The
   fix is a model re-export that assigns section ids, or a sweep converting
   those patterns to `fixtureType == FIX_*`. Real, and not small.
2. **Wire the themes into show-plan looks** (R3) with the §5.2 palettes.
3. **`MASK_*` injection in the harness** — still unsupported (fails loudly).
   Worth adding alongside the `FIX_*` fix for symmetry with `wasm_host.compile`.
4. **A `whiteMode` per-fixture compensation** so a white pattern can hold equal
   apparent output across W-capable and RGB-only fixtures without the operator
   hand-tuning `whiteLevel` per look.

## 9. Files

- `marsin_engine/patterns/{60_white_wash,61_white_breathe,62_white_shimmer,63_white_chase,64_temple_warm_white,65_uv_only}.js` — new
- `marsin_engine/patterns/manifest.json` — 6 entries added
- `marsin_engine/tools/pattern_audio_harness.mjs` — `fixtureTypeId` meta lanes + `FIX_*` injection (§4)
- `marsin_engine/tests/patterns/specialty_white_uv.test.js` — new, 47 tests
- `simulation/scenes/{test_bench,titanic}/playlists/{white_only,uv_test,tutu_tuesday,white_wednesday,iceberg_ahead,first_class_1912,deep_sea,burn_night,temple_white}.yaml` — new, 18 files
- `~/tmp/gen_specialty_playlists.mjs`, `~/tmp/white_probe.mjs` — scratch tooling (not in the source tree)
