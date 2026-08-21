[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $bridgeRoot 'server.mjs'
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-proxy.pid'

if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Output 'Codex Copilot proxy PID file not found; no managed process was stopped.'
    exit 0
}

$pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
$proxyPid = 0
if (-not [int]::TryParse($pidText, [ref]$proxyPid)) {
    Remove-Item -LiteralPath $pidPath -Force
    throw "The proxy PID file is invalid: $pidPath"
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$proxyPid" -ErrorAction SilentlyContinue
if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -like "*$serverPath*") {
    Stop-Process -Id $proxyPid -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped managed Codex Copilot proxy PID $proxyPid on port $Port."
}
elseif ($process) {
    throw "PID $proxyPid no longer points to the managed bridge. Refusing to stop another process."
}
else {
    Write-Output "Managed Codex Copilot proxy PID $proxyPid was not running."
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
