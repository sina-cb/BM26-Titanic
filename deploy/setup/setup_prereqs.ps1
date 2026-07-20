# setup_prereqs.ps1 - Show-server bring-up step 4 (docs/43): runtimes.
#
# Ensures Node.js, Git for Windows, and Python are present on the show
# server, then wires the repo's security pre-commit hook.
#
#   - Detection is MACHINE-VISIBILITY, not "on my PATH". The stack runs as the
#     `titanic` service account; a runtime installed per-user for another user
#     is invisible to `titanic`. So a tool counts as present only if it is on
#     the MACHINE PATH or in a standard machine location (Program Files) - not
#     merely resolvable on the current session/user PATH. (Field lesson: Node
#     was installed per-user, Get-Command SKIPped it, and `titanic` booted with
#     no node - the supervisor died at logon. Python bit us the same way.)
#   - If a tool is already MACHINE-VISIBLE: SKIP install. Its version is compared
#     to the pinned value; a mismatch is a loud WARN (surfaced in the summary),
#     never an auto-reinstall - the operator explicitly wants skip-if-present.
#   - If a tool is found ONLY per-user (the trap): WARN loudly naming the
#     per-user path, then install machine-scope anyway so every account sees it.
#   - If a tool is missing entirely: install it via winget at the pinned version.
#     If winget itself is missing, that is a hard FAIL (no fallback, codex P0).
#   - After Git is confirmed: `git config core.hooksPath .githooks` in the
#     repo (idempotent - safe to re-run).
#
# Idempotent: re-running on a fully-provisioned box reports SKIP for each tool.
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_prereqs.ps1
# Or via the orchestrator: deploy\server_setup.ps1
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [string]$NodeVersion = '24.18.0',
    [string]$PythonVersion = '3.12',
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic'
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

$notes = @()          # per-tool one-liners for the summary detail
$anyWarn = $false
$anyInstalled = $false
$anySkip = $false

# winget is only required if we actually have to install something. Resolve
# it once up front so the failure is loud and specific.
$winget = Get-Command winget -ErrorAction SilentlyContinue

function Install-ViaWinget {
    param([string]$Id, [string]$Version, [switch]$MachineScope)
    if (-not $winget) {
        throw ("winget (App Installer) is not available, so '$Id' cannot be " +
            "installed. Install 'App Installer' from the Microsoft Store or " +
            "https://aka.ms/getwinget, then re-run. No fallback (codex P0).")
    }
    $wingetArgs = @('install', '--id', $Id, '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements')
    if ($Version) { $wingetArgs += @('--version', $Version) }
    if ($MachineScope) { $wingetArgs += @('--scope', 'machine') }
    Write-Host ("  winget " + ($wingetArgs -join ' ')) -ForegroundColor DarkGray
    & $winget @wingetArgs
    if ($LASTEXITCODE -ne 0) {
        throw ("winget install of '$Id' failed with exit code $LASTEXITCODE.")
    }
}

# Machine-visibility resolver. Answers "can EVERY account (notably `titanic`)
# see this tool?" - which is what actually matters, not "is it on my PATH".
# Precedence: (1) an exe on the MACHINE PATH, (2) an exe in a standard machine
# install dir (Program Files) in case the elevated session's PATH is stale
# after a fresh install, (3) NOT machine-visible - report the per-user path
# (the trap) so the caller can WARN and install machine-scope anyway.
# Returns: MachineVisible (bool), Path (exe to invoke for --version, or null),
# UserPath (the per-user location when only per-user, else null).
function Resolve-MachineTool {
    param(
        [string]$ExeName,               # e.g. 'node.exe'
        [string[]]$StandardDirs = @()   # standard machine install dirs to probe
    )
    # (1) MACHINE PATH - the authoritative "every account sees it" surface.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $machineDirs = @()
    if ($machinePath) {
        $machineDirs = @($machinePath -split ';' | Where-Object { $_ -and $_.Trim() })
    }
    foreach ($dir in $machineDirs) {
        $candidate = Join-Path $dir.Trim() $ExeName
        if (Test-Path -LiteralPath $candidate) {
            return [PSCustomObject]@{ MachineVisible = $true; Path = $candidate; UserPath = $null }
        }
    }
    # (2) Standard machine locations (Program Files) - covers the just-installed
    #     case where this elevated session's PATH has not refreshed yet.
    foreach ($dir in $StandardDirs) {
        $candidate = Join-Path $dir $ExeName
        if (Test-Path -LiteralPath $candidate) {
            return [PSCustomObject]@{ MachineVisible = $true; Path = $candidate; UserPath = $null }
        }
    }
    # (3) Not machine-visible. Is it a per-user install (the trap)? Report where,
    #     so the WARN can name it. Check the user PATH env var, then the live
    #     session PATH (Get-Command) as a backstop.
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $userDirs = @()
    if ($userPath) {
        $userDirs = @($userPath -split ';' | Where-Object { $_ -and $_.Trim() })
    }
    foreach ($dir in $userDirs) {
        $candidate = Join-Path $dir.Trim() $ExeName
        if (Test-Path -LiteralPath $candidate) {
            return [PSCustomObject]@{ MachineVisible = $false; Path = $candidate; UserPath = $candidate }
        }
    }
    $sess = Get-Command $ExeName -ErrorAction SilentlyContinue
    if ($sess) {
        return [PSCustomObject]@{ MachineVisible = $false; Path = $sess.Source; UserPath = $sess.Source }
    }
    # Not found anywhere.
    return [PSCustomObject]@{ MachineVisible = $false; Path = $null; UserPath = $null }
}

