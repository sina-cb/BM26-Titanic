# boot_server.ps1 - Show-server boot supervisor (docs/43 "Supervisor").
#
# This is the script the BM26TitanicStack scheduled task launches at logon of
# the `titanic` user. It brings the lighting stack up on THIS machine's
# configured scene and keeps it up:
#
#   1. Resolve this machine's entry in deploy\machines.yaml by hostname
#      (case-insensitive). Hostname not in the manifest = FAIL LOUDLY and start
#      nothing - there is no default scene (codex P0, no fallback).
#   2. Run the launcher from the repo root with the manifest's profile + scene:
#          node launcher.js <profile> --scene <scene> --no-launch [--pattern <p>]
#      The `prod` profile brings up sim + engine + audio companion headless
#      (--no-launch: no browser is opened; docs/43). launcher.js resolves all of
#      its own paths from its own location, so cwd only needs to be the repo root
#      for tidiness - we set it anyway.
#   3. Stream all launcher output (stdout + stderr) with timestamps to a dated
#      log under C:\titanic\logs\, keeping the newest few log files.
#   4. When the launcher exits, log a LOUD banner with the exit code, bump
#      restart_count in a small status file the deploy-verify step can read,
#      wait a few seconds, and relaunch. Loop forever.
#
# LOG-FIRST ORDERING (field lesson, interior1 first bring-up): the supervisor
# once failed during one-time setup BEFORE it had created its log dir, leaving
# ZERO trace - the at-logon console window flashed and died and we could only
# diagnose it via schtasks Last Result. So the FIRST actions here are: create
# the log dir, open the dated log, and write a startup header. ALL fallible
# one-time setup (manifest read, hostname lookup, node + launcher resolution)
# then runs inside a try/catch that records any thrown error to that log (and
# echoes it to console) before exiting nonzero. A boot failure now ALWAYS
# leaves a log.
#
# The relaunch loop is the explicitly requested show-must-go-on behavior from
# docs/43 ("If the launcher exits: log a screaming banner with the exit code,
# wait 10 s, relaunch") - NOT a hidden fallback. Every restart is loud in the
# log and counted in the status file. $ErrorActionPreference is Stop for the
# one-time setup (manifest read, hostname lookup, node resolution) so a
# misconfiguration fails loudly before any loop starts; it is relaxed to
# Continue for the supervised loop so merged native stderr cannot abort the
# supervisor.
#
# Exit-code note: launcher.js exits 0 (clean stop) / 1 (runtime failure) /
# 2 (usage). The engine's scene-switch restart (exit 75) is consumed INSIDE the
# launcher and normally never surfaces here; if a 75 ever does reach us we treat
# it like any other exit (relaunch, counted) and label it a scene switch in the
# log.
#
# Full design: docs/43_show_server_deployment.md.

param(
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic',
    [string]$ManifestPath,
    [string]$LogDir = 'C:\titanic\logs',
    [int]$RestartDelaySeconds = 10,
    [int]$KeepLogs = 10
)

$ErrorActionPreference = 'Stop'

# Supervisor version - bump on structural changes; logged in the startup header
# so a stale copy is obvious in the field.
$ScriptVersion = '1.2.0'

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $RepoRoot 'deploy\machines.yaml'
}

# Hostname is available immediately (no work required), so the startup header
# can name the machine even if everything else fails.
$hostName = $env:COMPUTERNAME

# --- Logging + status: established FIRST, before any work that can throw -----
# See "LOG-FIRST ORDERING" in the header. Nothing above this point can throw
# except a bad -ManifestPath default join (pure string op). From here on, a log
# always exists to receive a failure.
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Count-based rotation: keep the newest (KeepLogs - 1) existing logs so that,
# with the new one created below, at most KeepLogs remain.
# NOTE (accepted trade-off): rotation runs once here per supervisor lifetime and
# there is exactly ONE log file per lifetime (this process holds it for the whole
# run). The poll-and-open browser job (a child process) also appends to that same
# file via Add-Content; interleaved writes from the two are accepted - the log is
# a human-read diagnostic, not a parsed record, so occasional line interleaving is
# fine and not worth per-write locking.
$existing = @(Get-ChildItem -LiteralPath $LogDir -Filter 'boot_server_*.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
if ($existing.Count -ge $KeepLogs) {
    $existing | Select-Object -Skip ([Math]::Max($KeepLogs - 1, 0)) |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
}
$logFile = Join-Path $LogDir ('boot_server_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.log')
$statusFile = Join-Path $LogDir 'boot_status.yaml'

function Write-Log {
    param([string]$Text)
    Add-Content -LiteralPath $logFile -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Text) -Encoding ascii
}

