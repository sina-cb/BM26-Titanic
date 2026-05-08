# MarsinEngine - API Output Server & Multichannel Rendering Engine

Node.js daemon that renders **Pixelblaze-compatible patterns** via a high-performance **WASM VM** against the simulation's 3D pixel model. It exposes a **REST/WebSocket API** on port `6968` for live control, and outputs DMX data via **sACN (E1.31)** in real-time.

> **Design Doc:** [MarsinEngine Architecture](../docs/12_marsin_engine.md)
>
> **Related:** [sACN Integration](../docs/11_sim_sacn_integration.md) · [Pixelblaze Engine](../docs/06_pixelblaze_engine.md) · [DMX Controller](../docs/08_dmx_controller.md)

---

## ⚡ Quick Start

```bash
cd marsin_engine
npm install
node engine.js --pattern rainbow --model test_bench
```

The engine will:
1. Boot up an HTTP/WebSocket **Output Server** on `http://localhost:6968`.
2. Load the pixel model from `models/test_bench.js`.
3. Compile the starting pattern into WASM bytecode.
4. Map rendered pixels to DMX universes and send sACN packets to `127.0.0.1` (simulation bridge).
5. Await live pattern swaps or parameter injections from CaptainPad via the API.

---

## 📋 Usage

```bash
# Render a pattern on a specific model
node engine.js --pattern rainbow --model test_bench

# List available patterns
node engine.js --list

# Custom FPS and priority
node engine.js --pattern test/fire --model titanic --fps 60 --priority 150

# Send directly to a physical controller
node engine.js --pattern bioluminescence --model test_bench --dest 10.1.1.102

# Compile-only test (no sACN output)
node engine.js --pattern rainbow --model test_bench --dry-run

# Full options
node engine.js --help
```

### CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--pattern, -p` | *(required)* | Initial pattern name to boot the engine with |
| `--model, -m` | *(required)* | Model name to load (`test_bench`, `titanic`, etc.) |
| `--fps` | `40` | Target framerate |
| `--port` | `6968` | HTTP/WS API listening port for control |
| `--priority` | `100` | sACN source priority (0–200) |
| `--dest` | `127.0.0.1` | sACN unicast destination IP |
| `--dry-run` | `false` | Load + compile only, no sACN output |
| `--list, -l` | — | List available patterns |
| `--help, -h` | — | Show help |

---

## 🔌 Live API Control (Port 6968)

The engine can be controlled completely live over its REST API and WebSocket layer without restarting the server. CaptainPad makes extensive use of this.

### HTTP Endpoints
- **`GET http://localhost:6968/patterns`**: Get JSON list of all available script names.
- **`GET http://localhost:6968/exports`**: Get the current UI parameter mappings defined inside the currently running script (like Color Pickers, Sliders).
- **`PUT http://localhost:6968/pattern`**: Hot-swap the running pattern. Example body: `{ "pattern": "fire" }`.
- **`POST http://localhost:6968/control`**: Push a parameter alteration manually via REST (Alternative to WebSocket). Example `{ "id": 1, "v0": 1.0 }`.

### WebSockets (`ws://localhost:6968/`)
Connect a WebSocket to stream parameter alterations live to the engine's memory:
```json
{ "type": "setControl", "id": 1, "v0": 1.0, "v1": 0.5, "v2": 1.0 }
```
The server also automatically drops a telemetry packet describing output health 1x per second:
```json
{ "type": "stats", "fps": 40, "patched": 323 }
```

### NPM Scripts

```bash
npm start                    # Starts with no pattern (shows help)
npm run rainbow              # Shortcut: --pattern rainbow --model test_bench
npm run breathing            # Shortcut: --pattern test/breathing --model test_bench
npm run fire                 # Shortcut: --pattern test/fire --model test_bench
npm run bio                  # Shortcut: --pattern 11_bioluminescence --model test_bench
npm run golden               # Shortcut: --pattern 00_golden_hour_wash --model test_bench
npm run check:fire           # Compile-only dry run for test/fire
npm run check:breathing      # Compile-only dry run for test/breathing
```

---

## 🧩 Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Pattern (.js)│ ──► │  WasmHost    │ ──► │ sACN Mapper  │
│ Pixelblaze   │     │ (compile +   │     │ (pixel -> DMX│
│ compatible   │     │  render loop)│     │  channel map)│
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │ sACN Output  │
                                          │ (sacn npm)   │
                                          │ → 127.0.0.1  │
                                          └──────────────┘
                                                  │
                                          sACN UDP (port 5568)
                                                  │
                                    ┌─────────────┼─────────────┐
                                    ▼                           ▼
                             sacn_bridge.js              Physical DMX
                             (sim WebSocket)             controllers
