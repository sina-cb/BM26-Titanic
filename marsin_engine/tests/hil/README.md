# HIL (Hardware-in-the-Loop) Tests

End-to-end tests that exercise the **live MarsinEngine** through its REST + WebSocket API.
These tests use real WASM compilation, actual blend scripts, and live pixel output — no mocks.

## Prerequisites

1. Engine running with `test_bench` model:
   ```bash
   cd marsin_engine
   node engine.js --pattern test_const --model test_bench
   ```
2. `ws` package installed (already in engine `node_modules`)

## Running Tests

```bash
cd marsin_engine
node tests/hil/hil_transition_test.mjs
```

## Test Inventory

| Test | File | What it validates |
|------|------|-------------------|
| Transition Symmetry | `hil_transition_test.mjs` | Fader crossfade produces symmetric output regardless of CH1→CH2 vs CH2→CH1 direction. Covers `blend_screen`, `blend_over`, per-pixel comparison, and brightness dip analysis. |

## Adding New Tests

1. Create a new `.mjs` file in this directory
2. Use `http` + `ws` to talk to the engine on port `6968`
3. Add a doc header explaining prerequisites, how to run, and what it tests
4. Update this table

## Notes

- Tests create/delete their own mixer channels and restore state on exit
- The engine must be running before you start a test
- Tests capture vis data via WebSocket `vis` messages (base64-encoded RGBWAU, 6 bytes/pixel)
- `SETTLE_MS` (200ms default) controls how long to wait after API calls for the render loop to converge
