# Design Doc: Global Effect Macros

**Status:** Proposed  
**Author:** Antigravity  
**Related Docs:** `09_dmx_fixture_models.md` · `16_captain_pad.md` · `12_marsin_engine.md` · `18_marsin_mixer.md`

---

## 1. Executive Summary

This document proposes the technical design for **Global Effect Macros** in the BM26-Titanic lighting controller. 

Unlike pattern-local parameters (which only modify individual Pixelblaze scripts) or fixture-native DMX effects (which run on independent fixture chips and cannot be phase-synchronized), Global Effect Macros are **engine-side, show-level lighting controls** applied to the combined post-mixer output immediately before DMX/sACN encoding.

By owning effect execution at the engine level, we gain **engine-frame control** over phase alignment, envelope shapes, and global color overrides. To ensure scalability and ease of use, we separate the system into a **modular Effect Library** (composed of individual engine effect files under a new `./marsin_engine/effects` directory) and **six user-configurable Performance Slots** rendered in the CaptainPad UI.

---

## 2. Core Concepts & Pipeline Order

### 2.1 Native Channel Suppression Rule
To ensure engine-side software effects are never distorted or fought by physical fixture hardware loops:
> **Explicit v1 Rule:** Native strobe channels are forced to **DMX value 0** in the fixture DMX encoder/fixture model mapping layer (not in the RGBWAU pixel macro pass). This ensures the physical fixture's native oscillators remain inactive and never fight the software global effects.

### 2.2 Recommended Output Pipeline
Global macros execute sequentially at the tail end of the rendering loop inside `engine.js` after composition and before sACN mapping:

```
1. Render Mixer Frame
   └─ PatternMixer.renderAll6ch() → outputBuffer

2. Unpack outputBuffer into model.pixels
   └─ Maps buffer floats to px.r, px.g, px.b, px.w, px.a, px.u

3. Apply Global Effect Macros (NEW)
   └─ GlobalEffectsController.apply({ pixels, frameIndex, nowMs })
      ├─ Apply active Color Wash Takeover
      ├─ Apply active Feedback Trails
      ├─ Apply active Drop Hit / Whiteout
      └─ Apply active Software Sync Strobe

4. Apply Master & Section Dimmers
   └─ IntensityController.apply(model.pixels) (scales intensities)

5. Apply Blackout / Safety Overrides
   └─ Forces all pixels to 0 if active

6. Encode DMX/sACN & Suppress Native Strobes
   └─ mapPixelsToSacn(model.pixels, dmxRouter) (forces CH2/CH8 native strobe to 0)

7. Send output
   └─ sacnOut.sendFrame(dmxBuffers)
```

> [!NOTE]
> **Macro Ordering & Feedback Trails:** Feedback Trails runs before Drop Hit by default so momentary whiteouts do not contaminate the feedback history. A future `captureDropHits` option may move Drop Hit before Feedback Trails for intentional long-exposure flash trails.

---

## 3. Macro Stack Specifications (v1)

### 3.1 Software Sync Strobe
Rather than letting physical fixtures flash out of phase, the engine implements a single, frame-locked ON/OFF gate running off the master 40Hz clock, producing a **frame-synchronized full-rig strobe** where every fixture receives the same ON/OFF gate for the same engine output frame.

#### Frame-Rate Quantization
At 40 FPS, the timing resolution is 25 ms. Software strobe rates are quantized to whole frame cycles:
* $4\text{ Hz} \rightarrow 40 / 4 = 10\text{ frames per cycle} \rightarrow 5\text{ frames ON}, 5\text{ frames OFF}$.
* $10\text{ Hz} \rightarrow 40 / 10 = 4\text{ frames per cycle} \rightarrow 2\text{ frames ON}, 2\text{ frames OFF}$.
* Arbitrary values (e.g. 7 Hz) will round: $\text{round}(40 / 7) = 6\text{ frames per cycle}$ ($\text{actualHz} = 40 / 6 = 6.67\text{ Hz}$).

For v1, preset rates are preferred over arbitrary slider values because frame-locked software strobe quantizes rates to whole frame cycles. The engine exposes `actualHz = frameRate / framesPerCycle` when the requested rate is quantized.

#### Safety Limits & UI Design Constraints
Epilepsy Society research states that common photosensitive seizure triggers occur between **5–30 Hz**, noting **16–25 Hz** as especially high-risk. The UK Health and Safety Executive (HSE) recommends that strobing at public events/clubs be restricted to **4 Hz or lower**.

> [!IMPORTANT]
> **Server-Side Safety Enforcement:** CaptainPad UI restrictions are advisory only. The server must enforce strobe safety behavior (such as rejecting toggle/hold for `max_20hz` rates, or burst clamping) because WebSocket/API callers can bypass UI constraints.

