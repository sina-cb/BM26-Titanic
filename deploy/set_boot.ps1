# set_boot.ps1 - Set THIS show server's boot scene (docs/43).
#
# The one command the operator runs to say "when this machine boots, bring the
# stack up on scene <X>". It:
#   1. Validates the scene actually exists (same checks launcher.js makes:
#      simulation\scenes\<scene>\scene_config.yaml AND
#      marsin_engine\models\<scene>.js) - a bad scene would crash-loop the
#      supervisor, so we FAIL LOUDLY here instead (no fallback, codex P0).
#   2. Writes this hostname's entry in deploy\machines.yaml (scene + profile,
#      and pattern if given), preserving every other machine's block and the
#      file's comments - only this machine's block is rewritten. An unparseable
#      manifest is a hard FAIL.
#   3. Ensures the BM26TitanicStack boot task exists and points at
#      deploy\boot_server.ps1, by invoking deploy\setup\setup_boot_task.ps1
#      (reused, not duplicated).
#   4. Applies this machine's config overlay - deploy\overlays\<hostname,
#      lowercase>\ mirrored over the repo root - if one exists. No overlay is a
#      LOUD WARN (the machine would run the repo's tracked laptop/dev config:
#      engine sACN to loopback, no physical controllers), but not a failure -
#      a sim-only machine is legitimate. INTERIM: per docs/43, overlay
#      application belongs to the Phase 2 deploy.py pipeline (phase 4); this
#      step covers the gap until that lands, and moves there when it does.
#   5. Prints a clear confirmation of what will run at the next titanic logon.
#
# -OpenBrowser / -NoOpenBrowser toggle this machine's 'open_browser' manifest
# key: when true, the supervisor auto-opens the sim + audio companion pages in
# the default browser on the titanic console at boot (docs/43); default off
# (servers stay headless). The switch only rewrites the manifest key - the
# actual opening is done by boot_server.ps1 at the next logon.
#
# The change takes effect at the next logon of the `titanic` user (i.e. next
# reboot / autologon) - it does not restart a running stack.
#
# Needs elevation (it touches the titanic user's scheduled task). Run it
# self-elevating from the tech account:
#   Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\titanic\BM26-Titanic\deploy\set_boot.ps1 -Scene test_bench'
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [Parameter(Mandatory = $true)]
    [string]$Scene,
    [string]$LauncherProfile = 'prod',
    [string]$Pattern,
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic',
    [string]$ManifestPath,
    [switch]$OpenBrowser,
    [switch]$NoOpenBrowser
)

$ErrorActionPreference = 'Stop'

if ($OpenBrowser -and $NoOpenBrowser) {
    throw "Pass at most one of -OpenBrowser / -NoOpenBrowser (they contradict each other; no fallback)."
}

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $RepoRoot 'deploy\machines.yaml'
}

# --- Minimal strict parser for deploy\machines.yaml (validation + read) ---
# Same strict two-level shape as deploy\boot_server.ps1: 'machines:' ->
# '<name>:' -> '<key>: value' at 0/2/4-space indent. Anything else = hard FAIL.
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

$hostName = $env:COMPUTERNAME

# --- 1. Validate the scene (fail loudly, exactly like launcher.js) --------
$sceneConfig = Join-Path $RepoRoot ("simulation\scenes\$Scene\scene_config.yaml")
$engineModel = Join-Path $RepoRoot ("marsin_engine\models\$Scene.js")
if (-not (Test-Path -LiteralPath $sceneConfig)) {
    throw "Scene '$Scene' has no scene_config.yaml ($sceneConfig). Refusing to set an unbootable scene (no fallback, codex P0)."
}
if (-not (Test-Path -LiteralPath $engineModel)) {
    throw "Scene '$Scene' has no engine model ($engineModel). The engine boots model = scene; refusing to set it (no fallback)."
}
if ($PSBoundParameters.ContainsKey('Pattern') -and -not [string]::IsNullOrWhiteSpace($Pattern)) {
    $patternFile = Join-Path $RepoRoot ("marsin_engine\patterns\$Pattern.js")
    if (-not (Test-Path -LiteralPath $patternFile)) {
        throw "Pattern '$Pattern' not found ($patternFile). Refusing to set a missing boot pattern (no fallback)."
    }
}
Write-Host "Scene '$Scene' validated (scene_config.yaml + engine model present)." -ForegroundColor Green

