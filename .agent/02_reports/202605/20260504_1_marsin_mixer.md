# Marsin Mixer — Gap Analysis & Implementation Plan

## Latest Debug Report — sACN Dark Output / Engine Blackout (2026-05-06)

**Read this first before acting on any older sACN bug report lower in this file.**

### Final Diagnosis

The sACN input path was not broken by the fog machine changes. The immediate reason the simulation and real lights stayed dark while the sACN monitor showed healthy `MarsinEngine` traffic was:

```yaml
marsin_engine/states/test_bench/globals_state.yaml
blackout: true
```

MarsinEngine was intentionally zeroing pixel output through its global blackout/intensity path before DMX mapping. The bridge still reported packets because packets were being sent normally; they just represented blacked-out output. Pixelblaze mode inside the simulation still lit fixtures because that mode does not depend on the external MarsinEngine blackout state.

### Current Code Changes Kept

| File | Change |
|------|--------|
| `simulation/src/gui/engine_blackout_warning.js` | New guard that polls `http://localhost:6968/globals` every 2 seconds and shows a very bright warning when `blackout === true`. |
| `simulation/main.js` | Imports and starts the blackout warning guard near the beginning of simulation initialization. Also still contains the separate fog fixture model registration work. |
| `simulation/style.css` | Adds the red/yellow flashing blackout warning banner and clear-button styling. |
| `.agent/02_reports/202605/20260504_1_marsin_mixer.md` | Documents the final diagnosis, reverted debug changes, and validation notes. |

The warning has a **CLEAR ENGINE BLACKOUT** button in normal mode. In readonly mode it still warns, but the clear button is hidden.

### Debug Changes Reverted

All engine-side debug code from this investigation has been removed:

- `marsin_engine/engine.js` is back to the normal `mapPixelsToSacn()` mapper import. The temporary local mapper and `globalThis.__marsinDmxDebug` are gone.
- `marsin_engine/lib/api_server.js` no longer has the temporary `/dmx-debug` endpoint.
- `marsin_engine/lib/sacn_output.js` was reverted to its pre-debug implementation.
- `simulation/src/core/animate.js` was reverted; do not apply the older speculative `processFrame()` change for this blackout issue.
- `simulation/server/sacn_bridge.js` was reverted; do not apply the older speculative raw-buffer forwarding change for this blackout issue.
- `marsin_engine/config.yaml` was restored to `playlist.active: true` after debug temporarily disabled autopilot.
- `marsin_engine/states/test_bench/dimmer_state.yaml` was restored after debug temporarily set section dimmers to full.

### Validation Performed

- `node --check marsin_engine/engine.js` passed after reverting debug code.
- `node --check marsin_engine/lib/api_server.js` passed after removing `/dmx-debug`.
- `node --check marsin_engine/lib/sacn_output.js` passed after reverting sender debug edits.
- `node --check simulation/main.js` passed.
- `node --check simulation/src/gui/engine_blackout_warning.js` passed.
- Restarted the running MarsinEngine process; current process reports `GET http://localhost:6968/globals` with `blackout: false`.
- Verified `GET http://localhost:6968/dmx-debug` now returns `404`, confirming the temporary debug endpoint is gone.
- Browser check with mocked `blackout: true` confirmed the warning appears and the clear button hides it after a successful `POST /global-blackout`.
- Browser check against the real running engine with `blackout: false` confirmed the warning remains hidden.

### Agent Guidance

If lights are dark but the sACN monitor shows `MarsinEngine` packets, check `GET http://localhost:6968/globals` first. Do not chase the fog-machine Pixelblaze exporter or the old `animate.js` control-flow hypothesis unless blackout is definitely false and the engine is sending non-black DMX.

**Branch**: `dev/mixer_impl` (from main)  
**Design doc**: `docs/18_marsin_mixer.md`  
**Status**: Ready for implementation after TODO review

## Summary

The current MarsinEngine runs one pattern through one WASM handle. Pattern switching is a hard cut because `marsin_wasm_runtime.compile()` destroys the old handle before compiling the new one. The mixer implementation must replace that with a small handle-based runtime host and a 3-channel compositor.

The implementation must also account for the code-review findings:

- `POST /save-pattern` currently compiles against the live runtime, so saving an inactive pattern can replace live output.
- CaptainPad static web export currently fails because `AsyncStorage.getItem()` runs at module import time.
- New mixer controls must be channel-scoped; old untargeted `/control` is only a legacy base-channel shim.
- `NauticalFader` must update its animated handle position when backend values change.

## Architectural Defaults

- `baseChannelId` is explicit and initialized to the first valid channel.
- Maximum active channels: `3`.
- Phase 1 uses fixed channel order; draggable ordering is later.
- Blend modes for v1: `normal`, `over`, `add`, `screen`.
- `over` uses max RGBWAU brightness as the opacity mask.
- `screen` is the default blend mode for overlays.
- Master fader applies after channel compositing and before global effects/intensity.
- Mixer state restores automatically on boot unless a channel compile fails.
- Legacy untargeted controls are base-channel-only compatibility shims; all new work must be channel-scoped.

## Phase 1 — Engine Core TODOs

