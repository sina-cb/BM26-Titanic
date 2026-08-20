# 20260725_99 — sACN INPUT bridge: the `addMembership EINVAL` boot crash, root-caused and killed

**Author:** developer/investigator (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-31
**Mission:** the sACN input bridge crashed at boot with `addMembership EINVAL`
from the `sacn` npm package (reported at the end of `20260725_92` §A7 as
pre-existing and "guaranteed to bite the next stack start"). Diagnose properly,
fix without a fallback, prove a clean bring-up.

Per `security_privacy.md` every real address here is redacted as `10.x.x.NN`;
interfaces and subnets are described generically. **Zero device HTTP, zero sACN
output enables, zero flashes, no git operations.**

---

## 0. TL;DR

| | |
|---|---|
| **Root cause** | A **boot-ordering race inside our own code**, not the NIC. The bridge subscribed universes *synchronously* at boot, before the `sacn` Receiver's own join loop (which the package defers to the socket's `listening` callback and runs over **the same array** `addUniverse` pushes into) had executed. The universe got joined **twice on one socket** — and a duplicate `IP_ADD_MEMBERSHIP` is `EINVAL` on Windows. |
| **Why it killed the process** | The package reports constructor-time join failures as `receiver.emit('error', …)`. `sacn_bridge.js` had a `packet` listener and **no `error` listener**, so an EventEmitter `'error'` with no handler **throws** — the whole input bridge died before relaying a frame. |
| **Trigger condition** | Any universe in the boot recompute's union that is **not** in the boot subscription list — in practice a scene patched to a universe the `📡 Subscribed Universes` field does not name. |
| **The NIC hypothesis is WRONG** | Proven by direct probe: `addMembership` succeeds on this box with `iface` unset, `0.0.0.0`, and the adapter's own address. Nothing about the machine's networking changed. |
| **Fix** | (1) a **boot gate** — no subscription until the receive socket is listening, deferral logged, held reason replayed; (2) a **loud, classified `receiver.on('error')`** — join failures isolated exactly as the runtime path already does, every other socket error FATAL; (3) a **self-policing invariant** at `listening` that fails hard if anything ever races in again; (4) **deterministic, logged interface selection** with an optional `sacn_interface` pin that fails loudly on a mismatch. |
| **Sim suite** | 1590 tests, **8 fail** — the documented baseline 8, **zero new**. (+19 new tests, 1571 → 1590.) |
| **Stack left** | Sim servers UP on :6969/:6970/:6971/:6972 + UDP 5568, pinned `titanic`. Input bridge verified receiving **1168 packets/5 s from `MarsinEngine`** while the engine was still up. **`launcher.js prod` could NOT be run — the permission system blocked it** (§6.3); the engine is currently down. One command from the operator completes the prod shape. |

---

## 1. Reproduction — the exact crash, twice

### 1.1 Through the bridge's own code path

`~/tmp/sacn_einval/repro_bridge_path.js` drives the **real** `sacn` Receiver
through the **real** `simulation/lib/bridge_routing.cjs` helper, in the bridge's
boot order: construct with a boot list, then subscribe a universe outside it
synchronously (what `recomputeRoutes('boot')` did).

```
boot universes: 1,2,3
[log]   runtime-subscribed U38 (scene 'titanic' patch) — boot
applied: {"added":[38],"failed":[],"invalid":[]}
universes now: 1,2,3,38
node:events:487
      throw er; // Unhandled 'error' event
      ^
Error: addMembership EINVAL
    at Socket.addMembership (node:dgram:907:11)
    at Socket.<anonymous> (…/node_modules/sacn/dist/receiver.js:46:33)
    at Socket.onListening (node:dgram:288:7)
    …
Emitted 'error' event on Receiver instance at:
    at Socket.<anonymous> (…/node_modules/sacn/dist/receiver.js:49:26)
  errno: -4071, code: 'EINVAL', syscall: 'addMembership'
```

