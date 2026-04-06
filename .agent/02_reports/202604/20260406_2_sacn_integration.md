# sACN Integration — Implementation Plan

> **Branch:** `dev/sacn` (based off `dev/main`)  
> **Design Doc:** [11_sim_sacn_integration.md](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/11_sim_sacn_integration.md)  
> **Date:** 2026-04-06

---

## Decision Log (User Answers)

| # | Question | Decision |
|---|---|---|
| 1 | Config migration | **Single unified YAML.** Incremental migration, but end state must be 1 file. No review until single-file achieved. |
| 2 | Pixelblaze/Marsin role | **Keep pixelblaze as in-sim test engine.** Add `sacn_in` as new lighting engine for external sources. MarsinEngine will eventually output sACN → Sim → physical lights. Sim serves as both visualizer and light-setup tool. |
| 3 | ParLight deprecation | **Remove legacy ParLight class.** Keep generators, refactor to spawn `DmxFixtureRuntime`. Generators get fixture-type selector (default: UKing Par YAML model). |
| 4 | UI priority | **Defer UI redesign.** Work with existing lil-gui panel. Focus on DMX pipeline first. |

---

## Gap Analysis Summary

### Exists Today ✅
- `ParLight` fixture class (to be removed)
- `ModelFixture` class (3D dot-based DMX fixture)
- `DmxFixture` base class (Node.js, CJS) + `DmxUniverse` (512-byte buffer)
- sACN Smart Router (single-universe, global priority lock)
- `universes.yaml` (8 fixtures patched on test bench)
- 3 fixture model YAMLs (UKing Par, SHEHDS Bar, Vintage LED)
- Procedural generators (trace-based, in gui_builder.js)
- Modular simulation architecture (12 modules)

### Missing ❌
- `DmxFixtureRuntime` — unified runtime combining placement + patch + fixture model + live DMX
- `UniverseRouter` — multi-universe, per-patch priority merge
- `UniverseFrameBuffer` — browser-side frame buffer for sim consumption
- `FixtureDefinitionRegistry` — centralized fixture model loader
- `PatchRegistry` — fixture-to-universe-channel mapping
- `sacn_in` InputSource — browser-side sACN receiver (via WebSocket bridge)
- Unified `scene_config.yaml` format (meta, network, scene, universes, fixtures)
- Config validation & invariants
- Debugging tools (ownership inspector, DMX channel view)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     MarsinEngine (future)                        │
│        Produces patterns → outputs sACN/Art-Net                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ sACN over network
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js Server Layer                           │
│                                                                  │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │ sACN Receiver│──▸│ UniverseRouter   │──▸│ sACN Sender      │  │
│  └─────────────┘   │ (priority merge) │   │ (to hardware)    │  │
│                    └───────┬──────────┘   └──────────────────┘  │
│                            │ WebSocket                           │
└────────────────────────────┼─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Browser Simulation                             │
│                                                                  │
│  ┌─────────────────┐   ┌────────────────┐   ┌────────────────┐  │
│  │PixelblazeEngine │   │ sacn_in Source  │   │ UniverseFrame  │  │
│  │ (test patterns) │──▸│ (WS receiver)  │──▸│ Buffer (512×N) │  │
│  └─────────────────┘   └────────────────┘   └───────┬────────┘  │
│                                                      │           │
│  ┌──────────────────────────────────────────────────┐│           │
│  │           DmxFixtureRuntime[] (per fixture)      ││           │
│  │  ┌─────────────┐ ┌──────────┐ ┌──────────────┐  ││           │
│  │  │ScenePlacement│ │PatchDef  │ │FixtureDef    │◀─┘│           │
│  │  │(pos,rot,mount)│ │(univ,addr)│ │(channels,    │  │           │
│  │  └─────────────┘ └──────────┘ │ pixels,model)│  │           │
│  │                                └──────────────┘  │           │
│  │  → Reads DMX slice → drives 3D visual            │           │
│  └──────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phased Implementation

### Phase 1: Foundation — One Config, New Runtime (This Session)

**Goal:** Single unified `scene_config.yaml`, `FixtureDefinitionRegistry`, `PatchRegistry`, and `DmxFixtureRuntime` replacing `ParLight`.

---

#### Step 1.1: Unified Config Format (in progress)

**[MODIFY] `simulation/config/scene_config.yaml`**

Migrate to the new format. The new top-level structure:

