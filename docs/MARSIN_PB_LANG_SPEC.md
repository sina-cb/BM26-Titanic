# MarsinScript Language Specification

**Version**: 2.3
**Status**: Authoritative for the current Marsin compiler, VM, firmware runtime, simulator, and WASM surface. Where implementation caveats still exist, they are called out explicitly.

Companion document: [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) —
engine contracts, parameter conventions, colour policy, and authoring recipes.
Where the two overlap (timing, metadata, trails, blends) they are reconciled;
this file owns the *language*, that file owns the *engine and the show*.

> **2.3 changes** (probed empirically against the vendored WASM VM via
> `marsin_engine/lib/marsin_wasm_runtime.js`, offline):
> - **§2.4 / §5.2 metadata ABI corrected** — seven lanes, not four. Adds
>   `fixtureType`, `pixelLocalIndex`, `viewMaskHi`, plus the compiler's
>   restriction on `viewMaskHi` and the removal of the "always handle
>   `sectionId == 0` with a coordinate fallback" advice (it is a fallback, and
>   fallbacks are banned — codex P0).
> - **§5.2.1 `inView("Name")`** documented as the preferred semantic-targeting
>   intrinsic, with its loud-failure contract.
> - **§9.3 `delta` corrected** — it *does* track the `elapsed` handed to
>   `begin_frame`, and is therefore global-speed-scaled. The old "fixed nominal
>   ≈15.7 per frame, independent of elapsed" claim was wrong. The real
>   initialization quirk is documented instead.
> - **§9.5 trails** — model-portability rules; stop recommending a hard-coded
>   test-bench pixel count.
> - **§13.4 channel-blend list corrected** to the three modes the API actually
>   accepts, plus the transition-script contract.
>
> **2.2 changes**:
> - **§6.1 trig corrected to radians** (the old "turns" note was stale — live patterns multiply by `PI2`, and `sin(PI/2) == 1` was confirmed).
> - New **§9.4 Frame-to-frame state persistence** and **§9.5 Simulating trails (frame feedback)** — how to carry state between frames to build trails.

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

Notes:

- Marsin-specific `rgbwau()` exists for direct multi-emitter control, but it is **not** Pixelblaze-compatible.
- Some *legacy* surfaces (RGB-only strip firmware, the RGB-only WASM exports) carry three channels and approximate the rest — see §1.4.
- The BM26 show rig is **not** one of those surfaces. See §1.5.

### 1.4 The RGB approximation — a PREVIEW path, not the physical output path

Where a surface carries only three channels, six-lane output is approximated:

```text
outR = min(255, R + W + A×0.8 + U×0.1)
outG = min(255, G + W + A×0.4)
outB = min(255, B + W + U×0.5)
```

- **No visual regression for `rgb()`/`hsv()` scripts:** W/A/U are always 0, so the formula reduces to `outR = R`, `outG = G`, `outB = B` — bit-identical to the pre-RGBWAU engine output.
- **For `rgbwau()` content:** W adds equally to R/G/B (a brightness boost), A contributes 80% R + 40% G (warm orange tint), U contributes 10% R + 50% B (deep violet tint).

> **Do not reason about the Titanic's physical output from these equations.**
> They describe the three-channel *preview / legacy* path only. The real chain
> is in §1.5.

### 1.5 What the BM26 rig actually emits

Two distinct output paths, both real, neither one the §1.4 approximation:

| Path | Fixtures | Emitters | Behaviour |
|---|---|---|---|
| **DMX** | Shehds 18-px bars, UKing pars | R G B **W A U** | R/G/B/W/A/U bytes are written to the fixture's mapped channels as authored. Where the profile has no A or U channel, that lane has no destination. When a pattern emitted no explicit W, the mapper synthesizes `W = min(R,G,B)`. |
| **DMX** | Vintage 6-head rails | R G B **W** | as above, no amber/UV destination |
| **LED strand** | rope/strand runs, TE signs | R G B **W** | `led_wire.js`: the **amber lane is folded into RGB** with weights `[0.9, 0.6, 0.0]`; the **UV lane is dropped** (no UV emitter); the whole RGBW quad is then jointly pre-scaled by one shared factor so no channel's `RGB + W` composite can clip — hue and colour/white balance survive exactly, the picture just dims. Gamma lives **only** on the LED controller. |

Authorities: [`simulation/src/dmx/sacn_mapper.js`](../simulation/src/dmx/sacn_mapper.js)
and [`simulation/src/dmx/led_wire.js`](../simulation/src/dmx/led_wire.js).
Per-instrument counts and roles are in
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §6.3 and
[`COLOR_THEORY.md`](COLOR_THEORY.md) §2.

**Strands and TE signs DO have white emitters** (`led.order: RGBW`,
`whiteMode: native`). What they lack is amber and UV.

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

These names are reserved and may not be assigned to or declared as variables
(verified by compile probe against the vendored WASM — declaring any of them
raises `Cannot declare reserved name '<name>'`):

