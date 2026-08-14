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

Recommended simulation URL:
[http://127.0.0.1:6969/simulation/?scene=titanic&profile=edit&spotlights=100&renderer=webgpu](http://127.0.0.1:6969/simulation/?scene=titanic&profile=edit&spotlights=100&renderer=webgpu)

---

## 🏗️ What `npm start` Launches

`npm start` runs `start.js`, which spawns all required background services.

| Service | Port | Purpose |
|---------|------|---------|
| **http-server** | `6969` | Serves Three.js frontend & static assets |
| **save-server** | `6970` | Node.js API for persisting scene config, camera presets, exports |
| **sACN Input Bridge** | `6971` | Receives sACN from MarsinEngine/Chromatik → WebSocket to browser |
| **sACN Output Bridge** | `6972` | Receives DMX from browser → sACN unicast to real controllers |

Ports are configured in `config.yaml`.

---

## 🛠️ Technology Stack

### Core Libraries

| Technology | Version | Role |
|---|---|---|
| **Three.js** | `0.177.0` in the browser import map; `0.184.x` in local dev dependencies | 3D rendering — scene graph, lights, meshes, shadows |
| **MarsinGui** | (in-tree, `src/gui/modern_gui/`) | CaptainPad-styled control panel (lil-gui-0.17-API-compatible) |
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
| **Frontend** | Vanilla JS (ES Modules via `importmap`) | `main.js` + modular components. Current import map uses CDN URLs; vendor these before claiming offline readiness. |
| **Styling** | Vanilla CSS + Google Fonts (Inter) | Dark theme with glassmorphism. Current font import is external. |
| **State** | `scenes/<scene>/scene_config.yaml` | Single source of truth — auto-saved |
| **DMX Pipeline** | `UniverseRouter` → `SacnOutputClient` | Multi-source merge with priority routing |

---

## 🎨 Features

### Fixture Management (Lighting Controls Panel)
- **Fixture Types:** UkingPar, ShehdsBar, VintageLed — loaded from `dmx/fixtures/`
- **DMX Patch Controls:** Universe, address, controller IP per fixture
- **Controller Mapping:** 🎛 Controllers panel owns all DMX patching (see `docs/33_controller_mapping.md`)
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
├── config.yaml                 # Port configuration
├── scenes/
│   └── <scene>/scene_config.yaml # Scene state (fixtures, generators, camera)
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

## 📸 Agent Render

No `simulation/agent_render.js` script exists in the current tree. Do not use
older docs that reference it until a replacement renderer is added.

Screenshots and generated visual artifacts should still be written under
`../.agent_renders/` or another gitignored scratch location.

---

## 🔧 Configuration

### `scenes/<scene>/scene_config.yaml`
Single source of truth for all scene state:
- Fixture positions, rotations, colors, intensities
- Generator traces (circle/line shapes, spacing, aim)
- DMX patches (universe, address, controller IP)
- Camera presets and render settings

### Spotlight Preview Pool Note
`Max Spotlights` is ONE number with one owner. It sets both how many
`THREE.SpotLight`s are pre-allocated at boot and how many may be lit per frame.
The chain is `scene_config.yaml` → `?spotlights=N` (URL wins) →
`initLightPool()` allocates exactly that many → the GUI slider ranges over that
pool.

- `src/core/light_pool.js` exports `MAX_SPOTLIGHT_POOL_SIZE` (default `200`). Change that constant if you want a different global cap for pooled analytic spotlights. Above ~160 SpotLights, Mac WebGPU can render the scene entirely white or black — the cap is a GPU-safety decision, not a stylistic one.
- `?spotlights=N` is the boot-time URL override, applied in `src/core/url_overrides.js` alongside `?profile=` / `?lighting_mode=` / `?renderer=`. Example: [http://localhost:6969/simulation/?scene=titanic&profile=full&renderer=webgl&spotlights=80](http://localhost:6969/simulation/?scene=titanic&profile=full&renderer=webgl&spotlights=80)
- If `N` is above `MAX_SPOTLIGHT_POOL_SIZE`, the sim **asks** — a blocking confirm at boot, before the pool is allocated, naming the count, the cap and the white/black-screen risk.
  - **Accept** → the pool is allocated at `N` **for that page load only**. The `Max Spotlights` slider ranges to `N`, and the slider is labelled `⚠ Max Spotlights (session N)`.
  - **Decline / dismiss / no dialog available (headless)** → the old behaviour exactly: clamp to the cap, console + toast. Nothing but an explicit yes ever raises the cap.
  - The yes is **never remembered**: no localStorage, and saving writes at most `MAX_SPOTLIGHT_POOL_SIZE` into `scene_config.yaml` (`clampPersistedSpotlightBudget`). Every over-cap boot asks again.
  - Above `SPOTLIGHT_ABSOLUTE_CEILING` (`2000`) there is no prompt at all — `?spotlights=999999` is refused loudly, like any other malformed value.
- A value that is not an integer `0..ceiling` (including negatives) is **refused** and the saved scene value is kept — no silent substitution.
- Without `?spotlights=`, the saved scene value is what gets allocated: a scene saved at `150` boots 150 SpotLights. A saved value above the hard cap is clamped and never prompts — consent is asked for what you just typed, not for what was already in a file.
- The GUI `Max Spotlights` slider ranges `1..poolSize` — the pool is fixed at boot, so travel above it would do nothing. To raise the budget, boot with `?spotlights=N` (or save the higher value and reload).
- `?spotlights=0` still disables the pooled spotlight preview from the URL.
- Regression coverage: `tests/spotlight_pool_budget.test.js`.

### `config.yaml`
Server port assignments:
```yaml
http_port: 6969       # Static file server
save_port: 6970       # Save server
sacn_port: 6971       # sACN input bridge
sacn_output_port: 6972 # sACN output bridge
sacn_udp_port: 5568   # Physical E1.31 UDP protocol port
```
