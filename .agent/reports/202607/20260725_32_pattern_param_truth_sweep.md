# 20260725_32 — Pattern parameter truth sweep

**Operator order:** "sweep the parameters and make sure they are doing what they
say they do for all patterns."

Built a **parameter truth harness** (`marsin_engine/tools/param_truth/`) — an
offline behavioural verifier that loads every pattern into the engine's own WASM
VM, sweeps each declared `slider*` control across its range, **measures what
actually changed in the rendered light**, and checks that measurement against
what the control's **name claims**. Then ran the full sweep.

**817 parameters across 125 patterns, in 183 s.** Fully offline — no socket, no
port, safe alongside the operator's live stack.

---

## 1. Headline

| Class | Count | Share |
|---|---:|---:|
| `TRUE` — does what the name says | **548** | 67.1 % |
| `DEAD` — no measurable effect anywhere in range | **170** | 20.8 % |
| `WRONG` — real effect, but not the claimed one | **39** | 4.8 % |
| `UNKNOWN_CLAIM` — name not falsifiable; effect recorded | **35** | 4.3 % |
| `WEAK` — real but sub-visible across the whole range | **25** | 3.1 % |

Patterns: **125 swept**, 1 compile error, 25 carry no sliders.

**The 170 DEAD split three ways, and only one of them is a pattern bug:**

| Cause | Count | Whose problem |
|---|---:|---|
| **Ship-model coverage gap** — control works, but the code path it drives is unreachable on `titanic` | **137** | R8 model mapping — *not* the patterns |
| **Buried by a shipped default** — control is wired, a default at full scale swallows it | **9** | Pattern defaults |
| **Hard dead** — inert on both models, at defaults and mid-range, and not edge-triggered | **25** | Pattern bugs |

So the actionable pattern-side punch-list is **25 hard-dead + 9 defaults-buried +
39 wrong = 73 parameters (8.9 %)**, not 209.

---

## 2. The single biggest finding: 137 dead knobs are a model problem

`05_orbital_attractor_field`, `01_cylon_sweep`, `17_rolling_color_dunes` and
many others drive their white/blinder work behind `sectionId == 2` (the vintage
heads). **Every one of `titanic`'s 981 pixels reports `sectionId 0`**, so those
branches never execute and every control feeding them renders byte-identical.

The same controls measure `TRUE` on `test_bench`, which carries real section
ids (1=Pars, 2=Vintage, 3=Bars). This is the harness's cross-model check doing
its job, and it corroborates report `_33` from the model side: the titanic
export ships all 981 pixels with `patch: null` and zeroed `cId/sId/fId/vMask`.

**Nobody should "fix" these patterns.** They are correct. The ship model has no
section mapping yet. Until R8 lands that mapping, roughly **one in six pattern
parameters is inert on the actual ship** — including most of the audience
blinder work. That is a visibility risk on the mission-critical goal, and it is
a model task, not a curator task.

---

## 3. Harness design

`marsin_engine/tools/param_truth/` — full docs in its `README.md`.

```
pattern_discovery.js   walk patterns/ recursively; ids are extension-free
                       relative paths. NEVER a hardcoded list — patterns are
                       being renamed and reorganised into themed subdirs.
render_context.js      offline model + VM setup, reusing the engine's own
                       loadModelForGauge / buildMaskConstants / inView table /
                       parsePatternDefaults. Three render paths (see below).
metrics.js             frame sequence → fixed feature vector.
claims.js              name → claim family, and every threshold, in one place.
classify.js            measurement + claim → verdict.
sweep.js               orchestration, probes, cross-model reconciliation.
report.js              worst-first markdown.
run_param_truth.mjs    single-process CLI (also the shard worker).
sweep_all.mjs          parallel driver — the one you run.
```

### Method, per pattern

1. Compile it; read its declared controls from the VM.
2. Render a **baseline** twice with every slider at its resolved default; the
   difference is the **measured per-feature noise floor** (renders are
   deterministic today, so it is 0 — but a pattern that ever becomes
   nondeterministic is caught rather than producing phantom verdicts).
3. For each slider, render **5 sweep points** (0, 0.25, 0.5, 0.75, 1.0) with
   that one slider moved and every other held at baseline.
4. Measure; classify against the name's claim.

**Baseline = the live engine's baseline.** Sliders sit at the code default
`parsePatternDefaults()` resolves; one with no literal default is left at the
VM's compiled-in seed — exactly what `api_server.seedSliderCodeDefaults()` does.
Which applied is recorded per slider as `defaultSource`.

**144 frames after 36 warmup** at the show's 40 fps = a 3.6 s measurement window
after 0.9 s of settling, long enough for the slowest breath/tide patterns.

