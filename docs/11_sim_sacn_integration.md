# BM26 Titanic Simulation — sACN Integration & Architecture Redesign

## 1. Overview & Key Objectives

This technical design document outlines the transition of the BM26 Titanic Interactive Simulation toward a robust sACN/DMX-driven network pipeline. 

The primary goals are:
- Transitioning from a heavily GUI-defined scene state to a unified, clean YAML configuration.
- Separating the roles of **fixture placement** (scene) from **fixture definition/patching** (DMX universes).
- Updating the UI to feel like a high-performance lighting desk / scene editor.
- **Deprecating the legacy `ParLight` pattern** in favor of exclusively using strict runtime objects.

**Core Architectural Concept:**
`DmxFixtureRuntime = Scene Placement + Patch Definition + Fixture Definition + Live DMX Slice`

## 2. Deprecation of ParLights / Move to DMX Fixtures Only

> [!WARNING]
> **Code Cleanup & Refactoring**
> We are actively deprecating `ParLight` classes and the legacy `parLights` block from the `scene_config.yaml`. The app will be heavily refactored to **keep only DMX fixtures**. 

**Procedural Generators Preserved:** While `ParLight` definitions will be deprecated, the existing procedural fixture generation logic (e.g., Deck Generators, Wall Generators, Chimney Generators) will be preserved as an option. These generators will be refactored to procedurally spawn modern, strict `DmxFixtureRuntime` entities rather than legacy par lights.
- **Lifecycle:** Procedural generators run at scene load time and produce deterministic fixture instances. Generated fixtures are treated identically to static fixtures after creation.
- **Patch Allocation:** Procedural generators produce fixtures with `patch.state: unpatched` by default. These fixtures are then manually patched by the user, or the user may invoke `pack_unpatched_only` to assign them into remaining free channel gaps of a chosen universe. Alternatively, generators may request explicit patch allocation through the `PatchRegistry`, which guarantees non-overlapping channel assignments.

Currently, `scene_config.yaml` mixes placement, metadata, and visual characteristics directly together. 
- **Future State:** At runtime, the application will solely operate on DMX fixtures. Each runtime fixture retrieves its static transform from its scene placement (`fixtures` block) and its live rendering data from the sACN merged DMX frame buffer. 
- **Other Elements:** Elements like the *Titanic Model*, *Atmosphere*, and the *Iceberg Arrays* will be cleanly maintained under the `scene:` block, ensuring the new design handles all non-DMX elements natively.

---

## 3. Recommended sACN Architecture

The application is divided into three isolated layers:

### A. Input Layer
Receives DMX values from Art-Net or sACN sources (e.g., from outside tools, internal test patterns, or physical desks).

#### Source Priority Model
The router accepts universe data from multiple input sources and resolves them by configured source priority.

Source priority values:
- pixelblaze / marsin-engine: 100
- canopy: 150
- Chromatik (LX): 200

Chromatik remains the highest-priority source.

Priority is interpreted according to router mode:
- `highest_priority_source_lock`: highest-priority active source owns the whole output.
- `highest_priority_per_patch`: highest-priority active source is selected independently for each patch.

**Source selection granularity depends on router mode:**
In `highest_priority_source_lock`, selection is global. In `highest_priority_per_patch`, selection is resolved independently per patch.

**Active Source Definition:**
A source is considered active if it has produced data within a configurable timeout window (e.g., 1000–2000 ms). Stale sources are automatically excluded from selection.

### B. Router / Merge Layer
This acts as the heart of DMX data, routing input buffers into the simulation.

#### Router Merge Modes
- **`highest_priority_source_lock`**: The router selects the single highest-priority active source across all configured inputs and grants that source full ownership of the final output. All lower-priority sources are ignored completely, even if the winning source does not provide data for every patched fixture. **If the winning source does not provide data for a patch, the output for that patch is set to zero (black) by default.** This is a global ownership mode and is the strongest override behavior.
- **`highest_priority_per_patch`**: The router resolves ownership independently for each patch. For every patched fixture, the router inspects all active sources that provide data for that patch and selects the highest-priority source for that patch's DMX slice. Different patches may therefore be owned by different sources at the same time. This is a patch-level priority merge, not a universe-level switch and not a channel-by-channel blend.

