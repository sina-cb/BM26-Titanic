# 20260804_152 — BENCH MIRROR runtime mode: adversarial routing + test review of `_151`

**Agent:** reviewer (Opus) · **Branch:** `feat/bm_readiness` · **Task:** `_152`
**Under review:** `.agent/reports/202608/20260804_151_bench_mirror_runtime_mode.md`
**Design:** `.agent/reports/202608/20260804_150_bench_mirror_audit.md`

**READ-ONLY on production code.** Zero source/test/scene/doc edits outside this
report and the tracker block. Zero git write operations (`show`/`diff`/`status`
only). **No server started, no port bound, no packet toward any controller, no
device HTTP, no engine boot.** The operator's live stack (6966–6972, 5568, 8081,
10000) was never approached. Every dynamic check ran in-process against fake
sockets; scratch files live in the session scratchpad, none in the source tree.

IPs are redacted to `10.x.x.NN` in this prose per
`.agent/os/security_privacy.md`. The scene/config files and the runtime UI carry
the real values and were not edited.

---

## 0. VERDICT

**FIX-FIRST — one defect on the operator's advertised disarm gesture.**

> **SUPERSEDED — see §5 RE-VERIFICATION: final verdict SHIP.** All five defects
> below were closed by the implementation owner in the same slice; D1 and D2 were
> falsified and re-confirmed independently. §1–§4 are preserved as the first-pass
> record. One non-blocking residual (RESIDUAL-1) is carried in §5.5.

Eight of the nine attack surfaces are CONFIRMED. `_151` is substantially what it
claims: the mapping is untouched, the arm is genuinely process-memory-only, the
refusals are exhaustive and loud, the `_105` fixes are real and correctly scoped,
and the test file loads the **real** bridge rather than a mock of it. The counts
in the report reproduce exactly.

The failure is in **one-writer during disarm**. The mission required "no second
writer" on disarm. On the socket-close path — the gesture `_151`'s own operator
instructions advertise ("or just close the sim window that armed it") — an
ordinary relay sender is re-created on an owned pair **while the blackout frames
are still in flight**, and a raw frame is emitted between blackout frame 1 and
frame 2 on that same `(universe, controller)`. Reproduced deterministically.

| # | attack surface | verdict |
|---|---|---|
| 1 | One-writer proof while armed | **CONFIRMED** steady-state · **BROKEN** during socket-close disarm (**D1**) |
| 2 | Armed defaults OFF, no persistence | **CONFIRMED** |
| 3 | Clean disarm (3× zeros awaited before release) | **CONFIRMED** for frame ordering · **BROKEN** for single-writer (**D1**), re-entrancy hole (**D2**) |
| 4 | Refusals fail loudly | **CONFIRMED** |
| 5 | Status broadcast + staleness | **CONFIRMED** |
| 6 | Sidecar mapping byte-identical, `suppress_host` semantics | **CONFIRMED** |
| 7 | Tests prove what is claimed | **CONFIRMED** counts and rig · **coverage gap** that is exactly why D1 was missed (**D4**) |
| 8 | Non-interference + security posture | **CONFIRMED** |
| 9 | `_105` scope (M2 subtraction without dest-host validation; F10) | **CONFIRMED** |

---

## 1. Defect list

### D1 — MODERATE. Relay sender re-created on an owned pair mid-blackout: two live writers

**`simulation/server/sacn_bridge.js:943-946`**

```js
if (_mirrorArm && _mirrorArm.ws === ws) {
  void disarmBenchMirror('the sim window that armed it disconnected', 'disconnect');
}
if (scene) recomputeRoutes(`client of scene '${scene}' disconnected`);
```

`disarmBenchMirror` is `async`. Its synchronous prologue clears `_mirrorArm`,
sets `_mirrorDisarming = true`, empties `_activeMirrors`, and fires the first
round of blackout sends — then **suspends** at
`await Promise.all(...)` (`:1225`). Control returns to the close handler, which
**synchronously** calls `recomputeRoutes(...)` at `:946`.

