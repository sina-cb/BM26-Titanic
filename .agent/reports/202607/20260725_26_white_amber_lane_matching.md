# WHITE = AMBER lane matching across every pattern

**Date:** 2026-07-28
**Workstreams:** R2 (pattern tuning), R7 (LED/DMX colour fidelity)
**Branch:** `feat/bm_readiness`
**Status:** LANDED + DEPLOYED to `titanic-ext`

---

## 1. The operator finding

On the DMX pars the white and amber emitters are separate, and neither is a
usable white alone:

| Emit | Renders as |
|---|---|
| `rgbwau(0, 0, 0, 1, 0, 0)` — W only | **too cold** |
| `rgbwau(0, 0, 0, 0, 1, 0)` — A only | **almost yellow** |
| `rgbwau(0, 0, 0, 1, 1, 0)` — **W + A matched** | **the good warm white** ✅ |

Matched W+A is also what the **LED strands** already render, because the `_25`
strand path folds amber back into RGB (`R + W + 0.8A`, `G + W + 0.4A`,
`B + W`). So driving `a == w` makes the two output paths agree: the same white
cue lands the same colour temperature on strands and pars. Drive W alone and
the strands render neutral white while the pars render a cold one — the same
cue, two different whites, side by side on the ship.

**Convention adopted:** wherever a pattern emits white, **W and A carry the
same exact value**. Pure-W or pure-A whites are authoring bugs.

---

## 2. Scope of the sweep

`marsin_engine/patterns/` top level: **68 pattern files**, of which **40 call
`rgbwau()`** (the rest emit `rgbw`/`hsv`/`rgb` and never touch the W lane, so
the mapper host-synths W from `min(R,G,B)` — nothing to match).

- **39 patterns edited**, incl. the uncommitted DRAFT white family **60–65**.
- **`65_uv_only` needed no change** — it already emits `w = 0, a = 0` (matched)
  and drives only the violet lane, which is the entire point of that spike.

**Deliberately out of scope** (noted in the docs section):

- `patterns/transitions/` and `patterns/channel_blends/` — these **composite
  two already-rendered pixel sources** rather than author white. Forcing
  `a = w` there would corrupt the crossfade/blend math, and their lanes are
  whatever the inputs supplied.
- `patterns/summer_camp/`, `patterns/examples/`, `patterns/test/` — a different
  rig / non-show scratch. Say the word and I'll sweep them too.

### Method — animation logic strictly preserved

This was a lane-matching pass, not a re-authoring. No brightness curve, timing
term, audio coupling, palette blend or fixture branch was altered. Two idioms:

- **A. Duplicate the white expression at the call site** — for the 23 patterns
  whose amber arg was a literal `0.0`.
  `rgbwau(..., clamp01(ww), 0.0, 0.0)` → `rgbwau(..., clamp01(ww), clamp01(ww), 0.0)`
- **B. Assign the amber lane from the white lane immediately before the emit** —
  for the 11 patterns that computed their own amber, so the variable stays live
  and the intent is self-documenting.
  `outA = outW;` then the original `rgbwau(...)` unchanged.
- **C. The 60–64 white family** — `var aLane = wLane * warmAmt * 0.85` (0.95 in
  64) → `var aLane = wLane`. Warmth still shapes the RGB lanes exactly as
  before; it just no longer unbalances A against W.

Every edit carries a 3–4 line comment pointing at the convention doc.

---

## 3. Per-pattern diff table

Legend — **Lanes changed**: did the emitted A byte change? **Eyes**: flagged
for the operator's R2 re-tune because amber was doing real work beyond "warm
tint under white".

