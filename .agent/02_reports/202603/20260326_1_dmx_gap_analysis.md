# BM26-Titanic: DMX & Simulation Integration GAP Analysis
**Date:** March 26, 2026 (updated March 27, 2026)
**Subject:** GAP Analysis between Three.js Simulation, Node.js DMX Handler, and Chromatik

## 1. Current State Overview

**The Simulation (`simulation/main.js`):**
- A Three.js application that renders a 3D environment.
- Maintains accurate 3D coordinates, rotations, and physical properties (Icebergs, Par Lights, LED strands).
- State is serialized/deserialized via `scene_config.yaml`.
- Currently operates as a pure visualizer with no outbound data pipeline for real-time fixtures.

**The DMX Handler (`dmx/pixelblaze_util/server.js`):**
- A standalone Express + WebSocket backend.
- Wraps the `MarsinEngine.wasm` module to compile and execute PixelBlaze patterns.
- Runs an internal fixed-rate render loop (40 FPS).
- Maps pixels as 1D structures (`index / pixelCount`).
- Pushes **Art-Net only** — zero sACN support anywhere in the codebase.

**Chromatik:**
- Commercial lighting design platform used as the primary VJ tool.
- Supports both Art-Net and sACN (E1.31) output.
- Configurable per-universe sACN priority.
- Currently has **no live data link** to the simulation or DMX handler.

---

## 2. Identified Integration Gaps

### A. Architectural Disconnect (Dual Truth)
The simulation holds the source of truth for 3D coordinates, but the DMX handler is executing patterns locally in Node.js. If PixelBlaze 3D/2D patterns are to be supported, the DMX handler's `MarsinEngine` needs the `x, y, z` coordinates for every pixel it renders, which it currently lacks.

### B. Data Flow Mismatch
There are two distinct paths to bridge this gap:

**Path 1: Simulation as the Render Engine (Video Mapping style)**
- *Action:* The Three.js simulation runs the MarsinEngine WASM.
- *Gap:* The simulation needs a WebSocket client to stream raw framebuffers (RGB arrays) to a lightweight DMX forwarder backend, bypassing the Node.js MarsinEngine entirely.

**Path 2: Backend as the Render Engine (Headless rendering)**
- *Action:* `server.js` continues to run MarsinEngine.
- *Gap:* The simulation must serialize the 3D pixel map (extracting `x, y, z` for all fixtures) and push it to `server.js`. `server.js` then calls `render3D(index, x, y, z)` instead of 1D rendering.

### C. Missing Communication Link
Currently, `app.js` (the DMX UI) talks to `server.js` via WebSockets to send raw code snippets. The `simulation/main.js` has no WebSocket implementation. A real-time data link (WebSockets, OSC, or WebRTC) must be established between the web-based simulation and the local node backend.

### D. No sACN Support — No Priority-Based Source Arbitration *(NEW)*
The entire codebase uses Art-Net exclusively. Art-Net has **no priority field** — when two sources send to the same universe, the receiver can only do HTP (highest value wins) or LTP (latest change wins). There is no way to declare "Chromatik is more important than my test script."

sACN (E1.31) solves this with a **per-universe priority field (0–200)**. The PKnight nodes already support sACN natively.

---

## 3. sACN Priority — Chromatik Takeover Architecture

### 3.1 The Problem

We need multiple sources to coexist on the same fixtures:

| Source | Role | When Active |
|--------|------|-------------|
| Test scripts (`test_calibration.js`, `testbench_helloworld.js`) | Default ambient / dev patterns | Always running |
| PixelBlaze utility (`pixelblaze_util/server.js`) | Live pattern coding | When a VJ is coding live |
| Chromatik | Primary show control / VJ tool | During performances or design sessions |

**Requirement:** When Chromatik is active, it takes over the fixtures. When it stops, the local scripts automatically resume. No manual switching.

### 3.2 How sACN Priority Solves This

sACN (ANSI E1.31) has a built-in priority byte in every packet. Range: **0–200**, default is **100**. The PKnight node follows one rule:

> **Highest priority wins the entire universe. If equal priority, HTP merge.**

This means the merge decision happens **inside the PKnight hardware** — the router/software doesn't need to implement any merge logic.

### 3.3 Priority Assignment

| Source | Protocol | Priority | Behavior |
|--------|----------|----------|----------|
| Local scripts (Node.js ArtNet Router) | **sACN** | **100** (default) | Always running, lowest priority |
| Chromatik | **sACN** | **150** | Takes over when active |
| Emergency blackout / safety | **sACN** | **200** | Overrides everything |

### 3.4 System Data Flow

