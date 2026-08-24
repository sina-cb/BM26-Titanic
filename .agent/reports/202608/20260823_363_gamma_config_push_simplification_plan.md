# 363 — Push simplification: narrowed config push, DMX toggle, gamma removal, MOCK + HIL

Fable planning output. **Nothing implemented, nothing run, no code changed.**
An Opus agent implements from this plan verbatim; a second Opus agent
validates against it. Direct continuation of `_362` (forced config push —
implemented, validated PASS, including the D1 fix: darkened outputs shed
`dmxUniverse`/`dmxStartAddress`; and D2: a missing/unknown write `outcome`
is a hard failure). Controllers are named by `controllerId`; IPs appear as
last octet only.

**Operator rulings this plan implements, in the order they arrived (later
rulings supersede earlier ones where they conflict; the plan below is the
reconciled END STATE):**

1. "Continue simplifying the gamma and config pushes, but reliable and well
   tested HIL and MOCK."
2. HIL targets are `ss_right_right` (`.65`) and `ss_right_left` (`.66`)
   ONLY, both attached to this machine over serial (privileged serial access
   granted); `.61`/`.62` are STRICTLY off-limits to all tooling and tests
   (operator is testing them manually). Writes + restore on `.65`/`.66` are
   authorized; restore verification is part of PASS.
3. Design against the firmware's actual behavior (private firmware /
   deployment repo reviewed as the authoritative source) — with a hard
   confidentiality boundary: NO private-repo content, paths, or structure in
   this public repo; firmware behavior stated generically only.
4. `docs/MARSINLED_API.md` is the BM26-side contract reference — pin designs
   against it, record divergences, and update THAT doc (allowed, it lives
   here).
5. NEW: a per-card DMX ON/OFF control — "use the API to do that simply. No
   hassle, please simple process."
6. NARROWING: "I just want config pushes: the number of LED strands,
   universes for DMX, and enabling DMX. The mirror I think might rely on
   this push too." — the push forces ONLY counts+enables, per-output
   universes, and `dmx.enabled: true`; strand type/colorOrder are NOT
   pushed; **swarm is NOT touched by the push** (the earlier
   `swarm.enabled:false` write is withdrawn along with `_362`'s Q1).
7. FINAL: "no gamma push, no gamma pull, no SWARM switch." — gamma leaves
   the sim entirely (both directions); zero swarm-switching surface (already
   removed today — grep-gated re-confirmation only).
8. REFINEMENT: "gamma push is an optional next step, when config is
   confirmed." — nothing gamma ships in this wave; §11 specifies the future
   optional gamma-push slice so it can return without re-planning.

**Authoritative-source note (confidentiality boundary).** The firmware
contract statements below were pinned this session against the private
firmware/deployment repo's own specs and source AND against
`docs/MARSINLED_API.md` — not inferred from the sim client. Per operator
instruction, no content, file path, or structure of the private repo is
recorded here or may be embedded in BM26 code by the implementer; anything
machine-specific the HIL tooling needs from the private side arrives via
environment variables or gitignored local files.

---

## 0. End state (what the Controllers panel offers when this lands)

Exactly five things talk to controllers, nothing else:

1. **Discovery / onboarding / probe** — unchanged.
2. **The map editor** — unchanged.
3. **The NARROWED config push** (⬆ Push / ⬆ Push all): counts+enables,
   per-output universes (+ start 1), `dmx.enabled: true`. One snapshot →
   one write → reboot wait → read-back verify of exactly what was pushed →
   per-controller PASS/FAIL. Fail loud, no retries.
4. **The DMX ON/OFF toggle** (new, §3): one button → one `dmx`-block write
   → reboot wait → read-back confirm. No polling, no mode model, no swarm
   coupling.
5. **Whatever the bench mirror needs** (§4): nothing new — the narrowed
   push keeps its dependencies intact.

Gone entirely: every gamma control, route, service, CLI, mirror field and
provenance stamp (§1); every swarm-switching surface (already gone —
re-confirmed by grep gate §1.4-G5).

---

## 1. Gamma removal (total, both directions — the `_362` switch-removal discipline)

The operator does ALL gamma work manually on the controller's own web UI.
The sim neither reads nor writes gamma. No stubs, no orphan imports, routes,
or CSS; grep gates prove it.

### 1.1 Files deleted outright

| File | Why it goes whole |
|---|---|
| `simulation/src/dmx/led/led_gamma.js` | the gamma model: mirror read/write, validation, push/refresh orchestration, TTL cache, fleet source plan — all feature-only |
| `simulation/src/gui/led_gamma_ui.js` | the whole per-card gamma section (sliders, presets, plot, push, manual refresh) + the fleet dialog |
| `simulation/server/led_gamma_service.cjs` | the server-side gamma push/read discipline; only consumers are the two save-server routes and the CLI (both die here) |
| `simulation/agent_tools/led_gamma_push.cjs` | CLI front end for the deleted service |
| `simulation/tests/led_gamma.test.js` | feature tests |
| `simulation/tests/led_gamma_workflow.test.js` | feature tests |
| `simulation/tests/led_gamma_push_devicename.test.js` | feature tests (the §4.1.1 deviceName-repair doctrine itself SURVIVES — it lives in `marsinled_client.js` (`deviceNameRepairForPush`) and is exercised by the config-push/toggle suites) |

### 1.2 Surgical edits

**`simulation/server/save-server.js`** — delete the require
(`const ledGamma = require('./led_gamma_service.cjs');`, line ≈15), the
`GET /led/gamma` route (≈935–952), the `POST /led/gamma-push` route
(≈953–985), and reword the header comment (≈93) that lists "gamma" among
the server's jobs.

**`simulation/src/gui/controller_map_editor.js`** — delete the imports
`renderGammaSection` / `startFleetGammaPush` (lines ≈83–84), the
"⬆ Push gamma to all" button and its handler (≈1409 and the button's
creation), and the per-card mount (`renderGammaSection(...)` ≈1701 with its
append).

**`simulation/src/dmx/controller_registry.js`** — delete
`recordDeviceGammaPush` and every `lastGammaPush` normalize/validate line.
Add a **drop-with-log migration** (the parking-migration precedent): on
scene load, if a controller carries `device.lastGammaPush` or
`led.wire.controllerGamma`, delete the key(s) and `console.log` once per
card: `gamma is retired from the sim — dropped <key>; gamma is managed on
the controller's own UI`.

**`simulation/style.css`** — delete every rule whose selector contains
`.cm-led-gamma` or `.led-gamma-` (whole rules, comments included).
**Do NOT touch `.led-push-*`** — those classes are shared by the config
push dialog.

**Scene YAML** — remove the `controllerGamma:` blocks and `lastGammaPush:`
blocks from every `scenes/*/controllers.yaml` that carries them (at
minimum: `test_bench`, `titanic`, `titanic_interior`; sweep all scenes).
The loader migration covers any copy that survives elsewhere.

**`simulation/src/dmx/led_wire.js` — deliberately UNTOUCHED.** The wire
model keeps its `controllerGamma` handling with its documented default
(`LED_CONTROLLER_GAMMA` = 1.0 linear on every channel). That is the sim
PREVIEW's screen-response constant, not a device feature: the sACN mapper
emits linear bytes regardless, so nothing on the wire changes. With the
YAML fields dropped, every card's preview normalizes to the 1.0 default —
which is what the `titanic` cards already declare today, so the show
scene's preview is unchanged (`test_bench`'s card carried 2.2; its preview
shifts to linear — cosmetic, preview-only). Removing the override
acceptance from `led_wire.js` and its preview consumers would be churn with
zero operator value; the grep gates below therefore scope "gamma" to the
FEATURE symbols, not to the preview constant. Cosmetic sweep: the
`lib/bench_mirror_resolve.cjs` warning string mentioning "gamma / amber
folding" (≈405) may be reworded to "led.wire colour-fidelity settings" —
optional, behavior identical.

