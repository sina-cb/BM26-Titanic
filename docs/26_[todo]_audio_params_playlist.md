# Design Doc: Dynamic Audio Parameter Mapping in CaptainPad Playlists

**Status:** Under Review  
**Author:** Antigravity  
**Related Docs:** `25_marsin_audio_analysis.md` · `15_central_param_center_cpc.md` · `16_captain_pad.md`

---

## 1. Executive Summary

This document describes the design for **Dynamic Audio Parameter Mapping** in MarsinEngine and the CaptainPad UI. This feature enables visual operators to dynamically route in-engine audio analysis signals (`micLow`, `micMid`, `micHigh`, and `micKick`) to modulate pattern-local sliders (like `noiseScale` or `localSpeed`) and global params (like `size`). 

These mappings are saved at the playlist-item level, allowing different playlists to apply customized audio reactivity to the same underlying patterns.

To ensure separation of concerns and maintain a clean, decoupled architecture, this design keeps `ParamCenter` as a pure source provider. A dedicated `ModulationEngine` module evaluates mappings and computes modulated target values in normalized space, which are then flushed directly to the WebAssembly VMs in the render loop.

---

## 2. User Experience & UI/UX Flow

The modulation mapping interface is integrated directly into the **Deck View** and **Playlist Editor** in CaptainPad. It is modeled after the LX/Chromatik style of modulation control.

```
┌─ LOCAL PARAMETERS ────────────────────────────────────────────────────────┐
│                                                                           │
│  NOISE SCALE   [ base slider + colored ghost overlay ]  0.50 → 0.71  [◎ micLow] 
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (Click ◎/Map opens popover)
                     ┌───────────────────────────────────┐
                     │ MAP PARAMETER: NOISE SCALE        │
                     ├───────────────────────────────────┤
                     │ Source:   [ micLow (Bass)     ] ▼ │
                     │ Mode:     (●) Offset   ( ) Scale  │
                     │ Polarity: (●) Unipolar ( ) Bipolar│
                     │ Range:    Min: 0.00   Max: +0.35  │
                     │ Curve:    [ Ease Out          ] ▼ │
                     ├───────────────────────────────────┤
                     │ [Disable]   [Remove]   [Close]    │
                     └───────────────────────────────────┘
```

### 2.1 UX Interactions and Rules
1. **Mapping Trigger**: Next to every local slider in the Deck View, a small `[◎]` (Map) badge/button is displayed.
2. **Modulator Popover**: Clicking this badge opens a popover containing:
   - **Source Selector**: Dropdown to select the modulator (`micLow`, `micMid`, `micHigh`, `micKick`). *Future sources include: `tempoBpm`, `LFO`, and global params.*
   - **Mode Selection**: Toggle between **Offset** (adds range-scaled delta to the base value) and **Scale** (multiplies the base value by range-scaled delta).
   - **Polarity**: Toggle between **Unipolar** (source $0..1$ maps to the specified range) and **Bipolar** (source $0..1$ maps to a balanced $-1..1$ scale, where $0.5$ is no movement).
   - **Range**: A dual input/slider defining the Min/Max delta in normalized space (e.g. `[0.0, 0.35]` or `[-0.25, 0.25]`).
   - **Curve**: Dropdown to select response shaping (`Linear`, `Ease In`, `Ease Out`, `Exp`).
   - **Action Buttons**: `[Disable]` toggles the mapping's active status; `[Remove]` deletes the mapping; `[Close]` closes the popover.
3. **Visual Feedback (Colored Ghost Sliders)**:
   - The primary slider handle continues to show and control the static **Base Value** ($P_{\text{base}}$).
   - A secondary, low-opacity "ghost" handle or bar on the slider track animates in real-time at 30 Hz to display the active **Modulated Value** ($P_{\text{modulated}}$) calculated by the engine.
4. **Primary Interaction Rule**:
   > [!IMPORTANT]
   > Dragging the main slider always edits the base value, never the modulated value.

---

## 3. Data Schema & Persistence

Mappings are defined at the **playlist-item** level and serialized inside `deck_state.yaml` and the playlist database/YAML configurations.

### 3.1 YAML Schema (`playlists.yaml`)
```yaml
playlists:
  - name: "Late Night Tech"
    items:
      - pattern: "00_golden_hour_wash"
        duration: 120

        parameters:
          localSpeed: 0.4
          noiseScale: 0.3

        modulations:
          - id: "mod_noiseScale_micLow"
            type: "continuous"
            enabled: true

            source:
              scope: "cpc"
              key: "micLow"
              label: "Mic Low"

            target:
              scope: "pattern"
              parameter: "noiseScale"

            mode: "offset"          # offset | scale
            polarity: "unipolar"    # unipolar | bipolar
            range: [0.0, 0.35]      # applied in normalized target space
            curve: "linear"         # linear | easeIn | easeOut | exp

          - id: "mod_localSpeed_micKick"
            type: "continuous"
            enabled: true

            source:
              scope: "cpc"
              key: "micKick"
              label: "Mic Kick"

            target:
              scope: "pattern"
              parameter: "localSpeed"

            mode: "offset"
            polarity: "unipolar"
            range: [0.0, 0.2]
            curve: "easeOut"
```

