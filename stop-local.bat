@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0package.json" (
  echo [!] Extract the zip first, then run this file from the extracted folder.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\stop-local.ps1" %*
if errorlevel 1 pause
