# 2026-07-09 — MarsinLED client + device-config mapper (LED integration P1+P2)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260709_0_led_integration_execution.md` — phases **P1**
and **P2**. **Device reference:** `docs/41_led_controller_onboarding.md`.
**No git operations performed.** New files only; no existing file modified.

## Scope

Delivered the transport + correctness core so a later UI agent (P3) can
discover MarsinLED controllers, derive the exact device config from sim LED
state, and push it. No UI, no scene persistence, no engine routing (P3–P5).

## Files added

- `simulation/src/dmx/led/marsinled_client.js` — browser ES module, plain
  `fetch`, no deps. Discovery + read/write transport for the device HTTP API.
- `simulation/src/dmx/led/device_config_mapper.js` — pure functions (no I/O):
  derive/layout/diff. Imports `LED_CHANNEL_ORDERS`, `DMX_UNIVERSE_SIZE`,
  `MAX_UNIVERSE`, controller type/protocol constants, and the chain-entry
  helpers from `../controller_registry.js` (single source of truth for stride).
- `simulation/tests/marsinled_client.test.js` — 17 tests, stubbed global
  `fetch`, no real network.
- `simulation/tests/device_config_mapper.test.js` — 24 tests, pure.

## Tests run + results

Run mode matches the repo (`simulation/package.json` → `node --test tests/*.test.js`).

- New files alone: **64 subtests pass** (`node --test tests/marsinled_client.test.js
  tests/device_config_mapper.test.js`).
- Full sim suite `npm test`: **159 pass, 0 fail** after installing the `three`
  devDependency (`npm install three@^0.177.0 --no-save --ignore-scripts` — the
  worktree shipped without `node_modules/three`, and puppeteer's postinstall
  browser download is network-blocked here, hence `--ignore-scripts`). Before
  that install, the only 3 red files (`panel_visibility`,
  `patch_manager_subscribe`, `pixelblaze_model_exporter_local_index`) failed at
  `import 'three'` — a pre-existing environment gap, unrelated to these
  modules, which import no `three`.

## Live read-only validation (10.x.x.201)

`GET /api/status` and `GET /api/config` (curl, no POST) confirmed the parsing:
fingerprint `controllerId:"titanic_201"` + `boardId:"angio4-old"` + `strands[]`
present in status; config carries `strands[]` (type/count/pinData/pinClock/
colorOrder:"RGBW"/rgbwMode:"exact"/enabled/deadPixels) + `dmx{enabled,protocol,
universe,startAddress,timeoutMs}`. The golden test fixtures mirror these bytes.
The smoke streamer was not touched.

## Public API — `marsinled_client.js`

```js
// Discovery
normalizeSubnetPrefix(input: string): string | null
probeDevice(ip: string, opts?: { timeoutMs=600 }): Promise<DiscoveredDevice | null>
  // null on any miss (unreachable / not-ok / non-JSON / fingerprint mismatch).
scanSubnet(prefix: string, opts?: {
  onProgress?: (p: { completed, total, found: DiscoveredDevice[] }) => void,
  batchSize=32, timeoutMs=600, signal?: AbortSignal
}): Promise<DiscoveredDevice[]>            // throws on a malformed prefix

// Reads (throw on failure — a chosen device must answer)
getStatus(ip: string, opts?: { timeoutMs=5000 }): Promise<object>
getConfig(ip: string, opts?: { timeoutMs=5000 }): Promise<object>   // /api/config

// Write
validatePushPayload(partial: object): void   // throws on §4.2 bound / denied key
pushConfig(ip: string, partial: object, opts?: { timeoutMs=5000 }):
  Promise<{ status?, outcome, reboot, message? }>
  // Refuses wifi/deviceName/boardType/boardTypes/swarm/networkMode/enableMesh/
  // controllerId. Client-validates §4.2 BEFORE POST. On HTTP 400 throws an
  // Error with .field, .detail, .deviceError set verbatim from the device.
rebootDevice(ip: string, opts?: { timeoutMs=5000 }): Promise<true>
awaitReboot(ip: string, opts?: {
  timeoutMs=30000, pollIntervalMs=1000, probeTimeoutMs=600
}): Promise<DiscoveredDevice>              // hard-errors on timeout

// DiscoveredDevice = { ip, controllerId, deviceName?, boardId, boardType?, mac?,
//   firmwareSHA?, firmwareTag?, version?, languageVersion?, fps?, pixelCount?,
//   strands[], sacn?, outputs?, networkMode?, raw }
```

