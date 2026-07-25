# 2026-07-24 — Render-loop perf root-cause on real GPU (Slice 1, bm_readiness)

Slice 1 of `20260724_0_mapping_readiness_review.md` (glitch **G1** / **G2**).
Investigator session. **No git ops, no source edits.** All measurement done
with throwaway puppeteer probes in `~/tmp/` (`gpu_perf_probe.cjs`,
`gpu_perf_probe2.cjs`) driving the **already-running** :6969 stack. The
`agent_render.cjs` path forces `--use-angle=swiftshader` (software GL); these
probes deliberately **omit** that flag to hit the real GPU, and drive the
native **WebGPU** backend (the operator's default when `navigator.gpu` exists,
`main.js:76`). Sim stack left running on standard ports 6969–6972 (it went down
mid-session and was restarted with `npm start`).

Measurement box: this Windows 11 machine, viewport 1600×900, `pixelRatio`
capped to 1.0 (`main.js:105`), Chrome 145, WebGPU backend.

---

## 0. TL;DR

- **The ~1 FPS in the review was a SwiftShader artifact, not the real number.**
  On this box's real GPU the `titanic` scene runs **20 FPS in the heavy visual
  profiles (`full`/`emissive`)** and **60 FPS (vsync-capped) in the mapping
  profiles (`pixel_mapping`/`edit`) and the default no-profile boot.**
- **The lag is CPU-bound draw submission, NOT GPU fragment cost and NOT the
  analytic spotlights.** At 20 FPS the JS main thread is ~100% saturated
  (4189 ms of profiled JS over a 4000 ms wall window).
- **Root cause: a draw-call explosion from non-instanced per-pixel DMX emitter
  geometry.** In `emitterMode:'pixel'` profiles every DMX pixel spawns its own
  `THREE.Mesh` bulb + halo (+ cone), pushing the scene to **~5,168 draw calls
  per frame**. three.js's WebGPU per-object submission
  (`writeBuffer`, `_projectObject`, `updateForRender`, `needsRenderUpdate`)
  scales with that object count and eats the frame.
- **The analytic SpotLights are exonerated by a controlled sweep:**
  `?spotlights=0`, `10`, `30`, `60` all render at **20 FPS with identical 5,168
  draws.** Turning the whole pool off changes nothing. The GPU has headroom.
- **Gating answer for the split-screen plan:** the *mapping* workflow's render
  loop is already **60 FPS** on real GPU, so split-screen is **not** blocked by
  the render loop — the mapping lag the operator feels is the **panel DOM
  rebuild (G2)**, a per-interaction jank, plus 20 FPS *only if they map/preview
  in the `full` profile*. The render-loop fix (instance the DMX emitters) and
  the panel fix are **independent** and can be scoped separately.

---

## 1. Measured FPS — software GL vs real GPU

| Profile (`?profile=`) | SwiftShader (review) | **Real GPU (WebGPU)** | draw calls | steady-state bound |
|---|---|---|---|---|
| `full` (emitter+analytic, "Heavy") | ~1.0 FPS | **20 FPS** (50 ms) | 5168 | CPU (main thread ~100%) |
| `emissive` (emitter, no analytic) | — | **20 FPS** | 5168 | CPU |
| `full` + `?spotlights=0` | — | **20 FPS** | 5168 | CPU |
| `full` + `?spotlights=10/30/60` | — | **20 FPS** (all) | 5168 | CPU |
| `pixel_mapping` (cones, no emitter) | — | **60 FPS** (16.7 ms) | 2684 | vsync (has idle) |
| `edit` (nothing) | — | **60 FPS** | 638 | vsync |
| default (no `?profile=`) | — | **60 FPS** | — | vsync |

`full` render stats: 1.33 M triangles, 616 geometries, 25 textures,
`info.render.calls` ~2.3k / `drawCalls` 5168 (the `drawCalls` figure includes
transparent-pass re-draws). Points 3000 (the instanced LED-dot batch = **1**
draw, cheap).

**Two independent controlled experiments both point away from the GPU/lights:**

1. **Spotlight sweep** (probe2): pool size 0→60 → **no FPS change, no draw
   change.** Forward analytic lights add per-fragment shader cost only, and the
   GPU isn't the bottleneck, so they're free here.
