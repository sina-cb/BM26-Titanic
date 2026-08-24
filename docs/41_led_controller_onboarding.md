# 41 — LED Controller Onboarding (MarsinLED discovery + fixture mapping)

Status: **infra implemented + shipped** (originally branch `feat/led_integration`,
2026-07-10) — client+mapper, discovery/bind/push UI, scene persistence, engine
dual-send, and exporter **per-output** addressing are all in and tested.
Execution plan + phase details: `.agent/plans/20260709_0_led_integration_execution.md`;
per-slice reports under `.agent/reports/202607/`. The engine→hardware link is
**verified on real hardware** (2026-07-09): `marsin_engine` sACN → MarsinLED
`10.1.1.201` → 80 physical RGBW pixels, correct colour order, 0 sequence
errors.

> **Mapping model:** the sim speaks **per-output sACN only** — one universe per
> physical output, start address 1. The legacy single-base *linear* mapping this
> doc used to describe was removed on the operator's 2026-07-10/11 ruling. See
> **§3**.
>
> **Push/save model:** ⬆ Push writes the device **and** saves the scene **and**
> notifies the sACN bridge; a 💾 save alone is sufficient for mapping-only
> changes. What each layer needs, and what a save still cannot fix, is **§4.5**.
>
> **What the push writes (narrowed):** exactly three things — strand
> **counts + enables**, **per-output universes** (start address 1), and
> **`dmx.enabled: true`**. Strand `type`, `colorOrder`, `rgbwMode`, pins,
> **swarm** and **gamma** are *not* touched: they pass through from the board's
> own snapshot or are never mentioned at all. A **pre-write identity gate**
> refuses before the confirm dialog if a bound card's live `controllerId` has
> changed, and a **disabled** output is written with its `dmxUniverse` /
> `dmxStartAddress` keys **removed** (D1 — the firmware's all-or-none rule).
> Details: **§4.1**.
>
> **DMX ⏻ toggle:** each LED card also carries a one-click DMX ON/OFF control
> that writes only the board's `dmx.enabled` flag and reboots it (**§4.4**).
>
> **Gamma:** operator-manual on the controller's own web UI. The sim's gamma
> section renders **disabled** and the sim **never reads gamma from a device**
> (**§4.1(d)**).

This doc is the source of truth for how the simulation onboards **MarsinLED
LED-string controllers** the way it onboards DMX controllers: **discover →
pick a controller → assign a sim fixture to each output → patch**. It also
records **exactly which controller configs we mutate over the HTTP API**, and
their apply/reboot semantics, so the sim can drive them safely.

DMX controllers are untouched by this work — LED is an additive, parallel
controller `type` (`CONTROLLER_TYPE_LED`, already present since the Views
Rehaul, PR #36).

---

## 1. The device (reference: MarsinLED firmware `main`)

- **Board `angio4-old`** — 4 fixed LED outputs on GPIO **35/36/37/38**
  (`pinsLocked`, `fixedOutputs`). Other profiles: `angio4-new`
  (21/45/14/38), `chroma-go` (single output, pin 5), `generic` (free pins).
- **HTTP JSON API on port 80.** mDNS advertises `<deviceName>.local`.
- **sACN/E1.31 unicast receiver** (`ESPAsyncE131`, `E131_UNICAST`) OR ArtNet,
  selected by `dmx.protocol` (`0`=sACN, `1`=ArtNet). Off by default
  (`dmx.enabled=false`) — the device runs its own local pattern engine until
  DMX mode is enabled.
- Example unit at `10.1.1.201`: `controllerId "titanic_201"`,
  `deviceName "Titanic-201"`, MAC `AA:BB:CC:DD:02:01`, static IP, strands
  0 & 1 enabled (WS281X_RGBW, 40 px each = 80 px), 2 & 3 disabled.

> The device does **not** answer ICMP ping — discover it over HTTP, never by
> ping. (`10.1.1.201` looked "offline" to `ping`/ARP while happily serving
> `/api/status`.)

---

## 2. Discovery (mirror of CaptainPad server discovery)

The scan borrows its **shape** from CaptainPad's server discovery
(`CaptainPad/hooks/useServerDiscovery.ts`): normalise a `/24` prefix
(`"10.1.1"`), enumerate `.1`–`.254`, `Promise.all` in batches, per-IP
`AbortController` timeout, accept only JSON hits. The **timings differ** —
MarsinLED needs a much longer cold-probe window than a CaptainPad server, see
the first bullet.

- **Probe:** `GET http://<ip>/api/status` (port 80), **6500 ms** timeout,
  batches of **64** (`marsinled_client.js`). The original 600 ms / 32 was too
  tight: a **cold** MarsinLED takes ~5 s to its first HTTP byte (warm GETs are
  ~160–240 ms), so 600 ms aborted before any cold device could answer and
  discovery reported an empty subnet. 6500 ms covers the cold case with margin
  and the bigger batch keeps a full `/24` sweep at ≈4 batches (~26 s worst
  case). Established: report `20260710_12_led_integration_merge.md`.
- **Accept a host as a MarsinLED controller** iff the response is `res.ok`
  and parses as JSON carrying **`controllerId` AND `boardId` AND `strands`**
  (there is no single `service` tag like the engine's; these three together
  are a reliable fingerprint). Reject anything else. Verified against the live
  bench device in report `20260725_56_led_controller_restart_debug.md`.
- **Identify** with: `controllerId`, `deviceName`, `boardId`, `ip`, `mac`,
  `firmwareSHA`, `version`, live `strands[]`, `sacn` rx counters, plus the two
  fields the push path feature-detects on: `capabilitiesExt.perOutputDmx` and
  `sacn.perOutput` (§3).
- **Dedup scan RESULTS by IP** — one card per address in the results list.
- **Bind by DEVICE IDENTITY, not by IP.** Binding writes the controller's
  `device:` block, whose identity key is the device's **`controllerId`**
  (`normalizeDeviceBlock`, `controller_registry.js`). "A card with this IP
  exists" and "a card is bound to this device" are different states, and only
  the second one joins the bound-only flows (sync chip, push-all, the DMX
  toggle; the fleet gamma entry exists but is inert — §4.1(d)).
  Accordingly the discovery modal offers **Bind** whenever the card it was
  opened from is not already bound to *this* `controllerId` — including a
  hand-typed card that already carries the right IP — and labels a matching but
  unbound card **"✓ added as '<name>' — NOT bound yet"** rather than a plain ✓.
  Gating Bind on the IP match made exactly the card that needed binding
  permanently unbindable; fixed and established in report
  `20260725_56_led_controller_restart_debug.md`.
- **The device MAC is never persisted.** It is read live from `/api/status` for
  display only — this repo is public and a committed MAC trips the security gate
  (`bm26-mac-address`). `normalizeDeviceBlock` drops a `mac` on load, so
  re-saving an old scene migrates it out.

### Discovery-relevant read endpoints

| Endpoint | Use |
|---|---|
| `GET /api/status` | discovery probe + live runtime (ip, mac, fps, `sacn.{enabled,rxPackets,lastUniverse,seqErrors}`, per-output `framesPresented`, `bootReport`) |
| `GET /api/config` | full persisted config (strands, dmx, wifi, brightness, caps) — read before writing so we PATCH, not clobber |
| `GET /api/board` | board profile + the 4 outputs' pin map / labels |
| `GET /api/version` | language/firmware version |

---

## 3. The per-output universe contract (**read this before patching**)

**A MarsinLED runs one INDEPENDENT sACN receiver per physical output.** Each
enabled output listens on its **own** `{universe, startAddress}`, and the sim
always sets `startAddress: 1` — output 0 on ITS universe channel 1, output 1 on
ITS universe channel 1, and so on. There is **no single contiguous stream
across outputs**.

> **Contract history (why this section changed).** This doc previously described
> a *linear* single-base mapping: one `dmx.universe`/`dmx.startAddress` with
> pixels packing across the enabled strands. That model is **gone**. Per-output
> became the ONLY supported mapping on the operator's 2026-07-10/11 ruling, and
> the legacy single-base push was **removed** from the sim (report
> `20260710_12_led_integration_merge.md`) — it addressed output 1 as a
> continuation of output 0, which darkens every output past the first on real
> per-output firmware. Both halves were re-verified against the live bench
> device in report `20260725_56_led_controller_restart_debug.md`: it advertises
> `capabilitiesExt.perOutputDmx: true` and reports a distinct universe per
> enabled output. The sim-side truth lives in `marsinled_client.js`,
> `device_config_mapper.js` (`derivePerOutputPlan`) and
> `led_patch_projection.js`.

### 3.1 What the sim requires of the device

- **Feature gate.** `GET /api/status` must carry `capabilitiesExt.perOutputDmx
  === true` (`deviceSupportsPerOutput`). Firmware without it gets a **loud
  refusal** — *"firmware too old — update MarsinLED to a per-output build"* —
  never a silent fall back to the old linear push (codex P0: no fallbacks).
- **Read-back.** The device reports its CONFIRMED mapping as
  `status.sacn.perOutput = [{index, universe, startAddress, enabled}]`. The push
  flow verifies the plan against that array after the reboot; an empty array
  means the device is carrying no per-output mapping.

### 3.2 A controller port DECLARES the physical output it drives

Each LED port row carries an explicit **`output`** (1-based) naming the physical
board output it drives. The device's 0-based `strands[]` index is derived from it
at the device boundary only — `ledOutputIndexForPort(port)` is the single place
`- 1` happens. Report `20260725_70_port_output_assoc_design.md`.

```yaml
ports:
  - port: 1
    output: 4          # ← the physical board output this row drives
    universe: 21
    startAddress: 1
    chain: [Left_Front_Left]
```

- **The port number is a stable ROW IDENTITY; `output` is the hardware target.**
  They match by default (port N → output N) and may be crossed deliberately (P1
  → output 4). A crossed row is marked in the pane and in the collapsed card
  summary (`· P1→O4`).
- **`output` is absent ⇒ identity.** A `controllers.yaml` written before this
  field loads as `output = port` — the exact rule in force before it existed, so
  nothing on the wire moves. It is materialized at load, logged once per card,
  and written explicitly on the next save. A non-integer or out-of-range value
  (outside 1…16) **hard-stops the boot**; a DUPLICATE (two rows on one output)
  **loads** and is caught by the pane chips and the push gate (§3.5).
- **No repeating port → output associations.** Two rows cannot drive one physical
  output: it can only carry one universe. The selector renders an already-taken
  option as disabled (`3 — taken by P2`), and the push refuses regardless of who
  authored the file.
- **The operator DOES pick a universe per output** — it is that port row's
  `universe` in `controllers.yaml`. (`led.baseUniverse` is ignored on the
  per-output path; it is a leftover of the linear model.)
- `+port` on an LED card fills the **lowest free port-row slot in 1…16**, not
  `max + 1`, and refuses loudly past 16 — otherwise deleting row 2 of a
  4-output board and re-adding minted port 4 while output 2 stayed permanently
  unreachable. The new row's `output` defaults to the lowest output no other row
  on the card claims. DMX controllers keep the append-only `max + 1` numbering
  and gain **no** `output` field (their port numbers are chain labels, not
  hardware indices). Established: report
  `20260725_52_led_fixtures_menu_mapping_ux.md`.
- An enabled device output whose port row carries an invalid universe is
  **repaired** to the next universe free across the whole registry (all-or-none
  is a firmware rule), with a warning surfaced in the push confirm dialog —
  never a silent fill. An output with **no port row at all** is **DISABLED** by
  the push (§3.2.1).

### 3.2.1 FORCE semantics: an output with no port row is DISABLED by the push

**The sim's controller panel is the SINGLE SOURCE OF TRUTH for the MAPPING.** A
push is a one-way overwrite of every output's enable, count and universe — no
negotiation with board-local mapping state, no partial-push variants, no modes
(operator ruling, report
`.agent/reports/202608/20260823_362_smokestack_switch_removal_push_hardening_plan.md`).
It is **not** an overwrite of the whole board: hardware fields the sim does not
own (`type`, `colorOrder`, `rgbwMode`, pins) pass through from the board's own
snapshot, and swarm and gamma are never mentioned (§4.1). Per output slot, there
are exactly two cases:

1. a card port drives it **and** that port maps ≥1 pixel → `enabled: true`,
   `count` = the port's mapped pixel count, `dmxUniverse` = the port's universe,
   `dmxStartAddress: 1`;
2. anything else → `enabled: false`.

This **supersedes two earlier rulings** that shaped the previous model:

- *"the push never writes `enabled: false`"* (parking, report `20260725_70`) —
  **gone**. Parking is retired end-to-end: no `parkedOutputs` block, no
  `↻ re-park` button, no parked registry claims, no parked-absent route
  assertion. A legacy `controllers.yaml` still carrying `parkedOutputs:` LOADS,
  DROPS the block and logs once per card
  (`parkedOutputs is retired — dropped; unmapped outputs are now disabled on
  push`); saving the scene persists the drop.
- *"`count` on an already-enabled output is never rewritten"* — **gone**. The
  count is forced from the sim's mapping **in both directions**.

Because both protections are gone, the confirm dialog carries two **mandatory**
sections before anything is written: **DISABLES** (every output enabled on the
board today that this push will darken, with its current count + universe) and
**COUNT CHANGES** (every already-enabled output whose `count` the push will
rewrite, `from → to`). The sync chip shows the same pending change *before* any
push: a portless enabled output reads `▲ Drift · enabled · U27 → disabled`.

The card's `Board outputs:` line shows the whole picture —
`1←P1(U21)  2←P2(U22)  3 will be DISABLED by push  4 disabled` — and the output
selector labels each option the same way (`2 — enabled, 40 px, U24 · push will
DISABLE it`, `4 — disabled · push will ENABLE it` on the row that maps it).

An EMPTY port row (or one whose strands the sim has no pixel count for) maps 0
pixels, so its output is **not** assigned — the firmware requires `count ≥ 1` on
an enabled output — and it is disabled like any other unmapped output. A card
that maps nothing at all still **refuses** (`no_enabled_output`): a MarsinLED
requires at least one enabled strand, and an all-dark force would earn a 400.

### 3.3 The byte layout WITHIN one output

Inside a single output the layout is contiguous from `(port.universe, ch 1)`:

- Bytes per pixel = the strand's colour-order width — **RGBW = 4**, RGB = 3.
- Multiple strands chained on ONE port pack contiguously, in chain order.
- A pixel **never straddles a universe**: when the next pixel would cross
  channel 512 the cursor jumps to channel 1 of the **next** universe, leaving
  the old universe's tail bytes unused (128 RGBW px / 170 RGB px per universe).
  That spill stays inside **that output's** stream.
- The one source of truth for this walk is `projectLedStrandSegments`
  (`led_patch_projection.js`); the scene exporter walks the same function, so
  the engine model, `patches.yaml` and the device agree byte-for-byte.

### 3.4 Worked example

A 4-output board, outputs 0 and 1 enabled at 40 px RGBW, mapped to U3 and U4:

| Output (device index) | Sim port row | Strand count | Universe | Channels |
|---|---|---|---|---|
| 0 (GPIO35) | P1 (`output: 1`) | 40 | **U3** | 1–160 |
| 1 (GPIO36) | P2 (`output: 2`) | 40 | **U4** | 1–160 |
| 2 (GPIO37) | — | 0 (disabled) | — | — |
| 3 (GPIO38) | — | 0 (disabled) | — | — |

The "drive output 4 only" case is ONE row with `output: 4`: no filler rows, no
unused universes. Outputs 1–3, if the board has them enabled, are **DISABLED**
by the push (§3.2.1) and go dark; output 4 is **enabled** by the push if the
board has it off.

Note output 1 starts at **channel 1 of its own universe**, not at channel 161 of
output 0's universe — that is precisely the difference from the old linear
table. A 200 px RGBW strand alone on an output at U6 spills as
`U6 ch1–512 (128 px)` + `U7 ch1–288 (72 px)`.

### 3.5 Plan rules (client-validated before any POST)

`validatePerOutputPlan` (`marsinled_client.js`) rejects a bad plan in the browser
so it never earns a device 400:

- **ALL-OR-NONE** — every *enabled* output must get a universe, and only enabled
  outputs may carry one.
- **sACN only** — `protocol: 0`; the per-output path rejects ArtNet.
- **Start address is always 1**, per output.
- **Universe range** 1–63999.
- **Span ≤ 16** — `(max declared universe − min declared universe) + 1 ≤ 16`
  across one controller's enabled outputs.
- **No overlap** — a strand longer than one universe (RGBW > 128 px, RGB >
  170 px) must not spill into the next output's universe.

`validatePerOutputPlan` runs on the **APPLIED** strands array — the intended
post-push state — not on the array the device reports today. Only the applied
array can express an enable, so validating the pre-push one would refuse a legal
"enable output 4" plan.

Further checks warn loudly but never block (`validateLedManualUniverses` — the
operator declared the universes and owns the choice):
`led_universe_duplicate` (two enabled outputs on one controller declaring the
SAME universe — both stream from its channel 1, so they overwrite each other),
`led_universe_collision` (a universe a controller actually streams also carries
DMX fixtures or another bound LED controller), `led_output_duplicate` (two port
rows declaring the SAME physical output — this one the push also BLOCKS),
and `led_output_out_of_card_range`.

On top of those chips, the **push itself runs a registry-aware pre-flight gate**
(`collectClaimedUniverses` + `derivePerOutputPlan`, `device_config_mapper.js`):
repaired outputs pick universes free across the WHOLE registry, and an
explicitly declared port universe that another controller already owns is a
**shared-address warning** naming both sides (the wire-side merge resolves it,
`src/dmx/address_merge.js`). The claim index counts another card's **strandless
port universes** too — a port declares its universe whether or not anything is
patched on it yet, and that never shows up in the strand patch projection.
Three blocking findings share the same refusal surface: `duplicate_output`
(two rows on one physical output), `output_out_of_range` (a row driving an output
the board does not have) and `no_enabled_output` (a card that would leave every
output dark). The device is not written and there is no override path — fix the
card and push again (§4.5).

A fixture is **patched** only once it is assigned to an output AND the sim's
LED/sACN model carries its universe+channel span; otherwise it is unpatched.

---

## 4. Remote configs we mutate over the API (the "note these down" list)

All writes: **`POST /api/config`** with a **partial** JSON body (only the keys
we change). The device validates, then replies:

```json
{ "status":"ok", "outcome":"applied"|"needs-reboot", "reboot":true|false,
  "message":"..." }
```

or `400` with `{ "error":..., "field":"strands[0].count", "detail":"..." }`
on a validation failure (fail-loud; surface the field to the operator). A
per-output rejection may additionally carry `fields: [{field, detail}, …]` for
multiple offending outputs at once — the client surfaces all of them verbatim
(`postConfigBody`, `marsinled_client.js`).

Writes go out as CORS **simple requests** — `Content-Type:
text/plain;charset=UTF-8`, no custom headers. The device answers `OPTIONS` on
these paths with **404**, so any preflight-triggering header makes the browser
abort the POST with "Failed to fetch". (The 404-on-OPTIONS behaviour was
re-confirmed live in report `20260725_56_led_controller_restart_debug.md`, along
with `Access-Control-Allow-Origin: *` on `GET /api/status`, which is why the
in-page subnet sweep can read responses at all.)

### 4.1 What we write when patching a controller

The forced push reads the board **once** (`GET /api/status` + `GET /api/config`),
builds **one** body from that snapshot (`buildForcedConfigBody`,
`marsinled_client.js`) and POSTs it verbatim (`pushForcedConfig`). The transport
does **no** GET of its own: the body must be built from the same snapshot the plan
was derived from, or the board can change between the two reads. The body the
confirm dialog previews **is** the object that gets posted, and there is
deliberately **no re-read immediately before the POST** — a second read would make
the posted body differ from the previewed one and would reopen the drift window it
claims to close. The residual "stale dialog" risk is covered by the **pre-write
identity gate** below plus the full read-back verify (§4.5).

**Pre-write identity gate.** Before the confirm dialog opens, a bound card's live
`status.controllerId` is compared with the identity stored in the scene. A
mismatch is a loud refusal naming both ids, and **nothing is written**. Push-all
runs the same gate per controller inside its loop: that board FAILs, the loop
continues.

The body is `{ strands, dmx }` — and `deviceName` only under the §4.1.1 repair.
**Three things and only three are forced**: strand counts + enables, per-output
universes (start 1), and `dmx.enabled: true`.

**(a) `strands[]`** — the FULL array, one object per physical output, array
order = output index. Each **assigned** output carries its **own** `dmxUniverse`
+ `dmxStartAddress: 1` (§3), `enabled: true`, and `count` = the port's mapped
pixel count (forced, both directions). Every **other** output is written
`enabled: false` **and its `dmxUniverse` / `dmxStartAddress` keys are DELETED from
the entry** (D1 — the firmware's all-or-none per-output rule 400s on a disabled
strand that still carries a universe).

Every **other** key of the entry passes through **untouched** from the snapshot:
`type`, `pinData`, `pinClock`, `colorOrder`, `rgbwMode`, `deadPixels` /
`deadPixelIndices`, and any key a future firmware adds (don't invent pins —
`angio4` pins are locked). **Strand type and colour order are deliberately NOT
pushed**: the operator manages chip type and colour order on the controller
itself. That pass-through is not "merging board tweaks", it is refusing to invent
hardware identity — and, by the same ruling, refusing to judge it (§4.5).

```json
{ "strands": [
  { "type":"WS281X_RGBW","count":40,"pinData":35,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":true,
    "dmxUniverse":3,"dmxStartAddress":1 },
  { "type":"WS281X_RGBW","count":40,"pinData":36,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":true,
    "dmxUniverse":4,"dmxStartAddress":1 },
  { "type":"WS281X_RGBW","count":40,"pinData":37,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":false },
  { "type":"WS281X_RGBW","count":40,"pinData":38,"pinClock":0,
    "colorOrder":"RGBW","rgbwMode":"exact","enabled":false }
] }
```

**(b) `dmx{}` — merged, never replaced. NO `swarm` key, ever.** Every push turns
the board's DMX input ON, idempotently: a board already receiving DMX re-asserts
it. The body's `dmx` is the board's **own saved `dmx` object** with only two keys
forced:

```json
{ "dmx": { "…the board's own saved dmx object…", "enabled":true, "protocol":0 } }
```

`timeoutMs`, the legacy `universe` / `startAddress` keys, and everything else the
board saved are **PRESERVED**. (The legacy globals are inert while per-output
universes are in force — the sim's universes are per-strand, above — but they are
the board's data and the push does not delete the board's data.) The snapshot must
carry a `dmx` **object**: a snapshot without one is a loud refusal, never an
invented block. The frozen `FORCED_DMX_BLOCK` export of the previous model is
**gone**; this merge rule replaces it.

`protocol: 0` (sACN) is forced because the per-output universes being written are
sACN-only by firmware rule (§3.5) — a body claiming ArtNet alongside per-output
universes would be incoherent.

**Swarm is never mentioned by the push.** There is no `swarm` key in the body, in
either direction. The board's swarm configuration — `enabled`, `isLeader`/`role`,
`groupId`, everything — survives a push **byte-for-byte** because the push simply
does not talk about it. Swarm is the operator's own setting on the controller's
web UI, in both directions; the sim has no swarm control, no mode model, and no
DMX⇄SWARM switch.

A board that ends up reporting `dmx.enabled` **and** `swarm.enabled` is an
**accepted** state — the firmware allows it, the retired mode model's "invalid
dual mode" classification is gone with it. The read-back surfaces one
**informational, non-failing** note on the outcome line — `ℹ board also reports
SWARM enabled — swarm is operator-managed; the sim does not touch it` — and the
push still passes.

**The push never touches wifi.** Some external provisioning tooling switches a
board's AP off when putting it into DMX mode; the sim deliberately does **not**
(wifi writes are staged behind the anti-brick confirm handshake and stay denied),
so the board's AP stays up after a push. That is cosmetic, not output ownership.

- `protocol` 0 = sACN, 1 = ArtNet — but the per-output path is **sACN only**
  (§3.5). `timeoutMs` 0 = hold-last-look forever; >0 = blackout after N ms of no
  packets (3000 is the value the sim writes, a good default while a live source
  streams).
- The old form (`dmx.universe` + `dmx.startAddress` as the single base for a
  linear stream) belonged to the removed legacy push — see §3's contract
  history. `dmx.startAddress` still has validation bounds (§4.2) because the
  client validates the key wherever it appears.

**(c) Optional device-level** (nice-to-have, not required to light): rename
via `deviceName`, set a power cap with `maxMilliamps` /
`maxMilliampsEnabled`, master `globalBrightness`.

**(d) `gamma{}` — the per-channel correction curve — is NOT pushed. Gamma is
operator-manual for now.**

The curve (`{r,g,b,w}`, each `1.0`–`3.0`, `1.0` = off) is still the ONE gamma in
the whole chain: the sim's sACN mapper deliberately emits linear bytes, so the
strand's perceptual response is entirely this curve. Keep `w` at `1.0` unless the
white emitter is measured to need its own trim — the controller derives white
AFTER applying the R/G/B curve, so a second exponent compounds and crushes
pastels.

```json
{ "gamma": { "r": 2.2, "g": 2.2, "b": 2.2, "w": 1.0 } }
```

Verified live 2026-07-28: a gamma-only write replies
`{"outcome":"applied","reboot":false}` — it applies WITHOUT a reboot. Exponents
are stored as float32, so a written `2.2` reads back as `2.200000048` — compare
with an epsilon.

**Where gamma is set today: on the controller's own web UI, by the operator.**
By operator ruling the sim's gamma surface is parked while the narrowed config
push is being proven:

- **The sim's gamma section still renders, fully DISABLED.** Each LED card keeps
  its gamma block — four R/G/B/W sliders, the `y = x^γ` curve plot, the preset
  chips, Link-RGB, the ⬆ push button, the last-push stamp — and every one of them
  is inert and greyed, with the note *"gamma is disabled until the config push is
  confirmed — set it on the controller's own web UI for now. The sim never reads
  gamma back from a device."* The LED group header's fleet gamma entry is inert
  the same way. There are **no handlers** in that section at all — nothing in it
  can reach the network.
- **The sim NEVER reads gamma from a device — permanently.** "Only push, not
  pull": there is no automatic read, no manual refresh, no TTL cache, no fleet
  source selection, and no `GET /led/gamma` route. Nothing may re-add one.
- **The push machinery is kept DORMANT, not deleted.** The save-server route
  `POST /led/gamma-push` and its service (`simulation/server/led_gamma_service.cjs`)
  still work and are still tested; the CLI
  `simulation/agent_tools/led_gamma_push.cjs` is **push-only** (its `--read` leg is
  gone and the flag now refuses loudly rather than silently pushing a default
  curve). Nothing in the UI calls any of it.
- **How gamma comes back:** as an operator-triggered option **after the config
  push is confirmed** — re-enable the disabled controls, keeping it **push-only**
  (verified by read-back within the push itself). The pull side does not come back.

The per-card `led.wire.controllerGamma` value in `controllers.yaml` is a
**preview-only** constant: it models the strand's screen response in the sim and
changes **zero bytes on the wire** (the mapper is linear either way). Those values
are still declared per scene and were deliberately KEPT. A card that declares
nothing previews the wire default — a fixed **linear** response (`1.0` on every
channel) — so unless a scene's YAML says otherwise, the preview models linear.

### 4.1.1 `deviceName` — the field EVERY write is validated against

`ConfigManager::update` merges the partial body into the **stored** config and
then validates the **whole merged document**. So a device whose *stored*
`deviceName` is invalid rejects **every** `POST /api/config` — including bodies
that never mention the field:

```text
400 {"error":"config apply failed","field":"deviceName",
     "detail":"1-32 chars, letters/digits/-._ only"}
```

Verified live 2026-08-03 on the `10.x.x.60` board, which shipped with
`deviceName: ""`: a **no-op gamma write** (`{"gamma":{"r":1,"g":1,"b":1,"w":1}}`
— the values it already held) earned the identical 400. Report
`20260725_124_marsinled_push_devicename.md`.

Consequence for the push: on such a board, *not* writing `deviceName` is not
"leave the device alone", it is "no config can ever be written". So
`buildForcedConfigBody` adds `deviceName` beyond `strands` + `dmx`, and
only then: it writes `deviceName` = **the controller card's name, verbatim**
(`deviceNameRepairForPush`, `marsinled_client.js`). No sanitizing, no
truncation, no substitution — if the card's name is not itself a legal device
name the push **refuses before the POST** and names the rename to make. A board
whose stored name is already valid is never renamed, and a `GET /api/config`
that does not carry the field at all is left alone. The repair is declared in
the push confirm dialog on its own heading (it also changes the device's
mDNS/AP name) and appears in the payload preview. Every other path —
`pushConfig` included — still refuses `deviceName` outright (`DENIED_PUSH_KEYS`).

The **gamma push carries the identical repair** (report
`20260725_126_gamma_push_devicename.md`): `led_gamma_service.cjs` consumes the
client's `deviceNameRepairForPush` directly (Node `require(esm)` — one
implementation, no drifting copy) and, when the stored name is invalid, adds
`deviceName` = the controller card's name verbatim to the `{gamma}` body, or
refuses before the POST naming the rename. Its caller sends the card name with
every `POST /led/gamma-push`; the CLI takes `--device-name <card name>`. If a
gamma write is still rejected with `field=deviceName` on a body that never
carried the field, the error now explains this §4.1.1 quirk instead of
parroting the device's misleading message. (That path is **dormant** while the
gamma UI is disabled — §4.1(d) — but the repair itself is live everywhere it
matters: the config push and the DMX toggle both carry it.)

