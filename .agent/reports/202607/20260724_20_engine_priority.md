# 2026-07-24 — Engine-priority hardening (Slice 20, bm_readiness)

**IMPLEMENTATION — code-only; NO git ops, NO commits; operator's running
stack untouched.** Operator ask (Sina): *"Make the pattern generation a
realtime priority and never allow issues on that."* Context: the show box
runs sim + engine alongside Chrome, and freezes correlate with Chrome window
focus — Windows gives the **foreground** window a scheduling/priority boost,
so the engine's 40 fps sACN generation gets starved when a browser window is
clicked. Fix: elevate the engine (and the frame-relaying sACN bridges) above
the NORMAL class Chrome sits in.

---

## 0. TL;DR

- New shared module **`tools/process_priority.cjs`** does OS priority
  elevation with an **always-on read-back** (`[<label>] requested=X
  achieved=Y`) — no fallback, no assumed success (codex P0).
- The **engine self-elevates** at boot (authoritative — runs in the real node
  process) AND the **launcher elevates it parent-side** (belt-and-braces),
  resolving the engine's real pid via its bound API port (robust on Windows
  where the spawned child is a shell wrapper).
- The **two sACN bridges** self-elevate and are parent-elevated by
  `simulation/start.js`.
- **Default = HIGH** (`HIGH_PRIORITY_CLASS`). **REALTIME is opt-in**
  (`--engine-priority realtime` / config / env) and, because it normally needs
  admin, the read-back **reports what the OS actually granted** (HIGH when
  denied) with a loud warning — never a silent claim of realtime.
- **Proven:** external `Get-Process … PriorityClass = High` on a scratch
  engine; measured tick jitter under synthetic load dropped **~7×** and
  dropped-tick count recovered (see §4).
- **Operator action to activate: just relaunch** (`node launcher.js prod
  --scene test_bench`). The change takes effect on next launch; the currently
  running engine (pid 4748) is still at `Normal` and untouched.

---

## 1. What landed (files:lines)

| File | Change |
|---|---|
| `tools/process_priority.cjs` | **NEW.** Pure helpers (`normalizePriorityRequest`, `resolvePriorityRequest`, `classForNice`, `priorityLine`, `interpret`) + OS-touching `elevateSelf` / `elevatePid`. Only two SAFE targets exposed: `high`→HIGH_PRIORITY_CLASS (nice −14), `realtime`→REALTIME_PRIORITY_CLASS (nice −20). Always reads achieved priority back; never silently retries at a lower class. |
| `marsin_engine/engine.js` | require the module (top, line ~78); `--engine-priority` CLI flag + help; `enginePriority` / `enginePriorityConfig` in `parseArgs`; **self-elevation** call in `main()` right after the banner, gated `!list && !dryRun`. Precedence: env `BM26_ENGINE_PRIORITY` > `--engine-priority` > config `engine.priority`/`enginePriority` > `'high'`. |
| `marsin_engine/config.yaml` | `engine.priority: high` with a doc comment (direct-launch default). |
| `launcher.js` | require the module; `--engine-priority high\|realtime` flag (validated, default `high`) + help; pass `BM26_ENGINE_PRIORITY` to the engine child and `BM26_BRIDGE_PRIORITY` to the sim child; **parent-side belt** — after the engine's `/status` is up, resolve its real pid via `listenersOnPort(marsin_engine_port)` and `elevatePid`. Runs on scene-switch restart too (inside `startEngine`). |
| `simulation/start.js` | require the module; read `BM26_BRIDGE_PRIORITY` (default `high`); **parent-elevate** both bridge children (real node pids — spawned without a shell) with read-back logging. |
| `simulation/server/sacn_bridge.js` | **self-elevate** at startup (`[BridgePriority]`). |
| `simulation/server/sacn_output_bridge.js` | **self-elevate** at startup (`[BridgePriority]`). |
| `marsin_engine/tests/io/process_priority.test.mjs` | **NEW.** 11 unit tests — normalization, precedence resolver (incl. loud-warn on invalid), nice→class map, the exact `requested=X achieved=Y` log-line contract, realtime→HIGH clamp detection, REQUESTS table. |

