[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-5.6-luna',

    [switch]$NoDashboard
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$enableScript = Join-Path $bridgeRoot 'Enable-Codex-CopilotProxy.ps1'
$consoleScript = [IO.Path]::GetFullPath((Join-Path $bridgeRoot 'Show-Codex-CopilotGateway.ps1'))
$consolePidPath = Join-Path $bridgeRoot 'runtime\codex-copilot-console.pid'

& $enableScript -Port $Port -Model $Model

$health = $null
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    }
    catch {
        $health = $null
    }
    if ($health -and $health.ok -and $health.model -eq $Model) {
        break
    }
    Start-Sleep -Milliseconds 250
}
if (-not ($health -and $health.ok -and $health.model -eq $Model)) {
    throw "The bridge did not become healthy on 127.0.0.1:$Port. Inspect runtime\proxy.stderr.log and runtime\watchdog.log."
}

$consoleProcess = $null
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if (Test-Path -LiteralPath $consolePidPath -PathType Leaf) {
        $consolePidText = [string](Get-Content -LiteralPath $consolePidPath -Raw -ErrorAction SilentlyContinue)
        $consolePid = 0
        if ([int]::TryParse($consolePidText.Trim(), [ref]$consolePid)) {
            $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$consolePid" -ErrorAction SilentlyContinue
            $isPowerShell = $candidate -and $candidate.Name -in @('powershell.exe', 'pwsh.exe')
            if ($isPowerShell -and ([string]$candidate.CommandLine) -like "*$consoleScript*") {
                $consoleProcess = $candidate
                break
            }
        }
    }
    Start-Sleep -Milliseconds 250
}
if (-not $consoleProcess) {
    throw 'The bridge is healthy, but the watchdog did not start the visible gateway event console.'
}

Write-Output "HEALTHY: provider=$($health.provider) model=$($health.model) port=$Port activeExchanges=$($health.activeExchanges)"
Write-Output "VISIBLE CONSOLE: PID $($consoleProcess.ProcessId); closing it will trigger automatic relaunch."
$dashboardUrl = "http://127.0.0.1:$Port/dashboard"
Write-Output "DASHBOARD: $dashboardUrl"
Write-Output 'Reopen the Codex task so the desktop app reloads the restored provider definition.'
if (-not $NoDashboard) {
    Start-Process -FilePath $dashboardUrl
}