# --- Node.js -------------------------------------------------------------
# Standard machine location for the OpenJS.NodeJS MSI is Program Files\nodejs.
Write-Host 'Node.js:' -ForegroundColor Cyan
$node = Resolve-MachineTool -ExeName 'node.exe' -StandardDirs @((Join-Path $env:ProgramFiles 'nodejs'))
if ($node.MachineVisible) {
    $nodeVer = (& $node.Path --version).TrimStart('v').Trim()
    if ($nodeVer -eq $NodeVersion) {
        Write-Host "  SKIP: node v$nodeVer already installed machine-wide (matches pin)." -ForegroundColor Green
        $notes += "node v$nodeVer (ok)"
        $anySkip = $true
    } else {
        Write-Host ("  WARN: node v$nodeVer installed machine-wide but pin is v$NodeVersion. " +
            'Not touching it - reconcile manually (must match the laptop).') -ForegroundColor Yellow
        $notes += "node v$nodeVer != pin v$NodeVersion (WARN)"
        $anyWarn = $true
    }
} else {
    if ($node.UserPath) {
        # THE TRAP: node exists ONLY per-user (on this user's PATH), so the
        # `titanic` service account can't see it. WARN loudly, install anyway.
        Write-Host ("  WARN: node found ONLY per-user at '" + $node.UserPath + "' - invisible to " +
            "the 'titanic' service account. Installing machine-scope so every account sees it.") -ForegroundColor Yellow
        Write-Host ("        If winget reports a collision (exit -1978335226), that per-user copy is " +
            "blocking it: run 'winget uninstall OpenJS.NodeJS.LTS' then re-run this script.") -ForegroundColor Yellow
        $notes += "node per-user trap ($($node.UserPath)) -> installing machine-scope (WARN)"
        $anyWarn = $true
    } else {
        Write-Host "  install: Node.js v$NodeVersion via winget (machine scope)..." -ForegroundColor Yellow
        $notes += "node v$NodeVersion installed (machine scope)"
    }
    # OpenJS.NodeJS.LTS ships as an MSI, which installs MACHINE-SCOPE by default
    # (Program Files\nodejs + system PATH) - no --scope flag needed here.
    # NOTE: it must be the .LTS package id - the plain OpenJS.NodeJS id carries
    # only the current (odd/newest) line and does NOT have the 24.x LTS patch
    # releases (field-verified: 24.18.0 exists only under OpenJS.NodeJS.LTS).
    Install-ViaWinget -Id 'OpenJS.NodeJS.LTS' -Version $NodeVersion
    Write-Host "  DONE: Node.js v$NodeVersion installed (machine scope)." -ForegroundColor Green
    $anyInstalled = $true
}

# --- Git for Windows -----------------------------------------------------
# Standard machine location for Git for Windows is Program Files\Git\{cmd,bin}.
Write-Host 'Git:' -ForegroundColor Cyan
$gitStandardDirs = @(
    (Join-Path $env:ProgramFiles 'Git\cmd'),
    (Join-Path $env:ProgramFiles 'Git\bin'))
$git = Resolve-MachineTool -ExeName 'git.exe' -StandardDirs $gitStandardDirs
if ($git.MachineVisible) {
    $gitVer = (& $git.Path --version).Trim()
    Write-Host "  SKIP: $gitVer already installed machine-wide." -ForegroundColor Green
    $notes += "git present"
    $anySkip = $true
} else {
    if ($git.UserPath) {
        # THE TRAP: git only per-user - invisible to the `titanic` account.
        Write-Host ("  WARN: git found ONLY per-user at '" + $git.UserPath + "' - invisible to " +
            "the 'titanic' service account. Installing machine-scope so every account sees it.") -ForegroundColor Yellow
        Write-Host ("        If winget reports a collision (exit -1978335226), that per-user copy is " +
            "blocking it: run 'winget uninstall Git.Git' then re-run this script.") -ForegroundColor Yellow
        $notes += "git per-user trap ($($git.UserPath)) -> installing machine-scope (WARN)"
        $anyWarn = $true
    } else {
        Write-Host '  install: Git for Windows via winget (machine scope)...' -ForegroundColor Yellow
        $notes += "git installed"
    }
    # Git.Git's winget package installs MACHINE-SCOPE already - no --scope flag.
    Install-ViaWinget -Id 'Git.Git' -Version ''
    Write-Host '  DONE: Git for Windows installed (machine scope).' -ForegroundColor Green
    $anyInstalled = $true
    # Refresh the handle so the hooks-path step below can find it this session.
    $git = Resolve-MachineTool -ExeName 'git.exe' -StandardDirs $gitStandardDirs
}

