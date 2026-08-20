# _260 — Launcher teardown integrity: the W-A slice of docs/62 — 2026-08-15

**Agent:** Opus implementer. **Scope:** `docs/62_service_lifecycle_and_upkeep.md`
**W-A1 … W-A6** only (W-B and W-C untouched, still open). Decision points taken
on Fable's recommended defaults: **D1** = the sentinel reaps in ALL profiles,
**D2** = `shell:false` for `node` children.

**Live-stack safety:** the prod stack (6966-6969, sACN 5568), the operator's
:6981 Metro and the :7175 mirror ran untouched throughout. Every test spawn used
scratch ports **17311-17324 / 17568 / 17868**, a scratch lock, a scratch arm
marker, and only ever killed processes this session spawned itself. Verified
after the work: all six live ports still LISTENING, live lock unchanged.

**GATE: LAUNCHER RESTART REQUIRED to activate.** Nothing here affects the
running launcher process — the current stack keeps the old behavior (including
the cmd.exe-wrapper pids in its lock) until the coordinator's next bounce.

---

## What landed

### W-A1 · Spawn contract — the shell exists only for `.cmd` shims

`startChild` no longer hardcodes `shell: IS_WIN`. It derives both the shell and
the quoting from one contract:

- `spawnNeedsShell(command)` — `node` → **false** (a real executable: args pass
  verbatim, no quoting layer exists to get wrong, and `child.pid` IS node);
  `npx`/`npm` → true (Windows cannot exec a `.cmd` shim without cmd.exe); any
  other command **throws by name** rather than being guessed at.
- `windowsShellQuote(args)` — quotes on `/[\s&()^%!"=,;]/` and **THROWS** on an
  embedded `"` or `%` (`%VAR%` expands even inside cmd.exe quotes). Identity on
  POSIX. Exported.

This replaces the coordinator's whitespace-only quoting hot-fix at
launcher.js ~:892 — the four `node` children (sim, engine, audio companion,
CaptainPad static server) no longer touch a shell at all, and `npmInstall`
routes through the same contract.

### W-A2 · The lock records REAL pids + `stackPorts`

`writeLock` now carries `stackPorts` (every port this run owns) and
`resolvedChildren`, plus `reaperPid`. `recordResolvedChild(tag, port)` resolves
the pid that actually OWNS a child's port after readiness and records it beside
the spawn pid — used for the engine (cross-checkable) and for the one remaining
shell-wrapped child, `npx expo`, whose `child.pid` is the cmd.exe wrapper.
`resolvePortOwner` refuses to guess: 0 or >1 listeners records nothing and says
so, because the union reap covers the port anyway.

**Field evidence from the LIVE lock while writing this** (a pre-W-A launcher):
`children` = `sim 30392 · engine 4748 · audio 52120 · captainpad 34380`, while
the processes actually holding 6969/6968/6966/6967 are `41032 / 11844 / 3460 /
41532`. Four wrapper pids, zero real ones — exactly the defect W-A1/W-A2 close.

### W-A3 · `stop` reaps the UNION: lock pids ∪ identity-checked port holders

Extracted one reap implementation — `reapStaleStack` = blackout →
`reapLockChildren` → `sweepStackPorts` (`portCleanup.freeStackPorts`, so
identity-checked and ARM-interlocked by construction) → lock removal — used by
BOTH `cmdStop` paths and by the sentinel. `reapLockChildren` also reaps
`resolvedChildren`, which is what makes a wrapper-death orphan reachable.
`finishStop` exits **non-zero** naming every survivor when one of OUR signatures
still holds a stack port; a foreign holder is reported (`FOREIGN, left alone`)
and is explicitly not a stop failure. A lock with no `stackPorts` (pre-W-A2)
announces the skipped sweep loudly instead of re-deriving profile logic.

### W-A4 · PRIORITY DEFECT — the interlock hole is closed

`killStaleListeners` called `forceKillTree` directly, bypassing the F7
bench-mirror ARM interlock: a relaunch over an ARMED mirror would `taskkill /T
/F` the armed `sacn_bridge.js` with **no refusal**, freezing every mirrored box
on its last composed frame.

- Every launcher kill of a **port holder** now goes through
  `portCleanup.killPid`. Refusals are surfaced, and `claimStackPorts` (the new
  boot policy over the sweep) **aborts the boot** naming the refusal.
- Critically, the port-claim `force` (`-f`, and `prod` by default) is **NOT**
  forwarded to `killPid`. Claiming a port from a foreign process is a different
  decision from freezing an armed bench; the only override remains
  `--force-sacn` / `BM26_FORCE_SACN_KILL`. Pinned by its own test.
- The launcher's private `listenersOnPort`, `commandlineOf` and
  `STACK_PROCESS_SIGNATURES` are **deleted** — `portCleanup.*` everywhere, no
  local alias (the acceptance grep gives 0 definitions).
- New, adjacent hole also closed: `benchMirrorTreeGuard` /
  `assertNoArmedBenchMirror`. A `-f` **takeover** force-kills the previous
  launcher's whole TREE, and the bridge is a grandchild that `killPid`'s per-pid
  interlock never sees. The takeover now refuses over an armed mirror (corrupt
  marker also refuses — it cannot PROVE nothing is armed), overridable by
  `--force-sacn`. Note `stop`'s own tree kill is deliberately NOT gated: it
  requests the engine blackout first, which the armed mirror relays.

### W-A5 · The sentinel reaper

