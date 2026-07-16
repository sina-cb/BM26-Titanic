# 2026-07-10 — LED controller UI, Round 2 (operator polish)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260709_0_led_integration_execution.md` → the
**"Round 2 — operator UI requirements (2026-07-10)"** section (R1–R6). Consumes
the existing P1/P2/P3/P4 modules verbatim (`marsinled_client.js`,
`device_config_mapper.js`, `led_patch_projection.js`, `controller_registry.js`)
— no duplicated device math.
**No git operations performed. NO POST/PUT to the live device.** The physical
`10.x.x.201` was **never contacted at all** (see "Device I/O" below).

## Scope — the six Round-2 requirements

- **R1 — default tray lists LED strands.** The non-picking tray now shows
  unmapped LED strands (💡) alongside unmapped DMX fixtures, so a strand is
  visible even with no LED controller present. Picking stays strictly
  type-gated (LED port → strands only, DMX port → fixtures only). Title count
  and empty-state message updated; the header `unmappedTotal` count is
  untouched (not regressed).
- **R2 — strict type enforcement.** Every add path (`+ sel` / `+ list` /
  `+ add strands`, all routed through `addNamesToPort`) refuses a name whose
  kind (strand vs fixture) doesn't match the target controller — loud toast,
  no-op, never a silent cross-type mis-map.
- **R3 — "MarsinLED" label.** The add-controller modal option, the card's
  DMX↔LED toggle button, and the group heading all read **MarsinLED**.
  `CONTROLLER_TYPE_LED = 'LED'` and vendor `'marsinled'` stay underneath
  (extensible for future vendors); the label is a single `LED_TYPE_LABEL`
  constant that also drives the R6 grouping.
- **R4 — safe per-controller push.** Push derives from CURRENT registry/UI
  state at click and can never push empty/zero/garbage: a new pure
  `derivePushPayload()` runs `deriveDeviceConfig` (which requires an allocated
  non-zero base universe, ≥1 enabled output, hardware fields copied from the
  device snapshot, dmx defaults protocol/startAddress/timeoutMs 3000/enabled)
  **then** `validatePushPayload` (docs/41 §4.2 bounds + denied-key guard)
  BEFORE the confirm dialog. Any violation blocks with the device field/detail.
  The payload is structurally only `{strands, dmx}` — never
  wifi/deviceName/boardType/swarm.
- **R5 — "Push all MarsinLED controllers".** A button in the MarsinLED group
  header pushes every BOUND LED controller **sequentially** (each reboots →
  the loop awaits each full derive→validate→diff→(skip if in-sync)→push→
  awaitReboot→verify→record before the next). One up-front confirm summarizing
  the count + reboot warning; a per-controller result summary at the end; a
  failure on one is reported but does NOT abort the rest; a bound controller
  with no valid IP is skipped with a note.
- **R6 — collapsible type groups.** `render()` now splits controllers into two
  independently-collapsible sections — **"DMX Controllers"** and **"MarsinLED
  Controllers"** — by `controller.type`, each with a persisted (session) collapse
  state. Discover + Push-all live in the MarsinLED group header. An empty group
  shows a muted hint (so Discover stays reachable with zero LED controllers).

## Files

### Modified
- `simulation/src/dmx/controller_registry.js` — three pure, exported helpers
  (the testable seams behind the DOM): `controllerFixtureKind`,
  `controllerAcceptsKind` (R2), `unmappedNamesByKind` (R1).
- `simulation/src/gui/led_discovery_panel.js` — `derivePushPayload` (R4
  derive+validate seam), a shared `pushDeriveVerifyRecord` core (single-push
  and push-all use the SAME path), `pushAllLedControllers(ctx, io)` +
  `startPushAll(ctx)` (R5). `runPush` refactored onto the shared core; an
  injectable `DEFAULT_DEVICE_IO` bag makes the orchestration mockable.
  `sha256Hex` now
  uses `globalThis.crypto` (identical to `window.crypto` in the browser; also
  works under node:test).
- `simulation/src/gui/controller_map_editor.js` — R1 tray (both fixtures +
  strands, updated title/empty-state), R2 cross-type guard in `addNamesToPort`
  (+ `strandNameSet`/`nameKind` helpers), R3 `LED_TYPE_LABEL` on the toggle +
  modal, R6 `renderControllerGroup()` with `collapsedGroups` + Discover/Push-all
  in the MarsinLED header (the old global Discover button moved into that header).
