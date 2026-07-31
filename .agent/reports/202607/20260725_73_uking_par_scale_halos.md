# 20260725_73 — UKing pars render at 3×, and every DMX fixture's halo is finally a rim

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (3D render path only)
**Order (operator):** *"do the same 3X enlargement for the par can Uking pars"*
and *"make sure all DMX fixtures have the halo, if it's not hurting
performance. High FPS is a must now."*

## TL;DR

- **Par cans: 3.0×, shipped.** Type key is **`UkingPar`** (model `uking_par_10`,
  `dmx/fixtures/uking_rgbwau_par_light/model_10.yaml`) — **47 of them on
  titanic, the most numerous fixture in the scene and the smallest single
  emitter**. Can 150 mm → **450 mm**, depth 120 mm → **360 mm**, bulb radius
  0.039 → **0.117**. Single-pixel, so the pixel-pitch ceiling never touches it:
  the 3× is exactly what is drawn, at every slider position.
- **Halos on all DMX fixtures: shipped, and it cost nothing.** They were never
  missing from the scene graph — they were **drawn inside their own bulbs**. At
  the operator's own settings a par's halo was **0.98× its bulb radius**:
  rendered every frame, invisible in every frame. Now the DMX halo is a rim
  **multiple** of the bulb as drawn, so it is outside the core at every setting
  — 1.48× at his 0.6, the historical 1.8× at the default.
- **Perf gate PASSED on a verified discrete GPU.** Scene-object census is
  **byte-identical** (1735 objects, 292 InstancedMesh, 3626 instances, 224
  sprites, 891 meshes) — the halo was already one InstancedMesh per fixture and
  still is; only numbers in its matrix buffer changed. Controlled within-session
  A/B: halos effectively off vs shipped = **30 vs 30 FPS**.

## 1. The par can

`UkingPar` is a 150 × 150 × 120 mm cylinder shell with **one** 39 mm RGBWAU
head at the fixture origin. Confirmed as what the titanic scene instantiates:
the live scene inventory reads **UkingPar 47**, ShehdsBar 20, VintageLed 16, TE
Sign halves 2 + 2 — and `dmxSceneFixtures` is empty, so every one of them goes
through `DmxFixtureRuntime`, the class the multiplier lives in. `scenes/**` was
read for diagnosis only; nothing there was written.

Added `UkingPar: 3.0` to `FIXTURE_MODEL_SCALE`. Same invariants as the vintage
2.5×:

| invariant | how it holds |
|---|---|
| housing scales | the **cylinder** shell branch (radius + height + offset) — the other geometry path from the vintage box, now covered by a test |
| pixels scale | bulb radius 0.039 → 0.117, applied after the 0.02 floor |
| physical `localPos` untouched | one pixel at the origin; the Pixelblaze exporter and light pool still read the real rig |
| clamp measured on drawn spacing | a single-pixel fixture has pitch 0 ⇒ **no ceiling ever applies** — verified at the slider max |
| instancing preserved | still one bulb + one halo InstancedMesh, count 1 |
| floor-guard test | fails if `UkingPar` is ever set below **3.0** |

## 2. The halo — what was actually wrong

Every fixture type already builds a halo `InstancedMesh`
(`led_halo_parity.test.js` has pinned that since `_49`). The defect was
**dimensional**, and it is a good one:

```
bulb radius = physicalBulb × modelScale × globalPixelScale
halo radius = physicalBulb × 1.8         × globalHaloScale     ← different slider
```

Two different sliders on the two radii, so the "rim" sinks **inside** its own
opaque core whenever `haloScale < pixelScale / 1.8`. At the operator's live
settings (Global Pixel Size **1.1**, Global Halo Size **0.6**) that threshold is
0.611 — he sits at 0.6, i.e. **just** inside the broken regime:

| | radius |
|---|---|
| par bulb, old rule | 0.039 × 1.1 = **0.0429** |
| par halo, old rule | 0.039 × 1.8 × 0.6 = **0.0421** |
| ratio | **0.98× — the halo is buried in the bulb** |

And **model-scaling made it strictly worse**: the bulb grew by 2.5×/3×, the rim
did not. So the par work in §1 would have deepened exactly the problem he was
reporting. (An LED-bus fixture escapes this because its halo is the absolute
`ledHaloRadius()` and its bulb is a token 12 mm puck — at his settings a TE Sign
pixel glows at 3.8× its core while a par glowed at 0.98×. That asymmetry is what
"all DMX fixtures have the halo" is really about.)

### The rule now

`dmxHaloRimMultiple(haloScale) = 1 + (HALO_RIM_FACTOR − 1) × haloScale`, applied
to the bulb **as drawn**:

- **always ≥ 1** ⇒ the rim is outside the core at every setting, every fixture
  type, every model scale. A rim that can hide inside its own bulb is not a rim.
- **byte-identical to the historical look at the shipped default** (halo 1.0,
  pixel 1.0 ⇒ bulb × 1.8, exactly `p.haloSize`).
- **one knob, not a new one** — the same "Global Halo Size" the LED work
  established; the slider widens the rim instead of scaling an unrelated radius.
- still bounded by `_53`'s pixel-spacing ceiling for multi-pixel DMX fixtures, so
  a dense bar's rims may touch but can never smear it into a featureless strip.
- **LED-bus halos are untouched** — `ledHaloRadius()` still owns them, and the
  `_49` parity suite still passes unmodified.

`HALO_RIM_FACTOR` and the new helper live in **`led_halo.js`**, the one halo
recipe module, rather than in the fixture class.

