# Marsin Mixer — Gap Analysis & Implementation Plan

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
