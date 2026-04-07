# BM26 Titanic — Lighting Simulation

Interactive 3D lighting simulator for the **Burning Man 2026 Titanic** project. Pre-visualize night-time illumination, manage DMX fixtures, and drive real sACN controllers — all from the browser.

> **Design Docs:** [sACN Architecture](../docs/11_sim_sacn_integration.md) · [DMX Fixtures](../docs/09_dmx_fixture_models.md) · [Pixelblaze Engine](../docs/06_pixelblaze_engine.md)
>
> **Reports:** [DMX Gap Analysis](../.agent/02_reports/202604/20260407_1_dmx_integration_gap_analysis.md) · [sACN Integration](../.agent/02_reports/202604/20260406_2_sacn_integration.md)

---

## ⚡ Quick Start

```bash
cd simulation
npm install
npm start
```

Open [http://localhost:6969/simulation/](http://localhost:6969/simulation/) in your browser.

---

## 🏗️ What `npm start` Launches

`npm start` runs `start.js`, which spawns all required background services:

| Service | Port | Purpose |
|---------|------|---------|
| **http-server** | `6969` | Serves Three.js frontend & static assets |
| **save-server** | `6970` | Node.js API for persisting scene config, camera presets, exports |
| **sACN Input Bridge** | `6971` | Receives sACN from MarsinEngine/Chromatik → WebSocket to browser |
| **sACN Output Bridge** | `6972` | Receives DMX from browser → sACN unicast to real controllers |

Ports are configured in `config/server_config.yaml`.

---

## 🛠️ Technology Stack

### Core Libraries

| Technology | Version | Role |
|---|---|---|
| **Three.js** | `0.160.0` | 3D rendering — scene graph, lights, meshes, shadows |
| **lil-gui** | (bundled) | Lightweight GUI control panel |
| **js-yaml** | `4.1.x` | YAML parsing for config persistence |
| **chroma-js** | `3.1.2` | LAB-space color interpolation for gradients |
| **sacn** | `4.6.x` | sACN (E1.31) protocol — used by bridge servers |
| **ws** | `8.x` | WebSocket server for sACN bridges |

### Three.js Addons

| Addon | Purpose |
|---|---|
| **OrbitControls** | Camera orbit, pan, and zoom |
| **TransformControls** | Translate/rotate/scale gizmos for fixtures |
| **FBXLoader** | Loads `.fbx` 3D model geometry |
| **EffectComposer** + **UnrealBloomPass** | HDR bloom post-processing |

### Architecture

| Layer | Tech | Details |
|---|---|---|
| **Frontend** | Vanilla JS (ES Modules via `importmap`) | `main.js` + modular components |
| **Styling** | Vanilla CSS + Google Fonts (Inter) | Dark theme with glassmorphism |
| **State** | `config/scene_config.yaml` | Single source of truth — auto-saved |
| **DMX Pipeline** | `UniverseRouter` → `SacnOutputClient` | Multi-source merge with priority routing |

---

## 🎨 Features

### Fixture Management (lil-gui Panel)
- **Fixture Types:** UkingPar, ShehdsBar, VintageLed — loaded from `dmx/fixtures/`
- **DMX Patch Controls:** Universe, address, controller IP per fixture
- **Auto-Patch:** One-click "🎯 Auto-Patch All Unpatched" packing algorithm
- **Multi-select:** Shift-click to select multiple fixtures, batch transforms
- **Undo/Redo:** 50-deep snapshot stack (Ctrl+Z / Ctrl+Shift+Z)

### Procedural Generators
- **Shape modes:** Circle and line generators for fixture arrays
- **Aim modes:** `lookAt` (each fixture aims at a target) and `direction` (uniform)
- **Lock toggle:** Prevent accidental regeneration of finalized arrays
- **Controller IP:** Set once per generator — propagates to all generated fixtures

### sACN Integration
- **Input:** Receives live DMX from MarsinEngine or Chromatik via WebSocket bridge
- **Output:** Sends DMX to real controllers via sACN output bridge
- **Router:** Multi-source priority merge (source lock / per-patch modes)
- **Monitor:** Floating `📡 sACN Monitor` panel with live stats

### Lighting Modes
- **Pixelblaze Engine:** Client-side pattern rendering (rainbow, fire, breathing, etc.)
- **sACN Input:** Live DMX from external sources
- **Gradient:** Chroma.js LAB-space wave animation
- **Off:** Blackout

---

## 📁 Directory Structure

```
simulation/
├── config/
│   ├── scene_config.yaml       # Scene state (fixtures, generators, camera)
│   └── server_config.yaml      # Port configuration
├── server/
│   ├── save-server.js          # Config persistence API
│   ├── sacn_bridge.js          # sACN input bridge (sACN → WS)
│   └── sacn_output_bridge.js   # sACN output bridge (WS → sACN)
├── src/
│   ├── core/
│   │   ├── animate.js          # Main render loop + DMX output
│   │   └── state.js            # Global state management
│   ├── dmx/
│   │   ├── sacn_input_source.js    # Browser sACN receiver
│   │   ├── sacn_output_client.js   # Browser sACN sender
│   │   ├── universe_router.js      # Multi-source DMX merge
│   │   └── universe_frame_buffer.js # Double-buffered DMX frames
│   ├── fixtures/               # Fixture runtime classes
│   └── gui/
│       ├── gui_builder.js      # Main GUI (fixtures, generators, patch)
│       ├── pattern_editor.js   # Lighting mode selector
│       └── sacn_monitor.js     # sACN stats panel
├── main.js                     # Application entry point
├── index.html                  # HTML shell with import maps
├── style.css                   # Global styles
└── start.js                    # Multi-server launcher
```

---

## 📸 Agent Render (`agent_render.js`)

GPU-accelerated Puppeteer script for automated screenshot capture.

```bash
node agent_render.js --open           # Interactive window
node agent_render.js --current        # Screenshot current camera
node agent_render.js --view dramatic  # Capture a specific preset
node agent_render.js                  # Capture all 5 presets
```

Screenshots saved to `../.agent_renders/` (gitignored).

---

## 🔧 Configuration

### `config/scene_config.yaml`
Single source of truth for all scene state:
- Fixture positions, rotations, colors, intensities
- Generator traces (circle/line shapes, spacing, aim)
- DMX patches (universe, address, controller IP)
- Camera presets and render settings

### `config/server_config.yaml`
Server port assignments:
```yaml
http_port: 6969       # Static file server
save_port: 6970       # Save server
sacn_port: 6971       # sACN input bridge
```
