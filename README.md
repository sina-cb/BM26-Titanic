# 🚢 Titanic — Burning Man 2026

Lighting design & simulation toolkit for the **Titanic** structure at Burning Man 2026.

> *Make it glow. Make it welcoming. Make it fun.*

### 🌐 [**Live Demo →**](https://sina-cb.github.io/BM26-Titanic/simulation/)

---

## ⚡ Quick Start

```bash
# 1. Clone and install
git clone git@github.com:sina-cb/BM26-Titanic.git
cd BM26-Titanic

# 2. Start the simulation (includes all servers)
cd simulation
npm install
npm start

# 3. Open in browser
open http://localhost:6969/simulation/

# 4. (Optional) Start the rendering engine in a second terminal
cd marsin_engine
npm install
node engine.js --pattern bioluminescence
```

---

## 🎯 Mission

- Make the **Titanic Exterior** highly visible, beautiful, and interactive at night *(mission critical)*
- Light up the **Titanic Rooms** for our passengers
- Keep the lighting easy to **strike within 2 hours**
- Carry **TE's design DNA** forward
- Be **welcoming**, **kind**, and above all — have **fun**

---

## 📂 Repository Structure

```
BM26-Titanic/
├── simulation/          # Interactive 3D lighting sim (Three.js + sACN)
│   └── dmx/             # Fixture definitions & DMX designer (moved from root)
├── marsin_engine/       # Multichannel Pixelblaze rendering engine (Node.js → sACN)
├── archived/            # Deprecated modules (old dmx backend, smart_router, etc.)
├── 3d_models/           # FBX/OBJ source geometry from TE
├── docs/                # Design docs & technical architecture
├── control_podium/      # Physical control station design
├── images/              # Reference images & renders
└── .agent/              # Agent collaboration codex & reports
```

### `/simulation` — Interactive 3D Lighting Simulator

Browser-based Three.js lighting previewer with real-time DMX fixtures, LED strands, procedural generators, sACN input/output, bloom post-processing, and YAML-persisted scene state. Includes fixture management GUI, auto-patching, and real-time sACN output to physical controllers.

→ See [simulation/README.md](simulation/README.md) for full details.

### `/marsin_engine` — Multichannel Rendering Engine

Node.js CLI that renders Pixelblaze-compatible patterns against the simulation's pixel model and outputs DMX data via sACN. Supports 6-channel RGBWAU pixels, multiple universes, and real-time preview in the simulation.

→ See [marsin_engine/README.md](marsin_engine/README.md) for full details.

### `/archived`
Deprecated modules preserved for reference: Node.js DMX backend (`DmxHandler`, `DmxUniverse`), sACN smart priority router, Pixelblaze utilities, and test bench scripts. These have been superseded by the simulation's built-in sACN pipeline.

### `/docs` — Design Documentation

| Doc | Topic |
|-----|-------|
| [11_sim_sacn_integration.md](docs/11_sim_sacn_integration.md) | sACN architecture, router design, patch registry, unified config format |
| [12_marsin_engine.md](docs/12_marsin_engine.md) | MarsinEngine design, Pixelblaze runtime, DMX mapping |
| [08_dmx_controller.md](docs/08_dmx_controller.md) | DMX controller hardware, sACN protocol, channel maps |
| [09_dmx_fixture_models.md](docs/09_dmx_fixture_models.md) | Fixture definitions, channel layouts, physical specs |
| [06_pixelblaze_engine.md](docs/06_pixelblaze_engine.md) | Pixelblaze pattern language, rendering pipeline |

### `/3d_models`
Source 3D models (FBX + OBJ) of the Burning Man structure from TE.

---

## 🏗️ System Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│   MarsinEngine CLI  │     │   Chromatik (LXStudio)│
│  (pattern rendering)│     │   (lighting console)  │
└────────┬────────────┘     └──────────┬───────────┘
         │ sACN (pri 100)              │ sACN (pri 200)
         ▼                             ▼
┌──────────────────────────────────────────────────┐
│              sacn_bridge.js (port 6971)           │
│              WebSocket ← sACN receiver            │
└────────────────────┬─────────────────────────────┘
                     │ WebSocket
                     ▼
┌──────────────────────────────────────────────────┐
│            Browser Simulation (Three.js)          │
│  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │SacnInput   │→ │Universe  │→ │ Fixture GUI  │ │
│  │Source      │  │Router    │  │ + 3D Render  │ │
│  └────────────┘  └──────────┘  └──────────────┘ │
│                        │                          │
│                        ▼                          │
│               SacnOutputClient ──────────────────►│
└────────────────────┬─────────────────────────────┘
                     │ WebSocket
                     ▼
┌──────────────────────────────────────────────────┐
│        sacn_output_bridge.js (port 6972)          │
│        WebSocket → sACN unicast sender            │
└────────────────────┬─────────────────────────────┘
                     │ sACN UDP
                     ▼
              Physical DMX Controllers
              (e.g. PKnight @ 10.1.1.102)
```

---

## 📸 Agent Render (`agent_render.js`)

GPU-accelerated Puppeteer script for automated screenshot capture.

```bash
cd simulation
node agent_render.js --open           # Interactive window (no captures)
node agent_render.js --current        # Screenshot current camera view
node agent_render.js --view dramatic  # Capture a specific preset view
node agent_render.js                  # Capture all 5 preset views
```

---

## 📋 Reports

| Report | Date | Topic |
|--------|------|-------|
| [DMX Integration Gap Analysis](.agent/02_reports/202604/20260407_1_dmx_integration_gap_analysis.md) | 2026-04-07 | Current gaps, prioritized roadmap |
| [sACN Integration Report](.agent/02_reports/202604/20260406_2_sacn_integration.md) | 2026-04-06 | sACN pipeline implementation status |
| [Current Sim Code Analysis](.agent/02_reports/202604/20260406_1_current_sim_code.md) | 2026-04-06 | Codebase structure walkthrough |

---

## 👤 Maintainer

**Sina Solaimanpour**
