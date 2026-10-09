[CmdletBinding()]
param([string]$UvPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
Set-ProjectEnvironment
Set-Location -LiteralPath $script:SetupRoot
if (-not $UvPath) { $UvPath = Get-SetupPath 'runtime/uv/uv.exe' }
$python = Get-SetupPath '.venv/Scripts/python.exe'
# Keep requirements/constraint arguments relative: uv can split constraint paths containing spaces.
Invoke-SetupCommand $UvPath @('pip','install','--python',$python,'-r','docs/gui-requirements.txt','-c','requirements.txt') 'chaiNNer dependencies'
$wheel = 'apps/chaiNNer/resources/src/dependencies/whls/chainner-pip/chainner_pip-23.2.0-py3-none-any.whl'
Invoke-SetupCommand $UvPath @('pip','install','--python',$python,$wheel,'setuptools==79.0.1') 'chaiNNer pip and setuptools'