# Startup header: the very first thing written, so even an instant failure of
# the setup below leaves a dated log naming host, script, and version.
Write-Log '=================================================================='
Write-Log ("BM26 Titanic boot supervisor v$ScriptVersion - starting")
Write-Log ("host: $hostName")
Write-Log ("script: $PSCommandPath")
Write-Log ("repo root: $RepoRoot")
Write-Log ("manifest: $ManifestPath")
Write-Log '=================================================================='

# --- Minimal strict parser for deploy\machines.yaml ----------------------
# Exactly two levels: 'machines:' -> '<name>:' -> '<key>: <value>'. Indentation
# is fixed at 0 / 2 / 4 spaces; tabs and any other structure are a hard FAIL
# (no fallback - a malformed manifest must not boot a guessed scene).
function Read-MachineManifest {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Machine manifest not found: $Path (no fallback, codex P0)."
    }
    $machines = [ordered]@{}
    $sawRoot = $false
    $current = $null
    $lineNo = 0
    foreach ($raw in (Get-Content -LiteralPath $Path)) {
        $lineNo++
        if ($raw -match "`t") {
            throw "machines.yaml line ${lineNo}: tab character found - use spaces only (strict parser, no fallback)."
        }
        if ($raw.Trim().Length -eq 0) { continue }
        if ($raw.TrimStart().StartsWith('#')) { continue }
        $indent = $raw.Length - $raw.TrimStart(' ').Length
        $content = $raw.Substring($indent)
        if ($indent -eq 0) {
            if ($content -match '^machines:\s*$') { $sawRoot = $true; $current = $null; continue }
            throw "machines.yaml line ${lineNo}: unexpected top-level content '$content' (expected 'machines:')."
        }
        if (-not $sawRoot) {
            throw "machines.yaml line ${lineNo}: content before the 'machines:' root."
        }
        if ($indent -eq 2) {
            if ($content -match '^([^:#]+):\s*$') {
                $current = $matches[1].Trim()
                $machines[$current] = [ordered]@{}
                continue
            }
            throw "machines.yaml line ${lineNo}: expected '<name>:' at 2-space indent, got '$content'."
        }
        if ($indent -eq 4) {
            if ($null -eq $current) {
                throw "machines.yaml line ${lineNo}: 'key: value' with no enclosing machine name."
            }
            if ($content -match '^([^:\s]+):\s*(.*)$') {
                $key = $matches[1].Trim()
                $val = $matches[2].Trim()
                if ($val.Length -ge 2) {
                    $first = $val.Substring(0, 1)
                    $last = $val.Substring($val.Length - 1, 1)
                    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                        $val = $val.Substring(1, $val.Length - 2)
                    }
                }
                if ($machines[$current].Contains($key)) {
                    throw "machines.yaml line ${lineNo}: duplicate key '$key' in machine '$current' (no fallback - refusing to silently overwrite)."
                }
                $machines[$current][$key] = $val
                continue
            }
            throw "machines.yaml line ${lineNo}: expected 'key: value' at 4-space indent, got '$content'."
        }
        throw "machines.yaml line ${lineNo}: unexpected indent $indent (only 0, 2, 4 allowed - strict two-level structure)."
    }
    if (-not $sawRoot) {
        throw "machines.yaml has no 'machines:' root (no fallback)."
    }
    return $machines
}

function Write-BootStatus {
    param([int]$RestartCount, $LastExit, [string]$LastStart)
    if ($null -eq $LastExit) { $exitText = 'null' } else { $exitText = [string]$LastExit }
    $lines = @(
        '# BM26 Titanic boot supervisor status - machine-written; do not edit.',
        '# Parsed by the deploy verify step (docs/43).',
        ('hostname: ' + $hostName),
        ('scene: ' + $scene),
        ('profile: ' + $profile),
        ('restart_count: ' + [string]$RestartCount),
        ('last_exit_code: ' + $exitText),
        ('last_start: ' + $LastStart),
        ('last_update: ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'))
    )
    Set-Content -LiteralPath $statusFile -Value $lines -Encoding ascii
}

