[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4141,

    [ValidateSet('gpt-5.6-sol', 'gpt-5.6-luna')]
    [string]$Model = 'gpt-5.6-sol',

    [string]$CodexPath,

    [switch]$NoInstall,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CodexArguments
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $bridgeRoot 'server.mjs'
$codexScript = Join-Path $bridgeRoot 'node_modules\@openai\codex\bin\codex.js'
$codexCommand = $null
$codexPrefixArguments = @()
if ($CodexPath) {
    $resolvedCodexPath = (Resolve-Path -LiteralPath $CodexPath -ErrorAction Stop).Path
    $codexCommand = $resolvedCodexPath
}
else {
    $codexCommand = $null
    $codexPrefixArguments = @($codexScript)
}
$sdkPath = Join-Path $bridgeRoot 'node_modules\@github\copilot-sdk\package.json'
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$stdoutLog = Join-Path $runtimeDirectory 'bridge.stdout.log'
$stderrLog = Join-Path $runtimeDirectory 'bridge.stderr.log'

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

if (Test-LocalPortInUse -LocalPort $Port) {
    throw "TCP port $Port is already in use. Close that process or rerun with -Port <another-port>."
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeVersionText = (& $nodeCommand.Source --version).TrimStart('v')
$nodeVersion = [version]$nodeVersionText
$nodeSupported = ($nodeVersion.Major -eq 20 -and $nodeVersion -ge [version]'20.19.0') -or
    ($nodeVersion -ge [version]'22.12.0')
if (-not $nodeSupported) {
    throw "Node.js 20.19+ or 22.12+ is required. Found $nodeVersionText."
}

if (-not (Test-Path -LiteralPath $sdkPath) -or (-not $CodexPath -and -not (Test-Path -LiteralPath $codexScript))) {
    if ($NoInstall) {
        throw 'Bridge dependencies are missing and -NoInstall was supplied.'
    }
    $npmCommand = Get-Command npm.cmd -ErrorAction Stop
    Write-Host 'Installing the pinned GitHub Copilot SDK and Codex CLI locally...'
    & $npmCommand.Source install --no-audit --no-fund --prefix $bridgeRoot
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE."
    }
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

$environmentNames = @(
    'BRIDGE_AUTH_TOKEN',
    'BRIDGE_PORT',
    'BRIDGE_DEFAULT_MODEL',
    'BRIDGE_WORKING_DIRECTORY',
    'CODEX_COPILOT_BRIDGE_KEY'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$token = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:BRIDGE_AUTH_TOKEN = $token
$env:CODEX_COPILOT_BRIDGE_KEY = $token
$env:BRIDGE_PORT = [string]$Port
$env:BRIDGE_DEFAULT_MODEL = $Model
$env:BRIDGE_WORKING_DIRECTORY = (Get-Location).Path

$bridgeProcess = $null
$codexExitCode = 1
try {
    $bridgeProcess = Start-Process `
        -FilePath $nodeCommand.Source `
        -ArgumentList @("`"$serverPath`"") `
        -WorkingDirectory $bridgeRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden `
        -PassThru

    $healthUri = "http://127.0.0.1:$Port/health"
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($bridgeProcess.HasExited) {
            $stderr = if (Test-Path -LiteralPath $stderrLog) {
                Get-Content -LiteralPath $stderrLog -Raw
            }
            else {
                ''
            }
            throw "The Copilot bridge exited during startup. $stderr"
        }
        try {
            $health = Invoke-RestMethod -Method Get -Uri $healthUri -TimeoutSec 2
            if ($health.ok -and $health.model -eq $Model) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        throw "The Copilot bridge did not become ready. Inspect $stderrLog."
    }

    $provider = @(
        '{',
        "name='github_copilot_bridge',",
        "base_url='http://127.0.0.1:$Port/v1',",
        "env_key='CODEX_COPILOT_BRIDGE_KEY',",
        "wire_api='responses',",
        'requires_openai_auth=false,',
        'request_max_retries=0,',
        'stream_max_retries=3,',
        'stream_idle_timeout_ms=900000',
        '}'
    ) -join ''

    $launchArguments = @(
        '-c', "model=`"$Model`"",
        '-c', 'model_provider="github_copilot_bridge"',
        '-c', 'model_reasoning_effort="max"',
        '-c', "model_providers.github_copilot_bridge=$provider"
    ) + $CodexArguments

    if (-not $CodexCommand) {
        $codexCommand = $nodeCommand.Source
    }
    Write-Host "Codex is using GitHub Copilot $Model through $healthUri"
    Write-Host 'GitHub Copilot allowance and metering still apply.'
    & $codexCommand @($codexPrefixArguments + $launchArguments)
    $codexExitCode = $LASTEXITCODE
}
finally {
    if ($bridgeProcess -and -not $bridgeProcess.HasExited) {
        Stop-Process -Id $bridgeProcess.Id -Force -ErrorAction SilentlyContinue
        $bridgeProcess.WaitForExit(5000) | Out-Null
    }
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

exit $codexExitCode
