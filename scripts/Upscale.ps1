[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$InputPath,
    [string]$OutputFolder,
    [ValidateSet('RealESRGAN_x2plus','RealESRGAN_x4plus_anime_6B','both')]
    [string]$Model = 'RealESRGAN_x2plus',
    [ValidateRange(32,8192)][int]$TileSize = 256,
    [switch]$Recurse
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Missing project Python: $pythonExe" }
if (-not $OutputFolder) { $OutputFolder = Join-Path $projectRoot 'output' }
$cliArgs = @('-X','utf8',(Join-Path $PSScriptRoot 'upscale.py'),'--input',$InputPath,'--output',$OutputFolder,'--model',$Model,'--tile',"$TileSize")
if ($Recurse) { $cliArgs += '--recursive' }
& $pythonExe @cliArgs
if ($LASTEXITCODE -ne 0) { throw "Upscale failed (exit $LASTEXITCODE). See the error and logs folder." }
