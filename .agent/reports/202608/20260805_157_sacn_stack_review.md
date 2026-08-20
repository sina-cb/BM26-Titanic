# 20260805_157 — sACN stack review: wire-layer defect list + fix plan

**Agent:** sACN debug/review (Fable, operator-requested) · **Branch:** `feat/bm_readiness` · **Task:** `_157`
**Inputs:** `_153` (packet/routing investigation), `_155` §15 (amended design), tracker tail.
**REVIEW ONLY.** Zero production edits, zero git writes (read-only `show`/`log`/`diff`),
no port bound, no packet sent, no process started. Every measurement ran in-process
against the REAL vendored `sacn@4.6.2` code with `dgram` intercepted (fake sockets);
probe + captured output in `~/tmp/sacn_review_157/` (`probe.cjs`, `probe_output.txt`).

**Line-number convention:** `_156` is concurrently editing `simulation/server/sacn_bridge.js`,
`sacn_output_bridge.js`, `simulation/src/dmx/sacn_input_source.js` and sim GUI files in this
working tree. Citations into those files (and `marsin_engine/config.yaml`) are **at HEAD
(`948447e9`)**; everything else is the working tree. `_156`'s in-flight changes were not
reviewed (separate adversarial reviewer owns them). IPs redacted to `10.x.x.NN`.

---

## 0. Verdict table — ranked by show impact

| # | Defect | Status | Rank |
|---|---|---|---|
| D1 | **Percent×2.55 clip on every project sender** — everything ≥ DMX 101 leaves as 255 (engine lane AND sim `:6972` lane); receive side carries percent-bytes 0-100 to the browser | `_153` F1b **CONFIRMED + blast radius widened** (probe P1/P2/P8/P9) | **1 — ship-wide color** |
| D2 | Sim tab = unsuppressable priority-150 second writer in `sacn_in`; `:6972` has no mirror knowledge at HEAD | `_153` F1 **CONFIRMED by code path**; fix in flight (`_156`, `_155` A3 gate) | **2 — bench/ops blocker** |
| D3 | One `DEFAULT_CID` project-wide; **measured 98/100 drop** at our own receiver for two same-CID writers on one universe | `_153` F2 **CONFIRMED + quantified** (probe P4) | **3** |
| D4 | Bridge arbitration dead (`sacn_high_priority: 100` ≤ engine 100) **and — new — the arbitration state is GLOBAL across universes**: raising the threshold without scoping turns one console override into an all-universe lockout | `_153` F3 **CONFIRMED + deepened** | **4 — latent trap in the planned fix** |
| D5 | **NEW — silent packet discard**: the `sacn` Receiver drops out-of-order and corrupt packets via `PacketOutOfOrder`/`PacketCorruption` events **no project code listens for** — fail-loud P0 violation; would have diagnosed the bench night in seconds | **CONFIRMED-OFFLINE** (probe P4-P6; repo grep: zero listeners) | **5** |
| D6 | `_153` F4 **PARTIALLY REFUTED**: `marsin_engine/config.yaml:14` (HEAD) carries `alsoFlat: true` since `c6eaa733` (July 15). U10/U12 **do** reach loopback; the bridge relays them to the ship boxes. "Ship U10/U12 dark" is wrong at HEAD. The `.202` direct-unicast two-writer risk (address ≠ board) **stands** | **REFUTED-IN-PART / CONFIRMED-IN-PART** | **6 — corrects `_155` A9-1's stakes** |
| D7 | Playa injection surfaces: multicast receive with no source filter + threshold 100 ⇒ the bridge **relays any third-party multicast source to the hardware, unicast**; `:6972` WS = unauthenticated arbitrary-DMX proxy for any LAN client | **CONFIRMED-OFFLINE** (design-level; F9 live sweep still open) | **7** |
| D8 | No `'error'` listener on ANY Sender's dgram socket (package registers none, project adds none) — an emitted socket error is an uncaught exception ⇒ **process death** (engine / either bridge) | **CONFIRMED-OFFLINE** (occurrence needs live check) | **8** |
| D9 | Sender re-creation resets sequence to 0 (route churn, `:6972` 15 s idle reap) ⇒ standards-compliant controllers discard up to 20 frames (~0.5 s); our own receiver drops exactly 1 packet; wraparound-with-loss drops 1 good frame | **CONFIRMED-OFFLINE** (probe P5/P6) | 9 |
| D10 | Stream_Terminated never set (options byte always 0) — blackouts are data-only; **and the engine's SHUTDOWN blackout is sent 1×** (vs the 3× convention its own stale-universe path follows) — one lost datagram = rig frozen bright at engine exit | **CONFIRMED-OFFLINE** (probe P3; `engine.js:2549` vs `:1753-1759`) | 10 |
| D11 | Unicast senders skip universe validation entirely (universe 0 and 64000 accepted; >65535 aliases via uint16 masking) | **CONFIRMED-OFFLINE** (probe P7) | 11 |
| D12 | Hygiene: falsy-default conflations (`\|\| 150` etc.), browser port-guess fallbacks, `priority \|\| 200` on receive | **CONFIRMED** (code read) | 12 |

