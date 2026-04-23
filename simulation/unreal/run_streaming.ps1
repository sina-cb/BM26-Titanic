# ============================================================
# BM26-Titanic Unreal Pixel Streaming Launcher
# ============================================================
# Usage:  powershell -ExecutionPolicy Bypass -File run_streaming.ps1
#
# Prerequisites:
#   - MarsinEngine must already be running separately (sACN on :5568)
#   - Unreal scene must be ingested via deploy/deploy.py
# ============================================================

Write-Host ""
Write-Host "  ==============================================" -ForegroundColor DarkCyan
Write-Host "   BM26-Titanic  |  Unreal Pixel Streaming     " -ForegroundColor Cyan
Write-Host "  ==============================================" -ForegroundColor DarkCyan
Write-Host ""

# --- Step 1: Kill any existing processes ---
Write-Host "  [1/2] Cleaning up old processes..." -ForegroundColor Yellow

# Kill old signalling server (node on port 80)
$oldNodes = Get-NetTCPConnection -LocalPort 80 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $oldNodes) {
    Write-Host "        Killing old signalling server (PID $procId)" -ForegroundColor DarkGray
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

# Kill old Unreal Editor
$ueProcs = Get-Process -Name "UnrealEditor" -ErrorAction SilentlyContinue
foreach ($p in $ueProcs) {
    Write-Host "        Killing old Unreal Editor (PID $($p.Id))" -ForegroundColor DarkGray
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

# --- Step 2: Start Signalling Server in background ---
Write-Host "  [2/2] Starting Signalling Server on :80..." -ForegroundColor Yellow

$ssProcess = Start-Process cmd.exe -ArgumentList '/c "cd /d C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal\PixelStreamingInfrastructure\SignallingWebServer && npm start"' -PassThru -WindowStyle Hidden
Write-Host "        Signalling Server PID: $($ssProcess.Id)" -ForegroundColor DarkGray

Start-Sleep -Seconds 3

# --- Step 3: Launch Unreal Editor (foreground, blocks this terminal) ---
Write-Host ""
Write-Host "  ==============================================" -ForegroundColor Green
Write-Host "   Launching Unreal Editor (headless)           " -ForegroundColor Green
Write-Host "   Stream:  http://localhost                     " -ForegroundColor Yellow
Write-Host "   Press Ctrl+C to stop                         " -ForegroundColor DarkGray
Write-Host "  ==============================================" -ForegroundColor Green
Write-Host ""

# --- Configuration ---
$ResX = 1920
$ResY = 1080
# ---------------------

$UnrealExe = "C:\Program Files\Epic Games\UE_5.7\Engine\Binaries\Win64\UnrealEditor.exe"
$Uproject = "C:\Users\sina_\workspace\BM26-Titanic\simulation\unreal\BM26_Unreal.uproject"

$ueArgs = @(
    "`"$Uproject`"",
    "-AudioMixer",
    "-PixelStreamingConnectionURL=ws://localhost:8888",
    "-RenderOffScreen",
    "-Windowed",
    "-ForceRes",
    "-ResX=$ResX",
    "-ResY=$ResY",
    "-dpcvars=PixelStreaming2.Editor.StartOnLaunch=true,PixelStreaming2.Editor.UseRemoteSignallingServer=true,PixelStreaming2.Editor.Source=LevelEditorViewport"
)

$ueProcess = Start-Process -FilePath $UnrealExe -ArgumentList $ueArgs -NoNewWindow -PassThru -Wait

# Cleanup when Unreal exits
Write-Host ""
Write-Host "  Unreal exited (code $($ueProcess.ExitCode)). Stopping signalling server..." -ForegroundColor Yellow
Stop-Process -Id $ssProcess.Id -Force -ErrorAction SilentlyContinue
Write-Host "  Done." -ForegroundColor Green
