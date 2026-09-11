$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Codex-Copilot-Config.ps1')
$testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('relay-hybrid-config-test-' + [guid]::NewGuid().ToString('N'))
$priorEnabled = $env:RELAY_OPENAI_ENABLED
$priorToken = $env:RELAY_OPENAI_LOCAL_TOKEN
try {
    New-Item -ItemType Directory -Path $testDirectory | Out-Null
    $testPath = Join-Path $testDirectory 'config.toml'
    [IO.File]::WriteAllText($testPath, "model = `"original-model`"`r`n")
    $env:RELAY_OPENAI_ENABLED = '1'
    $env:RELAY_OPENAI_LOCAL_TOKEN = 'test-local-token-with-at-least-32-characters'
    $state = Set-CodexCopilotConfig -ConfigPath $testPath -Port 4144 -Model 'gpt-6-astra'
    $text = [IO.File]::ReadAllText($testPath)
    if ($text -notmatch 'env_http_headers = .*RELAY_OPENAI_LOCAL_TOKEN') { throw 'Missing environment header mapping.' }
    if ($text.Contains($env:RELAY_OPENAI_LOCAL_TOKEN)) { throw 'Secret local token leaked into config.' }
    Restore-CodexCopilotConfig -ConfigPath $testPath -State $state | Out-Null
    $restored = [IO.File]::ReadAllText($testPath)
    if ($restored -match 'env_http_headers|RELAY_OPENAI') { throw 'Hybrid header was not removed on restore.' }
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return [pscustomobject]@{State='Ready'} }
    function Test-CodexCopilotTaskTargetsScript { param($Task, $ScriptPath) return $true }
    function Start-ScheduledTask { param($TaskName) throw 'Hybrid mode must inherit environment through a child process, not Task Scheduler.' }
    function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) if ($WindowStyle -ne 'Hidden') { throw 'Watchdog must be hidden.' }; $script:hybridStarted = $true }
    $mode = Start-CodexCopilotAutoStart -WatchScript (Join-Path $PSScriptRoot 'Watch-Codex-CopilotProxy.ps1') -Port 4144 -Model 'gpt-6-astra'
    if ($mode -ne 'Process' -or -not $script:hybridStarted) { throw 'Hybrid watchdog did not inherit the launcher environment.' }
    Write-Output 'HYBRID_HEADER_REFERENCE_AND_RESTORE_OK'
} finally {
    $env:RELAY_OPENAI_ENABLED = $priorEnabled; $env:RELAY_OPENAI_LOCAL_TOKEN = $priorToken
    $resolved = [IO.Path]::GetFullPath($testDirectory)
    $prefix = Join-Path ([IO.Path]::GetTempPath()) 'relay-hybrid-config-test-'
    if (-not $resolved.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
