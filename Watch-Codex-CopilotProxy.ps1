[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-5.6-luna',

    [ValidateRange(2, 300)]
    [int]$CheckIntervalSeconds = 10
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $bridgeRoot 'Start-Codex-CopilotProxy.ps1'
$configHelper = Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1'
$packagePath = Join-Path $bridgeRoot 'package.json'
$consoleScript = [IO.Path]::GetFullPath((Join-Path $bridgeRoot 'Show-Codex-CopilotGateway.ps1'))
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-watchdog.pid'
$consolePidPath = Join-Path $runtimeDirectory 'codex-copilot-console.pid'
$logPath = Join-Path $runtimeDirectory 'watchdog.log'
$statePath = Join-Path $runtimeDirectory 'codex-copilot-proxy.state.json'
$maxWatchdogLogBytes = 8MB
$auxiliaryLogPaths = @(
    (Join-Path $runtimeDirectory 'proxy.process.stdout.log'),
    (Join-Path $runtimeDirectory 'proxy.stderr.log')
)
$maxAuxiliaryLogBytes = 32MB
$expectedVersion = if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
    [string]((Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version)
}
else {
    throw "Bridge package metadata not found: $packagePath"
}
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
        return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5
    }
    catch {
        return $null
    }
}

function Sync-WatchedConfig {
    if (-not (Test-Path -LiteralPath $configHelper -PathType Leaf)) {
        throw "Config helper not found: $configHelper"
    }
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        throw "Managed state not found: $statePath"
    }

    . $configHelper
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ([int]$state.Port -ne $Port -or [string]$state.Model -ne $Model) {
        throw "Managed state does not match watchdog target $Port/$Model."
    }
    Assert-CodexCopilotConfigBackup -State $state | Out-Null
    $configPath = [IO.Path]::GetFullPath([string]$state.ConfigPath)
    $state = Set-CodexCopilotConfig `
        -ConfigPath $configPath `
        -Port $Port `
        -Model $Model `
        -RestoreState $state
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    return $configPath
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
    $lastSdkState = ''
    $lastTransitionState = ''
    $configSynchronized = $false

    while ($true) {
        Limit-AuxiliaryLogs
        $health = Get-WatchedHealth
        if ($health -and $health.model -eq $Model -and $health.sdk -and -not $health.ok) {
            # The Node supervisor owns SDK replacement and invalidation. Do not
            # launch a second HTTP process or kill resumable work on a slow ping.
            $sdkState = [string]$health.sdk.state
            if ($sdkState -ne $lastSdkState) {
                Write-WatchdogLog "SDK readiness is $sdkState; the relay supervisor owns backend recovery."
            }
            $lastSdkState = $sdkState
        }
        elseif (
            $health -and $health.ok -and $health.model -ne $Model -and
            ($health.PSObject.Properties.Name -contains 'activeExchanges') -and
            [int]$health.activeExchanges -gt 0
        ) {
            $transitionState = "$($health.version)/$($health.model) -> $expectedVersion/$Model with $($health.activeExchanges) active exchange(s)"
            if ($transitionState -ne $lastTransitionState) {
                Write-WatchdogLog "Model transition pending: $transitionState."
            }
            $lastTransitionState = $transitionState
        }
        elseif (-not ($health -and $health.ok -and $health.model -eq $Model)) {
            $lastTransitionState = ''
            try {
                $startOutput = (& $startScript -Port $Port -Model $Model 2>&1 | Out-String).Trim()
                Write-WatchdogLog "Recovery succeeded. $startOutput"
                $health = Get-WatchedHealth
            }
            catch {
                Write-WatchdogLog "Recovery failed: $($_.Exception.Message)"
            }
        }
        elseif (
            [string]$health.version -ne $expectedVersion -and
            ($health.PSObject.Properties.Name -contains 'activeExchanges') -and
            [int]$health.activeExchanges -eq 0
        ) {
            try {
                $previousVersion = if ([string]::IsNullOrWhiteSpace([string]$health.version)) {
                    'legacy-unversioned'
                }
                else {
                    [string]$health.version
                }
                $startOutput = (& $startScript -Port $Port -Model $Model 2>&1 | Out-String).Trim()
                Write-WatchdogLog "Deferred update promoted $previousVersion -> $expectedVersion. $startOutput"
                $health = Get-WatchedHealth
            }
            catch {
                Write-WatchdogLog "Deferred update promotion failed: $($_.Exception.Message)"
            }
        }
        if ($health -and $health.ok) { $lastSdkState = '' }
        if ($health -and $health.ok -and $health.model -eq $Model) { $lastTransitionState = '' }
        if ($health -and $health.ok -and $health.model -eq $Model) {
            if (-not $configSynchronized) {
                try {
                    $configPath = Sync-WatchedConfig
                    Write-WatchdogLog "Managed Codex route synchronized: $configPath -> 127.0.0.1:$Port -> $Model."
                    $configSynchronized = $true
                }
                catch {
                    Write-WatchdogLog "Managed Codex route synchronization failed: $($_.Exception.Message)"
                }
            }
        }
        else {
            $configSynchronized = $false
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
