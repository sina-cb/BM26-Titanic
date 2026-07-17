# Design: Show Servers — power-safe boot + one-command deploy

**Status:** Draft v1 (design; scripts not yet implemented)
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
2. **One-command deploy** — `python deploy/deploy.py --machine interior1`
   on the laptop ⇒ the server has the laptop's exact working tree, its
   per-machine config applied, the stack restarted, and health verified.

Offline readiness is a hard requirement (codex): everything below works on
an isolated LAN. No internet is used at deploy time or boot time.

## Vocabulary

| Term | Meaning |
|---|---|
| **Design station** | Sina's laptop (this machine). The single source of truth for code. Deploys are always laptop → server, never sideways. |
| **Show server** | A Windows machine on the playa LAN running the stack unattended. First one: **`interior1`** (interior/rooms lighting). Later: exterior, spares. |
| **Machine manifest** | `deploy/machines.yaml` — one entry per server: host, scene, profile, notes. Checked in. |
| **Overlay** | `deploy/overlays/<machine>/…` — per-machine files (chiefly `marsin_engine/config.yaml`) mirrored over the tree after sync. Checked in. |
| **Boot task** | The Windows Scheduled Task on the server that starts the supervisor at logon. |
| **Supervisor** | `deploy/boot_server.ps1` on the server — reads the machine's manifest entry, runs `node launcher.js prod --scene <scene> --no-launch`, relaunches it loudly if it ever exits. |

## Architecture

```
┌──────────────────────────────┐            ┌─────────────────────────────────────┐
│  DESIGN STATION (laptop)     │            │  SHOW SERVER (e.g. interior1)       │
│                              │            │                                     │
│  python deploy/deploy.py     │   SSH      │  OpenSSH server (control channel)   │
│    --machine interior1       │───────────▶│    · stop stack · run boot task     │
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
                                            │   → sim + engine + audio companion  │
                                            │   → sACN → LED controllers          │
                                            └─────────────────────────────────────┘
```

Design choices, and why:

- **Reuse `launcher.js` unchanged.** It already does the hard parts:
  startup order, readiness probes, port claiming (`prod` force-claims),
  single-instance lock, scene-switch restarts (exit 75), zombie-free
  teardown. The server layer wraps it; it does not fork it.
- **The server runs the full `prod` profile (sim + engine + companion),
  headless (`--no-launch`).** The sim's servers are cheap (http + save +
  sACN bridges; the heavy WebGL only runs when a browser opens the page),
  and keeping them means the operator can open
  `http://interior1:6969/simulation/…` from the laptop to *see* what the
  server thinks it's rendering, and the in-sim scene switcher keeps working
  remotely. If server CPU ever becomes a problem, a slimmer `server`
  profile (engine + companion only) is a 10-line launcher PR — deferred.
- **Working-tree sync, not git push.** Our working reality is long-lived
  feature branches with large uncommitted waves (see `now.md`). A
  git-based deploy would silently ship *less* than what the laptop is
  actually running — a lie. Robocopy ships the tree byte-for-byte,
  `node_modules` included (offline requirement: the server must never need
  `npm install`). `.git` is synced too so on-server agents can inspect
  history. Delta copy makes repeat deploys fast; only the first seed is big.
- **SSH for control, SMB for bytes.** Both are native Windows. SSH runs
  the remote stop/start; SMB + robocopy moves files with proper
  timestamp-delta behavior. Key-based SSH auth only — no passwords in any
  script (public repo, and Claude never handles credentials).
- **Per-machine config is an overlay, not a fork.** The tracked
  `marsin_engine/config.yaml` is the laptop's dev config (loopback sACN,
  `vsn1.deployLayout: true`, …). Each server gets its own copy in
  `deploy/overlays/<machine>/marsin_engine/config.yaml` — real controller
  IPs, **`vsn1.deployLayout: false`** (a server must never auto-flash a
  VSN1 that happens to be on a COM port), audio device for that box.
  Overlays are applied AFTER sync, so a deploy can never regress a server
  to laptop config.

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

**Scene selection** is therefore: edit that machine's `scene:` in
`deploy/machines.yaml`, redeploy (or `--restart-only`). The scene is
versioned, reviewable, and identical in the manifest and on the machine.

## Machine manifest

```yaml
# deploy/machines.yaml — one entry per show server. Checked in (LAN
# hostnames/IPs only — never credentials; MACs are banned by the security check).
machines:
  interior1:
    host: 10.1.1.50          # static IP on the show LAN (or DNS name)
    role: interior lights
    scene: titanic           # sim scene AND engine model at boot
    pattern: 00_golden_hour_wash
    profile: prod
    dest: 'C:\titanic\BM26-Titanic'
    share: '\\10.1.1.50\titanic'   # SMB share rooted at C:\titanic
    ssh_user: titanic
    notes: first server — interior/rooms universes
```

Overlay layout mirrors the repo tree:

```
deploy/overlays/interior1/
  marsin_engine/config.yaml      # real controllers, deployLayout:false, audio device
  simulation/config.yaml         # only if a machine ever needs port changes (it shouldn't)
```

(Per the port-topology rule, every server runs the ONE standard port stack
6966–6972 + 5568 — machines are isolated by being different hosts, never by
port-shuffling.)

## The deploy pipeline — `deploy/deploy.py`

`python deploy/deploy.py --machine interior1 [--seed-state] [--restart-only] [--dry-run]`

