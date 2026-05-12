@echo off
setlocal
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo [Age of War] dist build not found. Building first...
  call npm.cmd run build
  if errorlevel 1 (
    echo [Age of War] Build failed.
    pause
    exit /b 1
  )
)

echo [Age of War] Starting server at http://localhost:3000
echo [Age of War] Keep this window open while playing.
node server\index.js
pause