- [x] Create `marsin_engine/lib/wasm_host.js`.
- [x] Load the Emscripten module once inside `WasmHost`.
- [x] Expose handle-based methods: `compile(source) -> { ok, handle, error? }`, `destroy(handle)`, `beginFrame(handle, elapsed)`, `renderAll6ch(handle, outBuffer?)`, `setControl(handle, id, v0, v1, v2)`, `getExports(handle)`, `setCoords(pixels)`, and `setPixelMeta(metaArray)`.
- [x] Ensure `WasmHost.compile()` never destroys existing handles.
- [x] Add a separate validation compile path for `/save-pattern` so inactive pattern saves cannot replace or destroy live output.
- [x] Create `marsin_engine/lib/pattern_channel.js`.
- [x] Include channel fields: `id`, `name`, `pattern`, `handle`, `mode`, `fader`, `enabled`, `localExports`, `localControls`, and `sharedBindings`.
- [x] Create `marsin_engine/lib/pattern_mixer.js`.
- [x] Enforce max 3 channels.
- [x] Track `baseChannelId`.
- [x] Render enabled channels in fixed UI order.
- [x] Composite integer RGBWAU buffers with `normal`, `over`, `add`, and `screen`.
- [x] Apply master fader after compositing.
- [x] Destroy old WASM handles only after transition or channel removal completion.
- [x] Start the render loop only after at least one valid channel has compiled.
- [x] Modify `marsin_engine/engine.js` to use `WasmHost`, `PatternMixer`, and `ChannelParamRouter` instead of the single `MarsinWasmRuntime`.
- [x] Preserve current single-pattern startup behavior by creating one default base channel from `--pattern`.

## Phase 2 — Parameters, Lifecycle, API TODOs

- [x] Create `marsin_engine/lib/channel_param_router.js`.
- [x] Require `channelId` for all new pattern parameter writes.
- [x] Implement channel-local control state keyed by `(channelId, controlId)`.
- [x] On channel compile, read exports from that channel handle.
- [x] Split exports into `localExports` and `shared*` exports.
- [x] Restore local controls and apply shared bindings to that channel only.
- [x] Block local writes to shared-owned control IDs with `{ status: "ignored", reason: "shared_ownership" }`.
- [x] Persist mixer state to `marsin_engine/states/<scene>/mixer_state.yaml`.
- [x] Persist dimmer state to `marsin_engine/states/<scene>/dimmer_state.yaml`.
- [x] Persist master, channel order, base channel, pattern, name, enabled state, fader, mode, local controls, and shared bindings in the per-scene mixer state.
- [x] Completely remove legacy `pattern_state.yaml` since parameter states are now channel-scoped.
- [x] Centralize pattern/channel lifecycle for initial boot, `/set-pattern`, `/mixer/base`, channel pattern changes, autopilot transitions, and save validation.
- [ ] Implement `transitionBaseTo(pattern, { durationMs })` so overlays continue while old base fades out and new base fades in.
- [ ] Remove/destroy the old base handle only after the transition completes.
- [ ] Route autopilot through `transitionBaseTo()` so it changes only the base channel.
- [x] Add REST endpoints:
  - [x] `GET /mixer`
  - [x] `PATCH /mixer`
  - [x] `POST /mixer/channels`
  - [x] `PATCH /mixer/channels/:id`
  - [x] `DELETE /mixer/channels/:id`
  - [x] `POST /mixer/channels/:id/pattern`
  - [x] `POST /mixer/channels/:id/control`
  - [ ] `POST /mixer/base`
  - [ ] `POST /mixer/shared`
  - [ ] `PATCH /mixer/channels/:id/shared/:key`
- [x] Broadcast full mixer state on WebSocket connect.
- [x] Broadcast mixer state after any state change (e.g. fader updates).
- [ ] Broadcast transition progress during base transitions.
- [x] Add WS client message `setChannelControl` requiring `channelId`.
- [ ] Keep legacy `/control` and WS `setControl` base-channel-only and clearly mark them legacy.
- [ ] Keep `/set-pattern` as CaptainPad compatibility by routing it through base transition.

## Phase 3 — CaptainPad Mixer UI TODOs

- [x] Make the mixer the default live Control Deck surface.
- [x] Implement the UI in `CaptainPad/app/(tabs)/index.tsx` or a new mixer route. **Reference the UI prototype in `tmp/mixer_ui` (e.g. layout and components) for the mixer, but ensure the styling strictly follows the current CaptainPad iPad design system (color and theme-wise).**
- [x] Create reusable components:
  - [x] `MixerColumn`
  - [x] `PatternPicker`
  - [x] `ChannelControls`
  - [x] `BlendModePicker`
  - [x] `MasterStrip`
- [x] Support 1 to 3 channel columns.
- [x] Add channel create/remove controls; disable or hide add at 3 channels.
- [x] Add channel name editing.
- [x] Add channel enable/mute and solo controls.
- [x] Add compact pattern picker from existing pattern list.
- [ ] Show compile errors inline inside the affected channel.
- [x] Render channel-local sliders, toggles, triggers, and color controls inside the channel column.
- [x] Render shared parameter binding controls with modes `linked`, `local`, and `off`.
- [x] Add channel fader and blend mode controls at the bottom of each column.
- [x] Add always-visible global strip with connection state, FPS, model, master fader, blackout, dimmers, and global effects.
- [x] Use WebSocket for fader/control changes and REST for compile/pattern changes.
- [x] Make remove-channel fade out by default.
- [x] Fix `CaptainPad/components/NauticalFader.tsx` so animated handle position updates when `initialValue`, `min`, or `max` changes.

