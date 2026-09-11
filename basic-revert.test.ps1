$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('relay-basic-revert-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    # Run the real Disable entrypoint with fixture-only process/autostart hooks.
    $helper = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1'))
    $helper += "`n" + 'function Get-CodexCopilotConfigPath { Join-Path $PSScriptRoot ''config.toml'' }'
    $helper += "`n" + 'function Remove-CodexCopilotAutoStart { param([string]$WatchScript) ''fixture-autostart'' }'
    [IO.File]::WriteAllText((Join-Path $testRoot 'Codex-Copilot-Config.ps1'), $helper)
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Disable-Codex-CopilotProxy.ps1') -Destination $testRoot
    foreach ($name in @('Stop-Codex-CopilotWatchdog.ps1', 'Stop-Codex-CopilotGatewayConsole.ps1', 'Stop-Codex-CopilotProxy.ps1')) {
        $stub = 'param([int]$Port)' + "`n" + '[IO.File]::AppendAllText((Join-Path $PSScriptRoot ''stops.txt''), ''stopped'' + [Environment]::NewLine)'
        [IO.File]::WriteAllText((Join-Path $testRoot $name), $stub)
    }
    $runtime = Join-Path $testRoot 'runtime'
    New-Item -ItemType Directory -Path $runtime | Out-Null
    $configPath = Join-Path $testRoot 'config.toml'
    $original = 'model = "gpt-5.6-sol"' + "`r`n" + 'model_provider = "openai"' + "`r`n" + 'model_reasoning_effort = "low"' + "`r`n"
    [IO.File]::WriteAllText($configPath, $original)
    $protected = @{}
    foreach ($name in @('installed-engine.exe', 'auth.json', '.codex-global-state.json', 'requirements.toml')) {
        $file = Join-Path $testRoot $name
        [IO.File]::WriteAllText($file, "synthetic untouched $name")
        $protected[$file] = (Get-FileHash -LiteralPath $file).Hash
    }
    $backup = New-CodexCopilotConfigBackup -ConfigPath $configPath -BackupPath (Join-Path $runtime 'original.bak')
    $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-6-astra'
    $state = Add-CodexCopilotBackupToState -State $state -Backup $backup
    $statePath = Join-Path $runtime 'codex-copilot-proxy.state.json'
    [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 12))
    # Setup-era additions must be removed by exact restoration, too.
    $candidate = '# setup fixture marker' + "`r`n" + [IO.File]::ReadAllText($configPath)
    [IO.File]::WriteAllText($configPath, $candidate)
    $fixtureOutput = & powershell -NoProfile -File (Join-Path $testRoot 'Disable-Codex-CopilotProxy.ps1') 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Basic revert fixture failed: $fixtureOutput" }
    if ([IO.File]::ReadAllText($configPath) -cne $original) { throw 'Basic revert did not restore the exact original TOML.' }
    if (Test-Path -LiteralPath $statePath) { throw 'Managed activation state survived basic revert.' }
    if ([IO.File]::ReadAllLines((Join-Path $testRoot 'stops.txt')).Count -ne 3) { throw 'Not all stop hooks ran.' }
    foreach ($file in $protected.Keys) {
        if ((Get-FileHash -LiteralPath $file).Hash -ne $protected[$file]) { throw 'Protected fixture changed.' }
    }
    $null = & powershell -NoProfile -File (Join-Path $testRoot 'Disable-Codex-CopilotProxy.ps1') 2>&1
    if ($LASTEXITCODE -ne 0 -or [IO.File]::ReadAllText($configPath) -cne $original) { throw 'Repeated basic revert was not safe.' }
    Write-Output 'BASIC_REVERT_RESTORES_EXACT_CONFIG_AND_IS_REPEATABLE_OK'
    Write-Output 'ACCOUNT_PAIRING_POLICY_AND_UNREPLACED_ENGINE_PRESERVED_OK'
    Write-Output 'FIXTURE_ONLY_NO_LIVE_RELAY_STOPPED_NO_BINARY_REPLACEMENT_TESTED'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $prefix = Join-Path ([IO.Path]::GetTempPath()) 'relay-basic-revert-'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
