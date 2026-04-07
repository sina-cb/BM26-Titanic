# Team Report — April 7, 2026
## Simulation sACN Router Architecture & DMX Pipeline

**Author:** Sina Solaimanpour
**Commits:** 27 (c490f56 → bfb0fe8)
**Scope:** 229 files changed · +33,677 / -6,250 lines
**Live Demo:** [sina-cb.github.io/BM26-Titanic/simulation/](https://sina-cb.github.io/BM26-Titanic/simulation/)

---

## 1. Executive Summary

The lighting simulation has been transformed from a standalone 3D previewer into a **full sACN (E1.31) DMX router**. It now sits at the center of our lighting pipeline: receiving DMX from any number of rendering engines, merging them by priority, previewing the result in real-time 3D, and forwarding the output to real physical DMX controllers. This eliminates the need for separate routing tools and gives us a single interface for design, preview, and hardware control.

---

## 2. Architecture Overview

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  MarsinEngine    │  │  Chromatik       │  │  Canopy          │
│  (pri 100)       │  │  (pri 200)       │  │  (pri 150)       │
└────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
         │ sACN (UDP)          │ sACN (UDP)          │ sACN (UDP)
         └─────────────────────┼─────────────────────┘
                               ▼
                 ┌──────────────────────────┐
                 │  sACN Input Bridge       │
                 │  (Node.js, port 6971)    │
                 │  Receives sACN → WS      │
                 └────────────┬─────────────┘
                              │ WebSocket
                              ▼
                 ┌──────────────────────────┐
                 │  Browser Simulation      │
                 │  ┌────────────────────┐  │
                 │  │ UniverseRouter     │  │
                 │  │ Priority-based     │  │
                 │  │ multi-source merge │  │
                 │  └────────┬───────────┘  │
                 │           │              │
                 │  ┌────────▼───────────┐  │
                 │  │ 3D Scene Render    │  │
                 │  │ (Three.js + Bloom) │  │
                 │  └────────┬───────────┘  │
                 │           │              │
                 │  ┌────────▼───────────┐  │
                 │  │ SacnOutputClient   │  │
                 │  │ Per-fixture IP     │  │
                 │  └────────┬───────────┘  │
                 └───────────┼──────────────┘
                             │ WebSocket
                             ▼
                 ┌──────────────────────────┐
                 │  sACN Output Bridge      │
                 │  (Node.js, port 6972)    │
                 │  Pooled sACN senders     │
                 └────────────┬─────────────┘
                              │ sACN (UDP)
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              PKnight    PKnight    PKnight
              10.1.1.101 10.1.1.102 10.1.1.103
```

### Key Design Decisions

1. **Browser as Router**: The simulation browser app is the central routing node. All rendering engines send sACN to it, and it decides what reaches hardware. This means anyone looking at the sim sees exactly what's going out to the lights.

2. **Priority-Based Merge**: When multiple sources send to the same universe, the `UniverseRouter` resolves conflicts automatically. Higher priority always wins. This allows us to run MarsinEngine for ambient patterns while a lighting designer uses Chromatik to override specific fixtures.

3. **Per-Fixture Controller IP**: Instead of a global routing table, each fixture or generator group carries its own target controller IP. This maps directly to how we'll wire the playa — each physical DMX node gets its own IP.

---

## 3. Feature Details

### 3.1 sACN Input Pipeline

**Files:** `server/sacn_bridge.js`, `src/dmx/sacn_input_source.js`, `src/dmx/universe_router.js`

The sACN bridge server listens for E1.31 UDP packets from any source on the network. It forwards these to the browser via WebSocket. The browser's `SacnInputSource` deserializes the frames and submits them to the `UniverseRouter` with the source's priority.

The router supports three merge modes:
- **`highest_priority_source_lock`** — The highest-priority active source owns the entire universe. Good for "Chromatik takes over everything" scenarios.
- **`highest_priority_per_patch`** — Each fixture patch slot is controlled by its highest-priority source. Allows MarsinEngine to control some fixtures while Chromatik controls others.
- **`htp`** — Highest Takes Precedence per channel. Classic DMX merge. 

Sources are tracked with a 2-second stale timeout — if a source stops sending, the next-highest priority takes over automatically.

### 3.2 sACN Output Pipeline

**Files:** `server/sacn_output_bridge.js`, `src/dmx/sacn_output_client.js`

The output bridge accepts binary WebSocket frames from the browser (519 bytes: 2B universe + 4B IP + 1B priority + 512B DMX) and forwards them as sACN unicast packets. It uses a pooled sender architecture — one `sacn.Sender` instance per `{universe, controller IP}` pair, with automatic cleanup after 15 seconds of inactivity.

The render loop (`animate.js`) groups patched fixtures by `universe:controllerIp` and sends full 512-byte universe buffers to the bridge on every frame.

### 3.3 Multi-Source Priority System

| Source | Default Priority | Use Case |
|--------|-----------------|----------|
| MarsinEngine | 100 | Ambient generative patterns |
| Canopy | 150 | Structured lighting scenes |
| Chromatik (LXStudio) | 200 | Lighting designer override |

All sources point their sACN output at the sim's IP. The sim handles priority resolution and outputs the merged result to hardware. To switch between sources, you simply start/stop the engines or adjust priorities — no reconfiguration needed. The `UniverseRouter` handles everything automatically.

**Easy switching**: In the simulation GUI, the lighting mode dropdown lets you instantly switch between:
- `sacn_in` — Live DMX from external sources
- `pixelblaze` — Client-side pattern rendering
- `gradient` — Built-in gradient animation
- `off` — Blackout

### 3.4 Lite Mode (Mac Performance)

**Context:** Windows machines can render fixtures as true emitting light sources (SpotLights with real shadow casting), but Mac GPUs — especially integrated ones — struggle with more than 30 active SpotLights due to WebGL uniform limits.

**Solution:** Lite mode replaces expensive SpotLights with simple emissive meshes (glowing bulbs). The fixture geometry still shows correct color, but no light cones are cast into the scene. This brings Mac render performance from ~8fps up to 60fps with 120+ fixtures.

**Controls:**
- `conesEnabled: false` in GUI → disables SpotLight cones (Lite mode)
- `masterIntensity` controls overall fixture brightness in both modes
- Active SpotLights are capped at 30 to prevent WebGL uniform overflow

### 3.5 Controller IP Assignment

Each fixture carries its own `controllerIp` field:
- **Generator groups**: Set the IP once on the generator trace → all generated fixtures inherit it
- **Manual fixtures**: Editable `controllerIp` in the DMX Patch section
- **Generated fixtures**: Read-only display of inherited IP

When `controllerIp` is set and the fixture is patched (universe + address), the output pipeline automatically routes its DMX data to that controller.

### 3.6 Auto-Patching

One-click "🎯 Auto-Patch All Unpatched" button:
- Finds all fixtures with `dmxUniverse: 0` or `dmxAddress: 0`
- Packs them sequentially by channel footprint
- Fills universe 1 first (512 channels), then 2, 3, etc.
- Respects existing patches — only fills gaps

### 3.7 MarsinEngine

**Directory:** `marsin_engine/`

Standalone Node.js CLI that renders Pixelblaze-compatible patterns and outputs sACN. Key features:
- Renders against the simulation's exported 3D pixel model (`models/model.js`)
- Full Pixelblaze API: `time()`, `wave()`, `sin()`, `hsv()`, `rgbwau()`, etc.
- 9 patterns: bioluminescence, rainbow, fire, breathing, ocean liner, plasma, sparkle, wipe, test_6ch
- Multi-universe output (323 pixels across 4 universes)
- Configurable FPS (default 40), priority, destination IP

```bash
node engine.js --pattern bioluminescence          # → sim preview
node engine.js --pattern fire --dest 10.1.1.102   # → real hardware
```

### 3.8 sACN Monitor Panel

Floating draggable panel in the browser UI showing:
- Connection status (dot indicator: grey → green → pulsing)
- Incoming FPS
- Total frames received
- Active universes (count + list, e.g. "4 [1,2,3,4]")
- Source priority
- Activity log with timestamps

### 3.9 Codebase Modernization

The monolithic `main.js` (3,500+ lines) was split into 12 focused modules:

| Module | File | Purpose |
|--------|------|---------|
| State | `src/core/state.js` | Global state management |
| Config | `src/core/config.js` | YAML config load/save |
| Environment | `src/core/environment.js` | Scene, camera, lighting setup |
| Fixtures | `src/core/fixtures.js` | Fixture creation from config |
| Interaction | `src/core/interaction.js` | Mouse, keyboard, transform controls |
| Animate | `src/core/animate.js` | Render loop + DMX output |
| Undo | `src/core/undo.js` | 50-deep snapshot undo/redo |
| GUI Builder | `src/gui/gui_builder.js` | lil-gui fixture management |
| Pattern Editor | `src/gui/pattern_editor.js` | Lighting mode selector |
| sACN Monitor | `src/gui/sacn_monitor.js` | Floating stats panel |
| View Presets | `src/gui/view_presets.js` | Camera preset management |
| MarsinEngine | `src/core/marsin_engine.js` | Client-side Pixelblaze runtime |

Old DMX backend (DmxHandler, smart router, Pixelblaze WebSocket util) archived to `archived/dmx/`.

---

## 4. Repository Structure (Current)

```
BM26-Titanic/
├── simulation/              # Main application
│   ├── config/              # YAML configs (scene, server, cameras)
│   ├── server/              # Node.js backend services
│   │   ├── save-server.js   # Config persistence API
│   │   ├── sacn_bridge.js   # sACN input bridge (sACN → WS)
│   │   └── sacn_output_bridge.js  # sACN output bridge (WS → sACN)
│   ├── src/                 # Frontend source modules
│   │   ├── core/            # Rendering, state, config, fixtures
│   │   ├── dmx/             # Router, frame buffers, sACN clients
│   │   ├── fixtures/        # Runtime fixture classes
│   │   └── gui/             # GUI panels
│   ├── dmx/                 # Fixture definitions + designer
│   │   ├── fixtures/        # UkingPar, ShehdsBar, VintageLed
│   │   └── designer/        # Electron fixture design app
│   └── patterns/            # Pixelblaze patterns (browser-side)
├── marsin_engine/           # Standalone sACN rendering engine
│   ├── lib/                 # Runtime, DMX mapper, sACN output
│   ├── patterns/            # 9 Pixelblaze patterns
│   └── models/              # Pixel model (exported from sim)
├── docs/                    # 7 design documents
├── archived/                # Deprecated modules (old DMX backend)
└── control_podium/          # Physical control station (Python)
```

---

## 5. Services & Ports

| Port | Service | Protocol | Purpose |
|------|---------|----------|---------|
| 6969 | http-server | HTTP | Static file server (Three.js frontend) |
| 6970 | save-server | HTTP | Config persistence API |
| 6971 | sacn_bridge | WebSocket | sACN input (external → browser) |
| 6972 | sacn_output_bridge | WebSocket | sACN output (browser → hardware) |
| 5568 | sACN | UDP | Standard E1.31 (both bridges) |

---

## 6. Known Limitations

1. **Config migration pending**: Per-fixture `controllerIp` is functional but the full unified `network.output` YAML schema from the design doc hasn't been implemented yet.
2. **LED strand fixtures**: Currently only DMX par/bar fixtures support sACN routing. LED strands use the built-in Pixelblaze engine only.
3. **No Chromatik export**: Fixture definitions exist in our format but can't yet be exported as Chromatik `.lxf` project files.
4. **Single scene**: Only one scene (the ship exterior) is supported. Interior rooms and summer camp areas need multi-scene support.

---

## 7. Next Steps

| Priority | Feature | Description |
|----------|---------|-------------|
| 🔴 High | **Multi-scene support** | Support multiple scenes: ship exterior, interior rooms (Engine Room, Grand Staircase, etc.), and summer camp areas. Scene switcher UI or config-based scene profiles. |
| 🔴 High | **Finalize ship lights** | Complete the fixture placement and patching for all ship wall sections. Test with physical UkingPar units. |
| 🟡 Medium | **LED fixture sACN** | Route LED strand data through sACN in/out pipeline. Test end-to-end with real LED nodes. |
| 🟡 Medium | **Chromatik export** | Export fixture definitions and universe config as Chromatik `.lxf` project files for LXStudio lighting design. |
| 🟡 Medium | **Canopy integration** | Integrate Canopy as a rendering engine source (priority 150). Define its sACN universe mapping. |
| 🟢 Low | **sACN Monitor enhancements** | Per-universe activity indicators, source list with priorities, packet error tracking. |
| 🟢 Low | **Hardware end-to-end test** | Full pipeline test: MarsinEngine → sim → PKnight controllers → physical fixtures on the 10.1.1.x network. |

---

## 8. Design Documentation

| Doc | Topic | Status |
|-----|-------|--------|
| [11_sim_sacn_integration.md](../../docs/11_sim_sacn_integration.md) | sACN router architecture, merge modes, unified config | ✅ Updated |
| [12_marsin_engine.md](../../docs/12_marsin_engine.md) | MarsinEngine design, Pixelblaze runtime | ✅ Current |
| [08_dmx_controller.md](../../docs/08_dmx_controller.md) | DMX hardware, sACN protocol, channel maps | ✅ Current |
| [09_dmx_fixture_models.md](../../docs/09_dmx_fixture_models.md) | Fixture definitions, pixel model format | ✅ Current |
| [06_pixelblaze_engine.md](../../docs/06_pixelblaze_engine.md) | Pixelblaze pattern language | ✅ Current |
| [07_control_podium.md](../../docs/07_control_podium.md) | Physical control station design | 📋 Spec only |

---

*Report generated from commit range c490f56..bfb0fe8 (27 commits)*
