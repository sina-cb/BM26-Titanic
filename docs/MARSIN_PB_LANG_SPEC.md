# MarsinScript Language Specification

**Version**: 2.1
**Last Updated**: 2026-04-15
**Status**: Authoritative for the current Marsin compiler, VM, firmware runtime, simulator, and WASM surface. Where implementation caveats still exist, they are called out explicitly.

MarsinScript has two separate script environments:

1. **Pattern scripts**: Compiled to bytecode and executed by `MarsinVM`.
2. **Model scripts**: Executed in a host JavaScript environment to generate pixel maps.

This document covers both, with most detail focused on the pattern language.

---

## 1. Core Concepts

### 1.1 Pattern script lifecycle

Pattern scripts are compiled into three bytecode sections:

- **Init**: Top-level statements outside functions. Runs once when the script loads or resets.
- **beforeRender(delta)**: Runs once per frame.
- **Render entrypoint**: Runs once per pixel.

Top-level init is the correct place to allocate long-lived arrays, define lookup tables, and initialize persistent state.

### 1.2 Canonical internal color type: `MarsinPixel`

Inside the engine, the canonical pixel type is:

```cpp
struct MarsinPixel {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  uint8_t w;
  uint8_t a;
  uint8_t u;
};
```

Meaning:

- `r`, `g`, `b`: red, green, blue
- `w`: white
- `a`: amber
- `u`: UV

`MarsinPixel` is **not** a script-visible type. Pattern scripts do not construct it directly. It is produced internally by the color-output builtins:

- `hsv(h, s, v)` -> RGB only
- `rgb(r, g, b)` -> RGB only
- `rgbwau(r, g, b, w, a, u)` -> Marsin extension, full RGBWAU

For Pixelblaze-compatible scripts using only `hsv()` and `rgb()`, the `w/a/u` channels are always `0`.

### 1.3 Pixelblaze-compatible RGBW philosophy

MarsinScript keeps Pixelblaze-compatible RGBW semantics in the **core language**:

- There is **no** core-language `rgbw()` builtin.
- Standard scripts express color with `rgb()` and `hsv()`.
- On a real RGBW transport, white should be derived from RGB at the output layer:

```text
m = min(r, g, b)
outR = r - m
outG = g - m
outB = b - m
outW = m
```

This means `rgb(1, 1, 1)` prefers the white element on RGBW hardware, which matches the Pixelblaze approach.

Current Marsin phase-1 note:

- Firmware output is still RGB-only.
- The browser live visualizer is still RGB-only.
- Marsin-specific `rgbwau()` exists for direct multi-emitter control, but it is **not** Pixelblaze-compatible.

### 1.4 RGB fallback behavior on RGB-only hardware

On RGB-only hardware (all current installations), the firmware calls `MarsinPixel::toRGBFallback()` to convert 6-channel output to 3-channel:

```text
outR = min(255, R + W + A×0.8 + U×0.1)
outG = min(255, G + W + A×0.4)
outB = min(255, B + W + U×0.5)
```

**No visual regression for existing patterns:** For scripts that only use `rgb()` or `hsv()`, the W/A/U channels are always 0. The formula reduces to `outR = R`, `outG = G`, `outB = B` — **bit-identical** to the pre-RGBWAU engine output.

**For `rgbwau()` patterns on RGB hardware:** The WAU channels are additively mixed into visible RGB using perceptual approximations:
- **White (W)** adds equally to R, G, B → appears as a brightness boost.
- **Amber (A)** contributes 80% R, 40% G → warm orange tint.
- **UV (U)** contributes 10% R, 50% B → deep violet tint.

This means a pattern like `rgbwau(1, 0, 0, 0.5, 0, 0)` will appear as a warm pinkish-red on RGB hardware (red + white mix), which is the closest visual approximation to a dedicated red LED + white LED fixture.

When native RGBWAU fixtures are supported in a future phase, the firmware will output all 6 channels directly without fallback.

---

## 2. Pattern Scripts

### 2.1 Entry points

Supported entry points:

- `beforeRender(delta)`
- `render(index, x, y, z)`
- `render2D(index, x, y)`
- `render3D(index, x, y, z)`

Notes:

- `beforeRender` is optional.
- At least one render entrypoint is required.
- Host tools may prefer `render3D`, then `render2D`, then `render`.
- For widest portability, `render(index, x, y, z)` is the safest single entrypoint.
- If you provide multiple render entrypoints, keep them consistent and use wrappers where practical.

