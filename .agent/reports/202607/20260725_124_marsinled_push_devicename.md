# `_124` — MarsinLED push rejected on `deviceName` (root cause + fix + live landing)

Debugger thread, live operator bug, 2026-08-03. Branch `feat/bm_readiness`.
Subsystem: `simulation/` LED controller push (docs/41). **No git operations.**

---

## 1. The bug as reported

Pushing per-output universes to LED card **`LeftLeftRopes`** (`10.x.x.60`) failed:

```text
✋ per-output push failed: [MarsinLED] 10.x.x.60 rejected config: config apply failed
   (field=deviceName) — 1-32 chars, letters/digits/-._ only
   [deviceName: 1-32 chars, letters/digits/-._ only] (field=deviceName)
```

The paradox the operator flagged: the confirm dialog's payload preview contains
**only** `strands` (4 entries — 3 enabled `WS281X_RGBW` on U30/U31/U42, one
disabled) and `dmx {enabled, protocol, timeoutMs}`. **No `deviceName` anywhere.**
Yet the device rejects on `deviceName`. Its own web UI at `http://10.x.x.60/#config`
works fine.

## 2. Hypotheses, and what the evidence said

| # | Hypothesis | Verdict |
|---|---|---|
| 1 | The push code sends MORE than the preview (a merged/undefined `deviceName`) | **REFUTED** |
| 2 | The sim sends a differently-shaped name (spaces / `""` / `null`) | **REFUTED** |
| 3 | The FIRMWARE re-validates the whole stored config on apply, and the device's own stored `deviceName` is invalid | **CONFIRMED** |

**H1/H2 refuted by code.** The per-output push body is built in exactly one
place, `pushPerOutputUniverses` (`simulation/src/dmx/led/marsinled_client.js`,
now `:829`), as `{strands, dmx}` and nothing else; it reaches the wire through
`postConfigBody` (now `:532`) which serializes that object verbatim. The
transport's `DENIED_PUSH_KEYS` (now `:103`) has listed `deviceName` since the
integration shipped. The preview in the confirm dialog
(`simulation/src/gui/led_discovery_panel.js:1643`) is built from the same two
keys. There was no hidden merge.
(Line numbers are post-fix; the pre-fix file had the same three sites, shifted
up by the ~90 lines this wave added.)

**H3 confirmed on the live device.** Two read-only/no-op probes:

```console
$ curl http://10.x.x.60/api/config
{"strands":[…], "deviceName":"", "controllerId":"testbench", "boardType":"angio4-new", …}
                 ^^^^^^^^^^^^^^^^^ stored EMPTY

$ curl -X POST -H 'Content-Type: text/plain;charset=UTF-8' \
       --data '{"gamma":{"r":1.0,"g":1.0,"b":1.0,"w":1.0}}' http://10.x.x.60/api/config
HTTP/1.1 400 Bad Request
{"status":"error","error":"config apply failed",
 "fields":[{"field":"deviceName","detail":"1-32 chars, letters/digits/-._ only"}],
 "field":"deviceName","detail":"1-32 chars, letters/digits/-._ only"}
```

That second call is a **no-op gamma write** — it POSTs the exact `{r:1,g:1,b:1,w:1}`
the board already held, touching nothing — and it earns the identical
`field=deviceName` 400.

### Root cause

`ConfigManager::update` merges the partial body into the **stored** config and
validates the **whole merged document**. The `10.x.x.60` board stores
`deviceName: ""`, which fails its own `1-32 chars, letters/digits/-._ only`
rule. Therefore **every** `POST /api/config` to that board fails, whatever the
body contains. The push was never the problem; the board was unwritable.

Why the device's web UI still "works": its config page reads fine and its form
submits a full document including a name field the operator fills in — it is the
one client that always sends a `deviceName`.

## 3. The fix

Principle applied: **the push may repair a name that makes the device
unwritable, but it may never invent or mangle one.** On such a board, *not*
writing `deviceName` is not "leave the device alone", it is "no config can ever
be written again" — so leaving it alone is not the conservative choice.

**`simulation/src/dmx/led/marsinled_client.js`**

- `DEVICE_NAME_RE` / `DEVICE_NAME_RULE_TEXT` — the firmware rule, mirrored
  client-side (the previously-dead `DEVICE_NAME_MAX = 32` now feeds it).
- `isValidDeviceName(name)`.
- `deviceNameRepairForPush({ip, storedName, controllerName})` — **pure**, the
  payload-construction seam:
  - stored name **valid** → `null`; the push writes no `deviceName` (a working
    device is never renamed);
  - stored name **absent** from `GET /api/config` → `null`; a firmware that does
    not report the field gets no invented one;
  - stored name **present and invalid** → `{from, to, message}` with
    `to = controllerName` **verbatim**;
  - stored name invalid and the card name unusable (spaces, >32, empty, missing)
    → **THROWS**, naming the rename: *"'Left Left Ropes' is not a legal device
    name either (1-32 chars, letters/digits/-._ only — no spaces). RENAME THE
    CONTROLLER CARD … or set the device name once in the device's own web UI."*
    There is no sanitizer and no fallback.
- `pushPerOutputUniverses` calls it after its `GET /api/config` and adds
  `body.deviceName` only when a repair is returned. A refusal happens **before**
  the POST, so the device is never written on a bad name.
- `DENIED_PUSH_KEYS` keeps `deviceName`; the comment now records the one
  declared exception. `pushConfig` and every other path still refuse the key.

**`simulation/src/dmx/led/device_config_mapper.js`** — `derivePerOutputPlan`
returns `controllerName: controller.name`, so the plan carries the card's name
to the transport (the plan is already the one object every consumer past the
derive receives).