### 3.2 Mapping Constraints and Scope
- **v1 Policy**: At most one continuous modulation mapping per target parameter. Creating a new mapping for the same target replaces the previous mapping.
  ```yaml
  policy:
    maxMappingsPerTarget: 1
  ```
- **Trigger Modulations (Reserved for Future Version)**:
  Trigger-based modulations (e.g. mapping a kick drum to fire a pattern reset) are explicitly separated from continuous mappings:
  ```yaml
  # Future Trigger Example
  - id: "trig_reset_kick"
    type: "trigger"
    enabled: true
    source:
      scope: "cpc"
      key: "micKick"
    target:
      scope: "pattern"
      parameter: "reset"
    behavior: "onRise"      # onRise | onFall | threshold
    threshold: 0.8
  ```

---

## 4. Engine Architecture & Modulation Pipeline

The modulation logic executes entirely on the **MarsinEngine host** (Node.js layer) within the render loop. This ensures zero latency and guarantees the VM receives updated parameters on every frame without network overhead.

### 4.1 Modular Layout

Rather than putting modulation state inside `ParamCenter` (which should remain the global CPC source of truth), a new module `ModulationEngine` is created.

```
CPC/shared params ─┐
audio live params ─┤
playlist item base params ──▶ ModulationEngine ──▶ WasmHost.setControl(...)
active pattern exports ─────┘
```

### 4.2 Parameter Space Normalization
All modulation math happens in normalized parameter space ($0.0 \le P \le 1.0$):
$$\text{baseRaw} \longrightarrow \text{baseNorm} \longrightarrow \text{modulation in normalized } [0, 1] \longrightarrow \text{finalNorm} \longrightarrow \text{finalRaw / control value}$$
Because the WASM VM's controls expect normalized values $[0, 1]$, the computed `finalNorm` is passed directly.

### 4.3 Mathematical Formulas

For a given parameter $P$, let $P_{\text{base}}$ be the static normalized value ($0.0 \le P_{\text{base}} \le 1.0$), $S$ be the current normalized value of the audio source ($0.0 \le S \le 1.0$), and $R$ be the range array $[minDelta, maxDelta]$.

#### 1. Curve Response
$$S_{\text{curved}} = \text{applyCurve}(S, \text{curve})$$

#### 2. Polarity Remap
- **Unipolar**: $S_{\text{polar}} = S_{\text{curved}}$
- **Bipolar**: $S_{\text{polar}} = (S_{\text{curved}} - 0.5) \times 2.0$

#### 3. Delta Calculation
- **Unipolar**: $\Delta = minDelta + S_{\text{polar}} \times (maxDelta - minDelta)$
- **Bipolar**: $\Delta = S_{\text{polar}} \times \max(|minDelta|, |maxDelta|)$

#### 4. Modulation Mode Application
- **Offset Mode**:
  $$P_{\text{modulated}} = \text{clamp}(P_{\text{base}} + \Delta, 0.0, 1.0)$$
- **Scale Mode**:
  $$P_{\text{modulated}} = \text{clamp}(P_{\text{base}} \times (1.0 + \Delta), 0.0, 1.0)$$
  *Scale Mode allows base parameters of 0.0 to act as closed gates.*

---

### 4.4 Sequence of Operations (The Render Loop)

On every frame tick, the engine executes the following pipeline:

```
  1. Retrieve raw audio band metrics from AudioAnalyzer (micLow, micKick, etc.)
  2. Update live parameters in ParamCenter.
  3. Resolve modulation sources:
       sourceValues = resolveModulationSources({ paramCenterSnapshot: paramCenter.getAll() })
  4. Evaluate modulations:
       modulationResult = applyModulations({
         baseParams: activePlaylistItem.parameters,
         targetDefs: activeExports,
         modulations: activePlaylistItem.modulations,
         sourceValues,
       })
  5. Push values to VM for each export in active exports:
       mixer.wasmHost.setControl(activeHandle, exp.id, modulatedVal)
  6. Call WasmHost.beginFrame(patternClockSeconds)
  7. Call WasmHost.renderAll()
  8. Broadcast modulationState to WebSocket clients at 15–30 Hz
```

---

## 5. API & WebSocket Contracts

### 5.1 REST Endpoints

To support multiple mapping target scopes and future schema flexibility, CRUD operations are performed by mapping ID.

