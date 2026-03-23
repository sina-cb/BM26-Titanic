# 💡 DMX Handler — Universe & Fixture Architecture

## Overview

This document describes the **DMX output layer** for the BM26-Titanic lighting system — the
subsystem that translates high-level lighting intent into Art-Net UDP packets sent to physical
DMX controllers.

The system is structured as three composable classes (`DmxFixture`, `DmxUniverse`,
`DmxHandler`) loaded from a single `universes.yaml` config file. `DmxHandler` is the
top-level object that owns the entire DMX setup — universes, controllers, and the lifecycle
of every Art-Net socket. Fixture capability profiles (channel layouts and DMX semantics) live
in the `fixtures/` directory and are referenced from the universe config.

> **Note:** Channel profiles define DMX channel semantics only — they do not contain physical
> pixel geometry or 3D positions. A proposed model layer (see `09_dmx_fixture_models.md`)
> will add pixel-mapped 3D geometry as a companion YAML alongside each channel profile.

---

## System Architecture

```
universes.yaml
└── Universe: "main"  (10.1.1.101, Art-Net universe 0)
    ├── Fixture: "bar_1"  (Endyshow 240W, start addr 1)
    └── Fixture: "bar_2"  (Endyshow 240W, start addr 136)

Universe: "port_side"  (10.1.1.102, Art-Net universe 0)
    ├── Fixture: "par_1"  (UKing RGBWAU, start addr 1)
    ├── Fixture: "par_2"  (UKing RGBWAU, start addr 11)
    └── ...
```

```
DmxHandler
│   loads universes.yaml
│   init() / close() all sockets
│
└── DmxUniverse  [one per controller output]
    │   owns a 512-byte buffer
    │   owns one ArtNetSender (IP / universe / subnet / net)
    │   assigns each fixture a buffer offset when placing it
    │   send()     — flushes buffer → Art-Net UDP packet
    │   blackout() — zeros buffer and sends
    │
    └── DmxFixture  (base class)
        │   knows its local channel layout from a profile YAML
        │   does NOT know its position in the universe
        │   writes into whatever buffer offset the universe supplies
        │   setChannel(n, val)   — local channel n → buffer[offset + n - 1]
        │   setPixel(n, r, g, b) — local pixel n → 3 buffer bytes at offset
        │
        ├── EndyshowBar  extends DmxFixture
        │       setPixel(n, r, g, b)   32 RGB pixels, verified R,G,B order
        │       setAmber(n, val)        16 amber segments
        │       setWhite(n, val)        16 white segments
        │       setRgbStrobe(val)       CH129
        │       setRgbEffect(val)       CH131
        │       setRgbSpeed(val)        CH132
        │       setAcwEffect(val)       CH134
        │       — supports modes: 7 / 13 / 82 / 130 / 135
        │
        └── UkingPar  extends DmxFixture
                setRed(val) / setGreen(val) / setBlue(val)
                setWhite(val) / setAmber(val) / setPurple(val)
                setStrobe(val)    (10-ch mode only)
                setFunction(val)  (10-ch mode only)
                — supports modes: 6 / 10
```

---

## File Layout

```
dmx/
├── lib/
│   ├── artnet.js          # Art-Net 4 UDP sender (ArtNetSender class)
│   ├── DmxFixture.js      # Base fixture class — profile loader, buffer-offset writes
│   ├── DmxUniverse.js     # Universe — 512-byte buffer + ArtNetSender + fixture list
│   ├── DmxHandler.js      # Top-level — loads universes.yaml, owns all universes
│   └── fixtures/
│       ├── EndyshowBar.js  # extends DmxFixture — 7/13/82/130/135 ch modes
│       └── UkingPar.js     # extends DmxFixture — 6/10 ch modes
├── fixtures/
│   ├── endyshow_240w_stage_strobe_led_bar/
│   │   └── channels_135.yaml   (and other mode profiles)
│   └── uking_rgbwau_par_light/
│       └── (channel profiles)
├── universes.yaml          # Universe + fixture placement config
├── index.js                # Re-exports DmxHandler, DmxUniverse, DmxFixture + subclasses
└── package.json
```