`_153` F5/F6/F7/F8 were not re-litigated (its harness already measured them with the
real `Packet` class); F7's quantisation is subsumed into D1's fix.

---

## 1. D1 — the percent field: full blast radius and the exact fix

### Mechanism (independently reproduced)

`packet.js:132-139`: the DMX slot is written as `inRange(payload[ch] * 2.55)` unless
`useRawDmxValues` (a per-packet option, `:91-93`) is set. On receive, `util.js:objectify`
divides by 2.55. `payload` is a **percent** field. Repo grep: no project source sets
`useRawDmxValues` and none passes `cid` (both vendored copies `sacn@4.6.2`,
`packet.js` hash-identical between `simulation/` and `marsin_engine/`).

Probe P1 (real `Packet`, engine payload construction from `marsin_engine/lib/sacn_output.js:75-79`):

```
engine DMX in : 0 1 2  50  99 100 101 127 128 180 200 254 255
wire byte out : 0 3 5 127 252 255 255 255 255 255 255 255 255
```

### Blast radius — every lane, mapped

| lane | file:line | defect |
|---|---|---|
| engine → hardware/loopback | `marsin_engine/lib/sacn_output.js:75-79` (values from `sacn_mapper.js:351-353`, 0-255) | raw-into-percent ⇒ ×2.55 clip (P1) |
| sim → `:6972` → hardware | `sacn_output_bridge.js:139-148` (HEAD) — `payload[ch+1] = dmx[ch]`, raw 0-255 bytes | **identical bug** (P2). The sim's priority-150 stream is clipped too |
| bridge relay (in→out) | `sacn_bridge.js:947` (HEAD) resends the objectified percent floats | round-trips the (already-clipped) wire byte **exactly, all 256 values** (P8) — the relay itself does not distort |
| bridge → browser WS | `sacn_bridge.js:1031-1041` (HEAD) writes percent floats into a `Uint8Array` | browser receives **0-100 "DMX" bytes** (P9, max = 100) — this is `_105` F3's 39 % preview, and `sacn_mapper.js:124-131`'s `/255` is compensating for the wrong unit |
| sacn_in → sim → `:6972` | `sacn_input_source.js:283` (HEAD) → router → `animate.js:718-723` → output bridge | the 150-priority stream is a **double-quantised copy** (percent truncation then ×2.55 re-expansion, ±3) of already-clipped data — the two writers of D2 differ byte-wise even when carrying "the same" frame |
| bench mirror compose | `bench_mirror.cjs` writes percent floats into `Uint8Array` (truncate) | `_153` F7, ~100 levels — same family, dies with this fix |

### The exact fix (one slice, all-or-nothing)

Flipping `useRawDmxValues` on senders alone makes the rig 2.55× dark at every
receive-side consumer that still divides. The receive side has **no raw option** in
`sacn@4.6.2` — but `Packet.payloadAsBuffer` (`packet.js:101-103`) exposes the raw
inbound DMX slice untouched. Coherent end state:

1. **Senders** — all four sites pass `useRawDmxValues: true` (works via
   `defaultPacketOptions`, merged in `sender.js:56`): engine `sacn_output.js`,
   output bridge `getSender`, input-bridge relay senders, mirror senders.