# --- 2. Write this machine's entry in machines.yaml -----------------------
$existingEntry = $null
$existingKey = $null
$manifestExists = Test-Path -LiteralPath $ManifestPath
if ($manifestExists) {
    $machines = Read-MachineManifest -Path $ManifestPath   # validates; throws if unparseable
    foreach ($k in $machines.Keys) {
        if ($k -ieq $hostName) { $existingKey = $k; $existingEntry = $machines[$k]; break }
    }
}

# Build the ordered field set for this machine. A missing existing entry means
# this run INVENTED the machine's block (best-effort host guess + default role),
# which the operator must verify - flagged loudly in the confirmation below.
$freshEntry = -not [bool]$existingEntry
$fields = [ordered]@{}
if ($existingEntry) {
    foreach ($k in $existingEntry.Keys) { $fields[$k] = $existingEntry[$k] }
    $fields['scene'] = $Scene
    $fields['profile'] = $LauncherProfile
    if ($PSBoundParameters.ContainsKey('Pattern')) {
        if ([string]::IsNullOrWhiteSpace($Pattern)) {
            if ($fields.Contains('pattern')) { $fields.Remove('pattern') }
        } else {
            $fields['pattern'] = $Pattern
        }
    }
    if ($OpenBrowser) { $fields['open_browser'] = 'true' }
    elseif ($NoOpenBrowser) { if ($fields.Contains('open_browser')) { $fields.Remove('open_browser') } }
} else {
    # Fresh entry: best-effort primary IPv4 for host/share, else the hostname.
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -First 1).IPAddress
    if (-not $ip) { $ip = $hostName }
    $fields['host'] = $ip
    $fields['role'] = 'interior lights'
    $fields['scene'] = $Scene
    if ($PSBoundParameters.ContainsKey('Pattern') -and -not [string]::IsNullOrWhiteSpace($Pattern)) {
        $fields['pattern'] = $Pattern
    }
    $fields['profile'] = $LauncherProfile
    if ($OpenBrowser) { $fields['open_browser'] = 'true' }
    $fields['dest'] = $RepoRoot
    $fields['share'] = '\\' + $ip + '\titanic'
    $fields['ssh_user'] = 'titanic'
    $fields['notes'] = 'auto-added by set_boot.ps1'
}

$keyToWrite = $hostName.ToLower()
if ($existingKey) { $keyToWrite = $existingKey }

$blockLines = @('  ' + $keyToWrite + ':')
foreach ($k in $fields.Keys) {
    $blockLines += ('    ' + $k + ': ' + [string]$fields[$k])
}

