# setup_boot_task.ps1 - Show-server bring-up step 8 (docs/43): boot task.
#
# Creates the Scheduled Task 'BM26TitanicStack' that launches the show stack
# supervisor at logon:
#   - Trigger: At log on of user `titanic`
#   - RunLevel: Highest (the stack claims ports / touches devices)
#   - Action:  powershell -NoProfile -ExecutionPolicy Bypass -File
#              C:\titanic\BM26-Titanic\deploy\boot_server.ps1
#   - Restart-on-failure: every 1 min, up to 3 times (RestartCount/Interval).
#
# Two independent restart layers, at two levels (do not conflate them):
#   - The SUPERVISOR (boot_server.ps1) relaunches the LAUNCHER in its own loop,
#     where it can log every relaunch properly (docs/43, boot chain).
#   - This task's Task-Scheduler restart-on-failure revives the SUPERVISOR
#     ITSELF. The trigger only fires AT LOGON, so before this a supervisor that
#     died or was killed mid-session (e.g. the operator closing its interactive
#     window - the field incident) stayed dead until the next reboot: nothing
#     restarted it. Restart-on-failure now brings the supervisor back when its
#     process ends abnormally, every 1 min for up to 3 attempts. Beyond that
#     budget it stays down until a reboot/logon (or `deploy.py start`) - a
#     bounded net, not an infinite one, so a genuinely broken box still parks.
#
# No-fallback / idempotency rules (codex P0):
#   - task exists with the SAME action -> SKIP;
#   - task exists with a DIFFERENT action -> hard FAIL (never silently rewrite);
#   - boot_server.ps1 not present yet -> still create the task, WARN (the file
#     arrives via Phase 2 deploy);
#   - user `titanic` not created yet -> WARN and skip (create the account
#     first, then re-run).
#
# Run standalone from an elevated PowerShell prompt:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup\setup_boot_task.ps1
# Or via the orchestrator: deploy\server_setup.ps1
#
# Full design: docs/43_show_server_deployment.md.

#Requires -RunAsAdministrator

