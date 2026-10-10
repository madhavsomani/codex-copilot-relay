[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$scriptPath=Join-Path $PSScriptRoot 'Watch-Codex-CopilotProxy.ps1'
foreach ($process in @(Get-RelayScriptProcesses -Script $scriptPath)) {
    $fresh=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction Stop
    if ($fresh -and $fresh.CreationDate -eq $process.CreationDate -and $fresh.CommandLine -ceq $process.CommandLine) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        Write-Output "Stopped owned recovery watchdog PID $($process.ProcessId)."
    }
}
Remove-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\codex-copilot-watchdog.pid') -Force -ErrorAction SilentlyContinue
