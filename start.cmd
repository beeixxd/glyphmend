@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    start "" http://localhost:8787
    "C:\Program Files\nodejs\node.exe" server.cjs
  ) else (
    echo Please install Node.js LTS first: https://nodejs.org/
    pause
  )
) else (
  start "" http://localhost:8787
  node server.cjs
)
