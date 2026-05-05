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
- [ ] Create reusable components:
  - [x] `MixerColumn`
  - [ ] `PatternPicker`
  - [x] `ChannelControls`
  - [ ] `BlendModePicker`
  - [ ] `MasterStrip`
- [x] Support 1 to 3 channel columns.
- [ ] Add channel create/remove controls; disable or hide add at 3 channels.
- [ ] Add channel name editing.
- [x] Add channel enable/mute and solo controls.
- [ ] Add compact pattern picker from existing pattern list.
- [ ] Show compile errors inline inside the affected channel.
- [x] Render channel-local sliders, toggles, triggers, and color controls inside the channel column.
- [ ] Render shared parameter binding controls with modes `linked`, `local`, and `off`.
- [ ] Add channel fader and blend mode controls at the bottom of each column.
- [ ] Add always-visible global strip with connection state, FPS, model, master fader, blackout, dimmers, and global effects.
- [ ] Use WebSocket for fader/control changes and REST for compile/pattern changes.
- [ ] Make remove-channel fade out by default.
- [ ] Fix `CaptainPad/components/NauticalFader.tsx` so animated handle position updates when `initialValue`, `min`, or `max` changes.

## Phase 4 — Expo Web TODOs

- [ ] Fix `CaptainPad/utils/api.ts` so no `AsyncStorage` calls run at module import time.
- [ ] Move storage reads behind `getApiBaseAsync()` or use a web-safe storage adapter that does not touch `window` during static rendering.
- [ ] Fix current CaptainPad lint errors before adding mixer UI.
- [ ] Make the mixer route responsive for iPad landscape and desktop web.
- [ ] Verify no route imports browser-only APIs during Expo static rendering.
- [ ] Validate web export with `npx expo export --platform web`.
- [ ] Keep the iPad app and web app on the same API client and mixer components wherever practical.

## Verification Requirements

- [ ] `node engine.js --pattern 08_ocean_liner --model test_bench --dry-run` still passes.
- [ ] Multi-handle WASM test proves two different patterns render simultaneously.
- [ ] Same-pattern-twice test proves controls affect only the targeted channel.
- [ ] Blend-mode tests cover `normal`, `over`, `add`, `screen`, clamping, and master fader.
- [ ] Transition test proves old base fades out, new base fades in, overlays continue, and old handle is destroyed.
- [ ] Save-pattern test proves saving an inactive pattern does not change live output or reported active pattern.
- [ ] Persistence test proves mixer state restores and skips only channels with compile failures.
- [ ] API tests cover all mixer endpoints, invalid channel IDs, max-channel rejection, and legacy base-control behavior.
- [ ] CaptainPad `npm run lint` passes.
- [ ] CaptainPad `npx expo export --platform web` succeeds.

## Implementation Notes For The Agent

- Do not route new mixer UI controls through legacy `/control`.
- Do not use `pattern_state.yaml` for multi-channel state.
- Do not destroy a channel handle during validation compile.
- Do not interrupt overlay channels when base pattern changes.
- Do not start with a web-only UI; CaptainPad iPad remains the primary live surface, and Expo Web should reuse it.
- Keep changes scoped to mixer/runtime/API/CaptainPad unless a dependency issue blocks verification.

---

## Next Todos

1. **Fix patterns**: Go through the remaining patterns (04-25) and update their parameters to use the new CPC standard (e.g., replace `sliderSpeed` with `speed`), fixing any kinks and color usage.
2. **Color palette presets**: Add a meta parameter for beautiful color pairs that will automatically set `colorPalette1` and `colorPalette2` to curated, harmonious combinations.
3. **Autopilot transitions**: Support smooth transitions for the autopilot queue in the deck tab so automatic pattern changes crossfade gracefully.
4. **Color picker UI**: Update the color picker in CaptainPad to be a proper, intuitive, rich color picker rather than standard sliders.
5. **Deck lists categorization**: Brainstorm and categorize the deck lists into "fast", "slow", and "drop" lists for better live performance ergonomics.
6. **Pattern Queue**: Add a pattern queue feature (like a Spotify playlist queue) to allow stacking upcoming patterns dynamically.