| Phase | What happens | Fails loudly when |
|---|---|---|
| 1 preflight | Manifest entry exists; SSH and SMB reachable; remote `node --version` == local (v24.16.0 today); warn with a diff summary of what will change (`robocopy /L`) | host down, node mismatch, share missing |
| 2 stop | `ssh titanic@host "schtasks /End /TN BM26TitanicStack"` then `node launcher.js stop` for stragglers | stack won't die |
| 3 sync | `robocopy <repo> <share> /MIR` with the exclusion list below | any robocopy error class ≥ 8 |
| 4 overlay | Mirror `deploy/overlays/<machine>/` over the destination | overlay dir missing (every machine MUST have one — no machine silently runs laptop config) |
| 5 stamp | Write `deploy_info.yaml` at the destination root: git HEAD, branch, dirty-file count, timestamp, source hostname | — |
| 6 start | `ssh … "schtasks /Run /TN BM26TitanicStack"` (runs in the logged-on session, so audio/devices work — never start the stack directly from the SSH session) | task missing |
| 7 verify | From the laptop: poll `http://host:6968/status` until up (timeout 3 min), assert reported model == manifest scene; probe sim `:6969`; print the supervisor `restart_count` | probes time out, wrong scene |

**Sync exclusions** (`/XD` / `/XF`) — the server *owns* its live state, the
laptop owns code:

- `marsin_engine/states/**` — deck/mixer/effects runtime state (tracked in
  git, but runtime-mutated; clobbering it mid-event would wipe the server's
  live tuning). `--seed-state` includes it for the very first deploy.
- `simulation/.scene_backups/`, `.agent_renders/`, `deploy_info.yaml`,
  supervisor logs/status.
- Overlay-managed files are synced normally, then overwritten in phase 4.

`--restart-only` skips 3–5 (fast path for "same code, new scene").
`--dry-run` runs phases 1 + the robocopy `/L` listing and stops.

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
- **Two people deploy at once**: last robocopy wins; verify catches an
  inconsistent result. Fleet locking is deliberately out of scope (one
  operator, one laptop).
- **VSN1/MIDI hardware on a server COM port**: overlays force
  `vsn1.deployLayout: false`; servers never flash controller hardware.

## What it deliberately is not

- **Not internet OTA.** Laptop → LAN → server only. No git pulls from
  GitHub on servers, no auto-update at boot — a server boots whatever was
  last deployed, verbatim.
- **Not fleet orchestration.** One machine per invocation; `--machine all`
  can come later as a loop, nothing smarter.
- **Not a backup system.** `--seed-state` seeds; it does not sync state
  back. Pulling server state to the laptop is a separate (future) skill.
- **Not a Windows-hardening guide.** Only the settings the boot chain
  needs. Kiosk mode, auto-repair loops, disk imaging: out of scope.

## Open questions for the operator

1. **Server hardware + names**: what are the actual boxes, and do we bless
   `interior1` / `exterior1` naming? Static IP plan on the show LAN?
2. **Windows user**: create a dedicated `titanic` local account (recommend
   yes — clean profile, known password for Autologon) or reuse existing?
3. **UPS**: any battery between generator and servers? (Changes nothing in
   design; shortens the dark window.)
4. **Interior scene**: is `titanic` the boot scene for interior1, or does
   the interior get its own scene/model?
5. **Audio on servers**: does interior1 need live audio reactivity (mic on
   the server), or is the companion effectively idle there?

## Implementation phases

### Phase 1 — server bring-up, by hand (no new code)

Prove the boot chain on interior1 manually: BIOS, autologon, power
hygiene, one hand-run `robocopy` seed, hand-created scheduled task
pointing at a minimal `boot_server.ps1`, then the pull-the-plug test.
(Checklist below — this is the "get the first server ready for testing"
deliverable.)

### Phase 2 — `deploy/` tooling

- `deploy/machines.yaml` + `deploy/overlays/interior1/…`
- `deploy/boot_server.ps1` (manifest-driven supervisor, logging, status file)
- `deploy/deploy.py` (phases 1–7, python_style.md, no fallback behaviors)
- `.agent/ops/show_server_ops.md` runbook + auto-checks (deploy `--dry-run`
  green, verify probes green).

### Phase 3 — polish (post-first-deploy)

- Engine `/status` exposes `deploy_info` (rev + timestamp visible from
  CaptainPad/laptop).
- `--machine all`; state pull-back skill; spare-server cold-standby doc.

## First-server bring-up checklist (interior1)

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
4. **(A) Runtime**: install Node **v24.16.0** (must match laptop) + Git for
   Windows; `git config core.hooksPath .githooks` after first sync.
5. **(A) Remote access**: enable the **OpenSSH Server** optional feature
   (auto-start service); install the laptop's public key in
   `authorized_keys`; share `C:\titanic` as SMB share `titanic`
   (read/write for the deploy user).
6. **(A) Firewall**: allow inbound TCP 6966–6972 and UDP 5568 (LAN scope)
   plus SSH 22 / SMB 445.
7. **(O/L) Network**: static IP on the show LAN; record it in
   `deploy/machines.yaml`.
8. **(L) Seed**: first robocopy of the working tree (node_modules
   included), then apply the interior1 overlay by hand until Phase 2 lands.
9. **(A) Boot task**: create `BM26TitanicStack` (at logon, highest
   privileges → `boot_server.ps1`).
10. **(O) The plug test**: with the stack up and lights/sim animating, pull
    the wall plug. Count: power back → lights animating again with zero
    touches. Target < 4 minutes. Do it twice.
