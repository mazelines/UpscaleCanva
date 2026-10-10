$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot 'runtime\web'
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
Write-Output 'UpscaleCanva web URLs (connect remote devices to Tailscale):'
foreach ($address in $config.hosts) { Write-Output ("http://{0}:{1}" -f $address,$config.port) }
Write-Output ''
Write-Output 'No application login. Connect remote devices to your private Tailscale network.'