For public-facing defaults, CaptainPad treats 4 Hz as the maximum normal toggle rate. Higher rates are supported only as warned, hold-to-activate, or transient burst effects:

| Preset ID | Name | Target Hz | Actual Hz (at 40 FPS) | Duty Cycle | Safety Tier | UI Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `pulse_2hz` | 2 Hz Pulse | 2.0 | 2.0 (20f cycle) | 0.5 | Normal | Standard toggle |
| `sync_4hz` | 4 Hz Sync | 4.0 | 4.0 (10f cycle) | 0.5 | Normal | Standard toggle |
| `punch_5hz` | 5 Hz Punch | 5.0 | 5.0 (8f cycle) | 0.5 | Warning | Yellow warning border / toggle |
| `hard_10hz` | 10 Hz Hard | 10.0 | 10.0 (4f cycle) | 0.5 | Hold Only | Press-and-hold activation |
| `max_20hz` | 20 Hz Max | 20.0 | 20.0 (2f cycle) | 0.5 | Expert Burst | 1s auto-timeout burst trigger (burst-only) |

#### Strobe Logic Function
```javascript
function getFrameLockedStrobeTiming({ hz, duty = 0.5, frameRate = 40 }) {
  const framesPerCycle = Math.max(2, Math.round(frameRate / hz));
  const onFrames = Math.max(1, Math.round(framesPerCycle * duty));
  return {
    framesPerCycle,
    onFrames,
    actualHz: frameRate / framesPerCycle,
  };
}

function getFrameLockedStrobeGate({ frameIndex, startedAtFrame, framesPerCycle, onFrames }) {
  const localFrame = Math.max(0, frameIndex - startedAtFrame);
  const phaseFrame = localFrame % framesPerCycle;
  return phaseFrame < onFrames ? 1.0 : 0.0;
}

function applySoftwareStrobe({ pixels, gate, intensity = 1.0 }) {
  const scale = gate > 0 ? intensity : 0.0;

  for (const px of pixels) {
    px.r *= scale;
    px.g *= scale;
    px.b *= scale;
    px.w *= scale;
    px.a *= scale;
    px.u *= scale;
  }
}
```

---

### 3.2 Drop Hit / Whiteout
A momentary, full-rig brightness/color punch using an envelope generator. At 40 FPS, envelope timing is quantized to ~25 ms frames; attack values below 25 ms behave as near-instant attacks.

#### Envelope Presets
* **White Drop:** `[1.0, 1.0, 1.0, 1.0, 0.2, 0.0]`, 25ms attack, 75ms hold, 300ms release (ideal for drop emphasis).
* **Iceberg Flash:** `[0.3, 0.7, 1.0, 0.5, 0.0, 0.2]`, 20ms attack, 90ms hold, 500ms release.
* **Vintage Burst:** `[1.0, 0.65, 0.25, 0.2, 1.0, 0.0]`, 25ms attack, 120ms hold, 600ms release.

#### Implementation Details
```javascript
function envelopeValue({ elapsedMs, attackMs, holdMs, releaseMs }) {
  if (elapsedMs < attackMs) {
    return elapsedMs / attackMs;
  }
  if (elapsedMs < attackMs + holdMs) {
    return 1.0;
  }
  const r = elapsedMs - attackMs - holdMs;
  if (r < releaseMs) {
    return 1.0 - r / releaseMs;
  }
  return 0.0;
}

function applyDropHit({ pixels, color6, amount, blendMode = "add" }) {
  if (amount <= 0.001) return;

  for (const px of pixels) {
    const target = [
      color6[0] * amount,
      color6[1] * amount,
      color6[2] * amount,
      color6[3] * amount,
      color6[4] * amount,
      color6[5] * amount,
    ];

    if (blendMode === "replace") {
      const invAmount = 1.0 - amount;
      px.r = px.r * invAmount + color6[0] * amount;
      px.g = px.g * invAmount + color6[1] * amount;
      px.b = px.b * invAmount + color6[2] * amount;
      px.w = px.w * invAmount + color6[3] * amount;
      px.a = px.a * invAmount + color6[4] * amount;
      px.u = px.u * invAmount + color6[5] * amount;
    } else if (blendMode === "max") {
      px.r = Math.max(px.r, target[0]);
      px.g = Math.max(px.g, target[1]);
      px.b = Math.max(px.b, target[2]);
      px.w = Math.max(px.w, target[3]);
      px.a = Math.max(px.a, target[4]);
      px.u = Math.max(px.u, target[5]);
    } else {
      // Default: "add"
      px.r = Math.min(1.0, px.r + target[0]);
      px.g = Math.min(1.0, px.g + target[1]);
      px.b = Math.min(1.0, px.b + target[2]);
      px.w = Math.min(1.0, px.w + target[3]);
      px.a = Math.min(1.0, px.a + target[4]);
      px.u = Math.min(1.0, px.u + target[5]);
    }
  }
}
```

