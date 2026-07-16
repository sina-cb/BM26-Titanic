# 41 — LED Controller Onboarding (MarsinLED discovery + fixture mapping)

Status: **infra implemented** (branch `feat/led_integration`, 2026-07-10) —
client+mapper, discovery/bind/push UI, scene persistence, engine dual-send,
and exporter linear addressing are all in and tested (sim suite 190/190).
Execution plan + phase details: `.agent/plans/20260709_0_led_integration_execution.md`;
per-slice reports under `.agent/reports/202607/`. The engine→hardware link is
**verified on real hardware** (2026-07-09): `marsin_engine` sACN → MarsinLED
`10.1.1.201` → 80 physical RGBW pixels, correct colour order, 0 sequence
errors. Remaining: the operator's manual UI mapping session (see plan §P6).

This doc is the source of truth for how the simulation onboards **MarsinLED
LED-string controllers** the way it onboards DMX controllers: **discover →
pick a controller → assign a sim fixture to each output → patch**. It also
records **exactly which controller configs we mutate over the HTTP API**, and
their apply/reboot semantics, so the sim can drive them safely.

DMX controllers are untouched by this work — LED is an additive, parallel
controller `type` (`CONTROLLER_TYPE_LED`, already present since the Views
Rehaul, PR #36).

---

## 1. The device (reference: MarsinLED firmware `main`)

- **Board `angio4-old`** — 4 fixed LED outputs on GPIO **35/36/37/38**
  (`pinsLocked`, `fixedOutputs`). Other profiles: `angio4-new`
  (21/45/14/38), `chroma-go` (single output, pin 5), `generic` (free pins).
- **HTTP JSON API on port 80.** mDNS advertises `<deviceName>.local`.
- **sACN/E1.31 unicast receiver** (`ESPAsyncE131`, `E131_UNICAST`) OR ArtNet,
  selected by `dmx.protocol` (`0`=sACN, `1`=ArtNet). Off by default
  (`dmx.enabled=false`) — the device runs its own local pattern engine until
  DMX mode is enabled.
- Example unit at `10.1.1.201`: `controllerId "titanic_201"`,
  `deviceName "Titanic-201"`, MAC `AA:BB:CC:DD:02:01`, static IP, strands
  0 & 1 enabled (WS281X_RGBW, 40 px each = 80 px), 2 & 3 disabled.

> The device does **not** answer ICMP ping — discover it over HTTP, never by
> ping. (`10.1.1.201` looked "offline" to `ping`/ARP while happily serving
> `/api/status`.)

---

## 2. Discovery (mirror of CaptainPad server discovery)

CaptainPad already ships the exact scan we want
(`CaptainPad/hooks/useServerDiscovery.ts`): normalise a `/24` prefix
(`"10.1.1"`), enumerate `.1`–`.254`, `Promise.all` batches of 32, per-IP
`AbortController` timeout, accept only JSON hits. Reuse that shape.

- **Probe:** `GET http://<ip>/api/status` (port 80), ~600 ms timeout, batches
  of 32.
- **Accept a host as a MarsinLED controller** iff the response is `res.ok`
  and parses as JSON carrying **`controllerId` AND `boardId` AND `strands`**
  (there is no single `service` tag like the engine's; these three together
  are a reliable fingerprint). Reject anything else.
- **Identify** with: `controllerId`, `deviceName`, `boardId`, `ip`, `mac`,
  `firmwareSHA`, `version`, live `strands[]`, and `sacn` rx counters.
- **Key by IP** (operator decision — not MAC). Dedup by IP.

### Discovery-relevant read endpoints

| Endpoint | Use |
|---|---|
| `GET /api/status` | discovery probe + live runtime (ip, mac, fps, `sacn.{enabled,rxPackets,lastUniverse,seqErrors}`, per-output `framesPresented`, `bootReport`) |
| `GET /api/config` | full persisted config (strands, dmx, wifi, brightness, caps) — read before writing so we PATCH, not clobber |
| `GET /api/board` | board profile + the 4 outputs' pin map / labels |
| `GET /api/version` | language/firmware version |

---

## 3. The linear-mapping constraint (**read this before patching**)

The firmware's sACN receiver maps incoming channels **linearly across enabled
strands**, starting at `dmx.universe` / `dmx.startAddress`
(`src/network/DmxReceiver.cpp::drivePixels`). It has **no per-output universe
assignment** — it is one contiguous stream:

- Bytes per pixel = **4 (RGBW)** when the strand `isRGBW`, else 3. The
  RGBW strands here are **4 ch/px**. (The header comment says "logical RGB";
  the implementation reads RGBW when the driver is RGBW — trust the code.)
- Pixel 0 = `dmx.universe` @ channel `dmx.startAddress`; pixels advance
  linearly, **skipping disabled strands** (a disabled output contributes 0
  pixels), spilling into `universe+1, +2, …` when a universe fills
  (128 RGBW px per universe at `startAddress=1`).
- Strand order = `strands[]` array order = physical output index 0→3.

**Consequence for the "assign a fixture per output" UI:** the sim presents
per-output assignment, but the channel/universe of output *N* is **derived**
from the cumulative pixel count of enabled outputs before it — the operator
does not pick a universe per output. The sim computes the linear layout and
patches its LED fixtures to those exact contiguous channels so the sim's sACN
model and the firmware agree byte-for-byte.

Worked example (`10.1.1.201`, base universe `U`, RGBW, startAddress 1):

| Output | Strand count | Sim fixture | Universe | Channels |
|---|---|---|---|---|
| 0 (GPIO35) | 40 | LED line A (40 px) | U | 1–160 |
| 1 (GPIO36) | 40 | LED line B (40 px) | U | 161–320 |
| 2 (GPIO37) | 0 (disabled) | — (unpatched) | — | — |
| 3 (GPIO38) | 0 (disabled) | — (unpatched) | — | — |

A fixture is **patched** only once it is assigned to an output AND the sim's
LED/sACN model carries its universe+channel span; otherwise it is unpatched.

---

## 4. Remote configs we mutate over the API (the "note these down" list)

All writes: **`POST /api/config`** with a **partial** JSON body (only the keys
we change). The device validates, then replies:

```json
{ "status":"ok", "outcome":"applied"|"needs-reboot", "reboot":true|false,
  "message":"..." }
```

or `400` with `{ "error":..., "field":"strands[0].count", "detail":"..." }`
on a validation failure (fail-loud; surface the field to the operator).

### 4.1 What we write when patching a controller

**(a) `strands[]`** — one object per physical output, array order = output
index. Set each assigned output's `count` to its fixture's pixel count and
`enabled:true`; set unassigned outputs `enabled:false`. Keep `type`,
`pinData`, `pinClock`, `colorOrder`, `rgbwMode` as read from `/api/config`
(don't invent pins — `angio4` pins are locked).

```json
{ "strands": [
  { "type":"WS281X_RGBW","count":40,"pinData":35,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":true },
  { "type":"WS281X_RGBW","count":40,"pinData":36,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":true },
  { "type":"WS281X_RGBW","count":40,"pinData":37,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":false },
  { "type":"WS281X_RGBW","count":40,"pinData":38,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":false }
] }
```

**(b) `dmx{}`** — switch the device into sACN-receive on the base universe the
sim allocated for this controller:

```json
{ "dmx": { "enabled":true, "protocol":0, "universe":<U>,
           "startAddress":1, "timeoutMs":3000 } }
```

- `protocol` 0 = sACN, 1 = ArtNet. `timeoutMs` 0 = hold-last-look forever;
  >0 = blackout after N ms of no packets (3000 is a good default while a live
  source streams).

**(c) Optional device-level** (nice-to-have, not required to light): rename
via `deviceName`, set a power cap with `maxMilliamps` /
`maxMilliampsEnabled`, master `globalBrightness`.

### 4.2 Validation bounds (reject before sending)

- `strands`: 1–16 entries; **≥1 enabled**; unique `pinData` across strands;
  total enabled pixels ≤ device cap. Each: `count` ≥ 1, valid `type`,
  `colorOrder`, `rgbwMode`, `deadPixels`/`deadPixelIndices` in range.
- `dmx.universe` 1–63999; `dmx.startAddress` 1–512; `dmx.protocol` 0–1.
- `globalBrightness` 0–255; `maxMilliamps` 0–65535 (0 = cap off);
  `maxMilliampsEnabled` bool; `deviceName` charset + ≤32 (derives
  `<name>.local` AP SSID).

### 4.3 Apply vs reboot semantics (from `ConfigManager::update`)

| Change | Flag | Applies |
|---|---|---|
| `globalBrightness`, `maxMilliamps`, `maxMilliampsEnabled` | Brightness | **live**, no reboot |
| `strands[]` **any** field (type/count/pin/colorOrder/rgbwMode/enabled/deadPixels) | Leds → reinit | **reboot to apply** (FastLED can't re-register a controller at runtime) |
| `strands[]` array length change | Reboot | **reboot** |
| `dmx.*` (enable/protocol/universe/startAddress/timeout) | Dmx | **reboot** (verified: `outcome:"needs-reboot"`) |
| `boardType`, `networkMode`, `deviceName`, `wifi.*` | Reboot/Wifi | **reboot** |

So a patch that changes strand counts **and** enables DMX will report
`needs-reboot`. The device auto-reboots on that reply (~10 s;
`bootReport.bootDurationMs ≈ 9.4 s`); an explicit `POST /api/system/reboot`
also exists. **Keep the sACN source streaming across the reboot** — the
receiver latches the live stream as soon as it boots (that is how the
smoke test came up clean).

> Anti-brick note: **wifi/network** changes are *staged* and require
> `POST /api/config/confirm` from the new network context within a window or
> they auto-revert (`wire_interface_v1 §9`). **strand/dmx/brightness changes
> are not staged** — they apply on the reboot without a confirm. The sim's
> patch flow only touches strands/dmx, so no confirm handshake is needed.

### 4.4 Restore to standalone

`POST /api/config {"dmx":{"enabled":false}}` → device reboots back to its
local pattern engine.

---

## 5. Sim / engine wiring (production path)

To make the **real engine** drive these LEDs and show them in the sim:

1. **Scene** `simulation/scenes/test_bench/`:
   - Add LED strand fixtures to `scene_config.yaml::ledStrands.strands`
     (currently `[]`) — two 40-px RGBW "lines" for `10.1.1.201`.
   - Add an LED controller to `controllers.yaml`: `type: LED`,
     `protocol: sACN`, `ip: 10.1.1.201`, 4 ports (2 enabled), strands patched
     **contiguously** on the controller's base universe per §3.
   - Record patches in `patches.yaml` (LED fixtures become "patched").
2. **Engine model** `marsin_engine/models/test_bench.js` is auto-generated
   from the scene — regenerate so the 80 LED pixels appear with
   `patch:{universe:U, addr, footprint}` on the LED universe.
3. **Engine routing** `marsin_engine/config.yaml` — add a `controllers:` entry
   routing universe `U` to `10.1.1.201` (`protocol: sACN`). Universes not
   listed keep streaming to the flat `sacn.destinations` (the sim bridge), so
   the sim still visualises them. (If the LEDs must show in **both** sim and
   hardware simultaneously, the LED universe needs both destinations — decide
   per §Follow-ups.)
4. **Controller** — push §4 config (strands + dmx) via the sim's patch action.

---

## 6. Implementation plan (multi-agent, Opus)

Fan out per `.agent/os/multi_agent.md` (worktrees, `dev/<slug>`, own ports).
Slices are mostly file-disjoint:

- **Slice A — MarsinLED API client + discovery service (sim server side).**
  A `LedControllerClient` (GET status/config/board, POST config/reboot, PATCH
  helpers that respect §4 semantics) + an IP-range scanner (`/24`,
  batches-of-32, 600 ms, accept on `controllerId`+`boardId`+`strands`). Node
  service exposed to the sim UI over the save/HTTP server. Owns new files
  under `simulation/src/dmx/led/` + a server route; unit tests with a mock
  device.
- **Slice B — Discovery + per-output mapping UI.** Extend the controller map
  editor: a "Discover LED controllers" panel (subnet input + AUTO, scan,
  results list) and a per-output→fixture assignment surface that computes the
  linear layout (§3) and shows the resulting universe/channel per output.
  Owns `controller_map_editor.js` + new UI modules; no server logic.
- **Slice C — Scene/model/patch plumbing.** LED strand fixtures in
  `scene_config.yaml`, LED controller in `controllers.yaml`, `patches.yaml`
  wiring, the linear-layout patch computation shared with the engine model
  regeneration, and the `marsin_engine/config.yaml` `controllers:` routing.
  Owns the scene files + model export; integration test that a patched LED
  controller produces contiguous engine-model pixels on universe U.

Sequencing: A and C can start immediately (disjoint); B depends on A's client
shape. Each slice: unit + one live smoke against `10.1.1.201` (or the mock),
report under `.agent/reports/`.

---

## 7. Follow-ups / open decisions

- **Dual-destination for LED universes** — do we fan the LED universe to both
  the sim bridge and the hardware, or hardware-only? (Affects §5.3.)
- **Multi-controller** — `10.1.1.201` reports swarm peers `10.1.1.202/.203`
  (`Titanic-202/203`). Discovery must handle a fleet; universe allocation
  must not collide across controllers.
- **Pixel cap** — surface the device's total-pixel cap from `/api/config`
  validation so the UI blocks over-assignment before POST.
</content>
</invoke>