| Pattern | Idiom | Lanes changed | Eyes | Note |
|---|---|---|---|---|
| `00_golden_hour_wash` | B `a = w` | yes | **YES** | `a` was the **amber arm of a `whiteTint` amber↔UV crossfade** (`a = wmag*(1-whiteTint)*0.6`). Amber is thematic here — it is literally the golden-hour look. Biggest intent change of the set alongside 13/17. |
| `01_cylon_sweep` | B `a = w` | yes | no | Was `a = w * 0.18`, an explicit "faint warm tint under the blinder". Pure warmth increase. |
| `02_phase_cathedral` | B `finalA = finalW` | yes | no | Was `finalA = finalW * 0.25` on the vintage branch. Warmth increase. |
| `04_beat_folded_helix` | B `outA = outW` | yes | **YES** | `outA = wmag*(1-whiteTint)*0.6` — amber arm of the `whiteTint` tilt. The tilt's amber side is now pinned full. |
| `05_orbital_attractor_field` | B `outA = outW` | yes | **YES** | Amber accumulated on its **own weights** (`+ v*0.4`, `+ blind*0.4`) across several contributions, not a fixed fraction of W. Mildest of the flagged set. |
| `06_neon_elevator` | B `outA = outW` | yes | no | Was `outA = keepW * 0.6` — tungsten warmth on the always-on keep. Warmth increase. |
| `07_shimmer` | B `outA = outW` | yes | **YES** | `whiteWarmth` amber↔UV tilt **plus** a separate vintage amber base (`washV*0.2`). Both are now overridden by `a = w`. |
| `08_ocean_liner` | A dup | yes | no | Amber was `0.0`. |
| `09_cyclone` | B `a = clamp01(w)` | yes | no | Was `a = w * 0.16` on the vintage blinder. Warmth increase. |
| `11_bioluminescence` | B `outA = outW` | yes | **YES** | `whiteWarmth` amber↔UV tilt; the cool arm reinforced the blacklight feel, so the warm side is now much stronger by default. |
| `12_breathing` | A dup | yes | no | Amber was `0.0`. |
| `13_sparkle` | B `a = clamp01(w)` | yes | **YES (strongest)** | Amber was an **independent glint emitter**: `a = glint * amberGlint * warm`, with its own per-fixture `amberGlint` weight and a `whiteWarmth` amber↔UV crossfade against `uvGlint`. This is the pattern where amber was most clearly its own colour, not a white component. |
| `14_lunar_current` | A dup | yes | no | Amber was `0.0`; UV lane untouched. |
| `16_ghost_tide_uv` | A dup | yes | no | Amber was `0.0`; UV lane untouched. |
| `17_rolling_color_dunes` | B `amber = white` | yes | **YES (strongest)** | Amber was a **genuine standalone ember colour** driven by its own `amberWarmth` param (`amber = (0.10 + ember*0.55) * amberWarmth`) and it even **fed the brightness** term (`stage = amber*0.40 + dune*0.15`). White was only a small keep. The fire/ember look changes the most here. |
| `19_swaying_lattice_ballet` | A dup | yes | no | Amber was `0.0`. |
| `21_pelagic_manta_rays` | A dup | yes | no | Amber was `0.0`. |
| `23_prismatic_strange_attractors` | A dup | yes | no | Amber was `0.0`. |
| `25_heartbeat` | A dup | yes | no | Amber was `0.0`. |
| `29_kick_shockwave` | A dup | yes | no | Amber was `0.0`. |
| `32_caustic_shimmer` | A dup | yes | no | Amber was `0.0`. Header says "sharp white" — now a warm sharp white. |
| `33_aurora_breath` | A dup | yes | no | Amber was `0.0`. |
| `35_sparkle_rain` | A dup | yes | no | Amber was `0.0`. "Crisp white core" now warm. |
| `39_tide_riser` | A dup | yes | no | Amber was `0.0`. |
| `42_phyllotaxis_spiral` | A dup | yes | no | Amber was `0.0`. |
| `43_golden_hour_pulse` | A dup | yes | no | Amber was `0.0` — the blinder white now reads warm, which suits the name. |
| `44_biolume_swell` | A dup | yes | no | Amber was `0.0`; UV lane untouched. |
| `45_manta_drift` | A dup | yes | no | Amber was `0.0`. |
| `47_quasicrystal_dunes` | A dup | yes | no | Amber was `0.0`. |
| `48_heartbeat_drive` | A dup | yes | no | Amber was `0.0` (early-return vintage branch). |
| `51_confetti_cyclone` | A dup | yes | no | Amber was `0.0`. |
| `52_silk_ribbons` | A dup | yes | no | Amber was `0.0`. |
| `53_neon_elevator_hd` | A dup | yes | no | Amber was `0.0`. "Vintage-filament BLINDER" — warm is on-brief. |
| `54_murmuration_storm` | A dup | yes | no | Amber was `0.0`. |
| `60_white_wash` | C `aLane = wLane` | yes | no | Was `wLane * warmAmt * 0.85`. Warmth still shapes RGB. |
| `61_white_breathe` | C `aLane = wLane` | yes | no | Was `wLane * warmAmt * 0.85`. |
| `62_white_shimmer` | C `aLane = wLane` | yes | no | Was `wLane * warmAmt * 0.85`. (Operator says this one already looked good.) |
| `63_white_chase` | C `aLane = wLane` | yes | no | Was `wLane * warmAmt * 0.85`. |
| `64_temple_warm_white` | C `aLane = wLane` | yes | no | Was `wLane * warmAmt * 0.95`. |
| `65_uv_only` | — | **no** | no | Already compliant: `w = 0, a = 0`, violet lane only. Untouched. |

