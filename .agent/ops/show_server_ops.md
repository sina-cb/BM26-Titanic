# Show Server Ops — deploy, fetch, verify

This spec defines how agents operate the show-server deployment tooling
(`deploy/` — docs/43) from the design laptop, and the checks that must pass
before claiming the tooling merge-ready. The laptop is the ONLY machine with
git/GitHub access; show servers never touch GitHub.

Machine facts (hosts, paths, scenes) come from the external/private
show-server manifest through `$BM26_MACHINES` (real hostnames/IPs/shares are
never committed to this public repo). `deploy.py` requires `$BM26_MACHINES`
and fails loudly if it is unset; at deploy time it ships the file to each server's
`deploy\machines.yaml`. Never hardcode machine facts. Shape reference:
`deploy/machines.yaml.example`. Human-facing walkthrough: `deploy/README.md`.
Server-side bring-up: `deploy/interior1_agent_brief.md`.

## The two trees on a server

| Target | Manifest key | Role |
|---|---|---|
| prod | `dest` | Deployed, RUNNING show software (boot task → `boot_server.ps1` supervisor → `launcher.js`) |
| scratch | `scratch_dest` | On-server dev/agent workspace — humans and agents live here |

## Operations (run from the repo root on the laptop)

```powershell
python deploy\deploy.py fetch  --machine <name> [--source scratch] [--state]
python deploy\deploy.py deploy --machine <name> --target scratch [--force]
python deploy\deploy.py deploy --machine <name> [--scene <scene>] [--force|--dry-run|--restart-only]
python deploy\deploy.py stop   --machine <name>                    # park it: stop the stack (lights OFF)
python deploy\deploy.py start  --machine <name> [--no-verify]      # bring it back + verify the scene is live
```

- **fetch** is strictly non-destructive (SSH/scp scratch bundle →
  `refs/remotes/<machine>-scratch/*`; never merges). Curation of
  fetched `dev/*` branches follows `.agent/os/git.md`: cherry-pick durable
  work onto a `feat/` branch on the laptop, DROP engine runtime state
  (`marsin_engine/states/**`) — never push `dev/*` as-is.
- **deploy → scratch** ships tracked files except `marsin_engine/states/**`
  (server-owned, engine-mutated — excluded and counted loudly), preserves the
  server's `.git`/states/untracked, refuses a dirty scratch tree without
  `--force`.
- **deploy → prod** is the full docs/43 pipeline and RESTARTS THE LIVE
  STACK. The `/L` preview in preflight names every path that would change;
  server-side edits to synced paths are overwritten by design. Both source
  and destination `.git` are excluded from Robocopy, so protected Windows Git
  objects cannot break the list-only safety preview. Prod Git metadata is
  unsupported and may be stale; durable server-side commits belong in the
  **scratch** tree (`fetch` collects them), never in prod. `/ZB` and broad ACL
  repair are not sanctioned workarounds.
  Production `--force` is the operator-authorized fast lane: it skips only the
  duplicate `/L` preview and runs the real authoritative `/MIR` with 64 workers
  instead of 16. Secrets, identity, Node parity, SMB reachability, exclusions,
  safe stop, scene/shortcut application, restart, and verification remain
  mandatory. It cannot combine with `--dry-run` or `--restart-only`.
  Before SMB preview or stack stop, a real deploy validates the laptop's
  `$BM26_SECRETS` YAML, copies it over encrypted SCP into a protected stable
  location outside prod, sets protected least-privilege ACLs, persists only
  its path at Machine scope, removes any stale User-scope override, and verifies
  it read-only with redacted output.
  `--dry-run` validates locally and probes remotely but performs none of those
  remote mutations.
  Every full deploy resolves and prints the exact shortcut URLs from the
  selected scene, exported launcher profile registry, and effective
  machine-overlay port config. After overlays, it removes retired BM26 desktop
  shortcuts and verifies exactly three `.url` files plus three distinct local
  icons stored outside the mirrored repo. The boot script is verified to carry
  the exact `--no-launch` argument before `schtasks /Run`; neither deploy nor
  supervisor has a browser auto-open path.
- **verify's crash-loop check is a STABILITY check, not an absolute zero.**
  `restart_count` is monotonic per supervisor lifetime (a benign relaunch
  bumps it), so verify reads boot_status twice ~15 s apart (binding it to the
  run via a server-side timestamp captured before start) and fails on **any
  change** between the reads: a *rise* is a launcher crash loop (the supervisor
  keeps relaunching it); a *fall* means the supervisor process itself died and
  was relaunched by the boot task (the count resets with a fresh supervisor
  lifetime) — also unhealthy. Only an unchanged count is a pass; a stable
  nonzero count with the engine up on the expected scene is healthy.
- **stop** parks a machine: reuses the deploy pipeline's stop (`schtasks /End`
  + `launcher.js stop` + the port-quiet confirmation), then prints a loud
  `STACK STOPPED` banner. Already-stopped is fine and said so; a stack that
  refuses to go down is the same `confirm_stack_stopped` fail path (nonzero
  exit naming the orphaned port). Use it before generator/power work — the
  lights stay OFF until `start`, a reboot, or the next deploy.
  **How OFF happens (report `_169`):** `launcher.js stop` asks the engine to run
  its own graceful shutdown first (`POST /shutdown`), which sends the blackout
  frame, and only then force-kills the tree. If the stop prints
  **`BLACKOUT NOT CONFIRMED`**, the blackout could not be verified — treat the
  rig as **LIT**, confirm darkness by eye, and kill the controller PSUs before
  touching anything electrical. `stop` is a confirmed blackout, never an
  electrical isolation guarantee.
