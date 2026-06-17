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

> **How audio actually reaches patterns today:** the engine does *not* auto-inject `bpm/volume/...`.
> The implemented path is the **modulation system**: the audio analyzer publishes CPC signals
> `micLow` / `micMid` / `micHigh` / `micKick` (plus optional OSC stems `stemsBass/Drums/Vocals`), and
> a per-playlist-entry modulation mapping binds one of those sources onto a pattern's exported
> `slider*` parameter (`mode: offset|scale`, a `curve`, and a `range`). So to make a pattern
> audio-reactive you just expose ordinary `slider*` params (e.g. `sliderAudioKick`) and let the
> operator/playlist map `micKick → audioKick`. `micKick` is pre-shaped (envelope + Schmitt + hold)
> into a clean transient, which makes it the natural **trigger** for the feedback effects in §9.

---

## 9. Frame Feedback & Trails — Worked Examples

This section shows how to use the language's **frame-to-frame state persistence** (see
`MARSIN_PB_LANG_SPEC.md` §9.4–§9.5) to generate motion-trail effects. A compiled pattern is one
long-lived VM instance, so top-level `var`s and `array()`s keep their values between frames — that
single fact is what lets you build comets, pulses, ripples and ghosting.

All examples below were **compile- and run-validated** against the WASM VM. Three reminders that
make them correct:
1. Trig is **radians** — phases are turned into angles with `* PI2` (§4).
2. Reserved single-letter names (`i`, `t`, `h`, `f`, `p`, `q`, `r`, `g`, `b`, `x`, `y`, `z`,
   `index`, `pixelCount`) cannot be declared — loop with `k`, store brightness in `bri`, etc.
   (spec §2.4 / §7.3).
3. `pixelCount` bakes to a literal `~144`; size feedback buffers to your real model with an explicit
   constant `N`, not `pixelCount`.

### 9.1 Scalar decay-envelope trail (a pulse that fades)

The cheapest trail: one persistent scalar, snapped to `1.0` on an event and decayed each frame.
This is the engine behind heartbeats, pings, and searchlight afterglow.

```javascript
// pulse.js — a synchronized flash that leaves a fading afterglow.
var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
var fade = 0.5;                              // longer tail as this rises
export function sliderFade(v) { fade = v; }
export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

var clock = 0.0, env = 0.0, lastPhase = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  var dt = (delta / 1310.72) * localMult;
  clock = clock + dt * 0.5;
  var phase = clock % 1.0;
  if (phase < lastPhase) env = 1.0;          // fire on each wrap (swap for an audio kick — §9.3)
  lastPhase = phase;
  env = env - dt * (1.5 + fade * 4.0);       // decay the envelope toward 0
  if (env < 0.0) env = 0.0;
}

export function render3D(index, x, y, z) {
  hsv(cp1H, cp1S, env * cp1V);               // whole rig flashes + fades together
}
```

To make it travel instead of flashing globally, gate it by position: multiply `env` by
`smoothstep(headX + 0.1, headX, x)` where `headX = clock % 1.0`.

### 9.2 Per-pixel feedback buffer (a comet with a real tail)

For a head that **paints a fading tail into the pixels themselves**, keep your own brightness buffer.
Decay the whole buffer each frame, inject at the head, read `buf[index]` per pixel. This is the
negative-space "Single Comet" idea — maximally readable from far away.

```javascript
// comet.js — one bright head leaves a decaying trail across the rig.
var localSpeed = 0.5;
export function sliderLocalSpeed(v) { localSpeed = v; }
var tailLen = 0.6;                           // 0 = stub, 1 = long banner
export function sliderTailLen(v) { tailLen = 0.15 + v * 0.8; }
export var cp1H = 0.55, cp1S = 0.9, cp1V = 1.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

var N = 144;                                 // <-- set to your model's real pixel count
var buf = array(N);                          // persistent feedback buffer, allocated once at init
var head = 0.0;

export function beforeRender(delta) {
  var localMult = pow(2.0, (localSpeed - 0.5) * 4.0);
  head = (head + (delta / 1310.72) * localMult * 0.25) % 1.0;
  var decay = 1.0 - (1.0 - tailLen) * 0.25;  // closer to 1.0 => longer tail
  var k = 0;
  for (k = 0; k < N; k = k + 1) { buf[k] = buf[k] * decay; }   // fade every cell
  buf[floor(head * N) % N] = 1.0;            // paint the head into this frame
}

export function render3D(index, x, y, z) {
  hsv(cp1H, cp1S, buf[index] * cp1V);        // each pixel shows its own decaying memory
}
```

Variations from the same skeleton:
- **Ripple from one drop:** inject at a fixed center cell on a trigger, and in `render3D` read
  `buf[abs(index - center)]` so the stored envelope radiates outward.
- **Bassline snake:** drive `head` speed and `tailLen` from an audio param (§9.3) so the snake
  lengthens and accelerates with the bass.
- **Ink-in-water (near-field):** seed several cells with `random(1)` and use a gentler `decay` for a
  slow organic bloom.

### 9.3 Making a trail sound-reactive

Expose ordinary `slider*` params and let the modulation system feed audio into them (§8). The
cleanest trigger is `micKick → audioKick`:

```javascript
var audioKick = 0.0;
export function sliderAudioKick(v) { audioKick = v; }   // operator maps micKick onto this

export function beforeRender(delta) {
  // ... existing timing ...
  if (audioKick > 0.5) env = 1.0;            // re-fire the envelope on the beat instead of on a wrap
  // ... existing decay ...
}
```

For continuous "breathe with the music," map `micLow → sliderTailLen` (longer tails on the drops) or
`micHigh → a brightness slider` (sparkle on the hats). No render-math change needed — the modulation
controller writes the slider for you each frame.

### 9.4 Mixer-level trails (ghost any pattern, no code)

When you want trails on a pattern that manages no state of its own, skip the buffer entirely and turn
on the **`feedbackTrails` global effect** (`marsin_engine/effects/feedbackTrails.js`). It keeps an
RGBWAU trail buffer of the composited output and mixes it back with operator-tunable `decay`,
`injection`, `mix`, `colorBleed`, and `blendMode` (add / max / replace). This is the "ghost
everything" knob; §9.1–§9.2 are for trails baked into a specific pattern's design.

### 9.5 Gotchas (all verified)

| Gotcha | Why | Fix |
|---|---|---|
| Trail "teleports" off-screen | `pixelCount` is a literal `~144`, not your model size | use an explicit `var N = <model pixels>` for buffer size **and** head index |
| Trail vanishes on pattern change | state lives in the VM instance; a swap re-runs init | expected — never assume a trail survives a deck/pattern swap (spec §9.4) |
| `Cannot declare reserved name 'i'` | single letters are reserved slots | loop with `k`; name brightness `bri`, angle `ang`, etc. (spec §2.4) |
| Buffer alloc error / black pixels | allocating `array()` inside `render` | allocate once in **top-level init** (spec §7) |
| Motion ignores the global SPEED fader | SPEED scales `time()`, not raw `delta` | drive motion from `time()`, or accept that `delta` trails follow only `localSpeed` (spec §9.3) |
| Solid red pixels | exceeded 5000 instructions/pixel | keep the per-pixel path light; do the `O(N)` decay loop in `beforeRender`, not `render` |
