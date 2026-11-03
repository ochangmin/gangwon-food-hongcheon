@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 강원 먹거리 이음 서버
if not exist .env copy .env.example .env >nul
echo 서버를 시작합니다. 이 창을 닫으면 서버도 멈춥니다.
echo 브라우저에서 http://localhost:8080 을 여세요.
echo.
node server\server.js
echo.
echo 서버가 멈췄습니다.
pause
