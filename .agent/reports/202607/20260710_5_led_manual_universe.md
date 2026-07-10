# 2026-07-10 — Slice S4: manual per-output universes for MarsinLED

**Plan:** `.agent/plans/20260710_1_led_patching_grouping_look.md` §Requirement D /
Slice S4. Branch `feat/led_integration`, worktree `kind-banach-95157b`.
**Scope:** make each LED controller port's `universe` EDITABLE and wire the manual
per-output universes through the device-linear flows, with LOUD non-blocking
validation. No git ops. No device contact (operator live-testing `10.x.x.201`).

## The one semantic change

The MarsinLED firmware is single-base-universe LINEAR across enabled outputs
(docs/41 §3). Previously the device-linear flows read `controller.led.baseUniverse`
and ignored `port.universe`. Now:

**Base universe = the FIRST ENABLED output's `port.universe`** ("enabled" = the
port's chain carries ≥1 strand entry; ports sorted by port number). `led.startAddr`
unchanged. `led.baseUniverse` stays in the schema (normalizeLedConfig untouched,
unbound `computeLedProjection` still uses it) but bound/device flows no longer read
it. The manual per-output universe is the operator's declared intent; the linear
layout stays the single truth for patches/export/engine (byte-for-byte parity).

## What changed (my file zone only)

- **`device_config_mapper.js`** — new exported PURE helpers `firstEnabledPortUniverse(controller)`
  (the shared base-derivation core) and `synthLinearConfig(controller, counts)`
  (the shared `{strands, dmx}` builder for `computeLinearLayout`). `deriveDeviceConfig`
  now derives `dmx.universe` from the first enabled output (throws loud if that
  output has no valid universe) instead of `led.baseUniverse`.
- **`led_patch_projection.js`** — `computeLedStrandPatches` walks the cursor from the
  first enabled output's universe. Added the PURE `validateLedManualUniverses(registry,
  strandCounts, dmxUniverseMaps)` and `ledUniverseHonorability(controller, layout)`.
  Three warning codes, all NON-blocking (`console`-visible, projection/push proceed):
  - `led_universe_unhonorable` — an output's declared universe isn't where the
    single-base device lands it; the message spells out the real span
    (`P2 is set to U7 … will drive these pixels at U6 ch 161–320 …`).
  - `led_universe_collision` — a controller's real streamed universes (spills
    included) overlap a DMX universe (`computeProjection().universeMaps`) or another
    bound LED controller.
  - `led_universe_duplicate` — two outputs declare the same universe but land at
    different channels.
- **`controller_map_editor.js`** — LED port rows now render an editable universe
  numeric input (1–MAX_UNIVERSE, `noteUniverseUsed` on set, mutate/undo/save
  pipeline) with label `P<n> · U<input> · <n> strand(s)`. The LED config sub-panel's
  editable "U" input became a read-only derived `base = U<first enabled port>`.
  Warn chips (`cm-warn-chip`) render per-port (unhonorable/duplicate) and
  per-controller (collision), computed once per render via `validateLedManualUniverses`.
- **`led_discovery_panel.js`** — `deriveLayoutPreview` now uses `synthLinearConfig`
  (base = first enabled output). `ensureBaseUniverse` → `ensurePortUniverses`
  (repairs only ports left at ≤0; both push paths updated). Push-confirm dialog
  gained a red block listing every output whose declared universe the device won't
  honor and WHERE it will actually place the pixels.
- **`style.css`** — `.cm-warn-chip` (amber, token-based, distinct from the red
  `.cm-error-chip`), `.cm-led-base`, `.led-push-unhonorable-*`.

## Tests (all mock, no device) — PASS

Ran explicitly: `node --test tests/led_patch_projection.test.js
tests/device_config_mapper.test.js tests/led_device_binding.test.js
tests/led_controller_ui_round2.test.js` → **67 pass / 0 fail**. Also re-ran
`tests/pixelblaze_model_exporter_local_index.test.js` (11 pass) to confirm the
base-derivation change didn't disturb the exporter's device-linear path.

Golden coverage includes the plan's goldens: 2×40px RGBW → **U6 ch1–160 / U6
ch161–320** with a manual **U7 on output 2 producing exactly one
`led_universe_unhonorable`** warning (device really places it at U6:161); the
honorable 2×128px on U6/U7 case → zero warnings, strand B at U7:1; collision and
duplicate cases; first-enabled-port-without-universe throws (fail loud);
"base = first enabled output (empty port 1 ⇒ port 2)".

Updated three pre-existing tests that asserted the old `led.baseUniverse`-based
throw/violation to instead drive the first-enabled-**port** universe (the load
validator rejects `universe < 1`, so the out-of-range case uses `> MAX_UNIVERSE`).

## Needs an operator DEVICE test on 10.x.x.201 (once the server is released)

Per plan §"S4 operator device test": push/reboot/verify the boundary-aligned
layout (dialog shows `dmx.universe: 6`, no unhonorable warnings → In sync), then
the **negative case** — map a second 40px strand to P2 (manual U7) and confirm the
port row + push dialog show the `U7 → really U6 ch161–320` warning, push anyway,
and verify the hardware lights the second strand from the U6 stream while the sim
matches. Reload and confirm patches restore (LED_0 U6:1) and the sync chip
re-checks In sync. No agent pushed to the device.