## Phase 4 — Expo Web TODOs

- [x] Fix `CaptainPad/utils/api.ts` so no `AsyncStorage` calls run at module import time.
- [x] Move storage reads behind `getApiBaseAsync()` or use a web-safe storage adapter that does not touch `window` during static rendering.
- [ ] Fix current CaptainPad lint errors before adding mixer UI.
- [ ] Make the mixer route responsive for iPad landscape and desktop web.
- [ ] Verify no route imports browser-only APIs during Expo static rendering.
- [ ] Validate web export with `npx expo export --platform web`.
- [ ] Keep the iPad app and web app on the same API client and mixer components wherever practical.

## Phase 5 — Transition System (Completed 2026-05-04/05)

### WASM Transition Engine
- [x] Implement 13 transition built-in variables in `MarsinVM.h`: `transProgress`, `fromR/G/B/W/A/U`, `toR/G/B/W/A/U`.
- [x] Add `marsin_render_blend_6ch()` exported function to `marsin_wasm_api.cpp`.
- [x] Rebuild WASM binary with transition support and deploy to `marsin_pb/wasm/`.
- [x] Implement transition scripts as Pixelblaze-compatible patterns in `patterns/transitions/`:
  - `trans_dissolve.js` — Linear crossfade
  - `trans_flash.js` — White flash burst
  - `trans_wipe_left.js`, `trans_wipe_right.js`, `trans_wipe_up.js`, `trans_wipe_down.js` — Directional wipes
- [x] Default transition set to `trans_dissolve` at `1.0s` (changed from `trans_wipe_left` at `2.0s`).

### Per-Channel Transition Settings
- [x] `transitionMode` and `transitionTime` stored per channel in `mixer_state.yaml`.
- [x] Transition settings serialized in API broadcasts and accepted in PATCH/WS handlers.
- [x] iPad reads transition settings from server state and persists changes back.
- [x] Mode switching via WebSocket (`setChannelMode`) for instant effect — eliminates HTTP round-trip latency that caused white flash artifacts.
- [x] Smooth-step eased `requestAnimationFrame` animation loop on iPad side with throttled WS updates (16ms) and UI updates (50ms).

### Transition UI
- [x] Transition button added per mixer channel (hidden on deck channel via `isDeck` prop).
- [x] Transition style picker (dropdown) and duration input (numeric seconds) per channel.
- [x] On transition: target channel fades to 1.0, all others fade to 0.0, then original blend mode restores.

## Phase 6 — Deck/Mixer View Separation (Completed 2026-05-05)

### Rendering Pipeline Split
- [x] **Deck buffer**: Renders only the base/deck pattern.
- [x] **Mixer buffer**: Renders only overlay channels, composited on black (no deck bleed-through).
- [x] **viewFader** crossfade: `POST /mixer/view` sets `targetViewFader` (0.0 = deck, 1.0 = mixer), with smooth 0.5s transition between views.
- [x] iPad deck tab calls `setMixerView('deck')`, mixer tab calls `setMixerView('mixer')`.
- [x] Deck view now shows only the base pattern — mixer channels no longer bleed through.

### Solo System (Completed 2026-05-05)
- [x] `soloRef` tracks which channel is solo'd (null = none).
- [x] `preSoloStateRef` saves both `enabled` and `fader` per channel before solo.
- [x] **Solo on**: Target channel set to `enabled: true, fader: 1.0`. All others disabled.
- [x] **Solo off** (same button): All channels restored to pre-solo `enabled` and `fader` values.
- [x] **Unmute clears solo**: Enabling any channel via mute toggle clears the solo state.
- [x] All solo/mute changes sent via WebSocket (`setChannelEnabled`) for instant effect.

### Transition + Solo Interaction
- [x] Pressing **Transition** while solo is active clears solo and unmutes all channels.
- [x] All channels are re-enabled before the transition animation starts.
- [x] Target channel fades to 1.0, all others to 0.0 — clean handoff regardless of previous solo/mute state.

## Phase 7 — Global Palette Integration (Completed 2026-05-04)

- [x] `test_const.js` and `test_dualband.js` export `colorPalette1` and `colorPalette2`.
- [x] CPC auto-binds these exports to the global Color 1/2 palette controls.
- [x] Color changes from iPad propagate to all linked patterns in real-time via shared parameter system.

## Phase 8 — Infrastructure & Configuration (Completed 2026-05-05)

### Config Consolidation
- [x] Renamed `CaptainPad/configs.yaml` → `config.yaml` (all imports updated).
- [x] Removed `expo_port` from CaptainPad config — port now read from `marsin_engine/config.yaml` → `web_client.port`.
- [x] Added `web_client` section to `marsin_engine/config.yaml` (enabled, port, build_dir).
- [x] Port allocations documented in `simulation/config.yaml` (6967-6972 + 5568).

### Expo Stability
- [x] Rewrote `scripts/start.mjs` with native Windows tree-killing (`taskkill /T /F`).
- [x] Kill-port now **opt-in** via `-k` flag (was causing intermittent crashes by killing Expo itself).
- [x] Added port-release wait loop (up to 5s) after killing to prevent "port in use" race.
- [x] Added npm scripts: `start:k` (kill port), `start:kc` (kill + clear cache).
- [x] Stale `dist/` directory cleanup on startup (crashes Metro file watcher on Windows).

