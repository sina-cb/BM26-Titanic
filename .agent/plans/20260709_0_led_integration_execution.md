# 2026-07-09 — LED Integration Execution Plan (MarsinLED ↔ sim ↔ engine)

**Branch:** `feat/led_integration` (this is the deliverable branch — work on it
directly, no new branch unless the operator asks).
**System reference (read first):** `docs/41_led_controller_onboarding.md` —
device API, validation bounds, apply/reboot semantics, the linear-mapping
constraint. This plan is the "how to build it"; docs/41 is the "how the device
behaves".
**Laws:** `.agent/codex.md` (no fallbacks — fail loudly; imports at top;
snake_case files; scratch → `~/tmp/`), `.agent/os/nodejs_style.md`,
`.agent/os/git.md` + security check before any commit (operator-gated).

## Verified ground truth (2026-07-09, do not re-derive)

- Physical MarsinLED at **`10.x.x.201`** (`controllerId titanic_201`, board
  `angio4-old`, static IP): 4 outputs; strands 0/1 enabled, `WS281X_RGBW`,
  40 px each. **Verified lit end-to-end** from an sACN unicast stream
  (U1, RGBW 4 ch/px, contiguous, startAddress 1) — correct colors, 0 seq errors.
  A smoke streamer may still be running from the coordinator session
  (`~/tmp/led_smoke.mjs`, U1 → .201); kill it before engine-driven tests.
- Device serves **CORS `*` on every route** (verified live) → the sim browser
  UI calls the device directly; **no server proxy**. Discovery mirrors
  `CaptainPad/hooks/useServerDiscovery.ts` (/24 sweep, batches of 32,
  ~600 ms `AbortController` timeout).
- The device does **not** answer ICMP. HTTP is the only liveness signal.
- Device fingerprint: `GET /api/status` JSON containing `controllerId` +
  `boardId` + `strands`. Identity key = **IP** (operator decision).
- `POST /api/config` is **partial** (send only changed keys). `strands[]`/
  `dmx{}` changes → `outcome:"needs-reboot"` and the device **auto-reboots**
  (~10 s). Brightness/current-cap apply live. Never touch `wifi`, `deviceName`,
  `boardType`, swarm from the push flow.
- Firmware sACN mapping is **linear**: one `(universe, startAddress)`, pixels
  run output 0 → 3 across **enabled** strands, 4 ch/px for RGBW, spilling into
  universe+1 at 512-channel boundaries (pixels never straddle universes).
  There is **no per-output universe on the device.**

## What the sim already has (Views Rehaul, PR #36 — reuse, don't rebuild)

- **LED line fixture**: `simulation/src/fixtures/led_strand.js` — draggable
  start/end handles, `ledCount`, rendered strip. Added via the scene's
  `ledStrands` section (`gui_builder.js` `ledStrandArray`, currently
  `strands: []` in `scenes/test_bench/scene_config.yaml`).
- **LED controller type**: `simulation/src/dmx/controller_registry.js`
  (`CONTROLLER_TYPE_LED`, `LED_CHANNEL_ORDERS`, stride, white mode, 4 default
  ports) and `simulation/src/gui/controller_map_editor.js` (DMX↔LED toggle,
  per-port strand chains, "+ add strands" picking, base universe / start
  address / order / white-mode inputs, LED projection preview).
- **Patching + export**: `simulation/src/dmx/patch_manager.js` (LED strands
  carry their own `dmxUniverse`; sim subscribes to those universes) and
  `simulation/src/dmx/pixelblaze_model_exporter.js` (LED strands → engine
  model pixels). Scene persistence: `controllers.yaml`, `patches.yaml`,
  `scene_config.yaml` under `simulation/scenes/<scene>/` via save server :6970.
- **Engine output routing**: `marsin_engine/lib/output_dispatch.js` +
  `config.yaml` `controllers:` block (per-controller host/protocol/universes;
  sACN unicast :5568 / ArtNet :6454; fail-loud on bad config).

## The gaps this plan closes

1. No discovery of MarsinLED devices.
2. No binding of a discovered device to a sim LED controller.
3. No **push** of the sim-side layout to the device (`strands[]` + `dmx{}`),
   no verify/drift detection.
