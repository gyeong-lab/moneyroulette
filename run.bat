@echo off
chcp 65001 > nul
title 단발 용돈룰렛 관리 시스템
echo ========================================================
echo         단발 용돈룰렛 관리 시스템을 시작합니다...
echo ========================================================
echo.
echo [1] 서버를 실행하는 중입니다 (http://localhost:8000)
echo [2] 잠시 후 웹 브라우저가 자동으로 열립니다.
echo.

start "" "http://localhost:8000"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
pause
