# 12 — MarsinEngine: Multichannel Rendering Pipeline

## 1. Overview

MarsinEngine is a standalone, headless rendering engine for the BM26 Titanic lighting system. It executes Pixelblaze-compatible patterns against a pixel model exported from the simulation, maps rendered RGB values to DMX channels via a patch table, and transmits the result over sACN (E1.31) to the simulation bridge for real-time 3D visualization.

**Design Philosophy:**
- **Rendering efficiency first.** Pattern rendering runs on CPU (WASM primary, pure-JS fallback). GPU acceleration targets the mixing/compositing stage only.
- **Deterministic patching.** The pixel model embeds auto-packed DMX patch info (universe/addr/footprint). Both the engine and the simulation consume the same patch layout.
- **Pattern portability.** Patterns are Pixelblaze-compatible `.js` files that run identically in the simulation browser, the engine CLI, and the `pixelblaze_util` web editor.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       MarsinEngine CLI                        │
│                                                               │
│  ┌───────────┐   ┌──────────────┐   ┌──────────────────────┐ │
│  │  Pattern   │   │  Pixel Model │   │   Render Backend     │ │
│  │  Loader    │──▶│(test_bench.js)│──▶│                      │ │
│  │            │   │  323 pixels  │   │  ┌────────────────┐  │ │
│  │ rainbow.js │   │  + patches   │   │  │ CPU (WASM)     │  │ │
│  │ fire.js    │   │  + coords    │   │  │ primary (v2)   │  │ │
│  │ custom.js  │   └──────────────┘   │  ├────────────────┤  │ │
│  └───────────┘                       │  │ CPU (pure JS)  │  │ │
│                                      │  │ active (v1) ✅ │  │ │
│                                      │  └────────────────┘  │ │
│                                      └──────────────────────┘ │
│                           │                                    │
│                    ┌──────▼──────┐                             │
│                    │  DMX Mapper │                             │
│                    │  pixel RGB  │                             │
│                    │  → universe │                             │
│                    │  → address  │                             │
│                    └──────┬──────┘                             │
│                           │                                    │
│                    ┌──────▼──────┐                             │
│                    │ sACN Sender │                             │
│                    │  E1.31 UDP  │                             │
│                    └─────────────┘                             │
└──────────────────────────────────────────────────────────────┘
                           │
                    sACN unicast → 127.0.0.1
                           │
                    ┌──────▼──────┐        WebSocket        ┌──────────┐
                    │ sACN Bridge │ ──────────────────────▶  │ Browser  │
                    │ (port 6971) │    binary DMX frames     │ Sim (3D) │
                    └─────────────┘                          └──────────┘
