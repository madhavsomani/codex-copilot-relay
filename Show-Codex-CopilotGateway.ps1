[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidateSet('gpt-5.6-sol', 'gpt-5.6-luna')]
    [string]$Model = 'gpt-5.6-sol'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$stdoutLog = Join-Path $runtimeDirectory 'proxy.stdout.log'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-console.pid'
$consoleStatePath = Join-Path $runtimeDirectory 'codex-copilot-console.state.json'
$mutex = [Threading.Mutex]::new($false, "Local\CodexCopilotGatewayConsole_$Port")
$ownsMutex = $false

function Write-GatewayEvent {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return
    }
    try {
        $event = $Line | ConvertFrom-Json
        $time = try {
            [DateTimeOffset]::Parse([string]$event.timestamp).ToLocalTime().ToString('HH:mm:ss')
        }
        catch {
            Get-Date -Format 'HH:mm:ss'
        }
        switch ([string]$event.type) {
            'bridge.ready' {
                Write-Host "$time  READY       $($event.model) at $($event.url)" -ForegroundColor Green
            }
            'bridge.shutdown' {
                Write-Host "$time  STOPPED     signal=$($event.signal) (watchdog will recover it)" -ForegroundColor Yellow
            }
            'request.started' {
                Write-Host "$time  CALL START  model=$($event.model) tools=$($event.toolCount) id=$($event.responseId)" -ForegroundColor Cyan
            }
            'request.continued' {
                Write-Host "$time  CALL RESUME toolOutputs=$($event.toolOutputs) id=$($event.responseId)" -ForegroundColor Cyan
            }
            'response.completed' {
                $detail = if ($event.kind -eq 'tool_calls') { "toolCalls=$($event.count)" } else { "model=$($event.model)" }
                Write-Host "$time  COMPLETE    kind=$($event.kind) $detail id=$($event.responseId)" -ForegroundColor Green
            }
            'tool.requested' {
                $toolName = if ($event.namespace) { "$($event.namespace).$($event.name)" } else { [string]$event.name }
                Write-Host "$time  TOOL ASK    $toolName id=$($event.callId)" -ForegroundColor Magenta
            }
            'tool.resolved' {
                Write-Host "$time  TOOL DONE   failed=$($event.failed) id=$($event.callId)" -ForegroundColor Magenta
            }
            'blank_completion.detected' {
                Write-Host "$time  BLANK SEEN  model=$($event.model) id=$($event.responseId)" -ForegroundColor Yellow
            }
            'blank_completion.retry' {
                Write-Host "$time  AUTO RETRY  attempt=$($event.attempt) id=$($event.responseId)" -ForegroundColor Yellow
            }
            'context.compacted' {
                Write-Host "$time  CONTEXT OK  images=$($event.imageAttachments) clippedTools=$($event.truncatedToolOutputs) id=$($event.responseId)" -ForegroundColor Yellow
            }
            'response.failed' {
                Write-Host "$time  FAILED      $($event.code): $($event.message) id=$($event.responseId)" -ForegroundColor Red
            }
            'exchange.error' {
                Write-Host "$time  ERROR       $($event.code): $($event.message)" -ForegroundColor Red
            }
            'session.disconnect_error' {
                Write-Host "$time  DISCONNECT  $($event.message)" -ForegroundColor DarkYellow
            }
            default {
                Write-Host "$time  EVENT       $($event.type)" -ForegroundColor DarkGray
            }
        }
    }
    catch {
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  LOG         Unparseable bridge event" -ForegroundColor DarkGray
    }
}

function Get-GatewaySnapshot {
    try {
        return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/dashboard/api" -TimeoutSec 2
    }
    catch {
        return $null
    }
}

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    }
    catch [Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        exit 0
    }

    Set-Content -LiteralPath $pidPath -Value ([string]$PID) -Encoding ascii
    [pscustomobject][ordered]@{
        ProcessId = $PID
        Host = if ($env:WT_SESSION) { 'WindowsTerminal' } else { 'ConsoleHost' }
        TerminalSession = if ($env:WT_SESSION) { [string]$env:WT_SESSION } else { $null }
        StartedAt = (Get-Date).ToUniversalTime().ToString('o')
        Port = $Port
        Model = $Model
    } | ConvertTo-Json | Set-Content -LiteralPath $consoleStatePath -Encoding utf8
    try { $Host.UI.RawUI.WindowTitle = "Codex Copilot Gateway - $Model - Port $Port" } catch {}
    Clear-Host
    Write-Host 'CODEX -> GITHUB COPILOT GATEWAY' -ForegroundColor Cyan
    Write-Host "Healthy endpoint : http://127.0.0.1:$Port/health"
    Write-Host "Dashboard        : http://127.0.0.1:$Port/dashboard"
    Write-Host "Model            : $Model"
    Write-Host ''
    Write-Host 'This window shows live bridge, model, and tool-call events.'
    Write-Host 'Closing this window is temporary: the watchdog will reopen it.' -ForegroundColor Yellow
    Write-Host 'To stop permanently and restore normal Codex, use the Restore Normal Codex desktop shortcut.' -ForegroundColor Yellow
    Write-Host ''

    $snapshot = Get-GatewaySnapshot
    if ($snapshot) {
        Write-Host "Current totals   : received=$($snapshot.summary.received) completed=$($snapshot.summary.completed) failed=$($snapshot.summary.failed) active=$($snapshot.summary.active) tools=$($snapshot.summary.toolCalls)"
    }
    else {
        Write-Host 'Bridge is still recovering; live events will appear when it is ready.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'LIVE EVENT STREAM' -ForegroundColor Cyan

    [long]$offset = 0
    if (Test-Path -LiteralPath $stdoutLog -PathType Leaf) {
        foreach ($line in @(Get-Content -LiteralPath $stdoutLog -Tail 15 -ErrorAction SilentlyContinue)) {
            Write-GatewayEvent -Line ([string]$line)
        }
        $offset = (Get-Item -LiteralPath $stdoutLog).Length
    }

    while ($true) {
        if (Test-Path -LiteralPath $stdoutLog -PathType Leaf) {
            $length = (Get-Item -LiteralPath $stdoutLog).Length
            if ($length -lt $offset) {
                $offset = 0
            }
            if ($length -gt $offset) {
                $stream = $null
                $reader = $null
                try {
                    $stream = [IO.File]::Open(
                        $stdoutLog,
                        [IO.FileMode]::Open,
                        [IO.FileAccess]::Read,
                        [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
                    )
                    $stream.Seek($offset, [IO.SeekOrigin]::Begin) | Out-Null
                    $reader = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false), $true, 4096, $true)
                    while (-not $reader.EndOfStream) {
                        Write-GatewayEvent -Line ([string]$reader.ReadLine())
                    }
                    $offset = $stream.Position
                }
                finally {
                    if ($reader) { $reader.Dispose() }
                    if ($stream) { $stream.Dispose() }
                }
            }
        }
        Start-Sleep -Milliseconds 400
    }
}
finally {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $consoleStatePath -Force -ErrorAction SilentlyContinue
    if ($ownsMutex) {
        try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
}
