# 🎯 Kick-Off Party — Test Deployment Readiness

**Gap Analysis Report** · April 16, 2026  
**Goal:** Run a simple lighting show using MarsinEngine → sACN → Simulation → sACN → Physical Controllers

---

## Executive Summary

The core pipeline pieces **exist** but have integration gaps. The heaviest missing piece is the **Pattern Selection UI** (no web UI exists — engine is CLI-only today) and the **Multi-Scene Architecture** (simulation is hardcoded to one `scene_config.yaml`). The sACN plumbing is functional end-to-end for the existing Titanic scene; what's missing is mostly configuration, wiring, and operational tooling.

**Estimated total effort to show-ready:** ~3–4 focused days

---

## System Architecture (Current State)

```
┌─────────────────────┐       sACN (E1.31)       ┌────────────────────┐
│  MarsinEngine CLI   │ ────────────────────────► │ sacn_bridge.js     │
│  (Node.js, WASM VM) │       UDP unicast         │ (port 6971)        │
│  patterns/*.js      │       127.0.0.1           │ sACN → WS frames   │
│  models/model.js    │                           └────────┬───────────┘
└─────────────────────┘                                    │ WebSocket
                                                           ▼
                                                   ┌───────────────────┐
                                                   │ Browser Simulation │
                                                   │ SacnInputSource    │
                                                   │ UniverseRouter     │
                                                   │ animate.js         │
                                                   │ (3D visualization) │
                                                   └────────┬──────────┘
                                                            │ WebSocket
                                                            ▼
                                                   ┌───────────────────┐
                                                   │sacn_output_bridge  │
                                                   │(port 6972)         │
                                                   │ WS → sACN unicast  │
                                                   └────────┬──────────┘
                                                            │ sACN
                                                   ┌────────▼──────────┐
                                                   │Physical Controllers│
                                                   │(MarsinLED, etc.)   │
                                                   └───────────────────┘
```

---

## Gap Analysis by Workstream

### 1. 🎨 Pattern Selection UI

> **MISSING — This is the #1 blocker**

| Aspect | Status |
|--------|--------|
| Available patterns | ✅ 10 patterns in `marsin_engine/patterns/` |
| Engine CLI `--pattern` flag | ✅ Working |
| Engine CLI `--list` flag | ✅ Working |
| **Web UI for pattern selection** | ❌ **Does not exist** |
| **Live pattern switching** | ❌ Engine must be killed and restarted |
| **Pattern preview** | ❌ No preview without running sACN |

#### What's Needed

**Option A — Minimal CLI Wrapper (Fastest, 0.5 day)**
- A simple script that lists patterns and lets you pick one via keyboard
- Restarts the engine process when you switch
- Good enough for a test deployment

**Option B — Simple Web UI (1–1.5 days)**
- Lightweight Node.js Express server with a single HTML page
- Pattern dropdown populated from `patterns/*.js` directory scan
- Start / Stop / Switch buttons that spawn/kill `engine.js` child processes
- Real-time FPS/status display
- Could also expose basic controls (FPS slider, priority)
- This is the proper path for show readiness

**Option C — Integrate into Simulation UI (2+ days)**
- Add pattern controls to the existing simulation browser UI
- Would require the simulation's pattern editor to drive the MarsinEngine
- More complex, better long-term but not needed for kick-off

> **Recommendation:** Go with **Option B**. It's clean, standalone, and re-usable. The CLI engine stays untouched. The web UI is just a supervisor.

---

### 2. 📡 sACN: Engine → Simulation (Input Path)

| Component | Status | Notes |
|-----------|--------|-------|
| MarsinEngine sACN sender | ✅ Working | `lib/sacn_output.js`, unicast to 127.0.0.1 |
| sacn_bridge.js (sACN → WS) | ✅ Working | Listens on sACN universes, forwards to browser |
| SacnInputSource (browser) | ✅ Working | Receives WS frames, feeds to UniverseRouter |
| UniverseRouter | ✅ Working | Priority-based merge, source_lock and per_patch modes |
| animate.js sACN Direct Apply | ✅ Working | Reads DMX from router, applies to fixtures (legacy path) |
| **sacn_bridge auto-start** | ⚠️ Conditional | Only starts if `colorWave.sacn_enabled: true` in scene config |
| **Universe count mismatch** | ⚠️ Risk | Bridge defaults to `[1,2,3,4]`, model uses universes `[1,2,3]` — 3 universes active |
| **Lighting mode must be `sacn_in`** | ⚠️ Manual | Must switch mode in UI dropdown or set in config |

#### What's Needed

- **Verify `sacn_enabled: true`** in `scene_config.yaml` under the `colorWave` section — it IS currently `true` ✅
- **Set `lightingMode` to `sacn_in`** in scene config (currently `pixelblaze`) — simple config change
- **Test end-to-end** with `node engine.js --pattern rainbow` and verify simulation responds
- No code changes needed, just configuration + verification

