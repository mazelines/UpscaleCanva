[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Setup-Helpers.ps1')
$nodePath = Get-ProjectNode
$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupScript = Join-Path $PSScriptRoot 'Start-WebAtBoot.ps1'
$userName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'ARION Upscaler Web'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not ($existing.Actions.Arguments -join ' ').Contains('"' + $startupScript + '"')) {
    throw "An unrelated task already uses the name '$taskName'. It was left unchanged."
}

$action = New-ScheduledTaskAction -Execute $powerShellPath -WorkingDirectory $projectRoot -Argument (
    '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -NodePath "{1}"' -f $startupScript, $nodePath
)
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
# S4U runs under the current account without storing a password or requiring a desktop login.
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Start the local ARION upscaler web server after Windows boots. Wait for Tailscale and CUDA; log to logs\web-startup.log.'
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Write-Output "Registered startup task: $taskName ($userName)."
