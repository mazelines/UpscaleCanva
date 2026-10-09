[CmdletBinding()]
param([switch]$Foreground, [string]$NodePath = 'node')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& (Join-Path $projectRoot '.venv\Scripts\python.exe') -X utf8 (Join-Path $PSScriptRoot 'diagnostics.py')
if ($LASTEXITCODE -ne 0) { throw 'CUDA preflight failed. Web server was not started.' }
if ($Foreground) {
    & $NodePath (Join-Path $projectRoot 'web\server.mjs')
} else {
    & $NodePath (Join-Path $projectRoot 'web\control.mjs') start
}
if ($LASTEXITCODE -ne 0) { throw 'Web server failed. See logs/web-server.log.' }
Write-Output 'No login needed. Show URLs: .\scripts\Show-WebAccess.ps1'
