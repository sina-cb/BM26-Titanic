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
