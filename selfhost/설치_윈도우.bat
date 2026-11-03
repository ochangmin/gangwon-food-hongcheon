@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title 강원 먹거리 이음 서버 설치
echo.
echo [1/3] Node.js 확인
node -v >nul 2>nul && goto hasnode
echo Node.js 가 없어 설치를 시도합니다 (winget, LTS).
winget install -e --id OpenJS.NodeJS.LTS
echo.
echo 설치가 끝나면 이 창을 닫고 "설치_윈도우.bat" 을 한 번 더 실행하세요.
pause
exit /b 0
:hasnode
for /f %%v in ('node -v') do echo   Node.js %%v
echo [2/3] 설정 파일
if not exist .env copy .env.example .env >nul && echo   .env 를 만들었습니다 (필요하면 메모장으로 고치세요).
if not exist storage mkdir storage
echo [3/3] 방화벽 (관리자 권한일 때만)
netsh advfirewall firewall add rule name="GWFOOD 8080" dir=in action=allow protocol=TCP localport=8080 >nul 2>nul && echo   8080 포트를 열었습니다. || echo   방화벽은 바꾸지 않았습니다 (다른 PC에서 접속하려면 관리자 권한으로 다시 실행).
echo.
echo 설치 완료. "실행_윈도우.bat" 으로 서버를 시작하세요.
pause
