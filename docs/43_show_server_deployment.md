# Design: Show Servers — power-safe boot + one-command deploy

**Status:** Draft v1. Phase 1 bring-up scripts are implemented
(`deploy/server_setup.ps1` + `deploy/setup/*.ps1`, `deploy/create_titanic_user.ps1`,
`deploy/verify_server.ps1`). The supervisor `deploy/boot_server.ps1`, the
machine manifest `machines.yaml` (private — `$BM26_MACHINES` in the
BM26-Firmware-Deployment repo, shipped to the server at deploy time), and the
boot-scene command `deploy/set_boot.ps1` now exist too, so the boot task
launches the real stack.
**Phase 2 is implemented**: `deploy/deploy.py` on the laptop does the full
prod pipeline (preflight → stop → robocopy /MIR → --scene → overlay → stamp →
start → verify), a protected code-only sync to the server's scratch
workspace, and bundle-based fetch of on-server git work + state snapshots.
Laptop-side usage: `deploy/README.md` §"Deploying from the laptop".
**Operator request (verbatim):**
> "This machine is my laptop, I do design and testing on this. But then I
> wanna deploy to the servers running the software. The servers are Windows
> machines, I want them to be set up so when power goes out, and comes back,
> they turn on, and the software we have is scheduled to start on a scene we
> select. I want you to be able to run a deploy script and then we copy all
> new code to the server, and have it updated fully."

## Why

At the burn the stack must run on dedicated **show servers**, not the design
laptop. Playa power is unreliable — generators die and come back without
warning, nobody is standing next to the box when it happens, and the mission
says the Titanic must be **highly visible at night**. A dark ship because a
Windows machine sat at a login screen after a brownout is an unacceptable
failure mode.

At the same time, patterns, playlists, and fixes keep evolving on the laptop
right up to (and during) the event. Getting that work onto a server must be
one command, not a USB-stick ritual — otherwise servers rot behind the
laptop and we stop trusting what's running where.

Two deliverables, one doc:

1. **Power-safe boot chain** — wall power returns ⇒ machine powers on,
   logs in, and the stack comes up on that machine's configured scene, with
   no human touch.
2. **One-command deploy** — `python deploy/deploy.py deploy --machine titanic-int`
   on the laptop ⇒ the server has the laptop's exact working tree, its
   per-machine config applied, the stack restarted, and health verified.

Offline readiness is a hard requirement (codex): everything below works on
an isolated LAN. No internet is used at deploy time or boot time.

## Vocabulary

| Term | Meaning |
|---|---|
| **Design station** | Sina's laptop (this machine). The single source of truth for code. Deploys are always laptop → server, never sideways. |
| **Show server** | A Windows machine on the playa LAN running the stack unattended. First one: **`titanic-int`** (interior/rooms lighting). Later: exterior, spares. |
| **Machine manifest** | `machines.yaml` — one entry per server: host, scene, profile, notes. **Private** (real hostnames/IPs/shares): lives in the BM26-Firmware-Deployment repo, exported as `$BM26_MACHINES`, shipped to each server at deploy time. Public shape reference: `deploy/machines.yaml.example`. |
| **Overlay** | `deploy/overlays/<machine>/…` — per-machine config **override fragments** (chiefly `marsin_engine/config.yaml`), deep-merged over the tracked tree at deploy time. Minimal diff only, never a full copy; a machine that needs no changes carries no overlay and runs the tracked default. Checked in. |
| **Boot task** | The Windows Scheduled Task on the server that starts the supervisor at logon. |
| **Supervisor** | `deploy/boot_server.ps1` on the server — reads the machine's manifest entry, runs `node launcher.js prod --scene <scene> --no-launch`, relaunches it loudly if it ever exits. |

## Architecture

