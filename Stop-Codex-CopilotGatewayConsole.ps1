[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$consoleScript = [IO.Path]::GetFullPath((Join-Path $bridgeRoot 'Show-Codex-CopilotGateway.ps1'))
$pidPath = Join-Path $bridgeRoot 'runtime\codex-copilot-console.pid'
$consoleStatePath = Join-Path $bridgeRoot 'runtime\codex-copilot-console.state.json'
$managedProcesses = [System.Collections.Generic.List[object]]::new()

foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $isPowerShell = $process.Name -in @('powershell.exe', 'pwsh.exe')
    if ($isPowerShell -and ([string]$process.CommandLine) -like "*$consoleScript*") {
        $managedProcesses.Add($process)
    }
}

if ($managedProcesses.Count -eq 0) {
    Write-Output 'No managed Codex Copilot gateway console was running.'
}
else {
    foreach ($process in $managedProcesses) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        Write-Output "Stopped managed Codex Copilot gateway console PID $($process.ProcessId)."
    }
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $consoleStatePath -Force -ErrorAction SilentlyContinue
