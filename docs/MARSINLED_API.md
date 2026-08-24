# MarsinLED HTTP API

Reference for the MarsinLED HTTP endpoints consumed or referenced by this
repository. It documents the contract BM26-Titanic relies on; it is not a
complete firmware API specification.

## Scope and safety

- Controller base URL: `http://<controller-ip>` on port 80.
- The API is intended for a trusted show LAN. The calls used here have no TLS
  or application authentication.
- Treat the IP address as a route, not an identity. The stable identity is
  `controllerId` from `GET /api/status`.
- Read a controller immediately before writing it, and build the write from that
  ONE snapshot. A write can persist settings, change output ownership, and reboot
  the controller. See "Required write sequence" for the one-snapshot rule.
- Never infer success from a lost HTTP reply. Wait for the controller to return,
  then read and verify its identity, saved configuration, and runtime state.
- Do not add fallback write paths when an endpoint or capability is absent.

## Endpoint summary

| Method | Path | Used for | Called by this repo |
|---|---|---|---|
| `GET` | `/api/status` | Identity, capabilities, and live state | Yes |
| `GET` | `/api/config` | Full persisted configuration | Yes |
| `POST` | `/api/config` | Partial or full configuration update | Yes — configuration push, DMX ON/OFF toggle, dormant gamma push |
| `POST` | `/api/system/reboot` | Explicit controller reboot | Yes |
| `GET` | `/api/colors` | Bike palette state and lease support | Yes |
| `POST` | `/api/colors` | Bike Color Link palette delivery | Yes |
| `GET` | `/api/board` | Board profile and output pin map | Referenced only |
| `GET` | `/api/version` | Firmware/language version | Referenced only |
| `POST` | `/api/config/confirm` | Confirm staged network settings | Referenced only |

“Referenced only” means BM26-Titanic documentation expects the endpoint, but
the runtime clients in this repository do not currently call it.

## Controller identity

### `GET /api/status`

The simulation accepts a host as MarsinLED only when the response is successful
JSON containing all three fingerprint fields:

```json
{
  "controllerId": "controller_a",
  "boardId": "board_profile",
  "strands": []
}
```

`controllerId` and `boardId` must be non-empty strings; `strands` must be an
array. Additional fields consumed when present include:

- `deviceName`
- `boardType`
- `firmwareSHA`, `firmwareTag`, `version`, `languageVersion`
- `mac` for display-only live diagnostics; do not persist it in this public repo
- `fps`, `pixelCount`, `outputs`, `networkMode`
- `capabilitiesExt.perOutputDmx`
- `sacn.enabled`, packet counters, errors, and per-output state
- `dmxOwnsOutput`

Discovery treats an unreachable host, non-success response, invalid JSON, or a
missing fingerprint as a normal miss. Reads of an operator-selected controller
fail loudly on those same conditions.

Before any write to a bound controller, compare the live `controllerId` with the
identity stored by the simulation. Refuse the write if they differ.

## Persisted configuration

### `GET /api/config`

Returns the complete saved configuration. The BM26-Titanic clients use it as the
read side of a read-modify-write operation.

Important blocks include:

- `deviceName`
- `strands[]`
- `dmx`
- `swarm`, when supported — **never written by this repository**. The configuration
  push does not carry a `swarm` key, so the board's swarm block survives a push
  byte-for-byte. Swarm is an operator-managed setting on the controller's own web UI.
- `gamma` — present in the device config; the simulation **never reads it back from
  a device** (the gamma pull path is removed permanently). It is written only by the
  **dormant** gamma-push route below, which the simulation's disabled gamma UI never
  calls. Gamma is operator-managed on the controller's own web UI for now.
- power and brightness settings
- network settings

Each strand may carry hardware fields that the simulation does not own, such as:

```json
{
  "enabled": true,
  "type": "WS281X_RGBW",
  "count": 40,
  "pinData": 1,
  "pinClock": 0,
  "colorOrder": "RGBW",
  "rgbwMode": "native",
  "deadPixels": 0,
  "deadPixelIndices": [],
  "dmxUniverse": 21,
  "dmxStartAddress": 1
}
```

