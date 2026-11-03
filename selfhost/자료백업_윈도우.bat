@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist backups mkdir backups
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set D=%%d
node server\backup.js export backups\gwfood-%D%.json
echo 백업 파일: backups\gwfood-%D%.json  (안전한 곳에 따로 보관하세요)
pause
