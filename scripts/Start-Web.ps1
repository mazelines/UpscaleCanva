[CmdletBinding()]
param([switch]$Foreground, [string]$NodePath, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& (Join-Path $PSScriptRoot 'Install-Local.ps1')
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
Set-ProjectEnvironment
if (-not $NodePath) { $NodePath = Get-ProjectNode }
if ($Foreground) {
    & $NodePath (Join-Path $projectRoot 'web\server.mjs')
} else {
    & $NodePath (Join-Path $projectRoot 'web\control.mjs') start
}
if ($LASTEXITCODE -ne 0) { throw 'Web server failed. See logs/web-server.log.' }
if (-not $NoBrowser -and -not $Foreground) {
    $config = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime/web/config.json') -Raw | ConvertFrom-Json
    $url = 'http://127.0.0.1:{0}' -f $config.port
    # Opening the app is the user's requested interactive action.
    try { Start-Process $url | Out-Null } catch { Write-Warning "Browser could not open. Visit $url" }
}
Write-Output 'No login needed. Show URLs: .\scripts\Show-WebAccess.ps1'
