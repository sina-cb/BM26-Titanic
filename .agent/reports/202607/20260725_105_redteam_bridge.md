# 20260725_105 — Red-team: sACN bridge, routing, subscription, bench mirror, same-address merge

**Agent:** adversarial red-team (Opus). **Mode:** report-only — no source edits,
no tracked-suite edits. **Repros:** `~/tmp/redteam_bridge/harness.mjs`
(pure-module, 41/41 assertions). **Branch:** `feat/bm_readiness`.

**Scope attacked:** `simulation/server/sacn_bridge.js`,
`simulation/lib/{bridge_routing.cjs, sacn_receiver_boot.cjs, bench_mirror.cjs}`,
`simulation/src/dmx/address_merge.js`, and the subscribed-universes logic.
Weaponized `_86/_87` (subscription), `_89` (bench mirror), `_99` (boot EINVAL
race), `_102` (same-address merge), and the `sacn-route-ownership` doctrine.

**⚠ CONFIRMATION — NO sACN FRAME LEFT TOWARD HARDWARE.** Every repro is a
pure-module unit harness: no `Receiver`, no `Sender`, no socket, no `dgram`,
no engine, no network I/O. Zero device HTTP. IPs in this report are redacted
to `10.x.x.NN` per public-repo rules.

## Findings by severity

**HIGH: 1 · MED: 3 · LOW: 3** (no CRITICAL). Boot gate / `_99` race, the route
diff's flap-freedom, and the merge intersection math all survived — see
"What held" at the end.

---

### H1 — BOOT-CRASH (+ silent-fallback asymmetry): an out-of-range universe kills the whole input bridge at boot
**Category:** boot-crash / silent-fallback. **Trigger is LIVE.**

`multicastGroup(u)` in the `sacn` package (`node_modules/sacn/dist/util.js:5`)
throws a synchronous `RangeError('universe must be between 1-63999')` for any
`u > 63999` (except the discovery universe 64214). The package calls it from
its boot join loop inside the socket's `listening` callback and re-emits the
throw as `receiver.emit('error', err)`.

The bridge's boot accept-list is built with **no upper-bound filter**:
- `parseSubscribedUniversesField` (bridge_routing.cjs:285) admits any
  `parsed >= SACN_UNIVERSE_MIN` — **no `<= SACN_UNIVERSE_MAX` check.**
- `patchRecordUniverses` (bridge_routing.cjs:183) adds any `u >= 1` — same gap.

Both feed `sacnOpts.universes` → `new Receiver({universes})` verbatim
(sacn_bridge.js:133-152, 779-786). When the join loop hits the bad universe,
the `RangeError` reaches `classifyReceiverError` (sacn_receiver_boot.cjs:184):
its `syscall` is not `'addMembership'` (it is a plain `RangeError`), so it is
classified **FATAL → `process.exit(1)`** (sacn_bridge.js:811-820). The entire
input bridge dies at boot.

**Observed** (harness §A): field `'2, 70000, 63999'` → boot list `[2,63999,70000]`;
`multicastGroup(70000)` throws `RangeError`; `classifyReceiverError` →
`{fatal:true}` with message *"sACN receive socket **FAILED** (UNKNOWN):
universe must be between 1-63999…"* — framed as a socket failure, not "bad
universe number."
**Expected:** the boot list should enforce the E1.31 ceiling and refuse the
single bad universe **loudly but non-fatally**, exactly as the runtime path
already does — `computeUniverseSubscriptionDiff` buckets 70000 as `invalid`,
warns, and never joins it (harness §A5). Boot and runtime disagree.

**Why it matters / how live:** the `📡 Subscribed Universes` field is populated
and hand-edited today — `scenes/common.yaml:192` currently reads
`1, 2, … 37`. A fat-fingered digit (`37` → `3700` is fine; `6999` → `69999`,
or an accidental trailing digit pushing a value past 63999) makes the **next
launcher boot dead on arrival.** Worse, it is **delayed**: saving a bad field
value at runtime is survived (the runtime diff path protects it), so nothing
looks wrong — until the next restart, when the bridge exits. A corrupt or
hand-edited `patches.yaml dmxUniverse` is the same crash one file deeper.

**Fix rec:** filter the boot list through the same E1.31 range the runtime diff
uses before handing it to `new Receiver`. Either (a) clamp/drop-with-warning in
`getAllPatchUniverses` + the field-override path in sacn_bridge.js, or better
(b) add the `<= SACN_UNIVERSE_MAX` guard inside `parseSubscribedUniversesField`
and `patchRecordUniverses` so *no* caller can mint an out-of-range boot entry,
and have the boot code log refused universes by name. Also: `classifyReceiverError`
should recognise a `RangeError`/non-syscall error as an **authoring** fault and
say "universe N is outside 1–63999" rather than "socket FAILED."

---

### M1 — DROPPED-UNIVERSE: a present-but-truncated `segments[]` silently drops the spill universe
**Category:** dropped-universe.

