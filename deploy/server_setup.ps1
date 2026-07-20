# server_setup.ps1 - Show-server bring-up orchestrator (docs/43).
#
# Runs the machine-preparation steps for a BM26 Titanic show server in order,
# turning the by-hand docs/43 checklist into one elevated command. Each step
# is its own script under deploy\setup\ and is independently re-runnable; this
# orchestrator invokes them, isolates per-step failures, and prints a summary
# table (DONE / SKIP / WARN / FAIL) at the end.
#
# Idempotent by design: already-configured steps report SKIP (correct
# idempotency, NOT a fallback). Any hard FAIL is loud and sets exit code 1
# (no silent fallbacks - codex P0). Password/account creation and Autologon
# are OPERATOR steps and are deliberately NOT touched here.
#
# Run from an elevated PowerShell prompt (all params optional):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\server_setup.ps1 `
#       -SshPublicKey C:\keys\laptop.pub `
#       -StaticIp 192.0.2.50 -PrefixLength 24 -Gateway 192.0.2.1 -Dns 192.0.2.1
#
# Steps that need a value you did not supply are SKIPPED (reported as SKIP):
#   - no -SshPublicKey  -> SSH key install skipped
#   - no -StaticIp      -> static IP step skipped (keep DHCP)
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [string]$SshPublicKey,
    [string]$StaticIp,
    [int]$PrefixLength = 24,
    [string]$Gateway,
    [string[]]$Dns,
    [string]$NodeVersion = '24.18.0',
    [string]$PythonVersion = '3.12',
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic'
)

$ErrorActionPreference = 'Stop'

$setupDir = Join-Path $PSScriptRoot 'setup'
$results = @()
$totalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# Human-friendly elapsed formatting for the summary table ("0.8s" / "4m 32s").
function Format-Elapsed {
    param([TimeSpan]$Elapsed)
    if ($Elapsed.TotalSeconds -lt 60) {
        return ('{0:0.0}s' -f $Elapsed.TotalSeconds)
    }
    return ('{0}m {1}s' -f [int][Math]::Floor($Elapsed.TotalMinutes), $Elapsed.Seconds)
}

function Add-Result {
    param([string]$Step, [string]$Status, [string]$Detail, [string]$Elapsed = '-')
    $script:results += [PSCustomObject]@{ Step = $Step; Status = $Status; Detail = $Detail; Elapsed = $Elapsed }
}

# Invoke a step script, capture its returned status object, and turn any
# thrown error into a FAIL row (no fallback - a failure is recorded loudly and
# the run continues so the summary is complete).
function Invoke-Step {
    param(
        [string]$Name,
        [string]$Script,
        [hashtable]$Params
    )
    $path = Join-Path $setupDir $Script
    Write-Host ''
    Write-Host ("=== $Name === [" + (Get-Date -Format 'HH:mm:ss') + "]") -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not (Test-Path $path)) {
        Write-Host "  FAIL: step script not found: $path" -ForegroundColor Red
        Add-Result -Step $Name -Status 'FAIL' -Detail "missing script $Script" -Elapsed (Format-Elapsed $sw.Elapsed)
        return
    }
    try {
        $out = & $path @Params
        $result = $out | Where-Object {
            $_ -is [System.Management.Automation.PSCustomObject] -and $_.PSObject.Properties['Status']
        } | Select-Object -Last 1
        if ($null -eq $result) {
            Add-Result -Step $Name -Status 'WARN' -Detail 'step returned no status object' -Elapsed (Format-Elapsed $sw.Elapsed)
        } else {
            Add-Result -Step $Name -Status $result.Status -Detail $result.Detail -Elapsed (Format-Elapsed $sw.Elapsed)
        }
    } catch {
        Write-Host "  FAIL: $($_.Exception.Message)" -ForegroundColor Red
        Add-Result -Step $Name -Status 'FAIL' -Detail $_.Exception.Message -Elapsed (Format-Elapsed $sw.Elapsed)
    }
}

Write-Host 'BM26 Titanic - show-server setup orchestrator' -ForegroundColor Cyan
Write-Host "Repo root: $RepoRoot" -ForegroundColor DarkGray

# --- Step: prerequisites (Node/Git/Python) -------------------------------
Invoke-Step -Name 'Prerequisites (Node/Git/Python)' -Script 'setup_prereqs.ps1' -Params @{
    NodeVersion   = $NodeVersion
    PythonVersion = $PythonVersion
    RepoRoot      = $RepoRoot
}

# --- Step: power hygiene -------------------------------------------------
Invoke-Step -Name 'Power hygiene' -Script 'setup_power.ps1' -Params @{}

