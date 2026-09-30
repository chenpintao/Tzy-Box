@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current LTS from https://nodejs.org/
  pause
  exit /b 1
)
start "ZhongYu ToolBox" cmd /k node local_server.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8080/index.html
endlocal
