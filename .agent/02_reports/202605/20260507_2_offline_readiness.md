# BM26 Titanic Offline Readiness Audit

Date: 2026-05-07
Scope: `simulation/`, `marsin_engine/`, relevant `simulation/unreal/` startup paths, and adjacent CaptainPad networking references. No code was changed.

## Executive Summary

The core MarsinEngine runtime does not require public internet to render once its npm dependencies and WASM artifacts are already present. It starts a local HTTP/WebSocket API on port `6968` and sends sACN UDP to configured destinations, defaulting to `127.0.0.1`.

The browser simulation is not currently offline-ready on a cold/no-cache browser because `simulation/index.html` imports Three.js, Three addons, `js-yaml`, and `chroma-js` from `cdn.jsdelivr.net`. If those CDN modules are not already cached, the simulation frontend will fail before `main.js` can run.

Both simulation and MarsinEngine startup have npm-tool cold-start risks:

- `simulation/start.js` launches `npx http-server`, but `http-server` is not declared in `simulation/package.json` or present in `simulation/node_modules/.bin`.
- `simulation/tools/kill-ports.js` and `marsin_engine/engine.js` call `npx -y kill-port`, but `kill-port` is not declared or locally installed in either package.

I found no Tailscale/Tailnet/MagicDNS/Headscale/tsnet references, and no `100.x.x.x` tailnet IPs, in the first-party files searched.

## Offline Readiness Verdict

| Component | Internet needed to start? | Notes |
|---|---:|---|
| `marsin_engine/engine.js` with installed deps | Mostly no | Local files, local WASM, local API, sACN UDP. Cold-start risk from `npx -y kill-port`. |
| `simulation/start.js` server processes | Yes on cold start | Uses `npx http-server`; `http-server` is not locally installed. Also prestart uses `npx -y kill-port`. |
| `simulation/index.html` browser app | Yes unless CDN cache exists | Import map points at `https://cdn.jsdelivr.net/...`; Google Font is also remote. |
| `simulation` sACN bridges | No public internet | Local WebSocket ports plus sACN UDP. Can send to LAN controller IPs from patch config. |
| `simulation/unreal/run_streaming.ps1` | No for the checked launcher if installed deps exist | Uses local PixelStreamingInfrastructure `npm start`, local `ws://localhost:8888`, local HTTP `:80`. Bundled Epic helper scripts can use internet if invoked separately. |
| CaptainPad runtime control path | No public internet, but LAN required | Default `api_base` is `http://10.1.1.172:6968`; discovery scans local /24 by probing `/status`. |

## Findings

### 1. Simulation frontend imports runtime modules from CDN

File: `simulation/index.html`

The import map resolves runtime modules to external URLs:

- `three`: `https://cdn.jsdelivr.net/npm/three@0.177.0/build/three.webgpu.min.js`
- `three/addons/`: `https://cdn.jsdelivr.net/npm/three@0.177.0/examples/jsm/`
- `js-yaml`: `https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm`
- `chroma-js`: `https://cdn.jsdelivr.net/npm/chroma-js@3.1.2/+esm`

This is the most direct internet dependency. Without internet or browser cache, ES module resolution fails and the simulation app will not start. The Google Font request to `fonts.googleapis.com` is also remote, but that is only visual degradation; the CDN import map is functional.

Important detail: `simulation/node_modules` currently contains local `three` and `js-yaml` packages that could be vendored or served locally, but `index.html` does not point to them. `chroma-js` is declared in `simulation/package.json`, but in this workspace I did not find it in `simulation/node_modules` or `simulation/package-lock.json`, so the lockfile/install state also needs to be corrected before offline packaging.

Suggested local-cache fix:

1. Create a checked-in browser dependency cache such as `simulation/vendor/`.
2. Copy the exact browser ESM files used by the import map into that cache:
   - `simulation/node_modules/three/build/three.webgpu.min.js`
   - `simulation/node_modules/three/build/three.tsl.min.js`
   - `simulation/node_modules/three/examples/jsm/**`
   - `simulation/node_modules/js-yaml/dist/js-yaml.mjs`
   - the installed ESM/browser entry for `chroma-js` after `chroma-js` is actually present in the lockfile/install.
3. Change the import map to local URLs, for example:

```json
{
  "imports": {
    "three": "./vendor/three/build/three.webgpu.min.js",
    "three/webgpu": "./vendor/three/build/three.webgpu.min.js",
    "three/tsl": "./vendor/three/build/three.tsl.min.js",
    "three/addons/": "./vendor/three/examples/jsm/",
    "js-yaml": "./vendor/js-yaml/js-yaml.mjs",
    "chroma-js": "./vendor/chroma-js/<verified-browser-entry>.js"
  }
}
```

4. Remove or locally host the Google Font. This is not a startup blocker, but it avoids an external request and prevents font fallback changes in kiosk/offline use.
5. Add a simple request audit to the offline smoke test: open the simulation with the network disabled and fail if any requested URL starts with `http://` or `https://` and does not target `localhost`, `127.0.0.1`, or the local rig subnet.

### 2. Simulation startup uses `npx http-server` without a local dependency

File: `simulation/start.js`

`start.js` spawns:

```text
npx http-server ../ -p <port> -c-1 --cors
```

But `simulation/package.json` does not include `http-server`, `simulation/package-lock.json` has no `http-server` entry, and `simulation/node_modules/.bin/http-server.cmd` is absent.

On an offline machine where `http-server` is not globally installed or cached by npm, `npm start` can fail before the browser app is served.

Suggested fix:

- Best option: replace `npx http-server` with a tiny first-party Node static server checked into `simulation/server/static-server.js`. It only needs to serve the repo root, set CORS headers if still required, disable cache for dev, and return `index.html`/static files. That removes both the npm-download risk and the undeclared dependency.
- Acceptable option: add `http-server` as an explicit dependency in `simulation/package.json` and `package-lock.json`, then invoke it via the local binary path instead of relying on `npx` to discover or download it. This is less clean than a first-party server but is still offline-capable after install.
- Move port cleanup out of npm `prestart`. `prestart` always runs before `npm start`, so a future `npm start -- --prod` would still hit `kill-ports.js` unless cleanup is gated inside `start.js` or split into a separate `start:dev` script.

### 3. Port cleanup uses `npx -y kill-port` without a local dependency

Files:

- `simulation/package.json`
- `simulation/tools/kill-ports.js`
- `marsin_engine/engine.js`

Simulation `npm start` runs `node tools/kill-ports.js`, and that script calls:

```text
npx -y kill-port <ports>
```

MarsinEngine startup also calls:

```text
npx -y kill-port <configured ports>
```

`kill-port` is not declared or locally installed in either `simulation` or `marsin_engine`. `Get-Command kill-port` also found no global command on this machine. Because errors are swallowed, this may not always block startup, but it is still an internet/cold-cache dependency and can delay or fail cleanup.

Suggested MarsinEngine production behavior:

- Add a `--prod` flag, or a more explicit `--no-kill-ports` flag, to `marsin_engine/engine.js`.
- In dev/default mode, either keep cleanup but make it local-only, or remove cleanup entirely.
- In `--prod` mode, never call `npx -y kill-port` and never kill an existing process automatically.
- If the API port is busy, fail fast with a clear error and non-zero exit:

```text
Port 6968 is already in use. MarsinEngine --prod will not kill existing processes.
Stop the existing engine or choose --port <other-port>.
```

`marsin_engine/lib/api_server.js` already has an `EADDRINUSE` error path for the API server. The main gap is that `engine.js` kills ports before it ever reaches that safer error behavior.

Suggested simulation behavior:

- Apply the same mode split to `simulation/start.js`: dev can attempt cleanup if implemented locally, production/offline should fail if ports are busy.
- Remove the unconditional npm `prestart` cleanup or convert scripts to something like:

```json
{
  "scripts": {
    "start": "node start.js",
    "start:dev": "node start.js --kill-ports",
    "start:prod": "node start.js --prod"
  }
}
```

That gives production startup deterministic behavior: no internet, no surprise process kills, and a clear port-busy error.

### 4. MarsinEngine runtime itself is local-first

Files:

- `marsin_engine/engine.js`
- `marsin_engine/lib/wasm_host.js`
- `marsin_engine/lib/api_server.js`
- `marsin_engine/lib/sacn_output.js`
- `marsin_engine/config.yaml`

The engine loads:

- patterns from `marsin_engine/patterns`
- models from `marsin_engine/models`
- state from `marsin_engine/states/<model>`
- WASM from `marsin_pb/wasm/marsin-engine.cjs` and `marsin_pb/wasm/marsin-engine.wasm`

It starts a local HTTP/WebSocket server on port `6968` and sends sACN UDP through the `sacn` npm package. Default config is:

```yaml
sacn:
  destinations:
    - 127.0.0.1
  multicast: false
server:
  port: 6968
```

The only public-internet-like behavior in the checked engine startup path is the `npx -y kill-port` cleanup. The actual renderer, API, state manager, and sACN sender do not call remote services.

### 5. Simulation networking is local/LAN, not public internet

Files:

- `simulation/config.yaml`
- `simulation/server/save-server.js`
- `simulation/server/sacn_bridge.js`
- `simulation/server/sacn_output_bridge.js`
- `simulation/src/dmx/sacn_input_source.js`
- `simulation/src/dmx/sacn_output_client.js`
- `simulation/src/gui/engine_blackout_warning.js`
- `simulation/src/gui/pattern_editor.js`

Local ports:

- `6969`: static web server
- `6970`: save/config/pattern/model API
- `6971`: sACN input bridge WebSocket
- `6972`: sACN output bridge WebSocket
- `5568`: sACN UDP
- `6968`: MarsinEngine API/WebSocket

The browser uses `fetch()` and `WebSocket()` heavily, but these are local URLs such as `localhost`, `127.0.0.1`, or `window.location.hostname`. These do not require public internet. They do require the local services to be running.

The sACN output path can send to real controller IPs from scene patch files. Example checked value:

```yaml
controllerIp: 10.1.1.102
```

That is LAN/private-address behavior, not internet dependence. It does mean the physical-output path expects a local wired/wifi network if you are driving real controllers.

### 6. Simulation engine-health checks are non-blocking

File: `simulation/main.js`

After initialization, the browser probes:

```text
http://<window.location.hostname>:6968/status
```

If this fails and the lighting mode is `sacn_in`, the app falls back to native Pixelblaze mode. This is not a public internet dependency. It is a local MarsinEngine availability check.

### 7. Browser-side local WASM loader is local, but depends on the app loading first

File: `simulation/src/core/marsin_engine.js`

The browser pattern engine loads:

```text
../marsin_pb/wasm/marsin-engine.js
../marsin_pb/wasm/marsin-engine.wasm
```

Those are local repo-served assets. However, the browser app must first get past the CDN import map in `simulation/index.html`.

### 8. Unreal Pixel Streaming path is local in the project launcher

Files:

- `simulation/unreal/run_streaming.ps1`
- `simulation/unreal/README.md`
- `simulation/unreal/scripts/sacn_unreal_receiver.py`
- `simulation/unreal/PixelStreamingInfrastructure/SignallingWebServer/package.json`
- `simulation/unreal/PixelStreamingInfrastructure/SignallingWebServer/config.json`

The checked `run_streaming.ps1` path:

- starts the signalling server with `npm start` under `PixelStreamingInfrastructure/SignallingWebServer`
- uses local `http://localhost` for the browser
- launches Unreal with `-PixelStreamingConnectionURL=ws://localhost:8888`
- receives sACN on `127.0.0.1:5568`
- exposes a small local UI HTTP server on `0.0.0.0:8081`