#### `PUT /api/playlists/:playlistId/items/:itemId/modulations/:mappingId`
Creates or replaces a modulation mapping for a specific playlist item.
- **Request Body**:
  ```json
  {
    "id": "mod_noiseScale_micLow",
    "type": "continuous",
    "enabled": true,
    "source": {
      "scope": "cpc",
      "key": "micLow"
    },
    "target": {
      "scope": "pattern",
      "parameter": "noiseScale"
    },
    "mode": "offset",
    "polarity": "unipolar",
    "range": [0.0, 0.35],
    "curve": "linear"
  }
  ```

#### `PATCH /api/playlists/:playlistId/items/:itemId/modulations/:mappingId`
Partially updates an existing mapping (e.g. enabling/disabling or tuning range).
- **Request Body**:
  ```json
  {
    "enabled": false
  }
  ```

#### `DELETE /api/playlists/:playlistId/items/:itemId/modulations/:mappingId`
Removes a modulation mapping.

---

### 5.2 WebSocket Real-Time Broadcasts
The engine broadcasts a lightweight `modulationState` frame separate from the heavier rendering `engineState` frame. This runs throttled at 15–30 Hz:

```json
{
  "type": "modulationState",
  "deckId": "main",
  "pattern": "00_golden_hour_wash",
  "parameters": {
    "noiseScale": {
      "base": 0.3,
      "modulated": 0.51,
      "source": "micLow",
      "mappingId": "mod_noiseScale_micLow"
    },
    "localSpeed": {
      "base": 0.4,
      "modulated": 0.4
    }
  }
}
```

---

## 6. Implementation Code Snippets

### 6.1 `marsin_engine/lib/modulation_engine.js`

```javascript
/**
 * Helper to clamp values to [0, 1]
 */
function clamp01(x) {
  return Math.max(0.0, Math.min(1.0, x));
}

/**
 * Apply response curve shaping
 */
function applyCurve(value, curve) {
  if (curve === 'easeIn') {
    return value * value;
  }
  if (curve === 'easeOut') {
    return 1 - (1 - value) * (1 - value);
  }
  if (curve === 'exp') {
    return Math.pow(value, 3);
  }
  return value; // 'linear' or fallback
}

/**
 * Math implementation for continuous parameter modulation
 */
export function applyContinuousModulation({
  baseNorm,
  sourceNorm,
  mode = 'offset',
  polarity = 'unipolar',
  range = [0, 0],
  curve = 'linear',
}) {
  const s = applyCurve(clamp01(sourceNorm), curve);

  const bipolarS =
    polarity === 'bipolar'
      ? (s - 0.5) * 2.0
      : s;

  const [minDelta, maxDelta] = range;
  const delta =
    polarity === 'bipolar'
      ? bipolarS * Math.max(Math.abs(minDelta), Math.abs(maxDelta))
      : minDelta + s * (maxDelta - minDelta);

  if (mode === 'offset') {
    return clamp01(baseNorm + delta);
  }

  if (mode === 'scale') {
    return clamp01(baseNorm * (1.0 + delta));
  }

  return clamp01(baseNorm);
}

/**
 * Extract active modulation sources from system snapshots
 */
export function resolveModulationSources({ paramCenterSnapshot }) {
  // Extract only keys that can act as modulation sources
  const sources = {};
  if (paramCenterSnapshot) {
    // micLow, micMid, micHigh, micKick are fetched directly from ParamCenter
    sources.micLow = paramCenterSnapshot.micLow ?? 0.0;
    sources.micMid = paramCenterSnapshot.micMid ?? 0.0;
    sources.micHigh = paramCenterSnapshot.micHigh ?? 0.0;
    sources.micKick = paramCenterSnapshot.micKick ?? 0.0;
  }
  return sources;
}

/**
 * Batch apply all active modulations for the current pattern exports
 */
export function applyModulations({
  baseParams = {},
  targetDefs = [],
  modulations = [],
  sourceValues = {},
}) {
  const result = { values: {} };
  const targetMap = {};

  // Build targetDefs helper map
  for (const exp of targetDefs) {
    targetMap[exp.name] = exp;
  }

  // Set initial base values
  for (const exp of targetDefs) {
    const base = baseParams[exp.name] ?? 0.5; // fallback default
    result.values[exp.name] = {
      baseNorm: base,
      modulatedNorm: base,
    };
  }

  // Track applied parameters to respect v1 "one modulator per target" policy
  const appliedTargets = new Set();

  for (const mod of modulations) {
    if (!mod.enabled || mod.type !== 'continuous') continue;
    
    const targetParam = mod.target?.parameter;
    if (!targetParam || !targetMap[targetParam]) continue;

    // v1 enforcement: last-wins for duplicate target mapping
    if (appliedTargets.has(targetParam)) {
      console.warn(`[ModulationEngine] Duplicate mapping for target '${targetParam}' ignored (v1 policy limits).`);
      continue;
    }

    const sourceKey = mod.source?.key;
    const sourceVal = sourceValues[sourceKey] ?? 0.0;
    const baseVal = result.values[targetParam].baseNorm;

    const modulatedVal = applyContinuousModulation({
      baseNorm: baseVal,
      sourceNorm: sourceVal,
      mode: mod.mode,
      polarity: mod.polarity,
      range: mod.range,
      curve: mod.curve,
    });

    result.values[targetParam].modulatedNorm = modulatedVal;
    result.values[targetParam].source = sourceKey;
    result.values[targetParam].mappingId = mod.id;
    appliedTargets.add(targetParam);
  }

  return result;
}
```

