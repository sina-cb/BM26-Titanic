# 💡 DMX — Universe & Fixture System

Art-Net DMX output layer for the BM26 Titanic lighting system. Translates high-level lighting intent into Art-Net UDP packets sent to physical DMX controllers.

> **Calibration policy:** Runtime-calibrated driver code overrides vendor manuals where they disagree. If a fixture's physical behavior differs from its manual, the driver class (e.g., `EndyshowBar.js`) is the authoritative source. Known corrections are documented in-code with `⚠ VERIFIED` comments.

---

## Quick Start

```bash
cd dmx
npm install

# Run the color sequence test
node test/testbench_helloworld.js

# Run calibration test (static red)
node test/test_calibration.js --red_static

# Animated rainbow
node test/test_calibration.js --fps 60 --speed 1.5
```

All test scripts exit cleanly with **Ctrl+C** → blackout → shutdown.

---

## Directory Structure

```
dmx/
├── README.md                   ← you are here
├── index.js                    ← entry point, re-exports all public classes
├── package.json
├── universes.yaml              ← DMX topology: universes, controllers, fixtures
│
├── lib/                        ← core library
│   ├── artnet.js               ← Art-Net 4 UDP sender (raw dgram)
│   ├── DmxFixture.js           ← base fixture class (profile loader, buffer writes)
│   ├── DmxUniverse.js          ← 512-byte buffer + ArtNetSender + fixture list
│   ├── DmxHandler.js           ← top-level: loads universes.yaml, owns all universes
│   ├── DmxRenderLoop.js        ← fixed-fps timing driver for render engines
│   └── fixtures/
│       ├── EndyshowBar.js      ← 240W LED bar (7/13/82/130/135ch modes)
│       ├── UkingPar.js         ← RGBWAU PAR light (6/10ch modes)
│       └── VintageLed.js       ← 6-head retro stage light (15/33ch modes)
│
├── fixtures/                   ← fixture profiles (channel layouts + models)
│   ├── endyshow_240w_stage_strobe_led_bar/
│   │   ├── channels_135.yaml   ← DMX channel definitions (135ch mode)
│   │   ├── model_135.yaml      ← pixel model for Fixture Designer (planned)
│   │   └── manual/             ← OCR'd vendor manual pages
│   ├── uking_rgbwau_par_light/
│   │   ├── channels_10.yaml
│   │   └── manual/
│   └── vintage_led_stage_light/
│       ├── channels_33.yaml
│       ├── channels_15.yaml
│       └── manual/
│
└── test/                       ← test scripts (run on physical hardware)
    ├── testbench_helloworld.js ← color sequence: RED→GREEN→BLUE→WHITE→AMBER→PURPLE
    └── test_calibration.js     ← static colors + rainbow for channel verification
```

---

## Library API

### `DmxHandler` — Top-Level Controller

```js
const { DmxHandler } = require('./dmx');

const handler = new DmxHandler();
await handler.init();                  // opens all Art-Net sockets

const universe = handler.universe('test_bench');
const bar = universe.fixture('wash_1');

bar.setPixel(1, 255, 0, 0);           // pixel 1 → red
universe.send();                       // flush → Art-Net UDP packet

await handler.blackoutAll();           // zero all universes
handler.close();                       // close sockets
```

### `DmxRenderLoop` — Frame-Rate Driver

```js
const { DmxHandler, DmxRenderLoop } = require('./dmx');

const handler = new DmxHandler();
await handler.init();

const loop = new DmxRenderLoop(handler);
loop.start(40, ({ handler, elapsed, frame }) => {
    const bar = handler.universe('test_bench').fixture('wash_1');
    bar.fillPixels(255, 0, 0);
    handler.universe('test_bench').send();
});

// Hot-swap frame rate without stopping
loop.setFps(60);

// Stop
loop.stop();
```

### Fixture Drivers

Each fixture type has a driver class with high-level methods. All writes go into a shared 512-byte universe buffer — nothing is sent until `universe.send()` is called.

#### EndyshowBar (240W LED Bar)

```js
bar.setPixel(n, r, g, b)     // RGB pixel n (1–32)
bar.fillPixels(r, g, b)      // all 32 RGB pixels
bar.setAmber(n, val)          // amber segment n (1–16)
bar.fillAmber(val)            // all amber segments
bar.setWhite(n, val)          // white segment n (1–16)
bar.fillWhite(val)            // all white segments
bar.setRgbStrobe(val)         // CH129: 0=off, 10-255=slow→fast
bar.setRgbEffect(val)         // CH131: effect select
bar.setAcwEffect(val)         // CH134: amber/white effect
```

#### UkingPar (RGBWAU PAR Light)

