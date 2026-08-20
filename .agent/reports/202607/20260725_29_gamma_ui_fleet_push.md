# 20260725_29 — LED gamma: per-controller UI fields + fleet push

**Date:** 2026-07-28 · **Branch:** `feat/bm_readiness` · **Workstream:** R7
**Operator ask (verbatim):** "I want the gamma curve config to be a config that
I can set for all controllers from the controllers' UI in the simulation, and do
a gamma curve update for all LED controllers at once."

## What shipped

Gamma stopped being an agent CLI errand. It is now an operator control in the
sim's Controllers panel, for one controller or the whole fleet, with the scene
mirror kept honest against the hardware automatically.

### 1. Per-controller gamma fields (LED cards only)

Every LED controller card grows a `gamma` row: four number fields (r / g / b /
w) + **⬆ Push gamma** + a provenance chip. DMX cards are untouched — gamma is an
LED-controller setting.

- The fields ARE the scene mirror (`controllers.yaml` →
  `<controller>.led.wire.controllerGamma`). Editing one runs through the
  editor's normal `mutate()` pipeline, so the change is undoable, marks the
  scene dirty, and the preview follows it (the mirror is the only thing the sim
  preview reads for gamma — no wire byte ever changes).
- **Bounds are 1.0–3.0**, not the 0.5–4.0 floated in the brief: that is the
  range the LED controller accepts AND the range `led_wire.js` already enforced
  on the mirror. Widening the UI would have let the operator type a number that
  the scene loader or the device then rejects — a divergence bug. All three
  agree.
- Bad input is loud and local: the field goes red, an inline message + a toast
  name the channel and the range, and nothing is written. Empty is an error too
  (never a silent "keep the old value").
- The chip shows `✓ hardware 2.2 / 2.2 / 2.2 / 1 · <time>` when the last
  verified hardware curve matches the fields, or `▲ hardware … ≠ mirror — push
  to apply` when the operator has edited without pushing, or `○ never pushed`.

### 2. Push actions

- **Per card: ⬆ Push gamma.**
- **Fleet: ⬆ Push gamma to all** in the LED group header. Sequential, one
  result row per controller, live as it runs: `✓ ok` / `✋ failed` / `⚠
  unreachable` / `– skipped (no valid IP)`, each with the controller's name, IP
  and either the verified curve or the failure text. The summary line counts all
  four states and names the unreachable units. There is no aggregate
  "mostly worked" — a partial fleet is always visible per unit, and one
  controller's failure never aborts the rest.

Every push (single or fleet) runs the identical discipline the CLI tool ran:

1. `GET /api/status` (identity) + `GET /api/config` (full config)
2. timestamped backup of the FULL config →
   `~/tmp/led_controller_configs_backup/<ip>_<name>_config_<stamp>.json`
3. `POST /api/config` with a **partial** body carrying only `{ gamma }`
4. honour the reply — `applied` (no reboot, what the hardware does today) or
   `needs-reboot` (wait it out, then verify)
5. `GET /api/config` read-back; a mismatch is a hard failure

Only after step 5 succeeds does the sim write the **hardware-verified** values
into the mirror and stamp `device.lastGammaPush {at, outcome, gamma,
firmwareSHA}`. On any failure the mirror is left exactly as it was and the UI
names the controller and the reason. A controller that was written and verified
but whose scene record could not be updated (e.g. it was deleted mid-push) is
reported as a FAILURE with that exact wording — never as success.

### 3. Server-side transport

The browser never talks to a controller directly. New save-server routes:

- `POST /led/gamma-push` `{ip, gamma}` → `{ok:true, verified, outcome, reboot,
  before, backupPath, controllerId, deviceName, boardId, firmwareSHA, changed}`;
  `400 {ok:false, kind:'invalid'}` for a bad curve, `502 {ok:false,
  kind:'unreachable'|'rejected'|'verify-mismatch'}` otherwise.
- `GET /led/gamma?ip=…` → read-only identity + current curve.

One controller per request; the fleet loop lives in the browser so each unit
gets its own result and the UI can stream progress.

### 4. One implementation, two front ends

The whole discipline lives in `simulation/server/led_gamma_service.cjs`. The
save-server route and `simulation/agent_tools/led_gamma_push.cjs` both call it —
the CLI is now argument parsing + printing only, so UI and CLI cannot drift.

Float32 note: the controller stores exponents as float32, so a written `2.2`
reads back as `2.200000048`. Verification is epsilon-based (1e-3) and the
read-back is rounded to 4 dp before it reaches the mirror, so a push never
rewrites `controllers.yaml` with representation noise.

## Files

