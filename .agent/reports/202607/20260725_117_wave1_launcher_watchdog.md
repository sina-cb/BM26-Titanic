# `_117` — WAVE 1 / W1-2: launcher supervision & watchdog

**Operator order (2026-07-31, "go"):** red-team fix campaign, Wave 1 —
dark-ship hardening (Family A). This thread owns the **launcher/supervisor**
half: `simulation/start.js` and `launcher.js` (repo root). It closes the
capstone finding `_115` **L1 (P0)** plus L4, L6 and the P2-6 testability gap,
and adds the freeze-watchdog the synthesis (`_111`) demanded of Wave 1.

**Scope discipline.** Files touched: `simulation/start.js`, `launcher.js`,
`simulation/lib/load_ports.cjs` (one additive, fail-loud leaf change — the only
way the port override can reach the child servers I do not own), and a new
`simulation/tests/launcher_supervision.test.js`. **No engine, no save-server /
probe (W1-4), no pattern VM (W1-3), no `scenes/**` touched.** The operator's
live stack (:6969-:6972, UDP 5568) was verified byte-identical before and after
(same PIDs 35692 / 17308 / 38388 / 50272). Every exercise ran on throwaway
ports 786x/787x + UDP 7568 via the new override.

---

## The supervision model, in two sentences

`start.js` is now a real supervisor: it **detects the death OR freeze of every
server it owns** (HTTP/save + both sACN bridges), restarts a failed child within
a bounded budget (5 restarts / 60 s), and — rather than hide a persistently
crashing child behind an endless restart loop (a fallback) — **escalates loudly
by exiting non-zero so the launcher's teardown fires and the show-server
supervisor relaunches.** `launcher.js status` now **health-probes EVERY child**
(save :6970, sACN-in :6971, sACN-out :6972, not just :6969/:6968) and reads the
input bridge's packet-count surface, so a dark or wedged server turns a green
dashboard **RED**, and "green" means the ports answer *and* frames are flowing.

Health signals consumed: an HTTP GET liveness probe per child (2xx/3xx for the
http/save servers; **any HTTP status incl. 426 for the two `ws` bridges** — a
426 proves the event loop is alive, and a bare GET fires no WS `connection`
event so it never pollutes the input bridge's sim-client census); and the input
bridge's existing `N packets/5s from '<source>'` monitor broadcast for
frame-flow. (Wants, noted below: a census-neutral `/health` on the bridges and a
frame/output indicator on W1-1's engine `/status` would make continuous
frame-flow supervision clean.)

---

## Fixes — root cause → change → proof

### 1 · L1 (`_115` P0, the capstone) — start.js blind to child death; every surface green

**Root cause.** `start.js:80-97` spawned four servers and, on a child `exit`,
only `console.log`'d a line — no restart, no teardown, `start.js` stayed alive
forever. The launcher supervises `start.js` (one `startChild('sim', …)`), not
its grandchildren, and `cmdStatus` probed only :6969 (sim http) and :6968
(engine). So `kill -9` on the save server or either sACN bridge left the rig
dark while `status` printed ✅ and nothing restarted.

**Change.**
- **`start.js` rewritten as a supervisor.** Each of the four children is a spec
  `{tag, spawn, healthUrl, bridge}`. On unexpected exit (crash / `kill -9` /
  watchdog-killed freeze) `onChildGone` records the death in a 60 s rolling
  window and restarts after a 1 s backoff; past `MAX_RESTARTS` (5) it calls
  `escalate()` — kill all children, `exit(1)` — so the launcher's crash path
  (`teardown`) runs. A Windows console-Ctrl+C race is absorbed with a
  `CRASH_VERDICT_DELAY_MS` (2 s win / 300 ms posix) exactly like the launcher.
- **`launcher.js cmdStatus` now probes EVERY child** via `healthCheckList()` +
  `runHealthChecks()`: sim-http, **save (`/list-scenes`), sACN-in, sACN-out**,
  engine (+ captainpad on dev profiles). Bridges use `expect:'any'` (426 = up).

**Proof.** New test `start.js restarts a real child killed with -9` spawns the
real `start.js` on throwaway ports, `kill -9`s the save server, and asserts a
**fresh pid** appears and the port answers again, with `exited unexpectedly`
logged (not silent). Live status demo (report artifact):
```
STATUS #2 (immediately after kill -9 on sACN OUT):
  ✅ save   ✅ sacn-in   ❌ sacn-out (no response)   ...
```
Pre-fix that same kill left `status` all-✅. Unit tests pin the bounded-restart
budget and the loud escalation (`died 6 times in 60s … NOT restart-looping …
Escalating`).

### 2 · Freeze detection (Family A watchdog; `_113` J1 context)

**Root cause.** A crashed child is one dark-ship mode; a **frozen** one (alive
but unresponsive — e.g. the engine wedged 296 s on `/timeline/overview`) is the
other, and nothing watched for it.

**Change.** `start.js` runs a **watchdog** every 10 s that HTTP-probes each live
child; `FREEZE_FAILURES` (3) consecutive misses on a process we believe is up ⇒
it is treated as frozen and **killed**, which routes it through the same bounded
restart path. `launcher status` additionally reports frame-flow: it briefly
reads the input bridge's `packets/5s` broadcast and prints
`⚠ … 0 packets/5s — the rig may be DARK` when the bridge is up but nothing is
flowing — so "green" is never reported over a dark rig. (Continuous frame-flow
in the watchdog is deliberately NOT wired to a restart, because a quiet engine
is not a bridge fault; restarting a bridge over engine silence would itself be a
fallback. It is surfaced, not acted on.)

**Proof.** New test `watchdog kills a FROZEN (alive-but-unresponsive) child`
injects an always-unresponsive probe and asserts the child is killed exactly at
the threshold, not before. Live status demo shows the frame-flow warning.

### 3 · L4 (`_115` P2-1) — IPv4/IPv6 port shadowing defeats `checkPortFree`

**Root cause.** `checkPortFree` did a bare `probe.listen(port)` — binds `::`
only — and reported FREE while an IPv4-only squatter on `0.0.0.0:P`/`127.0.0.1:P`
still held it; the sim then co-bound and every IPv4 client reached the impostor
while `waitForTcp` (127.0.0.1) greenlit it.

**Change.** `checkPortFree` now bind-probes **both** families the sim binds and
clients use — IPv4 `0.0.0.0` **and** IPv6 `::`, sequentially — and returns free
only if NEITHER is held (`bindProbe` helper; a missing family
`EADDRNOTAVAIL`/`EAFNOSUPPORT` can't be squatted, so it counts as free).

**Proof.** New test squats `0.0.0.0:PORT` and asserts `checkPortFree === false`
(then `true` once released). Reproduced the original shadow first
(`bare listen(::) → REPORTS FREE`), then verified the fix detects it.

### 4 · L6 (`_115` P1-5) — `-f` kills the running stack before validating args

**Root cause.** `main()` ran `assertSingleInstance(force)` (which force-kills the
live launcher + child tree under `-f`, and `prod` force-claims by default)
BEFORE `validate()`. So `node launcher.js prod -f --scene titaniccc` took the
show down and *then* exited on the typo.

**Change.** Swapped the two lines: **`validate()` (a pure existence check, no
ports, no side effects) now runs first**, so a bad scene/model/pattern fails
loudly without touching the running stack.

**Proof.** Code ordering verified; `validate()` is side-effect-free (only
`fs.existsSync` + `logError`/`exit`). The destructive `assertSingleInstance`
path is now strictly downstream.

### 5 · P2-6 (`_115`) — no port override anywhere in the sim stack/launcher

**Root cause.** `load_ports.cjs` read only `simulation/config.yaml` with no
env/CLI seam, so launcher-profile behaviour couldn't be tested without seizing
the operator's live ports (which is why `_115`'s launcher findings were
ANALYSIS-only and needed a private copy of `simulation/`).

**Change.** Added **`BM26_SIM_CONFIG`** — same fail-loud contract as
`MARSIN_CONFIG_FILE`. When set it points **every** sim reader (`start.js`,
`save-server`, both bridges, via `load_ports.cjs`) **and** the launcher
(`SIM_CONFIG_PATH` + `readPorts`) at an alternate port map. Unset = byte-for-byte
the shipped behavior; a set-but-unreadable value throws (no fallback to the real
config). Child processes inherit the env, so the whole constellation runs on
throwaway ports. Also guarded `main()`/boot behind `require.main === module` in
both files and exported the pure helpers, so the internals are unit-testable.

**Proof.** The entire new test file — and every manual exercise in this thread —
ran on 786x/787x + UDP 7568 through this override, never touching :6969-:6972.

---

## What health signals the watchdog consumes / wants

- **Consumes now:** per-child HTTP liveness (426-aware for the `ws` bridges);
  the input bridge's `N packets/5s from '<source>'` WS broadcast (frame-flow,
  on-demand in `status`).
