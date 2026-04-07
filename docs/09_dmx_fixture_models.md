# 09 — DMX Fixture Models: Pixel-Based 3D Modeling & Fixture Designer

## 1. Overview

Each physical DMX fixture in the BM26 Titanic system needs a **pixel-based 3D model** that precisely represents its physical geometry — where each LED, segment, or light head is positioned in space. These models enable:

- **Accurate simulation** — seeing exactly what a fixture will look like when receiving DMX data
- **Spatial design** — arranging fixtures in a virtual scene that mirrors the real-world installation
- **Effect authoring** — writing patterns that sweep across pixel positions, not just channel addresses

The system draws from the pixel-mapped visualization architecture proven in production, adapting it for DMX fixtures where pixel types are diverse (RGB, Amber, White, Warm, RGBWAU) and physical form factors vary dramatically.

### 1.1 Calibration Truth Policy

> **Runtime-calibrated code overrides vendor manuals where they disagree.**

The fixture driver classes (`EndyshowBar.js`, `UkingPar.js`, `VintageLed.js`) are the authoritative source for channel mappings — not the OCR'd manual profiles. Physical testing on the real hardware has already revealed discrepancies between what the manual claims and what the fixture actually does. Verified corrections are documented in [Appendix A: Verified Fixture Truths](#appendix-a-verified-fixture-truths) and in the `dmx/README.md`.

**Known calibration overrides already in code:**

| Fixture | Manual Claim | Verified Reality | Code Reference |
|:---|:---|:---|:---|
| EndyshowBar (135ch) | Pixel order R,B,G | Pixel order **R,G,B** | `channels_135.yaml` line 28, `EndyshowBar.js` line 66 |
| EndyshowBar (135ch) | CH97–112 = Amber, CH113–128 = White | CH97–112 = **White**, CH113–128 = **Amber** | `EndyshowBar.js` lines 55–60 |
| UkingPar (10ch) | — | All channels verified as documented | `UkingPar.js` lines 42–54 |
| VintageLed (33ch) | — | All channels verified as documented | `VintageLed.js` lines 28–32 |

Model YAML files **must** use the calibrated values from the driver classes, not the raw manual data.

---

## 2. Fixture Inventory & Physical Characteristics

### 2.1 Endyshow 240W Stage Strobe LED Bar

| Property | Value |
|:---|:---|
| **Form Factor** | Linear horizontal bar (~60cm) |
| **Pixel Groups** | 32 RGB pixels (3ch each) + 16 White segments (1ch each) + 16 Amber segments (1ch each) |
| **Total Addressable Pixels** | 64 (32+16+16) |
| **Control Channels** | 7 (strobe, effects, speed, background) |
| **Modes** | 7 / 13 / 82 / 130 / 135 channel |
| **Primary Mode** | 135-channel (full pixel control) |
| **Physical Layout** | Three interleaved pixel rows along one axis — RGB across full width, White and Amber in alternating sub-segments |

**Pixel Geometry (135-ch mode) — calibrated mapping:**
- RGB pixels 1–32: evenly spaced along the bar's long axis (X), all at the same Y/Z. Verified order: R,G,B (manual incorrectly says R,B,G).
- White segments 1–16 (CH97–112): interleaved at half-density along the same axis, offset slightly in Z. ⚠ Manual incorrectly labels these channels as "Amber."
- Amber segments 1–16 (CH113–128): same pattern, different Z offset row. ⚠ Manual incorrectly labels these channels as "White."

> See `EndyshowBar.js` lines 55–60 for the code-level documentation of this swap.

### 2.2 UKing RGBWAU PAR Light

| Property | Value |
|:---|:---|
| **Form Factor** | Circular PAR can (~15cm diameter) |
| **Pixel Groups** | 1 DMX pixel with 6 color channels (R, G, B, W, Amber, Purple) |
| **Total Addressable Pixels** | 1 (all LEDs respond identically) |
| **Visual Dots** | ~18 individual LED emitters arranged in concentric rings |
| **Control Channels** | 4 (dimmer, strobe, function, speed) |
| **Modes** | 6-channel / 10-channel |
| **Primary Mode** | 10-channel |
| **Physical Layout** | ~18 LED dots in a circular face, all driven by the same single DMX pixel |

