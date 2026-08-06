# 20260805_153 — BENCH MIRROR first physical test failed: packet/routing investigation

**Agent:** investigator (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_153`
**Predecessors:** `_150` (audit), `_151` (implementation), `_152` (adversarial review, verdict SHIP)
**Trigger:** the operator armed BENCH MIRROR against the physical bench. The bench
fixtures showed **apparently random output and colours that did not match the
corresponding titanic fixtures.** `_152`'s SHIP verdict is treated as **DISPROVEN
by physical reality** and re-opened here.

**INVESTIGATION ONLY.** Zero source / test / scene / doc edits outside this report
and the tracker block. Zero git write operations (`show` / `diff` / `status` /
`log` only). **No server started, no port bound, no packet toward any controller,
no device HTTP, no engine or sim boot, nothing armed.** The operator's live stack
(6966–6972, 5568, 8081, 10000) was never approached. Every measurement below ran
in-process against faked sockets; scratch harnesses live in `~/tmp/bench_mirror_debug_153/`.

IPs are redacted to `10.x.x.NN` in this prose per `.agent/os/security_privacy.md`.
The scene/config files carry the real values and were not edited.

**Scope split with `_154` (fixture-profile investigator):** this report owns
**which bytes leave on which universe and channel, from which process, at which
priority, under which CID**. `_154` owns **what a fixture does with those bytes**.

---

## 0. VERDICT

**The bench mirror's own composition and suppression are correct. The bytes that
reached the bench were not only its bytes.**

While the mirror is armed there are **two independent processes writing sACN to
the bench DMX gateway on the same universe**, and the mirror is the *lower*
priority of the two. The second writer is **the sim window itself**, and it is
present *by construction* — the ARM button only exists in the lighting-engine
mode that turns the sim into that writer.

| # | Finding | Verdict |
|---|---|---|
| **F1** | **The sim window unicasts RAW titanic universes to their controllers at priority 150 whenever the lighting engine is in `sacn_in` — including `U2 → 10.x.x.10`, the mirror's owned pair. It runs through the OTHER bridge (`:6972`), which the mirror cannot suppress.** | **CONFIRMED-OFFLINE** |
| **F1b** | **Separate and project-wide: the ENGINE hands the `sacn` package 0-255 DMX values in a field the package treats as PERCENT and multiplies by 2.55. Every value ≥ 101 leaves as 255. This is the hardware-side half of `_105` F3 and it crushes colour on EVERY controller, ship and bench alike.** | **CONFIRMED-OFFLINE** |
| **F2** | Every sACN sender in the repo uses the `sacn` package's hardcoded DEFAULT CID, so two writers on one universe look like ONE source with two interleaved sequence counters | **CONFIRMED-OFFLINE** |
| **F3** | The bridge's source arbitration is disabled by config (`sacn_high_priority: 100`, engine priority 100) — the "priority override silences the mirror" comment is false in this configuration | **CONFIRMED-OFFLINE** |
| **F4** | The engine unicasts U10/U12 straight to `10.x.x.202` (ShehdsBar + SmokeStack data). If `.202` is the same physical board now bound at `10.x.x.60`, it is a second writer on the mirror's LED universes that the ARM check cannot see | **NEEDS-LIVE-CAPTURE** |
| **F5** | Bridge-side suppression while armed: exactly one writer per owned pair, no stale sender, no leak on the whole-owned host | **REFUTED-OFFLINE** (not a cause) |
| **F6** | Composition math (offsets, lengths, boundaries, untouched channels, partial sources, cadence) | **REFUTED-OFFLINE** (not a cause) |
| **F7** | The mirror quantises DMX to ~100 levels; the ordinary relay does not (`_105` F8, now measured) | **CONFIRMED-OFFLINE** — real, but ≤2/255, cannot look random |
| **F8** | Source-universe truth: the engine's `titanic` model matches the sidecar's assumed layout fixture-for-fixture | **REFUTED-OFFLINE** (not a cause) |
| **F9** | A third-party multicast source on the LAN | **NEEDS-LIVE-CAPTURE** |
| **F10** | The `10.x.x.60` board's actually-applied universes (`needs-reboot` receipt still open) | **NEEDS-LIVE-CAPTURE** |

---

## 1. F1 — the sim window is the second writer, and it outranks the mirror

### 1.1 The path, file by file

`simulation/src/core/animate.js:680-727`, inside the per-frame render loop:

```js
if (window.dmxRouter && params.parLights && !window.__readonlyMode) {   // :682
  ...
  for (const config of params.parLights) {
    ...
    // In sacn_in mode: relay ALL universes to controllers (simulation acts as bridge)
    if (!isEffect && lightingMode !== 'sacn_in' && !isMappingOutput) continue;   // :709
    const key = `${u}:${ip}`;
    if (!outputGroups.has(key)) outputGroups.set(key, { universe: u, ip, priority: 150 });   // :713
  }
  for (const [, group] of outputGroups) {
    const fullFrame = window.dmxRouter.getFullFrame(group.universe);
    if (fullFrame) sacnOutputClient.sendUniverse(group.universe, group.ip, group.priority, fullFrame);  // :721
  }
}
```

- `lightingMode === 'sacn_in'` makes the `continue` at `:709` unreachable, so **every**
  patched DMX fixture contributes its `(universe, controllerIp)` pair.
- **Priority 150 is hard-coded** at `:713`.
- `sacn_output_client.js:81-122` packs a 519-byte `[universe][ip][priority][512 dmx]`
  frame and pushes it to `ws://localhost:6972`.
- `simulation/server/sacn_output_bridge.js:126-185` unpacks it and sends through
  `new Sender({ universe, port: 5568, useUnicastDestination: ip })` (`:63-73`) at the
  frame's priority.

### 1.2 Why the bench mirror cannot stop it

`:6972` is a **separate process**, spawned unconditionally next to the input bridge —
`simulation/start.js:105-108` (`server/sacn_bridge.js`) and `:116`
(`server/sacn_output_bridge.js`). The mirror's whole ownership machinery
(`partitionMirrorSuppression` → `relayRoutes` → `_routeEntries` → `outgoingSenders`)
lives **only inside `sacn_bridge.js`**. `sacn_output_bridge.js` has no route table, no
scene, no engine poll, no notion of a mirror; it sends whatever the browser hands it.

Grep for `benchMirror` across `simulation/src/**`: it appears in
`sacn_monitor_panel.js`, `bench_mirror_control.js`, `bench_mirror_banner.js` and
`sacn_input_source.js` — **the UI and the `:6971` socket client only**. It appears in
neither `animate.js` nor `sacn_output_client.js`. **There is no code path by which
arming changes what the browser transmits.**

### 1.3 Why it is guaranteed present at the moment of arming

The ARM control is inside the 📡 sACN IN monitor, which is shown only when
`showSacnInMonitor(mode === 'sacn_in' && enabled)` (`gui_builder.js:1601`,
`pattern_editor.js:804`), and `_151` §9.1 step 3 instructs the operator:
*"set the lighting engine to sACN IN so the 📡 sACN IN monitor is shown"*.

**The mode required to arm is exactly the mode that makes the sim a
priority-150 writer to every titanic controller.** This is not a race or an edge
case; it is the documented operating procedure.

### 1.4 What the gateway therefore receives

Both streams are unicast to `10.x.x.10:5568`, universe 2:

| writer | process | source name | priority | payload |
|---|---|---|---|---|
| bench mirror | `sacn_bridge.js` (:6971) | `MarsinRelay Engine` | **100** (measured) | the composed bench frame (pars@1-40, vintage@41-106, bars@107-344) |
| the sim window | `sacn_output_bridge.js` (:6972) | `BM26-Simulation` | **150** (hard-coded) | **RAW titanic U2** — `Left Front Wall 1` @1 and `Left Front Wall 2` @120, both `ShehdsBar` fp 119 |

The mirror's outbound priority is not a constant this file invents — it is the
priority of the source frame that fed it (`sacn_bridge.js:1432-1434`), and the
engine sends at 100 (`marsin_engine/config.yaml:2`). Measured on the wire by my
harness: **priority 100 on all three owned destinations, every frame** (§5, PHASE D).

150 > 100. On any gateway that implements E1.31 priority, **the sim wins** and the
bench plays raw titanic `Left Front Wall` bar bytes at bench addresses. The
byte-level mismatch (this report's half of the scope split; `_154` owns what the
fixtures then do):

| bench fixture | bench channels | what the raw titanic U2 stream puts there |
|---|---|---|
| Par 1-4 (`UkingPar`, fp 10, @1/11/21/31) | 1-40 | `Left Front Wall 1` (`ShehdsBar` fp 119) channels 1-40 — its master/control head plus its first pixels |
| Vintage Left / Right (`VintageLed`, fp 33, @41/74) | 41-106 | `Left Front Wall 1` channels 41-106 — mid-bar pixel data |
| Bar Left (`ShehdsBar`, fp 119, @107) | 107-225 | `Left Front Wall 1` ch107-119 **then** `Left Front Wall 2` ch1-106 — a bar's worth of data shifted by 106 channels |
| Bar Right (@226) | 226-344 | `Left Front Wall 2` ch107-119 then zeros |

That is "apparently random output and colours that do not match the corresponding
titanic fixtures", precisely.

### 1.5 F1b — the engine's own values are multiplied by 2.55 and clipped at DMX 100

Independent of the mirror, and affecting every controller on the rig.

`marsin_engine/lib/sacn_output.js:76-79` builds the sACN payload straight from the
DMX router's buffer:

```js
for (let ch = 0; ch < 512; ch++) {
  if (data[ch] !== 0) payload[ch + 1] = data[ch];   // sACN uses 1-indexed channels
}
```

That buffer holds **0-255 DMX values** — `simulation/src/dmx/sacn_mapper.js:351-353`
writes `Math.min(255, entry.r * 255)`, and `marsin_engine/engine.js:61` imports that
very module. But the `sacn` package treats `payload` as **percent**:
`node_modules/sacn/dist/packet.js:138` — `n[125 + ch] = inRange(payload[ch] * 2.55)`
— unless `useRawDmxValues` is set, and a repo-wide grep finds **no project source
that ever sets it**. Both vendored copies are `sacn@4.6.2` and identical.

Measured (`~/tmp/bench_mirror_debug_153/engine_scale.mjs`, real `Packet`, no socket):

```
engine DMX value -> byte on the wire: 0->0  1->3  2->5  50->127  99->252  100->255
                                      101->255  128->255  180->255  200->255  254->255  255->255
what the bridge receives (percent):   0->0  1->1.18 2->1.96 50->49.8 99->98.82 100->100
                                      101->100  128->100  180->100  200->100  254->100  255->100
```

**Everything the engine renders above DMX 100 leaves as 255**, and the information is
gone before the bridge — the relay and the mirror both faithfully forward a value that
was already clipped. An RGB of `(255, 120, 60)` reaches the fixture as
`(255, 255, 153)`. Colour is crushed toward saturation and white across the whole rig.

This is the **hardware-side half of `_105` F3**: the sim's 39 % preview is the same
unit confusion seen from the receiving end (`sacn_mapper.js:124-131` divides the
percent value it got by 255). F3 is logged as open; its wire consequence has not been
written down before.

**It does not, by itself, make the bench differ from the ship** — both are fed through
the same lane, so it is not the differential cause of "did not match the corresponding
titanic fixtures". But it is a live, project-wide answer to "colours that did not
match [what the pattern intended]", and it is the largest single byte-level defect
found in this investigation.

### 1.6 The LED box is NOT hit by the F1 path

`patch_manager.js:57`: *"LED strands carry their own patch record and are NOT in
`params.parLights`."* `sendUniverse` has exactly one caller (`animate.js:721`), fed
only from `params.parLights`. So the browser does **not** transmit U30/U31 or
U10/U12. The `10.x.x.60` box's competing-writer question is F4/F10, not F1.

Verified against the live scene, not just the comment — walking
`scenes/titanic/scene_config.yaml`:

```
fixtures under parent=parLights  count=80  ... has Left_Front_Left = false
strands                          count=8   names=Left_Front_Left, Left_Back_Left, …
```

`config.js:129-135` puts `strands:` into `params.ledStrands` and only `fixtures:`
into `params.parLights`, and the output loop iterates `params.parLights` alone.

> **Correction to `_153`'s sibling report `_154` (M1 "aggravator").** `_154` states
> that the same mechanism *"sends raw `U30/U31 → 10.x.x.60` at 150, which defeats
> `suppress_host: true` from OUTSIDE the bridge"*. The DMX half of `_154` M1 is
> correct and independently reproduced here; **the LED half is not** — the browser
> has no path that transmits a strand universe. `suppress_host: true` therefore
> still holds, and `_151` §9.3's promise (*"dark strands mean the board is not on
> U10/U12"*) survives, subject only to F4 and F10.

---

## 2. F2 — one CID for the entire project

`simulation/node_modules/sacn/dist/constants.js:22-26`:

```js
exports.DEFAULT_CID = Buffer.from([0x6b,0x79,0x6c,0x65,0x48,0x65,0x6e,0x73,
                                   0x65,0x6c,0x44,0x65,0x66,0x61,0x75,0x6c]);
```
(ASCII `kyleHenselDefaul`.) `packet.js:86` uses `options.cid || DEFAULT_CID`, and a
repo-wide grep for `cid:` finds **no project source that ever passes one**. Measured
on the wire from my harness: every frame carried
`cid=6b796c6548656e73656c44656661756c`.

Each `Sender` keeps its **own** sequence counter starting at 0
(`sender.js:29`, incremented at `:60`). So when the mirror and the sim both write
`U2 → 10.x.x.10`, an E1.31 receiver doing standard source discovery sees **one
source** whose sequence number jumps between two independent counters and whose
priority field alternates 100/150 packet to packet. Under E1.31 §6.7.2 a receiver
discards a packet when `seq_new − seq_last ∈ [−20, 0]`, so a large fraction of both
streams is dropped, semi-randomly.

**Consequence:** the F1 collision produces flicker/garbage **even on a gateway that
ignores priority entirely**. Two independent mechanisms, one symptom.

`_105` F4 flagged the shared CID; it is unfixed and it is load-bearing here.

---

## 3. F3 — the bridge's priority arbitration is switched off by config

`simulation/scenes/common.yaml:200-202`:

```yaml
  sacn_high_priority:
    value: 100
    label: 📡 High Priority Threshold
```

`sacn_bridge.js:1003` `HIGH_PRIORITY = sacnOpts.highPriorityThreshold` → **100**.
The engine sends at priority **100** (`marsin_engine/config.yaml:2`). So at
`:1073`:

```js
if (priority >= HIGH_PRIORITY) { ... routeFrame(...) }   // 100 >= 100 → ALWAYS true
else { if (!highPriorityActive) routeFrame(...) }         // dead code
```

`highPriorityActive` is permanently true, `activeSource` latches to the first source
seen, and the `else` branch — the only place a lower-priority source is ever
silenced — can never run. Measured (PHASE H): an inbound U2 at priority 150 is
composed **and** emitted, at outbound priority 150.

Two consequences:
- The comment at `sacn_bridge.js:1457-1459` (*"an sACN priority override silences
  the mirror exactly as it silences the relay"*) is **false in this configuration**.
- If a second source ever reaches the bridge's own receiver on a mirrored source
  universe, the bridge will splice **both** into the composed buffer, interleaved,
  and the composed frame's outbound priority will follow whichever arrived last.

Not the cause of tonight's symptom (no second source reaches `:6971`'s receiver —
the sim unicasts to controllers, not to the bridge host), but it is the missing
defence.

---

## 4. F4 — the engine's own unicast to `10.x.x.202` (NEEDS-LIVE-CAPTURE)

`marsin_engine/config.yaml:1-13`:

```yaml
sacn:
  priority: 100
  destinations: [127.0.0.1]
controllers:
  - name: Titanic-202
    host: 10.x.x.202
    protocol: sACN
    universes: [10, 12]
```

`lib/output_dispatch.js:137-149`: a declared universe with no `alsoFlat` goes to its
controller's host **and nowhere else**. So:

- **U10 and U12 never reach `127.0.0.1`** — the bridge never receives them, the sim
  never renders them, and the bridge's `U10 → 10.x.x.13` / `U12 → 10.x.x.14` relay
  routes (created every boot, seen in my capture) carry **no frames at all**. In the
  titanic model U10 = `Left Back Wall 3/4` (`ShehdsBar`) and U12 = `Left SmokeStack
  1-4`. *Adjacent finding, independent of the mirror: those ship fixtures are dark.*
- The engine **is** streaming titanic bar + smokestack data on **universes 10 and 12**
  to a host called `Titanic-202`.

The bench mirror composes **U10 and U12 → `10.x.x.60`**, and the `test_bench` scene
names that box `Titanic_202`, `boardId: angio4-old`. If `10.x.x.202` is the same
physical board (an old address still bound, a second NIC, a stale DHCP lease, or a
box that answers on both), then **the strands receive engine ShehdsBar/SmokeStack
bytes and mirror rope bytes on the same universes, from the same CID.**

The ARM's engine-clash refusal cannot catch this: `evaluateArmRequest`
(`bench_mirror.cjs:536-550`) compares `routeKey(universe, host)` strings, and
`10→10.x.x.202` ≠ `10→10.x.x.60`; the whole-host check tests
`key.endsWith('→10.x.x.60')`, which also misses. **Ownership is compared by address,
but hardware is a board, not an address.**

---

## 5. F5 / F6 / F7 / F8 — measured offline, with the real bridge

Harness: `~/tmp/bench_mirror_debug_153/capture.cjs`. It loads the **real**
`simulation/server/sacn_bridge.js` with `Module._load` intercepting `sacn`, `ws` and
`process_priority.cjs`, stubs `globalThis.fetch` as the engine `/status` (activeScene
`titanic`, `outputRouting` reproducing the real `controllers:` block), and — unlike
the repo's own test rig — **encodes every send through the real `sacn` `Packet`
class**, so the captured bytes are exactly the bytes `dgram` would have transmitted
(CID, sequence, priority, 512 DMX slots). No port bound, no datagram sent.
Source frames are synthesised by round-tripping engine DMX bytes through a real
`Packet` encode/decode, so the bridge sees the same percent-valued payload a real
receiver would hand it.

Second harness: `~/tmp/bench_mirror_debug_153/boundaries.cjs` — pure
`lib/bench_mirror.cjs`, per-channel-unique markers.

### 5.1 F5 — one writer, from the bridge (REFUTED as a cause)

PHASE A (disarmed baseline), one engine frame on U2/U5/U6/U30/U31:

```
writers: U2 → 10.x.x.10 | U5 → 10.x.x.11 | U6 → 10.x.x.11 | U30 → 10.x.x.60 | U31 → 10.x.x.60
```

PHASE C/D (armed), five consecutive engine frames:

```
U2  → 10.x.x.10 : 5 frames, distinct CIDs=1, sourceName=MarsinRelay Engine, sequence monotonic=true, priorities=100
U10 → 10.x.x.60 : 5 frames, distinct CIDs=1, sourceName=MarsinRelay Engine, sequence monotonic=true, priorities=100
U12 → 10.x.x.60 : 5 frames, distinct CIDs=1, sourceName=MarsinRelay Engine, sequence monotonic=true, priorities=100
stray frames to 10.x.x.60 on non-composed universes: 0
frames to 10.x.x.10 universes: U2 only
```

Whole-host suppression works: U30/U31 → `10.x.x.60` stop entirely while armed.
Pair suppression works: no raw U2 reaches `10.x.x.10`. Sequence is strictly
monotonic per sender. **The bridge is a clean single writer.** `_152`'s steady-state
conclusion reproduces exactly; the failure is outside its boundary.

### 5.2 F6 — composition math is exact (REFUTED as a cause)

`boundaries.cjs`, every source channel carrying a value unique to `(universe,
channel)`:

```
2→10.x.x.10 : mapped=344  mismatches=0  unmapped-non-zero=0
    [dest   1..40  ← U6   1..40 ] first=2(want 2)     last=41(want 41)
    [dest  41..73  ← U5   1..33 ] first=2(want 2)     last=34(want 34)
    [dest  74..106 ← U5  34..66 ] first=35(want 35)   last=67(want 67)
    [dest 107..225 ← U2   1..119] first=2(want 2)     last=120(want 120)
    [dest 226..344 ← U2 120..238] first=121(want 121) last=239(want 239)
10→10.x.x.60 : mapped=80 mismatches=0 unmapped-non-zero=0  [dest 1..80 ← U30 1..80]
12→10.x.x.60 : mapped=80 mismatches=0 unmapped-non-zero=0  [dest 1..80 ← U31 1..80]
dropped-channel: destCh1 was 2, after a U6 payload omitting ch1 it is 0   (correct)
null U30 payload: non-zero channels remaining in U10 ch1-80 = 0           (correct)
TOTAL DEFECTS: 0
```

Armed, with an all-red source (R=255 on every 3rd channel), the composed U2 frame:

```
ch  1- 16: 255   0   0 255   0   0 255   0   0 255   0   0 255   0   0 255
...
ch337-344:   0 255   0   0 255   0   0 255
ch345-512 non-zero channels: NONE (deterministically zero)
```

**Partial source (PHASE E)** — a fresh mirror state, only U6 arrives:

```
ch  1- 40: 255 …255                       (the U6 slice)
ch 41-344: all zero
non-zero channels in the NOT-YET-ARRIVED region ch41-344: 0
```

A composed frame **is** emitted on a partial arrival, but the not-yet-arrived regions
are deterministically **zero**, never stale and never garbage. A destination is
therefore dark-in-part for at most the first frame after arming.

**Cadence (PHASE F)** — one engine frame (5 source datagrams delivered in one poll
phase) produced exactly `U2→10.x.x.10 ×1, U10→10.x.x.60 ×1, U12→10.x.x.60 ×1`. The
`setImmediate` coalescing at `sacn_bridge.js:1437-1439` works: one composed send per
destination per engine frame, not one per slice.

*Offline limit:* my harness delivers all five source datagrams in one synchronous
burst. Whether the five real UDP datagrams from `sacnOut.sendFrame`'s `Promise.all`
always land in one libuv poll phase is **not provable offline** — if they split, the
bench would see one composed frame carrying a stale-by-one-frame region. That is a
1/40 s artefact at worst and cannot look "random"; listed for completeness, see §7.

### 5.3 F7 — the mirror quantises, the relay does not (CONFIRMED, but small)

The `sacn` package hands the receiver a **percent** payload
(`util.js:objectify` → `dp(val/2.55, 2)`) and multiplies by 2.55 on transmit
(`packet.js:138`). The relay passes that float straight through, so it round-trips
exactly. `bench_mirror.cjs:704` writes it into a `Uint8Array`, which **truncates the
float** — so the mirror carries ~100 distinct levels instead of 256.

Measured, engine DMX value in → wire byte out at the destination (PHASE G):

```
MIRROR (composed U2 → 10.x.x.10): 0→0  1→3  2→3  3→8  4→8  5→13  6→13  7→18  8→18  9→23 10→26 11→26 …
RELAY  (U6      → 10.x.x.11)    : 0→0  1→3  2→5  3→8  4→10 5→13  6→15  7→18  8→20  9→23 10→26 11→28 …
```

The loss is the fractional part of a 0..100 percent value, i.e. up to one percent
point ≈ **2.55 DMX steps**; over the full range `_154` measured worst error **−3** and
only 54 of 256 values exact. (My printed sample above covers the low end, where the
error is ≤ 2; the two measurements agree — different sub-ranges of the same defect.)
This is `_105` **F8**, now quantified. It is real and worth fixing
(`useRawDmxValues` exists in the package, `packet.js:135`), but it **cannot** produce
random output or mismatched colours — and it is an order of magnitude smaller than
F1b, which sits on the same percent lane.

### 5.4 F8 — source-universe truth is correct (REFUTED as a cause)

The sidecar assumes titanic U6 ch1-40 = 4× `UkingPar`, U5 ch1-33/34-66 = 2×
`VintageLed`, U2 ch1-119/120-238 = 2× `ShehdsBar`, U30/U31 ch1-80 = 20 px RGBW.
Read out of the **engine's own generated model** (`marsin_engine/models/titanic.js`):

```
Left Auditorium 5  UkingPar    patch { universe: 6,  addr: 1,   footprint: 10 }
Left Auditorium 8  UkingPar    patch { universe: 6,  addr: 31,  footprint: 10 }
Left Front Rails 1 VintageLed  patch { universe: 5,  addr: 1,   footprint: 33 }
Left Front Rails 2 VintageLed  patch { universe: 5,  addr: 34,  footprint: 33 }
Left Front Wall 1  ShehdsBar   patch { universe: 2,  addr: 1,   footprint: 119 }
Left Front Wall 2  ShehdsBar   patch { universe: 2,  addr: 120, footprint: 119 }
Left_Front_Left    led         patch { universe: 30, addr: 1, footprint: 4, led: true }
Left_Back_Left     led         patch { universe: 31, addr: 1, footprint: 4, led: true }
```

Exact match. The scene side matches too: `scenes/titanic/controllers.yaml:4-16`
(`LeftFrontWall` U2/U3/U4), `:65-92` (`LeftFrontDeck` U5/U6), `:29-46`
(`LeftLeftRopes` U30/U31) — and **`scenes/titanic/controllers.yaml` and
`patches.yaml` are unmodified in the working tree** (`git status`), so HEAD and
working tree agree. The operator's uncommitted edits this morning touched
`test_bench/patches.yaml` (removed two unpatched `TE Sign V3` records),
`test_bench/controllers.yaml` (added `output:` fields, a `needs-reboot` push receipt,
a parked output), `test_bench/scene_config.yaml` (fixture positions, `haloScale`) and
`common.yaml` (camera only) — **nothing that moves a mirrored address**.

The bench side is unchanged too: `test_bench/patches.yaml` still places Pars at
1/11/21/31, Vintage at 41/74, Bars at 107/226 on U2 → `10.x.x.10`, and LED_0/LED_1 on
U10/U12 → `10.x.x.60`.

`node --test tests/bench_mirror.test.js tests/bench_mirror_arm.test.js` on this tree:
**91 tests, 91 pass, 0 fail** — including the six live-map tests that pin the sidecar
against the real scenes and the real generated models. The map is not stale.

---

## 6. Writers enumerated (the brief's H1 checklist, answered)

| candidate writer | reachable while armed? | evidence |
|---|---|---|
| bridge's ordinary relay, pair `U2 → 10.x.x.10` | **No** — suppressed | measured, §5.1; `partitionMirrorSuppression` `bench_mirror.cjs:394-399` |
| bridge's ordinary relay, whole host `10.x.x.60` | **No** — U30/U31 suppressed too | measured, §5.1; `:400-405` |
| stale sender surviving the arm | **No** — the relay sender is closed and the mirror sender created in the same recompute pass; sequence is monotonic from 0 | `sacn_bridge.js:636-643`, `:691-705`; measured §5.1 |
| a second sim tab tagged `test_bench` | possible but **not required and not the cause** — a second tab adds relay routes that suppression still removes; it is, however, a second priority-150 `:6972` writer exactly like F1 | `_150` §2; `sacn_bridge.js:751-761` |
| **the sim window's own sACN OUT (`:6972`)** | **YES — unsuppressable, priority 150, on `U2 → 10.x.x.10`** | **F1** |
| the ENGINE unicasting to a controller IP | **YES for U10/U12 → `10.x.x.202`** | **F4** |
| a second input bridge on `:6971` | no — the port is bound once by `start.js` | `start.js:105-108` |
| `:6972` output bridge vs `:6971` input bridge | **two separate processes, both send sACN to controllers; only `:6971` knows about the mirror** | `start.js:105-116` |
| multicast delivery | **no project sender multicasts** — every `new Sender(...)` in the repo passes `useUnicastDestination` (engine `sacn_output.js:44-51`, output bridge `:63-73`, input bridge `:647-653` and `:694-698`). The `Receiver` joins multicast groups for **reception** only (`receiver.js:47-53`). A third-party multicast source cannot be excluded offline | F9 |
| CaptainPad / podium / `marsin_pb` | no sACN sender anywhere in those trees | repo-wide grep for `new Sender(` |

---

## 7. Controlled live capture — the procedure, for operator approval

**None of this was run.** Each step is read-only observation except where marked.
Run them in order; step B alone settles F1.

### A. Passive wire capture (no change to the running system)

Wireshark / `tshark` on the LAN interface, with the built-in E1.31 dissector:

```
tshark -i <lan-iface> -f "udp port 5568" \
  -T fields -e frame.time_relative -e ip.src -e ip.dst \
  -e e131.universe -e e131.priority -e e131.seq_number \
  -e e131.cid -e e131.source_name
```

What to look for, in one 10-second capture with the mirror **armed**:

1. **Count distinct `(ip.dst, e131.universe)` writers.** For `ip.dst == 10.x.x.10`,
   `e131.universe == 2`, expect **two** `e131.source_name` values:
   `MarsinRelay Engine` (priority 100) and `BM26-Simulation` (priority 150).
   **Two source names on one (dst, universe) confirms F1 on the wire.**
2. **Check `e131.cid`.** Expect the *same* 16 bytes
   (`6b796c6548656e73656c44656661756c`) on both streams. That confirms F2 —
   the box cannot tell them apart as sources.
3. **Check `e131.seq_number`** on that pair: expect two interleaved, non-monotonic
   counters rather than one monotonic one.
4. **`ip.dst == 10.x.x.202`**: expect the engine's U10 + U12 stream. Note whether
   ARP resolves (a real box) or the frames go unanswered.
5. **Multicast sweep** (F9): `-f "udp port 5568 and dst net 239.255.0.0/16"` — any
   traffic here is a source none of our code produces.

### B. The decisive counter-test (one operator gesture, fully reversible)

With the mirror **armed** and the bench misbehaving:

> **Switch the sim's lighting-engine mode away from `sACN IN`.**

The arm survives — it is process state in `sacn_bridge.js`, and the panel's
visibility gate (`showSacnInMonitor(mode === 'sacn_in' && enabled)`) hides the
control without disarming; the HUD banner is deliberately panel-independent
(`_151` §1). But `animate.js:709` then stops admitting fixtures unless the profile's
`mappingEnabled` is set, so the priority-150 stream to `10.x.x.10` **stops within a
frame**.

- **If the bench snaps to the correct mirrored look → F1 is the root cause, proven live.**
- If it does not change → F1 is not the whole story; go to C and D.

(To re-show the ARM/DISARM control afterwards, switch back to `sACN IN` — which
re-starts the competing writer.)

### C. The `10.x.x.60` board's applied configuration (F10 — two GETs, no write)

```
curl -s --max-time 3 http://<the .60 controller IP>/api/config
curl -s --max-time 3 http://<the .60 controller IP>/api/status
```

Read `strands[].dmxUniverse` (and `dmxStartAddress`) for the two enabled outputs:
**10 and 12** = the bench binding is applied and the mirror can reach the strands;
**30 and 31** = the board is still on the ship binding and the mirror's frames are
discarded at the box (the `needs-reboot` receipt on the `Titanic_202` card is still
open). `/api/status` corroborates with `sacn.lastUniverse`, `sacn.rxPackets` and the
per-output `framesPresented`. Both are `GET`s; every write is a `POST /api/config`,
i.e. the Push button, which stays an operator gesture.

### D. Is `10.x.x.202` a real box, and is it the same board? (F4)

```
arp -a | findstr 202
ping -n 2 <the .202 address>
tshark -i <lan-iface> -f "udp port 5568 and host <the .202 address>"
```

If `.202` answers at all, capture `http://<the .202 address>/api/status` and compare
its board identity (`boardId` / MAC) against the `.60` box. **If they are the same
board, the engine is a second writer on U10/U12 and the ARM's address-keyed
ownership check cannot see it.**

### E. F1b on the wire (same capture as A, one extra column)

In the step-A capture, dump the DMX slots of a frame from `ip.src == <the engine
host>` while a pattern is running mid-brightness:

```
tshark -i <lan-iface> -f "udp port 5568" -Y "e131.universe == 6" -x
```

Read the DMX slots (offset 126 onward). **If channels that the sim's pattern editor
shows at 40-90 % all read `0xFF`, F1b is confirmed live.** A quicker desk check: set a
single par to 50 % from the engine and read its channel — it should be ~128, not 255.

### F. Regression guard for the fix (offline, no hardware)

`~/tmp/bench_mirror_debug_153/capture.cjs` and `boundaries.cjs` reproduce every
measurement in §5 with no port and no packet. They are the shape a permanent test
should take if the project wants "the sim does not write to a mirrored destination"
pinned.

---

## 8. What a fix has to address (findings, not a design — no code was written)

1. **F1 is the blocker.** The one-writer law is currently enforced inside
   `sacn_bridge.js` only, while a second process (`sacn_output_bridge.js`) writes to
   the same hardware with no knowledge of it. Any fix must make the arm visible to
   the browser's output loop (or to `:6972`), or must refuse to arm while the sim is
   transmitting to an owned pair. Refusing is the codex-shaped answer, but it
   conflicts with the ARM control living inside the mode that causes the conflict —
   **that placement is itself part of the defect.**
2. **F2** — the shared CID makes every two-writer situation in this project
   indistinguishable at the receiver. A per-process CID would at least turn silent
   corruption into a diagnosable merge.
3. **F3** — `sacn_high_priority: 100` disables the bridge's only arbitration; the
   threshold should sit above the engine's priority for the mechanism to exist at all.
4. **F4** — ARM ownership is compared by `(universe, host)` string. Hardware is a
   board. The engine's `controllers:` block still names `10.x.x.202` while the scene
   binds the same board at `10.x.x.60`.
5. **F1b / F7** — one root cause, two symptoms. The vendored `sacn` package's
   `payload` is a **percent** field; the engine, the relay and the mirror all treat it
   as raw DMX in one direction or the other. `useRawDmxValues` (`packet.js:91-93`,
   `:134-139`) exists and would make the field mean what every call site already
   assumes — but it must be flipped on **every** sender and the receive-side
   `objectify` compensation removed **in the same change**, or the rig goes 2.55×
   dark instead of 2.55× bright. `_105` F3 is the same defect seen from the browser.

**Sequencing note.** F1b changes what every fixture on the rig does. Fixing it while
the bench-mirror retest is in flight would make the retest unreadable. Land F1 first,
retest the mirror, then take F1b as its own slice with its own before/after capture.

---

## 9. Hygiene

- **Zero writes** outside this report and the tracker landing block. No source, test,
  scene, doc or config edit. No git write operation — `show` / `diff` / `status` /
  `log` only.
- **No process started**: no engine, no sim, no bridge server, no launcher. **No port
  bound.** No sACN datagram, no multicast join, no device HTTP, no ping. The
  operator's live stack (6966–6972, 5568, 8081, 10000) and every controller on the LAN
  were never approached. **Nothing was armed** — the harness runs the bridge module
  in-process with faked sockets, so no real hardware could have been armed.
- Scratch harnesses and their captures live in `~/tmp/bench_mirror_debug_153/`
  (`capture.cjs`, `capture_output.txt`, `boundaries.cjs`, `boundaries_output.txt`,
  `engine_scale.mjs`). Nothing was created in the source tree.
- The only test command run was
  `node --test tests/bench_mirror.test.js tests/bench_mirror_arm.test.js` (91/91), which
  binds nothing and constructs no real `Sender`.
- Every claim is a file read, a `git` read, a test run, or a byte table captured
  in-process; citations are `file:line` against the working tree on
  `feat/bm_readiness`.
- IPs redacted to `10.x.x.NN` in prose throughout.

---

# 10. FLICKER ADDENDUM — second live test: "sane colors, but flickering like hell"

**Added after the operator's second bench test.** Same constraints as §1-§9:
read-only, no port bound, no packet, no git write, scratch in
`~/tmp/bench_mirror_debug_153/`.

## 10.0 Tree pins, and one change that landed mid-investigation

| file | md5 at the start of this addendum | at the end | note |
|---|---|---|---|
| `simulation/server/sacn_bridge.js` | `79393bb4db3a0e02ba3f065bf2a0c589` | **unchanged** | mtime 09:58:32 |
| compose path, `sacn_bridge.js:1418-1455` | `9235188038e8aeab96655ec6acc1c936` | **unchanged** | the scheduler under test |
| `simulation/lib/bench_mirror.cjs` | `48388018e326336e1f4b19053bf03b1b` | **`c5dfcb43679592dc8f1417e9c08ae74f`** | **changed under me at 12:18:59** — `_156`'s v3 `slots` schema |
| `simulation/scenes/test_bench/bench_mirror.yaml` | `dab947e9b123881bb7fcc70050851b38` | unchanged | still **v2** on disk (mtime 08:44:29) |
| `simulation/src/core/animate.js` | at `HEAD`, unmodified | unmodified | **the F1 priority-150 path is still in the code** |

**`HEAD` is not a usable baseline here.** The last commit (`948447e9`) predates the
whole runtime-arm feature — `_151`/`_152` are uncommitted. The build the operator
tested is the *working tree*, so every pin above is a working-tree hash.

**The compose pipeline is byte-identical across the v2 build the operator tested and
`_156`'s in-flight v3.** `createMirrorState`, `spliceMirrorFrame` and `mirrorPayload`
are character-for-character the same (only line numbers moved: 667-727 → 645-710), and
the v3 "computed spec" still carries `spec.mirrors`. The measurements below therefore
apply to both builds.

### 10.0.1 URGENT, operational — the live sidecar no longer parses

`_156`'s v3 parser (`bench_mirror.cjs:86`) now allows only
`version, enabled, label, note, slots`, while the on-disk
`scenes/test_bench/bench_mirror.yaml` is still **v2** (`version: 2`,
`source_scene:`, `mirrors:`). Reproduced: `parseBenchMirrorSpec` throws
*"unknown key 'source_scene' — allowed: enabled, label, note, slots, version"*.

`readBenchMirrorSpecs()` is called on **every route recompute**
(`sacn_bridge.js:512`), and a spec that stops parsing is an `evaluateArmedHealth`
auto-disarm reason (*"…stopped parsing"*). So on any bridge restart onto the
current tree, **ARM is refused and any live arm auto-disarms**. This is the most
likely explanation for "the bench lights are NOW DARK" and it needs no further
investigation — the file and the parser must land together. Flagged, not chased,
per the coordinator.

## 10.1 Method

`~/tmp/bench_mirror_debug_153/jitter.cjs` drives the **real** compose functions
under the **verbatim** scheduler copied from `sacn_bridge.js:1427-1454`, feeding the
five source universes across a controllable number of event-loop **poll phases** —
the live case, where the engine's five universes are five separate UDP datagrams.
The parser is bypassed on purpose (§10.0.1); the computed spec is built directly
from the sidecar's declared mapping. Every channel of every source frame is stamped
with a value identifying its **engine frame number**, so each emitted region can be
classified **FRESH** (this frame), **STALE** (a previous frame) or **ZERO**.

Buffers are warmed before measurement, so STALE means "a previous engine frame",
never "never written".

## 10.2 Results — the asymmetry is total

40 engine frames per pattern.

| arrival pattern | `U2 → 10.x.x.10` (5 slices, 3 sources) | `U10`/`U12 → 10.x.x.60` (1 slice, 1 source) |
|---|---|---|
| **A** — all 5 datagrams in one poll phase | **1.00** sends/frame · 100 % fully fresh · **0 % torn** | 1.00 · 100 % · 0 % |
| **B** — split 2 / 3 across two phases | **2.00** sends/frame · 50 % fully fresh · **50 % torn** | 1.00 · 100 % · **0 %** |
| **C** — every datagram in its own phase | **3.00** sends/frame · 33 % fully fresh · **67 % torn** | 1.00 · 100 % · **0 %** |
| **D** — DMX universes together, LED trailing | 1.00 · 100 % · 0 % | 1.00 · 100 % · 0 % |
| **E** — U2's sources split, LED together | **3.00** sends/frame · 33 % fully fresh · **67 % torn** | 1.00 · 100 % · **0 %** |

Region totals, pattern C: `U2 → 10.x.x.10` FRESH 360 / **STALE 240** / ZERO 0;
`U10` and `U12` FRESH 40 / STALE 0 / ZERO 0 each.

**Two results matter:**

1. **ZERO regions: 0 %, in every pattern.** The composed buffers persist across
   frames (`createMirrorState` allocates once; `spliceMirrorFrame` only rewrites the
   slices the arriving universe feeds), so a partially-composed frame carries the
   **previous** frame's bytes in the not-yet-arrived regions — never black. My `_153`
   PHASE E showed zeros only because that buffer was freshly allocated.
2. **A single-source destination is structurally immune; a multi-source destination is
   structurally exposed.** `U10`/`U12` are 1.00 send/frame and 100 % fresh under
   *every* arrival pattern, because one source universe both fills the whole buffer
   and triggers the flush. `U2` is composed from **three** source universes, so it is
   flushed up to three times per engine frame and two of those three carry stale
   regions.

**That asymmetry is exactly the operator's observation** — "the DMX fixtures were
definitely flickering; didn't notice whether the LED strands were". It is the
sharpest discriminator available and it lands cleanly.

## 10.3 Verdicts

### H1 — compose cadence / partial-source. **SPLIT VERDICT.**

- **"Partial-source ZEROS" — REFUTED-OFFLINE.** 0 % zero regions in 200 measured
  engine frames across five arrival patterns. The mechanism is not blanking.
- **"Variable compose cadence with sub-frame tearing" — CONFIRMED-OFFLINE.**
  Up to **3 composed sends per engine frame** on `U2 → 10.x.x.10` (≈120 packets/s
  where the engine produces 40 frames/s), **67 % of them carrying at least one region
  from the previous engine frame**, with the split point moving as arrival timing
  jitters.

The trigger, exactly: `mirrorInbound` (`sacn_bridge.js:1427-1440`) splices the
arriving universe, marks the destination dirty, and schedules **one**
`setImmediate(flushMirrors)`. `setImmediate` fires in the **check** phase
immediately after the **poll** phase that delivered the datagrams. So the coalescing
window is *one poll phase* — not one engine frame. Any engine frame whose five
datagrams are read across more than one poll phase emits more than one composed
frame, and the early ones are incomplete. **There is no frame synchronisation of any
kind** — no E1.31 sync packets (the `sacn` package hardcodes `syncUniverse = 0`,
`packet.js:78`), no frame id, no arrival-order contract. The only thing standing
between the bench and torn frames today is the accident of libuv reading all five
datagrams in one poll iteration.

Honest limit: **whether the live stack actually splits poll phases is not provable
offline.** What is proven is that the pipeline has no defence if it does, that the
cost is 2-3× the intended packet rate with 50-67 % torn frames, and that the
exposure is confined to multi-source destinations — which is precisely where the
operator saw flicker.

### H2 — two writers with sequence-discard. **NEEDS-LIVE-CAPTURE, and H1 makes it worse.**

`animate.js` is unmodified at `HEAD`, so the priority-150 path (§1) is **still in the
code**; nothing I can see offline removed it. Quantifying the discard, per E1.31
§6.7.2 (discard when the signed 8-bit difference `new − last` ∈ `[−20, 0]`), for two
same-CID streams on one universe with constant offset `d = seq_B − seq_A`:

| `d` | outcome |
|---|---|
| `[−20, 0]` (21 values) | B always discarded — **A wins cleanly, no flicker** |
| `[1, 21]` (21 values) | A always discarded — **B wins cleanly, no flicker** |
| everything else (**214 / 256 ≈ 83.6 %**) | both accepted — the box alternates the two looks at **80 Hz** |

**New result: H1 and H2 compound.** With the mirror emitting a *variable* 1-3
packets per engine frame while the sim's `:6972` stream emits exactly 1, the offset
`d` **drifts by 0-2 per frame** instead of staying constant — sweeping the full
256-value space every **1.6-6.4 seconds** and repeatedly crossing both clean-win
windows. The physical result is a multi-second beat that cycles through "mirror
wins" (sane), "sim wins" (garbage) and "both alternate at 80 Hz" (flicker). That is
a strong match for *"sane colors, but flickering like hell"* — and it explains why
the colours read as sane at all, which a steady priority-150 win would not.

Fixing H1 alone makes `d` constant; it does **not** remove the second writer. Do not
mistake the cadence fix for a two-writer fix.

### H3 — sequence restart on sender recreation. **REFUTED-OFFLINE, transient only.**

`Sender.sequence` starts at 0 (`sender.js:29`). A receiver holding a prior sequence
of, say, 173 from the same CID sees `0 − 173 = −173`, which is **outside** the
`[−20, 0]` discard window, so the very first packet is accepted and re-syncs. The
`sacn` package's own receiver takes the other branch (`|last − seq| > 20` → treat as
out of order) but updates `lastSequence` **before** throwing (`receiver.js:27-33`),
so it too costs exactly **one** packet. Either way: a single dropped frame at arm
time, 25 ms, not sustained flicker. Killed.

