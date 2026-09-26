@echo off
cd /d "%~dp0"
echo Starting Friendpad on http://localhost:8000 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8000
pause