### Three render paths, because patterns are not all the same

- **`render`** — the normal `renderAll6ch` path.
- **`renderBlend`** — transitions and channel blends never run `renderAll`; the
  mixer feeds them two source buffers and a `progress` fader via
  `renderBlend6ch`. Rendering them normally pins `progress` at 0 and reported
  **10 false DEADs** (`sliderFeather` across every wipe). Detected from the
  **source** (`progress` + `fromR…toU` built-ins), never from the path, so a
  folder rename cannot silently break it. Verified exact: 19/19 hits, no false
  positives.
- **`renderPulsed`** — drives one control as a 0↔1 square wave.

### Three probes that stop false accusations

| Probe | Question | Runs on |
|---|---|---|
| **Trigger probe** | Is it edge-triggered rather than level-driven? | DEAD rows |
| **Mid-range probe** | Is it dead only at the pattern's shipped defaults? | DEAD rows |
| **Cross-model** | Is it dead only on this model? | DEAD rows |

The trigger probe exists because `29_kick_shockwave` arms on
`kick >= 0.5 && prevKick < 0.5` — a slider *held* anywhere fires nothing, by
design, because it is meant to be driven by a modulation mapping. Three
controls were rescued this way.

The mid-range probe exists because `12_breathing` ships `level = 1.0`, which
drives its brightness gain to `0.12 + 1² × 2.2 = 2.32` and saturates `bri` for
every pixel. Its `kick` is provably alive at `level 0.5` (byte-sum delta 13 353)
and provably invisible at its own default (delta 0). That is a defaults bug, not
a wiring bug, and needs a different fix. Nine controls landed here.

### Claim families and thresholds

Names are tokenised on camelCase (`sliderWhiteKick` → `white`, `kick`) and the
first matching family wins in priority order — so `whiteKick` is a WHITE claim,
not merely an "amount" claim. **A name with no recognised token is never guessed
at**; it becomes `UNKNOWN_CLAIM` with its measured effect recorded for human
judgement.

| Family | Testable prediction |
|---|---|
| `SPEED` | temporal rate/frequency rises monotonically, ratio ≥ 1.25 |
| `DIRECTION` | ends of the range travel opposite ways — by net drift, or by anticorrelated per-frame velocity |
| `HUE` | circular hue mean or saturation shifts |
| `BRIGHTNESS` / `DARKNESS` | luma (or lit fraction) rises / falls, monotonically |
| `WHITE` / `UV` / `WARMTH` | the named emitter channel moves |
| `SPATIAL` / `TRAIL` / `CONTRAST` | spatial statistics move |
| `MAGNITUDE` / `UNKNOWN_CLAIM` | only "there is an amount of me" — can be DEAD or WEAK, **never WRONG** |

All thresholds live in `claims.js → THRESHOLDS`, are absolute, are never adapted
per pattern, and are echoed into every results file:

```json
{ "dead": 0.005, "weak": 0.020, "claim": 0.020, "emitter": 0.010,
  "speedRatio": 1.25, "levelRatio": 1.25, "relFloor": 0.0005,
  "driftFloor": 0.004, "reversalCorrelation": -0.3,
  "monotonicSlack": 0.05, "noiseMultiple": 3.0 }
```

Two threshold notes worth defending:

- **Level claims pass on ratio as well as absolute swing.** A sparkle pattern's
  white glints can double their output while moving the model-wide mean 0.004 —
  plainly visible on the rig, invisible to an absolute threshold. The ratio path
  is gated by `relFloor` so it cannot fire on two near-zero numbers.
- **Speed is judged on ratio, not absolute change.** Doubling a slow pattern's
  rate is a tiny absolute delta and an obvious visual one.

### Measurement corrections made during the run (each fixed a false verdict)

These were **gaps in what was measured**, not thresholds tuned to make specific
cases pass:

1. **Direction used min/max instead of the range ends.** A sign wobble mid-range
   scored as a reversal. Now the endpoints must differ in sign — plus an
   anticorrelation path, because a ping-pong sweep nets to ~0 drift in *both*
   directions and net travel can never show its reversal.
2. **No edge-sharpness feature.** "Feather" claims edge softness, which no
   spatial-frequency count measures. Added the steepest bin-to-bin step in the
   spatial profile. Turned 10 false DEADs into 9 TRUEs.
3. **Contrast measured absolute spread.** `34_moire_interference` sharpens its
   bands *and* darkens them, so absolute spread stays flat while the picture
   visibly gains contrast. Now judged on `spatialStd / lumaMean`.