### H4 — burst / pacing. **PARTLY CONFIRMED-OFFLINE, same root cause as H1.**

Measured: up to 3 full 512-channel frames for `U2` inside one engine period, then
silence for the rest of it — ≈120 packets/s on a universe the gateway converts to
physical DMX at ~30-44 Hz. All destinations are also emitted back-to-back in a
single check phase. Whether a given gateway's input path drops or mis-latches under
that burst is device-dependent and **NEEDS-LIVE-CAPTURE**; the H1 fix removes the
burst by construction, so H4 needs no separate work.

### H5 (mine) — state-reset blanking. **CONFIRMED-OFFLINE. A real black-flash mechanism, live right now.**

Buffer reuse is keyed on `JSON.stringify(spec)` (`sacn_bridge.js:519`). Any change to
a **parsed** field — and any disarm/re-arm — drops the composed buffers and
`createMirrorState` allocates fresh zeros. Measured cost of one reset:

```
warm buffer non-zero mapped channels : 344/344
after a state reset, first composed  :  40/344   -> 304 channels of BLACK
```

`readBenchMirrorSpecs()` re-reads the sidecar from disk on **every** recompute, and
recomputes fire on every engine-poll state change and every client `setScene`. With
`_156` actively rewriting the sidecar and the parser, each parsed-field edit lands a
**304-channel black flash** on the bench gateway. `_105` F14 fixed this for
comment-only edits; it is unfixed for real ones. The H1 fix below closes this too, as
a side effect.

