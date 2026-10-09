$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
& (Get-ProjectNode) (Join-Path $projectRoot 'web\control.mjs') stop
if ($LASTEXITCODE -ne 0) { throw 'Web server could not stop.' }
