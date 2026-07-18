# setup_firewall.ps1 - Show-server bring-up step 6 (docs/43): firewall.
#
# Opens the inbound ports the show stack + deploy path need, scoped to the
# Private and Domain profiles (the show LAN is a private network - never open
# these on Public). Rules are named with the 'BM26 Titanic - ' prefix so they
# are obvious in wf.msc and easy to audit/remove.
#
#   TCP 6966-6972  stack (CaptainPad, engine, sim http/save/sACN bridges)
#   UDP 5568       sACN (E1.31) multicast
#   TCP 22         SSH  (deploy control channel)
#   TCP 445        SMB  (robocopy file sync)
#
# Idempotent: keyed by rule name - an existing rule is a SKIP, not an error.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_firewall.ps1
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

$prefix = 'BM26 Titanic - '
$profiles = @('Private', 'Domain')

# name-suffix, protocol, port spec
$rules = @(
    @{ Name = 'stack TCP 6966-6972'; Protocol = 'TCP'; Port = '6966-6972' },
    @{ Name = 'sACN UDP 5568';        Protocol = 'UDP'; Port = '5568' },
    @{ Name = 'SSH TCP 22';           Protocol = 'TCP'; Port = '22' },
    @{ Name = 'SMB TCP 445';          Protocol = 'TCP'; Port = '445' }
)

Write-Host 'Firewall inbound allow rules (Private + Domain):' -ForegroundColor Cyan

$created = 0
$skipped = 0
foreach ($rule in $rules) {
    $displayName = $prefix + $rule.Name
    $existing = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  SKIP: '$displayName' already exists." -ForegroundColor Green
        $skipped++
    } else {
        New-NetFirewallRule -DisplayName $displayName `
            -Direction Inbound -Action Allow `
            -Protocol $rule.Protocol -LocalPort $rule.Port `
            -Profile ($profiles -join ',') `
            -Description 'BM26 Titanic show-server bring-up (docs/43).' | Out-Null
        Write-Host "  DONE: created '$displayName' ($($rule.Protocol) $($rule.Port))." -ForegroundColor Green
        $created++
    }
}

if ($created -eq 0) { $status = 'SKIP' } else { $status = 'DONE' }

Write-StepResult ([PSCustomObject]@{
    Step   = 'Firewall rules'
    Status = $status
    Detail = "$created created, $skipped already present (Private+Domain)"
})
