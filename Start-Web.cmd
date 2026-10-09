@echo off
setlocal
title ARION Upscaler - Start Server
echo Starting the ARION upscaler web server...
echo.

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Web.ps1"
set "launcherExitCode=%ERRORLEVEL%"

echo.
if "%launcherExitCode%"=="0" (
    echo Server is ready. Closing this window will keep the server running.
) else (
    echo Server could not start. Check the error above and logs\web-server.log.
)
echo.
if /I not "%~1"=="--no-pause" pause
exit /b %launcherExitCode%
