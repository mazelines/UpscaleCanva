[CmdletBinding()]
param([switch]$Repair)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
$projectRoot = $script:SetupRoot
Set-Location -LiteralPath $projectRoot
if (-not [Environment]::Is64BitProcess -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'UpscaleCanva requires Windows x64 and 64-bit PowerShell.'
}
if ($projectRoot.StartsWith('\\')) { throw 'Extract the project to a local writable folder, then run Setup.cmd.' }
foreach ($folder in @('models','input','output','workflows','downloads','docs','logs','runtime','runtime/temp')) {
    New-Item -ItemType Directory -Force -Path (Get-SetupPath $folder) | Out-Null
}
Set-ProjectEnvironment
$lock = $null
$transcribing = $false
try {
    try { $lock = [IO.File]::Open((Get-SetupPath 'runtime/setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another setup is running for this project. Wait for that window to finish, then try again.' }
    Start-Transcript -Path (Get-SetupPath 'logs/setup.log') -Append | Out-Null
    $transcribing = $true
    Write-Host 'UpscaleCanva development environment'
    Write-Host 'First setup downloads several GB. Keep this window open; rerun to resume after a failure.'
    if (-not (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32/nvcuda.dll'))) {
        throw 'NVIDIA CUDA driver not found. Install the NVIDIA graphics driver for your GPU, restart Windows, then retry. A separate CUDA Toolkit is not needed.'
    }
    $manifest = Get-Content -LiteralPath (Get-SetupPath 'scripts/runtime-manifest.json') -Raw | ConvertFrom-Json
    Write-Host '[1/6] Preparing project-local Git, Node.js and uv...'
    foreach ($artifact in $manifest.tools) { Install-SetupArchive $artifact }
    $node = Get-SetupPath 'runtime/node/node.exe'
    $uv = Get-SetupPath 'runtime/uv/uv.exe'
    Invoke-SetupCommand $node @('--version') 'Node.js validation'
    Invoke-SetupCommand $uv @('--version') 'uv validation'
    Invoke-SetupCommand (Get-SetupPath 'runtime/git/cmd/git.exe') @('--version') 'Git validation'
    Install-VisualCppRuntime
    $python = Get-SetupPath '.venv/Scripts/python.exe'
    $pythonReady = $false
    if (Test-Path -LiteralPath $python) {
        try {
            $details = @(& $python -c 'import sys; print(sys.version.split()[0]); print(sys.base_prefix)' 2>$null)
            $pythonReady = $LASTEXITCODE -eq 0 -and $details.Count -eq 2 -and $details[0] -eq $manifest.python -and
                $details[1].StartsWith((Get-SetupPath 'runtime/python') + '\', [StringComparison]::OrdinalIgnoreCase)
        } catch { $pythonReady = $false }
    }
    $statePath = Get-SetupPath 'runtime/setup-complete.json'
    $fingerprint = Get-SetupFingerprint
    $state = $null
    if (Test-Path -LiteralPath $statePath) {
        try { $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $state = $null }
    }
    $modelsReady = $true
    foreach ($model in $manifest.models) {
        $file = Get-SetupPath $model.file
        if (-not (Test-Path -LiteralPath $file) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $model.sha256) { $modelsReady = $false }
    }
    $guiReady = (Test-Path -LiteralPath (Get-SetupPath 'apps/chaiNNer/chaiNNer.exe')) -and
        (Test-Path -LiteralPath (Get-SetupPath 'vendor/chaiNNer-0.25.1/src/main/SaveFile.ts')) -and
        (Test-Path -LiteralPath (Get-SetupPath 'docs/chainner-schema.json')) -and
        (Test-Path -LiteralPath (Get-SetupPath 'apps/chaiNNer/settings.json'))
    if (-not $Repair -and $pythonReady -and $modelsReady -and $guiReady -and $state -and
        $state.root -eq $projectRoot -and $state.fingerprint -eq $fingerprint) {
        try {
            Invoke-SetupCommand $python @('-X','utf8',(Get-SetupPath 'scripts/diagnostics.py'),'--quiet') 'Environment validation'
            Write-Host 'Environment is ready. Reusing the installed runtime; no downloads needed.'
            return
        } catch { Write-Host "Existing environment needs repair: $($_.Exception.Message)" }
    }
    $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($projectRoot))
    if ($drive.AvailableFreeSpace -lt 12GB) { throw 'At least 12 GB of free disk space is required for setup and downloads.' }
    Write-Host '[2/6] Preparing Python 3.10 and the virtual environment...'
    if (-not $pythonReady) {
        if (Test-Path -LiteralPath (Get-SetupPath '.venv')) { Move-SetupBackup '.venv' }
        Invoke-SetupCommand $uv @('python','install',$manifest.python,'--no-bin','--no-registry') 'Python download'
        Invoke-SetupCommand $uv @('venv','--python',$manifest.python,'--managed-python','--seed',(Get-SetupPath '.venv')) 'Virtual environment creation'
    }
    Write-Host '[3/6] Installing CUDA PyTorch and image processing packages...'
    Invoke-SetupCommand $uv @('pip','install','--python',$python,'-r',(Get-SetupPath 'requirements-torch.txt')) 'CUDA PyTorch installation'
    Invoke-SetupCommand $uv @('pip','install','--python',$python,'-r',(Get-SetupPath 'requirements.txt')) 'Image processing dependencies'
    Write-Host '[4/6] Preparing models and chaiNNer...'
    foreach ($model in $manifest.models) { Get-VerifiedDownload $model.url $model.file $model.sha256 | Out-Null }
    foreach ($artifact in $manifest.gui) { Install-SetupArchive $artifact -ReuseExisting }
    Write-Host '[5/6] Installing chaiNNer dependencies and configuring workflows...'
    & (Join-Path $PSScriptRoot 'Install-ChaiNNerDeps.ps1') -UvPath $uv
    Invoke-SetupCommand $python @('-X','utf8',(Get-SetupPath 'scripts/export_chainner_schema.py')) 'chaiNNer node registry'
    Invoke-SetupCommand $node @((Get-SetupPath 'scripts/configure_chainner.mjs')) 'chaiNNer configuration'
    Write-Host '[6/6] Checking dependencies and running a CUDA operation...'
    Invoke-SetupCommand $uv @('pip','check','--python',$python) 'Python dependency check'
    Invoke-SetupCommand $python @('-X','utf8',(Get-SetupPath 'scripts/diagnostics.py')) 'CUDA validation'
    $record = @{ root = $projectRoot; fingerprint = $fingerprint; completedAt = (Get-Date).ToUniversalTime().ToString('o') }
    [IO.File]::WriteAllText("$statePath.partial", ($record | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath "$statePath.partial" -Destination $statePath -Force
    Write-Host 'Setup complete. Use Start-Web.cmd to open the app or Dev-Shell.cmd to develop.'
} catch {
    Write-Host "SETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($lock) { $lock.Dispose() }
}