---

### 3.3 Color Wash Takeover / Palette Override
A global colorizing takeover macro that tints or overrides the rendered outputs.

#### Presets
* **Ocean Blue:** `[0.05, 0.20, 1.00, 0.00, 0.00, 0.15]`, amount: 0.7, mode: `tint`
* **Iceberg Cyan:** `[0.15, 0.85, 1.00, 0.20, 0.00, 0.10]`, amount: 0.75, mode: `tint`
* **Emergency Red:** `[1.00, 0.00, 0.00, 0.00, 0.20, 0.00]`, amount: 0.9, mode: `replace`
* **Vintage Amber:** `[1.00, 0.45, 0.05, 0.10, 1.00, 0.00]`, amount: 0.65, mode: `tint`

#### Implementation Details
```javascript
function applyColorWash({ pixels, color6, amount, mode = "tint" }) {
  const a = Math.max(0, Math.min(1, amount));
  const ia = 1 - a;

  for (const px of pixels) {
    if (mode === "replace") {
      px.r = px.r * ia + color6[0] * a;
      px.g = px.g * ia + color6[1] * a;
      px.b = px.b * ia + color6[2] * a;
      px.w = px.w * ia + color6[3] * a;
      px.a = px.a * ia + color6[4] * a;
      px.u = px.u * ia + color6[5] * a;
    } else if (mode === "multiply") {
      px.r *= ia + color6[0] * a;
      px.g *= ia + color6[1] * a;
      px.b *= ia + color6[2] * a;
      px.w *= ia + color6[3] * a;
      px.a *= ia + color6[4] * a;
      px.u *= ia + color6[5] * a;
    } else if (mode === "max") {
      px.r = Math.max(px.r, color6[0] * a);
      px.g = Math.max(px.g, color6[1] * a);
      px.b = Math.max(px.b, color6[2] * a);
      px.w = Math.max(px.w, color6[3] * a);
      px.a = Math.max(px.a, color6[4] * a);
      px.u = Math.max(px.u, color6[5] * a);
    } else {
      // Default: tint/additive hybrid
      px.r = Math.min(1, px.r * ia + (px.r + color6[0]) * 0.5 * a);
      px.g = Math.min(1, px.g * ia + (px.g + color6[1]) * 0.5 * a);
      px.b = Math.min(1, px.b * ia + (px.b + color6[2]) * 0.5 * a);
      px.w = Math.min(1, px.w * ia + (px.w + color6[3]) * 0.5 * a);
      px.a = Math.min(1, px.a * ia + (px.a + color6[4]) * 0.5 * a);
      px.u = Math.min(1, px.u * ia + (px.u + color6[5]) * 0.5 * a);
    }
  }
}
```

---

### 3.4 Feedback Trails / Ghost Trails
A temporal accumulation overlay that injects previously rendered frames back into the active output, creating trailing and glowing movement indicators.

#### Presets
* **Soft Afterimage:** `decay: 0.88`, `injection: 0.45`, `mix: 0.45`, `blendMode: "add"`, `colorBleed: 0.02`
* **Ghost Ship:** `decay: 0.94`, `injection: 0.25`, `mix: 0.60`, `blendMode: "replace"`, `colorBleed: 0.12`

