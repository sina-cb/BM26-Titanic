# 14 - Lighting Optimization Brainstorm

**Date:** 2026-04-17  
**Status:** Brainstorming / options catalog  
**Priority:** Not prioritized yet  
**Scope:** BM26 Titanic browser/Electron simulation lighting performance, WebGPU renderer stability, and long-term paths for realistic fixture visualization at high FPS.

---

## 1. Purpose

This document collects long-term lighting optimization ideas for the Titanic simulation.

It is intentionally **not a prioritized roadmap yet**. The goal is to capture the best architectural options and tradeoffs before choosing an implementation sequence.

The immediate problem that motivated this document:

- Lite Mode on: fixtures are mostly visual/emissive and the simulation is more stable.
- Lite Mode off: every DMX fixture creates a real `THREE.SpotLight`, and WebGPU can eventually lose the device in Electron.
- The target visual design wants many visible light sources, realistic glow, beams, fixture color, and convincing illumination without a large FPS drop.

The important distinction:

- Thousands of **visible LEDs/glow sources** are reasonable.
- Thousands of **real dynamic analytic lights affecting scene materials** are not reasonable with stock Three.js lighting.

---

## 2. Current Observed Lighting Model

Current renderer setup:

- `simulation/main.js` uses `THREE.WebGPURenderer`.
- WebGPU postprocessing bloom is enabled through TSL/node postprocessing.
- Renderer uses ACES tone mapping.
- Renderer currently uses MSAA if `antialias: true`.
- Renderer currently caps DPR at `Math.min(window.devicePixelRatio, 2)`, which can mean 4x pixel count on high-DPI displays.

Current fixture lighting behavior:

- `simulation/src/fixtures/dmx_fixture_runtime.js` creates one fixture-level `THREE.SpotLight` when Lite Mode is disabled.
- Lite Mode skips those `SpotLight` objects and keeps visual fixture meshes, bulbs, halos, and additive beam cones.
- The current Titanic scene has 87 DMX fixtures.
- Those fixtures expand to hundreds of logical pixels and thousands of small visual dot meshes.
- The visual LED count and mesh count are not the same thing as real scene lights.

Current likely bottlenecks:

- Too many real `SpotLight` evaluations against the ship, ground, icebergs, and standard materials.
- High render resolution from DPR.
- MSAA plus bloom/postprocessing bandwidth.
- Many separate mesh/material objects for dots, bulbs, halos, and cones.
- Fixture rebuilds may leave GPU resources alive unless every geometry/material in the fixture group is disposed.
- Electron flags can push the GPU harder than needed, especially uncapped frame rate.

---

## 3. Design Goals

The long-term renderer should support:

- Realistic nighttime lighting impression from many fixtures.
- High FPS in Electron on the target show machine.
- Stable WebGPU device behavior over long sessions.
- DMX/sACN driven color updates at show cadence.
- Visually dense LED hardware representation.
- Beam cones and glow that look like stage lighting.
- A small number of high-quality real lights where they matter most.
- Graceful degradation when GPU load rises.

Non-goals for the default path:

- Thousands of shadow-casting lights.
- Thousands of stock Three.js `SpotLight` objects.
- Physically exact global illumination for every LED.
- Perfect illumination from every LED onto every triangle.

---

## 4. Recommended Mental Model

Separate fixture rendering into four layers:

1. **Emitter layer**
   - The LED face, bulb, strip, or lens.
   - Should be emissive or basic material.
   - Should be cheap and scalable.

2. **Glow layer**
   - Bloom, halo sprites, billboard quads, or low-poly transparent shells.
   - Makes lights feel bright without requiring actual illumination.

3. **Beam layer**
   - Additive cones, volumetric impostors, or beam meshes.
   - Suggests direction, intensity, and atmosphere.

4. **Illumination layer**
   - Real lights or custom shading that actually affect ship/ground/iceberg materials.
   - This should be heavily budgeted.

The main optimization principle:

> Use cheap emitter/glow/beam rendering for most fixtures, and reserve real illumination for a small adaptive subset.

---

## 5. Option A - Hybrid Hero Lights

Use Lite Mode style rendering for all fixtures, but allow a limited number of real lights at once.

### Concept

Keep every fixture visible through:

- emissive pixels
- additive beams
- bloom
- halos

