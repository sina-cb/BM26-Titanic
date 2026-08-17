# _266 — The supervised Expo Go Metro, the stale-Metro guard, and `rebuild-pad`: docs/62 W-B + W-C — 2026-08-15

**Agent:** Opus implementer. **Scope:** `docs/62_service_lifecycle_and_upkeep.md`
**W-B1-B3** and **W-C1-C3**, built ON the landed W-A (report `_260`) — its
`shell:false` spawn contract, real-pid lock, `stackPorts`, `reapStaleStack`,
ARM-interlocked kills and sentinel reaper are reused, not re-derived. Decision
points taken on the recommended defaults: **D3** flag (not a fourth profile),
**D4** `:7175` retired, **D5** in-place export, **D6** warn-never-refuse on a
stale dist. With this, every D1-D6 default in docs/62 is taken.

**Live-stack safety.** The prod stack (6966-6972, sACN 5568), the operator's
:6981 Metro, the :7175 mirror and the **ARMED bench mirror** ran untouched
throughout — verified before and after: identical pids on every port
(6966=3460 · 6967=41532 · 6968=11844 · 6969=41032 · 6970=49648 · 6971=48344 ·
6972=44224 · 6981=36900 · 7175=11812), UDP 5568 still held by the bridge, the
live lock unchanged (pid 7944, profile prod), the arm marker still present.
Nothing was killed except processes this session spawned itself. **No
`expo export` was ever run against the real `CaptainPad/dist`.**

**GATE: LAUNCHER RESTART REQUIRED to activate.** Nothing here affects the
running launcher process; the coordinator's end-of-batch bounce picks it up.
The running :6981 Metro stays the operator's until then — this slice does not
adopt it retroactively.

---

## What landed

### W-B1 · `--with-native-pad`: the Expo Go Metro becomes a launcher child

Expo Go cannot load a static export, so a show profile's native path used to be
a hand-run background `expo start` — a straggler by construction, outside every
teardown path and outside every guard. It is now an ordinary supervised child:

