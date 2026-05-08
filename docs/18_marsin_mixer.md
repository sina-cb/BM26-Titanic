# Design 18: Marsin Mixer and Pattern Transition

**Status**: Design Review  
**Last Updated**: 2026-05-02  
**Scope**: BM26-Titanic MarsinEngine + CaptainPad mixer UI  
**Goal**: Replace the single active WASM runtime model with a small pattern mixer that can run up to 3 live channels, blend them in real time, transition the base pattern smoothly, and expose compact iPad controls for performance.

---

## 1. Problem Statement

MarsinEngine currently renders one pattern runtime:

```text
engine.js tick
  runtime.beginFrame(elapsed)
  runtime.renderAll6ch()
  copy RGBWAU into model pixels
  global effects
  intensity
  sACN output
```

The API server mutates that same runtime when switching patterns:

```text
POST /set-pattern
  runtime.compile(newSource)
  old handle destroyed
  new handle becomes active
```

That gives hard cuts and prevents layered looks such as:

```text
base: ocean_liner
over: sparkle highlights
over: heartbeat pulse
```

BM has more CPU and memory than firmware, so the right abstraction is not a temporary two-slot transition engine. BM should have a real mixer.

---

## 2. Goals

1. Run up to **3 live pattern channels** at the same time.
2. Let each channel select a pattern from the existing pattern list.
3. Give each channel a user-editable name.
4. Support channel faders and a master fader.
5. Support practical blend modes for light output.
6. Keep parameter controls compact and usable on iPad.
7. Preserve global effects and intensity after the mixer output.
8. Make pattern transitions a special case of channel weight automation.

---

## 3. Core Concepts

### 3.1 Channel

A channel is one running pattern instance:

```js
{
  id: "ch_1",
  name: "Base",
  pattern: "08_ocean_liner",
  handle: 123456,
  mode: "normal",
  fader: 1.0,
  opacity: 1.0,
  enabled: true,
  pinned: false,
  exports: [],
  controlState: {}
}
```

Each channel owns its own WASM handle and its own pattern-specific controls.

### 3.2 Mixer

The mixer owns all active channels. `engine.js` should not render a raw `runtime` anymore. It should ask the mixer for one mixed RGBWAU buffer.

```text
engine.js tick
  mixer.beginFrame(elapsed)
  outBuf = mixer.renderAll6ch()
  copy outBuf into model pixels
  global effects
  intensity controller
  map to sACN
  send frame
```

### 3.3 Transition

A transition is not a separate engine type. It is timed channel automation:

```text
old base channel fader: 1.0 -> 0.0
new base channel fader: 0.0 -> 1.0
duration: 500ms or user value
on complete: destroy old base channel
```

This gives the same behavior as firmware fade, but using the BM mixer model.

### 3.4 Overlay

An overlay is a persistent channel composited over the base:

```text
Channel 1: Base wash      normal  fader 1.00
Channel 2: Sparkles       screen  fader 0.45
Channel 3: Heartbeat      add     fader 0.25
```

---

## 4. Runtime Architecture

### 4.1 Current Wrapper Problem

`marsin_wasm_runtime.js` hides a single handle inside each runtime object. Its `compile()` method destroys the previous handle before compiling a new one.

For a mixer, create a lower-level `WasmHost` that loads the Emscripten module once and exposes handle-based calls:

```js
class WasmHost {
  async init() {}

  compile(source) {}              // returns handle
  destroy(handle) {}
  beginFrame(handle, elapsed) {}
  renderAll6ch(handle, outPtr) {}
  setControl(handle, id, v0, v1, v2) {}
  getExports(handle) {}

  setCoords(pixels) {}
  setPixelMeta(metaArray) {}
}
```

Then each channel is lightweight:

```js
class PatternChannel {
  constructor({ id, name, pattern, handle, mode, fader }) {}

  beginFrame(elapsed) {
    wasmHost.beginFrame(this.handle, elapsed);
  }

  renderInto(buffer) {
    wasmHost.renderAll6ch(this.handle, buffer);
  }

  setControl(id, v0, v1, v2) {
    wasmHost.setControl(this.handle, id, v0, v1, v2);
  }
}
```

### 4.2 PatternMixer

