# 🚢 Titanic — Burning Man 2026

Lighting design, pattern engineering, and simulation toolkit for the **Titanic** structure at Burning Man 2026.

> *Make it glow. Make it welcoming. Make it fun.*

### 🌐 [**Live Demo →**](https://sina-cb.github.io/BM26-Titanic/simulation/?scene=test_bench&profile=full&spotlights=60)

---

## ⚡ Quick Start

You need **three terminals** open side-by-side: one for the
simulation (browser preview), one for the rendering engine, and one
for the CaptainPad control surface. Each component has its own README
with the full story — this is just enough to get pixels moving.

### 0. Clone the repo

```bash
git clone git@github.com:sina-cb/BM26-Titanic.git
cd BM26-Titanic
```

### 1. Terminal 1 — Simulation (browser preview)

The simulation renders the rig in 3D in your browser and listens for
sACN packets from the engine, so you can see exactly what the lights
will do without plugging anything in.

```bash
cd simulation
npm install                 # first time only
npm start                   # launches the dev server on :6969
```

Then open one of these in a browser:

```bash
open http://localhost:6969/simulation/
# Or with a specific scene + edit profile:
open "http://127.0.0.1:6969/simulation/?scene=titanic&profile=edit&spotlights=100&renderer=webgpu"
```

Full sACN/DMX architecture, fixture details, and startup flags are in
[`simulation/README.md`](simulation/README.md).

### 2. Terminal 2 — Rendering engine (MarsinEngine)

The engine compiles Pixelblaze patterns into WASM bytecode, runs the
render loop at 40 fps, and emits sACN to the simulation (and/or
physical controllers). It also hosts the REST/WebSocket API that
CaptainPad talks to.

```bash
cd marsin_engine
npm install                                                # first time only
node engine.js --model test_bench --pattern 00_golden_hour_wash
```

Optional: turn on the in-engine **microphone listener** so patterns
react to whatever's playing in the room. One-time setup per scene:

```bash
node engine.js --list_mics                                 # see available mics
node engine.js --choose_mic --model test_bench             # save your mic for this scene
# Then boot normally — patterns can now read micLow/micMid/micHigh/micKick.
```

Full CLI reference, audio setup, OSC integration, and operational
notes live in [`marsin_engine/README.md`](marsin_engine/README.md).

### 3. Terminal 3 — CaptainPad (iPad / web control surface)

CaptainPad is the React Native / Expo app you drive the show from. It
auto-discovers the engine's REST/WebSocket API and lets you tune
globals, swap patterns, layer channels, and configure audio
reactivity — all from an iPad, or from a web browser during
development.

```bash
cd CaptainPad
npm install                 # first time only
npm start -c                # clears cache; prints a QR code for Expo Go
```

- **iPad / iPhone**: install **Expo Go** from the App Store, then scan
  the QR code with your phone camera.
- **Web preview**: press `w` in the Expo dev menu after `npm start`.
  Handy for verifying UI changes without an iPad in hand.
- **Permanent iPad install** (without Expo Go): see the EAS build
  runbook in [`CaptainPad/README.md`](CaptainPad/README.md).

### 4. (Optional) Verify the pipeline

With all three terminals running:

1. The browser shows the simulation rig in 3D.
2. CaptainPad shows the active pattern's controls.
3. Drag a slider in CaptainPad — the lights should update in the
   browser within a frame or two.

If anything's off, each component's README has its own troubleshooting
notes. The most common one is "engine isn't on the same Wi-Fi as the
iPad" — CaptainPad shows `OSC OFF` and now throttles a single
`Network request failed` warning every 30 s per endpoint instead of
spamming the console.

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
Browser-based Three.js lighting previewer with real-time DMX fixtures, LED strands, procedural generators, sACN input/output, and YAML-persisted scene state. Accurately simulates **Shehds Bars**, **Uking Pars**, and **Vintage Wash Heads**. See [`simulation/README.md`](simulation/README.md).

### `/marsin_engine` — WASM MarsinVM Backend
Node.js CLI that compiles and executes Pixelblaze patterns inside a native WASM runtime (`MarsinVM`). Sub-millisecond multi-universe rendering, outputs sACN to the simulation and/or physical controllers. Auto-exports pattern UI parameters to a **Central Parameter Center (CPC)** that CaptainPad reads over WebSocket. Also hosts an **OSC listener** (live stems, BPM) and an optional **in-engine microphone listener** (low / mid / high / kick band detection + BPM-to-speed sync) so patterns can react to ambient audio without an external analyser. See [`marsin_engine/README.md`](marsin_engine/README.md).

### `/CaptainPad` — Interactive Performance UI
React Native / Expo app for performing the show. Auto-generates sliders, color pickers, and toggles from whatever the active pattern exposes. Tabs: **Deck** (active pattern + globals), **Mixer** (multi-channel layering with playlists), **Audio Analysis** (mic tuning + BPM sync), **Studio**, **Monitor**, **Config**. Runs on iPad via **Expo Go** or as a **web preview** in any browser. See [`CaptainPad/README.md`](CaptainPad/README.md).

### `/docs` — Design Documentation

| Doc | Topic |
|-----|-------|
| [11_sim_sacn_integration.md](docs/11_sim_sacn_integration.md) | sACN architecture, router design, patch registry, unified config format |
| [12_marsin_engine.md](docs/12_marsin_engine.md) | MarsinEngine design, WASM VM integration, V2 DMX mapping |
| [08_dmx_controller.md](docs/08_dmx_controller.md) | DMX controller hardware, sACN protocol, channel maps |
| [09_dmx_fixture_models.md](docs/09_dmx_fixture_models.md) | **Current Fixtures**: Shehds 18x18, Uking Pars, Vintage Heads |
| [06_pixelblaze_engine.md](docs/06_pixelblaze_engine.md) | Pixelblaze syntax support, PB inversion mathematics, and structural engine routing |
| [15_central_param_center_cpc.md](docs/15_central_param_center_cpc.md) | CPC contract: shared params, registry, sources & arbitration |
| [16_captain_pad.md](docs/16_captain_pad.md) | CaptainPad architecture, tabs, theming, CPC binding |
| [24_osc_integration.md](docs/24_osc_integration.md) | OSC listener: bindings, live-param policy, BPM, stems |
| [25_marsin_audio_analysis.md](docs/25_marsin_audio_analysis.md) | In-engine microphone listener: capture, FFT, kick, BPM→speed, Audio Analysis tab |

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

## 📸 Agent Render

There is no current `simulation/agent_render.js` script in the tree. Keep
generated screenshots and visual artifacts under `.agent_renders/` or another
gitignored scratch location until a replacement renderer is added.

---

## 👤 Maintainer
**Sina Solaimanpour**