```
┌──────────────────────────────┐            ┌─────────────────────────────────────┐
│  DESIGN STATION (laptop)     │            │  SHOW SERVER (e.g. titanic-int)     │
│                              │            │                                     │
│  python deploy/deploy.py     │   SSH      │  OpenSSH server (control channel)   │
│    --machine titanic-int     │───────────▶│    · stop stack · run boot task     │
│                              │            │                                     │
│  1 preflight (node ver,      │   SMB      │  C:\titanic\BM26-Titanic\           │
│    manifest, reachability)   │───────────▶│    · robocopy delta sync            │
│  2 stop stack (ssh)          │  robocopy  │    · overlay applied on top         │
│  3 sync working tree         │            │    · deploy_info.yaml stamped       │
│  4 apply overlay             │            │                                     │
│  5 stamp deploy_info         │            │  Boot chain (no human):             │
│  6 start boot task (ssh)     │            │   power back → BIOS auto-power-on   │
│  7 verify from laptop:       │   HTTP     │   → Windows auto-login              │
│    engine /status, sim page, │◀──────────▶│   → Scheduled Task at logon         │
│    scene == manifest scene   │            │   → boot_server.ps1 (supervisor)    │
└──────────────────────────────┘            │   → launcher.js prod --scene <X>    │
                                            │   → sim + engine + companion +      │
                                            │     CaptainPad (prebuilt static)    │
                                            │   → sACN → LED controllers          │
                                            └─────────────────────────────────────┘
```

Design choices, and why:

- **Reuse `launcher.js` unchanged.** It already does the hard parts:
  startup order, readiness probes, port claiming (`prod` force-claims),
  single-instance lock, scene-switch restarts (exit 75), zombie-free
  teardown. The server layer wraps it; it does not fork it.
- **The server runs the full `prod` profile (sim + engine + companion +
  CaptainPad), headless (`--no-launch`).** CaptainPad is served on :6967
  from its PREBUILT export (`CaptainPad/dist`, shipped by the sync) through
  `tools/static_web_server.cjs` — Node built-ins only, so there is no Metro
  and nothing to resolve over a network the server does not have. It is on
  the show machine so the operator can reach a control surface from the
  iPad even when the laptop is not on the LAN. **Build it before deploying:
  `cd CaptainPad && npm run web:build`** — the launcher refuses to start
  `prod` without `CaptainPad/dist/index.html`. The sim renders in the
  `2d_pixels` profile (2D Pixel Map only, every per-frame GPU 3D pass
  skipped) so an open console tab costs the show box almost nothing.
  The sim's servers are cheap (http + save +
  sACN bridges; the heavy WebGL only runs when a browser opens the page),
  and keeping them means the operator can open
  `http://titanic-int:6969/simulation/…` from the laptop to *see* what the
  server thinks it's rendering, and the in-sim scene switcher keeps working
  remotely. If server CPU ever becomes a problem, a slimmer `server`
  profile (engine + companion only) is a 10-line launcher PR — deferred.
- **Working-tree sync, not git push.** Our working reality is long-lived
  feature branches with large uncommitted waves (see `now.md`). A
  git-based deploy would silently ship *less* than what the laptop is
  actually running — a lie. Robocopy ships the tree byte-for-byte,
  `node_modules` included (offline requirement: the server must never need
  `npm install`). `.git` is deliberately excluded: production is a runtime
  artifact, and protected Windows Git-object ACLs can make even Robocopy's
  list-only preview fail. On-server agents use the scratch workspace for Git
  history and durable work. Delta copy makes repeat deploys fast; only the
  first seed is big.
- **SSH for control, SMB for bytes.** Both are native Windows. SSH runs
  the remote stop/start; SMB + robocopy moves files with proper
  timestamp-delta behavior. Key-based SSH auth only — no passwords in any
  script (public repo, and Claude never handles credentials).
- **Per-machine config is an overlay of MINIMAL override fragments, not a
  fork or a full copy.** The tracked `marsin_engine/config.yaml` is the
  operator-blessed default (VSN1 auto-deploy on — see below). A server that
  needs something different carries only the changed keys in
  `deploy/overlays/<machine>/marsin_engine/config.yaml`; the deploy
  **deep-merges** that fragment over the tracked file (maps recurse; arrays and
  scalars replace) and writes the result. A machine that needs no changes
  carries no overlay at all and runs the tracked config (operator ruling,
  2026-07-20 — a missing or empty overlay dir is the default path, not a
  failure). Overlays are applied AFTER sync, so a deploy can never regress a
  server below its intended config. Full-copy overlays are banned: they rot
  silently against the tracked config and hide what a machine really overrides.

