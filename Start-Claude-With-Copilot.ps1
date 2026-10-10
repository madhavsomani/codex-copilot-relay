param(
    [ValidateRange(1024, 65535)][int]$Port = 4246,
    [ValidateRange(0, 65535)][int]$SetupPort = 0,
    [switch]$OpenSetup,
    [switch]$NoSetup,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ClaudeArguments
)
$ErrorActionPreference = 'Stop'
if ($Port -eq 4144) { throw 'Claude preview must not use the live Codex relay port.' }
$taskClaude = Get-Command claude -ErrorAction Stop
$taskOldExecutable = $env:CLAUDE_EXECUTABLE
try {
    $env:CLAUDE_EXECUTABLE = $taskClaude.Source
    $taskLauncherArgs = @('--port', [string]$Port)
    if ($NoSetup) { $taskLauncherArgs += '--no-setup' }
    else { $taskLauncherArgs += @('--setup-port', [string]$SetupPort) }
    if ($OpenSetup) { $taskLauncherArgs += '--open-setup' }
    & node (Join-Path $PSScriptRoot 'claude-gateway\launch.mjs') @taskLauncherArgs -- @ClaudeArguments
    if ($LASTEXITCODE -ne 0) { throw "Claude gateway exited with code $LASTEXITCODE." }
} finally {
    $env:CLAUDE_EXECUTABLE = $taskOldExecutable
}