*Note: v1 intentionally avoids per-channel HTP/LTP merge behavior unless a concrete use case requires it.*

### C. Simulation & Output Layer
**The simulation does not read raw network packets.** Instead, it queries the `finalUniverses` alongside static patch and placement data to update visual renderings.
Additionally, this layer can transmit the final computed buffer back out over sACN.

**Timing Model:** 
The router updates `finalUniverses` on DMX frame cadence (e.g., ~44Hz), while the simulation consumes the latest available frame each render tick (e.g., 60fps). This prevents future sync confusion.

*Future Note: This architecture perfectly positions the app to support recording/replay of `finalUniverses` for offline simulation, testing, and debugging without needing network inputs.*

---

## 4. Runtime Module Boundaries
To keep the implementation clean and strictly separated, the core logic should follow these exact module boundaries:
- `InputSource` / `SacnInputSource`
- `UniverseRouter`
- `UniverseFrameBuffer`
- `FixtureDefinitionRegistry`
- `PatchRegistry`
- `SceneFixtureInstance`
- `DmxFixtureRuntime`
- `SacnOutputDriver`

### Implementation Status

| Module | File | Status |
|--------|------|--------|
| `SacnInputSource` | `src/dmx/sacn_input_source.js` | ✅ Implemented — receives sACN via WebSocket from bridge, submits to router |
| `UniverseRouter` | `src/dmx/universe_router.js` | ✅ Implemented — multi-source merge with source_lock and per_patch modes |
| `UniverseFrameBuffer` | `src/dmx/universe_frame_buffer.js` | ✅ Implemented — double-buffered read/write with HTP merge |
| `PatchRegistry` | `src/dmx/patch_registry.js` | ✅ Implemented — validates non-overlapping patches, but not yet populated from config |
| `DmxFixtureRuntime` | `src/fixtures/dmx_fixture_runtime.js` | ✅ Implemented — accepts patchDef + fixtureDef, applies DMX slices |
| `SacnOutputDriver` | — | ❌ Not yet implemented (future: re-broadcast final output) |
| `FixtureDefinitionRegistry` | — | 🟡 Partial — fixture types exist but no centralized registry |

### Current Data Pipeline (Working)

```
MarsinEngine CLI ──sACN──▶ sacn_bridge.js ──WS──▶ SacnInputSource
                           (port 6971)             │
                                                   ▼
                                            UniverseRouter
                                                   │
                                                   ▼
                                            animate.js sACN Direct Apply
                                            (sequential auto-pack mapping)
                                                   │
                                                   ▼
                                            Par/LED/Iceberg fixtures
                                            (light.color, bulb color)
```

> [!NOTE]
> The current pipeline uses a "sACN Direct Apply" path in `animate.js` that reads DMX data from the router using a sequential auto-pack layout (pars=10ch, LEDs=3ch) matching the MarsinEngine's model export. This bypasses the `patchDef` requirement on legacy `ParLight` fixtures. Once fixtures are migrated to `DmxFixtureRuntime` with proper `patchDef`, the direct-apply path will be deprecated.

### sACN Monitor Panel

A floating `📡 sACN Monitor` panel in the browser UI shows:
- Bridge connection status
- Real-time packet activity logs
- Source name and priority

Managed by `src/gui/sacn_monitor.js`, positioned on the left side (z-index 200), draggable, collapsible, and scrollable.

## 5. What DMX Patching Means

A DMX universe contains 512 channels. Patching is the mapping from a fixture to a channel range within one of those universes.

A patch is a logical fixture mapping defined by:
- universe
- start address
- channel footprint/layout (derived from the layout profile)

