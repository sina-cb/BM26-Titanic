# 20260725_74 — "Only Left Front Rails": the scene-wide dot mesh never saw the render scale

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (3D render path only)
**Order (operator, verbatim, with a screenshot):**
*"the vintage lights are still bad… funny thing, it's only Left Front Rails so I
think it might be a lingering cache somewhere, try to regenerate the instances
quickly and let me check."*

This was commissioned as a **cold review** — read the code, form an independent
picture, treat prior reports as context and not as conclusions. It ends up
**contradicting `_68`'s addendum**, and the correction is stated plainly below.

## TL;DR

There is no cache, and it is not brightness. There are **two** emitter layers
drawn over every pixel in this sim, and only one of them was fixed:

1. **Per-fixture** instanced bulb/halo, built by `DmxFixtureRuntime`. `_68`
   scaled this correctly. A live probe measured all 16 vintage fixtures
   identical. All true.
2. **Scene-wide** instanced-dot mesh in `animate.js` — ONE `InstancedMesh` over
   every pixel in the whole show (971 instances on titanic). It placed and sized
   its dots from the pixel map's **PHYSICAL** `x/y/z` + `pixelSize`. It never
   saw `fixture_model_scale.js` at all.

Layer 2 draws every **unpatched** pixel black (or flat red under the
unpatched-red overlay) and only a **patched** pixel in its live colour. So the
pre-scale dots were visible on exactly the patched fixtures — the **Left Front
Rails, the only patched vintage run in the scene** — and invisible everywhere
else. That is the entire asymmetry the operator spotted. Every vintage
fixture's dots were wrong; only four of them were lit.

In the `pixel_mapping` profile the per-fixture emitters are **not built at all**
(`emitterMode: 'none'`, verified live: `per-fixture emitters built=false`), so
layer 2 is the *only* emitter on screen and `_68`'s whole 2.5× was invisible.

| | before | after |
|---|---|---|
| dot position | physical `localPos` → six heads over **375 mm** | drawn `renderPos` → **937 mm**, filling the 1150 mm housing |
| dot radius (vintage head @ Global Pixel Size 1.1) | 18 mm × 1.1 = **0.0198** | 18 mm × **2.5** × 1.1 = **0.0495** |
| dot radius (UKing par head @ 1.1) | 39 mm × 1.1 = **0.0429** | 39 mm × **3.0** × 1.1 = **0.1287** |

## Reading the operator's screenshot against the code

Every element in his frame is now accounted for:

| in the screenshot | what it is |
|---|---|
| small yellow-green dots at one end of a big dark housing | layer-2 dots at **physical** spacing (375 mm of heads inside a 2.5×-scaled 1150 mm housing) and **physical** size |
| the rest of that housing dark/void | there is nothing to draw there — the heads never reached that far |
| large red hexagonal blobs | UKing par **shells** at the new 3.0× under the unpatched-red overlay (`setUnpatchedRed`), 16-segment cylinders |
| thin dotted red LED strings | layer-2 dots for **unpatched** strand pixels, forced to `(0.8, 0, 0)` by the overlay branch in the colour flush |
| one more red-glowing vintage-ish fixture behind the railing | an **unpatched** vintage fixture — its six dots take the same overlay red |

The par blobs also confirm the operator's browser was running the newest code, so
"stale browser" was correctly ruled out.

## Hypotheses tested

**Prime (from the coordinator): the driven per-frame path rebuilds bulb matrices
from physical sizes, clobbering patched fixtures on their first live frame.**
**KILLED.** The driven chain is
`applyDmxFrame → setPixelColorRGB → _applyPixelColor → _writePixelColor`, and
`_writePixelColor` touches `instanceColor` only. `_rebuildBulbHaloMatrices` is
called from exactly two places — the constructor and `updateScales()` (a global
slider move). Nothing per-frame writes a matrix. Pinned by a new test so it
stays killed.

