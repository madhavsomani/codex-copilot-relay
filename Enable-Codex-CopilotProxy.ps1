[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-5.6-luna',

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
$backupPath = Join-Path $runtimeDirectory 'config.toml.pre-copilot.bak'
if (-not (Test-Path -LiteralPath $configHelper)) {
    throw "Config helper not found: $configHelper"
}
. $configHelper
$configPath = Get-CodexCopilotConfigPath

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$hadState = Test-Path -LiteralPath $statePath
$state = $null
$proxyStarted = $false
$autoStartInstalled = $false
$watchdogStarted = $false
try {
    if ($hadState) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if (@($state.PSObject.Properties.Name) -contains 'ConfigPath' -and -not [string]::IsNullOrWhiteSpace([string]$state.ConfigPath)) {
            $configPath = [IO.Path]::GetFullPath([string]$state.ConfigPath)
        }
        if ([int]$state.Port -ne $Port -or [string]$state.Model -ne $Model) {
            throw "Codex Copilot proxy is already enabled on port $($state.Port) using $($state.Model). Disable it before changing the port or model."
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
        # Reapply the provider definition without losing its original restore values
        # or its protected full-config backup metadata.
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model -RestoreState $state
        $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    }
    else {
        $backup = New-CodexCopilotConfigBackup -ConfigPath $configPath -BackupPath $backupPath
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model
        $state = Add-CodexCopilotBackupToState -State $state -Backup $backup
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port $Port -Model $Model -RestoreState $state
        $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statePath -Encoding utf8
    }

    & $startScript -Port $Port -Model $Model
    $proxyStarted = $true

    $autoStart = $null
    if (-not $SkipStartup) {
        $autoStart = Install-CodexCopilotAutoStart -WatchScript $watchScript -Port $Port -Model $Model
        $autoStartInstalled = $true
        Start-CodexCopilotAutoStart -WatchScript $watchScript -Port $Port -Model $Model | Out-Null
        $watchdogStarted = $true
    }

    $desktopShortcuts = Install-CodexCopilotDesktopShortcuts `
        -RepairScript $repairScript `
        -DisableScript $disableScript `
        -Port $Port `
        -Model $Model

    Write-Output "Codex provider routing enabled: $configPath -> http://127.0.0.1:$Port/v1 -> GitHub Copilot $Model."
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
    Write-Output 'Restart or reopen the Codex desktop task once so its app-server reloads config.toml.'
}
catch {
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
            if (@($state.PSObject.Properties.Name) -contains 'BackupPath') {
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
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    throw
}