---

### 3. 📤 sACN: Simulation → Physical Controllers (Output Path)

| Component | Status | Notes |
|-----------|--------|-------|
| SacnOutputClient (browser) | ✅ Working | Sends 519-byte binary frames to bridge via WS |
| sacn_output_bridge.js | ✅ Working | WS → sACN unicast, auto-start on `node start.js` |
| **Controller IP assignment** | ❌ **Not configured** | Each fixture needs `controllerIp` set in scene_config |
| **New scene controller mapping** | ❌ **Missing** | Need to map universe:ip pairs for your actual controllers |
| **Network routing** | ⚠️ Untested | Need controllers on reachable IP addresses |

#### What's Needed

1. **Assign controller IPs** in `scene_config.yaml` for each fixture (the `controllerIp` field)
2. **Verify network topology** — simulation machine must be able to reach controller IPs over sACN (port 5568 UDP)
3. **Test with one controller first** — `node engine.js --pattern rainbow --dest 10.1.1.x` bypasses the simulation entirely for direct testing
4. For the **simulation output path**, the output loop in `animate.js` (lines 344-377) groups fixtures by `universe:controllerIp` and sends the full universe frame — this works but requires `controllerIp` to be set on at least one fixture per universe

> **Direct Engine → Controller path exists!** You can skip the simulation entirely for the show:
> ```bash
> node engine.js --pattern bioluminescence --dest 10.1.1.102
> ```
> This sends sACN directly from the engine to the controller. The simulation is only needed for visualization.

---

### 4. 🗺️ Model & Patch Synchronization

| Component | Status | Notes |
|-----------|--------|-------|
| `model.js` export from simulation | ✅ Working | 291 pixels, 3 universes, auto-generated |
| Model ↔ scene_config alignment | ✅ Aligned | model.js matches scene_config fixture order |
| **Sequential auto-pack in model.js** | ⚠️ Divergent | Model uses sequential 10ch packing (addr 1,11,21...) but scene_config has custom addresses (1,120,239,358...) |
| **Model re-export for new scene** | ❌ **Not automated** | Must manually re-export when scene changes |

#### The Auto-Pack Divergence Problem

The `model.js` (used by MarsinEngine) uses **sequential auto-pack** addressing:
```
pixel 0: U1:1, pixel 1: U1:11, pixel 2: U1:21, ...
```

But the `scene_config.yaml` has **custom** DMX addresses:
```
Right Front Wall Generator 1: U1:1
Right Front Wall Generator 2: U1:120
Right Front Wall Generator 3: U1:239
```

This means **the engine's sACN output addresses may not match what the simulation expects when individual fixtures have custom patches**. The `sACN Direct Apply` path in `animate.js` also uses sequential auto-packing, so it works with the engine — but if you send directly to physical controllers, the addresses won't align with what's physically patched.

#### What's Needed

- **For test deployment**: This is fine as-is if the simulation is the consumer (both use auto-pack)
- **For physical controllers**: Either re-patch the controllers to match auto-pack, OR update the model export to emit the actual scene_config addresses
- **For new scene**: New model.js must be generated from the new scene

---

### 5. 🎭 Multi-Scene Architecture (New Environment)

> **MISSING — The simulation is hardcoded to one scene config**

This is the big architectural question. Currently:

- `simulation/config/scene_config.yaml` is the **sole** config file — hardcoded path in `main.js` line 177
- `start.js` reads from `config/server_config.yaml` — fixed path
- `sacn_bridge.js` reads from `config/scene_config.yaml` — fixed path
- The 3D model path (`models/titanic.fbx`) is embedded in `scene_config.yaml`

#### Proposed Multi-Scene Architecture

```
simulation/
├── config/
│   ├── server_config.yaml          # Shared server ports (unchanged)
│   ├── scene_preset_cameras.yaml   # Per-scene (move into scene dir)
│   └── scenes/                     # NEW: Scene library
│       ├── titanic/                # Existing scene (migrate)
│       │   ├── scene_config.yaml   # Current scene_config.yaml (copied)
│       │   └── cameras.yaml        # Camera presets for this scene
│       └── kick_off_party/         # NEW: Your new scene
│           ├── scene_config.yaml   # Different fixtures, different layout
│           └── cameras.yaml        # Camera presets for this scene
├── main.js                         # Modified: reads ?scene=kick_off_party from URL
└── start.js                        # Modified: sacn_bridge reads active scene
```

#### Implementation Steps (Zero Breakage Strategy)

**Phase 1: Create scene directory structure (0 risk)**
1. Create `config/scenes/titanic/` directory
2. **Copy** (not move) `scene_config.yaml` into it — the original stays untouched
3. Create `config/scenes/kick_off_party/scene_config.yaml` with your new fixtures

