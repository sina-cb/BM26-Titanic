# `_170` — RAW DMX on the wire (S-D1): the ×2.55 percent clip is gone

**Slice:** `_157` **S-D1**, the whole of it, nothing else. Operator-authorised
("do #4"). **Branch:** `feat/bm_readiness`. **No git operations.** No operator
process touched, no port bound, no packet put on a wire — every measurement in
this report was made in-process against the vendored `sacn` package's own
`Packet` class.

Fixes `_157` **D1** = `_153` **F1b** + **F7** = `_105` **F3** + **F8**. One root
cause, four symptoms, one change.

---

## 1. Mechanism

The vendored `sacn@4.6.2` treats `Sender.send({ payload })` as a **0..100
PERCENT** field. `packet.js:132-139`:

```js
n[125 + +ch] = this.useRawDmxValues ? inRange(this.payload[ch])
                                    : inRange(this.payload[ch] * 2.55);
```

and on receive `util.js:objectify` divides every wire byte by 2.55. **No project
source set `useRawDmxValues` and every project source wrote raw 0-255 DMX into
`payload`.** So the field meant one thing to the package and the opposite thing
to every call site in this repo, in both directions at once.

Measured with the real `Packet`, before the fix
(`~/tmp/fix_170/before.cjs`):

```
DMX value          :  0    1    2   32   50   64   99  100  101  127  128  180  200  254  255
byte on the wire   :  0    3    5   82  127  163  252  255  255  255  255  255  255  255  255
value at the bridge:  0 1.18 1.96 32.2 49.8 63.9 98.8  100  100  100  100  100  100  100  100
mirror -> wire     :  0    3    3   82  125  161  250  255  255  255  255  255  255  255  255
```

**Exact round-trips before the fix: 2 of 256** (0 and 255) — on both the engine
lane and the mirror lane. Everything the engine rendered above DMX 100 left as
full, so colour was crushed toward white on every controller on the ship; the
bridge handed the browser 0-100 "DMX" bytes, which is `_105` F3's 39 % preview;
and the mirror truncated those percent floats into a `Uint8Array`, which is F7's
~100-level quantisation on top.

### The fix, end to end

1. **All four senders declare `useRawDmxValues: true`** in
   `defaultPacketOptions` (spread first inside `Sender.send()`, so it survives
   every frame including blackouts): the engine's output, the sim's output
   bridge pool, the input bridge's relay routes, the bench-mirror senders.
2. **The receive path reads `packet.payloadAsBuffer`**, not `packet.payload` —
   the untouched inbound DMX slice — via a new `rawDmxPayload(packet)` in
   `sacn_bridge.js`. Everything downstream of `routeFrame` (relay resend, mirror
   splice, WebSocket broadcast) therefore carries raw bytes.
3. **The browser needed no change.** `sacn_mapper.js`'s `/255` was always the
   right arithmetic for raw DMX; it was being fed the wrong unit. The `/255`
   stays and now means what it says. Nothing in the repo ever compensated with a
   `2.55` of its own — a repo-wide grep confirms zero such call sites — so there
   was no compensation to remove, only a unit to correct.
4. **The mirror needed no arithmetic change either.** `spliceMirrorFrame` writes
   integers into its `Uint8Array` now instead of floats, so F7's truncation is
   gone with the unit rather than with a rounding fix.

### The pitfall, heeded

`_157` §1 warns: do **not** hand `packet.payloadAsBuffer` back to
`Sender.send({ payload })`. `Packet`'s getter objectifies a Buffer payload to
percent, and `useRawDmxValues` then writes that percent *as the byte*. Measured:

```
naive Buffer-as-payload resend:  0->0   1->0   64->25   128->50   200->78   255->100
```

— **2.55× DARK**, exactly as predicted. `rawDmxPayload` therefore returns a plain
1-indexed object of raw numbers, never the Buffer. There is an executable guard
for this in `simulation/tests/engine_bridge_contract.test.js`
("R-D1 PITFALL GUARD").

### Shape deliberately unchanged

