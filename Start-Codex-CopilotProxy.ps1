[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-5.6-luna'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $bridgeRoot 'server.mjs'
$packagePath = Join-Path $bridgeRoot 'package.json'
$backupScript = Join-Path $bridgeRoot 'Backup-Codex-CopilotTelemetry.ps1'
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-proxy.pid'
$stdoutLog = Join-Path $runtimeDirectory 'proxy.stdout.log'
$processStdoutLog = Join-Path $runtimeDirectory 'proxy.process.stdout.log'
$stderrLog = Join-Path $runtimeDirectory 'proxy.stderr.log'

function Test-LocalPortInUse {
    param([int]$LocalPort)

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.BeginConnect('127.0.0.1', $LocalPort, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(250)) {
            return $false
        }
        $client.EndConnect($connect)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Get-ProxyHealth {
    try {
        return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    }
    catch {
        return $null
    }
}

function Stop-OutdatedManagedProxy {
    param(
        [Parameter(Mandatory)][psobject]$Health,
        [Parameter(Mandatory)][string]$ExpectedVersion
    )

    $reportedVersion = if ($Health.PSObject.Properties.Name -contains 'version') {
        [string]$Health.version
    }
    else {
        'legacy-unversioned'
    }
    for ($sample = 0; $sample -lt 3; $sample++) {
        $current = if ($sample -eq 0) { $Health } else { Get-ProxyHealth }
        if (-not ($current -and $current.ok -and $current.model -eq $Model)) {
            throw 'The existing relay changed state during the safe-update check. Run Start or Repair again.'
        }
        if (-not ($current.PSObject.Properties.Name -contains 'activeExchanges')) {
            throw 'The existing relay does not report active exchanges. Refusing an unsafe update restart.'
        }
        if ([int]$current.activeExchanges -gt 0) {
            throw "Relay update $reportedVersion -> $ExpectedVersion is ready, but $($current.activeExchanges) exchange(s) are still active. Let those Codex tasks reach a checkpoint, then run Start or Repair again."
        }
        if ($sample -lt 2) { Start-Sleep -Milliseconds 500 }
    }

    if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
        throw "The outdated relay is healthy, but its managed PID file is missing: $pidPath"
    }
    $pidText = ([string](Get-Content -LiteralPath $pidPath -Raw)).Trim()
    $proxyPid = 0
    if (-not [int]::TryParse($pidText, [ref]$proxyPid)) {
        throw "The outdated relay PID file is invalid: $pidPath"
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$proxyPid" -ErrorAction SilentlyContinue
    if (-not ($process -and $process.Name -eq 'node.exe' -and ([string]$process.CommandLine) -like "*$serverPath*")) {
        throw 'The outdated relay PID does not point to this bridge. Refusing to stop another process.'
    }
    Stop-Process -Id $proxyPid -Force
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not (Test-LocalPortInUse -LocalPort $Port)) { break }
        Start-Sleep -Milliseconds 100
    }
    if (Test-LocalPortInUse -LocalPort $Port) {
        throw "The outdated relay stopped, but port $Port did not become available."
    }
    Write-Output "Stopped idle relay version $reportedVersion so version $ExpectedVersion can start."
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$expectedVersion = if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
    [string]((Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json).version)
}
else {
    throw "Bridge package metadata not found: $packagePath"
}
$existingHealth = Get-ProxyHealth
if ($existingHealth -and $existingHealth.ok -and $existingHealth.model -eq $Model) {
    $existingVersion = if ($existingHealth.PSObject.Properties.Name -contains 'version') {
        [string]$existingHealth.version
    }
    else {
        'legacy-unversioned'
    }
    if ($existingVersion -eq $expectedVersion) {
        Write-Output "Codex Copilot proxy version $expectedVersion is already healthy on http://127.0.0.1:$Port using $Model."
        exit 0
    }
    Stop-OutdatedManagedProxy -Health $existingHealth -ExpectedVersion $expectedVersion
}