### Engine WebSocket Handlers Added
- [x] `setChannelFader` — Instant fader changes.
- [x] `setChannelMode` — Instant blend/transition mode changes.
- [x] `setChannelEnabled` — Instant mute/unmute for solo system.

### Documentation
- [x] `marsin_engine/README.md` — Added web client hosting section with setup, architecture table, and port assignments.
- [x] `CaptainPad/README.md` — Updated startup docs with `npm run start:k` / `start:kc` aliases.

## Implementation Notes For The Agent

- Do not route new mixer UI controls through legacy `/control`.
- Do not use `pattern_state.yaml` for multi-channel state.
- Do not destroy a channel handle during validation compile.
- Do not interrupt overlay channels when base pattern changes.
- Do not start with a web-only UI; CaptainPad iPad remains the primary live surface, and Expo Web should reuse it.
- Keep changes scoped to mixer/runtime/API/CaptainPad unless a dependency issue blocks verification.

---

## Next Todos

1. **Layer visualization (VERIFIED ✅)**: Engine-side vis broadcast confirmed working (10fps, base64 RGBWAU). iPad PixelStrip integrated in mixer + deck. Performance optimized: `React.memo` on ChannelStrip, vis state throttled to 5fps. Check iPad to confirm strips are rendering.
2. **Deck channel picker**: User requested a dropdown in the deck tab to choose which channel renders in deck view. Currently hardcoded to `ch_base`.
3. **Autopilot transitions**: Support smooth transitions for the autopilot queue in the deck tab so automatic pattern changes crossfade gracefully.
4. **Fix patterns**: Go through the remaining patterns (04-25) and update their parameters to use the new CPC standard (e.g., replace `sliderSpeed` with `speed`), fixing any kinks and color usage.
5. **Color palette presets**: Add a meta parameter for beautiful color pairs that will automatically set `colorPalette1` and `colorPalette2` to curated, harmonious combinations.
6. **Color palette transition time**: Implement smooth gradient transitions when switching color palettes. When either `colorPalette1` or `colorPalette2` changes, both colors should interpolate (HSV lerp) from the old values to the new values over a configurable transition time (e.g., 0.5–5s). This prevents jarring color jumps during live performance. Engine-side: CPC needs an interpolation timer per HSV param. iPad-side: expose a "Palette Fade" time control in the CPC controls panel.
7. **Color picker UI**: Update the color picker in CaptainPad to be a proper, intuitive, rich color picker rather than standard sliders.
8. **Deck lists categorization**: Brainstorm and categorize the deck lists into "fast", "slow", and "drop" lists for better live performance ergonomics.
9. **Pattern Queue**: Add a pattern queue feature (like a Spotify playlist queue) to allow stacking upcoming patterns dynamically.

---

## Agent Handoff — 2026-05-05 13:48 PT

### Session Summary

This session focused on three areas: (1) fixing deck/mixer view separation, (2) building a fluid solo/mute/transition system, and (3) starting the per-channel pixel visualization feature.

### What Was Completed

1. **Deck/Mixer View Separation** — `pattern_mixer.js:renderAll6ch()` now renders deck and mixer into independent buffers. `viewFader` crossfades between them based on which iPad tab is active (`POST /mixer/view`). Deck = base pattern only on black. Mixer = overlay channels only on black.

2. **Solo System** — `mixer.tsx` tracks `soloRef` and `preSoloStateRef`. Solo saves both `enabled` and `fader` state per channel, sets the solo'd channel to `fader: 1.0`, disables all others. Un-solo restores previous state. Unmuting any channel clears solo. Transition clears solo and unmutes all before animating.

3. **WebSocket `setChannelEnabled`** — Added to `api_server.js` for instant mute/solo changes (no HTTP round-trip).

4. **Expo Stability** — Kill-port in `start.mjs` is now opt-in (`-k` flag). Added port-release wait loop. npm aliases: `start:k`, `start:kc`.

5. **Report Update** — Added Phases 5-8 covering transitions, view separation, solo, palette integration, and infrastructure.

### What Is In Progress (90% Done)

**Per-Channel Pixel Visualization:**

Engine side (DONE):
- `pattern_mixer.js:_extractVis()` captures full 6ch RGBWAU buffer per channel after each render
- `pattern_mixer.js:renderAll6ch()` populates `this._visData` with per-channel + master vis
- `engine.js` broadcasts `{ type: 'vis', vis: { channelId: base64, ... }, pixelCount }` at 10fps via the stats callback
- `api_server.js` publish callback routes `type: 'vis'` messages through WS without wrapping in stats

iPad side (DONE but UNTESTED):
- `components/ui/PixelStrip.tsx` — Decodes base64 RGBWAU (6 bytes/pixel), renders horizontal color bar. Color mapping: W=cool white(200,220,255), A=yellow amber(255,200,50), U=dark purple(75,0,130).
- `mixer.tsx` — `visDataRef` + `visVersion` state, WS handler for `type: 'vis'`, PixelStrip rendered per channel + master strip above channels
- `index.tsx` (deck tab) — Same vis handling, master PixelStrip above pattern queue

**What needs verification:**
- Expo crashed during final test (exit code 1, intermittent). Restart with `npm run start:kc` and verify vis renders on iPad.
- Confirm PixelStrip performance with 64 pixels × 6 channels at 10fps refresh (should be fine — each strip is ~70 tiny View elements).
- If PixelStrip is too heavy, consider using Canvas/SVG or reducing pixel count by downsampling.

