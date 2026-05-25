# Design Doc: Mixer Layer View Selection

**Status:** Ready for Final Review  
**Author:** Antigravity  
**Related Docs:** `13_model_v2.md` · `18_marsin_mixer.md` · `12_marsin_engine.md` · `16_captain_pad.md`

---

## 1. Executive Summary

This document proposes the technical design for **Mixer Layer View Selection** in the BM26-Titanic lighting controller. This feature allows visual operators in the CaptainPad Mixer tab to restrict a channel's output to a specific part of the physical model. For example, an operator can run a "sparkle" pattern exclusively on the "Right Front Wall" while leaving the rest of the ship rendering a "bioluminescence" base wash.

To ensure simplicity, flexibility, and maximum performance, the masking/selection logic is implemented **entirely host-side in Node.js within `marsin_engine`** (during the channel-blending loop in `PatternMixer`) rather than forcing the complexity into the compiled WASM pattern binaries. It leverages the semantic metadata introduced in Model V2 (`group`, `fixtureId`, `sectionId`, and `viewMask`).

### Key Principles:
1. **Per-Channel Blending Commit:** Masking is applied immediately after each channel's blend step during composition rather than globally at the end, preventing global washout.
2. **Post-Blend Background Preservation:** We blend background and foreground first, and then commit the blended result *only* to selected pixels in `mixerBuffer`. This prevents blend modes (like `normal` or `multiply`) from bleeding black/zeros into unselected areas.
3. **Pre-Compiled Mask Cache:** Channel filters are compiled into a static `Uint8Array` mask when `viewSelection` config changes, avoiding any conditionals or string matching in the hot 40Hz render loop.
4. **Base Background Initialization:** The base channel (if active and enabled) initializes the live composition background (`mixerBuffer`), allowing true layer stacking.
5. **Isolated PFL Preview Masking:** The Deck preview (PFL) continues to render into `deckBuffer`. Unselected pixels in PFL are blacked out to clearly show the operator what the layer covers, whereas unselected pixels in live mixer channels preserve the accumulated background.

---

## 2. Architecture & Data Flow

To ensure consistency, the execution order of the rendering pipeline is structured as follows:

```
1. Initialize Frame
   └─ Clear mixerBuffer, deckBuffer, outputBuffer, & channelBuffer to black (0)

2. Render Vis-Data Telemetry Snapshots
   for each channel:
     └─ Render Pattern → channelBuffer
     └─ Copy to _visData[channel.id] (base64 string for UI monitoring)
   (Note: This dry-run rendering pass is performed to stream live preview 
    streams to the visualizer regardless of channel mutes/faders. Bypassing 
    this redundancy is planned as a post-v1 optimization.)

3. Initialize Live Background (Base Channel)
   └─ Render Base Pattern → channelBuffer
   └─ Scale/Blend Base over Black → baseBlendBuffer (scratch space)
   └─ commitBlendedLayerWithMask(mixerBuffer, baseBlendBuffer, base.compiledPixelMask)

4. Composite Overlay Channels (1 to N)
   for each overlay:
     └─ Render Pattern → channelBuffer
     └─ Blend (mixerBuffer + channelBuffer) → blended (WASM)
     └─ commitBlendedLayerWithMask(mixerBuffer, blended, overlay.compiledPixelMask)

5. Render Deck / PFL Preview (Isolated View)
   └─ Render Focused Pattern → deckBuffer
   └─ applyPreviewMaskBlackout(deckBuffer, focusedChannel.compiledPixelMask)

6. Crossfade & Master Scaling
   └─ Crossfade (deckBuffer & mixerBuffer) based on viewFader → outputBuffer
   └─ Scale outputBuffer by master fader
```

> [!WARNING]
> **Base-Channel Semantic Behavior Change:** This design changes how the base channel behaves. The base channel now seeds the live `mixerBuffer` composition directly, whereas it previously only rendered to `deckBuffer`. Existing show configurations should be validated with `viewFader = 0` (deck preview only), `viewFader = 1` (mixer composition), and intermediate crossfade values to verify behavior.

> [!NOTE]
> **viewFader Semantics:** When `deckFocusChannelId` defaults to `baseChannelId` (i.e. the Deck tab is previewing the base channel), `deckBuffer` and the base portion of `mixerBuffer` will contain the same pattern output. This is expected. The crossfade must remain strictly linear between the two buffers:
> `outputBuffer[i] = deckBuffer[i] * (1 - viewFader) + mixerBuffer[i] * viewFader`
> This prevents additive brightening or dimming anomalies during tab crossfading.
> By default at engine startup, `viewFader` is set to `1.0` (target `1.0`) so that the live output is the `mixerBuffer` (live mixer composition). Toggling the tab to the Deck view in CaptainPad sends a POST/PATCH requesting `view` = `deck`, which transitions `viewFader` to `0.0`, routing the isolated Pre-Fade Listen (`deckBuffer`) directly to the physical lights.

