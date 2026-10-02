@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    start "" http://localhost:8787
    "C:\Program Files\nodejs\node.exe" server.cjs
  ) else (
    echo 请先安装 Node.js LTS（18 或更高）: https://nodejs.org/
    pause
  )
) else (
  start "" http://localhost:8787
  node server.cjs
)
