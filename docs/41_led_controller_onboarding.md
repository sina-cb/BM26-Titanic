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
  the second one joins the bound-only flows (sync chip, push-all, gamma-all).
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
  never a silent fill. An output with **no port row at all** is **parked**
  (§3.2.1), which replaces the old anonymous "auto-extend".

### 3.2.1 Parking: "off" means no data routed here, not "output disabled"

**The push never writes `enabled: false`, for any output, ever.** Nothing the sim
does can dark a strand somebody wired outside it. A board output that is enabled
with no card port driving it is **PARKED**: it keeps a universe proven free
across the whole registry, so it stays enabled and subscribed and receives **zero
packets** (relay routes are unicast per `(universe, controllerIp)` and no patch
record points at it) — dark, held there by the device's own `dmx.timeoutMs`
blackout.

- Parked universes are **persisted** on the card as `parkedOutputs: [{output,
  universe}]` and **reused** across pushes. A re-derived park would move whenever
  any other controller took a universe, and the sync chip — which compares device
  ≡ plan — would then report drift on a card nobody touched.
- A park is re-allocated only when it stops being valid (another controller
  claimed it, it collides with one of this card's port universes, or it falls
  outside the ≤16-universe window). Each re-park names the old and new universe.
- A park must fit the **≤16-universe window** measured across the card's assigned
  AND parked universes. If no free universe fits, the push **refuses loudly**
  rather than earning a device 400.
- Parked universes are **registry claims**: another card's push can never take
  one.
- The card's `Board outputs:` line shows the whole picture —
  `1←P1(U21)  2←P2(U22)  3 parked U27  4 disabled` — with a `↻ re-park` button
  that forgets the stored universes so the next push allocates fresh ones.

