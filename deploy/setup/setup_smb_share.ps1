# setup_smb_share.ps1 - Show-server bring-up step 5 (docs/43): SMB share.
#
# Shares C:\titanic as SMB share 'titanic' with Full access for the local
# `titanic` user, so the laptop's robocopy deploy can write the tree over the
# LAN.
#
# Idempotency / no-fallback rules (codex P0):
#   - share exists rooted at C:\titanic  -> SKIP (re-assert the grant);
#   - share exists rooted ELSEWHERE      -> hard FAIL (never silently repoint);
#   - local user `titanic` not created yet -> WARN and skip the grant (account
#     creation is an operator step); re-run this script after the account
#     exists.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_smb_share.ps1
# Or via the orchestrator: deploy\server_setup.ps1
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [string]$SharePath = 'C:\titanic',
    [string]$ShareName = 'titanic',
    [string]$GrantUser = 'titanic'
)

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

Write-Host "SMB share '$ShareName' -> $SharePath :" -ForegroundColor Cyan

if (-not (Test-Path $SharePath)) {
    throw "Share source path '$SharePath' does not exist - refusing to share a missing directory (no fallback)."
}

$userExists = [bool](Get-LocalUser -Name $GrantUser -ErrorAction SilentlyContinue)

# Resolve the local Administrators group by its well-known SID (S-1-5-32-544)
# so the name is locale-proof (localized Windows names the group differently).
# Used for the deferred-create grant below instead of New-SmbShare's default
# of Everyone:Read, which would leave the whole code tree LAN-readable.
$adminsAccount = (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    ).Translate([System.Security.Principal.NTAccount]).Value

$existingShare = Get-SmbShare -Name $ShareName -ErrorAction SilentlyContinue
if ($existingShare) {
    $existingPath = $existingShare.Path.TrimEnd('\')
    $wantPath = $SharePath.TrimEnd('\')
    if ($existingPath -ne $wantPath) {
        throw ("SMB share '$ShareName' already exists but points at '$existingPath', " +
            "not '$wantPath'. Refusing to repoint it - resolve manually (no fallback, codex P0).")
    }
    Write-Host "  SKIP: share '$ShareName' already exists at $existingPath." -ForegroundColor Green
    $shareStatus = 'SKIP'
} else {
    if ($userExists) {
        New-SmbShare -Name $ShareName -Path $SharePath -FullAccess $GrantUser | Out-Null
        Write-Host "  DONE: created share '$ShareName' with Full access for '$GrantUser'." -ForegroundColor Green
    } else {
        # Create the share with an EXPLICIT Full-access grant to Administrators
        # (not New-SmbShare's Everyone:Read default, which would expose the code
        # tree to the whole LAN). The per-user titanic grant is added once the
        # account exists (WARN below).
        New-SmbShare -Name $ShareName -Path $SharePath -FullAccess $adminsAccount | Out-Null
        Write-Host "  DONE: created share '$ShareName' (Administrators full; titanic grant deferred - user missing)." -ForegroundColor Yellow
    }
    $shareStatus = 'DONE'
}

# Heal any Everyone:Read entry (New-SmbShare's historical default, or a share
# created by an older revision of this script). Runs for both the exists->SKIP
# path and a fresh create so one elevated re-run closes the LAN-readable hole.
$everyoneRevoked = $false
$everyoneAce = Get-SmbShareAccess -Name $ShareName -ErrorAction SilentlyContinue |
    Where-Object { $_.AccountName -match '(^|\\)Everyone$' }
if ($everyoneAce) {
    Revoke-SmbShareAccess -Name $ShareName -AccountName 'Everyone' -Force | Out-Null
    Write-Host "  revoked Everyone:Read from share '$ShareName'." -ForegroundColor Green
    $everyoneRevoked = $true
}
$revokeNote = ''
if ($everyoneRevoked) { $revokeNote = '; revoked Everyone:Read' }

# Grant access to the titanic user (idempotent), or WARN if not created yet.
if ($userExists) {
    Grant-SmbShareAccess -Name $ShareName -AccountName $GrantUser -AccessRight Full -Force | Out-Null
    Write-Host "  Full access granted to '$GrantUser'." -ForegroundColor Green
    Write-StepResult ([PSCustomObject]@{
        Step   = 'SMB share'
        Status = $shareStatus
        Detail = "share '$ShareName' -> $SharePath, Full access for '$GrantUser'$revokeNote"
    })
} else {
    Write-Host ("  WARN: local user '$GrantUser' does not exist yet - access grant skipped. " +
        "Create the account (deploy\create_titanic_user.ps1), then re-run this script.") -ForegroundColor Yellow
    Write-StepResult ([PSCustomObject]@{
        Step   = 'SMB share'
        Status = 'WARN'
        Detail = "share '$ShareName' -> $SharePath created; grant deferred (user '$GrantUser' missing)$revokeNote - re-run after account creation"
    })
}