---

## `universes.yaml` Schema

This is the single source of truth for the physical deployment topology.

```yaml
# BM26 Titanic — DMX Universe Configuration
# ==========================================
# One entry per Art-Net output universe.
# Each universe maps to one controller port (one Art-Net universe = 512 DMX channels).

network:
  local_ip: "10.1.1.172"
  broadcast_ip: "10.1.1.255"
  subnet_mask: "255.255.255.0"

universes:
  - id: "main"
    name: "Main Deck Bar Lights"
    controller:
      ip: "10.1.1.101"
      port: 6454       # Art-Net default
      universe: 0      # 0-15 within subnet
      subnet: 0        # 0-15 within net
      net: 0           # 0-127
    fixtures:
      - label: "bar_1"
        profile: "fixtures/endyshow_240w_stage_strobe_led_bar/channels_135.yaml"
        dmx_start_address: 1    # 1-indexed, must not overlap with bar_2

  - id: "port_side"
    name: "Port Side Par Array"
    controller:
      ip: "10.1.1.102"
      port: 6454
      universe: 0
      subnet: 0
      net: 0
    fixtures:
      - label: "par_1"
        profile: "fixtures/uking_rgbwau_par_light/channels_10.yaml"
        dmx_start_address: 1
      - label: "par_2"
        profile: "fixtures/uking_rgbwau_par_light/channels_10.yaml"
        dmx_start_address: 11
```

> [!IMPORTANT]
> `dmx_start_address` is **1-indexed** (DMX convention). This value is used **only by the
> universe** to compute each fixture's buffer offset — the fixture itself is never aware of
> where it sits in the universe. The universe passes `offset = dmx_start_address - 1`
> (0-indexed) to each fixture at placement time. Fixture channel numbering always starts at
> local 1 regardless of offset.
>
> Fixtures must not overlap: fixture N's `dmx_start_address + total_channels - 1` must be
> less than fixture N+1's `dmx_start_address`.

---

## Fixture Profile Schema

Each physical fixture model has one YAML profile per channel mode in `fixtures/`. These
are already defined for our two fixture types.

**Required fields:**

```yaml
fixture:
  name: "Human-readable name"
  mode: "135-channel"
  total_channels: 135

# For LED bar fixtures with pixel-mapped RGB sections:
rgb_pixels:
  count: 32
  channels_per_pixel: 3
  channel_order: [red, green, blue]   # verified physical order
  start_channel: 1
  end_channel: 96

# For simpler single-function sections:
control_channels:
  - channel: 129
    function: "RGB Strobe"
    ranges:
      - { min: 0, max: 9, description: "No function" }
      - { min: 10, max: 255, description: "Strobe (slow-fast)" }
```

---

## Class API

### `DmxHandler`

The top-level object that owns the entire DMX setup — universes, controllers, and socket
lifecycle. Instantiate one per process.

```js
const handler = new DmxHandler(universesYamlPath);
// universesYamlPath defaults to path.join(__dirname, 'universes.yaml')

await handler.init();          // Opens all ArtNet sockets
handler.universe('main');      // Returns DmxUniverse by id
handler.universes;             // Map<id, DmxUniverse> of all universes
await handler.blackoutAll();   // Blackout every universe
handler.close();               // Close all sockets
```

### `DmxUniverse`

```js
// Retrieved via ctrl.universe('main')
u.id                        // "main"
u.name                      // "Main Deck Bar Lights"
u.buffer                    // Buffer(512) — current channel state
u.fixture('bar_1')          // Returns DmxFixture by label
u.fixtures                  // Map of all fixtures in this universe

await u.init()              // Opens ArtNet socket
u.send()                    // Flush buffer → Art-Net packet
u.blackout()                // Zero buffer + send
u.setChannel(ch, val)       // Set raw channel (1-512), then send
u.close()                   // Close socket
```