## The boot chain (server side)

Every link is required; any missing link breaks unattended recovery.

1. **BIOS/UEFI — "Restore on AC Power Loss: Power On."** The machine
   powers itself on when wall power returns. (Name varies: "AC Power
   Recovery", "After Power Failure". Set it to *always on*, not
   *last state* — a machine that was shut down for the night should still
   revive; on the playa, powered = running.)
2. **Windows auto-login.** The stack needs an interactive session (audio
   capture and any future browser/UI work do not behave in session 0), so
   the `titanic` user auto-logs-in. Set up with **Sysinternals Autologon**
   (stores the password as an LSA secret, not plaintext registry). This is
   an operator-performed step — no script in this repo touches passwords.
   Autologon already means **no password is ever typed at boot**. Do NOT
   reach for a blank-password account instead: Windows default policy
   blocks blank-password accounts from network logon, which would break
   the SMB/SSH deploy path — and weakening that policy hands admin to
   anyone on the show LAN.
3. **Power hygiene.** Never sleep, never hibernate, disable Fast Startup
   (`powercfg /h off` kills both), display timeout is fine. Windows Update
   set to notify-only so it can never auto-reboot mid-show (moot on the
   playa, matters during home testing).
4. **Boot task.** Scheduled Task `BM26TitanicStack`, trigger *At log on of
   titanic*, highest privileges, action:
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\boot_server.ps1`.
   No Task-Scheduler-level restart settings — restart logic lives in the
   supervisor where it can log properly.
5. **Supervisor — `deploy/boot_server.ps1`.**
   - Resolves the machine's manifest entry by **hostname** (fail loudly if
     the hostname is not in `deploy/machines.yaml` — no default scene, no
     guessing; codex P0).
   - Runs `node launcher.js prod --scene <scene> --pattern <pattern>
     --no-launch`, streaming output to a dated log under
     `C:\titanic\logs\` (keep last N, size-rotated).
   - If the launcher exits: log a screaming banner with the exit code,
     wait 10 s, relaunch. This is not a hidden fallback — it is the
     explicitly requested show-must-go-on behavior, and every restart is
     loud in the log and counted (`restart_count` in a status file the
     deploy verify step can read).
6. **Launcher** does the rest exactly as on the laptop: sim → engine
   (model = scene) → audio companion, ports claimed, scene switches via
   exit-75 handled *inside* one supervisor run.

**Scene selection** is therefore: edit that machine's `scene:` in the private
`machines.yaml` (`$BM26_MACHINES`) — or run `deploy.py deploy --scene`, which
edits it there — then redeploy (or `--restart-only`). `deploy.py` ships the
private manifest to the server, so the scene is identical in the source of
truth and on the machine.

## Machine manifest

The manifest is **private** and does not live in this repo: it is
`machines.yaml` in the BM26-Firmware-Deployment repo, exported as
`$BM26_MACHINES` by that repo's `setup_env` scripts, and shipped to each
server's `deploy\machines.yaml` by `deploy.py` at deploy time. `deploy.py`
fails loudly if `$BM26_MACHINES` is unset — there is no repo-local fallback.
The shape (placeholder values only) is in `deploy/machines.yaml.example`:

```yaml
# machines.yaml — one entry per show server. PRIVATE (LAN hostnames/IPs only —
# never credentials; MACs are banned by the security check). Placeholder values:
machines:
  example-server:
    host: 192.0.2.10         # static IP on the show LAN (or DNS name)
    role: interior lights
    scene: test_bench        # sim scene AND engine model at boot
    pattern: 00_golden_hour_wash
    profile: prod
    dest: C:\titanic\BM26-Titanic
    share: \\192.0.2.10\titanic    # SMB share rooted at share_root
    share_root: C:\titanic         # dest must live under this (dest_unc maps it)
    scratch_dest: C:\Users\tech\workspace\BM26-Titanic  # on-server dev tree
    ssh_user: titanic
    notes: placeholder — real values live in the private repo
