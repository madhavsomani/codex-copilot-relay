[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4144,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')][string]$Model='gpt-6.1-sol',
    [switch]$NoDashboard)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $PSScriptRoot
try {
    $null=Get-RelayLocalKey -Root $PSScriptRoot -Create
    $marker=Join-Path $PSScriptRoot 'runtime\desktop-relay.json'
    Assert-RelayLocalPath -Root $PSScriptRoot -Path $marker
    [IO.File]::WriteAllText($marker,'{"version":1,"mode":"codex-and-claude","credential":"windows-user-dpapi"}')
    & (Join-Path $PSScriptRoot 'Repair-Codex-CopilotProxy.ps1') -Port $Port -Model $Model -NoDashboard:$NoDashboard
    Write-Output "Claude Gateway base URL: http://127.0.0.1:$Port/claude (once both adapters are ready)."
    Write-Output 'The live terminal shows both setup paths. Type setup to repeat, models for Claude choices, or key for your persistent local key.'
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