- **Flag, not a profile** (D3): valid only where the resolved CaptainPad mode is
  `static`, so it composes with prod's force-claim / sACN 150 / 2d_pixels
  instead of forking them. `resolveNativePadRequest` is a pure verdict;
  `dev --with-native-pad` **exits 2** with a named refusal ("two Metros race
  `node_modules/.cache`"), raised inside `validate()` — i.e. **before**
  `assertSingleInstance`, so a usage error can never take the running show down
  first.
- **Port**: new `captainpad_native_port: 6981` in `simulation/config.yaml`,
  pinning :6981 as THE native-Metro slot (BM26 port-topology memory).
  `readPorts({ requireNativePad })` demands the key only when the flag is
  present, and the failure names the standard slot rather than guessing one.
- **Child**: tag `captainpad-native`, `npx expo start --port <port>` (no
  `--web` — its job is the Expo Go manifest + native bundles) in `CaptainPad/`,
  readiness via `waitForHttp('captainpad native', …, 300000)`, then
  `recordResolvedChild` (it is the shell-wrapped `.cmd`-shim class, so
  `child.pid` is the cmd.exe wrapper — W-A2's idiom).
- **Lifecycle**: in `stackPorts`, in the lock, in `children` — so W-A3's union
  reap, W-A5's sentinel and the ordinary teardown all reach it with no new code.
- **`status`**: a `captainpad-native` row appears exactly when the lock says
  `withNativePad: true`, which the boot records. A lock claiming the native pad
  while the port key is gone throws by name instead of rendering a healthy stack.
- **LAN host**: `--with-native-pad` makes detection REQUIRED on a static profile
  too (ambiguity fails before anything spawns), and the startup summary prints
  `exp://<lanHost>:6981` to scan or type into Expo Go.
- **One env contract**: the expo-profile Metro and the native-pad Metro now both
  go through `metroChildEnv(lanHost)` — `CI` genuinely DELETED, `BROWSER=none`,
  `EXPO_NO_TELEMETRY=1`, `REACT_NATIVE_PACKAGER_HOSTNAME` = the plain host
  STRING. One definition, because the hand-run Metro drifting from the
  launcher's is precisely what this ends. A static profile also now requires
  CaptainPad's dependency tree when the flag is present
  (`captainPadMetroDependencyProblems`, extracted from the expo branch).

### W-B2 · The stale-Metro class becomes self-announcing and self-healing

A Metro older than the last dependency change serves `Unable to resolve module`
for files that are on disk (tonight: `TypefaceFontProvider`). Before starting
ANY Metro the launcher now fingerprints the dependency state — SHA-1 of
`CaptainPad/package-lock.json` **plus** the mtime of npm's installed-tree marker
`node_modules/.package-lock.json` — and compares it with
`~/tmp/bm26_metro_fingerprint.json`:

- changed / no stamp → `expo start --clear`, logged as `Metro cache:
  dependencies changed since the last Metro start → cache cleared`;
- unchanged → normal start (clearing every boot costs minutes on the playa);
- **package-lock NEWER than the installed tree → the boot REFUSES**, naming
  `npm install` / `npm ci --offline`. No cache policy can fix a manifest nobody
  installed. The refusal joins `validate()`'s problem list, so it also lands
  before `assertSingleInstance`.

The stamp is written only AFTER the Metro passes readiness (`markMetroReady`) —
a Metro that never came up must not certify its own cache. `markMetroReady`
also records `metroReadyAt` in the lock, which W-C1 reads.

One deliberate calibration, stated rather than hidden: the "lock newer than
tree" comparison carries **5 s of slack** (`INSTALL_WRITE_ORDER_SLACK_MS`),
because npm writes the installed marker LAST — measured at +340 ms on this box.
That is write ordering inside one install, not tolerance for a stale tree: the
state this catches is minutes or hours apart.

### W-B3 · `:7175` retired as a standing surface

Nothing to build (D4): `:6967` on a show profile IS the same dist through the
same `tools/static_web_server.cjs`. What landed is the **removal of the repo
scaffolding that institutionalized it** — the runbook, the README and the
`apiBase` comments no longer name a standing mirror; they name prod `:6967`,
`--with-native-pad` for the native half, and an **ephemeral, in-session** 71xx
static server for the one residual dev need. Files:
`.agent/ops/captain_pad_debugging.md`, `.agent/ops/stack_lifecycle.md`,
`README.md`, `.agent/skills/expo_go_qr.md`, `CaptainPad/utils/apiBase.ts` +
`utils/api_base_resolution.test.ts` (comments only — no behavior).
**The currently-running :7175 process was NOT touched** — it is the
coordinator's to stop at batch end.

### W-C1 · `launcher.js rebuild-pad` — the ONE dist-refresh path

`npx expo export --platform web -c` (CaptainPad's own `web:build` command,
verbatim) in `CaptainPad/`, `CI` deleted, output streamed with a `[rebuild]`
tag, in place (D5).

- **Success is proven structurally**, never by exit code alone: exit 0 AND
  `dist/index.html` rewritten during this run (mtime past the command start) AND
  an entry bundle present — whose name is printed so the hash can be verified on
  the iPad. An export that exits 0 without rewriting the index, or without a
  bundle, is a **failure**, loudly.
- **No restart needed**, and the success line says so: `static_web_server.cjs`
  reads from disk per request and sends the HTML `no-store`.
- **SERIALIZED**, which is the point. Parallel `expo export` runs corrupt the
  metro cache and emit a blank-page bundle that looks exactly like a product
  crash (`_259`). `rebuildPadGuard` refuses, by name, over (1) another
  `rebuild-pad` (a lock file, released in a `finally`), (2) **any `expo export`
  running elsewhere on the box** (a process scan), (3) a launcher Metro that has
  not reported readiness (`metroReadyAt`), and (4) a lock naming a profile this
  launcher does not know — which cannot PROVE no Metro is warming. A rebuild
  lock left by a *dead* export is reclaimed loudly, so a crash cannot block
  every future rebuild.
- The process scan is deliberately **tight** (two exact signatures: the cmd.exe
  wrapper's `expo export`, and expo's resolved `expo/bin/cli export`). A first
  draft matching `expo` + `export` anywhere flagged **every Git-Bash wrapper on
  this box** (they export environment variables) — a rebuild that refuses at
  random is a rebuild nobody runs. Verified: zero hits on the live box, both
  real shapes caught, `expo start` and shell wrappers not.

### W-C2 · A prod boot announces a stale dist (warn, never refuse)

`validate()` compares `dist/index.html` against the newest file under
`CaptainPad/{app,components,hooks,utils}` (`node_modules`/`dist` excluded by
construction) and prints ONE loud `⚠ STALE CaptainPad build` naming
`rebuild-pad`. **It never gates the boot** (D6) — launching a deliberate older
known-good build must stay possible offline. Field check: run against the real
tree right now, it correctly reports the live dist as stale
(`components/mixer/pixel_view_band_logic.test.ts` is newer).

### W-C3 · Cadence, in the runbook and the README

`.agent/ops/stack_lifecycle.md` gains: the native-pad child and its port, the
fingerprint guard's three outcomes, `rebuild-pad` and its serialization, the
`:7175` retirement, the two new lock fields, and the **per-profile cadence
table** — engine/sim/companion ⇒ bounce (arm-marker check first, both profiles);
CaptainPad-web ⇒ nothing on dev, `rebuild-pad` + iPad reload on prod (no
bounce); native deps ⇒ auto-`--clear` on next launch. README's ops section
mirrors it and links the runbook; `docs/62`'s status header records W-B/W-C as
implemented with D3-D6 taken.

### Test seams added (all explicit, all documented as seams)

`BM26_METRO_FINGERPRINT_STAMP`, `BM26_REBUILD_PAD_LOCK`, and
`BM26_REBUILD_PAD_DIR` — the last one matters: `CaptainPad/dist` is the LIVE
:6967 surface, so no test is ever one broken guard away from rewriting it.
In-process `rebuildPad` takes an injected exporter and a scratch pad dir.

---

## Gates

- **`simulation/tests/launcher_supervision.test.js`: 76/76 PASS** on the final
  run (+26 new W-B/W-C tests; **all 50 W-A tests still green**). An earlier run
  showed 75/76 — a foreign collision that has since cleared, kept below because
  the next agent will hit it again.
- **Mutation checks — each guarded line reverted, suite re-run, reverted back;
  the file is byte-identical to its pre-mutation state afterwards:**
  - **M1** drop the installed-tree mtime term from `metroDependencyFingerprint`
    → `W-B2: the fingerprint depends on BOTH the manifest and the installed
    tree` **RED** (5/6 W-B2 still green, so the assertion is specific).
  - **M2** let `resolveNativePadRequest` allow any CaptainPad mode → **2 RED**:
    the unit refusal test AND the real-CLI `dev --with-native-pad` exit-2 test.
  - **M3** remove the rebuild lock write in `rebuildPad` → `W-C1
    SERIALIZATION` **RED** with `exports === 2` — i.e. the mutation reproduces
    the exact metro-cache corruption of `_259`.
- **Serialization proof, real concurrency**: two `rebuildPad` calls against a
  scratch pad with a slow injected exporter → **exactly one export ran**, the
  second refused naming the holding pid, and the lock was released when the
  winner finished. Plus a real-CLI run (`node launcher.js rebuild-pad` with a
  live-pid rebuild lock and `BM26_REBUILD_PAD_DIR` at a scratch pad) → **exit 1**,
  `REFUSING to rebuild the CaptainPad dist`, and **no dist directory created** —
  proving the refusal precedes any spawn.
- **Fingerprint-guard proof against the real tree**: `readMetroDependencyState()`
  on the live CaptainPad returns a stable fingerprint; with no stamp the guard
  says *clear* and names the stale-Metro guard, with a matching stamp it says
  *keep*; the measured lock→marker delta is **+340 ms** (marker newer), i.e. the
  live tree is correctly NOT refused.
- **Real-spawn coverage of the native-pad env contract**: `startChild` through
  the real spawn path with `launcher.metroChildEnv(host)` and `CI=true` exported
  in the parent → the child reports `'CI' in process.env === false`,
  `REACT_NATIVE_PACKAGER_HOSTNAME === '10.x.x.NNN'` (a plain string, never
  `[object Object]`), `BROWSER=none`, `EXPO_NO_TELEMETRY=1`.
- **Neighbors**: `CaptainPad/utils/api_base_resolution.test.ts` **29/29** (the
  only CaptainPad file touched, comments only).
- **Docs grep gate**: `:7175` survives in tracked non-report prose only in the
  two places that RETIRE it by name (`stack_lifecycle.md`,
  `captain_pad_debugging.md`).

### The transient foreign red (cleared by the final run) — NOT mine, and proven so

Mid-session, `start.js restarts a real child killed with -9 (L1 end-to-end)` failed because
another session's scratch processes are squatting this suite's **78xx** map:
`ghost_sim/static_server.cjs` on :7869 plus `save-server.js` / `sacn_bridge.js` /
`sacn_output_bridge.js` on :7870-:7872, all started at 17:26 — before this
session touched anything, and left alone (not mine to kill). The test's
`probeSave()` therefore answers instantly against the squatter and the
supervisor never gets to log its own pid.

Proven mechanically rather than asserted: the same `start.js` supervisor run on a
FREE scratch map (17461-17467) came up and logged `Save server (save) started
(pid 51600)` — the exact line the assertion wants. `start.js` is healthy; the red
was the collision. Those squatters exited on their own before the final run,
which is why it is **76/76**. My own probe's leftover on :17461 was killed by me
afterwards; 17451-17467 are clear.

**Standing hazard for the next agent:** this suite's scratch map is **78xx**
(7867-7872 / UDP 7568) and it is not exclusive — a concurrent session on the
same ports turns L1 into a phantom red. Check the ports before believing it.

### One incident of my own, disclosed

While replacing an accidental NUL byte in a hash separator I used a PowerShell
byte-splice that silently failed its `AddRange` calls and **truncated
`launcher.js` to 3 bytes**, destroying the uncommitted W-A work along with mine.
It was fully recovered — not from git (HEAD predates W-A) but by reassembling the
file from this session's own transcript: the pre-edit base was rebuilt from the
`Read` tool results (2116/2116 lines, contiguous, verified), then all 41 `Edit`
calls were replayed in order with an **exact-once match required for every
replacement** (any ambiguity aborted). The result loads, carries every W-A and
W-B/W-C marker, has zero NUL bytes, and keeps the working tree's CRLF endings;
the whole 76-test suite ran green against it afterwards. Lesson recorded here
because it is the second time this session that a "clever" byte-level fix beat a
plain one: no byte surgery on source files.

## Files

- `launcher.js` — `--with-native-pad` (flag, port key, child, lock field, status
  row, LAN-host requirement, Expo Go line), `metroChildEnv`, the dependency
  fingerprint guard + `metroArgs`/`markMetroReady`, `rebuild-pad`
  (`rebuildPadGuard`/`rebuildPadState`/`rebuildPad`/`runningExpoExports`), the
  stale-dist warning, `validate()` now returns its resolved verdicts, three new
  test seams.
- `simulation/config.yaml` — `captainpad_native_port: 6981`.
- `simulation/tests/launcher_supervision.test.js` — +26 tests.
- `.agent/ops/stack_lifecycle.md` — native pad, fingerprint guard, `rebuild-pad`,
  `:7175` retirement, cadence table.
- `.agent/ops/captain_pad_debugging.md` — stale-Metro bullet rewritten around the
  guard, `:6981` is launcher-owned, `rebuild-pad` is the one export path, no
  standing mirror.
- `README.md` — `rebuild-pad`, `--with-native-pad`, lifecycle/cadence pointer,
  three troubleshooting rows.
- `.agent/skills/expo_go_qr.md` — the Metro target is the launcher-owned :6981.
- `CaptainPad/utils/apiBase.ts`, `utils/api_base_resolution.test.ts` — comments.
- `docs/62_service_lifecycle_and_upkeep.md` — status header.

No git operations. No engine/schema/wire/client behavior change. docs/62 is now
fully implemented (W-A `_260`, W-B/W-C here).
