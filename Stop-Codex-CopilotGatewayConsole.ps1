[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$consoleScript = [IO.Path]::GetFullPath((Join-Path $bridgeRoot 'Show-Codex-CopilotGateway.ps1'))
$pidPath = Join-Path $bridgeRoot 'runtime\codex-copilot-console.pid'
$consoleStatePath = Join-Path $bridgeRoot 'runtime\codex-copilot-console.state.json'
$managedProcesses = [System.Collections.Generic.List[object]]::new()
. (Join-Path $bridgeRoot 'Relay-Control.ps1')

foreach ($process in @(Get-RelayScriptProcesses -Script $consoleScript)) {
    $managedProcesses.Add($process)
}

if ($managedProcesses.Count -eq 0) {
    Write-Output 'No managed Codex Copilot gateway console was running.'
}
else {
    foreach ($process in $managedProcesses) {
        $fresh=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ProcessId)" -ErrorAction Stop
        if (-not $fresh -or $fresh.CreationDate -ne $process.CreationDate -or $fresh.CommandLine -cne $process.CommandLine) { continue }
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
        Write-Output "Stopped managed Codex Copilot gateway console PID $($process.ProcessId)."
    }
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $consoleStatePath -Force -ErrorAction SilentlyContinue