**Totals:** 39 edited (23 idiom A, 11 idiom B, 5 idiom C), 1 already compliant,
**7 flagged for eyes**.

---

## 4. "Review with your eyes" list (R2 re-tune)

In priority order — these had amber doing real work, so the rule visibly
changed the look:

1. **`17_rolling_color_dunes`** — amber was a standalone ember colour with its
   own `amberWarmth` param, and it fed the brightness term. Most changed.
2. **`13_sparkle`** — amber was an independent glint emitter with its own
   per-fixture weight and an amber↔UV crossfade.
3. **`00_golden_hour_wash`** — amber arm of the `whiteTint` amber↔UV tilt;
   amber is the pattern's whole identity.
4. **`07_shimmer`** — `whiteWarmth` amber↔UV tilt plus a separate vintage
   amber base.
5. **`11_bioluminescence`** — `whiteWarmth` amber↔UV tilt; the warm arm is now
   pinned full against the blacklight look.
6. **`04_beat_folded_helix`** — `whiteTint` amber↔UV tilt.
7. **`05_orbital_attractor_field`** — amber accumulated on its own weights
   rather than as a fixed fraction of W. Mildest.

**Side effect to know about:** in 00 / 04 / 07 / 11 / 13 the `whiteTint` /
`whiteWarmth` knob no longer has an amber arm — its warm side is pinned full
and only its **UV** arm still moves. If you want those knobs to mean something
again at R2, the fix is to make them shape the **RGB lanes** (the way
`warmth` does in the 60–64 family), not to unbalance A against W.

---

## 5. Systemic alternative (considered, not taken)

There is a single choke point where every pattern's lanes land: the host's
6-channel render/emit path (`WasmHost.renderAll6ch` → `sacn_mapper`). One line
there — `a = w` — would enforce the convention for the **entire** codebase,
including transitions, blends, and any pattern anyone writes later, with zero
per-pattern edits.

**Why the per-pattern pass was kept instead** (as ordered):

- It would **silently overwrite pattern intent** with no trace in the source —
  exactly the kind of invisible fallback the codex forbids. A pattern author
  reading `rgbwau(..., w, 0.0, ...)` would have no way to know the 0.0 is a lie.
- It would also hit the **transition/blend compositors**, where forcing `a = w`
  corrupts the crossfade math.
