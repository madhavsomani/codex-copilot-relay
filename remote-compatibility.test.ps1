$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('relay-remote-compat-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $configPath = Join-Path $testRoot 'config.toml'
    $original = @(
        'model = "gpt-5.6-sol"',
        'model_provider = "openai"',
        'forced_login_method = "chatgpt"',
        'cli_auth_credentials_store = "keyring"',
        'chatgpt_base_url = "https://chatgpt.com"',
        '',
        '[features]',
        'apps = true',
        '',
        '[mcp_servers.example]',
        'command = "fixture-command"'
    )
    $accountLines = $original[2..4]
    $unrelatedTables = $original[6..11] -join "`n"
    $authPath = Join-Path $testRoot 'auth.json'
    $appStatePath = Join-Path $testRoot '.codex-global-state.json'
    $policyPath = Join-Path $testRoot 'requirements.toml'
    # Synthetic sentinels only; never read or overwrite the user's login/pairings.
    [IO.File]::WriteAllText($authPath, '{"fixture":"synthetic-account-state"}')
    [IO.File]::WriteAllText($appStatePath, '{"codex-mobile-has-connected-device":true,"electron-local-remote-control-installation-id":"synthetic-installation"}')
    foreach ($allowed in @('true', 'false')) {
        [IO.File]::WriteAllLines($configPath, $original)
        [IO.File]::WriteAllText($policyPath, "allow_remote_control = $allowed")
        $protected = @{}
        foreach ($file in @($authPath, $appStatePath, $policyPath)) {
            $protected[$file] = (Get-FileHash -LiteralPath $file).Hash
        }
        $backup = New-CodexCopilotConfigBackup -ConfigPath $configPath -BackupPath (Join-Path $testRoot "original-$allowed.bak")
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-6-astra'
        $state = Add-CodexCopilotBackupToState -State $state -Backup $backup
        foreach ($model in @('gpt-6-astra', 'gpt-5.6-sol')) {
            $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model $model -RestoreState $state
            $text = [IO.File]::ReadAllText($configPath).Replace("`r`n", "`n")
            foreach ($line in $accountLines) { if (-not $text.Contains($line + "`n")) { throw 'Account service configuration changed during repair.' } }
            if (-not $text.Contains($unrelatedTables)) { throw 'Unrelated app/connector settings changed.' }
            foreach ($line in @('requires_openai_auth = true', 'experimental_bearer_token = "codex-copilot-local-only"')) {
                if (-not $text.Contains($line)) { throw 'Lost the paired desktop identity and local-model credential settings.' }
            }
        }
        Restore-CodexCopilotConfig -ConfigPath $configPath -State $state | Out-Null
        if ([IO.File]::ReadAllText($configPath) -notmatch 'model_provider = "openai"') { throw 'Line-level restoration did not return to the original provider.' }
        $state = Set-CodexCopilotConfig -ConfigPath $configPath -Port 4144 -Model 'gpt-6-astra' -RestoreState $state
        Restore-CodexCopilotConfigFromBackup -ConfigPath $configPath -State $state
        if ((Get-FileHash -LiteralPath $configPath).Hash.ToLowerInvariant() -ne $backup.BackupSha256) { throw 'Full restoration changed the original config.' }
        foreach ($file in $protected.Keys) {
            if ((Get-FileHash -LiteralPath $file).Hash -ne $protected[$file]) { throw 'Account, app pairing state, or Remote policy was modified.' }
        }
    }
    Write-Output 'REMOTE_ACCOUNT_PAIRING_AND_POLICY_PRESERVED_OK'
    Write-Output 'LOCAL_CONFIG_TEST_ONLY_PHONE_ROUND_TRIP_NOT_VERIFIED'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $prefix = Join-Path ([IO.Path]::GetTempPath()) 'relay-remote-compat-'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