```

---

## 3. Rendering Backends

Pattern rendering always runs on **CPU** (via WASM or pure-JS fallback). GPU acceleration targets the **mixing/compositing stage** only — blending multiple source inputs, priority resolution, and final output composition. We do NOT re-implement or transpile Pixelblaze patterns to GPU shaders.

### 3.1 CPU — WASM (Primary Renderer)

Uses the existing **MarsinEngine WASM binary** (`marsin-engine.js` + `.wasm`) via the Emscripten loader in Node.js.

**How it works:**
1. Load the WASM module via dynamic `import()`.
2. `compile()` → `marsin_compile(code)` — compiles Pixelblaze pattern to internal bytecode.
3. `renderFrame()` → `marsin_render_all(handle, outPtr, pixelCount, coordPtr)` — batch renders all pixels in one WASM call.
4. Read back RGB buffer from WASM linear memory.

**Performance:** Near-native C++ speed. 10,000 pixels at 60fps easily achievable.

**Status:** Designed for v2 integration. Requires Node.js Emscripten loader adaptation.

### 3.2 CPU — Pure JS (Fallback Renderer)

A lightweight JavaScript implementation of the Pixelblaze API (`marsin_runtime.js`). Pattern code runs directly in Node.js via `new Function()` sandboxing. **This is the v1 shipping path.**

**API surface:**

| Category | Functions |
|----------|-----------|
| Time | `time(interval)` |
| Waves | `wave(x)`, `triangle(x)`, `square(x, duty)` |
| Color | `hsv(h, s, v)`, `rgb(r, g, b)`, `rgbwau(r, g, b, w, a, u)` |
| Math | `sin`, `cos`, `abs`, `min`, `max`, `pow`, `sqrt`, `floor`, `ceil`, `round`, `random`, `clamp`, `mod`, `frac` |
| Noise | `perlin(x, y, z, lacunarity, detail)` (simplex approx) |
| Globals | `pixelCount`, `PI`, `PI2`, `E` |
| Metadata | `controllerId`, `sectionId`, `fixtureId`, `viewMask` (Marsin extension — live-read per pixel via getters) |

> [!NOTE]
> `rgbwau()` downmixes the W/A/U channels into RGB for the v1 3-channel output path, matching the same mixing ratios used in the simulation's `animate.js`.

> [!NOTE]
> Metadata variables are Marsin extensions (Design 24: Model Views). They default to `0` when no metadata is configured. Use `rt.setPixelMeta([...])` to assign per-pixel metadata, or pass metadata to individual `rt.renderPixel(i, x, y, z, { sectionId: 1 })` calls.

**Verified performance:** 39fps sustained, 0.2ms/frame for 323 pixels on Apple M-series.

### 3.3 GPU — Mixing / Compositing (Future)

> [!NOTE]
> GPU is **NOT** used for executing Pixelblaze patterns. Patterns always run on CPU via WASM.

GPU compute (WebGPU) targets the **mixing stage** for when multiple rendering sources are active simultaneously:

- **Multi-source blending:** Compositing outputs from multiple concurrent patterns or external sACN inputs.
- **Priority resolution:** Per-patch or per-universe source arbitration at GPU speed.
- **Effects pipeline:** Post-processing effects (fade, crossfade, global dimmer, color correction) on final mixed output.

At 323 pixels, CPU mixing is trivially fast. GPU mixing becomes essential at 10,000+ pixels with multiple concurrent sources.

### 3.4 Backend Selection

```
v1 (current):  pure-JS renderer → CPU mixer → sACN output
v2 (planned):  WASM renderer    → CPU mixer → sACN output
v3 (future):   WASM renderer    → GPU mixer → sACN output
```

---

## 4. Pixel Model Format

The simulation exports a model file (`models/test_bench.js` or `models/titanic.js`) that includes pixel coordinates and DMX patch information:

```js
export const pixelCount = 323;

export const pixels = [
  {
    i: 0,
    type: 'par',                          // fixture type
    name: 'Right Front Wall Generator 1',
    group: 'Right Front Wall Generator',
    x: 20.60, y: 11.5, z: 3.0,           // world coordinates
    nx: 0.67, ny: 0.86, nz: 0.57,        // normalized [0,1]
    patch: {                              // DMX mapping
      universe: 1,
      addr: 1,
      footprint: 10,
    },
    channels: 3,                          // RGB output channels
  },
  // ...
];
```

**Key fields:**
- `nx, ny, nz` — normalized coordinates fed to `render3D(index, x, y, z)` or `render(index)`.
- `patch.universe` + `patch.addr` — where this pixel's DMX data starts.
- `channels` — how many DMX channels this pixel writes (3 for RGB in v1).
- `patch.footprint` — total channel footprint of the physical fixture this pixel belongs to.

---

## 5. DMX Patching

### 5.1 Patch Table

The `universes:` block in `scene_config.yaml` defines the authoritative DMX patch table shared by the simulation and the engine:

```yaml
universes:
  1:
    name: Pars A
    fixtures:
      - id: par_0
        type: UkingPar
        addr: 1
        footprint: 10
      - id: par_1
        type: UkingPar
        addr: 11
        footprint: 10
      # ... sequentially packed
  2:
    name: Pars B
    fixtures:
      - id: par_51
        addr: 1
        footprint: 10
      # ...
  3:
    name: LED Strands
    fixtures:
      - id: led_strand_1
        type: WS2812
        addr: 1
        footprint: 300
  4:
    name: Icebergs
    fixtures:
      - id: berg_alpha
        type: IcebergLed
        addr: 1
        footprint: 3