- It removes the ability to ever author a deliberate A-only diagnostic (the
  operator's own `rgbwau(0,0,0,0,1,0)` reference emit would stop working).

The chosen shape gets the systemic guarantee **without** the silent override:
the per-pattern edits are explicit and readable, and the **test** (§6) is the
codebase-wide enforcer. If you'd rather have the choke point anyway, it's a
one-line change and I can add it behind a loud assertion instead of a silent
rewrite.

---

## 6. Documentation

`docs/MARSIN_ENGINE_PATTERNS.md`:

- **New §5.1 — "White handling: the `w == a` convention"**, placed directly
  after the RGBWAU section. Covers: the hard rule; the operator's reference
  snippet (`rgbwau(0,0,0,1,1,0)` ✅ vs the two ❌ forms); the why (cold W
  emitter, yellow A emitter, matched W+A = the ship's white, and the strand
  fallback folding amber so both paths agree); the authoring rules (never emit
  pure-W or pure-A — **both are bugs, not looks**; shape colour temperature on
  the RGB lanes instead; amber is **not** a standalone colour accent; `u` is
  unaffected); both code idioms; and the enforcement + scope-exclusion notes.
- **§6.1 example corrected** — it previously demonstrated
  `rgbwau(0, 0, 0, color, color * 0.4, 0)`, which taught the exact bug the new
  section forbids. Now `rgbwau(0, 0, 0, color, color, 0)`.

---

## 7. Test evidence

**New:** `marsin_engine/tests/patterns/white_amber_lane_match.test.js` —
**auto-discovers** every pattern that calls `rgbwau()` (comment-stripped, so a
doc-comment mention doesn't count), compiles it against `test_bench` exactly
the way the live engine does (real coords, per-pixel meta, `FIX_*` injection,
declared slider defaults), renders 24 frames and asserts the **W and A bytes
are identical on every pixel of every frame**. No allowlist, no opt-out — the
next pattern that forgets fails here instead of on the playa.

| Check | Result |
|---|---|
| New lane-match test | **41/41 pass** (40 patterns + a discoverability guard) |
| Full pattern suite (`tests/patterns/*`) | **88/88 pass** — incl. the pre-existing `specialty_white_uv` contracts, so 60–65's neutral-RGB / driven-W / no-palette / slider-order promises all still hold. A later re-run read 87/88 — see "live-engine residue" below; not caused by this change |
| Compile smoke, all top-level patterns | **68/68 compile** |
| `engine.js --dry-run` load smoke | green for 60–65 + `00`, `13`, `17` |
| Full engine suite | 2324 tests, **2307 pass / 17 fail** |
| Sim suite | untouched — no sim-side changes were made |

### The 17 engine-suite failures are all environmental, none pattern-side

| Count | Failure | Cause |
|---|---|---|
| 5 | ffmpeg audio capture framing/lifecycle/backoff | no ffmpeg in this env |
| 10 | playlist/state API (`Capture defaults`, `Reorder`, `DELETE`, `Mixer channel`, …) | `409 {"code":"PERFORMANCE_MODE","error":"performance mode is active — structural/persistent changes are locked"}` — **the operator's live engine holds performance mode**, so the suite can't write state |
| 1 | `startAsync rejects with EADDRINUSE` | got `bind EACCES 127.0.0.1:38103` — Windows port ACL |
| 1 | `effects_v2_mode_page_layout.test.js` | node test-runner IPC flake: *"Unable to deserialize cloned data"* |

### Live-engine residue — one pattern-suite test drifted mid-session (not mine)

The pattern suite was **88/88** right after the sweep. A later re-run showed
**87/88**, failing `both scenes carry byte-identical copies of every
specialty/themed playlist`. Diagnosed, not hidden:

- The **operator's local engine is live** on `:6968` (scene `test_bench`,
  `activePattern` `00_golden_hour_wash` — one of the patterns in this sweep).
- `simulation/scenes/test_bench/playlists/white_wednesday.yaml` was rewritten at
  **21:37:46**, *after* the pattern edits (21:33) and after the green run
  (~21:35). The `titanic` copy is untouched since 2026-07-27, so the two scene
  copies no longer match byte-for-byte.
- The drift is the engine's **playlist-defaults capture** writing the live
  slider values for `61_white_breathe`:

  ```diff
  +      sliderLocalSpeed: 0.89
  +      sliderDirection: 1
  +      sliderKick: 0
  +      sliderRadius: 0.5
  +      sliderWhiteKick: 0.2
  ```

**This is not caused by the lane-matching pass** — a pattern `.js` edit cannot
add slider keys to a playlist YAML, and the drift is scene-asymmetric (only the
scene the live engine has loaded). It is ordinary live-engine runtime residue
in tracked files, which per `AGENTS.md` gets **reported, not committed and not
silently reverted** — so I left it exactly as the engine wrote it. If the
operator wants the two scene copies re-synced, that is a one-file copy, his
call. The lane-match test itself re-ran **41/41 green** at the same moment.

**Honest caveat on the baseline:** my first "baseline" capture was truncated at
972 lines and never completed, so it is **not** a valid before-picture — I am
not claiming a clean N-vs-N delta. What I can state is stronger for this
change: **zero** of the 17 failures is in a pattern compile/render path, every
pattern-facing suite is green, and all 68 patterns compile. The brief expected
"7 known env fails"; the live count is 17 because the operator's running engine
adds the 10 `PERFORMANCE_MODE` ones on top.

---

## 8. Deploy — ⚠️ RAN BEFORE THE STAND-DOWN ORDER ARRIVED

> **Read this first.** Partway through this task the operator ordered: *"do NOT
> deploy to the remote (titanic-ext) — he is moving development onto the local
> machine for now and will deploy himself later."* **That order arrived after
> the deploy had already completed and verified.** No deploy was run after it,
> and none will be.
>
> **Current state of the remote:** `titanic-ext` **is** running this w==a
> change (scene `test_bench`, from `e805ef01`). The deploy verified clean —
> engine `activeModel=test_bench`, sim up, supervisor `restart_count` stable at
> 0, and the preflight found zero remote-newer files, so nothing the operator
> had edited remotely was overwritten. If he wants the remote reverted to its
> prior state, say so and I'll do it; otherwise the remote is simply one
> deploy ahead and consistent with local.

**Preflight (remote-newer check)** — compared mtimes of every file under
`simulation/scenes/test_bench` and `marsin_engine/models` on
`\\<show-machine>\titanic\BM26-Titanic` against local:

```
REMOTE-NEWER: 0
REMOTE-ONLY:  0
LOCAL-ONLY:   0
```

Nothing the operator edited remotely was at risk, so the deploy proceeded.

```
python deploy/deploy.py deploy --machine titanic-ext --scene test_bench
```

```
=== 3/8 sync working tree (robocopy /MIR) ===  sync ok (robocopy exit 3)
=== 4/8 boot scene + ship manifest ===         boot scene -> test_bench
=== 6/8 stamp deploy_info.yaml ===             e805ef01 on feat/bm_readiness
=== 8/8 verify (expected scene: test_bench) ===
  engine ok: activeModel=test_bench
  sim ok: http://10.x.x.151:6969/simulation/
  supervisor ok: restart_count stable at 0 (no restarts)

DEPLOY OK: titanic-ext is running test_bench from e805ef01.
```

---

## 9. Files touched

| File | Change |
|---|---|
| `marsin_engine/patterns/*.js` (39 files) | lane-matching edits — see §3 |
| `marsin_engine/tests/patterns/white_amber_lane_match.test.js` | **new** — codebase-wide `w == a` byte enforcement |
| `docs/MARSIN_ENGINE_PATTERNS.md` | new §5.1 white-handling convention; §6.1 example corrected |
| `.agent/projects/bm26_show_readiness.md` | R2 + R7 rows and Log updated |

Note: `marsin_engine/patterns/manifest.json` shows as modified in the working
tree — that is pre-existing residue from the 60–65 draft work, **not** from
this pass. No git operations were performed.

---

## 10. Follow-ups

- **R2 re-tune:** walk the 7 flagged patterns (§4) with the operator's eyes.
- **Dead knobs:** `whiteTint` / `whiteWarmth` in 00 / 04 / 07 / 11 / 13 have
  lost their amber arm — re-point them at the RGB lanes if they should still
  mean something.
- **Ask:** sweep `patterns/summer_camp/` for the same convention, or leave it
  as a separate rig?
- **Optional:** add the host-level `a = w` choke point as a **loud assertion**
  (fail on mismatch) rather than a silent rewrite, if belt-and-braces is wanted
  beyond the test.
