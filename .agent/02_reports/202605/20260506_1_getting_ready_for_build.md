# 2026-05-06 — Getting Ready for Build

## Session: DMX Priority Fix + Simulation Global Parameters

### sACN Priority Fix

The simulation's Pixelblaze sACN output was transmitting at **priority 100**, the same as the MarsinEngine. Physical fixtures were receiving interleaved frames from both sources, causing flickering.

**Fix**: Bumped simulation sACN output priority from `100` → `150` in `simulation/src/core/animate.js`. Since the sACN bridge's `highPriorityThreshold` is `≥150`, the bridge now locks onto the simulation stream when Pixelblaze mode is active, and falls back to the engine stream when it stops.

### Global Parameters Panel (CPC)

Added a standalone `🌐 Global Parameters` GUI panel to the simulation that:
- Fetches current CPC state from the MarsinEngine (`GET /param-center`)
- Shows speed, direction, count, size, rotate, colorPalette1 (Hue), colorPalette2 (Hue)
- Posts changes back to the engine (`POST /param-center`)
- **Appears in ALL lighting modes** when lighting is enabled (not just Pixelblaze mode)
- Is **fully independent** of pattern compilation and the pattern editor
- Hue sliders use a rainbow gradient track with a white position indicator

| File | Change |
|------|--------|
| `simulation/src/gui/pattern_editor.js` | New `setupGlobalParamsGui()` / `destroyGlobalParamsGui()` functions; `updateParameterUI()` now only handles pattern-local exports |
| `simulation/src/core/animate.js` | sACN output priority `100` → `150` |

---

## 🐛 BUG: Hue Slider Rainbow Does Not Match Physical Light Output

### Status: CLOSED (Fixed 2026-05-06)

### Summary
The hue rainbow gradient on the simulation's color sliders did not accurately represent the colors that appear on the physical LED fixtures. Dragging to a position that visually shows "green" on the slider might produce yellow on the lights, and vice versa. Furthermore, dragging it to the center (cyan/green) sometimes produced red on patterns like `02_phase_cathedral.js`.

### Root Cause
1. **Wrong Gradient Visual**: The UI used a custom `pbWave()` function (a linear triangle wave) to generate the slider's gradient. This did not match the standard HSV algorithm used by the CPC schema (`colorPalette1` is type `hsv`) or the Pixelblaze engine's `hsv()` built-in.
2. **Incorrect Data Path Translation**: The simulation intercepted CPC parameter changes and converted them from HSV to RGB before sending them to the pattern engine, *unless* the export was explicitly named with `hsvPicker`. This corrupted canonical CPC exports like `colorPalette1(h,s,v)` because they were fed the `R` channel as the `Hue` channel.

### Fix
- **Visuals**: Replaced the incorrect triangle wave gradient with standard CSS `hsl()` stops (Red → Yellow → Green → Cyan → Blue → Magenta → Red). This matches both the WASM engine's `hsv()` implementation and the `CaptainPad` UI.
- **Data Path**: The simulation now always sends raw `(h, s, v)` for CPC color params, respecting the CPC schema which defines `colorPalette1` and `colorPalette2` strictly as `hsv` types.
- **CaptainPad Sync**: Verified that the iPad CaptainPad UI uses the standard `hsvToRgbString` and correctly posts `{ h, s, v }` objects to `/param-center`.

---

## 🐛 BUG: CaptainPad Mixer Master Vis Does Not Show True Master Output

### Status: CLOSED (Fixed)

### Summary
In the CaptainPad iPad app's Mixer tab, the "Master" visualizer was displaying data from the mixer's internal composite buffer. However, this buffer represents the pre-effects output. The true final master output sent to the lights (which includes global effects, blackout states, and hardware intensity controllers) was not being visualized, leading to a discrepancy between the UI and the physical lights.

### Fix
- Modified the telemetry broadcast in `marsin_engine/engine.js`. The engine now manually extracts the `trueMasterBuffer` directly from the `model.pixels` array *after* the `intensityController` and `globalEffectsController` have applied their modifications.
- Replaced the pre-effects `visData['master']` with this new true master buffer.
- Fixed an additional logic error in `marsin_engine/lib/pattern_mixer.js` where the base channel was being skipped during `mixerBuffer` compositing, which broke proper overlay crossfading.

