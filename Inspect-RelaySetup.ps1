[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port = 4144)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
$configPath = Get-CodexCopilotConfigPath
$lines = Read-CodexConfigLines -ConfigPath $configPath
$index = Find-CodexTopLevelKeyIndex -Lines ([string[]]$lines.ToArray()) -Key 'model_provider'
$routed = $index -ge 0 -and $lines[$index] -match '^\s*model_provider\s*=\s*"github_copilot_bridge"\s*(#.*)?$'
$parts = ($lines -join "`n") -split '\[model_providers.github_copilot_bridge\]', 2
$endpointMatches = $parts.Count -eq 2 -and (($parts[1] -split '(?m)^\s*\[', 2)[0] -match ('(?m)^base_url\s*=\s*"http://127\.0\.0\.1:' + $Port + '/v1"'))
$backup = 'not-created'
$statePath = Join-Path $PSScriptRoot 'runtime/codex-copilot-proxy.state.json'
try {
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { Get-CodexCopilotEmbeddedState -ConfigPath $configPath }
    if ($state) { Assert-CodexCopilotConfigBackup -State $state | Out-Null; $backup = 'verified' }
} catch { $backup = 'invalid' }
$installed = $false
$binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
foreach ($dir in @(Get-ChildItem -LiteralPath $binRoot -Directory -ErrorAction SilentlyContinue)) {
    if (Test-Path -LiteralPath (Join-Path $dir.FullName 'codex.exe') -PathType Leaf) { $installed = $true; break }
}
if (-not $installed) {
    $command=Get-Command codex -ErrorAction SilentlyContinue
    $bundled=Join-Path $PSScriptRoot 'node_modules'
    $installed=$null -ne $command -and -not ([string]$command.Source).StartsWith($bundled,[StringComparison]::OrdinalIgnoreCase)
}
[ordered]@{installed=$installed;configured=[bool]($routed -and $endpointMatches);backup=$backup;
    configExists=(Test-Path -LiteralPath $configPath);customHome=(-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME))} | ConvertTo-Json -Compress