### `DmxFixture` (base class)

A fixture works entirely in **local channel space** — it has no knowledge of where it
sits in a universe. The universe assigns it a buffer and an offset at placement time.

```js
// Base class — not instantiated directly
f.label                     // "bar_1"
f.totalChannels             // 135  (from profile YAML)
f.profile                   // parsed YAML object

// Called by DmxUniverse when placing the fixture:
f._attach(buffer, offset)   // buffer = universe's Buffer(512), offset = 0-indexed start

// All writes go directly into the universe's shared buffer at (offset + ch - 1).
// Nothing is sent until u.send() is called.
f.setChannel(ch, val)       // ch is local (1 = this fixture's first channel)
f.blackout()                // zeros all local channels in the buffer
```

### `EndyshowBar` extends `DmxFixture`

```js
// Loaded automatically from profile "fixtures/endyshow_240w_stage_strobe_led_bar/channels_N.yaml"
// Supports modes: 7 / 13 / 82 / 130 / 135
f.setPixel(n, r, g, b)     // pixel n (1–32), R/G/B per verified channel order
f.setAmber(n, val)          // amber segment n (1–16), 0-255
f.setWhite(n, val)          // white segment n (1–16), 0-255
f.setRgbStrobe(val)         // CH129: 0=off, 10-255=slow→fast
f.setRgbEffect(val)         // CH131: effect pattern select
f.setRgbSpeed(val)          // CH132: effect speed
f.setAcwEffect(val)         // CH134: amber/white pattern select
f.setAcwSpeed(val)          // CH135: amber/white speed
```

### `UkingPar` extends `DmxFixture`

```js
// Supports modes: 6 / 10
f.setRed(val)               // 0-255
f.setGreen(val)             // 0-255
f.setBlue(val)              // 0-255
f.setWhite(val)             // 0-255
f.setAmber(val)             // 0-255 (yellow)
f.setPurple(val)            // 0-255
f.setStrobe(val)            // (10-ch mode only) CH8
f.setFunction(val)          // (10-ch mode only) CH9 — jump/fade/pulse/sound
f.setFunctionSpeed(val)     // (10-ch mode only) CH10
```

---

## Usage Examples

```js
const { DmxHandler } = require('./dmx');

async function main() {
    const handler = new DmxHandler();
    await handler.init();

    const main = handler.universe('main');
    const bar  = main.fixture('bar_1');   // returns EndyshowBar instance

    // Turn pixel 1 red, pixel 2 green — fixture uses local channel coords
    bar.setPixel(1, 255, 0, 0);
    bar.setPixel(2, 0, 255, 0);
    main.send();  // one UDP packet with both writes

    // Animate all 32 pixels blue
    for (let px = 1; px <= 32; px++) {
        bar.setPixel(px, 0, 0, 255);
    }
    main.send();

    // Blackout everything
    await handler.blackoutAll();
    handler.close();
}

main();
```

---

## Art-Net Implementation Notes

### Third-Party Library vs. Custom Implementation

