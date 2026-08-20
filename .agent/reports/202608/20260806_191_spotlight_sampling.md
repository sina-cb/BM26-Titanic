# _191 — spotlight sampling: strategy census, flicker root causes, and a stable option

**Date:** 2026-08-06 · **Agent:** _191 (Opus implementer) · **Branch:** feat/bm_readiness
**Builds on:** `20260806_186` (precedence audit), `20260806_187` (pool sizing chain),
`20260806_189` (over-cap session prompt) — none of that chain is touched.

**Operator ask:** optimize the existing "Sim Spotlight Sampling" options, and add a
best-practice option for the best overall viewing **without flicker** — flicker meaning
temporal instability of the pool assignment, lights popping in and out as a pattern moves
brightness around the ship.

---

## 1. Strategy census (what shipped, before this work)

The dropdown lives in `scenes/common.yaml → options.spotlightSamplingMode` and offered
three names. The selector was `light_pool.js:445-583`.

| Strategy | What it samples on | Per-frame cost | Temporal stability |
|---|---|---|---|
| `closest` | **nothing — it was dead code** | n/a | n/a |
| `closest_bucket` | a depth window `[d(nearest emitter), + bucketDistance]`, then an even stride inside it | `O(V log V)` global sort + a full `O(V)` scan with **one `Math.sqrt` per request** + a second `O(B log B)` sort | worst of the three: the window's anchor jumps, and the stride re-indexes |
| `uniform` | even stride midpoints across the whole distance-sorted visible list | `O(V log V)` global sort + `O(K)` | poor: stride indices are computed from `visible.length`, which changes every frame |

`V` = frustum-passing, still-emitting requests (≈2300/frame on a 4800-pixel scene);
`K` = the per-frame active limit (the "Max Spotlights" slider); `B` = bucket members.

### The `closest` bug — a silent substitution, not a missing feature

`getSafeSpotlightSamplingMode()` accepted **only** `closest_bucket` and `uniform` and
returned `uniform` for everything else. `closest` is in the dropdown and had its own branch
in the selector (`if (samplingMode === 'closest') return visible.slice(0, activeLimit)`),
but that branch was **unreachable**: picking `closest` in the GUI silently ran `uniform`,
and so did any typo in the scene file. Nothing on any channel said so. That is exactly the
silent-fallback shape the codex forbids at P0, and it is also the operator's stated
favourite for close work ("closest is nice for looking at one side with 350 lights") — he
has never actually seen it.

---

## 2. Flicker root causes

"Flicker" here is instability of the **assignment**, not of a light's own brightness. Three
mechanisms, all structural:

**F1 — rank-based selection over a length-varying list.** `uniform` picks stride midpoints
whose indices are `floor(i·V/K)`. `V` changes *every frame*: the analytic light gate
(`analytic_light_gate.js`, from the _82 leak fix) drops pixels below 1/255, so a pattern
moving brightness around the ship continuously adds and removes list entries. One entry
appearing anywhere shifts **every** stride index — the whole selected set can turn over in
a single frame.

**F2 — a moving anchor.** `closest_bucket` anchors its window on `visible[0]`, the nearest
*emitting* pixel. When that pixel goes dark the anchor jumps to the next one, the window
slides, and the membership changes wholesale. It then uniform-samples inside the window, so
it carries F1 on top of F2.

**F3 — no continuity and no ramp.** Slot `i` was handed `sample[i]` positionally, with no
memory of the previous frame. A fixture that loses its slot goes from full intensity to
zero in one frame; one that gains a slot goes zero to full. Every set change is a hard cut.

**Ruled out** (checked, not causes): sorting ties do not oscillate — `Array#sort` is stable
per spec and the collect order is deterministic; and the 1/255 gate threshold is not itself
a pop source, because the request's colour carries the pixel's brightness, so a pixel
crossing the gate contributes a near-black light either way. The pops are **evictions of
bright fixtures**, which is F1/F2 driving F3.

Measured on a synthetic 4800-pixel ship with a travelling brightness wave, 600 frames,
pool 60: `closest_bucket` **reassigned a pool slot 54 times per frame**, and in its worst
frame replaced **all 60** at once.