```js
class PatternMixer {
  constructor({ wasmHost, pixelCount, patternsDir }) {
    this.channels = [];
    this.master = 1.0;
    this.automations = [];
  }

  async addChannel(patternName, options) {}
  async replaceChannel(channelId, patternName) {}
  removeChannel(channelId) {}
  setChannelFader(channelId, value) {}
  setMaster(value) {}
  setBlendMode(channelId, mode) {}
  transitionBaseTo(patternName, options) {}

  beginFrame(elapsed) {}
  renderAll6ch() {}
}
```

### 4.3 Render Order

Channels are rendered left to right in UI order. The first enabled channel is usually the base.

```text
clear output buffer
for channel in channels:
  render channel buffer
  composite channel into output using mode and fader
apply master fader
return output
```

Render order matters for `normal`, `over`, `screen`, and `multiply`. The UI should make channel order visible and eventually draggable. Phase 1 can use fixed columns: left channel renders first, right channel renders last.

### 4.4 Two-Mode Output Architecture (Deck vs Mixer)

The engine has **two output modes** that drive the physical lights. The CaptainPad UI selects the active mode by switching tabs, which sets the `viewFader` to crossfade between the two buffers:

```
  ┌──────────────────────── CaptainPad ─────────────────────────┐
  │                                                             │
  │   ┌─────────┐                          ┌─────────┐         │
  │   │  DECK   │  ◄── Tab Switch ──►      │  MIXER  │         │
  │   │  Tab    │                          │  Tab    │         │
  │   └────┬────┘                          └────┬────┘         │
  └────────┼────────────────────────────────────┼──────────────┘
           │                                    │
           ▼                                    ▼
  POST /mixer/view                    POST /mixer/view
  { view: 'deck' }                    { view: 'mixer' }
  viewFader → 0.0                     viewFader → 1.0
           │                                    │
           ▼                                    ▼
  ┌──────────────────┐               ┌──────────────────┐
  │   deckBuffer     │               │   mixerBuffer    │
  │  (PFL: 1 channel │               │  (composited     │
  │   at 100%)       │               │   mixer channels)│
  └────────┬─────────┘               └────────┬─────────┘
           │                                    │
           └──────────┐    ┌────────────────────┘
                      ▼    ▼
              ┌────────────────────┐
              │  viewFader         │
              │  crossfade         │
              │  0.0=deck 1.0=mix  │
              └────────┬───────────┘
                       │
                       ▼
              ┌────────────────────┐
              │   outputBuffer     │──────▶ sACN / DMX
              │                    │        Physical Lights
              └────────────────────┘
```

#### Channel Ownership

| Channel | Belongs to | Renders into |
|---------|-----------|-------------|
| `ch_base` (index 0) | **Deck** | `deckBuffer` only — PFL at 100% |
| `ch_1`, `ch_2`, ... | **Mixer** | `mixerBuffer` — composited with faders/blends |

The deck channel (`ch_base`) must **never** be included in the mixer composite loop. The mixer composite iterates only non-deck channels:

```js
// Mixer composite — skip the deck channel
for (const channel of this.channels) {
  if (channel.id === this.baseChannelId) continue;   // deck isolation
  if (!channel.enabled || channel.fader <= 0.001) continue;
  // ... blend into mixerBuffer
}
```

#### Deck Channel Selection

The Deck tab provides selection buttons for PFL preview. Two types:

| Button | Behavior |
|--------|----------|
| **DECK MAIN** | PFL the deck-specific channel (`ch_base`) at 100% |
| **MIXER CH N** | PFL one of the mixer channels at 100% (ignoring its live fader/mute) |

This is controlled by `deckFocusChannelId`. When set to a mixer channel ID, the deck buffer renders that channel's pattern at full intensity. The mixer composite is unaffected.

---

## 5. Blend Modes

### 5.1 Naming Caution

In Marsin RGBWAU, `a` is **amber**, not alpha. Blend opacity must come from the mixer's channel fader/opacity, not from the `a` channel.

### 5.2 Recommended Phase 1 Modes

Lighting-friendly modes:

| Mode | Use | Notes |
|------|-----|-------|
| `normal` | base channel or full replacement | Linear mix against current output using channel fader |
| `over` | pattern over base with black transparent | Top pattern luminance becomes mask |
| `add` | sparks, pulses, glints | Adds light, clamps at 255 |
| `screen` | luminous overlays | Brighter than base without harsh clipping |
| `multiply` | dimming/masking looks | Less useful for emitters, but useful for shadow/mask patterns |
| `lighten` | take brighter channel | Useful for highlight layers |

