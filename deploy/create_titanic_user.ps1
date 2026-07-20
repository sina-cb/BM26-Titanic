# create_titanic_user.ps1 - Show-server bring-up step 2 (docs/43).
#
# Creates the local `titanic` operator account on a Windows show server:
#   - prompts for the password interactively (typed at the console, twice;
#     never passed as an argument, never written to disk or logs)
#   - local admin (Administrators group, by SID - locale-proof)
#   - password + account never expire (unattended show machine)
#
# Focused on account creation only. The user-dependent config (SMB share grant,
# boot task) is completed by the next server_setup.ps1 pass - run that AFTER
# this, once the account exists, and both finish in that single idempotent pass.
#
# This script NEVER handles passwords beyond the interactive create prompt. When
# it succeeds it prints a bold banner with the exact Autologon command + fields;
# enabling Autologon is the operator's step - we do not touch it ourselves.
#
# Run from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\create_titanic_user.ps1
#
# After it succeeds, follow the printed Autologon banner:
#   1. Run Sysinternals Autologon and enable it for `titanic` (stores the
#      password as an LSA secret - NOT the plaintext registry key). The tool
#      is downloaded on demand by this script (setup\get_autologon.ps1) into a
#      gitignored local dir - the Sysinternals license forbids committing it to
#      this public repo.
#   2. Log in as `titanic` once, then reboot to test.
#   3. Config pass: deploy\server_setup.ps1 (completes the SMB grant + boot task).
#   4. Set the boot scene: deploy\set_boot.ps1 -Scene <scene>.

#Requires -RunAsAdministrator

param(
    [string]$UserName = 'titanic'
)

$ErrorActionPreference = 'Stop'
$ADMINISTRATORS_SID = 'S-1-5-32-544'
$MANUAL_AUTOLOGON_URL = 'https://learn.microsoft.com/sysinternals/downloads/autologon'

# No fallback behaviors (codex P0): an existing account is a hard stop, not
# a silent reuse or password reset. Removing/resetting is an operator call.
if (Get-LocalUser -Name $UserName -ErrorAction SilentlyContinue) {
    Write-Error ("User '$UserName' already exists on this machine. " +
        "If this is a stale/failed bring-up, remove it first " +
        "(Remove-LocalUser -Name '$UserName') and rerun; if it is already " +
        "set up, there is nothing to do. To finish config for an existing " +
        "user, run deploy\setup\setup_smb_share.ps1 and " +
        "deploy\setup\setup_boot_task.ps1 individually, or re-run " +
        "deploy\server_setup.ps1 (idempotent).")
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
if (-not $match) { Write-Error 'Passwords do not match - nothing was created. Rerun the script.' }
if ($empty)      { Write-Error 'Empty password refused - nothing was created. Rerun the script.' }

New-LocalUser -Name $UserName `
    -Password $password `
    -FullName 'BM26 Titanic show operator' `
    -Description 'Unattended show-server account (docs/43)' `
    -PasswordNeverExpires -AccountNeverExpires | Out-Null

$adminGroup = Get-LocalGroup -SID $ADMINISTRATORS_SID
Add-LocalGroupMember -Group $adminGroup -Member $UserName

Write-Host ''
Write-Host "OK: '$UserName' created - local admin, password/account never expire." -ForegroundColor Green

# --- Bold Autologon banner (operator step; this script never touches the ----
# password beyond the create prompt above). Domain is this machine's hostname.
$domain = $env:COMPUTERNAME
$autologonExe = Join-Path $PSScriptRoot 'setup\tools\autologon\Autologon64.exe'

# Ensure the Autologon tool is present before pointing the operator at it. It
# is deliberately NOT committed (Sysinternals license + public repo), so fetch
# it on demand. The account already exists at this point, so a failed download
# (e.g. offline) must NOT abort the script - it downgrades the banner to a loud
# WARN with the manual URL instead.
$autologonReady = $true
$getAutologon = Join-Path $PSScriptRoot 'setup\get_autologon.ps1'
if (-not (Test-Path -LiteralPath $autologonExe)) {
    try {
        & $getAutologon
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $autologonExe)) {
            $autologonReady = $false
        }
    } catch {
        $autologonReady = $false
        Write-Host ("  (Autologon download failed: " + $_.Exception.Message + ")") -ForegroundColor DarkYellow
    }
}

$bar = ('=' * 70)
Write-Host ''
Write-Host $bar -ForegroundColor Black -BackgroundColor Yellow
Write-Host '   ACTION REQUIRED - ENABLE AUTOLOGON FOR titanic (operator step)      ' -ForegroundColor Black -BackgroundColor Yellow
Write-Host $bar -ForegroundColor Black -BackgroundColor Yellow
Write-Host ''
if (-not $autologonReady) {
    Write-Host '  WARN: could not download Sysinternals Autologon (no internet?).' -ForegroundColor Black -BackgroundColor Red
    Write-Host '        Get it manually, then place Autologon64.exe at the path below:' -ForegroundColor Red
    Write-Host "          $MANUAL_AUTOLOGON_URL" -ForegroundColor White
    Write-Host "          expected path: $autologonExe" -ForegroundColor White
    Write-Host '        (or re-run: deploy\setup\get_autologon.ps1 once online).' -ForegroundColor Red
    Write-Host ''
}
Write-Host '  1. Run this tool (right-click -> Run as administrator; it also' -ForegroundColor Yellow
Write-Host '     self-elevates via UAC if you just double-click it):' -ForegroundColor Yellow
Write-Host "        $autologonExe" -ForegroundColor White
Write-Host ''
Write-Host '  2. In the Autologon window, enter EXACTLY:' -ForegroundColor Yellow
Write-Host "        Username : $UserName" -ForegroundColor White
Write-Host "        Domain   : $domain" -ForegroundColor White
Write-Host '        Password : <the password you just typed above>' -ForegroundColor White
Write-Host '     then click  Enable.' -ForegroundColor White
Write-Host ''
Write-Host '  NEVER use a blank password. NEVER set autologon via the registry' -ForegroundColor Yellow
Write-Host '  (DefaultPassword there is plaintext). Autologon stores it as an' -ForegroundColor Yellow
Write-Host '  encrypted LSA secret - that is the only approved method.' -ForegroundColor Yellow
Write-Host ''
Write-Host "  3. Then log in as $UserName once, then reboot to test." -ForegroundColor Yellow
Write-Host $bar -ForegroundColor Black -BackgroundColor Yellow
Write-Host ''
Write-Host 'After Autologon: run deploy\server_setup.ps1 (config pass - completes the' -ForegroundColor Cyan
Write-Host 'SMB grant + boot task now that the account exists), then' -ForegroundColor Cyan
Write-Host 'deploy\set_boot.ps1 -Scene <scene> to pick the boot scene.' -ForegroundColor Cyan
