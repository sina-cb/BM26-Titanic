# Show Server Ops — deploy, fetch, verify

This spec defines how agents operate the show-server deployment tooling
(`deploy/` — docs/43) from the design laptop, and the checks that must pass
before claiming the tooling merge-ready. The laptop is the ONLY machine with
git/GitHub access; show servers never touch GitHub.

Machine facts (hosts, paths, scenes) live in the PRIVATE show-server manifest —
`machines.yaml` in the BM26-Firmware-Deployment repo, exported as
`$BM26_MACHINES` by its `setup_env` scripts (real hostnames/IPs/shares are never
committed to this public repo). `deploy.py` requires `$BM26_MACHINES` and fails
loudly if it is unset; at deploy time it ships the file to each server's
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
python deploy\deploy.py fetch  --machine <name> [--source prod|scratch|both] [--state]
python deploy\deploy.py deploy --machine <name> --target scratch [--force]
python deploy\deploy.py deploy --machine <name> [--scene <scene>] [--dry-run|--restart-only]
python deploy\deploy.py stop   --machine <name>                    # park it: stop the stack (lights OFF)
python deploy\deploy.py start  --machine <name> [--no-verify]      # bring it back + verify the scene is live
```

- **fetch** is strictly non-destructive (SSH/scp bundles → remote-tracking
  refs `refs/remotes/<machine>-<source>/*`; never merges). Curation of
  fetched `dev/*` branches follows `.agent/os/git.md`: cherry-pick durable
  work onto a `feat/` branch on the laptop, DROP engine runtime state
  (`marsin_engine/states/**`) — never push `dev/*` as-is.
- **deploy → scratch** ships tracked files except `marsin_engine/states/**`
  (server-owned, engine-mutated — excluded and counted loudly), preserves the
  server's `.git`/states/untracked, refuses a dirty scratch tree without
  `--force`.
- **deploy → prod** is the full docs/43 pipeline and RESTARTS THE LIVE
  STACK. The `/L` preview in preflight names every path that would change;
  server-side edits to synced paths are overwritten by design. The prod
  tree's `.git` is **disposable — mirrored from the laptop on every deploy**;
  durable server-side commits belong in the **scratch** tree (`fetch`
  collects them), never in prod.
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

## Required Before Commit (auto-checks)

Run from the repo root; all must pass:

```powershell
python -m py_compile deploy\deploy.py
python deploy\deploy.py --help
python deploy\deploy.py fetch --machine titanic-int --source prod      # non-destructive E2E (writes only a server-side bundle file + laptop remote refs)
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
- **`dubious ownership` from server-side git**: the trees are owned by the
  `tech` account; the `titanic` user needs
  `git config --global --add safe.directory <tree>` once per tree.
- **Engine hot-reload gap**: a deploy that changes output universes needs
  the full stack restart the pipeline already does — never "deploy without
  restart" for universe changes.
- **`BM26_MACHINES` unset after `setup_env`**: a long-running app (IDE/editor)
  gives its terminals a stale env from before setup ran. `deploy.py` reads the
  persisted User-scope value from the registry (`HKCU\Environment`) itself and
  prints a `note:`, so this only fails if `setup_env` never ran — restart the
  IDE to silence the note. Detail: `deploy/README.md` §Troubleshooting.