Pin values above are illustrative only. Never copy example pins into hardware.
Preserve the board's own hardware fields from the fresh configuration read.

## Configuration writes

### `POST /api/config`

The firmware merges the submitted object into the stored configuration and
validates the resulting complete document. A field not present in the request
can therefore still cause rejection if the stored value is invalid.

The browser client sends JSON text using:

```http
Content-Type: text/plain;charset=UTF-8
```

This keeps the request CORS-simple. The firmware parses the body as JSON. Do not
add custom browser headers unless firmware preflight support is verified.

Server-side clients may use `Content-Type: application/json`.

A successful reply identifies the apply outcome and whether a reboot is required:

```json
{
  "status": "ok",
  "outcome": "applied",
  "reboot": false,
  "message": "..."
}
```

`outcome` is `applied` (the change is live, nothing to wait for) or `needs-reboot`
(the controller reboots itself to apply it, `reboot: true`). Those are the only two
outcomes the repository accepts: a missing or unknown `outcome` is a hard failure
that quotes the device reply — never a value the client interprets charitably.

An identical body — one that changes nothing — answers `applied`, so every write on
this path is idempotent in shape.

**Which changes need a reboot:**

- **`gamma` changes are live-apply** — `{"outcome":"applied","reboot":false}`, no
  reboot, no wait.
- **`dmx`-block changes are reboot-to-apply** — `{"outcome":"needs-reboot",
  "reboot":true}`, roughly 11 s of downtime. This holds for `dmx.enabled` alone,
  which is what the DMX toggle below relies on.
- **`strands[]` changes are reboot-to-apply** as well, so the configuration push
  (which always writes `strands` + `dmx`) always reboots the board.

Validation failures return HTTP 400 with:

```json
{
  "status": "error",
  "error": "config apply failed",
  "field": "strands[0].count",
  "detail": "must be a positive integer",
  "fields": [
    { "field": "strands[0].count", "detail": "must be a positive integer" }
  ]
}
```

The `error` string is `config apply failed` (verified live against a board whose
stored `deviceName` was invalid — `docs/41_led_controller_onboarding.md` §4.1.1).
Surface `field`, `detail`, and `fields` verbatim to the operator.

A POST that lands **during an active staged-network-config confirm window** answers
**HTTP 409**. Like the 400, this is an *answered* non-2xx and therefore a definite,
loud failure: the clients never treat it as ambiguous and never retry the write.
The only ambiguity the clients arbitrate is a **lost** reply, which is settled by
the reboot wait plus the read-back, never by re-sending the mutation.

### Per-output sACN capability

The simulation's controller push requires:

```json
{
  "capabilitiesExt": {
    "perOutputDmx": true
  }
}
```

There is no legacy fallback. If this flag is absent or false, the push is
refused.

For enabled outputs, BM26-Titanic uses one sACN universe per strand and
`dmxStartAddress: 1`. Universe values must be in `1..63999`. A controller may
report between 1 and 16 strand entries.

### The narrowed configuration push payload

The simulation's configuration push forces exactly **three** things: strand
counts + enables, per-output universes (with start address 1), and DMX input ON.
Nothing else. The body is `{ strands, dmx }`, plus `deviceName` under the single
repair case in `docs/41_led_controller_onboarding.md` §4.1.1:

```json
{
  "strands": [ "…the FULL array, read-modify-write per entry…" ],
  "dmx": { "…the board's own saved dmx object…", "enabled": true, "protocol": 0 }
}
```

**`strands[]`** — the full array, one entry per physical output, array order =
output index. Per entry the push forces only:

- output assigned by the simulation's mapping → `enabled: true`,
  `count` = the mapped pixel count, `dmxUniverse` = the port's universe,
  `dmxStartAddress: 1`;