Then select a limited set of "hero" fixtures that also create real `SpotLight` objects.

Possible hero selection rules:

- Nearest fixtures to the camera.
- Brightest fixtures by DMX dimmer/intensity.
- Fixtures currently aimed at visible ship/ground/iceberg areas.
- User-pinned key fixtures.
- Section-based caps, such as 4 lights per major ship region.
- Camera-frustum visible lights only.

### Example Budgets

Suggested budgets to test:

| Quality Level | Real Fixture SpotLights | Shadows |
|---|---:|---:|
| Performance | 8-16 | 0 |
| Balanced | 16-32 | 0-1 key shadow |
| High | 32-48 | 1-2 key shadows |
| Screenshot | 64+ | optional, not for live FPS |

### Required Systems

- `LightBudgetManager`
- Stable fixture scoring function
- Hysteresis to prevent popping
- Real light object pool
- GUI controls for budget and mode
- Debug overlay showing active real lights

### Pros

- Best near-term long-term architecture.
- Preserves the current Three.js material path.
- Does not require custom clustered lighting shaders.
- Easy to reason about.
- Keeps compatibility with current fixture classes.

### Cons

- Not every fixture truly illuminates the ship.
- Needs good scoring to avoid obvious missing light.
- Can pop if hero light assignment changes too often.

### Best Use

This is the best fit for realistic live simulation with manageable engineering risk.

---

## 6. Option B - Instanced Emitters, Halos, Dots, and Beams

Replace thousands of separate Mesh objects with instanced draw calls.

### Concept

Current fixture visuals create many separate meshes/materials:

- dot meshes
- bulb meshes
- halo meshes
- beam meshes
- fixture shell meshes

For many repeated objects, use `THREE.InstancedMesh` or a custom instanced buffer approach.

Candidate instance groups:

- UkingPar LED dots
- ShehdsBar pixels
- VintageLed decorative dots
- bulb spheres
- halo spheres or billboard quads
- beam cones
- small fixture shells if geometry is shared

Per-instance attributes:

- transform matrix
- color
- intensity
- size
- cone angle
- cone length
- visibility flag or alpha

### Pros

- Large CPU and GPU draw-call reduction.
- Makes thousands of visible LEDs practical.
- Works well with Lite Mode.
- Still compatible with bloom.

### Cons

- More complex selection/editing because individual meshes are no longer individual objects.
- Requires mapping fixture/pixel index to instance index.
- Requires careful update buffers for DMX colors.

### Best Use

This is one of the best long-term optimizations for the visual layer. It does not solve real illumination, but it makes the visible hardware and beams much cheaper.

---

## 7. Option C - Light Budget Manager With Object Pooling

Avoid destroying and recreating real lights during mode changes or quality changes.

### Concept

Maintain a fixed pool of `SpotLight` objects:

- Create N lights once.
- Reassign them to the current hero fixtures.
- Hide unused lights.
- Update position, target, color, angle, intensity, and distance.

This avoids repeated allocation, shader/material churn, and possible GPU resource fragmentation.

### Pros

- Stabilizes Lite Off style experiments.
- Reduces rebuild cost.
- Pairs naturally with hybrid hero lights.
- Helps avoid device loss from repeated heavy rebuilds.

### Cons

- Requires refactoring fixture ownership.
- Fixtures no longer own their real light directly.
- Need robust cleanup and state sync.

### Best Use

Strong companion to Option A. The real lights should be managed globally, not inside every fixture.

---

## 8. Option D - Deferred or Clustered WebGPU Lighting

Implement a custom lighting pipeline that can evaluate many lights efficiently on the GPU.

### Concept

Stock Three.js lighting is not designed for thousands of dynamic lights. A scalable many-light renderer usually uses one of these:

- clustered forward lighting
- tiled forward+ lighting
- deferred lighting

In WebGPU, light data can be stored in GPU storage buffers. A compute pass can assign lights to screen tiles or 3D clusters. The material shader then evaluates only the relevant lights for each pixel.

### Possible Pipeline

1. Build GPU buffers for all lights:
   - position
   - direction
   - color
   - intensity
   - range
   - angle
   - type

2. Divide camera space into clusters:
   - x/y screen tile
   - z depth slice

3. Compute pass:
   - assign lights to clusters
   - write compact light index lists