2. **Bridge receive path** — `routeFrame` consumes `packet.payloadAsBuffer` (guard
   length < 512 from third-party senders) instead of `packet.payload`:
   - WS `:6971` frames carry true DMX bytes (protocol unchanged in shape, changed in unit);
   - relay resend converts the raw buffer to a 1-indexed object + `useRawDmxValues`
     (do **not** pass the Buffer as `payload` — the getter would objectify it to
     percent and then send it raw, a 2.55× darkening);
   - mirror splices raw bytes (F7 quantisation gone).
3. **Browser** — `sacn_mapper.js:124-131`'s `/255` becomes CORRECT (verify the 39 %
   preview dies rather than doubling); the `sacn_in` → `:6972` path then carries raw
   bytes end-to-end.
4. **Tests** — byte tables 0..255 exact on both lanes (extend `_153`'s
   `capture.cjs` shape into a permanent test); `_155` A5's "0/255-only constants"
   rule can be retired after this lands.

**RETEST / GATE:** every colour on the ship changes (everything currently ≥ DMX 101 is
saturated to full). This slice needs its own operator gate with a before/after capture
(`_153` §7E procedure), and per `_153`'s sequencing note it must NOT land in the same
window as the bench-mirror retest.

---

## 2. D2 — the `:6972` second writer (status at HEAD, for the record)

Confirmed by code path at HEAD: `animate.js:682-727` admits every patched DMX fixture
in `sacn_in` mode (`:709`), hard-codes priority 150 (`:713`), sends at render fps
(~60, vs the engine's 40 — the byte content also differs per D1's double-quantisation
row, so the interleave never even agrees with itself); `sacn_output_bridge.js` (HEAD)
has no route table, no scene, no mirror knowledge, and both bridges spawn
unconditionally (`start.js:103-119`). Nothing new to add to `_153` F1 / `_155` A3 —
the server-side gate design is the right shape; `_156` owns it. Two review notes for
the gate's adversarial pass: (a) the gate must drop **binary** frames while still
answering **JSON** control messages (at HEAD non-519-byte messages are silently
ignored, `:127-129`); (b) after an ungate, the pool's reaped-and-recreated senders
restart sequence at 0 — see D9 for the cost.

## 3. D3 — shared CID: quantified, and the receiver-side half nobody had measured

`constants.js:23-26` (`kyleHenselDefaul`), `packet.js:86` `options.cid || DEFAULT_CID`,
no project `cid:` anywhere. New quantification — the drop happens at OUR receiver too,
not just at controllers: the package keys its sequence tracking by `CID + universe`
(`receiver.js:25`) and discards any packet whose sequence differs from the last by
more than 20 in absolute value (`:26-31`).

Probe P4, two writers (independent counters at offset 100) interleaved on one universe
through the REAL `Receiver` message handler: **accepted 2, dropped 98 of 100.** The
probe itself demonstrated the state-key collision a second way: P5's counter bled into
P6's fresh test purely because both used the default CID on the same universe.

Fix (small, no visual change): distinct **16-byte** CIDs per sender role — engine,
bridge-relay, bridge-mirror, output-bridge — passed via `defaultPacketOptions.cid`.
**Validate length == 16**: `Packet` splices `[...this.cid]` into the frame
(`packet.js:113`) with no length check; a short buffer would shift every following
byte of the packet. Derive as fixed namespace + role string (e.g. first 16 bytes of
sha256 of `bm26:<role>`), stable across restarts per E1.31's own CID lifetime rule.
This is `_155` A4's "separate small slice", now with the wire-math warning attached.

## 4. D4 — arbitration: dead by config AND global by design

Confirmed at HEAD: `common.yaml:200-205` `sacn_high_priority: 100` — **with slider
`min: 100`**, so the GUI cannot express a value that revives the branch; the `>=` at
`sacn_bridge.js:888` makes the engine's own priority-100 frames permanently
"high-priority"; the `else` at `:903-912` is dead. Also `:146`'s
`unwrapConfigValue(...) || 150` silently replaces a configured 0/falsy with 150.

**New — the deeper defect:** `activeSource`, `highPriorityActive` and
`highPriorityTimer` (`:820-822`) are **single globals for all universes**. The moment
any source ≥ threshold appears on ANY universe, `highPriorityActive` latches true and
the `else` branch stops routing EVERY lower-priority source on EVERY universe — relay
AND browser broadcast. Consequence for the planned fix: raising the threshold to,
say, 150 without scoping means one console override on U1 (or one stray sim tab in
`sacn_in`, which sends at exactly 150) **blacks out the entire engine-driven rig**
through the bridge for as long as it transmits + `LOCKOUT_MS`.

