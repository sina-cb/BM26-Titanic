# install_ssh_key.ps1 - Show-server bring-up step 5 (docs/43): SSH key.
#
# Installs the laptop's SSH PUBLIC key for the `titanic` admin user so the
# deploy pipeline can authenticate key-only (no passwords ever). Because
# `titanic` is an Administrator, the key goes in the machine-wide admin file
# per Microsoft's OpenSSH docs:
#   C:\ProgramData\ssh\administrators_authorized_keys
# with ACLs locked to Administrators + SYSTEM (inheritance disabled).
#
# -PublicKey accepts either the literal key line OR a path to a .pub file.
# Safety rails (no fallback, codex P0):
#   - the value must LOOK like a public key (ssh-ed25519 / ssh-rsa / ecdsa-...);
#   - anything containing 'PRIVATE KEY' is refused loudly (never accept a
#     private key);
#   - the key line is de-duplicated by exact match, so re-running is a SKIP.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\install_ssh_key.ps1 -PublicKey 'ssh-ed25519 AAAA... laptop'
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\install_ssh_key.ps1 -PublicKey C:\path\to\id_ed25519.pub
# Or via the orchestrator: deploy\server_setup.ps1 -SshPublicKey <key-or-path>
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [Parameter(Mandatory = $true)]
    [string]$PublicKey
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

$authFile = 'C:\ProgramData\ssh\administrators_authorized_keys'

# Resolve literal-key-vs-path. A single-line value that parses as a public
# key is treated literally; otherwise it must be an existing .pub file.
$keyLine = $null
if (Test-Path -LiteralPath $PublicKey -PathType Leaf) {
    Write-Host "Reading public key from file: $PublicKey" -ForegroundColor Cyan
    $fileLines = Get-Content -LiteralPath $PublicKey | Where-Object { $_.Trim().Length -gt 0 }
    if ($fileLines.Count -ne 1) {
        throw "Public key file '$PublicKey' must contain exactly one key line (found $($fileLines.Count))."
    }
    $keyLine = $fileLines[0].Trim()
} else {
    $keyLine = $PublicKey.Trim()
}

# Refuse private keys outright - never accept secret material.
if ($keyLine -match 'PRIVATE KEY') {
    throw 'Refusing input: this looks like a PRIVATE key. Only a PUBLIC key (ssh-ed25519 / ssh-rsa / ecdsa-...) may be installed.'
}

# Must look like an OpenSSH public key.
if ($keyLine -notmatch '^(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-\S+)\s+\S+') {
    throw ("Input does not look like an SSH public key line (expected it to start with " +
        "ssh-ed25519 / ssh-rsa / ecdsa-...). Refusing to install it - no fallback.")
}

Write-Host 'Installing SSH public key for the titanic admin user.' -ForegroundColor Cyan

# Ensure the ProgramData\ssh directory exists (created by OpenSSH install).
$sshDir = Split-Path -Parent $authFile
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
}

# De-dupe by exact line match.
$already = $false
if (Test-Path -LiteralPath $authFile) {
    $existing = Get-Content -LiteralPath $authFile -ErrorAction SilentlyContinue
    foreach ($line in $existing) {
        if ($line.Trim() -eq $keyLine) { $already = $true; break }
    }
}

if ($already) {
    Write-Host '  SKIP: key already present in administrators_authorized_keys.' -ForegroundColor Green
    $status = 'SKIP'
} else {
    # Guard against concatenation: if the existing file's last line has no
    # trailing newline, Add-Content would fuse the new key onto it, corrupting
    # BOTH key lines and silently breaking auth. Ensure a line break first.
    if (Test-Path -LiteralPath $authFile) {
        $existingRaw = Get-Content -LiteralPath $authFile -Raw
        if ($existingRaw -and $existingRaw.Length -gt 0 -and $existingRaw -notmatch "(`r`n|`n)$") {
            Add-Content -LiteralPath $authFile -Value '' -Encoding ascii
        }
    }
    Add-Content -LiteralPath $authFile -Value $keyLine -Encoding ascii
    Write-Host '  DONE: key appended to administrators_authorized_keys.' -ForegroundColor Green
    $status = 'DONE'
}

# Lock ACLs exactly as OpenSSH requires for the admin keys file:
# Administrators + SYSTEM full control, inheritance disabled, nobody else.
# Each security-critical icacls call is exit-code checked - a silent ACL
# failure on this file would leave sshd auth misconfigured (fail loudly, P0).
Write-Host '  Setting ACLs (Administrators + SYSTEM full control, inheritance off)...' -ForegroundColor DarkGray
& icacls.exe $authFile /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "icacls /inheritance:r failed on $authFile (exit $LASTEXITCODE) - ACLs are NOT locked down."
}
& icacls.exe $authFile /grant '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "icacls /grant Administrators failed on $authFile (exit $LASTEXITCODE) - ACLs are NOT locked down."
}
& icacls.exe $authFile /grant '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "icacls /grant SYSTEM failed on $authFile (exit $LASTEXITCODE) - ACLs are NOT locked down."
}
# Strip any other principals: remove common inherited users (BUILTIN\Users,
# S-1-5-32-545) if present. This one is best-effort - the principal simply may
# not be on the ACL. It MUST be wrapped in try/catch: icacls writes to stderr
# when the principal is absent, and under $ErrorActionPreference='Stop' PS 5.1
# turns that redirected native stderr into a TERMINATING error, which would
# abort the script AFTER the key is already installed. Swallow it here.
try {
    & icacls.exe $authFile /remove '*S-1-5-32-545' 2>$null | Out-Null
} catch {
    # principal was not on the ACL - nothing to remove; not an error.
}
Write-Host '  ACLs applied.' -ForegroundColor Green

Write-StepResult ([PSCustomObject]@{
    Step   = 'SSH public key'
    Status = $status
    Detail = "administrators_authorized_keys (ACL: Administrators+SYSTEM full, inheritance off)"
})
