# 20260805_159 — BENCH MIRROR v3: the DISARMED path. Is the ship untouched?

**Agent:** reviewer (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_159`
**Operator concern (verbatim):** *"I am worried about the test bench arm feature
and messing up the routing and actual light communications for the titanic scene
or any other scenes for that matter."*

**Mission:** the opposite face of `_158`. `_158` attacked the ARMED path and the
physical test passed WHILE ARMED. This review asks the playa question: with the
mirror **never armed**, does titanic — and every other scene — route and light
exactly as it would if the bench-mirror feature had never been built?

**READ-ONLY.** Zero source / test / scene edits. Zero git write operations
(`show` / `diff` / `status` / `log` only). **No port bound, no packet toward any
controller, no device HTTP, no engine process started against the real config,
nothing armed on real hardware.** Everything dynamic ran in-process against faked
sockets; scratch lives in `~/tmp/disarmed_review_159/`.

**Snapshot reviewed:** working tree as of `sacn_bridge.js` mtime `13:58`,
`bench_mirror.cjs` `14:05`, `sacn_output_bridge.js` `12:49`,
`bench_mirror_resolve.cjs` `12:22`.

> **DISCLOSED — one file changed under me.** `sacn_bridge.js` was rewritten by
> the implementation agent at **14:32**, after my measurements (116 732 →
> 122 881 bytes). I **re-ran all five harnesses against the new file: every one
> still passes** (H1 15/15 route-table snapshots, 0 mirror senders, 0 gate links;
> H2 all 16 hostile trees; H3, H5, H6 green). I then re-read the delta on the
> disarmed path. It adds one thing that matters to this review — a **new timer**,
> `_darkTickTimer` (`:2136`, `setDarkTick` at `:2134`) driving the held-dark
> mapping at 40 fps. It is **mirror-only and cannot run while disarmed**: its
> only two call sites are `recomputeRoutes:691`
> (`setDarkTick(_activeMirrors.some(m => m.state.bySource.size === 0))` — false
> whenever `_activeMirrors` is empty, which is always while disarmed) and
> `disarmBenchMirror:1747` (`setDarkTick(false)`); the interval body itself
> early-returns on `_activeMirrors.length === 0`, and the handle is `unref`'d.
> **Every `file:line` in this report is against the 13:58 snapshot** except the
> ones in this box; the touch-point *sites* were re-grepped against the new file
> and are unchanged in kind (their current lines: `:589`, `:671`, `:709`, `:712`,
> `:858`, `:869`, `:1082`, `:1179`, `:2360`, `:2368`, `:2437`, `:2460`).

This snapshot is **post-`_158`**: D-158-1 (sticky
`_gateLostWhileArmed` + `proveOutputGateHeld` in the ownership proof), D-158-2
(held-dark destinations now emit zeros), D-158-3 (sequence-based frame identity),
D-158-4 (`evaluateClaimOverlap` after resolution), D-158-5 (version check before
the unknown-key sweep) and D-158-8 (`fail()` instead of `|| new Set()`;
`forgetMirrorGather` on retire) are all present in the code I read. I did not
re-verify the ARMED-path claims those fixes make — that is `_158`'s surface.

IPs are redacted to `10.x.x.NN` in this prose per `.agent/os/security_privacy.md`.

---

## 0. VERDICT — **INERT-CONFIRMED on every disarmed surface I could reach**

**No defect found on the disarmed path.** Titanic's route table, sender set,
priorities, CIDs, packet fan-out and relay byte path are the mirror-agnostic
function of the scene files, measured 15 times across a full battery of ordinary
show events, and identical to what the pre-mirror routing core computes. No
mirror sender is ever created, no control link to `:6972` is ever opened, no
mirror-owned timer ever runs, and a broken / absent / hostile sidecar degrades
nothing.

| # | surface | verdict |
|---|---|---|
| 1 | Disarmed = zero behavioural delta | **INERT-CONFIRMED** — 15/15 route-table snapshots equal the pre-mirror core; relay bytes, priority, CID, fan-out identical |
| 2 | Broken / absent / hostile sidecar | **INERT-CONFIRMED** — 16 hostile trees, relay unaffected in all, refusals only in the status/control |
| 3 | Failure containment | **INERT-CONFIRMED** — no gate can survive a restart; output-bridge death and foreign gates do not touch the relay; SIGINT while disarmed sends nothing |
| 4 | Other scenes / scene switching / multi-client | **INERT-CONFIRMED** — every scene on disk, both directions, one and two windows |
| 5 | Engine side (guard + removed unicast) | **INERT-CONFIRMED for the ship** · **one live check owed** on the retired `10.x.x.202` stream |
| 6 | Playa failure drills | **INERT-CONFIRMED where offline-provable** · recovery invariant documented in §6 |

There are **seven observations** (§3) — benign deltas and residual risks worth
the operator knowing. None of them is a reason to hold the feature.

**The single strongest fact:** every mirror hook on the disarmed path is a guard
that reads `_mirrorArm === null` (or an empty `_activeMirrors`) and returns.
`_mirrorArm` is process memory, initialised to `null` at module load, written
only by `armBenchMirror` (which requires a WS gesture plus every check plus a
gate ack) and cleared by `disarmBenchMirror`. There is **no disk, env, argv or
config path into it** — I re-verified this by full read, and `_155`/`_158`
verified the same.

---

## 1. Method

Both real bridges (`server/sacn_bridge.js` and `server/sacn_output_bridge.js`)
were loaded **in-process** with the `sacn`, `ws` and `process_priority` modules
replaced by fakes and `fetch` stubbed as the engine — the tier-2 rig from
`tests/bench_mirror_arm.test.js`, rebuilt in the scratch dir so it could be
driven imperatively. Nothing bound a port; every "send" landed in an array.

Four harnesses, all in `~/tmp/disarmed_review_159/`:

| harness | what it proves |
|---|---|
| `h1_disarmed_equivalence.mjs` | the whole disarmed battery vs the pre-mirror routing core |
| `h2_sidecar_hostility.mjs` | 16 hostile sidecar trees via an `fs` overlay (the real tree is never written) |
| `h3_gate_containment.mjs` | gate persistence, restart, link death, foreign holders |
| `h5_post_cycle_residue.mjs` | arm → disarm → is the disarmed state identical again? |
| `h6_arm_refusal_no_output_bridge.mjs` | ARM pressed with the output bridge DEAD — does the ship survive? |
| `h4_engine_side.mjs` | the boot guard against the REAL config (read-only) + temp copies |

**The counterfactual.** "As if the feature had never been built" is not a file I
can check out — the mirror has been in `sacn_bridge.js` since `7d2cb6d7`, and the
intervening commits changed unrelated routing behaviour. So I used the honest
equivalent: the relay route set is, pre-mirror and post-mirror alike, a pure
function of the scene files computed by `computeEffectiveRoutes`
(`lib/bridge_routing.cjs`) — and **that file's only change on this branch is
comments** (`git diff HEAD` = 14 lines, all inside a comment block; verified by
reading the diff). So `computeEffectiveRoutes` IS the pre-mirror core, unmodified,
and "the live sender set equals its output at every step" is exactly the property
the operator is asking about.

---

## 2. Surface by surface

### 2.1 Disarmed = zero behavioural delta — **INERT-CONFIRMED**

**The exhaustive touch-point list.** From the complete `git diff HEAD` of
`sacn_bridge.js` (1386 lines added), every code path a DISARMED bridge can reach:

| # | site | what happens while disarmed |
|---|---|---|
| 1 | module load | two extra `require`s; `MIRROR_CID = md5('bm26:bridge-mirror')` computed once |
| 2 | module state | `_mirrorArm=null`, `_activeMirrors=[]`, `_relaySuspended=false`, `_relayCloseHeld=false`, `_armBlackoutInFlight=false`, `_blackoutHold=null`, `_gateLink=null`, `_gateLostWhileArmed=null`, `_lastSelection` empty |
| 3 | `recomputeRoutes` armed-health block (`:589`) | `if (_mirrorArm && …)` false ⇒ **skipped entirely, including `readBenchMirrorSpecs()`** |
| 4 | `recomputeRoutes` mirror block (`:671`) | `if (_mirrorArm !== null)` false ⇒ `_activeMirrors = []` |
| 5 | `partitionMirrorSuppression` (`:706`) | `mirrors: []`, `hold: null` ⇒ returns `relay: [...routes]` — a shallow copy, same objects, same order — and empty `suppressed`/`targets` (`bench_mirror.cjs:392-393`) |
| 6 | engine-clash loop (`:709`) | iterates an empty Map |
| 7 | mirror sender diff (`:855`, `:866`) | iterates empty maps |
| 8 | `mirrorSig` / `suppressedSig` logs | both `''` ⇒ one "Bench mirror INACTIVE" line at boot, nothing after |
| 9 | `wss.on('connection')` (`:1079`) | one extra `benchMirrorStatus()` — `readBenchMirrorSpecs()`, **0.295 ms** on the live tree (measured, 200 iterations) — and one extra JSON frame to that client |
| 10 | WS message handler | three new `else if` branches, none reachable without an operator gesture |
| 11 | WS close (`:1176`) | `if (_mirrorArm && _mirrorArm.ws === ws)` false |
| 12 | `routeFrame` (`:2233`, `:2241`) | `mirrorInbound()` returns on `_activeMirrors.length === 0` (first line); `if (!_relaySuspended)` is true ⇒ the identical relay loop |
| 13 | `shutdown` (`:2310`) | `_mirrorArm === null && !blackoutInFlight()` ⇒ log + `process.exit(0)`, **no blackout, no send** |
| 14 | boot banner | two extra console lines |

**No mirror-owned timer runs while disarmed.** Every `setTimeout`/`setInterval`
in the file, re-enumerated against the 14:32 revision: `:995` (engine-poll abort,
pre-existing), `:1285` (priority lockout, pre-existing), `:1428`/`:1571` (gate
ack — inside `ensureGateLink`/`setOutputGate`, unreachable while disarmed),
`:2424` (engine poll, pre-existing), `:2442` (shutdown only), and the new
`:2136` held-dark ticker, which is created **only** for an armed all-`none`
mapping and cleared on disarm (see the disclosure box above). The stall watchdog
and the misalignment counter live **inside** `flushMirrors`, which is scheduled
only by `mirrorInbound`/the dark ticker — both of which early-return on an empty
`_activeMirrors`.

**Strictly LIGHTER than HEAD.** The shipped v2 called `readBenchMirrorSpecs()` on
**every recompute** (`git show HEAD:` — the old `for (const found of
readBenchMirrorSpecs())` loop). v3 calls it only when armed, plus on status
builds. The disarmed recompute now does *less* file I/O than the code currently
on `main`.

**Measured (H1).** Boot → one titanic window → client tag churn across
`studio` → `test_bench` → `titanic` → `studiodj` → `led202` → `titanic` → a
second window tagged `test_bench` → engine scene `studio` → `test_bench` →
`titanic` (each with a real 3.4 s wait for the bridge's own engine poll) →
engine claims one titanic pair → releases it → second window closes.

- **15/15 steps: the live relay sender set is exactly `computeEffectiveRoutes`'s
  output** for that (pin, engine scene, client scenes, engine-owned) tuple.
- **0 mirror senders created, ever.**
- **0 connections to `:6972` from the input bridge, ever** (the output bridge's
  client set stayed empty through the entire battery).
- Relay byte path: one send per `(universe, ip)` route per inbound frame; the
  payload object handed to the sender is **the inbound object itself**
  (identity-compared, not deep-equal); priority is the inbound priority (100 in,
  100 out; 150 in, 150 out); `sourceName` is `MarsinRelay Engine`; **no CID
  override** — the mirror's distinct CID never touches a relay frame.
- `active requests: 0` at the end; the only open handles are piped stdout/stderr.

**Status while disarmed:** `armed:false`, `blackoutInFlight:false`,
`destinations:[]`, `selection:[]`, `specErrors:[]`.

### 2.2 Broken / absent / hostile sidecar — **INERT-CONFIRMED**

`readBenchMirrorSpecs()` is reached on the disarmed path **only** through
`benchMirrorStatus()` (new connection, status broadcast) and the two operator
gestures. Per-scene parse failures are caught per scene (`sacn_bridge.js:490`)
and returned as `errors`; a `readdirSync` failure warns once and returns empty.

16 hostile trees (H2), each injected through an `fs` overlay that intercepts
**only** paths ending in `bench_mirror.yaml` — the operator's tree was never
written to:

absent · unparseable YAML · the actual committed HEAD **v1** file · a v2-shaped
file · empty file · YAML `null` · a top-level list · a valid file plus one
unknown key · a valid file naming fixtures that do not exist · **a broken sidecar
in every one of the 8 scenes at once** · **a valid sidecar in every scene at
once** · 1 MB of comments before a valid file · a 5000-slot file · a BOM/NUL
prefix.

For every one of them:

- **relay sender set unchanged** and still equal to the pre-mirror expectation;
- **no crash** — nothing propagated out of the status build or the recompute;
- **zero mirror senders, zero gate links**;
- the refusal appears **only** in `status.specErrors` / `status.available` and in
  the ARM refusal text. `benchMirrorControlState` turns those into a **disabled**
  control with `✋ …` inline text (`available.length === 0` ⇒ disabled;
  `available.length > 1` ⇒ disabled, "the bridge will not pick one for you") —
  exactly the unavailable-state text the mission asked for, and nothing else in
  the sim reads those fields;
- ARM was attempted for `test_bench`, `titanic`, `studio`, a nonexistent scene
  and `null` in every case: **every refusal put 0 frames on the wire, opened 0
  gate links, and named a reason.**

Scenes with no sidecar at all — `titanic`, `studio`, `studiodj`,
`studio_top_loft`, `summer_camp_dome`, `summer_camp_logsville`, `led202` (I
enumerated `simulation/scenes/*/`: **only `test_bench` carries one**) — are
refused with *"scene 'titanic' declares no bench_mirror.yaml. Scenes that do:
test_bench."* They contribute nothing to routing, subscription or senders.

D-158-5 confirmed fixed in passing: a real v1 file now dies on the **version**
check and the migration paragraph is present in the message (reproduced with the
committed HEAD file).

**Cost:** `readBenchMirrorSpecs()` on the live tree is **0.295 ms**; the 1 MB
pathological file pushed one full status cycle from ~13 ms to ~39 ms. It is
blocking work on the bridge's event loop, but only at connect/transition — see
OBS-3.

### 2.3 Failure containment — **INERT-CONFIRMED**

**A gate cannot survive a restart.** `gateHolder` is a module-scope `let`
initialised to `null` (`sacn_output_bridge.js:77`). The file contains **no
write path of any kind** — no `writeFile`, no state file, no env read. H3 proves
it dynamically: gate the bridge, confirm frames are dropped, drop the module from
the require cache, re-require it, feed a frame → **forwarded**. A fresh boot
cannot start gated. *If it could, that would be the defect the operator fears
most; it cannot.*

**The gate dies with its link.** Gate held ⇒ 0 sends; drop the control link ⇒ the
next frame is forwarded, with the loud `⚠ ▶ physical output UNGATED` line.

**The input bridge never dials `:6972` while disarmed** — verified across boot,
client connect, and two scene tags (H3 §4): `ensureGateLink()` is called only
from `setOutputGate()`, which is called only from `armBenchMirror`,
`disarmBenchMirror` and `proveOutputGateHeld`. So "the gate control link existing
at all while disarmed" is **not a state that exists**.

**A foreign gate does not touch the relay.** With some other client holding
`:6972`'s gate and the input bridge disarmed, an inbound frame is still relayed
normally (H3 §5). The sim window's own priority-150 path is dead in that state,
but the ship is still fed by the bridge — see OBS-4.

**Output-bridge crash while disarmed:** the input bridge holds no link to lose,
has no `onGateLinkLost` to fire, and its relay is untouched. **Input-bridge
crash while disarmed:** the launcher restarts it (`start.js` restarts on any
unexpected child exit, budget `MAX_RESTARTS` in `RESTART_WINDOW_MS`, then
escalates rather than restart-looping); it comes up disarmed and the relay set is
complete at boot from the `--scene` pin (H1 step "boot" — the full titanic route
set exists **before any client connects**).

**SIGINT while disarmed sends nothing.** `shutdown()` takes the
`_mirrorArm === null && !blackoutInFlight()` branch and calls `process.exit(0)`
immediately — no blackout frames to any relay route. (Read-verified, not
executed: invoking it would kill the harness.)

**Round trip leaves no residue (H5).** Arm → (relay set empty, gate link up,
mirror senders live) → disarm → **the relay sender set is byte-identical to the
pre-arm set**, zero open mirror senders, the gate link is **closed**
(`closeGateLink()` at `:1796`), the output bridge forwards sim frames again, and
the whole status object is **string-identical** to the pre-arm status. A
post-cycle scene battery (`titanic → studio → test_bench → titanic`) matches the
pre-mirror expectation at every step.

### 2.4 Other scenes, scene switching, multi-client — **INERT-CONFIRMED**

Arming is scene-parametric and refuses cleanly for everything that is not a
healthy, enabled `test_bench` sidecar with the engine on a different scene:
R-1 (no scene named), R-2 (does not parse), R-3 (no sidecar), R-4
(`enabled: false`), R-22a (a scene cannot stand in for itself), R-6/R-7 (engine
unreachable / no scene), R-16 (a slot the scene cannot resolve), R-8 (no
`outputRouting`), R-21 (any engine-direct route at all). Each refusal is a reply,
not a throw, and — measured — costs 0 frames and 0 gate links.

Scene switching with the feature present but disarmed was exercised in **both**
directions and across **every scene on disk**, from the client tag and from the
engine poll, single- and double-window. In all 15 snapshots the relay set is the
union the pre-mirror core computes; a second window only ADDS its scene's routes
(the 2026-07-24 ownership law), and closing it removes exactly those. The
multi-window census warning is unchanged.

### 2.5 The engine side — **INERT-CONFIRMED for the ship; one live check owed**

Verified offline (H4), never booting an engine:

- the **real** `config.yaml` passes `assertNoDirectHardwareRoutes` and declares no
  `controllers:`; `sacn.destinations` is `["127.0.0.1"]` — everything goes to
  loopback, where the bridge is the single router;
- a temp copy that reintroduces `controllers:` **refuses to boot**, and so do
  `controllers: []`, `controllers: null`, top-level `alsoFlat:` and `protocol:`;
- `lib/output_dispatch.js` and `lib/artnet_output.js` are gone, with no dangling
  references anywhere in `marsin_engine/` or `simulation/` (the only `_routing`
  hits in `api_server.js` are `ws_topic_routing`);
- `/status.outputRouting` is the literal `{ controllers: [] }`;
- `engineOwnedPairs({controllers: []})` is empty — so **R-21 is vacuous but
  armed**: a non-empty payload still parses to 2 pairs, so the check is live code,
  not a no-op that would silently stop refusing;
- the engine guard's own suite: **9/9**.

**The one thing the operator should look at.** The deleted block was
`Titanic-202` → `10.x.x.202`, U10 + U12, `alsoFlat: true`. `_157` §6 established
— and I re-verified from the **live route table**, not from the report — that
ship U10/U12 are relayed to `10.x.x.13` and `10.x.x.14`, which are different
pairs, so **the ship's U10/U12 fixtures are unaffected**. What is retired is the
redundant direct stream to `10.x.x.202`, and `10.x.x.202` appears **nowhere** in
any scene's `controllers.yaml`/`patches.yaml` (grepped all 8 scenes). So if that
address is a real board, nothing feeds it any more — and nothing sent it a
blackout when the mechanism was deleted, so it will hold whatever it last showed
until it is power-cycled. That is a **deliberate** consequence of the operator's
own removal ruling, not a regression in the mirror; it is listed as OBS-6 because
it is the one visible physical change on the normal path.

### 2.6 Playa failure drills — see §6

---

## 3. Observations (ranked; no defects)

**OBS-1 — LOW/BENIGN. New SIGINT/SIGTERM handlers change the disarmed exit
shape.** `sacn_bridge.js:2333-2334` is new on this branch (HEAD had no signal
handler). Disarmed, the bridge now logs and `process.exit(0)` instead of dying by
signal. `start.js`'s `onChildGone` restarts on **any** unexpected exit (code or
signal) and is suppressed by `shuttingDown`, so the launcher's behaviour is
unchanged either way. No action.

**OBS-2 — LOW. `MIRROR_CID` hashes MD5 at module load.**
`crypto.createHash('md5')` (`:271`) runs at boot even when nothing will ever be
armed. On a FIPS-enforcing Node build that call **throws**, which would take the
bridge down at startup — i.e. a mirror-only line on the ship's critical boot
path. This box is not FIPS and the show server will not be; noting it because it
is the one disarmed-path line that can *fail*, and a non-MD5 digest (or a
hardcoded 16-byte literal) would remove the class entirely.

**OBS-3 — LOW. Sidecar I/O on the connect path.** Every new sim window makes the
bridge `readdir` `scenes/` and parse every sidecar (0.295 ms today). A
pathological sidecar makes that ~8 ms per call. It is blocking work on the
process that relays every ship frame. Bounded (connect/transition only, and the
input is an operator-authored file in the repo), but a cached-with-mtime read
would make it free. No action needed for the show.

**OBS-4 — LOW/MEDIUM (pre-existing, widened). `:6972` accepts a gate command from
any client, unauthenticated.** `handleControlMessage` has no origin check, and
the server binds all interfaces (`_157` D7). Any LAN client — or a sim window
that somehow sends that JSON — can gate the sim's own output path while the
bridge is disarmed, with no way for the input bridge to notice. **The ship is not
darkened by this** (the bridge relay is a separate writer and I measured that it
keeps running, H3 §5), and the loud `⛔ physical output GATED` line names it. The
recovery is a restart of the output bridge. Worth knowing at 2 am.

**OBS-5 — LOW. The browser belt trusts a pushed status.** `animate.js:699-703`
suppresses the window's `:6972` output when its last `benchMirrorStatus` said
`armed:true`. A window that misses the disarm broadcast would keep its own
output suppressed. Bounded three ways: any socket drop nulls the status
(`sacn_input_source.js`), the bridge pushes status to every new connection, and
the ship is fed by the bridge relay regardless. The belt is explicitly *not* the
enforcement.

**OBS-6 — INFORMATIONAL (ship-visible). The retired `10.x.x.202` stream.** See
§2.5. Ship U10/U12 unaffected; the `.202` board, if real and previously lit by
the engine's direct stream, is now unfed and was never zeroed. **Live check
owed:** look at whatever `10.x.x.202` physically is, once, on the next power-up.

**OBS-7 — INFORMATIONAL. `window.sacnInput.armBenchMirror` is a page global.**
`sacn_input_source.js:170`/`:183` are reachable from any sim window's devtools
console, bypassing the disabled header button (already noted by `_158` §2.5).
Inherent to the design — the header control calls exactly those. The consequence
of an accidental arm is loud (HUD banner, bridge log, ship dark) and one DISARM
away.

---

## 4. What I could NOT prove offline

| claim | why offline cannot settle it | exact live check |
|---|---|---|
| the disarmed bridge's **wire** output is byte-identical to pre-mirror | my senders are fakes: I proved the payload/priority/CID/fan-out handed to the `sacn` package, not the datagrams | one `tshark`/`Wireshark` capture on the show LAN with the bridge disarmed: confirm the relay's CID is the package default (NOT the mirror CID `md5('bm26:bridge-mirror')`), priority 100, one source per universe |
| SIGINT/SIGTERM while disarmed emits nothing | executing it would kill the harness; verdict is by code read | Ctrl-C the launcher with the mirror disarmed and confirm no zero frames appear in the capture |
| the launcher's real restart timing | `start.js` was read, not run (it spawns real bridges on real ports) | kill `sacn_bridge.js` by PID with the mirror disarmed; confirm the ship resumes within the ~1 s restart backoff and the log shows `Route created:` for the titanic set |
| `10.x.x.202` identity | the address is not in any scene file, and no device HTTP was allowed | one look at that board (or its absence) on power-up |
| FIPS/MD5 (OBS-2) | depends on the show server's Node build | `node -p "require('crypto').createHash('md5')&&'ok'"` on the show box |

---

## 5. What could still go wrong on playa (residual risk)

1. **An accidental ARM.** Nothing in the disarmed path can arm itself, but a
   human can — one click in the 🎛 Controllers header, or one console call
   (OBS-7). The consequence is the **whole ship going dark**, deliberately and
   loudly (HUD banner in every window, `⛔ ALL ordinary relay SUSPENDED` in the
   log). *Mitigation: everyone who touches the sim should know that banner means
   "press DISARM".*
2. **A gate held by something that is not our arm** (OBS-4). Ship unaffected;
   the sim's own `:6972` output is silently dead until the output bridge is
   restarted.
3. **A stale `armed:true` in one window** (OBS-5). That window stops its own
   priority-150 output. Ship still fed by the relay.
4. **The `.202` board** (OBS-6) — unfed and possibly frozen on its last look.
5. **A pathological `bench_mirror.yaml`** (OBS-3) — tens of milliseconds of
   event-loop stall per sim-window connect. Only reachable by editing the file.
6. **MD5 at boot** (OBS-2) — a bridge that will not start on a FIPS Node.
7. **Everything that was already true before the mirror existed** and is
   unchanged by it: `:6971`/`:6972` are unauthenticated, the receiver accepts any
   multicast source, two sim windows double-drive the rig. `_157` D3/D4/D5/D7
   own those; none of them is made worse by this feature, and none of them is
   made better either.

**Not on this list, because I measured them as impossible:** a disarmed bridge
creating a mirror sender; a disarmed bridge holding a control link; a gate
surviving a restart; a broken sidecar affecting relay; a scene switch perturbing
routes; an arm/disarm cycle leaving residue.

---

## 6. The recovery invariant (the 2 am answer)

**If the bench mirror is misbehaving, DISARM always wins, and if you cannot
reach DISARM, killing something always wins.** In order of escalation:

1. **Press DISARM** (🎛 Controllers header). Sends 3 all-zero frames to the bench
   destinations, restores the **entire** relay set in the same pass, then ungates
   `:6972` last. Ship lit before the sim's own path returns — no window where two
   writers overlap. *Refused only while the ARM's own blackout is still in
   flight; wait for the ARMED line and press again.*
2. **Close the sim window that armed it.** The arm is socket-scoped: its
   disconnect runs the same disarm.
3. **Kill the input bridge** (`server/sacn_bridge.js`). The launcher restarts it
   within ~1 s; it comes up **DISARMED**, rebuilds the full relay from the
   `--scene` pin before any client connects, and the output bridge releases its
   gate the moment the control link dies. The ship comes back on its own.
4. **Restart the launcher.** Same as 3 for both processes.
5. **Power-cycle the box.** Every start comes up disarmed — there is no persisted
   arm and no persisted gate anywhere in the tree.

**What does NOT self-recover:** the bench boxes' last composed look if the bridge
was killed mid-arm rather than disarmed (nothing sent them zeros) — they are
bench-only, and the next relay or arm/disarm cycle fixes them. And `10.x.x.202`
(OBS-6).

**What never needed recovering, because it was never touched:** any titanic
controller, while the mirror was disarmed.

---

## 7. Hygiene

- **Zero writes** outside this report and the tracker block. No source, test,
  scene, doc or config edit. No git write operation of any kind.
- **No port bound, no packet, no device HTTP, no engine started, nothing armed on
  hardware.** Both bridges ran in-process against faked sockets. The hostile
  sidecars were injected through an `fs` **overlay** — the operator's
  `scenes/**/bench_mirror.yaml` was never written and its mtime is unchanged.
- Scratch (harnesses + one temp config copy carrying a synthetic, non-routable
  placeholder host) is in `~/tmp/disarmed_review_159/`, gitignored and outside
  the source tree.
- Suites run: `simulation/npm test` → **1881 / 1875 / 6** (the same six
  pre-existing failures `_158` recorded — pixel-map/fixture-docking, unrelated);
  the four focused suites (`bench_mirror`, `bench_mirror_resolve`,
  `bench_mirror_arm`, `bridge_routing`) → **181 / 181 / 0**; the engine's
  `output_config_guard.test.js` → **9 / 9 / 0**. The engine's full suite was
  **not** run — it spawns real engines and `_158` already contributed that state
  residue twice; `tests/io/status_output_routing.test.js` was skipped for the
  same reason (it boots a real engine on the repo config).
- Every claim here is a file read, a `git show`/`git diff`, a test run or a
  reproduced in-process trace. Citations are `file:line` against the working tree
  on `feat/bm_readiness` at the snapshot named at the top.
- IPs redacted to `10.x.x.NN` throughout. No future dates.