That recompute sees `_mirrorArm === null`, so `_activeMirrors` is empty
(`:502-503`), so `partitionMirrorSuppression` suppresses nothing (`:525`), so
every owned pair is back in `relayRoutes` and the sender-creation loop at
`:627-647` **opens a relay sender on it immediately**. `_mirrorDisarming` guards
only the sender-**closing** loop (`:668`); nothing guards sender **creation**.

The comment at `:938-942` asserts the opposite of what the code does — it
reasons about the plain recompute not *closing* a mirror sender, which is true,
and does not consider that the same pass *creates* the relay writer the blackout
is still handing off from.

**Repro** (offline, zero ports, zero packets — same `Module._load` rig as
`tests/bench_mirror_arm.test.js`, plus the `setScene` the real browser sends on
WS open). Events on the owned gateway pair after the arming socket drops:

```
send  [ALL-ZERO BLACKOUT]
open                        ← ordinary relay sender created for the SAME pair
send  [RAW RELAY FRAME]     ← second writer, mid-blackout
send  [ALL-ZERO BLACKOUT]
send  [ALL-ZERO BLACKOUT]
close
send  [RAW RELAY FRAME] …
```

> DEFECT CONFIRMED: 1 RAW relay frame reached `U2 → 10.x.x.10` BEFORE the last
> blackout frame on that same pair — two live writers on one
> (universe, controller) during the socket-close disarm window.

**Blast radius, stated honestly.** Bounded and small:

- Only `U2 → 10.x.x.10` collides. On the wholly-owned LED box the blackout
  targets U10/U12 while the restored relay is U30/U31 — different universes,
  so no per-pair collision, and **the frozen-frame hazard the blackout exists to
  prevent is not reintroduced**.
- The end state of that pair is the raw relay anyway, so the visible artefact is
  a few milliseconds of ordinary titanic bytes arriving out of order with the
  zeros, not a stuck or wrong look.

**Why it still blocks.** The brief's requirement was categorical — "clean disarm
… no second writer" — and this is the disarm path `_151` §9.2 tells the operator
to use. A one-writer law with a documented exception window is not the law the
`_15` fix established. The fix is small and local: when this socket's disconnect
already triggered the disarm, let the disarm's own post-blackout recompute
(`:1237`) do the work — `clientScenes.delete(ws)` at `:935` has already run, so
that recompute picks up the scene removal too. (Guarding sender creation on
`_mirrorDisarming` would also work; the branch is cleaner.)

### D2 — MINOR. No `_mirrorDisarming` guard on the ARM path; the bridge logs DISARMED while ARMED

**`simulation/server/sacn_bridge.js:1256-1266`** and
**`simulation/lib/bench_mirror.cjs:431-576`** (`evaluateArmRequest`).

