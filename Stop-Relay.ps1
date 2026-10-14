[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $PSScriptRoot
try {
    Write-Host 'Stopping recovery and cancelling active relay requests now. Restoring Codex; history, keys and backups are retained.' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'Disable-Codex-CopilotProxy.ps1') -CancelActive
    $browserSetup=Join-Path $PSScriptRoot 'claude-browser-setup.mjs'
    if (Test-Path -LiteralPath $browserSetup) {
        & node $browserSetup restore
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Browser additions were edited and left untouched. Run node claude-browser-setup.mjs restore after reviewing the conflict.' }
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
