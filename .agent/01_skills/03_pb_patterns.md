# Skill: Pixelblaze-Compatible Pattern Engine (WASM)

The simulation includes a **pre-built WebAssembly pattern engine** (`lib/marsin-engine/`) that compiles and runs LED patterns written in a JavaScript-like language compatible with [Pixelblaze](https://electromage.com/pixelblaze) by Ben Hencke.

This engine runs the **exact same bytecode VM** as the physical ESP32 LED controllers — patterns written here will look identical on real hardware.

---

## 1. Quick Start

```javascript
import { MarsinEngine } from './MarsinEngine.js';

const engine = new MarsinEngine();
await engine.init();  // loads WASM from lib/marsin-engine/

// Compile a rainbow pattern
engine.compile(`
  export function beforeRender(delta) {
    t1 = time(0.1)
  }
  export function render(index) {
    h = t1 + index / pixelCount
    hsv(h, 1, 1)
  }
`);

// In your animation loop:
engine.beginFrame(elapsedTimeSeconds);
for (let i = 0; i < ledCount; i++) {
  const { r, g, b } = engine.renderPixel(i, i / (ledCount - 1), 0, 0);
  // r, g, b are 0-255
}
```

---

## 2. API Reference (`MarsinEngine.js`)

### `async init(wasmDir = './lib/marsin-engine')`
Load the WASM module. Call once at startup.

### `compile(sourceCode: string): boolean`
Compile a pattern. Returns `true` on success. On failure, call `getError()`.

### `getError(): string`
Get the compile error message (includes line number).

### `beginFrame(timeSeconds: number): void`
Call once per animation frame. Runs the pattern's `beforeRender(delta)`.

### `renderPixel(index, x?, y?, z?): {r, g, b}`
Render one pixel. Returns RGB 0-255. Coordinates default to 0.

### `renderAll(pixelCount, coords?): Uint8Array`
Batch render all pixels. Returns flat RGB buffer (3 bytes per pixel).
- `coords`: optional `Float32Array` with 3 floats per pixel (x, y, z)
- If `null`, uses linear mapping: `x = index / (pixelCount - 1)`

### `destroy(): void`
Free the engine instance.

---

## 3. The Pattern Language

The language is JavaScript-like with Pixelblaze compatibility (created by Ben Hencke, [electromage.com](https://electromage.com)). All values are **floating-point numbers** (no strings, no objects).

### Entry Points

Every pattern must define at least `render`:

```javascript
// Called once at startup
// Use for array allocation, palette setup
var myPalette

// Called once per frame
// delta = milliseconds since last frame
export function beforeRender(delta) {
  t1 = time(0.1)    // slow sawtooth
  t2 = time(0.05)   // slower sawtooth
}

// Called once per pixel per frame
// index = pixel number (0, 1, 2, ...)
export function render(index) {
  hsv(t1 + index / pixelCount, 1, 1)
}

// 2D variant (if pixel map has x,y)
export function render2D(index, x, y) {
  hsv(x + t1, 1, wave(y + t2))
}

// 3D variant (if pixel map has x,y,z)
export function render3D(index, x, y, z) {
  v = wave(hypot3(x - 0.5, y - 0.5, z - 0.5) - t1)
  hsv(0, 0, v)
}
```

### Variables

| Variable | Scope | Description |
|----------|-------|-------------|
| `t` | Frame | Current time in seconds (from `beginFrame()`) |
| `index` or `i` | Pixel | Current pixel index (integer) |
| `x`, `y`, `z` | Pixel | Normalized coordinates (0.0–1.0) |
| `pixelCount` | Global | Total number of LEDs (currently 144) |
| `PI` | Const | 3.14159... |
| `PI2` | Const | 6.28318... (2π) |
| `true` / `false` | Const | 1.0 / 0.0 |

### Operators

```
Arithmetic:    +  -  *  /  %
Comparison:    <  >  <=  >=  ==  !=
Logical:       &&  ||  !     (short-circuit)
Bitwise:       &  |  ^  ~  <<  >>
Ternary:       condition ? valueIfTrue : valueIfFalse
Unary:         -  !  ~
```

### Control Flow

```javascript
if (condition) {
  // ...
} else {
  // ...
}

for (i = 0; i < 10; i = i + 1) {
  // ...
}

while (condition) {
  // break and continue are supported
}
```

### User Functions

```javascript
function myHelper(a, b) {
  return a * b + 0.5
}

export function render(index) {
  v = myHelper(index, t1)
  hsv(v, 1, 1)
}
```

Forward references are allowed — call a function before it's defined.

### Arrays

```javascript
// Create with size
myArr = array(10)

// Literal syntax
colors = [0.0, 0.33, 0.66]

// Access
val = myArr[3]
myArr[3] = 0.5

// Allocate in init/beforeRender only (not in render — performance guard)
```

---

## 4. Built-in Functions

### Color Output (terminates render for this pixel)

| Function | Args | Description |
|----------|------|-------------|
| `hsv(h, s, v)` | 3 | Set pixel color. H wraps 0–1, S/V clamped 0–1 |
| `rgb(r, g, b)` | 3 | Set pixel color. All values 0–1 |

### Timing & Waveforms

| Function | Args | Description |
|----------|------|-------------|
| `time(interval)` | 1 | Sawtooth 0→1, period = `65.536 * interval` seconds |
| `wave(v)` | 1 | Sine wave: `(1 + sin(v * 2π)) / 2` → 0..1 |
| `square(v, duty)` | 2 | Square wave with duty cycle |
| `triangle(v)` | 1 | Triangle wave 0→1→0 |

### Interpolation

| Function | Args | Description |
|----------|------|-------------|
| `mix(low, high, weight)` | 3 | Linear interpolation |
| `smoothstep(low, high, v)` | 3 | Hermite interpolation |
| `clamp(v, low, high)` | 3 | Constrain value to range |

### Math

| Function | Args | Description |
|----------|------|-------------|
| `sin(v)`, `cos(v)`, `tan(v)` | 1 | Trig (input in **turns**, not radians: `sin(0.25)` = 1.0) |
| `asin(v)`, `acos(v)`, `atan(v)` | 1 | Inverse trig (returns turns) |
| `atan2(y, x)` | 2 | Two-argument arctangent (returns turns) |
| `pow(base, exp)` | 2 | Power |
| `sqrt(v)` | 1 | Square root |
| `exp(v)`, `log(v)`, `log2(v)` | 1 | Exponential / logarithmic |
| `abs(v)` | 1 | Absolute value |
| `floor(v)`, `ceil(v)` | 1 | Rounding |
| `round(v)`, `trunc(v)`, `frac(v)` | 1 | Round / truncate / fractional part |
| `min(a, b)`, `max(a, b)` | 2 | Minimum / maximum |
| `hypot(x, y)` | 2 | 2D distance: `sqrt(x² + y²)` |
| `hypot3(x, y, z)` | 3 | 3D distance: `sqrt(x² + y² + z²)` |

### Noise (Perlin)

| Function | Args | Description |
|----------|------|-------------|
| `perlin(x, y, z, seed)` | 4 | 3D Perlin noise → 0..1 |
| `perlinFbm(x, y, z, lac, gain, oct)` | 6 | Fractal Brownian motion |
| `perlinRidge(x, y, z, lac, gain, off, oct)` | 7 | Ridge noise |
| `perlinTurbulence(x, y, z, lac, gain, oct)` | 6 | Turbulence noise |
| `setPerlinWrap(x, y, z)` | 3 | Set noise tiling period |

### Random

| Function | Args | Description |
|----------|------|-------------|
| `random(max)` | 1 | Deterministic random 0..max (stateless, seeded by frame+pixel+callsite) |

### Arrays

| Function | Args | Description |
|----------|------|-------------|
| `array(size)` | 1 | Create new array of given size (init/beforeRender only) |

---

## 5. Pattern Examples

### Rainbow Scroll
```javascript
export function beforeRender(delta) {
  t1 = time(0.1)
}
export function render(index) {
  hsv(t1 + index / pixelCount, 1, 1)
}
```

### Breathing Pulse
```javascript
export function beforeRender(delta) {
  v = wave(time(0.05))
}
export function render(index) {
  hsv(0, 0, v)
}
```

### 2D Plasma
```javascript
export function beforeRender(delta) {
  t1 = time(0.1)
  t2 = time(0.13)
}
export function render2D(index, x, y) {
  v1 = wave(x * 3 + t1)
  v2 = wave(y * 3 + t2)
  v3 = wave(hypot(x - 0.5, y - 0.5) * 4 - t1)
  v = (v1 + v2 + v3) / 3
  hsv(v + t1, 1, v)
}
```

### Perlin Fire
```javascript
export function beforeRender(delta) {
  t1 = time(0.08)
}
export function render2D(index, x, y) {
  n = perlinFbm(x * 3, y * 3 - t1 * 5, 0, 2, 0.5, 4)
  n = n * (1 - y)  // fade with height
  hsv(n * 0.1, 1, n * n)
}
```

### Sparkle
```javascript
export function beforeRender(delta) {
  t1 = time(0.01)
}
export function render(index) {
  v = random(1)
  v = pow(v, 10)
  hsv(t1, 0.5, v)
}
```

### Color Wipe
```javascript
export function beforeRender(delta) {
  pos = wave(time(0.05)) * pixelCount
}
export function render(index) {
  d = abs(index - pos)
  v = clamp(1 - d / 5, 0, 1)
  v = v * v
  hsv(0.6, 1, v)
}
```

---

## 6. Integration with LedStrand

To wire the engine into the simulation's LED strands:

```javascript
// In animation loop (main.js animate function)
engine.beginFrame(clock.getElapsedTime());

(window.ledStrandFixtures || []).forEach(fixture => {
  const count = fixture.config.ledCount || 10;
  const bulbs = fixture.group.children.filter(
    c => c.userData._strandPart === 'led'
  );

  // Filter to just the bulb meshes (every 3rd child: housing, bulb, halo)
  bulbs.forEach((child, idx) => {
    if (idx % 3 !== 1) return; // only the glowing bulb mesh
    const ledIdx = Math.floor(idx / 3);
    const t = count > 1 ? ledIdx / (count - 1) : 0.5;
    const { r, g, b } = engine.renderPixel(ledIdx, t, 0, 0);
    child.material.color.setRGB(r / 255, g / 255, b / 255);
    child.material.emissive.setRGB(r / 255, g / 255, b / 255);
  });
});
```

---

## 7. Important Notes

- **Trig uses turns, not radians**: `sin(0.25)` = 1.0 (quarter turn = 90°). This is a Pixelblaze convention.
- **`time()` is frame-driven**: It uses the elapsed time from `beginFrame()`, not wall-clock time.
- **`random()` is deterministic**: Same frame + pixel + callsite = same value. This enables distributed rendering where multiple controllers produce identical output.
- **No strings or objects**: Every value is a float. Arrays hold floats.
- **Array allocation only in init/beforeRender**: The VM blocks array creation in `render()` for performance safety.
- **Comments**: Both `//` single-line and `/* */` multi-line are supported.

---

## 8. Credits

The pattern language is compatible with **Pixelblaze** by **Ben Hencke** ([electromage.com](https://electromage.com), [github.com/simap](https://github.com/simap)). Pixelblaze is an incredible platform for LED art, and this engine aims to maintain compatibility with its pattern ecosystem.

See also: `lib/marsin-engine/README.md` for binary details.