**Key distinction:** The PAR has ~18 physical LED emitters visible on its face, but they all respond to the **same** DMX channels simultaneously. The model must capture both:
- The **visual layout** (18 dots arranged in concentric rings for realistic rendering)
- The **DMX grouping** (all 18 dots share one `rgbwau` pixel binding)

### 2.3 Vintage LED Stage Light

| Property | Value |
|:---|:---|
| **Form Factor** | Vertical fixture with 6 retro-style Edison bulb heads arranged in a column/arc (~50cm tall) |
| **Pixel Groups** | 6 Warm-white heads (1ch each) + 1 global Aux RGB (3ch) + 6 per-head Aux RGB (3ch each, 33-ch mode only) |
| **Total Addressable Pixels** | 6 warm + 6 aux-RGB heads = up to 12 distinct emission points |
| **Control Channels** | 6 (dimmer, strobe, main effect, main speed, aux effect, aux speed) |
| **Modes** | 15-channel / 33-channel |
| **Primary Mode** | 33-channel (per-head aux RGB) |
| **Physical Layout** | Six bulb heads arranged vertically, each with a warm LED + auxiliary RGB LED ring |

**Pixel Geometry (33-ch mode):**
- 6 heads arranged vertically along the Y axis
- Each head has two co-located pixel types:
  - `warm` — a single warm-white channel (CH3–8)
  - `aux_rgb` — a per-head RGB triplet (CH16–33)
- The global aux RGB (CH9–11) acts as a master tint for all heads simultaneously

---

## 3. Model Architecture

### 3.1 Core Concept: Visual Dots vs DMX Pixels

A fixture model has two distinct layers:

1. **DMX Pixels** — addressable control points. Each pixel maps to one or more DMX channels. This is what you control.
2. **Visual Dots** — the physical LED emitters visible on the fixture face. Multiple dots can belong to the same DMX pixel (they all display the same color). This is what you see.

```
                ┌─ DMX Pixel ─────────────────────┐
                │  id: "pixel_1"                   │
                │  type: rgbwau                    │
                │  channels: {R:2, G:3, B:4, ...}  │
                │                                   │
                │  visual_dots: [                   │
                │    { position: [0, 0, 0] },       │  ← physical LED #1
                │    { position: [5, 0, 0] },       │  ← physical LED #2
                │    { position: [2.5, 4.3, 0] },   │  ← physical LED #3
                │    ...                             │  ← (18 LEDs total)
                │  ]                                │
                └───────────────────────────────────┘
```

For simple fixtures like the Endyshow bar, each DMX pixel has exactly 1 visual dot (1:1 mapping). For the PAR light, 1 DMX pixel has ~18 visual dots.

**Important:** The visual dot layout for grouped fixtures like the UKing PAR is a **measured/estimated visual model** — it represents approximately where the physical LEDs sit on the fixture face for realistic rendering. It is *not* something that can be validated LED-by-LED via DMX identify, since all dots in a grouped pixel always emit the same color. The ring arrangement is based on counting and measuring the physical LEDs on the fixture.

### 3.2 Model Schema

```yaml
# Model Definition — model_10.yaml (UKing PAR example)
model:
  id: "uking_par_10"
  name: "UKing RGBWAU PAR (10ch)"
  fixture_type: "UkingPar"
  channel_mode: 10

  # Physical dimensions for shell rendering (mm)
  dimensions:
    width: 150
    height: 150
    depth: 120

  # Shell: the fixture body (purely cosmetic)
  shell:
    type: "cylinder"
    dimensions: [150, 150, 120]
    color: "#111111"
    offset: [0, 0, -60]

  # DMX Pixels — the addressable control points
  pixels:
    - id: "par"
      type: "rgbwau"
      channels:
        dimmer: 1
        red: 2
        green: 3
        blue: 4
        white: 5
        amber: 6
        purple: 7
        strobe: 8
        function: 9
        function_speed: 10

      # Visual dots — the individual LED emitters this pixel drives.
      # All 18 dots display the same color. This ring layout is a
      # measured/estimated visual model for realistic rendering — it
      # cannot be calibrated per-LED since DMX controls them as one unit.
      dots:
        # Inner ring (6 LEDs)
        - [15, 0, 0]
        - [7.5, 13, 0]
        - [-7.5, 13, 0]
        - [-15, 0, 0]
        - [-7.5, -13, 0]
        - [7.5, -13, 0]
        # Middle ring (6 LEDs)
        - [30, 0, 0]
        - [15, 26, 0]
        - [-15, 26, 0]
        - [-30, 0, 0]
        - [-15, -26, 0]
        - [15, -26, 0]
        # Outer ring (6 LEDs)
        - [45, 0, 0]
        - [22.5, 39, 0]
        - [-22.5, 39, 0]
        - [-45, 0, 0]
        - [-22.5, -39, 0]
        - [22.5, -39, 0]
```

