# Installer regression checks with local fixtures; no downloads, GPU or Pester required.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
$originalRoot = $script:SetupRoot
$script:SetupRoot = Join-Path $originalRoot ('.cache/setup-tests/' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $script:SetupRoot | Out-Null
$checks = 0
function Assert-Setup($Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
    Write-Host "PASS: $Message"
}
try {
    $blocked = $false
    try { Get-SetupPath '../outside' | Out-Null } catch { $blocked = $true }
    Assert-Setup $blocked 'Paths cannot escape the setup directory'
    $source = Get-SetupPath 'source.txt'
    [IO.File]::WriteAllText($source, 'verified contents')
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $sourceUrl = (New-Object Uri($source)).AbsoluteUri
    $target = Get-VerifiedDownload $sourceUrl 'downloads/model.pth' $hash
    Assert-Setup ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $hash) 'Downloaded contents are verified before use'
    Get-VerifiedDownload 'file:///does-not-exist' 'downloads/model.pth' $hash | Out-Null
    Assert-Setup ([IO.File]::ReadAllText($target) -eq 'verified contents') 'Verified downloads are reused without contacting the source'
    [IO.File]::WriteAllText($target, 'corrupt cache')
    Get-VerifiedDownload $sourceUrl 'downloads/model.pth' $hash | Out-Null
    Assert-Setup ([IO.File]::ReadAllText($target) -eq 'verified contents') 'Corrupt cached files are downloaded again'
    $blocked = $false
    try { Get-VerifiedDownload $sourceUrl 'downloads/rejected.pth' ('0' * 64) | Out-Null } catch { $blocked = $true }
    Assert-Setup ($blocked -and -not (Test-Path -LiteralPath (Get-SetupPath 'downloads/rejected.pth'))) 'Hash mismatch never promotes a partial download'

    $archiveFiles = Get-SetupPath 'archive-files'
    New-Item -ItemType Directory -Path $archiveFiles | Out-Null
    [IO.File]::WriteAllText((Join-Path $archiveFiles 'tool.exe'), 'test fixture, not executed')
    $archive = Get-SetupPath 'tool.zip'
    Compress-Archive -LiteralPath (Join-Path $archiveFiles 'tool.exe') -DestinationPath $archive
    $artifact = [pscustomobject]@{
        name = 'test tool'; url = (New-Object Uri($archive)).AbsoluteUri
        sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        archiveRoot = ''; directory = 'runtime/test-tool'; executable = 'tool.exe'
    }
    Install-SetupArchive $artifact
    $exe = Get-SetupPath 'runtime/test-tool/tool.exe'
    Assert-Setup (Test-Path -LiteralPath $exe) 'Archive installs into the project runtime'
    $firstWrite = (Get-Item -LiteralPath $exe).LastWriteTimeUtc
    Install-SetupArchive $artifact
    Assert-Setup ((Get-Item -LiteralPath $exe).LastWriteTimeUtc -eq $firstWrite) 'Repeated setup leaves a verified installation intact'
    # Simulate an incomplete runtime; keep its remaining files in a backup on repair.
    Remove-Item -LiteralPath $exe
    [IO.File]::WriteAllText((Get-SetupPath 'runtime/test-tool/preserved.txt'), 'keep this file')
    Install-SetupArchive $artifact
    Assert-Setup (Test-Path -LiteralPath $exe) 'Incomplete runtime is restored from the verified archive'
    $saved = @(Get-ChildItem -LiteralPath (Get-SetupPath 'runtime/backups') -Recurse -Filter preserved.txt)
    Assert-Setup ($saved.Count -eq 1 -and [IO.File]::ReadAllText($saved[0].FullName) -eq 'keep this file') 'Repair preserves the previous directory in a backup'
    $powerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    Invoke-SetupCommand $powerShell @('-NoProfile','-Command',"[Console]::Error.WriteLine('normal progress'); exit 0") 'Native progress test'
    Assert-Setup $true 'Progress written to stderr is not mistaken for an installation failure'
    $blocked = $false
    try { Invoke-SetupCommand $powerShell @('-NoProfile','-Command','exit 7') 'Failure test' } catch { $blocked = $_.Exception.Message.Contains('exit 7') }
    Assert-Setup $blocked 'Native nonzero exit codes stop setup'
    Write-Host "$checks setup regression checks passed. Fixtures: $script:SetupRoot"
} finally { $script:SetupRoot = $originalRoot }