- `t`, `i`, `index`, `x`, `y`, `z`, `pixelCount`
- `PI`, `PI2`, `true`, `false`
- `controllerId`, `sectionId`, `fixtureId`, `viewMask`
- `fixtureType`, `pixelLocalIndex`, `viewMaskHi`

Also effectively reserved in practice: `h`, `f`, `p`, `q`, `r`, `g`, `b` are
builtin slots and cannot be declared at all in some positions — the palette
helpers in `MARSIN_ENGINE_PATTERNS.md` §9.2 use a `*v` suffix (`hv`, `iv`,
`fv`, `pv`, `qv`, `tv`) for exactly this reason.

Built-in render parameters:

- `index` or `i`: current pixel index
- `x`, `y`, `z`: current pixel coordinates, normalized `0..1`
- `t`: VM time in seconds — exactly the `elapsed` the host passed to
  `begin_frame` (§9.3)
- the seven metadata builtins: see §5.2

Names that are **not** builtins (compile as `Undefined var`): `fixtureTypeId`
(the ABI lane name; the *language* name is `fixtureType`) and `pixelIndex`
(use `index` / `i`).

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

- `pixelCount` is **compiled as a literal `144`** by the compiler, not the true runtime pixel count. Confirmed by offline probe: VMs created for 4, 144 and 964 pixels all report ~144 to the pattern.
- Existing patterns use it heavily, but this is a known implementation limitation.
- Prefer deriving normalized position from `x`/`y`/`z` instead of relying on `pixelCount`. Where you genuinely need a model-sized array, use an explicit constant and mark the pattern model-specific (§9.5).

### 5.2 Model metadata variables (Marsin extension)

These built-in variables expose per-pixel metadata. They are **read-only** and
populated per pixel by the render loop from a flat Int32 buffer whose lane
layout is a cross-repo **ABI contract** — the single source of truth is
[`marsin_engine/lib/meta_abi.js`](../marsin_engine/lib/meta_abi.js). The stride
is **7 int32 per pixel** (Tier C, live since 2026-06-19).

| Lane | Language name | Description |
|---:|---|---|
| 0 | `controllerId` | numeric ID of the controller rendering this pixel |
| 1 | `sectionId` | **model-specific** numeric section ID |
| 2 | `fixtureId` | **model-specific** numeric fixture ID |
| 3 | `viewMask` | low view word — views 0..30, bit `1 << view` |
| 4 | `fixtureType` | canonical `FIX_*` fixture-type id (ABI lane name: `fixtureTypeId`) |
| 5 | `pixelLocalIndex` | 0-based index of this pixel within its fixture |
| 6 | `viewMaskHi` | high view word — views 31..61, bit `1 << (view − 31)` |

A value is `0` when the model or caller supplies no metadata for that lane
(v1 flat / v1 keyed models, or a host that packs no meta buffer).

#### `viewMaskHi` is restricted by the compiler

`viewMaskHi` may **only** appear in the membership form. Anything else is a
compile error, verbatim:

```text
viewMaskHi may only be used as '(viewMaskHi & MASK)' — it cannot be stored,
compared, shifted, or used in arithmetic
```

The mask must be a compile-time single-bit **literal**, not a `var`. The
`inView()` intrinsic and the `MASK_*` injector both emit exactly that form, so
in practice you never write it by hand.

#### `viewMask` usage

`viewMask` is a bitmask; test membership with bitwise AND. Prefer the named
`MASK_*` constants the host injects from the loaded model over magic numbers,
and prefer `inView()` (§5.2.1) over both:

```javascript
if (viewMask & MASK_LEFT_FRONT_WALL) {
  hsv(0.0, 1, 1);
}
```

`MASK_*` names are injected only where referenced; a `MASK_*` the model cannot
satisfy is a **loud compile-stage error**, never a silent zero. A pattern that
declares its own `var MASK_X = ...` wins.

#### Section and fixture IDs are model-specific

There is **no global section taxonomy.** `test_bench` uses `1 = Pars,
2 = Vintage, 3 = Bars`; the Titanic uses values like `514` and `515`. A pattern
that branches on a raw `sectionId` literal is bound to one model, and must say
so in its header. Targeting by *view name* (§5.2.1) or by *fixture capability*
(§5.2.2) is portable; targeting by raw section id is not.

#### No metadata fallbacks

Earlier revisions of this spec told patterns to "always handle the `0` (no
metadata) case" by falling back to coordinate thresholds. **That guidance is
withdrawn** — it is a fallback behaviour, and fallbacks are banned (codex P0:
fail loudly). A model that should carry metadata and does not is a model bug to
be surfaced, not papered over in every pattern. If a pattern is genuinely
designed to work with no metadata at all, drive it from `x`/`y`/`z` only and
never read the metadata builtins.

### 5.2.1 `inView("Authored View Name")` — the preferred semantic target