---

## 3. What changed

New module **`simulation/src/core/spotlight_sampling.js`** owns every strategy and produces
a per-slot assignment plan; `light_pool.js` keeps ownership of the THREE objects and just
executes the plan. Splitting it also made the strategies unit-testable without a browser.

### 3a. Optimizations to the shipped strategies — semantics preserved

All three are asserted output-identical against a verbatim copy of the original selector
(900 randomized cases with ties/zeros/clusters, plus 800 real frame/budget combinations).

| Change | Effect |
|---|---|
| `closest_bucket` window tested on **squared** distance (`x ↦ x²` is monotone on `x ≥ 0`, so the membership set is identical) | `Math.sqrt` calls over 300 frames: **693,100 → 300** |
| `closest_bucket` bucket is a **contiguous prefix** (the window's lower bound *is* `visible[0]`, and `visible` is sorted), so the scan stops at the first non-member | full `O(V)` scan → `O(B)` |
| the `bucketRequests.sort(by bucketDepth, then distSq)` **deleted** — it sorted an already-sorted array by a monotone function of the same key, a provable no-op | one `O(B log B)` sort and one property write per request gone |
| the global distance sort now runs **only for the three positional strategies** | the stable strategies skip `O(V log V)` entirely |
| request objects **pooled** and mutated in place; the emission direction hoisted out of the pixel loop (it depends only on the fixture matrix); no per-pixel `Color` clone (every consumer `.copy()`s out of it); config-colour fallback memoised with a source check so it cannot go stale; `req.worldDir.clone().multiplyScalar(100)` → `addScaledVector` | collect loop at 4800 px: **0.307 → 0.052 ms/frame (5.9×)**, heap churn over 400 frames **19.6 MB → ~0**. Was 4 heap allocations per pixel per frame (Vector3 clone, Vector3 direction, Color clone, object literal) → **0 in steady state** |
| dark pixels are gated **before** the world-space transform | a dark pixel no longer pays for its matrix multiply |

Two behaviour changes, both deliberate, both loud:

- **`closest` now works.** It selects the K nearest emitting pixels, as its name and its
  (previously dead) code always said. An operator who had `closest` selected was running
  `uniform` and will see a change.
- **An unknown strategy name is refused.** `assertSpotlightSamplingMode()` throws a
  `RangeError` naming the bad value and the roster. `initLightPool()` validates once at
  boot, outside its try/catch, so a bad `common.yaml` value fails at boot rather than on
  the first animation frame. No coercion, no default.

The strategy roster now lives in **code** (`SPOTLIGHT_SAMPLING_MODES`), and
`gui_builder.addControl()` writes it into the config-tree entry so a save records the
truthful list — the same split as the "Max Spotlights" slider range in _187, and for the
same reason: `scenes/common.yaml` is operator-owned data, and an options list that
disagrees with the strategies that exist is a lie the operator can only find by picking a
dead option. **No scene file was edited by this work.**

### 3b. New option: `stable_importance` (the recommendation)

Two sentences: it scores every emitting pixel by **importance = brightness × proximity**,
picks candidates **round-robin across a spatial coverage grid** so one bright cluster
cannot own the pool while the far end of the ship goes dark, and then a slot **keeps its
fixture** until a challenger beats the weakest incumbent by 35% for 12 consecutive frames.
Every appearance, disappearance and handoff runs through a 15-frame crossfade, so a swap is
a dip and never a cut.

Per frame:

1. **Score.** `importance = (0.15 + 0.85·brightness) · 1/(1 + d²/r²)`. Brightness is the max
   channel — the same quantity the analytic gate thresholds, so "worth a slot" and "scores
   high" agree. Proximity is a solid-angle-flavoured falloff: 1 at the camera, 0.5 one model
   radius out — camera-aware, so what the operator is looking at wins, without the hard
   cliff `closest` has. Scores are **absolute, never per-frame normalized**: normalizing
   would make every score move whenever any pixel moves, which is F1 again, and would make
   the hysteresis margin meaningless.
2. **Coverage.** The model's bounding sphere is diced into `(2r)/8` cells. Requests are
   bucketed, sorted inside each cell, then the cells are walked **round-robin** — each
   cell's best, then each cell's second-best, and so on. Cells themselves are ordered by
   their best score, so the bright camera-facing region still leads. **Importance decides
   the order; coverage decides the spacing.** This is the answer to the operator's
   "representative overall view": camera-aware and coverage-aware pull in the same
   direction here because coverage only reorders *within* a budget that importance already
   ranked. Both are constants, not knobs — a coverage knob set to 0 would silently
   re-create the clustering it exists to prevent.
3. **Incumbency.** A slot keeps its pixel while that pixel is still emitting and in
   frustum. Nothing is re-derived from list rank, so F1 and F2 cannot reach the assignment
   at all.
4. **Hysteresis.** One global counter on the challenger key: the best unheld candidate may
   take the weakest incumbent's slot only after beating it by `×1.35` for **12 consecutive
   frames**. A challenger that flickers above and below the margin resets and never wins.
5. **Bounded change.** ≤ 8 new lights and ≤ 2 handoffs per frame.
6. **Crossfade.** A per-slot `gain` envelope moves 1/15 per frame and multiplies the light
   intensity. A handoff is: fade the incumbent to 0 → adopt the challenger → fade to 1.
   The slot keeps a **slot-owned snapshot** of what it is showing, so a fixture that goes
   dark or leaves the frustum fades out properly instead of vanishing.

Determinism: pure functions of the frame's data, ties broken on the stable per-pixel key,
iteration in slot-index order. **No `Math.random` anywhere in the module.** Two runs over
the same input produce identical plans, frame for frame (asserted for all five strategies).

Tuning constants and why:

| Constant | Value | Why |
|---|---|---|
| `IMPORTANCE_BRIGHTNESS_FLOOR` | 0.15 | dimness should lose ties, not be invisible |
| `COVERAGE_GRID_DIVISIONS` | 8 | a cell ≈ a quarter of the hull: coarse enough that a cell holds many fixtures (so round-robin actually spreads), fine enough that one cluster cannot own the pool |
| `STABLE_HYSTERESIS_MARGIN` | 1.35 | comfortably outside a pattern's frame-to-frame ±10–20% shimmer |
| `STABLE_HYSTERESIS_FRAMES` | 12 | 0.2 s at 60 fps ⇒ at most 5 evictions/second can even be *started* |
| `STABLE_FADE_FRAMES` | 15 | 0.25 s: responsive when a fixture lights up, never reads as a cut |
| `STABLE_MAX_FILLS_PER_FRAME` | 8 | a mass light-up reveals over ~0.4 s instead of flashing |
| `STABLE_MAX_HANDOFFS_PER_FRAME` | 2 | hard ceiling on visible change |

### 3c. `rotating_coverage` — the operator's time-sharing idea, honestly evaluated

**The fast regime is arithmetically impossible and is not implemented.** A browser renders
at 60 Hz. Time-sharing one pooled slot between `K` fixtures gives each a `60/K` Hz square
wave. Critical flicker fusion for a bright source against a dark field is ~50–60 Hz.
`K = 2` is 30 Hz — a hard strobe, and the naive round-robin would *add* flicker rather than
remove it. `K = 1.2` would fuse and buys nothing. **There is no `K` that both fuses and
increases coverage**, so persistence of vision cannot be used to "show all of them a
fraction of the time" at browser frame rates. This is stated in the code beside the
constant so nobody adds a fast-cycle knob later.

**The slow regime does work**, and it is shipped as an explicitly experimental option.
`rotating_coverage` is `stable_importance` with step 4 replaced by a forced, staggered
rotation: each slot hands off every **360 frames (6 s ⇒ 0.17 Hz**, three orders of
magnitude below any flicker percept) to the best candidate that has not had a turn in the
last 900 frames, through a **30-frame (0.5 s) crossfade**. Neighbouring slots are staggered
7 frames apart so the ship never changes all at once.

It is a **look, not a free lunch**: at any instant only `pool` lights are on. On a static
field it showed **160 distinct fixtures over 30 s with a pool of 60** (2.7×). On a strongly
animating field the wave already turns fixtures over, so the extra coverage is small. It is
never the recommendation.

---

## 4. Numbers (synthetic harness, `~/tmp/fix_191/`)

Travelling brightness wave, 600 frames. "Slot changes" = a pooled SpotLight changing which
fixture it represents — one visible pop each, under the old strategies.

**4800 pixels (~2300 visible/frame), pool 60:**

| Strategy | slot changes | per frame | worst single frame |
|---|---|---|---|
| `closest` | 18,056 | 30.1 | 60 of 60 |
| `closest_bucket` | 32,544 | 54.2 | 60 of 60 |
| `uniform` | 31,780 | 53.0 | 60 of 60 |
| **`stable_importance`** | **1,160** | **1.93** | **8** |
| `rotating_coverage` | 939 | 1.56 | 8 |

**288 pixels, pool 24:** `closest` 4,906 · `closest_bucket` 6,809 · `uniform` 7,200 ·
**`stable_importance` 466** · `rotating_coverage` 370.

⇒ **28× fewer reassignments than `closest_bucket`**, and the worst frame goes from *the
whole pool turning over* to *8 lights fading in*.

**Cost, `plan()` only, 4800 px / 2300 visible / pool 60:** `closest` 0.489, `closest_bucket`
0.488, `uniform` 0.678, `stable_importance` 0.872, `rotating_coverage` 0.910 ms/frame. The
positional numbers *include* the `O(V log V)` distance sort they require; the stable modes
skip it but pay for scoring plus per-cell sorting. So `stable_importance` costs ~0.4 ms
more per frame than `closest_bucket` at 4800 pixels — ~1.6% of a 25 ms frame budget — and
the shared collect-path win (**−0.26 ms/frame, −19.6 MB of GC churn per 400 frames**)
applies to every strategy including the old ones. Net at 4800 px, `closest_bucket` is
faster than before; `stable_importance` is roughly break-even against the *old*
`closest_bucket` and vastly stabler.

---

## 5. Tests

**New: `simulation/tests/spotlight_sampling.test.js` — 27 tests, all pass.** Offline: no
browser, no ports, no scene writes.

- **Roster / refusal:** the five names in dropdown order; `''`, `'CLOSEST'`, `'closest '`,
  `'stable'`, `'nearest'`, `null`, `undefined`, `7`, `{}` all throw a `RangeError` naming
  the value and the roster; every roster entry validates.
- **Legacy semantics preserved:** the original selector is copied verbatim into the test
  file and diffed against the new one over 900 randomized cases (ties, zeros, clustered
  depths, budgets 0–40, bucket 2–20) and 800 real frame/budget combinations — identical
  chosen sets, in order. Stride arithmetic pinned including the odd `sampleCount === 1`
  case (picks the *last* element).
- **The `closest` fix:** `closest` and `uniform` now select different sets, and `closest`
  really is the K nearest in order.
- **Churn:** `stable_importance` is asserted **>10× calmer** than both `closest_bucket` and
  `uniform` on the same input (actual: 28×), calmer than `closest`, and its worst frame is
  bounded by `MAX_FILLS + MAX_HANDOFFS`. The legacy modes are asserted to turn over more
  than a third of the pool in a single frame — the failure mode is pinned, not assumed.
- **Hysteresis:** below the margin never wins (400 frames); over the margin wins, but not
  before `HYSTERESIS_FRAMES + FADE_FRAMES − 1`; a challenger alternating across the margin
  never wins in 600 frames; the margin constant itself is the line (×1.05 wins, ×0.98
  never does).
- **Crossfade:** a handoff is monotone down to exactly 0, then monotone up to 1, one
  `1/FADE_FRAMES` step at a time; and across a full 600-frame run no gain ever moves faster
  than one step (both stable modes, each against its own fade constant).
- **Determinism:** two runs, all five strategies, 400 frames — identical key traces and
  identical gain traces.
- **Coverage:** with one very bright bow cluster, `stable_importance` still lights ≥4
  distinct grid cells and spreads strictly wider than `closest`.
- **`rotating_coverage`:** shows more distinct fixtures than it has slots; stays ≥5×
  calmer than `uniform`.
- **Plumbing:** plan shape (one entry per slot, `null` for unused, gain 1 for positional);
  mode switching drops the previous strategy's half-faded state; `reset()` (the
  analytic-lighting-off path) clears everything; an empty frame releases every slot; pulling
  the "Max Spotlights" slider down **fades** the surplus slots out instead of cutting them.
