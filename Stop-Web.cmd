@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\Stop-Web.ps1"
set "stopExitCode=%ERRORLEVEL%"
if /I not "%~1"=="--no-pause" pause
exit /b %stopExitCode%