| File | Change |
|---|---|
| `simulation/server/led_gamma_service.cjs` | **new** — shared backup → write → verify service (`pushGamma`, `readGamma`, validation, backup dir, float32 rounding); errors carry `.kind` |
| `simulation/server/save-server.js` | **new routes** `POST /led/gamma-push`, `GET /led/gamma` |
| `simulation/agent_tools/led_gamma_push.cjs` | rewritten as a thin CLI over the service (same flags, same behaviour) |
| `simulation/src/dmx/led/led_gamma.js` | **new** — mirror read/write/validation, `commitGammaPush`, DOM-free `pushGammaToController` / `pushGammaFleet`, default transport through the save-server |
| `simulation/src/gui/led_gamma_ui.js` | **new** — the card gamma row + the fleet-push modal with per-controller result rows |
| `simulation/src/gui/controller_map_editor.js` | renders the gamma row on LED cards; "⬆ Push gamma to all" in the LED group header |
| `simulation/src/dmx/controller_registry.js` | `device.lastGammaPush` schema (validated with the same rules as the mirror) + `recordDeviceGammaPush`; preserved across re-binds |
| `simulation/style.css` | gamma row, push buttons, per-controller result-row states |
| `simulation/tests/led_gamma.test.js` | **new**, 20 tests |
| `docs/41_led_controller_onboarding.md` | §4.1(d): the `gamma{}` config, its live-apply semantics, float32 read-back, and the UI/CLI entry points |

## Verification

**Sim suite: 591/591 pass, 0 failures** (571 baseline + 20 new). The new tests
cover: range/key/channel validation, field parsing (empty / non-numeric /
out-of-range), mirror writes preserving the other wire keys, `lastGammaPush`
round-tripping through the registry validator (and hard-stopping on a malformed
stamp), commit binding an unbound card from the verified identity, unreachable
and mismatch pushes leaving the mirror untouched, and the fleet loop reporting
every controller in order with one failure not aborting the rest.

**Live, against the bench LED controller (operator-sanctioned),
through the real save-server route:**

```
GET  /led/gamma          → gamma {r:2.200000048, g:2.200000048, b:2.200000048, w:1}
POST /led/gamma-push  g 2.2 → 2.3
   💾 full config backed up → ~/tmp/led_controller_configs_backup/…_2026-07-28T22-25-31-456Z.json
   reply: {"status":"ok","outcome":"applied","reboot":false}
   ✅ verified on hardware: {r:2.200000048, g:2.299999952, b:2.200000048, w:1}
   → response verified {r:2.2, g:2.3, b:2.2, w:1}, changed:true
POST /led/gamma-push  RESTORE g 2.2 → verified {r:2.2,g:2.2,b:2.2,w:1} (applied)
invalid curve (r:9)      → 400 {kind:"invalid", error:"gamma.r 9 must be a number in 1–3 …"}
offline address        → 502 {kind:"unreachable", error:"… did not answer within 10000 ms"}
FINAL hardware state     → {r:2.200000048, g:2.200000048, b:2.200000048, w:1}   ← restored exactly
```

Gamma applied **without a reboot**, as it did in the manual push earlier today;
the `needs-reboot` branch is implemented and waits + re-verifies if a future
build asks for one.

**Full browser → sim server → hardware chain, from the UI:** the fleet push was
run from the sim page (scratch save-server on 6979 so the operator's live stack
was never touched) — `done — 1 ok · 0 failed · 0 unreachable · 0 skipped`, row
`✓ ok Titanic_202 (bench) — 2.2 / 2.2 / 2.2 / 1 → 2.2 / 2.2 / 2.2 / 1
(applied)`, and the card then rendered `✓ hardware 2.2 / 2.2 / 2.2 / 1 ·
7/28/2026, 3:27:51 PM`. Nothing was saved to disk from that session.

**Screenshots** (visually inspected): `~/tmp/gamma_ui/`
`01_controllers_panel.png`, `02_led_card_gamma_fields.png`,
`03_fleet_modal_before.png`, `04_fleet_results.png`,
`05_led_card_after_push.png`, `06_panel_after_push.png`.

**Environment care:** the operator's sim (:6969) and save-server (:6970) were
running throughout and were never killed, restarted, or written to. Both probe
servers ran on a scratch port and were shut down; ports are clean.

## Operator note (one-time)

Browser code is served from source, so the gamma fields appear on a page
reload. **The save-server is a Node process — it must be restarted (`cd
simulation && npm start`) before `⬆ Push gamma` works**, otherwise the push
reports a 404 from the sim server.

## Follow-ups

- Only one controller was online, so the fleet path's multi-unit ordering is
  proved by unit test, not on metal. Re-run the fleet push once more units are
  up — the "unreachable, named" path is already live-proved against an offline
  address.
- The mirror↔hardware drift chip is computed from the last verified push. A
  controller changed by someone else (its own web UI) shows drift only after the
  next read; a periodic reconcile could use `GET /led/gamma`, but no polling
  loop was added on purpose.
