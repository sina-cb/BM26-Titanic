# setup_power.ps1 - Show-server bring-up step 3 (docs/43): power hygiene.
#
# A show server must never sleep, hibernate, or Fast-Start: on the playa,
# powered means running, and a box that dozed off after a brownout is a dark
# ship. Applies:
#   powercfg /change standby-timeout-ac 0   (never sleep on AC)
#   powercfg /change hibernate-timeout-ac 0 (never hibernate on AC)
#   powercfg /h off                          (disable hibernate + Fast Startup)
#
# Idempotent: these settings are convergent - re-running just re-asserts the
# same state, so this step always reports DONE.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_power.ps1
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

function Invoke-Powercfg {
    param([string[]]$PowercfgArgs)
    Write-Host ("  powercfg " + ($PowercfgArgs -join ' ')) -ForegroundColor DarkGray
    & powercfg @PowercfgArgs
    if ($LASTEXITCODE -ne 0) {
        throw ("powercfg " + ($PowercfgArgs -join ' ') + " failed (exit $LASTEXITCODE).")
    }
}

Write-Host 'Applying power hygiene (no sleep / no hibernate / no Fast Startup):' -ForegroundColor Cyan

Invoke-Powercfg -PowercfgArgs @('/change', 'standby-timeout-ac', '0')
Invoke-Powercfg -PowercfgArgs @('/change', 'hibernate-timeout-ac', '0')
Invoke-Powercfg -PowercfgArgs @('/h', 'off')

Write-Host '  DONE: standby off, hibernate off, hibernate file disabled.' -ForegroundColor Green

Write-StepResult ([PSCustomObject]@{
    Step   = 'Power hygiene'
    Status = 'DONE'
    Detail = 'standby-timeout-ac=0, hibernate-timeout-ac=0, hibernate off'
})
