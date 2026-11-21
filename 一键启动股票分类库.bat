@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Stock Sector Library Server

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install Node.js 18 or newer: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\next\package.json" (
  echo Installing dependencies for the first run...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed. Please check the network and try again.
    pause
    exit /b 1
  )
)

if exist ".next-dev" (
  echo Cleaning old development cache...
  rmdir /s /q ".next-dev"
)

echo Starting stock sector library...
echo Browser will open automatically. Keep this window open while using the page.
echo Close this window to stop the service.
echo.

start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$limit=(Get-Date).AddSeconds(30); while((Get-Date) -lt $limit) { try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 1; if($r.StatusCode -eq 200) { Start-Process 'http://localhost:3000'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; Start-Process 'http://localhost:3000'"

call npm.cmd run dev

endlocal