Example:

```javascript
var phase = 0

export function beforeRender(delta) {
  phase = time(0.1)
}

export function render(index, x, y, z) {
  hsv(phase + x, 1, 1)
}
```

### 2.2 Data model

The MarsinVM is fundamentally a numeric VM.

Pattern scripts support:

- **Numbers**: all scalar values are floats
- **Booleans**: represented as `0.0` or `1.0`
- **Arrays**: supported via array references and indexed access

Pattern scripts do **not** support:

- strings
- objects
- classes
- closures
- exceptions
- module imports

### 2.3 Variable storage model

MarsinScript uses a **flat named-slot storage model**, not full JavaScript lexical scope.

Rules:

- `var` is supported, but it does **not** create block scope.
- Named variables are stored in a shared script-wide symbol table.
- Function arguments also occupy named storage slots.
- Reusing a variable name in another function refers to the same storage slot.
- There is no `let` or `const`.

Practical consequences:

- Treat `var` as declaration syntax only.
- Do not rely on block scope.
- Keep helper-function argument names distinct and intentional.
- Prefer top-level initialization plus `beforeRender` updates for persistent state.

### 2.4 Reserved identifiers

These names are reserved and may not be assigned to or declared as variables:

- `t`
- `i`
- `index`
- `x`
- `y`
- `z`
- `pixelCount`
- `PI`
- `PI2`
- `true`
- `false`
- `controllerId`
- `sectionId`
- `fixtureId`
- `viewMask`

Built-in render parameters:

- `index` or `i`: current pixel index
- `x`, `y`, `z`: current pixel coordinates
- `t`: VM time in seconds
- `controllerId`: numeric controller ID from model metadata (0 if no metadata)
- `sectionId`: numeric section ID from model metadata (0 if no metadata)
- `fixtureId`: numeric fixture ID from model metadata (0 if no metadata)
- `viewMask`: bitmask of views this pixel belongs to (0 if no metadata)

### 2.5 Top-level init

Top-level statements outside functions compile into the init section and run once when the script loads or resets.

Use top-level init for:

- `array(size)` allocation
- array literals
- palette tables
- persistent state defaults

Example:

```javascript
var palette = [0.0, 0.15, 0.33, 0.66]
var accum = 0
var history = array(16)

export function beforeRender(delta) {
  accum += delta / 1000
}

export function render(index, x, y, z) {
  hsv(palette[index & 3] + accum, 1, 1)
}
```

---

## 3. Syntax and Control Flow

Supported statements:

- variable declaration: `var x = ...`
- assignment: `x = ...`
- compound assignment: `+=`, `-=`, `*=`, `/=`
- increment/decrement: `x++`, `x--`
- array element assignment: `arr[i] = ...`
- array compound assignment: `arr[i] += ...`, `-=`, `*=`, `/=`
- `if / else`
- `while`
- `for (init; cond; step)`
- `break`
- `continue`
- `return`
- user-defined functions

Supported comments:

- single-line comments: `// ...`
- block comments: `/* ... */`

Example:

```javascript
function pulse(v) {
  return v * v
}

export function render(index, x, y, z) {
  var v = wave(time(0.1) + x)

  if (v > 0.5) {
    rgb(pulse(v), 0, 0)
  } else {
    rgb(0, 0, pulse(1 - v))
  }
}
```

---

## 4. Expressions and Operators

Supported operators:

- arithmetic: `+`, `-`, `*`, `/`, `%`
- unary: `-`, `!`, `~`
- comparison: `<`, `>`, `<=`, `>=`, `==`, `!=`
- logical: `&&`, `||`
- bitwise: `&`, `|`, `^`, `~`, `<<`, `>>`
- ternary: `condition ? a : b`
- postfix indexing: `arr[i]`

Logical semantics:

- `0.0` is false
- any non-zero value is true
- `&&` and `||` short-circuit and produce numeric boolean results (`0` or `1`)
- comparison operators produce `0` or `1`

Bitwise semantics:

- operands are coerced to signed 32-bit integers
- results are returned to the VM stack as floats

Operator precedence, highest to lowest:

1. postfix indexing `[]`
2. unary `- ! ~`
3. multiplicative `* / %`
4. additive `+ -`
5. shift `<< >>`
6. relational `< <= > >=`
7. equality `== !=`
8. bitwise `&`
9. bitwise `^`
10. bitwise `|`
11. logical `&&`
12. logical `||`
13. ternary `?:`