- output not assigned → `enabled: false`, and `dmxUniverse` / `dmxStartAddress`
  are **deleted** from the entry, because the firmware's all-or-none per-output
  rule rejects a disabled strand that still carries a universe.

Every other key of the entry passes through **untouched** from the snapshot:
`type`, `colorOrder`, `rgbwMode`, pins, dead-pixel fields, and any key a future
firmware adds. **Strand type and color order are deliberately not pushed** — chip
type and color order are managed by the operator on the controller itself.

**`dmx`** — `{ ...snapshot.dmx, enabled: true, protocol: 0 }`. The board's own
saved `dmx` object is the base; only `enabled` and `protocol` are forced.
`timeoutMs`, the legacy `universe` / `startAddress` keys, and anything else the
board saved are **preserved**. `protocol: 0` (sACN) is forced because the
per-output universes being written are sACN-only by firmware rule. The snapshot
must carry a `dmx` object: a snapshot without one is a loud refusal, never an
invented block.

**No `swarm` key, ever.** The push neither reads nor writes swarm; the board's
swarm configuration — role, leader, group — survives byte-for-byte because it is
simply never mentioned. Switching a board between DMX and SWARM is the operator's
own move on the controller's web UI; the simulation has no mode-switch workflow.
A board that reports both `dmx.enabled` and `swarm.enabled` after a push is an
accepted state: the read-back surfaces one **informational, non-failing** note
(`ℹ board also reports SWARM enabled — swarm is operator-managed; the sim does not
touch it`) and nothing else.

**No `gamma` key.** The push never carries gamma.

A push is an irreversible operator action: the device write cannot be rolled back.

### Read-back verification after a push

After the reboot wait the client re-reads `GET /api/config` + `GET /api/status` and
asserts **exactly what it pushed**:

1. every index of the pushed `strands` array — `enabled` in both directions; on
   enabled outputs `count`, `dmxUniverse`, and `dmxStartAddress === 1`; on
   disabled outputs `enabled === false` **and** no integer `dmxUniverse` left in
   the read-back;
2. `config.dmx.enabled === true` and `config.dmx.protocol === 0`;
3. runtime `status.sacn.enabled === true`; `dmxOwnsOutput === true` only when the
   firmware reports the field (an absent field is never read as agreement);
4. `status.controllerId` unchanged versus the pre-push identity.

Deliberately **not** asserted, because they are deliberately not written: strand
`type` / `colorOrder` / `rgbwMode` / pins, `dmx.timeoutMs`, `swarm.*`, `gamma`.

### Required write sequence (the one-snapshot contract)

**One read, one body, one write.** The object the confirm dialog previews **is**
the object that gets posted; the transport performs no read of its own.

1. Read `GET /api/status` and `GET /api/config` **once**. This is the snapshot.
2. **Pre-write identity gate** — before the confirm dialog opens, refuse loudly if
   the card is bound and the live `status.controllerId` differs from the stored
   one, naming both ids. In a fleet push the gate runs per controller inside the
   loop: that board fails and the loop continues.
3. Derive the plan and build the exact request body **from that same snapshot**,
   and validate it client-side before any network write.
4. Send one `POST /api/config` carrying that body verbatim.
5. If the reply is lost, or a reboot is reported, poll `GET /api/status` within a
   bounded deadline.
6. Read `GET /api/status` and `GET /api/config` again.
7. Verify identity and every submitted field (see "Read-back verification").

**There is deliberately no re-read immediately before the POST.** An earlier
revision of this document required one; it is rejected, because a second read
would make the posted body differ from the previewed one and would reopen the very
drift window it claims to close — the board can change between any two reads.

The accepted residual risk is a **stale confirm dialog**: the operator may sit on
the dialog while the board changes underneath. That risk is covered, not ignored,
by three things: the pre-write identity gate above (step 2), the identity assert
in the read-back, and the fact that the read-back verifies the **full** pushed
contract rather than a sample of it. A board that drifted under a stale dialog
fails the read-back loudly instead of being silently accepted.

