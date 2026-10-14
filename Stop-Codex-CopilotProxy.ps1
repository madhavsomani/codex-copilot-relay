[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4144,[int]$WaitSeconds=0,[switch]$CancelActive)
$ErrorActionPreference='Stop'
$bridgeRoot=$PSScriptRoot
. (Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $bridgeRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $bridgeRoot -Kind 'server'
try {
    if (-not (Stop-RelayOwnedListener -Root $bridgeRoot -Port $Port -WaitSeconds $WaitSeconds -CancelActive:$CancelActive)) {
        throw 'Relay has active work. Use Stop & Restore only if you intend to cancel it, or wait for tasks to finish.'
    }
    foreach ($name in @('codex-copilot-proxy.pid','relay-stop.json','relay-session-cancel.json')) {
        $file=Join-Path $bridgeRoot ('runtime\'+$name)
        Assert-RelayLocalPath -Root $bridgeRoot -Path $file
        Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    }
    Repair-RelayClaudeLease -Root $bridgeRoot -Port $Port
    Write-Output "Owned relay stopped (or already stopped) on port $Port. History retained."
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
