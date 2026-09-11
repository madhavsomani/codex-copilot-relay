[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')]
    [string]$OpenAIModel,
    [ValidateRange(1024,65535)][int]$Port = 4144,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')]
    [string]$CopilotModel = 'gpt-6-astra'
)
$ErrorActionPreference = 'Stop'
$running = $null
try { $running = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 } catch {}
if ($running) {
    throw 'A relay is already running. After its work finishes, use Restore Normal Codex, then run this script from a fresh PowerShell session. This script will not interrupt active work.'
}
# Process environment only: no key in a command argument, TOML, registry, or repo.
if (-not $env:RELAY_OPENAI_API_KEY) {
    $enteredKey = Read-Host 'OpenAI Platform API key (separate paid API account, not Codex sign-in)' -AsSecureString
    try { $env:RELAY_OPENAI_API_KEY = [Net.NetworkCredential]::new('', $enteredKey).Password }
    finally { $enteredKey.Dispose() }
}
if (-not $env:RELAY_OPENAI_API_KEY) { throw 'An OpenAI Platform API key is required for this optional mode.' }
if (-not $env:RELAY_OPENAI_LOCAL_TOKEN -or $env:RELAY_OPENAI_LOCAL_TOKEN.Length -lt 32) {
    $tokenBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($tokenBytes); $env:RELAY_OPENAI_LOCAL_TOKEN = [Convert]::ToBase64String($tokenBytes) }
    finally { $generator.Dispose(); [Array]::Clear($tokenBytes, 0, $tokenBytes.Length) }
}
$env:RELAY_OPENAI_MODEL = $OpenAIModel
$env:RELAY_OPENAI_ENABLED = '1'
& (Join-Path $PSScriptRoot 'Repair-Codex-CopilotProxy.ps1') -Port $Port -Model $CopilotModel -NoDashboard
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 10
if (-not $health.openaiFallback.enabled -or -not $health.openaiFallback.configured) {
    throw 'Public API fallback did not load its environment. No live API verification was performed.'
}
# The watchdog/relay inherited the key already. The client only needs the local
# token; remove the upstream credential before launching an agent from this shell.
Remove-Item -LiteralPath 'Env:RELAY_OPENAI_API_KEY' -ErrorAction SilentlyContinue
Write-Output 'Hybrid gateway configured. Normal inference stays on Copilot; routed public APIs incur separate OpenAI Platform charges.'
Write-Output 'Run codex (or launch a fully exited desktop app) FROM THIS PowerShell session so it inherits the local gateway token.'
Write-Output 'Credentials remain process-local. Re-run this script after reboot; never paste keys or the local token into config.toml or GitHub.'