if (Test-LocalPortInUse -LocalPort $Port) {
    throw "TCP port $Port is already in use by a non-matching process. Choose another port."
}

$nodeCommand = Get-Command node -ErrorAction Stop
if (-not (Test-Path -LiteralPath $serverPath)) {
    throw "Bridge server not found: $serverPath"
}
if (-not (Test-Path -LiteralPath $backupScript)) {
    throw "Telemetry backup script not found: $backupScript"
}

$telemetryBackup = & $backupScript -RuntimeDirectory $runtimeDirectory -Reason 'pre-start' -Keep 8 -MaxTotalMiB 512
if ($telemetryBackup.Created) {
    Write-Output "Preserved $($telemetryBackup.RecordCount) telemetry records before startup: $($telemetryBackup.Path)"
}

$environmentNames = @(
    'BRIDGE_AUTH_TOKEN',
    'BRIDGE_DEFAULT_MODEL',
    'BRIDGE_PORT',
    'BRIDGE_RUNTIME_DIRECTORY',
    'BRIDGE_WORKING_DIRECTORY',
    'BRIDGE_EVENT_LOG_PATH',
    'BRIDGE_EVENT_LOG_MAX_MIB',
    'BRIDGE_HISTORY_LIMIT',
    'BRIDGE_DETAILED_HISTORY_LIMIT',
    'BRIDGE_HISTORY_MAX_MIB',
    'BRIDGE_METRICS_MAX_MIB',
    'BRIDGE_HISTORY_RECORD_MAX_KIB',
    'CODEX_COPILOT_BRIDGE_KEY'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$bridgeProcess = $null
try {
    # Persistent mode intentionally uses no bearer token. The server is hard-coded
    # to 127.0.0.1, and no Copilot credential or API key is copied to disk.
    Remove-Item -LiteralPath 'Env:BRIDGE_AUTH_TOKEN' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'Env:CODEX_COPILOT_BRIDGE_KEY' -ErrorAction SilentlyContinue
    $env:BRIDGE_PORT = [string]$Port
    $env:BRIDGE_DEFAULT_MODEL = $Model
    $env:BRIDGE_RUNTIME_DIRECTORY = $runtimeDirectory
    $env:BRIDGE_WORKING_DIRECTORY = $env:USERPROFILE
    $env:BRIDGE_EVENT_LOG_PATH = $stdoutLog
    $env:BRIDGE_EVENT_LOG_MAX_MIB = '64'
    $env:BRIDGE_HISTORY_LIMIT = '1000'
    $env:BRIDGE_DETAILED_HISTORY_LIMIT = '200'
    $env:BRIDGE_HISTORY_MAX_MIB = '256'
    $env:BRIDGE_METRICS_MAX_MIB = '16'
    $env:BRIDGE_HISTORY_RECORD_MAX_KIB = '512'

    $bridgeProcess = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList @("`"$serverPath`"") `
        -WorkingDirectory $bridgeRoot `
        -RedirectStandardOutput $processStdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden `
        -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($bridgeProcess.HasExited) {
            throw "The Copilot proxy exited during startup. Inspect $stderrLog."
        }
        $health = Get-ProxyHealth
        if ($health -and $health.ok -and $health.model -eq $Model) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        throw "The Copilot proxy did not become ready. Inspect $stderrLog."
    }

    Set-Content -LiteralPath $pidPath -Value ([string]$bridgeProcess.Id) -Encoding ascii
    Write-Output "Codex Copilot proxy started on http://127.0.0.1:$Port using $Model (PID $($bridgeProcess.Id))."
}
catch {
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) {
        Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw
}
finally {
    foreach ($name in $environmentNames) {
        $oldValue = $previousEnvironment[$name]
        if ($null -eq $oldValue) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -LiteralPath "Env:$name" -Value $oldValue
        }
    }
}
