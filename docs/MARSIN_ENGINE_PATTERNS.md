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

## 7. Audio Reactivity (Planned Interfaces)

The audio analysis subsystem (currently in active integration) will expose frame-level audio metrics. Future patterns can declare these globals to receive automatic BPM and frequency spectrum sync:

```javascript
// Planned hooks (read-only when audio is active):
export var bpm = 120.0;
export var volume = 0.0; // overall gain (0..1)
export var bass = 0.0;   // low-frequency energy (0..1)
export var treble = 0.0; // high-frequency energy (0..1)
```