# --- One-time setup (resolve scene + profile + node + launcher) ----------
# Every step here can throw ($ErrorActionPreference is Stop); the try/catch
# guarantees the failure is written to the log we already opened, echoed to
# console, and turned into a clean nonzero exit - never a silent flash.
try {
    # Resolve this machine's manifest entry by hostname.
    $machines = Read-MachineManifest -Path $ManifestPath

    $entryKey = $null
    foreach ($k in $machines.Keys) {
        if ($k -ieq $hostName) { $entryKey = $k; break }
    }
    if (-not $entryKey) {
        throw ("Hostname '$hostName' has no entry in $ManifestPath (known: " +
            ($machines.Keys -join ', ') + "). Refusing to start - no default scene (codex P0).")
    }
    $entry = $machines[$entryKey]

    foreach ($req in @('scene', 'profile')) {
        if (-not $entry.Contains($req) -or [string]::IsNullOrWhiteSpace([string]$entry[$req])) {
            throw "Machine '$entryKey' is missing required key '$req' in $ManifestPath (no fallback)."
        }
    }
    $scene = [string]$entry['scene']
    $profile = [string]$entry['profile']
    $pattern = $null
    if ($entry.Contains('pattern') -and -not [string]::IsNullOrWhiteSpace([string]$entry['pattern'])) {
        $pattern = [string]$entry['pattern']
    }

    # Optional per-machine desktop auto-open (docs/43). Absent -> false: servers
    # stay headless by default. Only the titanic console session is targeted -
    # the browser opens on whatever desktop this supervisor runs in.
    $openBrowser = $false
    if ($entry.Contains('open_browser')) {
        $obVal = [string]$entry['open_browser']
        if ($obVal -match '^(?i:true|1|yes|on)$') { $openBrowser = $true }
    }

    # Resolve node + the launcher. node MUST be machine-visible for the
    # `titanic` account - a per-user install for another user is invisible here
    # (this is the interior1 failure). Make the diagnosis loud: name what was
    # searched, dump the Machine PATH, and point at the fix.
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
        $machinePathVal = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        throw ("node was not found on this account's PATH - cannot start the stack " +
            "(no fallback, codex P0). Searched: Get-Command 'node' on the current " +
            "('$env:USERNAME') session PATH. node must be MACHINE-VISIBLE for the " +
            "'titanic' service account - a per-user install for another user is " +
            "invisible here. Machine PATH is: [" + $machinePathVal + "]. If no " +
            "nodejs directory appears in that Machine PATH, re-run " +
            "deploy\setup\setup_prereqs.ps1 elevated to install Node machine-scope, " +
            "then reboot.")
    }
    $nodeExe = $nodeCmd.Source

    $launcher = Join-Path $RepoRoot 'launcher.js'
    if (-not (Test-Path -LiteralPath $launcher)) {
        throw "launcher.js not found at $launcher - wrong RepoRoot or the tree is not deployed yet."
    }

    $launchArgs = @($launcher, $profile, '--scene', $scene, '--no-launch')
    if ($pattern) { $launchArgs += @('--pattern', $pattern) }
}
catch {
    $msg = $_.Exception.Message
    Write-Log '******************************************************************'
    Write-Log ('FATAL during one-time setup - the stack was NOT started.')
    Write-Log ($msg)
    if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
        Write-Log ('  ' + ([string]$_.InvocationInfo.PositionMessage).Trim())
    }
    Write-Log 'Supervisor exiting 1. Fix the cause above and reboot / re-run.'
    Write-Log '******************************************************************'
    Write-Host ("boot_server FATAL: $msg") -ForegroundColor Red
    Write-Host ("See the log: $logFile") -ForegroundColor Red
    exit 1
}

# Detailed banner now that scene/profile/launcher are resolved.
Write-Log '------------------------------------------------------------------'
Write-Log ("resolved: host '$hostName' -> scene '$scene', profile '$profile'")
if ($pattern) { Write-Log ("boot pattern: $pattern") }
Write-Log ("launcher: node " + ($launchArgs -join ' '))
Write-Log ("node exe: $nodeExe")
Write-Log '------------------------------------------------------------------'

# --- Desktop auto-open URLs (only used when open_browser is true) ----------
# Standard port stack (docs/43: every server runs the ONE 6966-6972 stack) -
# sim HTTP is 6969, audio companion is 6966. The sim OPEN url is the exact
# string launcher.js builds for the 'prod' profile (2d_pixels profile,
# 0 spotlights, sacn_in), with this machine's scene substituted; the sim PROBE
# url is the query-less path launcher.js itself waits on for readiness.
# KEEP IN SYNC with PROFILES.prod.simParams in launcher.js - a mismatch means
# the console tab renders in a DIFFERENT mode than the profile intends (the
# 2d_pixels profile is what keeps a show box off the per-frame GPU 3D passes).
$simProbeUrl = 'http://localhost:6969/simulation/'
$simOpenUrl = "http://localhost:6969/simulation/?scene=$scene&lighting_mode=sacn_in&profile=2d_pixels&spotlights=0"
$audioUrl = 'http://localhost:6966'
if ($openBrowser) {
    Write-Log 'open_browser: TRUE - will auto-open sim + audio on the console after the first launch.'
    Write-Log ("  sim:   $simOpenUrl")
    Write-Log ("  audio: $audioUrl")
} else {
    Write-Log 'open_browser: false - staying headless (no browser opened).'
}