# --- Step: Windows Update (notify-only) ----------------------------------
Invoke-Step -Name 'Windows Update (notify-only)' -Script 'setup_windows_update.ps1' -Params @{}

# --- Step: OpenSSH Server ------------------------------------------------
Invoke-Step -Name 'OpenSSH Server' -Script 'setup_openssh.ps1' -Params @{}

# --- Step: SSH public key (skipped if none supplied) ---------------------
if ($SshPublicKey) {
    Invoke-Step -Name 'SSH public key' -Script 'install_ssh_key.ps1' -Params @{ PublicKey = $SshPublicKey }
} else {
    Write-Host ''
    Write-Host ('=== SSH public key === [' + (Get-Date -Format 'HH:mm:ss') + ']') -ForegroundColor Cyan
    Write-Host '  SKIP: no -SshPublicKey supplied. Re-run with -SshPublicKey <key-or-.pub> to install.' -ForegroundColor Yellow
    Add-Result -Step 'SSH public key' -Status 'SKIP' -Detail 'no -SshPublicKey supplied'
}

# --- Step: SMB share -----------------------------------------------------
Invoke-Step -Name 'SMB share' -Script 'setup_smb_share.ps1' -Params @{}

# --- Step: firewall ------------------------------------------------------
Invoke-Step -Name 'Firewall rules' -Script 'setup_firewall.ps1' -Params @{}

# --- Step: network profile (Private) -------------------------------------
# Must follow the firewall step: the gateway-less show LAN comes up as an
# "Unidentified network" -> Public profile, on which the Private+Domain-scoped
# firewall rules above are inert. This sets the profile Private so they apply.
Invoke-Step -Name 'Network profile (Private)' -Script 'setup_network_profile.ps1' -Params @{}

# --- Step: boot task -----------------------------------------------------
Invoke-Step -Name 'Boot task' -Script 'setup_boot_task.ps1' -Params @{ RepoRoot = $RepoRoot }

# --- Step: static IP (skipped if none supplied) --------------------------
if ($StaticIp) {
    $netParams = @{ StaticIp = $StaticIp; PrefixLength = $PrefixLength }
    if ($Gateway) { $netParams['Gateway'] = $Gateway }
    if ($Dns)     { $netParams['Dns'] = $Dns }
    Invoke-Step -Name 'Static IP' -Script 'setup_static_ip.ps1' -Params $netParams
} else {
    Write-Host ''
    Write-Host ('=== Static IP === [' + (Get-Date -Format 'HH:mm:ss') + ']') -ForegroundColor Cyan
    Write-Host '  SKIP: no -StaticIp supplied. Leaving current addressing (DHCP) as-is.' -ForegroundColor Yellow
    Add-Result -Step 'Static IP' -Status 'SKIP' -Detail 'no -StaticIp supplied'
}

# --- Summary -------------------------------------------------------------
Write-Host ''
Write-Host '================ SETUP SUMMARY ================' -ForegroundColor Cyan
$colors = @{ DONE = 'Green'; SKIP = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }
foreach ($r in $results) {
    $c = $colors[$r.Status]
    if (-not $c) { $c = 'Gray' }
    $line = ('  {0,-6} {1,-32} {2,8}  {3}' -f $r.Status, $r.Step, $r.Elapsed, $r.Detail)
    Write-Host $line -ForegroundColor $c
}
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ('Total elapsed: ' + (Format-Elapsed $totalStopwatch.Elapsed)) -ForegroundColor Cyan

$failed = @($results | Where-Object { $_.Status -eq 'FAIL' })
$warned = @($results | Where-Object { $_.Status -eq 'WARN' })

Write-Host ''
if ($failed.Count -gt 0) {
    Write-Host '##############################################' -ForegroundColor Red
    Write-Host "#  SETUP FAILED - $($failed.Count) step(s) FAILED. Fix and re-run." -ForegroundColor Red
    Write-Host '##############################################' -ForegroundColor Red
    Write-Host ''
    Write-Host 'Next: read each FAIL detail above, resolve the exact condition, re-run this script.'
    exit 1
}

if ($warned.Count -gt 0) {
    Write-Host "Setup completed with $($warned.Count) WARN(s) - review them above." -ForegroundColor Yellow
} else {
    Write-Host 'Setup completed - all steps DONE/SKIP.' -ForegroundColor Green
}
Write-Host ''
Write-Host 'Operator follow-ups (not scripted - see docs/43):'
Write-Host '  - BIOS: Restore on AC Power Loss -> Power On (always on).'
Write-Host '  - Account: deploy\create_titanic_user.ps1, then Sysinternals Autologon for titanic.'
Write-Host '  - Verify anytime (read-only): deploy\verify_server.ps1'
exit 0