`rawDmxPayload` keeps `objectify`'s **sparse** shape (zero channels omitted).
Only the UNIT moves. The dark channels still reach the fixture as explicit zeros
because the packet builder zero-fills all 512 slots (`empty(512)`, pinned by
`marsin_engine/tests/io/sacn_output_wire.test.js`), the mirror's splice already
writes 0 for an absent channel, and the WebSocket frame starts from a zeroed
`Uint8Array`. Densifying would have been a second, unrelated behaviour change
riding along.

### Fail-loud, no fallback

`payloadAsBuffer` is null only for a `Packet` built from an options object; the
`Receiver` always builds from the received Buffer, so on this path it is
structurally unreachable. If it ever is null the bridge logs `❌` and
`process.exit(1)` — the same invariant treatment `checkBootSubscriptionInvariant`
already gets. It does **not** throw: the vendored `Receiver` wraps its
`emit('packet')` in try/catch and re-emits as `PacketOutOfOrder`, which nothing
listens to, so a throw would be *silently swallowed*.

---

## 2. Files changed (production)

| File | Change |
|---|---|
| `marsin_engine/lib/sacn_output.js` | `useRawDmxValues: true` in `defaultPacketOptions` |
| `simulation/server/sacn_output_bridge.js` | same, in `getSender`'s pool sender |
| `simulation/server/sacn_bridge.js` | same on the relay senders **and** the mirror senders (beside `MIRROR_CID`); new `rawDmxPayload(packet)`; both `routeFrame(...)` calls now pass it; unit documented on `routeFrame` and on the WS broadcast |
| `simulation/lib/bench_mirror.cjs` | doc only — `spliceMirrorFrame`'s `@param` now states RAW 0-255 and records that F7 died with the unit |

**Not touched:** `launcher.js`, `marsin_engine/lib/api_server.js`, `CaptainPad/**`
(concurrent agents `_167`/`_168`/`_169`), any scene/pattern/playlist file, any
browser source.

---

## 3. Proof — all 256 values, three lanes

`~/tmp/fix_170/proof.cjs` (offline, no socket) and, permanently, the tests in §4.
Every wire byte is produced and read with the vendored package's own `Packet`
class — never a hardcoded offset.

| lane | what it walks |
|---|---|
| **A** | engine payload build → `Packet.buffer` → wire byte |
| **B** | wire byte → `Packet(buf).payloadAsBuffer` → `rawDmxPayload` → relay resend → wire byte |
| **C** | raw payload → `spliceMirrorFrame` → `mirrorPayload` → mirror sender → wire byte |

```
LANE A engine->wire      : 0->0 1->1 2->2 32->32 50->50 64->64 99->99 100->100
                           101->101 127->127 128->128 180->180 200->200 254->254 255->255
LANE B wire->recv->resend: 0->0 1->1 2->2 32->32 50->50 64->64 99->99 100->100
                           101->101 127->127 128->128 180->180 200->200 254->254 255->255
LANE C mirror->wire      : 0->0 1->1 2->2 32->32 50->50 64->64 99->99 100->100
                           101->101 127->127 128->128 180->180 200->200 254->254 255->255

identity: A 256/256   B 256/256   C 256/256      (was 2/256 on A and C)
```

**Zero distortion anywhere.** The relay's exact round-trip — the property
`_157` P8 measured under the old units — is preserved under the new ones: the
sender no longer scales and the receiver no longer un-scales, and the identity
holds for all 256 values rather than for the 2 that survived saturation.

Position independence is asserted too (first, middle and last channel of the
universe carry the same value), so nothing depends on where in the frame a byte
sits.

---

## 4. Test flips and additions (11 files' worth of change, 6 flips, 5 new tests)

**Characterization pins that named this fix and have now been flipped:**

1. `marsin_engine/tests/io/sacn_output_wire.test.js` — file header "KNOWN QUIRK,
   pinned not fixed (G-1 case 8 / blocked on R-D1)" → "QUIRK, NOW FIXED"; the
   `{0,255}`-only restriction (`_155` A5) retired in prose.