---

## 3. Data Schema & Serialization

### 3.1 Persistent Schema (`viewSelection`)
Each channel configuration block in `mixer_state.yaml` and `deck_state.yaml` stores a `viewSelection` block:

```yaml
viewSelection:
  type: "group"       # all | group | section | fixture | viewMask
  target: "ParLights" # string group name, numeric ID, or bitmask
  invert: false       # if true, acts as "exclude" (applies to all EXCEPT target)
```

To ensure system safety and prevent malformed data from causing runtime issues in the render loop, the REST API and WebSocket message handlers must validate target shapes before mask compilation:
* `type: "all"` → `target` must be `null` or omitted.
* `type: "group"` → `target` must be a non-empty `string`.
* `type: "section"` → `target` must be a valid `integer`.
* `type: "fixture"` → `target` must be a valid `integer`.
* `type: "viewMask"` → `target` must be a valid positive `integer` representing a bitmask.

Invalid payload requests must be rejected immediately by the API server with a `400 Bad Request`.

### 3.2 Transient Schema (`compiledPixelMask`)
Each `PatternChannel` instance maintains a transient runtime mask array, constructed using the active model pixels:

* Property: `channel.compiledPixelMask`
* Type: `Uint8Array | null` (where `null` represents "ALL" pixels selected)
* Length: `pixelCount`
* Value at `i`: `1` if pixel `i` is targeted/selected; `0` if pixel `i` is ignored/masked.

---

## 4. Host-Side Engine Implementation

### 4.1 Mask Pre-Compilation
When a channel's `viewSelection` is configured or updated, the engine compiles the mask to avoid CPU overhead during rendering.

```javascript
// marsin_engine/lib/pattern_mixer.js

/**
 * Compiles a view selection configuration into a fast lookup mask.
 * Returns null if all pixels are selected, otherwise a Uint8Array of size pixelCount.
 */
export function compileViewSelectionMask({ pixels, pixelCount, viewSelection }) {
  if (!viewSelection || viewSelection.type === 'all') {
    return null; // null means full model
  }

  const mask = new Uint8Array(pixelCount);
  const target = viewSelection.target;

  for (let i = 0; i < pixelCount; i++) {
    const px = pixels[i] || {};
    let match = false;

    switch (viewSelection.type) {
      case 'group':
        match = px.group === target;
        break;

      case 'section': {
        const sectionId = px.sId ?? px.sectionId;
        match = sectionId === target;
        break;
      }

      case 'fixture': {
        const fixtureId = px.fId ?? px.fixtureId;
        match = fixtureId === target;
        break;
      }

      case 'viewMask': {
        const viewMask = px.vMask ?? px.viewMask ?? 0;
        match = (viewMask & target) !== 0;
        break;
      }

      default:
        console.warn(`[PatternMixer] Unknown viewSelection type '${viewSelection.type}', treating as ALL`);
        return null;
    }

    mask[i] = viewSelection.invert
      ? (match ? 0 : 1)
      : (match ? 1 : 0);
  }

  return mask;
}
```

Whenever a channel's view selection is set or loaded, `channel.compiledPixelMask` is recalculated.

---

### 4.2 Allocation-Optimized Helper Blending Functions
To prevent garbage collection spikes in the 40Hz render loop, scratch buffers are allocated once in the `PatternMixer` constructor and reused for fallbacks. 

```javascript
// Copy 6-channel byte values for a single pixel
function copyPixel6(dst, src, pixelIndex) {
  const o = pixelIndex * 6;
  dst[o + 0] = src[o + 0];
  dst[o + 1] = src[o + 1];
  dst[o + 2] = src[o + 2];
  dst[o + 3] = src[o + 3];
  dst[o + 4] = src[o + 4];
  dst[o + 5] = src[o + 5];
}

// Commit layer blend results only on targeted mask indices
function commitBlendedLayerWithMask({ mixerBuffer, blendedBuffer, pixelMask, pixelCount }) {
  if (!pixelMask) {
    mixerBuffer.set(blendedBuffer);
    return;
  }

  for (let i = 0; i < pixelCount; i++) {
    if (pixelMask[i]) {
      copyPixel6(mixerBuffer, blendedBuffer, i);
    }
  }
}

// Blackout unselected pixels in the Deck/PFL preview buffer
function applyPreviewMaskBlackout(buffer, pixelMask, pixelCount) {
  if (!pixelMask) return;

  for (let i = 0; i < pixelCount; i++) {
    if (!pixelMask[i]) {
      const o = i * 6;
      buffer[o + 0] = 0;
      buffer[o + 1] = 0;
      buffer[o + 2] = 0;
      buffer[o + 3] = 0;
      buffer[o + 4] = 0;
      buffer[o + 5] = 0;
    }
  }
}

// Utility to scale foreground over black using reusable scratch space
function blendNormalOrScaleOverBlack({ foreground, fader, pixelCount, scratchBuffer }) {
  if (fader >= 0.999) {
    scratchBuffer.set(foreground);
  } else {
    for (let i = 0; i < foreground.length; i++) {
      scratchBuffer[i] = Math.round(foreground[i] * fader);
    }
  }
  return scratchBuffer;
}
```