Start with:

```text
normal
over
add
screen
```

Add `multiply` and `lighten` after the UI and engine path are stable.

### 5.3 Normal

```js
out = mix(out, src, fader)
```

```js
function blendNormal(out, src, fader) {
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(out[i] + (src[i] - out[i]) * fader);
  }
}
```

### 5.4 Over

`over` treats black from the overlay as transparent. Since there is no alpha channel, use top-channel brightness as the mask.

```js
function mask6(src, off) {
  return Math.max(
    src[off], src[off + 1], src[off + 2],
    src[off + 3], src[off + 4], src[off + 5]
  ) / 255;
}

function blendOver(out, src, fader) {
  for (let off = 0; off < out.length; off += 6) {
    const t = Math.min(1, mask6(src, off) * fader);
    for (let ch = 0; ch < 6; ch++) {
      out[off + ch] = Math.round(out[off + ch] + (src[off + ch] - out[off + ch]) * t);
    }
  }
}
```

This is the mode for "run a pattern over A" when the overlay pattern outputs black where it should not affect the base.

### 5.5 Add

```js
function blendAdd(out, src, fader) {
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.min(255, Math.round(out[i] + src[i] * fader));
  }
}
```

### 5.6 Screen

`screen` is usually the best default for light overlays. It brightens without the hard clipping of `add`.

```js
function blendScreen(out, src, fader) {
  for (let i = 0; i < out.length; i++) {
    const a = out[i] / 255;
    const b = (src[i] / 255) * fader;
    out[i] = Math.round((1 - (1 - a) * (1 - b)) * 255);
  }
}
```

### 5.7 Master Fader

Master fader applies after all channel compositing and before global effects/intensity:

```js
function applyMaster(out, master) {
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(out[i] * master);
  }
}
```

The existing `IntensityController` can still apply section-level dimmers after this.

---

## 6. Pattern Transition in BM

### 6.1 Base Transition

```js
await mixer.transitionBaseTo("12_breathing", {
  durationMs: 1000,
  mode: "normal"
});
```

Implementation:

1. Find current base channel.
2. Add new base channel at fader `0`.
3. Render both channels each frame.
4. Automate old fader down and new fader up.
5. Destroy old base channel when fader reaches `0`.
6. Rename/promote new channel to base.

### 6.2 Overlay Fade In/Out

Overlay add:

```js
await mixer.addChannel("13_sparkle", {
  name: "Sparkles",
  mode: "screen",
  fader: 0.0
});

mixer.fadeChannel("sparkles", 0.55, 750);
```

Overlay remove:

```js
mixer.fadeChannel("sparkles", 0.0, 500, { destroyOnComplete: true });
```

---

## 7. API Design

### 7.1 REST

List mixer state:

```http
GET /mixer
```

```json
{
  "master": 0.85,
  "maxChannels": 3,
  "channels": [
    {
      "id": "ch_1",
      "name": "Base",
      "pattern": "08_ocean_liner",
      "mode": "normal",
      "fader": 1.0,
      "enabled": true,
      "exports": []
    }
  ]
}
```

Set master:

```http
PATCH /mixer
{ "master": 0.8 }
```

Add channel:

```http
POST /mixer/channels
{
  "name": "Sparkles",
  "pattern": "13_sparkle",
  "mode": "screen",
  "fader": 0.5
}
```

Update channel:

```http
PATCH /mixer/channels/ch_2
{
  "name": "Top sparkle",
  "mode": "over",
  "fader": 0.35,
  "enabled": true
}
```

Change channel pattern:

```http
POST /mixer/channels/ch_2/pattern
{
  "pattern": "25_heartbeat",
  "transitionMs": 500
}
```

Set channel control:

```http
POST /mixer/channels/ch_2/control
{
  "id": 12345,
  "v0": 0.8,
  "v1": 0,
  "v2": 0
}
```

Transition base:

```http
POST /mixer/base
{
  "pattern": "12_breathing",
  "transitionMs": 1000
}
```

Remove channel:

```http
DELETE /mixer/channels/ch_2?fadeMs=500
```

### 7.2 WebSocket

Broadcast state changes:

```json
{
  "type": "mixer",
  "master": 0.85,
  "channels": []
}
```

Broadcast transition:

```json
{
  "type": "mixerTransition",
  "from": "08_ocean_liner",
  "to": "12_breathing",
  "durationMs": 1000,
  "progress": 0.42
}
```

---

## 8. Parameter Model

### 8.1 The Rule: No Untargeted Pattern Control Writes

In the mixer world, every pattern parameter write must target a specific channel.

This is the most important API rule:

```text
setControl(channelId, controlId, v0, v1, v2)
```

Never:

```text
setControl(controlId, v0, v1, v2)
```

The old single-runtime API could treat `/control` as globally meaningful because there was only one handle. With multiple channels, the same control ID may exist in more than one running pattern, and two channels may even run the same pattern with different values. A write without `channelId` is ambiguous and dangerous.

Mixer UI, CaptainPad, REST, WS, OSC, and future MIDI must route through a channel-aware control router.

### 8.2 Controller Scopes

There are three different parameter scopes:

| Scope | Example | Target | Persisted |
|-------|---------|--------|-----------|
| Mixer global | master fader, blackout | final mixed output or post-output controllers | yes |
| Shared pattern default | global speed/color from CPC | any channel explicitly linked to that shared param | yes |
| Channel-local pattern param | tail length on `ch_2` | exactly one WASM handle | yes |

These scopes must remain separate in API and UI.

### 8.3 Mixer Global Parameters

Global shared parameters affect the mixed output or shared hardware behavior:

- master fader
- blackout
- global effects
- section brightness/dimmers
- fogger trigger or global effect controls

These belong above or outside channel columns in CaptainPad.

They do not call `wasmHost.setControl()` directly unless they are explicitly shared pattern params. Most mixer-global controls are applied after the mixer output.

### 8.4 Channel-Local Pattern Parameters

Pattern-specific exports belong inside each channel column. Two channels can run the same pattern with different parameter values.

Example:

```text
Channel 1: Ocean
  speed = 0.25
  hue = 0.58

Channel 2: Ocean Copy
  speed = 0.75
  hue = 0.12
```

Channel-local controls are keyed by both channel and control ID:

```yaml
channels:
  - id: ch_2
    pattern: 13_sparkle
    localControls:
      "12345": { v0: 0.75, v1: 0, v2: 0 }
```

Runtime route:

```js
function setChannelControl(channelId, controlId, v0, v1, v2) {
  const channel = mixer.getChannel(channelId);
  channel.controlState[controlId] = { v0, v1, v2 };
  wasmHost.setControl(channel.handle, controlId, v0, v1, v2);
  persistMixerStateDebounced();
  broadcastMixerStateDebounced();
}
```

The old `/control` endpoint should become legacy/base-only or return an error when mixer mode is active:

```json
{
  "status": "ignored",
  "reason": "channel_required"
}
```

### 8.5 CPC Integration: Channel-Aware Shared Params

`docs/15_parameter_control.md` defines the Central Parameter Center as a singleton canonical store for shared pattern parameters. That model must be extended carefully for the mixer.

The CPC still owns the shared vocabulary:

```text
speed
direction
count
size
rotate
colorPalette1
colorPalette2
```

But injection must be channel-aware. A shared param update should affect only channels that are explicitly linked to that shared param.

Recommended binding model:

```js
channel.sharedBindings = {
  speed: {
    supported: true,
    controlId: 398112233,
    mode: "global",      // "global" or "override"
    overrideValue: null,
    dirty: false
  },
  colorPalette1: {
    supported: true,
    controlId: 91726354,
    mode: "override",
    overrideValue: { h: 0.58, s: 0.8, v: 1.0 },
    dirty: true
  }
};
```

Binding modes:

| Mode | Behavior |
|------|----------|
| `global` | Channel receives the CPC global value when it changes |
| `override` | Channel ignores CPC global value and uses its own channel-local shared value |
| `disabled` | Shared export is not injected for that channel |

This prevents accidental global changes while still allowing intentional shared control.

### 8.6 Shared Export Discovery Per Channel

When a channel compiles a pattern:

1. Read `wasmHost.getExports(channel.handle)`.
2. Split exports into local exports and `shared*` exports.
3. Build the channel's shared binding map from supported `shared*` functions.
4. Filter `shared*` exports out of the channel-local parameter UI.
5. Apply a full snapshot to that channel only.

Example:

```js
function onChannelCompiled(channel) {
  const exports = wasmHost.getExports(channel.handle);

  channel.localExports = exports.filter(e => !paramCenter.isSharedExport(e.name));
  channel.sharedBindings = paramCenter.buildBindingsForExports(exports, channel.previousBindings);

  paramRouter.applySnapshotToChannel(channel);
  channel.localControls = restoreLocalControls(channel.id, channel.pattern);
  applyLocalControlsToChannel(channel);
}
```

Full snapshot apply must target exactly one handle:

```js
function applySharedParamToChannel(channel, key, value) {
  const binding = channel.sharedBindings[key];
  if (!binding || !binding.supported || binding.mode === "disabled") return;

  const resolved = binding.mode === "override" ? binding.overrideValue : value;
  wasmHost.setControl(channel.handle, binding.controlId,
                      resolved.v0, resolved.v1, resolved.v2);
}
```

### 8.7 Dirty Injection Per Channel

CPC remains event-driven, but dirty state is per channel because channels can opt in/out independently.

```js
paramCenter.setGlobal("speed", 0.7, "ipad")
  -> canonical speed = 0.7
  -> mark linked channel bindings dirty
  -> broadcast shared param state

tick()
  paramRouter.flushDirtyChannels(mixer.channels)
  mixer.beginFrame(elapsed)
  mixer.renderAll6ch()
```

`flushDirtyChannels()` only calls `setControl()` for dirty `(channelId, key)` pairs.

### 8.8 Conflict Rules

The exclusive-variable rule from `docs/15_parameter_control.md` still applies inside each channel:

```text
If a pattern declares sharedSpeed(v), it must not also expose sliderSpeed(v)
that writes the same underlying variable.
```

In mixer mode, enforcement has two levels:

1. Per-channel export filtering hides `shared*` functions from local controls.
2. The control router blocks writes to shared-owned control IDs through local-control endpoints.

Rejected local write:

```json
{
  "status": "ignored",
  "reason": "shared_ownership",
  "channelId": "ch_2",
  "controlId": 398112233
}
```

### 8.9 API Additions for Parameters

Channel-local control:

```http
POST /mixer/channels/ch_2/control
{
  "id": 12345,
  "v0": 0.8,
  "v1": 0,
  "v2": 0
}
```

Set global shared param:

```http
POST /mixer/shared
{
  "key": "speed",
  "value": 0.7,
  "origin": "ipad-001"
}
```

Link or unlink a shared param for one channel:

```http
PATCH /mixer/channels/ch_2/shared/speed
{
  "mode": "global"
}
```

Set a channel override for a shared param:

```http
PATCH /mixer/channels/ch_2/shared/speed
{
  "mode": "override",
  "value": 0.35
}
```

Disable shared param injection for one channel:

```http
PATCH /mixer/channels/ch_2/shared/speed
{
  "mode": "disabled"
}
```

WebSocket equivalent:

```json
{
  "type": "setChannelControl",
  "channelId": "ch_2",
  "id": 12345,
  "v0": 0.8,
  "v1": 0,
  "v2": 0,
  "origin": "ipad-001"
}
```

```json
{
  "type": "setChannelSharedBinding",
  "channelId": "ch_2",
  "key": "speed",
  "mode": "override",
  "value": 0.35,
  "origin": "ipad-001"
}
```

### 8.10 State Persistence

Persist mixer and dimmer state in a per-scene directory structure, completely deprecating legacy global pattern state:

```yaml
# marsin_engine/states/<scene_name>/mixer_state.yaml
mixer:
  master: 0.85
  shared:
    speed: { value: 0.7, lastSource: ipad, lastOrigin: ipad-001 }
    colorPalette1: { value: { h: 0.1, s: 1.0, v: 1.0 }, lastSource: ipad }
  channels:
    - id: ch_1
      name: Base
      pattern: 08_ocean_liner
      mode: normal
      fader: 1.0
      sharedBindings:
        speed: { mode: global }
        colorPalette1: { mode: override, value: { h: 0.55, s: 0.9, v: 1.0 } }
      localControls:
        "12345": { v0: 0.5, v1: 0, v2: 0 }
```

Legacy `pattern_state.yaml` has been completely removed. State is now strictly channel-scoped and saved per scene, allowing multiple instances of the same pattern to retain independent values.

Recommended per-scene files (`marsin_engine/states/<scene_name>/`):