`BM26_ENGINE_PRIORITY=realtime` is passed only when the operator opts in;
bridges track the engine request only **up to HIGH** (REALTIME is reserved
for the engine — a realtime relay could starve things and is not wanted).

## 2. Default behavior + the realtime opt-in

- **Default (any `node launcher.js …`):** engine → HIGH, both bridges → HIGH.
  Nothing to configure. HIGH sits above Chrome's NORMAL (and above Chrome's
  foreground boost, which does not cross the class boundary), so the render
  loop keeps being scheduled regardless of window focus.
- **Opt-in realtime:** `node launcher.js prod --engine-priority realtime`
  (or engine `--engine-priority realtime`, or `engine.priority: realtime` in
  `marsin_engine/config.yaml`, or `BM26_ENGINE_PRIORITY=realtime`). The engine
  **attempts** REALTIME_PRIORITY_CLASS and **reports what it got**: with admin
  → `achieved=REALTIME`; without admin the OS clamps to HIGH and the log says
  `requested=REALTIME achieved=HIGH` + a loud warning that realtime needs
  admin and HIGH is active. Bridges stay HIGH.
- **Failure is loud, never silent.** If `setPriority` throws (e.g. POSIX
  negative-nice without root) the process is left where the OS left it and the
  read-back line still prints the true class — an un-elevated engine is
  obvious in the logs.

## 3. Achieved-priority proof (external verification)

Scratch engine on a high port (`:6985`), state redirected to `~/tmp` so the
tracked `states/` tree was never touched:

```
node engine.js --port 6985 --model test_bench --pattern test_const   (BM26_ENGINE_PRIORITY=high)
  engine log:  [EnginePriority] requested=HIGH achieved=HIGH
  external:    Get-NetTCPConnection :6985 → node pid 42576 → PriorityClass = High   ✅
```

Realtime opt-in without admin (honesty check), `:6986`:

```
  engine log:  [EnginePriority] requested=REALTIME achieved=HIGH
               ⚠ requested REALTIME but the OS granted HIGH (needs admin — HIGH is active and safe)
  external:    PriorityClass = High   ✅  (matches the read-back; no false "realtime" claim)
```

Operator's LIVE engine (pid 4748, launched before this change) externally
reads `PriorityClass = Normal` — confirming (a) it was untouched, and (b) it
is exactly the vulnerable case this slice fixes on next relaunch.

## 4. Timer-resolution / tick-jitter measurement (§scope item 2)

Repeatable scratch harness in `~/tmp` (gitignored, prefix `prio_*`):
`prio_stressor.cjs` (busy worker threads = synthetic CPU contention) +
`prio_jitter.cjs` (runs the engine's 25 ms / 40 fps `setInterval`, reports
|actual−25 ms| jitter). Box has 32 logical CPUs; load = 64 busy workers (2×
cores). 8 s windows, first sample dropped.

| Condition | ticks (of ~320) | mean | p50 | p95 | p99 | max | sd |
|---|---|---|---|---|---|---|---|
| **NORMAL** under load | 281 (≈39 lost) | 3.396 | 3.351 | 4.758 | 5.242 | 5.925 | 0.757 |
| **HIGH** under load | 314 | **0.491** | 0.504 | 1.151 | 1.415 | **1.489** | 0.375 |
| NORMAL, light load (ref) | 312 | 0.639 | 0.552 | 1.640 | 3.054 | — | 0.488 |

(all jitter values in ms.) **Findings:** under contention, HIGH cut mean
jitter **~7×** (3.40→0.49 ms) and max **~4×** (5.93→1.49 ms), and recovered
lost ticks (281→314, i.e. NORMAL was dropping/coalescing ~12% of frames).
Node already keeps sub-ms timer resolution when *not* starved (the light-load
reference row), so the win is specifically **starvation resistance**, which is
exactly the operator's Chrome-focus symptom — no timer-resolution code change
is needed; the priority class is the lever.

