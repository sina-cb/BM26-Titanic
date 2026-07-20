# verify_server.ps1 - Show-server bring-up verifier (docs/43): READ-ONLY.
#
# Reports the state of every bring-up step so an agent or operator can fill in
# the docs/43 "Report back" section. It makes NO changes and needs NO
# elevation - it only reads. COM ports are reported, never touched.
# NOTE: a couple of checks (SMB share, scheduled task) cannot be read reliably
# without elevation; when run non-elevated those report UNKNOWN rather than
# falsely claiming MISSING. Run elevated for a definitive answer.
#
# Reports: hostname; IPv4 per adapter; node/git/python versions vs pins;
# OpenSSH service state + StartType; firewall rules present; SMB share present;
# titanic user exists + in Administrators; boot task present + last run result;
# hibernate state; COM ports (device names only).
#
# Run standalone (no elevation required):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_server.ps1
#
# Full design: docs/43_show_server_deployment.md.

param(
    [string]$NodeVersion = '24.18.0',
    [string]$PythonVersion = '3.12',
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic'
)

$ErrorActionPreference = 'Stop'

# Some read APIs (SMB shares, other users' scheduled tasks) return nothing
# for a non-elevated caller - detect elevation so those checks can say
# UNKNOWN instead of a false MISSING.
$isElevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Write-Field {
    param([string]$Label, [string]$Value, [string]$Color = 'Gray')
    Write-Host ('  {0,-26} {1}' -f ($Label + ':'), $Value) -ForegroundColor $Color
}

Write-Host ''
Write-Host '============ interior server verify (read-only) ============' -ForegroundColor Cyan

# --- Identity ------------------------------------------------------------
Write-Host ''
Write-Host 'Identity' -ForegroundColor Cyan
Write-Field 'hostname' $env:COMPUTERNAME

# --- Network -------------------------------------------------------------
Write-Host ''
Write-Host 'Network (IPv4 per adapter)' -ForegroundColor Cyan
$addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' } |
    Sort-Object InterfaceAlias
if ($addrs) {
    foreach ($a in $addrs) {
        Write-Field $a.InterfaceAlias ("{0}/{1} ({2})" -f $a.IPAddress, $a.PrefixLength, $a.PrefixOrigin)
    }
} else {
    Write-Field 'adapters' '(none with an IPv4 address)' 'Yellow'
}

# --- Runtimes ------------------------------------------------------------
Write-Host ''
Write-Host 'Runtimes (installed vs pinned)' -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVer = (& node --version).TrimStart('v').Trim()
    if ($nodeVer -eq $NodeVersion) { $c = 'Green'; $tag = 'ok' } else { $c = 'Yellow'; $tag = "!= pin $NodeVersion" }
    Write-Field 'node' "v$nodeVer  ($tag)" $c
} else {
    Write-Field 'node' 'NOT INSTALLED' 'Red'
}

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    Write-Field 'git' ((& git --version).Trim()) 'Green'
} else {
    Write-Field 'git' 'NOT INSTALLED' 'Red'
}

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python -and $python.Source -notlike '*WindowsApps*') {
    # --version merges stderr via 2>&1; under $ErrorActionPreference='Stop' a
    # stray stderr line would be wrapped as a terminating NativeCommandError in
    # PS 5.1 and abort this read-only verify. Relax EAP for just this call.
    $pyEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $pyRaw = (& python --version 2>&1 | Select-Object -First 1).ToString()
    $ErrorActionPreference = $pyEap
    $pyVer = ($pyRaw -replace '^Python\s+', '').Trim()
    if ($pyVer -like ($PythonVersion + '*')) { $c = 'Green'; $tag = 'ok' } else { $c = 'Yellow'; $tag = "!= pin $PythonVersion" }
    Write-Field 'python' "$pyVer  ($tag)" $c
} else {
    Write-Field 'python' 'NOT INSTALLED (or Store stub)' 'Red'
}

# --- OpenSSH -------------------------------------------------------------
Write-Host ''
Write-Host 'OpenSSH Server' -ForegroundColor Cyan
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshd) {
    if ($sshd.Status -eq 'Running' -and $sshd.StartType -eq 'Automatic') { $c = 'Green' } else { $c = 'Yellow' }
    Write-Field 'sshd' ("Status=$($sshd.Status), StartType=$($sshd.StartType)") $c
} else {
    Write-Field 'sshd' 'service not present' 'Red'
}

# --- Firewall ------------------------------------------------------------
Write-Host ''
Write-Host 'Firewall rules (BM26 Titanic -)' -ForegroundColor Cyan
$fwNames = @(
    'BM26 Titanic - stack TCP 6966-6972',
    'BM26 Titanic - sACN UDP 5568',
    'BM26 Titanic - SSH TCP 22',
    'BM26 Titanic - SMB TCP 445'
)
foreach ($fn in $fwNames) {
    $present = [bool](Get-NetFirewallRule -DisplayName $fn -ErrorAction SilentlyContinue)
    if ($present) { Write-Field $fn.Replace('BM26 Titanic - ', '') 'present (y)' 'Green' }
    else          { Write-Field $fn.Replace('BM26 Titanic - ', '') 'MISSING (n)' 'Yellow' }
}