---

## 5. Built-in Variables and Constants

### 5.1 Built-in variables

- `t`: VM time in seconds
- `index` / `i`: pixel index
- `x`, `y`, `z`: current coordinates
- `pixelCount`: reserved built-in name

Important current implementation note:

- `pixelCount` is **currently compiled as a literal `144`** by the compiler, not the true runtime pixel count.
- Existing patterns use it heavily, but this is a known implementation limitation.
- If you need portable behavior today, prefer deriving normalized position from `x` where possible instead of relying on `pixelCount`.

### 5.2 Model metadata variables (Marsin extension)

These built-in variables expose per-pixel metadata from v2 model files. They are **read-only** and populated by the firmware render loop at each pixel.

| Variable | Type | Default | Description |
|---|---|---|---|
| `controllerId` | uint16 | 0 | Numeric ID of the controller rendering this pixel |
| `sectionId` | uint16 | 0 | Numeric ID of the section (e.g., left/center/right) |
| `fixtureId` | uint16 | 0 | Numeric ID of the fixture (e.g., shop_sign, test_bench) |
| `viewMask` | uint16 | 0 | Bitmask of views this pixel belongs to |

All four variables are `0` when:
- The model is a v1 flat or v1 keyed model (no metadata)
- The caller does not supply metadata (e.g., MarsinLED browser UI simulation fallback)

Patterns should **always** handle the `0` (no metadata) case as a fallback:

```javascript
if (sectionId == 0) {
  // v1 fallback — use coordinate thresholds
  if (x < 0.33) {
    hsv(0.0, 1, 1);  // Red
  } else if (x < 0.67) {
    hsv(0.33, 1, 1);  // Green
  } else {
    hsv(0.66, 1, 1);  // Blue
  }
} else {
  // v2 metadata path — use section ID
  if (sectionId == 1) {
    hsv(0.0, 1, 1);   // Red
  } else if (sectionId == 2) {
    hsv(0.33, 1, 1);  // Green
  } else if (sectionId == 3) {
    hsv(0.66, 1, 1);  // Blue
  }
}
```

#### viewMask usage

`viewMask` is a bitmask. Use bitwise AND to check membership:

```javascript
var VIEW_ALL = 1;
var VIEW_LEFT = 2;
var VIEW_CENTER = 4;
var VIEW_RIGHT = 8;

if (viewMask & VIEW_LEFT) {
  // This pixel is visible in the "left" view
  hsv(0.0, 1, 1);
}
```

### 5.3 Constants

- `PI`
- `PI2`
- `true`
- `false`

---

## 6. Built-in Functions

### 6.1 Trigonometry and core math

| Function | Args | Notes |
|---|---:|---|
| `sin(x)` | 1 | Input is in turns, not radians |
| `cos(x)` | 1 | Input is in turns, not radians |
| `tan(x)` | 1 | Input is in turns, not radians |
| `asin(x)` | 1 | Returns turns |
| `acos(x)` | 1 | Returns turns |
| `atan(x)` | 1 | Returns turns |
| `atan2(y, x)` | 2 | Returns turns |
| `pow(base, exp)` | 2 | |
| `sqrt(x)` | 1 | |
| `exp(x)` | 1 | |
| `log(x)` | 1 | natural log |
| `log2(x)` | 1 | |
| `abs(x)` | 1 | |
| `floor(x)` | 1 | |
| `ceil(x)` | 1 | |
| `round(x)` | 1 | |
| `trunc(x)` | 1 | |
| `frac(x)` | 1 | current implementation uses `fmod(x, 1)` |
| `min(a, b)` | 2 | |
| `max(a, b)` | 2 | |
| `clamp(v, low, high)` | 3 | |
| `hypot(x, y)` | 2 | |
| `hypot3(x, y, z)` | 3 | |

Trig note:

- MarsinScript follows the Pixelblaze convention of using **turns** for trig.
- `sin(0.25)` is approximately `1`.
- `cos(0.5)` is approximately `-1`.

### 6.2 Time, waveforms, mixing, and randomness

| Function | Args | Notes |
|---|---:|---|
| `time(scale)` | 1 | sawtooth phase `0..1` |
| `wave(x)` | 1 | `(1 + sin(x * 2pi)) / 2` |
| `square(x, duty)` | 2 | wraps `x` into `0..1` before compare |
| `triangle(x)` | 1 | wraps `x` into `0..1` |
| `mix(low, high, amount)` | 3 | linear interpolation |
| `smoothstep(low, high, value)` | 3 | Hermite smoothstep |
| `random(max)` | 1 | deterministic stateless random scaled by `max` |

