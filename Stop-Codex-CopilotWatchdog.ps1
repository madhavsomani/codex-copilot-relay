[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchScript = Join-Path $bridgeRoot 'Watch-Codex-CopilotProxy.ps1'
$pidPath = Join-Path $bridgeRoot 'runtime\codex-copilot-watchdog.pid'

if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Output 'Codex Copilot watchdog PID file not found; no managed watchdog was stopped.'
    exit 0
}

$pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
$watchdogPid = 0
if (-not [int]::TryParse($pidText, [ref]$watchdogPid)) {
    Remove-Item -LiteralPath $pidPath -Force
    throw "The watchdog PID file is invalid: $pidPath"
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$watchdogPid" -ErrorAction SilentlyContinue
$isPowerShell = $process -and $process.Name -in @('powershell.exe', 'pwsh.exe')
if ($isPowerShell -and $process.CommandLine -like "*$watchScript*") {
    Stop-Process -Id $watchdogPid -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped managed Codex Copilot watchdog PID $watchdogPid."
}
elseif ($process) {
    throw "PID $watchdogPid no longer points to the managed watchdog. Refusing to stop another process."
}
else {
    Write-Output "Managed Codex Copilot watchdog PID $watchdogPid was not running."
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