`tools/launcher_reaper.cjs` — Node built-ins only, spawned detached + `unref`ed
right after `writeLock()` (before the first child exists), never in `children`,
stdio pointed at `~/tmp/bm26_reaper.log`. Polls every 2 s; trigger is exactly
"the lock names launcher X AND X is dead", requiring **two consecutive**
dead observations so a normal teardown's exit-handler window can never read as
abnormal. Lock gone → exit 0; lock names another launcher → exit 0. On abnormal
death it calls the launcher's exported `reapStaleStack` — ONE reap
implementation, not a second copy of the policy — and refuses to start at all if
its argv lock path disagrees with the launcher module's resolved lock (it would
delete the wrong lock).

Race closed on top of the design: the lock records `reaperPid` and a `-f`
takeover explicitly retires the OLD sentinel (`killPreviousReaper`,
identity-checked), so a sentinel firing mid-takeover can never sweep the
incoming stack's ports.

### W-A6 · Runbook

New `.agent/ops/stack_lifecycle.md`: the three sanctioned stops (Ctrl+C /
`launcher.js stop` / `-f` takeover) and the explicit ban on killing the
launcher's shell/task wrapper or hand-killing individual children; what the
sentinel does and where its log is; how to read a `stop` that exits non-zero
(ARM refusal vs genuine straggler vs foreign holder); what the lock records; the
"check the arm marker before a bounce" order. Cross-linked from
`.agent/ops/show_server_ops.md`. `docs/62`'s status header now records W-A as
implemented with D1/D2 taken.

### Test seams added (both explicit, both documented as seams)

`BM26_LAUNCHER_LOCK` (lock path) and `BM26_REAPER_LOG` — same doctrine as
`BM26_SIM_CONFIG`. The suite sets the lock override **before** requiring
launcher.js, which makes it structurally impossible for any test in that file to
touch the operator's live lock.

---

## Gates

- **`simulation/tests/launcher_supervision.test.js`: 50/50 PASS** (was 24; +26
  new W-A tests, all pre-existing tests still green).
- **Mutation checks — each guarded line reverted, suite re-run, reverted back:**
  - M1 `shell: useShell` → `shell: IS_WIN` + the old whitespace quoting: the
    real-spawn test goes RED on `child.pid must BE the node process` (the argv
    assertion survives — proving the pid assertion is the one that catches a
    quoting-clever regression). A second source pin was added after this check,
    because the first version of that test did not notice the rebinding.
  - M2 drop `&` from `WINDOWS_SHELL_QUOTE_CLASS`: metacharacter test RED.
  - M3 `killStaleListeners` back to a direct `forceKillTree`: **4 tests RED**
    (routing, force-not-forwarded, refusal surfacing, and the source pin).
- **Real-spawn space+apostrophe test PASSES**: a script under
  `~/tmp/bm26_wa_<pid>/spawn contract 'dir/` reaches the child as ONE byte-
  identical argv entry AND `child.pid === process.pid` inside the child.
- **Interlock proof, end-to-end, twice**: (a) the boot sweep with the real
  `portCleanup.killPid` over a scratch-marker-armed `sacn_bridge.js` listener
  refuses BY NAME and leaves it alive, even with `-f` force; (b) `node
  launcher.js stop` over the same setup prints `REFUSING to kill pid …`,
  `STILL RUNNING`, and **exits 1**.
- **Sentinel proof, real processes**: a stand-in launcher killed with `taskkill
  /F` (no `/T`) → within ~16 s the orphan is dead, the port swept to zero
  stack-signature holders, the lock removed, the reaper exited, and the log
  carries `ABNORMAL LAUNCHER DEATH` + `reap complete`. It provably does nothing
  while the launcher is alive; a clean lock removal makes it exit on its own; a
  takeover makes it stand down.
- **Grep gate**: no `forceKillTree` remains in any launcher path that kills a
  port holder. The remaining call sites are our own children by handle
  (`stopChild`, the `exit` net), the lock-recorded children (per the design),
  the previous launcher during a takeover (now ARM-guarded), and the previous
  sentinel.
- **Neighbors**: `port_cleanup_arm_interlock` 14/14, the marsin_engine companion
  contract test (which reads launcher.js) 1/1.

### Foreign reds — NOT touched, NOT mine

`simulation/tests/*.test.js` overall: **2351/2359, 7 failures**, all in
scene/fixture/display areas and all reproducible standalone with my modules not
even loaded (verified for `bench_mirror_state.test.js`):

- `bench_mirror_state.test.js` — `_176 §5.3: a TEST-CONTEXT write into the
  REPO's real scenes dir is REFUSED`
- `bench_section_sync.test.js` — 5 reds (fixtures docked, orphan patch record,
  real titanic scene collisions, both CLI emit/parity cases)
- `touch_control_pixel_views.test.js` — `Live display orientation is a pure
  projection of authoritative 3D coordinates`

Almost certainly the concurrent scene/pixel-order work. Reported, not fixed.

## Files

- `launcher.js` — spawn contract, lock fidelity, union reap, interlock routing,
  sentinel spawn, `BM26_LAUNCHER_LOCK`/`BM26_REAPER_LOG` seams, new exports.
- `tools/launcher_reaper.cjs` — new.
- `simulation/tests/launcher_supervision.test.js` — +26 tests.
- `.agent/ops/stack_lifecycle.md` — new (W-A6).
- `.agent/ops/show_server_ops.md` — sanctioned-stops bullet + cross-link.
- `docs/62_service_lifecycle_and_upkeep.md` — status header only.

No git operations. No engine/schema/wire/client change. W-B (`--with-native-pad`,
the Metro fingerprint guard, retiring :7175) and W-C (`rebuild-pad`, stale-dist
warning, cadence memories) remain open exactly as designed.