#### Implementation Details (Supported blend modes: `add` | `replace` | `max`)
```javascript
function applyFeedbackTrails({ pixels, trailBuffer, decay, injection, mix, blendMode = "add", colorBleed = 0 }) {
  for (let i = 0; i < pixels.length; i++) {
    const px = pixels[i];
    const off = i * 6;

    // Read previous trail value
    let tr = trailBuffer[off + 0];
    let tg = trailBuffer[off + 1];
    let tb = trailBuffer[off + 2];
    let tw = trailBuffer[off + 3];
    let ta = trailBuffer[off + 4];
    let tu = trailBuffer[off + 5];

    // Inject active pixel values into trails
    tr = tr * decay + px.r * injection;
    tg = tg * decay + px.g * injection;
    tb = tb * decay + px.b * injection;
    tw = tw * decay + px.w * injection;
    ta = ta * decay + px.a * injection;
    tu = tu * decay + px.u * injection;

    // Apply color bleed / trail chromatic dispersion
    if (colorBleed > 0) {
      tr += tg * colorBleed;
      tb += tr * colorBleed;
    }

    // Clamp trails
    trailBuffer[off + 0] = Math.min(1.0, tr);
    trailBuffer[off + 1] = Math.min(1.0, tg);
    trailBuffer[off + 2] = Math.min(1.0, tb);
    trailBuffer[off + 3] = Math.min(1.0, tw);
    trailBuffer[off + 4] = Math.min(1.0, ta);
    trailBuffer[off + 5] = Math.min(1.0, tu);

    // Mix back into live pixel values
    if (blendMode === "replace") {
      px.r = px.r * (1 - mix) + trailBuffer[off + 0] * mix;
      px.g = px.g * (1 - mix) + trailBuffer[off + 1] * mix;
      px.b = px.b * (1 - mix) + trailBuffer[off + 2] * mix;
      px.w = px.w * (1 - mix) + trailBuffer[off + 3] * mix;
      px.a = px.a * (1 - mix) + trailBuffer[off + 4] * mix;
      px.u = px.u * (1 - mix) + trailBuffer[off + 5] * mix;
    } else if (blendMode === "max") {
      px.r = Math.max(px.r, trailBuffer[off + 0] * mix);
      px.g = Math.max(px.g, trailBuffer[off + 1] * mix);
      px.b = Math.max(px.b, trailBuffer[off + 2] * mix);
      px.w = Math.max(px.w, trailBuffer[off + 3] * mix);
      px.a = Math.max(px.a, trailBuffer[off + 4] * mix);
      px.u = Math.max(px.u, trailBuffer[off + 5] * mix);
    } else {
      // Default: "add"
      px.r = Math.min(1.0, px.r + trailBuffer[off + 0] * mix);
      px.g = Math.min(1.0, px.g + trailBuffer[off + 1] * mix);
      px.b = Math.min(1.0, px.b + trailBuffer[off + 2] * mix);
      px.w = Math.min(1.0, px.w + trailBuffer[off + 3] * mix);
      px.a = Math.min(1.0, px.a + trailBuffer[off + 4] * mix);
      px.u = Math.min(1.0, px.u + trailBuffer[off + 5] * mix);
    }
  }
}
```

---

## 4. Effect Library & Six Performance Slots

The macro architecture is divided into two operational layers:
1. **Effect Library:** The registry of all supported macro types, parameter profiles, and presets. Helper functions in the library are stateless.
2. **Performance Slots:** Exactly 6 user-configurable UI bindings mapping physical inputs/taps to specific library presets.

> [!IMPORTANT]
> **State Ownership Rule:** Effect library entries define static metadata, presets, validation parameters, and pure apply/math helpers. All active, mutable runtime state (such as envelopes, counters, feedback trails buffers, and selected presets) is owned and managed exclusively by `GlobalEffectsController`.
> 
> **State Ownership Clarification:** Effect library entries define metadata, presets, validation, and pure helper functions. Runtime active state is owned by `GlobalEffectsController`, not by the registry object. This avoids accidental singleton mutable state inside the library.

### 4.1 Modular File Structure
To enforce clean separation of concerns, the system's files are structured under `./marsin_engine` and `./marsin_engine/effects`:

```
marsin_engine/
  ├── effects/                   # Modular Effect Files
  │    ├── strobe.js              # Sync Strobe logic & presets
  │    ├── dropHit.js             # Drop Hit envelope logic & presets
  │    ├── colorWash.js           # Color Wash takeover logic & presets
  │    └── feedbackTrails.js      # Feedback Trails logic & presets
  └── lib/
       ├── global_effects_controller.js  # Executes active macros
       ├── global_effect_library.js      # Consolidated Effect Library registry
       └── global_effect_slot_manager.js # Manages UI Slot assignments & dispatching
```

---

### 4.2 Global Effect Library Registry
The core effect library defines all active macros and their capabilities:

