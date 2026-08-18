# provision_runtime_secrets.ps1 - secure, idempotent show-server secret source.
#
# This script never prints the secret path or contents. The deploy pipeline
# first calls -PrepareDirectory, copies a validated private YAML over encrypted
# SCP into that protected directory, then calls the finalize mode to lock the
# file ACL, replace the stable destination, persist BM26_SECRETS, and verify it.

param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedUser,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [string]$SourceTempPath,
    [switch]$PrepareDirectory,
    [ValidateSet('Machine', 'Process')]
    [string]$EnvironmentTarget = 'Machine'
)

$ErrorActionPreference = 'Stop'

function New-AccessRule {
    param(
        [System.Security.Principal.SecurityIdentifier]$Sid,
        [System.Security.AccessControl.FileSystemRights]$Rights,
        [System.Security.AccessControl.InheritanceFlags]$Inheritance
    )

    return New-Object System.Security.AccessControl.FileSystemAccessRule(
        $Sid,
        $Rights,
        $Inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
}

function Assert-OutsideRepo {
    param([string]$Candidate, [string]$Repository)

    $candidateFull = [IO.Path]::GetFullPath($Candidate)
    $repoPrefix = [IO.Path]::GetFullPath($Repository).TrimEnd('\') + '\'
    if ($candidateFull.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime secrets destination must live outside the deployed repo (path redacted).'
    }
}

function Set-PrivateDirectoryAcl {
    param(
        [string]$Path,
        [System.Security.Principal.SecurityIdentifier]$UserSid
    )

    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $adminsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule(
        (New-AccessRule -Sid $systemSid -Rights FullControl -Inheritance $inherit)
    )
    $security.AddAccessRule(
        (New-AccessRule -Sid $adminsSid -Rights FullControl -Inheritance $inherit)
    )
    $security.AddAccessRule((New-AccessRule -Sid $UserSid -Rights Modify -Inheritance $inherit))
    Set-Acl -LiteralPath $Path -AclObject $security
}

function Set-PrivateFileAcl {
    param(
        [string]$Path,
        [System.Security.Principal.SecurityIdentifier]$UserSid
    )

    $systemSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
    $adminsSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $none = [System.Security.AccessControl.InheritanceFlags]::None
    $userRights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor
        [System.Security.AccessControl.FileSystemRights]::Delete
    $security = New-Object System.Security.AccessControl.FileSecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.AddAccessRule((New-AccessRule -Sid $systemSid -Rights FullControl -Inheritance $none))
    $security.AddAccessRule((New-AccessRule -Sid $adminsSid -Rights FullControl -Inheritance $none))
    $security.AddAccessRule((New-AccessRule -Sid $UserSid -Rights $userRights -Inheritance $none))
    Set-Acl -LiteralPath $Path -AclObject $security
}

if ($env:USERNAME -ine $ExpectedUser) {
    throw ("Runtime-secret identity mismatch: running as '$env:USERNAME', " +
        "expected '$ExpectedUser'.")
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User
if ($null -eq $userSid) {
    throw 'Could not resolve the registered show account SID.'
}

Assert-OutsideRepo -Candidate $DestinationPath -Repository $RepoRoot
$privateDir = Split-Path -Parent $DestinationPath
if (-not $privateDir) {
    throw 'Runtime secrets destination has no parent directory (path redacted).'
}

if ($PrepareDirectory) {
    if (-not (Test-Path -LiteralPath $privateDir -PathType Container)) {
        New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
    }
    Set-PrivateDirectoryAcl -Path $privateDir -UserSid $userSid
    $dirAcl = Get-Acl -LiteralPath $privateDir
    if (-not $dirAcl.AreAccessRulesProtected) {
        throw 'Private runtime-secret directory still inherits ACLs.'
    }
    Write-Host 'BM26_SECRET_DIRECTORY_READY'
    exit 0
}

if (-not $SourceTempPath -or -not (Test-Path -LiteralPath $SourceTempPath -PathType Leaf)) {
    throw 'Encrypted-copy staging file is missing (path redacted).'
}
Assert-OutsideRepo -Candidate $SourceTempPath -Repository $RepoRoot

try {
    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Force
    }
    Move-Item -LiteralPath $SourceTempPath -Destination $DestinationPath -Force
    Set-PrivateFileAcl -Path $DestinationPath -UserSid $userSid
    [Environment]::SetEnvironmentVariable('BM26_SECRETS', $DestinationPath, $EnvironmentTarget)
    if ($EnvironmentTarget -eq 'Machine') {
        # User scope overrides Machine scope in a newly launched process. Remove
        # any stale per-user path so the scheduled task must resolve this exact
        # protected Machine-scope source after its restart.
        [Environment]::SetEnvironmentVariable('BM26_SECRETS', $null, 'User')
        $userOverride = [Environment]::GetEnvironmentVariable('BM26_SECRETS', 'User')
        if (-not [string]::IsNullOrWhiteSpace($userOverride)) {
            throw 'Stale User-scope BM26_SECRETS override could not be removed.'
        }
    }

    $persisted = [Environment]::GetEnvironmentVariable('BM26_SECRETS', $EnvironmentTarget)
    if ($persisted -cne $DestinationPath) {
        throw 'Persistent BM26_SECRETS path verification failed (value redacted).'
    }
    $fileAcl = Get-Acl -LiteralPath $DestinationPath
    if (-not $fileAcl.AreAccessRulesProtected) {
        throw 'Private runtime-secret file still inherits ACLs.'
    }
    $stream = [IO.File]::Open(
        $DestinationPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    $stream.Dispose()
} finally {
    if ($SourceTempPath -and (Test-Path -LiteralPath $SourceTempPath)) {
        Remove-Item -LiteralPath $SourceTempPath -Force
    }
}

Write-Host "BM26_SECRETS_PROVISIONED scope=$EnvironmentTarget"