**Patch Ownership & Priority Logic**
In `highest_priority_per_patch` mode, source arbitration is resolved per patch, not per universe and not per individual channel. That means one source may own one fixture while another source owns a different fixture, even if both fixtures live in the same universe.

**The channel footprint of a fixture is derived from its layout profile.** The system must compute `[addr, addr + footprint - 1]` and validate against universe bounds.

*Implementation Note:* In `highest_priority_per_patch` mode, a source is considered to "provide data for a patch" strictly if:
- the source is active.
- the universe containing the patch has been received from that source.
- the full channel range `[addr, addr + footprint - 1]` is present in the latest frame.
Partial or missing ranges invalidate the source for that patch.

This patching is fundamentally separate from scene placement:
- `universes` defines where fixtures live in DMX channel space.
- `fixtures` defines where fixtures live in 3D scene space.

---

## 6. Fixture Definition Requirements

Fixture designers must provide explicit metadata beyond DMX channel layouts to support simulation realism:
- fixture type id
- channel layout/profile path
- channel footprint
- physical size/dimensions
- mount pivot
- local forward axis
- local up axis
- beam origin
- beam direction
- default render hints

This metadata is strictly required to power Mount mode, Aim mode, beam previews, accurate gizmos, and surface snapping orientation.

---

## 7. Unified Scene Configuration Format (`scene_config.yaml`)

We use a unified YAML file that segregates network, patching, and scene logic. 
*Conceptual note: `universes` establishes the logical DMX patch topology (where fixtures live in channel space), while `network.output` establishes transport routing (where those final universes get sent on the network). `network.output` defines default transport behavior, whereas `universes[].output` may optionally override output settings per universe when specified.*

```yaml
meta:
  name: BM26 Titanic
  version: 1

network:
  inputs:
    - id: chromatik_a
      type: sacn
      enabled: true
      universes: [1, 2, 3]
      priority: 200
  output:
    type: sacn
    enabled: true
    source_name: BM26-Titanic
    mode: unicast
    destinations:
      - ip: 127.0.0.1
        universes: [1]
  merge:
    mode: highest_priority_per_patch  # Patch-by-patch composition

scene:
  model:
    path: models/titanic.fbx
    position: [-2, 8, 16]
    rotation_deg: [-90, 0, 0]
  render: 
    # mode explicitly triggers design or show context
    # design: prettier, more complete, more diagnostic, higher quality.
    # show: cheaper, simpler, more stable, performance-oriented.
    mode: design
    show_beams: true
    show_helpers: true
    show_surface_snap: true

universes:
  1: # Universe ID
    name: test_bench
    output:
      ip: 127.0.0.1
      priority: 100
    fixtures:
      - id: par_1
        type: UkingPar
        addr: 136
        layout: fixtures/uking_rgbwau_par_light/channels_10.yaml

fixtures:
  - id: right_front_wall_1
    patch:
      universe: 1
      fixture: par_1
      locked: true   # Patched fixtures are fixed and never moved automatically
    placement:
      pos: [20.60, 11.5, 2.99]
      mount_rot: [-62.99, 134.20, -110.82]
      aim_rot: [0, 0, 0]
      mount: wall
      mount_ref: hull_starboard_section_a
    render:
      design: beam
      show: hero
      color: "#ffaa44"

  # Draft/Unpatched Fixture Support
  - id: left_deck_2
    patch:
      state: unpatched
    placement:
      pos: [-14.50, 12.0, 5.00]
      mount_rot: [0, 90, 0]
      aim_rot: [0, 0, 0]
      mount: floor
```

> [!NOTE]
> The split in the `placement` block (`mount_rot` for the installation frame vs. `aim_rot` for the fixture optics) exists specifically to handle cases like a tilted Titanic surface with an “upright-installed” fixture.

---

## 8. Patch Policy