Set-Location -LiteralPath $RepoRoot

# --- Supervised relaunch loop (deliberate + loud; docs/43) ---------------
# ErrorActionPreference relaxed here so merged native stderr from node cannot
# turn into a terminating error and kill the supervisor.
$ErrorActionPreference = 'Continue'
$restartCount = 0
$lastExit = $null
$browserOpened = $false   # open the desktop UIs ONCE per supervisor lifetime, not on every relaunch

# Poll-and-open runs as a background job because the launcher call below BLOCKS
# this thread for the whole run - the job polls the sim + audio pages
# concurrently and Start-Processes each URL (default browser, titanic console)
# once it answers. It logs into the same dated log via Add-Content, and if a
# page never comes up it just WARNs and exits: it can never block or break the
# supervision loop. This scriptblock lives in a child process (no access to the
# parent's functions), so everything it needs is passed in.
$browserJob = {
    param([string]$SimProbeUrl, [string]$SimOpenUrl, [string]$AudioUrl, [string]$LogFile, [int]$TimeoutSec)
    function JobLog { param([string]$Text)
        Add-Content -LiteralPath $LogFile -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] [browser] ' + $Text) -Encoding ascii
    }
    $targets = @(
        @{ Name = 'sim';   Probe = $SimProbeUrl; Open = $SimOpenUrl },
        @{ Name = 'audio'; Probe = $AudioUrl;    Open = $AudioUrl }
    )
    JobLog ("poll-and-open started (timeout ${TimeoutSec}s per page).")
    foreach ($t in $targets) {
        $deadline = (Get-Date).AddSeconds($TimeoutSec)
        $opened = $false
        while ((Get-Date) -lt $deadline) {
            try {
                $null = Invoke-WebRequest -UseBasicParsing -Uri $t.Probe -TimeoutSec 5
                Start-Process $t.Open
                JobLog ('opened ' + $t.Name + ' -> ' + $t.Open)
                $opened = $true
                break
            } catch {
                Start-Sleep -Seconds 3
            }
        }
        if (-not $opened) {
            JobLog ('WARN: ' + $t.Name + ' (' + $t.Probe + ') did not come up within ' + $TimeoutSec + 's - not opened; carrying on.')
        }
    }
    JobLog 'poll-and-open finished.'
}

while ($true) {
    $startIso = Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'
    Write-BootStatus -RestartCount $restartCount -LastExit $lastExit -LastStart $startIso
    Write-Log '------------------------------------------------------------------'
    Write-Log ("STARTING launcher (run #" + [string]($restartCount + 1) + "): node " + ($launchArgs -join ' '))
    Write-Log '------------------------------------------------------------------'

    # First launch only: kick off the desktop auto-open (guarded so relaunches
    # never re-open tabs). Failure to start the job is logged, never fatal.
    if ($openBrowser -and -not $browserOpened) {
        try {
            Start-Job -Name 'BM26BrowserOpen' -ScriptBlock $browserJob `
                -ArgumentList $simProbeUrl, $simOpenUrl, $audioUrl, $logFile, 180 | Out-Null
            Write-Log 'open_browser: started poll-and-open background job (sim :6969 + audio :6966).'
        } catch {
            Write-Log ('open_browser: WARN - could not start poll-and-open job: ' + $_.Exception.Message + ' - continuing headless.')
        }
        $browserOpened = $true
    }

    & $nodeExe @launchArgs 2>&1 | ForEach-Object { Write-Log ([string]$_) }
    $lastExit = $LASTEXITCODE
    $restartCount++

    if ($lastExit -eq 75) {
        $why = 'scene-switch restart (exit 75)'
    } else {
        $why = ('exit code ' + [string]$lastExit)
    }
    Write-Log '******************************************************************'
    Write-Log ("LAUNCHER EXITED - $why - relaunch #$restartCount in $RestartDelaySeconds s")
    Write-Log '******************************************************************'
    Write-BootStatus -RestartCount $restartCount -LastExit $lastExit -LastStart $startIso

    Start-Sleep -Seconds $RestartDelaySeconds
}
