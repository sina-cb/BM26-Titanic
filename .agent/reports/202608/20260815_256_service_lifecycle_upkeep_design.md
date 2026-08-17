# _256 — Service lifecycle & upkeep design (Fable review) — 2026-08-15

**Agent:** Fable design/review (explicit operator order via coordinator).
**Scope:** design/review only — deliverable is
`docs/62_service_lifecycle_and_upkeep.md` + this report. No code changed,
no ports touched, no git ops.
**Operator ruling under review:** launcher.js must be THE single way services
are launched and maintained ("using launcher directly to launch is what I
need, extra needs design by fable") — triggered by tonight's straggler-children
incident, the unquoted-spawn prod-boot failure, and the hand-run extras
(:6981 interim Metro, :7175 mirror, manual dist rebuilds).

## What was audited

- `launcher.js` (full read: startChild/teardown/stop/status/lock, profiles,
  companions, validate, blackout-before-kill, killStaleListeners).
- `tools/port_cleanup.cjs` (F7 arm interlock, killPid, freeStackPorts).
- `tools/static_web_server.cjs` (serve-from-disk semantics, no-store HTML).
- `simulation/tests/launcher_supervision.test.js` (the regression suite the
  new tests extend), `simulation/config.yaml` port map,
  `.agent/ops/captain_pad_debugging.md`, the Infra row in the master dossier.

## Verdicts

1. **Quoting hot-fix (launcher.js ~:892):** right direction, not a permanent
   contract. Whitespace-only quoting leaves cmd.exe metacharacters
   (`& ( ) ^ % !`) unquoted, embedded `"` unhandled, and `%VAR%` expands even
   inside cmd.exe quotes. Structural fix (doc W-A1): spawn `node` children
   with `shell:false` on Windows — the shell exists only for `.cmd` shims
   (npx/npm) — so the quoting layer survives only for the one expo child,
   where it is hardened (throw on `"`/`%`, quote on the full metachar class)
   and pinned by a mutation-checked test that spawns through the real code
   path under a directory named with a space + apostrophe. Bonus: real node
   PIDs land in the lock (today the lock stores cmd.exe wrapper PIDs — the
   engine-priority code already works around this at ~:1616).
2. **:7175 mirror:** RETIRE as a standing service (doc W-B3). Prod :6967
   serves the identical dist through the identical server. Residual dev-time
   need = ephemeral in-session 71xx servers only.
3. **:6981 interim Metro:** legitimate need (Expo Go requires a Metro),
   illegitimate form. Becomes launcher-owned via `--with-native-pad` on
   static-mode profiles (doc W-B1): supervised child, `CI` deleted,
   `REACT_NATIVE_PACKAGER_HOSTNAME` from the existing LAN detection, new
   `captainpad_native_port: 6981` key in simulation/config.yaml, health row
   in `status`, ordinary teardown.

## REAL defect found during review (flag to Opus as priority)

`launcher.js`'s private `killStaleListeners` calls `forceKillTree` directly
and **bypasses the bench-mirror ARM interlock** (F7, `port_cleanup.killPid`,
reports `_212`/`_229`/`_233`). A relaunch while a bench mirror is ARMED would
`taskkill /T /F` the armed `sacn_bridge.js` with no refusal — the exact
frozen-rig incident F7 exists to prevent. launcher.js also carries private
duplicates of `listenersOnPort`/`commandlineOf`/`STACK_PROCESS_SIGNATURES`
that can drift from port_cleanup's. Doc W-A4 routes every launcher port-kill
through `portCleanup.killPid` and deletes the duplicates.

## The designed model (five lines)

1. The launcher is the only thing that starts, stops, or rebuilds services;
   `node` children spawn shell-free so args and PIDs are exact.
2. A detached zero-dep sentinel (`tools/launcher_reaper.cjs`) watches the
   launcher PID and runs the `stop` reap path (blackout → lock-children reap →
   port sweep → lock removal) the moment the launcher dies abnormally.
3. `stop`/boot reap the union of lock-recorded PIDs and identity-checked port
   holders, always through the ARM-interlocked `killPid`.
4. The native-iPad Metro is a launcher child (`--with-native-pad`, :6981)
   whose cache auto-clears when the dependency fingerprint changes — the
   stale-Metro class becomes self-announcing and self-healing.
5. `launcher.js rebuild-pad` is the one way the prod dist refreshes; the
   static server picks it up on the next iPad reload, zero restart.

## W-items (full acceptance criteria in docs/62)

- **W-A1** spawn contract (shell only for .cmd shims; hardened quote helper;
  4-test mutation-checked spec incl. the real-spawn integration test).
- **W-A2** lock records real PIDs + `stackPorts` (port-resolved for shell
  children).
- **W-A3** `stop` reaps lock ∪ ports via `freeStackPorts`; non-zero exit if a
  stack-signature process survives.
- **W-A4** boot orphan policy stays loud named-reap, but routed through the
  ARM interlock; launcher's duplicated port helpers deleted.
- **W-A5** sentinel reaper — abnormal launcher death reaps within ~5 s, clean
  stops leave no reaper; ONE reap implementation shared with `stop`.
- **W-A6** runbook: sanctioned stops only (Ctrl+C / `stop` / `-f` takeover);
  killing the shell task is forbidden, merely survivable now.
- **W-B1** `--with-native-pad` supervised Metro (:6981) — refused by name on
  expo profiles (one Metro per project).
- **W-B2** dependency-fingerprint guard → auto `expo start --clear` + loud
  line; refuse boot when package-lock is newer than the installed tree.
- **W-B3** :7175 retired.
- **W-C1** `rebuild-pad` subcommand (CI-deleted env, bundle-hash proof, no
  restart needed — static server serves from disk with no-store HTML).
- **W-C2** prod boot warns (never refuses) when dist is older than sources.
- **W-C3** cadence table: who rebuilds what, per profile; memory + runbook
  deltas spelled out for the coordinator.

## Operator decision points (defaults recommended, doc §5)

D1 reaper reaps in ALL profiles (default yes — an unsupervised stack is
already broken: exit-75 restart, blackout-on-stop and crash teardown all live
in the launcher) · D2 `shell:false` for node children (yes) · D3 flag vs
fourth profile for the native Metro (flag) · D4 retire :7175 (yes) ·
D5 rebuild-pad in-place vs atomic swap (in-place) · D6 stale-dist warn vs
refuse (warn).

## Sizing

W-A one Opus session (reaper races = the risk); W-B one session, parallel to
W-A; W-C half a session after W-A. All tests on scratch port maps
(`BM26_SIM_CONFIG`, 17xxx/78xx) — never 6966-6972/5568/6981/7175 while the
live stack runs.

## Handoff

- Doc: `docs/62_service_lifecycle_and_upkeep.md` (numbered W-items +
  acceptance criteria + D1-D6).
- Coordinator: update own memory (`keep-live-engine-latest` gains the prod
  rebuild-pad/bounce split from W-C3; VSN1/etiquette memories unaffected) and
  `.agent/ops/captain_pad_debugging.md` per W-A6/W-C3 once implementation
  lands.
- Tracker `_256` landing block + Infra row updated this session.