4. **Darkness measured only luma.** `44_apex_gyro_vortex` pushes pixels to black
   without dimming the survivors much. Now lit fraction counts too.

---

## 4. Punch-list for the curator

### 4a. HARD DEAD — inert everywhere tested (25)

Dead on `titanic` **and** `test_bench`, at declared defaults **and** mid-range,
and not edge-triggered. These are the real bugs.

**Show patterns (top-level) — 7:**

| Pattern | Param | Family |
|---|---|---|
| `05_orbital_attractor_field` | `sliderFocus` | SPATIAL |
| `11_bioluminescence` | `sliderDetail` | SPATIAL |
| `12_breathing` | `sliderDepth` | MAGNITUDE |
| `13_sparkle` | `sliderAmberGlint` | WHITE |
| `23_prismatic_strange_attractors` | `sliderColorSpread` | HUE |
| `44_biolume_swell` | `sliderBase` | MAGNITUDE |
| `53_neon_elevator_hd` | `sliderKick` | MAGNITUDE |

**`13_sparkle` / `sliderAmberGlint` — root cause confirmed by reading the
source.** The pattern computes `a = glint * amberGlint * warm`, then the
WHITE=AMBER lane-match pass appended `a = clamp01(w)`, which unconditionally
overwrites it. The knob cannot reach the output. This is a **direct consequence
of the `_26` lane-matching wave**, and `13_sparkle` was one of the seven
patterns `_26` itself flagged as "amber doing real work". The same overwrite is
why `sliderWhiteWarmth` reads WRONG in `13_sparkle` and `04_beat_folded_helix` —
warmth's amber half is dead, and only its UV half still moves.

**summer_camp — 17**, and note these were re-swept on their **home** models
(`summer_camp_logsville`, cross-checked against `summer_camp_dome`), which
cleared 9 of the titanic-measured deads as model artefacts. What survives on the
home model:

`112_logsville_giant_call_response/sliderSectionCount`,
`113_tower_column_breath/sliderLocalSpeed` + `sliderVintageGlow`,
`114_tower_ring_chase/sliderLocalSpeed` + `sliderVintageWash` +
`sliderAudioKick`, `46_dome_lockdown/sliderAlarmCadence`,
`47_apex_perimeter_ping/sliderCoronaImpact`,
`48_titanic_sos_beacon/sliderEchoDelay`,
`82_redwood_timber_fall/sliderImpactFlash`.

**Two `sliderLocalSpeed` that do nothing at all** (`113_tower_column_breath`,
`114_tower_ring_chase`) are the most serious entries here — a speed knob is the
first thing an operator reaches for.

Also `test/test_params/sliderFlashSpeed` (a test fixture, low priority).

### 4b. BURIED BY A DEFAULT — wired, but swallowed as shipped (9)

The control works; a shipped default at full scale hides it. Fix the default,
not the wiring.

| Pattern | Param | Why |
|---|---|---|
| `05_orbital_attractor_field` | `sliderWhiteKick`, `sliderBlinderBite` | gated behind `kick`, which ships at 0 |
| `17_rolling_color_dunes` | `sliderWhiteKick`, `sliderBlinderBite` | same — `rawKick = kick * (0.7 + 0.6·whiteKick)`, and `kick` ships at 0 |
| `12_breathing` | `sliderKick` | `level = 1.0` → gain 2.32 → `bri` saturated |
| `24_chromatic_murmuration` | `sliderKick` | same shape |
| `summer_camp/56_stage_mirror_axis` | `sliderCenter`, `sliderCenterGuide` | |
| `summer_camp/81_outpost_distress_beacon` | `sliderSignalStrength` | |

Measured proof for `17_rolling_color_dunes` on `test_bench`, byte-sum over 8
frames while sweeping `whiteKick` 0 → 1:

```
kick=0.0   →  delta      0   (dead)
kick=0.5   →  delta 30 578   (large)
kick=1.0   →  delta    314   (saturated)
```

### 4c. WRONG — measurable effect contradicts the name (39)

Worst first by measured effect. Full evidence per row in the results file.

| Effect | Pattern | Param | Reason |
|---:|---|---|---|
| 0.300 | `08_ocean_liner` | `sliderRadius` | spatial stats flat; moved `driftY` 0.30 |
| 0.299 | `07_shimmer` | `sliderRadius` | spatial stats flat |
| 0.266 | `summer_camp/74_lookout_gyro_vortex` | `sliderOutpostGlow` | luma flat |
| 0.219 | `summer_camp/111_…_pixel_heartbeat` | `sliderPopBrightness` | luma flat |
| 0.218 | `62_white_shimmer` | `sliderDirection` | no reversal |
| 0.200 | `29_kick_shockwave` | `sliderRingWidth` | spatial stats flat |
| 0.180 | `13_sparkle` | `sliderSparkleIntensity` | luma flat (moves spark size + rate instead) |
| 0.174 | `09_cyclone` | `sliderDirection` | no reversal |
| 0.168 | `summer_camp/112_…_call_response` | `sliderTurnBrightness` | luma flat |
| **0.164** | **`22_abyssal_sway_garden`** | **`sliderBaseDarkness`** | **inverted — adds light** |

