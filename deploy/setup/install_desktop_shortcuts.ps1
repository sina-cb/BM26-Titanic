# install_desktop_shortcuts.ps1 - reconciled offline show-control shortcuts.

param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedUser,
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,
    [Parameter(Mandatory = $true)]
    [string]$LauncherProfile,
    [Parameter(Mandatory = $true)]
    [string]$Scene,
    [Parameter(Mandatory = $true)]
    [string]$AssetsPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{64}$')]
    [string]$ExpectedPlanHash,
    [string]$DesktopPath
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Bm26ShortcutNative {
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr handle);
}
'@

function Get-TextHash {
    param([string]$Text)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLower()
    } finally {
        $sha.Dispose()
    }
}

function Write-ProfessionalIcon {
    param(
        [string]$Path,
        [ValidateSet('simulation', 'audio', 'captainpad')]
        [string]$Kind
    )

    $temporary = "$Path.bm26-new"
    $bitmap = New-Object Drawing.Bitmap 64, 64
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    $background = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 29, 31, 35))
    $gold = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 255, 190, 46)), 5
    $teal = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 57, 212, 190)), 5
    $violet = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 142, 97, 255)), 5
    $goldBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 255, 190, 46))
    $tealBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255, 57, 212, 190))
    $graphics.FillEllipse($background, 2, 2, 60, 60)
    $graphics.DrawEllipse($gold, 4, 4, 56, 56)

    switch ($Kind) {
        'simulation' {
            $hull = [Drawing.Point[]]@(
                [Drawing.Point]::new(13, 34),
                [Drawing.Point]::new(51, 34),
                [Drawing.Point]::new(44, 46),
                [Drawing.Point]::new(20, 46)
            )
            $graphics.FillPolygon($tealBrush, $hull)
            $graphics.DrawLine($gold, 21, 32, 21, 24)
            $graphics.DrawLine($gold, 21, 24, 43, 24)
            $graphics.DrawLine($gold, 43, 24, 43, 32)
            foreach ($x in @(26, 32, 38)) {
                $graphics.FillEllipse($goldBrush, $x, 27, 3, 3)
            }
            $graphics.DrawArc($teal, 12, 43, 40, 9, 10, 160)
        }
        'audio' {
            $heights = @(10, 20, 34, 46, 34, 20, 10)
            for ($index = 0; $index -lt $heights.Count; $index++) {
                $x = 17 + ($index * 5)
                $height = $heights[$index]
                $pen = if ($index -eq 3) { $gold } else { $teal }
                $graphics.DrawLine($pen, $x, 32 - ($height / 2), $x, 32 + ($height / 2))
            }
        }
        'captainpad' {
            foreach ($x in @(21, 32, 43)) {
                $graphics.DrawLine($violet, $x, 17, $x, 47)
            }
            $graphics.FillEllipse($goldBrush, 16, 23, 10, 10)
            $graphics.FillEllipse($tealBrush, 27, 35, 10, 10)
            $graphics.FillEllipse($goldBrush, 38, 18, 10, 10)
        }
    }

    $iconHandle = $bitmap.GetHicon()
    try {
        $icon = [Drawing.Icon]::FromHandle($iconHandle)
        $stream = [IO.File]::Create($temporary)
        try {
            $icon.Save($stream)
        } finally {
            $stream.Dispose()
            $icon.Dispose()
        }
    } finally {
        [Bm26ShortcutNative]::DestroyIcon($iconHandle) | Out-Null
        $graphics.Dispose()
        $bitmap.Dispose()
        $background.Dispose()
        $gold.Dispose()
        $teal.Dispose()
        $violet.Dispose()
        $goldBrush.Dispose()
        $tealBrush.Dispose()
    }

    if ((Test-Path -LiteralPath $Path -PathType Leaf) -and
        ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ceq
            (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash)) {
        Remove-Item -LiteralPath $temporary -Force
        return $false
    }
    Move-Item -LiteralPath $temporary -Destination $Path -Force
    return $true
}

function Write-ShortcutFile {
    param(
        [string]$Path,
        [string]$Url,
        [string]$IconPath
    )

    $expected = @('[InternetShortcut]', "URL=$Url", "IconFile=$IconPath", 'IconIndex=0')
    $current = @()
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $current = @(Get-Content -LiteralPath $Path)
    }
    if (($current.Count -eq $expected.Count) -and
        (($current -join "`n") -ceq ($expected -join "`n"))) {
        return $false
    }

    $temporary = "$Path.bm26-new"
    try {
        Set-Content -LiteralPath $temporary -Value $expected -Encoding Ascii
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
    return $true
}

function Get-UrlFromShortcut {
    param([IO.FileInfo]$File)

    if ($File.Extension -ieq '.url') {
        $line = Get-Content -LiteralPath $File.FullName | Where-Object {
            $_ -match '^URL='
        } | Select-Object -First 1
        if ($line) { return $line.Substring(4).Trim() }
        return $null
    }
    if ($File.Extension -ieq '.lnk') {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($File.FullName)
        $combined = "$($shortcut.TargetPath) $($shortcut.Arguments)"
        $match = [regex]::Match($combined, 'https?://[^\s"]+')
        if ($match.Success) { return $match.Value }
    }
    return $null
}

function Test-ManagedUrl {
    param([string]$Url, [int[]]$Ports)

    if (-not $Url) { return $false }
    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri)) { return $false }
    $hostName = $uri.Host.ToLowerInvariant()
    $loopback = $hostName -in @('localhost', '127.0.0.1', '::1', '[::1]')
    return ($loopback -and ($Ports -contains $uri.Port))
}