```javascript
// marsin_engine/lib/global_effect_library.js
import { strobeEffect } from '../effects/strobe.js';
import { dropHitEffect } from '../effects/dropHit.js';
import { colorWashEffect } from '../effects/colorWash.js';
import { feedbackTrailsEffect } from '../effects/feedbackTrails.js';

export const GLOBAL_EFFECT_LIBRARY = {
  strobe: {
    id: 'strobe',
    name: 'Software Sync Strobe',
    category: 'gate',
    behaviorTypes: ['toggle', 'hold', 'burst'],
    singleton: true,
    safetySensitive: true,
    presets: {
      pulse_2hz: {
        label: '2 Hz Pulse',
        params: { hz: 2, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        safetyTier: 'normal'
      },
      sync_4hz: {
        label: '4 Hz Sync',
        params: { hz: 4, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'toggle',
        safetyTier: 'normal'
      },
      hard_10hz: {
        label: '10 Hz Hard',
        params: { hz: 10, duty: 0.5, intensity: 1.0 },
        defaultBehavior: 'hold',
        safetyTier: 'hold_only'
      },
      max_20hz: {
        label: '20 Hz Max',
        params: { hz: 20, duty: 0.5, intensity: 1.0, durationMs: 1000 },
        defaultBehavior: 'burst',
        safetyTier: 'expert_burst'
      }
    },
    apply: strobeEffect.apply
  },

  dropHit: {
    id: 'dropHit',
    name: 'Drop Hit / Whiteout',
    category: 'envelope',
    behaviorTypes: ['trigger'],
    singleton: false,
    safetySensitive: false,
    presets: {
      white_drop: {
        label: 'White Drop',
        params: {
          color: [1.0, 1.0, 1.0, 1.0, 0.2, 0.0],
          intensity: 1.0,
          attackMs: 25,
          holdMs: 75,
          releaseMs: 300,
          blendMode: 'add'
        },
        defaultBehavior: 'trigger'
      },
      iceberg_flash: {
        label: 'Iceberg Flash',
        params: {
          color: [0.3, 0.7, 1.0, 0.5, 0.0, 0.2],
          intensity: 1.0,
          attackMs: 20,
          holdMs: 90,
          releaseMs: 500,
          blendMode: 'add'
        },
        defaultBehavior: 'trigger'
      }
    },
    apply: dropHitEffect.apply
  },

  colorWash: {
    id: 'colorWash',
    name: 'Color Wash Takeover',
    category: 'color',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      ocean_blue: {
        label: 'Ocean Blue',
        params: {
          color: [0.05, 0.20, 1.00, 0.00, 0.00, 0.15],
          amount: 0.7,
          mode: 'tint'
        },
        defaultBehavior: 'toggle'
      },
      emergency_red: {
        label: 'Emergency Red',
        params: {
          color: [1.00, 0.00, 0.00, 0.00, 0.20, 0.00],
          amount: 0.9,
          mode: 'replace'
        },
        defaultBehavior: 'toggle'
      }
    },
    apply: colorWashEffect.apply
  },

  feedbackTrails: {
    id: 'feedbackTrails',
    name: 'Feedback Trails / Ghost Trails',
    category: 'feedback',
    behaviorTypes: ['toggle'],
    singleton: true,
    safetySensitive: false,
    presets: {
      soft_afterimage: {
        label: 'Soft Afterimage',
        params: {
          decay: 0.88,
          injection: 0.45,
          mix: 0.45,
          blendMode: 'add',
          colorBleed: 0.02,
          resetOnEnable: true
        },
        defaultBehavior: 'toggle'
      },
      ghost_ship: {
        label: 'Ghost Ship',
        params: {
          decay: 0.94,
          injection: 0.25,
          mix: 0.60,
          blendMode: 'replace',
          colorBleed: 0.12,
          resetOnEnable: true
        },
        defaultBehavior: 'toggle'
      }
    },
    apply: feedbackTrailsEffect.apply
  }
};
```

---

### 4.3 Active Performance Slots Schema
Exactly six performance slots are loaded and verified on start.

> [!IMPORTANT]
> **V1 Constraint:** To prevent server-side boot validation failures, all default slot assignments must map strictly to **fully implemented V1 effects and presets** inside `GLOBAL_EFFECT_LIBRARY`. References to future/unimplemented effects (like `lightningStrike` or `waterlineSweep`) are prohibited in default slots.

#### Default Slots Configuration:
```yaml
globalEffectSlots:
  - slotId: 1
    enabled: true
    label: "4 Hz Sync"
    effectId: "strobe"
    presetId: "sync_4hz"
    behavior: "toggle"
    paramsOverride: {}

  - slotId: 2
    enabled: true
    label: "White Drop"
    effectId: "dropHit"
    presetId: "white_drop"
    behavior: "trigger"
    paramsOverride: {}

  - slotId: 3
    enabled: true
    label: "Ocean Wash"
    effectId: "colorWash"
    presetId: "ocean_blue"
    behavior: "toggle"
    paramsOverride: {}

  - slotId: 4
    enabled: true
    label: "Ghost Trails"
    effectId: "feedbackTrails"
    presetId: "ghost_ship"
    behavior: "toggle"
    paramsOverride: {}

  - slotId: 5
    enabled: true
    label: "Iceberg Flash"
    effectId: "dropHit"
    presetId: "iceberg_flash"
    behavior: "trigger"
    paramsOverride: {}

  - slotId: 6
    enabled: true
    label: "20 Hz Burst"
    effectId: "strobe"
    presetId: "max_20hz"
    behavior: "burst"
    paramsOverride:
      durationMs: 1000
```

---