- **Boot gate:** a scene naming `closest_buckets` fails `initLightPool()` with the loud
  `RangeError`; all five roster strategies boot a real 8-SpotLight pool.

**Touched existing suite:** `simulation/tests/spotlight_pool_budget.test.js` — one line
added to its `bootScene()` harness (it must now supply `params.spotlightSamplingMode`, as
every real scene does via `extractParams`). **33 tests, all pass**, none rewritten.

**Full suite:** `node --test tests/*.test.js` → **2217 tests, 2209 pass, 7 fail, 1 todo.**
Failing list is **identical to the known baseline**:

- `bench_section_sync.test.js` ×5 (`:119 :221 :271 :451 :460`)
- `pixel_map_view_defaults.test.js` — "the compression threshold has real headroom on the
  live scene" (now at `:510`; the baseline recorded `:487` — the line moved because another
  session is editing that file, the test and its failure are the same)
- `bench_mirror_state.test.js:212` (the tracked `scenes/test_bench/bench_mirror_state.yaml`
  that _187 flagged as needing an operator ruling)
- todo: `scene_data_lint.test.js:109`

`tests/pixel_order*` and the rest of `tests/bench_mirror*` all pass. The three touched
browser modules were also acorn-parsed (Node cannot import them wholesale): all OK.