### Key Files Modified This Session

| File | Changes |
|------|---------|
| `marsin_engine/lib/pattern_mixer.js` | Deck/mixer buffer split, viewFader crossfade, `_extractVis()`, `getVisData()`, per-channel vis capture |
| `marsin_engine/engine.js` | 10fps vis broadcast via `statsCallback` |
| `marsin_engine/lib/api_server.js` | `setChannelEnabled` WS handler, vis message routing |
| `CaptainPad/app/(tabs)/mixer.tsx` | Solo system (`soloRef`, `preSoloStateRef`), mute clears solo, transition clears solo, PixelStrip per channel + master |
| `CaptainPad/app/(tabs)/index.tsx` | Master PixelStrip, vis WS handler |
| `CaptainPad/components/ui/PixelStrip.tsx` | New — RGBWAU pixel visualization component |
| `CaptainPad/scripts/start.mjs` | Kill-port opt-in, port-release wait loop |
| `CaptainPad/package.json` | `start:k`, `start:kc` scripts |
| `CaptainPad/README.md` | Updated startup docs |

### Architecture Context

- **Render pipeline**: `mixer.renderAll6ch()` → `deckBuffer` (base only) + `mixerBuffer` (overlays on black) → `viewFader` crossfade → `outputBuffer` → sACN
- **Solo**: iPad-only state (`soloRef`/`preSoloStateRef`). Engine just sees `enabled: true/false` per channel.
- **Transitions**: iPad drives the fader animation via `requestAnimationFrame` + WS. Engine does blend mode switching via `setChannelMode` WS. On completion, original blend mode restores.
- **Vis**: Engine → WS `{ type: 'vis', vis: { ch_base: base64, ch_1: base64, master: base64 }, pixelCount: 64 }` at 10fps → iPad `PixelStrip` component renders each as a color bar.

### Startup Commands
```bash
# Engine
cd marsin_engine && node engine.js --pattern 08_ocean_liner --model test_bench

# iPad (Expo)
cd CaptainPad && npm run start:kc   # kill port + clear cache
cd CaptainPad && npm start          # normal start

# Simulation
cd simulation && npm start
```

---

## Bug Report — sACN Simulation Pipeline Broken (2026-05-06)

> **Status**: Open  
> **Severity**: High — simulation fixtures do not light up from sACN input  
> **Reporter**: Sina (via Antigravity trace session)  
> **Context**: Pixelblaze mode works correctly (fixtures light up). sACN IN mode receives data from MarsinEngine but fixtures stay dark.

### Symptom

When the simulation GUI is set to **sACN IN** mode and `marsin_engine` is running, the sACN monitor shows healthy data flow:
```
12:31:17 🟡 ACTIVE — 'MarsinEngine' (Priority 100) forwarding.
12:31:22 197 packets/5s from 'MarsinEngine', 1 client(s)
```
But **no fixtures light up** in the 3D simulation. Pixelblaze mode works fine — fixtures respond to patterns.

### Full Packet Trace

```
Engine (sacn_output.js)
  │  UDP multicast → 239.255.0.1:5568
  ▼
sacn_bridge.js (Node.js, PID 12224)
  │  Receiver.on('packet') → routeFrame()
  │  Builds 515-byte binary: [universe(2)][priority(1)][dmx(512)]
  │  Broadcasts to WebSocket clients on port 6971
  ▼
sacn_input_source.js (Browser)
  │  _handleDmxFrame() → extracts universe, priority, dmx
  │  Calls: window.dmxRouter.submitFrame('sacn_in', 200, universe, dmx)
  │  ✅ Data is now in the router's WRITE buffer
  ▼
animate.js — DMX Router section (line 216)
  │  Gate: window.dmxRouter && getProfileDef(params.lightingProfile).mappingEnabled
  │
  ├─ if (lightingMode === 'sacn_in'):        ← ONLY in sacn_in mode
  │    processFrame()                         ← swaps write→read buffer
  │    demapSacnToPixels(batchRenderList)     ← reads from read buffer, sets pixel colors
  │
  ├─ applyDmx(window.parFixtures)            ← runs UNCONDITIONALLY
  │    reads dmxRouter.getFullFrame(u)        ← reads from READ buffer
  │    fixture.applyDmxFrame(slice)
  │
  ▼
V2 InstancedMesh GPU Flush (line 252)
  │  Reads entry.r, entry.g, entry.b from batchRenderList
  │  Sets instanceColor on GPU mesh
```

### Root Cause Analysis

**There are two independent bugs preventing sACN data from reaching the fixtures:**

#### Bug 1: `processFrame()` gated by `lightingMode === 'sacn_in'`

**File**: `simulation/src/core/animate.js`, line 221-224

```js
if (lightingMode === 'sacn_in') {
   window.dmxRouter.processFrame(); // ← ONLY runs here
   demapSacnToPixels(_batchRenderList, window.dmxRouter);
}
```

`processFrame()` is the **only place** where the UniverseRouter merges submitted frames and **swaps the write buffer to the read buffer** (see `universe_router.js:160` → `buffer.swap()`).