4. Material pass:
   - find fragment cluster
   - evaluate only lights in that cluster

5. Optional:
   - separate pass for beams/glow
   - shadows only for a few hero lights

### Pros

- The real path for hundreds or thousands of dynamic analytical lights.
- Uses WebGPU where it actually helps.
- Can support 2,000+ small unshadowed lights if engineered carefully.

### Cons

- Major renderer architecture project.
- Stock `MeshStandardMaterial` will not automatically participate.
- Requires custom TSL/WGSL materials or a deeper Three.js WebGPU integration.
- Harder to debug.
- Shadows remain expensive.
- May diverge from normal Three.js APIs.

### Best Use

Best if the simulation eventually needs true many-light illumination as a core feature. Not the fastest path to visual improvement.

---

## 9. Option E - Screen-Space Light Accumulation

Approximate many lights as a postprocess rather than real scene lighting.

### Concept

Render the base scene normally. Then use screen-space passes to add glow and local color bleed around projected light positions.

Possible effects:

- projected light sprites
- screen-space additive flares
- depth-aware radial glow
- cone-shaped screen-space beams
- approximate surface tint near bright lights

This does not physically light geometry, but can look convincing in a dark theatrical scene.

### Pros

- Much cheaper than true many-light shading.
- Pairs well with bloom.
- Can scale to many emitters.
- Good for the "bright LEDs in darkness" aesthetic.

### Cons

- Screen-space artifacts.
- Light disappears or changes when offscreen.
- Does not properly wrap around geometry.
- Needs depth awareness to avoid glow bleeding through the ship.

### Best Use

Good for atmosphere, glow, and perceived brightness. Not a replacement for hero lights.

---

## 10. Option F - Baked and Probe-Based Ambient Lighting

Use precomputed or slowly updated lighting to improve realism without many dynamic lights.

### Concept

Most of the ship material can receive:

- a static nighttime base lightmap
- ambient occlusion
- simple gradient lighting
- probe/grid lighting
- section-based color wash

Dynamic fixtures then add mostly emissive/glow/beam effects plus a few hero lights.

Possible approaches:

- Bake AO/lightmap for the Titanic FBX externally.
- Use vertex colors for broad warm/cool zones.
- Add simple projected color washes per ship section.
- Use low-resolution 3D light probes updated at low frequency.

### Pros

- Makes the ship look more realistic at low runtime cost.
- Reduces need for hundreds of real lights.
- Can improve depth and contrast even in Lite Mode.

### Cons

- Requires asset pipeline work.
- Static lighting cannot match every live pattern.
- FBX/material setup must preserve UVs or vertex color data.

### Best Use

Excellent visual multiplier for the base scene. Especially valuable if the ship currently looks flat in Lite Mode.

---

## 11. Option G - Section-Based Proxy Lights

Represent groups of fixtures with a small number of aggregate lights.

### Concept

Instead of one real light per fixture, compute aggregate light state by group:

- wall generators
- chimney generators
- deck generators
- iceberg floods
- ship side sections

Each group drives one or a few proxy lights.

For example:

- 20 back wall fixtures become 2-4 broad wash lights.
- 10 front wall bar fixtures become 2 rectangular/spot proxies.
- deck fixtures become a small warm fill group.

The individual fixtures still show their exact DMX colors through emitters and beams.

### Pros

- Very cheap.
- Stable.
- Good for broad visible illumination.
- Aligns with how audiences perceive grouped stage lighting.

### Cons

- Less accurate for individual fixture illumination.
- Requires group metadata and tuning.
- Color aggregation can look wrong if nearby fixtures have very different colors.

### Best Use

Very strong practical option for the Titanic scene because the scene already has fixture groups and procedural generator names.

---

## 12. Option H - Custom Fixture Beam Material

Improve beam realism without real lights.

### Concept

Current beams are additive cone meshes. These can become more realistic with custom shader logic:

- soft edge falloff
- distance fade
- angle falloff
- noise/fog modulation
- camera-facing density correction
- depth fade near geometry
- optional gobo/IES-like profile texture

This can make Lite Mode look much more like real lighting without illuminating the ship.

### Pros

- High visual payoff for stage-light simulation.
- Cheaper than real lights.
- Works for thousands of beams if instanced.
- Tunable per fixture type.

### Cons

