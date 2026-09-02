@echo off
REM ============================================================
REM  Mini Program Preview QR Code Generator
REM
REM  Double-click to compile the project and generate a preview
REM  QR code. Scan it with WeChat on your phone to open the
REM  latest dev build.
REM
REM  Unlike "remote debug on device", this does NOT require the
REM  phone and PC to be on the same subnet - the code is uploaded
REM  to WeChat servers, so campus/corporate Wi-Fi isolation does
REM  not break it.
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

"%NODE_EXE%" "scripts\automation\preview-qrcode.js" %*

echo.
pause