Note the damning middle line: **`applied: {"added":[38],"failed":[]}`**. The
bridge's own subscription log said the join **succeeded** — and the process was
already dead a tick later. Full capture: `~/tmp/sacn_einval/repro_bridge_path.log`.

`receiver.js:46` is the constructor's join loop; `receiver.js:49` is the
`emit('error')` with nobody listening.

### 1.2 The minimal mechanism

`~/tmp/sacn_einval/probe2.js`, plain `dgram`, no sACN involved:

```
[duplicate join of U1 twice] 1->239.255.0.1 OK | 1->239.255.0.1 FAIL EINVAL addMembership EINVAL
```

**A duplicate multicast group join on one socket is `EINVAL` on Windows.** That
single line is the whole error.

---

## 2. Root cause

### 2.1 The package's shape

`node_modules/sacn/dist/receiver.js`:

```js
constructor({ universes = [1], port = 5568, iface = undefined, reuseAddr = false }) {
  this.universes = universes;                 // ← keeps OUR array, does not copy
  …
  this.socket.bind(this.port, () => {         // ← DEFERRED to 'listening'
    for (const uni of this.universes) {       // ← iterates the LIVE array
      try { this.socket.addMembership(multicastGroup(uni), this.iface); }
      catch (err) { this.emit('error', err); }
    }
  });
}
addUniverse(universe) {
  if (this.universes.includes(universe)) return this;
  this.socket.addMembership(multicastGroup(universe), this.iface);   // joins NOW
  this.universes.push(universe);                                     // and grows the array
}
```

Three properties combine badly: the constructor keeps *our* array, joins from a
**deferred** callback, and iterates that array **at callback time**.

### 2.2 Our boot order fed it

`sacn_bridge.js` (before this change) ran, all in one synchronous tick:

```
741  const receiver = new Receiver({ universes: sacnOpts.universes, … })   // join loop QUEUED
…
955  recomputeRoutes('boot')
       └─ applyUniverseSubscriptions(...)
            └─ receiver.addUniverse(38)   // joins U38 NOW, pushes 38 into sacnOpts.universes
                                          //   …which IS receiver.universes
--- next tick ---
     socket 'listening' → for (uni of this.universes) → addMembership(U38) AGAIN → EINVAL
                                                     → emit('error') → no listener → THROW
```

`sacnOpts.universes` is literally `receiver.universes` — the file's own comment
at line 776 says so ("the `sacn` package keeps the very array we handed its
constructor and pushes into it"). The consequence of that aliasing across the
deferred join loop was never followed through.

### 2.3 The second defect — no error listener

`grep receiver.on sacn_bridge.js` returned exactly one hit: `'packet'`. Report
`20260725_58` §7.1 carefully gave the **runtime** subscription path per-universe
error isolation (`applyUniverseSubscriptions`, `bridge_routing.cjs:472`), with a
long comment explaining that a failed join must not abort the rest. The
**boot-time** twin of that failure arrives as an `'error'` event, and had no
handler at all — so the very case the runtime path was hardened against was
lethal at boot.

### 2.4 What actually "changed on the box" — nothing networking

The mission brief's hypothesis (multicast join on an interface with no usable
IPv4 — sleeping Wi-Fi, VPN adapter) is **disproved on this machine**.
`~/tmp/sacn_einval/probe.js` joins 5 groups three ways:

```
[iface undefined (package default)] ok=5 fail=0
[iface 0.0.0.0]                     ok=5 fail=0
[iface <adapter's own address>]     ok=5 fail=0
```

The box has exactly one external IPv4 interface (one Wi-Fi adapter on a private
/24) plus loopback. Multicast joins are healthy.

**What changed was DATA, not the NIC.** The trigger is a universe in the boot
recompute's union that is absent from the boot subscription list. The boot list
is `colorWave.sacn_universes` (the `📡 Subscribed Universes` field in
`scenes/common.yaml`) when that field is set — and when it is set it **replaces**
the patches-derived list entirely (`sacn_bridge.js:129-131`). So:

> **the moment any scene patches a universe the field does not name, the input
> bridge crashes at boot.**

That is exactly the state `20260725_92` passed through: its §1 fix put the TE
signs on U38/U39 in `titanic/patches.yaml`, and the field is a separate,
hand-maintained control that has to be widened by its own edit. Whenever the two
were out of step across a stack start, the boot recompute pulled U38 into the
union, `addUniverse` raced the join loop, and the bridge died. The addendum then
removed both, which is why the divergence is **not** present in the tree today —
and why a plain boot right now no longer crashes.

It is a live landmine regardless: `20260725_92` §A8 step 1 leaves the operator
one action away from re-creating it (attach the four TE-sign halves to a
MarsinLED output → a new universe in `patches.yaml`, field untouched). Verified
current state, field vs every scene:

```
field (35): 1..27, 30..37
titanic  patch universes: 2..27, 30, 31   OUTSIDE FIELD: none
test_bench / studio / studiodj / summer_camp_* :  OUTSIDE FIELD: none
```

---

## 3. The fix

### 3.1 New pure module — `simulation/lib/sacn_receiver_boot.cjs`

Everything decision-shaped is pure (no sockets, no fs) so the invariants are
unit-tested; `sacn_bridge.js` keeps the imperative half. Four exports:

| export | what it decides |
|---|---|
| `resolveMulticastInterface({requested, interfaces})` | which local interface the joins are pinned to, plus the boot report lines |
| `createBootGate({onDefer})` | whether a recompute may subscribe **yet**; holds and replays the reason |
| `classifyReceiverError(err, ifaceLabel)` | `{fatal, message}` for a Receiver `'error'` event |
| `checkBootSubscriptionInvariant(boot, current)` | did anything race in ahead of the join loop |

### 3.2 The race — a boot gate (this is the actual root-cause fix)

`recomputeRoutes()` now returns early until the receive socket is listening, and
the `listening` handler replays the held reason:

```js
if (!_bootGate.guard(reason)) return;      // top of recomputeRoutes
…
receiver.socket.on('listening', () => {
  const invariant = checkBootSubscriptionInvariant(BOOT_UNIVERSES, receiver.universes);
  if (!invariant.ok) { console.error(`[sACN Bridge] ❌ ${invariant.message}`); process.exit(1); }
  const replay = _bootGate.open();
  console.log(`[sACN Bridge] ✅ Receive socket listening on :${SACN_UDP_PORT} — ` +
    `${BOOT_UNIVERSES.size} multicast group(s) joined on ${IFACE_LABEL}.`);
  if (replay) recomputeRoutes(replay);
});
```

Ordering is **guaranteed**, not hoped for: `socket.bind(port, cb)` registers the
package's join loop as a `'listening'` listener *inside the constructor*, and
Node fires `'listening'` listeners in registration order — ours is registered
after, so every boot group is already joined when the gate opens.

**Why this is not a fallback.** Nothing is skipped, softened or swallowed: the
held work runs in full, with its original reason, one tick later; every deferral
prints a line naming the reason and why. The only thing that changed is *when*.

### 3.3 The unhandled `'error'` — loud and classified

```js
receiver.on('error', (err) => {
  const { fatal, message } = classifyReceiverError(err, IFACE_LABEL);
  if (!fatal) { console.error(`[sACN Bridge] ${message}`); broadcastLog(message, 'warn'); return; }
  console.error(`[sACN Bridge] ❌ ${message}`);
  process.exit(1);
});
```

- `syscall === 'addMembership'` → **loud, not fatal**, and the message names the
  interface, states that UNICAST on that universe still arrives while MULTICAST
  does not, lists the real environmental causes, and points at the config lever.
  This is precisely the contract `applyUniverseSubscriptions` already documents
  for the runtime path — the two halves now agree instead of one logging a
  warning and the other killing the process.
