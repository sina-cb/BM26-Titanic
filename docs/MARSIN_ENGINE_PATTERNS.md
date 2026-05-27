# MarsinEngine Pattern Development Guide

This guide defines the engineering contracts, parameter conventions, and runtime lifecycles for developing LED patterns in the **MarsinEngine** ecosystem. 

For the formal grammar, syntax rules, and standard functions of the programming language, see the [MarsinScript Language Specification](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/MARSIN_PB_LANG_SPEC.md).

---

## 1. Engine Architecture & Environment

Every pattern is written in MarsinScript (a Javascript-like dialect compiling to stack-based bytecode) and executes inside the **MarsinVM** WebAssembly sandboxed runtime.

```
                  ┌──────────────────────────────────────────┐
                  │          CaptainPad UI / CPC             │
                  └──────┬────────────────────────────┬──────┘
                         │ Global Parameter sync     │ Local Slider inputs
                         ▼                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ MarsinEngine Node Host                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ WasmHost (batch renders beforeRender + render3D per pixel)       │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │ MarsinVM Runtime                                           │  │  │
│  │  │  - Globals (cp1H/cp2H, speed, sectionId, etc.)             │  │  │
│  │  │  - Bytecode execution (strict 5000 instr/pixel limit)      │  │  │
│  │  │  - 6-channel RGBWAU Color Output                          │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Execution Lifecycle

Each pattern script implements two main entrypoint lifecycles:

### 2.1 Frame Initialization: `beforeRender(delta)`
- Runs **once per frame** prior to rendering pixels.
- **Contract**: Receives `delta` (elapsed wall-clock time in milliseconds).
- **Timing Best Practice**: To prevent stuttering or "phase-jumps" when speed sliders are dragged, **never** calculate coordinates by scaling absolute wall-clock `time()`. Instead, accumulate delta-time offsets locally:
  ```javascript
  var tPhase = 0.0;
  
  export function beforeRender(delta) {
    // Compounding global speed multiplier and local speed trim
    var globalMult = pow(2.0, (speed - 0.5) * 4.0);
    var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
    var overallSpeed = globalMult * localMult;

    // Normal loop duration is 1310.72ms
    tPhase = (tPhase + (delta / 1310.72) * overallSpeed) % 1.0;
    if (tPhase < 0.0) tPhase += 1.0;
  }
  ```

### 2.2 Pixel Calculation: `render3D(index, x, y, z)`
- Runs **per pixel** per frame.
- **Contract**: Receives:
  - `index`: Index of the current pixel (0 to `pixelCount - 1`).
  - `x`, `y`, `z`: Normalized physical coordinates mapping the pixel in the 3D volume.
- **Output**: Terminal execution is reached when a color function (e.g. `rgbwau()`) is called, returning a pixel state to the host.

---

## 3. Parameter Binding Contracts

MarsinEngine utilizes a strict parameter binding contract between the pattern scripts and the **CaptainPad Controller (CPC)** interface.

### 3.1 Global Parameters (Shared Sync)
Global parameters are synchronized across all running decks. If you declare these variables or functions, the CPC will automatically bind them to the global system controls:

#### Global Speed (`speed`)
- Controls the master speed of the engine.
- Binds to:
  ```javascript
  export var speed = 0.5; // CPC maps this 0.0 to 1.0
  ```

#### Global Palettes (`colorPalette1` & `colorPalette2`)
- Control the color spectrum for strict color-palette compliance.
- Binds to:
  ```javascript
  export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
  export var cp2H = 0.08, cp2S = 1.0, cp2V = 1.0;
  
  export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
  export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }
  ```
- **Palette Rules**: To maintain consistent lighting design, patterns should by default restrict all colors to a linear interpolation between `colorPalette1` and `colorPalette2` (plus black/white offsets). Avoid hardcoding static color sweeps.

---

### 3.2 Local Parameters (Deck Sliders)
Local parameters are unique to each deck slot and are mapped to UI sliders in the CaptainPad interface.

#### Local Speed Trim (`localSpeed`)
- Used to tune the speed of a specific visual playlist slot without altering the global BPM.
- **Standard Convention**: Make this the **first** local parameter in your file:
  ```javascript
  export var localSpeed = 0.5; // Local speed trim variable
  export function sliderLocalSpeed(v) { localSpeed = v; }
  ```

#### Custom Parameter Sliders (`slider*`)
- Any exported function beginning with the prefix `slider` is registered as a custom deck slider (inputs scaled `0.0` to `1.0`).
- **Ordering**: The order in which custom parameters appear in the CaptainPad UI is determined by the **declaration order of the `slider*` functions in the source file**.
  ```javascript
  // Declared first -> Appears first in the UI
  export var localSpeed = 0.5;
  export function sliderLocalSpeed(v) { localSpeed = v; }

  // Declared second -> Appears second in the UI
  export var noiseScale = 0.5;
  export function sliderNoiseScale(v) { noiseScale = 0.1 + (v * 0.8); }
  ```

---

## 4. Trigonometry and Radians Migration

The MarsinVM math parser is fully migrated to JavaScript-compliant **radians** trig semantics (replacing the turn-based structures historically found in Pixelblaze).

### 4.1 Radian Trigonometric Functions
`sin(x)`, `cos(x)`, `tan(x)`, `asin(x)`, `acos(x)`, `atan(x)`, and `atan2(y, x)` expect and return values in **radians** (`-PI` to `PI` or `0` to `PI2`).

To convert coordinate phases (which are naturally `0..1` turns) to radians, multiply by `PI2`:
```javascript
// Spatial cycle mapping (e.g. 10 cycles across x)
var angle = (x * 10.0) * PI2;
var amplitude = sin(angle + beatPhase); // beatPhase is in radians
```

### 4.2 The Wave Exception: `wave(x)`
- `wave(x)` is a specialized shortcut function equivalent to `(1.0 + sin(x * PI2)) * 0.5`.
- **Contract Exception**: The input `x` to `wave(x)` is **still turn-based** (`0..1` turns). If your input is already in radians, divide by `PI2` before passing it to `wave()`:
  ```javascript
  var colorBlend = wave((radianOffset) / PI2);
  ```

---

## 5. Multichannel Color Output (RGBWAU)

MarsinEngine natively supports 6-channel **RGBWAU** color mixing (Red, Green, Blue, White, Amber, UV) via the `rgbwau(r, g, b, w, a, u)` function.

- **White (W) / Amber (A)**: Essential for rendering warm sunset washes, vintage filament bulbs, and clean highlights.
- **UV (U)**: Used to drive dark-light tones and blacklight aesthetics.
- **Approximated RGB Fallback**: If the output fixture is RGB-only (e.g., standard pixel strips), the engine automatically down-mixes the output using perceptual approximations:
  $$\text{displayR} = \min(1.0, R + W + 0.8A + 0.1U)$$
  $$\text{displayG} = \min(1.0, G + W + 0.4A)$$
  $$\text{displayB} = \min(1.0, B + W + 0.5U)$$

---

## 6. Hardware Metadata Reactivity

Patterns can dynamically adapt their visuals depending on which physical fixture or section of the rig they are rendering. The engine automatically injects four metadata variables per pixel:

| Variable | Type | Description |
|---|---|---|
| `controllerId` | number | Unique ID of the physical hardware controller. |
| `sectionId` | number | Rig section (e.g., `1` = Pars, `2` = Vintage, `3` = Bars). |
| `fixtureId` | number | Specific fixture classification ID. |
| `viewMask` | bitmask | Bitmask of view states this pixel belongs to. |

### 6.1 Writing Multi-Fixture Visuals
Use `sectionId` to apply different emitter configurations or logic. For instance, push pure whites to Vintage bulbs while pushing rich colors to the LED bars:

```javascript
export function render3D(index, x, y, z) {
  var color = wave(x + tPhase);
  
  if (sectionId == 2) {
    // Vintage bulbs: Rich amber glow
    rgbwau(0, 0, 0, color, color * 0.4, 0);
  } else {
    // Pars/Bars: Palette color sweep
    var h = mix(cp1H, cp2H, color);
    hsv(h, 1.0, 1.0);
  }
}
```

---

## 7. Pattern-Local Palette Helpers (`_hsv2rgb1` / `_hsv2rgb2`)

> **Status:** required pattern-local idiom today, slated to become language-level built-ins (`paletteRgb1()` / `paletteRgb2()`). See [§6.x — Future: Built-in palette accessors](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/MARSIN_PB_LANG_SPEC.md#6.x-future-built-in-palette-accessors-paletterbg1-paletterbg2).

### 7.1 The problem these helpers solve

Patterns receive the two global palette pickers as **HSV** triplets (`cp1H/cp1S/cp1V`, `cp2H/cp2S/cp2V`). The naïve "blend in HSV-space" approach has two failure modes that have caused every "weird colour appearing" bug operators have reported on stage:

1. **Hue-shortest-path traversal.** Interpolating `cp1H → cp2H` walks *around* the colour wheel. When the picker pair is, e.g., red (h=0.0) + blue (h=0.6), the intermediate hues are purple, magenta, pink, deep red — none of which the operator picked. With a complementary pair like blue + orange the midpoint becomes green. The cleanest fix is to convert each picker to RGB **once** and lerp in linear-RGB space — the output then stays strictly on the straight line between the two pickers and nothing else.

2. **Rainbow-wave synthesis leaks third hues.** A common compact pattern idiom — `r = v * wave(h + 0.000); g = v * wave(h + 0.333); b = v * wave(h + 0.666);` — *always* emits non-zero values on all three channels regardless of `h` and saturation. This is why patterns 06, 08, 11, 14, 16, 21, 23 used to "follow the palette but with weird colours mixed in". RGB lerping between two pre-converted endpoints fixes all of these at once.

### 7.2 The canonical idiom (copy-paste this into every new pattern)

Each pattern that wants strict cp1↔cp2 blending declares this once. The two helpers are run **inside `beforeRender`** so the conversion happens once per frame (instead of per pixel), and the per-pixel `render3D` path then lerps using the cached `pr1/pg1/pb1` and `pr2/pg2/pb2`.

```javascript
// ── Palette RGB cache (strict cp1<->cp2 blending) ─────────────────────
// Pre-convert cp1/cp2 (HSV) to RGB once per frame, then lerp in RGB-space
// in the per-pixel path. This guarantees output stays on the straight line
// between the two pickers (e.g. red+blue -> only red/magenta/blue, no
// green/yellow/cyan drift from HSV shortest-path interpolation).
var pr1 = 1, pg1 = 0, pb1 = 0;
var pr2 = 0, pg2 = 0, pb2 = 1;
function _hsv2rgb1() {
  var hv = cp1H - floor(cp1H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp1V * (1 - cp1S);
  var qv = cp1V * (1 - fv * cp1S);
  var tv = cp1V * (1 - (1 - fv) * cp1S);
  if      (iv == 0) { pr1 = cp1V; pg1 = tv;   pb1 = pv;   }
  else if (iv == 1) { pr1 = qv;   pg1 = cp1V; pb1 = pv;   }
  else if (iv == 2) { pr1 = pv;   pg1 = cp1V; pb1 = tv;   }
  else if (iv == 3) { pr1 = pv;   pg1 = qv;   pb1 = cp1V; }
  else if (iv == 4) { pr1 = tv;   pg1 = pv;   pb1 = cp1V; }
  else              { pr1 = cp1V; pg1 = pv;   pb1 = qv;   }
}
function _hsv2rgb2() {
  var hv = cp2H - floor(cp2H); if (hv < 0) hv += 1;
  var iv = floor(hv * 6) % 6;
  var fv = hv * 6 - floor(hv * 6);
  var pv = cp2V * (1 - cp2S);
  var qv = cp2V * (1 - fv * cp2S);
  var tv = cp2V * (1 - (1 - fv) * cp2S);
  if      (iv == 0) { pr2 = cp2V; pg2 = tv;   pb2 = pv;   }
  else if (iv == 1) { pr2 = qv;   pg2 = cp2V; pb2 = pv;   }
  else if (iv == 2) { pr2 = pv;   pg2 = cp2V; pb2 = tv;   }
  else if (iv == 3) { pr2 = pv;   pg2 = qv;   pb2 = cp2V; }
  else if (iv == 4) { pr2 = tv;   pg2 = pv;   pb2 = cp2V; }
  else              { pr2 = cp2V; pg2 = pv;   pb2 = qv;   }
}

export function beforeRender(delta) {
  // ... pattern timing math ...
  _hsv2rgb1();
  _hsv2rgb2();
}

export function render3D(index, x, y, z) {
  var t = /* your 0..1 blend factor */;
  var v = /* your 0..1 brightness  */;
  var r = (pr1 + (pr2 - pr1) * t) * v;
  var g = (pg1 + (pg2 - pg1) * t) * v;
  var b = (pb1 + (pb2 - pb1) * t) * v;
  rgb(r, g, b);
}
```

### 7.3 Why the locals are named `hv/iv/fv/pv/qv/tv`

MarsinScript reserves single-letter identifiers (`h`, `i`, `f`, `p`, `q`, `t`, `r`, `g`, `b`) for built-in slots and per-pixel context — declaring `var i = ...` triggers a compile error (`Cannot declare reserved name 'i'`). Always use the two-character `*v` suffix inside palette helpers. See also `MARSIN_PB_LANG_SPEC.md` §2.4 (Reserved identifiers).

### 7.4 When to opt out

The strict cp1↔cp2 contract is the default for production patterns, but two exceptions are legitimate:

- **Hardcoded section-driven colours (`sectionId`).** Patterns that intentionally drive different fixture sections in different palette positions (e.g. cp1 on the bars, cp2 on the vintage row) still use the helpers, but pick `tColour` from `sectionId` instead of a continuous gradient.
- **W / A / UV emitters.** Additive writes to the W/A/UV channels on top of the RGB lerp are fine — they don't pollute the palette hue because they sit on dedicated emitters. Expose them as named sliders (`sliderWhiteLift`, `sliderUvLevel`, …) so operators can disable them per show.

### 7.5 Patterns that depend on this idiom today

`01_cylon_sweep`, `03_dual_axis_crush`, `06_neon_elevator`, `08_ocean_liner`, `11_bioluminescence`, `13_sparkle`, `14_lunar_current`, `16_ghost_tide_uv`, `20_parametric_sway_field`, `21_pelagic_manta_rays`, `23_prismatic_strange_attractors`, `24_chromatic_murmuration`, `25_heartbeat`. All 13 have identical `_hsv2rgb1` and `_hsv2rgb2` bodies — the proposed language built-in collapses these to two function calls.

---

## 8. Audio Reactivity (Planned Interfaces)

The audio analysis subsystem (currently in active integration) will expose frame-level audio metrics. Future patterns can declare these globals to receive automatic BPM and frequency spectrum sync:

```javascript
// Planned hooks (read-only when audio is active):
export var bpm = 120.0;
export var volume = 0.0; // overall gain (0..1)
export var bass = 0.0;   // low-frequency energy (0..1)
export var treble = 0.0; // high-frequency energy (0..1)
```