**The repair is load-bearing for the whole write surface.** An invalid stored
name rejects EVERY write, so the config push (§4.1), the DMX toggle (§4.4) and
the dormant gamma push all share this one implementation. It is not gamma-specific
and it did not go anywhere when gamma was parked.

### 4.2 Validation bounds (reject before sending)

- `strands`: 1–16 entries; **≥1 enabled**; unique `pinData` across strands;
  total enabled pixels ≤ device cap. Each: `count` ≥ 1, valid `type`,
  `colorOrder`, `rgbwMode`, `deadPixels`/`deadPixelIndices` in range. This
  1–16 bound is where the sim's `LED_MAX_OUTPUTS = 16` output ceiling comes
  from (§3.2) — a 17th port could never be addressed.
- `dmx.universe` 1–63999; `dmx.startAddress` 1–512; `dmx.protocol` 0–1.
- **Per-output plans** carry their own rules on top of these — all-or-none,
  sACN only, start 1, span ≤ 16, no overlap: see §3.5.
- `globalBrightness` 0–255; `maxMilliamps` 0–65535 (0 = cap off);
  `maxMilliampsEnabled` bool; `deviceName` charset + ≤32 (derives
  `<name>.local` AP SSID).

### 4.3 Apply vs reboot semantics (from `ConfigManager::update`)

