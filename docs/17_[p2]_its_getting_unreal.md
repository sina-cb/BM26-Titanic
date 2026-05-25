# 17. It's Getting Unreal: The High-Performance Lighting Node

This document outlines the architecture, scope, and technical design for transitioning the BM26-Titanic lighting visualization from a browser-bound WebGL/WebGPU pipeline into a high-performance **Unreal Engine 5.7.4** node.

## 1. Architectural Overview

The simulation environment is expanding to include Unreal Engine as a high-fidelity **read-only visualization monitor**. 

Due to hardware bottlenecks handling massive per-pixel SpotLight counts in standard web rendering, Unreal Engine is introduced to leverage Deferred Rendering (Lumen) and Virtual Shadow Maps.
However, **the browser sim remains the canonical editor**. Unreal Engine acts strictly as a passive listener and renderer.

### Authoring vs. Preview Separation
- **Browser Simulation:** Remains the primary authoring environment for editing transforms, managing patching boundaries, generating geometry, and saving states.
- **Unreal Engine (V1):** Strictly a **read-only preview monitor**. It does not write to the config files and does not permit UI-level structural edits. Its environment must be regenerated programmatically whenever the canonical files change.

---

## 2. Ingestion Contracts

Unreal Engine cannot safely assume `scene_config.yaml` represents the entire state of the rig. Unreal's automated Python ingestion script must honor the exact multi-file schema currently used by the core simulation. To prevent broad dependencies, this is strictly decoupled:

