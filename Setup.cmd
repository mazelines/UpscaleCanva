@echo off
setlocal
title UpscaleCanva - Development Setup
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Local.ps1"
set "setupExitCode=%ERRORLEVEL%"
if not "%setupExitCode%"=="0" echo Setup failed. See the error above and logs\setup.log. Run Setup.cmd again to retry.
if /I not "%~1"=="--no-pause" pause
exit /b %setupExitCode%