`SignallingWebServer/node_modules`, `dist/index.js`, and `www/index.html` exist locally. That path should not require public internet if those files stay present.

Caveat: Epic's bundled platform helper scripts under `PixelStreamingInfrastructure/SignallingWebServer/platform_scripts` contain optional STUN/TURN/public-IP setup that can call `api.ipify.org`, `stun.l.google.com`, `nodejs.org`, GitHub release downloads, Docker images, or apt/curl. The project launcher does not invoke those helpers, but they are internet-dependent if someone uses them.

### 9. CaptainPad uses LAN discovery, not Tailscale

Files:

- `CaptainPad/config.yaml`
- `CaptainPad/hooks/useServerDiscovery.ts`
- `CaptainPad/utils/api.ts`

Default API:

```yaml
api_base: "http://10.1.1.172:6968"
```

Discovery gets the iPad/device IP and probes `http://<same-subnet-ip>:6968/status` across the local `/24`. This requires a LAN connection but not public internet or Tailscale.

CaptainPad contains design prototype HTML under `CaptainPad/StitchDesigns` that references external fonts/Tailwind/images, but that is not the runtime control app path.

## Tailscale Result

No matches found for:

- `tailscale`
- `tailnet`
- `MagicDNS`
- `headscale`
- `tsnet`
- `100.x.x.x` tailnet IP ranges

The networking model I found is plain localhost plus private LAN IPs (`10.1.1.x`) plus sACN UDP.

## Cold Offline Start Risks

These are the concrete items that can break if the machine has no internet and no prior cache:

1. Browser simulation module imports from `cdn.jsdelivr.net`.
2. `simulation/start.js` depends on `npx http-server` but does not vendor/declare `http-server`.
3. `simulation/tools/kill-ports.js` depends on `npx -y kill-port`.
4. `marsin_engine/engine.js` depends on `npx -y kill-port` for startup cleanup.
5. `npm install` itself needs npm registry unless dependencies are already installed or an offline npm cache/package mirror exists.
6. Unreal helper scripts for STUN/TURN/public-IP setup are internet-dependent if used, though the project `run_streaming.ps1` does not use them.

## Runtime Public Internet Dependencies

Once all dependencies are installed and if the browser modules are served locally instead of from CDN:

- MarsinEngine: no public internet dependency found.
- Simulation server stack: no public internet dependency found.
- Simulation browser app: no public internet dependency found beyond current CDN import map/font references.
- Physical lighting path: requires local network reachability to controller IPs, not internet.
- CaptainPad: requires local network reachability to MarsinEngine, not internet.

## Recommended Fixes

No changes were made, but these are the practical hardening steps:

1. Replace the `simulation/index.html` CDN import map with locally served module paths from `simulation/node_modules`, or switch the simulation to a bundled Vite/build artifact that vendors those modules.
2. Prefer a checked-in local vendor cache under `simulation/vendor/` for browser ESM dependencies, and verify that `chroma-js` is actually installed and locked before packaging.
3. Replace `npx http-server` with a first-party static server, or add `http-server` explicitly and invoke only the local binary.
4. Add a MarsinEngine `--prod` mode that disables all automatic port killing and exits clearly on `EADDRINUSE`.
5. Apply the same production mode idea to simulation startup: no process killing in prod/offline mode, just a clear port-busy error.
6. Avoid `npx` in startup scripts for playa/offline use; `npx` is fine for dev convenience but is a weak contract offline.
7. Add an offline smoke test that runs with network disabled and checks:
   - `node engine.js --pattern <known> --model <known> --dry-run`
   - simulation static server starts without npm downloads
   - browser loads without external requests
   - local WebSocket ports `6968`, `6971`, `6972` come up as expected
8. For Unreal, keep using `run_streaming.ps1` rather than Epic's platform helper scripts unless STUN/TURN/public internet streaming is intentionally needed.