**A lingering geometry cache keyed before the scale change.** **KILLED.** The
only per-fixture cache is `_minPixelPitch`, computed at construction from
`renderPos` (already scaled). Shared geometry is a **unit** sphere
(`emitterSphereGeo`) — every size lives in an instance matrix, so no cached
geometry can carry an old size. There is a batch cache in `animate.js`, but it
is rebuilt on `invalidateMarsinBatchCache` and, crucially, it was rebuilding
**correctly wrong**: it read the physical fields every time.

**Scene-level per-fixture overrides on those four fixtures.** **KILLED.**
`scenes/titanic/scene_config.yaml` (read only, zero writes) shows the four
`Left Front Rails` entries structurally identical to the other three rail
groups — same `fixtureType`, colour, intensity, angle, generator. Their only
distinguishing property is in `patches.yaml`: universe 23, addresses 1/34/67/100
on controller `10.1.1.x`, the **only** patched vintage fixtures in the scene.

**A different construction path for patched fixtures.** **KILLED.** All 16 go
through `parLights → _buildFixtureAt → DmxFixtureRuntime`; the legacy
`ModelFixture` branch is only reachable via `params.dmxFixtures`, which no
shipped scene uses. Patching plays no part in construction.

## Correction to `_68`'s addendum

`_68`'s addendum concluded the "Left Front Rails 4 still small" observation was
**"brightness, not size"**, on the strength of a live probe finding all 16
vintage fixtures drawn identically (scale 2.5, bulb radius 0.055, pitch 0.1875).

That probe was **accurate and its measurements still stand** — but it measured
`fixture.bulbInst`, i.e. **layer 1 only**, at construction time. Layer 2 is not
reachable from a fixture object (`_pixelInstancedMesh` is module-private in
`animate.js`, parented directly to the scene), so nothing in that probe could
have seen it. The conclusion drawn from it was therefore too strong: the
fixtures *were* identical, and they were *all* wrong on the layer the operator
was actually looking at. It is a size bug after all.

The same note is embedded in `tests/fixture_model_scale.test.js`; that comment
is now superseded by this report and by the new test file.

## The fix

The invariant from `_68` — **drawn sizes everywhere in the render path, physical
only for exports and the light pool** — was correct; it just had not been
carried into `animate.js`.

**`simulation/src/dmx/pixelblaze_model_exporter.js`** — every pixel now carries
its **drawn** geometry beside its physical geometry:

- `rx / ry / rz` — `localPos × renderScale` through the fixture's world matrix
  (the same product `DmxFixtureRuntime` stores as `renderPos`);
- `renderScale` — from `fixtureModelScale(fixture.fixtureDef)`, the one table
  that owns per-type exaggeration, so the exported drawn geometry cannot drift
  from what is drawn.

`x / y / z` and `pixelSize` are **unchanged and still physical** — the engine
model, sACN patching, the normalized `_batchCoords` handed to the engine, the
2D Pixel Map layout and the analytic light pool all sample those. The new fields
are **runtime-only**: they are not in `saveModelJS`'s field list, so the exported
Pixelblaze model is byte-identical.

**`simulation/src/core/pixel_dot_geometry.js`** (new) — the one place that
answers *"where and how big is this pixel's dot drawn"*. `dotDrawnRadius()` and
`writeDotMatrix()` read the drawn fields, and both **throw** if handed
physical-only data: a future regression fails loud instead of quietly going back
to physical sizes (codex P0).

**`simulation/src/core/animate.js`** — all **three** dot writers (cache build,
the global-pixel-scale slider hook, the per-frame flush that runs while
isolating a view) now go through those two helpers. They were three independent
copies of the same recipe; that is how one could have drifted anyway.

`simulation/src/fixtures/model_fixture.js` is untouched: it renders 1:1 and
carries no `fixtureDef`, so it correctly reports `renderScale = 1`.

**Not changed, deliberately:** the pitch ceiling is not applied to layer-2 dots.
That is pre-existing behaviour, unrelated to this bug, and touching it would
change every fixture's dots at high slider values. Also unchanged: `localPos`,
the light pool sampling point, and every LED-strand path (strands carry no
fixture type, so drawn === physical and their entries are byte-identical).

## Proof

