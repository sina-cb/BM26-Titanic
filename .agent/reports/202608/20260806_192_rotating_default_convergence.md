# _192 — `rotating_coverage` as the shipped default, and a 2–3× faster convergence

**Date:** 2026-08-06 · **Agent:** _192 (Opus implementer) · **Branch:** feat/bm_readiness
**Amends:** `20260806_191` (spotlight sampling). The `_186`/`_187`/`_189` pool-sizing
chain is untouched. **Nothing under `scenes/**`, `states/**` or `marsin_engine/**`
was written.**

**Operator ask, two parts:**
1. "Make the rotating coverage default."
2. "Is there a way to slightly speed up the convergence of the light changes?"

Both done. Short answers up front: the default now lives in **code**, and the
operator's live scene keeps its saved value until he re-saves (exact steps in §2);
and yes — convergence is **2.0–3.1× faster**, with the per-light modulation moving
from 0.167 Hz to **0.286 Hz**, still ~52× below the frequency where flicker is
visible at all.

---

## 1. Where the default lived, and where it lives now

Post-`_191` there was **no code default at all**. The value came from exactly one
place:

```
scenes/common.yaml → options.spotlightSamplingMode.value   (shipped as `uniform`)
        ↓ extractParams()  (src/core/config.js:207)
params.spotlightSamplingMode
        ↓ assertSpotlightSamplingMode()  (light_pool.js initLightPool + per frame)
```

`common.yaml` is not a "defaults file" — the **save path writes it**
(`server/save-server.js:447` splits `atmosphere / options / colorWave / config /
_camera / _patternEditor` out of the config tree and writes them to
`scenes/common.yaml`, shared by every scene). So a default parked there is
whatever the last 💾 happened to leave behind, not a decision anyone made. The
scenes themselves carry no `options:` section at all — `titanic/scene_config.yaml`
has none, so its sampling value **is** the one in `common.yaml`.

That is why the default went into code, matching the split `_187` used for the
"Max Spotlights" slider range and `_191` used for the strategy roster:

| Thing | Owner | Written into the config tree by |
|---|---|---|
| strategy **roster** | `SPOTLIGHT_SAMPLING_MODES` (code) | `gui_builder.addControl()` (`_191`) |
| slider **range** | `light_pool` (code) | `gui_builder.addControl()` (`_187`) |
| **default strategy** | `DEFAULT_SPOTLIGHT_SAMPLING_MODE` (code) — **new** | `gui_builder.ensureSpotlightSamplingEntry()` — **new** |
| the **chosen value** | the operator, in `scenes/common.yaml` | `reconstructYAML()` on 💾 |

### Precedence — unchanged

```
saved scene value  >  code default  >  (nothing: an unknown value still throws)
```

`resolveSpotlightSamplingMode(saved, context)` is the single authority:

- `saved === undefined` — the key is **absent from the config tree**, i.e. the
  scene has recorded no opinion — is the *only* input that reaches the code
  default. That is not a fallback; there is nothing to fall back from.
- Everything else is a recorded opinion. `null`, `''`, `'rotating'`, `7`, `{}`
  all still throw the `_191` `RangeError` naming the value and the roster
  (codex P0). The default never swallows a typo.

Three loud, non-silent behaviours were added:

1. **`initLightPool()`** resolves an absent value **once at boot**, writes it back
   onto `params`, and `console.warn`s that it is running the shipped default and
   that saving will record it. Because it is resolved once, the per-frame reader
   stays a bare assert with no default branch.
2. **`gui_builder.ensureSpotlightSamplingEntry()`** creates the `⚙️ Options →
   spotlightSamplingMode` leaf when the section has none, at the resolved value,
   and warns. This is required, not cosmetic: `buildOptionsSection` builds
   controls by walking the leaves that **exist**, and `reconstructYAML()` only
   writes into leaves that **already exist** — so without the seed, an operator
   who deleted the key would have no dropdown at all and no way for the next save
   to record what he is looking at. Same shape and same reason as
   `applySubscribedUniverses()` in `subscribed_universes_prompt.js`. A leaf that
   is already there is left completely alone.