2. **Profile ladder**: the FPS cliff sits exactly between `pixel_mapping`
   (emitter `none`, 60 FPS / 2684 draws) and `emissive`/`full` (emitter
   `pixel`, 20 FPS / 5168 draws). The **only** render-flag that changes across
   that cliff is `emitterMode`. The +2484 draws = the per-pixel bulb + halo
   emitter meshes (~1,240 DMX pixels × 2 meshes).

---

## 2. Frame-time breakdown (CPU profile, `full`, real GPU)

CDP `Profiler` self-time, 4 s window, top contributors (all in
`three.webgpu.min.js` / `three.core.min.js` unless noted):

| Self-time % | Function | What it is |
|---|---|---|
| **22.9%** | `writeBuffer` (GPU device) | uploads per-object uniform/attribute buffers — **scales with draw/object count** |
| 8.9% | `updateForRender` | per-object render-graph node update |
| 6.0% | `updateMatrixWorld` | scene-graph transform propagation |
| 5.9% | `get` (node cache) | render-graph bookkeeping |
| 4.8% | `_projectObject` | per-object visibility/opaque-vs-transparent sort prep |
| 3.6% | `_renderObjectDirect` | per-object draw dispatch |
| 3.3% | `getForRender` | render-graph lookups |
| 3.0% | `intersectsObject` (`three.core`) | **a per-frame raycast** (minor; see §5) |
| 2.9% | `needsRenderUpdate` | per-object pipeline-state check |
| 2.7% | `setVertexBuffer` | per-draw GPU binding |
| 2.2% | `sort` | transparent/opaque render-list sort (grows with object count) |

Everything above is **per-object draw-submission or scene-graph traversal
cost** — it grows with the number of rendered meshes, i.e. the draw-call count,
**not** with light count. `writeBuffer` alone is ~957 ms (≈ 4.8 ms/frame at 20
FPS). Sum of JS self-time ≈ wall time ⇒ **CPU-bound**, GPU idle-waiting.

By contrast `pixel_mapping` (60 FPS) shows `(idle)` at 5.5% and no `writeBuffer`
in the top set — the main thread has slack.

---

## 3. Root cause with file:line

`simulation/src/fixtures/dmx_fixture_runtime.js` builds DMX-par pixel visuals as
**individual, non-instanced meshes**, gated on the profile's render flags:

- Emitter gate: `:240` `emitterMode === 'pixel'` → per pixel:
  - **bulb** `new THREE.Mesh(getCachedSphere(bulbSize), bulbMat)` — `:301`
  - **halo** `new THREE.Mesh(getCachedSphere(bulbSize*1.8), haloMat)` — `:328`
    (transparent, `depthTest:false` `:290` → forces its own transparent-pass
    draw, cannot batch)
- Cone gate: `:338` `coneMode === 'pixel'` → **beam**
  `new THREE.Mesh(baseBeamGeo, coneMat)` — `:347`
- Second build path (rebuild-on-profile-change) mirrors this at `:571`–`:806`.

Geometry is cached/shared (`_sphereCache` `:37`, good), **but each pixel still
gets its own `THREE.Mesh` = its own draw call.** For ~1,240 DMX pixels that is
~2,500 emitter draws on top of the cones — the 5,168 total.

**The fix template already exists in-repo:** LED strands render every pixel's
bulb + halo through a single per-strand **`InstancedMesh`**
(`simulation/src/fixtures/led_strand.js:14–18`, `pixelSphereGeo` +
instanced bulb/halo), which is why the 1,120 LED pixels cost **one** draw call
each strand and don't move the FPS needle. DMX pars never got that treatment.

**Classification of the operator's "laggy/slow":**
- (a) GPU-bound draw? **No** — GPU has headroom (lights free; 60 FPS in lighter
  profiles).
- (b) CPU-bound per-frame JS? **Yes** — three.js WebGPU draw-submission over
  ~5,000 objects saturates the main thread in the `full`/`emissive` profiles.
- (c) Panel DOM thrash? **Separate** — G2's `refreshControllerMapPanel`
  full-DOM rebuild (16–38 ms per click/keystroke, review §G2) is
  per-interaction jank, not steady-state FPS. On real GPU the mapping profiles
  are 60 FPS, so *this* is the dominant contributor to felt lag **while
  mapping**, provided the operator maps in a light profile.

