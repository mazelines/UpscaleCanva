# Shared by the installer and launchers. No installation takes place when dot-sourced.
$script:SetupRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))

function Get-SetupPath([string]$RelativePath) {
    $resolved = [IO.Path]::GetFullPath((Join-Path $script:SetupRoot $RelativePath))
    if (-not $resolved.StartsWith($script:SetupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Setup path must stay inside the project: $RelativePath"
    }
    return $resolved
}

function Set-ProjectEnvironment {
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    $global:OutputEncoding = [Console]::OutputEncoding
    $env:UV_PYTHON_INSTALL_DIR = Get-SetupPath 'runtime/python'
    $env:UV_CACHE_DIR = Get-SetupPath '.cache/uv'
    $env:UV_PYTHON_INSTALL_BIN = '0'
    $env:UV_PYTHON_INSTALL_REGISTRY = '0'
    $env:UV_PYTHON_NO_REGISTRY = '1'
    $env:PIP_CACHE_DIR = Get-SetupPath '.cache/pip'
    $env:PYTHONNOUSERSITE = '1'
    $env:PYTHONUTF8 = '1'
    $env:PATH = @((Get-SetupPath '.venv/Scripts'), (Get-SetupPath 'runtime/node'),
        (Get-SetupPath 'runtime/uv'), (Get-SetupPath 'runtime/git/cmd'), $env:PATH) -join ';'
}

function Invoke-SetupCommand([string]$Executable, [string[]]$Arguments, [string]$Description) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Missing executable: $Executable" }
    # PowerShell 5 treats native stderr as error records; uv also writes normal progress there.
    # Forward both streams through Write-Host so the transcript records the actual installer output.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
        $commandExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($commandExitCode -ne 0) { throw "$Description failed (exit $commandExitCode). See logs/setup.log and run Setup.cmd again." }
}

function Get-VerifiedDownload([string]$Url, [string]$RelativePath, [string]$Sha256) {
    $destination = Get-SetupPath $RelativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $Sha256) {
        return $destination
    }
    $partial = "$destination.partial"
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Write-Host "Downloading $(Split-Path -Leaf $destination) (attempt $attempt/3)..."
            $client = New-Object Net.WebClient
            try { $client.DownloadFile($Url, $partial) } finally { $client.Dispose() }
            if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Sha256) {
                throw 'SHA256 verification failed. The downloaded file will not be executed.'
            }
            Move-Item -LiteralPath $partial -Destination $destination -Force
            return $destination
        } catch {
            if ($attempt -eq 3) { throw "Download failed: $Url. $($_.Exception.Message)" }
            Start-Sleep -Seconds 2
        }
    }
}

function Move-SetupBackup([string]$RelativePath) {
    $source = Get-SetupPath $RelativePath
    $destination = Get-SetupPath ('runtime/backups/' + (Split-Path -Leaf $source) + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    # Both absolute paths have been checked against the project root before moving a directory.
    Move-Item -LiteralPath $source -Destination $destination
    Write-Host "Previous files preserved at $destination"
}

function Install-SetupArchive($Artifact, [switch]$ReuseExisting) {
    $destination = Get-SetupPath $Artifact.directory
    $executable = Join-Path $destination $Artifact.executable
    $stamp = Join-Path $destination '.upscalecanva-sha256'
    if (Test-Path -LiteralPath $executable -PathType Leaf) {
        if ($ReuseExisting -or ((Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $Artifact.sha256)) { return }
    }
    Write-Host "Preparing $($Artifact.name)..."
    $archive = Get-VerifiedDownload $Artifact.url ('downloads/' + $Artifact.sha256 + '.zip') $Artifact.sha256
    $staging = Get-SetupPath ('runtime/staging/' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    $source = if ($Artifact.archiveRoot) { Join-Path $staging $Artifact.archiveRoot } else { $staging }
    $source = [IO.Path]::GetFullPath($source)
    if ($source -ne $staging -and -not $source.StartsWith($staging + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Archive root must stay inside the staging directory.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $source $Artifact.executable) -PathType Leaf)) {
        throw "Archive is missing $($Artifact.executable): $archive"
    }
    if (Test-Path -LiteralPath $destination) { Move-SetupBackup $Artifact.directory }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    # Staging and destination are both inside the project; no user image folders are touched.
    Move-Item -LiteralPath $source -Destination $destination
    [IO.File]::WriteAllText($stamp, $Artifact.sha256)
}

function Get-SetupFingerprint {
    $files = @('scripts/runtime-manifest.json', 'scripts/Setup-Helpers.ps1', 'scripts/Install-Local.ps1',
        'scripts/Install-ChaiNNerDeps.ps1', 'scripts/diagnostics.py', 'scripts/configure_chainner.mjs',
        'scripts/export_chainner_schema.py', 'requirements.txt', 'requirements-torch.txt', 'docs/gui-requirements.txt')
    return (($files | ForEach-Object { (Get-FileHash -LiteralPath (Get-SetupPath $_) -Algorithm SHA256).Hash }) -join ':')
}

function Get-ProjectNode {
    $localNode = Get-SetupPath 'runtime/node/node.exe'
    if (Test-Path -LiteralPath $localNode) { return $localNode }
    $systemNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($systemNode) { return $systemNode.Source }
    throw 'Node.js is missing. Run Setup.cmd or Start-Web.cmd first.'
}

function Install-VisualCppRuntime {
    $missing = @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $env:SystemRoot "System32/$_"))
    }
    if (-not $missing) { return }
    Write-Host 'Installing Microsoft Visual C++ runtime. Windows may ask for administrator approval.'
    $installer = Get-SetupPath 'downloads/vc_redist.x64.exe'
    $client = New-Object Net.WebClient
    try { $client.DownloadFile('https://aka.ms/vs/17/release/vc_redist.x64.exe', $installer) } finally { $client.Dispose() }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
        throw 'Visual C++ installer does not have a valid Microsoft signature.'
    }
    $process = Start-Process -FilePath $installer -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -eq 3010) { throw 'Visual C++ runtime installed. Restart Windows, then run Start-Web.cmd again.' }
    if ($process.ExitCode -notin @(0, 1638)) { throw "Visual C++ installation failed (exit $($process.ExitCode))." }
}