3. A module-load self-check refuses a `DEFAULT_SPOTLIGHT_SAMPLING_MODE` that is
   not on the roster, so that class of typo can never reach a boot.

**Known limit, stated rather than papered over:** if a scene's tree has no
`options:` **section** whatsoever, `buildOptionsSection` never runs, so no leaf is
seeded and there is no dropdown — exactly as for every other Options control. The
pool still boots on the code default and says so in the console. No scene in the
repo is in that state.

---

## 2. What the operator has to do on the live `titanic` scene

**The live scene has a saved value** (`scenes/common.yaml → options.
spotlightSamplingMode.value`, currently `uniform`), and **a saved value always
wins over the code default**. Reloading alone will therefore change nothing.
Either of these makes `rotating_coverage` the thing that runs — pick one:

**A. Flip it and save (30 seconds, recommended)**

1. Reload the sim (`?profile=full`, or whichever profile uses analytic lights).
2. Lighting panel → **⚙️ Options → Sim Spotlight Sampling** → pick
   `rotating_coverage`. It takes effect on the next frame, no reload.
3. Hit **💾**. That writes `value: rotating_coverage` into
   `scenes/common.yaml`, and it is what every scene loads from then on.

**B. Delete the saved key (makes the code default the thing that runs)**

1. Close the sim tab first — an autosave would rewrite the file under you.
2. In `simulation/scenes/common.yaml`, delete the whole four-line
   `spotlightSamplingMode:` block under `options:` (the key, its `value:`, its
   `label:` and its `options:` list).
3. Reload. The console prints the `[LightPool] this scene records no
   options.spotlightSamplingMode` notice, the dropdown is rebuilt at
   `rotating_coverage`, and the next 💾 records it.

Route A is the one to use. Route B exists so "what does a fresh install do?" has
an answer you can actually verify, and it is the only route that proves the seed
path works. **This report changed no scene file; the value on disk is still
`uniform` until you do one of the above.**

---

## 3. Faster convergence — what changed, and the arithmetic that keeps it safe

`_191` established the slow regime in writing: at 60 Hz vsync a K-way time-share
gives each light a 60/K Hz square wave against CFF ≈ 50–60 Hz, so **no K both
fuses and adds coverage**, and the fast regime is refused. Nothing here goes near
it. Three changes, all inside the slow regime:

| Constant | `_191` | `_192` | In seconds at 60 fps |
|---|---|---|---|
| `ROTATION_PERIOD_FRAMES` | 360 | **210** | 6 s → **3.5 s** |
| `ROTATION_FADE_FRAMES` | 30 | **20** | 0.5 s → **0.333 s** |
| `ROTATION_WARMUP_PERIOD_FRAMES` | — | **105** (new) | first turn only, **1.75 s** |
| `ROTATION_MEMORY_FRAMES` | 900 | 900 (deliberately unchanged) | 15 s |

### 3a. The frequencies, stated

- **Per-slot modulation.** A slot's `gain` envelope dips to 0 and back **exactly
  once per period**, so the modulation frequency is `fps / period`:
  **0.167 Hz → 0.286 Hz**. Visible flicker for a bright source on a dark field
  starts around 15–20 Hz; CFF is ~50–60 Hz. 0.286 Hz is **~52× below the visible
  floor and ~190× below CFF**. It reads as breathing, which is the entire point
  of the mode.
- **Per-fixture modulation is slower still.** A fixture that has had its turn is
  excluded for `ROTATION_MEMORY_FRAMES` = 15 s, so its own on/off cycle is
  **≤ 0.067 Hz**.
- **Fastest luminance slew.** A full 0 → 1 crossfade in **0.333 s**. That is a
  one-shot ramp, not a periodic modulation — and it is still **33% gentler than
  the 0.25 s crossfade `stable_importance` has shipped with since `_191`**, which
  the operator has been looking at and which reads as a dip, not a cut. That
  comparison is the strongest single argument that 0.333 s is safe: the mode he
  already calls smooth transitions faster than this one does.