4. Sim LED layout is not constrained to the device's linear model, so sim and
   firmware can disagree.
5. Engine doesn't route the LED universe to the hardware (and the sim bridge
   loses a universe the moment a controller claims it — parity gap).
6. `marsin_engine/models/test_bench.js` has 0 LED pixels (needs re-export once
   strands exist).

## Phases (single Opus agent, sequential; each phase lands runnable + tested)

### P1 — MarsinLED client + discovery module (no UI)

New: `simulation/src/dmx/led/marsinled_client.js` (browser ES module, plain
`fetch`, no deps):

- `probeDevice(ip, {timeoutMs=600})` → `DiscoveredDevice | null`
  (`{ip, controllerId, deviceName, boardId, mac, firmwareSHA, version,
  strands[], sacn, outputs[], pixelCount}` from `/api/status`); accept only on
  the 3-field fingerprint; `AbortController` timeout.
- `scanSubnet(prefix, {onProgress, batchSize=32})` → sweep `.1`–`.254`;
  normalize/validate the `"a.b.c"` prefix exactly like
  `normalizeSubnetPrefix` in CaptainPad; cancellable.
- `getConfig(ip)`, `pushConfig(ip, partial)` (returns the device's
  `{outcome, reboot, message}` or throws with the device's
  `{field, detail}` on 400 — surface it verbatim, no swallowing),
- `rebootDevice(ip)`, `awaitReboot(ip, {timeoutMs=30000})` (poll `/api/status`
  until it answers again; hard error on timeout).
- Client-side validation mirroring docs/41 §4.2 bounds — reject before POST.

Tests: `simulation/tests/marsinled_client.test.js` with a stubbed `fetch`
(happy path, fingerprint rejection, timeout, 400 field error, reboot wait).

### P2 — Device config derivation (the correctness core)

New: `simulation/src/dmx/led/device_config_mapper.js` — pure functions,
heavily unit-tested. This is where sim layout and firmware must agree
byte-for-byte:

- `deriveDeviceConfig(controller, strandFixtures, deviceSnapshot)` →
  `{strands: [...], dmx: {...}}`:
  - Port *k* (1-based) = device output *k−1* = `strands[k−1]`.
  - A port with assigned strand fixture(s): `count` = sum of the chain's
    `ledCount`s, `enabled: true`. Port with none: `enabled: false`, keep the
    device's existing count.
  - Copy `type/pinData/pinClock/colorOrder/rgbwMode` **from the device
    snapshot** (`GET /api/config`) — never invent hardware fields.
  - `dmx: {enabled: true, protocol: 0|1 from controller.protocol,
    universe: <base universe from the sim allocator>, startAddress, timeoutMs: 3000}`.
- `computeLinearLayout(config)` → per-port `{universe, startChannel,
  endChannel, pixelSpan}` using the firmware's exact algorithm
  (4 ch/px RGBW, skip disabled, universe spill at 512, no straddling) — this
  feeds both the UI preview and the sim-side patch record, so the sim's sACN
  model always matches what the device will render.
- `diffDeviceConfig(derived, actual)` → drift report (used for the sync chip
  and to skip no-op pushes).
- **Constraint enforcement (fail loudly):** for a MarsinLED-bound controller
  the per-port layout is *derived*, not free-form — if the existing map-editor
  state (per-port universes/addresses) can't be represented linearly, block
  the push with a precise message; never silently re-map.

Tests: golden cases incl. the real .201 shape (2×40 en / 2 dis → U, ch 1–160 /
161–320), disabled-middle-output skip, >128 px spill to U+1, cap violations.

### P3 — Map-editor UI: discover, bind, push

Extend `simulation/src/gui/controller_map_editor.js` (+ new
`simulation/src/gui/led_discovery_panel.js` to keep the editor readable):

- **Discover panel** (visible for LED-type controllers and via a global
  "Discover LED controllers" button): subnet input (persisted per scene,
  default `10.1.1`), Scan/Cancel with progress, result cards
  (`deviceName`, `controllerId`, ip, board, per-output strand summary, fps,
  `sacn.enabled`, live rx state). Actions per card: **Create controller from
  device** (new LED controller: ip, name from `deviceName`, ports from board
  `outputCount`, order `RGBW`) or **Bind to selected controller** (sets `ip`,
  records identity).
