# MarsinEngine Automated API Tests

This directory contains standalone execution tests designed to stress the live API layer of `engine.js` exactly as `CaptainPad` or other automated external orchestration tools would.

## Prerequisites

The tests run securely over port **6968**, meaning the core rendering engine must already be online.

1. Ensure the simulator web UI or actual hardware is waiting to receive sACN (or check simulator browser at `http://localhost:6969/simulation`).
2. Boot the standalone engine server:
   ```bash
   cd ../
   node engine.js --model test_bench --pattern rainbow
   ```

## Running the Speed & Reverse Test

Since we've enabled seamless API parameter manipulation into WASM memory, you can run the test script dynamically while the engine handles rendering:

```bash
cd hil_test
node test_speed_run.js
```

### What this test does:
1. Validates the API server is up by executing a `GET /patterns` check.
2. Forces a hot-swap operation to seamlessly switch over to `test_params.js`.
3. Injects values to drastically spin up the `speed` parameter, completely sets `reverse` to true, and forces `hold_flash` on dynamically without blocking or interrupting the active sACN thread.

Keep an eye on the simulation output window or the rendered simulation screen while you trigger this test to see it respond smoothly to the automated parameter hits!
