# 🚢 Titanic — Burning Man 2026

Lighting design & simulation toolkit for the **Titanic** structure at Burning Man 2026.

> *Make it glow. Make it welcoming. Make it fun.*

### 🌐 [**Live Demo →**](https://sina-cb.github.io/BM26-Titanic/simulation/)

---

## 🎯 Mission

- Make the **Titanic Exterior** highly visible and beautiful and interactive at night *(mission critical)*
- Light up the **Titanic Rooms** for our passengers
- Keep the lighting easy to **strike within 2 hours**
- Carry **TE's design DNA** forward
- Be **welcoming**, **kind**, and above all — have **fun**

---

## 📂 Repository Structure

```
BM26-Titanic/
├── simulation/      # Interactive 3D lighting sim (Three.js)
├── 3d_models/       # FBX/OBJ source geometry from TE
├── docs/            # Design docs & ideology
└── .agent/          # Agent collaboration codex
```

### `/simulation`
Browser-based Three.js lighting previewer with real-time par lights, LED strands, iceberg geometry, bloom post-processing, and YAML-persisted scene state. See [simulation/README.md](simulation/README.md) for full tech stack & setup.

### `/3d_models`
Source 3D models (FBX + OBJ) of the Burning Man structure from TE.

### `/docs`
Design references — Project overview, lighting ideology, and iceberg concepts.

---

## 🚀 Quick Start

```bash
cd simulation
npm install
npm start
```

Then open [http://localhost:8080/simulation/](http://localhost:8080/simulation/) in your browser.

`npm start` automatically kills any stale processes on ports **8080** and **8181**, then launches:

| Service | Port | Purpose |
|---|---|---|
| **http-server** | `8080` | Serves the Three.js frontend & static assets |
| **save-server** | `8181` | Node.js API for persisting scene config, camera presets, STL exports, and Pixelblaze pattern files |

### 📸 Agent Render (`agent_render.js`)

GPU-accelerated Puppeteer script for automated screenshot capture. Requires servers to be running (`npm start`).

```bash
node agent_render.js --open          # Interactive window (no captures)
node agent_render.js --current       # Screenshot current camera view
node agent_render.js --view dramatic # Capture a specific preset view
node agent_render.js                 # Capture all 5 preset views
```

Screenshots are saved to `.agent_renders/` (gitignored). See [simulation/README.md](simulation/README.md) for full details.

---

## 👤 Maintainer

**Sina Solaimanpour**
