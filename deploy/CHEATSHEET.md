# 🖥️ Show-Server Cheatsheet — Windows 11

Boot chain: **BIOS power-on → autologon `titanic` → task `BM26TitanicStack` →
`boot_server.ps1` → `node launcher.js <profile> --scene <scene> --no-launch`**.

Commands run from any directory; elevated ones self-elevate (UAC). In an
already-elevated window (prompt at `C:\Windows\system32`), drop the
`Start-Process … -ArgumentList` wrapper and run the inner `powershell … -File …`
directly. Everything is idempotent — re-run freely. Full detail:
[`deploy/README.md`](README.md).

## Bring-up

**0 · Clone** (prod path — deploy mirrors over it, never keep edits here):

```powershell
git clone https://github.com/sina-cb/BM26-Titanic.git C:\titanic\BM26-Titanic
```

**1 · BIOS**: *Restore on AC Power Loss* → **Power On**.

**2 · Config pass** (runtimes machine-scope, SSH/SMB/firewall/boot task):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\server_setup.ps1'
```

Optional flags: `-SshPublicKey <pub>` · `-StaticIp <ip> -PrefixLength 24 -Gateway <gw> -Dns <dns>` · `-Scene <scene>` (folds in step 4).
The SMB grant + boot task `WARN (deferred)` until the `titanic` user exists —
after step 3, re-run this pass to complete them (idempotent, seconds).

If the show LAN shows category **Public** afterwards, the firewall rules are
inert — make it Private (durable for identified networks; elevated):

```powershell
Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private
```

**3 · Create the `titanic` user** (prompts for password twice):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\create_titanic_user.ps1'
```

Then download the Autologon tool (no elevation; `SKIP` if already present):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\setup\get_autologon.ps1
```

Run `deploy\setup\tools\autologon\Autologon64.exe` → `titanic` /
`<hostname>` / password → **Enable** (manual on purpose — scripts never touch
the password). The account now exists but has no profile yet — **sign in as
`titanic` once to create it**, then reboot to test autologon. Now re-run
step 2. 🚫 Never registry autologon, never a blank password.

**4 · Boot scene** (takes effect next `titanic` logon):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\set_boot.ps1 -Scene test_bench'
```

Bootable scenes need `simulation\scenes\<s>\scene_config.yaml` **and**
`marsin_engine\models\<s>.js` — e.g. `test_bench`, `titanic`, `studio`.

**5 · Verify + reboot test**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\verify_server.ps1
```

Reboot → no login prompt → `titanic` desktop → stack up. Check a fresh
`C:\titanic\logs\boot_server_*.log` exists, and from the laptop:
`ssh -i ~\.ssh\id_ed25519_titanic titanic@<server-ip>`.

**6 · Plug test** — pull the wall plug, watch it come back. Twice.

## Laptop link-up (SSH deploy key)

On the **laptop** (design machine), generate the deploy keypair once:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519_titanic
```

Copy the **`.pub`** file (never the private key) to the server — convention:
`C:\titanic\keys\` (outside the repo tree, which deploys mirror over). Then on
the **server** (or pass `-SshPublicKey` to the step-2 config pass):

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\setup\install_ssh_key.ps1 -PublicKey C:\titanic\keys\id_ed25519_titanic.pub'
```

`-PublicKey` takes a `.pub` path or the literal `ssh-ed25519 AAAA…` line; it
refuses private keys and `SKIP`s duplicates. The key lands in
`C:\ProgramData\ssh\administrators_authorized_keys` (ACL-locked).

Test from the laptop: `ssh -i ~\.ssh\id_ed25519_titanic titanic@<server-ip>`.
If refused, the server's network profile is likely Public — see Troubleshooting.

Remote ops from the laptop (SSH admin sessions are elevated — no UAC):

```powershell
ssh -i ~\.ssh\id_ed25519_titanic titanic@<ip> "powershell -NoProfile -ExecutionPolicy Bypass -File C:\titanic\BM26-Titanic\deploy\set_boot.ps1 -Scene <scene>"
ssh -i ~\.ssh\id_ed25519_titanic titanic@<ip> "shutdown /r /t 0"   # apply (next logon)
```

Fleet-scale scene/config management goes through the laptop's `deploy.py`
(ships the private `machines.yaml`) — SSH is for one-off flips.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Boot task dies instantly (`LastTaskResult=1`) | Node was per-user → re-run step 2 (installs machine-scope) |
| SSH/SMB refused though `sshd` runs | LAN came up Public → `Set-NetConnectionProfile -InterfaceAlias Ethernet -NetworkCategory Private`; permanent: `secpol.msc` → Unidentified Networks → Private (the step-2 WARN here is expected) |
| winget exit `-1978335226` | User-scoped package collides → `winget uninstall <id>`, re-run step 2 |
| Stack dies ~72 h in | Stale task limit → re-run step 2 or 4 (repairs to unlimited) |
| Registry `DefaultPassword` populated | Forbidden plaintext autologon — remove it, redo with Autologon64 |

## Dev quick-ref (scratch clone)

```powershell
git config core.hooksPath .githooks      # once per clone
node launcher.js setup                   # install all deps
node launcher.js dev --scene test_bench  # sim + engine + CaptainPad
node launcher.js status                  # / stop
```
