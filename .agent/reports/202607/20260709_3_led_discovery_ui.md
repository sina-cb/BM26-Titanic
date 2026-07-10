# 2026-07-09 — LED discovery UI + scene persistence (LED integration P3+P4)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260709_0_led_integration_execution.md` — phases **P3**
(map-editor discover/bind/push UI) and **P4** (device-binding schema + strand
patch persistence). Consumes P1/P2 (`marsinled_client.js`,
`device_config_mapper.js`) verbatim and P5's `alsoFlat` dual-send.
**No git operations performed.** Device `10.x.x.201` touched READ-ONLY only.

## Scope delivered

- **P3 UI** — a discovery/bind/push surface on the Controller Mapping panel:
  subnet scan, result cards, create/bind, per-output derived-layout lines, a
  read-through-verify Push flow, and a per-controller sync chip.
- **P4 persistence** — the `device:` binding block on LED controllers (identity
  + push provenance) with fail-loud load validation, and device-linear LED
  strand patch records written into `patches.yaml` through the existing save
  flow.

## Files

### New
- `simulation/src/gui/led_discovery_panel.js` — all discover/bind/push DOM +
  orchestration (kept out of the editor for readability). Owns the sync-chip
  cache, the scan modal, the push confirm+verify dialog, and the
  layout-preview helper.
- `simulation/src/dmx/led/led_patch_projection.js` — **pure**
  `computeLedStrandPatches(registry, strandCounts)`: the firmware's *contiguous*
  linear layout, reported per strand (universe/addr/pixelCount/outputIndex +
  controllerIp/controllerId), for **device-bound** LED controllers only.
- `simulation/tests/led_device_binding.test.js` — 20 tests (schema + mutations).
- `simulation/tests/led_patch_projection.test.js` — 10 tests (golden layouts).

### Modified
- `simulation/src/dmx/controller_registry.js` — `device:` block:
  `normalizeDeviceBlock`, load-time wiring in `createControllerRegistry` (fail
  loud on unknown vendor / block-on-DMX / bad shape), and mutations
  `bindControllerDevice`, `unbindControllerDevice`, `recordDevicePush`,
  `addLedControllerFromDevice`, `isBoundLedController`,
  `LED_DEVICE_VENDOR_MARSINLED` / `LED_DEVICE_PUSH_OUTCOMES`.
- `simulation/src/gui/controller_map_editor.js` — a `ledCtx()` bridge into the
  mutate/undo/save pipeline; a global **🔍 Discover LED Controllers** button;
  the per-controller device section (identity/chip/push/re-bind); the per-port
  read-only derived-layout line; bound-controller chips now render the
  device-linear address; `refreshSyncChips` on panel open; LED strand
  projection folded into `recomputeAndMark()`.
- `simulation/main.js` — `window.projectLedStrandPatches()` (applies the strand
  records onto `params.ledStrands` + the global patch tree, unpatches the rest)
  and a boot call so scenes restore their strand patches.
- `simulation/server/save-server.js` — extracts the six LED strand patch fields
  (`controllerIp, controllerId, dmxUniverse, dmxAddress, pixelCount,
  outputIndex`) from `ledStrands.strands` into `patches.yaml` and strips them
  from `scene_config.yaml`; a record is written only for a *patched* strand.
- `simulation/style.css` — `led-disc-*`, `led-device-*`, `led-sync-*`,
  `led-push-*`, `cm-led-derived`, `cm-discover-led` (all CSS-variable tokens).

## Tests

- New files alone: **30 subtests pass**
  (`node --test tests/led_device_binding.test.js tests/led_patch_projection.test.js`).