**No retries, ever.** An answered non-2xx (400, 409, anything else) is a definite
failure. A lost write reply is the one sanctioned ambiguity and is arbitrated by
the reboot wait plus the read-back.

### DMX ON/OFF toggle

Each LED card carries a small `DMX ⏻` control next to ⬆ Push that flips the
board's DMX input on or off without touching anything else. It is the manual lever
between pushes.

**There is no lighter endpoint than `POST /api/config` for `dmx.enabled`.** The
endpoint summary above is complete for this purpose: DMX on/off is a field of the
`dmx` block of the persisted configuration, and there is no runtime-only route
that flips it. So the toggle is a configuration write, and — per the apply/reboot
rules above — it reboots the controller (about 11 s).

The body is the same sidestep-partial-merge shape as the push: the board's own
saved `dmx` object with only `enabled` flipped, plus `deviceName` under the §4.1.1
repair. A snapshot without a `dmx` object is a loud refusal.

```json
{ "dmx": { "…the board's own saved dmx object…", "enabled": false } }
```

Flow: pre-write identity gate → one `GET /api/config` + `GET /api/status` → build
body → one POST → reboot wait → re-read → verify `config.dmx.enabled`,
`status.sacn.enabled`, and unchanged identity. Nothing else is claimed: the toggle
asserts nothing about strands, swarm, or gamma. Writing the value the board already
holds answers `applied` with no reboot.

The toggle's label reflects the last confirmed observation (`DMX: on` / `DMX: off`
/ `DMX: ?` before anything was observed) and is seeded from reads the panel already
performs. There is no polling, no timer, and no cache. Every failure is loud and
sets the label back to `?`, because the read-back is the only truth source.

A board toggled OFF reads as drift against the push plan (“push will force DMX
ON”). That is intended: the push still forces `dmx.enabled: true`.

### `POST /api/system/reboot`

Requests an explicit reboot. The connection may close as the controller
restarts. A caller that needs proof must use the same bounded status-poll and
identity check as a configuration write.

### Network configuration confirmation

Network changes are documented as staged changes requiring:

```http
POST /api/config/confirm
```

from the new network context. BM26-Titanic does not currently call this route,
so network configuration must not be added to a generic controller push.

## Bike Color Link

Bike discovery first uses `GET /api/status`. A non-empty `controllerId` is the
stable registry identity; the address may change.

### `GET /api/colors`

A successful response proves Color Link support and returns the current palette
and engine lease state. The repository expects fields such as:

```json
{
  "color1": [0.1, 1.0, 1.0],
  "color2": [0.6, 1.0, 1.0],
  "source": "engine",
  "engine": {
    "msRemaining": 60000
  }
}
```

HTTP 404 marks the controller unsupported. There is no fallback endpoint.

### `POST /api/colors`

The engine sends:

```json
{
  "color1": [0.1, 1.0, 1.0],
  "color2": [0.6, 1.0, 1.0],
  "engine": true
}
```

Each color is `[hue, saturation, value]` using normalized floating-point values.
`engine: true` requests the firmware's temporary engine lease. The response may
include `engine.msRemaining`, which the engine records for operator status.

The production behavior is change-driven with coalescing and a flood guard,
plus a periodic keepalive so the firmware lease does not expire while colors
remain unchanged.

## Simulation save-server routes

These are BM26-Titanic proxy routes, not MarsinLED firmware endpoints.

### `POST /controllers/probe`

Request:

```json
{
  "targets": [
    { "id": 1, "name": "Controller A", "ip": "192.0.2.10", "type": "led" }
  ],
  "force": false,
  "timeoutMs": 3000
}
```

Returns `{ "ok": true, ... }` with per-controller online/offline/unknown
verdicts. This route is server-side so probes are not limited by browser CORS.

### `POST /led/gamma-push` — kept, **dormant**

Request:

```json
{
  "ip": "192.0.2.10",
  "controllerName": "Controller-A",
  "gamma": { "r": 2.2, "g": 2.2, "b": 2.2, "w": 1.0 }
}
```

The service backs up the full configuration, writes a gamma-only partial update
with a device-name repair when required, then reads back and verifies gamma, mode,
name, and identity. A gamma write is live-apply — no reboot.

**Nothing in the simulation calls this route.** By operator ruling the Controllers
pane renders its gamma section **disabled**, so the route, its service
(`simulation/server/led_gamma_service.cjs`) and its CLI front end
(`simulation/agent_tools/led_gamma_push.cjs`, **push-only**) are kept working and
tested but unused. Gamma is operator-managed on the controller's own web UI for
now; the push returns as an operator-triggered option once the configuration push
is confirmed, and it returns **push-only**.

**The gamma READ route is removed permanently.** `GET /led/gamma` no longer exists
— the ruling is "only push, not pull", including the former manual refresh. The
simulation never reads a controller's gamma back, automatically or on demand, and
no replacement read path may be added.

## Timing used by the simulation client

| Operation | Budget |
|---|---:|
| Subnet probe, per address | 6.5 s |
| Normal selected-device HTTP request | 8 s |
| Per-output configuration POST | 12 s |
| Reboot recovery deadline | 45 s |
| Reboot polling interval | 1 s |

These are client deadlines, not firmware guarantees.

## Known integration gaps

Two gaps remain open. Until they are corrected, do not treat a green push result
as proof of a complete safe transaction. The first three entries are kept for the
record with their current resolution.

1. **CLOSED** — a bound card's `controllerId` used to be checked only after the
   write. The pre-write identity gate (see "Required write sequence" step 2) now
   refuses before the confirm dialog, per controller in a fleet push.
2. **Resolved as a design decision, not a defect** — the confirmation dialog can
   hold a stale snapshot until the operator presses FORCE. Under the one-snapshot
   rule the preview and the POST are the same object, so a pre-POST re-read is
   deliberately rejected; the residual risk is covered by the pre-write identity
   gate, the identity assert, and the full read-back verify.
3. **Narrowed by ruling** — read-back does not compare strand `type`,
   `colorOrder`, `rgbwMode`, pins, `dmx.timeoutMs`, or `swarm.*`. That is
   deliberate: the push does not write those fields, so it does not judge them.
   They are operator-managed on the controller itself. The one part of this that
   *was* a real gap is fixed: the read-back now asserts that a disabled output
   carries no leftover `dmxUniverse`.
4. **OPEN** — a chain containing both known and unknown fixtures can derive a
   partial pixel count instead of refusing the push.
5. **OPEN** — a fleet push continues after individual failures and then saves the
   desired scene, so hardware and saved mappings can remain split.

## Repository implementation map

- Browser controller transport, push body + verify, DMX toggle body + verify:
  `simulation/src/dmx/led/marsinled_client.js`
  (`buildForcedConfigBody`, `diffForcedConfig`, `swarmEnabledNote`,
  `buildDmxToggleBody`, `diffDmxToggle`, `pushDmxToggle`, `deviceNameRepairForPush`)
- Forced configuration derivation:
  `simulation/src/dmx/led/device_config_mapper.js`
- Simulation controller workflow (push, push-all, identity gate, DMX toggle):
  `simulation/src/gui/led_discovery_panel.js`
- Save-server proxies:
  `simulation/server/save-server.js`
- Gamma push service — **dormant, push-only**, no read path:
  `simulation/server/led_gamma_service.cjs`
- Gamma push CLI — **dormant, push-only**:
  `simulation/agent_tools/led_gamma_push.cjs`
- Disabled gamma UI section:
  `simulation/src/gui/led_gamma_ui.js`
- Controller probe service:
  `simulation/server/controller_probe_service.cjs`
- Bike Color Link:
  `marsin_engine/lib/bike_color_share.js`
- Controller onboarding and operational context:
  `docs/41_led_controller_onboarding.md`