## Public API — `device_config_mapper.js`

```js
deriveDeviceConfig(controller, strandFixtures, deviceSnapshot):
  { strands: object[], dmx: { enabled:true, protocol:0|1, universe, startAddress,
                              timeoutMs:3000 } }
  // controller: sim LED controller (registry shape: .type, .protocol, .led
  //   {baseUniverse,startAddr,order,stride,whiteMode}, .ports[{port,chain}]).
  // strandFixtures: Map<name,ledCount> | Map<name,{ledCount}> | {name:ledCount}
  //   | {name:{ledCount}} | Array<{name,ledCount}>.
  // deviceSnapshot: a GET /api/config result (hardware fields copied from it).
  // Port k (1-based) → device output k-1. Assigned port: count=Σledcounts,
  //   enabled:true. Unassigned: enabled:false, device count kept.
  // THROWS: non-LED controller, missing snapshot, explicit per-strand `at`
  //   pin or gap entry (non-representable), unknown strand ledCount, port past
  //   device outputs, zero enabled, unallocated/out-of-range base universe or
  //   startAddress.

computeLinearLayout(config): Array<{
  outputIndex, enabled, universe, startChannel, endUniverse, endChannel,
  pixelCount, pixelSpan, bytesPerPixel,
  segments: Array<{ universe, startChannel, endChannel, pixelCount }>
}>
  // config = { strands[], dmx{universe,startAddress} }. Firmware algorithm
  //   (docs/41 §3): 4 ch/px RGBW (stride from colorOrder), skip disabled
  //   outputs, single contiguous cursor across enabled outputs, spill to
  //   universe+1 at ch>512 (each new universe resets to ch1 — no straddling).
  // Disabled outputs → enabled:false, null spans. THROWS on bad dmx bounds,
  //   unknown colorOrder, or a spill past MAX_UNIVERSE (63999) — cap violation.

diffDeviceConfig(derived, actual): { inSync: boolean,
  changes: Array<{ path, from, to }> }
  // Compares push-relevant strand fields (type/count/pinData/pinClock/
  //   colorOrder/rgbwMode/enabled) and dmx fields (enabled/protocol/universe/
  //   startAddress/timeoutMs). from = device's current, to = derived. inSync
  //   true ⇒ skip the push. THROWS on malformed inputs.
```

## Known gaps / notes for the next agent

- **`deviceName` is absent from `/api/status`** (it lives in `/api/config`), so
  `probeDevice`/`scanSubnet` return `deviceName: undefined`. The P3 "Create
  controller from device" card should fall back to `controllerId` for a label,
  or `getConfig(ip)` for the real name. Not fabricated here (no fallbacks).
- **`led.baseUniverse` must already be allocated** (non-zero) before
  `deriveDeviceConfig` — it does NOT run the scene universe allocator (pure
  function). P3 must allocate `baseUniverse` (auto from the scene allocator when
  0) before calling. A `baseUniverse:0` throws by design.
- **Constraint enforcement is limited to chain-level non-representability**
  (explicit `at` pins, gaps, out-of-range outputs). Per-port `universe`/
  `startAddress` fields on LED ports are ignored (the device is single-base-
  universe + linear), matching `controller_registry.computeLedProjection`.
- **`pushConfig` client validation** treats `type`/`rgbwMode` as
  "non-empty string" (the device owns their enums; a guessed list would wrongly
  reject valid values). `colorOrder` is bounded to `[RGBWA]{3,5}`; numeric/
  structural §4.2 bounds are enforced precisely.
- **`three` devDependency** is not installed in this worktree; install it
  (`--ignore-scripts` to dodge puppeteer's blocked browser download) to run the
  full suite green. The two new test files need no `three`.
- Not in scope (P3–P6): map-editor UI, scene persistence schema, engine routing,
  model re-export, physical push. `patches.yaml` records (P4) can be built from
  `computeLinearLayout` output (`universe`, `startChannel`→dmxAddress,
  `pixelCount`, `outputIndex`).
