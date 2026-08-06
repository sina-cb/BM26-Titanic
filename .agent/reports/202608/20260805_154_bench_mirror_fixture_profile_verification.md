# 20260805_154 — BENCH MIRROR: fixture-profile + address semantic verification

**Agent:** investigator (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_154`
**Predecessors:** `_89` (the mirror), `_105` (F3/F5/F8/F10/F12/M2), `_150` (audit),
`_151` (runtime ARM mode), `_152` (adversarial review, verdict SHIP).

**INVESTIGATION-ONLY.** Zero source/test/scene/doc edits outside this report and
the tracker landing block. Zero git write operations (`show` / `diff` / `log` /
`status` only). **No process started, no port bound, no sACN datagram, no device
HTTP, no ARM.** The operator's live stack (6966–6972, 5568, 8081, 10000) and every
controller on the LAN were never approached. Scratch lives in
`~/tmp/bench_mirror_fixtures_154/`.

IPs are redacted to `10.x.x.NN` in prose per `.agent/os/security_privacy.md`. The
scene/config files quoted carry the real values and were not edited.

**Analysed state:** the CURRENT working tree (what the failed physical test ran
against), with a `HEAD` diff for every file that matters — §7.

---

## 0. VERDICT

**Every slice is SEMANTICALLY COMPATIBLE, channel for channel. The fixture
profiles are not the bug.**

All 344 destination channels on the bench DMX gateway were checked mechanically
against the live scene data: **0 mismatches**. Source fixture type, personality,
channel function, footprint and start-address offset agree exactly on all five
DMX slices; both LED slices agree on stride, order, white lane and wire math.

**The smoking gun is a second writer that no amount of mirror correctness can
beat: the sim window itself.** In `sacn_in` mode — the *only* mode in which the
📡 sACN IN monitor (and therefore the ARM button) is even rendered — the sim tab
unicasts **every patched universe of the loaded scene straight to its real
controller at sACN priority 150**, including `U2 → 10.x.x.10` and
`U30/U31 → 10.x.x.60`. The mirror's composed frame goes out at the priority of
the source that fed it, which is the engine's **100**. 150 outranks 100 at the
box. The bench therefore plays **raw titanic U2** — and raw titanic U2 lands
animated pixel bytes on the bench pars' *strobe* and *function-selection*
channels, on both vintage heads' *effect-macro* channels, and on both bars'
*strobe / auto-function* channels. That is not a metaphor for "random"; that is
literally what the operator saw.

| slice | verdict |
|---|---|
| U6 ch1-40 → bench U2 ch1-40 (Pars 1-4) | **COMPATIBLE** — byte-identical semantics |
| U5 ch1-33 → bench U2 ch41-73 (Vintage Left) | **COMPATIBLE** |
| U5 ch34-66 → bench U2 ch74-106 (Vintage Right) | **COMPATIBLE** |
| U2 ch1-119 → bench U2 ch107-225 (Bar Left) | **COMPATIBLE** |
| U2 ch120-238 → bench U2 ch226-344 (Bar Right) | **COMPATIBLE** |
| U30 ch1-80 → `.60` U10 ch1-80 (LED_0) | **COMPATIBLE** at byte level; **UNPROVABLE** whether the board is listening on U10 |
| U31 ch1-80 → `.60` U12 ch1-80 (LED_1) | **COMPATIBLE** at byte level; **UNPROVABLE** whether the board is listening on U12 |

Everything below is the evidence.

---

## 1. SOURCE TRUTH — what actually occupies the titanic source addresses

Derived mechanically from `simulation/scenes/titanic/patches.yaml` +
`scene_config.yaml` (fixture types), cross-checked against the generated engine
model `marsin_engine/models/titanic.js` (which is what actually emits the bytes).
Both agree.

| source | fixture | type | personality | footprint | start |
|---|---|---|---|---|---|
| U6 ch1-10 | Left Auditorium 5 | `UkingPar` | 10-channel (`A001`) | 10 | 1 |
| U6 ch11-20 | Left Auditorium 6 | `UkingPar` | 10-channel | 10 | 11 |
| U6 ch21-30 | Left Auditorium 7 | `UkingPar` | 10-channel | 10 | 21 |
| U6 ch31-40 | Left Auditorium 8 | `UkingPar` | 10-channel | 10 | 31 |
| U5 ch1-33 | Left Front Rails 1 | `VintageLed` | 33-channel | 33 | 1 |
| U5 ch34-66 | Left Front Rails 2 | `VintageLed` | 33-channel | 33 | 34 |
| U2 ch1-119 | Left Front Wall 1 | `ShehdsBar` | 119-channel (hardware-verified) | 119 | 1 |
| U2 ch120-238 | Left Front Wall 2 | `ShehdsBar` | 119-channel | 119 | 120 |
| U30 ch1-160 | Left_Front_Left | LED strand | RGBW stride 4, `whiteMode: native` | 160 (40 px) | 1 |
| U31 ch1-160 | Left_Back_Left | LED strand | RGBW stride 4, `whiteMode: native` | 160 (40 px) | 1 |

Neighbours (proof that the slices do not cross a fixture boundary): U5 continues
with Left Front Rails 3 @67 and 4 @100; U6 ends at ch40 (nothing after); U2 ends
at ch238 (nothing after — ch239-512 unpatched, so those bytes are 0).

**Channel maps the engine actually writes** (`simulation/src/dmx/sacn_mapper.js`
`mapPixelsToSacn` + `suppressNativeStrobes`, imported by `marsin_engine/engine.js:61`):

- `UkingPar` — ch1 **forced to 255** (master dimmer, `sacn_mapper.js:302-303`),
  ch2=R ch3=G ch4=B ch5=W ch6=Amber ch7=Purple, **ch8 forced to 0** (native strobe
  suppressed, `NATIVE_STROBE_CHANNELS.UkingPar = [8]`), ch9 (function select) and
  ch10 (function speed) never written ⇒ 0 ⇒ "Manual — CH1–CH7 control".
- `VintageLed` — ch1 **forced 255**, **ch2 forced 0** (strobe suppressed),
  ch3-8 = the six heads' W lane, ch9-11 (global aux RGB) never written ⇒ 0,
  ch12-15 (main/aux effect + speeds) never written ⇒ 0 ⇒ "No effect",
  ch16-33 = 6 heads × RGB.
- `ShehdsBar` — ch1 **forced 255**, ch2-11 never written ⇒ 0 (strobe off,
  Function off, Speed 0, BG Color 0, master Dim-RGBWAV 0 — deliberate, see the
  comment at `sacn_mapper.js:305-306`), ch12-119 = 18 px × [R,G,B,W,A,V].
- LED strand — `ledWireBytes()` (`src/dmx/led_wire.js`): amber folded into RGB,
  UV dropped, over-unity scaled, W = the pattern's own white lane
  (`whiteMode: native`), 4 bytes/px in **RGBW** order.

---

## 2. DEST TRUTH — what the bench actually is

From `simulation/scenes/test_bench/patches.yaml` + `scene_config.yaml` +
`controllers.yaml`, cross-checked against `marsin_engine/models/test_bench.js`.

| bench fixture | type | footprint | U2 range | gateway port |
|---|---|---|---|---|
| Par 1 | `UkingPar` | **10** | 1-10 | port 1 (U2) |
| Par 2 | `UkingPar` | 10 | 11-20 | port 1 |
| Par 3 | `UkingPar` | 10 | 21-30 | port 1 |
| Par 4 | `UkingPar` | 10 | 31-40 | port 1 |
| Vintage Left | `VintageLed` | 33 | 41-73 | port 3 |
| Vintage Right | `VintageLed` | 33 | 74-106 | port 3 |
| Bar Left | `ShehdsBar` | 119 | 107-225 | port 2 |
| Bar Right | `ShehdsBar` | 119 | **226-344** | port 2 |
| LED_0 | strand, 20 px RGBW | 80 | U10 ch1-80 @ `10.x.x.60` out 1 | — |
| LED_1 | strand, 20 px RGBW | 80 | U12 ch1-80 @ `10.x.x.60` out 2 | — |

Answers to the brief's explicit questions:

- **Do the pars really span 10 channels each?** Yes — `UkingPar` resolves to the
  10-channel personality (`dmx/fixtures/uking_rgbwau_par_light/channels_10.yaml`),
  and the patch spacing 1/11/21/31 is exactly 10.
- **What occupies bench U2 after each fixture ends?** Nothing between them — the
  eight fixtures tile ch1-344 contiguously with **no gaps and no overlaps**
  (verified by enumeration). After ch344: **nothing at all** on U2. The bench's
  haze/fog live on **U1** ch510/512, a different universe the mirror never
  touches.
- **Does anything cross the U2 ch344 edge?** No. `226 + 119 - 1 = 344 ≤ 512`.
  The mirror writes a full 512-channel payload with ch345-512 = 0, which is
  correct: nothing is patched there.

---

## 3. THE TABLE — profile compatibility, channel by channel

Method: for every destination channel `d` in 1..344, resolve
`(source universe, source channel)` from the sidecar slice, then compare the
**fixture type** and the **relative channel index within the fixture** on both
sides. Any drift in type or offset is a mismatch. Script:
`~/tmp/bench_mirror_fixtures_154/verify.cjs` (reads the live scene YAMLs + the
three fixture personality YAMLs; writes nothing).

| # | bench fixture | source range → meaning | dest range → physical interpretation | mismatches | verdict |
|---|---|---|---|---|---|
| 1 | Par 1 | U6 ch1-10 = **Left Auditorium 5**, `UkingPar` 10ch, rel 1-10 | U2 ch1-10, `UkingPar` 10ch, rel 1-10 | **0/10** | **COMPATIBLE** |
| 2 | Par 2 | U6 ch11-20 = Left Auditorium 6, rel 1-10 | U2 ch11-20, rel 1-10 | **0/10** | **COMPATIBLE** |
| 3 | Par 3 | U6 ch21-30 = Left Auditorium 7, rel 1-10 | U2 ch21-30, rel 1-10 | **0/10** | **COMPATIBLE** |
| 4 | Par 4 | U6 ch31-40 = Left Auditorium 8, rel 1-10 | U2 ch31-40, rel 1-10 | **0/10** | **COMPATIBLE** |
| 5 | Vintage Left | U5 ch1-33 = **Left Front Rails 1**, `VintageLed` 33ch, rel 1-33 | U2 ch41-73, `VintageLed` 33ch, rel 1-33 | **0/33** | **COMPATIBLE** |
| 6 | Vintage Right | U5 ch34-66 = Left Front Rails 2, rel 1-33 | U2 ch74-106, rel 1-33 | **0/33** | **COMPATIBLE** |
| 7 | Bar Left | U2 ch1-119 = **Left Front Wall 1**, `ShehdsBar` 119ch, rel 1-119 | U2 ch107-225, `ShehdsBar` 119ch, rel 1-119 | **0/119** | **COMPATIBLE** |
| 8 | Bar Right | U2 ch120-238 = Left Front Wall 2, rel 1-119 | U2 ch226-344, rel 1-119 | **0/119** | **COMPATIBLE** |
| 9 | LED_0 | U30 ch1-80 = Left_Front_Left px 1-20, RGBW×4 | `.60` U10 ch1-80, 20 px RGBW×4, `startAddress: 1` | 0/80 | **COMPATIBLE** (byte level) |
| 10 | LED_1 | U31 ch1-80 = Left_Back_Left px 1-20, RGBW×4 | `.60` U12 ch1-80, 20 px RGBW×4 | 0/80 | **COMPATIBLE** (byte level) |

**Total: 344 / 344 destination channels checked on the DMX gateway, 0 mismatches.**
Every slice starts on a fixture boundary on both sides, every slice length equals
that fixture's footprint, no slice crosses a fixture boundary, and the eight
destination fixtures are exactly covered with no channel written twice and no
patched channel left unfed.

Spot-check of the classes the brief called out:

| function class | source ch | dest ch | agree? |
|---|---|---|---|
| Par master dimmer | U6 ch1 (LA5 ch1 Total dimming) | U2 ch1 (Par 1 Total dimming) | ✅ |
| Par strobe | U6 ch8 (LA5 ch8 Total strobe) | U2 ch8 (Par 1 Total strobe) | ✅ |
| Par macro (Function selection) | U6 ch9 | U2 ch9 | ✅ |
| Par white / amber / purple order | U6 ch5/6/7 (W, Amber, Purple) | U2 ch5/6/7 | ✅ |
| Vintage master dimmer / strobe | U5 ch1 / ch2 | U2 ch41 / ch42 | ✅ |
| Vintage Main Light Effect (macro) | U5 ch12 | U2 ch52 | ✅ |
| Vintage Aux Light Effect (macro) | U5 ch14 | U2 ch54 | ✅ |
| Bar Dimmer / Strobe / Function / Speed / BG | U2 ch1-5 | U2 ch107-111 | ✅ |
| Bar master Dim-R…Dim-Violet | U2 ch6-11 | U2 ch112-117 | ✅ |
| Bar pixel 1 R,G,B,W,A,V | U2 ch12-17 | U2 ch118-123 | ✅ |

**8-bit only.** None of the three personalities declares a 16-bit / fine channel
pair, so there is no coarse/fine split to break across a slice boundary.
**No mode/personality-selection channel exists in the DMX stream** for any of the
three families — personality is set in the fixture's own menu, not over DMX. That
makes it the one thing the repo cannot prove; see §6.

---

## 4. LED SEMANTICS

| property | source (titanic U30/U31) | dest (bench LED_0/LED_1) | agree? |
|---|---|---|---|
| bytes/pixel (stride) | 4 | 4 | ✅ |
| channel order | **RGBW** (`channels {r:1,g:2,b:3,w:4}`) | RGBW (`order: RGBW, stride: 4`) | ✅ |
| white lane | `whiteMode: native` | `whiteMode: native` | ✅ |
| start address | 1 | 1 (`startAddress: 1`) | ✅ |
| amber folding | `foldAmber: true` (via `LED_WIRE_DEFAULTS` — the titanic controller card declares **no** `wire:` block) | `foldAmber: true` (explicit) | ✅ |
| amber→RGB weights | `[0.9, 0.6, 0.0]` (default) | `[0.9, 0.6, 0.0]` (explicit) | ✅ |
| controller white model | `fold_extract` (default) | `fold_extract` (explicit) | ✅ |
| controller gamma | 1.0 (default) | 2.2 (explicit) | ⚠ **preview-only — does NOT reach the wire** |
| pixels carried | first 20 of 40 | 20 | ✅ (documented `_89` caveat) |

**The RGB-vs-RGBW hypothesis in the brief is DISPROVEN.** The titanic ropes are
not RGB-packed at 3 bytes/pixel — the generated model gives every strand pixel
`footprint: 4` and `channels {r:1,g:2,b:3,w:4}`, addresses stepping 1,5,9,…,157
for 40 pixels = 160 channels. 80 channels of that is exactly 20 whole RGBW
pixels. No stride shift is possible.

**The gamma delta is cosmetic, not structural.** `controllerGamma` is consumed
only by the *preview* path (`ledPreviewRgbFromBytes`); the wire bytes come from
`ledCompositeTarget` → `ledCompositeToBytes`, neither of which reads it
(`sacn_mapper.js:308-317` states this explicitly: "Gamma is NOT applied here —
the LED controller owns the only gamma curve in the chain"). So the bytes the
mirror carries are the same bytes a native bench run would put on that wire.

**What is UNPROVABLE:** whether the physical board at `10.x.x.60` is currently
listening on U10/U12 at all. Two scene cards claim the same `boardId:
angio4-old` under two different `controllerId`s, and the receipts disagree —
titanic's `LeftLeftRopes` (U30/U31) reads `applied`, test_bench's `Titanic_202`
(U10/U12) reads **`needs-reboot`** (working tree; `HEAD` had `applied` on an
older date — the operator re-pushed the bench binding, §7). If the board has not
been power-cycled since, it is still on U30/U31 and the mirror's U10/U12 frames
are discarded at the box. Physical check: §6.

---

## 5. RANKED MISMATCHES THAT PRESENT AS "RANDOM COLORS"

None of these is a fixture-profile mismatch. Ranked by how completely each one
explains the observed failure.

### M1 — SMOKING GUN. The sim window is a priority-150 writer to the same controllers, and it wins

**`simulation/src/core/animate.js:696-724`:**

```js
// In sacn_in mode: relay ALL universes to controllers (simulation acts as bridge)
if (!isEffect && lightingMode !== 'sacn_in' && !isMappingOutput) continue;
…
outputGroups.set(key, { universe: u, ip, priority: 150 });
…
const fullFrame = window.dmxRouter.getFullFrame(group.universe);
sacnOutputClient.sendUniverse(group.universe, group.ip, group.priority, fullFrame);
```

With `lightingMode === 'sacn_in'` the `continue` never fires, so **every** patched
`(universe, controllerIp)` pair of the **loaded scene** is unicast to the real
controller at **priority 150** through `server/sacn_output_bridge.js` (:6972).
With the sim on `titanic` that set includes `U2 → 10.x.x.10`,
`U30 → 10.x.x.60` and `U31 → 10.x.x.60` — the mirror's three owned destinations.

The mirror's frames go out at the **source frame's** priority
(`sacn_bridge.js:1427-1436`: `_mirrorPriority.set(key, priority)`), and the engine
sends at **100** (`marsin_engine/config.yaml` → `sacn.priority: 100`;
`lib/sacn_output.js:23`). **150 > 100.**

In `sacn_in` mode the sim never rewrites its own router from rendered pixels —
`mapPixelsToSacn` is in the `else if (mappingEnabled)` branch
(`animate.js:497-519`) — so what it retransmits is the **raw received titanic
frame**, byte-accurate.

**Why this is structural, not bad luck:** the ARM control lives in the 📡 sACN IN
monitor, and that panel is rendered only when the lighting engine mode **is**
`sacn_in` (`gui_builder.js`, `pattern_editor.js` →
`showSacnInMonitor(mode === 'sacn_in' && enabled)`). The operator cannot arm the
mirror without being in the exact mode that makes the sim outrank it.

**Byte-level evidence — what raw titanic U2 does to the bench.** Source content
(from §1): `ch1=255`, `ch2-11=0`, `ch12-119` = LFW1's 18 px × RGBWAV, `ch120=255`,
`ch121-130=0`, `ch131-238` = LFW2's 18 px, `ch239-512=0`.

| bench channel | bench function | receives (raw titanic U2) | effect |
|---|---|---|---|
| ch1 | Par 1 Total dimming | LFW1 ch1 Dimmer = 255 | full |
| ch2-7 | Par 1 R,G,B,W,Amber,Purple | LFW1 ch2-7 = **0** | **Par 1 dark** |
| ch8 | **Par 1 Total strobe** | LFW1 ch8 Dim-Blue = 0 | off |
| ch11 | Par 2 Total dimming | LFW1 ch11 Dim-Violet = 0 | **Par 2 dark** |
| ch18 | **Par 2 Total strobe** | LFW1 **px2 Red** (animated) | **strobes with the red channel** |
| ch19 | **Par 2 Function selection** | LFW1 **px2 Green** (animated) | **jumps between manual / colour-macro / jump / gradate / pulse / sound-active** |
| ch21 | Par 3 Total dimming | LFW1 px2 White | flickers |
| ch28 | **Par 3 Total strobe** | LFW1 **px3 Amber** | **strobes** |
| ch29 | **Par 3 Function selection** | LFW1 **px3 Violet** | **macro roulette** |
| ch38 | **Par 4 Total strobe** | LFW1 **px5 Blue** | **strobes** |
| ch39 | **Par 4 Function selection** | LFW1 **px5 White** | **macro roulette** |
| ch42 | **Vintage Left Total Strobe** | LFW1 **px6 Red** | **strobes** |
| ch52 | **Vintage Left Main Light Effect** | LFW1 **px7 Amber** | **runs the fixture's own built-in chases (values ≥5)** |
| ch54 | **Vintage Left Auxiliary Light Effect** | LFW1 **px8 Red** | **runs aux chases** |
| ch75 | **Vintage Right Total Strobe** | LFW1 **px11 White** | **strobes** |
| ch85/ch87 | **Vintage Right Main / Aux Light Effect** | LFW1 px13 Green / px13 White | **chases** |
| ch108 | **Bar Left Strobe** | LFW1 **px17 Red** | **strobes** |
| ch109 | **Bar Left Function** (auto mode select) | LFW1 **px17 Green** | **drops into auto mode** |
| ch227 | **Bar Right Strobe** | LFW2 px17 Red | **strobes** |
| ch228 | **Bar Right Function** | LFW2 px17 Green | **auto mode** |

Animated colour data landing on strobe and macro channels of four pars, two
vintage heads and two bars is a byte-exact match for "apparently random output
and colors". **This is the failure the operator reported.**

**Aggravator:** the same mechanism sends raw `U30/U31 → 10.x.x.60` at 150,
which **defeats `suppress_host: true`**. `_151` §9.3 promises that while armed,
"dark strands mean the board is not on U10/U12" — that promise does not hold,
because the sim tab (not the bridge relay) is still lighting them on U30/U31.

**Why the existing ARM warning misses it** — `lib/bench_mirror.cjs:602-607`:

```js
if (Number(clientCount) > 1) {
  base.warnings.push(`⚠ … in sACN-OUT mode every extra window is an independent
    priority-150 writer that OUTRANKS the composed mirror frame at the box …`);
}
```

Two errors: it fires only at **more than one** window (one is already enough),
and it attributes the behaviour to **sACN-OUT** mode when `animate.js:709` puts it
squarely in **`sacn_in`** mode. Nothing anywhere in `animate.js`,
`sacn_output_client.js` or `sacn_output_bridge.js` references the bench mirror —
grep-confirmed, zero hits.

### M2 — The relay path produces the identical garbage, so a failed/absent ARM is indistinguishable

If the ARM never took effect (refused, auto-disarmed on the 3 s engine poll, or
simply not pressed), the ordinary bridge relay sends **raw titanic U2** to
`10.x.x.10` — the very same bytes as M1, with the very same visual result. The
observed symptom therefore **cannot** distinguish "mirror inactive" from "mirror
active but outranked". Any retest must read the bridge's own transition lines
(`🪞 BENCH MIRROR ACTIVE`, `🚫 Relay suppressed`) before trusting the fixtures.

### M3 — `_105` F8 quantisation: the mirror is not byte-transparent

`lib/bench_mirror.cjs:271` allocates a `Uint8Array(512)` and `:302` truncates the
`sacn` package's **2-decimal percent** float into it
(`node_modules/sacn/dist/util.js:13-20`: `data[ch+1] = dp(val/2.55, 2)`), then
`mirrorPayload` hands those integers back to a sender that re-multiplies by 2.55
(`packet.js:132-138`). Measured round-trip over all 256 values:

| source byte | mirrored byte | Δ |
|---|---|---|
| 0 | 0 | 0 |
| **1** | **0** | **−1 (lost)** |
| **2** | **0** | **−2 (lost)** |
| 3 | 3 | 0 |
| 100 | 99 | −1 |
| 127 | 125 | −2 |
| 128 | 127 | −1 |
| 200 | 199 | −1 |
| 254 | 252 | −2 |
| 255 | 255 | 0 |

**54 of 256 values survive exactly; worst error −3; DMX 1 and 2 collapse to 0.**
Not a "random colour" mechanism — a low-end crush and a ≤3-step dimness bias —
but it must be in the truth-test expectations (§8) or the tests will fail for the
wrong reason. Still unfixed: `useRawDmxValues` appears only inside
`node_modules/sacn/`, nowhere in project source.

### M4 — Bench LED strands can be lit by three different things

While armed, `10.x.x.60` can receive: the mirror's composed U10/U12 @100, the
sim tab's raw U30/U31 @150 (M1), and — if the whole-host suppression is working —
nothing else from the bridge. Combined with the unresolved
`applied` (U30/U31) vs `needs-reboot` (U10/U12) receipt conflict on one board
(§4, §7), the strands' appearance proves nothing about the mirror either way.

### M5 — Cosmetic-only deltas, listed so they are not mistaken for bugs

- **Bench strands show 20 of the rope's 40 pixels** — by design (`_89`).
- **`controllerGamma` 1.0 vs 2.2** — preview-only, never on the wire (§4). The
  *device-side* gamma is whichever push is live on the board, which is a real
  appearance delta and an open reconcile hazard, not a mirror defect.
- **`_105` F3** — the browser's own preview reads these frames as percent (0-100)
  in a byte lane, so the sim's on-screen brightness is ~39 % of the truth. Does
  not affect the retransmitted bytes (they are re-scaled ×2.55 on the way out).

---

## 6. UNPROVABLE FROM THE REPO — exact physical checks

The repo describes the *intended* personality of every fixture. It cannot read
the DIP switches / menus of the boxes on the bench. Each item below is stated
with the diagnostic signature so the operator can confirm in seconds.

| # | claim the repo cannot prove | physical check | signature if wrong |
|---|---|---|---|
| U1 | The four bench pars are in the **10-channel** personality (`A001`), not the 6-channel one (`d001`) | Par menu → mode readout; must show the 10-ch code | In 6-ch mode ch1 is **Red**, not dimmer; each par would read the *next* par's channels; pars 2-4 would show colours belonging to their neighbours and the last would be dark |
| U2 | Both bench vintage heads are in the **33-channel** mode, not 15-channel | Fixture menu → channel-mode readout | In 15-ch mode ch16-33 (the per-head RGB the engine drives) do not exist; the heads would show only the six warm-white lanes and the aux RGB globals |
| U3 | Both bench bars are in the **119-channel** mode (hardware-verified variant), not 12 / 108 | Bar menu → channel count | In 108-ch mode the 11 master channels vanish and every pixel shifts by 11; in 12-ch mode only masters respond |
| U4 | Bench DMX start addresses are physically 1 / 11 / 21 / 31 / 41 / 74 / 107 / 226 | Each fixture's address readout | Any offset re-creates exactly the M1-class strobe/macro corruption |
| U5 | The board at `10.x.x.60` is running the **bench** binding (U10 / U12) | `GET http://<the .60 IP>/api/config` → `strands[].dmxUniverse`; corroborate with `/api/status` → `sacn.lastUniverse`, `rxPackets`, per-output `framesPresented`. Both are reads. (`_151` §9.4 documents this; it was not run then and was not run now.) | `30`/`31` ⇒ still on the ship binding, mirror frames discarded |
| U6 | The bench DMX gateway implements E1.31 **priority arbitration** | Two-source test, or the gateway's manual | If it does *not* arbitrate (many cheap gateways take last-received or HTP-merge), M1 produces a *flickering* blend of composed and raw frames rather than a clean 150-wins — visually even more "random" |

**Strong circumstantial argument for U1-U4:** the bench scene drives these exact
fixtures at these exact addresses and footprints in ordinary use. If the bench
renders its own `test_bench` scene correctly, U1-U4 are proven by construction —
and the mirror's source profiles are byte-identical to them (§3). Ask the
operator whether the bench looks right on its own scene; that single answer
retires four unknowns.

---

## 7. WORKING TREE vs `HEAD` — what the failed test actually ran against

`git diff` (read-only) over `simulation/scenes/**` and `marsin_engine/models/**`:

| file | change | affects the mirror? |
|---|---|---|
| `scenes/titanic/patches.yaml` | **unmodified** | — |
| `scenes/titanic/controllers.yaml` | **unmodified** | — |
| `scenes/test_bench/patches.yaml` | removed two unpatched `TE Sign V3 A/B` entries (`dmxUniverse: 0`, `dmxAddress: 0`) | **No** — they were never on U2 |
| `scenes/test_bench/controllers.yaml` | added `output: 1` / `output: 2` to the two LED ports; added `parkedOutputs` (out 3 @ U11); **`Titanic_202` lastPush `applied` (older) → `needs-reboot` (current session)** | **Yes, for the LED slices only** — the bench binding was re-pushed and is unconfirmed |
| `scenes/test_bench/scene_config.yaml` | `generatorsVisible`, two par X positions, `haloScale: 1` on each fixture | **No** — no `fixtureType` changed |
| `scenes/test_bench/bench_mirror.yaml` | `_151`'s v1→v2 (`label`, three `suppress_host`); **mapping byte-identical to `HEAD`** (re-confirmed here, and independently by `_152` §2.6) | mapping unchanged |
| `marsin_engine/models/test_bench.js` | TE-Sign removal + coordinate churn | **No** — the engine runs `titanic` while armed |
| playlists, `common.yaml`, `titanic/pixel_map_views.yaml` | content/view churn | **No** |

**The "stale source addressing" hypothesis is DISPROVEN.** `titanic/patches.yaml`
and `titanic/controllers.yaml` are at `HEAD` and their last change (`70bc617b`)
still leaves U6 = four `UkingPar` at 1/11/21/31, U5 = `VintageLed` at 1/34/67/100,
U2 = two `ShehdsBar` at 1/120 — exactly what the sidecar assumes. Verified against
both the scene YAML and the generated engine model.

**One test-coverage gap found while here:** the live-map test
`tests/bench_mirror.test.js:490` asserts *"every DMX slice lands on a bench
fixture of the SAME footprint"* — footprint only. Two different 33-channel
fixtures would pass it. Today the types do match (§3), but the assertion does not
prove what its name implies. Worth tightening to compare `fixtureType`.

---

## 8. DETERMINISTIC TRUTH-TEST EXPECTATION TABLE

For the implementation owner to turn into tests. Six constant looks, driven on
the titanic model, read at the bench. **Every "mirrored" column already includes
the M3 quantisation** — do not expect byte-transparency.

**Quantisation rule** (apply to every source byte):
`p = round(b/2.55, 2)` → `t = trunc(p)` → `mirrored = clamp(round(t × 2.55), 0, 255)`.
Fixed points used below: `0→0`, `3→3`, `26→26`, `64→64`, `153→153`, `255→255`;
`1→0`, `2→0`, `128→127`, `230→229`.

### 8.1 UkingPar (bench Par 1-4 @ 1/11/21/31 ← titanic Left Auditorium 5-8, U6)

Relative channel: 1 Dim · 2 R · 3 G · 4 B · 5 W · 6 Amber · 7 Purple · 8 Strobe ·
9 FuncSel · 10 FuncSpeed. W is host-synthesised as `min(R,G,B)` when the pattern
gives no explicit white (`sacn_mapper.js:359-369`).

| look | source bytes (rel 1-10) | mirrored bytes | expected physical |
|---|---|---|---|
| **RED** | 255,255,0,0,0,0,0,0,0,0 | identical | full-bright red, no strobe, manual mode |
| **GREEN** | 255,0,255,0,0,0,0,0,0,0 | identical | full green |
| **BLUE** | 255,0,0,255,0,0,0,0,0,0 | identical | full blue |
| **RGB-WHITE** (r=g=b=1, w=0) | 255,255,255,255,**255**,0,0,0,0,0 | identical | white **including the dedicated W emitter** — ch5 is `min(R,G,B)`, not 0. Expect this, or the test fails for the wrong reason |
| **NATIVE WHITE/AMBER** (w=1, a=1, rgb=0) | 255,0,0,0,**255**,**255**,0,0,0,0 | identical | warm white + amber emitters only |
| **BLACKOUT** | **255**,0,0,0,0,0,0,0,0,0 | identical | dark. **ch1 stays 255** — the mapper always forces the master dimmer; darkness comes from the colour lanes |

### 8.2 VintageLed (bench Vintage L/R @ 41/74 ← Left Front Rails 1/2, U5)

Relative: 1 Dim · 2 Strobe · 3-8 warm-white per head 1-6 · 9-11 aux RGB globals ·
12 MainEffect · 13 MainEffectSpeed · 14 AuxEffect · 15 AuxEffectSpeed ·
16-33 aux R,G,B per head 1-6.

| look | source bytes | mirrored | expected physical |
|---|---|---|---|
| **RED** | rel1=255; rel2=0; rel3-8=**0**; rel9-15=0; rel16,19,22,25,28,31=255, rest of 16-33=0 | identical | all six heads red, **no warm-white**, no strobe, **no effect running** |
| **GREEN** | rel17,20,23,26,29,32=255 | identical | six heads green |
| **BLUE** | rel18,21,24,27,30,33=255 | identical | six heads blue |
| **RGB-WHITE** | rel3-8=**255** (W=min(R,G,B)=255) and rel16-33=255 | identical | heads white **plus** the warm-white lanes lit |
| **NATIVE WHITE** (w=1, rgb=0) | rel3-8=255, rel16-33=0 | identical | warm-white lanes only, aux RGB dark |
| **BLACKOUT** | rel1=255, everything else 0 | identical | dark, **rel12 and rel14 MUST read 0** ("No effect") |

**Regression assertion worth pinning:** rel2 (Strobe), rel12 and rel14 (effect
macros) must be **0** in every look. A non-zero there is the M1 signature.

### 8.3 ShehdsBar (bench Bar L/R @ 107/226 ← Left Front Wall 1/2, U2)

Relative: 1 Dimmer · 2 Strobe · 3 Function · 4 Speed · 5 BG Color ·
6-11 Dim-R/G/B/W/A/V · 12+ 18 px × [R,G,B,W,A,V].

| look | source bytes | mirrored | expected physical |
|---|---|---|---|
| **RED** | rel1=255; rel2-11=**0**; every px R=255, G/B/W/A/V=0 | identical | all 18 px red, no strobe, no auto mode |
| **GREEN** | px G=255 | identical | 18 px green |
| **BLUE** | px B=255 | identical | 18 px blue |
| **RGB-WHITE** | px R,G,B=255 and **px W=255** (host-synth `min`) | identical | white incl. the W emitter |
| **NATIVE WHITE/AMBER** | px W=255 / px A=255, RGB=0 | identical | white-only / amber-only emitters |
| **BLACKOUT** | rel1=255, all pixels 0 | identical | dark |

**Regression assertion:** rel2 (Strobe) and rel3 (Function) must be **0**; rel6-11
must be **0** (deliberate, `sacn_mapper.js:305-306`).

### 8.4 LED strands (bench LED_0/LED_1 ← Left_Front_Left / Left_Back_Left px 1-20)

Per pixel, 4 bytes RGBW. Wire math: `ledCompositeTarget` → `ledCompositeToBytes`.

| look | wire bytes per px (R,G,B,W) | mirrored (after M3) | expected physical |
|---|---|---|---|
| **RED** (r=1) | 255,0,0,0 | 255,0,0,0 | 20 px red |
| **GREEN** (g=1) | 0,255,0,0 | 0,255,0,0 | 20 px green |
| **BLUE** (b=1) | 0,0,255,0 | 0,0,255,0 | 20 px blue |
| **RGB-WHITE** (r=g=b=1, w=0) | 255,255,255,0 | identical | RGB white, **W emitter dark** |
| **NATIVE WHITE** (w=1, rgb=0) | 0,0,0,255 | identical | **W emitter only** — this is the one that proves the RGBW stride: a stride bug lights the *next* pixel's red instead |
| **AMBER** (a=1, foldAmber) | 230,153,0,0 | **229**,153,0,0 | warm amber (folding, no amber emitter on a strand). Note the −1 from M3 |
| **BLACKOUT** | 0,0,0,0 | 0,0,0,0 | dark |

**The decisive LED test is NATIVE WHITE.** 20 px of `(0,0,0,255)` = channels
4,8,12,…,80. If the strand instead shows a colour march, the stride/order
assumption is wrong. If it shows nothing at all, the board is not on U10/U12
(check U5 in §6).

### 8.5 The test that must run FIRST

Before any of the above: **prove there is exactly one writer.** With the mirror
armed, the bench gateway must be receiving *only* the composed frame. Cheapest
repo-side proof, no hardware: assert that while `lightingMode === 'sacn_in'`, the
sim's output loop skips every `(universe, ip)` pair the bridge reports as
mirror-owned. That gate does not exist today (§5 M1) — it is the fix this
investigation points at, and every truth test above is meaningless until it
lands.

---

## 9. WHAT THE IMPLEMENTATION OWNER SHOULD DO

1. **Close M1.** While armed, the sim window must not unicast to a mirror-owned
   pair. The bridge already broadcasts `benchMirrorStatus` with `destinations[]`
   and `hosts[]` to every client (`_151` §5) — `animate.js:696-724` can consult
   `window.sacnInput.stats.benchMirror` and skip those `(universe, ip)` keys, and
   the whole-host entries too. Fail loudly if the status is unknown while armed.
2. **Fix the ARM warning.** `bench_mirror.cjs:602-607` should warn at
   `clientCount >= 1`, and say **`sacn_in`**, not "sACN-OUT" — one window is
   already the hazard, and `sacn_in` is the only mode the ARM button exists in.
3. **Retract the `_151` §9.3 promise** ("dark strands mean the board is not on
   U10/U12") until (1) lands — the sim's raw U30/U31 defeats
   `suppress_host: true` from outside the bridge.
4. **Tighten the live-map test** (`bench_mirror.test.js:490`) to compare
   `fixtureType`, not just footprint.
5. **`_105` F8** stays open and must be encoded into the truth tests (§8), not
   worked around.
6. **Operator-only:** the `10.x.x.60` board state (§6 U5) and the
   `controllerId` divergence for `boardId: angio4-old` (`testbench` in the titanic
   scene vs `titanic_202` in test_bench) — one board, two identities, receipts
   disagreeing.

---

## 10. HYGIENE

- **Zero writes** outside this report and the tracker landing block. No source,
  test, scene or doc edit. No git write operation — `show`, `diff`, `log`,
  `status` only.
- **No process started**: no engine, no sim, no bridge, no launcher. **No port
  bound.** No sACN datagram, no multicast join, no device HTTP, no ARM.
- Two read-only analysis scripts ran under `~/tmp/bench_mirror_fixtures_154/`
  (`dump.cjs`, `verify.cjs`) plus one `node -e` quantisation calculation. They
  read scene YAML, fixture personality YAML and the generated engine models, and
  write nothing. Nothing was created in the source tree.
- Every claim is a file read, a `git diff`/`git log`, or a computation over those
  files; citations are `file:line` against the working tree on `feat/bm_readiness`.
- IPs redacted to `10.x.x.NN` in prose throughout.
