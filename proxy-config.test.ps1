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
    if ($persistentStartText -notmatch 'DeferUpdateWhenBusy' -or $persistentStartText -notmatch 'Update deferred') {
        throw 'Persistent startup cannot keep a healthy older relay available while an update waits for active exchanges.'
    }
    if (
        $persistentStartText -match '\$existingHealth -and \$existingHealth\.ok -and \$existingHealth\.model -eq \$Model' -or
        $persistentStartText -match '\$current -and \$current\.ok -and \$current\.model -eq \$Model'
    ) {
        throw 'Persistent startup still rejects a healthy managed relay solely because its model differs.'
    }
    if (
        $persistentStartText -notmatch 'BRIDGE_MODEL_ROUTING_MODE' -or
        $persistentStartText -notmatch 'BRIDGE_LOCKED_REASONING_EFFORT' -or
        $persistentStartText -notmatch "expectedRoutingMode = 'per-request'" -or
        $persistentStartText -notmatch 'Test-ExpectedRouting'
    ) {
        throw 'Persistent startup must honor explicit model choices and verify routing.'
    }

    $enableText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Enable-Codex-CopilotProxy.ps1') -Raw
    if ($enableText -notmatch 'DeferUpdateWhenBusy') {
        throw 'Enable/repair does not opt into a non-destructive deferred relay update.'
    }
    if ($enableText -match '\[string\]\$state\.Model -ne \$Model') {
        throw 'Enable/repair still requires disablement before a same-port model transition.'
    }
    $installIndex = $enableText.IndexOf('Install-CodexCopilotAutoStart')
    $searchStart = [Math]::Max(0, $installIndex)
    $recycleIndex = $enableText.IndexOf('& $stopWatchdogScript', $searchStart)
    $restartIndex = $enableText.IndexOf('Start-CodexCopilotAutoStart', $searchStart)
    if (
        $installIndex -lt 0 -or
        $recycleIndex -lt $installIndex -or
        $restartIndex -lt $recycleIndex -or
        $enableText.Substring($restartIndex, [Math]::Min(300, $enableText.Length - $restartIndex)) -notmatch 'RestartRunning'
    ) {
        throw 'Enable/repair does not recycle the managed watchdog after staging a new expected version.'
    }

    $fakeWatchScript = Join-Path $tempDirectory 'Watch-Codex-CopilotProxy.ps1'
    $script:fakeTaskState = 'Running'
    $script:fakeTaskStopCount = 0
    $script:fakeTaskStartCount = 0
    function Get-ScheduledTask {
        param([string]$TaskName, $ErrorAction)

        return [pscustomobject]@{
            State = $script:fakeTaskState
            Actions = @([pscustomobject]@{
                Execute = 'powershell.exe'
                Arguments = "-NoProfile -File `"$fakeWatchScript`" -Port 4144 -Model gpt-5.6-sol"
            })
        }
    }
    function Stop-ScheduledTask {
        param([string]$TaskName)

        $script:fakeTaskStopCount++
        $script:fakeTaskState = 'Ready'
    }
    function Start-ScheduledTask {
        param([string]$TaskName)

        $script:fakeTaskStartCount++
        $script:fakeTaskState = 'Running'
    }
    try {
        Start-CodexCopilotAutoStart `
            -WatchScript $fakeWatchScript `
            -Port 4144 `
            -Model 'gpt-5.6-sol' `
            -RestartRunning | Out-Null
        if ($script:fakeTaskStopCount -ne 1 -or $script:fakeTaskStartCount -ne 1) {
            throw 'Restarting auto-recovery did not stop and relaunch the already-running managed watchdog.'
        }
    }
    finally {
        Remove-Item -LiteralPath Function:Get-ScheduledTask -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Function:Stop-ScheduledTask -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath Function:Start-ScheduledTask -ErrorAction SilentlyContinue
        Remove-Variable -Name fakeTaskState, fakeTaskStopCount, fakeTaskStartCount -Scope Script -ErrorAction SilentlyContinue
    }

    $watchText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Watch-Codex-CopilotProxy.ps1') -Raw
    if ($watchText -notmatch 'package\.json' -or $watchText -notmatch 'activeExchanges' -or $watchText -notmatch 'version') {
        throw 'The watchdog cannot promote a deferred relay update after exchanges become idle.'
    }
    if (
        $watchText -notmatch 'Sync-WatchedConfig' -or
        $watchText -notmatch 'Set-CodexCopilotConfig' -or
        $watchText -notmatch '\$health\.model -eq \$Model'
    ) {
        throw 'The watchdog cannot reconcile the managed Codex route after a model transition.'
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

    # Context overrides come from the selected live model and survive repair.
    $contextPath = Join-Path $tempDirectory 'context-config.toml'
    [IO.File]::WriteAllLines($contextPath, @('model = "gpt-5.6-luna"', 'model_context_window = 272000', 'model_auto_compact_token_limit = 250000'))
    $astraHealth = [pscustomobject]@{ ok = $true; model = 'gpt-6-astra'; compatibility = [pscustomobject]@{ maxContextWindowTokens = 1000000; maxPromptTokens = 872000 } }
    $catalogPath = New-CodexCopilotModelCatalog -Health $astraHealth -Model 'gpt-6-astra' -Directory $tempDirectory -BaseInstructions 'CODEX_ORIGINAL_INSTRUCTIONS'
    $catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
    $entry = $catalog.models[0]
    if ($entry.max_context_window -ne 1000000 -or $entry.effective_context_window_percent -ne 87 -or $entry.model_messages.instructions_template -ne 'CODEX_ORIGINAL_INSTRUCTIONS') { throw 'The generated catalog did not preserve instructions and real model limits.' }
    $contextState = Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-6-astra' -ModelHealth $astraHealth -ModelCatalogPath $catalogPath
    $contextState = Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-6-astra' -RestoreState $contextState
    $contextText = [IO.File]::ReadAllText($contextPath)
    if ($contextText -notmatch '(?m)^model_context_window = 1000000' -or $contextText -notmatch '(?m)^model_auto_compact_token_limit = 780000' -or $contextText -notmatch '(?m)^model_catalog_json = ' -or $contextText -notmatch '(?m)^web_search = "disabled"') { throw 'Live context/catalog/search settings were not installed or did not survive repair.' }
    $contextState = Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-5.6-sol' -RestoreState $contextState
    $contextText = [IO.File]::ReadAllText($contextPath)
    if ($contextText -notmatch '(?m)^model_context_window = 272000' -or $contextText -notmatch '(?m)^model_auto_compact_token_limit = 250000') { throw 'A model transition leaked Astra context settings.' }
    Restore-CodexCopilotConfig -ConfigPath $contextPath -State $contextState | Out-Null
    [IO.File]::WriteAllLines($contextPath, @('model = "gpt-5.6-luna"'))
    $contextState = Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-6-astra' -ModelHealth $astraHealth
    $contextState = Get-CodexCopilotEmbeddedState -ConfigPath $contextPath
    Restore-CodexCopilotConfig -ConfigPath $contextPath -State $contextState | Out-Null
    if ([IO.File]::ReadAllText($contextPath) -match 'model_context_window|model_auto_compact_token_limit') { throw 'Rollback did not remove inserted context overrides.' }
    if ((Get-CodexCopilotContextSettings -Health $astraHealth -Model 'gpt-5.6-sol').Count -ne 0) { throw 'Context settings used another model metadata.' }

    # Different subagent models must retain their own caps, defaults and restoration.
    $multiHealth = [pscustomobject]@{ ok=$true; model='gpt-6-astra'; models=@('gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra'); routing=[pscustomobject]@{mode='per-request'}; compatibility=$astraHealth.compatibility; modelCapabilities=[pscustomobject]@{
        'gpt-6-astra'=[pscustomobject]@{maxContextWindowTokens=1000000;maxPromptTokens=872000;supportedReasoningEfforts=@('low','high','xhigh');defaultReasoningEffort='xhigh';maxImageAttachments=1}
        'gpt-5.6-sol'=[pscustomobject]@{maxContextWindowTokens=1050000;maxPromptTokens=922000;supportedReasoningEfforts=@('low','high','xhigh','max');defaultReasoningEffort='max';maxImageAttachments=1}
        'gpt-5.6-terra'=[pscustomobject]@{maxContextWindowTokens=272000;maxPromptTokens=240000;supportedReasoningEfforts=@('low','high');defaultReasoningEffort='high';maxImageAttachments=0}
    }}
    $multiCatalogPath=New-CodexCopilotModelCatalog -Health $multiHealth -Model 'gpt-6-astra' -Directory $tempDirectory -BaseInstructions 'CODEX_ORIGINAL_INSTRUCTIONS'
    $multiCatalog=Get-Content -LiteralPath $multiCatalogPath -Raw | ConvertFrom-Json
    $solEntry=$multiCatalog.models | Where-Object slug -eq 'gpt-5.6-sol'
    $terraEntry=$multiCatalog.models | Where-Object slug -eq 'gpt-5.6-terra'
    if ($solEntry.max_context_window -ne 1050000 -or $solEntry.default_reasoning_level -ne 'max' -or $terraEntry.max_context_window -ne 272000) { throw 'Per-model metadata was replaced with Astra limits.' }
    if (-not $solEntry.supports_parallel_tool_calls -or $solEntry.truncation_policy.limit -ne 65536) { throw 'Parallel tools or 64 KiB result budget missing.' }
    [IO.File]::WriteAllLines($contextPath,@('model = "gpt-5.6-sol"','model_context_window = 272000','model_auto_compact_token_limit = 250000'))
    $multiState=Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-6-astra' -ModelHealth $multiHealth -ModelCatalogPath $multiCatalogPath
    $multiState=Set-CodexCopilotConfig -ConfigPath $contextPath -Port 4144 -Model 'gpt-6-astra' -RestoreState $multiState
    if ([IO.File]::ReadAllText($contextPath) -match '(?m)^model_(context_window|auto_compact_token_limit) =') { throw 'Global context overrides shadow per-model catalog.' }
    Restore-CodexCopilotConfig -ConfigPath $contextPath -State $multiState | Out-Null
    if ([IO.File]::ReadAllText($contextPath) -notmatch 'model_context_window = 272000') { throw 'Rollback lost original context override.' }

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
        $resolvedTestDirectory = [IO.Path]::GetFullPath($tempDirectory)
        $expectedTestPrefix = Join-Path ([IO.Path]::GetTempPath()) 'codex-copilot-config-test-'
        if (-not $resolvedTestDirectory.StartsWith($expectedTestPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a directory outside this config test.' }
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
}
