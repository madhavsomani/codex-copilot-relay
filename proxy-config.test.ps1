$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1'
. $helper

$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('codex-copilot-config-test-' + [guid]::NewGuid().ToString('N'))
$configPath = Join-Path $tempDirectory 'config.toml'
$originalLines = @(
    'model = "gpt-5.6-luna"',
    'model_reasoning_effort = "max"',
    '',
    '[mcp_servers.example]',
    'command = "node"'
)

New-Item -ItemType Directory -Path $tempDirectory | Out-Null
try {
    [IO.File]::WriteAllLines($configPath, $originalLines, [Text.UTF8Encoding]::new($false))
    $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-5.6-luna'
    $enabledText = [IO.File]::ReadAllText($configPath)
    $missingProvider = $enabledText -notmatch 'model_provider = "github_copilot_bridge"'
    $missingBaseUrl = $enabledText -notmatch 'base_url = "http://127.0.0.1:4144/v1"'
    if ($missingProvider -or $missingBaseUrl) {
        throw 'The managed provider block was not written.'
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
    if (Test-Path -LiteralPath $tempDirectory) {
        Remove-Item -LiteralPath $tempDirectory -Recurse -Force
    }
}