- **Transition duty is essentially unchanged.** A handoff is fade-out + fade-in =
  0.667 s inside a 3.5 s cycle (**19%**), against 1.0 s inside 6 s (**17%**). The
  ship is no busier than it was; the coverage just arrives sooner.

`ROTATION_MEMORY_FRAMES` was **not** scaled down with the period on purpose: it is
a wall-clock "don't show me that one again yet" window, and holding it at 15 s
while the period shrinks makes each turn *more* likely to land on something
genuinely new — which is the convergence being asked for.

### 3b. The compressed first turn

Before, a slot's first rotation was scheduled at `frame + period + stagger`, i.e.
**one to two full periods** after it lit up — so the mode did nothing at all for
the first 6–12 s, which is most of what "slow to converge" felt like. The first
turn of each slot in a rotation *epoch* (boot, strategy switch, analytic lighting
coming back on — every path through `_resetStableState`) is now scheduled at
`ROTATION_WARMUP_PERIOD_FRAMES` instead, with the stagger taken modulo that
period so it stays a spread inside it.

It is **one turn per slot**: `_rotate()` always re-arms at the full
`ROTATION_PERIOD_FRAMES`, so this is a warmup, not a permanently faster mode.
Nothing about a handoff changes — same crossfade, same `≤2` handoffs and `≤8`
fills per frame, same candidate and memory rules — **only when the first one is
scheduled**, which is why every crossfade and churn invariant is untouched by it.

Measured on one slot with no stagger (static field):

| | first turn | second turn | gap |
|---|---|---|---|
| `_191` | frame **391** (6.52 s) | 751 | 360 |
| `_192` | frame **125** (2.08 s) | 335 | 210 |

**3.1× faster to the first visible rotation**, then dead-on the steady cycle. And
after a `reset()`, `_191` produced **no turn at all** inside a following period;
`_192` re-arms and turns at frame 125 again.

### 3c. Convergence numbers, before → after

Synthetic 24-fixture × 12-pixel ship, **static** field (every pixel lit, nothing
moving — the honest test, because the rotation is then the only thing that can
change the picture; on an animating field the pattern's own turnover flatters the
measurement). Harness: `~/tmp/fix_192/`.

| Measurement | `_191` | `_192` | Speed-up |
|---|---|---|---|
| pool 24 — frames to **75% of the ship's fixtures** represented (18 of 24) | 857 (14.3 s) | **386 (6.4 s)** | **2.22×** |
| pool 24 — frames to **2× pool** distinct fixtures (48) | 554 (9.2 s) | **224 (3.7 s)** | **2.47×** |
| pool 24 — frames to **3× pool** (72 — the ceiling) | 914 (15.2 s) | **434 (7.2 s)** | **2.11×** |
| pool 12 — frames to **50% of fixtures** (12 of 24) | 412 (6.9 s) | **146 (2.4 s)** | **2.82×** |
| pool 12 — frames to **2× pool** (24) | 469 (7.8 s) | **203 (3.4 s)** | **2.31×** |
| pool 12 — frames to **3× pool** (36 — the ceiling) | 829 (13.8 s) | **413 (6.9 s)** | **2.01×** |
| first rotation of a slot (pool 1) | 391 (6.5 s) | **125 (2.1 s)** | **3.13×** |

**A ceiling worth knowing about, and it is not the period.** The rotation can only
hand a slot to something on the candidate list, and that list is
`CANDIDATE_DEPTH_FACTOR (3) × slotBudget` deep. So `rotating_coverage` tops out at
**3× the pool** in distinct fixtures no matter how long it runs — which is exactly
the "~2–4×" `_191` measured (160 on a pool of 60 = 2.7×). `_192` gets to that
ceiling twice as fast; it does not raise it. Raising it is a separate decision
with a per-frame cost, and it would change `stable_importance` too, so it was
left alone.

### 3d. It did not buy convergence with churn

Travelling-wave field, 600 frames, pool 24 — slot reassignments (each one is a
crossfade, never a cut):