`simulation/agent_tools/patched_dot_scale_capture.cjs` (new) — a
**readonly-guarded** before/after capture in the `pixel_mapping` profile, where
layer 2 is the only emitter. It reuses the four guards from
`vintage_sizing_capture.cjs`: `__readonlyMode` forced true as an accessor before
any page script runs, the sACN-OUT socket (`:6972`) refused at the `WebSocket`
constructor, every save-server request counted with a loud failure on any
non-GET, and no GUI controller or param ever written. "Before" is produced by
writing the **pre-fix recipe** into the live instance buffer in-page (physical
position, physical size × slider) — no source revert, nothing on disk;
`window.updatePixelInstancedScale()` restores the shipped geometry.

Run against the operator's running stack. Guard results: **0 sACN-OUT enables,
0 save-server requests**, geometry restored. Live facts confirmed in the same
pass: 16 vintage fixtures, **4 patched**, `_patchesActive=true`,
`per-fixture emitters built=false`, dot mesh 971 instances, Global Pixel Size 1.1.

Captures in `~/tmp/patched_dot_scale/` (outside the repo):

| file | what it shows |
|---|---|
| `before_prefix_dots.png` | six **tiny** dots huddled over the top third of a large dark housing — a near pixel-for-pixel match for the operator's screenshot |
| `after_fixed_dots.png` | six **full-size** dots spanning the whole housing |
| `after_restored.png` | the shipped geometry back after the in-page revert |

FPS in the capture is meaningless (SwiftShader software GL, contending with the
operator's own sim) and no performance claim is made from it. **No scene-graph
objects were added** — the dot mesh's instance count and geometry are unchanged;
only the numbers written into existing instance matrices differ.

## Tests

New: `simulation/tests/patched_fixture_dot_scale.test.js` (**+8 tests**),
extending the `_68` floor-guard family:

- a live 33-channel DMX frame (heads 1–4 lit, 5–6 dark — the screenshot's own
  pattern) plus `setColor` and `setPixelColorRGB` leave **every** bulb and halo
  instance matrix byte-identical, while the colours demonstrably change — the
  prime hypothesis, pinned dead;
- `dotDrawnRadius` clears the operator's floors (**2.5×** vintage, **3.0×** par)
  and keeps the 14 mm default for strand LEDs;
- `dotDrawnRadius` / `writeDotMatrix` **throw** on physical-only entries — no
  silent fallback;
- `writeDotMatrix` places the instance at `rx/ry/rz` when the physical and drawn
  positions deliberately disagree;
- a real `DmxFixtureRuntime` at a rail-like rotated pose exports physical
  `x/y/z` unchanged **and** drawn `rx/ry/rz` matching its own `renderPos`, with
  the drawn head span exactly 2.5× the physical;
- the par reports 3.0, an unscaled type (`ShehdsBar`) reports 1 with
  `rx === x`, and LED strand pixels report 1 with `rx === x`;
- end to end: real fixture → real pixel map → real dot recipe, every head's dot
  clearing the floor **and** landing on its fixture's drawn emitter.

**Suite: 1232 / 1224 / 8** (was 1224 / 1216 / 8). +8 tests, **zero new
failures** — the 8 are the same known stale-model / scene-parity failures.
`node --check` clean on every touched file.

## What the operator does to see it

**Hard-reload the sim tab.** That rebuilds the pixel map and every instance —
which is exactly the "regenerate the instances" he asked for. There is no
runtime cache that survives a reload: the batch cache and the dot mesh are both
rebuilt from `generatePixelMap()` on load, and the per-fixture meshes are
rebuilt with the fixtures. His live session was not touched by this work.

Watch the **Left Front Rails**: their heads should now fill their housings at
the same size as the unpatched vintage fixtures beside them, instead of sitting
as small dots at one end.

## Files

- `simulation/src/core/pixel_dot_geometry.js` (new)
- `simulation/src/core/animate.js`
- `simulation/src/dmx/pixelblaze_model_exporter.js`
- `simulation/tests/patched_fixture_dot_scale.test.js` (new)
- `simulation/agent_tools/patched_dot_scale_capture.cjs` (new)
