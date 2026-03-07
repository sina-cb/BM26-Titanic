# 🔗 NDI / Chromatik Integration Pipeline

## Overview

This document describes the bidirectional real-time pipeline between the Three.js TITANIC simulation and **Chromatik** (the lighting pattern authoring platform), using **NDI** (Network Device Interface) as the transport layer.

---

## Architecture

```
┌──────────────────┐       NDI Out        ┌──────────────┐
│                  │ ──────────────────▶   │              │
│  Three.js Sim    │                       │   Chromatik  │  ──▶  DMX Output
│  (Browser)       │                       │              │       (to real fixtures)
│                  │  ◀──────────────────  │              │
└──────────────────┘       NDI In         └──────────────┘
         │                                        │
         │    WebSocket Bridge                     │
         │    (Node.js + NDI SDK)                  │
         └────────────────────────────────────────┘
```

---

## Direction 1: Simulation → Chromatik (NDI Out)

### Purpose
Generate lighting patterns in the simulation (eventually running Pixelblaze pattern code in the browser) and send pixel color data to Chromatik, which maps it to DMX universes for physical fixture control.

### Use Case
- Develop patterns in the simulation where you can see the full 3D scene context
- Run Pixelblaze `.js` pattern scripts directly in the browser
- Send the resulting per-fixture color values to Chromatik
- Chromatik outputs to DMX → real-world fixtures respond in real-time

### Data Flow
1. Simulation evaluates pattern → produces array of `[R, G, B]` per fixture index
2. Pixel data encoded into a small NDI video frame (e.g., 1×N texture, N = fixture count)
3. NDI frame sent via Node.js bridge (WebSocket → NDI SDK → NDI network)
4. Chromatik receives NDI source, maps each pixel to a DMX address
5. Chromatik outputs sACN/ArtNet to the lighting network

---

## Direction 2: Chromatik → Simulation (NDI In)

### Purpose
Show how Chromatik-authored patterns would look on the actual installation, visualized in the full 3D simulation — **without any physical hardware**.

### Use Case
- Lighting designers work in Chromatik (familiar tool, powerful pattern engine)
- Chromatik sends its output as an NDI source
- The simulation receives pixel data and applies it to the 3D fixture meshes
- Immediate visual feedback in the photorealistic 3D environment

### Data Flow
1. Chromatik evaluates pattern → produces per-fixture color output
2. Chromatik outputs an NDI frame (1×N pixel strip) alongside normal sACN/ArtNet
3. Node.js bridge receives NDI frame → forwards via WebSocket to browser
4. Three.js simulation parses pixel array → applies color to each `ParLight`, `Iceberg` flood, and `LedStrand` mesh
5. 3D scene updates in real-time at target <100ms latency

---

## Chromatik 3D Model Export

### 3D Model Import
- Export the ship geometry from simulation as OBJ/FBX for Chromatik's 3D visualizer
- Coordinate baking: convert from Three.js conventions (Y-up, meters) to Chromatik's expected coordinate system
- Optimize mesh to keep Chromatik's viewport responsive

### Light Position Export ("Big Pixels")
Each light fixture in `scene_config.yaml` is exported as a pixel with spatial coordinates:

```json
{
  "fixtures": [
    { "id": 0, "type": "par", "x": 20.6, "y": 11.5, "z": 3.0, "universe": 1, "address": 1 },
    { "id": 1, "type": "par", "x": 21.3, "y": 10.9, "z": 2.4, "universe": 1, "address": 5 },
    { "id": 100, "type": "flood", "x": -63.5, "y": 12, "z": 59, "universe": 3, "address": 1 },
    { "id": 104, "type": "ring", "x": 0, "y": 30, "z": -8, "universe": 3, "address": 13 }
  ]
}
```

### Export Script (Future)
A CLI tool that reads `scene_config.yaml` and outputs:
1. Chromatik fixture definition JSON
2. Simplified 3D model (decimated mesh)
3. NDI pixel mapping table

---

## Technical Implementation Notes

### WebSocket Bridge (Node.js)
- Uses `grandiose` npm package for NDI SDK bindings
- Runs as a sidecar process alongside the simulation's `save-server.js`
- WebSocket server on a separate port (e.g., `:8182`)
- Frame rate: 30fps for smooth feedback, configurable

### Pixel Mapping
- Each NDI pixel index maps 1:1 to a fixture index in `scene_config.yaml`
- Fixture ordering: pars first (by config array index), then iceberg floods, then strand segments, then ring segments
- The mapping table is generated from the config and shared between sim and Chromatik

### Latency Target
- **<100ms roundtrip** for interactive pattern development
- NDI over localhost: ~1-2ms
- WebSocket bridge overhead: ~5-10ms
- Three.js material update: ~1 frame (16ms at 60fps)
- Total budget is achievable on a single machine

---

## Implementation Phases

1. **Phase 1:** Chromatik fixture export script (read `scene_config.yaml` → JSON)
2. **Phase 2:** Sim → Chromatik NDI Out (pattern preview on real hardware)
3. **Phase 3:** Chromatik → Sim NDI In (pattern development visualization)
4. **Phase 4:** Pixelblaze pattern runtime in browser → NDI out → Chromatik → DMX