| Change | Flag | Applies |
|---|---|---|
| `globalBrightness`, `maxMilliamps`, `maxMilliampsEnabled` | Brightness | **live**, no reboot |
| `strands[]` **any** field (type/count/pin/colorOrder/rgbwMode/enabled/deadPixels) | Leds → reinit | **reboot to apply** (FastLED can't re-register a controller at runtime) |
| `strands[]` array length change | Reboot | **reboot** |
| `dmx.*` (enable/protocol/universe/startAddress/timeout) | Dmx | **reboot** (verified: `outcome:"needs-reboot"`) — including `dmx.enabled` alone, which is what the DMX toggle writes (§4.4) |
| `gamma.*` | — | **live**, no reboot (verified: `outcome:"applied"`, `reboot:false`) |
| `boardType`, `networkMode`, `deviceName`, `wifi.*` | Reboot/Wifi | **reboot** |

So a patch that changes strand counts **and** enables DMX will report
`needs-reboot` — which means **every per-output push reboots the device**
(it always writes `strands[]` + `dmx{}`). The device auto-reboots on that reply
(~10 s; `bootReport.bootDurationMs ≈ 9.4 s`) and the sim waits it out with
`awaitReboot`, then verifies the read-back from `sacn.perOutput`. **Keep the
sACN source streaming across the reboot** — the receiver latches the live stream
as soon as it boots (that is how the smoke test came up clean).

An explicit `POST /api/system/reboot` also exists and is **verified live**
(2026-07-25: HTTP 200 `{"status":"ok","message":"Device Rebooting…"}`, device
back in ~11 s with `resetReason: software`, while a bogus sibling path returned
the 404 unregistered-route signature — report
`20260725_56_led_controller_restart_debug.md`). The sim's transport function
`rebootDevice(ip)` targets it correctly, but **the sim has no restart button**:
`rebootDevice` currently has no callers, so the operator's only in-sim reboot
lever is the full push-and-reboot flow above. Adding an explicit restart control
is an open operator decision (§7).

> Anti-brick note: **wifi/network** changes are *staged* and require
> `POST /api/config/confirm` from the new network context within a window or
> they auto-revert (`wire_interface_v1 §9`). **strand/dmx/brightness changes
> are not staged** — they apply on the reboot without a confirm. The sim's
> patch flow only touches strands/dmx, so no confirm handshake is needed.

### 4.4 The DMX ⏻ toggle (and restoring a board to standalone)

`POST /api/config {"dmx":{"enabled":false}}` → the device reboots back to its
local pattern engine; `true` → it listens to sACN again. **There is no lighter
endpoint than `POST /api/config` for `dmx.enabled`** — DMX on/off is a field of
the persisted config, not a runtime-only route — so this is a configuration write
and it reboots the board (~11 s, §4.3).

**Each LED card carries a `DMX ⏻` control next to ⬆ Push** that does exactly this,
and nothing else. One button, one write, one read-back:

pre-write identity gate (§4.1) → one `GET /api/config` + `GET /api/status` →
`buildDmxToggleBody` → one POST → `awaitReboot` (phase text on the button:
`writing… / rebooting… / verifying…`) → re-read → `diffDmxToggle` → label + toast.

The body is the board's **own saved `dmx` object with only `enabled` flipped**
(same sidestep-partial-merge rule as the push), plus `deviceName` under the
§4.1.1 repair; a snapshot without a `dmx` object is a loud refusal. The verify
asserts three things and no more — `config.dmx.enabled`, `status.sacn.enabled`,
and unchanged identity. The toggle claims nothing about strands, swarm or gamma.
Writing the value the board already holds answers `applied` with no reboot.

There is **no confirm dialog** (operator ruling: no hassle), no fleet toggle, no
polling, no timer, no cache. The label shows the last confirmed observation —
`DMX: on` / `DMX: off` / `DMX: ?` before anything was observed — seeded
opportunistically from reads the panel already performs (the sync sweep, a push
verify). Any failure is a loud toast and sets the label back to `?`, because the
read-back is the only truth source.

**How it reconciles with the push:** the push always forces `dmx.enabled: true`;
the toggle is the manual lever between pushes. A board toggled OFF therefore reads
`▲ Drift` on the sync chip ("push will force DMX ON") — honest and intended.

**The DMX ⇄ SWARM switch is still the operator's own move in the board's web UI.**
The sim has no swarm control at all, and the push does not touch swarm (§4.1(b)).

### 4.5 Push, save, and the sACN feed (what actually makes the LEDs light)

A device write moves ONE state layer. The sACN feed the hardware receives is
produced from FILES ON DISK — `patches.yaml` (the sACN-in bridge's relay routes)
and `marsin_engine/models/<scene>.js` (the engine's send set) — and only a scene
save writes those. Auto-save is off by default, so before this wave a push wrote
the device and the strands stayed dark until the operator saved by hand. Root
cause + the six state layers: report
`.agent/reports/202607/20260725_58_push_save_workflow_plan.md`.

**⬆ Push to controller now completes the loop.** After the device write +
read-back verify it runs, in order:

1. **the scene save** — the same full `exportConfig()` the 💾 buttons run
   (`controllers.yaml` + `patches.yaml` server-side, plus the engine model
   re-export). The confirm dialog **declares this up front** — "Push writes the
   device AND saves the scene (mapping must land on disk for the sACN feed to
   follow)" — because it saves the whole scene, not just the mapping;
2. **the bridge notify** — a `setScene` over the sACN WS, chained on the save's
   completion (never on a timer), which makes the bridge re-read `patches.yaml`
   and recompute its relay routes;
3. **the bridge route read-back** (report `20260725_127`) — the bridge's ACTIVE
   route table is read back over the same WS (`{type:'getRoutes'}` →
   `{type:'routes'}`, answered from the live sender maps), and the third check
   renders ✓ only when every expected `(universe → controller IP)` pair exists
   — spill universes included. An output the push DISABLES makes no route claim
   at all. A pair the ENGINE delivers directly counts as confirmed
   `[engine-direct]` (the one-writer arbitration working); a pair the BENCH
   MIRROR owns is a named one-writer conflict, never a ✓.

Each step is reported in the dialog: `✓ device written + verified · ✓ scene
saved (patches projected) · ✓ bridge routes confirmed (U30,U31→10.1.1.60)`.
**Any step failing is red and names the stale layer** — "the device WAS written
(cannot be rolled back); the sACN feed was NOT updated: `<scene save|bridge
notify>` — LEDs will not follow until a successful save", and a failed
read-back names exactly the missing/extra routes ("✋ bridge routes NOT
confirmed: missing U31→10.1.1.60 …"). The device write is deliberately NOT
rolled back (that would be a hidden fallback plus a second reboot); a failed save
also suppresses the notify, because telling the bridge to re-read an unchanged
file only makes a stale feed look fresh, and a failed notify suppresses the
read-back (it would measure the old world). **Push all** runs one save + one
notify + one read-back over the union of every pushed controller's routes
after the last controller, not one per device.

**A save alone is sufficient for mapping-only changes.** Both 💾 buttons — the
controller pane's **💾 Save Configuration** and the Lighting Controls save — call
the identical `exportConfig()`, and that path notifies the bridge **after** the
write lands. Moving a strand between ports, renaming, re-patching: save and the
hardware follows. A failed notify is no longer silent — it raises a red save
toast **and** a red line in the sACN-IN monitor's activity log, and the page
re-sends the `setScene` automatically when the bridge WebSocket reconnects
(`sacn_input_source.js` — the self-heal).

**Two `setScene` messages per push are by design.** `exportConfig` notifies from
its own success branch (that is what makes "a save alone is sufficient" true for
the 💾 buttons), and the push then notifies again as a *reported* step, because
the inner call's outcome is not observable to the push. `setScene` is idempotent
— the bridge recomputes routes from disk — so the cost is one extra WS message.
See report `20260725_62_notify_ordering_loudness.md`.

**The bridge subscribes to new universes at runtime.** The `sacn` receiver
silently drops packets for universes it is not subscribed to, and that list used
to be frozen at bridge boot — so a universe patched after boot got a relay route
that logged healthy and carried nothing. Every `recomputeRoutes` now subscribes
the receiver to the effective route set plus the active scenes' patch universes,
logging `runtime-subscribed U27 (…)` once per universe and `✅ First frame on
U27 … — runtime-subscribed after boot` when it starts delivering
(`20260725_60_bridge_runtime_subscription.md`). **This needs one sACN-bridge
restart to take effect on a running box** — a restart briefly drops the relay, so
it is operator-timed. Until that restart the boot-frozen list is still in force.

**What a save still does NOT cover: pixel-count changes.** Adding or resizing a
strand changes the engine model's geometry, and the engine watcher refuses a hot
reload (`/status.modelStale`) — that needs the deliberate reload runbook,
`.agent/ops/engine_model_refresh.md`. Universe and mapping-only changes hot-reload
fine.

**What the sync chip measures.** `● In sync` compares the DEVICE to the FORCED
plan the page would push — device ≡ plan across the **full** forced array: which
outputs would be enabled and on which universe, which would be **DISABLED**,
which **counts** would be rewritten, and whether the board's DMX input is on at
all. A board with `dmx.enabled: false` reads `▲ Drift` with the detail
`push will force DMX ON`, because a push *would* change it.

**A board sitting in SWARM is NOT drift.** The swarm clause is gone from the chip:
the push no longer changes swarm, so a swarm-enabled board with a correct mapping
and DMX on is genuinely `● In sync`. Swarm membership is the operator's business
(§4.1(b)). The chip says nothing about the feed, and its
tooltip says so. After a push whose save or notify failed the chip stays green
(device ≡ plan is literally true) but carries the detail
`device ≡ plan, but the sACN feed is STALE — <step> failed: <reason>`.

**What the push verifies — exactly what it pushed, and nothing else.** After the
reboot wait the push reads `GET /api/status` + `GET /api/config` and asserts
(`diffForcedConfig`): every index of the pushed `strands` array (`enabled` both
directions; on enabled outputs `count`, `dmxUniverse` and `dmxStartAddress === 1`;
on **disabled** outputs that the read-back carries **no integer `dmxUniverse`** —
D1, proving the all-or-none strip landed on the device), the saved DMX block
(`dmx.enabled === true`, `dmx.protocol === 0`), the RUNTIME receiver
(`status.sacn.enabled === true`; `dmxOwnsOutput === true` only when the firmware
reports the field — an absent field is never read as agreement), and the board's
identity (`controllerId` unchanged versus the pre-push snapshot).

**Deliberately NOT verified**, because they are deliberately not written: strand
`type`, `colorOrder`, `rgbwMode`, pins, `dmx.timeoutMs`, `swarm.*`, `gamma`. This
is a ruling, not an oversight — the sim does not judge fields it does not own, and
a strand whose chip type or colour order is wrong is an on-device configuration
matter. A read-back reporting `swarm.enabled: true` produces one informational,
**non-failing** note on the outcome line (§4.1(b)), never a mismatch.

Every mismatch is quoted
verbatim in one thrown error; provenance hashes the FULL body into `configHash`.
**No retries, ever** — the one sanctioned ambiguity resolution is unchanged: a
LOST write reply falls through to `awaitReboot` + read-back arbitration. A fleet
push reports a **per-controller results table** (PUSHED / FAILED / SKIPPED with
the reason) plus a live per-controller progress line; the operator re-pushes a
failed board after reading its reason.

---

## 5. Sim / engine wiring (production path)

To make the **real engine** drive these LEDs and show them in the sim:

1. **Scene** `simulation/scenes/test_bench/`:
   - Add LED strand fixtures to `scene_config.yaml::ledStrands.strands`
     (currently `[]`) — two 40-px RGBW "lines" for `10.1.1.201`.
   - Add an LED controller to `controllers.yaml`: `type: LED`,
     `protocol: sACN`, `ip: 10.1.1.201`, 4 ports (2 enabled), **each enabled
     port carrying its OWN `universe`** (§3) — the strands on one port pack
     contiguously from that universe's channel 1.
   - Record patches in `patches.yaml` (LED fixtures become "patched").
2. **Engine model** `marsin_engine/models/test_bench.js` is auto-generated
   from the scene — regenerate so the 80 LED pixels appear with
   `patch:{universe, addr, footprint}`, each output's pixels on **its own**
   universe.
3. **Engine routing** — nothing to do. The engine has ONE output path: sACN to
   the flat `sacn.destinations` (127.0.0.1), where the **sim's input bridge is
   the single router** to every controller. It picks the LED universes up from
   the scene's `controllers.yaml` / `patches.yaml` on its next route recompute,
   so the strands light AND the sim visualises them with no engine config
   change. Engine-side direct-to-hardware routes are **forbidden** and refused
   at boot (`marsin_engine/lib/output_config_guard.js`): a stream the bridge
   never sees cannot be suspended, gated or accounted for, so
   one-writer-per-(universe, controller) stops being provable.
4. **Controller** — push §4 config (strands + dmx) via the sim's patch action.
   The push also saves the scene and notifies the bridge, so steps 1–2 land on
   disk and the relay routes follow in the same action (§4.5).

---

## 6. Implementation plan (historical — executed 2026-07-09/10)

> **This section is the ORIGINAL plan, kept as a record of how the work was
> sliced. It is not a description of the shipped system.** Two of its
> assumptions were superseded during execution: the scan window is 6500 ms /
> batches of 64, not 600 ms / 32 (§2), and the "linear layout" Slices B and C
> refer to was replaced by the per-output contract (§3). Read §2–§5 for what
> actually exists.

Fan out per `.agent/os/multi_agent.md` (worktrees, `dev/<slug>`, own ports).
Slices are mostly file-disjoint:

- **Slice A — MarsinLED API client + discovery service (sim server side).**
  A `LedControllerClient` (GET status/config/board, POST config/reboot, PATCH
  helpers that respect §4 semantics) + an IP-range scanner (`/24`,
  batches-of-32, 600 ms, accept on `controllerId`+`boardId`+`strands`). Node
  service exposed to the sim UI over the save/HTTP server. Owns new files
  under `simulation/src/dmx/led/` + a server route; unit tests with a mock
  device.
- **Slice B — Discovery + per-output mapping UI.** Extend the controller map
  editor: a "Discover LED controllers" panel (subnet input + AUTO, scan,
  results list) and a per-output→fixture assignment surface that computes the
  linear layout (§3) and shows the resulting universe/channel per output.
  Owns `controller_map_editor.js` + new UI modules; no server logic.
- **Slice C — Scene/model/patch plumbing.** LED strand fixtures in
  `scene_config.yaml`, LED controller in `controllers.yaml`, `patches.yaml`
  wiring, the linear-layout patch computation shared with the engine model
  regeneration. (No engine config change: the bridge routes every universe.)
  Owns the scene files + model export; integration test that a patched LED
  controller produces contiguous engine-model pixels on universe U.

Sequencing: A and C can start immediately (disjoint); B depends on A's client
shape. Each slice: unit + one live smoke against `10.1.1.201` (or the mock),
report under `.agent/reports/`.

---

## 7. Follow-ups / open decisions

**Resolved**

- ~~**Dual-destination for LED universes**~~ — moot. The engine no longer has a
  per-controller output path at all: it streams every universe to the flat
  `sacn.destinations` and the sim's input bridge relays to the hardware, so
  "hardware AND sim" is the only shape there is. The old opt-in dual-send
  (`alsoFlat:`) and the whole `controllers:` block are REMOVED and refused at
  boot — see `marsin_engine/lib/output_config_guard.js`.

**Open**

- **Explicit restart control** — `rebootDevice(ip)` exists and its endpoint is
  verified live, but nothing calls it (§4.3). Add a "⟳ Restart device" button to
  the LED card? It is a destructive control, so it wants the operator's
  sign-off. Shape when wanted: confirm dialog naming the ~10 s outage →
  `rebootDevice` → `awaitReboot` → status re-read, loud failure on either, no
  silent retry. (Report `20260725_56_led_controller_restart_debug.md`.)
- **Multi-controller** — `10.1.1.201` reports swarm peers `10.1.1.202/.203`
  (`Titanic-202/203`). Discovery must handle a fleet; universe allocation
  must not collide across controllers. (`validatePerOutputPlan` still catches
  collisions *within* one controller only, but a cross-controller claim is now a
  **blocking push refusal** via the registry-aware plan gate — §3.5 / §4.5. What
  remains open is fleet-scale discovery and allocation, not the collision.)
- **Pixel cap** — surface the device's total-pixel cap from `/api/config`
  validation so the UI blocks over-assignment before POST.
- **Re-enabling gamma push** — the machinery is dormant, not deleted (§4.1(d)).
  When the operator green-lights it after the config push is confirmed, the open
  product questions are: where a FLEET curve comes from now that source-selection
  is deleted (one operator-typed curve, or per-card push only — per-card is the
  smaller re-enable), and whether the parked section keeps showing the per-card
  preview curve + last-push stamp or collapses to a single line while parked.
  **The pull side does not come back** under any of those options.