- Transparent sorting can be tricky.
- Many large transparent cones can still be fill-rate heavy.
- Needs shader work.

### Best Use

One of the best quality upgrades for Lite Mode.

---

## 13. Option I - Adaptive Quality Controller

Automatically lower expensive settings when frame time rises.

### Concept

Measure GPU/CPU frame time and adjust quality:

- DPR
- bloom strength or resolution
- beam visibility distance
- number of hero lights
- shadow count
- max visible fixture detail
- update rate for non-critical buffers

Example quality knobs:

| Knob | Expensive Direction | Cheap Direction |
|---|---|---|
| DPR | 1.5-2.0 | 1.0 |
| MSAA | on | off |
| hero lights | 48 | 12 |
| bloom | full res/high radius | lower radius/threshold |
| beams | all visible | frustum/distance culled |
| dot geometry | all meshes | instanced or LOD |

### Pros

- Protects long-running sessions.
- Helps avoid WebGPU device loss from overload.
- Lets screenshot mode and live mode share the same code.

### Cons

- Requires good metrics.
- Bad thresholds can cause visible quality pumping.
- Needs UI transparency so the operator knows quality changed.

### Best Use

Best once the core lighting architecture is stable.

---

## 14. Option J - Dedicated Render Profiles

Define explicit lighting profiles instead of one global Lite Mode.

### Possible Profiles

**Editor**

- DPR 1.0
- no real fixture lights
- no heavy bloom
- flat/edit material optional
- helpers visible

**Live Performance**

- DPR 1.0 or 1.25
- instanced emitters/beams
- bloom on
- 16-32 hero lights
- no fixture shadows
- one moon/key shadow at most

**High Quality Preview**

- DPR 1.25 or 1.5
- 32-48 hero lights
- higher bloom
- stronger beam materials
- optional proxy group lights

**Screenshot / Render**

- DPR 2.0
- more hero lights
- optional shadows
- no real-time FPS requirement

### Pros

- Clear operator expectations.
- Easier testing.
- Avoids one toggle carrying too much meaning.

### Cons

- More UI state.
- Needs robust profile persistence.

### Best Use

Good product/UX layer over the technical options.

---

## 15. Resource Management Fixes

Any long-term optimization should include strict GPU resource lifecycle management.

Current risk:

- Destroying a fixture removes groups and some materials, but may not dispose every geometry/material created under the fixture group.
- Repeated rebuilds can leave GPU resources around until browser cleanup.

Recommended cleanup pattern:

```javascript
function disposeObject3D(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose());
      } else {
        obj.material.dispose();
      }
    }
  });
}
```

Additional lifecycle recommendations:

- Reuse shared geometries aggressively.
- Avoid cloning materials per LED when a per-instance color buffer can work.
- Pool real light objects.
- Pool temporary vectors where hot.
- Avoid rebuilds for simple color/intensity changes.
- Separate topology changes from live DMX frame changes.

---

## 16. Renderer Settings to Treat as Quality Knobs

These should become explicit renderer quality settings:

- `antialias`
- MSAA sample count
- `renderer.setPixelRatio`
- bloom enabled
- bloom strength/radius/threshold
- bloom internal resolution, if exposed
- shadow map enabled
- shadow map size
- fog density
- max hero lights
- max beam draw distance
- max visible detail for fixture dots

Suggested live defaults to test:

```javascript
const renderer = new THREE.WebGPURenderer({
  antialias: false,
  samples: 1,
  powerPreference: "high-performance",
});

renderer.setPixelRatio(1);
```

Suggested higher-quality preview:

```javascript
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
```

Avoid defaulting live mode to DPR 2.0.

---

## 17. Bloom Wiring Notes

Bloom should be treated as part of the lighting system, not an isolated postprocess.

Current important behavior:

- GUI controls exist for bloom strength, radius, and threshold.
- The controls update WebGPU uniforms through `window._bloomParams`.
- Initial uniform values should be initialized from `params.bloomStrength`, `params.bloomRadius`, and `params.bloomThreshold` so the GUI matches actual render state immediately after load.

Recommended conceptual controls:

- Bloom enabled
- Bloom strength
- Bloom radius
- Bloom threshold
- Bloom quality scale
- Emitter intensity scale
- Beam intensity scale

The realistic glow target should usually come from:

- brighter emissive/basic emitters
- bloom threshold tuned to catch those emitters
- moderate bloom radius
- not from hundreds of real lights

---

## 18. Observability and Debugging

The lighting system needs instrumentation before major optimization.

Useful counters:

- render FPS
- frame time average and 95th percentile
- number of real lights active
- number of shadow-casting lights active
- number of draw calls
- number of triangles
- number of materials
- number of textures
- number of visible fixture instances
- bloom enabled and settings
- pixel ratio
- current renderer backend
- WebGPU device lost reason/message

Useful debug views:

- active hero light markers
- light budget score per fixture
- fixture group proxy light volumes
- beam culling overlay
- bloom-only view
- emitter-only view
- real-light-only view

Three.js has `renderer.info` style counters in WebGL; WebGPU support may differ, but any available metrics should be surfaced.

---

## 19. Best Candidate Combinations

These are not prioritized yet, but they are the strongest combinations.

### Combination 1 - Practical Live Renderer

- Lite Mode style visual rendering for all fixtures.
- Instanced emitters, halos, and beams.
- Bloom tuned as part of the lighting look.
- 16-32 pooled hero `SpotLight` objects.
- 0 fixture shadows.
- 1 moon/key shadow maximum.
- DPR 1.0 or 1.25.
- Adaptive quality guard.

This is likely the best balance of visual quality, implementation risk, and FPS.

### Combination 2 - Group Proxy Illumination

- Exact fixture emitters and beams.
- Aggregate fixture groups into broad proxy lights.
- Optional small hero light budget.
- Section-based color averaging.
- Bloom for sparkle/glow.

This is likely the best path if broad ship illumination matters more than per-fixture accuracy.

### Combination 3 - High-End Custom WebGPU Many-Light Renderer

- Custom clustered/tiled lighting.
- GPU light buffers.
- Compute culling into clusters.
- Custom materials for the ship/ground/ice.
- Shadows only for a tiny subset.
- Instanced visual emitters and beams.

This is the technically best answer for many real lights, but also the largest project.

### Combination 4 - Cinematic Preview Mode

- Uses the practical live renderer.
- Raises DPR and hero light budget.
- Optional screenshot-only shadows.
- Can be slower than real time.

This separates show operation from pretty still/video capture.

---

## 20. Open Questions

- What is the target GPU for the final installation laptop/desktop?
- Is live performance target 60 FPS, 90 FPS, or just stable 30+ FPS?
- Is the simulation primarily an operator tool, a design renderer, or an audience-facing visualizer?
- How important is actual surface illumination versus perceived glow/beam realism?
- Are shadows needed from fixtures, or only from moon/key lights?
- Should beam cones be physically plausible or just visually expressive?
- How many fixtures are expected after final patching?
- Will future scenes exceed the current Titanic fixture count?
- Should WebGL fallback remain supported?
- Should the renderer support screenshot/high-quality offline modes separately?

---

## 21. Non-Prioritized Next Experiments

These are experiment ideas only, not priority order.

- Add a renderer quality config object.
- Add a debug overlay for DPR, bloom, real light count, and backend.
- Add a real-light budget cap and manually assign first N fixtures to real lights.
- Replace per-fixture real lights with a global light pool.
- Add group proxy lights for wall/deck/chimney groups.
- Prototype instanced beam cones for all fixtures.
- Prototype instanced LED dots for UkingPar and ShehdsBar.
- Add proper full recursive disposal for fixture rebuilds.
- Add a benchmark scene with 0, 16, 32, 64, 128 real lights.
- Add a "bloom sanity" test pattern with known bright emitters.
- Add WebGPU device lost handling and a user-visible error state.
- Test Electron with frame cap on versus off.
- Test DPR 1.0, 1.25, 1.5, and 2.0 on target hardware.

---

## 22. Working Recommendation

The likely best long-term direction is:

1. Keep the default live path visually rich but mostly fake: emitters, halos, beams, bloom.
2. Make all repeated visual lighting hardware instanced.
3. Add a global, pooled, capped hero light system for real illumination.
4. Add group proxy lights for broad ship washes.
5. Keep shadows extremely limited.
6. Treat clustered/deferred WebGPU lighting as a later research project only if real many-light illumination becomes essential.

This document remains a brainstorming document until the team chooses a prioritized implementation plan.