`time(scale)` details:

- returns a repeating phase in the range `0..1`
- current VM period is `65.536 * scale` seconds
- `time(0.1)` loops roughly every `6.5536` seconds

`random(max)` details:

- there is **no** zero-argument `random()` overload in the current compiler
- randomness is deterministic per call site, pixel, frame, and seed context
- use `random(1)` for a normalized random value

### 6.3 Noise

| Function | Args | Notes |
|---|---:|---|
| `perlin(x, y, z, seed)` | 4 | seed is currently ignored by the VM implementation |
| `perlinFbm(x, y, z, lacunarity, gain, octaves)` | 6 | |
| `perlinRidge(x, y, z, lacunarity, gain, offset, octaves)` | 7 | |
| `perlinTurbulence(x, y, z, lacunarity, gain, octaves)` | 6 | |
| `setPerlinWrap(x, y, z)` | 3 | sets wrap offsets for later Perlin calls |

Noise note:

- `perlin()` and `perlinFbm()` return normalized values around `0..1`
- `perlinRidge()` and `perlinTurbulence()` are not automatically clamped

### 6.4 Arrays

| Function | Args | Notes |
|---|---:|---|
| `array(size)` | 1 | allocates numeric array initialized to `0` |

Array literals are also supported:

```javascript
var a = [1, 2, 3]
var b = [[0, 0], [1, 1], [0.5, 0.25]]
```

### 6.5 Color output

### Core color output (Pixelblaze-compatible)

| Function | Args | Meaning |
|---|---:|---|
| `hsv(h, s, v)` | 3 | hue wraps, saturation/value clamp to `0..1` |
| `rgb(r, g, b)` | 3 | each channel clamps to `0..1` |

### Marsin extensions

| Function | Args | Meaning |
|---|---:|---|
| `rgbwau(r, g, b, w, a, u)` | 6 | direct RGBWAU control; Marsin-specific, not Pixelblaze-compatible |

Color-output semantics:

- These are **terminal output builtins**.
- When the VM executes `hsv()`, `rgb()`, or `rgbwau()`, it returns a `MarsinPixel` immediately for the current pixel.
- In practice, they should be used on the active render path, not as ordinary numeric helper functions.

Examples:

```javascript
// Pixelblaze-compatible RGB
rgb(1, 0.2, 0)

// Pixelblaze-compatible HSV
hsv(time(0.1) + x, 1, 1)

// Marsin extension
rgbwau(0, 0, 0, 1, 0.3, 0)
```

### 6.5.1 Pixelblaze-compatible RGBW usage

How to write RGBW-friendly scripts:

- Use `rgb()` and `hsv()`, not `rgbw()`
- Express pure white as `rgb(1, 1, 1)` or `hsv(h, 0, 1)`
- Let the RGBW transport derive white from RGB at output time

Example:

```javascript
// Pure white in the Pixelblaze style
rgb(1, 1, 1)
```

On a future RGBW transport, that should map to white-channel output via white extraction. On current Marsin RGB-only transports, it appears as equal RGB white.

### 6.5.2 Current Marsin RGBWAU fallback

When a script uses `rgbwau()` on an RGB-only output, Marsin currently falls back by approximating W/A/U into visible RGB:

```text
displayR = clamp(r + w + amber * 0.8 + uv * 0.1, 0, 255)
displayG = clamp(g + w + amber * 0.4, 0, 255)
displayB = clamp(b + w + uv * 0.5, 0, 255)
```

This is a Marsin preview and RGB-fallback heuristic. It is **not** the Pixelblaze RGBW white-extraction rule.

### 6.5.3 Current output surfaces

How `MarsinPixel` is surfaced today:

- **Firmware LED output**: current RGB strip drivers consume RGB only; `rgbwau()` content is approximated via the RGB fallback adapter.
- **Firmware browser visualizer**: still transports `pixelCount * 3` RGB bytes only; it can display white visually as equal RGB but does not carry a distinct white channel.
- **Simulator**: emits full `RGBWAU` data and previews it through the RGB fallback heuristic.
- **WASM compatibility exports**: `marsin_render_pixel()` and `marsin_render_all()` expose RGB only.
- **WASM 6-channel exports**: `marsin_render_pixel_6ch()` and `marsin_render_all_6ch()` expose full `RGBWAU`.

