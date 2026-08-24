# 364 — S1 (revised): gamma UI disabled, gamma PULL removed, gamma PUSH parked

Implements slice **S1** of report `_363`, but **NOT as `_363` §1 wrote it**.
The operator issued superseding rulings after that plan was written; they are
reproduced verbatim-in-substance below and are what this slice built.
Everything here is **implemented and gated** (greps, `node --check`, targeted
`node --test`). No git operation, no device contact, no stack bounce.

Controllers are named by `controllerId`; no IPs appear.

---

## 1. The superseding operator rulings (these WIN over `_363` §1)

1. **The gamma UI STAYS, rendered DISABLED.** `led_gamma_ui.js` is not
   deleted. The per-card gamma section still renders — sliders, presets,
   Link RGB, the push button, the curve plot, the provenance line — and every
   one of them is inert and greyed.
2. **Gamma PUSH machinery is KEPT, DORMANT**, for a quick re-enable later:
   *"as soon as I am happy with the config push, I will do that too."*
3. **Gamma PULL is REMOVED PERMANENTLY** — *"only push, not pull"* —
   **including the manual refresh**. The sim never reads gamma from a device
   again. This also supersedes today's earlier ~18:02 edit to
   `led_gamma_ui.js`, which had cut only the render-time auto-pull and left a
   comment saying "manual only": there is no manual pull either.

`_363` §1 planned TOTAL gamma removal (files deleted outright, routes gone,
CSS and scene YAML swept). That plan is now **wrong in its §1 and §11**; see
§7 below for what must be corrected.

---

## 2. What SURVIVED vs what was REMOVED

### Survived (dormant, compiling, tested)

| Thing | State |
|---|---|
| `src/gui/led_gamma_ui.js` | kept, rewritten as a **read-only, fully disabled** section |
| `src/dmx/led/led_gamma.js` push + validation half | kept: `validateGammaMirror`, `parseGammaField`, `quantizeGamma`, curve/preset/plot maths, `readGammaMirror`/`setGammaMirror` (SCENE-mirror accessors, no I/O), `gammaPushRequestBody`, `postGamma`, `DEFAULT_GAMMA_TRANSPORT` (push leg only), `commitGammaPush`, `pushGammaToController`, `pushGammaFleet`, `summarizeFleetResults` |
| `server/led_gamma_service.cjs` | kept whole except its standalone read (below) |
| `POST /led/gamma-push` in `server/save-server.js` | kept, dormant, commented as such |
| `agent_tools/led_gamma_push.cjs` | kept as a **push-only** CLI |
| `recordDeviceGammaPush` / `device.lastGammaPush` in `controller_registry.js` | untouched — the disabled UI still displays the last push stamp |
| `tests/led_gamma_workflow.test.js`, `tests/led_gamma_push_devicename.test.js` | untouched, green |
| `led_wire.js`, `controllerGamma` preview values, scene YAML, `style.css .led-push-*` | **untouched**, per instruction |

### Removed (permanently)

| Removed | Where |
|---|---|
| `GET /led/gamma` route | `server/save-server.js` (≈935–952) |
| `readGamma(host)` + its export | `server/led_gamma_service.cjs` — its only two callers were the deleted route and the CLI's `--read` |
| `--read` CLI leg | `agent_tools/led_gamma_push.cjs` — the flag now **fails loudly** (it must not silently fall through to a push) |
| `refreshGammaFromController`, `commitGammaRefresh`, `gammaRefreshState`, `clearGammaRefreshCache`, `cacheVerifiedGamma`, `validateGammaReadIdentity`, `gammaRefreshCache`, `GAMMA_REFRESH_TTL_MS` | `src/dmx/led/led_gamma.js` — the whole TTL-cached refresh path |
| `getGamma` transport leg + `readGamma` key on `DEFAULT_GAMMA_TRANSPORT` | `src/dmx/led/led_gamma.js` |
| `fleetGammaSourcePlan` + `gammaExactlyEquals` | `src/dmx/led/led_gamma.js` — fleet SOURCE selection (harvesting a curve off a chosen card) is the last "read a curve from somewhere else" surface |
| `startFleetGammaPush` (the fleet dialog) | `src/gui/led_gamma_ui.js` — it existed only to drive the deleted source selection; its entry button is now inert |
| `runGammaRefresh`, `runSingleGammaPush`, `commitThroughCtx`, `commitRefreshThroughCtx`, the "↻ Refresh gamma" button, the inline error line, every slider/preset/link handler | `src/gui/led_gamma_ui.js` |
| CSS `.cm-led-gamma-error`, `.led-gamma-row-*` (fleet dialog rows) | `style.css` — dead with the controls they styled |