`patchRecordUniverses` (bridge_routing.cjs:191-197) treats `segments[]` as
**authoritative when present** and returns immediately — it never cross-checks
against `endUniverse`. The interpolation-and-anomaly guard exists **only** on
the empty-`segments` branch (lines 199-215). So a strand record whose
`segments[]` was truncated (an interrupted save, a hand-edit, a serializer
bug) — e.g. `segments:[{universe:30}]` while `endUniverse:31` — yields
universes `[30]` with **`anomaly: null`**: U31 vanishes from both the relay
route set and the subscription diff. Dark pixels past channel 512, green log.

**Observed** (harness §B): `patchRecordUniverses({dmxUniverse:30, endUniverse:31,
segments:[{universe:30}]})` → `[30]`, `anomaly=null`. The same shape with
`segments:[]` (U30–33) correctly interpolates AND raises an anomaly.
**Expected:** when `segments[]` is present but its span disagrees with
`endUniverse`/`endChannel` (or is shorter than the pixel count implies), raise
an anomaly and cover the missing universe(s) — this is the exact `_87`
spill-dark class the module was written to end, reintroduced one field deeper.
**Fix rec:** if `endUniverse > max(segments.universe)`, either interpolate the
gap (span ≤ `MAX_INTERPOLATED_STRAND_SPAN`) or emit the same "re-save the
scene" anomaly the no-segments branch does. Never trust `segments[]` as
complete without a consistency check against the record's own endpoints.

---

### M2 — DOUBLE-WRITE: bench-mirror destination is never subtracted from the engine-owned set; and `dest_host` is not validated against real controllers
**Category:** double-write / merge-miscompose.

In `recomputeRoutes`, `mirrorTargets` is built purely from the active mirrors'
`mirrorDestPairs` (sacn_bridge.js:437-445) and a `Sender` is created for each
(lines 567-581) — **independently of `engineState.owned`.** The engine-owned
exclusion only removes pairs from the *relay* route set (`excluded`), and the
mirror-suppression only removes them from `relayRoutes`. Nothing removes a
mirror destination that coincides with an engine-owned `(universe, host)` pair.
If `dest_host` + `dest_universe` equals a pair the engine delivers itself, the
**bench-mirror Sender and the engine both write that destination** — two
writers on one pair, no conflict warning — directly violating the
"one writer per (universe, controller)" law the mirror's own header cites
(bench_mirror.cjs:31).

Compounding it: `parseBenchMirrorSpec` validates `dest_host` **only** through
`classifyRouteIp` (placeholder / broadcast / loopback) — it does **not** check
the host against the controller registry or the engine-owned set. So a mirror
can legally be pointed at a **real titanic controller** and will splice
engine-derived bench bytes onto it.

**Observed** (harness §E): a mirror dest `U2→10.x.x.99` and engine-owned
`U2→10.x.x.99` collide as one `routeKey`, and the recompute builds
`mirrorTargets` without subtracting `engineState.owned`. (Requires a
`dest_host` that is also an engine controller — misconfiguration, not the
normal bench-box IP, so latent rather than live.)
**Expected:** the mirror should refuse (or suppress) a destination the engine
already owns, with a named warning — symmetric to how it suppresses the relay.
**Fix rec:** drop any `mirrorTargets` key present in `engineState.owned` and log
it as suppressed (the engine wins); and have `parseBenchMirrorSpec` (or the
recompute) warn when `dest_host` matches a known controller/engine host — a
bench mirror should only ever address a stand-in box.

*(The `_102`×`_89` question the brief posed — "does the merge compose WITH the
bench mirror or double-write?" — answer: they operate in **different processes
and never share a destination in a correct config** (address_merge is the
sim's browser-side prio-150 OUT to controllers; bench_mirror is the bridge
synthesizing frames to the bench box). They compose only in the trivial sense
of not touching the same wire. The real hazard is M2 above: the mirror's
`dest_host` is unconstrained, so a misconfig can put it on a controller the
engine or the sim already drives — and neither subsystem's "one writer" guard
sees the other.)*

---

### M3 — MERGE-MISCOMPOSE: `composeUnifiedFrame` does not self-guard same-IP contests, and sorts before filtering by universe
**Category:** merge-miscompose.