Manual patching is the default and primary workflow. Physical fixture addresses are set on real devices, universe routing is fixed in deployment, and the software adapts to the physical rig rather than reshuffling it.

**Patch States:**
- **Patched + Locked:** A fixture with `universe`, `address`, and `locked: true` is fixed and must never be changed automatically. All manually patched fixtures are locked by default.
- **Unpatched (Draft):** A fixture with `patch.state: unpatched` has no DMX mapping, is excluded from router processing, and is eligible for helper-assisted placement.

#### `pack_unpatched_only` Helper
A one-time helper command, not an ongoing behavior. It operates on a selected universe and:
- Treats all existing patched fixtures in that universe as **blocked occupied ranges**.
- Assigns addresses only to fixtures with `patch.state: unpatched`.
- Never moves or rewrites existing patch assignments.
- Fails if no contiguous free slot exists for a fixture's footprint.

This helper must be invoked explicitly by the user. It must never run silently or automatically.

---

## 9. Validation & Invariants

The configuration system enforces the following deterministic checks:
- Every scene fixture `id` must be unique.
- **Patch fixture IDs must be globally unique across all universes.**
- **Each patch entry represents a single physical fixture and must be referenced by exactly one scene fixture instance.**
- Every `fixtures[].patch.fixture` reference must resolve to a valid defined patch entry (unless `state` is `unpatched`).
- No fixture may overflow past channel 512 in a universe.
- Overlapping addresses in the same universe must be flagged as strict configuration errors.
- Every fixture type must resolve to a valid channel layout/profile, and referenced layout files must physically exist.
- Render mode values and mount type values (free, wall, floor, truss) must be strictly validated.

#### Draft/Unpatched Fixtures
The engine explicitly permits:
```yaml
patch:
  state: unpatched
```
When `patch.state` is configured as `unpatched`, no DMX mapping is applied, properties like `universe`, `fixture` or `addr` are ignored, and the fixture is entirely excluded from router processing.

---

## 10. Debugging & Diagnostics

Crucial debug hooks required for development predictability:
- **Ownership Inspector:** Inspect per-universe source ownership.
- **Source Visualization:** Visualize the active source per universe in the UI and optionally in the 3D view.
- **Network Health:** Show stale/active timeout statuses of inbound network connections.
- **Fixture DMX View:** A mechanism to selectively inspect `[0-255]` slices for any individual fixture mapped physically in DMX.

---

## 11. UI / UX Design

The user interface adopts a robust 3-Pane Layout resembling a professional lighting console.

### Left Panel: Scene / Patch Browser
- **Fixtures Tab:** Full tree view. Enables navigating placed fixtures.
- **Universes Tab:** Important visual Patch Strip (Channels 1-512) for viewing gaps/overlaps intuitively.
- **Types/Groups Tabs:** Libraries and selection logic.

### Center Panel: 3D View
Features explicit interaction tools (Select, Add, **Move**, **Mount**, **Aim**, **Snap**).

### Right Panel: Inspector
Sectioned cards for Identity, Patch details, Placement adjustments, Render modes, and Live DMX read-outs.

### Explicit Workflows

#### 1. Add and Patch a Fixture
- Choose fixture type.
- Place in 3D (fixture starts as `unpatched`).
- Manually set universe and DMX address in the Patch inspector.
- Inspect and refine.

#### 2. Repatch a Fixture
- Select fixture.
- Open Patch inspector.
- Edit universe/address or visually drag in the patch strip.
- Validate overlap / capacity.

#### 3. Surface-Mount a Fixture
- Enable surface snap.
- Hover geometry and show wall highlight patch.
- Click to place.
- Adjust with Move / Mount / Aim.

#### 4. Pack Unpatched Fixtures
- Open Universes tab, select target universe.
- Click **Pack Unpatched Only** (or **Find Free Slot** for a single fixture).
- Review proposed assignments.
- Confirm to write patch entries. Existing patched fixtures are never moved.
