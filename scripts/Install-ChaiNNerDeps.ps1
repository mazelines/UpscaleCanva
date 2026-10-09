$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.cache\uv'
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.cache\pip'
& uv pip install --python '.venv\Scripts\python.exe' -r 'docs\gui-requirements.txt'
if ($LASTEXITCODE -ne 0) { throw 'chaiNNer GUI dependency installation failed' }
$wheel = 'apps\chaiNNer\resources\src\dependencies\whls\chainner-pip\chainner_pip-23.2.0-py3-none-any.whl'
& uv pip install --python '.venv\Scripts\python.exe' $wheel
if ($LASTEXITCODE -ne 0) { throw 'chaiNNer bundled pip installation failed' }
# chaiNNer pins tracerite 1.1.0, which still imports pkg_resources.
# Modern setuptools >=82 removed it. Use the wheel bundled with this project's Python.
$bundledSetuptools = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'runtime\python') -Filter 'setuptools-79.0.1-py3-none-any.whl' -Recurse -File | Select-Object -First 1
if (-not $bundledSetuptools) { throw 'Missing Python-bundled setuptools 79.0.1 wheel' }
& uv pip install --offline --python '.venv\Scripts\python.exe' $bundledSetuptools.FullName
if ($LASTEXITCODE -ne 0) { throw 'Bundled setuptools compatibility installation failed' }
& '.venv\Scripts\python.exe' -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Dependency verification failed' }