**Docs** — `docs/41_led_controller_onboarding.md`: §4.1(d) and every gamma
push/UI/CLI paragraph rewritten to: gamma is operator-manual on the
controller's own UI; the sim neither reads nor writes it; the preview
models a fixed linear response. `docs/MARSINLED_API.md`: remove the
`GET /led/gamma` and `POST /led/gamma-push` proxy-route sections; in the
config-blocks list annotate `gamma` as "present in the device config; not
consumed or written by this repository".

### 1.3 What deliberately survives

- `deviceNameRepairForPush` + its doctrine (docs/41 §4.1.1) — the config
  push and the DMX toggle still need it (an invalid stored name rejects
  EVERY write).
- `led_wire.js` and all preview-side colour modeling (§1.2 note).
- The `~/tmp/led_controller_configs_backup/` directory contents (history;
  nothing new is written there by the sim once the service is gone — the
  HIL runner writes its own snapshots there, §6).

### 1.4 S1 gates (no stubs, no orphans)

- **G1**: `grep -rn "led_gamma\|ledGamma\|gamma-push\|/led/gamma\|lastGammaPush\|recordDeviceGammaPush\|renderGammaSection\|startFleetGammaPush\|pushGammaFleet\|readGammaMirror\|setGammaMirror" simulation/` → **zero** matches.
- **G2**: `grep -rn "cm-led-gamma\|led-gamma-" simulation/` → **zero**.
- **G3**: `grep -rn "controllerGamma\|gamma" simulation/scenes/` → **zero**
  (scene YAML fully cleaned).
- **G4**: `node --check` on `save-server.js`, `controller_map_editor.js`,
  `controller_registry.js`; targeted suites green
  (`controller_registry.test.js` gains ONE migration test: a yaml carrying
  both retired keys loads, drops them, logs once per card;
  `led_controller_ui_round2.test.js` / `theme_parity` lose their gamma
  assertions).
- **G5 (swarm re-confirmation, no new work)**:
  `grep -rin "smokestack\|smk-\|swarm" simulation/src simulation/server simulation/tests` →
  swarm hits ONLY in `marsinled_client.js`/`led_discovery_panel.js`
  comments describing what the push does NOT touch (§2), plus the §1.3
  survivors' comments — no control surface, no route, no model. (The
  `_362` §1.4 greps for `smk-`/smokestack code stay at zero.)
- **G6**: browser smoke after launcher bounce + reload: LED cards render
  with NO gamma row, console clean, `GET /led/gamma?ip=…` and
  `POST /led/gamma-push` answer **404**.

Rollback: pure deletion of a self-contained feature; operator restores from
git history if ever wanted (and §11 is the sanctioned way gamma PUSH
returns).

---

## 2. The NARROWED config push (supersedes `_362` §2.1's body where they differ)

### 2.1 The body — one snapshot, one write, three forced things

Per push target, ONE `POST /api/config` body built by
`buildForcedConfigBody({ snapshot, plan, ip })` (PURE; the confirm dialog's
payload preview IS this object):

```json
{
  "strands":    [ /* FULL array: read-modify-write per entry, see below */ ],
  "dmx":        { /* the board's own saved dmx object */ "enabled": true, "protocol": 0 },
  "deviceName": "<card name — ONLY under the unchanged §4.1.1 repair>"
}
```

- `strands[i]` = `{ ...snapshot.strands[i] }` with ONLY these keys forced:
  - plan assigns output i → `enabled: true`, `count: <mapped px>`,
    `dmxUniverse: <port universe>`, `dmxStartAddress: 1`;
  - plan does not assign output i → `enabled: false`, and `dmxUniverse` /
    `dmxStartAddress` are DELETED from the entry (D1 — the firmware's
    all-or-none per-output rule 400s on a disabled strand carrying a
    universe).
  Everything else in the entry — `type`, `colorOrder`, `rgbwMode`, pins,
  dead-pixel fields, any future key — passes through UNTOUCHED from the
  snapshot. **Strand type and color order are explicitly NOT pushed** (the
  operator manages chip type / color order manually on the controller).