## 10.4 FIX SPECIFICATION for `_156` (v3)

The `_151` compose pipeline carries into v3 unchanged, so this lands there.

**Principle: emit one composed frame per destination per ENGINE FRAME, never per
source-universe arrival. A destination is emitted only when every source universe it
declares has contributed since its last emission.**

**1. Pure half — `lib/bench_mirror.cjs`.** `createMirrorState` already walks every
slice; have it also record, per destination, the set of source universes that feed it:

```
requiredSources: Map<destKey, Set<number>>     // from new Set(m.slices.map(s => s.sourceUniverse))
```
Return it alongside `buffers` / `bySource` / `targets`. For the live map that is
`{2→10.x.x.10: {6,5,2}}`, `{10→10.x.x.60: {30}}`, `{12→10.x.x.60: {31}}`.

**2. Bridge half — `server/sacn_bridge.js`.** Add one module-scope map beside
`_mirrorDirty`:

```
const _mirrorSeen = new Map();      // destKey -> Set<sourceUniverse> since last emit
```

- In `mirrorInbound` (`:1427`), after `spliceMirrorFrame` returns the touched keys,
  record the arriving universe: `_mirrorSeen.get(key).add(universe)`. Keep the
  existing `_mirrorDirty.add(key)` and the single `setImmediate` schedule.