New in `style.css`: `.cm-led-gamma-note` (the "why is this off" line) and the
`.cm-led-gamma-off` fade for the disabled sliders/plot/readouts. House style:
buttons and chips lean on the existing `.cm-btn:disabled` (opacity 0.35).

The section's note/tooltip, used verbatim on the section, every chip, the
sliders, the push button and the fleet entry:

> gamma is disabled until the config push is confirmed — set it on the
> controller's own web UI for now. The sim never reads gamma back from a device.

---

## 3. Gate results

### G-pull — zero device-read gamma symbols

Real symbol names identified first (the brief's examples were guesses), then
grepped over `simulation/` (excluding `node_modules`, `vendor`,
`.scene_backups`):

| Symbol | Hits | Note |
|---|---|---|
| `refreshGammaFromController` | 0 code | 2 hits, both inside the new absence-guard test's string list |
| `commitGammaRefresh` | 0 code | test string list only |
| `gammaRefreshState` | 0 code | test string list only |
| `clearGammaRefreshCache` | 0 code | test string list only |
| `GAMMA_REFRESH_TTL_MS` / `gammaRefreshCache` | 0 code | test string list only |
| `cacheVerifiedGamma` | **0** | |
| `runGammaRefresh` | **0** | |
| `fleetGammaSourcePlan` | 0 code | test string list only |
| `startFleetGammaPush` | 0 code | test string list + one absence assertion |
| `getGamma` / `transport.readGamma` | **0** | |
| `readGamma(` | 0 code | 1 hit: the comment in `led_gamma_service.cjs` explaining the removal |
| `"Refresh gamma"` (button label) | 0 code | test string list only |
| `GET /led/gamma` route string | 0 code | 2 comment hits explaining the removal; `/led/gamma-push` (POST) intentionally remains |
| `--read` | 0 read path | CLI header comment + the loud refusal |

Permitted-mention rule honoured: every surviving hit is either a comment
explaining the removal or a test asserting the absence.

`lastGammaPush` / `recordDeviceGammaPush` still appear (registry, UI stamp,
tests) — **kept deliberately** per the rulings; they are push receipts, not a
read path.

### G-syntax — `node --check`, every touched `.js`/`.cjs`

```
OK  src/dmx/led/led_gamma.js
OK  src/gui/led_gamma_ui.js
OK  src/gui/controller_map_editor.js
OK  server/save-server.js
OK  server/led_gamma_service.cjs
OK  agent_tools/led_gamma_push.cjs
OK  tests/led_gamma.test.js
```

(`style.css` has no checker; it is validated by the theme-parity suite, green.)

### G-tests — `node --test`, from `simulation/`

Command: `node --test tests/led_gamma.test.js tests/led_gamma_workflow.test.js
tests/led_gamma_push_devicename.test.js tests/controller_registry.test.js
tests/led_controller_ui_round2.test.js tests/theme_parity.test.js`

| | tests | pass | fail |
|---|---|---|---|
| **before** | 151 | 151 | 0 |
| **after** | 149 | 149 | 0 |

Net −2: **6 pull tests deleted** (TTL coalescing, TTL expiry + manual refresh,
push-primes-cache, refresh identity/malformed refusal, and the two fleet
SOURCE-selection tests), **1 rewritten** (the frozen-fleet-curve test now
states the curve outright instead of harvesting it from a card), **1 replaced**
(the old `runGammaRefresh` source-reading test), **+5 added**:

- `the gamma transport has a push leg and NO read leg`
- `led_gamma.js exports no refresh / cache / fleet-source symbol`
- `the gamma UI section is DISABLED: no handler, no transport, no fetch`
- `the fleet gamma entry is inert in the Controllers pane`
- `no server route or service function reads gamma off a device`

Regression fences also run green (not part of the gate line, run as a fence):
`controller_pane_ergonomics`, `led_bind_affordance`, `provisional_binding`,
`per_output_push`, `marsinled_client`, `led_wire`,
`led_discovery_scene_liveness`, `controllers_pane_toggle` → **243/243**; and
the source-scanning suites `subscribed_universes`, `touch_control_passcode`,
`chained_led_patches`, `natural_sort`, `led_segments_persistence`,
`led_fixtures_menu_wiring`, `rename_hygiene_wiring`, `panel_layout`,
`panel_visibility` → **153/153**.

Full `npm run check` was **not** run: it binds/sweeps live-stack ports and the
operator's stack is up (`_363` §7 rule).

### G-inert — code reading, every handler left alive

`src/gui/led_gamma_ui.js` after the rewrite:

- **Imports**: `GAMMA_CURVE_GEOMETRY`, `LED_GAMMA_CHANNELS`, `LED_GAMMA_MIN`,
  `LED_GAMMA_MAX`, `LED_GAMMA_PRESETS`, `LED_GAMMA_RECOMMENDED`,
  `LED_GAMMA_STEP`, `activeGammaPresetKey`, `formatGamma`, `gammaCurvePath`,
  `gammaEquals`, `readGammaMirror`, `isLedController`. **No transport, no push
  function, no refresh function, no `saveHttpUrl`, no `fetch`.**
- **Handlers**: there are **none**. The file contains no `onclick`,
  `oninput`, `onchange`, `onkeydown` or `addEventListener` — asserted by test,
  not just by eye.
- **Controls**: `chip.disabled = true` (×3 presets), `linkBox.disabled = true`,
  `pushBtn.disabled = true`, `slider.disabled = true` (×4), plus
  `aria-disabled="true"` on the section.
- **Reads**: exactly two, both pure scene reads — `readGammaMirror(controller)`
  (`led.wire.controllerGamma`, or the wire default) and
  `controller.device.lastGammaPush`. Neither performs I/O.
- `controller_map_editor.js`: `gammaAllBtn.disabled = true` with **no**
  `onclick` and no import of a fleet function.

Therefore no live handler in the gamma section can reach `fetch` or the
save-server. ✅

### Browser smoke — DEFERRED

`_363` §1.4-G6 (LED card renders, console clean, routes answer 404) needs a
launcher bounce, which is operator-timed. **Nothing was bounced.** When the
operator next bounces: the card should show the gamma block greyed with the
"⏸ …" note, `GET /led/gamma?ip=…` must answer 404, and
`POST /led/gamma-push` must still answer (it is kept).

---

## 4. One deviation worth naming: `readGammaMirror` stays

The brief's G-pull example list named `readGammaMirror` as a device-read
symbol. It is **not** one: it reads `led.wire.controllerGamma` out of the
scene object (falling back to the documented wire default) and performs no
I/O. It is what the disabled sliders display, and what the dormant push uses
as its default curve. Deleting it would have meant inlining the same scene
lookup in two places. It stayed; the code-reading assert above covers the
intent the gate was after.

## 5. Second deviation: the CLI's `--read`

The slice brief's KEEP list names `agent_tools/led_gamma_push.cjs`. Keeping the FILE is
not the same as keeping its pull leg, and "delete the PULL side across the
stack" plus the G-pull zero-hit gate both point the same way, so `--read` and
the service's `readGamma` went. The flag now **refuses loudly** rather than
being silently unrecognised — an unrecognised `--read` would have fallen
through to pushing the default curve, which is exactly the kind of silent
surprise the codex forbids.

## 6. Untouched, as instructed

Scene YAML (`controllerGamma:`, `lastGammaPush:` blocks), `src/dmx/led_wire.js`,
the preview `controllerGamma` values, and `style.css .led-push-*`. No
migration was added to `controller_registry.js` (`_363` §1.2's
drop-with-log migration was for the total-removal plan and is now **wrong** —
the keys are still live).

## 7. Documents that must be corrected next

- **`_363` §1** — describes a total gamma removal that did NOT happen. It must
  be marked superseded by the rulings in §1 above: UI stays (disabled), push
  stays (dormant), only pull dies. Its §1.1 deletion table, §1.2 surgical
  edits (registry migration, CSS sweep, scene YAML sweep, doc strips) and
  gates G1/G2/G3/G6 no longer describe reality.
- **`_363` §11** — "the deferred optional gamma PUSH" says *"no helpers are
  kept — the simplest current tree wins"*. False now: the whole push path,
  service, route and CLI are kept dormant, so §11 shrinks to "flip the UI back
  on and decide where the curve comes from". Its one still-correct sentence is
  **"NO pull, NO cache, NO fleet source selection — those stay dead
  permanently"**, which this slice enforced.
- **The upcoming S4 doc slice** — `docs/41_led_controller_onboarding.md` and
  `docs/MARSINLED_API.md` must say: gamma is operator-manual on the
  controller's own web UI for now; the sim's gamma section renders disabled;
  `GET /led/gamma` is **removed** (drop that proxy-route section);
  `POST /led/gamma-push` **remains** (dormant, not removed); the CLI is
  push-only and `--read` is gone.

## 8. Open questions for the operator

1. When gamma push is re-enabled, where does the **fleet** curve come from now
   that source-selection is deleted — one operator-typed curve in the dialog,
   or per-card push only? (Per-card only is the smaller re-enable.)
2. The disabled section still shows the per-card **scene mirror** curve and
   the ghost of the last verified push. Keep that (it explains the preview),
   or collapse the section to a single line while it is parked?
