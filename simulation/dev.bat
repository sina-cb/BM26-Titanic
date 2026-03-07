@echo off
REM ─── BM26 Titanic Simulation — Dev Environment ───────────────────────
REM Starts: HTTP file server (8080) + Save server (8181) + Puppeteer browser
REM Usage:  dev.bat
REM Stop:   Ctrl+C (kills all child processes)

echo.
echo  ┌──────────────────────────────────────────┐
echo  │  🚢  BM26 Titanic — Dev Environment      │
echo  │  HTTP server:  http://localhost:8080      │
echo  │  Save server:  http://localhost:8181      │
echo  └──────────────────────────────────────────┘
echo.

cd /d "%~dp0"
npx concurrently -n "HTTP,SAVE,BROWSER" -c "cyan,yellow,green" "npx http-server ../ -p 8080 -c-1 --cors" "node save-server.js" "node agent_render.js --open"