```

Overlay layout mirrors the repo tree (each `.yaml` is a MINIMAL override
fragment — only the changed keys — deep-merged over the tracked file, not a copy):

```
deploy/overlays/titanic-int/
  marsin_engine/config.yaml      # ONLY the changed keys: real controllers, audio device
  simulation/config.yaml         # only if a machine ever needs port changes (it shouldn't)
```

(Per the port-topology rule, every server runs the ONE standard port stack
6966–6972 + 5568 — machines are isolated by being different hosts, never by
port-shuffling.)

## The deploy pipeline — `deploy/deploy.py`

`python deploy/deploy.py deploy --machine titanic-int [--scene <scene>] [--restart-only] [--dry-run]`

The prod pipeline prints **eight** loud phases (`1/8`…`8/8`); the exact
sequence and phase names below are what `deploy_prod` emits:

| Phase | What happens | Fails loudly when |
|---|---|---|
| 1/8 preflight | Manifest entry exists; SSH reaches the right host; remote `node --version` == local (v24.18.0 today); the laptop's external `$BM26_SECRETS` YAML validates; the exact three-shortcut URL plan is derived and printed from the selected scene, launcher profile, and effective machine overlay/config; a real deploy securely provisions its protected remote secret copy outside prod, persists its Machine-scope path, removes any stale User-scope override, and verifies read access with redacted output; `--dry-run` only probes and describes remote actions; `--scene` (if given) validates NOW while the stack is still up; SMB reachable + a `robocopy /L` diff summary of what will change | host down, wrong box, node mismatch, invalid launcher/lighting profile or port config, local secret invalid, secure copy/ACL/persistence/read verification failure, share missing, bad `--scene` |
| 2/8 stop stack | `ssh … "schtasks /End /TN BM26TitanicStack"` then `node launcher.js stop` for stragglers, then confirm both ports go quiet | stack won't die (orphaned port) |
| 3/8 sync working tree | `robocopy <repo> <share> /MIR` with the exclusion list below | any robocopy error class ≥ 8 |
| 4/8 boot scene + manifest | If `--scene`, write it into the private `machines.yaml` (`$BM26_MACHINES`, same validation as `set_boot.ps1`); ship that manifest | scene missing its files or manifest unparseable/unwritable |
| 5/8 apply overlay + operator shortcuts | Deep-merge each `deploy/overlays/<machine>/` `.yaml` override fragment over the tracked file at the same path; then reconcile exactly three localhost `.url` shortcuts on the registered show user's Known Folder desktop from the deployed profile/config, remove retired BM26 shortcut duplicates, and create/verify distinct offline icons in the stable operator-assets directory outside prod | malformed overlay, wrong SSH user, desktop unavailable, URL plan mismatch, stale shortcut removal failure, or icon/shortcut verification mismatch |
| 6/8 stamp deploy_info.yaml | Write `deploy_info.yaml` at the destination root: git HEAD, branch, dirty-file count, timestamp, source hostname | — |
| 7/8 start stack | Capture the server wall clock, verify the deployed boot script contains the exact `node launcher.js <profile> --scene <scene> --no-launch` argument contract, then `ssh … "schtasks /Run /TN BM26TitanicStack"` (runs in the logged-on session, so audio/devices work — never start the stack directly from SSH) | no-launch contract missing or task missing |
| 8/8 verify | From the laptop: poll `http://host:6968/status` until up (5-min budget — a cold boot plus one benign supervisor restart can exceed 3 min), assert reported model == expected scene; probe sim `:6969`; bind `boot_status.yaml` to THIS run (server wall clock captured just before start) and confirm the supervisor is **stable** — two `restart_count` reads ~15 s apart, failing on any change (rise = crash loop, fall = supervisor restart) | probes time out, wrong scene, stale/crash-looping supervisor |

**Sync exclusions** (`/XD` / `/XF`) — the server *owns* its live state, the
laptop owns code:

- `.git/**` on both source and destination — production does not execute Git.
  Excluding both roots prevents inherited/protected object ACLs from aborting
  the safety preview. Existing prod metadata may remain but is stale and
  unsupported; all durable server-side Git work lives in scratch. Never use
  `/ZB` or broad ACL grants to force a prod mirror through `.git`.
- `marsin_engine/states/**` — deck/mixer/effects runtime state (tracked in
  git, but runtime-mutated; clobbering it mid-event would wipe the server's
  live tuning), so it is excluded on **every** deploy. First-deploy state is
  seeded to the server by hand (there is no state-seeding flag).
- `simulation/.scene_backups/`, `.agent_renders/`, `deploy_info.yaml`,
  `machines.yaml`, supervisor logs/status.
- Overlay-managed files are synced normally, then overwritten in phase 5.

The phase-5 shortcuts are ordinary InternetShortcut files. Their exact URLs
come from the same exported launcher profile registry and effective deployed
`simulation/config.yaml` used by the stack, including scene, lighting profile,
common simulation query, spotlights, and ports. Dry-run prints the complete
plan. The installer removes retired `.url`/`.lnk` entries targeting the BM26
localhost endpoints, converges exactly three authoritative names, and verifies
their contents and plan hash. It also generates three distinct offline `.ico`
assets in `<share_root>\operator_shortcuts\icons`, outside the mirrored repo,
then pins each shortcut to its stable icon. It never launches a browser, starts
a service, or adds startup behavior. The supervisor likewise has no auto-open
path and always invokes launcher.js with `--no-launch`.

`--restart-only` skips phases 3–6 (fast path for "same code, new scene" — but
`--scene` needs a sync so it cannot combine with `--restart-only`).
`--dry-run` runs phase 1 + the robocopy `/L` listing and stops.

## Edges

- **Power blips mid-deploy**: phases are re-runnable; robocopy `/MIR` is
  convergent. Just run the deploy again.
- **Server has local edits** (an on-server agent fixed something live):
  `/MIR` will erase them. That is by design — laptop is the single source
  of truth — but phase 1's diff summary names every file the sync would
  change, so a surprising server-side delta is visible *before* it's gone.
  Durable server-side fixes must round-trip through the laptop.
- **Engine crash-loops on a bad deploy**: the supervisor keeps relaunching
  (loud, counted). The verify phase surfaces `restart_count > 0` right in
  the deploy output — a deploy that "worked" but crash-loops fails its
  verify.
- **Wrong machine ID**: supervisor matches by hostname; unknown hostname =
  refuse to start anything (no default scene).
- **Runtime secret missing from the scheduled-task environment**: a real prod
  preflight validates the laptop's external source, copies it over encrypted
  SCP to an ACL-protected stable path outside the deployed tree, persists that
  path at Machine scope, removes any stale User-scope override, and opens it
  read-only before the stop phase. Output
  redacts both path and values. `--dry-run` performs only local validation and
  a read-only remote readiness probe. Process-only remote variables do not
  count.
- **Two people deploy at once**: last robocopy wins; verify catches an
  inconsistent result. Fleet locking is deliberately out of scope (one
  operator, one laptop).
- **VSN1/MIDI hardware on a server COM port**: `vsn1.deployLayout` /
  `vsn1.deployOnBoot` were once a per-machine overlay choice defaulting off. Per
  operator decision 2026-07-20 they are now **default TRUE everywhere** — the
  tracked `marsin_engine/config.yaml` turns auto-deploy on, and the engine reads
  that single file with no per-scene override path — so `titanic-int` needs **no
  overlay override** to auto-flash. A machine that must never auto-flash pins it
  off with the `MARSIN_VSN1_DEPLOY=0` env var (or a fragment setting
  `vsn1.deployLayout: false`).

## What it deliberately is not

- **Not internet OTA.** Laptop → LAN → server only. No git pulls from
  GitHub on servers, no auto-update at boot — a server boots whatever was
  last deployed, verbatim.
