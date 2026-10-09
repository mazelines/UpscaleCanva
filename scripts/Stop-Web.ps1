$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot 'web\control.mjs') stop
if ($LASTEXITCODE -ne 0) { throw 'Web server could not stop.' }
