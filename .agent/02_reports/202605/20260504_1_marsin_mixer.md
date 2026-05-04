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

- [ ] Create `marsin_engine/lib/wasm_host.js`.
- [ ] Load the Emscripten module once inside `WasmHost`.
- [ ] Expose handle-based methods: `compile(source) -> { ok, handle, error? }`, `destroy(handle)`, `beginFrame(handle, elapsed)`, `renderAll6ch(handle, outBuffer?)`, `setControl(handle, id, v0, v1, v2)`, `getExports(handle)`, `setCoords(pixels)`, and `setPixelMeta(metaArray)`.
- [ ] Ensure `WasmHost.compile()` never destroys existing handles.
- [ ] Add a separate validation compile path for `/save-pattern` so inactive pattern saves cannot replace or destroy live output.
- [ ] Create `marsin_engine/lib/pattern_channel.js`.
- [ ] Include channel fields: `id`, `name`, `pattern`, `handle`, `mode`, `fader`, `enabled`, `localExports`, `localControls`, and `sharedBindings`.
- [ ] Create `marsin_engine/lib/pattern_mixer.js`.
- [ ] Enforce max 3 channels.
- [ ] Track `baseChannelId`.
- [ ] Render enabled channels in fixed UI order.
- [ ] Composite integer RGBWAU buffers with `normal`, `over`, `add`, and `screen`.
- [ ] Apply master fader after compositing.
- [ ] Destroy old WASM handles only after transition or channel removal completion.
- [ ] Start the render loop only after at least one valid channel has compiled.
- [ ] Modify `marsin_engine/engine.js` to use `WasmHost`, `PatternMixer`, and `ChannelParamRouter` instead of the single `MarsinWasmRuntime`.
- [ ] Preserve current single-pattern startup behavior by creating one default base channel from `--pattern`.

## Phase 2 — Parameters, Lifecycle, API TODOs

- [ ] Create `marsin_engine/lib/channel_param_router.js`.
- [ ] Require `channelId` for all new pattern parameter writes.
- [ ] Implement channel-local control state keyed by `(channelId, controlId)`.
- [ ] On channel compile, read exports from that channel handle.
- [ ] Split exports into `localExports` and `shared*` exports.
- [ ] Restore local controls and apply shared bindings to that channel only.
- [ ] Block local writes to shared-owned control IDs with `{ status: "ignored", reason: "shared_ownership" }`.
- [ ] Persist mixer state to `marsin_engine/mixer_state.yaml`.
- [ ] Persist master, channel order, base channel, pattern, name, enabled state, fader, mode, local controls, and shared bindings.
- [ ] Keep `pattern_state.yaml` readable only for legacy fallback; do not use it to represent mixer state.
- [ ] Centralize pattern/channel lifecycle for initial boot, `/set-pattern`, `/mixer/base`, channel pattern changes, autopilot transitions, and save validation.
- [ ] Implement `transitionBaseTo(pattern, { durationMs })` so overlays continue while old base fades out and new base fades in.
- [ ] Remove/destroy the old base handle only after the transition completes.
- [ ] Route autopilot through `transitionBaseTo()` so it changes only the base channel.
- [ ] Add REST endpoints:
  - [ ] `GET /mixer`
  - [ ] `PATCH /mixer`
  - [ ] `POST /mixer/channels`
  - [ ] `PATCH /mixer/channels/:id`
  - [ ] `DELETE /mixer/channels/:id`
  - [ ] `POST /mixer/channels/:id/pattern`
  - [ ] `POST /mixer/channels/:id/control`
  - [ ] `POST /mixer/base`
  - [ ] `POST /mixer/shared`
  - [ ] `PATCH /mixer/channels/:id/shared/:key`
- [ ] Broadcast full mixer state on WebSocket connect.
- [ ] Broadcast mixer state after any state change.
- [ ] Broadcast transition progress during base transitions.
- [ ] Add WS client message `setChannelControl` requiring `channelId`.
- [ ] Keep legacy `/control` and WS `setControl` base-channel-only and clearly mark them legacy.
- [ ] Keep `/set-pattern` as CaptainPad compatibility by routing it through base transition.

## Phase 3 — CaptainPad Mixer UI TODOs

- [ ] Make the mixer the default live Control Deck surface.
- [ ] Implement the UI in `CaptainPad/app/(tabs)/index.tsx` or a new mixer route. **Reference the UI prototype in `tmp/mixer_ui` (e.g. layout and components) for the mixer, but ensure the styling strictly follows the current CaptainPad iPad design system (color and theme-wise).**
- [ ] Create reusable components:
  - [ ] `MixerColumn`
  - [ ] `PatternPicker`
  - [ ] `ChannelControls`
  - [ ] `BlendModePicker`
  - [ ] `MasterStrip`
- [ ] Support 1 to 3 channel columns.
- [ ] Add channel create/remove controls; disable or hide add at 3 channels.
- [ ] Add channel name editing.
- [ ] Add channel enable/mute and solo controls.
- [ ] Add compact pattern picker from existing pattern list.
- [ ] Show compile errors inline inside the affected channel.
- [ ] Render channel-local sliders, toggles, triggers, and color controls inside the channel column.
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