2. same file, `value bytes: 0 stays 0 and 255 stays 255 … (the _155 A5 rule)` —
   renamed; the "intermediate values are NOT asserted here" tail deleted.
3. same file, `1-indexing` test — `assert.notEqual(…, 0)` → `assert.equal(…, 42)`
   (42 used to leave as 107).
4. `simulation/tests/engine_bridge_contract.test.js` — `relay fidelity: … relays
   as the sacn-percentage-scale equivalent` → `… as RAW DMX 255, byte for byte`,
   asserting 255 (was 100) and additionally that the relay sender declares raw
   values.
5. `simulation/tests/bench_mirror.test.js` — the `_155` A4 source pin now
   requires `defaultPacketOptions: { cid: MIRROR_CID, useRawDmxValues: true }`.
6. `simulation/tests/bench_mirror.test.js` — the `_153` §10 / `_158` D-158-3
   source pin now requires `routeFrame(universe, priority, rawDmxPayload(packet),
   packet.sequence)`.

**Held deliberately UNCHANGED:** `engine_bridge_contract`'s "an ALL-ZERO frame
relays as an EMPTY payload" — retitled and re-commented to say the sparse shape
is preserved on purpose, since only the unit moved.

**New tests (5):**

- `marsin_engine/tests/io/sacn_output_wire.test.js` — **R-D1 full 0..255 identity
  table** (the table this file deferred), and a mechanism guard that
  `useRawDmxValues` lives in `defaultPacketOptions`, not on a per-send object.
- `simulation/tests/engine_bridge_contract.test.js` — **R-D1 PROOF**: all 256
  values through real engine sender → real wire → real bridge receive → relay
  resend → wire; and **R-D1 PITFALL GUARD** (Buffer-as-payload = 100 for a
  full-on byte).
- `simulation/tests/bench_mirror_arm.test.js` — **`_170` R-D1**: all 256 values
  through the ARMED bridge's composed mirror lane, asserted at compose and at
  wire, with the mirror's real CID + options.

**Truth tables extended past `{0,255}` (the `_155` A5 / `_156` restriction, now
retired), per fixture family:**

- `simulation/tests/bench_mirror_resolve.test.js` — new
  `byte level [_170]: a PAR slot carries mid-range levels exactly, per lane`
  (32/64/128/200 on each of R/G/B/W, plus a 10-channel ramp) and
  `byte level [_170]: a STRAND slot carries mid-range levels exactly, per pixel
  lane` (same levels per RGBW pixel lane, plus a 16-channel ramp). The file's
  tier-2 header note that "0 and 255 are the only constants a PHYSICAL truth test
  may use" is replaced with the retirement.

**Test-infrastructure changes forced by the receive-path unit** (the bridge now
reads `payloadAsBuffer`, so injected fake packets must carry it):

- `simulation/tests/helpers/bridge_harness.mjs` — `inbound()` keeps its
  `{channel: 0..255}` API and builds the 512-byte buffer; values outside 0-255
  now fail loudly instead of wrapping. `FakeSender` also records
  `useRawDmxValues` per frame so the flag is assertable.
- `simulation/tests/sacn_bridge_arbitration.test.js`,
  `simulation/tests/sacn_bridge_boot_invariant.test.js`,
  `simulation/tests/engine_bridge_contract.test.js` — their direct
  `receiver.emit('packet', …)` injections now pass `payloadAsBuffer`.

**Grep sweep:** a repo-wide search for `2.55` / `percent` / percentage-scale
modelling over `simulation/{src,server,lib,tests}` and `marsin_engine/{lib,tests}`
returns, after this slice, only comments that describe the *old* behaviour and
name this report. No test still models the transform as live.

---

## 5. Suites

Measured fresh on this tree. **The tree moved under this session** — concurrent
agents (`_167` api_server, `_168` CaptainPad, `_169` launcher, plus bridge-routing
and scene edits) changed files and added tests between the baseline and the
after run, so the totals rose by more than this slice's own additions.