- In `flushMirrors` (`:1443`), emit a key **only** when
  `_mirrorSeen.get(key)` is a superset of `requiredSources(key)`. On emit, clear that
  key's seen-set and remove it from `_mirrorDirty`. **A key that is not yet complete
  stays dirty and stays scheduled** — re-arm the `setImmediate` if any key remains.

Result, against the measured patterns: `U2` goes from 2-3 sends/frame with 50-67 %
torn to **exactly 1.00 send/frame, 100 % fully fresh, in every arrival pattern**.
`U10`/`U12` are unchanged (single source ⇒ complete on arrival). Packet rate on the
gateway drops from ≈120/s to 40/s, which also closes H4.

**3. Silence must be loud, not a fallback (codex P0).** A destination whose source
universe stops arriving now stops emitting, and the box holds its last look. Do
**not** add a timeout that emits an incomplete frame — that reintroduces exactly the
torn frame this fixes. Instead add a watchdog that **reports**: if a destination has
been incomplete for more than ~250 ms, `console.warn` + `broadcastLog` **once** per
destination, naming the missing universes, e.g.
`⚠ 🪞 U2 → 10.x.x.10 has not composed for 312 ms — waiting on U5. The bench is
holding its last frame.` Clear the latch when it completes again.

**4. Free side effects.** The completeness gate means a freshly allocated state never
emits until all its sources have contributed, so **H5's 304-channel black flash on
re-arm and on any sidecar edit disappears** without touching the reuse key. Say so in
the v3 report rather than fixing H5 separately.