### 4.4 Slot Behavior Semantics
UI clicks or commands route according to resolved behavior types:
* **Toggle:** Toggles persistent active state. If active, switches to the new preset if it differs, or deactivates if the same.
* **Trigger:** Instantly fire envelopes.
* **Hold:** Sends WebSocket `down` (activate) and `up` (deactivate) messages.
* **Burst:** Auto-timeout execution.

---

### 4.5 Slot Resolution & Dispatch Logic (Preset-Aware Switching)
Tapping a different slot pointing to the same singleton effect type (like `strobe` or `colorWash`) must smoothly **switch the active preset** rather than disabling the effect:

```javascript
// marsin_engine/lib/global_effect_slot_manager.js

export function resolveSlotBinding({ slot, library }) {
  if (!slot.enabled) {
    throw new Error(`Slot ${slot.slotId} is disabled`);
  }

  const effect = library[slot.effectId];
  if (!effect) {
    throw new Error(`Unknown effectId: ${slot.effectId}`);
  }

  const preset = effect.presets?.[slot.presetId];
  if (!preset) {
    throw new Error(`Unknown presetId '${slot.presetId}' for effect '${slot.effectId}'`);
  }

  const params = {
    ...preset.params,
    ...(slot.paramsOverride || {})
  };

  const behavior = slot.behavior || preset.defaultBehavior;

  if (!effect.behaviorTypes.includes(behavior)) {
    throw new Error(`Effect '${slot.effectId}' does not support behavior '${behavior}'`);
  }

  return {
    slotId: slot.slotId,
    effectId: slot.effectId,
    presetId: slot.presetId,
    label: slot.label || preset.label,
    behavior,
    params,
    safetyTier: preset.safetyTier || 'normal'
  };
}

export class GlobalEffectSlotManager {
  constructor(controller, slotsConfig = []) {
    this.controller = controller;
    this.slots = slotsConfig;
  }

  dispatchSlotAction({ slotId, action, frameIndex, nowMs }) {
    const slot = this.slots.find(s => s.slotId === slotId);
    if (!slot) throw new Error(`Invalid slotId: ${slotId}`);

    const resolved = resolveSlotBinding({ slot, library: GLOBAL_EFFECT_LIBRARY });

    if (resolved.safetyTier === 'expert_burst' && action === 'toggle') {
      throw new Error('Expert burst effects may not be toggled; use burst or hold.');
    }

    switch (resolved.effectId) {
      case 'strobe':
        this.dispatchStrobe({ resolved, action, frameIndex });
        break;

      case 'dropHit':
        if (action === 'trigger' || action === 'activate' || action === 'down') {
          this.controller.triggerDropHit(resolved.params, nowMs);
        }
        break;

      case 'colorWash':
        this.dispatchColorWash({ resolved, action });
        break;

      default:
        this.controller.triggerGenericMacro({
          effectId: resolved.effectId,
          params: resolved.params,
          action,
          frameIndex,
          nowMs
        });
    }
  }

  dispatchStrobe({ resolved, action, frameIndex }) {
    const p = resolved.params;

    if (resolved.behavior === 'burst') {
      this.controller.triggerStrobeBurst(p.hz, p.durationMs ?? 1000, frameIndex, {
        presetId: resolved.presetId,
        slotId: resolved.slotId
      });
      return;
    }

    if (resolved.behavior === 'hold') {
      if (action === 'down' || action === 'activate') {
        this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
          presetId: resolved.presetId,
          slotId: resolved.slotId
        });
      } else if (action === 'up' || action === 'deactivate') {
        this.controller.stopStrobe();
      }
      return;
    }

    if (resolved.behavior === 'toggle') {
      const sameStrobe = 
        this.controller.strobeActive &&
        this.controller.activeStrobePresetId === resolved.presetId;

      if (sameStrobe) {
        this.controller.stopStrobe();
      } else {
        this.controller.setStrobe(true, p.hz, p.duty, p.intensity, frameIndex, {
          presetId: resolved.presetId,
          slotId: resolved.slotId
        });
      }
    }
  }

  dispatchColorWash({ resolved, action }) {
    const p = resolved.params;
    if (action === 'deactivate' || action === 'up') {
      this.controller.setColorWash(false);
      return;
    }

    if (resolved.behavior === 'toggle') {
      const sameWash =
        this.controller.colorWashConfig.enabled &&
        this.controller.colorWashConfig.preset === resolved.presetId;

      if (sameWash) {
        this.controller.setColorWash(false);
      } else {
        this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode);
      }
    } else {
      // Standard trigger/activate action
      this.controller.setColorWash(true, resolved.presetId, p.amount, p.mode);
    }
  }
}
```

#### Transient Active States on Controller:
Inside `GlobalEffectsController` we explicitly track variables to enable preset-aware UI highlights:
* `this.activeStrobePresetId = null;`
* `this.activeStrobeSlotId = null;`

---

