# Bringing up a show server

Hi Sina! This folder turns a blank Windows machine into a BM26 Titanic show
server: a box that powers itself back on after a power cut, logs itself in,
and starts the lighting stack on a scene you choose -- with zero human
touches -- plus the plumbing to deploy code to it from the laptop. The full
design lives in
[docs/43_show_server_deployment.md](../docs/43_show_server_deployment.md),
and the agent-facing version of this guide is
[interior1_agent_brief.md](interior1_agent_brief.md). This README is the
human path.

## TL;DR — day-to-day commands (run on the laptop)

```powershell
python deploy\deploy.py deploy --machine titanic-int --dry-run          # preview, touches nothing
python deploy\deploy.py deploy --machine titanic-int --restart-only     # bounce the stack
python deploy\deploy.py deploy --machine titanic-int --scene <scene>    # full deploy + set boot scene
python deploy\deploy.py stop   --machine titanic-int                    # park it (lights OFF until start/reboot/deploy)
python deploy\deploy.py start  --machine titanic-int                    # bring it back + verify (add --no-verify to skip the poll)
python deploy\deploy.py fetch  --machine titanic-int --state            # collect server-side work + state snapshot
```

Details in ["Deploying from the laptop"](#deploying-from-the-laptop-deploypy)
below. The rest of this README is the one-time **server bring-up** path.

After BIOS, the whole flow is **three commands**, in order:

1. **user** -- `create_titanic_user.ps1` (create the `titanic` account; it
   prints a bold Autologon banner to follow).
2. **config** -- `server_setup.ps1` (one idempotent machine-config pass;
   because the account now exists, the SMB grant and boot task complete in
   this same pass).
3. **deploy** -- `set_boot.ps1 -Scene <scene>` (pick the boot scene and wire
   the boot task to the supervisor).

Passing `-Scene <scene>` to the `config` command folds step 3 into step 2, so
a fully-specified `config` run is the whole flow in one elevated pass.

## Quick start

| # | Step | Who | Rough time |
|---|------|-----|------------|
| 0 | Clone the repo | You | 2 min |
| 1 | BIOS: power on after power loss | You | 5 min |
| 2 | **user:** `create_titanic_user.ps1` + Autologon | You | 10 min |
| 3 | **config:** `server_setup.ps1` (elevated!) | Script | 5-10 min |
| 4 | **deploy:** `set_boot.ps1 -Scene <scene>` | Script | 1 min |
| 5 | Verify + reboot test | You | 5 min |
| 6 | The plug test (twice) | You | 10 min |

Everything the scripts do is safe to re-run -- an already-done step just says
`SKIP` and moves on. When in doubt, run it again.

## The two machines: who does what

Deployment always has two sides: the **design laptop** (the machine you
design/test on -- also the ONLY machine with git/GitHub access) and each
**show server** (the box that runs the stack unattended). For the laptop to
act as the deployment machine, each side needs its own setup, and they meet
at five handshake points:

| # | On each show server | On the design laptop | The handshake |
|---|---|---|---|
| 1 | `create_titanic_user.ps1` + Autologon (Step 2) | -- | The `titanic` account exists; you know its password. |
| 2 | `server_setup.ps1` config pass (Step 3): OpenSSH on, firewall, SMB share, boot task | Generate the dedicated deploy keypair (`id_ed25519_titanic`, quick start below) | Laptop's **public** key goes into the server's config pass (`-SshPublicKey`); after this, `ssh` from the laptop needs no password. |
| 3 | Node installed **machine-scope** by the config pass | Node installed at the **same exact version** | Versions must match -- `node_modules` ship as-is; the deploy preflight hard-fails on a mismatch. |
| 4 | SMB share `titanic` exposed by the config pass | `cmdkey /add:<server> /user:<SERVER-HOSTNAME>\titanic /pass` (once) | You type the `titanic` password into Windows Credential Manager; robocopy (prod deploys) can now write the share. |
| 5 | `set_boot.ps1 -Scene <scene>` picks what boots | Entry for the machine in the private `machines.yaml` (`$BM26_MACHINES`) | The manifest tells the laptop where the server is and what it should run; `deploy.py` ships it to the server, which reads that derived copy at boot. |

After that, day-to-day is laptop-only: `deploy.py` (below) ships code,
bounces the stack, and verifies it -- the server is never touched by hand.
Server details (host, paths, scene) always come from the private show-server
manifest (`$BM26_MACHINES` -> `machines.yaml` in the BM26-Firmware-Deployment
repo), never hardcoded and never checked into this public repo.

## Step 0 -- get the code

From any PowerShell window:

```powershell
git clone -b feat/auto_start https://github.com/sina-cb/BM26-Titanic.git C:\titanic\BM26-Titanic
```

This clone is for setup. Later, the deploy pipeline will sync the laptop's
working tree into this same path -- so don't hand-edit files here.

## Step 1 -- BIOS: wake up after a power cut

Reboot into the BIOS/UEFI setup and enable **"Restore on AC Power Loss ->
Power On"** (your board may call it "AC Power Recovery" or "After Power
Failure"). Pick **always on**, not "last state".

Why: on the playa, generators die and come back with nobody standing at the
machine -- this setting is what makes the box turn itself back on, and "last
state" would leave a deliberately-shut-down machine dark forever.

## Step 2 -- the titanic user + Autologon (command 1: "user")

The stack runs as a local user named `titanic`. Create it with the
self-elevating one-liner (say Yes to the UAC prompt; the window stays open so
you can read the banner it prints):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\create_titanic_user.ps1'
```

It asks you to type the password twice, right there at the console. The
password is never stored, logged, or passed as an argument. When it finishes
it prints a **bold yellow banner** with the exact Autologon instructions --
follow it:

1. Run the Autologon tool (it self-elevates via UAC, or right-click -> Run as
   administrator):
   `C:\titanic\BM26-Titanic\deploy\setup\tools\autologon\Autologon64.exe`
   The tool is **not in the repo** -- the Sysinternals license forbids
   republishing it and this repo is public. `create_titanic_user.ps1`
   downloads it automatically on first use into that gitignored path (you'll
   need internet at setup time; fine right after the `git clone`). If that
   download failed (offline), the banner it printed says so -- fetch it
   manually via `deploy\setup\get_autologon.ps1` or from
   <https://learn.microsoft.com/sysinternals/downloads/autologon>. Microsoft's
   `Eula.txt` lands alongside the exe (it applies).
2. In the Autologon window: **Username** `titanic`, **Domain** = this
   machine's hostname (the banner fills in the real value), **Password** =
   the one you just typed, then click **Enable**.
3. Log in as `titanic` once (creates the profile), then reboot to test.

Two things to never do here:

- **Never use a blank password.** Windows blocks blank-password accounts
  from network logons, which would break the SSH/SMB deploy path -- and
  weakening that policy hands admin to anyone on the LAN.
- **Never set autologon via registry keys.** The `DefaultPassword` value is
  stored in plaintext. Autologon (the Sysinternals tool) is the only
  approved way.

**Quick check -- reboot lands on the `titanic` desktop with no prompt.** You
can confirm Autologon is wired the safe way (LSA secret, not plaintext)
without touching any secret:

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' |
  Select-Object AutoAdminLogon, DefaultUserName, DefaultDomainName, DefaultPassword
```

Expect `AutoAdminLogon = 1`, `DefaultUserName = titanic`,
`DefaultDomainName = <hostname>`, and **`DefaultPassword` absent**. A
`DefaultPassword` with a value means someone used the forbidden registry
method -- fix that (use Autologon instead).

## Step 3 -- the config pass (command 2: "config")

`server_setup.ps1` does the machine prep in one go: runtimes (Node, Git,
Python), power hygiene, Windows Update notify-only, OpenSSH server, SMB
share, firewall rules, the network profile (forces the gateway-less show LAN
to Private so those firewall rules actually apply -- see the Troubleshooting
note on SSH/SMB refused), the boot task, and (optionally) a static IP.

**It must run as Administrator.** Paste this into any normal PowerShell
window -- it opens an elevated window (say Yes to UAC), runs the setup, and
stays open so you can read the summary table:

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\server_setup.ps1'
```

For the full run, add the laptop's SSH public key and the static address for
the show LAN inside the quotes (placeholders below -- fill in this machine's
real show-LAN values; its `host` address is the one recorded in
`deploy\machines.yaml`). The public key is the design laptop's deploy keypair
-- see **The two machines** above and **New laptop quick start** below for
generating it and handing it to this pass:

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\server_setup.ps1 -SshPublicKey C:\keys\laptop.pub -StaticIp <static-ip> -PrefixLength 24 -Gateway <gateway> -Dns <dns>'
```

Optionally add `-Scene <scene>` (with `-LauncherProfile` / `-Pattern` if you
want them) and this pass also does Step 4 -- it folds in `set_boot.ps1` after
the machine config, so a single elevated run configures the box **and** sets
its boot scene. Omit it and the boot-scene step just reports `SKIP`; run
`set_boot.ps1` on its own later (Step 4).

Because you created the `titanic` account in Step 2, the SMB share grant and
the boot task **complete in this single pass** -- no deferred WARNs. Reading
the summary table:

- **DONE** -- the step made a change and succeeded.
- **SKIP** -- already configured (or you didn't pass a needed param, like
  `-SshPublicKey` / `-StaticIp`). Fine.
- **WARN** -- worked partially; something needs a later step or a re-run.
- **FAIL** -- something is actually wrong. The row carries the exact error;
  nothing is silently worked around. Fix the cause and re-run.

> **Order note.** If you ever run `config` *before* the `titanic` user
> exists (the very first machine was brought up that way), you'll get WARNs
> for the SMB grant and the boot task -- that's expected. Just re-run
> `server_setup.ps1` after the account exists; it's idempotent and picks up
> whatever it deferred.

Two things that surprised us on the first bring-up (both benign):

- **OpenSSH install can sit silent for minutes.** The OpenSSH Server
  capability is a Feature-on-Demand download with no progress output. Signs
  it's alive: `sshd` shows up in `Get-Service` partway through, and
  TiWorker / TrustedInstaller are busy. Ctrl+C and re-run is safe (the step
  is idempotent).
- **winget Python can fail with a per-user collision.** If a USER-scoped
  `Python.Python.3.12` was installed earlier, the machine-scope install
  collides (exit code `-1978335226`). Fix: `winget uninstall
  Python.Python.3.12`, then re-run `config`. Machine scope is required so the
  `titanic` account (which the stack runs as) actually sees Python.

## Step 4 -- set the boot scene (command 3: "deploy")

Tell this machine which scene to boot. `set_boot.ps1` writes this hostname's
entry in `deploy/machines.yaml`, makes sure the `BM26TitanicStack` task
points at the supervisor `deploy/boot_server.ps1`, and confirms the chain.
Self-elevating (it edits the `titanic` user's task):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\set_boot.ps1 -Scene test_bench'
```

`-Scene` is required and is validated (it must have a
`simulation\scenes\<scene>\scene_config.yaml` and a
`marsin_engine\models\<scene>.js`, exactly what the launcher needs).
Optional: `-LauncherProfile` (default `prod`) and `-Pattern`. It ends with a
"BOOT SCENE SET" confirmation showing the hostname, scene, profile, and the
exact launcher line the boot task will run -- effective at the next
`titanic` logon / reboot.

**Config overlay.** `set_boot.ps1` does **not** touch config -- per-machine
config overlays are applied by `deploy\deploy.py` at deploy time (its overlay
phase deep-merges each machine's `.yaml` override fragments over the tracked
tree on the server). A machine that needs no config changes carries no overlay
and simply runs the tracked config (the operator-blessed default). See
[`deploy\overlays\README.md`](overlays/README.md) for the fragment format and
deep-merge semantics.

**Browser at boot (`open_browser`).** Add `-OpenBrowser` (toggle off with
`-NoOpenBrowser`, or edit `open_browser` in `machines.yaml`) to have the
supervisor auto-open the sim (`localhost:6969`) and audio companion
(`localhost:6966`) pages in the default browser at boot. They open on the
**titanic console desktop only** -- the session the supervisor runs in -- not
in any other logged-in user's session (a fast-user-switching nuance). Default
is off: servers stay headless.

At boot the chain is: autologon -> `BM26TitanicStack` task ->
`deploy\boot_server.ps1` -> `node launcher.js <profile> --scene <scene>
--no-launch`. The supervisor streams to a dated log under `C:\titanic\logs\`
and relaunches loudly if the launcher ever exits.

## Step 5 -- verify + reboot test

Read-only state report (no admin needed, run it as often as you like):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\verify_server.ps1
```

It prints hostname, addresses, runtime versions vs the pins, OpenSSH state,
firewall rules, the share, the account, the boot task, hibernate state, and
any COM ports. One quirk: from a **non-elevated** window a couple of rows
(the SMB share and the boot task) show `UNKNOWN (needs elevation to
confirm)` -- Windows won't let a normal user read them. Re-run elevated for a
definitive yes/no.

**Reboot test.** Reboot and confirm:

1. the machine lands on the `titanic` desktop with **no prompt**;
2. the boot task fired -- check its last run time (elevated):

```powershell
Get-ScheduledTask BM26TitanicStack | Get-ScheduledTaskInfo
```

`LastRunTime` should be about your boot time. Now that `boot_server.ps1`
ships in the repo, the task actually launches the supervisor -- so also look
for a fresh `boot_server_*.log` under `C:\titanic\logs\`, and (once the code
tree + `node_modules` are present on the box) the sim answering at
`http://localhost:6969/simulation/`. If the tree isn't fully seeded yet, the
supervisor will loudly retry every 10 s -- that's the expected in-between
state until the deploy pipeline seeds the code + deps.

## Step 6 -- the plug test

The whole point. With the machine up and the lights/sim animating:

1. Pull the wall plug.
2. Plug it back in.
3. Watch: power on -> autologon as `titanic` -> boot task -> supervisor ->
   stack up, with you touching nothing.

Do it **twice** -- once is luck, twice is a boot chain.

## Deploying from the laptop (`deploy.py`)

Once a server is brought up, day-to-day code movement is **one command from
the design laptop** (the only machine with git/GitHub access). `deploy.py`
knows two operations against the two trees on a server:

| Tree | Path (titanic-int) | Role |
|---|---|---|
| **prod** | `C:\titanic\BM26-Titanic` | The deployed, running show software (boot task launches it). |
| **scratch** | `C:\Users\tech\workspace\BM26-Titanic` | On-server dev/agent workspace. |

### New laptop quick start (one-time, per design laptop)

The laptop is the deploy + git gate, so a fresh one needs a little
plumbing before `deploy.py` works. Each step here is the laptop half of a
handshake in **The two machines** above (its server half is done during
Steps 2-4 of the server bring-up). Hostnames and addresses live in the private
`machines.yaml` (see step 2 below) - wherever you see `<server>` below, use that
machine's `host` value from the manifest.

1. **Clone the repo** and check out the working branch.
2. **Private manifest + secrets**: clone the private **BM26-Firmware-Deployment**
   repo and run its `setup_env.ps1` (Windows) or `source setup_env.sh`
   (macOS/Linux), then open a NEW terminal. That exports `$BM26_MACHINES`
   pointing at the private `machines.yaml` (real hostnames/IPs/shares/scenes).
   `deploy.py` requires this var and fails loudly if it is unset - there is no
   repo-local manifest. (`deploy/machines.yaml.example` shows the shape only.)
3. **Runtimes**: Node **exactly matching the servers** (`ssh` in and run
   `node --version` to see theirs - a mismatch hard-fails the deploy
   preflight on purpose), plus Git and Python 3.11+.
4. **Dedicated SSH key** (no passphrase - deploys run unattended):
   ```powershell
   ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519_titanic -C titanic-deploy@laptop
   ```
   Add a block to `~\.ssh\config` so every show-LAN box gets the right
   user + key automatically (`User titanic`, `IdentityFile
   ~/.ssh/id_ed25519_titanic`, `IdentitiesOnly yes` under a `Host` entry
   covering the show LAN).
5. **Install the public key on each server**: hand `id_ed25519_titanic.pub`
   to the server's config pass (`setup\install_ssh_key.ps1`, or
   `server_setup.ps1 -SshPublicKey <path>`).
6. **Store the SMB credential** (per server, once - this is the one people
   forget):
   ```powershell
   cmdkey /add:<server> /user:<SERVER-HOSTNAME>\titanic /pass
   ```
   It prompts for the `titanic` password and stores it in Windows
   Credential Manager. Only **prod** deploys need it (robocopy over SMB);
   fetch and scratch deploys are pure SSH. If a prod deploy ever fails
   with "not reachable over SMB", this credential is missing or stale -
   the error message prints the exact `cmdkey` line to run, and
   `cmdkey /delete:<server>` first replaces a bad one.
7. **Prove it end-to-end** (safe, read-only / non-prod):
   ```powershell
   ssh <server> hostname                                      # key auth, no password prompt
   python deploy\deploy.py fetch  --machine <name>            # SSH-only
   python deploy\deploy.py deploy --machine <name> --dry-run  # exercises SMB, changes nothing
   ```

### Deploy to prod - the full docs/43 pipeline

```powershell
python deploy\deploy.py deploy --machine titanic-int                  # ship current tree
python deploy\deploy.py deploy --machine titanic-int --scene titanic  # ship + set boot scene
python deploy\deploy.py deploy --machine titanic-int --dry-run        # preview only
python deploy\deploy.py deploy --machine titanic-int --restart-only   # bounce stack, no files
python deploy\deploy.py stop  --machine titanic-int                   # park it safely (lights OFF) - e.g. before generator work
python deploy\deploy.py start --machine titanic-int                   # bring it back + verify (--no-verify skips the poll)
```

Eight loud phases: preflight (manifest, SSH identity, **node version must
match the laptop**, SMB, robocopy `/L` preview of every path that would
change) -> stop stack (`schtasks /End` + `launcher.js stop`) -> robocopy
`/MIR` (excludes `marsin_engine\states\**`, `simulation\.scene_backups\`,
`.agent_renders\`, `deploy_info.yaml`, `machines.yaml`; **includes
`node_modules`** - offline playa rule) -> optional `--scene` written into the
*private* `machines.yaml` (`$BM26_MACHINES`, same validation as `set_boot.ps1`)
then that private manifest shipped to `<dest>\deploy\machines.yaml` on the
server -> overlay override fragments deep-merged over the dest (missing/empty
overlay dir = OK; the tracked config is the operator-blessed default) ->
`deploy_info.yaml` stamp (git
head/branch/dirty count/source host) -> `schtasks /Run` (the stack must run
in titanic's logged-on session, never inside the SSH session) -> verify from
the laptop (engine `/status` `activeModel` == expected scene, sim `:6969`
up, supervisor **not crash-looping**). The supervisor check is a **stability
check, not an absolute zero**: `restart_count` is monotonic per supervisor
lifetime (a benign relaunch bumps it), so verify reads it twice ~15 s apart
and fails on **any change** between reads — a *rise* is a launcher crash loop,
a *fall* means the supervisor itself restarted (the count resets with a fresh
supervisor lifetime) — both unhealthy. A stable nonzero count with the engine
up on the right scene is healthy.

A deploy **overwrites/deletes server-side edits to synced paths by design**
(laptop is the single source of truth) - the `/L` preview names every such
path before bytes move. Durable server-side work must round-trip via
`fetch` + laptop curation instead. That includes the prod tree's `.git`: it
is **disposable — mirrored from the laptop on every deploy**, so never commit
durable work in the prod tree; server-side commits belong in the **scratch**
tree (`fetch` collects them).

### Deploy to scratch - safe code hand-off

```powershell
python deploy\deploy.py deploy --machine titanic-int --target scratch [--force]
```

Streams the laptop's **tracked files except `marsin_engine\states\**`** (tar
over SSH), printing how many server-owned state files it excluded. Deliberate
semantics: the server's `.git`, `marsin_engine\states\**` (engine-mutated live
tuning), and untracked files are never touched; laptop-side deletions do NOT
propagate (it is a working tree people live in, not a mirror); a dirty scratch
tree aborts with the file list unless `--force`. Ends with sha256 spot-checks.

### Fetch - collect on-server work (never merges)

```powershell
python deploy\deploy.py fetch --machine titanic-int                 # both trees' branches
python deploy\deploy.py fetch --machine titanic-int --source prod --state
```

Each tree's branches arrive as `refs/remotes/titanic-int-<prod|scratch>/*`
via a git bundle (created server-side at `C:\titanic\fetch_*.bundle`,
copied with scp - git-over-SSH direct is broken by cmd.exe quoting on
Windows OpenSSH, so bundles are the *primary* path, not a fallback).
Nothing is merged; curation follows `.agent/os/git.md` (`dev/*` residue is
cherry-picked on the laptop, runtime state dropped). `--state` snapshots
`marsin_engine\states\**` + `boot_status.yaml` into
`~\tmp\bm26_state_snapshots\<machine>\<timestamp>\` for inspection - state
is read, never committed.

## Running a single step

The full `server_setup.ps1` is the normal path (and is what the Phase 2
deploy pipeline will drive remotely), but every step is a standalone script
you can run on its own -- to fix one thing or re-check it. Each is **exactly
as safe to re-run** as the full orchestrator (SKIP on already-done work), and
each prints its own conclusive `==== <step>: DONE/SKIP/WARN/FAIL ====` line
when run directly.

| Script | What it does | Admin? | Params worth knowing |
|---|---|---|---|
| `create_titanic_user.ps1` | Create the `titanic` local admin (interactive password), then print the Autologon banner | Yes | `-UserName` (default `titanic`) |
| `setup\get_autologon.ps1` | Download Sysinternals Autologon into the gitignored local tools dir (not committed - license) | No | (none) |
| `setup\setup_prereqs.ps1` | Install/verify Node + Git + Python; set git `core.hooksPath` | Yes | `-NodeVersion` 24.18.0, `-PythonVersion` 3.12, `-RepoRoot` |
| `setup\setup_power.ps1` | No sleep / no hibernate / no Fast Startup | Yes | (none) |
| `setup\setup_windows_update.ps1` | Windows Update notify-only, no auto-reboot | Yes | (none) |
| `setup\setup_openssh.ps1` | Enable OpenSSH Server, service Automatic + started | Yes | (none) |
| `setup\install_ssh_key.ps1` | Install the laptop's public key for the `titanic` admin | Yes | `-PublicKey` (**mandatory**: key line or `.pub` path) |
| `setup\setup_smb_share.ps1` | Share `C:\titanic` as `titanic`, Full access for `titanic` | Yes | `-SharePath`, `-ShareName`, `-GrantUser` |
| `setup\setup_firewall.ps1` | Inbound allow: TCP 6966-6972, UDP 5568, TCP 22, TCP 445 | Yes | (none) |
| `setup\setup_network_profile.ps1` | Set the gateway-less show LAN's Unidentified profile to Private (so the Private-scoped firewall rules apply); named Wi-Fi SSIDs untouched | Yes | (none) |
| `setup\setup_boot_task.ps1` | Create `BM26TitanicStack` (at logon of `titanic` -> `boot_server.ps1`) | Yes | `-RepoRoot`, `-TaskName`, `-LogonUser` |
| `setup\setup_static_ip.ps1` | Static IPv4 on the one physical adapter | Yes | `-StaticIp` (**mandatory**), `-PrefixLength` 24, `-Gateway`, `-Dns` |
| `set_boot.ps1` | Set this machine's boot scene + wire the task to the supervisor (also foldable into `server_setup.ps1 -Scene`) | Yes | `-Scene` (**mandatory**), `-LauncherProfile` prod, `-Pattern` |
| `verify_server.ps1` | Read-only state report | No | `-NodeVersion`, `-PythonVersion`, `-RepoRoot` |

The two mandatory-param steps (`install_ssh_key.ps1 -PublicKey`,
`setup_static_ip.ps1 -StaticIp`) refuse to guess -- omit the value and
PowerShell prompts for it. Example: run just the OpenSSH step, elevated:

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\setup\setup_openssh.ps1'
```

## Troubleshooting

**"The script 'server_setup.ps1' cannot be run because it contains a
"#requires" statement for running as Administrator."** -- You ran it from a
normal PowerShell window. Nothing happened and nothing broke; use the
`Start-Process ... -Verb RunAs` one-liner from Step 3 (it opens an elevated
window for you). The same applies to any single step -- they all need
elevation except `verify_server.ps1`.

**OpenSSH install seems frozen.** It's a silent Feature-on-Demand download
(see Step 3). It's working if `Get-Service sshd` appears partway through and
TiWorker/TrustedInstaller are busy. Ctrl+C + re-run is safe.

**winget Python fails (`-1978335226`).** A per-user Python collided with the
machine-scope install. `winget uninstall Python.Python.3.12`, then re-run
`config` (see Step 3).

**Reboot lands on the desktop but no lights; boot task `Last Result = 1`; no
log in `C:\titanic\logs`.** (interior1 first bring-up.) *Symptom:* autologon
works, the `titanic` desktop appears, but the stack never comes up;
`Get-ScheduledTask BM26TitanicStack | Get-ScheduledTaskInfo` shows
`LastTaskResult = 1`, and there is no fresh `boot_server_*.log`. *Cause:* a
runtime (usually **node**) was installed **per-user** for the setup account
(e.g. `tech`), so it is invisible to the `titanic` service account the stack
runs as -- the supervisor died resolving node before it wrote anything.
*Check:* does the **Machine** PATH contain a `nodejs` directory?

```powershell
[Environment]::GetEnvironmentVariable('Path','Machine')
```

If no `nodejs` dir appears, node is per-user only. *Fix (elevated):*

```powershell
winget install --id OpenJS.NodeJS.LTS --version 24.18.0 --exact --silent --accept-package-agreements --accept-source-agreements --scope machine
```

(It must be the `.LTS` package id -- plain `OpenJS.NodeJS` does not carry the
24.x LTS patch releases and answers "No version found matching".) If that
returns `-1978335226`, the per-user copy is blocking it -- `winget uninstall
OpenJS.NodeJS.LTS` first, then re-run the install (same collision dance as
Python above). Better: just re-run `config` -- `setup_prereqs.ps1` now
detects the per-user trap for node/git/python, WARNs loudly naming the
per-user path, and installs machine-scope anyway. Note: after this hardening,
`boot_server.ps1` **always leaves a dated log** under `C:\titanic\logs\` even
on an instant setup failure -- so "no log at all" now specifically points at a
failure *before* the supervisor ran (task/permissions/RepoRoot), not a runtime
resolution error.

**Machine went dark after exactly ~3 days.** The stack ran fine, then the
whole thing stopped roughly 72 h after the last boot. *Cause:* an old boot
task carried Task Scheduler's default `ExecutionTimeLimit = PT72H`, so the
scheduler killed the supervisor (and its whole process tree) 72 hours after
logon. *Fix (elevated, once):* re-run `config` (or `set_boot.ps1`) after
updating the tree -- `setup_boot_task.ps1` now sets the limit to unlimited
(`PT0S`) and, on an already-configured machine, **detects the stale 72 h limit
and repairs the existing task in place** (reports `repaired settings
(ExecutionTimeLimit unlimited)`). One elevated re-run heals it; the change
takes effect at the next `titanic` logon / reboot.

**SSH/SMB refused from the laptop even though `sshd` runs and the firewall
rules exist.** (interior1, field-verified.) *Symptom:* `Get-Service sshd`
is Running, `verify_server.ps1` shows the `BM26 Titanic -` inbound rules
present, but connecting to port 22 (SSH) or 445 (SMB) from the laptop is
refused/times out. *Cause:* the show LAN has **no gateway**, so Windows can't
identify it and classifies the Ethernet as an **"Unidentified network" ->
Public** firewall profile. Every suite rule is scoped **Private+Domain**, so
on a Public interface the inbound allow is inert and Windows drops the
traffic. `verify_server.ps1` now surfaces this: the *Network profile* row
shows the adapter's category (a yellow **Public** on the show-LAN adapter is
the tell). *Fix:* re-run `config` -- the **network profile** step sets the
current Unidentified/Network profile on the physical adapter to Private
(named Wi-Fi SSIDs are never touched). Quick manual one-liner (elevated),
if you just need access back this second:

```powershell
Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private
```

*Durability caveat:* setting the profile fixes it **until the next
reconnect/reboot**, when Windows can mint a fresh Unidentified profile that
reverts to Public. The permanent fix is the Network List Manager policy
"Unidentified Networks -> Private" (`secpol.msc` > Network List Manager
Policies > Unidentified Networks > Location type = Private), which makes it
**survive reboots**. That policy write is a documented TODO in
`setup\setup_network_profile.ps1` (the exact policy-key signature could not
be verified read-only without elevation, and the suite never ships a guessed
registry write) -- so the step reports **WARN** until it is applied, meaning
"access is unblocked now, but not yet reboot-durable." Set the policy once
via `secpol.msc` on the box to close it.

**`deploy.py` says `BM26_MACHINES` is not set even after `setup_env.ps1`.**
A long-running app (an IDE or editor like Antigravity, VS Code) hands every
terminal it spawns a **stale environment captured before `setup_env` ran**, so
`os.environ` lacks the var even though it was persisted. `deploy.py` reads the
persisted User-scope value straight from the registry (`HKCU\Environment`), so
this only truly fails if `setup_env` never ran — it prints a one-line `note:`
that it fell back to the registry because the terminal is stale. Restart the
IDE (so its children inherit a fresh environment) to silence the note.

**WARN vs FAIL.** WARN means "did what it could; a later step or re-run
finishes it". FAIL means "stopped, here is the exact error" -- these scripts
never quietly work around a problem, so a FAIL is always worth reading. On a
machine where `config` ran before the `titanic` user existed, the SMB grant
and boot task WARN until you re-run `config` with the account in place.

**`create_titanic_user.ps1` errors on an OLD clone.** Two bugs were fixed in
the current file: a PS 5.1 encoding bug (em-dashes in a no-BOM UTF-8 file
mis-decoding into a stray quote -> parser error) and a `New-LocalUser
-Description` string exceeding this Windows build's 48-char cap. If you see
either symptom (a parser error about a stray quote, or a `-Description`
length error), your clone is stale -- `git pull` to update it.

**"titanic already exists" when re-running `create_titanic_user.ps1`.** It
hard-stops on purpose (no silent password reset). If the account is fine and
you only need to finish its config, run `setup\setup_smb_share.ps1` and
`setup\setup_boot_task.ps1` individually, or just re-run `server_setup.ps1`.

**Where's the rest of the stack?** `boot_server.ps1` (the supervisor) ships in
this folder, so the boot task actually launches the lighting stack and the
boot-task step reports DONE (no more "boot_server.ps1 missing" WARN). The
per-machine scene manifest `machines.yaml` is NOT in this repo -- it is private
(`$BM26_MACHINES`, BM26-Firmware-Deployment repo) and `deploy.py` ships it to
`<dest>\deploy\machines.yaml` on the server at deploy time. Still Phase 2:
`deploy.py`, the one-command laptop-to-server sync that seeds the code tree +
`node_modules`. Until that lands, the supervisor runs but the launcher needs
the tree present to bring the stack fully up. docs/43 tracks the plan.