**Phase 2: Add scene selector to main.js (low risk)**
1. Read `?scene=<name>` from the URL query string
2. Default to current behavior (root `scene_config.yaml`) when no param
3. If `?scene=kick_off_party` → fetch `config/scenes/kick_off_party/scene_config.yaml`
4. All downstream code is untouched — `extractParams()` works on any valid YAML tree

```javascript
// main.js bootstrap — proposed change (3 lines)
const urlParams = new URLSearchParams(window.location.search);
const sceneName = urlParams.get('scene');
const configPath = sceneName
  ? `config/scenes/${sceneName}/scene_config.yaml`
  : 'config/scene_config.yaml';   // ← fallback = existing behavior, zero breakage
```

**Phase 3: Create new scene config**
- Start with a minimal `scene_config.yaml` for the kick-off party
- Define only the fixtures you have available for this event
- Map fixture types to the actual hardware (ShehdsBar, UkingPar, VintageLed)
- Set proper `controllerIp` and `dmxAddress` values
- Optionally skip the Titanic 3D model (use a simple ground plane)

**Phase 4: Update sacn_bridge.js for scene routing**
- Pass `--scene <name>` argument or read from server_config
- Or: leave sacn_bridge reading the default config (it only needs universe IDs)

**Phase 5: Update engine model.js per scene**
- The MarsinEngine also needs a model.js matching the new scene
- Add `--model` flag to engine OR separate model files per scene:
  ```
  marsin_engine/models/
  ├── model.js              # Default (current Titanic)
  └── kick_off_party.js     # New scene model
  ```

#### New Scene Config Template

```yaml
# config/scenes/kick_off_party/scene_config.yaml
# Minimal scene for kick-off party test deployment

titanicEnd:
  _section:
    label: 🧊 The End
    type: icebergArray
    collapsed: true
  icebergsEnabled:
    value: false
  icebergs: []

atmosphere:
  _section:
    label: 🌌 Atmosphere
    collapsed: true
  ambientIntensity:
    value: 0.3
    label: Global Ambient
    min: 0
    max: 1
    step: 0.01

modelTransform:
  _section:
    label: 📦 Model Transform
    collapsed: true
  modelX:
    value: 0
    label: Pos X
    min: -500
    max: 500
    step: 1
    listen: true
  modelY:
    value: 0
    label: Pos Y
    min: -500
    max: 500
    step: 1
    listen: true
  modelZ:
    value: 0
    label: Pos Z
    min: -500
    max: 500
    step: 1
    listen: true
  rotX:
    value: 0
    label: Rot X °
    min: -180
    max: 180
    step: 1
    listen: true
  rotY:
    value: 0
    label: Rot Y °
    min: -180
    max: 180
    step: 1
    listen: true
  rotZ:
    value: 0
    label: Rot Z °
    min: -180
    max: 180
    step: 1
    listen: true

parLights:
  _section:
    label: 🔌 DMX Fixtures
    type: fixtureArray
    collapsed: false
  parsEnabled:
    value: true
    label: Master Enabled
  conesEnabled:
    value: true
    label: Show Light Cones
  generatorsVisible:
    value: false
    label: Show Generators
  fixtures:
    # --- YOUR ACTUAL FIXTURES GO HERE ---
    - group: LED Bar A
      name: Bar A 1
      fixtureType: ShehdsBar
      color: '#ffffff'
      intensity: 10
      angle: 30
      penumbra: 0.5
      x: 0
      y: 3
      z: 0
      rotX: 0
      rotY: 0
      rotZ: 0
      controllerIp: '10.1.1.102'
      dmxUniverse: 1
      dmxAddress: 1
      controllerId: 0
      sectionId: 0
      fixtureId: 0
      viewMask: 0

ledStrands:
  _section:
    label: 💡 LED Strands
    collapsed: true
  strands: []

colorWave:
  _section:
    label: ⚡ Lighting Engine
    collapsed: true
  lightingEnabled:
    value: true
    label: ⚡ Enable
    transient: true
  lightingMode:
    value: sacn_in
    label: Mode
    options:
      - gradient
      - pixelblaze
      - sacn_in
  waveSpeed:
    value: 0.1
    label: Speed
    min: 0.05
    max: 2
    step: 0.05
  gradientStops:
    - '#ff0000'
    - '#ffffff'
  sacn_enabled:
    value: true
    label: 📡 Bridge Enabled
  sacn_universes:
    value: 1,2
    label: 📡 Listen Universes
  sacn_lockout_ms:
    value: 10000
    label: 📡 Source Lockout (ms)
    min: 1000
    max: 30000
    step: 1000
  sacn_high_priority:
    value: 150
    label: 📡 High Priority Threshold
    min: 100
    max: 200
    step: 10
  sacn_stale_ms:
    value: 2000
    label: 📡 Source Stale (ms)
    min: 500
    max: 10000
    step: 500

config:
  _section:
    label: 💾 Configuration
    collapsed: false
  autoSave:
    value: false
    label: Auto-Save on Change
```