Fix (one slice, bridge only): per-universe arbitration state (map universe →
{activeSource, active, timer}), threshold raised above the engine's 100 (recommend
120: engine 100 passes as the ordinary source; the sim's 150 and any console override
≥ 150 win per-universe), `common.yaml` value + slider min raised together, falsy
handling made explicit. Regression tests: dead-else revival, per-universe
independence, release-after-lockout per universe. `_155` A4's "mirror emits at fixed
100" recommendation is unaffected.

## 5. D5 — silent discard: the missing loud path (fail-loud P0)

`receiver.js:30-39`: an out-of-order packet **throws inside the message handler**,
is caught, and re-emitted as `PacketOutOfOrder`; a malformed packet (failed
`assert`) becomes `PacketCorruption`. Emitting an event with zero listeners is a
no-op. Repo grep: **no project file listens for either event.** The bridge (HEAD)
registers only `error` (`:840`) and `packet` (`:877`).

So every drop in D3/D9's classes — including the bench night's two-writer corruption,
had it reached `:6971` — is invisible in every log and every monitor. Fix (tiny,
independent, land first): register both listeners in `sacn_bridge.js`; throttled
`console.warn` + `broadcastLog` + running counters surfaced in the `getRoutes`
snapshot / monitor panel. This turns the entire two-writer bug class from "random
colors" into a named, counted log line.

## 6. D6 — F4 corrected: `alsoFlat: true` was there all along

`git log -S 'alsoFlat: true' -- marsin_engine/config.yaml` → `c6eaa733` (2026-07-15).
HEAD `config.yaml:7-14`: the `Titanic-202` block (host `10.x.x.202`, U10+U12)
carries `alsoFlat: true`. `output_dispatch.js:143-145` therefore dual-sends: U10/U12
go to `10.x.x.202` **and** to the flat destination `127.0.0.1`. The bridge receives
them; `engineOwnedPairs` (pair-keyed, `bridge_routing.cjs:370-382`) excludes only
`(10→10.x.x.202)`/`(12→10.x.x.202)`, while the titanic scene declares
`U10 → 10.x.x.13` and `U12 → 10.x.x.14` (`scenes/titanic/patches.yaml:338-473`) —
different pairs, so those relay routes are **live and fed**.

Corrections that flow from this:
- `_153` §4's "U10 and U12 never reach 127.0.0.1 … those ship fixtures are dark" is
  **wrong at HEAD** (it quoted the config without line 14). `Left Back Wall 3/4` and
  `Left SmokeStack 1-4` are fed via bridge relay.
- `_155` A9-1's stated stakes ("removing the block … un-darkens ship U10/U12,
  currently receiving nothing at all") are **overstated**: removing the block changes
  nothing about the ship feed path — it removes the redundant direct stream to
  `.202` and satisfies R-21. The removal decision itself remains correct.
- The real F4 risk is unchanged and still NEEDS-LIVE-CAPTURE: if `.202` resolves to
  a live board (same physical box as the bench `.60`, or anything else), the engine
  is a second writer there under the shared CID. `_153` §7D's arp/identity procedure
  stands.

## 7. D7 — injection surfaces (security_privacy angle, playa LAN)

- **Multicast in → unicast out amplifier.** The receiver joins ~40 multicast groups
  (`common.yaml:192` field), accepts any source (no allowlist; E1.31 has no auth),
  and with D4's threshold at 100 every default-priority source is admitted, composed
  into the mirror, broadcast to browsers, and **relayed unicast to the controllers**.
  A neighboring camp's console multicasting U1-42 drives our rig. Mitigations, in
  effect order: D4's per-universe arbitration + threshold raise (a 100-priority
  stranger then loses to nothing but at least alternates instead of winning);
  D3's CIDs + D5's counters make it attributable; an optional expected-source pin
  (warn-and-name any source ≠ engine CID) is cheap once D3 lands. The F9 tshark
  multicast sweep (`_153` §7A step 5) remains the live check.