param(
    [string]$TaskName = 'BM26TitanicStack',
    [string]$RepoRoot = 'C:\titanic\BM26-Titanic',
    [string]$LogonUser = 'titanic'
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

$bootScript = Join-Path $RepoRoot 'deploy\boot_server.ps1'
$exe = 'powershell.exe'
# The -File path is quoted so a RepoRoot containing spaces cannot produce an
# unparseable action. The same string is used for creation AND the
# idempotency comparison below, so re-runs still match exactly.
$argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$bootScript`""

Write-Host "Scheduled task '$TaskName':" -ForegroundColor Cyan

$warn = $false
$warnNote = ''

# The trigger fires for a real logon session - refuse to bind it to a user
# that does not exist yet.
if (-not (Get-LocalUser -Name $LogonUser -ErrorAction SilentlyContinue)) {
    Write-Host ("  WARN: local user '$LogonUser' does not exist yet - task NOT created. " +
        "Create the account (deploy\create_titanic_user.ps1), then re-run this script.") -ForegroundColor Yellow
    return (Write-StepResult ([PSCustomObject]@{
        Step   = 'Boot task'
        Status = 'WARN'
        Detail = "skipped - user '$LogonUser' missing; re-run after account creation"
    }))
}

if (-not (Test-Path $bootScript)) {
    Write-Host ("  WARN: $bootScript not present yet (Phase 2 tooling). " +
        'Creating the task anyway; it stays harmless until the file is deployed.') -ForegroundColor Yellow
    $warn = $true
    $warnNote = 'boot_server.ps1 missing (arrives via deploy)'
}

# Desired task definition - built once, then used for BOTH create and repair so
# a stale live task is healed to exactly what a fresh install would produce.
$action = New-ScheduledTaskAction -Execute $exe -Argument $argLine
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $LogonUser
$principal = New-ScheduledTaskPrincipal -UserId $LogonUser -RunLevel Highest -LogonType Interactive
# ExecutionTimeLimit PT0S = unlimited in PS 5.1. The DEFAULT is PT72H: Task
# Scheduler would KILL the supervisor (and the whole stack's process tree)
# exactly 72 h after boot - fatal across a multi-day burn. Battery flags keep
# the supervisor alive on a laptop that loses AC. RestartCount/RestartInterval
# revive the supervisor if its process ends abnormally (killed / crashed):
# 3 attempts, 1 min apart. This is the supervisor's own safety net - the trigger
# only fires at logon, so without it a mid-session death stayed dead until the
# next reboot.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    $act = $existing.Actions | Select-Object -First 1
    $curExe = "$($act.Execute)".Trim()
    $curArgs = "$($act.Arguments)".Trim()
    $sameExe = ($curExe -ieq $exe) -or ($curExe -ieq (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'))
    if ($sameExe -and ($curArgs -ieq $argLine)) {
        # Action matches. Now inspect the SETTINGS: a task created by an older
        # revision of this script (or the Task Scheduler default) carries the
        # fatal 72 h ExecutionTimeLimit, battery flags, and/or NO restart-on-
        # failure that differ from ours. If so, REPAIR by re-registering with the
        # same action/trigger/principal and the corrected settings, so a single
        # elevated re-run heals the live machine. Same action + same settings ->
        # SKIP as before.
        $curLimit = "$($existing.Settings.ExecutionTimeLimit)".Trim()
        $limitOk = ($curLimit -ieq 'PT0S')
        $batteryOk = (-not $existing.Settings.DisallowStartIfOnBatteries) -and `
            (-not $existing.Settings.StopIfGoingOnBatteries)
        # Restart-on-failure: an older task predating this setting reports
        # RestartCount 0 and an empty RestartInterval - REPAIR heals it to 3 / PT1M.
        $curRestartCount = [int]$existing.Settings.RestartCount
        $curRestartInterval = "$($existing.Settings.RestartInterval)".Trim()
        $restartOk = ($curRestartCount -eq 3) -and ($curRestartInterval -ieq 'PT1M')
        if ($limitOk -and $batteryOk -and $restartOk) {
            Write-Host "  SKIP: task '$TaskName' already exists with the expected action and settings." -ForegroundColor Green
            $status = 'SKIP'
            if ($warn) { $status = 'WARN' }
            return (Write-StepResult ([PSCustomObject]@{
                Step   = 'Boot task'
                Status = $status
                Detail = ("action + settings match; " + (@($warnNote) -join '') ).TrimEnd('; ').Trim()
            }))
        }
        Write-Host ("  REPAIR: task '$TaskName' exists but its settings are stale " +
            "(ExecutionTimeLimit '$curLimit', expected 'PT0S'; battery flags off; " +
            "restart-on-failure '$curRestartCount x $curRestartInterval', expected '3 x PT1M'). " +
            'Re-registering with corrected settings.') -ForegroundColor Yellow
        Register-ScheduledTask -TaskName $TaskName `
            -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
            -Description 'BM26 Titanic show-stack supervisor at logon (docs/43).' -Force | Out-Null
        Write-Host "  DONE: repaired task '$TaskName' settings (ExecutionTimeLimit unlimited; restart-on-failure 3 x 1 min)." -ForegroundColor Green
        $status = 'DONE'
        if ($warn) { $status = 'WARN' }
        return (Write-StepResult ([PSCustomObject]@{
            Step   = 'Boot task'
            Status = $status
            Detail = ("repaired settings (ExecutionTimeLimit unlimited; restart-on-failure 3 x 1 min); " + (@($warnNote) -join '')).TrimEnd('; ').Trim()
        }))
    } else {
        throw ("Scheduled task '$TaskName' already exists but its action differs " +
            "(found: '$curExe $curArgs'; expected: '$exe $argLine'). Refusing to " +
            "rewrite it - resolve manually (no fallback, codex P0).")
    }
}

# Create the task: logon trigger for $LogonUser, highest privileges, settings
# built above (unlimited ExecutionTimeLimit).
Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'BM26 Titanic show-stack supervisor at logon (docs/43).' | Out-Null

Write-Host "  DONE: created task '$TaskName' (at logon of '$LogonUser', highest privileges)." -ForegroundColor Green

if ($warn) { $status = 'WARN'; $detail = "task created; $warnNote" }
else       { $status = 'DONE'; $detail = "task created (at logon of '$LogonUser', highest)" }

Write-StepResult ([PSCustomObject]@{
    Step   = 'Boot task'
    Status = $status
    Detail = $detail
})
