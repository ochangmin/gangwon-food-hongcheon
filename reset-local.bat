@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo This deletes all local data (orders, receipts, accounts) and restores the demo data.
set /p ANSWER=Type RESET to continue: 
if /i not "%ANSWER%"=="RESET" goto cancel
if exist ".localdb" rmdir /s /q ".localdb"
echo Done. Run start-local.bat again.
pause
exit /b 0
:cancel
echo Canceled.
pause