The most-used Node.js Art-Net libraries are [`artnet`](https://www.npmjs.com/package/artnet)
and [`dmxnet`](https://www.npmjs.com/package/dmxnet). The recommendation is to **keep the
custom implementation** for this project, for three reasons:

1. **Already proven** — the prototype scripts exercised the packet builder against a real
   PKnight controller and produced correct output on the physical fixture.
2. **Zero abstraction cost** — third-party libs add their own buffer and event models on
   top of `dgram`. Our direct implementation makes the packet structure completely
   transparent, which is valuable when debugging DMX timing issues on playa.
3. **No dependency risk** — `dmxnet` and `artnet` are lightly maintained packages. Removing
   them as a dependency eliminates a vector for breaking changes.

If sACN (E1.31) support is ever needed, the [`sacn`](https://www.npmjs.com/package/sacn)
package is the exception — it's well-maintained and the protocol is complex enough that a
from-scratch sACN implementation would not be justified.

### Packet Details

The `lib/artnet.js` module implements **Art-Net 4** directly over Node's built-in `dgram`.
Key details:

| Parameter | Value |
|-----------|-------|
| UDP Port | 6454 (0x1936) |
| OpCode | 0x5000 (OpDmx / OpOutput) |
| Protocol Version | 14 (Art-Net 4) |
| Packet length | 18-byte header + 512 DMX bytes (padded to even) |
| Port-address | 15-bit: `(net << 8) \| (subnet << 4) \| universe` |
| Sequence | 1–255 wrapping counter for packet ordering |

The sender accepts both `Buffer` and `number[]` as channel data and always pads to full 512
bytes before sending.

---

## Addressing Rules

- DMX channels are **1-indexed** in all public APIs
- **Fixtures are offset-unaware.** A fixture always numbers its channels from 1, regardless
  of where it is placed in a universe. There is no `startAddress` property on the fixture.
- **The universe assigns the offset.** When a fixture is placed, the universe calls
  `fixture._attach(buffer, offset)` where `offset = dmx_start_address - 1` (0-indexed).
  All subsequent `setChannel(ch, val)` calls from that fixture write to `buffer[offset + ch - 1]`.
- `DmxUniverse.setChannel(ch, val)` accepts **universe-global** channel numbers (1–512)
  and writes directly to `buffer[ch - 1]`.

---

## Buffer Flow

```
# Placement (at init time, by DmxUniverse):
bar_1._attach(universe.buffer, offset=0)    # dmx_start_address 1 → offset 0
bar_2._attach(universe.buffer, offset=135)  # dmx_start_address 136 → offset 135

# At runtime (bar_1 does not know about offset 0 — that's internal):
EndyshowBar.setPixel(1, 255, 0, 0)
  → local ch 1,2,3
  → buffer[0+0]=255, buffer[0+1]=0, buffer[0+2]=0

EndyshowBar.setPixel(1, 255, 0, 0)  ← if this were bar_2:
  → buffer[135+0]=255, buffer[135+1]=0, buffer[135+2]=0

DmxUniverse.send()
  → ArtNetSender.send(universe.buffer)   # entire 512-byte buffer
  → builds Art-Net 4 packet
  → UDP → controller IP:6454
  → controller outputs DMX signal on universe 0 → physical fixtures
```

---

## Fixture Database

| Fixture | Modes | Channels | RGB Pixels | Amber | White |
|---------|-------|----------|------------|-------|-------|
| Endyshow 240W Stage Strobe LED Bar | 7 / 13 / 82 / 130 / 135 | 7–135 | 0 / 0 / 16 / 32 / 32 | 0–16 | 0–16 |
| UKing RGBWAU PAR Light | 6 / 10 | 6–10 | — | — | — |

> Channel profiles are initially OCR'd from vendor manuals, then **calibrated against
> physical hardware**. Runtime-calibrated code overrides vendor manuals where they disagree.
> Known corrections (e.g., Endyshow R,G,B pixel order, white/amber channel swap) are
> documented in `dmx/fixtures/verified_fixture_truths.md` and enforced in the driver classes
> (`EndyshowBar.js`, `UkingPar.js`, `VintageLed.js`).

---

## Extension Points

| Extension | Approach |
|-----------|----------|
| **sACN (E1.31) support** | Use the `sacn` npm package; universe config gains a `protocol: artnet\|sacn` field |
| **Refresh loop** | `DmxUniverse.startRefresh(fps)` — sends buffer at fixed rate (44fps = standard DMX refresh). Required for fixtures that time out without data. |
| **Scene system** | A `Scene` class holds a snapshot of multiple universe buffers; `handler.applyScene(scene)` hydrates all buffers and sends |
| **ArtPoll discovery** | `handler.discover()` wraps `artPollDiscover()` to auto-populate controller IPs. Already implemented in `lib/artnet.js`. |
| **New fixture type** | Subclass `DmxFixture`, add mode-specific methods, drop profile YAML in `fixtures/`, register the class in `DmxHandler`'s fixture factory |
| **Additional fixture modes** | Drop a new `channels_N.yaml` in the fixture folder; reference it in `universes.yaml` via `profile:` |

---

## Rendering Engine Interface

### Philosophy

`DmxHandler` is a **dumb output layer** — it owns sockets and buffers, but has no opinion
about what data goes into them. The rendering problem (what color should pixel N be at time
T?) is fully delegated to an external **rendering engine** that is given a reference to the
handler and drives it at its own frame rate.

This separation means:
- The DMX wiring and fixture layout change independently of the pattern logic
- Any engine that can produce RGB values per pixel can drive the system
- Multiple engines can coexist (one per universe, or swapped at runtime)

### `DmxRenderLoop` — The Timing Driver

A `DmxRenderLoop` class lives in `lib/DmxRenderLoop.js`. It wraps `DmxHandler` and provides
the frame-rate clock that calls into a rendering engine each tick.

```js
loop.start(fps, engineCallback)
loop.stop()
loop.setFps(fps)     // hot-swap frame rate without stopping
```

The `engineCallback` is called once per frame with a context object:

```js
loop.start(40, ({ handler, elapsed, frame }) => {
    // elapsed = seconds since start (float)
    // frame   = frame number
    // handler = DmxHandler — call fixture methods, then send()

    const bar = handler.universe('main').fixture('bar_1');
    bar.setPixel(1, 255, 0, 0);
    handler.universe('main').send();
});
```

The loop calls `send()` only when the engine explicitly does so, giving engines full control
over when to flush (e.g., batch multiple fixture writes into a single UDP packet).

---

### Built-in Engine: MarsinLED

The primary rendering engine for this system is **MarsinLED** — the same scripting
language used in the Three.js simulation. Patterns are written once and run identically
in simulation and on physical hardware.

#### MarsinLED Architecture

```
simulation/lib/marsin-engine/
  ├── marsin-engine.js    # Emscripten WASM module loader
  └── marsin-engine.wasm  # Compiled MarsinScript VM (C++ → WASM)

simulation/pb/
  ├── rainbow.js          # MarsinScript pattern source
  ├── fire.js
  └── ...
```

The `MarsinEngine` class (in `simulation/MarsinEngine.js`) wraps the WASM binary:

| Method | Description |
|--------|-------------|
| `engine.init(wasmDir)` | Load and initialize the WASM module |
| `engine.compile(source)` | Compile a MarsinScript pattern string; returns `true` on success |
| `engine.beginFrame(t)` | Advance the pattern clock to time `t` (seconds). Runs `beforeRender(delta)`. Must be called once per frame. |
| `engine.renderPixel(i, x, y, z)` | Render a single pixel at index `i`, spatial coords `x/y/z` (0–1). Returns `{r, g, b}`. |
| `engine.renderAll(n, coords)` | Batch-render all `n` pixels. `coords` is a `Float32Array` of `[x,y,z]` triples. Returns a `Uint8Array` of RGB bytes. Preferred over per-pixel calls for performance. |
| `engine.destroy()` | Clean up the WASM VM instance |

#### MarsinLED Render Loop

```js
const { DmxHandler, DmxRenderLoop } = require('./dmx');
const { MarsinEngine } = require('../simulation/MarsinEngine');
const fs = require('fs');

async function main() {
    const handler = new DmxHandler();
    await handler.init();

    const engine = new MarsinEngine();
    await engine.init('../simulation/lib/marsin-engine');

    const source = fs.readFileSync('../simulation/pb/rainbow.js', 'utf8');
    engine.compile(source);

    const bar = handler.universe('main').fixture('bar_1');
    const pixelCount = bar.totalChannels / 3;   // 32 for EndyshowBar 135-ch mode

    // Optional: build spatial coordinate buffer (x maps linearly across the bar)
    const coords = new Float32Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
        coords[i * 3 + 0] = i / (pixelCount - 1);  // x: 0 → 1
        coords[i * 3 + 1] = 0.5;                    // y: center
        coords[i * 3 + 2] = 0;                      // z: flat
    }

    const loop = new DmxRenderLoop(handler);
    loop.start(40, ({ elapsed }) => {
        engine.beginFrame(elapsed);
        const rgb = engine.renderAll(pixelCount, coords);  // Uint8Array

        for (let px = 0; px < pixelCount; px++) {
            bar.setPixel(px + 1, rgb[px*3], rgb[px*3+1], rgb[px*3+2]);
        }
        // Amber/White channels can be derived from RGB luminance — see archived marsin_play.js
        handler.universe('main').send();
    });

    process.on('SIGINT', () => { loop.stop(); handler.blackoutAll(); handler.close(); });
}
```

Key design note: `engine.renderAll()` is preferred over per-pixel `renderPixel()` calls.
The WASM batch path removes the JS-to-WASM call overhead for each pixel and is significantly
faster at 30+ fps with 32+ pixels.

#### Pattern Library

Patterns live in `simulation/pb/` as `.js` files written in MarsinScript syntax. They are
shared between the simulation and the physical DMX output — a pattern tested in the browser
runs unchanged on hardware.

```
simulation/pb/
├── rainbow.js       # HSV sweep across positions
├── fire.js          # Perlin noise fire effect
├── plasma.js        # 2D plasma waves
├── breathing.js     # Slow sine-pulse glow
└── ...
```

---

### External Engine Contract

Any rendering engine — Python process, OSC listener, Chromatik bridge,
game-engine output, etc. — can drive `DmxHandler` by satisfying a simple contract:

> **The engine must, on each frame:**
> 1. Write pixel/channel values into fixtures via the handler's fixture API
> 2. Call `universe.send()` on each modified universe to flush the buffer
>
> Everything else (socket management, channel layout, offset arithmetic) is the handler's problem.

#### Integration Patterns

| Engine Type | Integration Approach |
|-------------|---------------------|
| **MarsinLED (Node.js)** | Direct in-process: `DmxRenderLoop` + `MarsinEngine` as shown above |
| **Python process** | UDP socket bridge: Python renders pixels, sends raw 512-byte DMX buffer to a small JS shim that calls `universe.writeRaw(buf); universe.send()` |
| **Chromatik / sACN pipeline** | Chromatik outputs sACN (E1.31); a sACN receiver feeds raw universe buffers directly into `DmxUniverse.writeRaw(buf)` — the handler just re-emits as Art-Net |
| **OSC controller** | An OSC listener maps incoming OSC addresses to fixture method calls |
| **External clock / timecode** | Any engine that can callback at a fixed interval can use `DmxRenderLoop` with a custom `engineCallback` |

#### `DmxUniverse.writeRaw(buffer)` 

For engines that produce a raw 512-byte DMX universe buffer (e.g., sACN receivers, external
processes), the universe exposes a bypass path that skips the fixture layer entirely:

```js
u.writeRaw(buf512);   // Bulk-copy 512 bytes into the universe buffer
u.send();             // Flush to Art-Net node
```

This is the zero-overhead path for high-throughput engines that do their own channel mapping.

> [!NOTE]
> The MarsinLED engine is the **primary and recommended** engine for this system. Its output
> is identical to the simulation, patterns are reusable, and the WASM runtime is already
> compiled and integrated. External engine support exists as an escape hatch for special
> scenarios — Chromatik-driven video mapping, Python ML color generation, live OSC input
> from a hardware controller, etc.

