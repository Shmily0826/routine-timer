@echo off
REM ============================================================
REM  Upload this mini program as a new "dev version" so you can
REM  promote it to the long-lived 体验版 (experience version).
REM
REM  Why: preview QR codes expire in ~25 minutes and real-device
REM  debugging needs the phone on the same network. The experience
REM  version lives on WeChat's servers, so its QR code keeps
REM  working and works from anywhere.
REM
REM  Usage:
REM    upload-experience.bat
REM    upload-experience.bat --version 1.0.3
REM    upload-experience.bat -v 1.0.3 -d "fix frozen again button"
REM
REM  After it finishes, set the new dev version as the experience
REM  version in mp.weixin.qq.com -> Manage -> Version Management.
REM  See RELEASE.md for the full release + review checklist.
REM
REM  IMPORTANT: run this by double-clicking it from your own
REM  desktop session. Headless/agent sessions cannot start the IDE
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

"%NODE_EXE%" "scripts\automation\upload-experience.js" %*

echo.
echo ============================================================
echo  Done. If the upload succeeded, go to mp.weixin.qq.com
echo  -^> Manage -^> Version Management and click
echo  "Set as experience version" on the version just uploaded.
echo ============================================================
echo.
pause
