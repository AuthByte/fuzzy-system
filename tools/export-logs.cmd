@echo off
setlocal
cd /d "%~dp0\.."
echo.
echo BlockLogger - export Minecraft logs to JSON files
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install from https://nodejs.org then run this again.
  pause
  exit /b 1
)
node tools\pull-minecraft-logs.mjs --open
echo.
pause
