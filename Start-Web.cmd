@echo off
setlocal
title UpscaleCanva - Setup and Start
echo Preparing UpscaleCanva. First launch installs the development environment.
echo.

set "browserOption="
if /I "%~1"=="--no-browser" set "browserOption=-NoBrowser"
if /I "%~2"=="--no-browser" set "browserOption=-NoBrowser"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Web.ps1" %browserOption%
set "launcherExitCode=%ERRORLEVEL%"

echo.
if "%launcherExitCode%"=="0" (
    echo Server is ready. Closing this window will keep the server running.
) else (
    echo Setup or server start failed. Check logs\setup.log and logs\web-server.log.
)
echo.
if /I "%~1"=="--no-pause" goto finish
if /I "%~2"=="--no-pause" goto finish
pause
:finish
exit /b %launcherExitCode%
