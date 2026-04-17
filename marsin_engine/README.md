# MarsinEngine — Multichannel Pixelblaze Rendering Engine

Node.js CLI that renders **Pixelblaze-compatible patterns** against the simulation's 3D pixel model and outputs DMX data via **sACN (E1.31)** in real-time.

> **Design Doc:** [MarsinEngine Architecture](../docs/12_marsin_engine.md)
>
> **Related:** [sACN Integration](../docs/11_sim_sacn_integration.md) · [Pixelblaze Engine](../docs/06_pixelblaze_engine.md) · [DMX Controller](../docs/08_dmx_controller.md)

---

## ⚡ Quick Start

```bash
cd marsin_engine
npm install
node engine.js --pattern bioluminescence --model test_bench
```

The engine will:
1. Load the pixel model from `models/test_bench.js` (or `titanic.js`, exported from the simulation)
2. Compile the pattern
3. Map rendered pixels to DMX universes
4. Send sACN packets to `127.0.0.1` (simulation bridge by default)

---

## 📋 Usage

```bash
# Render a pattern on a specific model
node engine.js --pattern rainbow --model test_bench

# List available patterns
node engine.js --list

# Custom FPS and priority
node engine.js --pattern fire --model titanic --fps 60 --priority 150

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
| `--pattern, -p` | *(required)* | Pattern name to render |
| `--model, -m` | *(required)* | Model name to load (`test_bench`, `titanic`, etc.) |
| `--fps` | `40` | Target framerate |
| `--priority` | `100` | sACN source priority (0–200) |
| `--dest` | `127.0.0.1` | sACN unicast destination IP |
| `--backend` | `auto` | Force backend: `js`, `wasm`, `gpu` |
| `--dry-run` | `false` | Load + compile only, no sACN output |
| `--list, -l` | — | List available patterns |
| `--help, -h` | — | Show help |

### NPM Scripts

```bash
npm start                    # Starts with no pattern (shows help)
npm run rainbow              # Shortcut: --pattern rainbow --model test_bench
npm run breathing            # Shortcut: --pattern breathing --model test_bench
npm run fire                 # Shortcut: --pattern fire --model test_bench
```

---

## 🧩 Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Pattern (.js)│ ──► │MarsinRuntime │ ──► │  DMX Mapper  │
│ Pixelblaze   │     │ (compile +   │     │ (pixel → DMX │
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
| **MarsinRuntime** | `lib/marsin_runtime.js` | Compiles Pixelblaze pattern code, provides `beginFrame()` / `renderPixel()` API. Implements PB globals (`time`, `wave`, `sin`, etc.) |
| **DMX Mapper** | `lib/dmx_mapper.js` | Maps pixel indices to DMX universe/channel based on model patch data. Builds 512-byte buffers per universe |
| **sACN Output** | `lib/sacn_output.js` | Creates one `sacn` Sender per universe, sends DMX frames as E1.31 UDP packets |
| **Engine CLI** | `engine.js` | CLI entry point — argument parsing, model loading, render loop orchestration |

---

## 🎨 Patterns

Patterns are Pixelblaze-compatible JavaScript files in `patterns/`. They export `beforeRender(delta)` and `render(index, x, y, z)` functions.

### Available Patterns

| Pattern | Description |
|---------|-------------|
| `rainbow` | Classic HSV rainbow sweep |
| `breathing` | Gentle sine-wave pulse |
| `fire` | Warm flickering fire effect |
| `bioluminescence` | Deep-sea organic glow animation |
| `occeanliner` | Ocean-themed multi-effect pattern |
| `plasma` | Classic plasma fractal |
| `sparkle` | Random twinkling sparkle |
| `wipe` | Linear color wipe |
| `test_6ch_pixel` | 6-channel RGBWAU test pattern |

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
  { idx: 0, nx: 0.123, ny: 0.456, nz: 0.789, universe: 1, addr: 1, footprint: 10 },
  // ... one entry per pixel
];
```

Each pixel has:
- **`nx, ny, nz`** — Normalized 3D position (0→1) used as pattern coordinates
- **`universe, addr`** — DMX patch (which universe and start address)
- **`footprint`** — Channel count (e.g. 10 for UkingPar)

The model is exported from the simulation via the GUI's export function.

---

## 📁 Directory Structure

```
marsin_engine/
├── engine.js               # CLI entry point & render loop
├── lib/
│   ├── marsin_runtime.js   # Pixelblaze runtime (compile + render)
│   ├── dmx_mapper.js       # Pixel → DMX universe/channel mapping
│   └── sacn_output.js      # sACN (E1.31) sender
├── models/
│   ├── test_bench.js       # Test bench model
│   └── titanic.js          # Full Titanic model
├── patterns/
│   ├── bioluminescence.js
│   ├── rainbow.js
│   ├── fire.js
│   └── ...                 # 9 patterns total
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
