[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidateSet('gpt-5.6-sol', 'gpt-5.6-luna')]
    [string]$Model = 'gpt-5.6-luna',

    [ValidateRange(2, 300)]
    [int]$CheckIntervalSeconds = 10
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $bridgeRoot 'Start-Codex-CopilotProxy.ps1'
$consoleScript = [IO.Path]::GetFullPath((Join-Path $bridgeRoot 'Show-Codex-CopilotGateway.ps1'))
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-watchdog.pid'
$consolePidPath = Join-Path $runtimeDirectory 'codex-copilot-console.pid'
$logPath = Join-Path $runtimeDirectory 'watchdog.log'
$maxWatchdogLogBytes = 8MB
$auxiliaryLogPaths = @(
    (Join-Path $runtimeDirectory 'proxy.process.stdout.log'),
    (Join-Path $runtimeDirectory 'proxy.stderr.log')
)
$maxAuxiliaryLogBytes = 32MB
$mutex = [Threading.Mutex]::new($false, "Local\CodexCopilotBridgeWatchdog_$Port")
$ownsMutex = $false

function Write-WatchdogLog {
    param([Parameter(Mandatory)][string]$Message)

    if ((Test-Path -LiteralPath $logPath -PathType Leaf) -and (Get-Item -LiteralPath $logPath).Length -gt $maxWatchdogLogBytes) {
        $tail = @(Get-Content -LiteralPath $logPath -Tail 4000 -ErrorAction SilentlyContinue)
        Set-Content -LiteralPath $logPath -Value $tail -Encoding utf8
    }
    $line = "$(Get-Date -Format o) $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
}

function Get-WatchedHealth {
    try {
        return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    }
    catch {
        return $null
    }
}

function Limit-AuxiliaryLogs {
    foreach ($path in $auxiliaryLogPaths) {
        try {
            if ((Test-Path -LiteralPath $path -PathType Leaf) -and (Get-Item -LiteralPath $path).Length -gt $maxAuxiliaryLogBytes) {
                $tail = @(Get-Content -LiteralPath $path -Tail 4000 -ErrorAction Stop)
                Set-Content -LiteralPath $path -Value $tail -Encoding utf8 -ErrorAction Stop
            }
        }
        catch {
            # The active process may briefly hold a redirect handle. Try again on the next watchdog pass.
        }
    }
}

function Test-GatewayConsoleProcess {
    if (-not (Test-Path -LiteralPath $consolePidPath -PathType Leaf)) {
        return $false
    }
    $pidText = (Get-Content -LiteralPath $consolePidPath -Raw -ErrorAction SilentlyContinue).Trim()
    $consolePid = 0
    if (-not [int]::TryParse($pidText, [ref]$consolePid)) {
        Remove-Item -LiteralPath $consolePidPath -Force -ErrorAction SilentlyContinue
        return $false
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$consolePid" -ErrorAction SilentlyContinue
    $isPowerShell = $process -and $process.Name -in @('powershell.exe', 'pwsh.exe')
    if ($isPowerShell -and ([string]$process.CommandLine) -like "*$consoleScript*") {
        return $true
    }
    Remove-Item -LiteralPath $consolePidPath -Force -ErrorAction SilentlyContinue
    return $false
}

function Start-GatewayConsole {
    $powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $terminal = Get-Command wt.exe -ErrorAction SilentlyContinue
    if ($terminal) {
        $arguments = "-w new new-tab --title `"Codex Copilot Gateway - $Model - Port $Port`" `"$powerShell`" -NoProfile -ExecutionPolicy Bypass -File `"$consoleScript`" -Port $Port -Model $Model"
        Start-Process `
            -FilePath $terminal.Source `
            -ArgumentList $arguments `
            -WorkingDirectory $bridgeRoot `
            -WindowStyle Normal | Out-Null
    }
    else {
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$consoleScript`" -Port $Port -Model $Model"
        Start-Process `
            -FilePath $powerShell `
            -ArgumentList $arguments `
            -WorkingDirectory $bridgeRoot `
            -WindowStyle Normal | Out-Null
    }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-GatewayConsoleProcess) {
            return [int]([string](Get-Content -LiteralPath $consolePidPath -Raw)).Trim()
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'The visible gateway console did not publish its managed PID.'
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    }
    catch [Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        Write-Output "A Codex Copilot watchdog is already running for port $Port."
        exit 0
    }

    Set-Content -LiteralPath $pidPath -Value ([string]$PID) -Encoding ascii
    Write-WatchdogLog "Watchdog started for 127.0.0.1:$Port using $Model (PID $PID)."

    while ($true) {
        Limit-AuxiliaryLogs
        $health = Get-WatchedHealth
        if (-not ($health -and $health.ok -and $health.model -eq $Model)) {
            try {
                $startOutput = (& $startScript -Port $Port -Model $Model 2>&1 | Out-String).Trim()
                Write-WatchdogLog "Recovery succeeded. $startOutput"
                $health = Get-WatchedHealth
            }
            catch {
                Write-WatchdogLog "Recovery failed: $($_.Exception.Message)"
            }
        }
        if ($health -and $health.ok -and $health.model -eq $Model -and -not (Test-GatewayConsoleProcess)) {
            try {
                $consolePid = Start-GatewayConsole
                Write-WatchdogLog "Visible gateway console started (PID $consolePid)."
            }
            catch {
                Write-WatchdogLog "Visible gateway console recovery failed: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds $CheckIntervalSeconds
    }
}
finally {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    if ($ownsMutex) {
        try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
}
