# 12 — MarsinEngine: Headless API Output Server

## 1. Overview

MarsinEngine is the core standalone WebAssembly-powered API server for the BM26 Titanic lighting system. Unlike the browser simulation, the Engine runs a headless HTTP/WebSocket daemon that executes Pixelblaze-compatible patterns at high speeds against the DMX pixel model, mapping RGBWA values to universes, and transmitting sACN (E1.31) dynamically.

CaptainPad (iPad) binds strictly to the MarsinEngine to control live pattern states and inject dynamic UI parameter telemetry.

**Design Philosophy:**
- **Persistent Server Architecture.** Booting the engine daemon spins up port 6968, allowing dynamic script recompilation and pattern swaps without process restarts.
- **Rendering efficiency first.** Pattern rendering runs fully in the CPU.
- **Deterministic patching.** The pixel model embeds auto-packed DMX patch info (universe/addr/footprint). Both the engine and the simulation consume the same patch layout.
- **Pattern portability.** Patterns run identically in the simulation browser and the engine backend.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    MarsinEngine API Server                    │
│                        (Port 6968)                            │
│                                                               │
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

## 7. API Reference (Port 6968)

### HTTP Endpoints

- **`GET /patterns`**
  - Returns a JSON array of all available `.js` patterns in the repository.
- **`GET /exports`**
  - Outputs the current WASM JSON ABI definitions mapping UI controls (ExportKinds like TOGGLE, HSV) directly back to the active pattern.
- **`PUT /pattern`**
  - **Body:** `{ "pattern": "name_without_js" }`
  - Immediately signals the engine loop to switch, triggering a hot WASM recompilation of the newly requested file via the internal fileloader.

### WebSocket Connections (`ws://localhost:6968/`)

The core bidirectional event channel for controllers.

**Events In (To Server):**
- `{ "type": "setControl", "id": <num>, "v0": <float>, "v1": <float>, "v2": <float> }`
  - Pushes a zero-latency memory alteration directly onto the active WASM parameter controls.

**Events Out (To Client):**
- `{ "type": "stats", "fps": 40, "patched": 323 }`
  - Telemetry streamed regularly back to `CaptainPad` to indicate system network health.

---

## 7a. CaptainPad and PortWatch Integration

CaptainPad (iPad, Wi-Fi) and PortWatch (iPhone/iPad, LoRa via BLE) are
the two operator surfaces that drive MarsinEngine. They use disjoint
transports but a *shared* event surface — every write produces a
broadcast that both UIs follow, so changes from one are reflected on
the other within a frame.

### 7a.1 Transports

| Surface       | Transport                                  | Writes                           | Reads                                                                |
| ------------- | ------------------------------------------ | -------------------------------- | -------------------------------------------------------------------- |
| CaptainPad    | Wi-Fi → HTTP REST + WebSocket on port 6968 | HTTP POSTs (and WS `setControl`/`setSharedParam`) | WebSocket: `mixer`, `sharedParams`, `autopilot`, `viewOverride`, `pattern`, `playlistLibrary`, `playlistSaved`, `vis` |
| PortWatch     | BLE → captain Heltec → LoRa → server Heltec → USB → Pi bridge → HTTP REST | Bridge translates `cmd …` frames to engine REST calls (see `control_podium/comms/bridge.py::_exec_cmd`) | Bridge subscribes to engine WS internally and publishes compact `pub` frames + on-demand `rep` responses to PortWatch |

The bridge is **the only path** from LoRa to the engine, and is a
direct mirror of the REST surface — see `docs/21_portwatch_monitor.md`
§7 for the design rule. Adding a command means adding an entry to
`control_podium/.config.commands.yaml`, a handler in `Bridge._exec_cmd`,
and a builder in `PortWatch/src/frame/ops.ts`.

### 7a.2 The broadcast contract

Every state-mutating endpoint broadcasts so all clients converge:

| Endpoint                              | Broadcast(s) emitted                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `POST /set-pattern`                   | `pattern`, `mixer`                                                |
| `POST /param-center`                  | `sharedParams` (full canonical doc; see `param_center.getCanonicalState()`) |
| `POST /control`                       | `mixer` (channel.exports include live `v0/v1/v2`)                 |
| `POST /mixer/channels/<id>/control`   | `mixer`                                                           |
| `POST /global-blackout`               | `mixer` (carries `blackout: globalsState.blackout`)               |
| `POST /global-effect`                 | `mixer`                                                           |
| `POST /autopilot`                     | `autopilot`                                                       |
| `POST /mixer/view-override`           | `viewOverride` (also carries `controlLock` — see §7a.4)            |
| `POST /deck/playlist`                 | `pattern`, `mixer`                                                |
| `POST /playlists` / `DELETE /playlists/<n>` | `playlistLibrary`, `playlistSaved` / `playlistDeleted`     |

Both UIs treat the broadcast as authoritative — UI-side optimistic
state lasts only until the next broadcast reconciles it (see
PortWatch's `intent` reducer and CaptainPad's `useEngineState` hook).

### 7a.3 The CaptainPad sync hook

CaptainPad's `hooks/useEngineState.ts` is the single subscription
point. It:

1. Subscribes once at module load to the `engineEvents` bus (which the
   deck and mixer tabs both feed from their per-tab WS handlers).
2. Seeds itself from `GET /param-center` and `GET /mixer` on first read
   so first paint is correct on a cold boot.
3. Exposes typed selectors: `useSharedParamValues()`,
   `useChannelExports()`, `useEngineState()`, plus the dedicated
   `useEngineLock()` for the deck override.

The hook replaced an earlier per-component pattern where every
consumer bound `wsRef.current.addEventListener('message', …)` in its
own `useEffect`. That had two failure modes the engine could not fix:
the listener never bound when `wsRef.current` was null at mount, and
it stayed bound to a dead WebSocket after the auto-reconnect loop
replaced the instance. After centralisation, adding a new live-state
surface is "call the hook and render"; no WS bookkeeping anywhere
downstream.

### 7a.4 The deck override (`controlLock`) and its lease

A single global on the engine — `globalsState.controlLock` — coordinates
which surface owns the deck:

- `null` — anyone can write; both UIs are interactive.
- `"portwatch"` — PortWatch holds the deck; CaptainPad raises a
  full-screen overlay (`EngineLockoutOverlay`) and refuses writes.

Today, the only way to set the lock is `POST /mixer/view-override
{override: "deck"}`. The handler calls `syncControlLockToGlobals()`
(writes `globalsState.controlLock` and persists) **and arms a 30 s
lease timer**. The matching `viewOverride` broadcast carries the
new `controlLock` value plus `controlLockLeaseExpiresAtMs` and
`controlLockLeaseDurationMs` so CaptainPad / PortWatch can render the
countdown without subscribing to a second event.

The lock is a **lease, not a permanent take**. Every successful
view-override POST restarts the 30 s timer. If nobody renews,
`setTimeout` fires, the engine clears the override using the same
code path as a manual `view/clear`, and broadcasts the normal
`viewOverride` event — CaptainPad's overlay falls away identically
to a release. This protects against a holder walking out of range,
crashing, or losing radio.

The expected renew cadence is ~20 s (PortWatch's `LEASE_RENEW_INTERVAL_MS`).
PortWatch sends `cmd view/renew` for the silent path; the bridge
translates `view/renew` to the same POST as `view/deck`. The verb
split is cosmetic — logs read `RENEW` not `TAKE LOCK` 12 times an
hour.

On boot, if the engine restores `controlLock === 'portwatch'` from
disk, `armControlLockLease()` runs at hydration time so the inherited
lock can't outlive the engine restart by more than one full lease.

Implemented entirely as a CPC global parameter — see
`docs/15_central_param_center_cpc.md` §15. Adding the next operator
lock (e.g. "mixer-only mode") follows exactly the same template with
zero new transport work.

### 7a.5 Connect-time hydration

When a PortWatch (or any new LoRa client) comes online, the bridge
sends a fresh `compact_status` PUB immediately on receiving `hlo`
(rather than waiting up to `long_interval_s` for the next periodic
poll). The PUB carries the lock owner (`lk`), lease remaining
seconds (`lku`), active deck playlist (`pl`), pattern, brightness,
blackout, autopilot, view — everything PortWatch needs to render its
DECK card with real state before the operator touches anything.

PortWatch's `App.tsx::onConnect` also fires a small qry burst
(`engine/status`, `deck/playlist`, `playlists/p/0`,
`engine/playlist-patterns/p/0`, `params`, `exports/p/0`) so the
PARAMS and pattern picker hydrate concurrently. The contract is that
by the time the DECK card is fully rendered, the operator is looking
at engine ground truth — TAKE LOCK / RELEASE / DECK ACTIVE shows up
correctly without a guess-and-correct flash.

### 7a.6 Where to look

- Engine: `marsin_engine/lib/api_server.js` — every broadcast in this
  file is a candidate for both UIs to mirror. The lease + arm/disarm
  helpers live alongside `broadcastViewOverride()`.
- CaptainPad: `CaptainPad/hooks/useEngineState.ts`,
  `CaptainPad/hooks/useEngineLock.ts`,
  `CaptainPad/utils/engineEvents.ts`.
- PortWatch: `control_podium/PortWatch/src/state/store.ts`,
  `control_podium/PortWatch/src/frame/ops.ts`,
  `control_podium/PortWatch/src/status/parse.ts`,
  `control_podium/PortWatch/src/ui/DeckScreen.tsx` (renew loop).
- Bridge: `control_podium/comms/bridge.py::_exec_cmd` /
  `::_exec_qry`, `control_podium/.config.commands.yaml`,
  `control_podium/comms/engine_client.py::compact_status` (the
  `lk` / `lku` / `pl` fields).
- Tests: `control_podium/tests/test_comms_e2e_sim.py` covers
  the full lock + lease + connect-time-hydration surface.

---

## 8. Server Interface

```bash
# Basic usage (boots server on 6968 default)
node engine.js --model titanic

# With custom options
node engine.js --model test_bench --fps 60 --priority 100
```

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | (required) | Model file to load and target for patched mapping |
| `--fps` | 40 | Target render framerate |
| `--priority` | 100 | sACN source priority |
| `--port` | 6968 | HTTP + WebSocket API access port |
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