if (-not $manifestExists) {
    $out = @(
        '# machines.yaml - BM26 Titanic show servers (docs/43). Created by set_boot.ps1.',
        '# LAN hostnames/IPs only - never credentials, no MACs.',
        'machines:'
    ) + $blockLines
    Set-Content -LiteralPath $ManifestPath -Value $out -Encoding ascii
} else {
    $lines = @(Get-Content -LiteralPath $ManifestPath)
    if ($existingKey) {
        $startIdx = -1
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^  ([^:#]+):\s*$' -and ($matches[1].Trim() -ieq $existingKey)) {
                $startIdx = $i; break
            }
        }
        if ($startIdx -lt 0) {
            throw "Internal error: entry '$existingKey' parsed but its block was not found in $ManifestPath."
        }
        $endIdx = $lines.Count
        for ($j = $startIdx + 1; $j -lt $lines.Count; $j++) {
            $lj = $lines[$j]
            if ($lj.Trim().Length -eq 0) { continue }
            $ind = $lj.Length - $lj.TrimStart(' ').Length
            if ($lj.TrimStart().StartsWith('#')) {
                # Only a TOP-LEVEL comment (indent <= 2) ends this machine's
                # block. A comment indented deeper than 2 spaces sits INSIDE the
                # block (e.g. annotating a key) and must NOT terminate it, or the
                # keys after it would be orphaned and left behind on rewrite.
                if ($ind -le 2) { $endIdx = $j; break }
                continue
            }
            if ($ind -le 2) { $endIdx = $j; break }
        }
        while (($endIdx - 1) -gt $startIdx -and $lines[$endIdx - 1].Trim().Length -eq 0) { $endIdx-- }
        $before = @()
        if ($startIdx -gt 0) { $before = $lines[0..($startIdx - 1)] }
        $after = @()
        if ($endIdx -lt $lines.Count) { $after = $lines[$endIdx..($lines.Count - 1)] }
        $out = @() + $before + $blockLines + $after
    } else {
        $out = @() + $lines
        if ($out.Count -gt 0 -and $out[-1].Trim().Length -ne 0) { $out += '' }
        $out += $blockLines
    }
    Set-Content -LiteralPath $ManifestPath -Value $out -Encoding ascii
}
Write-Host "Wrote boot entry for '$keyToWrite' -> scene '$Scene', profile '$LauncherProfile' in $ManifestPath." -ForegroundColor Green

# --- 3. Ensure the boot task exists (reuse setup_boot_task.ps1) -----------
$bootTaskScript = Join-Path $PSScriptRoot 'setup\setup_boot_task.ps1'
if (-not (Test-Path -LiteralPath $bootTaskScript)) {
    throw "setup_boot_task.ps1 not found at $bootTaskScript - cannot ensure the boot task."
}
Write-Host ''
Write-Host 'Ensuring the BM26TitanicStack boot task:' -ForegroundColor Cyan
& $bootTaskScript -RepoRoot $RepoRoot | Out-Null