- **Binding block persisted on the controller** (see schema below) so the
  scene remembers *which physical device* backs controller N.
- **Per-output assignment** stays the existing chain UI; add a read-only
  derived-layout line per port (`U3 ch 1–160`) from `computeLinearLayout`, and
  pixel-count surface showing fixture `ledCount` → device `count`.
- **Universe field** = the existing base-universe input; when bound to a
  device it becomes *the* `dmx.universe` pushed; auto-allocate from the
  scene's universe allocator when 0 (never collide with DMX universes).
- **Push to controller** button: read device config → derive → validate →
  diff (no-op ⇒ say "already in sync") → confirm dialog showing the exact
  JSON to be pushed + "device will reboot" warning → POST → on
  `needs-reboot`, `awaitReboot` with progress → **verify**: re-GET
  `/api/config`, assert it matches the derivation; poll `/api/status` for
  `sacn.enabled:true` (and, if the engine is streaming, `rxPackets`
  climbing). Any mismatch = red error state with the diff, never a warning.
- **Sync chip** per bound controller: `In sync / Drift / Unreachable / Never
  pushed`, refreshed on panel open and after pushes (single status GET — no
  background polling loops).
- All state changes go through the editor's existing `mutate()`/undo/save
  pipeline so controllers.yaml + patches.yaml auto-save like DMX edits do.

### P4 — Scene persistence schema (patch stored with the scene)

Everything lives under `simulation/scenes/<scene>/` (the "scene path") —
no global registry, no dotfiles:

- `controllers.yaml` controller entry gains, for LED controllers bound to a
  device:

  ```yaml
  type: LED
  protocol: sACN
  ip: 10.x.x.201
  led: { order: RGBW, stride: 4, whiteMode: native,
         baseUniverse: 3, startAddress: 1 }
  device:                      # identity + push provenance (NEW)
    vendor: marsinled
    controllerId: titanic_201
    deviceName: Titanic-201
    boardId: angio4-old
    mac: "AA:BB:CC:DD:02:01"   # informational only; identity key is ip
    lastPush:
      at: <ISO8601>
      outcome: applied|needs-reboot
      firmwareSHA: be2fcc1b5f6f
      configHash: <sha256 of derived {strands,dmx} JSON>
  ```

- `patches.yaml`: each patched LED strand records
  `controllerIp, controllerId, dmxUniverse, dmxAddress (start channel),
  pixelCount, outputIndex` — computed by `computeLinearLayout`, so a strand
  is "patched" exactly when it has this record; unassigned strands have none.
- Loader must **fail loudly** on a `device:` block whose `vendor` isn't
  recognized or whose shape is invalid (no silent migration).

### P5 — Engine routing + model export + dual-send

- Re-export the test_bench engine model (existing exporter flow) once strands
  exist — `marsin_engine/models/test_bench.js` gains the LED pixels with
  `patch: {universe, addr, footprint}` matching `computeLinearLayout`.
- `marsin_engine/config.yaml`: `controllers:` entry
  `{name: Titanic-201, host: 10.x.x.201, protocol: sACN, universes: [<U>]}`.
- **Dual-send** (`marsin_engine/lib/output_dispatch.js`): today a universe
  claimed by a controller stops reaching the flat `sacn.destinations`, so the
  sim bridge (127.0.0.1:6971) would go dark for the LED universe. Add an
  explicit opt-in per controller entry — `alsoFlat: true` — that sends the
  claimed universes to the controller **and** the flat destinations. Fail
  loudly on unknown keys. Unit-test in
  `marsin_engine/tests/output_dispatch.test.js` alongside the existing cases.
  (Do NOT touch `marsin_engine/lib/` beyond output_dispatch + its test —
  another track owns effects/MIDI files; coordinate via report if more is
  needed.)

### P6 — E2E acceptance on the physical bench (the definition of done)