## 5. API Specification & Validation Rules

### 5.1 Query Configuration and Status
* `GET /global-effect-library` — Returns list of all available effects and presets.
* `GET /global-effect-slots` — Returns slot bindings configuration.
* `GET /global-effect-slots/status` — Returns slot structures appended with active runtime flags:
  ```json
  {
    "slots": [
      {
        "slotId": 1,
        "label": "4 Hz Sync",
        "effectId": "strobe",
        "presetId": "sync_4hz",
        "behavior": "toggle",
        "active": true,
        "safetyTier": "normal"
      }
    ]
  }
  ```

#### Resolving Active Flag per Slot:
* `strobe`: `active = true` if `strobeActive === true` AND `activeStrobePresetId === slot.presetId` (or matches `activeStrobeSlotId`).
* `colorWash`: `active = true` if `colorWashConfig.enabled === true` AND `colorWashConfig.preset === slot.presetId`.
* `feedbackTrails`: `active = true` if `feedbackTrailsConfig.enabled === true`.
* `dropHit`: `active = true` only during active envelope decay (`dropHitActive === true`).

### 5.2 Patch Active Slots Configuration
* `PATCH /global-effect-slots` or `PATCH /global-effect-slots/:slotId`
* **Validation Rules:**
  - `strobe.hz` must be one of preset rates, or clamped to `1.0` to `20.0` Hz.
  - `strobe.duty` must be a float between `0.05` and `0.95`.
  - `strobe.intensity` must be a float between `0.0` and `1.0`.
  - `colorWash.amount` must be a float between `0.0` and `1.0`.
  - Colors array (RGBWAU) must contain exactly 6 numbers between `0.0` and `1.0`.
  - Preset safety level check: Presets with `safetyTier = "expert_burst"` (e.g. `max_20hz`) must reject configuration attempts selecting `toggle` or `hold` behaviors.

### 5.3 Active Trigger Endpoints
* `POST /global-effect-slots/:slotId/activate`
* `POST /global-effect-slots/:slotId/deactivate`
* `POST /global-effect-slots/:slotId/trigger`
* `POST /global-effect-macros/panic-stop`
  - **Panic Stop v1 Action:**
    - Stops active strobes
    - Cancels timed bursts
    - Resets active drop hit envelopes
    - Disables feedback trails
    - Leaves color wash unchanged by default
    - Blackout/safety system remains separate and stronger

---

## 6. CaptainPad UI Design

The legacy fixed controls cards are replaced with a **2x3 Performance Grid**:

```
GLOBAL EFFECT MACROS

┌──────────────────────┬──────────────────────┬──────────────────────┐
│  1: 4 Hz Sync        │  2: White Drop       │  3: Ocean Wash       │
│  STROBE              │  DROP HIT            │  COLOR WASH          │
│  [ ACTIVE ]          │  [ TRIGGER ]         │  [ ACTIVE ]          │
├──────────────────────┼──────────────────────┼──────────────────────┤
│  4: Ghost Trails     │  5: Iceberg Flash    │  6: 20 Hz Burst      │
│  FEEDBACK            │  DROP HIT            │  STROBE              │
│  [ INACTIVE ]        │  [ TRIGGER ]         │  [ BURST ] ⚠         │
└──────────────────────┴──────────────────────┴──────────────────────┘
```

---

## 7. Future & Optional Show Macros (Effect Library Registry)

The effect library registry supports modular additions for the following macros:

### 1. Lightning Strike (`lightningStrike`)
A sudden cold-white / blue-white flash with randomized fast flicker decay.
* *Presets:* `storm_flash` (`color: [0.6, 0.8, 1.0, 0.8, 0.0, 0.2]`, `strikeCount: 2`, `jitter: 0.35`, `decayMs: 700`).

### 2. Waterline Sweep (`waterlineSweep`)
A spatial overlay wipe moving vertically or horizontally across coordinates.
* *Presets:* `rising_tide` (`direction: "bottom_to_top"`, `color: [0.0, 0.35, 1.0, 0.0, 0.0, 0.2]`, `speed: 0.8`).

### 3. Iceberg Takeover (`icebergTakeover`)
A cold cyan/white takeover creeping in from the front-right side of the ship.
* *Presets:* `glacier_impact` (`color: [0.25, 0.85, 1.0, 0.4, 0.0, 0.15]`, `creepMs: 2500`, `shimmer: 0.25`).

### 4. Section Chase (`sectionChase`)
A global chase sequence looping across named V2 model groups.
* *Presets:* `hull_scan` (`order: ["Left Wall", "Front", "Right Wall", "Back"]`, `stepMs: 180`).