```

### Core Modules

| Module | File | Purpose |
|--------|------|---------|
| **WasmHost** | `lib/wasm_host.js` | Loads the bundled MarsinVM WASM runtime, compiles Pixelblaze pattern code, and exposes frame/render APIs. |
| **WASM Runtime Wrapper** | `lib/marsin_wasm_runtime.js` | Lower-level wrapper around `marsin_pb/wasm/marsin-engine.*`. |
| **sACN Mapper** | `../simulation/src/dmx/sacn_mapper.js` | Maps pixel indices to DMX universe/channel based on model patch data. Builds 512-byte buffers per universe |
| **sACN Output** | `lib/sacn_output.js` | Creates one `sacn` Sender per universe, sends DMX frames as E1.31 UDP packets |
| **Engine CLI** | `engine.js` | CLI entry point — argument parsing, model loading, render loop orchestration |

---

## 🎨 Patterns

Patterns are Pixelblaze-compatible JavaScript files in `patterns/`. They export `beforeRender(delta)` and `render(index, x, y, z)` functions.

### Available Patterns

| Pattern | Description |
|---------|-------------|
| `00_golden_hour_wash` | Warm production wash |
| `01_cylon_sweep` through `25_heartbeat` | Numbered production pattern set |
| `rainbow` | Minimal classic HSV rainbow test pattern |
| `test/fire` | Test fire pattern, used by `npm run fire` |
| `test/breathing` | Test breathing pattern, used by `npm run breathing` |
| `test/test_6ch_pixel` | 6-channel RGBWAU test pattern |

### Writing Patterns

Patterns use the [Pixelblaze API](https://electromage.com/docs/language):

```javascript
// patterns/my_pattern.js

export function beforeRender(delta) {
  t1 = time(0.1);  // slow time ramp (0→1)
}

export function render(index, x, y, z) {
  // index: pixel index (0 to pixelCount-1)
  // x, y, z: normalized 3D coordinates (0→1)
  h = (x + t1) % 1;   // hue based on position + time
  s = 1;
  v = wave(y + t1);    // brightness wave
  hsv(h, s, v);        // set pixel color
}
```

**6-channel patterns** can use `rgbwau(r, g, b, w, a, u)` instead of `hsv()` for direct RGBWAU control.

---

## 🗺️ Pixel Model

The engine requires a pixel model exported from the simulation. Located at `models/titanic.js` or `models/test_bench.js`, it contains:

```javascript
export const pixelCount = 323;
export const pixels = [
  { i: 0, nx: 0.123, ny: 0.456, nz: 0.789, patch: { universe: 1, addr: 1, footprint: 10 } },
  // ... one entry per pixel
];
```

Each pixel has:
- **`nx, ny, nz`** — Normalized 3D position (0→1) used as pattern coordinates
- **`patch.universe, patch.addr`** — DMX patch (which universe and start address)
- **`patch.footprint`** — Channel count (e.g. 10 for UkingPar)

The model is exported from the simulation via the GUI's export function.

---

## 📁 Directory Structure

```
marsin_engine/
├── engine.js               # CLI entry point & render loop
├── lib/
│   ├── wasm_host.js        # High-level MarsinVM WASM host
│   ├── marsin_wasm_runtime.js # Low-level WASM runtime wrapper
│   └── sacn_output.js      # sACN (E1.31) sender
├── models/
│   ├── test_bench.js       # Test bench model
│   └── titanic.js          # Full Titanic model
├── patterns/
│   ├── 00_golden_hour_wash.js
│   ├── 11_bioluminescence.js
│   ├── rainbow.js
│   ├── test/
│   │   └── fire.js
│   └── ...                 # Numbered production patterns plus test patterns
└── package.json
```

---

## 🔗 Integration with Simulation

The engine sends sACN to `127.0.0.1` by default, which is picked up by the simulation's `sacn_bridge.js` (port 6971). The simulation's `SacnInputSource` receives these frames via WebSocket and feeds them to the `UniverseRouter` for display.

To send to **real hardware** instead:

```bash
node engine.js --pattern bioluminescence --model titanic --dest 10.1.1.102
```

### Priority System

| Source | Priority | Notes |
|--------|----------|-------|
| MarsinEngine | `100` | Default, lowest priority |
| Canopy | `150` | Mid-priority |
| Chromatik (LX Studio) | `200` | Highest, always wins |

When multiple sources send to the same universe, the simulation's `UniverseRouter` resolves conflicts using the configured merge mode (`highest_priority_source_lock` or `highest_priority_per_patch`).

---

## 🌐 Web Client Hosting

`config.yaml` contains a reserved `web_client` block, but the current engine API server does not serve static files from `CaptainPad/dist`. Use the CaptainPad web scripts below until engine-side static hosting is implemented.

### Setup

1. **Build the web export** from CaptainPad:
   ```bash
   cd ../CaptainPad
   npm run web:build
   ```
   This produces a static site in `CaptainPad/dist/`.

2. **Leave the reserved `web_client` block documented, but do not rely on it yet:**
   ```yaml
   web_client:
     enabled: true
     port: 6967
     build_dir: ../CaptainPad/dist
   ```

3. **Serve the web build** from `CaptainPad`:
   ```bash
   cd ../CaptainPad
   npm run web:serve
   ```

The web UI is then available on `http://localhost:6967`; the engine API remains on `http://localhost:6968`.

### Architecture

| Component | Port | Purpose |
|-----------|------|---------|
| **Engine API** | `6968` | REST + WebSocket for pattern/mixer control |
| **Web Client** | `6967` | CaptainPad static server from `npm run web:serve` |
| **Expo Dev** | `6967` | iOS/Android development (shares same port, run one at a time) |

> **Note:** The web client connects to the engine API at the address configured in `CaptainPad/config.yaml` (`api_base`). For production, both run on the same host, so the web UI can reach the API at `http://localhost:6968`.
