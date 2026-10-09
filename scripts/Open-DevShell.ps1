$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Install-Local.ps1')
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
Set-ProjectEnvironment
Set-Location -LiteralPath $script:SetupRoot
Write-Host 'UpscaleCanva development shell: git, node, npm, uv, python and pip are ready.'
Write-Host 'This PATH applies only to this shell. Run .\Start-Web.cmd to open the app.'
