@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 윈도우가 켜질 때 서버가 자동으로 시작되도록 작업 스케줄러에 등록합니다. (관리자 권한 필요)
for /f "delims=" %%n in ('where node') do set NODE=%%n
schtasks /Create /F /SC ONSTART /RU SYSTEM /RL HIGHEST /TN "GWFOOD 서버" /TR "\"%NODE%\" \"%~dp0server\server.js\"" && echo 등록했습니다. 해제: schtasks /Delete /TN "GWFOOD 서버" /F
pause
