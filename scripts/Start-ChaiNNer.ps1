[CmdletBinding()]
param(
    [string]$InputPath,
    [ValidateRange(32,8192)][int]$TileSize = 256,
    [switch]$VerifyWindow
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not $InputPath) { $InputPath = Join-Path $projectRoot 'input\_synthetic_test\arion_pipeline_test.png' }
$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
& $pythonExe -X utf8 (Join-Path $PSScriptRoot 'diagnostics.py')
if ($LASTEXITCODE -ne 0) { throw 'CUDA preflight failed. GUI launch stopped.' }
$env:PYTHONNOUSERSITE = '1'
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.cache\pip'
$env:TEMP = Join-Path $projectRoot 'runtime\temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$session = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$workflow = Join-Path $projectRoot "workflows\sessions\ARION-compare-2x-$session.chn"
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
& (Get-ProjectNode) (Join-Path $PSScriptRoot 'build_workflow.mjs') $inputFile "$TileSize" $workflow
if ($LASTEXITCODE -ne 0) { throw 'Workflow generation failed' }
$guiExe = Join-Path $projectRoot 'apps\chaiNNer\chaiNNer.exe'
# This is the interactive GUI requested by the user, so show its window.
Start-Process -FilePath $guiExe -ArgumentList @('open', ('"' + $workflow + '"')) -WorkingDirectory (Split-Path $guiExe) -WindowStyle Normal | Out-Null
Write-Output "Opened chaiNNer workflow: $workflow"
if ($VerifyWindow) {
    $match = $null
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 500
        $match = Get-Process -Name chaiNNer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*$workflow*" } | Select-Object -First 1
    } until ($match -or (Get-Date) -gt $deadline)
    $report = [PSCustomObject]@{workflow=$workflow;windowTitle=$match.MainWindowTitle;pid=$match.Id;openedWithWorkflowTitle=[bool]$match;checkedAt=(Get-Date -Format o)}
    $report | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $projectRoot 'docs\gui-open-test.json')
    if (-not $match) { throw 'Could not verify the GUI workflow title. Inspect the chaiNNer window and logs.' }
    Write-Output "GUI open verified: $($match.MainWindowTitle)"
}