`armBenchMirror` reads `activeArm: _mirrorArm`, which a disarm-in-flight has
already set to `null`. Nothing consults `_mirrorDisarming`. An ARM that lands
inside the blackout window is therefore **accepted**, and the refusal branch that
exists precisely for this ("a re-arm must go through the blackout, not around
it", `bench_mirror.cjs:470-474`) is bypassed.

**Repro** (same rig; `FakeSender.send` resolves on a later event-loop turn, which
is how `dgram.send` actually behaves — with a synchronously-resolving fake the
whole blackout completes in microtasks and the window is invisible, which is why
`tests/bench_mirror_arm.test.js` cannot see this):

```
 3  reqId=undefined  armed=true   reason=armed by an operator gesture at …45.697Z
 4  reqId=a2         armed=true   ← ARM accepted mid-blackout
 5  reqId=undefined  armed=true   reason=the operator pressed DISARM
 6  reqId=d1         armed=true   ← the DISARM's own reply says ARMED

log order: 🪞 BENCH MIRROR DISARMING → 🪞 BENCH MIRROR ARMED → 🪞 BENCH MIRROR DISARMED
```

The bridge prints `🪞 BENCH MIRROR DISARMED — … released. The ordinary relay is
back` (`:1238-1242`) while it is in fact ARMED. That is the lying log the whole
design set out to make impossible. Secondary effects: `_mirrorPriority.clear()`
(`:1235`) wipes the new arm's priority map, and the new arm's destinations
receive the tail of the previous arm's zero frames.

**Reachability is low** — a human cannot click ARM inside a few-millisecond
window, and the button only flips to ARM after the disarm broadcast. It is
reachable by any local WS client (the `:6971` control surface has no auth or
origin check — `_150` §3) and by the socket-close disarm racing a scripted arm.
Classify as robustness, not a show blocker. Fix: refuse the ARM while
`_mirrorDisarming`, with a named reason.

### D3 — COSMETIC (report accuracy, not code). `_lastArmStatus` does not exist

`_151` §2 documents the module-scope state as including `let _lastArmStatus =
null;`. Grep across `server/`, `src/`, `lib/`, `tests/` finds no such
identifier. The actual state is `_mirrorArm`, `_mirrorDisarming`,
`_lastRelayRoutes`, `_lastSuppressedSig`. No behavioural consequence — status is
always rebuilt fresh by `benchMirrorStatus()` (`:1165`), which is the better
design and matches §7.1's "never a cached copy". The report's file table
(§8) also lists `_lastArmStatus`. Correct the report, not the code.

### D4 — TEST COVERAGE GAP. The fake client never sends `setScene`, which is exactly why D1 is invisible

**`simulation/tests/bench_mirror_arm.test.js:347-362, 565-587`**

`FakeClient` never sends `{type:'setScene'}`. The real browser sends it in its
`onopen` handler (`src/dmx/sacn_input_source.js:222-227`). Consequence:
`clientScenes` is empty for every test socket, so the close handler's
`if (scene) recomputeRoutes(...)` at `sacn_bridge.js:946` **never runs in any
test**. The socket-drop test at `:565` therefore exercises a control flow the
real system never takes — and passes.

This is the sharpest finding about the harness: it is a genuinely good rig (real
bridge, real recompute, real handlers) whose one divergence from the real client
is on the exact line where the defect lives. Adding `setScene` to `connect()`
would have failed the suite.

### D5 — COVERAGE GAP (not a defect). Untested paths

- **SIGINT/SIGTERM blackout** (`:1441-1458`) — no test. Read-verified: it awaits
  `disarmBenchMirror` before `process.exit(0)`, bounded at 1500 ms by an
  `unref`'d timer. Narrow edge: a signal arriving while `_mirrorDisarming` is
  true sees `_mirrorArm === null`, reports "bench mirror was not armed" and exits
  immediately, killing an in-flight blackout.
- **`ownedUnavailable` / engine-owned degrade at recompute** — the ARM refusals
  are tested end-to-end; the runtime auto-disarm branches are tested only purely
  (`evaluateArmedHealth`).
- **`_105` F12 cross-sidecar overlap** — pure only, no end-to-end case.
- **Ordering dependence:** the Tier-2 tests share one bridge instance and one
  `sends` array and depend on execution order (the arm in one test is the
  precondition of the next three). Works under `node --test`; brittle.

---

## 2. Attack surface detail

### 2.1 One-writer while armed — CONFIRMED (steady state)

Traced every path that can emit to an owned destination:

- **Relay hot path.** `routeFrame` (`:1373-1383`) reads `outgoingSenders`, which
  is rebuilt at `:652-656` from `_routeEntries`, which is diffed at `:618-647`
  from `relayRoutes` — the **post-suppression** set from
  `partitionMirrorSuppression` (`:523-525`). Owned pairs and every universe on a
  wholly-owned host are absent by construction. Verified dynamically: while
  armed, inbound U2/U30/U31 produce zero raw sends to any owned destination.
- **Client-tag-driven routes.** A window tagging `test_bench` adds that scene's
  pairs to `routes`, but suppression is keyed on `(universe, ip)` and on host, so
  U10/U12 → `10.x.x.60` are removed and `U1 → 10.x.x.10` (fog/haze, not owned)
  correctly survives. No path adds a route after the suppression split.
- **Engine-owned routes.** Removed upstream by `computeEffectiveRoutes`; and
  `mirrorTargets` subtracts `engineState.owned` at `:528-531`, so the two sets
  cannot both claim a pair.
- **Arm-time gap.** `_mirrorArm = {...}` (`:1273`) → `recomputeRoutes` (`:1290`)
  is straight-line synchronous — no `await`, so no frame can be routed between
  them.
- **Health/activation divergence.** `_activeMirrors` is gated on
  `isMirrorActive(spec, engineScene, armedForThis)` while suppression is gated on
  `_activeMirrors`. A state where the flag is set but the mirror is inert would
  un-suppress the relay with the banner still up; `evaluateArmedHealth`
  (`bench_mirror.cjs:589-617`) is a strict superset of `isMirrorActive`'s
  conditions and runs **first** in `recomputeRoutes` (`:444-459`), so the
  divergence is unreachable. Good.
- **Priority-150 writer #2.** Unfixed, unfixable at this layer, correctly
  surfaced as an ARM warning (`bench_mirror.cjs:565-570`). Matches `_150` §4.

### 2.2 Armed defaults OFF — CONFIRMED

`let _mirrorArm = null;` at `sacn_bridge.js:248`, module scope. Grepped the whole
bridge for `writeFile` / `localStorage` / `sessionStorage` / `process.env` on any
`_mirrorArm` line — none; the only `process.env` in the file is the unrelated
`BM26_BRIDGE_PRIORITY`, and every `readFileSync` is a scene/config read. The
existing pin (`bench_mirror.test.js`) enforces this per-line and passes.

Client side: `armBenchMirror` is called only from `runBenchMirrorAction`
(`sacn_monitor_panel.js:101-106`), which fires only from the button. The
reconnect path (`sacn_input_source.js:216-228`) sends `setScene` and nothing
else — **no auto-rearm**. On socket close the client sets
`stats.benchMirror = null` and hides the banner (`:243-244`) rather than
asserting a stale ARMED. Verified dynamically: a freshly constructed bridge
reports `armed:false` to its first client, and the ordinary relay owns every pair
the mirror would take.

### 2.3 Clean disarm — CONFIRMED for ordering, BROKEN for single-writer

Frame ordering is right on every path. `disarmBenchMirror` (`:1207-1245`) clears
the flag and `_activeMirrors` synchronously, sends `BLACKOUT_FRAMES = 3` full
512-channel zero payloads per owned universe and **awaits** them, and only then
recomputes — which is the pass that closes the mirror senders. `_mirrorDisarming`
holds the close loop off (`:668`). The dynamic test proves exactly 3 all-zero
512-channel frames per owned universe, and since `FakeSender.send` rejects once
closed, recording 3 successful sends *is* proof they preceded the close.

Per exit path: explicit DISARM ✓; socket close ✓ frames, ✗ single-writer (D1);
engine-scene-change degrade ✓ (called from inside `recomputeRoutes` with an
immediate `return`, so no second recompute in that turn); `ownedUnavailable`
degrade ✓ same branch; SIGINT/SIGTERM ✓ by read (D5).

### 2.4 Refusals — CONFIRMED

All eleven branches in `evaluateArmRequest` are named refusals with no permissive
default, and each is unit-tested. Wrong scene names **both** scenes; unreachable
engine and `ownedUnavailable` both refuse rather than assume; engine-owned pair
and engine-owned-universe-on-a-wholly-owned-host both refuse; cross-sidecar
overlap refuses by scene name; an unnamed scene refuses rather than guessing.
A v1 sidecar is refused **at parse** (`bench_mirror.cjs:133-141`) with the
migration spelled out, and that message is quoted verbatim into the ARM refusal
(`:444-448`).

The ARM's post-recompute **proof** (`:1297-1327`) is real and is not
self-referential: it re-reads the live sender maps through the same
`buildRouteTableSnapshot` the `_127` LED push uses, requires every owned pair to
be mirror-owned and in neither `routes` nor `engineOwned`, requires no relay
sender to survive on a wholly-owned host, and **auto-disarms** otherwise. Worth
noting as a positive: an ARM issued while the boot gate is still closed makes
`recomputeRoutes` a no-op, the snapshot comes back empty, and the proof
auto-disarms loudly. Fail-loud by construction rather than by accident.

### 2.5 Status — CONFIRMED

`benchMirrorStatus` (`:1165-1187`) is built fresh from live state on every call —
there is no cached status to go stale. Pushed to every new connection
(`:867-872`) and broadcast on every transition. A tab connecting after an arm is
told `armed:true` and its banner renders (verified dynamically); a tab connecting
after a disarm gets `armed:false` from the same fresh build. Refusals are replied
to the requesting socket only, which is correct — a refusal is not a state
transition — and are separately `broadcastLog`'d to the monitor.

### 2.6 Sidecar — CONFIRMED

`git show HEAD:simulation/scenes/test_bench/bench_mirror.yaml` parsed and
compared structurally against the working tree:

```
HEAD version: 1 | WORKING version: 2
mapping identical (source_scene / enabled / dest_universe / dest_host / all slices): true
slice count: 7
suppress_host by host: [["10.x.x.10", false], ["10.x.x.60", true], ["10.x.x.60", true]]
top-level keys  HEAD: version, enabled, source_scene, note, mirrors
                WORK: version, enabled, source_scene, label, note, mirrors
per-mirror keys HEAD: dest_universe, dest_host, note, slices
                WORK: dest_universe, dest_host, suppress_host, note, slices
```

All seven slices, every `source_universe` / `source_addr` / `length` /
`dest_addr`, unchanged. The only deltas are `version`, the new top-level `label`,
the three `suppress_host` declarations, and comments — exactly what was
permitted. `suppress_host` semantics match the operator ruling: `10.x.x.60` is
`true` (wholly owned, so a lit strand means the mirror reached it), `10.x.x.10`
is `false` (pair only, so the ship gateway's U3/U4 keep flowing). Both halves are
pinned by a live-map test that derives the two hosts from
`test_bench/controllers.yaml` rather than hard-coding them.

### 2.7 Tests — CONFIRMED counts and rig

Runner is `node --test tests/*.test.js` (`simulation/package.json`), not jest.

| run | observed |
|---|---|
| `tests/bench_mirror_arm.test.js` | **35 tests, 35 pass, 0 fail** |
| `tests/bench_mirror.test.js` | **48 tests, 48 pass, 0 fail** |
| both together | **83 / 83 / 0** |
| full suite `node --test tests/*.test.js` | **1826 tests, 1820 pass, 6 fail** |

The six failures are byte-identical to `_151`'s list and all pre-existing:
`fixtures are docked beside the ship…`, `REFUSES: a patched fixture no chain
reaches…`, `the real titanic scene can accept the block today…`, the two
scene-block CLI cases, `the compression threshold has real headroom…`. **`_151`'s
1826 / 1820 / 6 claim reproduces exactly.**

Rig quality — attacked, and it holds: `Module._load` is patched **before**
`require('../server/sacn_bridge.js')`, so the file under test is the real one,
and the real `recomputeRoutes`, real message handlers, real `sendVia`, real
`disarmBenchMirror` all execute. No real `Sender`/`Receiver` is constructed, no
port is bound, every send lands in an array, and the teardown test asserts the
class identities. No address literal appears in the file — `GATEWAY`/`LED` are
derived from the live sidecar. Not a mock testing a mock.

Assertions checked for vacuity: the "exactly 3 all-zero frames" count is a real
constraint in both directions; the "raw frames never reach an owned destination"
test iterates actual recorded sends; the 512-channel assertion would catch a raw
payload passthrough. The one weak case is "a refused ARM sends nothing"
(`:456-465`) — no inbound frames are fed, so `sends.length === 0` would hold
regardless; harmless, but it proves less than it reads.

### 2.8 Non-interference — CONFIRMED

`simulation/scenes/titanic/controllers.yaml` and `patches.yaml` are **not
modified**. `git status` shows `test_bench/controllers.yaml`, `patches.yaml`,
`marsin_engine/models/test_bench*`, `titanic/pixel_map_views.yaml` and playlists
as modified — attribution verified by mtime: all of those are **00:10–00:22**,
the operator's own earlier session; `_151`'s nine files are **08:43–09:10**. Their
diffs are device push receipts, `output:` fields and a TE-Sign removal — nothing
mirror-related. `_151`'s §7.4 honesty note is accurate.

`python scripts/security_check.py --all` → **6 findings, all the pre-existing
MAC in gitignored `simulation/.scene_backups/studiodj/**`** — the recorded
baseline, unchanged. No IP literal appears in any of the seven changed/new
source files; the synthetic `10.9.9.x` addresses in `bench_mirror.test.js` are
non-routable placeholders in the file's established style, not hardware.

### 2.9 `_105` scope — CONFIRMED, both halves

- **M2/F2 subtraction present, dest-host validation correctly absent.**
  `sacn_bridge.js:528-531` skips any target in `engineState.owned` and collects
  it into `mirrorEngineClash`, which logs by name and auto-disarms (`:532-544`).
  The only `dest_host` check anywhere is `classifyRouteIp`
  (`bench_mirror.cjs:174-177`), which refuses the placeholder/broadcast/loopback
  classes the relay refuses anyway. There is **no** "is this a bench controller"
  check — correct: `10.x.x.10` is a real ship controller by design and such a
  check would kill the intentional mapping.
- **F10 suppression log on its own signature.** `suppressedSig` is computed at
  `:717-718` and gated at `:719`, **outside** the `mirrorSig` block that closes at
  `:709`, and is derived from exactly what it prints — the same shape as
  `excludedSig` at `:735`. Pinned by an index-ordering assertion in
  `bench_mirror.test.js`.
- Also verified in passing: **F14** — mirror-state reuse is keyed on
  `JSON.stringify(found.spec)` (`:508`), so a comment-only sidecar edit no longer
  blanks the next composed frame. **F12** — cross-sidecar overlap refused at ARM
  for both pairs and hosts.

---

## 3. What the implementer should change

1. **D1** — `sacn_bridge.js:943-946`: do not run the plain scene-removal
   recompute when this socket's disconnect already started a disarm; the
   disarm's own post-blackout recompute (`:1237`) restores the relay and, because
   `clientScenes.delete(ws)` (`:935`) has already run, picks up the scene removal
   in the same pass. Correct the comment at `:938-942`, which currently reasons
   only about sender *closing*.
2. **D2** — refuse `benchMirrorArm` while `_mirrorDisarming` is true, with a
   named reason ("a blackout is in flight; wait for it to finish").
3. **D4** — send `{type:'setScene'}` from the test rig's `connect()`, matching
   `sacn_input_source.js:222-227`, and add a case asserting that no raw frame
   reaches an owned pair between the first and last blackout frame.
4. **D3** — remove `_lastArmStatus` from `_151` §2 and §8.
5. Optional (**D5**): cover the SIGINT path and the runtime `ownedUnavailable`
   degrade; consider whether a signal arriving mid-blackout should await it.

Nothing here requires touching the sidecar, either scene's controllers/patches,
or any engine model.

---

## 4. Hygiene

- **Zero writes** outside this report and the tracker landing block. No source,
  test, doc or scene edit. No git write operation of any kind — `show`, `diff`,
  `status` only.
- **No process started**: no engine, no sim, no bridge server, no launcher.
  **No port bound.** No sACN datagram, no multicast join, no device HTTP. The
  operator's live stack and the controllers on the LAN were never approached.
- The three repro scripts ran in the session scratchpad against fake `sacn` /
  `ws` modules; one was created in the source tree by mistake and removed in the
  same step, leaving the tree clean.
- Every claim is a file read, a `git show`, a test run, or a reproduced
  in-process trace; citations are `file:line` against the working tree on
  `feat/bm_readiness`.
- IPs redacted to `10.x.x.NN` in prose throughout.

---

## 5. RE-VERIFICATION (scoped pass) — **SHIP**

The implementation owner closed all five items in the same slice. Ground truth
re-established from disk first: only **four** files changed since §1–§4 were
written — `lib/bench_mirror.cjs` (09:29), `server/sacn_bridge.js` (09:38),
`tests/bench_mirror.test.js` (09:39), `tests/bench_mirror_arm.test.js` (09:39) —
plus report `_151` (09:41) and the tracker (09:42). The sidecar (08:44), the
banner, the control, the monitor panel and `sacn_input_source.js` are
**untouched since my first pass**. No new untracked file appeared.

**Verdict: SHIP.** D1 and D2 are fixed and I falsified both independently; D3 and
D4 are done; D5 is partly closed with the remainder explicitly accepted. One
residual hardening nit, below, which does not block.

### 5.1 D1 — FIXED, and fixed better than I proposed · CONFIRMED

The owner rejected my per-caller fix and was **right to**. My suggestion closed
the ws-close path only; `recomputeRoutes` is also reachable during the release
window from a client's `setScene` (`sacn_bridge.js:887`) and from the 3 s engine
poll (`:781`). The shipped fix states the invariant where relay senders are
*decided* instead:

- **Single choke point — verified by exhaustive grep.** `partitionMirrorSuppression`
  has exactly **one** call site that feeds the sender diff: `sacn_bridge.js:541`,
  passing `hold: _blackoutHold`. The only other production call is
  `bench_mirror.cjs:575`, inside `evaluateArmRequest`, which computes ARM
  *warnings* and creates no sender — correctly holdless. Everything that decides
  `relayRoutes` therefore passes through the hold by construction, so every
  recompute caller is covered without enumerating callers. The pinning test
  (`bench_mirror.test.js:598`) regex-matches the destructure **including**
  `hold: _blackoutHold`, so the call site cannot silently lose it.
- **Raised synchronously before the first suspension — verified against the
  actual suspension points.** `disarmBenchMirror` (`:1240-1259`) captures
  `entries` from the live `_mirrorEntries`, nulls `_mirrorArm`, sets
  `_mirrorDisarming`, and raises `_blackoutHold` at `:1253` — all before the
  `_blackoutSettled` IIFE at `:1266`, whose own body runs synchronously through
  the first `entries.map(sendVia)` before suspending. The outer function's first
  suspension is `await _blackoutSettled` at `:1277`. **No interleaving window
  exists between clearing the arm and raising the hold.**
- **Dropped in the same `finally` as `_mirrorDisarming`** (`:1278-1282`), so a
  rejected blackout still releases it. The hold set is `keys` from the live
  mirror senders (exactly the destinations receiving zeros) plus `was.hosts` (the
  wholly-owned boxes) — not stale: a destination the engine had claimed has no
  mirror sender, receives no zeros, and correctly needs no hold.
- **A re-arm during the window cannot repopulate `_mirrorEntries`** — D2's guard
  now refuses it (§5.2).
- The suppression log gained a third `blackout` sentence (`:738-752`), so the
  hold is visible in the operator's monitor rather than an unexplained gap; and
  the misleading ws-close comment (`:963-973`) now states what the code does.

**Falsified independently, without touching production code.** I installed a
`--require` preload that intercepts `lib/bench_mirror.cjs` and returns the real
module with the exported `partitionMirrorSuppression` forced to `hold: null` —
the D1 fix neutralised, nothing else changed. The repo's own regression then
fails with exactly the finding from §1:

```
✖ _152 D1: no raw relay frame reaches an owned pair between the blackout frames
  AssertionError: U2 → 10.x.x.10: a RAW frame was emitted between the first and
  last blackout frame — two live writers on one (universe, controller) during
  the release window
```

Without the preload it passes. **And my own §1 repro — a separately written
harness, not theirs — now reports `No raw frame overlapped the blackout` against
the fixed tree.** Two independently written harnesses agree.

Their regression is not vacuous: it pumps real inbound traffic on all three owned
universes for the whole window, asserts on an ordered cross-sender
`open`/`send`/`close` event log (no raw send, no relay `open`, no mirror `close`
between the first and last zero frame), and separately asserts that raw frames
**did** flow and **resumed** afterwards.

### 5.2 D2 — FIXED · CONFIRMED

`evaluateArmRequest` takes `blackoutInFlight` and refuses **first, before every
other branch** (`bench_mirror.cjs:463-474`); the bridge passes `_mirrorDisarming`
(`sacn_bridge.js:1315`). Ordering verified by reading — the check precedes even
the empty-scene guard, which is right: a blackout in flight is a property of the
bridge, not of the request.

Falsified the same way — a preload forcing `blackoutInFlight: false` makes the D2
regression fail; unpatched it passes. The test asserts both halves: the reply is
a refusal, **and** `🪞 BENCH MIRROR ARMED` never appears between `DISARMING` and
`DISARMED`, which is exactly the lying-log symptom I reported.

### 5.3 D4 — FIXED · CONFIRMED, and the third defect was real

All three harness defects are genuinely repaired: `connect()` now sends
`{type:'setScene'}` (`:480-484`), so `clientScenes` is non-empty and the close
handler's recompute actually runs; `FakeSender.send` resolves via `setImmediate`
(`:345-361`), so the release window exists at all; `captureConsole` /
`releaseConsole` are reference-counted (`:415-427`). The third is the owner's own
find, not mine, and it was real — nested capture/release handed the console back
mid-test and silently dropped lines a later assertion depended on. Completion is
now read from the bridge's status broadcast rather than from sender liveness
(mirror and relay senders share a key, so the old signal was ambiguous in both
directions), and my noted vacuity in *"a refused ARM sends nothing"* is closed
with a live frame.

### 5.4 D3 / D5 · CONFIRMED

`_lastArmStatus` no longer appears anywhere in `_151`. The runtime
`ownedUnavailable` degrade is now covered end-to-end (observed passing at 2.96 s
— it waits a real engine poll). The SIGINT/SIGTERM mid-blackout edge I raised is
**fixed in code**: `shutdown()` now tests
`_mirrorArm === null && !_mirrorDisarming` (`:1496`) and, when a blackout is in
flight, awaits `_blackoutSettled` before exiting (`:1502-1511`), still bounded by
the 1500 ms `unref`'d timer. Accepted as untested — I agree: stubbing
`process.exit` inside the shared bridge instance risks hanging the runner for
less than it proves. F12 end-to-end and Tier-2 order-dependence remain accepted
gaps, correctly labelled as such.

### 5.5 Residual — one hardening nit, non-blocking

**RESIDUAL-1 — `sacn_bridge.js:1253-1276`.** The hold is raised at `:1253`, but
the `try` that guarantees its release does not open until `:1276`. In between sit
`console.log` (`:1262`) and `broadcastLog` (`:1264`). `broadcastLog` calls
`client.send()` on every open client, and `ws.send()` can throw on a socket in
transition — and the socket-close disarm path is precisely where a just-closed
socket exists. A throw there would propagate out of `disarmBenchMirror` with
`_blackoutHold` **still raised and never dropped**, permanently suppressing the
ordinary relay on those pairs: an unfed gateway until the process restarts.

Narrow — `broadcastLog` guards on `readyState === 1` first, and the `ws` library
removes a closed socket from `wss.clients` before user handlers run. Note the
async IIFE at `:1266` is **not** a risk: a synchronous throw inside an async
function body becomes a rejected promise, which the `finally` already handles.
One-line hardening: open the `try` immediately after the hold is raised so the
two log calls sit inside it. Worth doing; does not block the ship.

### 5.6 Counts observed, versus claimed

| | claimed | **observed** |
|---|---|---|
| `tests/bench_mirror.test.js` | 52 / 52 / 0 | **52 / 52 / 0** ✓ |
| `tests/bench_mirror_arm.test.js` | 38 / 38 / 0 | **38 / 38 / 0** ✓ |
| full suite `node --test tests/*.test.js` | 1833 / 1827 / 6 | **1833 / 1827 / 6** ✓ |
| `security_check.py --all` | 6 baseline | **6**, all gitignored `.scene_backups/studiodj/**` ✓ |

The failing six are byte-identical to both prior runs, all pre-existing and
unrelated.

**No scope creep.** `git diff --stat` since my first pass shows only
`lib/bench_mirror.cjs`, `server/sacn_bridge.js` and the two test files changed;
the sidecar mapping is **still byte-identical to `HEAD`** (re-verified
programmatically) with `suppress_host` unchanged (`10.x.x.60` true, `10.x.x.10`
false); `titanic/controllers.yaml` and `titanic/patches.yaml` remain unmodified;
the operator's own uncommitted files are still at their 00:10–00:22 mtimes. No
falsification residue reached the source tree — both preloads live in the session
scratchpad and intercept at module-load time, so nothing was edited or reverted.

### 5.7 Re-verification hygiene

Read-only throughout: no production edit, no git write (`show` / `diff` /
`status` only), no port bound, no packet, no engine or bridge process started.
The two falsification preloads and my two repro harnesses ran offline against
fake `sacn` / `ws` modules in the session scratchpad.