# --- Python --------------------------------------------------------------
# Standard machine location for a machine-scope python.org / winget install is
# Program Files\Python<major><minor> (e.g. Python312 for the 3.12 pin). The old
# WindowsApps execution-alias stub lives on the USER PATH, so the resolver
# below naturally treats it as a per-user trap and installs machine-scope over
# it - no special-casing needed.
Write-Host 'Python:' -ForegroundColor Cyan
$pyDirTag = 'Python' + ($PythonVersion -replace '\.', '')
$python = Resolve-MachineTool -ExeName 'python.exe' -StandardDirs @(
    (Join-Path $env:ProgramFiles $pyDirTag),
    (Join-Path $env:ProgramFiles 'Python313'),
    (Join-Path $env:ProgramFiles 'Python312'))
if ($python.MachineVisible) {
    # --version merges stderr via 2>&1; under $ErrorActionPreference='Stop' a
    # stray stderr line (e.g. a startup DeprecationWarning) would be wrapped as
    # a terminating NativeCommandError in PS 5.1 and abort the run. Relax EAP
    # for just this read so a warning cannot kill prereq detection.
    $pyEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $pyRaw = (& $python.Path --version 2>&1 | Select-Object -First 1).ToString()
    $ErrorActionPreference = $pyEap
    $pyVer = ($pyRaw -replace '^Python\s+', '').Trim()
    if ($pyVer -like ($PythonVersion + '*')) {
        Write-Host "  SKIP: Python $pyVer already installed machine-wide (matches pin $PythonVersion)." -ForegroundColor Green
        $notes += "python $pyVer (ok)"
        $anySkip = $true
    } else {
        Write-Host ("  WARN: Python $pyVer installed machine-wide but pin is $PythonVersion. " +
            'Not touching it - reconcile manually.') -ForegroundColor Yellow
        $notes += "python $pyVer != pin $PythonVersion (WARN)"
        $anyWarn = $true
    }
} else {
    if ($python.UserPath) {
        # THE TRAP (this is exactly how Python bit us on the first bring-up):
        # a per-user (or WindowsApps-stub) python `titanic` cannot see.
        Write-Host ("  WARN: Python found ONLY per-user at '" + $python.UserPath + "' - invisible to " +
            "the 'titanic' service account. Installing machine-scope so every account sees it.") -ForegroundColor Yellow
        Write-Host ("        If winget reports a collision (exit -1978335226), that per-user copy is " +
            "blocking it: run 'winget uninstall Python.Python." + $PythonVersion + "' then re-run this script.") -ForegroundColor Yellow
        $notes += "python per-user trap ($($python.UserPath)) -> installing machine-scope (WARN)"
        $anyWarn = $true
    } else {
        Write-Host "  install: Python $PythonVersion via winget (machine scope)..." -ForegroundColor Yellow
        $notes += "python $PythonVersion installed (machine scope)"
    }
    # --scope machine: the python.org installer defaults to a PER-USER install
    # (even when winget runs elevated), which lands in the elevating user's
    # profile and is invisible to the `titanic` account the stack runs as.
    # Machine scope puts Python in Program Files + the system PATH, so
    # bring-up is deterministic and every user/session sees the same install.
    # (Node and Git need no flag - their winget packages are machine-scope MSIs.)
    Install-ViaWinget -Id ('Python.Python.' + $PythonVersion) -Version '' -MachineScope
    Write-Host "  DONE: Python $PythonVersion installed (machine scope)." -ForegroundColor Green
    $anyInstalled = $true
}

# --- git hooksPath (security pre-commit gate) ----------------------------
Write-Host 'Git hooks path:' -ForegroundColor Cyan
if (-not $git.Path) {
    throw 'git was expected to be resolvable after install but is not this session. Open a new shell and re-run.'
}
if (Test-Path (Join-Path $RepoRoot '.git')) {
    & $git.Path -C $RepoRoot config core.hooksPath .githooks
    if ($LASTEXITCODE -ne 0) {
        throw "git config core.hooksPath .githooks failed (exit $LASTEXITCODE) in $RepoRoot."
    }
    Write-Host "  DONE: core.hooksPath = .githooks in $RepoRoot." -ForegroundColor Green
    $notes += "hooksPath set"
} else {
    Write-Host ("  WARN: $RepoRoot is not a git repo yet; skipped hooksPath. " +
        'Re-run after the tree is cloned/synced.') -ForegroundColor Yellow
    $notes += "hooksPath skipped (no repo)"
    $anyWarn = $true
}

# --- Aggregate status ----------------------------------------------------
if ($anyWarn)          { $status = 'WARN' }
elseif ($anyInstalled) { $status = 'DONE' }
elseif ($anySkip)      { $status = 'SKIP' }
else                   { $status = 'DONE' }

Write-StepResult ([PSCustomObject]@{
    Step   = 'Prerequisites (Node/Git/Python)'
    Status = $status
    Detail = ($notes -join '; ')
})
