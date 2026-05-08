# 08. MarsinScript Patterns

This spec defines how to write, compile, and test lighting patterns for the `marsin_engine`. Patterns are compiled into WASM bytecode and executed on the local Pixelblaze-compatible VM.

## Writing a Pattern

Patterns are authored in JavaScript and placed in `marsin_engine/patterns/` as `.js` files. They must export `beforeRender(delta)` and `render(index, x, y, z)`.

```javascript
// patterns/my_pattern.js
export function beforeRender(delta) {
  // Executed once per frame. 
  // Use to calculate time ramps, update globals, or read transition states.
}

export function render(index, x, y, z) {
  // Executed per pixel. 
  // x, y, z are normalized 3D coordinates (0.0 to 1.0).
  hsv(x, 1, 1);
}
```

## Engine Capabilities & Math Context

1. **Radian Trigonometry:** The VM has been migrated to use **radian-based math** for trigonometric functions (`sin`, `cos`, etc.). Do NOT use turn-based logic (0-1).
2. **Crossfade Transitions:** The engine supports double-buffered transition blending. If writing transition-aware scripts, use the 13 built-in transition variables (`progress`, `from*`, `to*`) to coordinate crossfades.
3. **6-Channel Fixture Support:** For modern RGBWAU fixtures, use `rgbwau(r, g, b, w, a, u)` instead of `hsv()` for direct multi-channel diode control.

## Offline Readiness Requirements

1. **Zero External Dependencies:** Patterns are strict mathematical/logic functions running inside a sandboxed WASM VM. They cannot `require()` node modules or fetch data from the internet. 
2. **Bounded Execution:** Patterns must execute within strict computational limits per frame to maintain the target 40 FPS. Avoid intensive loops or nested iterations.
3. **Parameter Injection:** Any dynamic data (BPM, intensity modifiers, palettes) must be exposed via standard UI mapping exports and controlled locally via CaptainPad. No cloud polling allowed.
4. **Standalone Compilation:** The MarsinScript WASM compiler is fully bundled locally within the engine. Generating and loading new patterns offline requires absolutely no internet connectivity or remote build servers.

## Testing Patterns

Test your pattern locally against the test bench model to ensure compilation succeeds and framerates are stable before deploying:

```bash
cd marsin_engine
node engine.js --pattern my_pattern --model test_bench --dry-run
```

For existing smoke checks, use:

```bash
npm run check:rainbow
npm run check:breathing
npm run check:fire
```
