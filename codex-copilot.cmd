@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Codex-With-Copilot.ps1" %*
exit /b %errorlevel%
