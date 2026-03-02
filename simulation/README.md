# BM26 Titanic — Lighting Simulation Ecosystem
This directory contains the interactive 3D lighting simulation tool built for the **Burning Man 2026 Titanic Honoraria** project. 

The tool empowers lighting designers to pre-visualize night-time illumination, validate DMX fixture beam angles against realistic proxy geometry, and persist configuration states via a synchronized local filesystem architecture.

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
