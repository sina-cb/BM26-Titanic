# 🎆 Pixelblaze Pattern Engine — Design & Integration

## Overview

The TITANIC simulation includes a **Pixelblaze-compatible WASM pattern engine** (MarsinEngine) that compiles and executes LED patterns written in the [Pixelblaze](https://electromage.com/pixelblaze) language by Ben Hencke. The engine runs the same bytecode VM as physical ESP32 LED controllers — patterns authored in the simulation will produce identical output on real hardware.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Three.js Simulation                             │
│                                                                         │
│   ┌──────────────────────────────────┐                                  │
│   │  Fixture Layer (MODEL)           │  ◀── scene_config.yaml           │
│   │  • LedStrand.js  (LED bulbs)     │      (single source of truth)    │
│   │  • ParLight.js   (par positions) │                                  │
│   │  • Iceberg.js    (flood/LEDs)    │                                  │
│   └───────────┬──────────┬───────────┘                                  │
│               │          │                                              │
│          ┌────▼────┐ ┌───▼──────────────────┐                           │
│          │ Export 1 │ │ Export 2              │                          │
│          │ PB Pixel │ │ Chromatik Fixtures   │                          │
│          │ Map      │ │ (DMX control plane)  │                          │
│          │ (x,y,z)  │ │ [TODO]               │                          │
│          └────┬─────┘ └───┬──────────────────┘                          │
│               │           │                                             │
│        ┌──────▼──────┐    │                                             │
│        │ MarsinEngine │    │                                             │
│        │   (WASM)     │    │                                             │
│        │              │    │                                             │
│        │  compile()   │    │                                             │
│        │  beginFrame()│    │                                             │
│        │  renderPixel()    │                                             │
│        └──────┬───────┘    │                                             │
│               │            │                                             │
│               ▼            ▼                                             │
│        ┌──────────────┐  ┌──────────────┐                                │
│        │  NDI Out     │─▶│  Chromatik   │──▶ sACN / ArtNet ──▶ Fixtures │
│        └──────────────┘  └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Fixture Targets

The pattern engine addresses **two distinct lighting interfaces**:

### 1. LED Strands (Addressable Pixels)
- **Interface:** Individual LED bulbs on `LedStrand.js` fixtures
- **Pixel mapping:** Each LED = 1 pixel, mapped linearly along the strand (0.0 → 1.0)
- **Render function:** `render(index)` or `render2D(index, x, y)` with strand position
- **Use case:** Animated color patterns, chases, sparkles, perlin fire along ship hull strands

### 2. Par Lights (DMX Fixtures)
- **Interface:** `ParLight.js` spot color — each par = 1 "big pixel"
- **Pixel mapping:** 3D position from `scene_config.yaml`, normalized to 0-1 range
- **Render function:** `render3D(index, x, y, z)` using fixture XYZ coordinates
- **Use case:** Color waves, zone washes, synchronized group effects across the par array
- **DMX output:** Each pixel's RGB maps to the par's DMX RGBW channels via Chromatik

### 3. Iceberg Systems (Floods + LEDs)
- **Flood lights:** 1 big pixel per flood, addressed by iceberg index
- **LED string art:** Addressable per-edge or per-face segments on iceberg geometry
- **Use case:** Ice-glow animations, slow breathing, color temperature drift

---

## Fixture Export Formats

The fixture layer is the **single source of truth** for all light positions. When fixtures change, two export formats are generated:

### Export 1: Pixelblaze Pixel Map

A normalized coordinate map loaded by MarsinEngine so patterns can use `render2D`/`render3D` with real spatial data.

```json
{
  "pixelCount": 112,
  "map": [
    [0.21, 0.38, 0.03],
    [0.22, 0.36, 0.02],
    ...
  ]
}
```

- Coordinates normalized to 0.0–1.0 across the full scene bounding box
- Pixel order: LED strand pixels first, then par lights as big pixels, then iceberg floods
- Updated automatically when fixtures move in the GUI or `scene_config.yaml` changes
- Loaded by engine via `engine.setPixelMap(mapData)` before rendering

### Export 2: Chromatik Fixture Definitions `[TODO — DEEP RESEARCH REQUIRED]`

> [!CAUTION]
> **This section is speculative and requires deep research before implementation.**
> The JSON schema below is a rough placeholder — Chromatik's actual fixture definition format, LXF model spec, and fixture library conventions need to be studied in detail. This includes understanding how Chromatik handles fixture types, 3D model import coordinate systems, DMX universe/address auto-assignment, and the relationship between LX fixtures and sACN/ArtNet output nodes.

A fixture definition file for Chromatik's DMX control plane *(schema TBD after research)*:

```json
// ⚠️ PLACEHOLDER — actual Chromatik fixture format TBD
{
  "fixtures": [
    {
      "id": 0,
      "label": "Par Port Fwd 01",
      "type": "par_rgbw",
      "x": 20.6, "y": 11.5, "z": 3.0,
      "universe": 1,
      "address": 1,
      "channelCount": 4
    }
  ]
}
```

> [!NOTE]
> The Chromatik export is not yet implemented. It requires:
> 1. **Deep research** into Chromatik/LX fixture definition format and 3D model import
> 2. DMX universe and address assignment strategy (auto vs. manual)
> 3. Understanding of Chromatik's fixture library and how custom fixtures are registered
> 4. Coordinate system mapping between Three.js (Y-up, meters) and Chromatik's 3D space

---

## Engine Integration Points

### Current State
The MarsinEngine WASM binary and wrapper (`MarsinEngine.js`, `lib/marsin-engine/`) are present in the simulation directory but not yet wired into the animation loop.

### Missing Implementations (To Be Built)

| Component | Status | Description |
|-----------|--------|-------------|
| **Animation loop hook** | ⬜ Not wired | `engine.beginFrame()` + `renderPixel()` calls in `main.js` `animate()` |
| **LED strand pixel driver** | ⬜ Needs code | Apply engine output to `LedStrand.js` bulb meshes (see skill doc §6) |
| **Par light pixel driver** | ⬜ Needs code | Map engine output to `ParLight.js` spotlight colors |
| **PB pixel map exporter** | ⬜ Needs code | Generate normalized XYZ map from fixture positions on save |
| **Chromatik fixture exporter** | ⬜ TODO | Generate Chromatik fixture JSON with DMX addressing |
| **Pattern selector UI** | ⬜ Needs code | GUI dropdown or text editor for switching/editing patterns |
| **NDI bridge** | ⬜ Needs code | Forward rendered pixel buffer to Chromatik via NDI |

### Integration Code (LED Strands)

```javascript
// In main.js animate() loop
engine.beginFrame(clock.getElapsedTime());

(window.ledStrandFixtures || []).forEach(fixture => {
  const count = fixture.config.ledCount || 10;
  const bulbs = fixture.group.children.filter(
    c => c.userData._strandPart === 'led'
  );
  bulbs.forEach((child, idx) => {
    if (idx % 3 !== 1) return; // only the glowing bulb mesh
    const ledIdx = Math.floor(idx / 3);
    const t = count > 1 ? ledIdx / (count - 1) : 0.5;
    const { r, g, b } = engine.renderPixel(ledIdx, t, 0, 0);
    child.material.color.setRGB(r / 255, g / 255, b / 255);
    child.material.emissive.setRGB(r / 255, g / 255, b / 255);
  });
});
```

### Integration Code (Par Lights)

```javascript
// Par lights as big pixels — each par is one pixel
const parCount = window.parFixtures.length;
window.parFixtures.forEach((fixture, i) => {
  const cfg = fixture.config;
  // Normalize position to 0-1 range across scene
  const nx = (cfg.x + 50) / 100;
  const ny = cfg.y / 30;
  const nz = (cfg.z + 50) / 100;
  const { r, g, b } = engine.renderPixel(i, nx, ny, nz);
  fixture.light.color.setRGB(r / 255, g / 255, b / 255);
  if (fixture.beam) fixture.beam.material.color.setRGB(r / 255, g / 255, b / 255);
});
```

---

## Pattern Language Summary

The Pixelblaze pattern language (by Ben Hencke, [electromage.com](https://electromage.com)) is a JavaScript-like DSL where all values are floats:

- **Entry points:** `beforeRender(delta)` (per frame), `render(index)` / `render2D` / `render3D` (per pixel)
- **Color output:** `hsv(h, s, v)` or `rgb(r, g, b)` — all values 0-1
- **Timing:** `time(interval)` returns a sawtooth 0→1 with period `65.536 * interval` seconds
- **Waveforms:** `wave()`, `square()`, `triangle()`
- **Noise:** `perlin()`, `perlinFbm()`, `perlinRidge()`, `perlinTurbulence()`
- **Trig uses turns, not radians:** `sin(0.25)` = 1.0

Full API reference: `.agent/01_skills/03_pb_patterns.md`

---

## TITANIC-Specific Pattern Ideas

| Pattern | Target | Description |
|---------|--------|-------------|
| **Ice Glow** | Iceberg LEDs | Slow perlin noise in blue-white, organic crystalline shimmer |
| **Hull Wash Wave** | Par lights | Color wave sweeping bow→stern using par 3D positions |
| **Smokestack Pulse** | Stack rings | Breathing warm glow synced across all 4 rings |
| **Distress Signal** | All | SOS morse code pattern (---...---) in red across all fixtures |
| **Playa Dust** | Par lights | Warm amber perlin turbulence, simulating dust storm glow |
| **Deep Sea** | LED strands | Cool blue-green chase patterns along hull strands |
| **Sinking** | Par + floods | Gradual vertical fade from warm→cold, top→bottom over minutes |

---

## Deployment Path

1. **Sim development** — Author and preview patterns in Three.js simulation
2. **Chromatik export** — Engine pixel output → NDI → Chromatik → DMX addressing
3. **On-playa** — Pixelblaze hardware controllers run the same patterns natively on ESP32, or Chromatik drives DMX directly from a laptop running the engine
