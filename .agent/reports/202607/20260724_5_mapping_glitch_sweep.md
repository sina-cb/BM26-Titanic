# 2026-07-24 — Mapping glitch sweep (Slice 5): G6/G7/G8/G9 + syncGuiFolders

Slice 5 of `20260724_0_mapping_readiness_review.md` §6.5 (the small-glitch sweep),
built on the current tree after Slices 2–4 (`20260724_2`, `20260724_4`).
Implementer session (Opus). Branch `feat/bm_readiness`. **No git ops, no commits
— all changes uncommitted in the working tree, which also carries other slices'
uncommitted work (untouched).** Sim stack left running on the standard ports
(:6969–:6972); every change is client-side, picked up on a fresh page load — the
stack was NOT restarted. Boot reads: `AGENTS.md`, `.agent/codex.md`, the four
20260724 reports, `nodejs_style.md`, `sim_auto_checks.md`, `see_the_world.md`.

**Out of scope, untouched:** split layout, panel render, reverse link, emitter
geometry, `dmx_fixture_runtime.js` / `led_strand.js` (another agent editing those
now — I did not need them for G9), engine code.

---

## 0. TL;DR

- **G6 (MINOR) fixed** — an unreachable LED push no longer surfaces the raw
  `"signal is aborted without reason"`. `fetchWithTimeout` now translates a
  timeout-triggered abort into `timed out after <N> ms — device did not
  respond`. Verified end-to-end in the real sim build (browser repro +
  screenshot): the toast reads `✋ 10.x.x.1 unreachable: timed out after 1500
  ms — device did not respond`.
- **G7 (MAJOR) fixed** — the sync-chip and live-MAC caches are now **scene-scoped**
  (`${scene}::${controllerId}`). `nextControllerId` restarts at 1 per scene, so a
  bare id key could serve one scene's chip/MAC for another scene's same-id
  controller; a cross-scene read is now a miss.
- **G8 (MAJOR) fixed** — the up-to-30 s reboot wait in the per-output push is
  **guarded**. If the controller is deleted (or the scene changes, i.e. it leaves
  the registry) during the wait, the push result is **discarded loudly** instead
  of recording provenance onto a detached/wrong object and triggering a save.
- **G9 (MAJOR) resolved** — `led.baseUniverse` is no longer written on
  create/bind for **bound** controllers, where the per-output device layout
  (`computeLedStrandPatches`, keyed off `port.universe`) is the one hardware-proven
  source of truth and always ignored it. **Wire behaviour unchanged** (proven
  immune to `baseUniverse` by a new parity test); with the vestigial write gone,
  the generic and device projections agree for bound controllers.
- **Bonus one-liner fixed** — `gui_builder.js` "☑ Select All" group button called
  an unimported `syncGuiFolders()` (ReferenceError on click). `syncGuiFolders` is
  now `export`ed from `interaction.js` and statically imported — no
  optional-chained window fallback (codex P0).
- **293** sim unit tests pass (284 baseline + **9 new**); `git diff --check`
  clean; `scene_console_smoke` clean on titanic + test_bench; `pick_accuracy_test`
  still **2/2** split-invariant.

---

## 1. What changed (files)

| File | Change |
|---|---|
| `simulation/src/dmx/led/marsinled_client.js` | **G6.** `fetchWithTimeout` (:117) tracks a `timedOut` flag set by the abort timer; on a fetch rejection it rethrows `timed out after <N> ms — device did not respond` when `timedOut` (the timer is the only thing that aborts this signal — scanSubnet's cancel signal is checked between batches, never wired into fetch here). Every non-timeout rejection (connection refused, DNS) still propagates verbatim. `probeDevice` still returns null on timeout (its catch is unchanged). |
| `simulation/src/gui/led_discovery_panel.js` | **G7.** New `cacheKey(ctx, id)` = `` `${ctx.activeScene()}::${id}` `` (:51); `syncCache`/`liveMacCache` now go through `setSyncState`/`getSyncState`/`setLiveMac`/`getLiveMac` helpers that key by scene. `getSyncState`/`getLiveMac` (exported, used only inside this module) gained a leading `ctx` param; every write site threads `ctx`. **G8.** New `controllerIsLive(ctx, controller)` (:663, reference-identity membership check); `pushPerOutputVerifyRecord` throws a loud "removed during the reboot wait" error just before its `ctx.mutate` (:706) when the controller is no longer in the registry. **G9.** Removed the `led.baseUniverse` allocation in `createFromDevice` (:386) and `bindToController` (:415) — comments explain why (ports already carry per-output universes via `addPort`; the device path ignores `baseUniverse`). |
| `simulation/src/core/interaction.js` | **Bonus.** `syncGuiFolders` is now `export function` (:178). |
| `simulation/src/gui/gui_builder.js` | **Bonus.** Added `syncGuiFolders` to the `../core/interaction.js` named import (:27) so the group "☑ Select All" handler (:1707) resolves it. |
| `simulation/tests/marsinled_client.test.js` | **NEW G6 tests** — getStatus/getConfig on a hung host throw the legible timeout (not "signal is aborted"); a non-timeout failure still propagates verbatim. |
| `simulation/tests/led_discovery_scene_liveness.test.js` | **NEW.** G7 scene-scoping (an entry set in one scene is not served in another), G8 delete-during-reboot discards the push (no blind mutate) + the live-controller happy path still records. |
| `simulation/tests/led_base_universe_quarantine.test.js` | **NEW.** G9 parity: `computeLedStrandPatches` is byte-immune to `baseUniverse`; with `baseUniverse=0` the generic and device projections agree; a stray `baseUniverse` is exactly what made the generic projection diverge (the rationale for not writing it). |
| `simulation/tests/led_controller_ui_round2.test.js` | Its mock `makeCtx` gained `activeScene: () => 'test'` — the cache is now scene-scoped, so the push path needs it (mirrors the real `ledCtx`). |

### G9 detail — why removing the write is the whole fix

At runtime the bound LED patch fields come **only** from
`computeLedStrandPatches` (`main.js window.projectLedStrandPatches`, :443), which
addresses per output from `port.universe` and never reads `baseUniverse`.
`computeLedProjection` (which *does* honor `baseUniverse`) is consulted for bound
controllers only as (a) the export existence-check that `deviceProj` then
overrides, and (b) `ledUniverseClaims`, which drops any name already resolved by
the bound path. So a bound controller's `baseUniverse` never reached the wire —
it was pure misleading residue that made the two projections disagree. Leaving it
`0` makes `computeLedProjection` fall back to `port.universe`, so both projections
now agree for bound controllers. `baseUniverse` remains a valid field for the
UNBOUND generic model and for backward-compat loading (`normalizeLedConfig`
still accepts it); `computeLedProjection`'s math is **unchanged** (no wire/test
churn). The `cm-led-base` readout was already quarantined in Slice-era code
(reads `firstMapped.universe`, not `baseUniverse`).