```yaml
# Model Definition — model_135.yaml (Endyshow bar example)
# ⚠ Uses calibrated channel mapping (code-verified, not manual)
model:
  id: "endyshow_bar_135"
  name: "Endyshow 240W Bar (135ch)"
  fixture_type: "EndyshowBar"
  channel_mode: 135

  dimensions:
    width: 600
    height: 80
    depth: 120

  shell:
    type: "box"
    dimensions: [600, 80, 120]
    color: "#111111"

  pixels:
    # 32 RGB pixels — 1 dot each (1:1 mapping)
    # Verified channel order: R, G, B (manual had R,B,G typo)
    - id: "rgb_1"
      type: "rgb"
      channels: { red: 1, green: 2, blue: 3 }
      dots: [[0, 0, 0]]

    - id: "rgb_2"
      type: "rgb"
      channels: { red: 4, green: 5, blue: 6 }
      dots: [[18.75, 0, 0]]

    # ... (32 total)

    # ⚠ CALIBRATED: Despite manual labeling, physical testing confirms:
    #   CH97–112  = WHITE segments (manual calls these "Amber")
    #   CH113–128 = AMBER segments (manual calls these "White")
    # See EndyshowBar.js lines 55–60

    # 16 WHITE segments (CH97–112) — 1 dot each, offset Z row
    - id: "white_1"
      type: "single"
      color_hint: "#FFFFFF"
      channels: { value: 97 }
      dots: [[0, 0, 15]]

    # ... (16 total, CH97–112)

    # 16 AMBER segments (CH113–128) — 1 dot each, another Z row
    - id: "amber_1"
      type: "single"
      color_hint: "#FFBF00"
      channels: { value: 113 }
      dots: [[0, 0, 30]]

    # ... (16 total, CH113–128)

  controls:
    - { channel: 129, function: "RGB Strobe" }
    - { channel: 130, function: "ACW Strobe" }
    - { channel: 131, function: "RGB Effect" }
    - { channel: 132, function: "RGB Speed" }
    - { channel: 133, function: "RGB Background Color" }
    - { channel: 134, function: "ACW Effect" }
    - { channel: 135, function: "ACW Speed" }
```

```yaml
# Model Definition — model_33.yaml (Vintage LED example)
model:
  id: "vintage_led_33"
  name: "Vintage LED Stage Light (33ch)"
  fixture_type: "VintageLed"
  channel_mode: 33

  dimensions:
    width: 80
    height: 400
    depth: 50

  pixels:
    # Head 1 — two co-located pixel types (warm + aux RGB)
    - id: "head_1_warm"
      type: "warm"
      channels: { value: 3 }
      dots: [[0, 0, 0]]

    - id: "head_1_aux"
      type: "rgb"
      channels: { red: 16, green: 17, blue: 18 }
      dots: [[0, 0, 0]]      # Same position as warm — co-located

    # Head 2
    - id: "head_2_warm"
      type: "warm"
      channels: { value: 4 }
      dots: [[0, 70, 0]]

    - id: "head_2_aux"
      type: "rgb"
      channels: { red: 19, green: 20, blue: 21 }
      dots: [[0, 70, 0]]

    # ... (6 heads total, each with warm + aux)

  controls:
    - { channel: 1, function: "Total Dimming" }
    - { channel: 2, function: "Total Strobe" }
    - { channel: 9, function: "Aux Red (global)" }
    - { channel: 10, function: "Aux Green (global)" }
    - { channel: 11, function: "Aux Blue (global)" }
    - { channel: 12, function: "Main Light Effect" }
    - { channel: 13, function: "Main Effect Speed" }
    - { channel: 14, function: "Aux Light Effect" }
    - { channel: 15, function: "Aux Effect Speed" }
```