- **`:6972` = unauthenticated DMX proxy.** `WebSocketServer({ port })` binds all
  interfaces; any LAN client can send 519-byte frames → unicast sACN to **any IP at
  any priority** (HEAD `:126-148`). Loopback-only binding would break LAN sim
  viewers, so: bind-address config + the `_155` A3 gate + (cheapest real win) log
  every remote-address connection loudly (HEAD logs it at `:124` already — keep).
  `:6971`'s exposure is lower (setScene/getRoutes only — worst case adds relay
  routes for a real scene).

## 8. D8 — unhandled Sender socket errors = process death

`sender.js:41` creates the dgram socket and never registers `'error'`; no project
code touches `sender.socket`. Send-callback errors are handled everywhere (engine
throttle, both bridges' dedup) — but a socket-level **event** (the known Windows UDP
ECONNRESET-after-ICMP-unreachable class, EADDRINUSE on rebind, iface loss) is an
uncaught exception that kills the engine or a bridge mid-show. Not provable offline
(the common failure path goes through the callback, which is why the rig has
survived downed controllers so far). Fix: one helper that attaches a throttled
`socket.on('error')` logger to every Sender at creation (4 sites). Live check for
the operator: with any sender streaming to a live host that has no listener on 5568
(ICMP port-unreachable answers), watch the sending process for ≥60 s — a crash
confirms the exposure on this OS/Node combo.

## 9. D9-D12 — smaller, verified

- **D9 sequence reset** (P5/P6): route recompute churn (`sacn_bridge.js:528-556`
  HEAD), mirror arm/disarm sender swaps, and the output bridge's 15 s idle reap
  (`:89-98` HEAD) all mint fresh senders at sequence 0 (`sender.js:28`). A
  spec-compliant controller's discard window `[-20,0]` costs up to 20 frames
  (~0.5 s dark/held) when the dead counter's last value mod 256 sits within 20
  above 0 — i.e. occasionally, per re-create. Our own receiver drops exactly one
  packet (P5), and one good frame per wraparound-with-loss (P6, package `Math.abs`
  logic — not spec E1.31 arithmetic). Cheap mitigation if wanted: persist the last
  sequence per (universe, ip) across sender re-creation in both bridges.
- **D10 termination semantics** (P3): options byte is always 0 — the package cannot
  set Stream_Terminated, so every "3× zeros" pattern relies on data-level black,
  and receivers keep the source registered until their own timeout. Acceptable —
  but make it consistent: `engine.js:2549` sends the SHUTDOWN blackout **once**,
  while `engine.js:1753-1759` documents and applies the 3× rule for stale
  universes. Repeat the shutdown blackout 3× too.
- **D11 universe validation** (P7): `multicastGroup` throws for universe 0/64000+,
  but every project sender passes `useUnicastDestination`, which skips that path
  entirely; `bit(16, u)` silently masks >65535. Validate 1-63999 at
  `createSacnOutput`, `getSender`, and the bridge's sender-creation sites (the
  receive side already refuses, `bridge_routing.cjs:436-448`).
- **D12 hygiene:** `sacn_bridge.js:145-147` `|| 10000`/`|| 150`/`|| 2000` conflate
  configured-0 with unset; `engine.js:158` `cSacn.priority || 100` likewise;
  `sacn_input_source.js:283` `priority || 200` promotes an (impossible-today)
  priority-0 frame to 200; `sacn_input_source.js:345-348` and
  `sacn_output_client.js:230-233` fall back to guessed ports 6971/6972 on a failed
  config fetch (silent-fallback violations, browser-side).

---

## 10. Non-findings — checked and sound

- **`bridge_routing.cjs` (working tree):** sentinel/broadcast/loopback route
  refusals with named warnings; pair-keyed engine exclusion; LED-segment universe
  expansion with anomaly reporting; 1-63999 subscription gate; snapshot
  introspection. No defect found.
- **No project sender multicasts.** Engine `sacn_output.js:44-56`, output bridge
  `:63-73` (HEAD), input-bridge relay `:539-545` and mirror `:575-588` (HEAD) all
  pass `useUnicastDestination`. The Receiver's group joins are receive-only.
- **`reuseAddr` discipline holds:** no sender binds (no `reuseAddr`, no `iface` ⇒
  `sender.js:42-50` never calls `bind`), so the historical
  "sender steals :5568 datagrams" bug cannot recur from these sites.
- **Boot join race** (`_99`): boot gate + `listening` replay + invariant check at
  HEAD `:855-867` — correct ordering, loud failure.