| suite | baseline (this session) | after | delta |
|---|---|---|---|
| `simulation` `npm test` | 2008 tests / 2001 pass / **6 fail** / 1 todo | 2024 / 2017 / **6 fail** / 1 todo | +16 tests, +16 pass, **0 new failures** |
| `marsin_engine` `npm test` | 2784 / 2776 / **8 fail** | 2793 / 2786 / **7 fail** | +9 tests, +10 pass, **0 new failures** (one fewer) |

**The sim failing LIST is byte-identical, all six, same files and same line
numbers** — `bench_section_sync.test.js` ×5 (docked-fixtures, orphan patch
record, titanic block collisions, two CLI parity cases),
`pixel_map_view_defaults.test.js` (compression headroom), `scene_data_lint.test.js`
(G8 residue file — `simulation/scenes/summer_camp_dome/patches.yaml.original`
still exists; operator action, outstanding since `_163`). None of the six touches
sACN, and +5 of the +16 tests are this slice's.

Engine baseline's 8 failures: five `audio_capture` cases that fail with
`device_not_configured` on this box (no pinned mic), `osc_listener`'s `startAsync
rejects with EADDRINUSE`, `fire_sync_listener`'s `a strobing burst coalesces into
ONE on/off pair`, and the file-level `effects_v2_mode_page_layout.test.js`
"Unable to deserialize cloned data" reporter fault. **The after run's 7 failures
are a strict SUBSET of those 8** — the strobe case passed this time. **Zero new
failures, none anywhere near sACN.**

**Contention caveat, stated plainly:** three of these are timing/contention
sensitive, not deterministic — the strobe case (failed at baseline, passed after),
`EADDRINUSE`, and `pattern_dirs_crash_pin`'s CRITICAL PIN, which failed in one
earlier run in this session and passed in both measured runs. The engine failing
LIST is stable only up to those three.

`python scripts/security_check.py --all`: **6 findings**, all in gitignored
`simulation/.scene_backups/studiodj/**` — the standing baseline, unchanged.

Auto-check specs for the touched subsystems (`.agent/ops/sim_auto_checks.md`,
`.agent/ops/marsin_engine_auto_checks.md`): `node --check` clean on all four
changed production files, `git diff --check` exit 0, `npm run check` = the two
suites above. The scene ↔ model parity gate does not apply — no scene or model
file was touched.

Targeted files, run in isolation after the change:
`bench_mirror_arm` 57/57, `bench_mirror` + `bench_mirror_resolve` +
`bridge_routing` + `sacn_bridge_*` + `sacn_input_frames` +
`engine_bridge_contract` **214/214**, `marsin_engine/tests/io/*` **57/57**.

---

## 6. Bench A/B — how to SEE the correction

The point of this recipe is that the operator can watch the same pattern, at the
same settings, before and after the fix, on the physical bench, through the
bench mirror. **Do the BEFORE capture on the stack that is running right now**
— it still has the old code in memory; nothing here has been restarted.

**Pick a pattern with no audio in it.** Every show pattern except `27_swipe`
carries an `AUDIO_MODULATION_V1` block, so its sliders move with the room and an
A/B is unreadable. Use one of these three (all zero audio mapping):

- **`test_const`** — the recommended one. A single flat colour over the whole
  rig, driven only by **Color 1**. Set Color 1 to a **deep amber/orange, full
  saturation, full value** (hue ≈ 0.05-0.08). That look puts **R at 255, G in the
  mid 70-120s, and B at 0** — one channel pinned at each extreme and one channel
  sitting exactly where the old percent scale did its worst. It is static, so it
  photographs cleanly.
- **`rainbow`** — the whole hue circle across the rig at once, if you want to
  see every colour's secondary channel corrected in one frame. It moves slowly;
  photograph, don't compare by eye.
- **`27_swipe`** — the only *show* pattern with no audio mapping, if you want
  motion. Freeze it: `localSpeed = 0`, and set `swipePos` to a fixed value.

**Steps**

1. **Do not restart anything yet.** On the stack that is currently up, open the
   sim's **🎛 Controllers** view and **ARM the bench mirror** for `test_bench`
   standing in for `titanic`. (Arming is by design ship-dark: while armed the
   bench boxes are the only physical output.)
2. Select **`test_const`**, set **Color 1** to the deep amber above, and note
   every slider position you touched — write them down, you must reproduce them
   exactly. Leave the master/dimmer wherever it is and note that too.
3. **Photograph the bench** — one wide shot of the pars, one of the strand, in
   the same light, same exposure, same white balance. Phone auto-exposure will
   lie to you across the A/B; lock it if you can.
4. Optional desk check, worth 10 seconds: pick one par, drive it to **50 %** from
   the engine, and read that channel at the fixture/gateway. **Before the fix it
   reads 255; after it reads ~128.** That single number is the whole slice.
5. **Disarm the mirror**, then **restart the engine and the launcher** (the
   launcher owns the sim's two bridge processes; the fix lives in the engine AND
   in both bridges, so all three must come back up).
6. **ARM the mirror again**, select **`test_const`**, and set **the identical
   Color 1 and identical slider positions** from step 2.
7. **Photograph the bench again**, same framing and exposure.

**What to expect**

- **Black is unchanged. Full white (255) is unchanged.** Those are the only two
  values that were ever correct.
- **The amber is actually amber.** Before, its green lane left the engine at
  ~76-120 and hit the wire at 194-255, which reads as yellow or near-white.
  After, the green lane carries its true value and the colour reads as the
  deep amber the pattern intended. **This saturation recovery is the headline —
  it is much more visible than the brightness change.**
- **Everything that is not 0 or 255 is dimmer.** How much depends on the level:
  a rendered DMX 100 or below drops by the full **2.55×** (100 used to reach the
  fixture as 255 and now reaches it as 100); a rendered 200 drops from 255 to
  200 (78 %); a rendered 250 barely moves. So the **low and mid levels lose the
  most**, and the rig's overall output at any given slider position falls.
- **The strand and the pars should now agree with each other and with the sim
  preview.** The sim's own preview also stops capping at 39 % (`_105` F3).

---

## 7. Warning the operator has to plan around

**After this fix the WHOLE SHIP reads darker at the same slider positions.**
This is not a regression; it is the rig finally rendering what the patterns
compute. The old wire multiplied every value by 2.55 and clipped, which acted as
a crude, colour-destroying brightness boost — the ship has been running on it
since sACN output existed.

Concretely, the light output at a given rendered value drops to:

| rendered DMX | old wire byte | new wire byte | fraction of the old look |
|---|---|---|---|
| 0 | 0 | 0 | unchanged |
| 25 | 64 | 25 | 39 % |
| 50 | 127 | 50 | 39 % |
| 100 | 255 | 100 | 39 % |
| 150 | 255 | 150 | 59 % |
| 200 | 255 | 200 | 78 % |
| 255 | 255 | 255 | unchanged |

**The retune tool is the dimmer rack** — and the new master slider (`_168`, in
flight) once it lands. Do the retune AFTER this fix, not before: every level set
on the old wire was set against a 2.55× boost and a saturation ceiling, so those
positions no longer mean what they meant. Expect to raise levels across the
board, and expect the colours to stay correct while you do it — that is the
difference between this and the old behaviour, where raising a level just pushed
more channels into the clip.

Per `_153`'s sequencing note this slice is its own operator gate, and it is
deliberately NOT in the same window as a bench-mirror retest.

---

## 8. Hygiene

Zero git operations. No operator process started, stopped or signalled; no port
bound (every test runs on in-process fakes); no packet emitted. Scratch in
`~/tmp/fix_170/` (`proof.cjs`, `before.cjs`, four suite logs) — nothing written
into the source tree beyond the files listed in §2 and §4, this report, and the
tracker block. No scene, pattern or playlist file touched. `.agent/codex.md` not
read-modified.

**Standing verdict unchanged: NOT SHIP.** This slice fixes the largest
byte-level defect in the sACN stack; it does not change the hardware-confirmation
status of anything, and it makes an operator-visible look change that has not yet
been seen on the physical rig.
