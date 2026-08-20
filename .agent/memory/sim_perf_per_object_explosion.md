---
name: sim-perf-per-object-explosion
description: WebGPU sim perf is killed by scene-graph OBJECT COUNT, not draw calls or pixel count — per-pixel meshes must be InstancedMesh; single color-write path also made LEDs visibly more vivid.
type: lesson
created: 2026-07-24
updated: 2026-07-24
---

**What was wrong (2026-07-24, report `20260724_6`):** every addressable
pixel of the 84 DMX fixtures was its own `THREE.Mesh` × 4 (bulb + halo +
cone + a provably-invisible redundant "dot") ≈ 2,668 objects. The cost
was per-object traversal/matrixWorld/submission (`_projectObject`,
`updateMatrixWorld`, `writeBuffer`) — it scales with OBJECT COUNT, not
raw draw calls or pixels. Titanic was pinned at 20 FPS. The LED strands
were already instanced and cheap; the DMX pars never got the treatment.

**The fix:** one `InstancedMesh` per fixture per emitter kind, white
material × per-instance `instanceColor` = the pixel color; delete
invisible geometry outright. 2,668 meshes → 250 InstancedMesh + 80
Sprites; 20 → ~60 FPS (`full` and `emissive`), zero visual regressions.

**Bonus observation (operator: "colors much more vivid… maybe I am
biased or because frame rate is better, it looks smoother, but it looks
amazing"):** the perceived color improvement is most plausibly the
locked 60 FPS itself — additive halo bloom compositing on every frame
instead of on starved, stuttering ones. A real contributing hygiene fix:
ALL per-pixel color writes now route through ONE function
(`_writePixelColor` fanning to bulb/halo/cone/sprite together), where
the old scattered setters could leave parts stale/mismatched. Keep the
single color source of truth regardless — it prevents inconsistency
even if the vividness was mostly framerate perception.

**How to apply:**
- Any per-pixel/per-emitter visual in the sim MUST use instancing
  (mirror `led_strand.js` / `dmx_fixture_runtime.js`); never one Mesh
  per pixel. Suspect object count first when FPS tanks.
- Keep exactly one write path for per-pixel color; new emitter parts
  hook into `_writePixelColor`, never a parallel setter.
- Measure FPS with a FRESH browser per config — leftover windows steal
  GPU (a dirty run read 30 FPS where clean reads 60); same-page renav
  hangs WebGPU teardown.

Related: [[bm-readiness-thread-tracker]].