```yaml
meta:
  name: BM26 Titanic
  version: 2

scene:
  model:
    path: 3d_models/2601_001_BURNING MAN HONORARIA_TE.fbx
    position: [-2, 8, 16]
    rotation_deg: [-90, 0, 0]
  atmosphere:
    ambientIntensity: 0.5
    cameraExposure: 0.4
    moonlight: { ... }
    bloom: { ... }
  render:
    mode: design          # design | show
    liteMode: true        # skip SpotLights for GPU perf
    showBeams: false
    showHelpers: false
    showGenerators: false
  camera: { ... }         # saved camera state

network:
  inputs:
    - id: sacn_in
      type: sacn
      enabled: false
      universes: [1]
      priority: 200
  output:
    type: sacn
    enabled: false
    source_name: BM26-Titanic
  merge:
    mode: highest_priority_per_patch

universes:
  1:
    name: main
    fixtures:
      - id: par_1
        type: UkingPar
        addr: 136
        layout: fixtures/uking_rgbwau_par_light/channels_10.yaml

fixtures:
  - id: right_front_wall_1
    type: UkingPar                # references FixtureDefinitionRegistry
    group: Right Front Wall Generator
    patch:
      universe: 1
      fixture: par_1
      state: patched
      locked: true
    placement:
      pos: [20.60, 11.5, 2.99]
      rot: [-62.99, 134.20, -110.82]
      mount: wall
    render:
      color: "#ffaa44"
      
  # Unpatched fixture (from generator, not yet assigned to DMX)
  - id: right_front_wall_2
    type: UkingPar
    group: Right Front Wall Generator
    patch:
      state: unpatched
    placement:
      pos: [19.50, 11.5, 4.10]
      rot: [-60.0, 130.0, -108.0]
      mount: wall

generators:
  - name: Right Front Wall Generator
    fixtureType: UkingPar         # User-selectable fixture type
    shape: line
    count: 20
    startX: 20.6
    # ... same trace config as today ...

lighting:
  enabled: false
  mode: pixelblaze               # pixelblaze | sacn_in | gradient
  gradient:
    speed: 0.1
    stops: ['#ff0000', '#ffffff']
```

**Migration strategy:**
- Write a one-time migration script that converts the current `scene_config.yaml` to the new format
- Each existing `parLights[].fixtures` entry → `fixtures[]` entry with `type: UkingPar`, `patch.state: unpatched`
- Existing `atmosphere`, `options` → `scene.atmosphere`, `scene.render`
- Move `universes.yaml` data into `universes:` section
- The `dmx/universes.yaml` file remains as a reference but the sim reads from the unified config

---

#### Step 1.2: Fixture Definition Registry ✅

**[NEW] `simulation/src/dmx/fixture_definition_registry.js`**

```
Responsibilities:
- Load all fixture model YAMLs from dmx/fixtures/*/model_*.yaml at startup  
- Build map: fixtureType → { id, name, channelMode, totalChannels, pixels[], dimensions, controls[] }
- Expose getDefinition(fixtureType) → FixtureDefinition
- Expose listTypes() → string[]  (for generator fixture-type dropdown)
- Validate required fields on load
```

---

#### Step 1.3: Patch Registry ✅ (code written, not wired)

**[NEW] `simulation/src/dmx/patch_registry.js`**

```
Responsibilities:
- Parse universes: block from unified config
- Build fixture→patch map: fixtureId → { universe, addr, footprint }
- Validate no overlapping addresses within a universe
- Support patch.state: unpatched (excluded from routing)
- Expose:
  - getFixturePatch(fixtureId) → PatchDef | null
  - getUniversePatches(universeId) → PatchDef[]
  - packUnpatchedOnly(universeId) → proposed assignments
```

---

#### Step 1.4: DmxFixtureRuntime (replaces ParLight) ✅

**[NEW] `simulation/src/fixtures/dmx_fixture_runtime.js`**

Replaces both `ParLight` and `ModelFixture` with a single class:

```
Constructor(config, index, scene, interactiveObjects, fixtureDef, patchDef, liteMode)

Properties:
- config        (from fixtures[] entry)
- fixtureDef    (from FixtureDefinitionRegistry)
- patchDef      (from PatchRegistry, or null if unpatched)
- dmxSlice      (Uint8Array view into UniverseFrameBuffer, or null)

3D Objects (same as ParLight):
- hitbox        (invisible raycast target)
- can           (fixture body mesh)
- beam          (additive-blended cone)
- bulb + halo   (glowing emissive sphere)

Methods:
- applyDmxFrame()     — read dmxSlice, extract R/G/B/dimmer, update visuals
- setVisibility()     — same as ParLight (respects liteMode, spotlight cap)
- setColor(r,g,b)     — direct color set (used by pixelblaze/gradient engines)
- syncFromConfig()    — update position/rotation from config
- destroy()           — cleanup
```