- **anything else** (bind `EADDRINUSE`, `ENETDOWN`, …) → **FATAL**, `exit(1)`,
  with the code, the syscall and "the input bridge cannot receive a single frame
  — refusing to run half-alive." A bridge that receives nothing must not limp;
  that is the silent-dark shape codex P0 bans.

**Why the non-fatal branch is not a fallback.** Before this change that error
was *also* non-fatal in the only place it was handled (the runtime path); at
boot it was a bare unhandled-throw stack trace with no interface, no universe
and no consequence stated. Nothing is now hidden that was visible before — the
opposite. And the case that used to produce it (the duplicate join) is
**structurally impossible** after §3.2, with §3.4 to prove it stays that way.

### 3.4 Self-policing — the invariant that refuses to let this rot

At `listening`, `receiver.universes` must equal the boot list exactly. Anything
extra was pushed in before the join loop and has therefore been joined twice.
That is a **hard exit** with a message that names the offending universes,
predicts the exact symptom, and says *"A caller reached `recomputeRoutes()`
without going through the boot gate — fix the ordering, do not retry."* A future
refactor that reintroduces the race fails at startup with the diagnosis already
written, instead of an anonymous `EINVAL`.

### 3.5 Interface determinism + visibility

The Receiver was constructed with `iface` unset, so the OS chose the multicast
interface and **the log never said which**. Now:

```
[sACN Bridge] Multicast interface: OS DEFAULT (no sacn_interface in simulation/config.yaml). Set sacn_interface to the lighting-LAN address to pin it.
[sACN Bridge] IPv4 interfaces on this machine: <one adapter, one private-LAN /24 address>
```

- New **optional** `sacn_interface` in `simulation/config.yaml` (read by
  `lib/load_ports.cjs`, the single fail-loud reader for that file). Set it to an
  IPv4 address or an adapter name and every `IP_ADD_MEMBERSHIP` is pinned there.
- A value matching nothing on the box **throws at startup**, with an inventory
  of what the box actually has. A value naming an adapter that carries two IPv4
  addresses **throws as ambiguous**. Never a silent switch to a different NIC.
- Unset = `iface: undefined` = **exactly the shipped behavior**, printed as
  such. This is a documented configuration state, not a swallowed error.
- Two loud extras: `⚠ N IPv4 interfaces are up — the OS picks which one receives
  multicast sACN, and it may not be the lighting LAN` (multi-NIC boxes: VPN,
  Hyper-V switch, the show server), and `⚠ No external IPv4 interface is up.
  Multicast joins will FAIL … only UNICAST sACN will be received` — which is the
  brief's original hypothesis, now a named diagnosis instead of a mystery.

Verified live that the pinned value is one Windows accepts:
`~/tmp/sacn_einval/iface_pin_check.js` → `resolved iface = "10.x.x.NN" | source
= config` … `joined 3 groups on the pinned iface, no error`.

---

## 4. Files touched

| file | what |
|---|---|
| `simulation/lib/sacn_receiver_boot.cjs` | **new** — the four pure decisions + the full root-cause writeup in its header |
| `simulation/server/sacn_bridge.js` | boot gate in `recomputeRoutes`; `receiver.on('error')`; `socket.on('listening')` (invariant + replay + the ✅ line); interface resolution passed as `iface`; `os` require; `SACN_INTERFACE` |
| `simulation/lib/load_ports.cjs` | `requireOptionalString` + `sacn_interface` |
| `simulation/config.yaml` | `sacn_interface` documented (commented out — behavior unchanged by default) |
| `simulation/tests/sacn_receiver_boot.test.js` | **new** — 19 tests (§5.2) |

The uncommitted `_89` bench-mirror work in `sacn_bridge.js` was **not** touched:
the gate is one line at the top of `recomputeRoutes`, and the mirror's own
`mirrorSourceUniverses` contribution to `wantedUniverses` is untouched (it now
simply runs a tick later, like everything else in that function).

---

## 5. Verification

### 5.1 End-to-end, through the real bridge, under the real trigger

