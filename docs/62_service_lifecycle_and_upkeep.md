# 62 — Service Lifecycle & Upkeep: launcher-owned, straggler-proof

**Status:** design contract (Fable review, report `_256`). **W-A (A1-A6) is
IMPLEMENTED** — report `_260`, on Fable's recommended defaults for **D1**
(sentinel reaps in all profiles) and **D2** (`shell:false` for `node`
children). **W-B (B1-B3) and W-C (C1-C3) are IMPLEMENTED** — report `_266`, on
the recommended defaults for **D3** (a flag, not a fourth profile), **D4**
(`:7175` retired), **D5** (in-place export) and **D6** (warn, never refuse, on
a stale dist). Operational half in `.agent/ops/stack_lifecycle.md` (sanctioned
stops, the native-pad child, the fingerprint guard, `rebuild-pad`, and the
per-profile cadence table). Every D1-D6 default is now taken; §5 is history.
**Operator ruling (verbatim intent):** *"using launcher directly to launch is
what I need, extra needs design by fable."* `launcher.js` is THE single way
stack services are launched and maintained. Every service the coordinator
currently runs by hand either becomes launcher-owned or is retired.

**Case file (all reproduced 2026-08-15):**

1. Killing the launcher's shell task on Windows orphaned all four children
   (engine :6968, sim :6969, Metro :6967, companion :6966) — hunted by PID.
2. `shell:true` spawns joined args UNQUOTED; the prod static-server child's
   absolute paths (user dir contains a space + apostrophe) shattered into
   tokens and the first prod boot executed garbage. Coordinator hot-fixed
   whitespace-quoting in `startChild` (launcher.js ~:892).
3. Ad-hoc extras run by hand: an interim Expo/Metro on **:6981** for Expo Go
   (prod serves static :6967, but native Expo Go REQUIRES a Metro); a **:7175**
   static dist mirror predating the prod profile; manual dist rebuilds after
   each CaptainPad wave.
4. Stale-Metro class: a Metro older than the last `npm install` serves phantom
   `Unable to resolve` errors for files that exist on disk.

---

## 1. Verdicts up front

| Question | Verdict |
|---|---|
| Coordinator's quoting hot-fix | **Right direction, not a permanent contract.** Whitespace-only quoting still leaves cmd.exe metacharacters (`&` `^` `(` `)` `%` `!`) unquoted and embedded `"` unhandled; `%VAR%` expands even INSIDE cmd.exe quotes. The structural fix is to stop shelling `node` children at all (W-A1) — the quoting layer then only exists for the one `.cmd`-shim child (npx/expo), where it is hardened + regression-tested. |
| `:7175` static mirror | **Retire** (W-B3). Prod :6967 serves the identical dist through the identical `tools/static_web_server.cjs`. Its one residual use (a stable dist beside a dev-profile Metro) is an *ephemeral, in-session* verification server owned and killed by the agent that started it — never a standing service. |
| `:6981` interim Metro | **Legitimate need, illegitimate form.** Expo Go genuinely requires a Metro; a bare background shell command is a straggler by construction. It becomes a launcher-owned child via `--with-native-pad` (W-B1) with env, cache policy, health check, lock entry, and teardown included. |
| Windows job objects | **Rejected.** Node has no job-object API; a native addon violates the offline/no-runtime-install codex rule. The equivalent guarantees come from `taskkill /T /F` (already the kill primitive), real-PID bookkeeping (W-A2), union reap (W-A3), and the sentinel reaper (W-A5). |

**The designed model in five lines:**

1. The launcher is the only process that starts, stops, or rebuilds anything;
   `node` children spawn shell-free so args and PIDs are exact.
2. A detached zero-dep sentinel watches the launcher PID and runs the
   `stop` reap path the moment the launcher dies abnormally — stragglers are
   structurally impossible, not merely documented against.
3. `stop`/boot reap the union of {lock-recorded PIDs} ∪ {identity-checked
   port holders}, always through `port_cleanup.killPid` so the bench-mirror
   ARM interlock is never bypassed.
4. The native-iPad Metro is a launcher child (`--with-native-pad`, :6981)
   whose cache is auto-cleared when the dependency fingerprint changes —
   the stale-Metro class becomes self-announcing and self-healing.
5. `launcher.js rebuild-pad` is the one way the prod dist is refreshed; the
   static server picks it up on the next iPad reload with zero restart.

---

## 2. W-A — Teardown integrity (stragglers structurally impossible)

