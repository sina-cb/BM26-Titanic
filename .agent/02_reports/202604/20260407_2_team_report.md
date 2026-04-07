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

### 3.10 Fixture Generators

**File:** `src/gui/gui_builder.js` (function `generateGroupFromTrace`)

Generators let you place arrays of DMX fixtures along geometric shapes with a single configuration. Instead of manually positioning 20 fixtures on a wall, you define a generator trace and it creates all the fixtures instantly.

**Shape modes:**
- **Circle** — Distributes fixtures evenly around a circle arc (used for chimney rings). Parameters: center position, radius, arc angle (0–360°), count.
- **Line** — Distributes fixtures evenly along a straight line (used for walls and decks). Parameters: start point, end point, count.

**Aim modes:**
- **`lookAt`** — Each fixture aims at a target point (e.g., aimed at the ship center). Computes per-fixture quaternion rotation.
- **`direction`** — All fixtures face the same direction (uniform orientation from first fixture to aim handle).

**Key behaviors:**
- Changing any generator parameter (shape, count, spacing, aim) regenerates all fixtures in the group
- **Lock toggle** — Prevents accidental regeneration of finalized arrays. Locked generators have their controls greyed out.
- **Controller IP** — Set on the generator trace; all generated fixtures inherit the same `controllerIp`
- **Fixture type** — Inherits from scene defaults (currently UkingPar, ShehdsBar, or VintageLed)
- **Fixture rotation offsets** — Per-generator X/Y/Z rotation offsets applied to all generated fixtures
- Generated fixtures are tagged with `_traceGenerated: true` and `group: "<generator name>"` for identification

### 3.11 DMX Fixture Library

**Directory:** `simulation/dmx/fixtures/`

Three fixture types have been fully profiled with channel YAML definitions and 3D pixel model YAMLs:

| Fixture | Channels | Profile | Description |
|---------|----------|---------|-------------|
| **UKing RGBWAU Par** | 10ch | `channels_10.yaml` | Master dimmer, R, G, B, W, Amber, UV (Purple), strobe, function mode, speed. Single-pixel fixture. |
| **SHEHDS 18×18W LED Bar** | 119ch | `channels_119.yaml` | 18 individually-addressable LED segments, each with R, G, B, W, Amber, UV. Plus 11 global channels (master, strobe, mode). |
| **Vintage LED Stage Light** | 33ch | `channels_33.yaml` | 6 individually-addressable LED heads, each with R, G, B, W, Amber. Plus 3 global channels (master, strobe, mode). |

Each fixture also has:
- **Channel YAML** — Complete DMX channel map with function descriptions and value ranges
- **Model YAML** — 3D pixel positions (normalized coordinates + DMX channel mappings) for sim rendering
- **Hardware manual** — Original manufacturer PDFs and annotated screenshots in `manual/` folders
- **Alternative profiles** — Some fixtures have multiple channel modes (e.g., SHEHDS has 12ch, 108ch, and 119ch modes)

The `FixtureDefinitionRegistry` loads these YAMLs at startup and provides `getDefinition(fixtureType)` to the runtime fixture system.

### 3.12 DMX Fixture Designer

**Directory:** `simulation/dmx/designer/`

Desktop Electron + React application for visually designing fixture pixel layouts:

- **3D Viewport** (React Three Fiber) — Place LED dots in 3D space using instanced meshes for performance
- **Properties Panel** — Edit individual dot/pixel coordinates, DMX channel assignments, and pixel types
- **Pixel List** — Spreadsheet view of all pixels with channel assignments and dot counts
- **DMX Test Panel** — Preview how pixels respond to test patterns (static red, blackout)
- **Load/Save YAML** — Load existing model YAMLs, edit, and export updated versions

**Tech stack:** Vite + React 19 + Zustand (state management) + React Three Fiber + js-yaml

```bash
cd simulation/dmx/designer
npm install
npm run desktop   # Launches Electron window
```

All three fixture models (UkingPar, ShehdsBar, VintageLed) were built and validated using this tool.

### 3.13 Current Ship Lighting Layout

The simulation currently has **119 fixtures** across **10 generator groups** covering the ship exterior:

| Generator | Shape | Fixtures | Section |
|-----------|-------|----------|----------|
| Right Front Wall | Line | 20 | Forward starboard wall |
| Left Front Wall | Line | 20 | Forward port wall |
| Right Back Wall | Line | 20 | Aft starboard wall |
| Left Back Wall | Line | 20 | Aft port wall |
| Right Center Auditorium | Line | 6 | Starboard auditorium wall |
| Left Center Auditorium | Line | 6 | Port auditorium wall |
| Right Top Chimney | Circle | 9 | Starboard chimney ring |
| Left Top Chimney | Circle | 9 | Port chimney ring |
| Right Front Deck | Line | 5 | Starboard bow deck |
| Left Front Deck | Line | 5 | Port bow deck |

All fixtures are currently configured as UkingPar (10ch each). Generator traces have `lookAt` aim mode pointing fixtures toward the ship center. Most generators are unlocked pending final placement review.

### 3.14 Control Podium (Ongoing)

**Directory:** `control_podium/`
**Design Doc:** [07_control_podium.md](../../docs/07_control_podium.md)

The Control Podium is a **wireless show control station** for remote scene triggering on playa. Currently in firmware development phase.

**Architecture:**
- Two **Heltec WiFi LoRa V4** controllers (ESP32-S3 + SX1262) forming a point-to-point raw LoRa radio link at 915 MHz
- **Podium node** (TX) — Operator-side with buttons and OLED display, sends cue commands
- **Server node** (RX) — Attached to the visual server, receives commands and dispatches to Chromatik/MarsinEngine
- **~50ms end-to-end latency** (40–300× faster than Meshtastic's 2–15s)

**BLE Integration:**
- Each controller runs a custom BLE GATT server with 14 characteristics (role, firmware version, uptime, TX/RX counts, RSSI, SNR, radio params, command input)
- Phone monitoring via nRF Connect app

**Software stack:**
- Custom PlatformIO firmware (`podium_tx/main.cpp`, `server_rx/main.cpp`)
- Python CLI (`cli.py`) for pairing, deployment, and monitoring
- PySide6 **Control Center** desktop app showing real-time status of both nodes
- Event protocol: `titanic:scene:<name>`, `titanic:cmd:<action>`, `titanic:fx:<name>`, `titanic:ping/pong`

**Current status:** Firmware v1.2 (`ble-cmd`) deployed. Bidirectional LoRa + BLE working. Awaiting integration with Chromatik/MarsinEngine for actual scene triggering.

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
└── control_podium/          # Wireless show control station
    ├── firmware/            # PlatformIO ESP32-S3 firmware (LoRa + BLE)
    ├── companions/          # Python serial/BLE companion scripts
    ├── utils/               # BLE discovery, serial parser, config store
    ├── tests/               # HIL + unit test suite
    └── cli.py               # CLI: pair, deploy, test, monitor
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