**`22_abyssal_sway_garden` / `sliderBaseDarkness` is the clearest single bug in
the sweep and is confirmed in source:**

```
glowFloor = (0.04 + baseDarkness * 0.08) * (0.55 + 0.45 * heightWeight)
```

Raising "darkness" raises the glow floor. Measured luma rises monotonically
across the sweep — `0.0304 → 0.0330 → 0.0355 → 0.0380 → 0.0405` — and lit
fraction rises with it. The knob is named backwards, or its sign is wrong.

The remaining 29 WRONG rows cluster into recognisable groups:

- **6 `sliderDirection` that never reverse** — `01_cylon_sweep`,
  `03_dual_axis_crush`, `09_cyclone`, `12_breathing`, `61_white_breathe`,
  `62_white_shimmer`. See the limitation note in §5 before filing these: for a
  symmetric ping-pong whose motion is mirror-symmetric at the launch phase,
  direction is genuinely unobservable. `01_cylon_sweep` was read in source and
  is real in a specific sense — its `direction` is a *bias* on a chaotic
  auto-reversing sweep (`effDir = userSign * autoSign`), so it never
  deterministically reverses anything. The name over-claims.
- **8 `*Brightness` / `*Glow` that do not change luma.**
- **5 `SPEED`-named that do not change temporal rate** — `04_beat_folded_helix/
  sliderTwistFreq`, `33_aurora_breath/sliderBreathRate`,
  `summer_camp/72_outpost_campfire/sliderLocalSpeed`,
  `summer_camp/96_logsville_ember_storm/sliderEmberSpeed`,
  `transitions/trans_wave_sweep/sliderWaveFreq`.
- **4 `DARKNESS`-named that do not remove light**, one of them inverted.
- **3 `WHITE`-named whose emitters never move** — all consistent with the
  lane-match overwrite.

### 4d. Also worth a look

- **`transitions/trans_iris_close` / `sliderFeather`** — WRONG by a hair:
  `edgeSharpnessY` swing **0.0197** against a 0.020 threshold, moving in the
  right direction (falling). It is almost certainly fine. Recorded rather than
  quietly passed, because moving a threshold to absolve one case is exactly the
  fuzzy pass this harness exists to avoid.
- **`examples/inview_demo` does not compile on `titanic`** — references
  `inView("PORT")`, a view the ship model does not define. Loud, expected for a
  demo, listed for completeness.
- **25 patterns declare no sliders at all** — the `test/` fixtures, three
  channel blends, and five transitions.

---

## 5. Known limitations — read before acting on a row

1. **Symmetric ping-pong direction is unobservable.** If a sweep's motion is
   mirror-symmetric at the launch phase, both slider ends produce identical
   output and the harness reports `no_reversal_net_travel_or_velocity_series`.
   That is an honest measurement of "this knob does not visibly reverse
   anything", but it deserves a human look before it is called a bug.
2. **Verdicts are relative to the pattern's declared defaults**, because that is
   what the operator actually sees. The mid-range probe separates "buried by a
   default" from "unwired", but a control that only works in some third corner
   of the parameter space will still read DEAD.
3. **Audio-modulated controls are measured statically.** The trigger probe
   catches edge-triggered ones; a control that needs a specific modulation
   *envelope* may still under-report.
4. **`MAGNITUDE` and `UNKNOWN_CLAIM` can never be WRONG** — those names make no
   falsifiable directional promise. 35 rows sit in `UNKNOWN_CLAIM` awaiting
   human judgement; their measured effects are recorded in full.
5. **The sweep is single-parameter.** Interactions between two controls are not
   explored beyond the mid-range probe.

---

## 6. Artefacts and how to re-run

```bash
cd marsin_engine
node tools/param_truth/sweep_all.mjs                    # full sweep, ~3 min
node tools/param_truth/sweep_all.mjs --workers 8
node tools/param_truth/run_param_truth.mjs --pattern 13_sparkle
node tools/param_truth/run_param_truth.mjs --dir summer_camp \
     --model summer_camp_logsville --cross-model summer_camp_dome
```