```js
par.setDimmer(val)            // master dimmer (10ch mode)
par.setColor(r, g, b, w, a, p)  // all 6 channels at once
par.setRed(val)               // individual color channels
par.setGreen(val)
par.setBlue(val)
par.setWhite(val)
par.setAmber(val)
par.setPurple(val)
par.setStrobe(val)            // CH8 (10ch mode)
par.setFunction(val)          // CH9: manual/jump/fade/pulse/sound
```

#### VintageLed (6-Head Stage Light)

```js
v.setDimmer(val)              // master dimmer
v.setStrobe(val)              // master strobe
v.setWarm(head, val)          // warm channel for head 1–6
v.fillWarm(val)               // all 6 warm heads
v.setAuxRgb(r, g, b)         // global auxiliary RGB (CH9–11)
v.setHeadAuxRgb(head, r,g,b) // per-head aux RGB (33ch mode, CH16–33)
v.fillHeadAuxRgb(r, g, b)    // all 6 heads aux RGB
```

---

## Fixture Profiles

Each fixture type has a `channels_N.yaml` defining its DMX channel layout for a specific mode. These files live in `fixtures/<fixture_type>/` alongside the vendor manual.

### Current Fixtures

| Fixture | Modes | Primary | RGB Pixels | Extra Channels |
|:---|:---|:---|:---|:---|
| Endyshow 240W Bar | 7/13/82/130/135 | 135ch | 32 | 16 amber + 16 white + 7 control |
| UKing RGBWAU PAR | 6/10 | 10ch | — | 6 color (RGBWAU) + 4 control |
| Vintage LED Stage | 15/33 | 33ch | — | 6 warm heads + 6 aux RGB heads + 6 control |

### Known Manual-vs-Hardware Corrections

| Fixture | Issue | Correction |
|:---|:---|:---|
| Endyshow Bar | Manual says pixel order R,B,G | Verified **R,G,B** — see `EndyshowBar.js` L66 |
| Endyshow Bar | Manual says CH97–112=Amber, CH113–128=White | Verified **CH97–112=White, CH113–128=Amber** — see `EndyshowBar.js` L55–60 |

---

## Tests

### `testbench_helloworld.js` — Color Sequence

Cycles through 6 colors with smooth crossfades: RED → GREEN → BLUE → WHITE → AMBER → PURPLE. Each fixture type handles colors according to its capabilities (e.g., the Endyshow bar has no purple channel, Vintage LEDs approximate purple via R+B).

```bash
node test/testbench_helloworld.js
node test/testbench_helloworld.js --hold 3 --fade 1
```

### `test_calibration.js` — Channel Calibration

Static color modes for verifying individual channel wiring, plus an animated rainbow.

```bash
node test/test_calibration.js --red_static     # solid red, all fixtures
node test/test_calibration.js --green_static
node test/test_calibration.js --blue_static
node test/test_calibration.js --white_static
node test/test_calibration.js                   # animated rainbow (default)
node test/test_calibration.js --fps 60 --speed 2
```

Both scripts automatically disable strobes and built-in effects before testing to ensure clean output.

---

## Universes Configuration

`universes.yaml` is the single source of truth for the physical DMX topology:

```yaml
universes:
  - id: "test_bench"
    controller:
      ip: "10.1.1.101"
      port: 6454
      universe: 0
    fixtures:
      - label: "wash_1"
        type: "EndyshowBar"
        dmx_start_address: 1
        config:
          layout: "fixtures/endyshow_240w_stage_strobe_led_bar/channels_135.yaml"
```

- `dmx_start_address` is 1-indexed (DMX convention)
- Fixtures must not overlap in the 512-channel universe
- Controller IPs must be reachable on the local network

---

## Fixture Designer (Planned)

> See `docs/09_dmx_fixture_models.md` for the full design specification.

The Fixture Designer is a browser-based 3D editor for creating pixel-mapped fixture models. It addresses the gap between DMX channel definitions (what you can control) and physical pixel geometry (where the lights are in space).

### What It Does
- **Design pixel layouts** — place visual dots in 3D space, group them into DMX pixels, assign channel bindings
- **Visual dots vs DMX pixels** — a PAR light has ~18 visible LEDs but 1 DMX pixel; a LED bar has 32 individually-addressable RGB pixels
- **Fixture-aware DMX testing** — built-in test panel with static colors, chase, pixel identify (not raw channel blasts)
- **Live DMX preview** — see incoming Art-Net data rendered onto the model in real-time

### Model Files

Models will live alongside channel profiles as `model_N.yaml`:

```
fixtures/
  endyshow_240w_stage_strobe_led_bar/
    channels_135.yaml     ← what channels do (existing)
    model_135.yaml        ← where pixels are in space (planned)
```

---

## Rendering Engines

The DMX handler is a **dumb output layer** — any engine that can produce pixel/channel values can drive it. The primary engine is MarsinLED (WASM-compiled pattern VM), but the handler also supports raw buffer writes for external engines.

See `docs/08_dmx_controller.md` for the full rendering engine architecture.
