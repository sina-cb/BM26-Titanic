# 07. Run Marsin Engine

This spec outlines how to run the `marsin_engine` locally or on the production environment. The engine is responsible for rendering Pixelblaze-compatible patterns and routing sACN DMX data to the simulation or physical controllers.

## How to Start the Engine

To start the engine with a specific pattern and 3D pixel model:

```bash
cd marsin_engine
node engine.js --pattern rainbow --model test_bench
```

Or using NPM shortcuts:
```bash
npm run fire
npm run breathing
npm run bio
npm run golden
```

## Core Infrastructure

- **API Server:** Binds to port `6968` (REST/WebSocket) to accept live CaptainPad control inputs and pattern swaps.
- **WASM VM:** Compiles and executes patterns locally through `lib/wasm_host.js`, backed by `lib/marsin_wasm_runtime.js` and the bundled `marsin_pb/wasm/` runtime.
- **DMX Output:** Maps pixel output to DMX frames through `simulation/src/dmx/sacn_mapper.js` and outputs sACN via UDP through `lib/sacn_output.js`.

## Offline Readiness Requirements

1. **Local Network Discovery:** The CaptainPad mobile app and web UI rely on local LAN subnet discovery or static Tailscale routing to find the engine. Ensure the `--dest` parameter correctly points to local controllers or `127.0.0.1` for simulation.
2. **Standalone Web Client Hosting:** `marsin_engine/config.yaml` has a reserved `web_client` block, but the current engine API server does not serve `CaptainPad/dist`. Until that is implemented, serve the browser UI from `CaptainPad` with `npm run web:build` and `npm run web:serve`, or install the iPad app through the EAS runbook.
3. **No External Data Integrations:** The engine must never call external weather, internet time, or status APIs. All runtime variables must be supplied via local WebSockets from the isolated CaptainPad interface.
4. **Crash Resilience:** The daemon must be wrapped in a process manager (e.g., pm2 or systemd) for instant offline recovery if the WASM module panics.

## Live Control

Use CaptainPad to hot-swap patterns and alter parameters via `ws://localhost:6968/`. The engine supports multi-channel double-buffering, allowing seamless pattern transitions without dropping frames.
