# 2026-07-24 — Emitter instancing: DMX par bulbs/halos/cones → InstancedMesh (Slice 6, bm_readiness)

Implementer session. Fixes the render-loop root cause from
`20260724_1_render_perf_root_cause.md` (fix #1). **No git ops, no commits.**
The tree carries other slices' uncommitted work — nothing reverted/cleaned. All
measurement via throwaway puppeteer probes in `~/tmp/` against the
already-running :6969 stack (never restarted).

---

## 0. TL;DR

- **Target hit.** On the real GPU (WebGPU), titanic goes from the documented
  **20 FPS → ~60 FPS** in both heavy emitter profiles:
  - `full`     : 20 → **59.5 FPS**
  - `emissive` : 20 → **59.9 FPS**
- Draw calls (`renderer.info.render.drawCalls`) in `full`: **5168 → 3413**.
  The bigger win is the **scene-graph object count**: the 84 DMX fixtures'
  ~2,668 per-pixel meshes collapse to **250 InstancedMeshes + 80 LED Sprites**.
  That per-object collapse is what tripled FPS — the report pinned the
  bottleneck on per-object traversal/submission (`_projectObject`,
  `updateMatrixWorld`, `updateForRender`, `writeBuffer`), all of which scale
  with object count, not raw draw calls.
- **Zero new console/page errors** on titanic in `full`, `emissive`,
  `pixel_mapping`. **293/293** sim unit tests pass. `scene_console_smoke`
  clean on titanic + test_bench.
- Visuals: bulbs/halos/cones rendered through the exact legacy material recipes
  (white material × `instanceColor` = the same pixel color). LED-bus fixtures
  keep their per-pixel Sprite halos + diffuser screen untouched. Selection /
  isolation unaffected (they never touched emitter meshes).

---

## 1. Root cause recap

`dmx_fixture_runtime.js` built each addressable pixel as its OWN `THREE.Mesh`:
a bulb sphere, a halo sphere (or LED Sprite), a beam cone, plus a redundant
"dot" sphere. ~667 DMX pixels on titanic × (bulb + halo + cone + dot) meshes →
a per-object explosion. The LED strands already used `InstancedMesh`
(`led_strand.js`) and cost ~1 draw/strand — the DMX pars never got that
treatment.

## 2. What changed

### `simulation/src/fixtures/dmx_fixture_runtime.js` (the bulk)
- **One `InstancedMesh` per fixture** for each emitter kind, mirroring
  `led_strand.js`:
  - `this.bulbInst` — unit sphere (`emitterSphereGeo`, module const), per-instance
    scale = `bulbSize × globalPixelScale`, material `depthTest:false` (legacy).
  - `this.haloInst` — unit sphere, additive BackSide rim, scale
    `bulbSize×1.8 × globalHaloScale`. **DMX fixtures only.**
  - `this.coneInst` — the shared `baseBeamGeo` unit cone, per-instance
    position + `(radius,radius,len)` scale from the fixture's beam angle.
  - Materials are white (`0xffffff`); the real per-pixel color rides in
    `instanceColor` (white × instanceColor = the pixel color, visually identical
    to the old per-material color).
- **Per-pixel color source of truth is now `p.color`** (`THREE.Color`), written
  by the new `_writePixelColor(i, r, g, b, includeCone)` which fans the color
  out to every instanced mesh's `setColorAt` (+ the LED Sprite material). All
  the public setters (`setColor`, `setBulbColor`, `_applyPixelColor` via
  `setPixelColorRGB`/`applyDmxFrame`) and the static-preview reset in
  `updateVisualsFromHitbox` route through it.
- **The redundant per-pixel "dot" meshes are dropped.** Each dot sat at its
  pixel's centroid with the same material and radius ≤ the bulb, so the bulb
  fully occluded it (provably invisible with the shared `depthTest:false`
  material). Removing them changes nothing on screen and removes ~667 meshes.
- New helpers `_rebuildBulbHaloMatrices()` / `_rebuildConeMatrices()` (re)write
  instance matrices; they run on build, on `updateVisualsFromHitbox` (cone
  angle), and on `updateScales` (global size sliders) — not per frame.
- `updateScales` no longer logs per call (sim_auto_checks item 3).
- `setVisibility` toggles whole-mesh `.visible` (the meshes only exist when the
  build-time profile enabled them; a render-flag change rebuilds the fixture).
- LED-bus (`bus: led`) fixtures keep **per-pixel Sprite halos** + the diffuser
  screen — the frosted look and per-fixture diffusion toggle are unchanged. The
  bulb + cone are still instanced. The screen paint now reads `p.color`.
- `destroy()` disposes the per-fixture InstancedMesh buffers + materials; the
  shared unit geometries (`emitterSphereGeo`, `baseBeamGeo`) are never disposed.

### Call sites (minimal)
- `simulation/src/core/light_pool.js` — the analytic-light request builder read
  each pixel's live color from `p.bulbMat.color`; now reads `p.color` (both the
  per-pixel and per-fixture paths). Only DmxFixtureRuntime pixels reach this
  code (FogMachine has no `.pixels`; ModelFixture is dead — `window.fixtureModels`
  is never assigned).