### 3.3 Pixel Types

| Type | Channels | Rendering | Dot Color | Examples |
|:---|:---|:---|:---|:---|
| `rgb` | 3 (red, green, blue) | Full color | Computed RGB | Endyshow RGB pixels, Vintage aux heads |
| `rgbw` | 4 (red, green, blue, white) | Color + white blend | Computed RGBW | — |
| `rgbwau` | 6 (red, green, blue, white, amber, purple) | Multi-layer color | Composite of all 6 | UKing PAR |
| `single` | 1 (value) | Monochrome with `color_hint` | `color_hint × value` | Endyshow amber/white segments |
| `warm` | 1 (value) | Warm white (~2700K tint) | `#FFD700 × value` | Vintage warm heads |

### 3.4 File Layout

Models live alongside their channel YAMLs:

```
dmx/fixtures/
  endyshow_240w_stage_strobe_led_bar/
    channels_135.yaml      # existing — DMX channel definitions
    model_135.yaml         # NEW — pixel model for 135-ch mode
  uking_rgbwau_par_light/
    channels_10.yaml       # existing
    model_10.yaml          # NEW
  vintage_led_stage_light/
    channels_33.yaml       # existing
    model_33.yaml          # NEW

```

The channel YAML and model YAML for the same mode are tightly coupled — they describe the same physical fixture from different angles (what channels do vs where they are). The Fixture Designer loads both files together.

---

## 4. Fixture Designer

### 4.1 Goal

A browser-based 3D editor for creating and editing fixture models. The user places visual dots in 3D space, groups them into DMX pixels, assigns channel bindings, and saves the result as a model YAML. The Fixture Designer is also a **fixture-aware DMX test bench** — you can send test patterns to the physical fixture directly from the design view to verify the model matches reality.

### 4.2 Technology Stack

| Component | Technology | Rationale |
|:---|:---|:---|
| 3D Viewport | Three.js + React Three Fiber | Proven in the existing BM26 simulation; shares rendering patterns with `ParLight.js` |
| Camera | Orthographic (default) + Perspective toggle | Mostly 2D design (plan/elevation views) but 3D-capable |
| Controls | OrbitControls + TransformControls | As used in the existing simulation |
| UI Framework | React | — |
| Post-processing | Optional bloom for pixel previewing | Proven pattern from existing LED visualization |
| DMX Output | Art-Net via existing `artnet.js` lib | For live test patterns |

### 4.3 UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Toolbar: [Save] [Load] [View: Top|Front|Side|3D] [Grid] [Snap] │
├───────────────────────────────────────────────┬──────────────────┤
│                                               │                  │
│                                               │  PROPERTIES      │
│            3D VIEWPORT                        │                  │
│                                               │  Fixture Info    │
│    • Grid with snap-to-grid                   │  ─────────────── │
│    • Dots rendered as spheres                 │  Selected Pixel  │
│    • Color-coded by pixel type                │   ID: rgb_14     │
│    • Click to select, drag to move            │   Type: rgb      │
│    • Multi-select with Shift+Click/Box        │   Dots: 1        │
│    • TransformControls on selection           │   Position:      │
│    • Pixel index labels (togglable)           │    X: [140.62]   │
│    • Shell outline (togglable)                │    Y: [  0.00]   │
│                                               │    Z: [  0.00]   │
│                                               │   Channels:      │
│                                               │    R: [40] G:[41]│
│                                               │    B: [42]       │
│                                               │  ─────────────── │
│                                               │  DMX TEST        │
│                                               │  (fixture-aware) │
│                                               │  [Details below] │
│                                               │  ─────────────── │
│                                               │  Bulk Actions    │
│                                               │  [Distribute]    │
│                                               │  [Align]         │
│                                               │  [Duplicate]     │
├───────────────────────────────────────────────┴──────────────────┤
│  PIXEL LIST                                                      │
│  ┌──────┬──────┬──────┬──────────┬────────────┬────────────────┐ │
│  │ ID   │ Type │ Dots │ Position │ Channels   │ Preview        │ │
│  ├──────┼──────┼──────┼──────────┼────────────┼────────────────┤ │
│  │ par  │rgbwau│ 18   │ (center) │ R:2 G:3 ...│ ● (color dot)  │ │
│  │ rgb_1│ rgb  │ 1    │ 0, 0, 0  │ R:1 G:2 B:3│ ●              │ │
│  └──────┴──────┴──────┴──────────┴────────────┴────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 Core Design Interactions

