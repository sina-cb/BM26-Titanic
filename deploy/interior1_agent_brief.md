# Agent brief — bring up show server `interior1`

> Hand this file to the agent running ON the server machine. It is
> self-contained: read it, then execute. The full design is
> `docs/43_show_server_deployment.md` in this repo — read that too before
> touching anything. (Human operator? The friendly walkthrough is
> `deploy/README.md`.)

## Your mission

You are on a Windows machine that will become **`interior1`**, the first
BM26 Titanic show server (interior/rooms lighting). Prepare it so that:

1. when wall power is cut and restored, the machine powers on, logs in as
   `titanic`, and the lighting stack starts on its configured scene with
   **zero human touches**, and
2. the design laptop can deploy code to it over the LAN (SSH + SMB).

You do the machine-preparation steps. Some steps belong to the human
operator (Sina) — for those, stop and tell the operator exactly what to do;
never work around them.

## Ground rules (non-negotiable)

- **Never handle passwords.** You do not create, type, store, or ask to be
  told any password. The operator runs the password-prompting script and
  Sysinternals Autologon themselves. Do not configure autologon via
  registry keys (`DefaultPassword` is plaintext — forbidden).
- **This repo is public.** Never commit or push from this machine. Clone
  and pull only. No secrets, MACs, or credentials anywhere in the tree.
- **No fallback behaviors** (codex P0). If a step fails, stop and report
  loudly with the exact error — do not improvise an alternative.
- **Do not flash any firmware** from this machine, and do not plug/unplug
  hardware. If a VSN1/ESP32 board appears on a COM port, report it.
- Reversible system configuration listed below is pre-authorized by the
  operator. Anything not listed here or in docs/43 (installing other
  software, changing network hardware, BIOS) — ask first.

## Setup sequence

Work through these in order. docs/43 "First-server bring-up checklist" is
the source of truth; this is the executable expansion.

> **Scripted:** steps 3–8 (the agent-owned ones) are automated. Run them all
> at once from an elevated prompt with `deploy\server_setup.ps1` (params:
> `-SshPublicKey`, `-StaticIp/-PrefixLength/-Gateway/-Dns`, `-NodeVersion`,
> `-PythonVersion`), or run any single step's script under `deploy\setup\`
> alone. Everything is idempotent — re-running reports SKIP for done work.
> Check state anytime, read-only, with `deploy\verify_server.ps1`.

**Step 0 — get the code.**
```powershell
git clone -b feat/auto_start https://github.com/sina-cb/BM26-Titanic.git C:\titanic\BM26-Titanic
```
(This clone is for setup + review. Show code will later be robocopy-synced
from the laptop into this same path by the deploy pipeline; don't hand-edit
the tree.)

**Step 1 — BIOS (OPERATOR).** Tell the operator: enable "Restore on AC
Power Loss → Power On" (a.k.a. "AC Power Recovery / After Power Failure";
choose *always on*, not *last state*).

**Step 2 — titanic account (OPERATOR runs, you verify).** Tell the
operator to run, from an elevated PowerShell:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\create_titanic_user.ps1
```
It prompts for a password interactively (never stored). Then the operator
logs in as `titanic` once and enables **Sysinternals Autologon** for it.
Note: autologon means no password is ever typed at boot — do NOT suggest a
blank password instead (blank passwords block the network logons the
deploy pipeline needs).
You verify afterwards: `Get-LocalUser titanic` exists, is in
Administrators, and a reboot lands on the desktop with no prompt.

**Step 3 — power hygiene (YOU).**
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /h off
```
Also set Windows Update to notify-only / pause so it can never auto-reboot.
Scripted: `deploy\server_setup.ps1` (power step) / run `deploy\setup\setup_power.ps1`
and `deploy\setup\setup_windows_update.ps1` alone.

**Step 4 — runtime (YOU).** Install **Node.js v24.18.0** (must match the
laptop exactly — check `node --version`) and **Git for Windows**. Then in
the repo: `git config core.hooksPath .githooks`.
Scripted: `deploy\server_setup.ps1` (prereqs step) / run `deploy\setup\setup_prereqs.ps1`
alone (skips anything already on PATH; version-mismatch is a WARN, never a reinstall).

**Step 5 — remote access (YOU).** Enable the **OpenSSH Server** optional
feature, set service to automatic, start it. Ask the operator for the
laptop's SSH **public** key and install it for the `titanic` user
(`authorized_keys`; for an admin user that's
`C:\ProgramData\ssh\administrators_authorized_keys` with correct ACLs).
Share `C:\titanic` as SMB share `titanic`, read/write for `titanic`.
Scripted: `deploy\server_setup.ps1 -SshPublicKey <key-or-.pub>` / run
`deploy\setup\setup_openssh.ps1`, `deploy\setup\install_ssh_key.ps1`, and
`deploy\setup\setup_smb_share.ps1` alone. (The SMB grant for `titanic` needs
the account to exist first — WARN + re-run after Step 2 if not.)

**Step 6 — firewall (YOU).** Inbound allow, private/LAN scope: TCP
6966–6972, UDP 5568, TCP 22 (SSH), TCP 445 (SMB).
Scripted: `deploy\server_setup.ps1` (firewall step) / run
`deploy\setup\setup_firewall.ps1` alone.

**Step 7 — network (OPERATOR decides, you apply).** Static IP on the show
LAN — ask the operator which address. Report hostname + chosen IP back so
they go into `deploy/machines.yaml`.
Scripted (apply the operator's chosen address):
`deploy\server_setup.ps1 -StaticIp <ip> -PrefixLength 24 -Gateway <gw> -Dns <dns>`
/ run `deploy\setup\setup_static_ip.ps1` alone. Fails loudly if more than one
physical adapter is Up (never guesses which NIC).

**Step 8 — boot task (YOU).** Create scheduled task `BM26TitanicStack`:
trigger *at log on of `titanic`*, run with highest privileges, action:
```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\boot_server.ps1
```
NOTE: `boot_server.ps1` (the supervisor) and `deploy\machines.yaml` (the
per-machine scene manifest) now SHIP in this repo, so the boot task launches
the real stack and the boot-task step reports DONE (no more "boot_server.ps1
missing" WARN). Pick this machine's boot scene with
`deploy\set_boot.ps1 -Scene <scene>` (writes `machines.yaml` + ensures the
task). Still Phase 2: `deploy.py`, which seeds the code tree + `node_modules`;
until it lands the supervisor runs but the launcher needs the tree present to
come fully up.
Scripted: `deploy\server_setup.ps1` (boot-task step) / run
`deploy\setup\setup_boot_task.ps1` alone. SKIPs if the task already matches,
FAILs loudly if a task of the same name has a different action.

**Step 9 — the plug test (OPERATOR, with you watching logs).** Once the
stack tooling is deployed: pull the wall plug, restore power, and confirm
the machine reaches "stack up, lights animating" with zero touches, twice.
Until then, verify the chain as far as it goes: power-on → autologon →
task fired.

## Report back

Scripted: `deploy\verify_server.ps1` (read-only) prints most of this section.

When done (or blocked), report to the operator:

- hostname, chosen static IP, MACs seen on COM ports (report, don't touch)
- `node --version`, `git --version`, OpenSSH service state
- checklist status per step: done / blocked-on-operator / failed (+ exact error)
- reboot test result: did it reach the desktop unattended, did the task fire