---

### 4.3 PatternMixer Constructor & Compositing Loop

We update the `PatternMixer` constructor to store model pixels, execute sanity checks, and pre-allocate scratch buffers:

```javascript
// marsin_engine/lib/pattern_mixer.js

export class PatternMixer {
  constructor({ wasmHost, pixelCount, pixels }) {
    this.wasmHost = wasmHost;
    this.pixelCount = pixelCount;
    this.channels = [];
    this.master = 1.0;
    this.baseChannelId = null;
    this.deckFocusChannelId = null;
    this.maxChannels = 6;
    this.viewFader = 1.0; // Default to mixerBuffer output on startup
    this.targetViewFader = 1.0;

    // Buffer allocations
    this.outputBuffer = new Uint8Array(this.pixelCount * 6);
    this.channelBuffer = new Uint8Array(this.pixelCount * 6);
    
    // Model mapping reference & validation
    this.pixels = pixels || [];
    if (this.pixels.length > 0) {
      if (this.pixels.length !== this.pixelCount) {
        throw new Error(`[PatternMixer] pixels length (${this.pixels.length}) must match pixelCount (${this.pixelCount})`);
      }
      for (let i = 0; i < this.pixels.length; i++) {
        if (this.pixels[i]?.i !== undefined && this.pixels[i].i !== i) {
          throw new Error(`[PatternMixer] Model pixel index alignment corrupted: pixels[${i}].i = ${this.pixels[i].i}, expected ${i}`);
        }
      }
    }

    // Reusable blend scratch buffers to prevent garbage-collector thrashing
    this.blendedBuffer = new Uint8Array(this.pixelCount * 6);
    this.baseBlendBuffer = new Uint8Array(this.pixelCount * 6);
    
    this.transitions = [];
    this.blendHandles = {};
    this.patternsDir = null;
    this.onChannelRemoved = null;
  }
  
  renderAll6ch() {
    if (!this.deckBuffer) {
      this.deckBuffer = new Uint8Array(this.pixelCount * 6);
      this.mixerBuffer = new Uint8Array(this.pixelCount * 6);
    }
    
    this.deckBuffer.fill(0);
    this.mixerBuffer.fill(0);
    this.outputBuffer.fill(0);
    this._visData = {};

    // 1. Vis data rendering
    // NOTE: This runs full pattern renders for telemetry vis data.
    // TODO (After v1 lands): reduce duplicate renders by extracting _visData 
    // opportunistically from buffers already rendered during base/overlay/PFL passes. 
    // Keep full-channel telemetry renders only at a lower debug/visualizer cadence.
    for (const channel of this.channels) {
      this.channelBuffer.fill(0);
      channel.renderInto(this.wasmHost, this.channelBuffer, true);
      this._visData[channel.id] = this._extractVis(this.channelBuffer);
    }

    // 2. Render Deck / PFL Preview (isolated preview at 100%)
    const deckChannelId = this.deckFocusChannelId || this.baseChannelId;
    const deck = this.getChannel(deckChannelId);
    if (deck) {
      deck.renderInto(this.wasmHost, this.deckBuffer, true);
      
      // Black out unselected preview pixels
      if (deck.compiledPixelMask) {
        applyPreviewMaskBlackout(this.deckBuffer, deck.compiledPixelMask, this.pixelCount);
      }
    }

    // 3. Initialize Live Background (Base Channel)
    const base = this.getChannel(this.baseChannelId);
    if (base && base.enabled && !base.mute && base.fader > 0.001) {
      this.channelBuffer.fill(0);
      base.renderInto(this.wasmHost, this.channelBuffer, true);

      const baseMask = base.compiledPixelMask;
      if (base.fader >= 0.999 && !baseMask) {
        this.mixerBuffer.set(this.channelBuffer);
      } else {
        const blendedBase = blendNormalOrScaleOverBlack({
          foreground: this.channelBuffer,
          fader: base.fader,
          pixelCount: this.pixelCount,
          scratchBuffer: this.baseBlendBuffer
        });
        commitBlendedLayerWithMask({
          mixerBuffer: this.mixerBuffer,
          blendedBuffer: blendedBase,
          pixelMask: baseMask,
          pixelCount: this.pixelCount
        });
      }
    }

    // 4. Composite Overlay Layers
    // Solo resolution logic: solo is evaluated API-side (setting non-solo channels 
    // to enabled=false/mute=true). The loop skips muted or inactive channels.
    for (const channel of this.channels) {
      if (channel.id === this.baseChannelId) continue;
      if (!channel.enabled || channel.mute || channel.fader <= 0.001) continue;

      this.channelBuffer.fill(0);
      channel.renderInto(this.wasmHost, this.channelBuffer, true);

      let blended;
      const blendHandle = this.getBlendHandle(channel.mode);
      
      if (blendHandle) {
        blended = this.wasmHost.renderBlend6ch(
          blendHandle, this.pixelCount,
          this.mixerBuffer, this.channelBuffer, channel.fader
        );
      } else {
        // Fallback: normal blend using scratch buffer to avoid GC allocation
        blended = this.blendedBuffer;
        for (let i = 0; i < blended.length; i++) {
          blended[i] = Math.round(this.mixerBuffer[i] + (this.channelBuffer[i] - this.mixerBuffer[i]) * channel.fader);
        }
      }

      commitBlendedLayerWithMask({
        mixerBuffer: this.mixerBuffer,
        blendedBuffer: blended,
        pixelMask: channel.compiledPixelMask,
        pixelCount: this.pixelCount
      });
    }

    // 5. Output: Crossfade and master scaling
    if (this.viewFader <= 0.001) {
      this.outputBuffer.set(this.deckBuffer);
    } else if (this.viewFader >= 0.999) {
      this.outputBuffer.set(this.mixerBuffer);
    } else {
      const v = this.viewFader;
      const iv = 1 - v;
      for (let i = 0; i < this.outputBuffer.length; i++) {
        this.outputBuffer[i] = Math.round(this.deckBuffer[i] * iv + this.mixerBuffer[i] * v);
      }
    }

    if (this.master < 1.0) {
      this.applyMaster(this.outputBuffer, this.master);
    }

    this._visData['master'] = this._extractVis(this.outputBuffer);
    
    return this.outputBuffer;
  }
}
```