| Strategy | slot changes | per frame | worst frame |
|---|---|---|---|
| `uniform` | 7,200 | 12.00 | 24 of 24 |
| `stable_importance` | 466 | 0.78 | 8 |
| `rotating_coverage` (`_191`) | 370 | 0.62 | 8 |
| **`rotating_coverage` (`_192`)** | **436** | **0.73** | **8** |

The faster cycle costs **66 extra slot changes in 10 seconds** (0.11/frame) and
still comes out **calmer than the `_191` recommendation** and **16.5× calmer than
`uniform`**. Worst-frame change is unmoved at 8, bounded by
`STABLE_MAX_FILLS_PER_FRAME + STABLE_MAX_HANDOFFS_PER_FRAME` = 10.

---

## 4. The knob decision: retuned constants, no new GUI control

**No knob was added.** Reasons, in order of weight:

1. **`_191` fenced this exact constant off in writing** — "the fast regime is not
   implemented and must not be added", stated in the code beside
   `ROTATION_PERIOD_FRAMES` precisely so nobody adds a fast-cycle knob later. A
   "Sim Sampling Cycle (s)" slider is that knob. The whole value of the mode is
   that its modulation is *provably* far below any flicker percept; a free-seconds
   dial makes that proof the operator's problem, at 2 a.m., on playa.
2. **The ask was a tuning question, not a dial.** "Slightly speed up" is answered
   once, by better numbers, for everyone — not by a control the operator now has
   to think about every session.
3. **Cost out of proportion.** A knob needs a new persisted key in
   `scenes/common.yaml` — an operator-owned file this task may not edit — so it
   would need its own code-owned seed, its own validated range, its own refusal
   path and its own control, to expose a number that has one right answer.
4. The constants now carry the reasoning **in the code, where the constraint
   lives** (the CFF block in `spotlight_sampling.js`), including the explicit
   "do not keep pulling this down expecting more coverage" note and the
   arithmetic that says why.

**If a dial is ever genuinely wanted**, the honest shape is a three-value dropdown
— `Gentle / Normal / Quick` mapping to vetted `(period, fade, warmup)` triples —
never free seconds. That keeps every value on the shipped side of the flicker
argument. Not built, because nothing has asked for it.

---

## 5. Tests

`simulation/tests/spotlight_sampling.test.js`: **27 → 37 tests, all pass.**
`simulation/tests/spotlight_pool_budget.test.js`: **33 tests, all pass, none
touched.** Together **70 / 70**. Offline: no browser, no ports, no scene writes.

Every `_191` invariant still holds and none was relaxed — churn bounds, hysteresis
(margin and frame count), crossfade monotonicity and one-step-per-frame,
determinism across all five strategies, coverage spread, legacy-semantics
identity, and the loud boot refusal.

**New (10):**

- **Default + precedence.** `DEFAULT_SPOTLIGHT_SAMPLING_MODE` is
  `rotating_coverage` and is on the roster; `resolveSpotlightSamplingMode`
  returns the default *only* for `undefined`, returns every roster value
  unchanged, and still throws a `RangeError` for `null`, `''`, `'CLOSEST'`,
  `'rotating'`, `'rotating_coverages'`, `7`, `{}`.
- **Boot on the default.** A pool booted with the key **deleted** initializes,
  writes `rotating_coverage` back onto `params`, and prints the "records no
  options.spotlightSamplingMode" warning — asserted from captured console output,
  so the default can never go silent.
- **The slow regime, pinned.** Per-slot modulation must stay ≥ 40× below the
  15 Hz visible-flicker floor (0.286 Hz passes with room; the guard fires if
  anyone pushes the period below ~2.7 s). The rotation crossfade must stay
  gentler than `STABLE_FADE_FRAMES`. The memory window must exceed two periods.
  The warmup must be half the period and longer than two full fades. The three
  shipped numbers (210 / 20 / 105) are pinned as literals.