- `simulation/style.css` — `.cm-group*`, `.cm-group-cards`, `.cm-push-all-led`,
  `.cm-discover-led` (all CSS-variable tokens; cards keep the multi-column flow,
  now scoped per group).

### New
- `simulation/tests/led_controller_ui_round2.test.js` — 10 tests (below).

## Tests

`npm test` in `simulation/` (globs `tests/*.test.js`; `three` is npm-installed
`--no-save` in this worktree): **200 pass, 0 fail** (was 190; +10 new).

The new file covers, all against pure functions / a MOCK device store:
- **R1**: `unmappedNamesByKind` returns unmapped fixtures AND strands; a mapped
  strand drops out and returns on unmap.
- **R2**: `controllerFixtureKind` / `controllerAcceptsKind` refuse the
  cross-type name (LED↔strand, DMX↔fixture) both ways.
- **R4**: `derivePushPayload` builds a validated `{strands, dmx}`-only payload
  (no denied keys); THROWS on an unallocated base universe, on no-enabled-output
  (empty push), and on a strand with no known ledCount (garbage).
- **R5**: `pushAllLedControllers` serializes (registry order, push→awaitReboot→
  verify sequence), skips an in-sync controller (no push), continues past a
  failed controller, and skips a bound controller with no valid IP (zero I/O).

## UI smoke (screenshot, inspected)

Booted the sim on **slot-0 ports** (31069–31072; `simulation/config.yaml`
edited in-worktree and **reverted** after — the operator's default-port stack
was left untouched). Scene `test_bench`, headed Chrome via the vendored
puppeteer. Injected (through ES-module singletons — no scene edit, reverts on
reload) two UNMAPPED LED strands + one BOUND MarsinLED controller, opened the
panel, screenshotted it:

`.agent_renders/1783671326_round2_panel.png` (repo-root, gitignored).

Verified in the PNG:
- **"DMX CONTROLLERS (1)"** and **"MARSINLED CONTROLLERS (1)"** render as two
  independent collapsible groups (DMX collapsed to a `▸` in the shot) — R6.
- The MarsinLED group header carries **🔍 Discover** and **⬆ Push all** — R5/R6.
- The controller's type button reads **MarsinLED** — R3.
- The default tray reads **"UNMAPPED — 0 FIXTURE(S), 3 STRAND(S)"** with 💡
  `lineA` / `lineB` strand chips visible with no picking active — R1.
- Header still reads **"Unmapped: 3 ⚠"** (the strand-inclusive `unmappedTotal`,
  not regressed).

The throwaway capture helper (`agent_tools/round2_panel_shot.cjs`) was **deleted**
after use; servers were killed and `config.yaml` restored.

## Device I/O (per the hard constraint)

**None.** No POST/PUT and **no GET** reached `10.x.x.201`. The R4/R5 push paths
are only exercised in tests against a mock `io` store. The UI smoke used an
unroutable TEST-NET IP (`192.0.2.x`, RFC5737) for the injected controller, and
because it carried no `lastPush` the sync-chip refresh short-circuits to
`○ Never pushed` without any device call. The operator's live experiment was
undisturbed.

## Operator-visible changes

1. Unmapped LED strands now appear as 💡 chips in the default tray (with a
   `… N fixture(s), M strand(s)` count); before, an unmapped strand was
   invisible unless you were picking onto an LED port.
2. Mapping a DMX fixture onto a MarsinLED controller (or a strand onto a DMX
   one) is now refused with a loud toast instead of silently mis-mapping.
3. The LED type is labelled **MarsinLED** in the add-controller dropdown and on
   the card's type toggle button.
4. **Push to controller** now pre-validates the exact payload before the confirm
   dialog and blocks a zero/empty/unallocated/garbage push with the device
   field/detail; it always derives from current UI state.
5. New **⬆ Push all** button in the MarsinLED group header pushes every bound
   controller one at a time (each reboots), skips already-in-sync ones, keeps
   going if one fails, and reports a per-controller summary.
6. Controllers are now organised into two collapsible **DMX Controllers** /
   **MarsinLED Controllers** sections; **🔍 Discover** and **⬆ Push all** live in
   the MarsinLED header (the old standalone Discover button moved there).