---

## 2. Verification

### Auto-checks (`.agent/ops/sim_auto_checks.md`)
- `git diff --check -- simulation`: **PASS** (only benign LF→CRLF warnings on
  `common.yaml`/`manifest.json`, untouched by this slice).
- `node --check` on every changed/new JS/CJS file: **PASS**.
- `cd simulation && npm test`: **293 pass / 0 fail** (284 baseline + 9 new).
- `agent_tools/scene_console_smoke.cjs titanic` and `… test_bench`: **no
  `pageerror` / uncaught JS**. Remaining lines are pre-existing environment noise
  (a 404 + `ERR_CONNECTION_REFUSED` to the sACN/engine bridges not running in the
  harness) — none from the changed modules; no `syncGuiFolders`/ReferenceError.
- `agent_tools/pick_accuracy_test.cjs`: **2/2 split-invariant across 4 pane
  widths**, exit 0 (this slice does not touch the raycaster/canvas).

### Scripted repros
- **G6 (browser, real build):** `scratchpad/sweep_g6_offline_repro.cjs` loads
  titanic, calls the real `marsinled_client.getStatus('10.x.x.1',
  {timeoutMs:1500})` in-page, and asserts the caught message is `timed out after
  1500 ms — device did not respond` with **no** `signal is aborted` substring —
  important because the browser's raw AbortError string differs from Node's, and
  the fix keys off the `timedOut` flag so it's immune to either wording.
  Screenshot: `.agent_renders/sweep_offline_push_message.png` (visually
  inspected — the red toast reads the clean message).
- **G7 scene-switch:** unit test flips `ctx.activeScene()` between two scenes and
  shows an in-sync chip set under scene A is `null` under scene B and returns
  under A.
- **G8 reboot-race:** unit test deletes the controller inside the mocked
  `awaitReboot`; `pushAllLedControllers` reports a per-controller `failed` with
  `/removed .* during the reboot/` and `controller.device.lastPush` stays
  `undefined` (no blind mutate). The live-controller happy path still records.

---

## 3. Known gaps / notes

- **G8 guard is reference-identity** (`registry.controllers.includes(controller)`).
  This catches delete (splice), undo (`restoreSnapshot` rebuilds with fresh
  objects), and scene switch (full page reload — the object is gone). It does NOT
  attempt to detect an in-place *field* mutation of the same controller object
  during the wait; that's not the failure mode G8 describes and would need a
  finer epoch token. Left as-is.
- **G6 message** is emitted by the shared `fetchWithTimeout`, so getStatus /
  getConfig / pushConfig / per-output push all inherit it. The offline *scan*
  path was already clean (`no MarsinLED controllers answered on …`) and is
  unchanged.
- **G9**: I did NOT neutralize `baseUniverse` inside `computeLedProjection`
  (would change the unbound model + break existing `baseUniverse` tests for no
  wire benefit). If the team later wants `baseUniverse` fully deleted, the
  unbound generic model must first be decided on — flag for a follow-up, not this
  sweep.
- FPS/perf untouched (render-loop G1 is a separate slice). No git ops.

## 4. Out of scope (untouched)

Split-layout, panel incremental render, reverse-link, emitter geometry,
`dmx_fixture_runtime.js`/`led_strand.js`, engine code (incl. G10). No git ops.