### 5. Emergency Alarm (`emergencyAlarm`)
A warning macro alternating colors (e.g. red/amber) on opposite sides.
* *Presets:* `collision_warning` (`rateHz: 2`, `colorA: [1, 0, 0, 0, 0.2, 0]`, `colorB: [1, 0.45, 0, 0, 0.8, 0]`).

### 6. Vintage Glow (`vintageGlow`)
Shifts the entire rig toward amber warm tints and boosts filament brightness.
* *Presets:* `engine_room` (`amount: 0.65`, `amberBoost: 0.8`, `whiteWarmth: 0.4`, `fadeMs: 1200`).

### 7. Engine Pulse / Heartbeat (`enginePulse`)
Pulsing brightness simulating steam engine thumps.
* *Presets:* `boiler_beat` (`bpm: 60`, `depth: 0.45`, `shape: "thump"`).

### 8. Freeze Frame (`freezeFrame`)
Locks current outputs, stops motion patterns, and slowly fades down.
* *Presets:* `time_stop` (`fadeInMs: 100`, `holdMs: 1000`, `fadeOutMs: 500`).

### 9. Sparkle Overlay (`sparkleOverlay`)
Transient sparkles overlaying the active pattern.
* *Presets:* `sparkle_white` (`density: 0.08`, `decayMs: 120`, `color: [1, 1, 1, 0.4, 0.2, 0]`).

### 10. Audio Duck / Bass Pump (`bassPump`)
Rig sidechains/pumps in response to microphone bass frequencies.
* *Presets:* `bass_pump` (`source: "micLow"`, `depth: 0.35`, `attackMs: 30`, `releaseMs: 180`).

---

## 8. State Management (Transient vs. Persistent)

* **Persistent Settings (survives restarts):** Color Wash selected preset, fader amount, default Strobe frequencies, strobe presets, drop hit configuration, and the 6 performance slot configuration mapping layout.
* **Transient State (resets on boot):** Strobe enabled status (`strobe.enabled` defaults to `false`), active drop hit envelopes (`dropHit.active` defaults to `false`), strobe burst timers (`strobe.burstFramesRemaining` defaults to `null`), active feedback trails buffer contents, and startup timestamps.

---

## 9. Verification Plan

### 9.1 Automated Unit Testing (`marsin_engine/tests/global_effect_macros.test.js`)
We will verify library registry, slots persistence, slot actions, safety validation, and ordering:

#### Library and Slot Configuration Checks
1. **Default slot config validates against the v1 effect library:** Verify the default slot configurations parse successfully against `GLOBAL_EFFECT_LIBRARY`.
2. **No default slot references a future/unimplemented effect:** Assert that no default slot mapping references future/unimplemented effects (such as `lightningStrike`).
3. **Registry Fetch:** Assert `GET /global-effect-library` lists all v1 modules, presets, and safety ratings.
4. **Boot Transient Cleanliness:** Assert strobe active states and drop hit envelope timers reset to `false`/`null`/`off` on start.
5. **Validation rejections:** Verify PATCH updates with missing/unknown `effectId` or `presetId` are rejected with `400`.
6. **Active Status Check:** Assert `GET /global-effect-slots/status` correctly includes the `active` status boolean for each slot.

#### Action Execution and Preset-Aware Switching
1. **Activating a second strobe preset switches strobe config instead of stopping it:** Assert that when a strobe preset is already active, triggering a different strobe preset switches configs directly instead of shutting down.
2. **Activating a second colorWash preset switches wash config instead of stopping it:** Assert that triggering a different color wash preset switches wash configs directly instead of shutting down.
3. **Trigger Slot:** Verify triggering slot 2 starts the `dropHit` envelope.
4. **Hold Slot:** Verify a down-action activates the strobe, and an up-action stops it.
5. **Slot 6 default behavior matches its label and safety tier:** Verify slot 6 activates a strobe that expires automatically after the configured frames (1000ms duration burst).
6. **Feedback Trails Allocation:** Assert enabling feedback trails allocates the transient buffer, and disabling clears it.

#### Safety Checks
1. **20 Hz max preset rejects toggle and hold if policy is burst-only:** Verify that trying to configure a toggle or hold behavior on the 20 Hz strobe preset (`max_20hz`) is rejected.
2. **Burst clamping:** Verify that duration parameters exceeding 2000 ms are clamped.
3. **Panic stop leaves slot mappings unchanged and leaves color wash unchanged unless explicitly configured otherwise:** Assert `panic-stop` clears all active strobe, burst, envelope, and feedback trail states, while leaving slot configurations and color wash configurations unchanged.

#### Pipeline Ordering Checks
1. **Feedback Trails runs before Drop Hit in macro ordering:** Verify that Color Wash takes place first, then Feedback Trails captures the wash state, then Drop Hit adds envelope flash, and finally Strobe gates the final result.
