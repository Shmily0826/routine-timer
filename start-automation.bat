@echo off
REM ============================================================
REM  WeChat DevTools Automation Launcher
REM  Double-click this file to start DevTools in automation mode
REM  and bind ws://127.0.0.1:9420 so WorkBuddy can drive tests.
REM
REM  IMPORTANT: you must run this from your own desktop session
REM  (double-click). Headless/agent sessions cannot start the IDE
REM  because Electron needs a real window station to render.
REM ============================================================

chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

REM ---- locate node.exe ----------------------------------------
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  if exist "C:\Users\Shmily\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" (
    set "NODE_EXE=C:\Users\Shmily\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
  )
)
if not defined NODE_EXE (
  echo.
  echo [ERROR] node.exe not found.
  echo         Install Node.js, or edit this .bat and set NODE_EXE manually.
  echo.
  pause
  exit /b 1
)

echo Using node: %NODE_EXE%
echo.

"%NODE_EXE%" "scripts\automation\start-automation.js" %*

echo.
echo ============================================================
echo  This launcher window can be closed now.
echo  The DevTools window it started is a separate process -
echo  keep THAT one open, not this one.
echo ============================================================
echo.
pause