- **Not fleet orchestration.** One machine per invocation; `--machine all`
  can come later as a loop, nothing smarter.
- **Not a backup system.** A deploy pushes code and (by hand) seeds initial
  state; it does not sync live state back. Pulling server state to the laptop
  is `fetch --state` (snapshot into `~/tmp`, inspection only — never committed).
- **Not a Windows-hardening guide.** Only the settings the boot chain
  needs. Kiosk mode, auto-repair loops, disk imaging: out of scope.

## Open questions for the operator

1. **Server hardware + names**: what are the actual boxes, and do we bless
   the `titanic-int` / exterior naming? Static IP plan on the show LAN?
2. **Windows user**: create a dedicated `titanic` local account (recommend
   yes — clean profile, known password for Autologon) or reuse existing?
3. **UPS**: any battery between generator and servers? (Changes nothing in
   design; shortens the dark window.)
4. **Interior scene**: is `titanic` the boot scene for titanic-int, or does
   the interior get its own scene/model?
5. **Audio on servers**: does titanic-int need live audio reactivity (mic on
   the server), or is the companion effectively idle there?

## Implementation phases

### Phase 1 — server bring-up, by hand (no new code)

Prove the boot chain on titanic-int manually: BIOS, autologon, power
hygiene, one hand-run `robocopy` seed, hand-created scheduled task
pointing at a minimal `boot_server.ps1`, then the pull-the-plug test.
(Checklist below — this is the "get the first server ready for testing"
deliverable.)

### Phase 2 — `deploy/` tooling

- `machines.yaml` (private, `$BM26_MACHINES`) + `deploy/overlays/titanic-int/…`
- `deploy/boot_server.ps1` (manifest-driven supervisor, logging, status file)
- `deploy/deploy.py` (phases 1–8, python_style.md, no fallback behaviors)
- `.agent/ops/show_server_ops.md` runbook + auto-checks (deploy `--dry-run`
  green, verify probes green).

### Phase 3 — polish (post-first-deploy)

- Engine `/status` exposes `deploy_info` (rev + timestamp visible from
  CaptainPad/laptop).
- `--machine all`; state pull-back skill; spare-server cold-standby doc.

## First-server bring-up checklist (titanic-int)

Operator (O) = must be done by Sina at the machine; Agent (A) = an agent
session on the server can do it; L = from the laptop.

1. **(O) BIOS**: enable "Restore on AC Power Loss → Power On". Verify: plug
   pull while shut down → machine boots when power returns.
2. **(O) Windows account**: run `deploy/create_titanic_user.ps1` from an
   elevated prompt — it asks for the password interactively (never stored)
   and creates the `titanic` local admin. Log in once, then run
   Sysinternals **Autologon** and enable it for `titanic`. Verify: reboot
   lands on the desktop with no prompt.
3. **(A) Power hygiene**: `powercfg /change standby-timeout-ac 0`,
   `powercfg /h off`; set Windows Update to notify-only.
4. **(A) Runtime**: install Node **v24.18.0** (must match laptop) + Git for
   Windows; `git config core.hooksPath .githooks` after first sync.
5. **(A) Remote access**: enable the **OpenSSH Server** optional feature
   (auto-start service); install the laptop's public key in
   `authorized_keys`; share `C:\titanic` as SMB share `titanic`
   (read/write for the deploy user).
6. **(A) Firewall**: allow inbound TCP 6966–6972 and UDP 5568 (LAN scope)
   plus SSH 22 / SMB 445.
7. **(O/L) Network**: static IP on the show LAN; record it in the private
   `machines.yaml` (`$BM26_MACHINES`, BM26-Firmware-Deployment repo).
8. **(L) Seed**: first robocopy of the working tree (node_modules
   included), then apply the titanic-int overlay by hand until Phase 2 lands.
9. **(A) Boot task**: create `BM26TitanicStack` (at logon, highest
   privileges → `boot_server.ps1`).
10. **(O) The plug test**: with the stack up and lights/sim animating, pull
    the wall plug. Count: power back → lights animating again with zero
    touches. Target < 4 minutes. Do it twice.
