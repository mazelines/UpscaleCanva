[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force -Path models,input,output,workflows,scripts,downloads,docs,logs,runtime | Out-Null
$env:UV_PYTHON_INSTALL_DIR = Join-Path $projectRoot 'runtime\python'
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.cache\pip'
function Get-Artifact([string]$Url, [string]$RelativePath, [string]$ExpectedSha256 = '') {
    $target = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $target)) {
        & curl.exe --fail --location --retry 3 --output "$target.partial" $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
        Move-Item -LiteralPath "$target.partial" -Destination $target
    }
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ExpectedSha256 -and $hash -ne $ExpectedSha256) { throw "SHA256 mismatch: $target" }
    [PSCustomObject]@{url=$Url;path=$RelativePath;sha256=$hash;bytes=(Get-Item -LiteralPath $target).Length}
}
$artifacts = @()
$artifacts += Get-Artifact 'https://github.com/chaiNNer-org/chaiNNer/releases/download/v0.25.1/chaiNNer-windows-x64-0.25.1-portable.zip' 'downloads\chaiNNer-windows-x64-0.25.1-portable.zip' 'ab06e3a8cf036ff76440fc162539b2c4c62abee99dd452ce0bf9c313d63450ed'
$artifacts += Get-Artifact 'https://github.com/chaiNNer-org/chaiNNer/archive/refs/tags/v0.25.1.zip' 'downloads\chaiNNer-v0.25.1-source.zip'
$artifacts += Get-Artifact 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth' 'models\RealESRGAN_x2plus.pth' '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb'
$artifacts += Get-Artifact 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth' 'models\RealESRGAN_x4plus_anime_6B.pth' 'f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da'
$artifacts | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'docs\artifacts.json')
if (-not (Test-Path -LiteralPath 'apps\chaiNNer')) { Expand-Archive -LiteralPath 'downloads\chaiNNer-windows-x64-0.25.1-portable.zip' -DestinationPath 'apps\chaiNNer' }
if (-not (Test-Path -LiteralPath 'vendor\chaiNNer-0.25.1')) { Expand-Archive -LiteralPath 'downloads\chaiNNer-v0.25.1-source.zip' -DestinationPath 'vendor' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & uv venv --python 3.10.20 --seed .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed' }
}
& uv pip install --python '.venv\Scripts\python.exe' 'torch==2.7.0+cu128' 'torchvision==0.22.0+cu128' --index-url 'https://download.pytorch.org/whl/cu128'
if ($LASTEXITCODE -ne 0) { throw 'CUDA PyTorch installation failed' }
& uv pip install --python '.venv\Scripts\python.exe' 'spandrel==0.4.1' 'numpy==1.24.4' 'Pillow==9.2.0' 'PyYAML==6.0.3'
if ($LASTEXITCODE -ne 0) { throw 'Inference dependencies installation failed' }
& '.venv\Scripts\python.exe' -X utf8 -c 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available()); assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0))'
if ($LASTEXITCODE -ne 0) { throw 'CUDA validation failed' }
& (Join-Path $PSScriptRoot 'Install-ChaiNNerDeps.ps1')
& '.venv\Scripts\python.exe' -X utf8 (Join-Path $PSScriptRoot 'export_chainner_schema.py')
if ($LASTEXITCODE -ne 0) { throw 'chaiNNer node schema validation failed' }
& node (Join-Path $PSScriptRoot 'configure_chainner.mjs')
if ($LASTEXITCODE -ne 0) { throw 'chaiNNer configuration failed' }