- `simulation/src/gui/gui_builder.js` — `_applyConeMaterialSettings` styled each
  `p.beam.material`; now styles the single per-fixture `f.coneInst.material`.

**Not touched:** `split_layout.js`, mapping/panel UI, `interaction.js` (emitters
were never raycast targets — picking is against the invisible `hitbox`, so it is
unaffected). `led_strand.js` left as-is (the instancing was mirrored inline in
the DMX runtime rather than sharing a helper, to keep the strand path low-risk).

## 3. Verification (real GPU, WebGPU, 1600×900, this box)

| Profile | Before (report §1) | **After** | drawCalls before→after | errors |
|---|---|---|---|---|
| `full` (emitter+analytic) | 20 FPS | **59.5 FPS** | 5168 → **3413** | 0 |
| `emissive` (emitter, no analytic) | 20 FPS | **59.9 FPS** | 5168 → **3413** | 0 |
| `pixel_mapping` (control, no emitter) | 60 FPS | **59.9 FPS** | 2684 → 2684 | 0 |

**FPS measured with a fresh browser per config** — a same-page renav hangs the
WebGPU context teardown, and leftover browser windows steal GPU (an early run
that left windows open read a contended 30 FPS; a clean single browser reads
~60). Probes: `~/tmp/inst_perf2.cjs`, `~/tmp/inst_census.cjs`,
`~/tmp/inst_fxcensus.cjs`; raw: `~/tmp/inst_census.log`.

**Fixture census (titanic/full, off `window.parFixtures`):**
`84 fixtures, 667 pixels` → `withBulbInst=84, withHaloInst=82, withConeInst=84`
(the 2 missing halo-instances are the 2 LED-bus `TeLedGrid40`, which use 80
Sprite halos instead) = **250 instanced emitter meshes + 80 Sprites**, versus
~1,334 bulb/halo + 667 cone + 667 dot meshes before.

**Remaining ~3413 drawCalls in `full`** are the ship model + environment
(`edit` baseline ≈ 638), the `effectsMode:'on'` bloom mip-chain passes, the
analytic spotlight pool, and the LED strands — all out of scope and unchanged.
The WebGPU `drawCalls` counter also folds in post/compute passes, so it moves
less than the raw mesh reduction; the FPS is the load-bearing number.

**Tests / smoke:**
- `npm run check` (sim unit): **293 pass / 0 fail** (baseline 284; more now, all
  green).
- `scene_console_smoke.cjs titanic` and `test_bench`: clean (only the
  pre-existing :6968 engine-down 404 noise).
- `git diff --check -- simulation`: clean.
- `node --check` on all changed files: pass.

**Visual A/B:** titanic/`full` rendered (SwiftShader, 1280×720) at three views —
`inst_full_front.png`, `inst_full_dramatic.png`, `inst_full_led_grid_close.png`
in `.agent_renders/`. Inspected:
- DMX pars render as crisp **red** emitter bulbs (not white → `instanceColor` is
  driving per-pixel color, not the white material), with the additive halo bloom
  and the cone/analytic red spill on the ground — the legacy look.
- The 2 LED-bus `TeLedGrid40` fixtures keep their soft frosted diffuser-screen +
  Sprite-halo panel (center of the led-grid view) — unchanged.
- No white blowout, no missing emitters, no geometry gaps. A true byte-diff vs
  the pre-change build wasn't possible (needs git ops on a dirty shared tree);
  the result matches the documented recipe.

**Pick accuracy:** `pick_accuracy_test.cjs` → **2/2 targets split-invariant**
across 4 pane widths. Emitters were never raycast targets (picking hits the
invisible `hitbox`), so instancing them left selection untouched. Also verified
`test_bench`/`full` builds emitters clean (0 code errors, 8/10 fixtures
instanced; the other 2 are fog / no-emitter).

## 4. Honesty notes / gaps

- **No true before/after pixel-diff.** A byte-level before/after would need the
  pre-change code, which means git ops on a shared, dirty tree — out of bounds
  this session. "Before" visuals are the documented recipe; "after" is the
  rendered result, inspected against it.
- **Dead `fixture_representative` / `fixture` (cone) profile modes** are
  preserved (single visible instance at the centroid via zero-scaled matrices)
  but untested — no registry profile uses them.
- **No-pixel-def fallback fixtures** (unregistered types) now render their single
  bulb/halo through the instanced path with the legacy 0.5/0.8 radii, and honour
  `globalPixelScale`; the old fallback ignored global scale and always drew a
  cone regardless of `coneMode`. Titanic has no such fixtures.
- `emissive` / `pixel_map` occasionally timed out on a *same-page* renav (WebGPU
  teardown) — a probe artifact, not a page fault; fresh-browser runs are clean.