`inView()` is a **compile-time intrinsic**
([`marsin_engine/lib/in_view_intrinsic.js`](../marsin_engine/lib/in_view_intrinsic.js)),
folded before the MarsinScript compiler ever runs:

```javascript
if (inView("Hull Canvas")) { /* ... */ }
```

folds to `((viewMask & <bit>) != 0)` for a low-word view, or
`((viewMaskHi & <literal>) != 0)` for a high-word one — so the author never has
to know which word a view lives in, nor manage `MASK_*` names by hand.

Contract:

- Resolution is by the view's **authored name** — the same string the scene's
  view registry and `/model/view-selection-options` use — so names with spaces
  work verbatim.
- **An unknown view name is a hard compile error** listing the model's known
  views. It never folds to a silent constant-false test.
- A **bit-free** (host-only) view is **promoted on demand**: the host allocates
  a free `(word, bit)` from the two-word 62-bit budget, sets it on the view's
  member pixels, and re-packs the meta buffer. No promoter wired, or budget
  exhausted, throws loudly.
- Two `inView()` calls on the same name promote exactly once (one bit).
- A commented-out `inView("X")` neither folds nor fails the compile.

The view registry itself is the scene's `views.yaml`, exported alongside the
model to `marsin_engine/models/<scene>.viewmasks.js`; the engine validates the
sidecar against the loaded model and fails loudly on drift. (Do not confuse
`views.yaml` — the engine's semantic/base view-mask registry — with
`pixel_map_views.yaml`, which is a simulator 2D display-layout sidecar and has
no effect on what a pattern can target.)

### 5.2.2 Fixture-type constants (`FIX_*`)

`fixtureType` is the one per-pixel property that stays stable across models
(`fixtureId`, `group` and `viewMask` all reshuffle). Use it where the real
distinction is *fixture capability*:

```javascript
if (fixtureType == FIX_PAR) { /* single-pixel wash source */ }
```

Canonical roles (`marsin_engine/lib/fixture_type_constants.js`; ids are
append-only and never renumbered): `FIX_RAW_LED` = 1, `FIX_PAR` = 2,
`FIX_VINTAGE_6` = 3, `FIX_BAR_18` = 4, `FIX_HAZE` = 5, `FIX_FOG` = 6,
`FIX_TE_SIGN` = 7. Id `0` is
`UNTYPED` and is **not** a fallback target. Only the roles actually present on
the loaded model are emitted, so a `FIX_*` the model does not carry **fails the
compile**.

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
| `sin(x)` | 1 | Input is in **radians** |
| `cos(x)` | 1 | Input is in **radians** |
| `tan(x)` | 1 | Input is in **radians** |
| `asin(x)` | 1 | Returns **radians** |
| `acos(x)` | 1 | Returns **radians** |
| `atan(x)` | 1 | Returns **radians** |
| `atan2(y, x)` | 2 | Returns **radians** |
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

- The MarsinVM math parser is migrated to **radians** (JavaScript `Math` semantics), *not* the
  historical Pixelblaze turn convention. Confirmed empirically: `sin(0.25) ≈ 0.247`,
  `sin(PI/2) == 1`, `PI2 ≈ 6.2832`.
- To turn a normalized `0..1` phase (a "turn") into an angle, multiply by `PI2`:
  `sin(x * PI2)`, `atan2(z, x) / PI2` to go back. This is why every production pattern uses `PI2`.
