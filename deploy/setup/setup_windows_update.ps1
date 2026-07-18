# setup_windows_update.ps1 - Show-server bring-up step 3 (docs/43).
#
# Windows Update must never auto-reboot a show server mid-show. This sets the
# WU Auto Update policy to notify-only and blocks auto-reboot while a user is
# logged on, via:
#   HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU
#     AUOptions = 2                       (notify before download)
#     NoAutoRebootWithLoggedOnUsers = 1   (never reboot out from under logon)
#
# Idempotent: re-running re-asserts the same two values. Reports the previous
# value vs the new value for each key.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_windows_update.ps1
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

$auKey = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'

function Set-PolicyDword {
    param([string]$Path, [string]$Name, [int]$Value)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
    $prev = $null
    $existing = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
    if ($null -ne $existing) { $prev = $existing.$Name }
    New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
    if ($null -eq $prev) { $prevText = '(unset)' } else { $prevText = "$prev" }
    Write-Host "  $Name : $prevText -> $Value" -ForegroundColor Green
    return $prevText
}

Write-Host 'Setting Windows Update to notify-only (no auto-reboot):' -ForegroundColor Cyan

$prevAu = Set-PolicyDword -Path $auKey -Name 'AUOptions' -Value 2
$prevReboot = Set-PolicyDword -Path $auKey -Name 'NoAutoRebootWithLoggedOnUsers' -Value 1

Write-StepResult ([PSCustomObject]@{
    Step   = 'Windows Update (notify-only)'
    Status = 'DONE'
    Detail = "AUOptions $prevAu->2, NoAutoRebootWithLoggedOnUsers $prevReboot->1"
})
