# BM26 Titanic Operations Handbook

Quick reference for CaptainPad iPad builds, the local stack, and show-server deployment. Run commands from the repository root unless noted.

## Rules

- Let `launcher.js` own the stack. Do not hand-start components, broadly kill Node, or force-claim its lock.
- Production deploy/restart/stop/start affects live output and requires operator approval.
- Machine facts and auth come only from `$BM26_MACHINES` and `$BM26_SECRETS`. Never record their paths or contents.
- Never record Apple credentials, tokens, signing data, device UDIDs, usernames, private addresses, or private source names.

## 1. CaptainPad iPad build with EAS

The `preview` profile is an internally distributed iOS Release build: bundled, offline, and Metro-free. EAS performs prebuild, CocoaPods, Xcode compilation, and signing on macOS; do not generate or commit `CaptainPad/ios`.

### Check and build from Windows

```powershell
Set-Location .\CaptainPad
npm run check
npm test
npx expo export:embed --eager --platform ios --dev false --reset-cache
npx eas-cli@latest whoami

$env:EAS_NO_VCS = "1"
$env:EAS_PROJECT_ROOT = (Get-Location).Path
npx eas-cli@latest build --platform ios --profile preview --clear-cache --non-interactive

Remove-Item Env:EAS_NO_VCS -ErrorAction SilentlyContinue
Remove-Item Env:EAS_PROJECT_ROOT -ErrorAction SilentlyContinue
```

The two EAS variables are required in this Windows checkout so only `CaptainPad` is archived. Authenticate interactively or with a session-only token; never put credentials in files or shared history. For a new iPad, omit `--non-interactive` and follow EAS's device/provisioning prompts.

### Install

Open the successful build-page URL on the registered iPad and tap **Install**. Find it again with:

```powershell
npx eas-cli@latest build:list --platform ios --build-profile preview --status finished --limit 1
```

If requested by iOS, enable **Settings > Privacy & Security > Developer Mode**. Launch CaptainPad and confirm local-network engine discovery.

## 2. Local stack

### Setup, build, and start

```powershell
node launcher.js setup
node launcher.js rebuild-pad
node launcher.js prod --scene titanic --no-launch
```

`rebuild-pad` is the only supported `CaptainPad/dist` refresh path. During `prod`, rebuild then reload the iPad; web-only CaptainPad changes need no stack restart.

Development profiles:

```powershell
node launcher.js dev --scene test_bench
node launcher.js dev-lite --scene test_bench
```

| Profile | Purpose |
|---|---|
| `prod` | Show stack, static CaptainPad, sACN priority 150 |
| `dev` | Full local sim and Expo development, priority 120 |
| `dev-lite` | Lower-GPU development, priority 120 |

Select another scene with `--scene <scene>`. List scenes with:

```powershell
Get-ChildItem .\simulation\scenes -Directory | Select-Object -ExpandProperty Name
```

### Status and stop

```powershell
node launcher.js status
node launcher.js stop
node launcher.js --help
```

`status` must show the expected scene, healthy services, and frame flow. `stop` uses graceful shutdown; if it says `BLACKOUT NOT CONFIRMED`, treat the rig as lit until verified dark by eye.

## 3. Show-server deployment

Machine keys come from the external manifest. Current operator-facing keys are `titanic-ext` and `titanic-int`; `$BM26_MACHINES` remains authoritative. Launcher profiles (`prod`, `dev`, `dev-lite`) are not machine keys.

### Preflight

```powershell
node --version
python --version
Test-Path Env:BM26_MACHINES
Test-Path Env:BM26_SECRETS
python deploy\deploy.py deploy --help
```

Both `Test-Path` checks must return `True`. Deploy then validates machine, scene, Node parity, identity, secrets, SMB, and remote readiness.

### Normal deploy

```powershell
python deploy\deploy.py deploy --machine titanic-ext --scene titanic
python deploy\deploy.py deploy --machine titanic-int --scene <scene>
```

Normal deploy previews the authoritative mirror, stops the remote stack, copies the local tree with production exclusions, applies the scene, restarts, and verifies. Included server edits/extras are overwritten or deleted.

Optional read-only preview:

```powershell
python deploy\deploy.py deploy --machine <machine> --scene <scene> --dry-run
```

### Operator-authorized fast deploy

```powershell
python deploy\deploy.py deploy --machine titanic-ext --scene titanic --force
python deploy\deploy.py deploy --machine titanic-int --scene <scene> --force
```

Production `--force` skips only the file-list preview and uses the faster mirror. Validation, safe stop, exclusions, secrets, restart, and verification remain. Use only when the local checkout is authoritative; it cannot combine with `--dry-run` or `--restart-only`.

### Lifecycle without file sync

```powershell
python deploy\deploy.py deploy --machine <machine> --restart-only
python deploy\deploy.py stop  --machine <machine>
python deploy\deploy.py start --machine <machine>
```

`--restart-only` bounces and verifies the deployed tree. `stop` parks it with lights off. `start` starts the boot task and verifies its configured scene.

### Postflight

Require: requested engine scene; all four services responsive; supervisor restart count unchanged during verification; production sACN priority 150; expected output confirmed by eye. On the show server:

```powershell
node launcher.js status
```

## Quick troubleshooting

| Symptom | Action |
|---|---|
| Huge EAS archive | Stop. From `CaptainPad`, set `EAS_NO_VCS=1` and `EAS_PROJECT_ROOT=(Get-Location).Path`. |
| iPad not provisioned | Run an interactive preview build and refresh the ad-hoc profile; never record its UDID. |
| App cannot see engine | Check same LAN, iOS Local Network permission, then `node launcher.js status`. |
| `prod` refuses | Check `$BM26_SECRETS`, dependencies, and `rebuild-pad` output. |
| Existing stack/held port | Use launcher `status`, then launcher `stop`; never broadly kill Node. |
| Unknown deploy machine | Use the exact `$BM26_MACHINES` key; never substitute an IP. |
| SSH/SMB unavailable | Check show-LAN profile and registered credentials; do not weaken ACLs. |
| Restart count changes | Treat as a crash loop; inspect named logs before redeploying. |
| `BLACKOUT NOT CONFIRMED` | Treat lights as on; verify darkness and isolate controller power before electrical work. |

Deep references: [`README.md`](README.md), [`CaptainPad/README.md`](CaptainPad/README.md), [`deploy/README.md`](deploy/README.md).