The `applyDmx()` function at line 230 runs unconditionally and calls `dmxRouter.getFullFrame(u)`, which reads from the **read buffer**. But if `processFrame()` never ran, the read buffer is stale/empty — so `applyDmx()` gets all zeros.

**Impact**: Even when in sacn_in mode, if `lightingMode` isn't correctly set in `state.js`, both `processFrame()` and `demapSacnToPixels()` are skipped. The router accumulates submitted frames but never merges them.

#### Bug 2: Multicast vs Unicast mismatch (FIXED in this session)

**File**: `marsin_engine/lib/sacn_output.js`, line 31-40

The `sacn` npm library's `Receiver` joins **multicast group** `239.255.0.x` per universe. But the engine's `Sender` was configured with `useUnicastDestination: '127.0.0.1'`, sending unicast packets that never reach the multicast socket.

**Fix applied**: When destination is `127.0.0.1` (localhost), omit `useUnicastDestination` so the sender uses multicast by default. For real controller IPs (e.g. `10.1.1.102`), unicast is preserved.

```js
// sacn_output.js — fixed
const isLocalhost = dest === '127.0.0.1' || dest === 'localhost' || dest === '0.0.0.0';
if (!isLocalhost) {
  senderOpts.useUnicastDestination = dest;
}
```

**Status**: ✅ Fixed — bridge now receives ~197 packets/5s. But fixtures still don't light up due to Bug 1.

### Key Files

| File | Role |
|------|------|
| `marsin_engine/lib/sacn_output.js` | Engine sACN sender (multicast fix applied) |
| `marsin_engine/config.yaml` | Engine config — `destinations: ['127.0.0.1']` |
| `simulation/server/sacn_bridge.js` | Node.js sACN→WebSocket bridge |
| `simulation/src/dmx/sacn_input_source.js` | Browser-side WebSocket→dmxRouter feeder |
| `simulation/src/dmx/universe_router.js` | Multi-source DMX merge engine |
| `simulation/src/core/animate.js:216-249` | DMX router processing + fixture application |
| `simulation/src/dmx/sacn_mapper.js` | `demapSacnToPixels()` — reads router → sets pixel colors |
| `simulation/src/core/state.js:57` | `lightingMode` default: `'gradient'` |
| `simulation/src/gui/pattern_editor.js:416-455` | `onLightingChange()` — sets mode + enables sacn_input |

### What Works

- **Pixelblaze mode**: Pattern engine renders → `mapPixelsToSacn()` writes to router → `processFrame()` is called elsewhere in the pipeline → `applyDmx()` reads merged data → fixtures light up ✅
- **sACN bridge**: Receives multicast from engine, forwards binary frames over WebSocket ✅
- **sacn_input_source**: Receives WebSocket frames, submits to dmxRouter ✅

### What Doesn't Work

- **sACN IN mode**: `processFrame()` and `demapSacnToPixels()` are gated by `lightingMode === 'sacn_in'` — if the mode isn't correctly propagated to `state.js`, both are skipped and fixtures stay dark ❌

### Recommended Fix

1. **Verify `lightingMode` propagation**: Add a `console.log` at the top of the animate loop to confirm what `lightingMode` actually is when in sacn_in mode. The GUI may be setting `params.lightingMode` but `setLightingMode()` in `state.js` may not be called.

2. **Move `processFrame()` outside the sacn_in gate**: `processFrame()` should always run if the router has sources, not just in sacn_in mode. The `applyDmx()` block already runs unconditionally and depends on it:
   ```js
   // animate.js — proposed fix
   if (window.dmxRouter && getProfileDef(params.lightingProfile).mappingEnabled) {
     window.dmxRouter.processFrame(); // ← ALWAYS merge, regardless of mode
     
     if (lightingMode === 'sacn_in') {
       demapSacnToPixels(_batchRenderList, window.dmxRouter);
     } else {
       mapPixelsToSacn(_batchRenderList, window.dmxRouter);
     }
     
     applyDmx(window.dmxSceneFixtures);
     applyDmx(window.parFixtures);
   }
   ```

3. **Do NOT touch**: `sacn_bridge.js`, `sacn_mapper.js`, `sacn_output_client.js`, networking, or fixture constructors. The issue is purely in `animate.js` control flow gating.

### Fog Machine Fixture Changes (This Session)

The following changes were made to onboard `TEFogMachine` and `ChauvetHaze4D` as proper DMX fixtures in the simulation. These are separate from the sACN bug above but should be validated for correctness.

#### New YAML Definition Files Created

| File | Purpose |
|------|---------|
| `simulation/dmx/fixtures/fog_te_machines/model_1.yaml` | TE Fog Machine model — 1ch, 300×150×400mm box, `fixture_type: TEFogMachine`, `pixels: []` |
| `simulation/dmx/fixtures/fog_te_machines/channels_1.yaml` | TE channels — Ch1: Fog output (0-255) |
| `simulation/dmx/fixtures/fog_chauvet_4d/model_2.yaml` | Chauvet Hurricane Haze 4D model — 2ch, 277×150×396mm box, `fixture_type: ChauvetHaze4D`, `pixels: []` |
| `simulation/dmx/fixtures/fog_chauvet_4d/channels_2.yaml` | Chauvet channels — Ch1: Fan speed, Ch2: Haze volume |

#### Code Changes

**1. `simulation/src/core/fixtures.js` (lines 88-91)**