**Division of labor:** the agent delivers the infra (P1–P5) fully tested with
mocks + a live read-only check against `10.x.x.201`; the **operator** performs
the manual UI flow below (adds the fixtures, maps, pushes). The scene ships
with `strands: []` — do NOT pre-populate LED fixtures or hand-edit the scene
YAML; the whole point is that the operator's UI flow creates them.

From a fresh sim session, **UI-only** (no hand-edited YAML):

1. Open test_bench → add **two LED line fixtures** (40 px each) in the
   `ledStrands` section, position them.
2. Discover → find `10.x.x.201` (card shows titanic_201 / angio4-old / 2
   enabled strands) → Create controller from device.
3. Assign line A → port 1, line B → port 2; universe auto-allocated (expect
   U3+ — U1/U2 are the DMX bench); derived layout shows
   `P1 U<n> ch1–160 · P2 U<n> ch161–320`.
4. Push → confirm → device reboots → verify passes → chip **In sync**.
5. Kill any leftover smoke streamer; start the engine
   (`node engine.js --model test_bench --pattern <any>`) with the
   `controllers:` routing → **physical LEDs animate with the engine pattern
   AND the sim strands show the same pattern** (dual-send).
6. Restart the sim → everything restores from the scene files; chip still
   In sync; `patches.yaml` carries the strand patch records.
7. Sim auto-checks (`.agent/ops/sim_auto_checks.md`) + engine tests pass;
   screenshot evidence via `.agent/skills/see_the_world.md`; dated report in
   `.agent/reports/202607/`.

Engine runtime-state files under `marsin_engine/states/` may change during
tests — expected residue; report, don't revert, don't commit.

## Stability rules (bake into every phase)

- **Read-modify-write, always**: never POST hardware fields you didn't read
  from the device this session.
- **Partial POSTs only** (`strands` + `dmx`); wifi/name/board/swarm are
  off-limits from the sim.
- **Verify after every push**; "pushed" without read-back proof is not done.
- **No polling loops** against the device except the explicit
  `awaitReboot`/refresh actions.
- **Fail loudly everywhere** (codex P0): validation errors show the device's
  `field`/`detail`; unreachable device = error state, not a retry spinner.
- Keep the sACN source streaming across device reboots — the receiver latches
  on boot (verified).

## Round 2 — operator UI requirements (2026-07-10)

Landed after first live mapping. All in `simulation/` (controller_map_editor.js,
led_discovery_panel.js, controller_registry.js, style.css, tests):

1. **Default tray lists LED strands.** Non-picking tray showed only DMX
   fixtures → an unmapped strand was invisible with no LED controller present.
   Show unmapped strands (💡) in the default view; picking stays type-gated.
   (Header "fully patched" already counts strands via `unmappedTotal`.)
2. **Strict type enforcement.** LED controllers accept only LED strands, DMX
   only DMX fixtures — in every add path; guard `addNamesToPort` so cross-type
   mapping is impossible (fail loud).
3. **"MarsinLED" type label** in the add-controller modal + card (replaces
   "Generic/LED"); keep `CONTROLLER_TYPE_LED`/vendor `marsinled` underneath,
   extensible for future vendors. Type label drives grouping.
4. **Per-controller push from latest UI state, safe defaults, no garbage** —
   require allocated non-zero universe, counts from fixture ledCounts, hw
   fields from device snapshot, dmx defaults (protocol/startAddr 1/timeout
   3000/enabled), validate pre-POST, never send device-rejected keys.
5. **"Push all LED controllers"** — sequential (each reboots), skip in-sync,
   one confirm, per-controller result, one failure doesn't abort the rest.
6. **Collapsible type groups** — "DMX Controllers" and "MarsinLED Controllers"
   as independently collapsible sections; Push-all + Discover live in the
   MarsinLED group header.

Constraint: NO live POST to 10.x.x.201 while the operator runs experiments —
mock in tests.

## Out of scope (file follow-ups on the Notion board instead)

- ArtNet push path beyond carrying `protocol` (device supports it; verify
  later).
- Fleet/swarm onboarding (`Titanic-202/.203`) and cross-controller universe
  auto-allocation — schema already allows N controllers.
- CaptainPad surfacing of controller health.
- DMX-controller discovery (same panel could probe :6968/:80 fingerprints —
  separate slice).