## 5. Tests / checks

- **New unit suite:** `tests/io/process_priority.test.mjs` — **11 pass / 0 fail**.
- **Engine default suite** (`npm test`, glob `tests/**/*.test.{js,mjs}`):
  **2110 tests, 2103 pass, 7 fail**. The 7 are all pre-existing environment
  failures unrelated to this slice — `osc_listener.test.js` (sandbox denies
  binding random high ports: `EACCES` where `EADDRINUSE` expected;
  lifecycle/backoff subtests) and one `effects_v2_mode_page_layout.test.js`
  node:test IPC "Unable to deserialize cloned data". 7 < the ~9-fail baseline;
  no new failures. The log shows `[EnginePriority] requested=HIGH
  achieved=HIGH` from test-spawned engines — self-elevation is active and
  harmless there.
- **`node --check`**: pass on all six changed JS files.
- **Engine auto-checks:** `node engine.js --list` OK (did not touch the live
  `:6968`); `--dry-run` exits 0, no missing-blend warning; `--dry-run
  --engine-priority realtime` exits 0 and correctly does **not** elevate.
- **Launcher:** `node --check` pass; `--help` shows `--engine-priority`;
  invalid value rejected (exit 2); `realtime` accepted by the parser (a test
  launch was then correctly blocked by the single-instance guard, so the
  operator's stack was never disturbed).
- **`git diff --check`:** clean (the LF→CRLF lines are pre-existing Windows
  advisories on files this slice did not touch). No state residue from this
  slice — scratch engines used `MARSIN_STATE_DIR`/`MARSIN_PLAYLISTS_DIR`
  redirects. The `states/test_bench/*.yaml` churn in the tree is the
  operator's LIVE engine persisting runtime state (expected per
  `marsin_engine_auto_checks.md`); left untouched.

## 6. Design notes / why these choices

- **Self-elevation is authoritative; the parent-side is the belt.** Only the
  engine's own process can reliably target its own pid; the launcher's
  contribution reinforces it and gives a parent-side read-back. On Windows the
  launcher spawns with `shell:true`, so `child.pid` is a `cmd.exe` wrapper —
  parent-walking `ParentProcessId` proved unreliable, so the belt resolves the
  **real** pid via the API port the engine binds (`listenersOnPort`), which is
  guaranteed to be the engine process.
- **Launcher is the authority when launched through it.** It always passes
  `BM26_ENGINE_PRIORITY`, and the engine's precedence puts env first, so the
  launcher flag wins over engine config for the show path. `engine.priority`
  in `config.yaml` governs a bare `node engine.js` (direct launch).
- **No fallback (codex P0).** An invalid priority string is reported loudly
  and the process proceeds at the default HIGH (itself an elevation, not a
  silent no-op) — the render loop is show-critical, so a typo must not crash
  it, but it must be loud.

## 7. Operator action

**Just relaunch** — `node launcher.js prod --scene test_bench`. Watch for
`[engine] [EnginePriority] requested=HIGH achieved=HIGH` and two
`[sim] [BridgePriority] …` lines. For an admin-elevated realtime attempt, add
`--engine-priority realtime` (run the terminal as admin to actually get
REALTIME; otherwise it stays HIGH and says so).

## 8. Follow-ups (candidates for the Notion board)

- Optional: run the show terminal elevated so `--engine-priority realtime`
  can actually reach REALTIME_PRIORITY_CLASS — only if HIGH proves
  insufficient in the field (HIGH is the recommended default; REALTIME can
  starve input/audio/kernel workers).
- Optional: a launch-time one-line summary in the launcher banner echoing the
  achieved engine/bridge classes (the read-back lines already carry it).