### W-A1 · Spawn contract: shell only for `.cmd` shims, hardened quoting there

`shell: IS_WIN` exists solely because Windows cannot exec `.cmd` shims
(`npx`/`npm`) without a shell. `node.exe` is a real executable — `node`
children (sim `start.js`, `engine.js`, companion, `static_web_server.cjs`)
must spawn with `shell: false`, where the args array is passed verbatim and
**no quoting layer exists to get wrong**. Only the `npx expo` child (and
`npmInstall`) keeps the shell.

For that remaining shell case, extract a pure exported helper (name
suggestion: `windowsShellQuote(args)`):

- Quote an arg if it matches `/[\s&()^%!"=,;]/`.
- **THROW** (fail loudly, per codex) on an embedded `"` or `%` — cmd.exe has
  no safe escape for `%` inside quotes, and no current arg legitimately
  carries either. A thrown launch beats a silently mangled one.
- Non-Windows: identity.

**Acceptance criteria:**
- `startChild('engine'|'sim'|'audio'|'captainpad'(static), …)` spawns with
  `shell:false` on Windows; a path containing a space + apostrophe reaches the
  child as ONE argv entry (integration-proven, see test spec below).
- The expo child still boots via shell with quoted args.
- `windowsShellQuote` exported from launcher.js for tests.

**Regression tests** (extend `simulation/tests/launcher_supervision.test.js`
or a sibling `launcher_spawn_contract.test.js`, mutation-checked in the `_245`
addendum style — each assertion must fail if the guarded line is reverted):
1. `windowsShellQuote(['C:\\Users\\Titanic\'s End\\x.cjs'])` → single quoted
   token; plain tokens pass through byte-identical.
2. Arg containing `&` gets quoted (mutation: remove `&` from the class → red).
3. Arg with embedded `"` or `%` throws by name.
4. **Windows-only integration:** spawn `node -e "console.log(process.argv[1])"`
   with a scratch path under a directory literally named `space 'apostrophe`,
   through the same code path `startChild` uses, and assert the child echoes
   the exact path. This is the test that catches a future `shell:true`
   regression regardless of quoting cleverness.

### W-A2 · The lock records REAL PIDs

`updateLockChildren()` records `child.pid` per tag — on Windows under
`shell:true` that is the cmd.exe wrapper, not node (the engine-priority code
at launcher.js ~:1616 already works around exactly this). Consequences today:
if the wrapper dies but node survives, `stop`'s lock-based reap skips a live
orphan (`pidAlive(wrapperPid)` false → child skipped).

- With W-A1, `node` children's `child.pid` becomes the real node PID — the
  lock is correct by construction for four of five children.
- For the shell-spawned expo child (and the native-pad child, W-B1), resolve
  the real PID after readiness via `listenersOnPort(port)` (the existing
  engine-priority idiom) and write it into the lock beside the wrapper:
  `children[tag] = pid` stays (back-compat for `stop`/blackout), plus a new
  sibling map `resolvedChildren[tag]`.
- Also record **`stackPorts`** in the lock at `writeLock()` time (including
  companion + native-pad ports), so `stop` can reap by port without
  re-deriving profile logic.

**Acceptance:** after a prod boot, the lock's engine PID is the PID that owns
:6968 (assert by cross-checking `listenersOnPort`); the lock carries
`stackPorts`; `launcher.js stop` after a simulated wrapper-only death still
finds the surviving node PID (test with a scratch port map).

### W-A3 · `stop` reaps the UNION: lock PIDs ∪ identity-checked port holders

`cmdStop`'s two paths (live launcher / stale lock) currently reap only
lock-recorded children. Add, after the lock-based reap in BOTH paths:
`portCleanup.freeStackPorts(lock.stackPorts)` — identity-checked (signatures)
and ARM-interlocked by construction. Any orphan the lock lost track of but
that still holds a stack port is named and reaped; anything foreign is
reported, never killed. `stop` exits non-zero if a stack-signature process
still holds a stack port after the sweep (loud, no fallback).

**Acceptance:** kill a launcher with `taskkill /F` (no `/T`) on a scratch port
map; children survive; `launcher.js stop` leaves zero stack-signature
processes on the scratch ports and removes the lock. A foreign process
planted on a scratch port survives and is named in output.

### W-A4 · Boot-time orphan policy + the interlock hole (REAL finding)

Boot already does the right shape — identity-checked named reap
(`killStaleListeners`), abort on foreign holders unless `-f`, `prod`
force-claims. Keep it: it is loud and deterministic, which satisfies the
no-fallback rule (refusing to boot over our own dead run's orphans would be
ceremony, not safety).

