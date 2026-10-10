[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-6.1-sol',

    [switch]$SkipStartup
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configHelper = Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1'
$startScript = Join-Path $bridgeRoot 'Start-Codex-CopilotProxy.ps1'
$stopScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotProxy.ps1'
$watchScript = Join-Path $bridgeRoot 'Watch-Codex-CopilotProxy.ps1'
$stopWatchdogScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotWatchdog.ps1'
$stopConsoleScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotGatewayConsole.ps1'
$repairScript = Join-Path $bridgeRoot 'Repair-Codex-CopilotProxy.ps1'
$disableScript = Join-Path $bridgeRoot 'Disable-Codex-CopilotProxy.ps1'
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$statePath = Join-Path $runtimeDirectory 'codex-copilot-proxy.state.json'
$proxyPidPath = Join-Path $runtimeDirectory 'codex-copilot-proxy.pid'
$backupPath = Join-Path $runtimeDirectory 'config.toml.pre-copilot.bak'
if (-not (Test-Path -LiteralPath $configHelper)) {
    throw "Config helper not found: $configHelper"
}
. $configHelper
$configPath = Get-CodexCopilotConfigPath

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
Remove-Item -LiteralPath (Join-Path $runtimeDirectory 'relay-disabled.flag') -Force -ErrorAction SilentlyContinue
$hadState = Test-Path -LiteralPath $statePath
$originalStateText = if ($hadState) { Get-Content -LiteralPath $statePath -Raw } else { $null }
$priorConfigPath = if ($hadState -and ($originalStateText | ConvertFrom-Json).ConfigPath) { [string]($originalStateText | ConvertFrom-Json).ConfigPath } else { $configPath }
$priorConfigBytes = if (Test-Path -LiteralPath $priorConfigPath -PathType Leaf) { [IO.File]::ReadAllBytes($priorConfigPath) } else { $null }
$state = $null
$transitionDeferred = $false
$previousModel = $null
$proxyStarted = $false
$autoStartInstalled = $false
$watchdogStarted = $false
try {
    if ($hadState) {
        $state = $originalStateText | ConvertFrom-Json
        $previousModel = [string]$state.Model
        if (@($state.PSObject.Properties.Name) -contains 'ConfigPath' -and -not [string]::IsNullOrWhiteSpace([string]$state.ConfigPath)) {
            $configPath = [IO.Path]::GetFullPath([string]$state.ConfigPath)
        }
        if ([int]$state.Port -ne $Port) {
            throw "Codex Copilot proxy is already enabled on port $($state.Port). Disable it before changing the port."
        }
        $statePropertyNames = @($state.PSObject.Properties.Name)
        if ($statePropertyNames -contains 'BackupPath') {
            Assert-CodexCopilotConfigBackup -State $state | Out-Null
        }
        else {
            # Upgrade a legacy managed state by reconstructing its normal-provider
            # baseline once, then use exact full-file restoration from this point on.
            $backup = New-CodexCopilotConfigBackup `
                -ConfigPath $configPath `
                -BackupPath $backupPath `
                -ManagedState $state
            $state = Add-CodexCopilotBackupToState -State $state -Backup $backup
        }
        $running = $null
        try { $running = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5 } catch {}
        $transitionDeferred = $running -and $running.ok -and $running.model -ne $Model -and
            ($running.PSObject.Properties.Name -contains 'activeExchanges') -and [int]$running.activeExchanges -gt 0
        if ($transitionDeferred) {
            # Never point Codex at a model the old in-memory relay cannot yet serve.
            # Preflight the target with a fresh authenticated SDK process first.
            $metadataText = (& node (Join-Path $bridgeRoot 'probe-sdk.mjs') --model $Model | Out-String)
            if ($LASTEXITCODE -ne 0) { throw "The Copilot SDK does not expose $Model; leaving the working route untouched." }
            $metadata = $metadataText | ConvertFrom-Json
            if ($Model -eq 'gpt-6.1-sol' -and @($metadata.supportedReasoningEfforts) -notcontains 'xhigh') {
                throw 'The Copilot SDK does not advertise xhigh reasoning for gpt-6.1-sol.'
            }
            $state.Model = $Model
            $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
        }
        else {
            # Reapply without losing the original restore values or protected backup.
            $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model -RestoreState $state
            $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
        }
    }
    else {
        $backup = New-CodexCopilotConfigBackup -ConfigPath $configPath -BackupPath $backupPath
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model
        $state = Add-CodexCopilotBackupToState -State $state -Backup $backup
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model -RestoreState $state
        $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    }

    # A healthy older relay can still own Codex tool continuations. Keep it
    # available, finish enablement, and let the watchdog promote the on-disk
    # update once the retained exchanges reach zero.
    $proxyPidBeforeStart = 0
    if (Test-Path -LiteralPath $proxyPidPath -PathType Leaf) {
        [int]::TryParse(
            ([string](Get-Content -LiteralPath $proxyPidPath -Raw)).Trim(),
            [ref]$proxyPidBeforeStart
        ) | Out-Null
    }
    & $startScript -Port $Port -Model $Model -DeferUpdateWhenBusy
    $modelHealth = $null
    try { $modelHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10 }
    catch { Write-Warning 'Context metadata is temporarily unavailable; the watchdog will synchronize it after recovery.' }
    $modelHealth = Select-CodexCopilotModelHealth -Health $modelHealth -Model $Model
    if ($modelHealth) {
        $catalogPath = New-CodexCopilotModelCatalog -Health $modelHealth -Model $Model -Directory $runtimeDirectory
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model -RestoreState $state -ModelHealth $modelHealth -ModelCatalogPath $catalogPath
        $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    }
    elseif (-not ($transitionDeferred -and $running -and [int]$running.activeExchanges -gt 0)) {
        throw "The live relay has no usable capability metadata for $Model. The Codex route was not finalized."
    }
    $proxyPidAfterStart = 0
    if (Test-Path -LiteralPath $proxyPidPath -PathType Leaf) {
        [int]::TryParse(
            ([string](Get-Content -LiteralPath $proxyPidPath -Raw)).Trim(),
            [ref]$proxyPidAfterStart
        ) | Out-Null
    }
    $proxyStarted = $proxyPidAfterStart -gt 0 -and $proxyPidAfterStart -ne $proxyPidBeforeStart

    $autoStart = $null
    if (-not $SkipStartup) {
        $autoStart = Install-CodexCopilotAutoStart -WatchScript $watchScript -Port $Port -Model $Model
        $autoStartInstalled = $true
        # The watchdog caches package.json's expected version once at startup.
        # Recycle only the managed watchdog so deferred exchanges stay alive while
        # the fresh watchdog waits to promote the staged relay version.
        & $stopWatchdogScript | Out-Null
        Start-CodexCopilotAutoStart `
            -WatchScript $watchScript `
            -Port $Port `
            -Model $Model `
            -RestartRunning | Out-Null
        $watchdogStarted = $true
    }

    $desktopShortcuts = Install-CodexCopilotDesktopShortcuts `
        -RepairScript $repairScript `
        -DisableScript $disableScript `
        -Port $Port `
        -Model $Model

    if ($transitionDeferred -and -not $modelHealth) {
        Write-Output "Update staged for $Model; Codex keeps its working $previousModel route until the active exchange ends. The watchdog will promote and synchronize config.toml."
    }
    else {
        Write-Output "Codex provider routing enabled: $configPath -> http://127.0.0.1:$Port/v1 -> GitHub Copilot $Model."
    }
    Write-Output "Protected full-config backup ready: $($state.BackupPath)"
    if ($SkipStartup) {
        Write-Output 'Automatic recovery was skipped; use the desktop repair shortcut after a reboot or failure.'
    }
    else {
        Write-Output "Automatic recovery installed via $($autoStart.Mode): $($autoStart.Name)"
    }
    foreach ($shortcut in $desktopShortcuts) {
        Write-Output "Desktop recovery control installed: $shortcut"
    }
    if ($transitionDeferred -and -not $modelHealth) {
        Write-Output 'After /health shows the new model and version, reopen Codex tasks to load the new default.'
    }
    else {
        Write-Output 'Restart or reopen the Codex desktop task once so its app-server reloads config.toml.'
    }
}
catch {
    if ($transitionDeferred) {
        # The previous model and full-config backup remain in place on failure.
        # Restore the prior watchdog target rather than reverting Codex to OpenAI.
        try { [IO.File]::WriteAllText($statePath, $originalStateText, [Text.UTF8Encoding]::new($false)) } catch {}
        if ($autoStartInstalled) {
            try {
                Install-CodexCopilotAutoStart -WatchScript $watchScript -Port $Port -Model $previousModel | Out-Null
                Start-CodexCopilotAutoStart -WatchScript $watchScript -Port $Port -Model $previousModel -RestartRunning | Out-Null
            } catch { Write-Warning "Could not restore the previous watchdog target: $($_.Exception.Message)" }
        }
        throw
    }
    if ($autoStartInstalled) {
        try { Remove-CodexCopilotAutoStart -WatchScript $watchScript | Out-Null } catch {}
    }
    if ($watchdogStarted) {
        try { & $stopWatchdogScript | Out-Null } catch {}
    }
    try { & $stopConsoleScript | Out-Null } catch {}
    if ($proxyStarted) {
        try { & $stopScript -Port $Port | Out-Null } catch {}
    }
    if ($state) {
        try {
            if ($hadState -and $null -ne $priorConfigBytes) {
                [IO.File]::WriteAllBytes($priorConfigPath,$priorConfigBytes)
            }
            elseif (@($state.PSObject.Properties.Name) -contains 'BackupPath') {
                Restore-CodexCopilotConfigFromBackup -ConfigPath $configPath -State $state
            }
            else {
                Restore-CodexCopilotConfig -ConfigPath $configPath -State $state | Out-Null
            }
        }
        catch {
            Write-Warning "Automatic config rollback failed: $($_.Exception.Message)"
        }
    }
    if ($hadState) { [IO.File]::WriteAllText($statePath,$originalStateText,[Text.UTF8Encoding]::new($false)) }
    else { Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue }
    throw
}
