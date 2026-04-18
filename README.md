# 🚢 Titanic — Burning Man 2026

Lighting design, pattern engineering, and simulation toolkit for the **Titanic** structure at Burning Man 2026.

> *Make it glow. Make it welcoming. Make it fun.*

### 🌐 [**Live Demo →**](https://sina-cb.github.io/BM26-Titanic/simulation/)

---

## ⚡ Quick Start

```bash
# 1. Clone and install
git clone git@github.com:sina-cb/BM26-Titanic.git
cd BM26-Titanic

# 2. Start the simulation (includes all 3D environment servers)
cd simulation
npm install
npm start

# 3. Open in browser
open http://localhost:6969/simulation/

# 4. Start the rendering engine (WASM MarsinVM) in a second terminal
cd marsin_engine
npm install
node engine.js --model test_bench --pattern 00_golden_hour_wash

# 5. Start the CaptainPad iPad UI in a third terminal
cd CaptainPad
npm install
npm start -c # Clears cache and shows the QR code to scan on your iPad
```

---

## 🎯 Mission

- Make the **Titanic Exterior** highly visible, beautiful, and interactive at night *(mission critical)*
- Light up the **Titanic Rooms** for our passengers
- Keep the lighting easy to **strike within 2 hours**
- Deploy a strict **Color Bible** focusing on aesthetic maturity (deep blues, ambers, strict gradients)
- Be **welcoming**, **kind**, and above all — have **fun**

---

## 📂 Repository Structure

```
BM26-Titanic/
├── simulation/          # Interactive 3D lighting sim (Three.js + sACN)
├── marsin_engine/       # WASM-compiled MarsinVM Pixelblaze rendering engine (outputs sACN)
├── CaptainPad/          # React Native/Expo UI for real-time parameter tuning on iPad
├── archived/            # Deprecated modules (old JS backend, smart_router, etc.)
├── 3d_models/           # FBX/OBJ source geometry from TE
├── docs/                # Design docs & technical architecture
├── control_podium/      # Physical control station design
├── images/              # Reference images & renders
└── .agent/              # Agent collaboration codex & reports
```

### `/simulation` — Interactive 3D Lighting Simulator
Browser-based Three.js lighting previewer with real-time DMX fixtures, LED strands, procedural generators, sACN input/output, and YAML-persisted scene state. Accurately simulates **Shehds Bars**, **Uking Pars**, and **Vintage Wash Heads**.

### `/marsin_engine` — WASM MarsinVM Backend
Node.js CLI that compiles and executes 26 custom-written Pixelblaze patterns inside a native WASM runtime (`MarsinVM`). Performs sub-millisecond, multi-universe processing across all rig pixels simultaneously outputting directly to physical controllers over sACN. Completely bypasses legacy JS mapping. 
*Features: Automated UI parameter exporting, V2 Sectional Metadata routing, global DMX dimming priorities.*

### `/CaptainPad` — Interactive Performance UI
An iPad-optimized React Native application allowing the crew to dynamically control lighting layers. Connects to `marsin_engine` via WebSockets to auto-generate sliders, color pickers, and toggle inputs based on what the active pattern exposes structurally.

### `/docs` — Design Documentation

| Doc | Topic |
|-----|-------|
| [11_sim_sacn_integration.md](docs/11_sim_sacn_integration.md) | sACN architecture, router design, patch registry, unified config format |
| [12_marsin_engine.md](docs/12_marsin_engine.md) | MarsinEngine design, WASM VM integration, V2 DMX mapping |
| [08_dmx_controller.md](docs/08_dmx_controller.md) | DMX controller hardware, sACN protocol, channel maps |
| [09_dmx_fixture_models.md](docs/09_dmx_fixture_models.md) | **Current Fixtures**: Shehds 18x18, Uking Pars, Vintage Heads |
| [06_pixelblaze_engine.md](docs/06_pixelblaze_engine.md) | Pixelblaze syntax support, PB inversion mathematics, and structural engine routing |

---

## 🏗️ System Architecture

```
┌───────────────────────────────────────┐
│           CaptainPad (iPad)           │
│  (Dynamic UI Controls via WebSockets) │
└───────────────────┬───────────────────┘
                    │ 
                    ▼
┌───────────────────────────────────────┐
│        MarsinEngine (WASM VM)         │
│  (Compiles patterns, outputs sACN)    │
└───────────────────┬───────────────────┘
                    │ sACN Multicast
                    ▼
┌───────────────────────────────────────┐
│            sacn_bridge.js             │
│        (port 6971 WebSocket proxy)    │
└───────────────────┬───────────────────┘
                    │ 
                    ▼
┌───────────────────────────────────────┐
│     Browser Simulation (Three.js)     │
│  (Real-time true-to-life 3D render)   │
└───────────────────────────────────────┘
                    │ 
                    ▼
            Physical DMX Rig
        (Uking Pars, Shehds Bars)
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

## 👤 Maintainer
**Sina Solaimanpour**
