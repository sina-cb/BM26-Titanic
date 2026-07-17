# create_titanic_user.ps1 — Show-server bring-up step 2 (docs/43).
#
# Creates the local `titanic` operator account on a Windows show server:
#   - prompts for the password interactively (typed at the console, twice;
#     never passed as an argument, never written to disk or logs)
#   - local admin (Administrators group, by SID — locale-proof)
#   - password + account never expire (unattended show machine)
#
# Run from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\create_titanic_user.ps1
#
# After it succeeds (operator steps, in order):
#   1. Log in as `titanic` once so the profile is created.
#   2. Run Sysinternals Autologon and enable it for `titanic` (stores the
#      password as an LSA secret — do NOT set autologon via raw registry,
#      that stores it in plaintext).
#   3. Continue the docs/43 checklist (power hygiene, Node, OpenSSH, ...).

#Requires -RunAsAdministrator

param(
    [string]$UserName = 'titanic'
)

$ErrorActionPreference = 'Stop'
$ADMINISTRATORS_SID = 'S-1-5-32-544'

# No fallback behaviors (codex P0): an existing account is a hard stop, not
# a silent reuse or password reset. Removing/resetting is an operator call.
if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
    Write-Error ("User '$UserName' already exists on this machine. " +
        "If this is a stale/failed bring-up, remove it first " +
        "(Remove-LocalUser -Name '$UserName') and rerun; if it is already " +
        "set up, there is nothing to do.")
}

Write-Host "Creating local show-operator account '$UserName'." -ForegroundColor Cyan
Write-Host 'Enter its password (input is hidden):'

$password = Read-Host -AsSecureString -Prompt 'Password'
$confirm  = Read-Host -AsSecureString -Prompt 'Confirm password'

# Compare the two entries. Plaintext exists only in these two locals for the
# duration of the comparison; both are cleared immediately after.
$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
    $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr1)
    $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr2)
    $match = ($plain1 -ceq $plain2)
    $empty = [string]::IsNullOrEmpty($plain1)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
    $plain1 = $null
    $plain2 = $null
}
if (-not $match) { Write-Error 'Passwords do not match — nothing was created. Rerun the script.' }
if ($empty)      { Write-Error 'Empty password refused — nothing was created. Rerun the script.' }

New-LocalUser -Name $UserName `
    -Password $password `
    -FullName 'BM26 Titanic show operator' `
    -Description 'Unattended show-server account (docs/43_show_server_deployment.md)' `
    -PasswordNeverExpires -AccountNeverExpires | Out-Null

$adminGroup = Get-LocalGroup -SID $ADMINISTRATORS_SID
Add-LocalGroupMember -Group $adminGroup -Member $UserName

Write-Host ''
Write-Host "OK: '$UserName' created — local admin, password/account never expire." -ForegroundColor Green
Write-Host ''
Write-Host 'Next (operator, in order):'
Write-Host "  1. Log in as '$UserName' once (creates the profile)."
Write-Host "  2. Sysinternals Autologon -> enable for '$UserName'."
Write-Host '  3. Continue the docs/43 bring-up checklist (steps 3+).'
