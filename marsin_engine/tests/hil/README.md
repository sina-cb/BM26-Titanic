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
3. For tests that exercise the mixer transition pipeline
   (`hil_transition_smoothness_test.mjs`, `hil_transition_type_test.mjs`),
   the mixer state must contain **at least 2 overlay channels** in
   addition to the base/deck channel. The tests only use existing
   overlays and restore their fader/enabled/mode state on exit. If
   you're starting from an empty mixer, the `visual` test below adds
   its own channels first.

## Running Tests

```bash
cd marsin_engine
node tests/hil/hil_transition_smoothness_test.mjs
node tests/hil/hil_transition_type_test.mjs
node tests/hil/hil_transition_visual_test.mjs
node tests/hil/hil_transition_test.mjs
node tests/hil/hil_deck_swap_test.mjs
```

Each test exits with code `0` on full pass and `1` on any failure, so
they can be wired into CI or run sequentially as a smoke gate.

## Test Inventory

| Test | File | What it validates |
|------|------|-------------------|
| Transition Symmetry | `hil_transition_test.mjs` | Fader crossfade produces symmetric output regardless of CH1→CH2 vs CH2→CH1 direction. Covers `blend_screen`, `blend_over`, per-pixel comparison, and brightness dip analysis. |
| Transition Smoothness | `hil_transition_smoothness_test.mjs` | Server-side `triggerMixerTransition` smoothness — smoothstep monotonicity, brightness sum stays ~1.0 (no sin/cos pump), 10 Hz progress broadcasts, completion fired exactly once, manual fader cancellation, validation rejects invalid targets, legacy `triggerTransition` back-compat. |
| Transition Type Wiring | `hil_transition_type_test.mjs` | The user's `transitionMode` pick (trans_crossfade / trans_flash / trans_dissolve / trans_wipe_*) is forwarded, honored, and the saved blend mode is restored on completion. Rapid back-to-back transitions don't leak `trans_*` into steady state. Manual `setChannelMode` mid-transition is sticky. |
| Transition Visual Output | `hil_transition_visual_test.mjs` | Pixel-level proof each `trans_*` script paints its signature: crossfade = smooth blend, flash = full WHITE midpoint, dissolve = per-pixel binary A-or-B, wipe = spatial gradient. Uses `test_const` + `test_dualband` for deterministic baselines and asserts pixel patterns post-restoration. |
| Deck Pattern Swap | `hil_deck_swap_test.mjs` | End-to-end deck soft-swap path via the engine's hidden shadow channel (`triggerDeckPatternSwap`): `/deck/transition-config` round-trip; transitions-off → instant load (no `deckSwapStarted`); transitions-on `trans_crossfade` produces a non-white blend at midpoint and lands on B's solo signature within duration; `trans_flash` paints WHITE midpoint; autopilot shuffle picks distinct entries; autopilot routes through the swap when enabled; **tap-during-swap returns 409 with `code:'EBUSY'` (operator clicks are silently ignored, not queued)**; **view→mixer mid-fade finalizes the swap immediately so coming back to the deck shows the destination pattern fully**; **autopilot timer is decoupled from transition duration (cycle = delay + transition + delay + … instead of every-N-seconds-regardless)**. Owns its own `hil_deck_swap` playlist so it doesn't disturb operator playlists. |

## Adding New Tests

1. Create a new `.mjs` file in this directory
2. Use `http` + `ws` to talk to the engine on port `6968`
3. Add a doc header explaining prerequisites, how to run, and what it tests
4. Update this table

## Notes

- Tests create/delete their own mixer channels (or restore the
  existing channels' state on exit — depends on the test, see the doc
  header in each file)
- The engine must be running before you start a test
- Tests capture vis data via WebSocket `vis` messages (base64-encoded RGBWAU, 6 bytes/pixel)
- Tests engage **mixer view** (`POST /mixer/view {view:'mixer'}`)
  before sampling pixels, because the master output defaults to the
  deck channel — sampling without this would read the base channel,
  not the mixer composite
- `SETTLE_MS` (200ms default) controls how long to wait after API calls for the render loop to converge
