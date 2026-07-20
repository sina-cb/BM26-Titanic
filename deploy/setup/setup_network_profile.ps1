# setup_network_profile.ps1 - Show-server bring-up step 6b (docs/43): network
# profile category.
#
# The show LAN has NO gateway, so Windows cannot identify it and classifies the
# Ethernet as "Unidentified network", defaulting it to the PUBLIC firewall
# profile. Every rule setup_firewall.ps1 creates (SSH 22, SMB 445, stack ports,
# sACN) is scoped Private+Domain, so on a Public interface inbound SSH/SMB is
# silently dropped - the deploy path looks dead even though sshd is running and
# the rules exist. This step sets the current connection profile to Private so
# those rules take effect immediately.
#
# What it touches (and, deliberately, what it does NOT):
#   - Only profiles on a PHYSICAL adapter (Get-NetAdapter -Physical) whose Name
#     is exactly 'Unidentified network' or 'Network' are set to Private. A named
#     Wi-Fi SSID (a real, identified, internet-connected network) is NEVER
#     touched - forcing a named network Private is not this step's job.
#   - Idempotent: a profile already Private is a SKIP, not an error.
#
# DURABILITY (the NLM policy) - see the TODO block below. Setting the current
# profile fixes access now, but Windows can mint a FRESH "Unidentified network"
# profile on the next reconnect/reboot and default it back to Public. The
# durable fix is the Network List Manager policy "Unidentified Networks ->
# Private" (secpol.msc > Network List Manager Policies > Unidentified Networks >
# Location type = Private). That policy write is a documented TODO here (it
# could not be verified against local ground truth without elevation - details
# below), so this step currently reports WARN to flag that the reboot-durable
# guarantee is not yet in place.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_network_profile.ps1
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

# Only these profile names are candidates. A named Wi-Fi SSID never matches, so
# a real internet-connected network is left exactly as Windows classified it.
$targetNames = @('Unidentified network', 'Network')

Write-Host 'Network profile category (unidentified show LAN -> Private):' -ForegroundColor Cyan

# --- (b) Set the current unidentified profile(s) on physical adapters Private -
$physIdx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ifIndex)
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)

$targets = @($profiles | Where-Object {
    ($physIdx -contains $_.InterfaceIndex) -and ($targetNames -contains $_.Name)
})

$changed = 0
$alreadyPrivate = 0
$changedList = @()
foreach ($p in $targets) {
    $alias = $p.InterfaceAlias
    if ($p.NetworkCategory -eq 'Private') {
        Write-Host "  SKIP: '$($p.Name)' on $alias already Private." -ForegroundColor Green
        $alreadyPrivate++
    } else {
        $prevCat = $p.NetworkCategory
        Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
        Write-Host "  DONE: '$($p.Name)' on ${alias}: $prevCat -> Private." -ForegroundColor Green
        $changed++
        $changedList += "$alias '$($p.Name)' $prevCat->Private"
    }
}

if ($targets.Count -eq 0) {
    Write-Host '  SKIP: no unidentified/Network profile on a physical adapter right now.' -ForegroundColor Green
}

# Transparency: show what was deliberately left alone (named Wi-Fi SSIDs,
# virtual adapters, etc.) so the operator can see nothing else was retouched.
$untouched = @($profiles | Where-Object {
    -not (($physIdx -contains $_.InterfaceIndex) -and ($targetNames -contains $_.Name))
})
foreach ($u in $untouched) {
    Write-Host "  (left untouched: '$($u.Name)' on $($u.InterfaceAlias), category $($u.NetworkCategory))" -ForegroundColor DarkGray
}

# --- (a) NLM policy: Unidentified Networks -> Private -------------------------
# TODO (not applied): make Unidentified networks default to Private durably via
# the Network List Manager policy, so a freshly-minted Unidentified profile
# after a reconnect/reboot comes up Private instead of reverting to Public.
#
# MECHANISM (believed, could NOT be verified against local ground truth - see
# WHY below, so it is intentionally NOT written here per the no-fallback ethos:
# a wrong registry key written silently is worse than an honest gap):
#   secpol.msc > Security Settings > Network List Manager Policies >
#     "Unidentified Networks" > Location type = Private
#   is understood to write, under
#     HKLM\SOFTWARE\Policies\Microsoft\Windows NT\CurrentVersion\NetworkList\
#       Signatures\010103000F0000F0010000000F0000F0<...64-hex-char signature...>
#   a REG_DWORD value:
#     Category = 1   (0 = Public, 1 = Private)
#   The long signature is a fixed, well-known GUID Windows uses to represent the
#   "Unidentified Networks" pseudo-network in policy. A companion DWORD controls
#   whether a standard user may change the location.
#
# WHY IT IS A TODO AND NOT A WRITE (local ground truth gathered read-only on
# this machine, Titanic-Int, 2026-07):
#   - The policy path HKLM\SOFTWARE\Policies\Microsoft\Windows NT\CurrentVersion\
#     NetworkList is ABSENT (no policy currently set), so there is no local,
#     already-correct example key to copy the exact signature string from.
#   - The live tree HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList
#     (Signatures\Unmanaged, Profiles, ...) is ACL-locked to SYSTEM: a
#     non-elevated admin read returns "Requested registry access is not allowed",
#     so the per-network Category values could not be inspected read-only to
#     cross-check the signature either.
#   Writing the 64-hex-char signature from memory would be a guessed registry
#   write: if a single character is wrong the key is created but has NO effect,
#   and that failure is indistinguishable from success (silent) - exactly the
#   fallback the codex forbids.
#
# TO FINISH THIS (one-time, elevated, on the target box):
#   1. secpol.msc > Network List Manager Policies > Unidentified Networks >
#      set Location type = Private, Apply.
#   2. Read back the exact key + Category value it created:
#        reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\CurrentVersion\NetworkList\Signatures\010103000F0000F0010000000F0000F0..." /s
#      (or dump the Signatures subkey to capture the real signature string).
#   3. Replace this TODO with an idempotent Set-PolicyDword-style write of that
#      verified key + Category=1, and flip $policyApplied below to reflect it.
$policyApplied = $false
Write-Host '  TODO: NLM "Unidentified Networks -> Private" policy NOT applied (unverified signature - see header).' -ForegroundColor Yellow
Write-Host '        Current-profile fix above unblocks the Private-scoped firewall rules NOW, but is not reboot-durable yet.' -ForegroundColor Yellow

# --- (c) Report --------------------------------------------------------------
$detailBits = @()
if ($changed -gt 0) { $detailBits += ($changedList -join '; ') }
if ($alreadyPrivate -gt 0) { $detailBits += "$alreadyPrivate already Private" }
if ($targets.Count -eq 0) { $detailBits += 'no unidentified/Network profile on a physical adapter' }
if ($policyApplied) {
    $detailBits += 'NLM Unidentified->Private policy applied (reboot-durable)'
    $status = 'DONE'
} else {
    $detailBits += 'NLM Unidentified->Private policy: TODO (not applied) - not reboot-durable yet'
    # WARN, not FAIL: the current-profile fix landed and unblocks the
    # Private-scoped firewall rules now; the durable policy piece is pending.
    $status = 'WARN'
}

Write-StepResult ([PSCustomObject]@{
    Step   = 'Network profile (Private)'
    Status = $status
    Detail = ($detailBits -join '; ')
})