# --- Network profile category --------------------------------------------
# On the gateway-less show LAN a physical adapter comes up as an "Unidentified
# network" -> Public profile, on which the Private+Domain firewall rules above
# are inert. Report each physical adapter's NetworkCategory (Public here is the
# smell) and whether the durable "Unidentified Networks -> Private" NLM policy
# is set. Both reads are non-elevated-safe: Get-NetConnectionProfile and the
# HKLM\...\Policies key read without admin; if a read is denied, say UNKNOWN.
Write-Host ''
Write-Host 'Network profile (Public on show LAN = firewall rules inert)' -ForegroundColor Cyan
$physIdx = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty ifIndex)
$connProfiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $physIdx -contains $_.InterfaceIndex })
if ($connProfiles.Count -eq 0) {
    Write-Field 'physical adapters' '(none with a connection profile)' 'Yellow'
} else {
    foreach ($cp in $connProfiles) {
        if ($cp.NetworkCategory -eq 'Private' -or $cp.NetworkCategory -eq 'DomainAuthenticated') { $c = 'Green' } else { $c = 'Yellow' }
        Write-Field $cp.InterfaceAlias ("'{0}' -> {1}" -f $cp.Name, $cp.NetworkCategory) $c
    }
}
# NLM "Unidentified Networks -> Private" policy: presence of the policy path is
# the read-only signal. Absent = not set (matches the setup step's TODO).
$nlmPolicyPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\CurrentVersion\NetworkList\Signatures'
$nlmSet = $null
try {
    $nlmSet = Test-Path $nlmPolicyPath -ErrorAction Stop
} catch {
    $nlmSet = $null
}
if ($null -eq $nlmSet) {
    Write-Field 'unidentified->Private policy' 'UNKNOWN (read denied - run elevated)' 'Yellow'
} elseif ($nlmSet) {
    Write-Field 'unidentified->Private policy' 'set (y)' 'Green'
} else {
    Write-Field 'unidentified->Private policy' 'NOT set (n) - setup step TODO' 'Yellow'
}

# --- SMB share -----------------------------------------------------------
Write-Host ''
Write-Host 'SMB share' -ForegroundColor Cyan
$share = Get-SmbShare -Name 'titanic' -ErrorAction SilentlyContinue
if ($share) {
    Write-Field 'titanic' ("present (y) -> " + $share.Path) 'Green'
} elseif (-not $isElevated) {
    Write-Field 'titanic' 'UNKNOWN (needs elevation to confirm)' 'Yellow'
} else {
    Write-Field 'titanic' 'MISSING (n)' 'Yellow'
}

# --- titanic user --------------------------------------------------------
Write-Host ''
Write-Host 'titanic account' -ForegroundColor Cyan
$user = Get-LocalUser -Name 'titanic' -ErrorAction SilentlyContinue
if ($user) {
    Write-Field 'exists' 'yes (y)' 'Green'
    $inAdmin = $false
    try {
        $members = Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction SilentlyContinue
        foreach ($m in $members) {
            if ($m.Name -like '*\titanic' -or $m.Name -eq 'titanic') { $inAdmin = $true; break }
        }
    } catch { $inAdmin = $false }
    if ($inAdmin) { Write-Field 'in Administrators' 'yes (y)' 'Green' }
    else          { Write-Field 'in Administrators' 'NO (n)' 'Yellow' }
} else {
    Write-Field 'exists' 'NO (n) - operator step (create_titanic_user.ps1)' 'Yellow'
}

# --- Boot task -----------------------------------------------------------
Write-Host ''
Write-Host 'Boot task (BM26TitanicStack)' -ForegroundColor Cyan
$task = Get-ScheduledTask -TaskName 'BM26TitanicStack' -ErrorAction SilentlyContinue
if ($task) {
    Write-Field 'present' 'yes (y)' 'Green'
    $info = Get-ScheduledTaskInfo -TaskName 'BM26TitanicStack' -ErrorAction SilentlyContinue
    if ($info) {
        $lrt = $info.LastRunTime
        if ($null -eq $lrt) { $lrt = '(never)' }
        Write-Field 'last run time' "$lrt"
        Write-Field 'last result' ("0x{0:X}" -f $info.LastTaskResult)
    }
} elseif (-not $isElevated) {
    Write-Field 'present' 'UNKNOWN (needs elevation to confirm)' 'Yellow'
} else {
    Write-Field 'present' 'NO (n)' 'Yellow'
}

# --- Power / hibernate ---------------------------------------------------
Write-Host ''
Write-Host 'Power' -ForegroundColor Cyan
$hibEnabled = $null
$hibProp = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Power' -Name 'HibernateEnabled' -ErrorAction SilentlyContinue
if ($null -ne $hibProp) { $hibEnabled = $hibProp.HibernateEnabled }
if ($hibEnabled -eq 0) { Write-Field 'hibernate' 'OFF (good)' 'Green' }
elseif ($null -eq $hibEnabled) { Write-Field 'hibernate' '(unknown - key absent)' 'Yellow' }
else { Write-Field 'hibernate' "ON ($hibEnabled) - run setup_power.ps1" 'Yellow' }

# --- COM ports (report only) ---------------------------------------------
Write-Host ''
Write-Host 'COM ports (report only - never touched)' -ForegroundColor Cyan
$comPorts = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\(COM\d+\)' } |
    Sort-Object Name
if ($comPorts) {
    foreach ($p in $comPorts) {
        Write-Host ('    ' + $p.Name) -ForegroundColor Gray
    }
    Write-Host '    (report any VSN1/ESP32 boards to the operator - do not flash from here)' -ForegroundColor DarkGray
} else {
    Write-Field 'devices' '(none)' 'Gray'
}

Write-Host ''
Write-Host '===========================================================' -ForegroundColor Cyan
Write-Host 'Read-only verify complete - nothing was changed.' -ForegroundColor Green
Write-Host ''