```

### 5.2 Channel Mapping

v1 uses simplified RGB mapping for all fixture types:

| Fixture Type | Channels | DMX Layout |
|-------------|----------|------------|
| UkingPar (10ch) | 3 used (R/G/B at ch1-3 of fixture, dimmer set to 255) | addr+0=R, addr+1=G, addr+2=B, addr+3..9=0 |
| WS2812 LED | 3 (R/G/B) | addr+0=R, addr+1=G, addr+2=B |
| IcebergLed | 3 (R/G/B) | addr+0=R, addr+1=G, addr+2=B |

The `DmxMapper` writes RGB at the correct offset within each fixture's address range and zeros the remaining channels (or sets dimmer channels to 255 as appropriate).

---

## 6. sACN Output

The engine uses the `sacn` npm package `Sender` class:

| Parameter | Value |
|-----------|-------|
| Source Name | `MarsinEngine` |
| Priority | 100 (override via `--priority`) |
| Universes | Auto-detected from model patches |
| Destination | `127.0.0.1` unicast (loopback to bridge) |
| Refresh Rate | Pattern FPS (default 40) |

Each frame:
1. Render all pixels → RGB array
2. Map RGB to universe/address DMX buffers
3. Send via sACN Sender (one packet per active universe)

---

## 7. CLI Interface

```bash
# Basic usage
node engine.js --pattern rainbow

# With options
node engine.js --pattern fire --fps 60 --priority 100

# Dry run (no sACN, just verify pattern loads)
node engine.js --pattern rainbow --dry-run

# List available patterns
node engine.js --list
```

| Flag | Default | Description |
|------|---------|-------------|
| `--pattern` | (required) | Pattern name (without .js) |
| `--fps` | 40 | Target render framerate |
| `--priority` | 100 | sACN source priority |
| `--dry-run` | false | Load & compile only, no sACN output |
| `--list` | — | List available patterns and exit |
| `--backend` | auto | Force: `js`, `wasm`, or `gpu` |
| `--dest` | 127.0.0.1 | sACN unicast destination IP |

---

## 8. Directory Layout

```
marsin_engine/
├── engine.js              # CLI entry point
├── package.json           # deps: sacn
├── lib/
│   ├── marsin_runtime.js  # Pure-JS Pixelblaze runtime (v1 active backend)
│   ├── dmx_mapper.js      # pixel RGB → universe/addr DMX buffers
│   └── sacn_output.js     # sACN Sender wrapper (one Sender per universe)
├── patterns/              # Shared with simulation + pixelblaze_util
│   ├── rainbow.js
│   ├── breathing.js
│   ├── fire.js
│   ├── bioluminescence.js
│   ├── occeanliner.js
│   ├── plasma.js
│   ├── sparkle.js
│   ├── test_6ch_pixel.js
│   └── wipe.js
├── models/                # Auto-generated from simulation
│   ├── test_bench.js      # 64 pixels + DMX patch info (universe/addr/footprint)
│   └── titanic.js         # 323 pixels + DMX patch info
└── node_modules/          # sacn dependency
```

---

## 9. Performance Budget

| Metric | Target | Measured (v1 JS) |
|--------|--------|------------------|
| Render latency (323px, JS) | < 1ms/frame | **0.2ms/frame** ✅ |
| Render latency (323px, WASM) | < 0.1ms/frame | (v2, not yet measured) |
| Sustained FPS | 40 fps | **39 fps** ✅ |
| sACN packet overhead | ~0.5ms/frame | 4 universe packets |
| Total frame budget @ 40fps | 25ms | **~1ms used** |
| Memory footprint | < 50MB | ~30MB (Node.js + sacn) |

At 323 pixels, the pure-JS backend has massive headroom (1ms used out of 25ms budget). The WASM path becomes essential for future pixel counts (10,000+ addressable LEDs).

---

## 10. Future Extensions

1. **WASM backend (v2):** Port existing MarsinEngine WASM binary to Node.js for near-native rendering speed.
2. **GPU mixing (v3):** WebGPU compute shaders for multi-source compositing and effects pipeline.
3. **RGBWAU full output:** Extended 6-channel DMX mapping for UkingPar fixtures (currently downmixed to RGB).
4. **Live pattern reload:** File watcher auto-reloads pattern on save.
5. **Multi-pattern mixer:** Run multiple patterns simultaneously with cross-fade.
6. **Recording/playback:** Capture rendered DMX frames for offline replay.
7. **Network discovery:** Auto-discover sACN bridge address via mDNS.
8. **DmxFixtureRuntime migration:** Replace legacy ParLight fixtures with proper patchDef-based runtime objects, eliminating the direct-apply path in animate.js.
