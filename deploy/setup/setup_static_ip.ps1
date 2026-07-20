# setup_static_ip.ps1 - Show-server bring-up step 7 (docs/43): static IP.
#
# Assigns a static IPv4 address to the active physical Ethernet adapter so the
# server has a stable address on the show LAN (recorded in
# deploy/machines.yaml). Virtual adapters (Hyper-V, loopback, VPN, Wi-Fi) are
# ignored.
#
# CAUTION: changing the IP of the adapter you are connected over WILL drop a
# remote (SSH/RDP) session. This prints a warning before applying.
#
# No-fallback / idempotency rules (codex P0):
#   - the adapter already has exactly the requested IP -> SKIP;
#   - more than one candidate physical adapter is Up   -> hard FAIL, listing
#     them (never guess which NIC to reconfigure).
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_static_ip.ps1 `
#       -StaticIp 192.0.2.50 -PrefixLength 24 -Gateway 192.0.2.1 -Dns 192.0.2.1
# Or via the orchestrator: deploy\server_setup.ps1 -StaticIp 192.0.2.50 ...
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [Parameter(Mandatory = $true)]
    [string]$StaticIp,
    [int]$PrefixLength = 24,
    [string]$Gateway,
    [string[]]$Dns
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

Write-Host "Static IP configuration ($StaticIp/$PrefixLength):" -ForegroundColor Cyan

# Candidate = physical, Up, non-virtual Ethernet adapters.
$candidates = Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Virtual|Hyper-V|Loopback|VPN' }

if (-not $candidates) {
    throw 'No physical Ethernet adapter is Up - cannot assign a static IP (no fallback, codex P0).'
}

$count = @($candidates).Count
if ($count -gt 1) {
    $list = ($candidates | ForEach-Object { "$($_.Name) [$($_.InterfaceDescription)]" }) -join '; '
    throw ("Multiple candidate physical adapters are Up ($list). Refusing to guess which " +
        "NIC to reconfigure - specify the intended adapter manually (no fallback, codex P0).")
}

$adapter = @($candidates)[0]
Write-Host "  adapter: $($adapter.Name) [$($adapter.InterfaceDescription)]" -ForegroundColor DarkGray

# Already set to exactly the requested address?
$currentIp = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $StaticIp -and $_.PrefixLength -eq $PrefixLength }
if ($currentIp) {
    # The address is right, but a re-run must also HEAL a machine where DHCP is
    # still enabled on the interface: with DHCP on, the adapter dual-addresses
    # and the DHCP server's gateway/DNS can override our static config. Check
    # and repair the DHCP state so one re-run fixes a half-configured box.
    $dhcpRepaired = $false
    $iface = Get-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
    if ($iface -and $iface.Dhcp -ne 'Disabled') {
        Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled
        Write-Host "  REPAIR: DHCP was enabled on $($adapter.Name) - disabled it (static config only)." -ForegroundColor Yellow
        $dhcpRepaired = $true
    }
    if ($dhcpRepaired) {
        Write-Host "  SKIP: $($adapter.Name) already has $StaticIp/$PrefixLength (DHCP disabled by repair)." -ForegroundColor Green
    } else {
        Write-Host "  SKIP: $($adapter.Name) already has $StaticIp/$PrefixLength." -ForegroundColor Green
    }
    $skipDetail = "$($adapter.Name) already $StaticIp/$PrefixLength"
    if ($dhcpRepaired) { $skipDetail += '; DHCP disabled (repaired)' }
    return (Write-StepResult ([PSCustomObject]@{
        Step   = 'Static IP'
        Status = 'SKIP'
        Detail = $skipDetail
    }))
}

Write-Host ("  WARNING: reconfiguring $($adapter.Name) now - if you are connected over this " +
    'adapter your session will drop. The new address is where you reconnect.') -ForegroundColor Yellow

# Clear existing manual IPv4 config on this interface, then apply the new one.
# Remove existing IPv4 addresses (leave APIPA/link-local alone via family filter).
Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -ne 'WellKnown' } |
    ForEach-Object { Remove-NetIPAddress -InputObject $_ -Confirm:$false -ErrorAction SilentlyContinue }

# Remove existing default routes on this interface.
Get-NetRoute -InterfaceIndex $adapter.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-NetRoute -InputObject $_ -Confirm:$false -ErrorAction SilentlyContinue }

$newArgs = @{
    InterfaceIndex = $adapter.ifIndex
    IPAddress      = $StaticIp
    PrefixLength   = $PrefixLength
    AddressFamily  = 'IPv4'
}
if ($Gateway) { $newArgs['DefaultGateway'] = $Gateway }

# Disable DHCP on this interface FIRST. New-NetIPAddress adds a manual address
# but does NOT turn DHCP off; on a LAN with a DHCP server the adapter would
# dual-address and DHCP's gateway/DNS could override ours. This makes the
# static config authoritative.
Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled

New-NetIPAddress @newArgs | Out-Null
Write-Host "  DONE: $($adapter.Name) set to $StaticIp/$PrefixLength." -ForegroundColor Green

if ($Dns -and $Dns.Count -gt 0) {
    Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $Dns
    Write-Host "  DNS servers: $($Dns -join ', ')" -ForegroundColor Green
}

$detailBits = @("$($adapter.Name) = $StaticIp/$PrefixLength")
if ($Gateway) { $detailBits += "gw $Gateway" }
if ($Dns -and $Dns.Count -gt 0) { $detailBits += "dns $($Dns -join ',')" }

Write-StepResult ([PSCustomObject]@{
    Step   = 'Static IP'
    Status = 'DONE'
    Detail = ($detailBits -join ', ')
})