### `UnrealSceneSource` (Regeneration Inputs)
The explicit ingest contract for regenerating the Unreal Level requires parsing and merging:
1. `common.yaml` (Base structural/shared settings)
2. `scene_config.yaml` (Specific fixture topologies for `titanic` or `test_bench`)
3. `patches.yaml` (Addressing, universe, controller IP, and section groupings)
4. `cameras.yaml` (To synchronize viewport framing with the browser's perspectives)
5. **Fixture Model YAMLs**: The concrete channel footprints and layouts utilized by `fixture_definition_registry.js` must be ingested so Unreal can correctly map attributes (e.g., RGB/WAU) when generating its internal Fixture Types.

### `UnrealRuntimeConfig`
1. `marsin_engine/config.yaml` -> **Isolated to `global_effects` only.** (Unreal does not ingest `playlist`, `server.port`, or operational settings.)

*Note: Unreal must support Multi-Scene ingestion (e.g., separating the `titanic` layout from the `test_bench` layout).*

---

## 3. Parity Requirements

### Concrete Fixture Parity
Unreal Blueprints must be matched 1:1 with the active DMX-patched runtime classes:
- **`UkingPar`**: Standard mapped PAR lights (RGB/WAU into one material cluster).
- **`ShehdsBar`**: Linear sectioned wash bars (per-segment materials or instances).
- **`VintageLed`**: Warm-white specific nodes (warm head intensity plus aux RGB).
- **`FogMachine`**: DMX-triggered volumetric density override.

> [!WARNING]
> **Static Geometry for Non-DMX Elements**
> **Icebergs** and **LED Strands** are currently excluded from live sACN control in V1 because they are exported with `patch: null`. However, Unreal **will still spawn their static geometry** during scene ingestion to guarantee the monitor perfectly matches the authored layout structure. They will simply exist as passive, read-only elements.

### Shared Address Behavior (Aliasing)
The current scene data allows multiple physical fixtures to share the same DMX address (e.g., two Fog Machines mapped to `U1:512`). Our explicit rule for the managed DMX Library is **Shared-Patch Aliasing**: 
- If the Python script detects a duplicate universe/address, mapping collision is resolved by creating exactly **one synthetic FixturePatch**. 
- Multiple Unreal Blueprint Actors are then spawned and bound to that single unified patch via their `OnFixturePatchReceivedDMX` event listeners.

### Metadata Parity
Spawned Unreal fixtures must inherit and respect the V2 metadata pathway: `controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`, `sectionId`, `fixtureId`, and `viewMask`.

---

## 4. Render Input Contract: `UnrealRenderInput`

Unreal Engine will **not** listen to the raw WASM pattern stream. To maintain absolute parity, Unreal must render the **post-processed final frame** exactly as it goes to the physical rig.

**Explicit Architecture Rule:** V1 Unreal ingests DMX through a managed **DMX Library + Fixture Types + Fixture Patches**, not through a raw universe listener by default. The Python ingest step will mathematically generate these patches within the Unreal DMX Library, and Actors will bind to `OnFixturePatchReceivedDMX`.

### Transport Strategy (Multi-Unicast Fan-Out)
Currently, `sacn_output.js` operates as a single-destination unicast sender. To bridge Unreal:
- `marsin_engine/lib/sacn_output.js` will be heavily refactored from a single IP to an **explicit multi-unicast fan-out array** (e.g., `destinations[]`). 
- This guarantees deterministic delivery of the post-processed frame (including dimmers and global effects) to both the physical hardware IPs and the local Unreal Engine NIC IP synchronously.

---

## 5. UI Integration Contract (CaptainPad)

1. **Native UI Persistence**: CaptainPad will maintain its interactive React-based interface. The Unreal Pixel Stream is strictly embedded as the isolated **Monitor Component**, keeping API endpoints responsible for data.
2. **Session / Status API Sync**: The iPad app currently hardcodes the monitor window to `test_bench`. A new `/status` endpoint (returning active scene, model, pattern, and Unreal stream state) must be implemented in the `marsin_engine` so CaptainPad can dynamically sync and instruct Unreal which level to render.
3. **Stream Reliability Behavior**: The Web UI must implement fallback/reconnect handling for the Pixel Streaming WebRTC connection.

---

## 6. Parity-Validation Matrix

Implementation must satisfy the following checks before marking V1 complete:

| Validation Area | Success Condition |
| --- | --- |
| **Scene Regeneration** | Python script parses `scene_config.yaml` & `patches.yaml` to spawn the correct number/coordinates of Blueprints without manual alignment. |
| **Fixture Type Gen.** | `UkingPar` attributes mathematically derive from model registries, successfully interpreting custom WAU/UV channel arrays in UE DMX Editor. |
| **Shared Patch Handling** | Overlapping topologies (e.g. dual foggers) natively bundle into single UE DMX Library patches. |
| **Final-Frame Overrides** | Global blackout, section dimming, and UV overrides are visually identical in the UE stream and physical output. |
| **Status API Freshness** | CaptainPad updates scene mappings immediately based on `api_server.js` dynamic `/status` payload, un-hardcoding `test_bench`. |

---

## 7. Integration with the Main Web Simulation (The Master Configurator)

The overarching goal is to unify the browser-based simulation (`main.js` / Web UI) and the Unreal Engine simulation so the **Web UI acts as the sole, master configuration tool**. 

### The Engine Toggle Pipeline
1. **Web UI Pivot:** A master toggle (`Engine Mode: [Three.js, Unreal Engine]`) will be added to the `lil-gui` options in the web simulator.
2. **IFrame Handoff:** When Unreal Engine is selected:
   - Three.js rendering pauses to save system resources.
   - An `<iframe>` pointing to the Pixel Streaming WebRTC local server (`http://localhost`) overlays the canvas.
   - Settings that do not apply to Unreal (e.g. Three.js Grid helpers, specific ambient material overrides) are grayed out or hidden.
3. **The Push (Cross-App IPC):** Whenever the user changes scenes (`?scene=test_bench`) or clicks "Save" in the web interface, the node server will intercept the updated `scene_config.yaml` state and push the complete JSON architecture to the Unreal Python HTTP Bridge via a new endpoint (`POST /api/scene-sync`).

### The Headless Scene Architect (Python)
Instead of statically binding to pre-baked maps, the Unreal Python backend (`sacn_unreal_receiver.py`) will serve as a **Headless Scene Architect**.
- **Purge:** Upon receiving a `/api/scene-sync` payload, it deletes any dynamically spawned meshes and DMX lights from the previous state.
- **Sublevel / Geometry Load:** Based on the scene name, it either streams in a pre-baked static Sublevel (e.g., `Titanic_Geo.umap`), or uses `unreal.AssetImportTask` to ingest and spawn STLs/FBXs dynamically.
- **Fixture Spawning:** It iterates through `parLights` and `dmxLights` from the JSON payload, spawns `PointLight` or Blueprint instances, applies exact XYZ transforms, and tags them (`MarsinPixel`, `U1`, `A166`) so the sACN receiver can immediately cache and drive them.

---

## 8. Unreal Engine Directory & Asset Structure

To keep things clean, trackable, and to prevent different scenes (e.g., `titanic` vs `test_bench`) from polluting each other, we will implement the following structured hierarchy inside the `simulation/unreal/` directory.

### Asset Content Structure (`Content/Marsin_Scenes/`)
This isolates all simulation-specific assets from standard Unreal engine bloat.
```text
Content/Marsin_Scenes/
├── Shared/
│   ├── Blueprints/          # Reusable actors (e.g., UkingPar_BP, Fog_BP)
│   ├── Materials/           # Master materials (e.g., Emissive LEDs, Metal Hull)
│   └── BaseMap.umap         # The persistent, empty master level (holds global PostProcess/Lighting)
├── Titanic/
│   ├── Titanic_Geo.umap     # Read-only static geometry sublevel for the Titanic scene
│   └── Meshes/              # Imported FBX/STL files specific to this scene
└── Test_Bench/
    ├── TestBench_Geo.umap   # Sublevel for local testing layout
    └── Meshes/
```

### Python Script Structure (`scripts/`)
We will split out the monolithic `sacn_unreal_receiver.py` into distinct domains to maintain separation of concerns:
```text
scripts/
├── __init__.py
├── sacn_unreal_receiver.py  # The master entry point and UDP socket ticker
├── http_bridge.py           # Isolates the ThreadingHTTPServer and /api/... endpoints
├── scene_architect.py       # NEW: Handles purging, parsing JSON, and spawning Sublevels/Actors
└── fixture_manager.py       # NEW: Handles identifying, tagging, and assigning properties to lights
```

This strict layout guarantees that as we add more models and scenes, Unreal remains organized, and the Python tools naturally isolate networking from level design.
