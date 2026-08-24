[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configHelper = Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1'
$watchScript = Join-Path $bridgeRoot 'Watch-Codex-CopilotProxy.ps1'
$stopWatchdogScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotWatchdog.ps1'
$stopConsoleScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotGatewayConsole.ps1'
$stopScript = Join-Path $bridgeRoot 'Stop-Codex-CopilotProxy.ps1'
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$statePath = Join-Path $runtimeDirectory 'codex-copilot-proxy.state.json'
if (-not (Test-Path -LiteralPath $configHelper)) {
    throw "Config helper not found: $configHelper"
}
. $configHelper
$configPath = Get-CodexCopilotConfigPath

$state = $null
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (@($state.PSObject.Properties.Name) -contains 'ConfigPath' -and -not [string]::IsNullOrWhiteSpace([string]$state.ConfigPath)) {
        $configPath = [IO.Path]::GetFullPath([string]$state.ConfigPath)
    }
}
else {
    $state = Get-CodexCopilotEmbeddedState -ConfigPath $configPath
}

$removedAutoStart = Remove-CodexCopilotAutoStart -WatchScript $watchScript
& $stopWatchdogScript | Out-Null
& $stopConsoleScript | Out-Null
$port = if ($state) { [int]$state.Port } else { 4144 }
& $stopScript -Port $port | Out-Null

if ($state) {
    $warnings = @()
    if (@($state.PSObject.Properties.Name) -contains 'BackupPath') {
        Restore-CodexCopilotConfigFromBackup -ConfigPath $configPath -State $state
        Write-Output "Exact config.toml backup restored and SHA-256 verified: $($state.BackupPath)"
    }
    else {
        $warnings = Restore-CodexCopilotConfig -ConfigPath $configPath -State $state
        Write-Warning 'Legacy state had no full-file backup; the compatibility line-based restore was used.'
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Write-Output "Codex provider routing restored in $configPath."
    foreach ($warning in $warnings) {
        Write-Warning $warning
    }
}
else {
    Write-Output 'No managed provider state was found; the current Codex config was left untouched.'
}
foreach ($item in $removedAutoStart) {
    Write-Output "Automatic recovery removed: $item"
}
Write-Output 'The desktop repair shortcut remains available if you want to enable the bridge again.'
Write-Output 'Restart or reopen the Codex desktop task once so its app-server reloads the restored provider.'