---

## 5. v1 Implementation Boundaries

The scope of the first implementation phase is defined as:

* **Engine-Side Compositing Control:** All masking filters run inside the Node.js rendering process. No WASM-side selected-pixel skipping will be done in v1.
* **Per-Layer Blending Mask:** Masking acts during layer commit steps (`commitBlendedLayerWithMask`), leaving background pixels untouched.
* **Pre-Compiled Uint8Array Masks:** View selections compile into lookup masks when the channel config changes, keeping the hot loop clean of object evaluations.
* **Base Channel Live Seeding:** The base channel seeds the overlay background, correcting the previous black-overlay composition model.
* **Safe Crossfade Verification:** The crossfading arithmetic is verified linear to ensure seamless tab toggling.
* **Rigorous Index Validation:** Model pixel array length and ordering are verified at constructor initialization to guarantee byte alignment.

---

## 6. Verification Plan

### 6.1 Integration Testing
We will add `marsin_engine/tests/pattern_mixer_masking.test.js` to assert the following requirements:
* **Default Startup Output:** Confirming that by default (with no api overrides), the engine outputs exactly the live composition (`mixerBuffer`) and `viewFader` starts at `1.0`.
* **Deck Mode Output:** Setting `viewFader = 0` outputs exactly the contents of `deckBuffer`.
* **Mixer Mode Output:** Setting `viewFader = 1` outputs exactly the contents of `mixerBuffer`.
* **Linear Tab Crossfade:** Verifying that a `viewFader` value of `0.5` produces a clean linear mix: `output[i] = deck[i] * 0.5 + mixer[i] * 0.5`, with no additive brightening.
* **Background Stacking:** Confirming that when the base channel is active, `mixerBuffer` is initialized with the base channel's values instead of pure black.
* **Muted Base Stacking:** Confirming that when the base channel is muted or disabled, it does NOT write/seed into `mixerBuffer`.
* **Per-Layer Constraints:** Running a red fill on base, blue fill on CH2 (masked to group "Wall"), and asserting that only the targeted wall pixels render blue while the rest remain red (matching the background).
* **PFL Separation:** Verifying that a focused channel's unselected pixels become black in the deck preview, but remain visible as background colors in the live mixer output.
* **API Payload Validation:** Verifying that the API rejects invalid `viewSelection.type` and `target` shapes with a `400` status before any masking compiles.
* **Array Alignment Guard:** Verifying that loading a model with corrupted or out-of-order pixel indices throws a boot error, protecting the mask index mapping.