- **start** brings it back: captures the server clock, fires `schtasks /Run`
  (the stack runs in titanic's logged-on session, never the SSH one), then
  runs the same `verify_prod` flow against the machine's manifest scene.
  Verifies by default; `--no-verify` fires the boot task without the
  laptop-side health poll (only when the show LAN is unreachable — then
  confirm the lights yourself).

- **Sanctioned stops only.** Ctrl+C in the launcher's terminal, `launcher.js
  stop`, or a `-f` takeover — never a kill of the launcher's shell/task
  wrapper. A detached sentinel (`tools/launcher_reaper.cjs`,
  log `~/tmp/bm26_reaper.log`) reaps the stack if the launcher dies anyway, so
  an unsanctioned kill is survivable but still costs the supervised blackout.
  Full lifecycle runbook — sentinel, lock contents, and how to read a `stop`
  that exits non-zero: `.agent/ops/stack_lifecycle.md`.

## Operator gates (never cross without an explicit go)

- `deploy --restart-only` and any full prod deploy **blink the lights**
  (~15–30 s stack bounce). Ask the operator first, every time.
- `stop` **kills the lights** (stack down until `start`/reboot/deploy) and
  `start` **brings them back**. Both cross the live rig → **operator go
  required before an agent runs either**. The operator may run them freely
  themselves (`stop` before generator work, `start` to restore).
- Prod SMB sync needs a one-time laptop credential
  (`cmdkey /add:<host> /user:<hostname>\titanic /pass`) — the operator
  types the password; agents never handle it.
- The operator must provide the laptop's external `$BM26_SECRETS` source.
  A real prod deploy automatically provisions the server copy over encrypted
  transport before stack stop; agents and deploy output never print paths or
  credentials. `--dry-run` remains non-mutating and only reports redacted
  readiness.

## Required Before Commit (auto-checks)

Run from the repo root; all must pass:

```powershell
python -m py_compile deploy\deploy.py
python -m unittest discover -s deploy\tests -p "test_*.py" -v
python deploy\deploy.py --help
python deploy\deploy.py fetch --machine titanic-int --source scratch   # non-destructive E2E (writes one server-side bundle + laptop remote refs)
python deploy\deploy.py deploy --machine titanic-int --dry-run         # preflight + preview, changes nothing
git diff --check -- deploy docs
python scripts\security_check.py --staged                              # public repo
```

The fetch and dry-run require the server reachable on the show LAN; if it
is not, say so explicitly in the report — do NOT claim the checks passed.

Hardware-touching proof (operator-gated, not part of the auto-checks):
`deploy --restart-only` then a full `deploy --scene <scene>` whose verify
phase ends with the engine on the expected scene and the supervisor stable
(`restart_count` steady across the two reads — see the stability note above).

## Known limitations

- **Stability check window is 15 s.** verify reads `restart_count` twice ~15 s
  apart and fails on any change (rise = crash loop, fall = supervisor restart).
  A **slow** crash loop (one relaunch every
  >20 s, e.g. a long boot that dies late) can pass both reads unchanged. After a
  big deploy, don't trust a green verify alone — open the sim view
  (`http://<host>:6969/simulation/…`) and confirm the lights are actually
  animating.
- **A manually-run supervisor is invisible to `schtasks`.** The stop path's
  boot-task-still-Running guard only sees supervisors launched by the boot task.
  A `boot_server.ps1` you started by hand in a shell is not tracked by
  `schtasks /Query` and can race a deploy (relaunch the stack after the stop
  phase). **Always** start supervisors via the boot task (`schtasks /Run` /
  `start`), never by hand, on any machine a deploy will touch.

## Troubleshooting

- **SSH/SMB suddenly refused**: the gateway-less show LAN re-tags the
  server's Ethernet as Public after reconnects — fix in
  `deploy/README.md` §Troubleshooting (`Set-NetConnectionProfile …
  Private`, or re-run the server `config` pass).
- **git-over-SSH to the server fails with quoting errors**: known-broken
  (Windows OpenSSH + cmd.exe strips git's quoting). Bundles via
  `deploy.py fetch` are the primary path, not a fallback.
- **Robocopy reports ERROR 5 under `.git`**: this is an exclusion invariant
  failure. Current deploys exclude both `.git` roots and never enumerate them.
  Do not add `/ZB` or widen ACLs; update the laptop deploy tooling and rerun the
  dry-run. Access denied elsewhere still requires a narrow ACL repair on the
  named destination path for the registered deployment identity.
- **`dubious ownership` from scratch Git**: if scratch is owned by the `tech`
  account, the `titanic` user needs
  `git config --global --add safe.directory <scratch_dest>` once. Prod is not
  a supported Git workspace.
- **Engine hot-reload gap**: a deploy that changes output universes needs
  the full stack restart the pipeline already does — never "deploy without
  restart" for universe changes.
- **`BM26_MACHINES` unset after external setup**: a long-running app
  (IDE/editor) gives its terminals a stale env from before setup ran.
  `deploy.py` reads the
  persisted User-scope value from the registry (`HKCU\Environment`) itself and
  prints a `note:`, so this only fails if setup never established the variable.
  Restart the IDE to silence the note. Detail: `deploy/README.md`
  §Troubleshooting.
- **Prod preflight says runtime-secret provisioning/verification failed**:
  confirm the laptop's external `$BM26_SECRETS` source is valid and the
  registered SSH identity can administer its private deployment root. Do not
  copy secrets manually into prod or print them. A Process-only remote variable
  is insufficient because the scheduled task will not inherit it.