```
┌─────────────────────────────┐
│  Local Sources              │
│  ┌────────────────────┐     │
│  │ test_calibration.js│     │
│  │ pixelblaze_util    │     │
│  │ simulation engine  │     │
│  └────────┬───────────┘     │
│           ▼                 │
│  ┌────────────────────┐     │           ┌────────────────┐
│  │  ArtNet Router     │     │           │                │
│  │  (Node.js)         │─────┼── sACN ──▶│  PKnight Node  │──▶ DMX Fixtures
│  │                    │     │  pri=100  │  (CR041R)      │
│  │  Receives ArtNet   │     │           │                │
│  │  from any source,  │     │           │  Follows       │
│  │  outputs sACN      │     │           │  HIGHEST       │
│  └────────────────────┘     │           │  PRIORITY      │
└─────────────────────────────┘           │                │
                                          │                │
┌─────────────────────────────┐           │                │
│  Chromatik                  │── sACN ──▶│                │
│  (VJ / Show Control)       │  pri=150  │                │
└─────────────────────────────┘           └────────────────┘
```

**Normal operation:** Local scripts send sACN at priority 100 → fixtures respond.

**Chromatik active:** Chromatik sends sACN at priority 150 → PKnight node **automatically ignores** local scripts and follows Chromatik for every channel in that universe.

**Chromatik stops:** PKnight falls back to the local sACN stream (priority 100) → seamless handoff with no gap.

### 3.5 Hardware Confirmation

| Component | sACN Support | Priority Merge |
|-----------|-------------|----------------|
| PKnight CR041R | ✅ Native | ✅ Per-universe priority |
| PKnight CR011R MK II | ✅ Native | ✅ Per-universe priority |
| Chromatik | ✅ Output (configurable priority) | N/A (it's a source) |
| Node.js `sacn` npm | ✅ Send + Receive | N/A (application handles it) |

### 3.6 What Needs To Be Built

The codebase currently sends **Art-Net only**. To enable the priority architecture:

#### Step 1: Add sACN Sender to the DMX layer
- Install `sacn` npm package (well-maintained, E1.31 compliant).
- Create `lib/SacnSender.js` — thin wrapper around `sacn` that takes a 512-byte buffer and a priority value.
- `DmxUniverse` gains a `protocol` option: `artnet` (existing) or `sacn` (new).

#### Step 2: Build the ArtNet Router (`lib/ArtNetRouter.js`)
- `ArtNetReceiver`: listens on UDP 6454 for incoming Art-Net packets from any source (simulation, PixelBlaze, external tools).
- Routing table (`routes.yaml`): maps incoming Art-Net universes → sACN output universes with a priority setting.
- Output dispatcher: sends via sACN at the configured priority.

#### Step 3: Configure Chromatik
- In Chromatik's output settings, switch from Art-Net to **sACN**.
- Set the universe number to match the PKnight node's sACN configuration.
- Set priority to **150** (or any value > 100).

#### Step 4: Configure PKnight Nodes
- Access the PKnight web UI.
- Enable **sACN input** (may already be enabled alongside Art-Net).
- Verify the universe number matches both the router and Chromatik.

### 3.7 Configuration Example

**`routes.yaml`** (new file in `dmx/`):
```yaml
# ArtNet Router — Routing Configuration
# Routes incoming Art-Net data to sACN output with priority

defaults:
  sacn_priority: 100        # local sources: low priority
  output_protocol: sacn      # default output is sACN (for priority support)

routes:
  - id: "local_to_bench"
    description: "Local scripts → test bench fixtures"
    input:
      protocol: artnet       # accept Art-Net from any local source
      universe: 0
      subnet: 0
      net: 0
    output:
      protocol: sacn
      universe: 1            # sACN universe (1-indexed, unlike Art-Net's 0-indexed)
      priority: 100          # lower than Chromatik

  - id: "passthrough_artnet"
    description: "Forward Art-Net directly (bypass sACN)"
    input:
      protocol: artnet
      universe: 1
    output:
      protocol: artnet
      ip: "10.1.1.102"
      universe: 0
```

**Chromatik sACN output Settings:**
```
Protocol:  sACN (E1.31)
Universe:  1
Priority:  150
Mode:      Unicast → 10.1.1.102  (or Multicast)
```

---

## 4. Recommendations (Updated)

1. **Add sACN output to the DMX layer** — install `sacn` npm, create `SacnSender.js`, add `protocol: sacn` option to `universes.yaml`.
2. **Build the ArtNet Router** — receive Art-Net from any source, route to sACN output with configurable priority.
3. **Configure Chromatik for sACN at priority 150** — enables automatic takeover from local sources.
4. **Choose a simulation architecture** (from original analysis): decide if pattern rendering happens in the browser or the Node.js backend.
5. **Implement WebSocket link** between simulation and DMX backend for 3D coordinate export.

### Priority Order
| # | Task | Blocks |
|---|------|--------|
| 1 | sACN sender + `sacn` npm | Everything below |
| 2 | ArtNet Router (receive → route → sACN output) | Chromatik integration |
| 3 | Chromatik sACN configuration | Live VJ workflow |
| 4 | Simulation ↔ DMX WebSocket link | 3D pattern rendering |
