[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $PSScriptRoot
try {
    Write-Host 'Stopping recovery. Waiting for active work before stopping the relay and restoring Codex.' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'Disable-Codex-CopilotProxy.ps1') -WaitSeconds 86400
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