> ⚠️ **Do NOT modify the existing `scene_config.yaml` for the new scene.** Create a new file. The URL-based scene selector ensures the default behavior is unchanged.

---

### 6. 🎛️ Show Control Basics

| Feature | Status | Needed for Test? |
|---------|--------|:---:|
| Blackout on stop | ✅ Engine sends blackout frame on SIGINT | ✅ |
| Pattern cross-fade | ❌ Not implemented | Nice-to-have |
| Master dimmer | ❌ Not implemented | Nice-to-have |
| Cue list / sequencer | ❌ Not implemented | ❌ Not for test |
| Emergency all-off | ⚠️ Ctrl+C kills engine → blackout | ✅ Functional |
| Pattern parameter control | ❌ No runtime params | ❌ Not for test |

#### What's Minimally Needed

- **Start pattern**: `node engine.js --pattern bioluminescence`
- **Switch pattern**: Ctrl+C, then start new pattern (or use web UI from Gap #1)
- **Emergency stop**: Ctrl+C sends blackout

---

### 7. ✅ Deployment Checklist

#### Pre-Deployment (Do at home)

- [ ] **Verify sACN input path** — Run `node engine.js --pattern rainbow`, open simulation, confirm lights change
- [ ] **Verify sACN output path** — Connect one real controller, set `controllerIp`, confirm it receives data
- [ ] **Build Pattern Selection UI** — Option B web UI (see Gap #1)
- [ ] **Create new scene config** — Measurements/positions for your actual venue fixtures
- [ ] **Generate model.js** for new scene — Export from simulation after creating scene
- [ ] **Test direct engine→controller** — `node engine.js --pattern rainbow --dest <controller_ip>`

#### Day-Of Deployment

- [ ] Set up network (controller IPs reachable from show computer)
- [ ] Start simulation: `cd simulation && node start.js`
- [ ] Start engine: `cd marsin_engine && node engine.js --pattern bioluminescence`
- [ ] Verify visual on simulation
- [ ] Verify physical controllers respond
- [ ] Walk through all patterns, pick a show list
- [ ] Test emergency stop (Ctrl+C → blackout)

---

## Priority Matrix

| Gap | Priority | Effort | Risk if Skipped |
|-----|:--------:|:------:|:---:|
| **1. Pattern Selection UI** | 🔴 High | 1 day | No way to switch patterns during show |
| **2. sACN Input Config** | 🟢 Low | 15 min | Just a config change |
| **3. Controller IP Mapping** | 🔴 High | 1 hour | Controllers won't receive data |
| **4. Model/Patch Sync** | 🟡 Medium | 2 hours | Addresses won't align with hardware |
| **5. Multi-Scene Architecture** | 🔴 High | 1.5 days | Can't load different venue layouts |
| **6. Show Control** | 🟢 Low | 0 | CLI is good enough for test |
| **7. End-to-End Test** | 🔴 High | 0.5 day | Must verify before venue |

**Critical path: 1 → 5 → 3 → 4 → 7**

---

## Recommended Execution Order

1. **Day 1 AM:** Implement Pattern Selection Web UI (Gap #1, Option B)
2. **Day 1 PM:** Implement multi-scene URL selector in `main.js` (Gap #5, Phase 1–2)
3. **Day 2 AM:** Create kick-off party scene config + model export (Gap #5, Phase 3–5)
4. **Day 2 PM:** Configure controller IPs + fix model addressing (Gap #3 + #4)
5. **Day 3:** Full end-to-end integration test (Gap #7)
6. **Day 3 PM:** Buffer time for issues

---

## Available Patterns (Ready to Go)

| Pattern | Style | Good for Show? |
|---------|-------|:-:|
| `bioluminescence` | Deep-sea organic glow | ✅ Mood setter |
| `rainbow` | Classic HSV sweep | ✅ Crowd pleaser |
| `fire` | Warm flickering | ✅ Dramatic |
| `breathing` | Gentle pulse | ✅ Ambient |
| `occeanliner` | Multi-effect ocean theme | ✅ On-brand |
| `plasma` | Classic fractal | ✅ Visual |
| `sparkle` | Random twinkle | ✅ Party vibe |
| `wipe` | Linear color wipe | ✅ Transition |
| `test_6ch_pixel` | RGBWAU test | ❌ Debug only |
| `rpm_fixtures_tune_v2` | Fixture tuning | ❌ Debug only |

**8 show-ready patterns** — enough for a simple show rotation.