Added type intercept to route `TEFogMachine` and `ChauvetHaze4D` to the `FogMachine` class instead of `DmxFixtureRuntime`:

```js
if (fixtureType === 'FogMachine' || fixtureType === 'TEFogMachine' || fixtureType === 'ChauvetHaze4D') {
  fixture = new FogMachine(config, index, scene, interactiveObjects, modelRadius, fixtureDef);
} else {
  fixture = new DmxFixtureRuntime(config, index, scene, interactiveObjects, modelRadius, fixtureDef, patchDef);
}
```

**Note**: `FogMachine` constructor does NOT receive `patchDef` (7th argument) like `DmxFixtureRuntime` does. This means fog fixtures lack `fixture.patchDef`, which may cause `applyDmx()` in `animate.js` to skip them (it checks `fixture.patchDef?.universe`). This is fine for fog machines (they don't have renderable pixels) but is worth noting.

**2. `simulation/src/fixtures/fog_machine.js` (constructor + applyDmxFrame)**

- Constructor now accepts an optional `fixtureDef` (6th arg) and reads `fixtureDef.shell.dimensions` for dynamic box sizing instead of hardcoded 0.5×0.5×0.5.
- `applyDmxFrame()` (line 88-98) — Added Chauvet-specific channel routing: if `fixtureType === 'ChauvetHaze4D'`, reads `dmxSlice[1]` (Ch2 = Haze) instead of `dmxSlice[0]` (Ch1 = Fan).

**3. `simulation/src/dmx/pixelblaze_model_exporter.js` (lines 37-40)**

Added filter to skip non-light fixtures from the Pixelblaze pixel map:

```js
if (fType.includes('Fog') || fType.includes('Horn') || fType.includes('Fire') || fType === 'ChauvetHaze4D') {
  return; // Skip — these do not have renderable LEDs
}
```

**Risk**: This filter uses `includes('Fog')` which will match `FogMachine`, `TEFogMachine`, etc. But `ChauvetHaze4D` does NOT contain "Fog" — hence the explicit `=== 'ChauvetHaze4D'` check. If new fixture types are added with "Fog" in the name they'll be auto-filtered, but non-obvious names like `ChauvetHaze4D` need explicit listing.

**4. `simulation/src/gui/gui_builder.js` (line 1421-1434)**

Added "Hold to Fog" button for all fog-type fixtures (`FogMachine`, `TEFogMachine`, `ChauvetHaze4D`). Sets `fixture._uiFogOverride = true` on mousedown, `false` on mouseup/mouseleave.

#### Scene Impact

The `test_bench` scene (`scenes/test_bench/scene_config.yaml`) has 10 fixtures:
```
0-3: Par 1-4       (UkingPar)
4-5: Vintage L/R    (VintageLed)
6-7: Bar L/R        (ShehdsBar)
8-9: FogMachine L/R (FogMachine)       ← existing generic type, not TEFogMachine/ChauvetHaze4D
```

The two fog machines at indices 8-9 use the generic `FogMachine` type. The `TEFogMachine` and `ChauvetHaze4D` types are registered but not yet placed in the test_bench scene. The pixelblaze exporter correctly skips indices 8-9, so the exported `test_bench.js` model has 64 pixels (all from fixtures 0-7).

### Important Context

- The `sacn_bridge.js` and `sacn_mapper.js` files were reverted by the user after earlier attempted fixes that were not the actual issue. Do not re-modify those files.
- The `sacn_output.js` multicast fix in the engine IS correct and should be kept — it's what restored bridge packet reception.
- The fog machine fixture additions (`fixtures.js`, `fog_machine.js`, `pixelblaze_model_exporter.js`) are **not** the cause of this specific bug, but should be validated separately to ensure they don't cause index mismatches in the `parFixtures` array.

---

## Codex Debug Update — 2026-05-06

**Status**: Patched in working tree; needs live sACN validation with `marsin_engine` sending to the running simulation.

### Files Changed By Codex

| File | Change |
|------|--------|
| `simulation/src/core/animate.js` | Moved `window.dmxRouter.processFrame()` out of the `lightingMode === 'sacn_in'` branch so submitted DMX source frames are flushed to the router read buffer every render tick before `applyDmx()` reads them. |
| `simulation/src/core/animate.js` | Added `getActiveLightingMode()` so the DMX path honors `params.lightingMode` directly if `state.js` propagation is stale. |
| `simulation/src/core/animate.js` | Wrapped batch pixel `entry.apply()` so, in `sacn_in` mode only, `demapSacnToPixels()` also updates `entry.r/g/b`. This keeps the V2 InstancedMesh GPU flush from rendering stale black pixels after sACN input. This avoids modifying `sacn_mapper.js`. |
| `marsin_engine/lib/sacn_output.js` | Re-applied the localhost multicast fix that the report expected but the checked-out file did not contain. Localhost-style destinations (`127.0.0.1`, `localhost`, `0.0.0.0`, `::1`, or empty) now omit `useUnicastDestination`, allowing the `sacn` sender to use multicast. Non-local destination IPs still use unicast. |
| `simulation/main.js` | Added fetch/registration for `fog_te_machines/model_1.yaml` and `fog_chauvet_4d/model_2.yaml` so `TEFogMachine` and `ChauvetHaze4D` are actually available through the fixture definition registry. |

### Additional Finding

The original report said the `marsin_engine/lib/sacn_output.js` multicast fix had already been applied, but the current working copy still always passed:

```js
useUnicastDestination: dest
```

That would regress localhost testing back to unicast and prevent the multicast receiver from seeing packets on a fresh run. Codex restored the intended conditional behavior.

### Why `animate.js` Needed More Than Moving `processFrame()`

Moving `processFrame()` fixes the router read-buffer issue for `applyDmx()`, but the V2 InstancedMesh path had a second stale-color problem:

```js
demapSacnToPixels(_batchRenderList, window.dmxRouter);
// later:
const rn = Math.min(1, (entry.r || 0) + ...)
```

`demapSacnToPixels()` calls `entry.apply(r, g, b)`, but it does not assign `entry.r`, `entry.g`, or `entry.b`. The patch in `animate.js` wraps `entry.apply()` so sACN demapping updates those cached RGB fields only while the active mode is `sacn_in`. Pixelblaze mode is not affected because it still preserves raw RGBWAU values for outgoing DMX mapping.

### Validation Performed

- `node --check simulation/src/core/animate.js` passed.
- `node --check simulation/main.js` passed.
- `node --check marsin_engine/lib/sacn_output.js` passed.
- Parsed the new fog model YAMLs from the `simulation` package context:
  - `TEFogMachine:1`
  - `ChauvetHaze4D:2`
- Verified `UniverseRouter.submitFrame()` + `processFrame()` publishes submitted sACN data to the read buffer.
- Constructed a `createSacnOutput()` sender with both localhost and real-controller destinations without throwing.
- Loaded `http://localhost:6969/simulation/?scene=test_bench&renderer=webgl` with Puppeteer against the already-running simulation server; no page or console errors were observed during the load check.

### Still Needs Live Validation

Run the full live path with `marsin_engine` actively sending sACN and the simulation GUI set to `sACN IN`:

1. Confirm the sACN monitor still shows `MarsinEngine` packets.
2. Confirm test bench fixtures light in the 3D simulation.
3. Confirm Pixelblaze/gradient modes still light fixtures and still send outbound sACN when not in `sacn_in`.
4. Confirm `TEFogMachine` and `ChauvetHaze4D` appear in fixture type choices after a page reload.

---

## Final Correction — 2026-05-06

**Read this section first. It supersedes the sACN control-flow hypothesis above.**

### Actual Root Cause

The sACN pipeline was not broken by the fog machine model changes. The live failure was caused by **MarsinEngine global blackout being enabled** at runtime.

The misleading symptom was that the bridge still reported healthy packet flow:

```text
196 packets/5s from 'MarsinEngine', 1 client(s)
```

That packet flow was real, but the engine was intentionally blacking out pixel output before DMX mapping. Pixelblaze mode in the simulation still worked because that path bypasses the external `marsin_engine` blackout state.

### Fog Machine Check

The fog fixture additions are not the cause of the dark fixtures:

- `FogMachine`, `TEFogMachine`, and `ChauvetHaze4D` are skipped by the Pixelblaze model exporter because they have no renderable LED pixels.
- The `test_bench` exported model still contains the expected light pixels from the pars, vintage fixtures, and bars.
- The fog entries do not shift the light pixel order used by the exported model.

### Debug Changes Reverted

The following diagnostic/speculative changes from the false lead were removed:

- `marsin_engine/engine.js`: removed the temporary local `mapEnginePixelsToSacn()` mapper and restored the normal `mapPixelsToSacn()` import from `simulation/src/dmx/sacn_mapper.js`.
- `marsin_engine/engine.js`: removed `globalThis.__marsinDmxDebug`.
- `marsin_engine/lib/api_server.js`: removed the temporary `/dmx-debug` endpoint.
- `simulation/src/core/animate.js`: reverted the speculative `processFrame()`/`getActiveLightingMode()` changes.
- `simulation/server/sacn_bridge.js`: reverted the speculative raw-buffer forwarding change.
- `marsin_engine/lib/sacn_output.js`: reverted the debug-pass sender transport edits so the engine sender is back to the pre-debug implementation.
- `marsin_engine/config.yaml`: restored `playlist.active: true` after debug disabled autopilot.
- `marsin_engine/states/test_bench/dimmer_state.yaml`: restored the pre-debug dimmer values after live validation temporarily set sections to full.

### Engine Code Status

No MarsinEngine debug code should remain from this investigation. If a future agent wants to revisit multicast/unicast behavior or raw DMX scaling, treat that as a separate, deliberate protocol change, not as part of this blackout fix.

### New Guardrail Added

The simulation now shows a high-visibility warning if MarsinEngine global blackout is enabled:

| File | Change |
|------|--------|
| `simulation/src/gui/engine_blackout_warning.js` | New polling UI guard. Reads `http://localhost:6968/globals` every 2 seconds and shows a large flashing warning when `blackout === true`. |
| `simulation/main.js` | Starts the blackout warning guard during simulation initialization. |
| `simulation/style.css` | Adds the bright red/yellow warning banner styling. |

The warning includes a **CLEAR ENGINE BLACKOUT** button in normal mode. In readonly mode the warning still appears, but the clear button is hidden.

### Current Agent Guidance

Do not chase the fog-machine model exporter for this symptom. If the sim or real lights are dark while the sACN monitor shows healthy `MarsinEngine` packets, check `GET http://localhost:6968/globals` first and inspect the `blackout` field.