The tree no longer contains the divergence (§2.4), so it was **re-created
deliberately**: `scenes/common.yaml`'s field was narrowed to `1..27` (dropping
30-37) while `titanic/patches.yaml` still patches U30/U31 — the exact
"scene patches a universe the field doesn't name" condition. Fixed bridge:

```
[sACN Bridge] Subscribing to 29 universe(s) from patches: [1 … 27, 30, 31]
[sACN Bridge] Multicast interface: OS DEFAULT (no sacn_interface …)
[sACN Bridge] IPv4 interfaces on this machine: <one adapter, one private /24>
[sACN Bridge] Route recompute ('boot') held until the sACN socket is listening — multicast joins must not race the receiver's own boot join loop.
[sACN Bridge] ✅ Receive socket listening on :5568 — 27 multicast group(s) joined on OS default.
[sACN Bridge] runtime-subscribed U30 (relay route → 10.x.x.NN; scene 'titanic' patch) — boot
[sACN Bridge] runtime-subscribed U31 (relay route → 10.x.x.NN; scene 'titanic' patch) — boot
```

No EINVAL, no exit — the process ran until the harness timeout killed it. The
late universes are still subscribed, which is the whole point of runtime
subscription. `common.yaml` was restored immediately and verified **byte-clean**
(`git diff --numstat -- simulation/scenes/common.yaml` → 0 lines). Capture:
`~/tmp/sacn_einval/postfix_divergence.log`.

### 5.2 Suite

| gate | result |
|---|---|
| `simulation` `npm test` | **1590 tests, 8 fail** — the documented baseline 8, **zero new** (was 1571/8) |
| new `tests/sacn_receiver_boot.test.js` | **19/19** |
| `python scripts/security_check.py --all` | 6 findings, **all 6 pre-existing MACs in gitignored `simulation/.scene_backups/studiodj/…`**; none in any file this work touched |

The 8 baseline failures, unchanged and untouched by this work: `bench_section_sync`
×5 (docked fixtures / `TGT_UNIVERSE_RESERVED` / view-bit headroom / both CLI
tests), `pixel_map_view_defaults` ×1 (compression headroom), `scene_model_parity`
×2 (`test_bench`'s own TE-sign `strand_metadata_drift`, the re-save handoff from
`20260725_92` §A4).

The two **LIVE** tests are the regression pin that matters: they drive a real
`Receiver` on a high throwaway port both ways round. "subscribe before
`listening`" reproduces the crash (asserting, when the platform raises it, that
it is an `addMembership` error the bridge now classifies as non-fatal);
"subscribe from the `listening` handler" asserts **no error at all** and that the
late universe is still subscribed. A refactor that moves the boot recompute back
ahead of `listening` fails here.

### 5.3 Clean full bring-up — proof the input bridge is up

```
  TCP 0.0.0.0:6969 LISTENING 35692      HTTP 200
  TCP 0.0.0.0:6970 LISTENING 17308      HTTP 404 (save server, no GET /)
  TCP 0.0.0.0:6971 LISTENING 38388      ← sACN INPUT bridge
  TCP 0.0.0.0:6972 LISTENING 50272      HTTP 426 (WS upgrade required)
  UDP 0.0.0.0:5568                38388 ← same pid: the receive socket is bound
```

Bridge boot lines, live stack, scene `titanic`:

```
[sACN Bridge] Multicast interface: OS DEFAULT (no sacn_interface in simulation/config.yaml). …
[sACN Bridge] IPv4 interfaces on this machine: <one adapter, one private /24>
[sACN Bridge] Route recompute ('boot') held until the sACN socket is listening — …
[sACN Bridge] ✅ Receive socket listening on :5568 — 35 multicast group(s) joined on OS default.
```

Monitor endpoint, read-only probe (`~/tmp/sacn_einval/ws_probe.js` — connects to
the :6971 monitor WS and sends **no** `setScene`, so it adds no relay route):

