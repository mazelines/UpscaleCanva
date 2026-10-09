[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [ValidateRange(1, 120)][int]$MaxAttempts = 20,
    [ValidateRange(1, 300)][int]$RetrySeconds = 30
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$logPath = Join-Path $projectRoot 'logs\web-startup.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null

function Write-StartupLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ('[{0}] {1}' -f (Get-Date -Format o), $Message)
}

Write-StartupLog ('Starting as {0}.' -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
        if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
            throw "Node.js executable not found: $NodePath"
        }
        $config = Get-Content -LiteralPath (Join-Path $projectRoot 'runtime\web\config.json') -Raw | ConvertFrom-Json
        $addresses = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
            ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
            ForEach-Object { $_.Address.ToString() })
        $missing = @($config.hosts | Where-Object { $_ -ne '127.0.0.1' -and $_ -notin $addresses })
        if ($missing.Count -gt 0) {
            throw ('Waiting for configured network addresses: {0}' -f ($missing -join ', '))
        }
        Write-StartupLog "Attempt $attempt of $MaxAttempts."
        & (Join-Path $PSScriptRoot 'Start-Web.ps1') -NodePath $NodePath -NoBrowser *>&1 |
            Out-File -FilePath $logPath -Append -Encoding utf8
        foreach ($address in $config.hosts) {
            $url = 'http://{0}:{1}' -f $address, $config.port
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
            if ($response.Headers['x-arion-service'] -ne 'upscaler-v1') {
                throw "Unexpected service response from $url"
            }
        }
        Write-StartupLog 'Web server is ready on all configured addresses (or was already running).'
        exit 0
    } catch {
        Write-StartupLog ('Attempt {0} failed: {1}' -f $attempt, $_.Exception.Message)
        if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds $RetrySeconds }
    }
}
Write-StartupLog 'Automatic startup failed. See this log and web-server.log.'
exit 1