---

#### Step 1.5: Config Parser & Main.js Integration

**[NEW] `simulation/src/core/config_v2.js`**

Parses the new unified YAML format:
- Extracts `scene`, `network`, `universes`, `fixtures`, `generators`, `lighting` blocks
- Constructs `params` object that the existing GUI/animation code can consume
- Handles backward compatibility during transition

**[MODIFY] `simulation/main.js`**
- Load unified config instead of separate YAML files
- Initialize `FixtureDefinitionRegistry` + `PatchRegistry` at startup
- Replace `rebuildParLights()` with `rebuildDmxFixtures()`

**[MODIFY] `simulation/src/core/fixtures.js`**
- Replace `ParLight` instantiation with `DmxFixtureRuntime`
- Pass `fixtureDef` and `patchDef` to each runtime

**[MODIFY] `simulation/src/gui/gui_builder.js`**
- Generator fixture creation: push new fixture format instead of legacy ParLight format
- Add fixture-type dropdown to each generator (populated from `FixtureDefinitionRegistry.listTypes()`)
- Default fixture type: `UkingPar`

**[DELETE] `simulation/src/fixtures/par_light.js`** (replaced by `dmx_fixture_runtime.js`)

---

### Phase 2: Router & sACN Input (Next Session)

#### Step 2.1: Universe Frame Buffer
**[NEW] `simulation/src/dmx/universe_frame_buffer.js`**
- `Uint8Array(512)` per universe
- Double-buffered (write buffer + read buffer, swap each frame)
- `DmxFixtureRuntime.dmxSlice` is a view into the read buffer

#### Step 2.2: Universe Router  
**[NEW] `simulation/src/dmx/universe_router.js`**
- Accepts input from multiple sources (pixelblaze, sacn_in)
- Implements `highest_priority_source_lock` and `highest_priority_per_patch`
- Source staleness timeout (~2000ms)

#### Step 2.3: sACN Input Source
**[NEW] `simulation/src/dmx/sacn_input_source.js`**
- WebSocket client that connects to Node.js server
- Receives DMX frames forwarded from sACN network
- Feeds data to UniverseRouter

**[MODIFY] `simulation/server/save-server.js`** (or new `ws-bridge.js`)
- Add WebSocket server
- Bridge sACN receiver packets → WebSocket → browser

#### Step 2.4: Animate Integration
**[MODIFY] `simulation/src/core/animate.js`**
- Each frame: router merges inputs → frame buffer swaps → each DmxFixtureRuntime calls `applyDmxFrame()`
- Pixelblaze engine writes to frame buffer as a source (priority 100)
- sACN input writes at priority 200 (overrides pixelblaze)

---

### Phase 3: sACN Output & Cleanup (Future Session)

- sACN output driver (sim → physical lights)
- `pack_unpatched_only` helper
- Generator → proper DmxFixtureRuntime spawn + auto-patch
- Config validation & invariants
- Export MarsinEngine model + artnet config from sim

---

## File Change Summary (Phase 1)

| Action | File | Description |
|---|---|---|
| NEW | `simulation/src/dmx/fixture_definition_registry.js` | Loads/validates fixture model YAMLs |
| NEW | `simulation/src/dmx/patch_registry.js` | Fixture → universe/channel mapping |
| NEW | `simulation/src/fixtures/dmx_fixture_runtime.js` | Unified runtime (replaces ParLight) |
| NEW | `simulation/src/core/config_v2.js` | New config parser |
| NEW | `simulation/tools/migrate_config.js` | One-time migration script |
| MODIFY | `simulation/config/scene_config.yaml` | Unified format |
| MODIFY | `simulation/main.js` | New startup flow |
| MODIFY | `simulation/src/core/fixtures.js` | Use DmxFixtureRuntime |
| MODIFY | `simulation/src/core/animate.js` | applyDmxFrame() integration |
| MODIFY | `simulation/src/gui/gui_builder.js` | Fixture-type selector, new config format |
| DELETE | `simulation/src/fixtures/par_light.js` | Replaced by dmx_fixture_runtime.js |

---

## Verification Plan

### Automated
- Run `npm start` — sim loads without errors
- All 119 fixtures render at correct positions with bulb/halo/beam visuals
- Generators create new fixtures with correct fixture type
- Config save/load round-trips correctly (save → reload → same state)
- Pixelblaze/gradient engines color fixtures correctly

### Manual
- Toggle lite mode on/off → SpotLights created/skipped
- Toggle beams/generators/helpers → visibility respects config
- Add fixture via generator → appears as UkingPar by default
- Change generator fixture type → new fixtures use selected type