- **Wants (flagged, not built — out of my two files):** a **census-neutral
  plain-HTTP `/health`** on both sACN bridges exposing `{packetsPerSec,
  activeSource, universes}` — connecting to the input bridge's WS counts as a
  sim window in its multi-window contention census, so continuous frame-flow
  supervision can't use it without a false "2 windows" warning. A **frame/output
  indicator on W1-1's engine `/status`** (is it emitting?) would let the watchdog
  verify the whole chain. Until those exist, freeze/death detection is
  continuous and frame-flow is an on-demand `status` advisory.

## Verification / suite delta

- **Sim suite:** baseline **1645 / 1637 pass / 8 fail** → after **1663 / 1655
  pass / 8 fail**. The 8 failures are **byte-identical** to the documented
  baseline (stale-model / scene-drift / compression); **zero new**. +6 new W1-2
  tests (the extra pass count is node's subtest accounting).
- **Live demonstration (report-only):** killed a child under the watchdog →
  detected + restarted (fresh pid) with `exited unexpectedly` logged; killed the
  sACN-out bridge → `launcher status` line went **❌**, not green; frame-flow
  line warned of a dark rig with no engine sending.
- **Isolation:** operator stack byte-identical before/after; throwaway-port
  orphans from the kill-tree races were swept (0 listeners on 786x/787x at exit);
  no `scenes/**`, engine, or `config.yaml` writes by this thread.

## Follow-ups (not mine to land)

1. Census-neutral `/health` on `sacn_bridge.js` / `sacn_output_bridge.js`
   (enables continuous frame-flow in the watchdog).
2. Engine `/status` frame/output indicator (W1-1) for end-to-end flow checks.
3. `_115` P2-3 (launcher `status`/`stop` refuse on a corrupt lock) — NOT in this
   thread's scope; the `_99` `ELOCKCORRUPT` recovery still lives only in the
   `start` path. Small, worth a follow-up.
4. Notion card: MCP connection not available this session — not filed.