At his settings a par's halo goes **0.98× → 1.48× its bulb**.

## 3. Perf gate — the operator's condition

Measured with `~/tmp/sim_fps_probe.cjs`: fresh browser per run (memory:
`sim_perf_per_object_explosion` + the fresh-window rule), **not** forced to
SwiftShader, adapter read back from `window.__gpuAdapter` and reported with
every number.

**Adapter: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU … D3D11)`,
`integrated: false`, `detectionFailed: false`, renderer mode `webgl`** — the
discrete GPU, so the numbers are valid for a perf claim.

**Object census — the structural question, and it is exact:**

| | before | after |
|---|---|---|
| scene objects | 1735 | **1735** |
| InstancedMesh | 292 | **292** |
| total instances | 3626 | **3626** |
| sprites / meshes | 224 / 891 | **224 / 891** |

**Zero** new scene-graph objects: the halo batch already existed for every
fixture, so the change is radii in a buffer that was already being written and
drawn. The only possible cost is additive fill.

**Frame rates.** Between-session numbers are noisy — the operator's own sim
window was open throughout (the sim's "2 sim windows connected" state), so
absolute FPS is contended:

| run | median | mean | min–max |
|---|---|---|---|
| before A | 45 | 40.9 | 1–50 |
| before B | 43 | 34.6 | 14–50 |
| **after** | **49** | **48.9** | 44–52 |

No regression — the after run is the fastest of the three. Because that
comparison is contaminated by contention drift, the decisive measurement is the
**controlled within-session A/B**: same window, same camera, same objects, only
the halo radii change.

| halo setting | rim multiple | median FPS |
|---|---|---|
| 0.1 (halo effectively off — rim 1.08×) | 1.08 | **30** |
| **0.6 (what he runs, what ships)** | **1.48** | **30** |
| 1.5 | 1.9 | 24 |
| 3.0 (≈5× beyond anything shipped) | 2.6 | 26 |

Going from "no visible halo" to "the halo he asked for" is **0 FPS**. Even a rim
2.6× the bulb costs ~4 FPS in a session whose own drift over the same minutes
was ±15 FPS (the return-to-0.6 control point read 27 with a 33→15 tail), so the
halo fill cost sits at or below the noise floor.

**Verdict: SHIP.** The condition "only if it's not hurting performance" is met.

## 4. Visual proof — inspected

`.agent_renders/1785443017_par_cans_3x_halo.png` (gitignored): the Left Center
Auditorium par row at 5.7 m. The cans read as a row of substantial emitters with
their dark bodies above them — each core measures ≈35 px at 1280×720, matching
the predicted 0.26 m bulb (0.039 × 3 × 1.1 × 2) exactly. Captured read-only
(`?readonly=1`), browser closed by the tool.

The frame again carries the sim's **"⚠ 2 sim windows connected — hardware output
contention risk"** banner (his window plus the capture, and `_72` is running
validation captures concurrently). This was the single authorized proof capture;
no further browser work was done after it.

## 5. Changes

- **`src/fixtures/fixture_model_scale.js`** — `UkingPar: 3.0` in the frozen
  table, with the reasoning inline.
- **`src/fixtures/led_halo.js`** — `HALO_RIM_FACTOR` moved here (it is a halo
  fact, not a fixture-class fact) plus `dmxHaloRimMultiple(haloScale)`, which
  **throws** on NaN/negative input.
- **`src/fixtures/dmx_fixture_runtime.js`** — the drawn bulb radius is computed
  once per pixel and the DMX halo is derived from it; `p.haloSize` stays as a
  descriptive physical value (documented as such, still read by the `_53`
  sizing harness).
- **`tests/dmx_halo_visibility.test.js`** (new, 6 tests) — the rim multiple's
  contract; **every DMX type at 5 slider settings must draw its halo strictly
  outside its bulb**; the par regression with his exact numbers; the dense-bar
  ceiling; LED-bus halos unchanged; and the perf-P0 guard that the halo is still
  exactly one InstancedMesh per fixture.
- **`tests/fixture_model_scale.test.js`** (+2) — the 3.0 floor guard and the par
  can's housing/bulb/no-clamp behaviour.

No writes to `scenes/**`, `marsin_engine/**`, model YAML, `pixel_map/**`,
`gui_builder.js`, or any file owned by `_71`/`_72`. No git operations, no saves,
no device HTTP, no server restarts.

## 6. Verification

- `node --check` on all five touched/added files — **PASS**
- `cd simulation && npm test` — **1222 / 1214 / 8**. The same 8 known
  stale-titanic-model failures, named and unchanged; **zero new**. (1176 at the
  start of this thread; +8 mine, the rest from agents landing concurrently.)
- Probe safety, every run: `?readonly=1` plus `window.__readonlyMode` pinned
  true through an accessor before any page script, `:6972` refused at the
  `WebSocket` constructor, every `:6970` request counted — **0 save-server
  writes** across all sessions. The halo sweep mutated **only the probe's own
  page** (in-memory params, never saved); the operator's window was never
  touched.

## 7. Notes

- The halo change is **global to the DMX bus**, not par-specific: bars and the
  vintage heads get a visible rim at his settings too, for the same reason.
- `size: 39` in the par model is consumed as a **radius** (0.039 world units),
  not a diameter, by the pre-existing `max(size × 0.001, 0.02)` rule. Left as-is
  — changing that would silently resize every fixture in the show — but worth
  knowing when reading the YAML.
- If he wants the pars bigger or smaller still, it is one number in
  `fixture_model_scale.js`; the floor-guard test moves with it.