if ($env:USERNAME -ine $ExpectedUser) {
    throw ("Desktop shortcut identity mismatch: running as '$env:USERNAME', " +
        "expected '$ExpectedUser'. Refusing to write another user's desktop.")
}
if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) {
    throw 'Deployed repository root is unavailable.'
}
if (-not $DesktopPath) {
    $DesktopPath = [Environment]::GetFolderPath(
        [Environment+SpecialFolder]::DesktopDirectory)
}
if (-not $DesktopPath -or -not (Test-Path -LiteralPath $DesktopPath -PathType Container)) {
    throw "Windows desktop Known Folder is unavailable for '$ExpectedUser'."
}

$repoPrefix = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
$assetsFull = [IO.Path]::GetFullPath($AssetsPath)
if ($assetsFull.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Shortcut icon assets must live outside the mirrored repository.'
}
New-Item -ItemType Directory -Path $assetsFull -Force | Out-Null

$planner = Join-Path $RepoRoot 'deploy\setup\shortcut_plan.cjs'
if (-not (Test-Path -LiteralPath $planner -PathType Leaf)) {
    throw 'Deployed shortcut planner is missing.'
}
$planJson = ((& node $planner $RepoRoot $LauncherProfile $Scene) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $planJson) {
    throw 'Deployed shortcut planner failed.'
}
$planHash = Get-TextHash -Text $planJson
if ($planHash -cne $ExpectedPlanHash) {
    throw 'Deployed shortcut plan differs from the laptop preflight plan.'
}
$plan = $planJson | ConvertFrom-Json

$icons = [ordered]@{
    simulation = Join-Path $assetsFull 'titanic_simulation.ico'
    audio = Join-Path $assetsFull 'audio_companion.ico'
    captainpad = Join-Path $assetsFull 'captainpad_web.ico'
}
$iconChanges = 0
foreach ($kind in $icons.Keys) {
    if (Write-ProfessionalIcon -Path $icons[$kind] -Kind $kind) { $iconChanges++ }
}

$desired = [ordered]@{
    'Titanic Simulation.url' = @{ Url = $plan.simulation; Icon = $icons.simulation }
    'Audio Companion.url' = @{ Url = $plan.audio; Icon = $icons.audio }
    'CaptainPad Web.url' = @{ Url = $plan.captainpad; Icon = $icons.captainpad }
}
$managedPorts = @(
    @(6966..6972)
    6981
    ([Uri]$plan.simulation).Port
    ([Uri]$plan.audio).Port
    ([Uri]$plan.captainpad).Port
) | Sort-Object -Unique
$retiredNames = @(
    'BM26 Simulation.url', 'Simulation.url', 'Titanic Sim.url',
    'BM26 Audio Companion.url', 'Audio.url',
    'CaptainPad.url', 'BM26 CaptainPad.url',
    'BM26 Simulation.lnk', 'Simulation.lnk', 'Titanic Sim.lnk',
    'BM26 Audio Companion.lnk', 'Audio.lnk',
    'CaptainPad.lnk', 'BM26 CaptainPad.lnk'
)
$ownedNamePattern = '^(?i:BM26|Marsin|Titanic (Simulation|Sim)|Audio Companion|CaptainPad)'
$removed = 0
foreach ($file in Get-ChildItem -LiteralPath $DesktopPath -File) {
    $knownRetired = $retiredNames -contains $file.Name
    $ownedRetired = ($file.Extension -iin @('.url', '.lnk')) -and
        ($file.BaseName -match $ownedNamePattern) -and
        (-not $desired.Contains($file.Name))
    if ($knownRetired -or $ownedRetired) {
        Remove-Item -LiteralPath $file.FullName -Force
        $removed++
        continue
    }
    $managedUrl = $false
    if ($file.Extension -iin @('.url', '.lnk')) {
        $managedUrl = Test-ManagedUrl -Url (Get-UrlFromShortcut -File $file) -Ports $managedPorts
    }
    if ($managedUrl -and -not $desired.Contains($file.Name)) {
        Remove-Item -LiteralPath $file.FullName -Force
        $removed++
    }
}

$changed = 0
foreach ($name in $desired.Keys) {
    $target = $desired[$name]
    $path = Join-Path $DesktopPath $name
    if (Write-ShortcutFile -Path $path -Url $target.Url -IconPath $target.Icon) {
        $changed++
    }
}

foreach ($name in $desired.Keys) {
    $target = $desired[$name]
    $path = Join-Path $DesktopPath $name
    $actual = @(Get-Content -LiteralPath $path)
    $expected = @(
        '[InternetShortcut]',
        "URL=$($target.Url)",
        "IconFile=$($target.Icon)",
        'IconIndex=0'
    )
    if (($actual.Count -ne $expected.Count) -or
        (($actual -join "`n") -cne ($expected -join "`n"))) {
        throw "Desktop shortcut verification failed for '$name'."
    }
    if (-not (Test-Path -LiteralPath $target.Icon -PathType Leaf) -or
        (Get-Item -LiteralPath $target.Icon).Length -lt 100) {
        throw "Desktop shortcut icon verification failed for '$name'."
    }
}

Write-Host ("DESKTOP SHORTCUTS VERIFIED: updated=$changed removed=$removed " +
    "icons_updated=$iconChanges plan=$planHash")