- The `wave(x)` / `triangle(x)` / `square(x, duty)` helpers are the exception — their input is still
  a normalized `0..1` phase (see §6.2). See also [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §5.

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

### 6.6 Future: built-in palette accessors (`paletteRgb1` / `paletteRgb2`)

> **Status:** proposed. Not yet implemented in `MarsinCompiler` or the WASM VM. Tracked because every production pattern today re-implements the same logic by hand — see [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §9.

#### Motivation

The two global palette pickers (`cp1H/cp1S/cp1V`, `cp2H/cp2S/cp2V`) arrive in patterns as HSV triplets. To produce output that stays strictly within the operator-chosen palette, every pattern needs the RGB form of each picker so it can lerp **in RGB-space** (HSV-space interpolation traverses non-palette hues via the colour-wheel shortest path).

Today every pattern carries an inlined ~30-line `_hsv2rgb1` / `_hsv2rgb2` helper that:
1. Reads `cp1H/S/V` (or `cp2H/S/V`) from script globals.
2. Performs an HSV→RGB conversion.
3. Writes the result to six pattern-local vars (`pr1/pg1/pb1`, `pr2/pg2/pb2`).
4. Is invoked once per frame from `beforeRender`.

These ~60 lines are bit-identical across 13+ production patterns. Worse, every pattern author has to remember:
- To call both helpers in `beforeRender`.
- To avoid the reserved single-letter locals (`h`, `i`, `f`, `p`, `q`, `t`) inside the helper.
- To reuse the cached `pr1…pb2` in `render3D`, not re-derive RGB per pixel.

#### Proposed shape

Add two zero-arg builtins that return the up-to-date RGB form of the current global palette pickers. The VM maintains an internal RGB cache invalidated whenever the CPC writes any of `cp1H/cp1S/cp1V` or `cp2H/cp2S/cp2V`, so cost is amortised across all patterns and re-computation only happens on palette change, not every frame.

| Function | Args | Returns | Meaning |
|---|---:|---|---|
| `paletteRgb1()` | 0 | `(r, g, b)` triple | Current `cp1H/cp1S/cp1V` converted to RGB |
| `paletteRgb2()` | 0 | `(r, g, b)` triple | Current `cp2H/cp2S/cp2V` converted to RGB |

Triple-return semantics mirror the existing `array(size)` and `rgbwau()` precedent: assign via destructured-style multi-target assignment, e.g. `pr1, pg1, pb1 = paletteRgb1()`. If multi-return assignment is not added to the language, an equivalent shape using four single-result accessors (`paletteR1()`, `paletteG1()`, `paletteB1()`, `paletteR2()`, `paletteG2()`, `paletteB2()`) is acceptable.

Sample pattern after the built-ins land:

```javascript
var pr1, pg1, pb1, pr2, pg2, pb2;

export function beforeRender(delta) {
  pr1, pg1, pb1 = paletteRgb1();
  pr2, pg2, pb2 = paletteRgb2();
}

export function render3D(index, x, y, z) {
  var t = wave(x + time(0.1));
  rgb(pr1 + (pr2 - pr1) * t,
      pg1 + (pg2 - pg1) * t,
      pb1 + (pb2 - pb1) * t);
}
```

That's a ~60-line reduction per pattern and removes an entire class of "I forgot the helper" bugs.

#### Implementation notes

- Cache invalidation is cheap: the host already mediates every CPC write into the VM, so it can flip a `paletteDirty` flag and lazy-recompute on first call per frame.
- Helpers must respect the same hue wrap rule as `hsv()`: `h = h - floor(h)`.
- `paletteRgb1`/`paletteRgb2` are **non-terminal** (unlike `rgb()`/`hsv()`/`rgbwau()`) — they return values for use in further expressions, not a `MarsinPixel`.
- On `paletteRgb1` / `paletteRgb2`, S=0 must collapse to `(V, V, V)` (white), matching `hsv(h, 0, v)` semantics — operators have a "always pure" picker policy that pins S=V=1, but the language helper should still behave correctly if a script writes a desaturated `cp*` directly.

#### Until then…

Every production pattern uses the pattern-local `_hsv2rgb1` / `_hsv2rgb2` idiom documented in [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §9.2.

---

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

### 6.5.2 The RGB approximation (three-channel surfaces only)

When `rgbwau()` content reaches a surface that carries only three channels,
W/A/U are approximated into visible RGB:

```text
displayR = clamp(r + w + amber * 0.8 + uv * 0.1, 0, 255)
displayG = clamp(g + w + amber * 0.4, 0, 255)
displayB = clamp(b + w + uv * 0.5, 0, 255)
```

This is a Marsin **preview / legacy-surface heuristic**. It is **not** the
Pixelblaze RGBW white-extraction rule, and it is **not** how the BM26 rig
emits light — see §1.5.

### 6.5.3 Where `MarsinPixel` actually goes

| Surface | Channels | Note |
|---|---|---|
| BM26 DMX fixtures (bars, pars, vintage rails) | full RGBWAU where the profile has the channels | authored bytes, no approximation |
| BM26 LED strands + TE signs | RGBW on the wire | amber folded into RGB, UV dropped, clip-proof joint pre-scale (`led_wire.js`) |
| Simulator preview | RGB for display | DMX fixtures use the additive blend; strand pixels are previewed through the **actual wire bytes** run back through the controller's own white extraction + gamma, so screen == strand |
| Legacy RGB strip firmware | RGB only | §6.5.2 approximation |
| WASM compatibility exports (`marsin_render_pixel`, `marsin_render_all`) | RGB only | |
| WASM 6-channel exports (`marsin_render_all_with_meta_6ch`, `marsin_render_blend_6ch`) | full RGBWAU | what the engine uses |

Practical implication: the engine drives the **6-channel** exports, so
`rgbwau()` content reaches the rig with its lanes intact — subject to each
fixture family's actual emitters (§1.5). Only legacy RGB-only consumers see the
approximation.

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

### 9.3 The clock: `begin_frame(elapsed)`, `t`, `time(scale)`, and `delta`

**Contract.** The host drives one call to `marsin_begin_frame(handle,
elapsedSeconds)` per frame. Everything a pattern can know about time derives
from that one number.

| Symbol | Value |
|---|---|
| `t` | exactly the `elapsedSeconds` passed to `begin_frame`, in seconds |
| `time(scale)` | a `0..1` sawtooth off that same clock, period `65.536 × scale` seconds |
| `delta` | `(elapsed_now − elapsed_prev) × 1000`, in **milliseconds** — with the initialization quirk below |

Measured offline against the vendored WASM
(`marsin_engine/lib/marsin_wasm_runtime.js` + `marsin_pb/wasm`), driving
`begin_frame` with controlled sequences and reading the values back out through
a pixel byte:

| `elapsed` sequence (s) | `delta` per frame (ms) |
|---|---|
| `0, 0.025, 0.05, 0.075, 0.1` | `16, 16, 25, 25, 25` |
| `0, 0.01, 0.03, 0.13, 0.14, 0.14, 0.20` | `16, 16, 20, 100, 10, 0, 60` |
| `1.0, 1.2, 1.4, 1.6` | `16, 200, 200, 200` |
| `0, 0, 0, 0` | `16, 16, 16, 16` |

| `elapsed` | `t` | `time(0.1)` (of 1.0) |
|---:|---:|---:|
| 0 | 0 | 0.00 |
| 1 | 1 | 0.15 |
| 3.2768 | 3.2768 | 0.50 |
| 6.5536 | 6.5536 | 1.00 (wraps) |
| 100 | 100 | — |

**What this establishes:**

1. **`delta` is a real millisecond step derived from `elapsed`.** The previous
   revision's claim that it is a fixed nominal ≈15.7 independent of `elapsed`
   is **wrong** and is withdrawn.
2. **Initialization quirk.** The VM's previous-time slot starts at `0`, and `0`
   also serves as the "no previous frame" sentinel. So `delta` is a nominal
   **`16.0` ms** on the first frame, *and* on any frame whose predecessor's
   `elapsed` was exactly `0`. A pattern started from a zero clock therefore sees
   `16, 16, <real>, <real>, …`. Do not derive a frame rate from the first
   frames.
3. **A repeated `elapsed` yields `delta == 0`**, not the nominal. Accumulators
   must tolerate a zero step.
4. **Global SPEED scales `delta` too.** The BM26 engine passes an
   already-speed-scaled clock into `begin_frame` (`engine.js` accumulates
   `patternClockSeconds += wallDelta * globalSpeedMultiplier()`), so `t`,
   `time()` **and** `delta` are all pre-scaled by the operator's SPEED fader.
   The previous "SPEED scales `time()`, not `delta`" note is **wrong** and is
   withdrawn. A pattern must therefore **not** apply a second global multiplier
   — see [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §3.

Guidance:

- Either style works and both follow global SPEED. `time(scale)` is stateless
  and self-wrapping; `delta` accumulation gives you an independent phase you can
  trim, gate, or reverse.
- The codebase convention is `dt = delta / <loopMs> * localMult` — e.g.
  `delta / 1310.72` for a 1.31 s loop, `delta / 65536.0` for a 65.5 s one.
- Treat `delta` as host-dependent only when you do **not** control the
  execution surface (a foreign firmware build, the native checker). On the BM26
  engine it is well-defined, as above.

### 9.4 Frame-to-frame state persistence

A compiled pattern is a **single long-lived VM instance**: it is created once and then driven with
repeated `begin_frame` + render calls. `begin_frame` does **not** wipe script memory. Therefore:

- **All top-level `var`s and `array()`s retain their values across frames.** Writing `accum += ...`
  in `beforeRender`, or `buf[i] = buf[i] * decay`, accumulates frame over frame. This is the
  foundation of every feedback/trail effect (§9.5). Production pattern `47_apex_perimeter_ping`
  relies on exactly this (decaying `coronaA*` envelopes + accumulating `tPing/tRing` phases).
- **State is per-VM-instance and resets on (re)compile.** Loading the pattern, a live-edit, a
  deck/pattern swap, or a transition that instantiates a fresh background buffer all re-run
  top-level init and clear your accumulators. **Never assume a trail survives a pattern change.**
- `beforeRender` and the render entrypoint share one flat symbol table (§2.3), so `beforeRender`
  can prepare state that the per-pixel path reads.
- During transitions the engine may run a pattern invisibly in a background buffer (§13.1). Drive
  state from `time()` / `delta`, never from an assumed absolute frame count.

### 9.5 Simulating trails (frame feedback)

"Trail" / "ghost" / "motion-blur" effects all reduce to: **carry brightness from the previous frame
forward, decayed.** There are three ways to do it; pick by what you need.

> **Model portability first.** Options (A) and (C) hold no per-pixel state and
> run unchanged on every model. Option (B) needs a model-sized array and is
> therefore **model-specific by construction** — reach for it only when the
> effect genuinely requires independent per-pixel memory.

**(A) Scalar decay envelope** — *parametric trails*: "an event happened, now fade it out."
Persist one scalar, set it to `1.0` on the event, multiply/subtract it down every frame. Cheap;
ideal for pulses, pings, searchlight afterglow, heartbeat.

```javascript
var env = 0.0, lastPhase = 0.0, clock = 0.0;

export function beforeRender(delta) {
  clock = clock + (delta / 1310.72) * 0.5;
  var phase = clock % 1.0;
  if (phase < lastPhase) env = 1.0;     // re-trigger on each wrap (or on an audio kick)
  lastPhase = phase;
  env = env - (delta / 1310.72) * 2.0;  // decay the tail
  if (env < 0.0) env = 0.0;
}

export function render3D(index, x, y, z) { hsv(0.0, 1, env); }
```

**(B) Per-pixel feedback buffer (`array`)** — *true "paint and fade" pixel trails.* Keep your own
brightness buffer; decay every cell each frame and inject new energy at the source position, then
read `buf[index]` per pixel.

```javascript
// pixelCount bakes to a literal (~144) in the current VM, so the size must be
// an explicit constant — which makes this pattern MODEL-SPECIFIC. Say so.
// MODEL-SPECIFIC: titanic = 964 mapped pixels; test_bench differs.
var N = 964;
var buf = array(N);     // allocated ONCE at top-level init — never allocate in render
var head = 0.0;

export function beforeRender(delta) {
  head = (head + (delta / 1310.72) * 0.25) % 1.0;
  var k = 0;
  for (k = 0; k < N; k = k + 1) { buf[k] = buf[k] * 0.85; }  // decay the whole buffer
  buf[floor(head * N) % N] = 1.0;                            // inject the moving head
}

export function render3D(index, x, y, z) { hsv(0.55, 0.9, buf[index]); }
```

Rules for (B):
- Allocate the buffer in **top-level init**, not in `render` (render runs with allocation disabled,
  §7) and not per-frame in `beforeRender`.
- **Do not rely on `pixelCount`** for buffer size or head index — it compiles to a literal `144`
  (§5.1) regardless of the real model. Verified by probe: a VM created for 4, 144 and 964 pixels
  all report ~144 to the pattern.
- **Do not treat any hard-coded count as portable, including `144`.** `144` is a test-bench-era
  number; the Titanic has **964** mapped pixels. State the model the constant is for, in a comment,
  next to the constant.
- Prefer a formulation that needs no model-sized array at all: a moving head plus a spatial falloff
  (`smoothstep(head + len, head, x)`) evaluated in `render3D` gives a comet tail that is
  resolution-independent and portable.
- The decay loop is `O(N)` once per frame (fine); the per-pixel read must stay under the
  5000-instruction budget (§9.1).
- Decay closer to `1.0` = longer tail. Expose it as a `slider*` so operators can tune tail length.

**(C) Mixer-level feedback (no pattern code).** The engine's `feedbackTrails` **global effect**
(`marsin_engine/effects/feedbackTrails.js`) owns an RGBWAU trail buffer of the **composited
output** and mixes it back each frame (`decay`, `injection`, `mix`, `colorBleed`, `blendMode`). Use
it to ghost *any* pattern — including ones that manage no state of their own — toggled live by the
operator. It is model-agnostic, so it is the right first choice for whole-frame feedback.

> **Boundary — what you cannot do:** a pattern **cannot read its own previous rendered pixel
> output**. There is no `prevPixel` / last-frame color fed into `render`. "Feedback" *inside* a
> pattern means state **you** maintain (A or B). Output-feedback of the composited frame exists only
> at the mixer (C).

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
5. Prefer `x`, `y`, and `z` over `pixelCount` when you need normalized spatial behavior — `pixelCount` is a literal `144` on every model (§5.1).
6. Keep helper functions numeric; do final color emission in the render path.
7. Drive motion from the clock (`t`, `time(scale)`, or accumulated `delta`), never from a frame counter — your `beforeRender` can run invisibly in a transition's background buffer (§13.1).
8. Do not apply a global speed multiplier of your own: the host's clock is already speed-scaled (§9.3).
9. Target topology by view name, not by a raw section literal (§5.2.1), and add no metadata fallbacks (§5.2).

For the engine-side and show-side contracts that sit on top of this language —
parameter philosophy, the `w == a` white invariant, audio policy, and the
verification harnesses — see
[`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md).

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

> **This four-value tuple is the FIRMWARE model-artifact format, not the host
> meta ABI.** The BM26 Node host does not consume these JSON artifacts; it packs
> a **seven-lane** per-pixel buffer (`fixtureType`, `pixelLocalIndex` and
> `viewMaskHi` in addition to the four above) for the WASM `*_with_meta` render
> exports — see §5.2 and
> [`marsin_engine/lib/meta_abi.js`](../marsin_engine/lib/meta_abi.js). A pixel
> loaded from a v2 firmware artifact simply has `0` in the three lanes the
> artifact cannot express.

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

Example pattern targeting model topology — **by view name**, which is portable
and fails loudly on a typo (§5.2.1):

```javascript
var phase = 0.0;

export function beforeRender(delta) { phase = time(0.05); }

export function render3D(index, x, y, z) {
  if (inView("Left Front Wall")) {
    hsv(0.00, 1, wave(phase + y));
  } else if (inView("Right Front Wall")) {
    hsv(0.33, 1, wave(phase + y));
  } else {
    hsv(0.66, 1, wave(phase + y));
  }
}
```

> **Do not write `sectionId == 2  // Vintage`.** Section ids are numbers a
> particular model happens to assign; they are not a portable taxonomy, and
> there is no global meaning for any of them. `test_bench` uses `1/2/3`; the
> Titanic uses values in the hundreds. Branching on a raw section literal binds
> the pattern to one model — which is allowed, but must be stated in the
> pattern header. Where the real distinction is fixture *capability*, use
> `fixtureType == FIX_*` (§5.2.2) instead. And do not add a `sectionId == 0`
> coordinate fallback: that is a fallback behaviour (§5.2, codex P0).

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

## 13. Blending and Transition Scripts

MarsinScript features a double-buffered execution environment. During a transition between two patterns, the engine evaluates the outgoing pattern, the incoming pattern, and an optional **transition script** to determine how they blend.

### 13.1 Authoring Pattern Scripts (Transparency)

Crossfading is completely transparent to standard pattern scripts. If you are writing a standard pattern, you do not need to write any custom fade-in logic. Write your pattern as if it is the only one running. 

To ensure your pattern transitions smoothly:
- **Initialize state safely:** Ensure all persistent arrays and accumulators are initialized in the top-level init block. The engine will run this block once when your script is loaded into the background buffer.
- **Never rely on exact frame counts:** Your `beforeRender` may execute invisibly in the background buffer. Always use `time()` or the `delta` parameter to drive animations, rather than incrementing a fixed counter per frame.

### 13.2 Authoring Transition Scripts

Transition scripts are special MarsinScripts placed in the `/transitions/*.js` directory. They are executed per-pixel during a pattern change.

In a transition script, you have access to standard geometry (`x`, `y`, `z`, `index`) plus special **Transition Built-ins**:

| Variable | Meaning |
|---|---|
| `progress` | A normalized float `0.0` to `1.0` representing the transition time |
| `fromR`, `fromG`, `fromB`, `fromW`, `fromA`, `fromU` | The outgoing pattern's pixel color (normalized `0..1`) |
| `toR`, `toG`, `toB`, `toW`, `toA`, `toU` | The incoming pattern's pixel color (normalized `0..1`) |

A transition script's job is to read these built-ins, calculate the mix, and output the final pixel color via `rgbwau()`.

#### The transition / channel-blend contract

Every script in `patterns/transitions/` and `patterns/channel_blends/` must
satisfy all six:

1. **Exact outgoing endpoint at `progress == 0`** — output equals the `from*`
   input exactly. Anything else pops the instant a fader leaves rest.
2. **Exact incoming endpoint at `progress == 1`** — output equals the `to*`
   input exactly. A channel at full fader must render its pattern, not an
   approximation of it.
3. **Bounded output** — every lane stays within `0..1`; an additive mode's
   clamp must be a designed ceiling, not an accident.
4. **Identical compositing math for W and A** — whatever expression produces
   the W output must produce the A output with the A inputs substituted, so two
   matched inputs (`fromW == fromA`, `toW == toA`) stay matched on the way out.
   This is what preserves the show's `w == a` white invariant through the mixer
   (see [`MARSIN_ENGINE_PATTERNS.md`](MARSIN_ENGINE_PATTERNS.md) §6.2) and why
   blend scripts are exempt from the pattern lane-match test.
5. **No per-pixel allocation** — `render` runs with allocation disabled (§7),
   and three scripts share the per-pixel instruction budget (§13.3).
6. **Truthful direction for spatial transitions** — a wipe named `wipe_left`
   travels left; a `direction`/`feather` control must measurably change the
   thing it names.

#### Example: Spatial X-Wipe

You can use the spatial coordinates to create geometric transitions. Here is a wipe that sweeps across the `x` axis with a feathered edge:

```javascript
// /transitions/wipe_x.js
export var feather = 0.08;

export function render(index, x, y, z) {
  // Use progress to move the wipe threshold across X
  var edge = smoothstep(progress - feather, progress + feather, x);

  rgbwau(
    mix(fromR, toR, edge),
    mix(fromG, toG, edge),
    mix(fromB, toB, edge),
    mix(fromW, toW, edge),
    mix(fromA, toA, edge),   // SAME expression as W — matched inputs stay matched
    mix(fromU, toU, edge)
  );
}
```

#### Example: Screen Blend Mode

You can implement compositor-style blend modes (Add, Multiply, Screen, Difference). Here is a "Screen" transition that prevents hard clipping for luminous patterns:

```javascript
// /transitions/screen_fade.js

// Screen function: 1 - (1 - base) * (1 - top)
function screen(base, top) {
  return 1 - (1 - base) * (1 - top);
}

// Blend standard progress between outgoing and the screen-blended result
function apply(base, top) {
  return mix(base, screen(base, top), progress);
}

export function render(index, x, y, z) {
  rgbwau(
    apply(fromR, toR),
    apply(fromG, toG),
    apply(fromB, toB),
    apply(fromW, toW),
    apply(fromA, toA),
    apply(fromU, toU)
  );
}
```

### 13.3 Performance Implications

During a scripted transition, the engine evaluates three scripts per-pixel: the outgoing pattern, the incoming pattern, and the transition script. 

This effectively divides your instruction budget. Keep transition scripts heavily optimized. Avoid allocating arrays inside the transition `render()` loop. If the engine detects a heap constraint or execution overrun, it will fall back to a highly-optimized native C++ crossfade or an immediate hard cut.

### 13.4 Channel Blend Context (Mixer)

The same blend scripts are reused in the **channel mixer**. In a mixer, multiple pattern channels play simultaneously and are composited in stack order. Each channel has a **fader** (0.0–1.0) and a **blend mode** (e.g., `blend_screen`, `blend_add`).

In this context, the transition built-ins are bound differently:

| Variable | Transition Context | Channel Blend Context |
|---|---|---|
| `progress` | Elapsed time / duration (0→1 automatically) | Channel **fader** value (user-controlled) |
| `fromR/G/B/W/A/U` | Outgoing pattern's pixel output | Accumulated mix-so-far (previous channels) |
| `toR/G/B/W/A/U` | Incoming pattern's pixel output | This channel's rendered pixel output |

So `blend_screen.js` with `progress = fader` blends the channel's output using screen compositing at the fader's intensity. The scripts are identical — only the engine's binding of `progress` changes.

**Resolution and the valid set.** The mixer resolves a blend name by looking in
`patterns/channel_blends/<name>.js` first, then `patterns/transitions/<name>.js`
(`lib/pattern_mixer.js` `_compileBlend`); a name found in neither is reported
loudly and the channel composites through the degraded host-side path. The API
accepts exactly **three steady channel-blend modes**
(`VALID_CHANNEL_BLEND_MODES` in `lib/api_server.js`), plus any `trans_*` name
used transiently while a fade is in flight — anything else is rejected with a
400:

| Script | Behavior |
|---|---|
| `blend_screen` | `1 - (1-from)(1-to)` — additive without clipping (the default channel mode) |
| `blend_add` | pure additive, scaled by `progress` (can clip) |
| `blend_over` | alpha-over compositing using `progress` as opacity |

Scripted transitions live in `patterns/transitions/` as `trans_*` — currently
`trans_color_burst`, `trans_crossfade`, `trans_diagonal_wipe`,
`trans_diamond_wipe`, `trans_dissolve`, `trans_flash`, `trans_iris`,
`trans_iris_close`, `trans_morse_blink`, `trans_ripple_in`,
`trans_split_horizontal`, `trans_split_vertical`, `trans_wave_sweep`,
`trans_wipe_down`, `trans_wipe_left`, `trans_wipe_right`. Read the directory
rather than this list when it matters — the set changes.

---

## 14. Final Language Contract

MarsinScript, as implemented today, is:

- a numeric VM language with arrays and user-defined numeric helper functions
- Pixelblaze-compatible at the core color-language level through `rgb()` and `hsv()`
- Marsin-extended through `rgbwau()` and the internal `MarsinPixel` RGBWAU model
- Marsin-extended through the seven metadata builtins — `controllerId`, `sectionId`, `fixtureId`, `viewMask`, `fixtureType`, `pixelLocalIndex`, `viewMaskHi` — and the compile-time `inView()` / `MASK_*` / `FIX_*` injections layered over them
- Marsin-extended through transition built-ins (`progress`, `fromR/G/B/W/A/U`, `toR/G/B/W/A/U`)
- intentionally separated from hardware transport details

If a script needs to stay Pixelblaze-like, keep to:

- `beforeRender(delta)`
- `render(index, x, y, z)`
- numeric math and arrays
- `rgb()` and `hsv()`

If a script needs Marsin-specific multi-emitter control, use:

- `rgbwau()` — and keep the W and A lanes matched wherever it emits logical white (`MARSIN_ENGINE_PATTERNS.md` §6.2)

If a script needs Marsin-specific topology-aware behavior:

- **prefer `inView("Authored View Name")`** — portable across models, resolves
  both view words, fails the compile loudly on an unknown name
- use `fixtureType == FIX_*` where the real distinction is fixture capability
- use raw `controllerId` / `sectionId` / `fixtureId` only for deliberately
  single-model work, and say so in the pattern header
- **do not add a `== 0` metadata fallback.** The old "always include a `== 0`
  fallback for v1 model compatibility" advice is withdrawn — it is a fallback
  behaviour (codex P0), and it is what let 137 parameters sit dead on the ship
  while looking healthy on the test bench

If a script is a transition/blend script, use:

- `progress`, `fromR/G/B/W/A/U`, `toR/G/B/W/A/U`
- Output via `rgbwau()` for full channel support
- Satisfy all six contract points in §13.2

Both Marsin extensions are Marsin-only, not cross-compatible with Pixelblaze proper.