```
WS OPEN -> sACN-IN monitor :6971
LOG {"type":"log","msg":"Browser connected (1 client(s))","level":"source"}
LOG {"type":"log","msg":"1168 packets/5s from 'MarsinEngine', 1 client(s)","level":"info"}
frames=1170 universes=[1,2,10,12]
```

Reception is proven end to end: the bridge is joined, receiving from the live
engine, and forwarding 515-byte frames to monitor clients.

---

## 6. Notes, scope and what I did not do

### 6.1 Zero device traffic

No controller HTTP, no sACN output enable, no flash. The only sockets opened
were the receive socket (which the bridge owns anyway), throwaway receivers on
high ports 45568-45570 in the tests, and a read-only monitor WS.

### 6.2 The `📡 Subscribed Universes` field is still a trap — just no longer a fatal one

With this fix, a scene patching a universe outside the field boots fine and
runtime-subscribes it with a logged provenance line. But the field still
**replaces** the patch-derived boot list rather than widening it
(`sacn_bridge.js:129-131`), which is a surprising shape for a hand-maintained
control on a public field. Not changed here — that is a behavior change to a
save-time gate `20260725_87` owns, and it deserves its own slice. Worth a
backlog card.

### 6.3 Stack state left behind — read this before assuming

**The sim servers are UP** (`cd simulation && npm start`), pinned `titanic`:
:6969 HTTP (200), :6970 save, :6971 sACN-IN, :6972 sACN-OUT, UDP 5568 bound to
the same pid as :6971. Re-verified at hand-off: the monitor WS still accepts
clients. (The harness stopped the *parent shell* of that `npm start` at one
point; the four servers survived it and are serving — checked by port, pid and
live HTTP/WS probe, not by assumption.)

**`node launcher.js prod --scene titanic` was NOT run — it was refused.** The
first attempt hit a **blocked-by-classifier permission denial** from the Claude
Code auto-mode gate, and per the rules I did not work around it. That is the
whole reason the prod shape is incomplete; it is not a judgement call I made.

There was also a real coordination reason to hold off earlier in the session,
worth recording because it will recur — `launcher.js:1025`:

```js
const force = opts.force || opts.command === 'prod';
```

`prod` **force-claims its ports by default**, including `:6968`. For most of
this session that port held the engine belonging to concurrent agents
`_97`/`_98` (`/status` → `activeScene: test_bench, pattern: 25_heartbeat`), and
starting `prod` would have killed it mid-work. There is no `--no-force`;
`--no-kill` would still collide on the engine port.

**Current state of the other ports:** :6966, :6967, :6968 and :7167 are all
**down** — the concurrent threads released them near the end of this session
(the input bridge logged the transition correctly and loudly: `⚠ Engine on
:6968 unreachable — engine-scene routes and dual-source suppression are OFF
until it returns`, followed by three `Route removed` lines). Nothing is
competing for the stack's ports now.

**To complete the prod shape** — one command, from the repo root:

```bash
node launcher.js prod --scene titanic
```

It force-claims :6966/:6968-:6972, so it will absorb the sim servers left
running; nothing needs stopping first. What that adds: the engine pinned to the
`titanic` model, the audio companion on :6966, and the sim browser window.
**Note before running it:** `marsin_engine/config.yaml` is currently CLEAN
against HEAD and its Titanic controller host is a real `10.x.x.NN` — i.e. the
loopback black-hole `_98` flagged in the pre-commit gate is already restored, so
a `prod` start WILL put engine frames on the wire toward that controller. That
is the normal show stack; just do not be surprised by it.

---

## 7. Follow-ups (backlog)

1. **`📡 Subscribed Universes` replaces rather than widens the boot list** (§6.2)
   — a field edit can still silently *narrow* what boot joins.
2. **`launcher.js prod` has no `--no-force`** — the show profile can only be
   started by killing whatever holds its ports, which makes it unusable
   alongside a concurrent agent or a hand-started engine. A `--no-force` (or a
   "port held by a stack process, reuse it" path) would remove the trade §6.3
   had to make.

No git operations were performed.
