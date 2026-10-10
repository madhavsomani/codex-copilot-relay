[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4144,[int]$WaitSeconds=0)
$ErrorActionPreference='Stop'
$bridgeRoot=$PSScriptRoot
. (Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $bridgeRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $bridgeRoot -Kind 'server'
try {
    if (-not (Stop-RelayOwnedListener -Root $bridgeRoot -Port $Port -WaitSeconds $WaitSeconds)) {
        throw 'Relay has active work. Nothing was stopped or restored. Use Stop & Restore after tasks finish.'
    }
    Remove-Item -LiteralPath (Join-Path $bridgeRoot 'runtime\codex-copilot-proxy.pid') -Force -ErrorAction SilentlyContinue
    Write-Output "Owned relay stopped (or already stopped) on port $Port. History retained."
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
