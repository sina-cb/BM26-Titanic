# Stack Lifecycle — sanctioned starts, sanctioned stops, and the sentinel

`launcher.js` is **THE** way stack services are started, stopped and rebuilt
(operator ruling; contract in `docs/62_service_lifecycle_and_upkeep.md`). This
runbook is the short operational half of that contract: how a stack is allowed
to end, what happens when it ends some other way, and how to read the output
when a stop refuses to finish.

Applies to the dev laptop and the show server alike. Server-specific deploy /
`stop` / `start` procedures live in `.agent/ops/show_server_ops.md`; the
operator gates there still apply on top of everything here.

## Sanctioned stops — there are exactly three

| How | What it does |
|---|---|
| **Ctrl+C in the launcher's own terminal** | The launcher's signal handler runs `teardown`: every child is stopped and waited for, then the lock is removed. |
| **`node launcher.js stop`** | Asks the engine for its blackout FIRST (`POST /shutdown`), then force-kills the tree, reaps the lock's children, sweeps the stack ports, removes the lock. |
| **`node launcher.js <profile> -f`** (takeover) | Force-kills the previous launcher + tree, retires its sentinel, then boots fresh. |

**Everything else is forbidden.** In particular: do **not** kill the
launcher's shell/task wrapper, do **not** close the terminal host out from
under it, do **not** `taskkill /F` the launcher pid by hand. The sentinel (see
below) makes those survivable — it does not make them acceptable, and none of
them can guarantee the blackout that a sanctioned stop attempts first.

**Never** kill individual stack children by pid to "restart just one thing".
The launcher supervises them; a hand-killed child either gets restarted under
you or takes the whole stack down as a crash. Bounce the launcher instead.

## The sentinel reaper (`tools/launcher_reaper.cjs`)

Every launcher run spawns one, detached, right after it writes its lock. It
polls every 2 s and does exactly one thing:

- lock gone → the launcher stopped cleanly → it exits silently;
- lock names a different launcher → a takeover happened → it exits silently;
- **the lock still names our launcher and that pid is dead** → abnormal death →
  it runs the same reap path `stop` runs (blackout → lock-children reap →
  identity-checked port sweep → lock removal) and exits.

Reap, not adopt: a launcher-less stack is already broken (the engine's exit-75
scene-switch restart, the blackout-on-stop and the crash teardown all live in
the launcher), so it comes down loudly and you restart with one command.

The sentinel has no console. Its log is **`~/tmp/bm26_reaper.log`** (appended,
timestamped) — that is the first place to look if a stack vanished on its own.
`ABNORMAL LAUNCHER DEATH` in that log means something killed the launcher
outside the three sanctioned stops; find out what, because the rig went down
without a supervised blackout.

## Reading a `stop` that does not exit 0

`stop` exits **non-zero** when one of OUR processes still holds a stack port
after the reap. It names every survivor (`STILL RUNNING: pid … holds :…`).
Two causes, in order of likelihood:

1. **`❌ REFUSING to kill pid … BENCH MIRROR is ARMED`** — the F7 interlock.
   The sACN bridge is mirroring to real boxes; force-killing it skips its
   all-zero DISARM blackout and every mirrored box **freezes** on its last
   composed frame. Fix it properly: **DISARM** in the sim (🎛 Controllers
   header → DISARM), then rerun `stop`. Only if you accept frozen boxes,
   rerun with `--force-sacn` (or `BM26_FORCE_SACN_KILL=1`).
   The same refusal aborts a **boot** and a **`-f` takeover** — by design, and
   with the same remedy. This is the standing "bench arm-marker check first"
   order, now enforced in code.
2. A genuine straggler that ignored `taskkill /T /F`. Kill the named pid by
   hand and rerun `stop` to confirm the ports are quiet.

A **foreign** process on a stack port is reported (`FOREIGN, left alone`) and
is **not** a stop failure — we never kill what we do not own. Free it yourself,
or claim it at boot with `-f` (`prod` force-claims by default).

## What the lock file records

`~/tmp/bm26_titanic_launcher.lock.json` (override: `BM26_LAUNCHER_LOCK`, a test
seam — never point the live stack at it):

- `pid` — the launcher; `reaperPid` — its sentinel.
- `children` — the spawn pid per tag. Since the W-A1 spawn contract these are
  **real node pids**: `node` children spawn shell-free, so no cmd.exe wrapper
  sits between the launcher and the process. Only `npx expo` still needs a
  shell.
- `resolvedChildren` — the pid that actually OWNS a child's port, resolved
  after readiness. This is what makes a shell-wrapped child (Metro) reapable
  when its wrapper dies but the server survives.
- `stackPorts` — every port this run owns, so `stop` and the sentinel can sweep
  by port without re-deriving profile logic. A lock without it (written by an
  older launcher) makes the sweep announce itself as skipped — reap the
  leftovers by hand.
- `withNativePad` — whether this run asked for the supervised Expo Go Metro, so
  `status` knows to probe the extra `captainpad-native` row.
- `devNoAuth` — whether this run launched with `--dev-no-auth`; `status` prints
  an unmistakable auth-bypass warning when true. Legacy locks without the field
  are treated as false.
