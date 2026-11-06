@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gangwon Meal Eum - local
if not exist "%~dp0package.json" goto noextract
where node >nul 2>nul
if errorlevel 1 goto nonode
if exist "node_modules\next\package.json" goto run
echo.
echo Installing packages - first run only, 1-3 minutes...
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail
:run
node scripts\local\run.mjs %*
echo.
pause
exit /b 0
:noextract
echo [!] Extract the zip first, then run start-local.bat inside the extracted folder.
pause
exit /b 1
:nonode
echo [!] Node.js is not installed. Install the LTS version from https://nodejs.org and run again.
pause
exit /b 1
:npmfail
echo [!] npm install failed. Check the internet connection and run again.
pause
exit /b 1