**The ONE asymmetric write.** If a port with mapped pixels drives an output the
board currently has **disabled**, the push **enables it** (`enabled: true` plus
`count` = the port's mapped pixel count), declared per output in the confirm
dialog under its own heading. It is add-only by construction, so it cannot dark
anything. `count` on an **already-enabled** output is **never** rewritten — the
physical strand length is hardware truth and the sim's model is a belief; a
mismatch is reported as a warning, never a write. An EMPTY port row pointed at a
disabled output enables nothing (there is nothing to drive it with).

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
unused universes. Outputs 1–3, if the board has them enabled, become **parked**
(§3.2.1) and stay dark; output 4 is **enabled** by the push if the board has it
off.

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
`led_output_out_of_card_range`, and `led_parked_output_conflict` (a stored park
on an output a port now drives).

On top of those chips, the **push itself runs a registry-aware pre-flight gate**
(`collectClaimedUniverses` + `derivePerOutputPlan`, `device_config_mapper.js`):
parked and repaired outputs pick universes free across the WHOLE registry, and
an explicitly declared port universe that another controller already owns is a
**blocking refusal** naming both sides ("output 3 would take U23 — owned by
LeftFrontDeck port 1"). The claim index counts another card's **strandless port
universes** and its **parked universes** too — both are universes that device
really subscribes to, and neither shows up in the strand patch projection.
Three more blocking findings share the same refusal surface: `duplicate_output`
(two rows on one physical output), `output_out_of_range` (a row driving an output
the board does not have) and `parked_span` (no free universe left in the
16-universe window to park an unmapped output on). The device is not written and
there is no override path — fix the card and push again (§4.5).

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

The patch push is a **read-modify-write**: `GET /api/config` first, mutate, then
POST the strands array back **wholesale** so no hardware field is lost
(`pushPerOutputUniverses`).

**(a) `strands[]`** — one object per physical output, array order = output
index. Each **enabled** output carries its **own** `dmxUniverse` +
`dmxStartAddress: 1` (§3). Set each assigned output's `count` to its fixture's
pixel count and `enabled:true`; unassigned outputs stay `enabled:false` and are
copied through **untouched** (no per-output fields added). Keep `type`,
`pinData`, `pinClock`, `colorOrder`, `rgbwMode` as read from `/api/config`
(don't invent pins — `angio4` pins are locked).

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

**(b) `dmx{}`** — switch the device into sACN-receive. On the per-output path
this body carries **no `universe` / `startAddress`**: those are per-strand
(above), so only the transport-level keys are written.

```json
{ "dmx": { "enabled":true, "protocol":0, "timeoutMs":3000 } }
```

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

**(d) `gamma{}` — the per-channel correction curve** (`{r,g,b,w}`, each
`1.0`–`3.0`, `1.0` = off). This is the ONE gamma in the whole chain: the sim's
sACN mapper deliberately emits linear bytes, so the strand's perceptual
response is entirely this curve (`simulation/src/dmx/led_wire.js`). Keep `w` at
`1.0` unless the white emitter is measured to need its own trim — the
controller derives white AFTER applying the R/G/B curve, so a second exponent
compounds and crushes pastels.

```json
{ "gamma": { "r": 2.2, "g": 2.2, "b": 2.2, "w": 1.0 } }
```

Verified live 2026-07-28: a gamma-only write replies
`{"outcome":"applied","reboot":false}` — it applies WITHOUT a reboot (the
push path still honours a `needs-reboot` reply if a future build asks for
one). Exponents are stored as float32, so a written `2.2` reads back as
`2.200000048` — compare with an epsilon, and round before mirroring.

Push it from the sim: **Controllers panel → each LED controller card has a
gamma curve control — four R/G/B/W sliders (1.00–3.00, step 0.05) with a live
`y = x^γ` curve preview, preset chips (Off / 2.2 sRGB / Punchy, all of which
hold W at 1.0) and a Link-RGB toggle — plus "⬆ Push gamma", and the LED group
header has "⬆ Push gamma to all"** (sequential, per-controller
ok/failed/unreachable). Every push
goes browser → save-server (`POST /led/gamma-push`) → controller and does
full-config backup → gamma-only write → read-back verify, then mirrors the
VERIFIED values into `controllers.yaml`
(`led.wire.controllerGamma`) and stamps `device.lastGammaPush`. CLI equivalent:
`simulation/agent_tools/led_gamma_push.cjs` (same shared implementation,
`simulation/server/led_gamma_service.cjs`).

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
`pushPerOutputUniverses` adds **one** key beyond `strands` + `dmx`, and only
then: it writes `deviceName` = **the controller card's name, verbatim**
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
refuses before the POST naming the rename. The UI sends the card name with
every `POST /led/gamma-push`; the CLI takes `--device-name <card name>`. If a
gamma write is still rejected with `field=deviceName` on a body that never
carried the field, the error now explains this §4.1.1 quirk instead of
parroting the device's misleading message.

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
| `dmx.*` (enable/protocol/universe/startAddress/timeout) | Dmx | **reboot** (verified: `outcome:"needs-reboot"`) |
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

### 4.4 Restore to standalone

`POST /api/config {"dmx":{"enabled":false}}` → device reboots back to its
local pattern engine.

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
   — spill universes included — and every PARKED universe is ABSENT for this
   controller. A pair the ENGINE delivers directly counts as confirmed
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

**What the sync chip measures.** `● In sync` compares the DEVICE to the
per-output plan the page would push — device ≡ plan. It says nothing about the
feed, and its tooltip says so. After a push whose save or notify failed the chip
stays green (device ≡ plan is literally true) but carries the detail
`device ≡ plan, but the sACN feed is STALE — <step> failed: <reason>`.

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
3. **Engine routing** `marsin_engine/config.yaml` — add a `controllers:` entry
   routing the LED universes to `10.1.1.201` (`protocol: sACN`). Universes not
   listed keep streaming to the flat `sacn.destinations` (the sim bridge), so
   the sim still visualises them. To light hardware **and** show the same
   strands in the sim, set `alsoFlat: true` on that controller entry — the
   opt-in dual-send (`marsin_engine/lib/output_dispatch.js`; report
   `20260709_2_engine_dual_send.md`). This resolves the old §7 open question.
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
  regeneration, and the `marsin_engine/config.yaml` `controllers:` routing.
  Owns the scene files + model export; integration test that a patched LED
  controller produces contiguous engine-model pixels on universe U.

Sequencing: A and C can start immediately (disjoint); B depends on A's client
shape. Each slice: unit + one live smoke against `10.1.1.201` (or the mock),
report under `.agent/reports/`.

---

## 7. Follow-ups / open decisions

**Resolved**

- ~~**Dual-destination for LED universes**~~ — answered: a per-controller
  opt-in. `alsoFlat: true` on the `marsin_engine/config.yaml` controller entry
  fans its universes to the hardware **and** the flat sim-bridge destinations
  (§5.3; report `20260709_2_engine_dual_send.md`).

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
