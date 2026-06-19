# MarsinEngine Pattern Development Guide

This guide defines the engineering contracts, parameter conventions, and runtime lifecycles for developing LED patterns in the **MarsinEngine** ecosystem. 

For the formal grammar, syntax rules, and standard functions of the programming language, see the [MarsinScript Language Specification](file:///Users/ssolaimanpour/workspace/BM26-Titanic/docs/MARSIN_PB_LANG_SPEC.md).

---

## 0. Pattern consistency ground rules (every pattern)

These rules apply to **every** pattern in `marsin_engine/patterns/` — both new
work and upgrades of existing patterns — so the whole show reads as one
coherent, high-definition, sound-reactive library. The full recipe lives in the
skill `.agent/01_skills/12_highdef_pattern_generation.md`; this is the contract
it enforces.

1. **`localSpeed` is the first local control and is genuinely effective.**
   Motion visibly accelerates/decelerates across its range (see §3.2). Never
   declare it and leave it unused.
2. **Direction varies — it is not always forward.** Provide a guarded
   `direction`/sign control (§3.2, "avoid the static dead-zone") *and* give the
   pattern autonomous direction variation: some patterns **occasionally
   auto-switch direction on their own**, on an incommensurate (irrational)
   cadence so the rig never flips in lockstep. Motion should feel organic.
3. **High-definition + bright.** Crisp cores, true-black-ish negative space, a
   real per-channel peak at musical peaks, and two palette colours spanning the
   rig (strict `cp1`/`cp2`, §3.1, §7).
4. **Never static at zero audio.** With no modulation and all controls at
   default, the pattern still animates from the clock alone (never dead-static,
   never dead-black; keep a small non-black base for silence visibility).
5. **The direction parameter never freezes the pattern** at any value — guard
   the slider-centre dead-zone so it changes heading, never stalls.
6. **Validate in the gallery.** Render each pattern through the offline harness
   and publish it to the pattern gallery (skill `13_pattern_gallery.md`) for an
   on-device visual pass; iterate until it is visually appealing.
7. **Expose clearly audio-reactive knobs** — at minimum a movement **radius**
   (travel/scale extent) and a brightness **kick** (kick-driven brightness pop),
   plus 1–2 more natural to the pattern, each an identity `slider*` meant to be
   modulated (§3.2, §8). Audio is modulators-only — never read CPC audio globals
   natively (§8).

When upgrading an existing pattern, **preserve its identity** (concept, palette
feel, name) and modernize it to these rules — do not rewrite it into a different
pattern.

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
- **MANDATORY — `localSpeed` must actually drive motion, not merely exist.** Declaring
  the variable is NOT enough. Every pattern MUST have autonomous, continuous motion
  driven by the VM clock (`t`, `time(scale)`, or accumulated `delta`), and that motion's
  *rate* MUST be scaled by `localSpeed`. Canonical idiom:
  ```javascript
  export function beforeRender(delta) {
    var localMultiplier = pow(2.0, (localSpeed - 0.5) * 4.0); // 0.5->1x, 1->4x, 0->0.25x
    // advance a phase from the clock, trimmed by localSpeed (pick one style):
    phase = (phase + (delta / 65536.0) * localMultiplier) % 1.0;   // delta-driven
    // tPhase = time(BASE_SCALE / localMultiplier);                // time()-driven
  }
  ```
- **Why this also gives you GLOBAL speed for free.** The engine advances the VM clock by
  `wallDelta * globalSpeedMultiplier()` and hands the pattern that already-scaled clock
  (see `engine.js` `globalSpeedMultiplier` / `beginFrame(elapsed)`). So `t`, `time(scale)`,
  and `beforeRender`'s `delta` are ALL pre-scaled by the global SPEED fader. Drive motion
  from those (× `localSpeed`) and the pattern automatically obeys **both** global speed
  (engine) and local speed (slider). Do not invent a separate clock.
- **No dead-static patterns.** A pattern whose only motion comes from audio modulation —
  or from any control that can sit at zero — freezes when nothing is mapped or the fader
  is centered. That is a bug. There MUST be a baseline clock-driven animation that still
  moves (and responds to `localSpeed`) with no audio mapped and every other control at
  default. Audio/other controls then *modulate* that baseline motion, never gate it to a
  standstill.

#### Direction / sign parameters (avoid the static dead-zone)
- A `direction` slider commonly maps `globalDir = (v * 2.0) - 1.0` and multiplies the
  phase increment by it — which means slider-center (`v = 0.5 → globalDir = 0`) FREEZES
  the pattern (and the engine may apply a `0.5` default at load, so it ships frozen).
  Never leave that dead-zone in. Guard the magnitude so the effective direction is always
  slightly positive or slightly negative — never exactly 0:
  ```javascript
  export function sliderDirection(v) {
    var d = (v * 2.0) - 1.0;
    if (d >= 0.0 && d < 0.06) d = 0.06;       // never freeze; bias slightly forward
    else if (d < 0.0 && d > -0.06) d = -0.06; // ...or slightly reverse
    globalDir = d;
  }
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

## 8. Audio Reactivity (Modulators-Only Policy)

**Operator decision (2026-06-17): patterns MUST NOT read live audio signals
natively.** There is no "declare `export var micLow` and the engine feeds it"
path any more — it was removed. A pattern that declares an `export var` whose
name matches a live audio key (`micLow`, `micDomEnergy1`, `audioBuildScore`, …)
will **not** receive the CPC audio value; the engine refuses to bind live
audio-family keys into pattern globals (`lib/param_center.js` `registerChannel`
skips them; the exclusion set is `isLiveAudioSharedFnName` in
`audio/postproc/audio_signals.js`).

### 8.1 The contract

Audio reactivity is built in two pieces:

1. **The pattern exposes a SLIDER param** for the thing audio should drive,
   with a default value that looks good at rest (no audio). The pattern reads
   only that slider — never a CPC audio global. Example:

   ```javascript
   export var domEnergy = 0.6;            // 0..1, looks lively at rest
   export function sliderDomEnergy(v) { domEnergy = v; }
   // ... render reads `domEnergy`, never `micDomEnergy1`.
   ```

2. **A MODULATION mapping couples an audio source to that slider**, declared
   on the playlist entry (`simulation/scenes/<scene>/playlists/<name>.yaml`,
   which is also the engine's playlist library). The modulation engine
   (`lib/modulation_engine.js`) reads the source from the CPC each frame and
   writes the modulated value to the slider through the normal control path:

   ```yaml
   modulations:
     - id: mod_sliderDomEnergy_micDomEnergy1
       type: continuous
       enabled: true
       source:    { scope: cpc, key: micDomEnergy1 }
       target:    { scope: pattern, parameter: sliderDomEnergy }
       mode: offset          # or scale
       polarity: unipolar    # or bipolar
       range: [0, 0.4]       # how far the source pushes the slider
       curve: easeOut        # linear | easeIn | easeOut | exp
   ```

At slider default (no mapping, or source silent) the pattern renders its
resting look — codex P0, no black-outs, no fallback.

### 8.2 Available audio sources

Any CPC key can be a modulation source — sources are **not** allow-listed. The
live audio family (the source of truth is `audio/postproc/audio_signals.js`)
includes:

| Key(s) | Meaning |
|---|---|
| `micLow`, `micMid`, `micHigh`, `micKick`, `micFlux` | Mic band energies / kick / spectral flux (0..1) |
| `micDomFreq1/2`, `micDomEnergy1/2` | Dominant-frequency analyzer outputs (Hz / 0..1) |
| `tempoBpm`, `audioBpm`, `audioBeat`, `audioBeatInBar`, `audioBarPhase`, `audioDownbeat` | Tempo / beat-grid signals |
| `audioStructure`, `audioBuildScore`, `audioEnergyRatio`, `audioVocalsHot`, `audioDropPulse`, `audioSlowZone` | Structure-detector outputs |
| `audioParty`, `audioNote`, `audioNoteHue`, `audioSwitchPattern`, `audioSwitchColor` | Derived cue signals |

These are fed by the Audio Companion (the sole analyzer) over OSC. They live
in the CPC as `live:true` params and are broadcast to CaptainPad for the ghost
slider, but they are **never** injected into pattern globals — only modulators
read them.

> The persistent `*Gain` knobs (`micLowGain`, …) are operator levels, not
> signals; they are not part of the live set and are not modulation sources.

---

## 9. Signal-to-Visual Patterns (audio-reactive-ready)

The modulators-only contract (§8) is the foundation of a whole *family* of
patterns we call **signal-to-visual**: the pattern renders a look built from a
few well-chosen, **named visual characteristics**, and every one of those
characteristics is a plain `slider*` that a modulation can drive. The pattern
never reads audio — it just exposes the *handles*; the show wires a signal (an
audio key, a hand fader, an LFO) onto each handle. The same pattern is a calm
idle at rest and a tightly audio-locked instrument once mapped, with **no code
change**.

### 9.1 Factor the look into modulatable characteristics

The design move is to decompose a visual into independent, individually
modulatable parameters — then expose each as a slider with a resting default
that already looks good (codex P0: alive at zero audio). Typical handles:

| Characteristic | What it controls | Example coupling |
|---|---|---|
| **position** | where the effect sits — x along a row, y up a column, an angle around a ring | `micLow → position` (signal literally moves the visual) |
| **movement radius / orbit** | how far it travels around an anchor | modulate this and a static point becomes a **circulating** pattern |
| **width / size** | how many pixels the effect covers | `micKick → width` (punch widens it) |
| **energy / intensity** | how hot it burns (brightness, core pop, halo) | `micDomEnergy1 → energy` |
| **speed** | how fast it animates | `audioBpm → speed` (beat-locked) |
| **trail / persistence**, **blur**, **hue / palette position**, **count** | the supporting texture | `audioBuildScore → trail`, `audioNoteHue → palette` |

Pick a small, orthogonal set, name them plainly, and let modulations (§8) do
the rest. A position-style signal (`micLow`, `micDomEnergy1`) on **position**
gives a wave that tracks the music; the same signal on **radius** gives an
orbit that breathes; on **energy** gives a pulse. One pattern, many shows.

### 9.2 `27_swipe` — the simplest high-definition, audio-reactive-ready pattern

`27_swipe` is the canonical starting point of this family — **the simplest
member, but a real start for beautiful things.** It does one thing — a single
sharp pixel sweeping a fixture — but it does it as a clean signal-to-visual
surface:

- **`swipePos`** is the modulatable **position**: drive it with any audio key
  and the lit pixel tracks the signal — a literal *signal → position* visual.
- **`swipeWidth` / `blur`** are size/softness, **`trail`** is persistence,
  **`swipeDir`** flips travel, **`shift`** calibrates the zero-point to the rig.
- A **sharp single-pixel core on true black** (`BASE_FLOOR = 0`) is what makes
  it **high definition**: every modulation of `swipePos` reads as a crisp,
  exact move, not a mushy glow. High contrast + high definition is what lets the
  audio signal show through faithfully.

It is deliberately one moving point, but the recipe scales straight up: add a
`radius` + `angle` for an orbiting effect; run several emitters each with its
own `position`/`energy`; layer `width`/`hue` modulations. The dancer patterns
(e.g. `26_dom_dancers_chevron`) are richer members of the same family — gliding
orbs whose position and energy are the modulation handles. Start at the swipe;
build toward the beautiful things.
---

## 10. Frame Feedback & Trails — Worked Examples

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

### 10.1 Scalar decay-envelope trail (a pulse that fades)

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
  if (phase < lastPhase) env = 1.0;          // fire on each wrap (swap for an audio kick — §10.3)
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

### 10.2 Per-pixel feedback buffer (a comet with a real tail)

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
- **Bassline snake:** drive `head` speed and `tailLen` from an audio param (§10.3) so the snake
  lengthens and accelerates with the bass.
- **Ink-in-water (near-field):** seed several cells with `random(1)` and use a gentler `decay` for a
  slow organic bloom.

### 10.3 Making a trail sound-reactive

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

### 10.4 Mixer-level trails (ghost any pattern, no code)

When you want trails on a pattern that manages no state of its own, skip the buffer entirely and turn
on the **`feedbackTrails` global effect** (`marsin_engine/effects/feedbackTrails.js`). It keeps an
RGBWAU trail buffer of the composited output and mixes it back with operator-tunable `decay`,
`injection`, `mix`, `colorBleed`, and `blendMode` (add / max / replace). This is the "ghost
everything" knob; §10.1–§10.2 are for trails baked into a specific pattern's design.

### 10.5 Gotchas (all verified)

| Gotcha | Why | Fix |
|---|---|---|
| Trail "teleports" off-screen | `pixelCount` is a literal `~144`, not your model size | use an explicit `var N = <model pixels>` for buffer size **and** head index |
| Trail vanishes on pattern change | state lives in the VM instance; a swap re-runs init | expected — never assume a trail survives a deck/pattern swap (spec §9.4) |
| `Cannot declare reserved name 'i'` | single letters are reserved slots | loop with `k`; name brightness `bri`, angle `ang`, etc. (spec §2.4) |
| Buffer alloc error / black pixels | allocating `array()` inside `render` | allocate once in **top-level init** (spec §7) |
| Motion ignores the global SPEED fader | SPEED scales `time()`, not raw `delta` | drive motion from `time()`, or accept that `delta` trails follow only `localSpeed` (spec §9.3) |
| Solid red pixels | exceeded 5000 instructions/pixel | keep the per-pixel path light; do the `O(N)` decay loop in `beforeRender`, not `render` |