Practical implication:

- If you write Marsin-extension patterns with `rgbwau()`, use a 6-channel-aware surface when you need the actual `w/a/u` channels.
- Legacy RGB-only WASM consumers see only RGB.

---

## 7. Arrays

Supported array features:

- `array(size)`
- array literals: `[a, b, c]`
- nested arrays
- indexing: `arr[i]`
- element assignment: `arr[i] = v`
- element compound assignment: `arr[i] += v`, etc.

Not supported:

- `.length`
- `push`, `pop`, `map`, `forEach`, or JS array methods
- object-style properties

Array allocation guidance:

- allocate persistent arrays in top-level init
- avoid allocating arrays inside `render`
- for portable scripts, avoid relying on per-frame allocation in `beforeRender`

Why:

- `render` calls run with allocation disabled
- some host runtimes intentionally restrict per-frame allocation paths

---

## 8. Functions and Returns

User-defined functions are supported.

Example:

```javascript
function pulse(v) {
  return v * v
}

export function render(index, x, y, z) {
  var v = pulse(wave(time(0.1) + x))
  rgb(v, 0, 0)
}
```

Return behavior:

- In helper functions, `return expr` returns a scalar number to the caller.
- In render entrypoints:
  - `return <number>` returns grayscale (`r = g = b = value * 255`)
  - `return;` returns black
  - `return hsv(...)`, `return rgb(...)`, and `return rgbwau(...)` work, but the color builtins already terminate evaluation
- If a render entrypoint falls through without a color output or explicit return, it returns black.

Recommended practice:

- Use helper functions for scalar math
- Use color builtins in the final render path

---

## 9. Runtime Semantics and Safety

### 9.1 Instruction limit

The VM enforces a safety limit of **5000 instructions per pixel**.

If a pixel exceeds that limit:

- execution aborts for that pixel
- the VM returns solid red as an error indicator

### 9.2 NaN and clamping behavior

- `rgb()` clamps each channel to `0..1`
- `rgbwau()` clamps each channel to `0..1`
- `hsv()` wraps hue and clamps saturation/value to `0..1`
- NaN in color output paths resolves to black

### 9.3 `delta` behavior

Conceptual contract:

- `beforeRender(delta)` expects `delta` in milliseconds

Current implementation notes:

- firmware `MarsinScript` populates `delta`
- simulator populates `delta` through global injection
- the native checker and current WASM `begin_frame` path do not currently guarantee a real `delta` argument

Portable guidance:

- prefer `time(scale)` and persistent state for portable animation timing
- treat `delta` as runtime-dependent unless you control the execution surface

---

## 10. Unsupported or Restricted JavaScript Features

Not supported in pattern scripts:

- `let`
- `const`
- strings
- objects
- classes
- closures
- `switch`
- exceptions
- dynamic property access
- standard JS array methods

Legacy note:

- If the source does not start with `export`, `function`, or `var`, the compiler still supports a legacy compatibility mode where the whole source is treated as a render expression.
- New scripts should use explicit functions and standard MarsinScript structure.

---

## 11. Pattern Authoring Guidance

For portable, low-surprise MarsinScript:

1. Allocate arrays at top level, not per pixel.
2. Use `beforeRender` for frame-level updates and `render` for per-pixel output.
3. Use `rgb()` and `hsv()` for Pixelblaze-compatible scripts.
4. Use `rgbwau()` only when you intentionally target Marsin-specific multi-emitter behavior.
5. Prefer `x`, `y`, and `z` over `pixelCount` when you need normalized spatial behavior.
6. Keep helper functions numeric; do final color emission in the render path.

---

## 12. Model Scripts

Model scripts are not compiled by `MarsinVM`. They run in a host JavaScript environment and produce pixel coordinates.

### 12.1 Signature

```javascript
function (pixelCount) {
  var map = []
  // build coordinates
  return {
    points: map,
    metadata: {
      controllers: { ... },
      sections:    { ... },
      fixtures:    { ... },
      views:       { ... }
    }
  }
}
```

The function may also return a flat array for legacy compatibility (see 12.2).

### 12.2 Return formats

#### Simple map (v1 flat)

```javascript
[
  [x, y, z],
  [x, y, z],
  ...
]
```

#### Tagged multi-controller map (v1 keyed)