| File | Purpose |
|------|---------|
| `mixer_state.yaml` | channels, faders, modes, local controls, shared bindings |
| `dimmer_state.yaml` | per-section brightness tracking |
| `param_center_state.yaml` | CPC global shared defaults (if CPC remains separately persisted) |

On restore:

1. Load mixer global state.
2. Compile each channel pattern.
3. Rebuild local/shared export maps per channel.
4. Apply shared bindings per channel.
5. Apply local channel controls per channel.
6. Start render loop only after at least one channel is valid.

---

## 9. CaptainPad Mixer UI

This builds on the CaptainPad design in `docs/16_captain_pad.md`: persistent iPad control deck, left navigation rail, high-tactility controls, and always-visible engine status.

### 9.1 Navigation

Add a mixer workspace to the live performance surface:

```text
Control Deck
  Live Mixer
  Pattern Queue
  Global Controls
```

The mixer should be the default Control Deck view during the event.

### 9.2 Layout

Use independent vertical channel columns. Maximum 3.

```text
-------------------------------------------------------
 Status: connected | FPS | active model | master fader
-------------------------------------------------------
 [Global controls: master, blackout, dimmers, effects]
-------------------------------------------------------
 | Channel 1       | Channel 2       | + Add Channel |
 | Base            | Sparkles        |               |
 | Pattern list    | Pattern list    |               |
 | Parameters      | Parameters      |               |
 | Channel settings| Channel settings|               |
-------------------------------------------------------
```

If 3 channels are active:

```text
| Channel 1 | Channel 2 | Channel 3 |
```

No fourth channel is allowed. The `+` button is hidden or disabled at 3 channels.

### 9.3 Channel Column Structure

Each channel is a compact vertical stack:

```text
Channel Header
  name field
  enable toggle
  remove button

Pattern
  searchable compact picker from existing pattern list
  current pattern label

Parameters
  pattern-specific controls
  shared-param bindings/overrides
  compact sliders/knobs/toggles

Channel Settings
  fader
  blend mode
  solo/mute
```

The order is intentional:

1. Pattern selection first
2. Parameters under selected pattern
3. Channel settings at the bottom

This matches how a performer thinks: choose what the layer is, tune the content, then set how it sits in the mix.

### 9.4 Pattern Picker

The pattern picker should use the existing pattern list:

```http
GET /patterns
```

or current equivalent:

```http
GET /list-patterns
```

UI behavior:

- tap current pattern to open searchable sheet
- recent patterns at top
- pattern compile errors shown inline in the channel
- switching a channel pattern can use a short per-channel transition

### 9.5 Compact Parameter Controls

Parameter area should be dense but touch-safe:

- shared param rows supported by this pattern, with link/override state
- sliders for numeric exports
- toggles for booleans
- color swatches or compact HSV control for color exports
- trigger buttons for triggers
- collapse advanced controls

Recommended parameter row:

```text
[label]        [value]
[----slider-----------]
```

Shared-param rows need a small mode control:

```text
Speed       [linked]  0.70
[----slider-----------]
```

Modes:

| UI Label | Binding |
|----------|---------|
| `linked` | uses CPC global value |
| `local` | channel override |
| `off` | no shared injection for this channel |

When `linked`, the value follows the global shared parameter row above the columns. When `local`, edits affect only that channel. This is what prevents an iPad adjustment in one channel from accidentally changing the same pattern running in another channel.

Avoid giant cards. Each channel column already acts as the frame.

### 9.6 Channel Settings

Compact controls at the bottom:

- channel fader: vertical or horizontal, always visible
- blend mode segmented menu or small dropdown
- mute toggle
- solo toggle
- output meter preview if cheap

Blend mode labels:

```text
Normal
Over
Add
Screen
```

Use `Screen` as the recommended overlay mode for luminous patterns.

### 9.7 Global Controls

Global shared controls sit above the channel columns:

- master fader
- blackout
- global effects
- section dimmers
- CPC shared defaults such as speed/color, clearly labeled as linked-channel defaults
- connection/FPS status

Master fader must be large enough for live use and always visible in the Control Deck.

Global CPC shared controls should show how many channels are linked:

```text
Speed 0.70       linked: 2 channels
Color 1          linked: 1 channel
```

Changing a global shared control only affects channels with that shared key in `linked` mode.

### 9.8 iPad Interaction Details