- Full sim suite `node --test tests/*.test.js`: **186 pass, 0 fail** (was 159;
  +27 new incl. the P1/P2 files, all green — `three` is installed in this
  worktree's `node_modules`).

## UI smoke (screenshot, inspected)

Booted the sim on **slot-0 ports** (31069–31072; the default 6969–6972 were
busy with the operator's running sim + `.201` smoke streamer, left untouched;
`simulation/config.yaml` was edited in-worktree and **reverted** after). Scene
`test_bench`, headed Chrome via the vendored puppeteer. Injected two 40-px LED
lines + a bound `Titanic-201` controller, opened the panel:
`~/…/scratchpad/led_panel2.png`.

Verified in the PNG (zero page errors from the new code):
- Bound card shows identity `Titanic-201 · angio4-old · AA:BB:CC:DD:02:01`,
  the **▲ Drift** sync chip (it reached the live `.201` read-only and diffed),
  push provenance, **⬆ Push to controller** + **Re-bind…**.
- Derived-layout lines are the **device-linear** span: `P1 → U3 ch 1–160`,
  `P2 → U3 ch 161–320` (Line B correctly at **U3:161**, contiguous — matches
  docs/41 §3 exactly), P3/P4 `disabled (no strands)`.
- Chips render the same device-linear address (`Line B U3:161 ×40px`).
- `agent_render.cjs --show-ui` against slot-0 also confirmed a clean boot with
  all the changes (WebGL working, load complete, fully patched).

## Operator flow (how to use the panel)

1. Open **🎛 Controller Mapping**. Add your LED line fixtures under **💡 LED
   Strands** first (2× 40-px for `.201`), position them.
2. Click **🔍 Discover LED Controllers** → set the subnet (default `10.1.1`,
   persisted per scene) → **Scan**. Cards show controllerId, ip, board, per-
   output strand summary, fps, sACN state.
3. On the `titanic_201` card click **+ Create controller from device** (or, on
   an existing LED controller's card, **Bind to '…'**). This creates an LED
   controller with 4 ports (RGBW), records the `device:` binding, and
   auto-allocates a base universe (expect **U3+** — U1/U2 are the DMX bench).
4. Assign line A → Port 1, line B → Port 2 (`+ add strands`). Each port shows
   its derived span live (`output 1: U3 ch 1–160 · 40px`).
5. Click **⬆ Push to controller** → the dialog shows the exact JSON diff, a
   "device will reboot" warning, and a copy-pasteable
   `marsin_engine/config.yaml` `controllers:` snippet (host/protocol/universes/
   `alsoFlat: true`). Confirm → pushes strands+dmx → waits out the reboot →
   re-reads and asserts the config matches + `sacn.enabled` → chip goes
   **● In sync**. Any mismatch is a red error state showing the diff.
6. Save (controllers.yaml + patches.yaml auto-save via the panel). Restart the
   sim → the binding + strand patches restore from the scene; the chip
   re-checks on open.

The sync chip is computed on panel open and after a push only (one
getConfig+getStatus each — no background polling).

## Known gaps / decisions (read before wiring the rest)

- **Device-linear vs the sim's generic per-port projection.** For a bound
  MarsinLED, patches.yaml + the panel now use the *contiguous* device model
  (`computeLedStrandPatches` / `computeLinearLayout`): output N continues where
  N-1 ended. The scene **exporter** (`pixelblaze_model_exporter.js`) still uses
  the registry's `computeLedProjection`, which **resets the cursor per port**
  (Line A and Line B would both land at U3:1). So a **multi-output** bound
  controller's engine model disagrees with both the device and patches.yaml.
  This is the plan's remaining **P5 "model re-export"** work: the exporter must
  adopt `computeLedStrandPatches` for bound controllers. I did **not** touch the
  exporter or `computeLedProjection` (P2 boundary + suite stability). Single-
  output-per-controller rigs are unaffected. **Flag for the next agent.**
- **Unbound LED controllers** get no patches.yaml strand record from
  `computeLedStrandPatches` (device: absent = unbound, by design). They keep the
  existing generic projection/export path.
- **P1 gap confirmed/worked around:** `probeDevice` returns `deviceName:
  undefined` (it lives in `/api/config`). Create/Bind therefore `getConfig(ip)`
  at action time for the real name (falling back to `controllerId` for the card
  label) — no fabrication.
- **P2 gap confirmed/worked around:** `deviceConfigMapper` requires a non-zero
  base universe. Create **and** Bind now auto-allocate `led.baseUniverse` via
  `nextFreeUniverse`/`noteUniverseUsed` immediately, and Push re-ensures it, so
  a bound controller always derives.
- **configHash** is `sha256(JSON.stringify(derived {strands,dmx}))` via
  `crypto.subtle` (secure-context on `localhost`). `firmwareSHA` comes from the
  live status/config at push time; timestamps use the real clock.
- **Subnet persistence** is `localStorage` keyed by active scene
  (`bm26.ledDiscovery.subnet.<scene>`) — offline-safe, no scene-YAML pollution.
- I did not modify `marsinled_client.js` or `device_config_mapper.js` (P1/P2).