**But:** launcher.js's private `killStaleListeners` calls `forceKillTree`
directly — it **bypasses the bench-mirror ARM interlock** that
`port_cleanup.killPid` enforces (F7, reports `_212`/`_229`/`_233`). A relaunch
while a bench mirror is ARMED would `taskkill /T /F` the armed
`sacn_bridge.js` with no refusal, freezing every mirrored box on its last
frame — the exact incident F7 exists to prevent. Same for the launcher's
private `listenersOnPort`/`commandlineOf`/`STACK_PROCESS_SIGNATURES`
duplicates.

- Route every launcher kill of a port-holder through `portCleanup.killPid`
  (which honors `--force-sacn` / `BM26_FORCE_SACN_KILL` — the flag is already
  accepted in launcher argv).
- Delete the duplicated helpers in launcher.js in favor of the
  `port_cleanup.cjs` exports (one definition of the signature list; the
  launcher's copy can drift, and two already exist).

**Acceptance:** with a scratch arm marker naming a fake `sacn_bridge.js` PID
(guardDeps seams), a launcher boot REFUSES that one kill by name and aborts
loudly (or proceeds only under the override); `grep -c STACK_PROCESS_SIGNATURES
launcher.js` → 0 definitions (import only).

### W-A5 · The sentinel reaper — abnormal launcher death can no longer orphan

New `tools/launcher_reaper.cjs` — Node built-ins only, ~80 lines:

- Spawned by the launcher right after `writeLock()`, `detached: true`,
  `unref()`ed, NOT in `children` (it must outlive the launcher). Passed the
  lock path + launcher PID via argv.
- Loop every 2 s: lock file gone, or `lock.pid !== <my launcher>` → exit 0
  silently (clean stop, or a takeover happened — the new launcher spawns its
  own sentinel).
- Launcher PID dead while the lock still names it → run exactly the
  `stop` stale-lock path: `blackoutEngineBeforeKill(lock)` → reap lock
  children (`forceKillTree` = `taskkill /T /F`) → `freeStackPorts(
  lock.stackPorts)` → delete the lock → exit. Log every line to
  `~/tmp/bm26_reaper.log` (append, timestamped) — the reaper has no console.
  Cleanest implementation: export the stale-lock reap from launcher.js as a
  function and have the reaper `require('../launcher.js')` and call it, so
  there is ONE reap implementation.

**Why reap instead of adopt/leave-running (D1):** a launcher-less stack is
already broken by construction — a sim scene switch makes the engine exit 75
with nobody to restart it (permanent engine loss), `stop`'s blackout path has
no engine PID it trusts, and crash teardown is gone. Leaving it up "because it
still looks lit" is precisely the silent-fallback behavior the codex bans. If
the launcher dies, the stack comes down loudly (with the blackout attempted
first) and the operator restarts one command.

**Acceptance:** on a scratch port map, `taskkill /F` (no `/T`) the launcher;
within ~5 s the reaper has blacked out (or loudly reported it could not),
killed all children, swept the ports, removed the lock, written the log, and
exited — zero processes left matching stack signatures on scratch ports,
including the reaper itself. A clean Ctrl+C stop leaves no reaper behind.
The reaper never acts while the launcher PID is alive.

### W-A6 · Runbook: sanctioned stops only

The only sanctioned ways to end a stack: **Ctrl+C in its terminal**,
**`node launcher.js stop`**, or a **`-f` takeover**. Killing the launcher's
shell/task wrapper is forbidden (the reaper now makes it survivable, not
acceptable). Coordinator updates `.agent/ops/captain_pad_debugging.md`
("Metro is a launcher child" bullet) and its own memory to state this.

---

## 3. W-B — The Expo Go path (native Metro, launcher-owned)

### W-B1 · `--with-native-pad`: a supervised Metro beside the prod static dist

New launcher flag, valid ONLY when the resolved captainPad mode is `static`
(on an `expo` profile it is refused by name — that profile already runs the
one Metro, and two Metros race `node_modules/.cache`). It adds a child, tag
`captainpad-native`:

- Command: `npx expo start --port <captainpad_native_port>` in `CaptainPad/`
  (no `--web`; its job is the Expo Go manifest + native bundles).
- Env: `CI: null` (deleted via `buildChildEnv`), `EXPO_NO_TELEMETRY: '1'`,
  `BROWSER: 'none'`, `REACT_NATIVE_PACKAGER_HOSTNAME: lanHost`. The flag makes
  LAN-host detection REQUIRED at preflight exactly as `expo` mode does today
  (ambiguous interfaces fail before anything spawns).
- Port: new `captainpad_native_port: 6981` key in `simulation/config.yaml`'s
  reserved-ports section (BM26 port-topology memory: ONE stack on standard
  ports — this pins :6981 as the standard native-Metro slot). `readPorts()`
  demands the key only when the flag is present; flag + missing key fails
  loudly.
- Lifecycle: ordinary `startChild` → in `stackPorts`, in the lock, reaped by
  W-A3/A5, torn down with everything else. Readiness:
  `waitForHttp('captainpad native', http://127.0.0.1:<port>/, 300000)`.
- `status`: a `captainpad-native` health row appears when the lock says the
  flag was active (store `withNativePad: true` in the lock).
- Startup summary prints the Expo Go line: `exp://<lanHost>:<port>`.

**Acceptance:** `node launcher.js prod --with-native-pad --no-launch` on a
scratch port map brings up static :6967 AND Metro :6981 with the manifest
answering the LAN host (`curl -H "expo-platform: ios"` shows `lanHost`, never
127.0.0.1); Ctrl+C leaves nothing on either port; `status` shows the extra
row; `dev --with-native-pad` exits 2 with a named refusal.

### W-B2 · Kill the stale-Metro class: dependency fingerprint → auto `--clear`

Before starting ANY Metro child (dev profile's and `--with-native-pad`'s),
compute a dependency fingerprint: SHA-1 of `CaptainPad/package-lock.json`
concatenated with the mtime of `CaptainPad/node_modules/.package-lock.json`.
Compare with the stamp file `~/tmp/bm26_metro_fingerprint.json`:

- **Mismatch or no stamp** → append `--clear` to the expo args and log loudly:
  `dependencies changed since the last Metro start → cache cleared (stale-
  Metro guard)`. Write the new stamp only AFTER the Metro passes readiness.
- **Match** → normal start (cache is trustworthy; `--clear` every boot would
  cost minutes on the playa for nothing).
- **`package-lock.json` newer than `node_modules/.package-lock.json`** →
  refuse to start the Metro at all, naming the fix (`npm install` /
  `npm ci --offline` in CaptainPad/): that state produces phantom
  `Unable to resolve` errors for files that exist (tonight's
  TypefaceFontProvider), and self-announcing beats the runbook diagnosis.

**Acceptance:** touch `package-lock.json` → next launch logs the guard line
and passes `--clear`; unchanged deps → no `--clear`; lock newer than installed
tree → preflight failure naming `npm install`. Unit-test the pure fingerprint/
decision helper (exported), mutation-checked (drop the mtime term → red).

### W-B3 · Retire the :7175 standing mirror

Retired as a standing service the moment the current stack generation ends —
prod :6967 IS the dist through the same server. Nothing new to build.
Residual dev-profile need ("stable dist beside hot-reload Metro") is served
by an **ephemeral** `static_web_server.cjs` on a 71xx port that the owning
agent starts and kills within its own session — never left running between
sessions, never a coordinator upkeep item. `tools/static_web_server.cjs`
itself stays (prod uses it).

**Acceptance:** after the next launcher generation, nothing listens on :7175;
runbook + coordinator memory no longer name it as a standing surface.

---

## 4. W-C — Upkeep cadence (dist rebuilds, "latest" per profile)

### W-C1 · `launcher.js rebuild-pad`

New subcommand — the ONE way the prod dist is refreshed:

- Runs `npx expo export --platform web -c` in `CaptainPad/` (the `web:build`
  script's exact command) with `CI` deleted from the child env, streaming
  output with a `[rebuild]` tag. Refuses if `CaptainPad/node_modules` is
  missing (same preflight as validate()).
- Asserts success structurally: exit 0, `dist/index.html` mtime advanced past
  the command start, and prints the new entry bundle name
  (`dist/_expo/static/js/web/*.js`) so the operator/agent can verify the hash
  changed on the iPad.
- **No restart needed:** `static_web_server.cjs` reads from disk per request
  and serves HTML `no-store`, so the next iPad reload gets the new build.
  The subcommand says exactly that in its success line.
- Runs fine while the stack is up (it touches only `dist/`). The export
  rewrites `dist/` non-atomically — a reload during the few export seconds
  can 404; D5 below offers the atomic-swap variant if the operator wants
  show-time rebuilds to be seamless. Default: in-place, with the success line
  noting "rebuilt while serving — reload the iPad now".

**Acceptance:** with the stack running (scratch ports), `rebuild-pad`
completes, the bundle hash changes, a reload serves the new hash, no stack
process restarted (PIDs unchanged). With `CI=true` exported in the parent
shell, the export still succeeds (env deletion proven).

### W-C2 · Prod boot announces a stale dist

In `validate()` for static mode: compare `dist/index.html` mtime against the
newest source mtime under `CaptainPad/{app,components,hooks,utils}` (cheap
walk, `node_modules`/`dist` excluded). If sources are newer, print ONE loud
warning naming `node launcher.js rebuild-pad` — **warn, never refuse** (D6):
deliberately launching an older known-good build must stay possible on the
playa; the announcement makes staleness visible instead of gating on it.

**Acceptance:** touch a source file → prod boot prints the warning; run
`rebuild-pad` → next boot silent.

### W-C3 · Cadence and ownership ("keep live at latest", per profile)

| Change landed | dev profile | prod profile |
|---|---|---|
| Engine / sim / companion code | launcher bounce (bench arm-marker check first — standing order) | same |
| CaptainPad web (app/components/…) | nothing — Metro serves source live | `launcher.js rebuild-pad` + iPad reload |
| CaptainPad native deps (`package-lock.json` moved) | Metro auto-`--clear` on next launch (W-B2); mid-generation: bounce | same, for the `--with-native-pad` Metro |
| Scene/pattern/playlist data | engine's own reload paths (operator/curator domain) | same |

The **coordinator** owns every launcher action in this table; the operator
owns his own Expo instances per existing memory. Coordinator's
`keep-live-engine-latest` memory should gain: *"prod: CaptainPad-web waves
need only `launcher.js rebuild-pad` + iPad reload — no bounce; engine/sim
waves still bounce (arm-marker first); native dep changes self-heal via the
Metro fingerprint guard."* Runbook delta (`.agent/ops/captain_pad_debugging.md`):
sanctioned stops (W-A6), :6981 = launcher-owned `captainpad-native` child,
stale-Metro bullet becomes "the launcher's fingerprint guard clears the cache
automatically; if you see Unable-to-resolve for a file that exists, the
guard was bypassed — check who started that Metro".

---

## 5. Operator decision points (recommended defaults)

| # | Decision | Recommended default |
|---|---|---|
| D1 | Sentinel reaper on abnormal launcher death: reap in ALL profiles, or leave a prod stack running unsupervised? | **Reap everywhere.** An unsupervised stack is already broken (engine exit-75 restart, blackout-on-stop, crash teardown all live in the launcher); restart is one command. |
| D2 | Spawn `node` children with `shell:false` on Windows (real PIDs, no quoting layer)? | **Yes** — this is the structural half of the quoting fix. |
| D3 | Native Metro shape: `--with-native-pad` flag on static profiles, or a fourth `prod+native` profile? | **Flag.** It composes with prod defaults (force-claim, priority 150) instead of forking them; the lock records it for `status`. |
| D4 | Retire the :7175 standing mirror? | **Yes.** Prod :6967 is the same dist through the same server; ephemeral 71xx verification servers stay in-session only. |
| D5 | `rebuild-pad`: in-place export (brief 404 window) or atomic dist-swap (`dist.new` → rename)? | **In-place.** Expo owns the dist layout; the window is seconds and announced. Revisit only if a mid-show rebuild becomes a real workflow. |
| D6 | Stale-dist check at prod boot: warn or refuse? | **Warn.** Launching a deliberate older build must remain possible offline. |

## 6. Sizing (for Opus implementation)

- **W-A** (spawn contract + lock fidelity + union reap + interlock routing +
  sentinel + tests): one focused session. Highest risk: W-A5 reaper races —
  keep its trigger condition exactly "lock names launcher X AND X is dead".
- **W-B** (flag + fingerprint guard + :7175 retirement): one session,
  independent of W-A (parallelizable; both touch `startChild` call sites but
  not the same lines — shared-tree protocol applies).
- **W-C** (rebuild-pad + staleness warning + runbook/memory deltas): half a
  session, after W-A lands (reuses env/spawn helpers).

Every new behavior lands with tests on scratch port maps (`BM26_SIM_CONFIG`
override, ports 17xxx/78xx) — nothing in the suites may touch 6966-6972,
5568, 6981, or 7175 while the live stack runs.
