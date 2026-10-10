[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 4144,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$')]
    [string]$Model = 'gpt-6.1-sol'
)

$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeDirectory = Join-Path $bridgeRoot 'runtime'
$stdoutLog = Join-Path $runtimeDirectory 'proxy.stdout.log'
$pidPath = Join-Path $runtimeDirectory 'codex-copilot-console.pid'
$consoleStatePath = Join-Path $runtimeDirectory 'codex-copilot-console.state.json'
$mutex = [Threading.Mutex]::new($false, "Local\CodexCopilotGatewayConsole_$Port")
$ownsMutex = $false
. (Join-Path $bridgeRoot 'Codex-Copilot-Config.ps1')
. (Join-Path $bridgeRoot 'Relay-Control.ps1')
. (Join-Path $bridgeRoot 'Relay-Setup.ps1')
$commandBuffer = ''

function Write-GatewaySetup {
    $health=$null; $configured=$false
    try { $health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3 } catch {}
    try {
        $text=[IO.File]::ReadAllText((Get-CodexCopilotConfigPath))
        $configured=$text -match '(?m)^model_provider\s*=\s*"github_copilot_bridge"\s*$' -and
            $text.Contains('base_url = "http://127.0.0.1:'+$Port+'/v1"')
    } catch {} finally { $text=$null }
    Write-Host (Get-RelaySetupInstructions -Port $Port -Health $health -CodexConfigured $configured)
}

function Read-GatewayCommand {
    try {
        while ([Console]::KeyAvailable) {
            $key=[Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Enter) {
                $command=$script:commandBuffer.Trim().ToLowerInvariant();$script:commandBuffer=''
                switch ($command) {
                    'key' {
                        if ([Console]::IsOutputRedirected -or [Console]::IsInputRedirected) { Write-Host 'Key reveal requires the interactive local relay terminal.' }
                        else { Write-Host 'Local Claude Gateway key (private; not an account credential):' -ForegroundColor Yellow; Write-Host (Get-RelayLocalKey -Root $bridgeRoot) }
                    }
                    'setup' { Write-GatewaySetup }
                    'models' {
                        $health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
                        Write-Host ('Claude models from live SDK: '+(@($health.claude.models | Where-Object { $_ -match '^claude-[\w.-]{1,90}$' }) -join ', '))
                        Write-Host 'Choose one in Claude Code. This command does not change either client.'
                    }
                    'status' {
                        $health=Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
                        Write-Host "v$($health.version) | Codex=$($health.ok) | Claude=$($health.claude.sdkState) | active=$($health.activeExchanges)"
                    }
                    default { Write-Host 'Commands: setup, models, key, status. To stop both adapters use Stop & Restore on the desktop.' }
                }
            }
            elseif ($key.Key -eq [ConsoleKey]::Backspace) { if ($script:commandBuffer.Length) { $script:commandBuffer=$script:commandBuffer.Substring(0,$script:commandBuffer.Length-1) } }
            elseif (-not [char]::IsControl($key.KeyChar) -and $script:commandBuffer.Length -lt 32) { $script:commandBuffer += $key.KeyChar }
        }
    } catch { Write-Host 'Command unavailable. See docs\TWO-CONTROLS.md; no key was changed.' -ForegroundColor Yellow }
}

function Write-GatewayEvent {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return
    }
    try {
        $event = $Line | ConvertFrom-Json
        if ([string]$event.type -match '^claude\.(received|selected|forwarded|tool_requested|tool_resolved|usage|completed|failed|rejected)$') {
            $safeModel={param($value) if ([string]$value -match '^[\w.-]{1,100}$') { [string]$value } else { 'unreported' }}
            $requested=& $safeModel $event.requestedModel; $selected=& $safeModel $event.selectedModel
            $usage=if ($event.type -eq 'claude.usage') { " input=$($event.inputTokens) output=$($event.outputTokens) AI-credits=$($event.aiCredits)" } else { '' }
            $requestId=if ([string]$event.requestId -match '^req_[a-f0-9-]{36}$') { ' id='+$event.requestId } else { '' }
            Write-Host "[Claude Code] $($event.type.Substring(7)) $requested -> $selected$usage$requestId" -ForegroundColor Cyan
            return
        }
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
                Write-Host "$time  [Codex] CALL START  model=$($event.model) tools=$($event.toolCount) id=$($event.responseId)" -ForegroundColor Cyan
            }
            'request.continued' {
                Write-Host "$time  [Codex] CALL RESUME toolOutputs=$($event.toolOutputs) id=$($event.responseId)" -ForegroundColor Cyan
            }
            'response.completed' {
                $detail = if ($event.kind -eq 'tool_calls') { "toolCalls=$($event.count)" } else { "model=$($event.model)" }
                Write-Host "$time  [Codex] COMPLETE    kind=$($event.kind) $detail id=$($event.responseId)" -ForegroundColor Green
            }
            'tool.requested' {
                $toolName = if ($event.namespace) { "$($event.namespace).$($event.name)" } else { [string]$event.name }
                Write-Host "$time  [Codex] TOOL ASK    $toolName id=$($event.callId)" -ForegroundColor Magenta
            }
            'tool.resolved' {
                Write-Host "$time  [Codex] TOOL DONE   failed=$($event.failed) id=$($event.callId)" -ForegroundColor Magenta
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
    try { $Host.UI.RawUI.WindowTitle = "Copilot Relay - Codex + Claude - Port $Port" } catch {}
    Clear-Host
    Write-GatewaySetup
    Write-Host ''

    $snapshot = Get-GatewaySnapshot
    if ($snapshot) {
        Write-Host "[Codex] received=$($snapshot.summary.received) completed=$($snapshot.summary.completed) failed=$($snapshot.summary.failed)"
        if ($snapshot.claude) { Write-Host "[Claude Code] received=$($snapshot.claude.received) completed=$($snapshot.claude.completed) failed=$($snapshot.claude.failed)" }
    }
    else {
        Write-Host 'Bridge is still recovering; live events will appear when it is ready.' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'LIVE EVENT STREAM' -ForegroundColor Cyan

    [long]$offset = 0
    if (Test-Path -LiteralPath $stdoutLog -PathType Leaf) {
        # Do not bury first-run instructions under old replayed events.
        $offset = (Get-Item -LiteralPath $stdoutLog).Length
    }

    while ($true) {
        Read-GatewayCommand
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