---

## 🐛 BUG: Lighting Profiles "pixel_mapping" Still Renders in Full Mode

### Status: CLOSED (Fixed 2026-05-06)

### Summary
When selecting the `pixel_mapping` lighting profile in the simulation's Option UI, the environment visually still appeared to be running in "Full Analytic (Heavy)" mode (i.e. full volumetric light cones were visible). Additionally, the lighting engine did not propagate profile changes properly to non-LED Par fixtures (`dmxSceneFixtures`), causing them to skip WebGPU Spotlight allocations and visibility toggles.

### Root Cause
1. **Profile Definition Error**: In `profile_registry.js`, the `pixel_mapping` configuration had `coneMode: 'pixel'` set instead of `coneMode: 'none'`. It also incorrectly had `emitterMode: 'none'` (which would make the physical LED pixels invisible against the dark ship model).
2. **Missing Collections in `LightPool`**: The WebGPU `LightPool` orchestrator was iterating exclusively over `window.parFixtures`, skipping `window.dmxSceneFixtures`. This meant that profile changes relating to analytic light allocation didn't evaluate all fixtures in the scene.
3. **Missing Visibility Updates**: The instant visibility toggles in `gui_builder.js` (for cases when topology hasn't changed) only evaluated `window.parFixtures` and skipped the `dmxSceneFixtures` array, preventing instant application of the new `coneMode` and `emitterMode` constraints.

### Fix
- Updated `pixel_mapping` in `profile_registry.js` to set `coneMode: 'none'` and `emitterMode: 'pixel'`.
- Updated `updateLightPool` in `simulation/src/core/light_pool.js` to build its evaluation list from `[...window.parFixtures, ...window.dmxSceneFixtures]`.
- Updated `gui_builder.js`'s instant visibility toggle block to invoke `.setVisibility()` across both fixture arrays, establishing a robust state-refresh loop across the renderer.

---

## 🐛 BUG: sACN "pixel_mapping" Profile Renders Black Pixels & URL Parameters Ignored

### Status: CLOSED (Fixed 2026-05-06)

### Summary
While the full DMX demapper correctly applied colors to the volumetric cones and global emissions, the raw point/instanced pixels themselves remained pitch black when receiving live sACN data from the engine. Additionally, the option to enforce a specific lighting profile via URL (e.g. `?profile=pixel_mapping`) was completely ignored by the simulation. Lastly, toggling "Transparent Cones" only affected standard Par lights, leaving DMX fixture cones completely opaque.

### Root Cause
1. **sACN Writeback Omission**: The `demapSacnToPixels` pipeline in `sacn_mapper.js` calculated the `r, g, b` output correctly and invoked `entry.apply()` (updating the physical cones). However, it failed to write `entry.r`, `entry.g`, `entry.b` directly back to the batch render list. The V2 InstancedMesh array (which draws the actual physical LED pixels) strictly pulls from `entry.r/g/b`, falling back to `0` (black) when undefined.
2. **Missing Parameter Handlers**: The simulation's boot logic inside `main.js` did not parse or apply the `?profile=` argument from `URLSearchParams`, locking the user out of headless configuration testing.
3. **Array Segregation in GUI**: The `_applyConeMaterialSettings()` loop in `gui_builder.js` was statically referencing `window.parFixtures` and omitting `window.dmxSceneFixtures`, breaking transparency material propagation for vintage lights, lightbars, and foggers.

### Fix
- Updated `demapSacnToPixels` to extract pure channel states (RGB+WAUV) and explicitly write them back to `entry.r/g/b/w/a/u` before calculating the blended visual output for `entry.apply()`. This ensures both the downstream WebGPU SpotLight allocator and the V2 InstancedMesh flush receive perfectly synced data.
- Added `URLSearchParams` handling inside `main.js` immediately following the `extractParams` sweep, allowing `?profile=` (e.g. `edit`, `pixel_mapping`, `full`) to immediately override the configuration profile before the renderer initiates.
- Patched `_applyConeMaterialSettings()` and the `conesEnabled` toggles inside `gui_builder.js` to unconditionally iterate over both `window.parFixtures` and `window.dmxSceneFixtures`.

---

## 🐛 BUG: Fixture Shells and "Black Backing" Artifacts Block Pixel Views

### Status: NO FIXED (Fixed 2026-05-07)

### Summary
In `pixel_mapping` mode, the 3D fixture model geometry (the physical dark casings or "shells" of the lights) was completely blocking the view of the individual LED pixel dots. Even after the shell generation was stripped entirely, the "Vintage LED Stage Light" still exhibited a massive black solid pill shape that swallowed the LED dots and looked exactly like a dark backing board.

### Root Cause
1. **Unconditional Shell Visibility**: The `DmxFixtureRuntime` was unconditionally instantiating physical `shell` geometries and adding them to the Three.js group, obstructing clear visualization of purely pixel-mapped layouts.
2. **Improper Dimension Scaling (Math.max)**: The central "warm" pixel of the Vintage LED light specifies its 3D rectangular box footprint in YAML as an array `[15, 60, 10]`. However, the simulation logic extracted the maximum value via `Math.max(15, 60, 10) = 60`, and applied it as the radius for a `SphereGeometry`. This spawned a huge 120mm sphere that enveloped the entire 72mm fixture ring. Because its unlit color was black and it used `depthTest: false`, it appeared as an overlapping solid black backdrop.
3. **GUI Toggle TypeError**: Disabling the "Enable" lighting toggle threw `TypeError: Cannot read properties of undefined (reading 'color')` because `gui_builder.js` still tried to call `f.light.color.set()` on legacy V1 objects, breaking the UI state machine.

### Fix
- **Complete Geometry Purge**: Explicitly removed `shell` and legacy `bulb` instantiations inside the `DmxFixtureRuntime` constructor. The renderer is now structurally constrained to only generate raw pixel `dots` and light `beams`/`halos`.
- **Accurate 3D Box Generation**: Updated `dmx_fixture_runtime.js` to natively parse 3-element array sizes (like `[15, 60, 10]`) and spawn correct, tightly bounded `BoxGeometry` rectangular emitters rather than extracting `Math.max()` and forcing an oversized sphere.
- **DmxFixtureRuntime API Safety**: Updated the color fallback loop in `gui_builder.js` to check for `f.setPixelColorRGB` and safely reset all pixels inside the new dynamic array structure, eliminating the runtime crash.

Revised note, 2026-05-07: the complete shell purge is no longer the desired final direction. The shell code was reverted for testing because fixture shells are useful for layout context. Future fixes should keep shell support and solve the black backing issue by simplifying Vintage emitters to 6 mixed pixels and by making shell visibility/materials non-obstructive where needed.

---

## Review / Detailed Fix Plan - Fixture Shells and Black Backing Artifacts (2026-05-07)

### Scope Clarification

Do not treat lighting profile definitions as the primary issue for this bug. The current profile behavior is considered acceptable by the user. The fix should focus on `DmxFixtureRuntime` geometry/material behavior and GUI API safety.

### Current Code Findings

The reported root cause is directionally correct, but the current code still has a few important edge cases for the next agent to handle carefully.

#### Finding 1 - Shells Should Stay, but Must Not Be the Pixel Artifact Fix

The previous shell purge was too blunt. The current desired direction is to keep fixture shells because they help with visual layout and fixture recognition.

The reverted shell path is acceptable to test further:

```js
if (fixtureDef && fixtureDef.shell) {
  this.shellMat = defaultShellMat.clone();
  this.shellMat.color.set(fixtureDef.shell.color || '#111111');
  // build YAML shell geometry
  this.group.add(this.shell);
} else {
  // fallback can geometry
  this.group.add(this.shell);
}
```

Hardening required:

- Keep shell construction available.
- Do not use shell removal as the primary Vintage black-backing fix.
- If shells block pixel inspection in a specific view, hide or fade shells only in that view/profile.
- Consider a future explicit `shellMode`/`shellOpacity` profile flag, but do not remove shells globally.
- Keep hitboxes separate from shells so selection still works even if shells are faded/hidden.

#### Finding 2 - Array Pixel Sizes Now Use `BoxGeometry`, but `Math.max()` Still Drives Halo Sizing

The pixel dot path correctly handles 3-element size arrays:

```js
if (Array.isArray(pixelModel.size) && pixelModel.size.length === 3) {
  const w = pixelModel.size[0] * 0.001;
  const h = pixelModel.size[1] * 0.001;
  const d = pixelModel.size[2] * 0.001;
  dotGeo = new THREE.BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01));
}
```

But the same pixel still later computes:

```js
else if (Array.isArray(pixelModel.size)) pixelSize = Math.max(...pixelModel.size);
const baseSize = Math.max(pixelSize * 0.002, 0.12);
halo = new THREE.Mesh(getCachedSphere(bulbSize * 2.5), haloMat);
```

For the Vintage warm emitter `[15, 60, 10]`, this still treats `60` as the representative size for halo math. It no longer creates the old black solid sphere, but it can still create a very large halo around rectangular emitters in modes where halos are enabled.

Recommended fix:

- Add a helper that parses pixel size once:

```js
function parsePixelSize(size) {
  if (Array.isArray(size) && size.length === 3) {
    return {
      kind: 'box',
      widthMm: Number(size[0]) || 0,
      heightMm: Number(size[1]) || 0,
      depthMm: Number(size[2]) || 0,
      representativeMm: Math.max(Number(size[0]) || 0, Number(size[2]) || 0)
    };
  }
  const diameterMm = Number(size) || 0;
  return { kind: 'sphere', diameterMm, representativeMm: diameterMm };
}
```

- For rectangular emitters, do not use the longest dimension as a sphere radius. Use a bounded representative value such as the average of width/depth, or an explicit `visual_size` if added to YAML later.
- Keep physical box dimensions for the actual rectangular emitter, but keep halo/glow sizing visually bounded.
- Do not remove halos globally. Halos are still desired in the `emissive` profile. The fix should make halos profile-aware and size-bounded, not delete them.
- In pixel inspection / pixel-mapping workflows, halos may be hidden or reduced if they interfere with reading individual dots. In `emissive`, they should remain available as the soft glow layer.

#### Why This Shows Up Mostly on Vintage Fixtures

The Vintage fixture has a unique geometry layout that exposes the bug:

- Each head has a central warm emitter with a rectangular size array: `[15, 60, 10]`.
- That warm emitter is a single dot at the center of a circular RGB aux ring.
- The old renderer treated the longest dimension, `60`, as a sphere-style visual size.
- The unlit warm emitter material could render black/near-black.
- Because the material used `depthTest: false`, that dark central emitter could draw over nearby ring pixels instead of sitting naturally in depth.

Other fixture types generally use smaller scalar pixel sizes, smaller dots, or layouts where no large unlit rectangular emitter sits directly over a visible RGB ring. So the same renderer weakness was present globally, but Vintage made it obvious because the central warm rectangle overlaps the exact area the user is trying to inspect.

#### Finding 3 - Opaque Black Emitters Can Still Draw Like Backing Boards

The dot meshes share `bulbMat`:

```js
bulbMat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, side: THREE.DoubleSide });
dotMeshList.forEach(d => { d.mesh.material = bulbMat; });
```

This is risky because an unlit rectangular emitter is still an opaque black/near-black mesh, and `depthTest: false` lets it render over other geometry regardless of depth. That can recreate the "black backing" look even after the sphere-size bug is fixed.

Recommended fix:

- Separate "pixel dot material" from the old "bulb material" concept.
- Use a material policy that cannot turn a dark emitter into a foreground occluder:

```js
const dotMat = new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity: 1,
  depthTest: true,
  depthWrite: false,
  side: THREE.DoubleSide
});
```

- When RGB/value output is near zero, either:
  - render a very dim neutral marker with low alpha, or
  - hide the emitter fill and rely on the V2 pixel marker path.

The important rule: an unlit light pixel should not become an opaque black physical blocker in pixel inspection views.

#### Finding 4 - The `lightingEnabled` Handler Still Has an Unsafe V1 Assumption

One direct `lightingEnabled` `.onChange()` path was updated to check `f.setPixelColorRGB` before falling back to `f.light`.

However, the generic handler registry still contains the old unsafe path:

```js
lightingEnabled: (v) => {
  if (window.onLightingChange) window.onLightingChange();
  if (!v && window.parFixtures) {
    window.parFixtures.forEach(f => {
      if (f && f.config) {
        f.light.color.set(f.config.color);
        if (f.beam && f.beam.material) f.beam.material.color.set(f.config.color);
      }
    });
  }
}
```

This can still throw `TypeError: Cannot read properties of undefined (reading 'color')` when `handlers.lightingEnabled()` is called through `window.applyAllHandlers()`, undo/redo, or any path that invokes the generic handler instead of the direct controller callback.

Recommended fix:

- Extract one shared reset helper in `gui_builder.js`:

```js
function resetFixtureVisualColor(f) {
  if (!f || !f.config) return;
  const c = new THREE.Color(f.config.color || '#ffaa44');

  if (typeof f.setPixelColorRGB === 'function') {
    const count = f.pixels?.length || 1;
    for (let i = 0; i < count; i++) f.setPixelColorRGB(i, c.r, c.g, c.b);
    return;
  }

  if (f.light?.color) f.light.color.set(f.config.color);
  if (f.beam?.material?.color) f.beam.material.color.set(f.config.color);
}
```

- Use this helper in both:
  - `handlers.lightingEnabled`
  - the direct `addControl(... 'lightingEnabled' ...).onChange(...)` callback

- Apply it to both fixture collections when appropriate:

```js
[...(window.parFixtures || []), ...(window.dmxSceneFixtures || [])].forEach(resetFixtureVisualColor);
```

#### Finding 5 - Cached Geometry Disposal Needs Care During Profile Rebuilds

`getCachedSphere(size)` returns shared `SphereGeometry` objects. The destroy path disposes geometries from each dot and halo:

```js
if (d.mesh && d.mesh.geometry) d.mesh.geometry.dispose();
if (p.halo) disposeNode(p.halo);
```

If a cached sphere geometry is shared across many dots/halos, disposing it from one fixture can invalidate geometry still referenced by the cache or by another fixture. This can cause missing pixels, blank halos, or intermittent rebuild artifacts after profile changes.

Recommended fix:

- Either stop caching geometries that are disposed by fixture instances, or track cache reference counts.
- Simpler: mark cached geometries with `geometry.userData.cached = true` and skip disposing cached geometry in per-fixture cleanup.
- Continue disposing non-cached `BoxGeometry` instances created per rectangular emitter.

### Implementation Plan

1. Add size parsing helpers in `dmx_fixture_runtime.js`.
   - Parse numeric sizes and `[w, h, d]` arrays once.
   - Avoid raw `Math.max(...size)` except where explicitly choosing a bounded representative size.

2. Split emitter creation into small helpers:
   - `createEmitterGeometry(pixelModel, profileDef)`
   - `createDotMaterial(initialColor)`
   - `createHaloGeometry(parsedSize, profileDef)`

3. Keep rectangular warm emitters physically bounded.
   - Vintage `[15, 60, 10]` should create a `0.015 x 0.060 x 0.010` meter box if physical emitter geometry is enabled.
   - It should not create a large sphere or large opaque halo from the `60` value.

4. Prevent dark emitters from becoming black occluders.
   - Do not use `depthTest: false` on opaque dot materials.
   - Consider low-alpha or hidden state when a pixel is unlit.
   - Keep lit pixels visible without allowing unlit physical geometry to cover nearby mapped dots.

5. Keep shell rendering support.
   - Keep YAML shell construction and fallback can geometry available.
   - Do not make shells solve the Vintage pixel artifact.
   - If pixel inspection needs clear dots, make shell visibility/opacity profile-aware instead of deleting shells.
   - Keep invisible hitboxes for selection/raycasting.

6. Fix `lightingEnabled` reset safety everywhere.
   - Create one reset helper.
   - Use optional chaining around V1-only fields.
   - Cover `parFixtures` and `dmxSceneFixtures`.

7. Fix cached-geometry cleanup.
   - Do not dispose shared cached sphere geometries from individual fixture instances.
   - Dispose per-instance box geometries and per-instance materials normally.

### Validation Checklist

- Load the simulation with `test_bench` and inspect the two Vintage LED fixtures.
- In pixel inspection / pixel-mapping workflow, confirm LED dots are visible. If shells interfere, they should be faded/hidden by profile behavior, not removed from the renderer.
- Drive the Vintage aux ring while warm channel is 0 and confirm the center warm emitter does not appear as a massive black backing.
- Drive the warm channel and confirm its rectangular emitter is tightly bounded to the intended `[15, 60, 10]` footprint.
- Toggle Lighting Engine Enable off and on; no `f.light.color` TypeError should occur.
- Run undo/redo or `window.applyAllHandlers()` after toggling lighting; the generic handler should not crash.
- Switch between profiles repeatedly and confirm dots/halos do not disappear due to disposed cached geometries.
- Confirm physical `shell` meshes are still available for layout context, and that they do not create the Vintage black-backing artifact.

---

## Simplified Direction - Vintage Should Be 6 Mixed Pixels (2026-05-07)

The preferred fix is simpler than preserving the detailed physical Vintage head model. The Vintage LED Stage Light should be represented as 6 logical mixed pixels, one per physical head.

Do not model each head as separate warm backing geometry plus a separate RGB aux ring. That design is what made the black backing artifact easy to trigger.

Keep fixture shells. This simplification applies to the Vintage light emitters/pixels, not the fixture body shell.

### Target Model

Update `simulation/dmx/fixtures/vintage_led_stage_light/model_33.yaml` so the fixture has 6 pixels total:

- `head_1`
- `head_2`
- `head_3`
- `head_4`
- `head_5`
- `head_6`

Each head should combine its warm channel and RGB aux channels into one logical pixel.

Example:

```yaml
- id: head_1
  type: rgbw
  size: 18
  channels:
    value: 3
    red: 16
    green: 17
    blue: 18
  dots:
    - [0, 0, -5]
```

Channel mapping:

- Head 1: warm `3`, RGB `16/17/18`
- Head 2: warm `4`, RGB `19/20/21`
- Head 3: warm `5`, RGB `22/23/24`
- Head 4: warm `6`, RGB `25/26/27`
- Head 5: warm `7`, RGB `28/29/30`
- Head 6: warm `8`, RGB `31/32/33`

Keep the fixture footprint/channel mode at 33 channels. The physical fixture still uses 33-channel DMX mode; only the simulation/export abstraction is simplified.

### Runtime Blending

Update `DmxFixtureRuntime.applyDmxFrame()` so a pixel with both `value` and RGB channels blends them instead of choosing only RGB.

Recommended simple blend:

```js
const warm = readDmxChannelNormalized(dmxSlice, ch.value);
const r = readDmxChannelNormalized(dmxSlice, ch.red) + warm * 1.0;
const g = readDmxChannelNormalized(dmxSlice, ch.green) + warm * 0.75;
const b = readDmxChannelNormalized(dmxSlice, ch.blue) + warm * 0.45;
this.setPixelColorRGB(pIndex, Math.min(1, r), Math.min(1, g), Math.min(1, b));
```

This keeps the behavior understandable: one DMX head becomes one simulated pixel color.

### Export Behavior

`simulation/src/dmx/pixelblaze_model_exporter.js` already maps `value` to `w` through `standardizeChannels()`. After the YAML is simplified, each Vintage fixture should export 6 Pixelblaze pixels instead of 12.

Expected `test_bench` light pixel count after this simplification:

- 4 Uking pars
- 12 Vintage pixels from 2 Vintage fixtures x 6 heads
- 36 Shehds bar pixels from 2 bars x 18 pixels
- Fog/haze special effects excluded from light model

Expected total: `52` renderable light pixels.

### Halos

Keep halos available in the `emissive` profile. The change is not "remove halos"; the change is "one halo per mixed Vintage head pixel instead of separate warm backing geometry plus RGB ring geometry."

### Agent Fix Order

1. [x] Simplify `vintage_led_stage_light/model_33.yaml` to 6 logical mixed pixels.
2. [x] Update `DmxFixtureRuntime.applyDmxFrame()` to blend `value` + RGB when both exist on the same pixel.
3. [x] Re-export the Pixelblaze model and confirm Vintage contributes 6 pixels per fixture.
4. [x] Verify no black backing appears when warm is 0 and RGB aux is active.
5. [x] Verify warm-only DMX still lights each head with a warm color.
6. [x] Verify `emissive` still shows halos, one per head.
