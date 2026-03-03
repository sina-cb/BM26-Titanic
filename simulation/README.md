# BM26 Titanic — Lighting Simulation Ecosystem
This directory contains the interactive 3D lighting simulation tool built for the **Burning Man 2026 Titanic Honoraria** project. 

The tool empowers lighting designers to pre-visualize night-time illumination, validate DMX fixture beam angles against realistic proxy geometry, and persist configuration states via a synchronized local filesystem architecture.

## Quick Start
To spin up both the frontend HTTP server and the backend YAML Node.js Save server simultaneously, run the following from the `simulation` directory:

```bash
cd simulation
npm install
npm start
```

Then, open your browser to [http://localhost:8080/simulation/](http://localhost:8080/simulation/).

---

## 🛠️ Technology Stack

### Core Libraries

| Technology | Version | Role |
|---|---|---|
| **Three.js** | `0.160.0` | 3D rendering engine — scene graph, camera, lights, meshes, shadows |
| **lil-gui** | (bundled with Three.js) | Lightweight GUI control panel |
| **js-yaml** | `4.1.x` | YAML parsing/serialization for config persistence |
| **chroma-js** | `3.1.2` | Color manipulation — LAB-space gradient interpolation |
| **Node.js** | (runtime) | Backend save server |

### Three.js Addons

| Addon | Purpose |
|---|---|
| **OrbitControls** | Camera orbit, pan, and zoom |
| **TransformControls** | Translate/rotate/scale gizmos for fixtures |
| **FBXLoader** | Loads `.fbx` 3D model geometry |
| **BufferGeometryUtils** | Mesh merging utilities |
| **EffectComposer** + **UnrealBloomPass** | HDR post-processing bloom pipeline |

### Architecture

| Layer | Tech | Details |
|---|---|---|
| **Frontend** | Vanilla JS (ES Modules via `importmap`) | `main.js` + component classes (`ParLight.js`, `LedStrand.js`, `Iceberg.js`) |
| **Styling** | Vanilla CSS + Google Fonts (Inter) | Dark theme with glassmorphism |
| **State** | `scene_config.yaml` | Single source of truth — loaded on boot, auto-saved via HTTP POST |
| **Save Server** | Node.js HTTP server on port `8181` | Minimal CORS endpoint: `POST /save` writes YAML to disk |
| **Static Server** | `http-server` on port `8080` | Serves HTML/JS/CSS and 3D model assets |
| **Dev Runner** | `concurrently` | Runs both servers in parallel via `npm start` |

### Key Patterns

- **Import Maps** — CDN-loaded ES modules, no bundler required
- **YAML-driven config** — all scene state persisted in `scene_config.yaml`
- **Undo/Redo** — snapshot-based state management (50-deep stack)
- **Multi-select transforms** — quaternion-based differential deltas
- **Snap-to-surface** — two-step raycast placement (position → aim)

---

## 🚀 Getting Started

To fully operate the simulation environment, you must start **two** background services simultaneously:

1. **The Web Server (Static Assets)**  
   Serves the Three.js front-end, styles, scripts, and the `3d_models` payload.
   ```bash
   # From the project root (c:\Users\sina_\workspace\BM26-Titanic)
   npx -y http-server . -p 8080 -c-1 --cors
   ```

2. **The Save Server (Config Bridge)**  
   Runs an isolated Node.js API that catches GUI-driven state changes (like XYZ translations or angle tweaks) and natively mutates `scene_config.yaml` to prevent data-loss across refreshes.
   ```bash
   # From the simulation directory (c:\Users\sina_\workspace\BM26-Titanic\simulation)
   node save-server.js
   ```

Once both servers are running, open your browser to [http://localhost:8080/simulation/](http://localhost:8080/simulation/) to launch the tool.

---

## 🛠️ Simulation Skills & Features

This platform features a suite of high-fidelity "skills" built specifically for the demands of large-scale, dust-covered architecture lighting.

### 1. DMX Par Light Fixtures (`ParLight.js` Engine)
- **Object-Oriented Fixtures:** Each directional spotlight is modeled natively with physics-accurate inner/outer angles and real-time shadows.
- **Physical Proxies:** Employs a physical proxy mesh (the Can) and a soft, additive-blending volume cone directly tracing where the beam hits.
- **Gizmo Synchronization:** Moving, scaling (which adjusts beam angle natively), or rotating a fixture via the Three.js `TransformControls` gizmos instantaneously rewrites real-world world-coordinate orientations accurately into the YAML state.

### 2. Micro-Tower Perimeter Arrays
- Procedurally generated perimeter light poles (default: 8) illuminating the central monument based on dynamically adjusted `modelRadius`.
- Replicates generic LED array washes, complete with directional target tilting and origin-glowing materials for volumetric ambiance. 

### 3. Atmospheric Post-Processing
- **Unreal Bloom Engine:** A hardware-accelerated HDR pipeline replicating desert dust scattered light overexposure.
- **Directional Moonlight Rig:** Emulates generic Black Rock Desert celestial illumination patterns mapped against adjustable `moonAngle` states.

### 4. Interactive Command Plane (`lil-gui`)
- The top-right drop-down GUI provides sub-millimeter precision tweaking for structural rotation, individual Light Fixture target data, exposure tone-mapping, and scene visibility modes.
- Modifying values natively bridges back via HTTP `POST /save` to instantly update `scene_config.yaml`.

### 5. Config State Parity (`scene_config.yaml`)
Your sole source-of-truth. Every time the page boots, it fetches and parses this YAML file first, ensuring that `main.js` instantly boots up mirroring exactly where you left your lights.

---

## 📸 Puppeteer Renderer (`agent_render.js`)

A GPU-accelerated Puppeteer script that opens the simulation in a real Chrome window for automated screenshot capture. Requires the servers to be running first (`npm start`).

### Usage

```bash
# Open the sim in a live window (no captures, interactive)
node agent_render.js --open

# Capture the current camera view without moving it
node agent_render.js --current

# Navigate to a specific view and capture
node agent_render.js --view dramatic

# Capture all 5 preset views (front, side, aerial, dramatic, night-walk)
node agent_render.js

# Add --keep-alive to any command to keep the window open after captures
node agent_render.js --current --keep-alive
```

### Output

Screenshots are saved to `../.agent_renders/` (gitignored):

| Mode | Output File |
|---|---|
| `--current` | `current_{timestamp}.png` |
| `--view <name>` | `{name}.png` |
| Default (all) | `front.png`, `side.png`, `aerial.png`, `dramatic.png`, `night-walk.png` |

### Scripting Renders

The renderer can be invoked from any Node.js script or shell pipeline:

```bash
# Start servers, render all views, stop servers
npm start &
sleep 5
node agent_render.js
kill %1

# Just grab one quick screenshot
node agent_render.js --view aerial
```

### Requirements

- **GPU** — The script uses `--ignore-gpu-blocklist` and ANGLE/D3D11 for hardware WebGL rendering
- **Servers running** — `npm start` must be active before running the renderer
- **Puppeteer** — Already included as a devDependency