So: a **mix**, but the steady-state render-loop cost is one thing (draw-call
count in emitter profiles) and the mapping-interaction lag is another (panel
rebuild). They do not share a root cause.

---

## 4. Recommended fixes (analysis only — not implemented)

| # | Fix | Addresses | Effort | Risk | Expected result |
|---|---|---|---|---|---|
| 1 | **Instance DMX-par emitters/halos/cones** — mirror `led_strand.js` `InstancedMesh` per fixture (or one global batch like the LED-dot `_pixelInstancedMesh` in `animate.js:185`). Per-pixel color moves to `instanceColor`. | render loop 20→~60 FPS in `full`/`emissive` (draws ~5168→~2700) | **1–2 d** | **Med** — per-pixel color writes must move to `setColorAt`/`instanceColor`; selection/isolation tint (`setUnpatchedRed`, `setSelected`) and the per-frame `fixture.update()` visual path (`animate.js:494`) must be reworked to index instances, not per-mesh materials. Pick a fixture-family at a time. | Highest-value render-loop fix; makes the heavy profile usable on this GPU |
| 2 | **Panel incremental render (G2)** — replace `bodyEl.replaceChildren()` full rebuild (`controller_map_editor.js:475`) with diffed/incremental updates; memoize `computeProjection`/LED projections per-mutation not per-render; rAF-batch `refreshControllerMapPanel`. | the felt mapping lag (per-interaction jank) | ~2 d | Med | Selection/edit no longer rebuilds DOM or reprojects; this is the real mapping-lag fix if mapping runs in a light profile |
| 3 | **Operator/default profile guidance** (zero code) — do mapping in `pixel_mapping`/`edit` (already 60 FPS). Only `full`/`emissive` are 20 FPS. Consider making the mapping UI force/suggest a light profile. | interim, no build | ~0 | Low | Immediate 60 FPS for the mapping task today |
| 4 | **Spotlight pool: DO NOT prioritize for FPS.** Proven not a bottleneck on real GPU. One real-but-minor issue: `_collectLightRequests` allocates fresh `THREE.Vector3`s per pixel every frame in `analyticLightMode:'pixel'` (`light_pool.js:465–489`) → GC pressure. Preallocate/scratch only if profiling a lighter box shows GC stalls. | GC hygiene | ~0.5 d | Low | Minor; deprioritize behind #1/#2 |

**Sequencing:** #3 today (free), then #2 (fixes felt mapping lag, unblocks
split-screen), then #1 (unblocks the heavy visual profile). #1 and #2 are
independent — the split-screen UI plan is **not** gated on #1 as long as
mapping happens in a light profile.

---

## 5. Caveats / honesty notes

- **Exact GPU adapter not captured** (backend reported as minified `dA` =
  WebGPU). Numbers are for *this* box at 1600×900 / dpr 1.0. Because the
  bottleneck is CPU draw-submission, FPS is roughly **resolution-insensitive**
  until the GPU becomes the limit — a larger monitor won't help `full`, and
  won't hurt `pixel_mapping` much either. Re-confirm on the operator's actual
  display if a hard budget is needed.
- **`intersectsObject` at 3%** in the `full` profile means *something raycasts
  every frame* (not on pointer events). Not chased to a file here — likely
  `TransformControls`/hover bookkeeping. Minor (~1.5 ms/frame); worth a glance
  during fix #1 but not a driver of the 20 FPS.
- **`window.params` is not exposed globally**, so the probe could not read the
  live `lightingProfile` name (shows `undefined` in `probe2_results.json`);
  profiles were pinned via `?profile=` in the URL instead, which is
  authoritative (`url_overrides.js:37`).
- **The sim stack went down mid-session** (cause unknown — the probes only
  launch/close their own browser; the node servers were untouched by them). It
  was restarted with `cd simulation && npm start` and is listening on
  6969–6972 again. If the operator had a specific engine/CaptainPad chain
  attached to the old stack, it will need re-attaching.
- Raw data: `~/tmp/gpu_perf_results.json` (full 6-config sweep + CPU profiles),
  `~/tmp/probe2_results.json` (spotlight isolation ladder).
