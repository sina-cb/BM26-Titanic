# get_autologon.ps1 - fetch Sysinternals Autologon into the local tools dir.
#
# Sysinternals Autologon is the ONLY approved way to enable auto-login for the
# `titanic` account (it stores the password as an encrypted LSA secret, not a
# plaintext registry key). Its license forbids republishing the binaries, and
# this repo is PUBLIC - so the exes are deliberately NOT committed. They live,
# gitignored, under deploy\setup\tools\autologon\ and are downloaded on first
# setup by this script (create_titanic_user.ps1 also calls it on demand).
#
# Idempotent: if Autologon64.exe is already present it reports SKIP and does
# nothing. Otherwise it downloads Microsoft's official package and extracts it.
#
# This needs INTERNET - which is fine at prep time (the machine just
# git-cloned the repo; the playa is offline, but setup happens before the
# playa). It does NOT need elevation: it only writes into the gitignored tools
# dir. Running the extracted Autologon64.exe later (an operator step) is what
# needs admin, not this download.
#
# By downloading you accept the Sysinternals license (Eula.txt ships inside
# the zip and lands next to the exes).
#
# Run standalone from a normal PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\get_autologon.ps1
#
# Full design: docs/43_show_server_deployment.md.

$ErrorActionPreference = 'Stop'

$SYSINTERNALS_URL = 'https://download.sysinternals.com/files/AutoLogon.zip'
$MANUAL_URL       = 'https://learn.microsoft.com/sysinternals/downloads/autologon'

$toolsDir = Join-Path $PSScriptRoot 'tools\autologon'
$exePath  = Join-Path $toolsDir 'Autologon64.exe'

if (Test-Path -LiteralPath $exePath) {
    Write-Host ''
    Write-Host '==== Autologon: SKIP ====' -ForegroundColor Green
    Write-Host ("  Already present: $exePath") -ForegroundColor Green
    exit 0
}

Write-Host 'Downloading Sysinternals Autologon (requires internet):' -ForegroundColor Cyan
Write-Host ("  $SYSINTERNALS_URL") -ForegroundColor DarkGray
Write-Host '  By downloading you accept the Sysinternals license (Eula.txt in the zip).' -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
}

$tempZip = Join-Path ([System.IO.Path]::GetTempPath()) ("AutoLogon_" + [Guid]::NewGuid().ToString('N') + '.zip')

try {
    Invoke-WebRequest -Uri $SYSINTERNALS_URL -OutFile $tempZip -UseBasicParsing
    Expand-Archive -Path $tempZip -DestinationPath $toolsDir -Force
} finally {
    if (Test-Path -LiteralPath $tempZip) {
        Remove-Item -LiteralPath $tempZip -Force
    }
}

# No fallback behaviors (codex P0): if the expected exe is not there after
# extraction, fail loudly rather than pretend success.
if (-not (Test-Path -LiteralPath $exePath)) {
    throw ("Download/extract completed but Autologon64.exe is missing under " +
        "$toolsDir. The package layout may have changed - fetch it manually " +
        "from $MANUAL_URL and place Autologon64.exe there.")
}

Write-Host ''
Write-Host '==== Autologon: DONE ====' -ForegroundColor Green
Write-Host ("  Installed: $exePath") -ForegroundColor Green
exit 0