- **Convergence, with the before-numbers as literals in the suite.** Frames to
  75% fixture coverage (pool 24) and to 2× pool distinct fixtures (pool 12) must
  each be **at least 1.8× faster** than the pre-`_192` measurements (857 and 469,
  written into the file), and within 25% of the measured 386 / 203. A companion
  assertion shows `stable_importance` **never** reaches the 75% target on the same
  input — this is coverage the rotation buys, not coverage the scene gave away.
- **The warmup, both halves.** The first turn lands after the warmup and no later
  than warmup + one fade (measured: exactly frame 125), and strictly inside one
  steady period; the *second* turn is a full `ROTATION_PERIOD_FRAMES` later
  (measured: exactly 210), proving the compression is one turn per slot and does
  not leak into steady state. A `reset()` re-arms it — the boot / strategy-switch
  / lighting-back-on path.
- **The warmup changes nothing about a handoff.** Across the warmup window, no
  gain step exceeds `1 / ROTATION_FADE_FRAMES` and no frame adds more lights than
  `MAX_FILLS + MAX_HANDOFFS`.
- **No churn regression.** `rotating_coverage` must stay within 1.25× of
  `stable_importance` on the wave field (actual: it is *lower*, 436 vs 466).

**Full sim suite:** `node --test tests/*.test.js` → **2231 tests, 10 fail, 1 todo.**
Seven are the known baseline — `bench_section_sync` ×5 (`:119 :221 :271 :451
:460`), `pixel_map_view_defaults:510`, `bench_mirror_state:212`, todo
`scene_data_lint:109`. **The other three are foreign and in flight**, from the
concurrent session that is mid-edit on the 2D Pixel Map (`git status` shows 7
modified `src/gui/pixel_map/*` sources and 5 modified `tests/pixel_map_*` files,
none of them mine): `pixel_map_edit_move:147`,
`pixel_map_layout_expansion:281`, `pixel_map_view_adjustability:104`. The count
moved between two runs minutes apart (7 → 10), which is what a shared tree under
active edit looks like. Nothing in this work touches the pixel map.

The two browser modules Node cannot import wholesale (`gui_builder.js`,
`light_pool.js`) were acorn-parsed as ES modules: both OK.

No live processes were started, no operator ports bound (6966–6972, 5568, 8081,
10000 all untouched), no git operations run, and nothing was written under
`scenes/**`, `states/**` or `marsin_engine/**`. Scratch lives in `~/tmp/fix_192/`.

---

## 6. Files touched

| File | Change |
|---|---|
| `simulation/src/core/spotlight_sampling.js` | `DEFAULT_SPOTLIGHT_SAMPLING_MODE` + `resolveSpotlightSamplingMode()` + module-load self-check; rotation constants retuned (210 / 20) with the full frequency reasoning; new `ROTATION_WARMUP_PERIOD_FRAMES` and the epoch-scoped first-turn schedule |
| `simulation/src/core/light_pool.js` | boot-time resolve of an absent value onto `params`, with the loud notice; doc updated |
| `simulation/src/gui/gui_builder.js` | `ensureSpotlightSamplingEntry()` seeds the `⚙️ Options` leaf so the default gets a dropdown and persists on save |
| `simulation/tests/spotlight_sampling.test.js` | +10 tests, coverage/turn tracking in the run harness, `staticBrightness` field |
| `simulation/tests/spotlight_pool_budget.test.js` | **untouched** (33 pass) |

---

## 7. Eyeballing it (I could not — :6969 is the operator's live sim)

Follow §2 route A first, then: `13_sparkle` or `01_cylon_sweep`, and **watch the
wash on the deck and the ground, not the emitter dots** — the dots are unaffected
by this setting. What is different from `_191`: the coverage starts wandering
after about **2 seconds** instead of standing still for **six and a half**, each
change takes a third of a second instead of half a second, and the whole ship has
been visited roughly twice as fast. If it reads as *busy* rather than *breathing*,
that is the one judgement the numbers cannot make — say so and the period goes
back up; the constants and their reasoning are in one block at the top of
`spotlight_sampling.js`, and the tests will tell you immediately if a change
leaves the slow regime.
