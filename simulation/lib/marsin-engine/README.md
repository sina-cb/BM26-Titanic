# LED Pattern Engine (WASM)

Pre-built WebAssembly module that compiles and runs LED patterns in a
[Pixelblaze](https://electromage.com/pixelblaze)-compatible language
(created by **Ben Hencke**, [electromage.com](https://electromage.com)).

## Files

| File | Description |
|------|-------------|
| `marsin-engine-{version}.js` | Versioned Emscripten loader |
| `marsin-engine-{version}.wasm` | Versioned compiled engine |
| `marsin-engine.js` | Stable loader (always latest) |
| `marsin-engine.wasm` | Stable binary (always latest) |

## Usage

See the full guide: [`.agent/01_skills/03_pb_patterns.md`](../../.agent/01_skills/03_pb_patterns.md)

```javascript
import { MarsinEngine } from './MarsinEngine.js';

const engine = new MarsinEngine();
await engine.init();
engine.compile(`
  export function render(index) {
    hsv(time(0.1) + index / pixelCount, 1, 1)
  }
`);

// Per frame:
engine.beginFrame(elapsedSeconds);
const { r, g, b } = engine.renderPixel(0, 0.5, 0, 0);
```

## Credits

Pattern language compatible with **Pixelblaze** by **Ben Hencke**
([electromage.com](https://electromage.com), [github.com/simap](https://github.com/simap)).