```javascript
[
  [controllerId, x, y, z],
  [controllerId, x, y, z],
  ...
]
```

Tagged maps are used by deployment tooling to split a single model across controllers. The `controllerId` is a string matching the `id` field in `deployment.yaml`.

#### Self-contained model with metadata (v2 source — recommended)

```javascript
return {
  points: [
    [controllerId, x, y, z],
    ...
  ],
  metadata: {
    controllers: { qtpy_left: 1, qtpy_center: 2, qtpy_right: 3 },
    sections:    { left: 1, center: 2, right: 3 },
    fixtures:    { test_bench: 1 },
    views: {
      all: 1,
      left: 2,
      center: 4,
      right: 8
    }
  }
}
```

When a model returns an object with `points` and `metadata`, the model is **self-contained** — all topology information travels with the model file itself, independent of `deployment.yaml`.

### 12.3 Compiled JSON formats

The deployment tooling evaluates the model `.js` file and produces compiled JSON. The firmware loads these JSON files, not the `.js` source.

#### v1 flat JSON

```json
[[0.0, 0.5, 0.0], [0.1, 0.5, 0.0], ...]
```

#### v1 keyed JSON

For multi-controller installations. Each controller reads only its own key:

```json
{
  "qtpy_left": [[0.0, 0.5, 0.0], [0.2, 0.5, 0.0], ...],
  "qtpy_center": [[0.4, 0.5, 0.0], [0.6, 0.5, 0.0], ...],
  "qtpy_right": [[0.8, 0.5, 0.0], [1.0, 0.5, 0.0], ...]
}
```

#### v2 keyed JSON (with metadata)

The v2 format adds schema identification, metadata lookup tables, and per-controller default metadata tuples:

```json
{
  "schema": "marsin-keyed-model-v2",
  "meta": {
    "controllers": { "rpm_r": 1, "rpm_p": 2, "rpm_m": 3 },
    "sections":    { "r": 1, "p": 2, "m": 3 },
    "fixtures":    { "rpm_shop_sign": 1 },
    "views":       { "rpm_all": 1, "rpm_r": 2, "rpm_p": 4, "rpm_m": 8 }
  },
  "controllers": {
    "rpm_r": {
      "defaultMeta": [1, 1, 1, 3],
      "points": [[0.04, 0.5, 0.0], [0.04, 0.5, 0.06], ...]
    },
    "rpm_p": {
      "defaultMeta": [2, 2, 1, 5],
      "points": [[0.35, 0.5, 0.0], ...]
    },
    "rpm_m": {
      "defaultMeta": [3, 3, 1, 9],
      "points": [[0.68, 0.5, 0.0], ...]
    }
  }
}
```

The `defaultMeta` tuple is `[controllerId, sectionId, fixtureId, viewMask]`. These values are pushed to the `controllerId`, `sectionId`, `fixtureId`, and `viewMask` built-in variables during rendering.

Points can also carry per-point metadata overrides as 7-element arrays:

```json
"points": [
  [0.04, 0.5, 0.0],
  [0.04, 0.5, 0.06, 1, 1, 2, 3]
]
```

The 7-element form is `[x, y, z, controllerId, sectionId, fixtureId, viewMask]`. When a point has per-point metadata, it overrides the controller's `defaultMeta` for that pixel only.

### 12.4 Metadata in model files (Design 25)

Metadata tables are embedded directly in the model `.js` file as part of the return object. This makes the model **self-contained** — it carries its own topology definition alongside its 3D coordinates.

```javascript
function (pixelCount) {
    var map = [];
    // ... build tagged map ...
    return {
        points: map,
        metadata: {
            controllers: { rpm_r: 1, rpm_p: 2, rpm_m: 3 },
            sections:    { r: 1, p: 2, m: 3 },
            fixtures:    { rpm_shop_sign: 1 },
            views: {
                rpm_all: 1,
                rpm_r: { bit: 2, controllers: ["rpm_r"] },
                rpm_p: { bit: 4, controllers: ["rpm_p"] },
                rpm_m: { bit: 8, controllers: ["rpm_m"] },
                rpm_rp_pair: { bit: 16, controllers: ["rpm_r", "rpm_p"] }
            }
        }
    };
}
```

The deployment tooling (`model_splitter`, `mass_deploy.py`) reads metadata from the model object and embeds it into the v2 JSON model artifact. `deployment.yaml` is now purely a hardware manifest (MAC-to-ID mapping, IP assignment, swarm roles).

