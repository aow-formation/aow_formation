@echo off
setlocal
cd /d "%~dp0"

echo [Age of War] Starting Vite dev server.
echo [Age of War] Keep this window open while developing.
npm.cmd run dev
pause