#### Adding Pixels
1. **Single pixel with 1 dot** — Click "Add Pixel" in toolbar, click in viewport to place
2. **Single pixel with N dots** — "Add Pixel Group" → specify dot count + arrangement (ring, line, grid) → all dots share one DMX pixel
3. **Linear pixel array** — "Add Line" → specify pixel count, start/end positions → pixels auto-distributed, 1 dot each
4. **Grid array** — "Add Grid" → specify rows × cols, spacing → 2D pixel grid, 1 dot each
5. **Duplicate** — Select existing pixels, Ctrl+D to duplicate with offset

#### Visual Dot Editing
Inside a multi-dot pixel (like the PAR's 18 LEDs):
- Click on individual dots to reposition them within the pixel
- Use arrangement presets: "Concentric Rings", "Linear", "Grid", "Custom"
- All dots in the same pixel always display the same color
- The dot layout is a **visual estimation**, not a DMX-validated mapping — for grouped pixels, you cannot "identify" individual dots via DMX since they all share the same channels

#### Pixel Type Assignment
- On creation, each pixel gets a type (dropdown: `rgb`, `single`, `warm`, `rgbwau`)
- Type determines how many channel bindings are required
- Type determines the rendering color/style in the viewport

#### Channel Auto-Binding
When creating pixel arrays, channels are auto-assigned sequentially:
- "Add 32 RGB pixels as line" → auto-assigns channels 1–96 (3 per pixel)
- User can override any channel binding in the properties panel
- **Validation**: red highlight on conflicts (same channel bound to multiple pixels)
- The UI loads the paired `channels_N.yaml` and cross-references to show function names

#### Spatial Tools
- **Snap to Grid** — configurable grid size (1mm, 5mm, 10mm, etc.)
- **Distribute Evenly** — select N pixels, distribute evenly between first and last
- **Align** — align selection to common X, Y, or Z
- **Mirror** — mirror selection across an axis

#### Views
- **Top (XY)** — primary 2D design view for bars and panels (orthographic)
- **Front (XZ)** — primary 2D view for vertical fixtures (orthographic)
- **Side (YZ)** — secondary 2D view (orthographic)
- **3D** — perspective view for final verification

### 4.5 DMX Test Panel (Fixture-Aware)

The Fixture Designer includes a built-in **fixture-aware** DMX test panel. Tests are not raw-channel blasts — they use the fixture's driver class APIs and understand each fixture type's capabilities and safe operating mode.

#### Safe Test Mode Setup

Before any test pattern runs, the test panel automatically puts the fixture into a **safe test mode** following the pattern established in `testbench_helloworld.js` (lines 113–117):

| Fixture Type | Safe Mode Setup | Why |
|:---|:---|:---|
| **EndyshowBar** | `setRgbStrobe(0)`, `setAcwStrobe(0)`, `setRgbEffect(0)`, `setAcwEffect(0)` | Disables strobes and built-in effects that could interfere with color testing |
| **UkingPar** | `setDimmer(255)`, `setStrobe(0)`, `setFunction(0)` | Ensures manual mode, full brightness, no strobe |
| **VintageLed** | `setDimmer(255)`, `setStrobe(0)`, `setMainEffect(0)`, `setAuxEffect(0)` | Ensures manual mode, no built-in effects |

This is done automatically — the user never has to think about it.

#### Fixture-Aware Test Patterns

Each test pattern understands the fixture type's color capabilities:

| Pattern | EndyshowBar | UKing PAR | Vintage LED |
|:---|:---|:---|:---|
| **Static Red** | `fillPixels(255,0,0)` | `setColor(255,0,0,0,0,0)` | `setAuxRgb(255,0,0)` + `fillHeadAuxRgb(255,0,0)` |
| **Static Green** | `fillPixels(0,255,0)` | `setColor(0,255,0,0,0,0)` | `setAuxRgb(0,255,0)` + `fillHeadAuxRgb(0,255,0)` |
| **Static Blue** | `fillPixels(0,0,255)` | `setColor(0,0,255,0,0,0)` | `setAuxRgb(0,0,255)` + `fillHeadAuxRgb(0,0,255)` |
| **Static White** | `fillWhite(255)` | `setWhite(255)` | `fillWarm(255)` |
| **Static Amber** | `fillAmber(255)` | `setAmber(255)` | `fillWarm(255)` (approx.) |
| **Static Purple** | *(no purple)* — skipped | `setPurple(255)` | R+B approx: `setAuxRgb(255,0,255)` |
| **All On** | All pixel groups at 255 | All 6 colors at 255 | All warm + aux at 255 |
| **Blackout** | `blackout()` | `blackout()` | `blackout()` |
| **Pixel Chase** | Walk lit pixel across 32 RGB positions | Pulse on/off (only 1 pixel) | Walk across 6 warm heads |
| **Identify Pixel** | Light selected pixel only, others dark | Light entire fixture (1 pixel) | Light selected head only |
| **Dimmer Sweep** | N/A (no master dimmer) | Ramp CH1 0→255 | Ramp CH1 0→255 |

> **Note on Identify:** For grouped-pixel fixtures like the UKing PAR, "Identify Pixel" lights the entire fixture since all dots share one DMX pixel. You cannot identify individual *dots* — those are a visual model, not DMX-addressable. For individually-addressable fixtures like the Endyshow bar, Identify lights one pixel while keeping others dark, which validates the pixel→channel mapping.

#### Workflow
1. Open a model YAML in the design UI
2. Select the target universe/fixture from `universes.yaml` (dropdown)
3. **Safe mode is applied automatically**
4. Click "Static Red" → the physical fixture turns red using the correct fixture API
5. Click individual pixels in the viewport → "Identify" fires on the corresponding DMX pixel
6. If the wrong LED lights up → adjust channel bindings or dot positions → re-test
7. Save the model when the mapping matches reality

### 4.6 Live DMX Preview

In addition to sending test patterns, the UI can also **receive** live DMX data and render it onto the model:

1. The design UI subscribes to the Art-Net stream for the fixture's universe
2. Incoming DMX data is mapped through the model's channel bindings
3. Each dot in the viewport lights up with the corresponding color/intensity
4. This provides instant visual verification while external scripts control the fixture

Uses the same `InstancedMesh` rendering pattern proven in the existing LED visualization — each dot is an instanced sphere with per-frame color updates.

---

## 5. Rendering Architecture

### 5.1 Dot Visualization

Each visual dot is rendered as a `THREE.InstancedMesh` sphere:

```
Pixel Type      → Dot Color (idle)       → Dot Color (active)
─────────────────────────────────────────────────────────────────
rgb             → dim gray               → actual RGB color
single (amber)  → dim amber (#3d2f00)    → bright amber (#FFBF00 × value)
single (white)  → dim white (#2a2a2a)    → bright white (#FFF × value)
warm            → dim warm (#3d2a00)     → warm white (#FFD700 × value)
rgbwau          → dim gray               → composite of all 6 channels
```

All dots belonging to the same DMX pixel display the same computed color.

### 5.2 Fixture Shell (Optional)

Models can include a `shell` definition for the fixture housing:

```yaml
shell:
  type: "cylinder"            # cylinder | box | custom_mesh
  dimensions: [150, 150, 120] # mm
  color: "#111111"
  offset: [0, 0, -60]
```

---

## 6. Integration: Current State vs Planned State

### 6.1 Current State (What Exists Today)

The DMX system today uses only:

```yaml
# universes.yaml — current schema (no model references, no transforms)
fixtures:
  - label: "wash_1"
    type: "EndyshowBar"
    dmx_start_address: 1
    config:
      layout: "fixtures/endyshow_240w_stage_strobe_led_bar/channels_135.yaml"
```

- `type` → maps to a JS driver class (`EndyshowBar`, `UkingPar`, `VintageLed`)
- `config.layout` → path to the channel-mode profile YAML
- `dmx_start_address` → universe buffer offset

**There are no `model`, `position`, or `rotation` fields in `universes.yaml` today.** Fixture geometry does not exist in the current runtime — the channel YAML only defines DMX semantics (channel numbers, value ranges, function descriptions), not physical positions.

### 6.2 Planned State (This Design)

The model YAML files proposed in this document are a **new layer** that adds physical geometry on top of the existing channel profiles:

```yaml
# universes.yaml — proposed future schema addition
fixtures:
  - label: "wash_1"
    type: "EndyshowBar"
    dmx_start_address: 1
    config:
      layout: "fixtures/endyshow_240w_stage_strobe_led_bar/channels_135.yaml"
      model: "fixtures/endyshow_240w_stage_strobe_led_bar/model_135.yaml"  # NEW
    position: [0, 2.5, -1]    # NEW — world coordinates, meters
    rotation: [0, 0, 0]       # NEW — Euler degrees
```

Adding `model` and `position`/`rotation` fields to `universes.yaml` is future runtime work. The immediate deliverable is the model YAML files and the design UI — they work standalone for fixture/pixel design and testing.

### 6.3 Relationship to Existing Code

```
dmx/fixtures/<type>/
  ├── channels_N.yaml     ← DMX channel definitions (EXISTING, current truth)
  └── model_N.yaml        ← Pixel positions + dot layouts (NEW, proposed layer)
         ↕ tightly coupled — same mode, same fixture, loaded together in design UI

dmx/universes.yaml        ← Currently: type + layout + start_address only
                             Future: + model + position + rotation

dmx/lib/
  ├── DmxFixture.js        ← Base class reads channels YAML (existing, unchanged)
  ├── fixtures/             ← EndyshowBar.js, UkingPar.js, VintageLed.js (existing, unchanged)
  └── DmxHandler.js         ← Universe management (existing, unchanged)
```

### 6.4 Future: Scene Unification

> **Not part of this design phase**, but planned as the next step.

The current simulation uses `scene_config.yaml` (fixture positions, atmosphere, lighting) and `scene_preset_cameras.yaml` (camera presets) as separate files. A future phase will unify fixture placement into `universes.yaml` and merge scene config, eliminating fragmented state. The model system is designed with this unification in mind.

---

## 7. File Structure Changes

```
dmx/
  fixtures/
    endyshow_240w_stage_strobe_led_bar/
      channels_*.yaml       (existing — channel definitions)
      model_135.yaml        (NEW — pixel model, primary)
      model_82.yaml         (NEW — pixel model, optional)
      manual/               (existing)
    uking_rgbwau_par_light/
      channels_*.yaml       (existing)
      model_10.yaml         (NEW)
      manual/               (existing)
    vintage_led_stage_light/
      channels_*.yaml       (existing)
      model_33.yaml         (NEW)
      manual/               (existing)
    verified_fixture_truths.md  → DELETED (folded into dmx/README.md)

  archive/                  → DELETED (replaced by fixture-aware DMX test panel)
```

---

## 8. Default Models Summary

| Fixture | Mode | DMX Pixels | Visual Dots | Shell |
|:---|:---|:---|:---|:---|
| Endyshow Bar | 135ch | 64 (32 RGB + 16 White + 16 Amber) | 64 (1:1) | Box 600×80×120mm |
| UKing PAR | 10ch | 1 (RGBWAU) | 18 (3 concentric rings of 6, estimated) | Cylinder ø150×120mm |
| Vintage LED | 33ch | 12 (6 warm + 6 aux RGB, co-located) | 12 (1:1) | Vertical 80×400×50mm |

---

## 9. Implementation Phases

### Phase 1: Model Data Layer
- Define model YAML schema (as specified in §3.2)
- Create the three default model files with measured positions
- Create `verified_fixture_truths.md` documenting all manual-vs-hardware corrections
- Add model YAML loading alongside channel YAML loading in fixture setup

### Phase 2: Fixture Designer with DMX Test Panel
- Build Three.js/R3F viewport with dot rendering (InstancedMesh)
- Implement pixel/dot CRUD (add, remove, move, duplicate, group)
- Properties panel with channel binding editor
- Spatial tools (distribute, align, snap, mirror)
- **Fixture-aware DMX test panel** with automatic safe mode setup
- Per-fixture test patterns using driver class APIs (not raw channels)
- Art-Net integration for sending test patterns to physical fixtures
- Live DMX preview (receive and render incoming Art-Net data)
- Save/load model YAML

### Phase 3 (Future): Scene Integration & Config Unification
- Add `model` and `position`/`rotation` fields to `universes.yaml` schema
- Unify fixture placement from `scene_config.yaml` into `universes.yaml`
- Replace hardcoded `ParLight.js` with model-driven rendering in the full simulation
- Merge camera presets and atmosphere settings into a unified scene format

---

## Appendix A: Verified Fixture Truths

This appendix records every known case where physical hardware testing produced results that differ from the vendor manual. The full authoritative record is maintained in `dmx/fixtures/verified_fixture_truths.md`.

| Fixture | Item | Manual Says | Hardware Does | Code Reference | Verified Date |
|:---|:---|:---|:---|:---|:---|
| Endyshow 240W Bar | RGB pixel order | R, B, G | **R, G, B** | `channels_135.yaml` L28 | 2026-03-21 |
| Endyshow 240W Bar | CH97–112 function | Amber segments | **White segments** | `EndyshowBar.js` L55–60 | 2026-03-21 |
| Endyshow 240W Bar | CH113–128 function | White segments | **Amber segments** | `EndyshowBar.js` L55–60 | 2026-03-21 |

---

## 10. Intermediate Integration Plan: `ModelFixture.js` & RGBWAU in `main.js`

To bridge the gap before the complete Phase 3 Config Unification is implemented, a pragmatic integration layer will be injected into the existing simulation context (`main.js`) to support new pixel formats and multi-spot form factors:

### 10.1 WebGL RGBWAU Downmixing
The 3D monitoring viewport operates exclusively within the visible RGB color space, meaning the expanded 6-channel logic must be mathematically downsampled into standard textures:
- **Change**: `patternEngine.renderPixel` calls will be upgraded to `renderPixel6ch(index, x, y, z)`.
- **Downmix Math**: Raw output will be aggressively mapped to simulated RGB boundaries. 
  - `W` (White) adds scalar intensity evenly to R, G, and B.
  - `A` (Amber) contributes warmth natively into the Red and Green boundaries.
  - `U` (UV/Purple) blends deep blues with localized red spikes.

### 10.2 Universal YAML-Driven Fixture Rendering (`ModelFixture.js`)
Instead of hardcoding each new fixture layout, `main.js` eagerly fetches the verified DMX model YAMLs (`model_119.yaml`, `model_10.yaml`, `model_33.yaml`) during boot. A new universal class, `ModelFixture.js`, accepts a parsed model object and constructs the corresponding 3D representation:
- **Shell**: `BoxGeometry` or `CylinderGeometry` from the `shell` schema, with correct dimensions (mm → meters) and offset.
- **Dots**: Each pixel's `dots` array creates small emissive `SphereGeometry` meshes at the exact spatial coordinates from the YAML.
- **SpotLights**: One `SpotLight` per pixel, positioned at the centroid of its dots, with 25° default beam angle.
- **Transform**: All elements live inside a `THREE.Group`. `TransformControls` on the hitbox moves the entire assembly in sync.
- **API**: `setPixelColorRGB(pixelIndex, r, g, b)` sets the color of a specific pixel's spotlight, beam cone, and dot meshes.

### 10.3 Dynamic GUI Typing & Render Loop
- **Change**: `params.parLights` entries in `scene_config.yaml` gain an optional `type` field (`ShehdsBar`, `UkingPar`, `VintageLed`). Entries without a `type` default to the existing `ParLight` class.
- **Execution**: `rebuildParLights()` checks `config.type` against the loaded `window.fixtureModels` registry. If a matching model exists, it instantiates a `ModelFixture` instead of a `ParLight`. The "Add Light" GUI gains dropdown options for each available DMX fixture type.
- **Render Loop (Resolved)**: Each pixel inside a `ModelFixture` is independent. An 18-pixel Shehds Bar consumes 18 sequential indices from `renderPixel6ch(offset + i)`, enabling continuous sweep animations across the physical array — exactly mirroring real DMX address cascading.