**`simulation/src/gui/led_discovery_panel.js`** — `startPerOutputPush` runs the
same pure decision against the snapshot it already holds, so:
- an unusable name is a **loud refusal toast + drift chip before the confirm
  dialog opens** — the operator never confirms a write that cannot land;
- a repair is added to the **payload preview** (the preview must show every key
  the POST carries) and declared in its own dialog block: *"⚠ This push also
  sets the device's NAME to 'LeftLeftRopes'"*, explaining that the board's stored
  name is rejected by its own firmware and that the card's name is written
  verbatim and becomes the mDNS/AP name.

**`docs/41_led_controller_onboarding.md`** — new **§4.1.1** records the firmware
behaviour, the no-op-gamma proof, and the repair contract.

### Regression test (no device needed)

`simulation/tests/per_output_push.test.js`, section `_124` — 8 cases at the
payload-construction seam: the charset rule; valid stored name left alone;
absent field never invented; `""` repaired with the card name; an unusable card
name failing loud with the rename instruction (and the >32 and missing-name
variants); `derivePerOutputPlan` carrying `controllerName`; and three transport
cases against a mocked device — `""` → body carries `deviceName` verbatim with
`strands`/`dmx` untouched, valid stored name → **no** `deviceName` key in the
body, unusable name → **zero POSTs**.

`node --test tests/per_output_push.test.js` → **79 pass / 0 fail**.
Full sim `npm test` → **1696 tests, 1688 pass, 8 fail** — the 8 are the
pre-existing scene-content baseline in the operator's working tree
(`strand_metadata_drift @ 'TE Sign V3 A'/'B'`, titanic view-bit headroom,
scene-block CLI), all untouched by this wave and none in the LED push path.

## 4. Live landing (device layer confirmed)

Ran the **real fixed client** (`pushPerOutputUniverses` → `awaitReboot` →
`readPerOutput`) against the live board from a scratch script, with the plan the
`LeftLeftRopes` card derives — P1 → output 1 U30, P2 → output 2 U31, output 3
enabled with no port row → **parked** U42, i.e. exactly the three universes the
operator's own confirm dialog displayed:

```text
BEFORE deviceName= ""  dmx= {"enabled":false,"protocol":0,"timeoutMs":3000}
BEFORE strands= 0:on U-  1:on U-  2:on U-  3:off U-
WRITE reply= {"status":"ok","outcome":"needs-reboot","reboot":true,
              "message":"Config saved — device is rebooting to apply changes"}
…reboot…
READ-BACK perOutput= [{"index":0,"universe":30,"startAddress":1,"enabled":true},
                      {"index":1,"universe":31,"startAddress":1,"enabled":true},
                      {"index":2,"universe":42,"startAddress":1,"enabled":true}]
AFTER deviceName= "LeftLeftRopes"  dmx= {"enabled":true,"protocol":0,"timeoutMs":3000}
AFTER strands= 0:on U30 start1 40px  1:on U31 start1 40px
               2:on U42 start1 40px  3:off U- start- 40px
```

**The push that failed all afternoon now lands.** The board's sACN receiver is
enabled, each enabled output listens on its own universe at start address 1, the
parked output 3 sits on U42 receiving nothing (dark by `dmx.timeoutMs`), and
output 4 was **not** touched — nothing was ever disabled. The device is now
named `LeftLeftRopes`, so every subsequent write to it (including gamma pushes)
works normally.

### What the script deliberately did NOT do

It is the device layer only. The sim-side layers were already correct on disk —
`scenes/titanic/controllers.yaml` carries the card with P1→output 1 U30 and
P2→output 2 U31, and `patches.yaml` already carries its `controllerIp` records —
so nothing was stale there. Two notes for the operator's own next push:

- the **park (U42) is not yet persisted** on the card as `parkedOutputs`; only
  the UI push writes that through `ctx.mutate`. The derive is deterministic, so
  a re-push picks U42 again and the sync chip reads in-sync; the operator's next
  ⬆ Push persists it for good.
- the UI push additionally runs the scene save + bridge `setScene` notify
  (docs/41 §4.5). Re-running it from the pane is therefore still worth doing —
  and is now an ordinary, idempotent push.

## 5. Follow-ups

- **The gamma push path has the same exposure.** `simulation/server/led_gamma_service.cjs`
  POSTs `{gamma}` and would hit the identical 400 on any board with an invalid
  stored `deviceName` (that is literally the probe used above). It is unblocked
  for `10.x.x.60` now that the name is repaired, but a fresh board out of the
  box would fail there with the same misleading message. Worth teaching that
  service the same repair (or at least the same diagnosis in its error text).
- **Discovery could surface it.** A card bound to a board whose stored
  `deviceName` is invalid is a board that cannot be configured at all; the
  device section could show it as a loud state rather than letting the first
  push discover it.

## 6. Files

| File | Change |
|---|---|
| `simulation/src/dmx/led/marsinled_client.js` | `DEVICE_NAME_RE`, `isValidDeviceName`, `deviceNameRepairForPush`, repair wired into `pushPerOutputUniverses`, `DENIED_PUSH_KEYS` comment |
| `simulation/src/dmx/led/device_config_mapper.js` | `derivePerOutputPlan` returns `controllerName` |
| `simulation/src/gui/led_discovery_panel.js` | pre-flight refusal, payload preview, declared repair block in the confirm dialog |
| `simulation/tests/per_output_push.test.js` | `_124` section — 8 regression cases |
| `docs/41_led_controller_onboarding.md` | new §4.1.1 |

Scratch script (not in the source tree): the scratchpad's `live_push_60.mjs`.