- All faders update over WebSocket for low latency.
- Channel pattern changes use HTTP/REST because they can compile/start runtimes.
- Local optimistic UI is okay for fader moves.
- Pattern compile failures roll back the channel picker and show error text.
- Remove channel should fade out by default, not hard stop, unless user long-presses or confirms immediate remove.

---

## 10. Example Use Cases

### 10.1 Run Sparkle Over Ocean

```text
Channel 1
  name: Ocean
  pattern: 08_ocean_liner
  mode: normal
  fader: 1.0

Channel 2
  name: Sparkles
  pattern: 13_sparkle
  mode: screen
  fader: 0.45

Master
  0.85
```

### 10.2 Add Heartbeat Pulse

```text
Channel 3
  name: Heartbeat
  pattern: 25_heartbeat
  mode: add
  fader: 0.25
```

### 10.3 Transition Base Pattern

```text
Channel 1: Ocean -> Breathing
duration: 1000ms
Channel 2 and 3 continue running
```

The base transition should not interrupt overlay channels.

---

## 11. Implementation Phases

### Phase 1: Engine Mixer Core

Files:

- `marsin_engine/lib/wasm_host.js`
- `marsin_engine/lib/pattern_mixer.js`
- `marsin_engine/lib/channel_param_router.js`
- `marsin_engine/engine.js`
- `marsin_engine/lib/api_server.js`

Behavior:

- load WASM module once
- run up to 3 channels
- support normal/add/screen/over
- support master fader
- require `channelId` for all pattern control writes
- persist channel-local controls separately
- expose `/mixer` REST and WS state

### Phase 2: Base Pattern Transition

Behavior:

- `POST /mixer/base`
- old base fades out
- new base fades in
- old base runtime destroyed

### Phase 3: CaptainPad Mixer UI

Files:

- `CaptainPad/app/(tabs)/index.tsx` or Control Deck route
- channel column components
- parameter control components
- mixer API client

Behavior:

- 1 to 3 columns
- add/remove channel
- pattern picker
- compact pattern controls
- linked/local/off shared parameter binding controls
- channel settings
- master fader

### Phase 4: Persistence and Autopilot

Behavior:

- persist mixer state
- restore local controls and shared bindings per channel
- autopilot can transition base only, without destroying overlays
- optional scenes/presets for named channel stacks

### Phase 5: CPC Mixer Integration

Behavior:

- adapt Central Parameter Center to build channel-specific shared bindings
- keep canonical shared defaults server-authoritative
- inject shared params only into linked channels
- block shared-owned control IDs from local channel-control endpoints
- broadcast rejected writes with `channel_required` or `shared_ownership`

---

## 12. Open Questions

1. Should the first channel always be the base, or can any channel be designated base?
2. Should `over` use max RGBWAU channel as mask, RGB luminance only, or a future explicit mask output convention?
3. Should channel order be fixed columns in Phase 1 or draggable from the start?
4. Should CaptainPad expose `multiply` and `lighten` initially, or hide them until tested on the real fixtures?
5. Should mixer state restore automatically on engine restart, or require a "restore last mix" action?
6. Should shared parameters default to `linked` or `local` when a new channel is added?
7. Should the old `/control` endpoint hard-error in mixer mode, or keep controlling only the first/base channel for compatibility?

---

## 13. References

| File | Purpose |
|------|---------|
| [engine.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/engine.js) | Current single-runtime render loop |
| [api_server.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/lib/api_server.js) | Current pattern/control API |
| [marsin_wasm_runtime.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/lib/marsin_wasm_runtime.js) | Current one-handle wrapper |
| [autopilot.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/lib/autopilot.js) | Future base-channel transition trigger |
| [intensity_controller.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/lib/intensity_controller.js) | Post-mixer section intensity |
| [global_effects_controller.js](file:///c:/Users/sina_/workspace/BM26-Titanic/marsin_engine/lib/global_effects_controller.js) | Post-mixer global effects |
| [15_parameter_control.md](file:///c:/Users/sina_/workspace/BM26-Titanic/docs/15_parameter_control.md) | Reserved parameter-control design slot |
| [16_captain_pad.md](file:///c:/Users/sina_/workspace/BM26-Titanic/docs/16_captain_pad.md) | iPad UX principles and app structure |
| [15_parameter_control.md](file:///c:/Users/sina_/workspace/BM26-Titanic/docs/15_parameter_control.md) | Shared parameter ownership, persistence, and source arbitration |
