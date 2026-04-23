# BM26-Titanic — Unreal Engine Pixel Streaming

Real-time DMX lighting visualization streamed from Unreal Engine 5.7 directly to any web browser via WebRTC.

---

## ⚡ Quick Launch

> **Prerequisite:** MarsinEngine must be running separately to provide sACN data.

```powershell
# Terminal 1 — Start MarsinEngine (sACN source)
cd C:\Users\sina_\workspace\BM26-Titanic\marsin_engine
node engine.js --pattern 01_cylon_sweep --model test_bench

# Terminal 2 — Start Pixel Streaming
cd C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal
powershell -ExecutionPolicy Bypass -File run_streaming.ps1
```

Then open **http://localhost** in your browser.

---

## Architecture

```
┌──────────────┐     sACN/UDP      ┌──────────────────────┐     WebRTC      ┌─────────┐
│ MarsinEngine │ ──── :5568 ────▶  │  Unreal Engine 5.7   │ ──── :80 ────▶  │ Browser │
│  (Node.js)   │                   │  (Headless Editor)    │                 │ (H.264) │
└──────────────┘                   └──────────────────────┘                 └─────────┘
                                          │  ▲
                                   Python │  │ Slate tick
                                   sACN   │  │ callback
                                   Recv   ▼  │
                                   ┌──────────────────┐
                                   │ sacn_unreal_recv  │
                                   │ (UDP :5568 hook)  │
                                   └──────────────────┘
```

### Data Flow

1. **MarsinEngine** renders LED patterns via WASM and outputs sACN (E1.31) UDP packets on `127.0.0.1:5568`
2. **Unreal Editor** boots headless (`-RenderOffScreen`) and loads `Marsin_Scene`
3. **`init_unreal.py`** auto-starts `sacn_unreal_receiver.py` on the Editor's Slate pre-tick callback
4. **Python sACN receiver** reads UDP packets, maps DMX channels → `PointLight` / `SpotLight` color properties via actor tags
5. **PixelStreaming2** encodes the Editor viewport as H.264 and streams it via WebRTC
6. **Signalling Server** (Node.js) brokers WebRTC connections between Unreal and the browser

---

## Directory Structure

```
simulation/unreal/
├── BM26_Unreal.uproject        # UE5.7 project file
├── run_streaming.ps1           # One-click streaming launcher
├── deploy/
│   └── deploy.py               # Rebuild scene (export → ingest → save)
├── scripts/
│   ├── export_unreal_data.js   # YAML → JSON fixture exporter (Node.js)
│   ├── ingest_scene.py         # JSON → Unreal actor spawner (Python/UE)
│   ├── sacn_unreal_receiver.py # Live sACN → light color updater
│   └── init_unreal.py          # Auto-start hook for sACN receiver
├── Content/
│   └── Python/
│       └── init_unreal.py      # Symlinked startup script
├── Config/
│   └── DefaultEngine.ini       # Engine config (startup map, etc.)
└── PixelStreamingInfrastructure/  # Epic's signalling server (git submodule)
    └── SignallingWebServer/
        ├── config.json         # Signalling server config (ports, etc.)
        └── www/                # Web frontend (pre-built)
```

---

## Scripts Reference

### `deploy/deploy.py`
Fully automated scene rebuild pipeline:
1. Kills the Unreal Editor (releases file locks)
2. Runs `export_unreal_data.js` to generate `unreal_ingested_model.json` from YAML fixtures
3. Launches `UnrealEditor-Cmd` headless to execute `ingest_scene.py`
4. Relaunches the Unreal Editor GUI

```powershell
cd simulation\unreal\deploy
python deploy.py
```

### `run_streaming.ps1`
Launches the full Pixel Streaming stack:
- Kills any existing signalling server or Unreal processes
- Starts the Epic Signalling Server in the background on port 80
- Launches Unreal Editor headless in the current terminal
- Streams only the 3D viewport (no editor UI)

### `scripts/ingest_scene.py`
Procedural scene builder (runs inside UE Python):
- Clears all existing Marsin actors
- Spawns floor plane, directional light, sky light, player start
- Spawns fixture shell geometry (boxes/cylinders) per fixture
- Spawns individual PointLights per pixel, tagged with DMX metadata
- Hides editor visual clutter (billboards, grids, light radius indicators)

### `scripts/sacn_unreal_receiver.py`
Real-time sACN-to-Unreal bridge:
- Non-blocking UDP socket on port 5568
- Parses E1.31 sACN packets, extracts per-universe DMX data
- Maps channels to lights via actor tags: `U<universe>`, `A<address>`, `PxOffset_<N>`, `PxType_<type>`
- Supports RGB, RGBWAU, and single-channel 'warm' pixel types
- Runs on the Editor Slate pre-tick callback (~3 FPS headless, 30+ FPS with GPU)

---

## Configuration

### Signalling Server (`PixelStreamingInfrastructure/SignallingWebServer/config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `player_port` | `80` | HTTP port for web frontend |
| `streamer_port` | `8888` | WebSocket port for Unreal streamer |
| `https` | `false` | Enable HTTPS (needs certificates) |

### UE Launch Flags (in `run_streaming.ps1`)

| Flag | Purpose |
|------|---------|
| `-RenderOffScreen` | No visible window on the host machine |
| `-ResX=1920 -ResY=1080` | Stream resolution |
| `-PixelStreamingConnectionURL=ws://localhost:8888` | Signalling server address |
| `-dpcvars="PixelStreaming2.Editor.Source=Viewport"` | Stream viewport only, no editor UI |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| White screen in browser | Streamer not connected | Check SignallingServer logs for `"New streamer connection"` |
| No DMX lights | sACN receiver not running | Check UE log for `[Marsin sACN] Streaming active` |
| Editor UI visible in stream | Wrong PS2 source | Ensure `-dpcvars` includes `Editor.Source=Viewport` |
| Port 80 in use | Another service (IIS, Skype) | Change `player_port` in config.json and update `index.js` |
| "LIGHTING NEEDS TO BE REBUILT" | Static lights | Run `deploy.py` — all lights are set to Movable |

---

## Plugin Dependencies

Enabled in `BM26_Unreal.uproject`:

- **PixelStreaming2** — WebRTC video streaming (UE 5.7 native)
- **PythonScriptPlugin** — Python scripting for sACN receiver
- **DMXEngine / DMXProtocol / DMXFixtures** — Legacy (can be removed)