- `metroReadyAt` — when a launcher Metro passed readiness. `rebuild-pad` refuses
  to export while it is absent on a stack that has a Metro: exporting into a
  still-warming Metro's cache is the corruption that produces a blank-page
  bundle.

## The Expo Go Metro is a launcher child, not a side process

A show profile serves the web pad from the PREBUILT `CaptainPad/dist`, which
Expo Go cannot load — it needs a Metro for the native manifest and bundles. That
Metro is **`node launcher.js <profile> --with-native-pad`** (docs/62 W-B1):
child tag `captainpad-native`, port `captainpad_native_port` (**:6981**, pinned
in `simulation/config.yaml`), in `stackPorts`, in the lock, a row in `status`,
and torn down by every path above. The startup summary prints the
`exp://<lanHost>:6981` line to scan or type into Expo Go.

It is **refused by name on an `expo` profile** — that profile already runs the
one Metro this project may have, and two Metros race `node_modules/.cache`.

Before starting ANY Metro the launcher fingerprints CaptainPad's dependency
state (`package-lock.json` + npm's installed-tree marker) and compares it with
the last Metro start that reached readiness (`~/tmp/bm26_metro_fingerprint.json`):

- changed → it passes `expo start --clear` and says so (`Metro cache:
  dependencies changed since the last Metro start → cache cleared`);
- unchanged → normal start (clearing every boot costs minutes on the playa);
- `package-lock.json` NEWER than `node_modules/.package-lock.json` → it
  **refuses to boot**, naming `npm install`. That state produces phantom
  `Unable to resolve` errors for files that exist, and no cache policy fixes it.

There is **no standing `:7175` dist mirror** (docs/62 W-B3/D4): `:6967` on a
show profile IS the dist, through the same `tools/static_web_server.cjs`. A dev
session that wants a stable surface beside a hot-reloading Metro starts an
**ephemeral** 71xx static server and kills it in the same session.

## Refreshing the pad: `node launcher.js rebuild-pad`

The ONE path that rewrites `CaptainPad/dist` (docs/62 W-C1). It runs
`npx expo export --platform web -c` with `CI` deleted, in place (D5), and proves
success structurally: exit 0, `dist/index.html` rewritten during this run, and
the new entry-bundle name printed so the hash can be checked on the iPad.

**No restart is needed.** `static_web_server.cjs` reads from disk per request and
sends the HTML `no-store`, so the next iPad reload gets the new build while the
stack keeps running.

It is **serialized**, because parallel `expo export` runs corrupt the metro cache
and emit a blank-page bundle that looks exactly like a product crash. It refuses,
by name, over: another `rebuild-pad`; any `expo export` running elsewhere on the
box; a launcher Metro that has not reported readiness. Never run
`npm run web:build` into the live dist by hand.

On a **static profile boot** (`prod`), a missing or stale `dist/` triggers the
same rebuild automatically **before any stack process starts** — visible
`[rebuild]` progress, one attempt, then a loud abort if the export is still
missing or stale. No prompt, no silent fallback. Expo profiles (`dev` /
`dev-lite`) skip this entirely — Metro serves source live.

## Cadence: keeping the live stack at latest

**Check the bench arm marker first for anything that bounces**
(`~/tmp/bm26_bench_mirror_armed.json`) — if a mirror is armed, DISARM in the sim,
or the boot/takeover refuses by name. A bounce is `node launcher.js stop` (or
Ctrl+C in its terminal) → `node launcher.js <profile>`.

| Change landed | `dev` / `dev-lite` | `prod` |
|---|---|---|
| Engine / sim / companion code | **bounce** (arm-marker check first) | **bounce** (arm-marker check first) |
| CaptainPad web (`app/`, `components/`, `hooks/`, `utils/`) | nothing — Metro serves source live | **`node launcher.js rebuild-pad` + reload the iPad.** No bounce. |
| CaptainPad native deps (`package-lock.json` moved) | `npm install` in CaptainPad/, then the next launch auto-clears the Metro cache; mid-generation, bounce | same, for the `--with-native-pad` Metro |
| Scene / pattern / playlist data | the engine's own reload paths (operator/curator domain) | same |

The **coordinator** owns every launcher action in this table. The operator owns
his own Expo instances.

## `--dev-no-auth` — development-only CaptainPad auth bypass

Contributors without the private `BM26_SECRETS` repository can run **`dev` or
`dev-lite` with `--dev-no-auth`** to disable CaptainPad privileged auth for that
session. The launcher:

- refuses the flag on **`prod`** (usage error, exit 2 — before any child spawn);
- uses **`resolveCaptainPadAuthPreflight()`** (pure, exported for tests) to skip
  `BM26_SECRETS` preflight when the flag is present;
- sets **`BM26_CAPTAINPAD_AUTH_REQUIRED=0`** on the supervised engine — the ONE
  authority; no hidden environment default;
- records **`devNoAuth: true`** in the lock; `node launcher.js status` prints an
  unmistakable auth-bypass warning when that field is set (legacy locks without
  it read as false);
- prints an unmistakable **DEVELOPMENT AUTH BYPASS** warning.

Without the flag, behavior is unchanged: missing secrets fail loudly at
preflight. Never use `--dev-no-auth` on the show server or in production.
