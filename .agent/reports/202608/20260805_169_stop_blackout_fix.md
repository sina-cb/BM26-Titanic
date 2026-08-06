# `_169` — `stop` now blacks the rig out before the force-kill (T1 fix)

**Agent:** fix `_169` (Opus) · **Branch:** `feat/bm_readiness` · **Scope:** operator-
authorized, explicitly optional ("the stop to black out is optional but nice to have →
fix if minimal work"). Fixes **T1** from
`.agent/reports/202608/20260805_160_titanic_scene_playa_review.md`.
No git ops, no scene/pattern/playlist edits, no operator port bound, no live process
signalled. Scratch in `~/tmp/fix_169/`.

---

## 1. The defect, restated from the evidence

`deploy/deploy.py stop_stack()` → `node launcher.js stop` → `launcher.js` force-kills the
launcher's whole process tree (`taskkill /PID <pid> /T /F`). `/F` is `TerminateProcess`,
so the engine's `SIGINT`/`SIGTERM` handler — **the only emitter of the shutdown blackout
frame** (`marsin_engine/engine.js` §8: zero every pixel → `mapPixelsToSacn` →
`sacnOut.sendFrame(blackBuffers)`) — never ran. Every controller held its **last live
frame** until its own unknown device-side E1.31 timeout, while
`.agent/ops/show_server_ops.md:30,63,75` and `deploy/README.md:19,364` promise
"lights OFF … before generator work".

Two facts made this unfixable from the launcher side alone:

1. **Windows has no graceful signal.** `taskkill /F` and node's `process.kill(pid, sig)`
   both terminate outright. Even the launcher's *own* teardown force-kills its children
   on Windows (`stopChild()` → `forceKillTree`), so "stop the launcher politely" would
   not have helped either.
2. **The engine had no in-band way to be asked to stop.** `POST /scene` /
   `POST /scene/reload` reach `shutdown()` but always *restart*; there was no
   "shutdown and stay down" route.

## 2. The fix — reach the existing blackout, don't build a second one

Three small changes; **nothing is duplicated and nothing is persisted.**

| File | Line | Change |
|---|---|---|
| `marsin_engine/engine.js` | `2569` | `engineCore.requestShutdown = () => shutdown();` — one hook onto the SAME `shutdown()` the signal handlers call (re-entrancy-guarded by its `shuttingDown` flag). |
| `marsin_engine/lib/api_server.js` | `5511` | `POST /shutdown` — requires `{"confirm": true}` (400 `CONFIRM_REQUIRED` otherwise), 500 `NO_SHUTDOWN_HOOK` if the hook is missing, else 200 then `setTimeout(…, 50)` → `requestShutdown()` (respond-then-act, the `POST /scene` pattern). |
| `launcher.js` | `1070-1129` | `BLACKOUT_CONFIRM_MS = 3000`, `BLACKOUT_CHILD_TAG`, `BLACKOUT_UNCONFIRMED_MSG`, `blackoutEngineBeforeKill(lock, deps)`. |
| `launcher.js` | `1140`, `1154` | `await blackoutEngineBeforeKill(lock)` — in the stale-lock branch (orphaned engine can still be driving the rig) and immediately **before** `forceKillTree(lock.pid)` in the live branch. |
| `deploy/deploy.py` | `stop_stack()` | echo any `BLACKOUT NOT CONFIRMED` line — it captured `launcher stop`'s output and printed it only on failure, so on rc 0 the warning was **invisible in the show path**. |
| `.agent/ops/show_server_ops.md` | §stop | states how OFF happens and what the warning means (treat the rig as LIT, kill the PSUs). |

`blackoutEngineBeforeKill` = POST `http://127.0.0.1:<marsin_engine_port>/shutdown`
`{confirm:true}`, then poll `pidAlive(lock.children.engine)` every 200 ms for a **bounded
3 s**. Confirmed ⇒ one line of stdout. Every other outcome ⇒ `logError` carrying
**`BLACKOUT NOT CONFIRMED — rig may still be lit. Confirm darkness by eye before any
electrical work.`** plus the underlying reason. **The kill always follows** — `stop` must
always stop; the function never throws and never returns early past the kill.

**Five** unconfirmed outcomes, all loud: no `engine` child in the lock file (every profile
runs one, so this is an anomaly), the recorded engine pid **already gone**, port map
unreadable, the POST rejected/refused, engine still alive after the budget.

The already-gone guard is also a safety property: with our own engine dead, POSTing
`/shutdown` at `:6968` would stop whatever **other** engine happens to answer that port.
`stop` never does that.

### Why not the existing `POST /global-blackout`

It would have been a zero-engine-change fix, and it is **wrong**: it writes
`globalsState.blackout = true` and `saveGlobals()`, and `lib/state_manager.js:413`
restores that flag at boot. Using it in `stop` would make the **next `start` boot the
ship dark**. `POST /shutdown` persists nothing.

### Deliberate properties

- **Not gated by `rejectIfPerformanceMode`** — a stop during a live show is exactly when
  the blackout matters. It sits with the other safety routes (blackout / panic), which
  are also open in performance mode.
- **`{"confirm": true}` required** — the route stops the show, so an accidental or
  malformed POST must not.
- **Exposure note (unchanged risk class):** the engine API already accepts
  `POST /global-blackout` and `POST /global-effect-macros/blackout` from anyone who can
  reach `:6968`. `/shutdown` adds no new authentication class, but it does add a
  *stop-the-show* verb to that surface. Recorded, not silently accepted.
- Because the engine now exits on its own, the running launcher logs
  `engine exited unexpectedly … Tearing down` and tears the stack down itself
  (`startChild`'s exit handler). Harmless during a stop — `cmdStop`'s own kill and lock
  cleanup are idempotent — but the wording is misleading in this one path. Cosmetic;
  left alone deliberately (the brief forbids touching anything else in the launcher).

## 3. Size

`launcher.js` +74 lines (≈45 code, rest comment), `api_server.js` +34 (≈22 code),
`engine.js` +11 (1 code line + comment). No new IPC — it rides the engine's existing
HTTP API. Above the brief's "~50 lines" soft ceiling in raw diff, at/below it in code
lines; judged still minimal because the blackout itself is entirely reused.

## 4. Tests

**New — `marsin_engine/tests/state/shutdown_api.test.js` (2/2 green).** Spawns a REAL
engine through `tests/helpers/spawn_engine.mjs` on an **OS-assigned free port** (asserted
not in `{5568, 6966-6972}`), `--dest 127.0.0.9` black-holing sACN, state/playlists in temp
dirs, scene `summer_camp_dome`:

- unconfirmed `POST /shutdown {}` → **400 `CONFIRM_REQUIRED`**, engine still serving
  `/status`, no exit;
- confirmed → **200** `{shuttingDown:true, blackout:true}`, engine **exits 0 on its own**,
  stdout contains `⏹ Stopping...` **and** `✅ Shutdown complete` (the latter is printed
  from `finish()`, which only runs after `sacnOut.sendFrame(blackBuffers)` settles — i.e.
  the blackout path executed). Observed in the run: `[sACN Out] Sender stopped after 15
  frames` against `Shutdown complete (14 frames rendered)` — **the 15th frame is the
  blackout.**

**New — 6 tests appended to `simulation/tests/launcher_supervision.test.js`** (file now
12/12 green). All in-process with injected deps — no port bound, no process signalled:

- blackout CONFIRMED (POST 200 + pid gone) ⇒ `{confirmed:true}`, **stderr empty** (no
  crying wolf), and the request asserted to be exactly
  `POST http://127.0.0.1:<port>/shutdown {confirm:true}`;
- POST rejected (`ECONNREFUSED`) ⇒ `{confirmed:false, reason:'request failed'}` + the
  loud message + the underlying reason not swallowed;
- **bounded wait**: engine never exits, injected clock ⇒ 1 liveness precheck + exactly 15
  polls for a 3000 ms budget / 200 ms interval, then
  `{confirmed:false, reason:'engine still alive'}` + loud;
- already-dead engine ⇒ **zero POSTs** (`stop` must never shut down an engine it does not
  own) + loud;
- no `engine` child in the lock ⇒ zero POSTs, loud;
- **ORDER pin**: source-level assertion that `await blackoutEngineBeforeKill(lock)`
  precedes `forceKillTree(lock.pid)` in the live-stop path — the defect was pure
  ordering, so the ordering is pinned.

Not covered: the `readPorts()`-throws branch (would require breaking
`simulation/config.yaml`), and the real `taskkill` sequence (cannot be exercised without
killing a live stack).

**Suite counts** — see §5.

## 5. Counts

- `simulation npm test`: **2021 / 2014 / 6** vs the `_165`/`_166` baseline
  **2008 / 2001 / 6** — the same 6 pre-existing failures (fixture-dock, orphan-patch
  refusal, titanic block collisions, the two `scene_model_parity` CLI cases, compression
  headroom), **zero new**. `launcher_supervision.test.js` isolated: **12/12**.
  *(An earlier run in this session showed 13 failures — 7 extra, all in
  `animate_output_wiring` / `engine_bridge_contract` / `sacn_bridge_arbitration` /
  `sacn_bridge_boot_invariant`, none of which import any file `_169` touched. They
  cleared on the re-run; they track another agent's in-flight `animate.js`/bridge edits
  and a live engine answering `:6968` at that moment.)*
- `marsin_engine npm test`: **2790 / 2783 / 7** — failing LIST byte-matches the documented
  baseline (5× `audio_capture`, 1× `effects_v2_mode_page_layout` file-level, 1×
  `osc_listener` EADDRINUSE→EACCES), **zero new failures**. New
  `shutdown_api.test.js` isolated: **2/2**. `e2e/shutdown_ordering.test.js` (the structural
  pin on `shutdown()`) still **3/3** after the hook insertion.
- `python scripts/security_check.py --all`: **6** — the documented gitignored
  `simulation/.scene_backups/studiodj/**` baseline, unchanged. This session adds none.

**Caveat, stated plainly:** other agents were editing this same working tree during this
session (the `output_dispatch`/`artnet_output` removal, `sacn_bridge.js`,
`sacn_output_bridge.js`, `animate.js`, CaptainPad, docs) — `engine.js` and
`api_server.js` carry their hunks alongside mine. Suite totals therefore measure the
combined tree; the failing LISTS and the isolated runs are the attributable evidence.

**Environment note (pre-existing, not introduced here):** `spawn_engine.mjs` isolates the
API port, sACN destination and state dirs, but a spawned test engine still binds OSC
`0.0.0.0:10000` and fire-sync `0.0.0.0:7703` — global UDP ports. With a live engine up,
a test engine can briefly contend for those. Applies to all 8 suites that use the harness.

## 6. Handoff

- **Applies at the NEXT stack start.** The engine running on the operator's box has no
  `/shutdown` route in memory, so a `stop` against it prints `BLACKOUT NOT CONFIRMED`
  (accurately — that process cannot be asked to go dark) and then kills as before.
  Nothing here touched the live stack.
- **The docs are now true.** `.agent/ops/show_server_ops.md` gained the "how OFF happens
  + what the warning means" note. `deploy/README.md:19,364` was **not** edited — it says
  "park it safely (lights OFF)", which now holds; it could gain the same warning line.
- **`_157` D10 / `_160` §2 still stands:** even on a graceful shutdown the blackout is
  sent **once**, while the engine's own stale-universe path applies a 3× rule
  (`engine.js:1753-1759`). One lost datagram on exit still = frozen bright. Cheap
  follow-up: send the shutdown blackout 3×.
- **`_166`'s G-7 gap ("needs a shutdown route") is now unblocked** — `POST /shutdown` is
  that route.
- Unchanged: `stop` is still not a substitute for killing power. It is now a *confirmed*
  blackout, not an isolation guarantee.