- `marsin_engine/tools/param_truth/param_truth_results.json` — 1.3 MB,
  machine-readable, keyed by pattern id + control name, so the sweep is
  re-runnable and diffable. Raw series are kept only for non-TRUE rows so a
  re-run diff shows real changes rather than noise.
- `marsin_engine/tools/param_truth/param_truth_results.md` — 171 KB human
  report, worst-first, with a per-pattern punch-list.
- `marsin_engine/tools/param_truth/README.md` — harness documentation.

The default `sweep_all.mjs` uses half the machine's cores (capped at 12) so it
never starves the operator's live stack.

### CI

`marsin_engine/tests/patterns/param_truth_smoke.test.js` — 8 tests, ~6 s. Runs
the harness over a fixed three-pattern subset and asserts the machinery's
**properties**: discovery recurses into subdirectories, every declared slider
produces a verdict with a reason, rendering is deterministic, and no module
under `tools/param_truth/` imports a network transport. It deliberately does
**not** pin a verdict census — pattern files belong to the curator lineage and
change often, and a frozen census would fail on their legitimate work.

One fixture assertion is deliberately brittle and documented as such:
`13_sparkle / sliderAmberGlint` must classify DEAD. If the curator fixes that
pattern, the test is *expected* to fail; retarget the fixture rather than
loosening the check.

---

## 7. Verification

- `marsin_engine` full suite: the **same 8 pre-existing environment failures**
  documented in `_31` reproduce on every run (audio worker-IPC framing ×5,
  `effects_v2_mode_page_layout`, `EADDRINUSE`, playlist byte-identity). The new
  smoke tests pass (7/7, ~2 s).
- No pattern file was modified. Writes were confined to
  `marsin_engine/tools/param_truth/`, `marsin_engine/tests/patterns/`, this
  report, and the master doc. Pattern files in this shared worktree were last
  modified at 14:42 by the curator lineage; all of this session's writes are
  timestamped 19:xx.
- `python scripts/security_check.py --all`: 46 findings, **none in any file this
  session created or touched** (all pre-existing — MACs in gitignored
  `simulation/.scene_backups/`, IPs in older reports).
- No deploy, no git operation, no show port touched.

### ⚠️ The "same-8" bar is not actually stable — worth a follow-up

While confirming the baseline I found that **adding any test file at all**
destabilises the suite beyond the 8. Measured over repeated full runs:

| Condition | `timeline_deck_release_default_cue` fails |
|---|---|
| No file added | 0 / 4 runs |
| This report's smoke file added | 2–3 / 5 runs |
| **A trivial 3-line no-op test file added** | **2 / 5 runs**, plus 5 further flaky failures |

The failing mode is not test logic. `timeline_deck_release_default_cue.test.js`
passes **9/9 in isolation in 156 ms**; in the suite it dies with
`failureType: uncaughtException`, `error: 'Unable to deserialize cloned data due
to invalid or unsupported version'`, thrown inside node's own
`FileTest.parseMessage` / `#processRawBuffer`. That is the *same* node
test-runner IPC framing defect as the 5 documented audio failures — adding a
file merely reshuffles parallel scheduling and exposes more of it.

I shrank the smoke test anyway (merged its two WASM contexts into one, narrowed
the swept sliders, ~8 s → ~2 s) on the principle that a CI smoke which
destabilises the rest of the suite is worse than no smoke. It did not help,
because the trigger is file scheduling rather than cost.

**Implication for the team:** "same-8" is a coincidence of the current file set,
not a property of the suite. Any agent adding a test file will appear to cause a
regression they did not cause. Worth capping `--test-concurrency` in the `test`
script, or splitting the chatty timeline/audio files out of the parallel pool.
- No pattern file was modified. Writes were confined to
  `marsin_engine/tools/param_truth/`, `marsin_engine/tests/patterns/`, this
  report, and the master doc.
- No deploy, no git operation, no show port touched.

---

## 8. Recommended order of work

1. **R8 model mapping** unblocks 137 dead parameters at once — by far the
   highest leverage, and it is the ship's visibility that is at stake.
2. **`22_abyssal_sway_garden / sliderBaseDarkness`** — one-line sign fix,
   confirmed in source.
3. **The 9 defaults-buried controls** — change a default, not code; the two
   `kick`-gated blinder pairs are the audience-punch controls.
4. **`13_sparkle / sliderAmberGlint`** and the lane-match fallout — this is
   `_26`'s tail, and best handled alongside the parked R2 re-tune where the
   operator already plans to eyeball those seven patterns.
5. **The two dead `sliderLocalSpeed`** in the tower patterns.
6. The remaining WRONG rows, worst-effect first.