# --- 4. Apply this machine's config overlay -------------------------------
# deploy\overlays\<hostname-lowercase>\ mirrors the repo tree; every file in it
# is copied over the repo root, preserving relative paths (see
# deploy\overlays\README.md). INTERIM mechanism: docs/43 assigns overlay
# application to the Phase 2 deploy.py pipeline (phase 4) - this moves there.
$overlayRoot = Join-Path $PSScriptRoot ('overlays\' + $hostName.ToLower())
$overlayApplied = @()          # repo-relative paths applied (for the confirmation)
$overlayMissing = -not (Test-Path -LiteralPath $overlayRoot -PathType Container)
Write-Host ''
if ($overlayMissing) {
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Yellow
    Write-Host ("  WARN: no config overlay for this machine ($overlayRoot).") -ForegroundColor Yellow
    Write-Host '  This machine will run the repo''s tracked (laptop/dev) config -' -ForegroundColor Yellow
    Write-Host '  engine sACN goes to LOOPBACK and NO physical controllers will' -ForegroundColor Yellow
    Write-Host '  light up. Fine for a sim-only box; wrong for a show server.' -ForegroundColor Yellow
    Write-Host '  How to create one: deploy\overlays\README.md (or docs/43).' -ForegroundColor Yellow
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Yellow
} else {
    Write-Host ("Applying config overlay: $overlayRoot") -ForegroundColor Cyan
    foreach ($f in @(Get-ChildItem -LiteralPath $overlayRoot -Recurse -File)) {
        $rel = $f.FullName.Substring($overlayRoot.Length).TrimStart('\')
        $dest = Join-Path $RepoRoot $rel
        $destDir = Split-Path -Parent $dest
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        Write-Host ("  overlay: $rel -> applied") -ForegroundColor Green
        $overlayApplied += $rel
    }
    if ($overlayApplied.Count -eq 0) {
        Write-Host ("  WARN: overlay dir exists but contains no files - nothing applied.") -ForegroundColor Yellow
    }
}

# --- 5. Confirmation ------------------------------------------------------
$launcherLine = "node launcher.js $LauncherProfile --scene $Scene --no-launch"
if ($PSBoundParameters.ContainsKey('Pattern') -and -not [string]::IsNullOrWhiteSpace($Pattern)) {
    $launcherLine += " --pattern $Pattern"
}

$task = Get-ScheduledTask -TaskName 'BM26TitanicStack' -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '================= BOOT SCENE SET =================' -ForegroundColor Cyan
Write-Host ("  hostname : $hostName  (manifest key '$keyToWrite')")
Write-Host ("  scene    : $Scene")
Write-Host ("  profile  : $LauncherProfile")
if ($PSBoundParameters.ContainsKey('Pattern') -and -not [string]::IsNullOrWhiteSpace($Pattern)) {
    Write-Host ("  pattern  : $Pattern")
}
if ($fields.Contains('open_browser') -and ([string]$fields['open_browser'] -match '^(?i:true|1|yes|on)$')) {
    Write-Host ("  browser  : ON  (sim :6969 + audio :6966 auto-open on the titanic console at boot)")
} else {
    Write-Host ("  browser  : off (servers stay headless; enable with -OpenBrowser)")
}
Write-Host ("  manifest : $ManifestPath")
Write-Host ''

# Fresh-entry warning: this run auto-created the machine's manifest block from a
# best-effort host guess and a DEFAULT role. Those values are unverified - make
# it impossible to miss. Only fires on a fresh add, never on an update.
if ($freshEntry) {
    Write-Host '  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Yellow
    Write-Host '  !! NEW machine entry auto-created with a GUESSED host/share and' -ForegroundColor Yellow
    Write-Host '  !! a DEFAULT role. VERIFY host/share/role in deploy\machines.yaml' -ForegroundColor Yellow
    Write-Host '  !! before relying on deploy tooling.' -ForegroundColor Yellow
    Write-Host '  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Yellow
    Write-Host ''
}

# Overlay status - repeat prominently here so the operator cannot miss that a
# missing overlay means this box runs the tracked laptop/dev config.
if ($overlayMissing) {
    Write-Host '  !! NO CONFIG OVERLAY for this machine - it will run the repo''s tracked' -ForegroundColor Yellow
    Write-Host '     (laptop/dev) config: engine sACN to LOOPBACK, NO physical controllers.' -ForegroundColor Yellow
    Write-Host '     Fine for a sim-only box; create deploy\overlays\' -ForegroundColor Yellow -NoNewline
    Write-Host ($hostName.ToLower() + '\ for a show server') -ForegroundColor Yellow
    Write-Host '     (see deploy\overlays\README.md).' -ForegroundColor Yellow
} elseif ($overlayApplied.Count -eq 0) {
    Write-Host '  !! overlay dir exists but is EMPTY - nothing applied; running tracked config.' -ForegroundColor Yellow
} else {
    Write-Host ("  overlay  : applied " + [string]$overlayApplied.Count + " file(s) from deploy\overlays\" + $hostName.ToLower() + '\:') -ForegroundColor Green
    foreach ($rel in $overlayApplied) {
        Write-Host ("               $rel") -ForegroundColor Green
    }
}
Write-Host ''
if ($task) {
    Write-Host '  Boot task BM26TitanicStack is present. At next titanic logon it runs:' -ForegroundColor Green
    Write-Host ("    deploy\boot_server.ps1  ->  $launcherLine")
} else {
    Write-Host '  Boot task NOT present yet (the titanic account likely does not exist).' -ForegroundColor Yellow
    Write-Host '  Create it (deploy\create_titanic_user.ps1), then re-run this command.' -ForegroundColor Yellow
    Write-Host ("  Once created, the boot task will run:  $launcherLine")
}
Write-Host ''
Write-Host '  Takes effect at the next titanic logon / reboot (autologon).' -ForegroundColor Cyan
Write-Host '=================================================' -ForegroundColor Cyan
