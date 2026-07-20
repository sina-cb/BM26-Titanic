# setup_openssh.ps1 - Show-server bring-up step 5 (docs/43): OpenSSH Server.
#
# Enables the OpenSSH Server optional feature so the laptop can drive remote
# stop/start over SSH (the deploy control channel):
#   - Add-WindowsCapability OpenSSH.Server (SKIP if already Installed)
#   - Set-Service sshd -StartupType Automatic
#   - Start-Service sshd
# The ssh-agent service is intentionally left alone (key-based auth uses the
# administrators_authorized_keys file, not an agent).
#
# Idempotent: an already-installed, already-running sshd reports SKIP for the
# capability and re-asserts the service state.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_openssh.ps1
# Or via the orchestrator: deploy\server_setup.ps1
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'

# Final status: under the orchestrator (server_setup.ps1 in the call stack)
# emit the status object so it is captured for the summary table; run
# standalone, print a conclusive line instead of dumping a raw object.
function Write-StepResult {
    param([PSCustomObject]$Result)
    if ((Get-PSCallStack).Command -contains 'server_setup.ps1') {
        return $Result
    }
    $colors = @{ DONE = 'Green'; SKIP = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }
    $c = $colors[[string]$Result.Status]
    if (-not $c) { $c = 'Gray' }
    Write-Host ''
    Write-Host ('==== ' + $Result.Step + ': ' + $Result.Status + ' ====') -ForegroundColor $c
    if ($Result.Detail) { Write-Host ('  ' + $Result.Detail) -ForegroundColor $c }
}

Write-Host 'OpenSSH Server:' -ForegroundColor Cyan

# The wildcard name can match more than one capability row (e.g. multiple
# OpenSSH.Server versions offered by the image); take the first so the state
# checks and Add-WindowsCapability below operate on a single object.
$cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' | Select-Object -First 1
if (-not $cap) {
    throw 'OpenSSH.Server capability is not offered by this Windows image - cannot enable it (no fallback, codex P0).'
}

$capState = 'installed'
if ($cap.State -eq 'Installed') {
    Write-Host "  SKIP: $($cap.Name) already installed." -ForegroundColor Green
    $capState = 'already installed'
} else {
    Write-Host "  install: adding $($cap.Name)..." -ForegroundColor Yellow
    Add-WindowsCapability -Online -Name $cap.Name | Out-Null
    Write-Host '  DONE: OpenSSH.Server capability added.' -ForegroundColor Green
    $capState = 'installed now'
}

# Service to Automatic + started (re-asserted every run).
$svc = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not $svc) {
    throw 'sshd service not found after installing OpenSSH.Server - bring-up cannot continue (no fallback).'
}

Set-Service -Name sshd -StartupType Automatic
Write-Host '  sshd StartupType = Automatic' -ForegroundColor Green

$svc = Get-Service -Name sshd
if ($svc.Status -ne 'Running') {
    Start-Service -Name sshd
    Write-Host '  sshd started.' -ForegroundColor Green
    $runState = 'started'
} else {
    Write-Host '  SKIP: sshd already running.' -ForegroundColor Green
    $runState = 'already running'
}

if ($capState -eq 'already installed' -and $runState -eq 'already running') {
    $status = 'SKIP'
} else {
    $status = 'DONE'
}

Write-StepResult ([PSCustomObject]@{
    Step   = 'OpenSSH Server'
    Status = $status
    Detail = "capability $capState; service Automatic, $runState"
})
