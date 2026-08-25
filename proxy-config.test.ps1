$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1'
. $helper

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('codex-copilot-config-test-' + [guid]::NewGuid().ToString('N'))
$configPath = Join-Path $tempDirectory 'config.toml'
$originalCodexHome = [Environment]::GetEnvironmentVariable('CODEX_HOME', 'Process')
$originalLines = @(
    'model = "gpt-5.6-luna"',
    'model_reasoning_effort = "max"',
    '',
    '[mcp_servers.example]',
    'command = "node"'
)

New-Item -ItemType Directory -Path $tempDirectory | Out-Null
try {
    $customCodexHome = Join-Path $tempDirectory 'custom-codex-home'
    $expectedCustomConfig = [IO.Path]::GetFullPath((Join-Path $customCodexHome 'config.toml'))
    [Environment]::SetEnvironmentVariable('CODEX_HOME', $customCodexHome, 'Process')
    $resolvedCustomConfig = Get-CodexCopilotConfigPath
    if ($resolvedCustomConfig -ne $expectedCustomConfig) {
        throw "CODEX_HOME was not honored. Expected '$expectedCustomConfig', got '$resolvedCustomConfig'."
    }

    $fallbackProfile = Join-Path $tempDirectory 'fallback-profile'
    $expectedFallbackConfig = [IO.Path]::GetFullPath((Join-Path $fallbackProfile '.codex\config.toml'))
    $resolvedFallbackConfig = Get-CodexCopilotConfigPath -CodexHome '' -UserProfile $fallbackProfile
    if ($resolvedFallbackConfig -ne $expectedFallbackConfig) {
        throw "The default Codex config path was not resolved from the user profile. Expected '$expectedFallbackConfig', got '$resolvedFallbackConfig'."
    }

    $safeModelIds = @('gpt-5.6-terra', 'gpt-5.4', 'openai/gpt-5.6-sol')
    $unsafeModelIds = @('gpt-5.6-sol;Stop-Process', 'gpt 5.6 sol', 'gpt-5.6-sol`"')
    $modelCommands = @(
        'Set-CodexCopilotConfig',
        'Install-CodexCopilotStartupShortcut',
        'Install-CodexCopilotAutoStart',
        'Start-CodexCopilotAutoStart',
        'Install-CodexCopilotDesktopShortcuts'
    )
    foreach ($commandName in $modelCommands) {
        $modelParameter = (Get-Command $commandName -ErrorAction Stop).Parameters['Model']
        $validation = @($modelParameter.Attributes | Where-Object { $_ -is [Management.Automation.ValidatePatternAttribute] })
        if ($validation.Count -ne 1) {
            throw "$commandName must expose one safe model-id ValidatePattern attribute."
        }
        foreach ($modelId in $safeModelIds) {
            if ($modelId -notmatch $validation[0].RegexPattern) {
                throw "$commandName rejects the safe model ID '$modelId'."
            }
        }
        foreach ($modelId in $unsafeModelIds) {
            if ($modelId -match $validation[0].RegexPattern) {
                throw "$commandName accepts the unsafe model ID '$modelId'."
            }
        }
    }

    $modelScriptNames = @(
        'Enable-Codex-CopilotProxy.ps1',
        'Repair-Codex-CopilotProxy.ps1',
        'Start-Codex-CopilotProxy.ps1',
        'Start-Codex-With-Copilot.ps1',
        'Watch-Codex-CopilotProxy.ps1',
        'Show-Codex-CopilotGateway.ps1'
    )
    foreach ($scriptName in $modelScriptNames) {
        $scriptPath = Join-Path $PSScriptRoot $scriptName
        $modelParameter = (Get-Command $scriptPath -ErrorAction Stop).Parameters['Model']
        $validation = @($modelParameter.Attributes | Where-Object { $_ -is [Management.Automation.ValidatePatternAttribute] })
        if ($validation.Count -ne 1 -or 'gpt-5.6-terra' -notmatch $validation[0].RegexPattern) {
            throw "$scriptName does not accept safe Copilot model IDs through a ValidatePattern attribute."
        }
        if ('gpt-5.6-sol;Stop-Process' -match $validation[0].RegexPattern) {
            throw "$scriptName accepts an unsafe model argument."
        }
    }

    foreach ($scriptName in @('Enable-Codex-CopilotProxy.ps1', 'Disable-Codex-CopilotProxy.ps1')) {
        $scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot $scriptName) -Raw
        if ($scriptText -notmatch 'Get-CodexCopilotConfigPath') {
            throw "$scriptName does not use the CODEX_HOME-aware config resolver."
        }
    }

    $persistentStartText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Start-Codex-CopilotProxy.ps1') -Raw
    if ($persistentStartText -notmatch 'package\.json' -or $persistentStartText -notmatch 'activeExchanges') {
        throw 'Persistent startup does not detect outdated relay code or guard active exchanges.'
    }
    if ($persistentStartText -notmatch 'for \(\$sample = 0; \$sample -lt 3; \$sample\+\+\)') {
        throw 'Persistent startup does not require a stable idle window before an update restart.'
    }

    [IO.File]::WriteAllLines($configPath, $originalLines, [Text.UTF8Encoding]::new($false))
    $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-5.6-luna'
    $enabledText = [IO.File]::ReadAllText($configPath)
    $missingProvider = $enabledText -notmatch 'model_provider = "github_copilot_bridge"'
    $missingBaseUrl = $enabledText -notmatch 'base_url = "http://127.0.0.1:4144/v1"'
    if ($missingProvider -or $missingBaseUrl) {
        throw 'The managed provider block was not written.'
    }
    if ($enabledText -notmatch '(?m)^stream_max_retries = 3\r?$') {
        throw 'The managed provider did not enable bounded stream retries.'
    }
    if ($enabledText -notmatch '(?m)^stream_idle_timeout_ms = 900000\r?$') {
        throw 'The managed provider did not install the resilient stream idle safety net.'
    }

    $embeddedState = Get-CodexCopilotEmbeddedState -ConfigPath $configPath
    if (-not $embeddedState -or $embeddedState.OriginalModelLine -ne 'model = "gpt-5.6-luna"') {
        throw 'Embedded restore metadata was not recoverable.'
    }
    $warnings = Restore-CodexCopilotConfig -ConfigPath $configPath -State $embeddedState
    $restoredLines = [IO.File]::ReadAllLines($configPath)
    while ($restoredLines.Count -gt $originalLines.Count -and [string]::IsNullOrWhiteSpace($restoredLines[-1])) {
        $restoredLines = $restoredLines[0..($restoredLines.Count - 2)]
    }
    if (($restoredLines -join "`n") -ne ($originalLines -join "`n")) {
        throw 'config.toml did not restore exactly.'
    }
    if ($warnings.Count -ne 0) {
        throw 'Unexpected rollback warning.'
    }
    # A retained state file must also be able to repair a missing provider block.
    $repairedState = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-5.6-luna' -RestoreState $state
    Restore-CodexCopilotConfig -ConfigPath $configPath -State $repairedState | Out-Null

    # Any safe model exposed by Copilot must work; the launcher must not hard-code
    # an allowlist that drifts behind the SDK model catalog.
    $terraState = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-5.6-terra'
    if ([IO.File]::ReadAllText($configPath) -notmatch '(?m)^model = "gpt-5\.6-terra"\r?$') {
        throw 'A safe Copilot model outside the former two-model allowlist was rejected.'
    }
    Restore-CodexCopilotConfig -ConfigPath $configPath -State $terraState | Out-Null

    # Full-file restore must preserve exact bytes, including BOM and line endings.
    $exactConfigPath = Join-Path $tempDirectory 'exact-config.toml'
    $backupPath = Join-Path $tempDirectory 'config.toml.pre-copilot.bak'
    $encoding = [Text.UTF8Encoding]::new($true)
    [byte[]]$exactBytes = @($encoding.GetPreamble()) + @($encoding.GetBytes("model = `"gpt-5.6-sol`"`ncustom = `"preserve bytes`"`n"))
    [IO.File]::WriteAllBytes($exactConfigPath, $exactBytes)
    $backup = New-CodexCopilotConfigBackup -ConfigPath $exactConfigPath -BackupPath $backupPath
    $fullState = Set-CodexCopilotConfig -ConfigPath $exactConfigPath -Port 4144 -Model 'gpt-5.6-luna'
    $fullState = Add-CodexCopilotBackupToState -State $fullState -Backup $backup
    $fullState = Set-CodexCopilotConfig -ConfigPath $exactConfigPath -Port 4144 -Model 'gpt-5.6-luna' -RestoreState $fullState
    $fullEmbeddedState = Get-CodexCopilotEmbeddedState -ConfigPath $exactConfigPath
    if (-not $fullEmbeddedState.BackupSha256) {
        throw 'Embedded restore metadata did not retain full-backup fields.'
    }
    Restore-CodexCopilotConfigFromBackup -ConfigPath $exactConfigPath -State $fullEmbeddedState
    $restoredBytes = [IO.File]::ReadAllBytes($exactConfigPath)
    if ([Convert]::ToBase64String($restoredBytes) -ne [Convert]::ToBase64String($exactBytes)) {
        throw 'Full config backup did not restore byte-for-byte.'
    }

    $savedBackupBytes = [IO.File]::ReadAllBytes($backupPath)
    [IO.File]::WriteAllBytes($backupPath, [byte[]](@($savedBackupBytes) + 0))
    $hashMismatchRejected = $false
    try {
        Assert-CodexCopilotConfigBackup -State $fullEmbeddedState | Out-Null
    }
    catch {
        $hashMismatchRejected = $true
    }
    if (-not $hashMismatchRejected) {
        throw 'A modified full config backup was not rejected.'
    }

    Write-Output 'CONFIG_LINE_FALLBACK_FULL_BACKUP_AND_HASH_GUARD_OK'
}
finally {
    [Environment]::SetEnvironmentVariable('CODEX_HOME', $originalCodexHome, 'Process')
    if (Test-Path -LiteralPath $tempDirectory) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
}