- `dmx` = `{ ...snapshot.dmx, enabled: true, protocol: 0 }`. `enabled` is
  ruling 6's third forced thing; `protocol: 0` is forced because the
  per-output universes being written are **sACN-only by firmware rule**
  (docs/41 §3.5) — a body that stated ArtNet alongside per-output universes
  would be incoherent. `timeoutMs` and any other `dmx` key are PRESERVED
  from the board. The `snapshot.dmx` object must exist (every MarsinLED
  config carries it); a snapshot without it throws loudly — never invent
  the block. `FORCED_DMX_BLOCK` (the `_362` frozen export) is DELETED with
  its tests; the merge rule above replaces it.
- **NO `swarm` key, ever** (ruling 6/7; `_362`'s Q1 is WITHDRAWN). The push
  neither reads nor writes swarm; the board's swarm config survives
  byte-for-byte because it is simply never mentioned.
- **NO `gamma` key** (ruling 7; see §11 for the deferred return).
- `deviceName` — unchanged §4.1.1 repair (verbatim card name or loud
  refusal before the POST).

Firmware contract for this body (pinned at source + `MARSINLED_API.md`):
the firmware merges the partial body into the stored config and validates
the WHOLE merged document; strand-field and `dmx`-block changes are
reboot-to-apply (`{outcome:"needs-reboot", reboot:true}`, ~11 s); an
identical body changes nothing and answers `{outcome:"applied"}`; a
validation failure answers 400 with `field`/`detail`/`fields`; **a POST
during an active staged-network-config confirm window answers 409** — an
answered non-2xx, i.e. a definite loud failure under the existing D2 rule
(this 409 case is a doc finding — §2.4).

### 2.2 The narrowed verify (`diffForcedConfig`) — verify exactly what was pushed

After `awaitReboot`: `getConfig` + `getStatus`, then assert:

1. every index of the pushed `strands` array: `enabled` matches; on enabled
   outputs `count`, `dmxUniverse`, `dmxStartAddress === 1` match; on
   disabled outputs `enabled === false` AND no integer `dmxUniverse`
   remains in the read-back (D1 proven on the device);
2. `config.dmx.enabled === true` and `config.dmx.protocol === 0`;
3. runtime: `status.sacn.enabled === true`; `dmxOwnsOutput === true` only
   when the firmware reports the field (absent ≠ agreement);
4. identity: `status.controllerId` equals the pre-push identity.

**NOT asserted — narrowed by ruling 6.2**: strand `type` / `colorOrder` /
pins (not pushed, not judged), `dmx.timeoutMs` (preserved, not forced),
`swarm.*` (untouched), `gamma` (gone). ONE informational (non-failing) note
is surfaced in the outcome line when the read-back reports
`swarm.enabled === true`: `ℹ board also reports SWARM enabled — swarm is
operator-managed; the sim does not touch it`. Mismatches keep the
`err.perOutputMismatch` shape. `recordDevicePush` keeps hashing the FULL
posted body.

### 2.3 Config-push follow-through (small hardenings that ride along)

1. **Pre-write identity gate** (closes `MARSINLED_API.md` "Known
   integration gaps" item 1): in `startPush`, after the snapshot reads and
   BEFORE the dialog — if the card is bound
   (`controller.device.controllerId`) and the live `status.controllerId`
   differs, refuse loudly naming both ids. Push-all applies the same gate
   per controller inside its loop (that board FAILs, the loop continues).
2. **Warning copy** — `FORCE_PUSH_WARNING` / `FORCE_PUSH_ALL_WARNING`
   rewritten to the narrowed truth (binding copy):

   > ⚠ FORCE push — the sim panel is the source of truth for the mapping.
   > This overwrites the board's strand counts, enables and per-output DMX
   > universes: outputs P-mapped here are enabled with the mapped counts
   > and universes, every other output is DISABLED, and DMX input (sACN) is
   > switched ON. Strand type, color order, swarm and gamma settings are
   > NOT touched. The device reboots (~11 s); the push waits up to 45 s and
   > reads the config back before calling it done.

   (Pluralized for push-all, as today.)
3. **Sync chip** (`computeSyncState`): keeps the full-array mapping compare
   and the `snapshot.dmx.enabled !== true` drift clause ("push will force
   DMX ON"); the `_362` `swarm.enabled === true → drift` clause is REMOVED
   (the push no longer changes swarm — a swarm-enabled board with a correct
   mapping and DMX on is In sync). Zero new reads.
4. **Display caches kept** (`syncCache`, `liveMacCache`,
   `deviceOutputsCache`): display-only, scene-scoped, populated only by
   reads the panel already performs. Not the gamma-TTL pattern; deleting
   them would force MORE device reads.
5. D2 (non-`applied`/`needs-reboot` outcome = hard failure quoting the
   device), the one-read-per-attempt rule, `writeResponseLost`
   arbitration, three-phase budgets (write 12 s / reboot 45 s / poll 1 s),
   G8 liveness, sequential push-all with per-board progress + results
   table, ONE save+notify+route-readback after the last controller: **all
   unchanged from `_362`** — do not touch.

### 2.4 `docs/MARSINLED_API.md` — divergences found and doc updates (this doc lives in BM26; updating it is wanted)

| # | Finding (pinned at firmware source) | Doc action |
|---|---|---|
| 1 | POST `/api/config` during an active staged-config window answers **409** (doc lists only 400) | add the 409 case to "Configuration writes" |
| 2 | The validation-failure `error` string is `config apply failed` (doc example says `validation failed`); success replies carry `status`,`outcome`,`reboot`,`message` | align the examples; pin the success shape |
| 3 | Gamma changes are live-apply (no reboot); `dmx`-block changes are reboot-to-apply | one sentence each (the toggle section relies on the latter) |
| 4 | "Required write sequence" item 4 (re-read immediately before POST) **conflicts with the landed one-read rule** (`_362` §2.3-3: the preview and the POST are the same object built from ONE snapshot; a pre-POST re-read reopens the drift window) | rewrite the sequence to the one-snapshot contract; note the stale-dialog risk is accepted and covered by the full read-back verify + identity asserts |
| 5 | "Force-to-DMX payload" section still shows the `swarm` write and full-force semantics | rewrite to the §2.1 narrowed body (no swarm, no type/colorOrder, dmx merge rule) |
| 6 | Known-gaps list: item 1 closes (§2.3-1); item 3 is resolved by RULING (type/colorOrder/swarm deliberately un-verified — rewrite the gap as a documented design decision, keeping the D1 read-back assert); items 4 (mixed known/unknown chains) and 5 (fleet save after partial failure) remain OPEN — keep them listed | update the list |
| 7 | Gamma proxy routes removed (§1.2); DMX toggle added as a new consumer of POST `/api/config` | remove / add sections |
| 8 | Endpoint summary confirms there is **no lighter endpoint than POST `/api/config` for `dmx.enabled`** (verified at source too) | note under the toggle section |

---

## 3. The DMX ON/OFF toggle (the anti-switch)

**Operator request:** *"I can switch the DMX off and on easily [from the
controller's own UI]. I expect the sim controller to use the API to do that
simply. No hassle, please simple process."*

**Contract** (source + doc, §2.4-8): DMX on/off is a field of the `dmx`
block of `/api/config`; there is no lighter runtime endpoint. Any `dmx`
change is reboot-to-apply; writing the held value answers `applied` with no
reboot (idempotent). The §4.1.1 deviceName quirk applies. After the reboot,
`status.sacn.enabled` mirrors the saved flag.

**Design — one button, one write, one read-back, zero machinery:**

- `marsinled_client.js`, NEW (names binding):
  - `buildDmxToggleBody({ snapshot, enabled, controllerName, ip })` — PURE.
    `{ dmx: { ...snapshot.dmx, enabled } }` (full stored `dmx` object,
    only `enabled` flipped — the same sidestep-partial-merge rule as the
    push) + `deviceName` only per `deviceNameRepairForPush`. Throws when
    `snapshot.dmx` is missing/non-object — never invent the block.
  - `diffDmxToggle(verifyConfig, verifyStatus, enabled, expected)` — PURE.
    Mismatches for `config.dmx.enabled !== enabled`,
    `status.sacn.enabled !== enabled`, identity vs `expected.controllerId`.
    Nothing else — the toggle claims nothing about strands/swarm.
  - `pushDmxToggle(ip, body, {writeTimeoutMs})` — transport-only mirror of
    `pushForcedConfig` (validates only `body.dmx`; no internal GET; same
    `writeResponseLost` semantics and D2 outcome rule).
- `led_discovery_panel.js`: a small `DMX ⏻` control on each LED card next
  to ⬆ Push, labeled from last-confirmed state (`DMX: on` / `DMX: off` /
  `DMX: ?` before anything was observed). NO confirm dialog (operator: no
  hassle); tooltip: "writes the board's DMX flag and reboots it (~11 s)".
  Flow `toggleDmx(ctx, controller, targetEnabled, io)`: pre-write identity
  gate (§2.3-1) → one `getConfig`+`getStatus` → `buildDmxToggleBody` →
  `pushDmxToggle` → on `needs-reboot`/lost reply `awaitReboot` with phase
  text on the button (`writing… / rebooting… / verifying…`) →
  `getConfig`+`getStatus` → `diffDmxToggle` → update the label + toast.
  Every failure is a loud toast; the label then shows `?` (the read-back is
  the only truth source). The label is ALSO seeded opportunistically from
  reads that already happen (sync sweep, push verify) — zero new reads, no
  polling, no timer, no cache TTL: a plain last-observation label.
- **Reconciliation:** the push still forces `dmx.enabled:true`; the toggle
  is the manual lever between pushes. A board toggled OFF reads ▲ Drift on
  the sync chip ("push will force DMX ON") — honest and intended.
- **NOT built** (anti-switch checklist): no fleet toggle, no status sweep
  service, no DMX⇄SWARM mode model, no swarm writes, no save-server route
  (browser-direct like the push), no persistence of live mode into the
  scene.

---

## 4. The bench mirror — dependency audit (ruling 6.3)

Surveyed this session (`lib/bench_mirror.cjs`, `lib/bench_mirror_resolve.cjs`,
`gui/bench_mirror_*`, `server/sacn_bridge.js`, `scenes/test_bench/bench_mirror*.yaml`):
the bench mirror is a **bridge-side re-addressing stage** — at ARM time it
resolves universes, addresses and slices FRESH from scene data and emits
composed sACN to the bench controller's universes; while armed it suspends
all ordinary relay. **It never calls the push path and never talks to the
LED controller's HTTP API.**

Its actual dependencies on this plan's surface:

1. **Scene port universes** (the resolve source) — untouched by this plan.
2. **The bench board's own per-output config** matching its scene card
   (universes on the physical board, `dmx.enabled` on) — this is exactly
   what the narrowed push writes; counts+enables+universes+dmx.enabled is
   a superset of nothing and a subset of nothing the mirror needs.
   Type/colorOrder/swarm/gamma are irrelevant to the mirror (bytes are
   linear and identical either way — its own resolve code says so).
3. **Nothing gamma** — G1/G3 greps double as the proof (`bench_mirror*`
   files carry one cosmetic wording hit, §1.2).

Guarantee: the full `bench_mirror*` + bridge suites run in the S-gates
(§7) as a regression fence. **HIL cannot exercise the mirror**: the bench
board (`.60`) is deliberately NOT in the HIL allowlist (ruling 2), and the
mirror's output side is the bridge, not the push path — it stays covered by
its mock suites and the operator's own bench use.

---

## 5. MOCK test design (no test may contact real hardware — ever)

All device I/O through the established fake seams: injected `io` bags
(`per_output_push.test.js` pattern), stubbed transports, documentation-range
/ private fake IPs only (`192.0.2.x`, `10.0.0.x`). `node --test` from
`simulation/`.

**`tests/marsinled_client.test.js`**

- `buildForcedConfigBody` **golden-body test** (narrowed): fixed snapshot +
  plan → `assert.deepEqual` of the WHOLE body — full strands array with
  per-entry pass-through proven (a snapshot entry carrying `type`,
  `colorOrder`, `rgbwMode`, a novel future key → all present verbatim in
  the built entry), forced keys forced, disabled entries stripped of
  universe keys (D1), `dmx` = snapshot's object with `enabled:true`,
  `protocol:0`, `timeoutMs` preserved; **no `swarm` key even when the
  snapshot has one; no `gamma` key even when the snapshot has one**;
  deviceName repair present/absent/refusal cases.
- Refusals: snapshot without `strands[]`; snapshot without a `dmx` object.
- `diffForcedConfig` narrowed: green on exact match; red on wrong
  enable/count/universe/start; red when a DISABLED output's read-back still
  carries an integer `dmxUniverse`; red on `dmx.enabled` false /
  `protocol` ≠ 0 / `sacn.enabled` false / identity change; **green when
  read-back `type`/`colorOrder`/`timeoutMs`/`swarm` differ arbitrarily**
  (narrowing pinned by test); the swarm-enabled informational note is
  produced and is not a mismatch; `dmxOwnsOutput` asserted only when
  present. `FORCED_DMX_BLOCK` no longer exported (grep-style assert).
- Toggle: `buildDmxToggleBody` golden bodies (flip ON, flip OFF,
  protocol/timeoutMs preserved, deviceName repair variant), refusal on
  missing `dmx`; `diffDmxToggle` green/red per clause; `pushDmxToggle`
  transport tests (byte-equal POST, `writeResponseLost` on silence,
  definite failure on answered non-2xx incl. 409, no internal GET).

**`tests/per_output_push.test.js`**

- Re-point `_362`-era body/verify expectations to the narrowed shape
  (delete swarm-write and swarm-verify cases; keep D1/D2, lost-reply
  arbitration, one-read rule, 3-board partial-failure fleet case,
  per-board progress, results model).
- NEW: pre-write identity gate — bound card + live status with a different
  `controllerId` → single push refuses before any POST; in push-all that
  board FAILs and the loop continues.
- NEW: a board in SWARM mode is pushed withOUT refusal, the body carries no
  `swarm` key, and the outcome line carries the informational swarm note.

**`tests/led_controller_ui_round2.test.js`** — dialog copy asserts the new
narrowed warning (including "Strand type, color order, swarm and gamma
settings are NOT touched"); payload preview shows `strands`+`dmx` and NO
`swarm`/`gamma`; gamma dialog assertions deleted (S1).

**Panel / sync suites** — swarm-drift clause removed (SWARM board with
perfect mapping + DMX on → In sync); DMX-off board → drift; toggle label
states (`?`→`on`→`off`), toggle failure → label `?` + toast.

**`tests/controller_registry.test.js`** — the §1.2 drop-with-log migration
test; `lastGammaPush` validation tests deleted.

**Regression fences run as-is**: full `bench_mirror*` suites,
`bridge_route_readback`, `sacn_bridge*`, `shared_address_ui`,
`led_discovery_scene_liveness`, `chained_led_patches`, `led_metadata`,
`theme_parity`.

**NEW `tests/hil_push_check.test.js`** — mock-only tests of the HIL
runner's PURE exports (§6): allowlist refusals (`.60`–`.64`, `.67`+, wrong
id/octet pairing, missing flags), snapshot-derived plan building, restore
body construction (`{strands, dmx}` only), serial-window classifier (boot
counting, crash markers, strand-line consistency — synthetic fixture lines
only), table rendering. Passes with networking absent; never spawns the
runner or the serial helper.

---

## 6. HIL runner — `simulation/tools/hil_push_check.cjs` + `tools/hil_serial_tail.py` (new)

Hardware-in-the-loop check of the REAL paths — HTTP plus the board's SERIAL
console as an independent evidence channel — against the two authorized
boards ONLY: **`ss_right_right` (`.65`)** and **`ss_right_left` (`.66`)**
(sim cards `RightRightRopes` / `RightLeftRopes`, outputs 1+2 enabled at
40 px, U36/U37 and U34/U35 — the same truth the private deployment record
carries). **`.61`/`.62` are STRICTLY off-limits**, as is every other board.
Explicit opt-in; never part of any suite.

**Why serial:** the firmware carries layered recovery — rejected applies, a
staged-config auto-revert, and boot-loop protection that can discard a
pending config and fall back to last-known-good or firmware-default strands
after repeated crashes. That last class hit `.61`/`.62` earlier today
(crash-revert to firmware-default strand types) — and an HTTP read-back
taken at the wrong moment can look green before a later crash-revert
changes the truth. Serial shows the reboot happening, whether it happened
ONCE, any panic/watchdog, and which strands the board actually initialized.

### 6.1 Placement + invocation

- `simulation/tools/hil_push_check.cjs` (Node driver + analysis; pure
  helpers exported, run body behind `require.main === module`) and
  `simulation/tools/hil_serial_tail.py` (capture helper — pyserial, since
  Node has no vendored serial library and the offline P0 forbids adding one
  at runtime; `import serial` at top of file, crash-at-start if missing).
  Both in `tools/`, never matched by any test glob or npm script (the
  implementer verifies).
- The runner speaks device HTTP `:80` and the named COM ports ONLY — never
  the sim/engine ports (6966–6972/5568). It reuses the REAL client
  functions via `require(esm)` of `marsinled_client.js` and writes its own
  snapshot files (a ~6-line local backup writer to
  `~/tmp/led_controller_configs_backup/hil_<id>_<stamp>.json` — the old
  gamma service's writer is deleted in S1).
- Invocation (targets + serial mapping REQUIRED):

```text
node tools/hil_push_check.cjs ^
  --board <.65 IP> --expect-id ss_right_right --serial ss_right_right=COM7 ^
  --board <.66 IP> --expect-id ss_right_left  --serial ss_right_left=COM8
```

  `--board`/`--expect-id` are ordered pairs; `--serial <id>=<COMx>` binds
  each target's port. `python tools/hil_serial_tail.py --list` enumerates
  COM ports with description + VID:PID so the operator can pick (ESP32-S3
  native USB and the common UART bridges are recognizable; MAC-based port
  identification was considered and REJECTED — it resets the chip into its
  bootloader). Optional: `--skip-config` / `--skip-toggle`,
  `--no-serial` (diagnostic only — verdict capped at `PASS (HTTP-only —
  not gate evidence)`), `--expect-universes <a,b>` (assert the snapshot's
  enabled universes before any write). No flag ever widens targeting.

### 6.2 Safety gates (all fail-loud, all BEFORE any write)

1. **Flag gate**: ≥1 board/id pair + a serial mapping per target (unless
   `--no-serial`), else exit 2 with usage. No default target exists.
2. **controllerId ALLOWLIST** (frozen, binding):
   `const HIL_ALLOWED = Object.freeze({ ss_right_right: 65,
   ss_right_left: 66 })` — every `--expect-id` must be a key AND its
   `--board` last octet must equal the mapped octet. Everything else —
   `.60`–`.64`, `.67`+ — is refused BEFORE any network I/O; the refusal
   text names `.61`/`.62` as operator-reserved.
3. **Identity preflight** per target: `GET /api/status`,
   `status.controllerId === --expect-id` or the WHOLE run aborts with both
   values printed, zero writes.
4. **Capability preflight**: `deviceSupportsPerOutput(status)`.
5. **Plan preflight**: the config leg's plan derives from the board's own
   pre-snapshot (§6.4); no enabled per-output strand → refuse ("push it
   from the sim once first"); `--expect-universes` mismatch → abort.
6. **Serial attach gate**: the tail helper opens each COM port with the
   serial control lines deasserted BEFORE open (the default open on these
   dev boards toggles them and resets the chip); the runner asserts NO
   boot/reset markers on attach. Reset-on-attach, busy port, or a dead
   helper aborts before any write.
7. **Swarm awareness (documented, no write)**: both targets are followers
   of the four-board show swarm whose persistent leader is one of the
   off-limits boards. The narrowed push does not touch swarm, so the
   board's membership persists through the whole cycle; a leader-driven
   sync during the run could, in principle, rewrite follower state under
   us — the serial + HTTP double verify would surface it as a loud
   mismatch naming what changed (finding, not silent). The runner never
   sends any swarm command.

### 6.3 Serial evidence channel (per target, whole-run capture)

`tools/hil_serial_tail.py` appends `<ISO-timestamp> <line>` to
`~/tmp/hil_serial/<controllerId>_<stamp>.log` for the entire run; the Node
runner analyzes windows with a PURE `classifySerialWindow(lines, from, to)`
(mock-tested). Asserted per leg:

- **Boot counting**: boots delimited by the chip's ROM reset banner
  (public ESP32 boot-ROM markers). Config leg: EXACTLY ONE boot on the
  target's port in the reboot window and ZERO on the other target's port
  (doubling as the COM-mapping cross-check — a boot on the wrong port
  fails the run naming the suspected swap). Toggle legs: one each.
  Restore: one. MORE than one boot in any window = crash loop = FAIL even
  if the final HTTP read-back matches (the `.61`/`.62` class).
- **Crash markers**: zero occurrences anywhere of the ESP-IDF-generic
  fatal markers (panic / "Guru Meditation", `abort()`, assert-failed,
  task/interrupt watchdog, brownout). Any hit = FAIL quoting line +
  timestamp.
- **Strand consistency** after the config-leg boot: the firmware prints
  per-strand init lines at boot naming type and count; the classifier
  checks tolerantly (generic patterns, numbers extracted) that the boot
  initialized 2 enabled outputs of 40 px and no firmware-default strand
  set appeared. Exact expected patterns MAY be supplied via an optional
  gitignored local file named by env var `BM26_HIL_SERIAL_PATTERNS` — per
  the confidentiality boundary, BM26 source embeds nothing beyond the
  ESP-IDF-generic markers and neutral `strand`-shaped heuristics.
- Raw serial logs STAY in `~/tmp` (gitignored; boot logs name WiFi SSIDs).
  Tracked reports carry paths + summarized verdicts only (boot counts,
  zero-crash statement, strand-check result) — never raw dumps.

### 6.4 The run (full cycle per target, targets sequential, abort-with-restore)

1. **SNAPSHOT**: `GET /api/status` + `GET /api/config`; write the full
   pre-config snapshot file; print its path FIRST (the manual recovery
   path).
2. **CONFIG PUSH leg** (the same client functions the panel calls): plan
   from the snapshot's enabled strands (each enabled strand with an integer
   `dmxUniverse` → `{outputIndex, pixelCount: strand.count}` +
   universe entry; `disables`/`countChanges`/`warnings` empty;
   `controllerName` = the target id) → `buildForcedConfigBody` →
   `pushForcedConfig` → `writeResponseLost` honored → `awaitReboot` →
   re-read → `diffForcedConfig` must be `[]` → identity. Serial: one boot,
   strand lines consistent. (This leg is idempotent-shaped by design — it
   proves transport, reboot, verify and serial health; the REAL
   state-change proof is the toggle leg.)
3. **DMX TOGGLE legs** (§3, real path): toggle OFF → verify
   (`dmx.enabled:false`, `sacn.enabled:false`, one boot) → toggle ON →
   inverse verify. Genuine both-direction writes.
4. **RESTORE** (mandatory; verify is part of PASS): POST ONE body carrying
   exactly the keys the run touched — `{strands, dmx}` from the
   pre-snapshot (plus `deviceName` original ONLY if a repair fired; an
   originally-invalid stored name stays repaired and is REPORTED) →
   reboot wait → re-read → `strands` and `dmx` deep-equal the pre-snapshot
   (`isDeepStrictEqual`), identity unchanged, one clean boot. The board
   leaves exactly as it entered — swarm membership included (never
   touched).
5. **On ANY leg failure**: skip remaining mutating legs for that target,
   ATTEMPT restore anyway (unless preflight/snapshot failed — nothing was
   written), mark the target FAIL regardless of restore success; continue
   to the next target only for a board-confined failure (allowlist /
   preflight failures abort everything).

### 6.5 Output format

One block per target, one row per step, verdict; exit 0 only on all-PASS:

```text
HIL PUSH CHECK — 2 target(s)
── ss_right_right (.65)   snapshot: ~/tmp/…/hil_ss_right_right_<stamp>.json
                          serial:   ~/tmp/hil_serial/ss_right_right_<stamp>.log (COM7)
  PREFLIGHT  allowlist+identity+capability+serial-attach  PASS
  SNAPSHOT   full config saved                            PASS
  CONFIG     forced write+reboot                          PASS  (11.2 s, responseLost=false, boots=1)
  CONFIG     read-back verify                             PASS  (0 mismatches; strands on serial: 2×40 ✓)
  TOGGLE     DMX off → verify                             PASS  (boots=1, sacn off)
  TOGGLE     DMX on  → verify                             PASS  (boots=1, sacn on)
  RESTORE    original config                              PASS  (boots=1)
  RESTORE    read-back verify                             PASS  (deep-equal; crash markers: 0)
── ss_right_left (.66) …
VERDICT: PASS (16/16)
```

FAIL rows print the mismatch sentences / device error / serial finding
verbatim; the final line always repeats both snapshot paths on any failure.

---

## 7. Slices for ONE implementer, with per-slice gates

| Slice | Scope | Gate |
|---|---|---|
| **S1** | Gamma removal (§1: deletions, save-server routes, editor mounts, registry migration, CSS, scene YAML, doc strips) | §1.4 G1–G6 |
| **S2** | Narrowed client contract (`marsinled_client.js`: §2.1 body, §2.2 verify, §3 toggle functions; `FORCED_DMX_BLOCK` gone) + `tests/marsinled_client.test.js` | `node --check`; client suite green incl. golden bodies + narrowing pins; grep `FORCED_DMX_BLOCK` → zero |
| **S3** | Panel wiring (`led_discovery_panel.js`: pre-write identity gate, warning copy, toggle UI + label seeding, sync-chip swarm-clause removal; push-all gate) + `per_output_push` / UI / sync suites | targeted suites green; browser evidence §8(b)–(e) |
| **S4** | Docs: `docs/41_led_controller_onboarding.md` (narrowed push, toggle, gamma-is-manual) + `docs/MARSINLED_API.md` (§2.4 table, all 8 rows) | doc greps: no force-payload swarm example, no gamma proxy routes, 409 + one-snapshot sequence present |
| **S5** | HIL: `tools/hil_push_check.cjs`, `tools/hil_serial_tail.py`, `tests/hil_push_check.test.js` | `node --check` / `python -m py_compile`; mock suite green offline; flagless invocation exits 2 before any I/O; allowlist constant frozen; no npm-script/test-glob reference |
| **S6** | Evidence bundle for the validator (§8) + the sanctioned HIL run | §8 list assembled; HIL table PASS or findings filed |

Order: S1 → S2 → S3 strictly; S4/S5 after S2 in either order; S6 last.
Finish + gate each slice before the next. Targeted invocation, from
`simulation/`:

```text
node --test tests/marsinled_client.test.js tests/per_output_push.test.js \
  tests/led_controller_ui_round2.test.js tests/controller_registry.test.js \
  tests/bridge_route_readback.test.js tests/shared_address_ui.test.js \
  tests/led_discovery_scene_liveness.test.js tests/theme_parity.test.js \
  tests/hil_push_check.test.js tests/bench_mirror.test.js \
  tests/bench_mirror_resolve.test.js tests/bench_mirror_state.test.js \
  tests/bench_mirror_arm.test.js tests/bench_mirror_reverse.test.js
```

Full `npm run check` binds/sweeps live-stack ports — run ONLY when the
operator's stack is down (operator-timed); otherwise record the targeted
list and say so. Never kill a stack port to make room.

**The sanctioned HIL run (part of S6):** the implementer MAY run
`hil_push_check` against `.65`/`.66` as a gate — operator-authorized —
after announcing it (both boards reboot several times and go dark briefly
while the live stack streams to them). `.61`/`.62` are never touched under
any circumstances. Evidence into the S6 bundle: the full PASS/FAIL table
transcript, snapshot file paths, serial log paths + per-leg summarized
serial verdicts (boot counts, zero-crash statement, strand-check result),
and before/after `configHash`. Raw serial logs are NOT pasted into any
tracked report.

## 8. Validator evidence list

**Autonomous (no operator needed):**

- (a) `node --check` / `py_compile` on every touched file; the §7 targeted
  suites green with before/after counts; §1.4 greps G1–G5 at zero; `_362`
  regression greps (`smk-`, `parkedOutputs`, `assertMappingPushAllowed`,
  `pushPerOutputUniverses`, `applyPerOutputPlan`) still zero.
- (b) Browser screenshot: an LED card with NO gamma row and the `DMX ⏻`
  control present.
- (c) Screenshot: the single-push confirm dialog — narrowed warning text,
  payload preview showing `strands`+`dmx` and NO `swarm`/`gamma` key.
- (d) Screenshot: sync chip In-sync on a stubbed SWARM-enabled board with a
  correct mapping + DMX on; drift on a DMX-off board.
- (e) Screenshot: toggle mid-flow phase text and the post-verify label.
- (f) Code-reading asserts: `diffForcedConfig` contains the D1 read-back
  clause and D2 semantics; `buildForcedConfigBody` writes no
  swarm/gamma/type/colorOrder; toggle path contains no polling/timer;
  HIL allowlist frozen and correct; the serial helper deasserts control
  lines before open.
- (g) HIL runner inertness: importing it runs nothing; flagless invocation
  exits 2 before any socket/serial work (mock suite + code reading).
- (h) `docs/MARSINLED_API.md` diff covers all §2.4 rows.

**Implementer-run, operator-announced (gate evidence, not autonomous):**

- (i) The HIL table for both targets (S6) — the validator checks the
  transcript + serial summaries against §6.4/§6.5, and that restore verify
  PASSed on both boards.

**Explicitly out of gates:** first live narrowed push / toggle use on show
boards other than `.65`/`.66` — operator-attended, after merge.

## 9. Restart vs reload matrix

| Change | What must bounce |
|---|---|
| `save-server.js` (gamma routes removed) | **launcher bounce** (operator-timed per `.agent/ops/stack_lifecycle.md`; never hand-kill one child) |
| `marsinled_client.js`, `led_discovery_panel.js`, `controller_map_editor.js`, `controller_registry.js`, `style.css` (browser ESM/CSS) | **page reload** after the bounce |
| Scene YAML (gamma keys dropped) | page reload; the migration logs once per affected card on first load |
| `tools/hil_*`, tests, docs | nothing — on demand |
| Engine, sACN bridges, bench-mirror runtime, CaptainPad | untouched |

## 10. Risks + open questions

1. **Dual-mode boards**: with swarm untouched, pushing/toggling a
   swarm-enabled board yields `dmx.enabled:true` + `swarm.enabled:true`.
   The retired mode model called that state invalid for classification;
   the firmware accepts it. The informational note (§2.2) is the designed
   surface; the operator owns swarm manually. HIL (§6) exercises exactly
   this shape on two swarm-member boards — any real firmware conflict
   surfaces there loudly.
2. **Preview gamma**: dropping `controllerGamma` from scene YAML makes
   every preview use the wire default (1.0 linear). `titanic` cards
   already declare 1.0 → show preview unchanged; `test_bench`'s card
   carried 2.2 → its preview shifts to linear. Preview-only; zero wire
   bytes change. If the operator later wants the preview to model a curve,
   that is a one-constant decision in `led_wire.js` — flagged, not built.
3. **Verify-narrowing trade**: a board whose type/colorOrder the operator
   changes on-device is now invisible to the push verify (by ruling). The
   sim never judges those fields; wrong colors on a strand are an
   on-device configuration matter.
4. **Swarm leader interplay during HIL**: a leader-driven sync from the
   off-limits leader could rewrite a target mid-run; the double verify
   (HTTP + serial) reports it as a loud finding (§6.2-7). Timing the run
   while the smokestack swarm is idle is an operator scheduling call.
5. **Serial capture hazards**: a port opened by another program, or an
   open that resets the chip, is caught by the attach gate before any
   write; pyserial missing crashes the helper at import (P0).
6. **`MARSINLED_API.md` gaps 4 and 5 remain open** (mixed known/unknown
   chain counts; fleet save after partial failure) — documented, out of
   this wave's scope.
7. **Uncommitted working tree**: this rides on the uncommitted
   `feat/bm_readiness` state; the operator owns commit timing and the
   security check (`python scripts/security_check.py --staged`) before it.
   No git operations by the implementer or validator.

## 11. Deferred: the optional gamma PUSH (returns only after the config push is confirmed)

Per ruling 8. Nothing ships now (no helpers are kept — the simplest current
tree wins; §1 removes gamma wholesale). When the operator green-lights it,
ONE small slice rebuilds it in the force shape, riding the config-push
machinery that will already be proven:

- A per-card gamma value (re-introduced as a plain card field or a fixed
  operator-entered curve — product call at that time), validated by a
  ~30-line pure `validateGammaCurve` in `marsinled_client.js`
  (range 1.0–3.0 per channel, complete `{r,g,b,w}`, firmware float32
  read-back compared at epsilon 1e-3).
- `buildGammaPushBody({snapshot, gamma, controllerName, ip})` →
  `{ gamma }` (+ §4.1.1 deviceName repair) — gamma is a key of the same
  `/api/config` document and is **live-apply, no reboot** (pinned at
  source; also re-record in `MARSINLED_API.md` then).
- Transport + verify exactly like the DMX toggle: one POST → read-back →
  epsilon compare → PASS/FAIL; no reboot wait expected (honor
  `needs-reboot` if a future build asks).
- NO pull, NO cache, NO fleet source selection — those stay dead
  permanently ("no gamma pull" is unconditional).
- Mock tests mirror the toggle's; the HIL runner gains a `--gamma` leg
  (push a distinct curve, verify, restored by the existing restore step;
  serial asserts ZERO boots — the live-apply proof).

A future agent can implement §11 from this section plus the then-current
`marsinled_client.js` without re-planning.