No live processes were started, no operator ports bound, no git operations run, nothing
written under `scenes/**` or `states/**` or `marsin_engine/**`.

---

## 6. The operator's 60-second eyeball recipe

I could not screenshot anything — the sim on :6969 is yours and live. Here is how to see
all of it yourself.

1. **Reload the sim.** The new dropdown entries are built at GUI setup, so a refresh is
   required. Scene `titanic`, a profile that uses analytic lights (`?profile=full`), "Max
   Spotlights" wherever you normally run it.
2. **Run a churny pattern.** Anything that moves brightness fast: `13_sparkle` or
   `35_sparkle_rain` are the worst case; `01_cylon_sweep` shows it more legibly.
3. **Watch the WASH, not the dots.** The pooled SpotLights are what light the hull and the
   ground — the emitter dots themselves are unaffected by this setting. Look at the pools of
   light on the deck and the ground plane.
4. **A/B it live** — Lighting panel → **Sim Spotlight Sampling**. No reload needed, the
   change takes effect on the next frame.
   - `closest_bucket` / `uniform` → the wash **boils**: patches of light jump around,
     appear and vanish between frames. That is 54 reassignments per frame.
   - `stable_importance` → the boil stops. Patches hold still, and when one does change it
     **fades** over a quarter second. Coverage should also look more spread along the hull
     instead of piling up wherever the pattern is brightest.
   - `closest` → **this one actually changed**: it now really is "the nearest N", which is
     what you wanted for looking at one side up close. Before this change picking it
     silently ran `uniform`.
   - `rotating_coverage` (experimental) → coverage slowly wanders on a 6-second cycle,
     crossfading. Nice for a wide static-ish look; not a substitute for more slots.
5. **Keep it:** hit 💾. The choice persists in `common.yaml` exactly like the old ones, and
   the save now also records the full options list.
6. **Nothing else moved:** the default is unchanged (`uniform` in `common.yaml`) — you opt
   in from the UI. The "Sim Sampling Bucket (m)" slider still shows only for
   `closest_bucket`. Pool sizing, `?spotlights=`, the over-cap prompt, the slider range and
   the GPU banners are all untouched.

**One thing to know:** a scene file naming a sampling strategy that does not exist now
fails the pool boot loudly, with the bad name and the valid list in the console. It used to
silently run `uniform`. If you ever hand-edit `common.yaml`, that is the message you will
get for a typo.