**View values** can be either:
- A plain integer (power of 2) for simple views: `all: 1`
- An object `{ bit: <power of 2>, controllers: ["id1", "id2"] }` for views that span specific controllers

**View IDs must be powers of 2** (bitmask bits). A pixel's `viewMask` is the OR of all views it belongs to.

> **Legacy support:** If a model returns only a flat array `[controllerId, x, y, z]` without metadata, the tooling falls back to reading metadata from `deployment.yaml` if present. This is deprecated — new models should embed their own metadata.

Example pattern using metadata:

```javascript
// Section constants (match deployment.yaml metadata tables)
var SECTION_LEFT = 1;
var SECTION_CENTER = 2;
var SECTION_RIGHT = 3;

export function render3D(index, x, y, z) {
  var t = time(0.05);

  if (sectionId == 0) {
    // v1 fallback: no metadata available
    hsv(t + x, 1, 1);
  } else if (sectionId == SECTION_LEFT) {
    hsv(0.0, 1, wave(t + y));   // Red pulsing
  } else if (sectionId == SECTION_CENTER) {
    hsv(0.33, 1, wave(t + y));  // Green pulsing
  } else if (sectionId == SECTION_RIGHT) {
    hsv(0.66, 1, wave(t + y));  // Blue pulsing
  }
}
```

### 12.6 Capabilities

Model scripts run in normal host JavaScript, so they may use:

- arrays
- objects
- loops
- helper functions
- normal JS math

The output contract is what matters:

- return either an array or an object with `points` and `metadata`
- each point must be either `[x, y, z]` or `[controllerId, x, y, z]`
- metadata (when present) includes `controllers`, `sections`, `fixtures`, and `views` tables

Coordinates are typically normalized to `0..1`, but deployment tooling may also normalize real-world coordinates upstream depending on the workflow.

### 12.7 Firmware model loading behavior

The firmware parser auto-detects the JSON format:

1. **v2**: JSON contains `"schema": "marsin-keyed-model-v2"` → parses controller's `defaultMeta` and `points`, allocates metadata sidecar
2. **v1 keyed**: JSON is an object with string keys → reads only the key matching the controller's own `id`
3. **v1 flat**: JSON is a plain array → loads all points directly

**Size Constraints and OOM Safety**:
- Due to ESP32 RAM limitations (no PSRAM on the base model), parsing a massive `_keyed_v2.json` into a JSON Document object can exhaust the heap, triggering an OOM crash.
- To prevent this, the WebUI limits typical `/api/model` JSON parsing endpoints to **30KB max**.
- For robust Swarm-scale deployment of massive V2 models, use the `mass_deploy.py` utility. `mass_deploy` natively bypasses HTTP String buffering memory exhaustion by leveraging the optimized `/api/sync/file` streaming endpoint. This endpoints writes binary chunks directly to the `LittleFS` flash without expanding JSON onto the heap.

If a v2 model is malformed (bad schema, missing fields), the parser **hard-fails**: it preserves the previous model and sets an error flag. This prevents half-loaded models from corrupting the swarm.

### 12.8 Parser failure semantics

- Malformed v2 JSON triggers `loadError_` flag on the firmware
- Previous model state is preserved (no `pixels.clear()`)
- Callers can check `hasLoadError()` to detect failures
- State is NOT saved to flash on failure (prevents bricking on reboot)

---

## 13. Final Language Contract

MarsinScript, as implemented today, is:

- a numeric VM language with arrays and user-defined numeric helper functions
- Pixelblaze-compatible at the core color-language level through `rgb()` and `hsv()`
- Marsin-extended through `rgbwau()` and the internal `MarsinPixel` RGBWAU model
- Marsin-extended through `controllerId`, `sectionId`, `fixtureId`, `viewMask` metadata variables
- intentionally separated from hardware transport details

If a script needs to stay Pixelblaze-like, keep to:

- `beforeRender(delta)`
- `render(index, x, y, z)`
- numeric math and arrays
- `rgb()` and `hsv()`

If a script needs Marsin-specific multi-emitter control, use:

- `rgbwau()`

If a script needs Marsin-specific per-controller or per-section behavior, use:

- `controllerId`, `sectionId`, `fixtureId`, `viewMask`
- Always include a `== 0` fallback for v1 model compatibility

Both Marsin extensions are Marsin-only, not cross-compatible with Pixelblaze proper.