### 6.2 Render Loop Integration in `marsin_engine/engine.js`

```javascript
import {
  resolveModulationSources,
  applyModulations,
} from './lib/modulation_engine.js';

function tick() {
  if (!running) return;

  const now = performance.now();
  const elapsed = (now - startTime) / 1000;

  // 1. Flush pending CPC updates to WASM VM
  if (paramCenter) paramCenter.flushDirty(mixer.wasmHost);

  // 2. Fetch the current CPC state snapshot
  const paramCenterSnapshot = paramCenter.getAll();

  // 3. Resolve modulation sources
  const sourceValues = resolveModulationSources({ paramCenterSnapshot });

  // 4. Evaluate modulation values
  const activeExports = mixer.getActiveExports(); // Array of target defs e.g., [{ name: 'noiseScale', kind: 1, id: 104 }]
  const modulationResult = applyModulations({
    baseParams: activePlaylistItem.parameters,
    targetDefs: activeExports,
    modulations: activePlaylistItem.modulations || [],
    sourceValues,
  });

  // 5. Apply computed parameter states to WASM
  for (const exp of activeExports) {
    if (exp.kind !== 1) continue; // EXPORT_SLIDER

    const val =
      modulationResult.values[exp.name]?.modulatedNorm ??
      modulationResult.values[exp.name]?.baseNorm ??
      0.5;

    mixer.wasmHost.setControl(activeHandle, exp.id, val, 0, 0);
  }

  // 6. Compute rendering frame
  mixer.beginFrame(elapsed);
  mixer.renderAll6ch();

  // 7. Map & transmit sACN, etc.
  // ... (sACN mapping logic) ...
}
```

---

## 7. Verification and Testing Plan

To verify the correct execution and synchronization of the modulation engine:

### 7.1 Automated Tests

#### Test File: `tests/modulation_engine.test.js`
- **Offset / Unipolar Math**: Assert source `0.0` yields minimum range boundary ($P_{\text{base}}$), and source `1.0` yields maximum range boundary ($P_{\text{base}} + rangeMax$).
- **Offset / Bipolar Math**: Assert source `0.5` yields no movement ($P_{\text{base}}$), source `1.0` moves positively, and source `0.0` moves negatively.
- **Scale Mode**: Verify that when $P_{\text{base}} = 0.0$, the result is locked to `0.0` (acting as a closed gate).
- **Clamping**: Verify that all computed parameters are strictly clamped in the range $[0.0, 1.0]$.
- **Disabled State**: Assert that a mapping with `enabled: false` is bypassed and yields $P_{\text{base}}$.
- **Unknown Targets / Sources**: Ensure unknown target variables do not crash the engine, and missing sources default safely to `0.0`.
- **v1 Policy Check**: Validate that duplicate mappings for the same target resolve in a last-wins fashion.

#### Test File: `tests/playlist_modulations_api.test.js`
- **CRUD Operations**: Assert that mappings can be written (`PUT`), updated (`PATCH`), and removed (`DELETE`) by mapping ID.
- **Validation**: Verify that invalid scopes (e.g. non-existent keys) and out-of-bounds ranges are rejected with `400 Bad Request`.
- **Parameter Isolation**: Verify that modifying mappings does not overwrite or corrupt base parameter values in `playlists.yaml`.

#### Test File: `tests/captainpad_modulation_ui.test.tsx`
- **UI Indicators**: Assert that mapped sliders display the `[◎]` mapping active indicator badge.
- **Render Separation**: Verify that dragging the slider edits the base value and does not interfere with the ghost modulation indicator.
- **Overlay Updates**: Assert that WebSocket `modulationState` payloads update the position of the ghost overlay track on the visual interface.
- **Removal**: Assert that removing a mapping clears the UI badge and hides the ghost slider.

### 7.2 Manual Verification
- In CaptainPad, configure a playlist item to map `micLow` to `noiseScale` at `+0.35` offset, unipolar.
- Verify that when deep bass hits, the visual "ghost" slider track indicator on the iPad animates upward in real-time, matching the music beat, while the base control slider remains stationary at its current user setting.
