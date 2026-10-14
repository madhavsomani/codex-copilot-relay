[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=4144,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')][string]$Model='gpt-6.1-sol',
    [switch]$NoDashboard)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $PSScriptRoot 'Relay-Control.ps1')
$mutex=Enter-RelayControlLock -Root $PSScriptRoot
try {
    # Desktop Start is an explicit restart. Freeze recovery before cancelling
    # the owned relay; Repair and the watchdog retain their drain-only behavior.
    $disabled=Join-Path $PSScriptRoot 'runtime\relay-disabled.flag'
    Assert-RelayLocalPath -Root $PSScriptRoot -Path $disabled
    New-Item -ItemType Directory -Path (Split-Path -Parent $disabled) -Force | Out-Null
    [IO.File]::WriteAllText($disabled,'Manual Start is restarting the relay.')
    & (Join-Path $PSScriptRoot 'Stop-Codex-CopilotWatchdog.ps1') | Out-Null
    & (Join-Path $PSScriptRoot 'Stop-Codex-CopilotGatewayConsole.ps1') | Out-Null
    & (Join-Path $PSScriptRoot 'Stop-Codex-CopilotProxy.ps1') -Port $Port -CancelActive | Out-Null
    $null=Get-RelayLocalKey -Root $PSScriptRoot -Create
    $marker=Join-Path $PSScriptRoot 'runtime\desktop-relay.json'
    Assert-RelayLocalPath -Root $PSScriptRoot -Path $marker
    [IO.File]::WriteAllText($marker,'{"version":1,"mode":"codex-and-claude","credential":"windows-user-dpapi"}')
    & (Join-Path $PSScriptRoot 'Repair-Codex-CopilotProxy.ps1') -Port $Port -Model $Model -NoDashboard:$NoDashboard
    $browserSetup=Join-Path $PSScriptRoot 'claude-browser-setup.mjs'
    if (Test-Path -LiteralPath $browserSetup) {
        & node $browserSetup resume
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Browser setup needs review; model routing is unchanged. See docs/CLAUDE-BROWSER.md.' }
    }
    Write-Output "Claude Gateway base URL: http://127.0.0.1:$Port/claude (once both adapters are ready)."
    Write-Output 'The live terminal shows both setup paths. Type setup to repeat, models for Claude choices, or key for your persistent local key.'
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