**5. Do not conflate with the two-writer defect.** This fix makes the mirror's packet
rate constant and its frames whole. It does **not** stop the sim's priority-150
stream (§1, `animate.js:713`, unmodified at `HEAD`). With the cadence fixed the
two-writer offset `d` stops drifting, which converts H2's multi-second beat into
either a clean win or a steady 80 Hz alternation (83.6 % likely). **F1 still has to be
fixed on its own.**

**6. Tests to add** (all offline, no port, no packet — the rig in
`tests/bench_mirror_arm.test.js` already supports this):
- feed the five source universes across 1, 2, 3 and 5 separate event-loop turns;
  assert **exactly one** composed send per destination per engine frame in all four,
  and that **every** emitted frame is fully fresh (no region carrying a previous
  frame's stamp). `~/tmp/bench_mirror_debug_153/jitter.cjs` is the working shape.
- assert a destination whose source universe never arrives emits **nothing** and logs
  the named warning exactly once.
- assert the single-source LED destinations are byte-identical before and after.
- assert a state reset followed by a complete arrival emits a full 344-channel frame,
  never the 40/344 partial.

## 10.5 Ranked answer

1. **H1 (cadence/tearing) + H5 (reset blanking)** — CONFIRMED-OFFLINE, mirror-side,
   fully fixable in the pipeline, and the U2-vs-U10 asymmetry matches the operator's
   observation exactly. **Fix first.**
2. **H2 (two writers, drifting sequence offset)** — the second writer is still in the
   code; H1 makes its beat sweep. NEEDS-LIVE-CAPTURE (§7 step A/B still applies).
3. **H4** — real but subsumed by the H1 fix.
4. **H3** — killed, one packet.
5. **§10.0.1** — the v2 sidecar / v3 parser mismatch is live and blocks arming
   entirely; land the file and the parser together.

## 10.6 Addendum hygiene

Read-only throughout: no source/test/scene edit, no git write, no port bound, no
packet, no process started. New scratch: `~/tmp/bench_mirror_debug_153/jitter.cjs`
and `jitter_output.txt`. `bench_mirror.cjs` changed under this run at 12:18:59 and
the change is disclosed in §10.0 rather than worked around silently; the compose
functions the measurements depend on were re-read after the change and are
byte-identical.