- **Relay byte fidelity:** percent floats round-trip ×2.55 exactly for all 256
  wire values (P8) — the relay lane adds zero distortion of its own.
- **Throughput:** 40 fps × ~20 universes engine-side (~25 kB/frame aggregate) and
  the sim's ~60 fps lane are trivial for the LAN; the bridge's per-frame relay adds
  one unicast send per admitted inbound frame per route. No pacing defect.
- **CaptainPad / control_podium / marsin_pb:** no sACN sender or 5568 touchpoint
  (grep; only UI copy in CaptainPad and the podium README). `archived/dmx/*` senders
  are not wired into any start path.
- **IPv4/udp4** consistently assumed and consistently true for this rig.
- **Engine `/status outputRouting`** shape matches `engineOwnedPairs` consumption;
  pinned by `tests/io/status_output_routing.test.js` and the e2e harness black-hole
  assertion.

## 11. Fix plan — slices for the Opus wave (ordering matters)

| slice | change | tests | retest / gate | depends on |
|---|---|---|---|---|
| **S-D5** (first — tiny, pure win) | `PacketOutOfOrder`/`PacketCorruption` listeners in `sacn_bridge.js`: throttled warn + `broadcastLog` + counters in the routes snapshot | fake-receiver emit → log/counter assertions | none | `_156` merge (same file) |
| **S-D3** | per-role 16-byte CIDs on all 4 sender sites via `defaultPacketOptions.cid` + length-16 assertion | offline `Packet` build per role: distinct CIDs, correct offsets 22-37 | none (no visual change); makes tshark attributable | `_156` merge |
| **S-D4** | per-universe arbitration map + threshold raise (recommend 120) + `common.yaml` value & slider min + falsy fix | dead-else revival; per-universe independence; per-universe release | none visually; operator informed that a ≥threshold source now silences ONLY its universe | S-D5 (counters make it observable) |
| **S-D6** | remove the engine `Titanic-202` block (operator/engine action, R-21 prerequisite) — with the corrected consequence statement from §6 | engine boots with 0 controllers; `/status.outputRouting.controllers == []`; bridge relay unchanged for U10/U12 | one live look at ship U10/U12 fixtures (they were already relay-fed) | operator go |
| **S-D1** (own gate) | raw DMX end-to-end per §1: `useRawDmxValues` on all senders + `payloadAsBuffer` receive path + WS raw bytes + mapper compensation removal + mirror raw compose | 0..255 byte tables both lanes; preview-brightness test (39 % dies); permanent no-distortion capture test | **operator-gated ship-wide before/after** (`_153` §7E); NOT in the mirror-retest window | mirror retest done; S-D3/S-D4 landed (attribution + arbitration live before the look change) |
| **S-D8/D10/D11/D12** (hardening batch) | sender-socket error listeners ×4; 3× shutdown blackout; universe range checks at sender creation; falsy-default + port-fallback cleanup | unit each; socket-error via fake socket emit | D8 live check per §8 | any time |
| **S-D7** (ops + config) | `:6972` bind-address config; expected-source warn (post-CID); F9 tshark sweep in the show runbook | gate tests already in `_156`'s T-9 | live sweep on playa LAN | S-D3 |
| (optional) **S-D9** | persist per-(universe,ip) sequence across sender re-creation in both bridges | seq continuity across a recompute in the fake-socket rig | none | S-D5 |

**Urgency call:** nothing here interrupts the bench-mirror work — D2's fix is already
in flight, and D1 must deliberately WAIT for the mirror retest. S-D5 and S-D3 are
safe, small, and should ride immediately after `_156` merges (same-file conflicts
otherwise).

## 12. Hygiene

- Zero writes outside this report and the tracker block. Read-only git only
  (`show`, `log`, `diff`, `status`). No port bound, no datagram, no multicast join,
  no device HTTP, no engine/sim/bridge boot. `_156`'s in-flight files reviewed at
  HEAD via `git show` snapshots in the session scratchpad.
- Probe harness (`~/tmp/sacn_review_157/probe.cjs` + `probe_output.txt`) loads the
  real vendored `sacn` dist with `dgram` replaced by an in-process fake; all 9
  probe groups PASS as asserted above.
- IPs redacted to `10.x.x.NN` throughout; the config/scene files carrying real
  values were read, not edited.