`composeUnifiedFrame` (address_merge.js:390-419) is on the write path and only
throws for an **unrankable** IP. Two contributions with the **same valid IP**
and overlapping channels are silently resolved by start-channel order — even
though `findAddressOverlaps` flags that exact pair as a `same_ip` ambiguity,
which `assertResolvableOverlaps` turns into a hard error (codex P0, "no
fallbacks"). So the guarantee "a same-IP contest is a hard error" holds only if
the caller runs `assertResolvableOverlaps` **first**; `composeUnifiedFrame`
itself does not enforce it and will happily miscompose.

Secondary: `composeUnifiedFrame` sorts the whole contribution list **before**
filtering by `destination.universe` (lines 394-406 vs the filter at 410). An
unrankable contribution that belongs to a *different* universe — one that would
have been filtered out and never written — still throws the entire
destination's frame.

**Observed** (harness §D): same-IP overlapping contributions compose without
throwing (contested channels resolved by order); the same pair is a `same_ip`
ambiguity in `findAddressOverlaps`. A `0.0.0.0` contribution for U6 throws the
compose of a U5 destination.
**Expected:** `composeUnifiedFrame` should either assert no `same_ip` contest
among its own contributions (belt-and-suspenders on the write path), or the
contract must be enforced structurally so no path reaches it un-asserted; and
the unrankable-IP throw should apply only to contributions that survive the
universe filter.
**Fix rec:** filter to `destination.universe` first, then sort; and add a
same-IP-contested-channel assertion in `composeUnifiedFrame` so the P0
"no silent resolution" holds regardless of caller discipline.

---

### L1 — QUIRK: leading-zero octets — ranking math and on-wire destination can diverge
**Category:** quirk / silent-divergence.

`ipToNumber('10.x.x.010')` folds `'010'` as **decimal 10** (regex `/^\d{1,3}$/`
accepts it; `Number('010')===10`), so the merge ranks it as `10.x.x.10`. But
`classifyRouteIp('010.x.x.5')` **admits the raw string** and the relay hands it
verbatim to the `dgram`/`sacn` socket, where some resolvers interpret a
leading-zero octet as **octal**. So the ranking math and the actual wire
destination can disagree for a leading-zero IP.
**Observed** (harness §C1-C2). **Fix rec:** reject leading-zero octets in
`ipToNumber` (return null → becomes an ambiguity), and canonicalise/validate
IPs in `classifyRouteIp` rather than passing raw strings to the socket. Very
low probability (operator would have to type a leading zero) — a hardening
nicety, not a live bug.

### L2 — QUIRK: boot gate replays only the last deferred reason
**Category:** quirk / log-fidelity.

`createBootGate` overwrites `pending` on each `guard()` and `open()` replays a
single reason, so when `boot` + `engine poll` + `client scene` all defer before
`listening`, only `'client scene …'` replays (harness §G). Functionally
harmless — the replayed recompute is a full idempotent rescan of all scenes +
engine state — but the boot transcript loses that three triggers stacked up.
**Fix rec:** none required; if boot diagnosability matters, log the set of
deferred reasons at `open()`.

### L3 — SILENT-COINFLIP SURFACE (by design): multi-NIC interface selection
**Category:** silent-fallback (documented).

With 2+ external IPv4 NICs and no `sacn_interface` pin,
`resolveMulticastInterface` returns `iface: undefined` → the **OS picks** which
NIC receives multicast; a VPN/virtual-switch adapter can win the route and
starve the lighting LAN. It warns loudly but does not fail or auto-pick
(harness §F). This is `_99`'s deliberate "don't guess" stance, but on a
multi-NIC show laptop it is a live path to dark fixtures.
**Fix rec:** operational, not code — **pin `sacn_interface` to the lighting-LAN
address in `simulation/config.yaml` on the show box.** (The requested-but-absent
and ambiguous-adapter cases already throw correctly — verified §F.)

---

## What HELD (attacked, no defect found)

- **`_99` boot gate / double-join race.** The gate defers every pre-`listening`
  recompute; the `sacn` package registers its join loop via `bind(port, cb)`
  (a `listening` one-shot) at construction, before the bridge's own
  `socket.on('listening')`, so the loop runs first and `addUniverse` can't
  race it. `checkBootSubscriptionInvariant` hard-exits on any leak. Tried 3+
  universes and interleaved deferrals — held (harness §G).
- **Route-diff flap.** Identical recomputes are idempotent (senders diffed by
  `routeKey`); duplicate `setScene`/connect churn adds/removes nothing. The
  existing suite's refcount tests confirm; no flap surface found.
- **Merge intersection math.** Partial overlap, adjacent-touch (share exactly
  one channel), and disjoint-by-one are all off-by-one clean at both edges;
  higher-IP-wins is numeric octet-wise (`*256`, not signed shift) — `.9` vs
  `.10`, `192.168` vs `10.x`, `255.255.255.255`, IPv6-mapped-as-unrankable all
  correct (harness §C).
- **Runtime subscription range + isolation.** `computeUniverseSubscriptionDiff`
  correctly buckets out-of-range as invalid and a throwing `addMembership`
  isolates per-universe (existing suite + §A5). *(The gap is only at BOOT — H1.)*
- **Bench-mirror spec validation.** Version, placeholder `dest_host`, and
  two-slices-one-channel are all hard-refused; activation gating (engine scene
  ≠ source scene, own scene inactive, engine unreachable) is correct (§E).
- **Field-parser server/browser parity** (`_86`) — the `1-24` range trap still
  surfaces as `malformed` on both sides (existing parity test).

## Top 3
1. **H1** — out-of-range universe (live hand-edited field) → whole input bridge
   `process.exit(1)` at next boot, with a misleading "socket FAILED" message;
   runtime path is protected but boot is not (asymmetry).
2. **M1** — a truncated `segments[]` silently drops a spill universe (no
   anomaly) → dark pixels with a green log; the `_87` class one field deeper.
3. **M2** — bench-mirror destination is never subtracted from engine-owned
   pairs and `dest_host` is unvalidated against real controllers → latent
   double-write against the "one writer" law.

## Repro
`node ~/tmp/redteam_bridge/harness.mjs` → 41/41. Sections A–G map to
H1 / M1 / (C: merge boundaries + L1) / M3 / M2 + bench validation /
L3 interface / L2 boot gate.

---
---

# SECOND PASS — independent red-team agent, same surface

**Why there are two.** Two agents of the six-agent sweep were pointed at the
bridge and worked concurrently in the same scratch directory without seeing each
other. The pass above is preserved verbatim; this section is appended, not
merged. **Overlaps are named explicitly** (my F1 = their H1, F2 = M2, F16 = L2);
everything else below is new, and **M1 / M3 / L1 above are theirs alone — I did
not find them.**

**Method difference, and it matters.** The first pass is a pure-module harness.
This pass drives the **real `sacn_bridge.js` process** with the `sacn` and `ws`
packages replaced by faithful fakes (the package's exact deferred-join ordering,
the real `multicastGroup`, the real Windows duplicate-join `EINVAL`, recording
Senders), the scene tree served from an in-memory VFS, `fetch` faked for
`/status`, and `process.exit` recorded rather than taken. Inbound frames are
**real `Packet` objects parsed from real wire buffers**, so the package's units,
asserts and sequence logic are its own. That end-to-end shape is what surfaced
the unit bugs below — they are invisible to a harness that fabricates payloads.

**Rules of engagement honoured.** Zero source edits, zero suite edits, zero scene
writes, no git operations. No port bound on 5568, no multicast group joined, no
datagram toward the rig, zero device HTTP; the operator's :6967 / :6969–:6972 /
UDP 5568 stack was never approached. Two probes bind throwaway loopback ports
(45590, 45599) and send nothing beyond `127.0.0.1`. Repro addresses are RFC 5737.

## Second-pass findings

| # | Sev | Finding | Live? | vs pass 1 |
|---|---|---|---|---|
| F1 | P1 | Out-of-range universe in the boot list → `process.exit(1)`, proven end-to-end through the real bridge from **both** entry points | latent | = **H1** |
| F2 | P1 | Bench-mirror destination never subtracted from engine-owned pairs → silent dual writer, and the log prints the opposite reassurance | latent | = **M2** (+ the false log line, + an end-to-end proof) |
| **F3** | **P1** | The DMX frame broadcast to browsers is in **percent (0–100)**, not DMX. The sim's sACN-IN preview renders at **≤39 %**, quantised to 101 levels | **LIVE** | new |
| **F4** | **P1** | Every sACN source in the project ships the package's hardcoded `DEFAULT_CID`; two same-CID sources on one universe destroy each other — **39 of 40 frames dropped, silently** | **LIVE** | new |
| **F5** | **P1** | The priority lockout is **global**: one prio-≥150 frame on one universe stops the relay of **every** universe for 10 s | **LIVE** | new |
| F6 | P2 | `PacketCorruption` / `PacketOutOfOrder` have no listener — 49 silent drops in one run, including start codes `0xDD` and `0xCC` | **LIVE** | new |
| F7 | P2 | `reuseAddr: true` lets a **second input bridge bind 5568** with no error; one of the two gets the engine's unicast, the other relays nothing while logging health | **LIVE** | new |
| F8 | P2 | The mirror's `Uint8Array` buffer truncates the percent payload: **202/256 DMX values wrong**, DMX 1 and 2 → **0** | **LIVE** | new |
| F9 | P2 | A relay destination may be a **multicast group this bridge is joined to** (self-feeding loop), a directed broadcast, or free text | latent | new |
| F10 | P2 | Mirror suppression lines are gated on `mirrorSig` changing — a new relay claim on a mirrored pair is suppressed in **total silence** | **LIVE** | new |
| F11 | P2 | A join that fails once is force-added to `receiver.universes` and **never retried**, warning dedup'd for the process lifetime | **LIVE** | new |
| F12 | P2 | Two scenes' sidecars may claim the **same destination pair**; sender from the last spec, payload from the first, nothing logged | latent | new |
| F13 | P2 | An unparseable `common.yaml` warns **once**, then silently narrows every later recompute — field-only universes die quietly | latent | new |
| F14 | P3 | Composed buffers are blanked by a **comment-only** sidecar edit and by every engine `/status` flap | **LIVE** | new |
| F15 | P3 | `✅ … N multicast group(s) joined` reports the boot-list size, not successful joins (observed 3 claimed / 2 actual) | **LIVE** | new |
| F16 | P3 | Boot gate keeps only the last held reason — 7 held recomputes collapse to 1 replay | **LIVE** | = **L2** |
| F17 | P3 | `checkBootSubscriptionInvariant` is a set difference — blind to a duplicate *inside* the boot list | latent | new |
| F18 | P3 | Two same-priority sources make `activeSource` flap → a `broadcastLog` **per packet** (200 packets → 401 WS messages) | **LIVE** | new |
| F19 | P3 | `setScene` runs a full synchronous recompute with **no debounce**; the sim re-sends it on every save and every WS open (3 s reconnect loop) | **LIVE** | new |
| F20 | P3 | `packet.priority \|\| 100` promotes a legitimate E1.31 **priority-0** source to 100 | **LIVE** | new |
| F21 | P3 | 63-byte attacker-controlled `sourceName` reaches the launcher terminal verbatim (ANSI, control chars). The Preact monitor is safe | **LIVE** | new |

**Adjacent, outside the bridge — flagged, not investigated.** Every raw-DMX
producer in the project feeds the `sacn` package's **percent** API.
`marsin_engine/lib/sacn_output.js:80` and `simulation/server/sacn_output_bridge.js:141`
both build `payload[ch+1] = <0..255 DMX>`, and `Packet.buffer` multiplies by 2.55
and clamps (`node_modules/sacn/dist/packet.js:138`). Measured: **DMX 100 → wire
255, everything above 100 flat at full, 256 input levels → 101 output levels.**
A uniform ×2.55 gain preserves hue until it clips, which is plausibly why it has
never been noticed. `useRawDmxValues` — the package option that exists for
exactly this — is set nowhere in the repo, and there is no `patch-package`
override. Not mine to conclude; it wants an owner before the rig is tuned.

## Repro files (`~/tmp/redteam_bridge/`, gitignored)

`rig.js` is the fake-module loader; each scenario takes a case argument.

| file | proves |
|---|---|
| `p01_units.js` | F3, F8, F1 classification, F9, boot/runtime range asymmetry |
| `s01_boot_fatal_universe.js patch\|field` | F1 end-to-end, F15 |
| `s02_mirror_vs_engine_owned.js declared\|undeclared` | F2 |
| `s03_mirror_collisions.js dup\|churn` | F12, F10 |
| `s04_priority_and_sources.js flap\|lock\|prio0` | F18, F5, F20 |
| `s05_boot_gate.js hold\|retry\|dup` | F16, F11, F17 |
| `s06_malformed_frames.js` | F6, F4 |
| `s07_relay_math.js units\|mirror\|dest` | F3, F8, F9 through the real bridge |
| `s08_churn.js field\|hotedit\|flap\|storm` | F13, F14, F19 |
| `s09_reuseaddr.js` | F7 |

## F1 — end-to-end confirmation of H1

`node s01_boot_fatal_universe.js patch` (a fixture at `dmxUniverse: 70000`) and
`… field` (`colorWave.sacn_universes: "1, 2, 70000"`). Both:

```
boot universes handed to Receiver : [1,2,70000]
multicast joins attempted         : 239.255.0.1 ok, 239.255.0.2 ok
[error] ❌ sACN receive socket FAILED (UNKNOWN): universe must be between 1-63999. …
        The input bridge cannot receive a single frame — refusing to run half-alive.
process.exit() calls              : [1]
```

The same run also prints the runtime path's correct verdict for the identical
claim — `⚠ Refusing to subscribe to universe 70000 — outside the E1.31 range …` —
which is the asymmetry H1 names, now observed side by side in one transcript.

## F2 — the mirror double-writes with the engine, and the log says otherwise

`node s02_mirror_vs_engine_owned.js declared` — mirror composes U10/U12 → `.60`;
the fake `/status` declares a controller at `.60` owning U10 and U12.

```
🪞   composes U10 → …60 (1 slice(s), 80 ch, from U30)
🚫 Relay suppressed: U10 → …60 — the engine delivers this universe to that
   controller ITSELF … relaying too would double-source it and flicker the fixture.
frames the bridge PUT ON THE WIRE toward …60:  U10 → …60,  U12 → …60
Any log line warning that the MIRROR and the ENGINE both write? ❌ NO
```

Two things pass 1 did not have. First, **the frames are observed leaving** — this
is not inference from the route sets. Second, the engine-suppression line at
`sacn_bridge.js:615` is **actively false** in this state: it tells the operator
there is one writer while the mirror is being the second. The `undeclared`
variant (no patch record for the pair) is quieter still — mirror composes and
unicasts with **no suppression line at all**.

Adjacency check, since it changes the grade: the engine currently owns
`U10/U12 → 10.x.x.202` while the mirror composes `U10/U12 → 10.x.x.60`, so the
pairs do not collide **today**. `_89` §3 records that the operator has already
bound the `.60` box in the titanic scene — the engine acquiring it is a pending
step, not a hypothetical.

## F3 — the browser gets percent and calls it DMX · **P1, live**

`node s07_relay_math.js units` — the engine paints a full 0…255 sweep on U2
through a real wire buffer:

```
engine DMX 255 (ch256) → browser byte 100
engine DMX 200 (ch201) → browser byte  78
engine DMX 128 (ch129) → browser byte  50
MAX byte anywhere in the browser frame: 100
for contrast, the RELAY wire byte for engine DMX 255: 255 ✅
```

**Expected** byte 255: the WS protocol block at `sacn_bridge.js:11-13` says
"Byte 3-514: DMX data", and `src/dmx/sacn_input_source.js:212` reads it as raw
DMX (`new Uint8Array(data, 3, 512)` → `dmxRouter.submitFrame`).

**Root cause.** The `sacn` package's public payload is **percent**: `objectify`
returns `dp(value / 2.55, 2)` and omits zeros
(`node_modules/sacn/dist/util.js:15-19`). The relay is symmetric and therefore
lossless — verified over all 256 values, **0 mismatches** — because
`Packet.buffer` multiplies by 2.55 on the way out. The browser branch at
`sacn_bridge.js:1002-1008` copies the same percent numbers into a
`Uint8Array(512)` with no conversion, so they are also truncated to integers.
Nothing in `simulation/src/**`, `server/**` or `lib/**` mentions `2.55` or
`useRawDmxValues` (grep-proven), so nothing downstream compensates.

**Why it matters.** The 3D view is the instrument the operator uses to answer the
codex's mission-critical question, *"is the exterior highly visible at night?"*
It is currently answering at 39 %, with 101 grey levels.

## F4 — one CID for the whole project · **P1, live**

`node s06_malformed_frames.js`, final block — 40 frames from two sources sharing
a CID on one universe, into the **real** `Receiver`:
`40 interleaved frames: delivered=1 dropped=39`.

`Packet` uses `options.cid || DEFAULT_CID` (`packet.js:88`), and `DEFAULT_CID` is
a hardcoded constant — the ASCII bytes `kyleHenselDefaul` (`constants.js:23`).
**No call site in this repo ever passes a `cid`**: not the bridge's relay or
mirror Senders (`sacn_bridge.js:531`, `:570`), not
`server/sacn_output_bridge.js:63`, not `marsin_engine/lib/sacn_output.js:44`.
Our own receiver keys duplicate/out-of-order state on `cid + universe`
(`receiver.js:24`) and drops when `|Δsequence| > 20`.

E1.31 identifies a **source** by CID; it is meant to be unique per sender. Two of
anything in this project on one universe therefore look like one source with a
violently jumping sequence counter — precisely the `seqErrors`/flicker signature
`20260724_15` §0 describes and the MarsinLED firmware counts (docs/41). Two stack
instances on one LAN is the normal show topology (laptop + `interior1`, docs/43),
and it is also what a debugging agent creates. The `_15` fix — remove one writer
— works; **this is why it was necessary rather than merely tidy.**

## F5 — the priority lockout is global · **P1, live**

`node s04_priority_and_sources.js lock`: one prio-150 frame on U2 from
`SimWindow`, then 20 prio-100 frames from `MarsinEngine` on **U3** — a universe
the high-priority source never touched. `U3 frames actually RELAYED : 0`, for
`LOCKOUT_MS` = 10 s after the last high-priority frame.

`sacn_bridge.js:859-883` — `highPriorityActive` and `activeSource` are single
process-wide variables and the low-priority branch is gated on
`if (!highPriorityActive)` with no universe comparison. `_89` §4 already warns
that a sim window in sACN-OUT mode is an independent prio-150 writer; the
consequence is not "the mirror loses that universe", it is **the whole ship's
relay stops for ten seconds**, announced by one line that names neither the
universe nor what it silenced.

## F6 — malformed frames vanish · P2, live

`node s06_malformed_frames.js`. `sacn_bridge.js receiver listeners:
["error","packet"]`.

| frame | verdict |
|---|---|
| start code `0xDD` (per-channel priority), `0xCC` (RDM) | DROPPED (`PacketCorruption`) |
| bad preamble / ACN PID / root vector / frame vector / DMP vector | DROPPED (`PacketCorruption`) |
| truncated to 100 B, 20 B, 0 B | DROPPED (`PacketOutOfOrder`) |
| priority 0, priority 255, `propertyValueCount` 769, ANSI `sourceName` | DELIVERED |
| sequence 250→255→0→3 (rollover) | 10/10 delivered ✅ |

`PacketCorruption=7 PacketOutOfOrder=42` — **49 events the bridge logs nothing
for.** `20260724_20` and the flicker saga were investigations into frames that
did not arrive; this is the evidence class that would have shown up first, and it
is not collected. The rollover handling is genuinely correct — that part is
bulletproof.

## F7 — a second input bridge binds silently · P2, live

`node s09_reuseaddr.js` (throwaway loopback port 45590):
`bridge B bound :45590 ← no EADDRINUSE`, then one unicast datagram to
`127.0.0.1:45590` → `A got 1, B got 0`.

`sacn_bridge.js:782` `reuseAddr: true`. The file's comment history is careful
that *Senders* must not bind 5568 (task 010); the Receiver's own `reuseAddr`
removes the one signal that a second input bridge exists. The engine unicasts to
`127.0.0.1:5568`, so exactly one bridge receives it; the other prints
`✅ Receive socket listening`, creates every relay route, and forwards nothing —
while multicast sources still reach both, making the failure partial and
source-dependent. This is the `bm26-port-topology` memory's hazard with no
enforcement behind it, and `launcher.js prod` force-claims ports by default
(`_99` §6.3).

## F8 — the mirror quantises the ship · P2, live

`node s07_relay_math.js mirror`: **202 of 256 DMX values wrong**, worst error 3
counts, 256 distinct inputs → **101** distinct outputs.

```
source DMX   1 → bench wire 0      ← a dim fixture reads as OFF
source DMX   2 → bench wire 0
source DMX 128 → bench wire 127
source DMX 254 → bench wire 252
```

`bench_mirror.cjs:271` allocates `new Uint8Array(DMX_CHANNELS)` and `:302` writes
the package's 2 dp **percent** float into it, truncating; `mirrorPayload` (`:319`)
hands the integer percent back to the Sender, which re-multiplies by 2.55. The
bench is the stand-in the operator judges titanic patterns on, so banding and a
dead bottom two counts are exactly the artefacts a tuning session would chase
into the wrong subsystem. `_89` §5.1's verification injected fabricated integer
payloads, so it could not see this — the harness units did not match the
package's.

## F9 — what may become a relay destination · P2

`node s07_relay_math.js dest`:

```
relay senders the bridge BUILT: ["U2→…10","U3→239.255.0.3","U4→…255","U5→the shed","U6→…10:5568"]
refusals logged: 0
```

`239.255.0.3` **is the multicast group for universe 3** — the group this bridge
joins whenever U3 is subscribed. Every relayed U3 frame comes back to our own
receive socket and is relayed again: a self-sustaining loop at line rate on the
show LAN, with a green log. `bridge_routing.cjs:73-105` refuses exactly four
shapes and admits everything else "deliberately TIGHT". That stance is right that
guessing at "looks malformed" is dangerous — but `239.0.0.0/8`, `224.0.0.0/4` and
this host's own addresses are not guesses, they are provably wrong destinations
for a unicast relay. (Pass 1's **L1**, leading-zero octets, is the same family.)

## F10 — mirror suppression is silent under churn · P2, live

`node s03_mirror_collisions.js churn` — steady state, then a client tags a scene
whose `patches.yaml` claims `U10 → …60`, a pair the mirror owns. The **entire**
recompute produces one line: `Client tagged scene 'late_scene'`. No route line,
no refusal, no suppression line — just a dark fixture.

`sacn_bridge.js:587-608` puts the `🚫 Relay suppressed … the BENCH MIRROR
composes this universe` loop inside `if (mirrorSig !== _lastMirrorSig)`.
`mirrorSuppressed` is recomputed every pass but printed only when the *mirror
set* changes. The engine-owned twin at `:611` has the same shape but gates on
`excludedSig`, which is derived from what it prints — so only the mirror half
drifts.

## F11 — a failed join is never retried · P2, live

`node s05_boot_gate.js retry` — the operator widens the 📡 field to include U40
while the interface transiently refuses the join, then it recovers:

```
⚠ Multicast join FAILED for U40 (📡 Subscribed Universes field): addMembership ENODEV.
── NIC recovers; five more recomputes follow ──
join attempts for 239.255.0.40 after recovery : 0 ❌
new log lines mentioning U40                  : 0
```

`bridge_routing.cjs:495` force-pushes the universe into `receiver.universes` on
failure, so the diff sees it as subscribed forever; `sacn_bridge.js:511` dedups
the warning on the full message string for the process lifetime. Both halves are
deliberate and individually reasonable; together they make a transient event
permanent and invisible. This is the operational partner to pass 1's **L3** —
pin `sacn_interface`, but also notice that one bad moment is now forever.

## F12 – F21, briefly

- **F12** (`s03 dup`): two scenes' sidecars both claim `U10 → …60`. Mirror
  senders are a `Map` keyed by destKey (`sacn_bridge.js:567`) so the **last**
  spec read wins the sender; `flushMirrors` resolves the payload with
  `_activeMirrors.find(m => m.state.buffers.has(key))` (`:982`) so the **first**
  wins the bytes. Observed: `aaa_bench`'s U30 data goes out, `zzz_bench`'s U31
  data never does, both mark the destination dirty,
  `cross-spec duplicate-destination warnings: 0`. Order is `readdirSync` order.
  `parseBenchMirrorSpec` refuses a duplicate destination **within** one file —
  the check simply has no cross-file twin.
- **F13** (`s08 field`): after `readSubscribedUniversesField`'s single warning
  (`sacn_bridge.js:260`), five further recomputes print nothing and U35 —
  declared only in the field — is never subscribed. The escape hatch `_87` §4
  exists for (an external console, a second machine on the wire) fails quietly.
- **F14** (`s08 hotedit`, `s08 flap`): a **comment-only** sidecar edit changes
  `found.raw`, so `sacn_bridge.js:430` rebuilds the state and the next composed
  frame carries the not-yet-refed slices at 0 — observed
  `ch1,2,9,10 = 100,100,100,100` → `100,100,0,0`. Three engine `/status` flaps
  produce 4 sender constructions, 4 closes, 16 log lines and the same blackout.
  `_89` §5.3's "a recompute never blanks a frame" holds only for a byte-identical
  file.
- **F15** (`s01`): boot list of 3, joins that succeeded 2, banner says
  `3 multicast group(s) joined`.
- **F16** (`s05 hold`) = pass 1's **L2**, quantified: 7 recomputes held in a 60 ms
  window (`boot`, four `client scene …`, one disconnect, `engine poll`), one
  replay. Routes are correct — the recompute is total.
- **F17** (`s05 dup`): `checkBootSubscriptionInvariant([1,2,2,3],[1,2,2,3])`
  returns `ok=true`. It computes `current \ boot` as sets
  (`sacn_receiver_boot.cjs:216-219`), so a repeat inside the boot list — the same
  duplicate `IP_ADD_MEMBERSHIP` the module exists to kill — passes. Unreachable
  via config today (both producers de-duplicate); it is the one hole in an
  otherwise genuinely self-policing invariant.
- **F18** (`s04 flap`): 200 packets from two same-priority sources → **401** WS
  messages to a single client, one `🟡 ACTIVE` broadcast per packet
  (`sacn_bridge.js:876-880`). At rig rates that is thousands of extra JSON
  messages per second to every open sim window, each one a Preact signal update.
  The monitor's 20-entry cap keeps memory bounded; the render rate is not.
- **F19** (`s08 storm`): 300 `setScene` messages → 300 full synchronous
  recomputes, 198 ms of blocked relay thread (0.66 ms each on a 12-scene tree;
  the real titanic tree is larger). No debounce, no coalescing. The sim re-sends
  `setScene` on every save **and** on every WebSocket open — a tab in a 3 s
  reconnect loop is a recompute every 3 s.
- **F20** (`s04 prio0`): inbound priority 0 is relayed as 100
  (`sacn_bridge.js:859`, `packet.priority || 100`) — a deliberately
  deprioritised source is re-stamped as a normal one, on the wire and in the
  monitor.
- **F21**: the 63-byte `sourceName` (`packet.js:66`, attacker-controlled, only
  `\x00` stripped) reaches `console.log` and the launcher terminal verbatim. The
  Preact monitor interpolates as text and is safe.

## What I attacked and could NOT break

- **The `_99` boot gate itself.** Held recomputes replay against live state and
  produce the correct route/subscription set in every ordering I could build
  (boot + engine poll + four client tags + a disconnect, all inside the window).
  I could not construct a third ordering that yields a wrong route set or an
  uncaught double join *through the gate*; F17 is a hole in the invariant's
  algebra, not a way past the gate. Independent agreement with pass 1.
- **The relay's DMX round-trip** — byte-exact over all 256 values, both
  directions. The one place the percent/DMX confusion cancels cleanly.
- **Sequence rollover** — 10/10 correct across 255→0.
- **The bench-mirror spec parser** — every refusal `_89` claims fires (unknown
  keys, version, non-integers, source/dest overrun past 512, overlapping
  destination channels, duplicate destination, refused `dest_host`). The gap is
  only *across* specs (F12).
- **`isMirrorActive`'s three preconditions** — all genuinely required; the
  deployment guard behaves as `_89` §4 describes.
- **Route ownership under scene churn** — no last-writer clobber survives; the
  `_15` union semantics hold under client storms.

## Hygiene (second pass)

- No source edits, no suite edits, no scene writes, **no git operations**.
- `cd simulation && npm test` re-run at the end: **1645 tests, 1637 pass, 8 fail**
  — the documented baseline, byte-identical failing list (fixture docking,
  titanic block acceptance, view-bit headroom, the two parity CLI rows, the
  compression threshold, the two `test_bench` model-parity rows).
- `git status -- simulation` unchanged from session start; the listed
  modifications are the pre-existing uncommitted `feat/bm_readiness` wave.
- Zero packets toward the rig. Loopback-only probes on 45590 / 45599.

## Second-pass top 3

1. **F3** — the sim's sACN-IN preview renders the ship at **39 %** with 101 grey
   levels, because the browser frame carries the `sacn` package's percent payload
   labelled as DMX. Live, and it is the instrument the mission-critical
   night-visibility judgement is made on.
2. **F4** — **one CID for the entire project.** Two same-CID sources on a
   universe drop 39 of 40 frames at our own receiver and are indistinguishable to
   real gateways. This is the missing mechanism behind the `_15` flicker, and it
   is live the moment a second stack instance exists on the LAN.
3. **F5** — the priority lockout is **global**: a single prio-≥150 frame on one
   universe stops the relay of every universe for ten seconds, announced by one
   line that names neither.
